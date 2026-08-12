"""Shared GitHub-Flavored-Markdown table-row parsing.

Moved verbatim from `tools/ci/check-plan-tables.py` (2026-08-12): it was already
the repository's authority on GFM cell splitting, it already handles the `\\|`
escape, and it already treats the outer delimiters as optional. Two other
consumers — `tools/limit-coverage/check-limit-coverage.py` and
`.claude/hooks/guard-track-goal.sh` — split rows on a bare `|` and so misread
PLAN.md row S7's escaped-pipe Milestone cell as extra cells, reading the Spec
ref cell as the Status. Row SQ-523 also omits its trailing pipe, which GFM
allows, so any splitter demanding both outer delimiters raises on real data.
There must be exactly one implementation of this logic.
"""
from __future__ import annotations

import re

SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")


def split_cells(line: str) -> list[str]:
    """Split a table row into cells exactly as GFM does: every unescaped `|`
    delimits — backtick code spans do NOT protect pipes in table rows, only
    `\\|` does; the leading/trailing delimiters contribute no cells."""
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
    # A well-formed row is `| a | b |`: drop the empty fragments outside the
    # outer delimiters so the count is the real cell count.
    if cells and cells[0] == "":
        cells = cells[1:]
    if cells and cells[-1] == "":
        cells = cells[:-1]
    return cells


def is_separator_row(line: str) -> bool:
    cells = split_cells(line)
    return bool(cells) and all(SEPARATOR_CELL_RE.match(c) for c in cells)


def unescape_cell(text: str) -> str:
    """Turn a cell's `\\|` escapes into literal pipes.

    split_cells deliberately leaves the backslash in place, because its own job
    is counting cells rather than reading them. Every caller that writes a cell's
    text into frontmatter or a body calls this first.
    """
    return text.replace("\\|", "|")
