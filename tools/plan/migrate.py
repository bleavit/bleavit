"""One-shot conversion of PLAN.md's tables into the plan/ item tree.

Every conversion carries its own losslessness proof. The converter never
guesses. An unrecognised status glyph, a row with the wrong cell count, or a
track heading it cannot read is an error, not a default.

The proof is content coverage, not block-multiset equality (2026-08-12
controller ruling, fix round 1): the multiset design let a converter pass by
echoing each source row verbatim into its own file, which is true by
construction regardless of whether the frontmatter or body captured anything.
Coverage cannot be satisfied that way, because nothing is echoed — a source
cell must actually appear in a *value* the converter derived.

Fix round 2 refined that further: coverage (does the source text survive
verbatim, as a substring, somewhere in the emitted tree?) is the right proof
for a column the converter copies through unchanged, but not for one it
*transforms*. The status column is transformed — a glyph (✅/⬜/🔨/⛔) becomes
an enum word (done/pending/active/blocked) that never appears verbatim in any
emitted file — so a coverage check on it can only pass by coincidence (some
*other* row's notes prose happening to mention the same glyph character) and
would keep passing even if `STATUS_GLYPHS` were inverted tomorrow. Every other
column (id, title, spec refs, depends refs, notes, and the track letter) is
copied through unchanged and belongs in `COVERAGE_CHECKED_COLUMNS`; the status
column belongs in `MAPPING_CHECKED_COLUMNS` and is proven instead by
`prove_status_mapping`, per row, against the same `STATUS_GLYPHS` table the
converter itself used to write it.
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

    **What this proves, precisely, and no more (fix round 3, finding 4):** the
    haystack is the union of the *whole emitted tree*, so this can tell only
    whether a piece of source text survived *somewhere in the tree* — never
    whether it landed on the right row, the right field, or even a field at
    all. A cell whose normalized text happens to recur anywhere else (which,
    empirically, is most of them: deleting S7's `depends` block, corrupting
    F9's first spec ref, swapping S7's and B14's bodies, and rewriting every
    `track:` to `A` were all tried against the real 117-file tree, and every
    one still reported `0 cells missing`) passes regardless of whether *this*
    row's own value is right. It is genuinely useful for exactly one thing:
    catching text the converter derived **nowhere at all** — which is what
    finding 1's echo-based design was gaming, and what a field left out of a
    column mapping entirely (a whole cell dropped, not merely misplaced)
    would still trip.

    **Every actual per-row guarantee comes from `verify_round_trip`, not from
    this function.** Any task reusing this proof design (Tasks 6, 8, 9, 10 —
    spec questions, verification records, day files) MUST also call
    `verify_round_trip` for every item it writes; copying `prove_lossless`
    alone inherits none of the real guarantee. See `COVERAGE_CHECKED_COLUMNS`
    / `MAPPING_CHECKED_COLUMNS` and `prove_status_mapping` for the companion
    check a transformed (not merely copied) column needs on top of both.
    """
    haystack = "\n".join(item_text(path) for path in emitted)
    return [c for c in source_cells if normalize_prose(c) and normalize_prose(c) not in haystack]


# Every milestone-row column, classified once and named loudly so a later
# migration task reusing this proof cannot inherit finding 3's hole by
# accident: a column belongs in exactly one list, and the two need different
# proofs (fix round 2). `track` is not a table column — it comes from the
# governing `### Track X` heading, not the row — but it is copied through
# unchanged exactly like the six column cells, so the same coverage proof
# applies to it and it is listed alongside them.
COVERAGE_CHECKED_COLUMNS = ("id", "title", "spec", "depends", "notes", "track")
MAPPING_CHECKED_COLUMNS = ("status",)


