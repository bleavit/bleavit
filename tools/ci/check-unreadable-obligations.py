#!/usr/bin/env python3
"""Every `UnreadableObligation` the canonical client declares must cite an OPEN question.

`app/packages/transaction-builder/src/rows.ts` carries a list of reads that
11 §11.8 requires and that 02 freezes no surface for. Each entry names the
PLAN.md spec question that owns the gap, and each `blocking` entry closes an
operator control: `operatorGate` turns it into a refusal the user sees, so the
screen cannot reach `ready` while the entry stands.

The file has always said those declarations "expire the way the limit-coverage
registry and the monitoring seams do — by the row closing, not by somebody
remembering to delete a comment". Nothing checked it. Contract v28 froze six
surfaces and PLAN.md marked SQ-615, SQ-616 and SQ-619 resolved; three
`blocking` entries stayed behind, so the guardian console, the upgrade crank and
the registry challenge panel could not be opened at all — and because they could
never reach `ready`, the suite covering them had settled for asserting the
refusal. A screen nothing can open is a screen nothing has exercised.

So the expiry is mechanical here. One rule:

    every `specQuestion` cited by an `unread(...)` entry is a row of PLAN.md's
    spec-question table whose status cell begins with "open".

"Open" is read exactly as `check-spec-question-batches.py` reads it — the status
cell's leading word, not a keyword search, because open rows legitimately
contain the word "resolved" in their prose.

The check deliberately does NOT verify the other direction (that an open
question has a declaration): most questions have nothing to do with this table.
What it catches is the one asymmetry that closes a screen silently.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROWS_TS = ROOT / "app/packages/transaction-builder/src/rows.ts"
PLAN = ROOT / "PLAN.md"

QUESTION_HEADER = ("ID", "Question", "Spec ref", "Raised", "Status")
QUESTION_ID_RE = re.compile(r"^SQ-\d+$")
SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")

# `unread(row, requirement, reason, specQuestion, disposition, scope?)` — the id
# and the disposition are string literals in the fourth and fifth positions.
# Matched on the pair rather than on the id alone so a malformed entry is
# reported rather than skipped.
#
# The optional sixth argument is an `ObligationScope` object literal, which
# narrows a blocking obligation to the dispatch arm that actually reads the
# condition. It is skipped rather than parsed: this checker's one rule is about
# the cited question's status, and a scope changes *which pending actions* an
# obligation speaks about, never *whether it has expired*. Tolerating it here
# keeps that separation — a scoped entry whose question closes is still caught.
UNREAD_RE = re.compile(
    r"\bunread\(\s*(?P<body>.*?)\)\s*,\s*\n",
    re.DOTALL,
)
TAIL_RE = re.compile(
    r"'(?P<sq>SQ-\d+)'\s*,\s*'(?P<disposition>stated|blocking)'\s*,"
    r"(?:\s*\{[^{}]*\}\s*,?)?\s*$",
    re.DOTALL,
)


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


def declarations(source: str) -> list[tuple[int, str, str]]:
    """(line number, spec question, disposition) for every `unread(...)` entry."""
    found: list[tuple[int, str, str]] = []
    for match in UNREAD_RE.finditer(source):
        body = match.group("body")
        tail = TAIL_RE.search(body)
        lineno = source.count("\n", 0, match.start()) + 1
        if tail is None:
            found.append((lineno, "", ""))
            continue
        found.append((lineno, tail.group("sq"), tail.group("disposition")))
    return found


def main() -> int:
    source = ROWS_TS.read_text(encoding="utf-8")
    status = question_status(PLAN.read_text(encoding="utf-8"))
    if not status:
        print("PLAN.md: no spec-question table found (header changed?)", file=sys.stderr)
        return 1

    entries = declarations(source)
    if not entries:
        # Zero declarations is a legitimate end state — it means every §11.8 read
        # has a frozen surface. It is reported rather than silently passing,
        # because it is also what a broken parser looks like.
        print("No unreadable obligations declared. Either every §11.8 read is frozen, or this parser stopped matching.")
        return 0

    errors: list[str] = []
    for lineno, sq, disposition in entries:
        where = f"{ROWS_TS.relative_to(ROOT)}:{lineno}"
        if not sq:
            errors.append(f"{where}: an unread(...) entry does not end in a spec-question id and a disposition")
            continue
        state = status.get(sq)
        if state is None:
            errors.append(f"{where}: cites {sq}, which is not a row of PLAN.md's spec-question table")
        elif state != "open":
            errors.append(
                f"{where}: cites {sq}, which PLAN.md records as RESOLVED. "
                f"This declaration is {disposition}"
                + (
                    " — it closes an operator control for a reason that no longer holds, "
                    "and a control that can never open is one nothing has exercised."
                    if disposition == "blocking"
                    else " — it tells the user a condition cannot be checked when its surface now exists."
                )
            )

    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1

    blocking = sum(1 for _, _, d in entries if d == "blocking")
    print(
        f"Unreadable obligations OK — {len(entries)} declared "
        f"({blocking} blocking), every one citing an open spec question."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
