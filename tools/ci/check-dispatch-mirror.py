#!/usr/bin/env python3
"""The 15 §4.8 *Dispatch-check mirror* — 09 §1.2 ↔ 11 §11.5.

Both documents have said for a long time that the frontend `execute` precondition table
must mirror the backend dispatch check list, and both credited a contract test with
diffing them. **No such test existed** (SQ-552). That is why a frontend precondition on
`DescriptorLeadTime` survived since X-11i — a check whose clock does not start until
`execute` itself succeeds, so the client could refuse an `execute` the runtime would have
accepted.

What this checks, and why it is not a restatement of the mapping:

* Both lists are parsed from the documents. The backend's numbered checks and the
  frontend's table rows are counted, so a list that grew or shrank is visible.
* **The mapping is parsed too**, out of 11 §11.5's own "BE n ↔ FE m" sentences. The
  checker does not know which backend item a frontend row belongs to; it reads the
  document's claim and then tests that claim for completeness: every backend check
  mapped exactly once, every frontend row mapped exactly once. A checker carrying its
  own copy of the mapping would agree with itself.
* A frontend row with no backend check behind it therefore fails — the case a
  length-only diff cannot see, and the live one.

Anti-vacuity is structural: a parse that finds no items, or a mapping covering nothing,
is an error rather than a pass. A checker that quietly matched zero things would be the
same defect one level up.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND = ROOT / "docs" / "architecture" / "09-execution-upgrades-and-rollout.md"
FRONTEND = ROOT / "docs" / "architecture" / "11-frontend-workflows.md"

# 09 §1.2 items 12–13 are the *effects* of passing (dispatch, record); the mirror is over
# the checks. The boundary is stated in 09 §1.2 itself and parsed from it below rather
# than hardcoded here.
EFFECTS_SENTENCE = re.compile(
    r"Items (\d+)–(\d+) are the checks; items (\d+)–(\d+) are the effects", re.UNICODE
)


def section(text: str, start: str, end: str, what: str) -> str:
    """Slice a document section, failing with an explanation rather than a traceback.

    A checker whose failure looks like a bug in the checker is a checker that gets
    switched off rather than fixed — so a heading that moved must say so in the same
    voice as a real finding. Found by mutation: deleting the mapping paragraph produced
    `ValueError: substring not found` instead of the message that explains what is now
    unverifiable.
    """
    i = text.find(start)
    if i < 0:
        raise SystemExit(
            f"FAIL cannot locate {what}: the anchor {start!r} is gone from the document. "
            "Either the section moved — update this checker — or it was deleted, in which "
            "case the mirror is no longer stated anywhere and cannot be diffed."
        )
    j = text.find(end, i + len(start))
    if j < 0:
        raise SystemExit(f"FAIL {what} has no end anchor {end!r}; the parse would run past it")
    return text[i:j]


def backend_checks(text: str) -> tuple[list[int], int]:
    """The numbered items of 09 §1.2, and the index of the last one that is a *check*."""
    body = section(text, "### 1.2 `execute(pid)`", "### 1.3", "09 §1.2's check list")
    items = [int(m.group(1)) for m in re.finditer(r"^(\d+)\. \*\*", body, re.MULTILINE)]
    match = EFFECTS_SENTENCE.search(body)
    if match is None:
        raise SystemExit(
            "FAIL 09 §1.2 no longer states which items are checks and which are effects; "
            "the mirror's scope is undefined and this checker would be guessing"
        )
    checks_from, checks_to, effects_from, effects_to = (int(g) for g in match.groups())
    if checks_from != 1 or effects_from != checks_to + 1:
        raise SystemExit(
            f"FAIL 09 §1.2's check/effect split is not contiguous from 1: "
            f"checks {checks_from}–{checks_to}, effects {effects_from}–{effects_to}"
        )
    if items != list(range(1, effects_to + 1)):
        raise SystemExit(
            f"FAIL 09 §1.2's numbered items are {items}, not a contiguous 1..{effects_to}; "
            "the parse has drifted from the document"
        )
    return items, checks_to


def frontend_rows(text: str) -> list[int]:
    """The numbered rows of 11 §11.5's `execution_guard.execute` table."""
    body = section(
        text,
        "### `execution_guard.execute` — the complete precondition row",
        "**Reaped Baseline books",
        "11 §11.5's execute precondition table",
    )
    return [
        int(m.group(1))
        for m in re.finditer(r"^\| (\d+)\.\s", body, re.MULTILINE)
    ]