def prove_status_mapping(
    plan_text: str, emitted: list[Path], glyphs: dict[str, str] = STATUS_GLYPHS
) -> list[str]:
    """For every source row, the emitted status must map back to its source glyph.

    Per row, not aggregate: an aggregate count (e.g. "101 done, 10 pending, 6
    active" matches "101 ✅, 10 ⬜, 6 🔨") would still pass under a map that
    permuted which *rows* got which status, so this reads each emitted file's
    own `status` value and checks it against that same row's own source glyph
    — `glyphs[emitted_status] == source_glyph` — not merely that the right
    totals occur somewhere. Returns one message per row that fails.

    `glyphs` defaults to the real `STATUS_GLYPHS` and takes an override only so
    a test can prove this function is not vacuous by feeding it a deliberately
    wrong (e.g. inverted) map and checking that every row then fails.
    """
    by_id = {path.stem: path for path in emitted}
    mismatches: list[str] = []
    for _number, _track, raw_cells in _iter_milestone_rows(plan_text):
        identifier, _title, _spec, _depends, source_glyph, _notes = raw_cells
        path = by_id.get(identifier)
        if path is None:
            mismatches.append(f"{identifier}: no emitted file to check")
            continue
        values, _body = parse_frontmatter(path)
        emitted_status = values.get("status")
        mapped_back = glyphs.get(emitted_status)
        if mapped_back != unescape_cell(source_glyph):
            mismatches.append(
                f"{identifier}: source glyph {source_glyph!r}, emitted status {emitted_status!r} "
                f"maps back to {mapped_back!r}"
            )
    return mismatches


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


def verify_round_trip(
    path: Path, expected_values: dict[str, str | list[str]], expected_body: str
) -> list[str]:
    """Read `path` straight back and compare every field against what was intended.

    This is the check that actually holds per row (fix round 3, finding 4) —
    `prove_lossless` does not, and cannot: it only tells you a piece of text
    survived *somewhere in the tree*, never that *this file's own* fields are
    right. `verify_round_trip` is the opposite kind of guarantee: exact,
    per-file, per-field equality between what the converter meant to write and
    what the strict parser reads back, catching corruption a substring search
    is structurally blind to (this is what caught fix round 1's comma
    corruption — every corrupted fragment was still a valid scalar on its
    own, so `load_milestones` alone reported 0 errors throughout).

    **Mandatory, not optional, for any task reusing this proof design** —
    copying `prove_lossless` without also calling this on every item written
    inherits none of the real per-row guarantee.

    `expected_values` maps frontmatter key -> the scalar or list value the
    caller intended for that key; `expected_body` is the intended body text.
    Returns one human-readable mismatch message per disagreeing field, or an
    empty list if the file reproduces its own input exactly.
    """
    values, body = parse_frontmatter(path)
    mismatches: list[str] = []
    for key, expected in expected_values.items():
        actual = values.get(key)
        if actual != expected:
            mismatches.append(f"{key}: wrote {expected!r}, read {actual!r}")
    if body != expected_body:
        mismatches.append(f"body: wrote {expected_body!r}, read {body!r}")
    return mismatches


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

        mismatches = verify_round_trip(
            path,
            {
                "id": identifier,
                "track": track,
                "title": title,
                "spec": spec_list,
                "depends": depends_list,
                "status": status,
            },
            notes,
        )
        if mismatches:
            raise ValueError(f"{path}: round-trip self-check failed: " + "; ".join(mismatches))

        written.append(path)
        print(f"wrote {path.relative_to(out)}", file=sys.stderr)

    return written


def find_orphans(directory: Path, written: list[Path]) -> list[Path]:
    """`*.md` files present in `directory` that this run did not write.

    `migrate_milestones` never clears the output directory (`mkdir(exist_ok=True)`
    only), so rerunning over a `PLAN.md` with a row removed leaves the stale
    file behind — absent from `written`, and invisible to both `prove_lossless`
    and `prove_status_mapping` (fix round 3, finding 5): neither checks what
    exists on disk, only what the current run produced. `load_milestones` and
    every downstream consumer would still see the stale file, though.

    Never deletes anything — a converter that removes files nobody asked it to
    remove is its own hazard. The caller (`main`) fails loudly instead, naming
    the orphans, so the operator can clear the directory deliberately.
    """
    if not directory.is_dir():
        return []
    written_set = {p.resolve() for p in written}
    return sorted(p for p in directory.glob("*.md") if p.resolve() not in written_set)


