#!/usr/bin/env python3
"""Check every plan/questions/ item's `batch:` label against PLAN.md's batch index.

PLAN.md's *Spec questions* section claims its batch assignment "is checked
mechanically". Before this script existed that claim was aspirational — the
index was maintained by hand across concurrent branches, which is exactly the
shape that drifts.

Most of what this checker used to enforce is now structurally impossible, since
`tools.plan.model.load_questions` (backing the `plan/questions/<ID>.md` item
tree) makes each of the following true by construction rather than by review:

  * an id cannot collide, because the id IS the filename;
  * a question cannot be named by two batches, because `batch:` is one scalar
    on one file;
  * an open question cannot be missing a batch and a resolved one cannot be
    misnamed by a live batch, because `tools/plan/migrate.py`'s round-trip
    proof already ties `batch:` to the source row it was extracted from.

One thing survives: a question's `batch:` value might name a batch PLAN.md's
index does not declare (a typo, or a label the index later renamed or
retired). That is the one invariant left to check.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

sys.path.insert(0, str(ROOT))
from tools.plan.model import load_questions  # noqa: E402

BATCH_HEADER = ("Batch", "Rows", "Members")
BATCH_LABEL_RE = re.compile(r"^\*\*([BDCXE][0-9]?)\s*[·.]")
SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")

# The sentinel `tools/plan/migrate.py` writes for a resolved question the batch
# index never named — a legitimate, common state (417 of 583 questions), not a
# missing assignment. Mirrors `migrate.py`'s own `UNBATCHED` constant.
UNBATCHED = "none"


def split_cells(line: str) -> list[str]:
    """Split a table row into cells exactly as GFM does: every unescaped `|`
    delimits — backtick code spans do NOT protect pipes in table rows, only
    `\\|` does. Mirrors `check-plan-tables.py`."""
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


def iter_rows(text: str, header: tuple[str, ...]):
    """Yield (lineno, cells) for every body row of every table whose header
    matches `header` exactly. Fenced code blocks are skipped."""
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
        if tuple(split_cells(line)) == header and i + 1 < len(lines) and is_separator_row(lines[i + 1]):
            j = i + 2
            while j < len(lines) and lines[j].startswith("|"):
                if not is_separator_row(lines[j]):
                    yield j + 1, split_cells(lines[j])
                j += 1
            i = j
            continue
        i += 1


def declared_batches(root: Path) -> set[str]:
    """Batch labels PLAN.md's batch-index table declares, plus the unbatched
    sentinel `"none"` — a resolved question the index never named is a
    legitimate state (see `UNBATCHED` above), not an error.

    The batch index itself is an aggregate over the open backlog, not a
    per-item fact, so it has no `plan/` item home of its own and still lives
    in PLAN.md's *Spec questions* section (read-only here).
    """
    text = (root / "PLAN.md").read_text(encoding="utf-8")
    declared = {UNBATCHED}
    for _lineno, cells in iter_rows(text, BATCH_HEADER):
        match = BATCH_LABEL_RE.match(cells[0])
        if match:
            declared.add(match.group(1))
    return declared


def check(root: Path) -> list[str]:
    """Every question's batch label must be one the index declares."""
    items, errors = load_questions(root)
    declared = declared_batches(root)
    for item in items:
        if item.batch not in declared:
            errors.append(f"plan/questions/{item.id}.md: batch {item.batch!r} is not a declared batch")
    return errors


def main(argv: list[str]) -> int:
    target = Path(argv[0]) if argv else ROOT
    if not target.is_absolute():
        target = ROOT / target
    errors = check(target)
    if errors:
        print("Spec-question batch-index errors:")
        for err in errors:
            print(f"  - {err}")
        return 1
    print("Spec-question batches OK — every question's batch label is declared by the index.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
