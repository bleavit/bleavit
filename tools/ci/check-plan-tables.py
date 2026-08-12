#!/usr/bin/env python3
"""Check Markdown table structure in PLAN.md, the living documents, and the spec.

Guards against the table-drift class fixed on 2026-07-17: a blank line (or any
non-table line) splitting a table strands the rows below it from the header, so
they render as raw pipe-text instead of table rows. GFM only renders a pipe block
as a table when it opens with a header row followed by a separator row and every
row carries a consistent cell count.

Rules, per contiguous block of `|`-prefixed lines (outside fenced code blocks):
  1. The block's second line must be a separator row (`|---|...|`) — a block
     without one is an orphaned body (the B10/B11 failure mode).
  2. The first line must NOT be a separator (header missing).
  3. Every row must have the same cell count as the header. Only `\\|` escapes a
     pipe — GFM splits cells on unescaped pipes even inside backtick code spans.
  4. Separator rows must not appear anywhere except line 2.

Standing user instruction (2026-07-17): PLAN.md table formatting must never
drift/break. Enforced by the `guard-plan-tables.sh` Stop hook and the docs CI job.
Verification-id uniqueness now comes from one-file-per-id under
`plan/verifications/`; it is no longer inferred from a prose table.

The default target set is **not** PLAN.md alone (widened 2026-07-29). `docs/architecture/`
is the source of truth per R-1, so a table that renders wrong there is worse than one in
a status file — and it went ungated long enough to accumulate 15 rows in 13 §4 whose
`Scope` and `Doc` columns had collapsed into one cell, silently blanking the Doc column
of every storage bound they described. Widening the *default* rather than passing paths
at one call site is deliberate: CI, the Stop hook and `check-ci-parity.py` all invoke
this with no arguments, so a per-site argument would have to be remembered three times.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

sys.path.insert(0, str(ROOT))
from tools.plan.gfm import is_separator_row, split_cells  # noqa: E402


def check_text(text: str, name: str) -> list[str]:
    errors: list[str] = []
    blocks: list[list[tuple[int, str]]] = []
    current_block: list[tuple[int, str]] = []
    in_fence = False
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
        if not in_fence and stripped.startswith("|"):
            current_block.append((lineno, stripped))
        else:
            if current_block:
                blocks.append(current_block)
                current_block = []
    if current_block:
        blocks.append(current_block)

    for block in blocks:
        first_no, first = block[0]
        if is_separator_row(first):
            errors.append(
                f"{name}:{first_no}: table starts with a separator row — header row missing"
            )
            continue
        if len(block) < 2 or not is_separator_row(block[1][1]):
            errors.append(
                f"{name}:{first_no}: orphaned table row(s) — a pipe block must open with a"
                " header row followed by a |---| separator (a blank line above these rows"
                " probably severed them from their table)"
            )
            continue
        width = len(split_cells(first))
        for row_no, row in block[1:]:
            if row_no != block[1][0] and is_separator_row(row):
                errors.append(
                    f"{name}:{row_no}: unexpected separator row inside table body"
                )
                continue
            cells = len(split_cells(row))
            if cells != width:
                errors.append(
                    f"{name}:{row_no}: row has {cells} cells but the header at line"
                    f" {first_no} has {width} (unescaped `|` in a cell, or a truncated row?)"
                )
    return errors


def default_targets() -> list[Path]:
    """PLAN.md, the living documents, and every architecture doc.

    Sorted and relative-to-ROOT so failures cite a stable, clickable path
    regardless of the working directory the caller ran from."""
    targets = [ROOT / name for name in ("PLAN.md", "README.md", "AGENTS.md", "CLAUDE.md")]
    targets.extend(sorted((ROOT / "docs" / "architecture").glob("*.md")))
    return [t for t in targets if t.is_file()]


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv] or default_targets()
    errors: list[str] = []
    for target in targets:
        path = target if target.is_absolute() else ROOT / target
        # Cite paths relative to the repo root: the defaults are absolute, and an
        # absolute path in the failure text is neither clickable nor diffable.
        try:
            name = str(path.relative_to(ROOT))
        except ValueError:
            name = str(target)
        content = path.read_text(encoding="utf-8")
        errors.extend(check_text(content, name))
    if errors:
        print("Markdown table errors:")
        for err in errors:
            print(f"  - {err}")
        return 1
    print("All Markdown tables are well-formed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