def source_cells_of(plan_text: str) -> list[str]:
    """The atomic units every emitted file, together, must cover.

    Covers exactly `COVERAGE_CHECKED_COLUMNS`: id, title, split spec refs,
    split depends refs, notes, and the row's track letter. **Deliberately
    excludes the status glyph** (fix round 2, finding 3) — it is
    mapping-checked by `prove_status_mapping` instead, because the converter
    transforms it (glyph → enum word) rather than copying it through, so no
    emitted file ever contains the glyph verbatim and a coverage check on it
    can only pass by coincidence.

    Spec/Depends columns legitimately become several frontmatter list items
    each (the semicolon/comma/slash split), so the units that must
    individually survive are the split refs, not the whole raw column text
    with its separators still in it — matching `migrate_milestones`'s own
    `_split_refs`/`_split_depends` calls, via the same `_iter_milestone_rows`
    both draw from, so the two can never drift against each other.

    Iterates `COVERAGE_CHECKED_COLUMNS` itself, and asserts each row's derived
    columns match it exactly (fix round 3, finding 4 item 3) — the tuple was
    previously referenced only by docstrings, so nothing stopped it drifting
    from what this function actually checks. A test also pins the tuple's
    contents directly, independent of this function's own use of it.
    """
    cells: list[str] = []
    for _number, track, raw_cells in _iter_milestone_rows(plan_text):
        identifier, title, spec, depends, _status_cell, notes = raw_cells
        per_column: dict[str, list[str]] = {
            "id": [identifier],
            "title": [title],
            "spec": _split_refs(unescape_cell(spec)),
            "depends": _split_depends(unescape_cell(depends)),
            "notes": [notes],
            "track": [track],
        }
        assert set(per_column) == set(COVERAGE_CHECKED_COLUMNS), (
            f"source_cells_of's per-row columns {sorted(per_column)} must exactly match "
            f"COVERAGE_CHECKED_COLUMNS {sorted(COVERAGE_CHECKED_COLUMNS)}"
        )
        for column in COVERAGE_CHECKED_COLUMNS:
            cells.extend(per_column[column])
    return cells


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["milestones"])
    parser.add_argument("--plan", type=Path, default=Path("PLAN.md"))
    parser.add_argument("--out", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    text = args.plan.read_text(encoding="utf-8")
    written = migrate_milestones(text, args.out)

    directory = args.out / "plan" / "milestones"
    orphans = find_orphans(directory, written)
    if orphans:
        for orphan in orphans:
            print(f"ORPHAN: {orphan} — present on disk but not written by this run", file=sys.stderr)
        print(
            f"{len(orphans)} orphaned file(s) in {directory}: not written by this run. "
            "Clear the directory deliberately and rerun; this converter never deletes.",
            file=sys.stderr,
        )
        return 1

    source_cells = source_cells_of(text)
    missing = prove_lossless(source_cells, written)
    print(f"{len(written)} files, {len(source_cells)} cells checked, {len(missing)} cells missing")
    if missing:
        for cell in missing[:20]:
            print(f"MISSING: {cell[:160]}", file=sys.stderr)
        print(f"{len(missing)} cells missing from the emitted tree", file=sys.stderr)
        return 1

    mapping_mismatches = prove_status_mapping(text, written)
    print(f"{len(written)} rows, {len(mapping_mismatches)} status-mapping mismatches")
    if mapping_mismatches:
        for row in mapping_mismatches[:20]:
            print(f"STATUS MISMATCH: {row}", file=sys.stderr)
        print(f"{len(mapping_mismatches)} rows failed the status mapping proof", file=sys.stderr)
        return 1

    print("losslessness proof: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
