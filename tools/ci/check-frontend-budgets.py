#!/usr/bin/env python3
"""10 §9's resource budgets, re-derived from the documents and the runtime that own them.

Doc 10 §9 publishes a load model, two retention-depth tables, a metadata bound and a
bundle budget. Every one of those numbers is a *derived* value, and until now nothing
re-derived any of them — which is how §9.1 came to size the browser against **196**
concurrently-observing books when the chain can never have more than **31**, and how
§9.3's metadata cap came to exceed the §9.2 share it is drawn from (SQ-557).

The point of this gate is that it carries **no answers of its own**. It reads:

* `13-parameters.md` §1 for `epoch.length`, `epoch.slots` and `mkt.obs_interval`;
* `13-parameters.md` §3.1 for the Trade-phase fraction;
* `13-parameters.md` §4/§5 for `MaxLiveProposals`, `MaxSettlingCohorts`, the frozen
  vault envelope and the `epoch.slots·6 + 1` book formula;
* the runtime's own pinned `MAX_TRADED_EVENTS_PER_BLOCK`, which
  `pov_budgets::traded_event_ceiling_per_block_pinned_for_frontend_budgets` proves
  against the live block budget and `buy`'s dispatched weight;

then derives §9's cells and compares them with what doc 10 prints. A checker holding its
own copy of the load model would agree with itself — the exact failure V-169 was, where a
constant and the fixtures built from it agreed while neither matched the chain.

Anti-vacuity is structural throughout: an anchor that cannot be found, a table that parses
to zero rows, or a cell that is not a number is an error rather than a pass.
"""

from __future__ import annotations

import pathlib
import re
import sys
from fractions import Fraction

ROOT = pathlib.Path(__file__).resolve().parents[2]
PARAMS = ROOT / "docs" / "architecture" / "13-parameters.md"
FRONTEND = ROOT / "docs" / "architecture" / "10-frontend-architecture.md"
POV_BUDGETS = ROOT / "runtime" / "bleavit-runtime" / "src" / "pov_budgets.rs"
SMOLDOT_GATE = ROOT / "app" / "tools" / "check-smoldot-budget.ts"
PRIMITIVES = ROOT / "crates" / "futarchy-primitives" / "src" / "lib.rs"
BUNDLE_GATE = ROOT / "app" / "tools" / "check-bundle-budget.ts"

#: 10 §9.1's effective per-row cost, and the one modelling assumption the documents
#: state rather than derive. It is labelled as an assumption in §9.1 itself, so it is
#: read from there rather than written here.
ROW_BYTES_ANCHOR = "~120 B effective per row"


class Fail(SystemExit):
    def __init__(self, message: str) -> None:
        super().__init__(f"FAIL {message}")


def find(text: str, pattern: str, what: str) -> re.Match[str]:
    """Match, or explain what is now underivable rather than raising an opaque error.

    A gate whose failure reads like a bug in the gate gets switched off instead of
    fixed, so a heading that moved has to report in the same voice as a real finding.
    """
    match = re.search(pattern, text, re.UNICODE | re.MULTILINE)
    if match is None:
        raise Fail(
            f"cannot locate {what}: the anchor is gone from the document. Either the "
            f"section moved — update this checker — or the value is no longer stated, "
            f"in which case doc 10 §9 is unverifiable rather than merely stale."
        )
    return match


def number(raw: str) -> float:
    return float(raw.replace(",", "").replace(" ", ""))


def product(expression: str) -> float:
    """Evaluate a `a * b * c` literal product, so both `3.5e6` and `3.5 * 1024 * 1024` read."""
    value = 1.0
    for factor in expression.split("*"):
        value *= float(factor.strip())
    return value


def decimals(raw: str) -> int:
    cleaned = raw.replace(",", "")
    return len(cleaned.split(".")[1]) if "." in cleaned else 0


def agrees(printed: str, derived: float) -> bool:
    """Does the published cell equal the derivation *at the precision it was printed*?

    Comparing to a fixed tolerance would let a cell printed to three decimals drift in
    the third, and would reject an honestly-rounded one-decimal cell. The document
    chooses its own precision; this reads that choice back.
    """
    return round(derived, decimals(printed)) == round(number(printed), decimals(printed))


# --------------------------------------------------------------------- doc 13 inputs


