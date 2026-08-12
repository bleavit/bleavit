"""One-shot conversion of PLAN.md's tables into the plan/ item tree.

Every conversion carries its own losslessness proof: every normalized source
cell of every milestone row must survive, as a substring, into the emitted
tree's frontmatter values or body. The converter never guesses. An
unrecognised status glyph, a row with the wrong cell count, or a track heading
it cannot read is an error, not a default.

The proof is content coverage, not block-multiset equality (2026-08-12
controller ruling, fix round 1): the multiset design let a converter pass by
echoing each source row verbatim into its own file, which is true by
construction regardless of whether the frontmatter or body captured anything.
Coverage cannot be satisfied that way, because nothing is echoed — a source
cell must actually appear in a *value* the converter derived.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.plan.gfm import is_separator_row, split_cells, unescape_cell  # noqa: E402
from tools.plan.model import STATUS_GLYPHS, parse_frontmatter  # noqa: E402

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


def item_text(path: Path) -> str:
    """Everything an emitted file actually carries: frontmatter VALUES plus body.

    Keys are excluded deliberately. The proof asks whether the source's prose
    survived into fields and body, so matching on `id:` or `status:` would let
    a converter pass by emitting key names.
    """
    values, body = parse_frontmatter(path)
    parts: list[str] = []
    for value in values.values():
        parts.extend(value if isinstance(value, list) else [value])
    parts.append(body)
    return normalize_prose(" ␟ ".join(str(part) for part in parts))


def prove_lossless(source_cells: list[str], emitted: list[Path]) -> list[str]:
    """Every normalized source cell must appear in some emitted file's content.

    Returns the cells that do not. Substring containment is the right test
    here: one source cell legitimately becomes several frontmatter fields.
    """
    haystack = "\n".join(item_text(path) for path in emitted)
    return [c for c in source_cells if normalize_prose(c) and normalize_prose(c) not in haystack]


def _yaml_scalar(value: str) -> str:
    """Emit a plain-or-quoted scalar the strict parser will read back identically.

    Quoting triggers only on a leading special character or edge whitespace.
    `TOP_LEVEL_RE` (tools/plan/model.py) splits a top-level `key: value` line
    *structurally*, at the first `[a-z_]+:` match, not by scanning for a
    `": "` substring inside the value — verified directly against
    `parse_frontmatter`, including a value with several embedded `": "` runs
    — so a plain scalar containing one needs no quoting. `BLOCK_ITEM_RE`
    (`^  - (.+)$`) is equally unbothered by interior punctuation: unlike a
    flow list's comma-delimited items (see `_yaml_block_list`'s docstring for
    why flow lists were dropped), a block item is everything after `  - ` to
    end of line, so commas, brackets and colons inside it need no protection.

    A value that needs quoting but also contains a literal `"` cannot be
    emitted safely at all: the strict parser's quoted-scalar grammar forbids
    an embedded quote outright, and silently substituting `'` for `"` (the
    brief's original approach) is a real corruption — it broke a real
    milestone's title (B14, which quotes R-4 verbatim: `"are genesis-endowed
    and can never be reaped"`) during an earlier iteration of this fix that
    quoted more eagerly than this one does. Fail closed instead.
    """
    if not value:
        raise ValueError("refusing to emit an empty scalar")
    if value[0] in "'\"[{|>-" or value != value.strip():
        if '"' in value:
            raise ValueError(
                f"cannot safely quote a scalar that both needs quoting and contains a literal \": {value!r}"
            )
        return f'"{value}"'
    return value


def _yaml_block_list(key: str, values: list[str]) -> list[str]:
    """Emit a `key:` field as a block list, one item per line.

    Flow lists (`key: [a, b, c]`) were the brief's original design and are
    what finding 2 (fix round 1) found broken: `_split_flow` (tools/plan/model.py)
    splits items on unquoted commas only, so an unquoted item containing its
    own comma — a real spec ref, "13 §1, §2, §5" — silently re-split into
    three fragments on read, and `load_milestones` reported 0 errors because
    every fragment is a valid scalar on its own. A block list needs no such
    escaping: `BLOCK_ITEM_RE` takes each item verbatim to end of line, so
    commas, brackets, and embedded quotes inside an item are all safe — which
    a real spec ref exercises (F9's spec cell embeds a semicolon-delimited
    clause containing both commas and literal `"..."` quotes).
    """
    if not values:
        return [f"{key}: []"]
    lines = [f"{key}:"]
    lines.extend(f"  - {_yaml_scalar(v)}" for v in values)
    return lines


def _split_refs(cell: str) -> list[str]:
    if cell in {"—", "-", ""}:
        return []
    return [part.strip() for part in cell.split(";") if part.strip()]


def _split_depends(cell: str) -> list[str]:
    if cell in {"—", "-", ""}:
        return []
    return [part.strip() for part in re.split(r"[,/]", cell) if part.strip()]


def _iter_milestone_rows(plan_text: str):
    """Yield (line_number, track, raw_cells) for every milestone row.

    Shared by migrate_milestones (which writes the files) and the CLI's proof
    (which needs the same source cells independently of what got written), so
    the two can never drift against each other.
    """
    track: str | None = None
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
        yield number, track, raw_cells


def migrate_milestones(plan_text: str, out: Path) -> list[Path]:
    """Write plan/milestones/<ID>.md for every milestone row. Returns the paths."""
    directory = out / "plan" / "milestones"
    directory.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    seen: set[str] = set()

    for number, track, raw_cells in _iter_milestone_rows(plan_text):
        cells = [unescape_cell(cell) for cell in raw_cells]
        identifier, title, spec, depends, status_cell, notes = cells
        status = GLYPH_TO_STATUS.get(status_cell)
        if status is None:
            raise ValueError(f"PLAN.md:{number}: unrecognised status glyph {status_cell!r}")

        path = directory / f"{identifier}.md"
        if identifier in seen:
            raise ValueError(f"PLAN.md:{number}: duplicate milestone id {identifier!r}")
        seen.add(identifier)

        spec_list = _split_refs(spec)
        depends_list = _split_depends(depends)
        lines = [
            "---",
            f"id: {identifier}",
            f"track: {track}",
            f"title: {_yaml_scalar(title)}",
            *_yaml_block_list("spec", spec_list),
            *_yaml_block_list("depends", depends_list),
            f"status: {status}",
            "---",
            "",
            notes,
            "",
        ]
        path.write_text("\n".join(lines), encoding="utf-8")

        # Converter-level self-check: a converter that cannot reproduce its own
        # input has not converted anything. Read the file straight back with
        # the strict parser and compare against what was intended, field by
        # field — this is what caught the finding-2 comma corruption, which
        # `load_milestones` alone could not (every corrupted fragment is a
        # valid scalar on its own).
        values, body = parse_frontmatter(path)
        mismatches = []
        if values.get("id") != identifier:
            mismatches.append(f"id: wrote {identifier!r}, read {values.get('id')!r}")
        if values.get("track") != track:
            mismatches.append(f"track: wrote {track!r}, read {values.get('track')!r}")
        if values.get("title") != title:
            mismatches.append(f"title: wrote {title!r}, read {values.get('title')!r}")
        if values.get("spec") != spec_list:
            mismatches.append(f"spec: wrote {spec_list!r}, read {values.get('spec')!r}")
        if values.get("depends") != depends_list:
            mismatches.append(f"depends: wrote {depends_list!r}, read {values.get('depends')!r}")
        if values.get("status") != status:
            mismatches.append(f"status: wrote {status!r}, read {values.get('status')!r}")
        if body != notes:
            mismatches.append(f"body: wrote {notes!r}, read {body!r}")
        if mismatches:
            raise ValueError(f"{path}: round-trip self-check failed: " + "; ".join(mismatches))

        written.append(path)
        print(f"wrote {path.relative_to(out)}", file=sys.stderr)

    return written


def source_cells_of(plan_text: str) -> list[str]:
    """The atomic units every emitted file, together, must cover.

    Spec/Depends columns legitimately become several frontmatter list items
    each (the semicolon/comma/slash split), so the units that must
    individually survive are the split refs, not the whole raw column text
    with its separators still in it — matching `migrate_milestones`'s own
    `_split_refs`/`_split_depends` calls, via the same `_iter_milestone_rows`
    both draw from, so the two can never drift against each other.
    """
    cells: list[str] = []
    for _number, track, raw_cells in _iter_milestone_rows(plan_text):
        identifier, title, spec, depends, status_cell, notes = raw_cells
        cells.append(identifier)
        cells.append(title)
        cells.extend(_split_refs(unescape_cell(spec)))
        cells.extend(_split_depends(unescape_cell(depends)))
        cells.append(status_cell)
        cells.append(notes)
        cells.append(track)
    return cells


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["milestones"])
    parser.add_argument("--plan", type=Path, default=Path("PLAN.md"))
    parser.add_argument("--out", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    text = args.plan.read_text(encoding="utf-8")
    written = migrate_milestones(text, args.out)

    source_cells = source_cells_of(text)
    missing = prove_lossless(source_cells, written)
    print(f"{len(written)} files, {len(source_cells)} cells checked, {len(missing)} cells missing")
    if missing:
        for cell in missing[:20]:
            print(f"MISSING: {cell[:160]}", file=sys.stderr)
        print(f"{len(missing)} cells missing from the emitted tree", file=sys.stderr)
        return 1
    print("losslessness proof: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
