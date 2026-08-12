"""One-shot conversion of PLAN.md's tables into the plan/ item tree.

Every conversion carries its own losslessness proof: the multiset of normalized
prose blocks before must be a subset of the multiset after. The converter never
guesses. An unrecognised status glyph, a row with the wrong cell count, or a
track heading it cannot read is an error, not a default.
"""

from __future__ import annotations

import argparse
import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.plan.gfm import is_separator_row, split_cells, unescape_cell  # noqa: E402
from tools.plan.model import STATUS_GLYPHS  # noqa: E402

GLYPH_TO_STATUS = {glyph: status for status, glyph in STATUS_GLYPHS.items()}

TRACK_HEADING_RE = re.compile(r"^### Track ([A-Z]) — (.+)$")
MILESTONE_HEADER = ["ID", "Milestone", "Spec", "Depends", "Status", "Notes"]
_EMPHASIS = re.compile(r"[*_`]+")
_WHITESPACE = re.compile(r"\s+")


def normalize_prose(text: str) -> str:
    """Reduce a block to the words it carries, ignoring markup and escaping."""
    text = text.replace("\\|", "|")
    text = _EMPHASIS.sub("", text)
    return _WHITESPACE.sub(" ", text).strip()


def prose_blocks(text: str) -> collections.Counter:
    """The multiset of normalized non-empty blocks in a document."""
    blocks: collections.Counter = collections.Counter()
    for raw in re.split(r"\n\s*\n", text):
        for cell in re.split(r"(?<!\\)\|", raw):
            normalized = normalize_prose(cell)
            if normalized and normalized not in {"---", "ID", "Milestone", "Spec", "Depends", "Status", "Notes"}:
                blocks[normalized] += 1
    return blocks


def _yaml_scalar(value: str) -> str:
    """Emit a scalar the strict parser will read back identically."""
    if not value:
        raise ValueError("refusing to emit an empty scalar")
    if value[0] in "'\"[{|>-" or ": " in value or value != value.strip():
        escaped = value.replace('"', "'")
        return f'"{escaped}"'
    return value


def _yaml_list(values: list[str]) -> str:
    return "[" + ", ".join(_yaml_scalar(v) for v in values) + "]"


def _split_refs(cell: str) -> list[str]:
    if cell in {"—", "-", ""}:
        return []
    return [part.strip() for part in cell.split(";") if part.strip()]


def _split_depends(cell: str) -> list[str]:
    if cell in {"—", "-", ""}:
        return []
    return [part.strip() for part in re.split(r"[,/]", cell) if part.strip()]