def registry_default(text: str, key: str) -> str:
    """The `default` cell of a 13 §1 registry row."""
    row = find(
        text,
        rf"^\| `{re.escape(key)}`[^|\n]*\|([^|\n]*\|){{2}}([^|\n]+)\|",
        f"13 §1's `{key}` row",
    )
    return row.group(2).strip()


def parameters() -> dict[str, object]:
    text = PARAMS.read_text(encoding="utf-8")

    length_cell = registry_default(text, "epoch.length")
    epoch_length = number(find(length_cell, r"([\d,]+)", "13 §1 `epoch.length` default").group(1))
    epoch_days = number(
        find(length_cell, r"\(([\d.]+)\s*d\)", "the day label on 13 §1's `epoch.length` row").group(1)
    )
    slots = number(registry_default(text, "epoch.slots"))
    obs_interval = number(registry_default(text, "mkt.obs_interval"))

    trade = find(
        text,
        r"^\| \*\*Trade\*\* \| \[(\d+)/(\d+), (\d+)/(\d+)\)",
        "13 §3.1's Trade-phase fraction",
    )
    start, den, end, den2 = (int(g) for g in trade.groups())
    if den != den2:
        raise Fail(f"13 §3.1's Trade fraction has mismatched denominators ({den}, {den2})")
    trade_fraction = Fraction(end - start, den)

    # §5 item 4 owns the book formula; §5 item 2 owns the vault envelope that caps the
    # slate. Both are read rather than restated, because the whole finding is that 31
    # is a *maximum* and the argument for that lives in item 2.
    books_formula = find(
        text, r"\(epoch\.slots·(\d+) \+ (\d+)\)", "13 §5's `epoch.slots·6 + 1` book formula"
    )
    books_per_slot, baseline_books = (int(g) for g in books_formula.groups())

    vault_row = find(
        text,
        r"^\| 2 \| `MaxLiveProposals \+ MaxSettlingCohorts·epoch\.slots`[^|]*\|\s*\*\*(\d+)\*\*",
        "13 §5 item 2's frozen vault envelope",
    )
    vault_envelope = int(vault_row.group(1))
    live_proposals = int(
        find(text, r"^\| `MaxLiveProposals` \| \*\*(\d+)\*\*", "13 §4's `MaxLiveProposals` row").group(1)
    )
    settling = int(
        find(text, r"^\| `MaxSettlingCohorts` \| (\d+) non-terminal", "13 §4's `MaxSettlingCohorts` row").group(1)
    )

    if settling <= 0:
        raise Fail("13 §4's `MaxSettlingCohorts` parsed as zero; the slate cap is underivable")
    max_slots = (vault_envelope - live_proposals) // settling

    return {
        "epoch_length": epoch_length,
        "epoch_days": epoch_days,
        "slots": slots,
        "obs_interval": obs_interval,
        "trade_fraction": trade_fraction,
        "books_per_slot": books_per_slot,
        "baseline_books": baseline_books,
        "max_slots": max_slots,
    }


def traded_ceiling() -> int:
    """The runtime's pinned per-block `Traded` ceiling.

    Read from the Rust source rather than restated, so the three-way binding holds: the
    runtime test proves this literal against the live block budget and `buy`'s dispatched
    weight, and this gate proves doc 10 against the same literal. Neither side is the
    source of truth on its own.
    """
    source = POV_BUDGETS.read_text(encoding="utf-8")
    match = find(
        source,
        r"const MAX_TRADED_EVENTS_PER_BLOCK: u64 = (\d+);",
        "the runtime's pinned `MAX_TRADED_EVENTS_PER_BLOCK`",
    )
    return int(match.group(1))


# --------------------------------------------------------------------- doc 10 tables


def section(text: str, start: str, end: str, what: str) -> str:
    i = text.find(start)
    if i < 0:
        raise Fail(f"cannot locate {what}: the heading {start!r} is gone from doc 10")
    j = text.find(end, i + len(start))
    if j < 0:
        raise Fail(f"{what} has no end anchor {end!r}; the parse would run past it")
    return text[i:j]


