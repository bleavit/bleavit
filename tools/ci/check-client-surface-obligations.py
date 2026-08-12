#!/usr/bin/env python3
"""The inverse surface gate: does every client obligation name a *frozen* surface?

`tools/release/surface-manifest.json` is the machine-readable form of doc 02's
frozen contract surface, and several gates already check that what it declares
agrees with the runtime — `check-chain-feed.py` compares it against real
metadata, `surface:check` re-derives `CRITICAL_SURFACE` from it, and
`test:mock-runtime` asserts a recorded fixture per entry. **Every one of those
verifies that what IS declared agrees. None asks whether what is REQUIRED was
ever declared.**

That gap is not hypothetical; it produced four findings in a single session:

  * SQ-552 — 09 §1.2 and 11 §11.5 both cited a contract test nobody had written.
  * SQ-577 — 10 §5.2 names calls the client classifies; 02 freezes none of them.
  * SQ-580 — 11 §11.3 mandates reading `Multisig.Multisigs`; 02 mentions the
    pallet zero times.
  * SQ-581 — 11 §11.5 calls `Market::Fee` a frozen constant the client MUST
    cross-check; the manifest carried neither it nor 35 others.

The shared shape: a client obligation written in doc 10 or 11 does not create
the frozen 02 surface it needs, and **nothing notices the absence**. The
consequence is worse than a missing feature. `CRITICAL_SURFACE` is what the
10 §5.2 compatibility classifier probes, so a surface that was never frozen is
one the lattice cannot fail on — a runtime upgrade that moves it leaves the
classifier reporting `full` while the dependent path silently breaks. A dead
screen under a green compatibility banner, and the banner is the wrong part.

This checker asks the inverse question. It extracts every `Pallet.Item` /
`Pallet::Item` reference from docs 10 and 11, keeps those whose prefix is a real
`construct_runtime!` pallet, and requires each to appear in the manifest.

**What it does NOT claim, stated because the obvious reading is wrong.** The item half
must be capitalised, so *dispatchable calls are outside this gate entirely* —
`Multisig.as_multi` and `ServiceLedger.split` are skipped by construction, not by
accident. Calls are snake_case, doc 02 freezes none of them (SQ-577), and the
09 §1.2 ↔ 11 §11.5 dispatch obligations are gated separately by
`check-dispatch-mirror.py`. Reading this gate as covering "every client obligation"
would credit it with a job nothing does.

Two design choices are load-bearing:

**The `construct_runtime!` restriction is what makes this quiet enough to keep.**
An earlier prose-sweep probe of the same idea reported findings on every
capitalized dotted pair in the documents and had to be thrown away — a gate that
noisy gets switched off rather than fixed. Anchoring the prefix to the runtime's
own pallet list cleanly separates surface reads (`Epoch.Proposals`) from type
references (`RejectReason::NotRatified`), and on the first calibrated run it
produced 27 references, 15 of them frozen and 12 genuine findings, with no false
positives to triage.

**Waivers expire mechanically.** A gap that is real but not yet fixed is waived
by open spec-question id, never by a bare marker. When that SQ closes in
plan/questions/ the waiver becomes an error, so the fix cannot be forgotten and the waiver file
cannot quietly become the permanent home of the problem. This mirrors the
limit-coverage registry's unwired-key expiry and
`tools/ci/generated-weight-overrides.toml`.

Usage:  python3 tools/ci/check-client-surface-obligations.py
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import re
import sys
from collections import defaultdict

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10 compatibility for the local quality gate.
    tomllib = None  # type: ignore[assignment]

ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "tools/release/surface-manifest.json"
WAIVERS = ROOT / "tools/ci/client-surface-waivers.toml"
CLIENT_DOCS = ("10-frontend-architecture.md", "11-frontend-workflows.md")

sys.path.insert(0, str(ROOT))
from tools.plan.model import load_questions  # noqa: E402

# `Pallet.Item` or `Pallet::Item`, both halves CamelCase. The item half must be
# capitalised: storage items, constants and events are, while dispatchable calls
# are snake_case and are the subject of a different gate (check-dispatch-mirror).
REFERENCE_RE = re.compile(r"\b([A-Z][A-Za-z0-9]*)(?:\.|::)([A-Z][A-Za-z0-9]*)\b")

# --- anti-vacuity ---------------------------------------------------------
#
# Every part of this checker can fail open. If the regex stops matching, or the
# pallet list comes back empty, or the manifest field names change, then
# `missing` is empty and the gate reports success while checking nothing. That
# is the exact failure mode this repository keeps rediscovering, so the floors
# below are asserted rather than assumed.
#
# The controls are *named pairs*, not just counts: a count floor survives a
# regex that matches the wrong thing, a named pair does not. Each is a surface
# doc 11 references and the manifest freezes, so finding it exercises the
# extractor and the manifest join together. Counts are measured values (27
# references, 15 frozen) held well below the measurement so ordinary doc edits
# do not trip them.
POSITIVE_CONTROLS = (
    ("Epoch", "Proposals"),
    ("Market", "Markets"),
    ("Constitution", "Params"),
    ("System", "Account"),
    # `::`-FORM CONTROLS. These three are not redundant with the dotted ones above and
    # were added after an adversarial review demonstrated the exact surviving mutation:
    # narrowing the separator alternation `(?:\.|::)` to `\.` drops every `::` reference
    # — `Market::Fee`, `ConditionalLedger::RedemptionFee`, `ConditionalLedger::ServiceIdBase`
    # — while all four dotted controls still match and the remaining 24 dotted references
    # still clear MIN_REFERENCES. The gate reported success while silently ceasing to check
    # the two rate constants 11 §11.5 calls compulsory. A control set that samples only one
    # of two syntactic forms cannot detect the loss of the other.
    ("Market", "Fee"),
    ("ConditionalLedger", "RedemptionFee"),
    ("ConditionalLedger", "ServiceIdBase"),
)
MIN_REFERENCES = 20
MIN_FROZEN_MATCHES = 10


def load_module(path: pathlib.Path, name: str):
    """Import a hyphenated sibling checker as a module."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover - import plumbing
        raise SystemExit(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def frozen_surface() -> set[tuple[str, str]]:
    """Every `(pallet, member)` pair the manifest declares frozen.

    Storage entries key the member as `item`, constants as `constant`, events as
    `event`. Getting these names wrong is not a theoretical risk: the first probe
    of this idea looked for `member` and reported *zero* frozen surfaces, which
    reads exactly like a catastrophic finding rather than a broken checker.
    """
    manifest = json.loads(MANIFEST.read_text())
    pairs: set[tuple[str, str]] = set()
    for entry in manifest["entries"]:
        pallet = entry.get("pallet")
        member = entry.get("item") or entry.get("constant") or entry.get("event")
        if pallet and member:
            pairs.add((pallet, member))
    return pairs


def client_references() -> dict[tuple[str, str], list[str]]:
    """`(pallet, member)` → citation sites, over the client-facing documents."""
    check_chain_feed = load_module(ROOT / "tools/ci/check-chain-feed.py", "check_chain_feed")
    pallets = check_chain_feed.source_pallets({"bootstrap"})
    if not pallets:
        raise SystemExit("no pallets parsed from construct_runtime! — the extractor is broken")

    found: dict[tuple[str, str], list[str]] = defaultdict(list)
    for doc in CLIENT_DOCS:
        path = ROOT / "docs/architecture" / doc
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            for pallet, member in REFERENCE_RE.findall(line):
                if pallet in pallets:
                    found[(pallet, member)].append(f"{doc}:{lineno}")
    return found


def open_question_ids() -> set[int]:
    """Spec-question ids whose plan/questions/ item is still open.

    Reuses `tools.plan.model.load_questions` rather than re-deriving "open":
    `status` is now an enum on the item's frontmatter, not a prose cell whose
    leading word had to be read carefully.
    """
    items, errors = load_questions(ROOT)
    if errors:
        # Fail closed: a broken plan/questions/ tree is not "no open questions",
        # it is "cannot tell" — and the waiver-expiry anti-vacuity guard below
        # exists precisely so that distinction is never silently collapsed.
        raise SystemExit(
            "plan/questions/: could not be parsed — the waiver expiry is broken:\n"
            + "\n".join(errors)
        )
    open_ids = {int(item.id.removeprefix("SQ-")) for item in items if item.status == "open"}
    if not open_ids:
        raise SystemExit("no open spec questions parsed from plan/questions/ — the waiver expiry is broken")
    return open_ids


def parse_waivers_toml_compat(text: str) -> list[dict]:
    """Parse the `[[waiver]]` subset of TOML this file uses.

    Deliberately dependency-free and narrow, matching `check-ghsa-only.py` and
    `check-limit-coverage.py`: CI runs 3.11+ and takes the `tomllib` path, so
    this only backs the local gate on 3.10. It understands `[[waiver]]` tables of
    basic strings and refuses anything else rather than guessing.
    """
    waivers: list[dict] = []
    current: dict | None = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip() if not raw.strip().startswith("#") else ""
        if not line:
            continue
        if line == "[[waiver]]":
            current = {}
            waivers.append(current)
            continue
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"', line)
        if not match or current is None:
            raise SystemExit(
                f"client-surface-waivers.toml: unsupported line for the 3.10 compat parser: {raw!r}"
            )
        current[match.group(1)] = match.group(2).replace('\\"', '"')
    return waivers


def load_waivers() -> dict[tuple[str, str], dict[str, str]]:
    if not WAIVERS.exists():
        return {}
    text = WAIVERS.read_text()
    rows = tomllib.loads(text).get("waiver", []) if tomllib else parse_waivers_toml_compat(text)
    waivers: dict[tuple[str, str], dict[str, str]] = {}
    for item in rows:
        pallet, _, member = item["surface"].partition(".")
        if not pallet or not member:
            raise SystemExit(f"waiver surface must be `Pallet.Item`, got {item['surface']!r}")
        waivers[(pallet, member)] = item
    return waivers


def check() -> list[str]:
    errors: list[str] = []
    references = client_references()
    frozen = frozen_surface()
    waivers = load_waivers()
    # Only consulted when something is actually waived. `open_question_ids()` fails closed
    # on an unparseable plan/questions/ tree, which is right when a waiver's expiry depends
    # on it — but a tree with no waivers at all would otherwise be failed by a condition it
    # does not rely on, and "the gate broke because there are no open questions" is a
    # confusing way to learn that every obligation is satisfied.
    open_ids = open_question_ids() if waivers else set()

    matched = {key for key in references if key in frozen}

    # Anti-vacuity, before any verdict is reported.
    for control in POSITIVE_CONTROLS:
        if control not in references:
            errors.append(
                f"anti-vacuity: positive control {control[0]}.{control[1]} was not extracted"
                " from docs 10/11 — the reference extractor is broken, so an empty finding"
                " list would mean nothing"
            )
        elif control not in matched:
            errors.append(
                f"anti-vacuity: positive control {control[0]}.{control[1]} was extracted but"
                " did not join to a manifest entry — the manifest field names changed"
            )
    if len(references) < MIN_REFERENCES:
        errors.append(
            f"anti-vacuity: only {len(references)} pallet-surface references extracted from"
            f" docs 10/11 (floor {MIN_REFERENCES})"
        )
    if len(matched) < MIN_FROZEN_MATCHES:
        errors.append(
            f"anti-vacuity: only {len(matched)} extracted references joined to the manifest"
            f" (floor {MIN_FROZEN_MATCHES})"
        )

    missing = {key: sites for key, sites in references.items() if key not in frozen}

    for key, sites in sorted(missing.items()):
        name = f"{key[0]}.{key[1]}"
        waiver = waivers.get(key)
        if waiver is None:
            errors.append(
                f"{name} is read by the client per {sites[0]} but is NOT frozen in the"
                " surface manifest — the 10 §5.2 classifier cannot probe it, so a runtime"
                " upgrade that moves it reports `full` while the path breaks. Freeze it in"
                " 02 (and the manifest), or waive it against an open spec question."
            )
            continue
        sq = waiver.get("sq")
        if not isinstance(sq, str) or not sq.startswith("SQ-"):
            errors.append(f"{name}: waiver must carry an `sq = \"SQ-nnn\"` id")
            continue
        if int(sq.removeprefix("SQ-")) not in open_ids:
            errors.append(
                f"{name}: waiver cites {sq}, which is no longer open — the"
                " waiver has expired; freeze the surface or re-open the question"
            )

    # A waiver for something that is no longer missing is stale in the other
    # direction: it would silently keep excusing a surface that got frozen.
    for key in waivers:
        if key not in missing:
            name = f"{key[0]}.{key[1]}"
            reason = (
                "it is now frozen in the manifest"
                if key in frozen
                else "the client documents no longer reference it"
            )
            errors.append(f"{name}: waiver is stale — {reason}; drop the waiver")

    if not errors:
        print(
            f"OK: {len(references)} pallet-surface references in docs 10/11;"
            f" {len(matched)} frozen, {len(missing)} waived against open spec questions."
        )
    return errors


def main() -> int:
    errors = check()
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
