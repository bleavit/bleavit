#!/usr/bin/env python3
"""The 11 §11.12 degradation matrix is complete and countable — SQ-593.

## Why this checker exists

F12's obligation is "rows E1–E25 scripted". Until 2026-08-05 **fourteen of those rows had
no text anywhere**: §11.12 said they lived in doc 10, doc 10 carried none, and 15 §3.3
called them "self-describing". None of that was detectable, because *nothing counted the
rows* — a client scripting the eleven readable ones would have passed every gate in this
repository and looked finished.

That is the same shape as SQ-552 (a mandated diff no suite implemented), SQ-580 (a client
read no contract froze) and SQ-582 (a surface set nothing compared). The pattern is always
an obligation stated in prose with no mechanical reader, and the fix is always the same:
give it one.

## What it checks, and why each direction matters

1. **The matrix is contiguous from E1 with no gaps or duplicates.** A gap is a row that was
   dropped; a duplicate is two rows that will be confused in every record mentioning either.
2. **Every row carries the facets that are always meaningful** — V (what is visible), A
   (what verified data is available) and F (the failure message). `L`, `U` and `R` are
   genuinely optional per row: a row with no loading state and nothing to recover from
   should not be padded with an em dash to satisfy a checker.
3. **15 §3.3's index names exactly the same ids.** The index and the matrix are two
   documents that must agree, and SQ-1 already had to reconcile them once when they
   disagreed about which row VOID redemption was. One list is canonical (§11.12); this makes
   the other provably its index rather than a second opinion.

The parse is **fail-closed**: finding no rows, or fewer than the count the index declares,
is an error rather than a pass. A checker that silently matches nothing is the defect it
was written to catch.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MATRIX = REPO / "docs/architecture/11-frontend-workflows.md"
INDEX = REPO / "docs/architecture/15-invariants-and-testing.md"

# A row opens `**E<n> <title>.**` at the start of a line and runs to the next row, the next
# blank line, or the end of the section — whichever comes first.
#
# All three terminators are needed, and finding that out is the point: §11.12 carries two
# formats. E15–E25 sit on consecutive lines with no blank line between them, while the rows
# authored under SQ-593 are blank-line separated because they are long. A parser written for
# either one alone silently swallows ten rows into one and then reports a matrix of 15.
ROW = re.compile(
    r"^\*\*E(\d+) ([^*]+?)\.\*\*(.*?)(?=^\*\*E\d+ |\n\n|\Z)", re.M | re.S
)

# Facets that must appear on every row. `L`, `U` and `R` are legitimately absent on rows
# with no loading state, no convenience layer, or nothing to recover from.
REQUIRED_FACETS = ("V", "A", "F")


def parse_matrix(text: str) -> dict[int, tuple[str, str]]:
    section = re.search(
        r"^## 11\.12 UX degradation matrix.*?^---$", text, re.M | re.S
    )
    if section is None:
        raise SystemExit("FAIL: 11 §11.12 not found — the section heading moved")
    rows: dict[int, tuple[str, str]] = {}
    for match in ROW.finditer(section.group(0)):
        number = int(match.group(1))
        if number in rows:
            raise SystemExit(f"FAIL: E{number} appears twice in §11.12")
        rows[number] = (match.group(2).strip(), match.group(3))
    return rows


def parse_index(text: str) -> set[int]:
    section = re.search(
        r"^### 3\.3 Required-UX row list.*?(?=^### 3\.4)", text, re.M | re.S
    )
    if section is None:
        raise SystemExit("FAIL: 15 §3.3 not found — the section heading moved")
    return {int(n) for n in re.findall(r"\bE(\d+)\b", section.group(0))}


def main() -> int:
    rows = parse_matrix(MATRIX.read_text(encoding="utf-8"))
    index = parse_index(INDEX.read_text(encoding="utf-8"))
    errors: list[str] = []

    # Fail closed on a parse that found nothing or nearly nothing: an empty expectation is
    # satisfied by an empty matrix, which is the state this checker exists to refuse.
    if len(rows) < 20:
        errors.append(
            f"parsed only {len(rows)} rows out of §11.12 — the row format changed, and a "
            "checker that matches nothing reports success"
        )

    if rows:
        expected = set(range(1, max(rows) + 1))
        missing = sorted(expected - set(rows))
        if missing:
            errors.append(
                "§11.12 has gaps: "
                + ", ".join(f"E{n}" for n in missing)
                + " — a gap is a row that was dropped, and the matrix is cited as E1–E"
                + str(max(rows))
            )

    for number, (title, body) in sorted(rows.items()):
        for facet in REQUIRED_FACETS:
            if not re.search(rf"(?<![A-Za-z]){facet}: ", body):
                errors.append(
                    f"E{number} ({title}) has no `{facet}:` facet — every row states what is "
                    "visible, what verified data is available, and what the failure says"
                )

    only_matrix = sorted(set(rows) - index)
    only_index = sorted(index - set(rows))
    if only_matrix:
        errors.append(
            "in §11.12 but not in 15 §3.3's index: "
            + ", ".join(f"E{n}" for n in only_matrix)
        )
    if only_index:
        errors.append(
            "in 15 §3.3's index but not in §11.12: "
            + ", ".join(f"E{n}" for n in only_index)
            + " — §11.12 is canonical (SQ-1), so a row named only in the index has no text"
        )

    if errors:
        print("Degradation-matrix errors:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(
        f"OK  degradation matrix: {len(rows)} rows E1–E{max(rows)}, every one carrying "
        f"{'/'.join(REQUIRED_FACETS)}, and 15 §3.3's index names exactly the same set."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