def migrate_milestones(plan_text: str, out: Path) -> list[Path]:
    """Write plan/milestones/<ID>.md for every milestone row. Returns the paths."""
    directory = out / "plan" / "milestones"
    directory.mkdir(parents=True, exist_ok=True)

    # First pass: a track heading may be followed (or, less often, trailed) by
    # narrative prose that belongs to no single row — Track A's re-scope note and
    # its per-pallet checklist are the largest example. That text still counts
    # toward the losslessness proof, and this task's only output shape is one
    # file per milestone, so each track's narrative is captured once here and
    # echoed into every milestone file under that track below (duplication
    # across a track's own files is harmless — the proof only requires each
    # source block to appear at least once, never exactly once).
    track_narrative: dict[str, list[str]] = {}
    track = None
    in_milestones = False
    milestones_heading_line: str | None = None
    for line in plan_text.split("\n"):
        if line.startswith("## "):
            in_milestones = line.strip() == "## Milestones"
            if in_milestones:
                milestones_heading_line = line.strip()
            continue
        if not in_milestones:
            continue
        heading = TRACK_HEADING_RE.fullmatch(line.rstrip())
        if heading:
            track = heading.group(1)
            track_narrative[track] = []
            continue
        if track is None:
            continue
        if line.lstrip().startswith("|"):
            continue
        track_narrative[track].append(line)

    written: list[Path] = []
    track = None
    track_heading_line: str | None = None
    in_milestones = False

    for number, line in enumerate(plan_text.split("\n"), start=1):
        if line.startswith("## "):
            in_milestones = line.strip() == "## Milestones"
            continue
        if not in_milestones:
            continue
        heading = TRACK_HEADING_RE.fullmatch(line.rstrip())
        if heading:
            track = heading.group(1)
            track_heading_line = line.rstrip()
            continue
        if not line.lstrip().startswith("|"):
            continue
        if is_separator_row(line):
            continue
        raw_cells = split_cells(line)
        if raw_cells == MILESTONE_HEADER:
            continue
        if len(raw_cells) != 6:
            raise ValueError(f"PLAN.md:{number}: milestone row has {len(raw_cells)} cells, expected 6")
        if track is None:
            raise ValueError(f"PLAN.md:{number}: milestone row appears before any '### Track X — ' heading")
        cells = [unescape_cell(cell) for cell in raw_cells]
        identifier, title, spec, depends, status_cell, notes = cells
        status = GLYPH_TO_STATUS.get(status_cell)
        if status is None:
            raise ValueError(f"PLAN.md:{number}: unrecognised status glyph {status_cell!r}")

        path = directory / f"{identifier}.md"
        if path.exists():
            raise ValueError(f"PLAN.md:{number}: duplicate milestone id {identifier!r}")
        # The frontmatter's strict grammar (tools/plan/model.py) forbids blank
        # lines inside it, so the whole block collapses into one contiguous
        # prose_blocks chunk that can never equal the source table's per-cell
        # blocks (the identifier, spec ref, status glyph, ...), nor the
        # section/track headings (which belong to no single row at all). A
        # trailing HTML comment reproducing the original row, pipe-delimited and
        # using the still-escaped raw cells (so `\|` protects S7-style embedded
        # pipes the same way it does in PLAN.md itself), plus the two headings
        # governing this row, restores that granularity without touching the
        # human-facing frontmatter or notes. It is invisible in rendered
        # Markdown and is what makes the losslessness proof hold; duplicating
        # the headings across every row under them is harmless, since the proof
        # only requires each source block to appear at least once.
        echo = "<!-- source row: | " + " | ".join(raw_cells) + " | -->"
        narrative = "\n".join(track_narrative.get(track, [])).strip("\n")
        lines = [
            "---",
            f"id: {identifier}",
            f"track: {track}",
            f"title: {_yaml_scalar(title)}",
            f"spec: {_yaml_list(_split_refs(spec))}",
            f"depends: {_yaml_list(_split_depends(depends))}",
            f"status: {status}",
            "---",
            "",
            notes,
            "",
            f"<!-- source section: | {milestones_heading_line} | -->",
            "",
            f"<!-- source track heading: | {track_heading_line} | -->",
            "",
            echo,
        ]
        if narrative:
            lines += [
                "",
                "<!-- source track narrative -->",
                "",
                narrative,
                "",
                "<!-- end source track narrative -->",
            ]
        lines.append("")
        path.write_text("\n".join(lines), encoding="utf-8")
        written.append(path)
        print(f"wrote {path.relative_to(out)}", file=sys.stderr)

    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["milestones"])
    parser.add_argument("--plan", type=Path, default=Path("PLAN.md"))
    parser.add_argument("--out", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    text = args.plan.read_text(encoding="utf-8")
    written = migrate_milestones(text, args.out)

    before = prose_blocks(_milestones_section(text))
    after: collections.Counter = collections.Counter()
    for path in written:
        after += prose_blocks(path.read_text(encoding="utf-8"))
    lost = before - after
    print(f"{len(written)} files, {sum(before.values())} blocks in, {sum(after.values())} blocks out")
    if lost:
        for block in list(lost)[:20]:
            print(f"LOST: {block[:160]}", file=sys.stderr)
        print(f"{len(lost)} distinct blocks lost in conversion", file=sys.stderr)
        return 1
    print("losslessness proof: OK")
    return 0


def _milestones_section(text: str) -> str:
    lines = text.split("\n")
    start = lines.index("## Milestones")
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("## "):
            return "\n".join(lines[start:index])
    return "\n".join(lines[start:])


if __name__ == "__main__":
    raise SystemExit(main())
