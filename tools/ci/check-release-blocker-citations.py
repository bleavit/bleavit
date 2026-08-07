#!/usr/bin/env python3
"""Every spec question the release pipeline cites must still be OPEN.

`app/tools/release/` emits the readiness blockers that `release:check
--production` refuses on, and a blocker is the one sentence a release operator
reads to learn why a release cannot be assembled. When a blocker names the
question it waits on, that name has to stay true.

It did not. The Asset Hub descriptor blocker read "F4, blocked on SQ-587 (which
network a release targets)" and SQ-587 was ruled on 2026-08-04 — the rollout
phases which Asset Hub a release pins (08 §2.5), so there was no standing choice
to make. F4 then landed every artifact the set needs: the feed directory, the
PAPI descriptor entry and `FOREIGN_CHAIN_PINS`. Nothing connected them, so a
blocker stood over finished work for three days, citing a closed question, under
fully green CI. Each half is invisible on its own — the pipeline cannot know a
question closed, and PLAN.md cannot know who cites it.

So the expiry is mechanical, exactly as it is for the client's unreadable
obligations and the limit-coverage registry. One rule:

    every `SQ-nnn` appearing anywhere under `app/tools/release/` is a row of
    PLAN.md's spec-question table whose status cell begins with "open".

**Anywhere, including comments, and that breadth is the design.** The stale
citation lived in a doc comment *and* in the emitted string, and the strings are
built by multi-line `+` concatenation — so a rule scoped to "blocker text" would
need a tokenizer, which is the hole this repository keeps having to remove from
its scanners. Reading the whole file needs no parser and cannot be evaded by
moving the claim one line up into a comment.

The cost is that this directory may not carry a closed question as history. That
is the right trade: the pipeline's job is to state what is *unresolved*, and
PLAN.md's decision log and session log are where a ruling is recorded.

"Open" is read exactly as `check-spec-question-batches.py` and
`check-unreadable-obligations.py` read it — the status cell's leading word, not a
keyword search, because open rows legitimately contain the word "resolved" in
their prose. The table parser is duplicated from those checkers rather than
shared, as they duplicate it from each other: each gate stays a standalone script
that a cold checkout can run with no import path.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RELEASE_DIR = ROOT / "app/tools/release"
PLAN = ROOT / "PLAN.md"

# The pipeline's own sources, and nothing else: these are the files whose text
# can reach a readiness blocker.
SCANNED_SUFFIXES = (".ts", ".json")

QUESTION_HEADER = ("ID", "Question", "Spec ref", "Raised", "Status")
QUESTION_ID_RE = re.compile(r"^SQ-\d+$")
SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")
CITATION_RE = re.compile(r"\bSQ-\d+\b")


def split_cells(line: str) -> list[str]:
    """Split a GFM table row: every unescaped `|` delimits. Mirrors
    `check-plan-tables.py` — backticks do not protect a pipe in a table row."""
    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for ch in line:
        if escaped:
            current.append(ch)
            escaped = False
        elif ch == "\\":
            current.append(ch)
            escaped = True
        elif ch == "|":
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    cells.append("".join(current).strip())
    if cells and cells[0] == "":
        cells = cells[1:]
    if cells and cells[-1] == "":
        cells = cells[:-1]
    return cells


def is_separator_row(line: str) -> bool:
    cells = split_cells(line)
    return bool(cells) and all(SEPARATOR_CELL_RE.match(c) for c in cells)


def question_status(text: str) -> dict[str, str]:
    """`SQ-n` → "open" | "resolved", from PLAN.md's question table."""
    status: dict[str, str] = {}
    lines = text.splitlines()
    in_fence = False
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence or not line.startswith("|"):
            i += 1
            continue
        if tuple(split_cells(line)) == QUESTION_HEADER and i + 1 < len(lines) and is_separator_row(lines[i + 1]):
            j = i + 2
            while j < len(lines) and lines[j].startswith("|"):
                if not is_separator_row(lines[j]):
                    cells = split_cells(lines[j])
                    if cells and QUESTION_ID_RE.match(cells[0]):
                        leading = cells[-1].lstrip("*_ ").lower()
                        status[cells[0]] = "open" if leading.startswith("open") else "resolved"
                j += 1
            i = j
            continue
        i += 1
    return status


def citations(directory: Path) -> list[tuple[str, int, str]]:
    """(path relative to the repo root, line number, question id), sorted."""
    found: list[tuple[str, int, str]] = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or path.suffix not in SCANNED_SUFFIXES:
            continue
        relative = str(path.relative_to(ROOT))
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for match in CITATION_RE.finditer(line):
                found.append((relative, lineno, match.group(0)))
    return found


def main() -> int:
    if not RELEASE_DIR.is_dir():
        print(f"{RELEASE_DIR.relative_to(ROOT)} does not exist; the pipeline moved", file=sys.stderr)
        return 1

    status = question_status(PLAN.read_text(encoding="utf-8"))
    if not status:
        # Fail closed. A parser that found no questions would report every
        # citation as unknown, or — with the check written the other way round —
        # pass every one of them.
        print("PLAN.md: no spec-question table found (header changed?)", file=sys.stderr)
        return 1

    found = citations(RELEASE_DIR)
    if not found:
        # A legitimate end state: no blocker is waiting on a question. Reported
        # rather than silently passing, because it is also what a scanner that
        # stopped matching looks like.
        print(
            "Release pipeline cites no spec question. Either no readiness blocker waits on "
            "one, or this scanner stopped matching."
        )
        return 0

    errors: list[str] = []
    for relative, lineno, sq in found:
        where = f"{relative}:{lineno}"
        state = status.get(sq)
        if state is None:
            errors.append(f"{where}: cites {sq}, which is not a row of PLAN.md's spec-question table")
        elif state != "open":
            errors.append(
                f"{where}: cites {sq}, which PLAN.md records as RESOLVED. A readiness blocker "
                "naming a closed question sends a release operator to a decision that has "
                "already been made — and the work it was waiting on may well be done, as F4's "
                "Asset Hub descriptor set was for three days behind SQ-587."
            )

    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1

    distinct = sorted({sq for _, _, sq in found})
    print(
        f"Release blocker citations OK — {len(found)} citation(s) of {len(distinct)} question(s) "
        f"({', '.join(distinct)}), every one open."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