def table_rows(body: str, header_contains: str, what: str) -> list[list[str]]:
    """The data rows of the one markdown table whose header line contains `header_contains`."""
    rows: list[list[str]] = []
    collecting = False
    for line in body.split("\n"):
        stripped = line.strip()
        if not stripped.startswith("|"):
            if collecting:
                break
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if not collecting:
            if header_contains in stripped:
                collecting = True
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        rows.append(cells)
    if not rows:
        raise Fail(f"{what} parsed to zero data rows; the table moved or its header changed")
    return rows


def main() -> int:
    p = parameters()
    doc = FRONTEND.read_text(encoding="utf-8")
    nine = section(doc, "## 9. Resource budgets", "## 10. Package structure", "doc 10 §9")

    checked = 0
    row_bytes = number(
        find(nine, re.escape(ROW_BYTES_ANCHOR).replace("120", r"(\d+)"), "§9.1's per-row byte model").group(1)
    )
    blocks_per_day = Fraction(int(p["epoch_length"]), int(p["epoch_days"]))
    # The day count comes from a parenthetical on 13 §1's `epoch.length` row — the one
    # input here that is a label rather than a value, and every rate below scales with it.
    # The kernel publishes the same figure as a constant, so the two are cross-checked
    # rather than one of them trusted.
    kernel_per_day = int(
        find(
            PRIMITIVES.read_text(encoding="utf-8"),
            r"pub const BLOCKS_PER_DAY: u32 = ([\d_]+);",
            "the kernel's `BLOCKS_PER_DAY`",
        )
        .group(1)
        .replace("_", "")
    )
    if blocks_per_day != kernel_per_day:
        raise Fail(
            f"13 §1's `epoch.length` row implies {float(blocks_per_day):g} blocks/day "
            f"({int(p['epoch_length'])} blocks over its '{int(p['epoch_days'])} d' label), but the "
            f"kernel pins BLOCKS_PER_DAY = {kernel_per_day}. Every rate in §9 scales with this, so "
            "the disagreement has to be resolved before any cell can be derived."
        )
    checked += 1
    obs_per_book_day = blocks_per_day / int(p["obs_interval"]) * p["trade_fraction"]

    def books(slots: int) -> int:
        return slots * int(p["books_per_slot"]) + int(p["baseline_books"])

    max_books = books(int(p["max_slots"]))

    # --- §9.1's slate lattice -------------------------------------------------------
    for cells in table_rows(nine, "Trading books", "§9.1's load table"):
        slate = find(cells[0], r"(\d+) of (\d+)", "a §9.1 slate label")
        slots, of = (int(g) for g in slate.groups())
        if of != int(p["max_slots"]):
            raise Fail(
                f"§9.1 prints the slate as '{slots} of {of}' but 13 §5 item 2's envelope "
                f"({p['max_slots']} slots) is what caps it"
            )
        printed_books = number(re.sub(r"[^\d]", "", cells[1]))
        if printed_books != books(slots):
            raise Fail(
                f"§9.1's {slots}-slot row publishes {printed_books:.0f} trading books; "
                f"13 §5's formula gives {books(slots)}"
            )
        rows_day = books(slots) * obs_per_book_day
        printed_rows = find(cells[2], r"([\d.,]+)\s*k", "a §9.1 rows/day cell").group(1)
        if not agrees(printed_rows, float(rows_day) / 1000):
            raise Fail(
                f"§9.1's {slots}-slot row publishes {printed_rows} k rows/day; derived "
                f"{float(rows_day) / 1000:.4f} k"
            )
        printed_bytes = find(cells[3], r"([\d.,]+)\s*MB", "a §9.1 bytes/day cell").group(1)
        if not agrees(printed_bytes, float(rows_day) * row_bytes / 1e6):
            raise Fail(
                f"§9.1's {slots}-slot row publishes {printed_bytes} MB/day; derived "
                f"{float(rows_day) * row_bytes / 1e6:.4f} MB"
            )
        checked += 3

    # --- §9.1's book count and `Traded` ceiling -------------------------------------
    stated_books = int(
        find(nine, r"trading books = epoch\.slots·\d+ \+ \d+ = (\d+)", "§9.1's book count").group(1)
    )
    if stated_books != max_books:
        raise Fail(f"§9.1 states {stated_books} trading books; 13 §5's formula gives {max_books}")

    ceiling = traded_ceiling()
    stated_ceiling = int(find(nine, r"\*\*(\d+) fills per block\*\*", "§9.1's fill ceiling").group(1))
    if stated_ceiling != ceiling:
        raise Fail(
            f"§9.1 states {stated_ceiling} fills per block; the runtime pins {ceiling}. "
            "The pin is the measured one — re-derive §9's event budget from it."
        )
    traded_per_day = ceiling * blocks_per_day
    printed_traded = find(nine, r"\*\*([\d,]+) `Traded` rows/day", "§9.1's Traded row rate").group(1)
    if number(printed_traded) != float(traded_per_day):
        raise Fail(
            f"§9.1 publishes {printed_traded} `Traded` rows/day; derived {float(traded_per_day):.0f}"
        )
    checked += 3

    # --- §9.2's shares, depth tables and the events ceiling -------------------------
    caps = find(nine, r"\*\*(\d+) MB desktop / (\d+) MB mobile\*\*", "§9.2's hard caps")
    desktop_cap, mobile_cap = (float(g) for g in caps.groups())
    shares = {
        name: float(value) / 100
        for name, value in re.findall(r"(raw samples|candles|events\+archive|metadata) (\d+)%", nine)
    }
    for required in ("raw samples", "candles", "events+archive", "metadata"):
        if required not in shares:
            raise Fail(f"§9.2 no longer states the '{required}' share; its budgets are underivable")
    if abs(sum(shares.values()) - 1.0) > 1e-9:
        raise Fail(f"§9.2's internal shares sum to {sum(shares.values()):.2%}, not 100%")

    def depth_days(cap_mb: float, share: float, per_day_bytes: float) -> float:
        return cap_mb * 1e6 * share / per_day_bytes

    slate_books = {}
    for label, table in (("raw", "Raw-sample depth"), ("c1h", "candles1h depth")):
        rows = table_rows(nine, table, f"§9.2's {label} depth table")
        header = find(nine, rf"\|[^|\n]*{re.escape(table)}[^|\n]*\|([^\n]*)", f"§9.2's {label} header")
        counts = [int(m) for m in re.findall(r"\((\d+) books\)", header.group(1))]
        if len(counts) != 2:
            raise Fail(f"§9.2's {label} table no longer names two book counts in its header")
        slate_books[label] = counts
        for cells in rows:
            device = cells[0].lower()
            cap = desktop_cap if "desktop" in device else mobile_cap
            if "desktop" not in device and "mobile" not in device:
                raise Fail(f"§9.2's {label} table has an unrecognised device row {cells[0]!r}")
            for count, printed in zip(counts, cells[1:3]):
                per_day = (
                    count * float(obs_per_book_day) * row_bytes
                    if label == "raw"
                    else count * 24 * row_bytes
                )
                derived = depth_days(cap, shares["raw samples" if label == "raw" else "candles"], per_day)
                value = find(printed, r"([\d.,]+)\s*days", f"a §9.2 {label} depth cell").group(1)
                if not agrees(value, derived):
                    raise Fail(
                        f"§9.2's {label} {device}/{count}-book cell publishes {value} days; "
                        f"derived {derived:.3f}"
                    )
                checked += 1
    if slate_books["raw"] != slate_books["c1h"]:
        raise Fail("§9.2's two depth tables are sized against different slates")
    if max(slate_books["raw"]) != max_books:
        raise Fail(
            f"§9.2's depth tables top out at {max(slate_books['raw'])} books; the maximum slate "
            f"is {max_books}"
        )

    events_per_day = float(traded_per_day) * row_bytes
    for device, cap in (("desktop", desktop_cap), ("mobile", mobile_cap)):
        printed = find(
            nine,
            rf"~\*\*([\d.]+) h\*\* {device}",
            f"§9.2's {device} event-share exhaustion figure",
        ).group(1)
        derived = cap * 1e6 * shares["events+archive"] / events_per_day * 24
        if not agrees(printed, derived):
            raise Fail(
                f"§9.2 states the {device} events share holds {printed} h of chain-wide trade "
                f"rows; derived {derived:.4f} h"
            )
        checked += 1

    # --- §9.3's metadata bound must fit the share it is drawn from ------------------
    blobs = find(
        nine,
        r"\*\*≤ (\d+) blobs / ≤ ([\d.]+) MB desktop, ≤ (\d+) blobs / ≤ ([\d.]+) MB mobile\*\*",
        "§9.3's metadata bound",
    )
    desktop_blobs, desktop_bytes, mobile_blobs, mobile_bytes = blobs.groups()
    for device, cap, stated in (
        ("desktop", desktop_cap, desktop_bytes),
        ("mobile", mobile_cap, mobile_bytes),
    ):
        share = cap * shares["metadata"]
        if float(stated) > share + 1e-9:
            raise Fail(
                f"§9.3's {device} metadata cap is {stated} MB but §9.2 allots it "
                f"{share:g} MB — a bound above its own share cannot bind"
            )
        checked += 1

    # §9.4's smoldot cell and the gate that enforces it. The gate held its own copy of
    # the bound and read it as MiB, which quietly granted 5 % more than §9 allots — the
    # same closed loop one file over, and the reason this binding exists at all.
    smoldot_mb = float(
        find(nine, r"\| smoldot WASM \(worker, lazy\) \| ≤ ([\d.]+) MB gz", "§9.4's smoldot budget").group(1)
    )
    gate = SMOLDOT_GATE.read_text(encoding="utf-8")
    # The RHS is captured as an expression and evaluated, not matched literally: the
    # difference between `3.5e6` and `3.5 * 1024 * 1024` is exactly the defect, so a
    # pattern that only recognised one spelling would report the other as "anchor
    # missing" rather than as the 5 % over-grant it is.
    gate_bytes = product(
        find(gate, r"const BUDGET_GZ_BYTES = ([\d.eE+*\s]+);", "the smoldot gate's budget constant").group(1)
    )
    if gate_bytes != smoldot_mb * 1e6:
        raise Fail(
            f"§9.4 budgets smoldot at {smoldot_mb} MB gz = {smoldot_mb * 1e6:.0f} B, but "
            f"`app/tools/check-smoldot-budget.ts` enforces {gate_bytes:.0f} B. §9 states MB = 10⁶; "
            "a MiB reading of this cell grants ~5 % the document does not."
        )
    checked += 1

    # §9.4's initial-JS row and the gate that enforces it. Both thresholds are bound, not
    # just the hard fail: a target nobody checks is how "≤ 350 KB" becomes decoration.
    js_row = find(
        nine,
        r"\| Initial JS \(critical path, gz\) \| ≤ (\d+) KB / hard-fail (\d+) KB",
        "§9.4's initial-JS budget",
    )
    bundle = BUNDLE_GATE.read_text(encoding="utf-8")
    for label, published, constant in (
        ("target", js_row.group(1), "TARGET_GZ_BYTES"),
        ("hard fail", js_row.group(2), "HARD_FAIL_GZ_BYTES"),
    ):
        enforced = product(
            find(bundle, rf"const {constant} = ([\d._eE+*\s]+);", f"the bundle gate's {constant}")
            .group(1)
            .replace("_", "")
        )
        if enforced != float(published) * 1e3:
            raise Fail(
                f"§9.4's initial-JS {label} is {published} KB = {float(published) * 1e3:.0f} B, but "
                f"`app/tools/check-bundle-budget.ts` enforces {enforced:.0f} B via {constant}. "
                "§9 states KB = 10³."
            )
        checked += 1

    blob_mb = float(find(nine, r"\*\*measured ([\d.]+) MB gz\*\*", "§9.3's measured blob size").group(1))
    bundle = float(
        find(nine, r"Release-shipped fallback metadata[^|]*\|\s*≤ ([\d.]+) MB", "§9.4's metadata bundle row").group(1)
    )
    if bundle < int(desktop_blobs) * blob_mb:
        raise Fail(
            f"§9.4 budgets {bundle} MB for release-shipped metadata but §9.3 admits "
            f"{desktop_blobs} blobs of {blob_mb} MB = {int(desktop_blobs) * blob_mb:g} MB"
        )
    checked += 1

    if checked < 20:
        raise Fail(f"only {checked} cells were checked; the parse is too shallow to be a gate")
    print(
        f"OK doc 10 §9: {checked} published cells re-derived from 13 §1/§3.1/§4/§5 and the "
        f"runtime's pinned ceiling ({ceiling} fills/block, {max_books} trading books)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