def declared_mapping(text: str) -> list[tuple[list[int], list[int]]]:
    """Parse 11 §11.5's own `BE … ↔ FE …` claims. The document states the mapping; this
    reads it back rather than restating it, so the two cannot agree by construction."""
    body = section(
        text,
        "**The mapping, stated so the diff is checkable",
        "\n\n**",
        "11 §11.5's declared BE↔FE mapping",
    )
    pairs: list[tuple[list[int], list[int]]] = []
    # Greedy on both sides: `↔` terminates the first run, and the second stops at the
    # first character that is not part of a number list. A non-greedy pattern stopped at
    # the space inside "3–10, 13" and silently dropped the trailing row — a parser that
    # under-matches turns this gate into a source of false failures, which is the fastest
    # way for a checker to be switched off.
    for match in re.finditer(r"BE ([\d,\s–-]+)↔\s*FE ([\d,\s–-]+)", body):
        pairs.append((expand(match.group(1)), expand(match.group(2))))
    return pairs


def expand(spec: str) -> list[int]:
    out: list[int] = []
    for part in spec.replace("–", "-").split(","):
        part = part.strip().rstrip("*").strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = (int(x) for x in part.split("-", 1))
            out.extend(range(lo, hi + 1))
        else:
            out.append(int(part))
    return out


def main() -> int:
    backend = BACKEND.read_text(encoding="utf-8")
    frontend = FRONTEND.read_text(encoding="utf-8")

    items, last_check = backend_checks(backend)
    checks = list(range(1, last_check + 1))
    rows = frontend_rows(frontend)
    mapping = declared_mapping(frontend)

    problems: list[str] = []

    if not checks:
        problems.append("parsed 0 backend checks — the parser has stopped matching")
    if not rows:
        problems.append("parsed 0 frontend rows — the parser has stopped matching")
    if rows != list(range(1, len(rows) + 1)):
        problems.append(f"11 §11.5's rows are numbered {rows}, not a contiguous 1..{len(rows)}")
    if not mapping:
        problems.append(
            "11 §11.5 states no `BE n ↔ FE m` mapping; without it the two lists cannot be "
            "diffed check-for-check and this gate would be vacuous"
        )

    seen_be: list[int] = []
    seen_fe: list[int] = []
    for be, fe in mapping:
        seen_be.extend(be)
        seen_fe.extend(fe)

    for label, seen, universe, where in (
        ("backend check", seen_be, checks, "09 §1.2"),
        ("frontend row", seen_fe, rows, "11 §11.5"),
    ):
        unmapped = [n for n in universe if n not in seen]
        if unmapped:
            problems.append(
                f"{where}: {label}(s) {unmapped} appear in the list but in no mapping clause"
                + (
                    " — a frontend precondition with no backend check behind it is a client "
                    "refusing an action the runtime would accept (SQ-552, FE row 14)"
                    if label == "frontend row"
                    else " — a backend check the frontend never re-reads before signing"
                )
            )
        duplicated = sorted({n for n in seen if seen.count(n) > 1})
        if duplicated:
            problems.append(f"{where}: {label}(s) {duplicated} are mapped more than once")
        stray = sorted({n for n in seen if n not in universe})
        if stray:
            problems.append(
                f"{where}: the mapping names {label}(s) {stray}, which the list does not contain"
            )

    effects = [n for n in items if n > last_check]
    if any(n in seen_be for n in effects):
        problems.append(
            f"the mapping names 09 §1.2 item(s) {effects}, which are effects (dispatch, record) "
            "and have nothing to pre-check"
        )

    if problems:
        print("FAIL dispatch-check mirror (15 §4.8):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print(
        f"OK  dispatch-check mirror: {len(checks)} backend check(s) ↔ {len(rows)} frontend row(s) "
        f"over {len(mapping)} mapping clause(s); {len(effects)} effect item(s) correctly excluded"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
