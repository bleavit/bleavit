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
import os
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

# A Markdown inline link: [label](target). The negative lookbehind excludes
# an image (`![alt](src)`) — mirrors tools/ci/check-doc-links.py's LINK_RE.
_MD_LINK_RE = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)]+)\)")
_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
_LEADING_UPLEVELS_RE = re.compile(r"^(?:\.\./)+")


def _split_link_target(raw: str) -> tuple[str, str]:
    """(path, fragment) — fragment keeps its leading '#', '' if there is none."""
    path, sep, frag = raw.strip().partition("#")
    return path, (sep + frag)


def _is_external_link(path_part: str) -> bool:
    """A scheme (http:, mailto:, …) or an anchor-only target — never rewritten."""
    return not path_part or bool(_SCHEME_RE.match(path_part))


def rewrite_repo_links(text: str, root: Path, emit_dir: Path) -> str:
    """Re-base each Markdown link in `text` so it resolves from `emit_dir`.

    Source prose (PLAN.md, at the repo root) writes every relative doc
    citation as root-relative, e.g. "docs/architecture/02-integration-
    contract.md" — correct only for a reader starting at the repo root. Once
    that text is lifted verbatim into an item file under `plan/<kind>/`
    (Task 6's `plan/questions/`, and by the same reasoning Task 8's
    `plan/verifications/` and Task 9's day files), the identical target no
    longer resolves: GitHub and `tools/ci/check-doc-links.py` both resolve a
    relative link against the *file's own* directory, two levels below root.

    A target already resolving from `emit_dir` (a cross-reference the item
    tree itself introduced, or one that happens to already be correct) is
    left untouched — this only re-bases a target that is right somewhere
    else, never invents one. A target resolving from neither base is left
    untouched too: whether it is broken is `check-doc-links.py`'s question
    to answer on the regenerated tree, not this function's to guess at.

    Read this together with `normalize_prose`'s `_canonicalize_link_targets`
    call, immediately below: whatever form this rewrites a target INTO, that
    must normalize it back to the same root-relative form the untouched
    source cell already has, or `prove_lossless`/`verify_round_trip` would
    see a rewritten link as a lost cell.
    """

    def replace(match: re.Match[str]) -> str:
        label, raw_target = match.group(1), match.group(2)
        path_part, fragment = _split_link_target(raw_target)
        if _is_external_link(path_part) or path_part.startswith("/"):
            return match.group(0)
        if (emit_dir / path_part).resolve().exists():
            return match.group(0)  # already resolves from here
        candidate = (root / path_part).resolve()
        if not candidate.exists():
            return match.group(0)  # resolves from neither base; not this function's call
        relative = Path(os.path.relpath(candidate, emit_dir)).as_posix()
        return f"[{label}]({relative}{fragment})"

    return _MD_LINK_RE.sub(replace, text)


def _canonicalize_link_targets(text: str) -> str:
    """Undo `rewrite_repo_links`'s re-basing for comparison purposes only.

    Strips any leading `../` run from a link target, which is exactly what
    turns a `rewrite_repo_links` output back into the root-relative form the
    untouched source cell carries — regardless of how many directory levels
    deep the emitting item file lives, since `os.path.relpath` always emits
    exactly that many leading `../` segments and no more. A target with no
    leading `../` (already root-relative, or a same-directory cross-
    reference) passes through unchanged.
    """

    def replace(match: re.Match[str]) -> str:
        label, raw_target = match.group(1), match.group(2)
        path_part, fragment = _split_link_target(raw_target)
        if _is_external_link(path_part):
            return match.group(0)
        return f"[{label}]({_LEADING_UPLEVELS_RE.sub('', path_part)}{fragment})"

    return _MD_LINK_RE.sub(replace, text)


def normalize_prose(text: str) -> str:
    """Reduce a block to the words it carries, ignoring markup and escaping."""
    text = text.replace("\\|", "|")
    text = _canonicalize_link_targets(text)
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


def _section(text: str, heading: str) -> str:
    """The text of one `## ` section, from its heading up to (not including) the next."""
    lines = text.split("\n")
    start = lines.index(heading)
    for index in range(start + 1, len(lines)):
        if lines[index].startswith("## "):
            return "\n".join(lines[start:index])
    return "\n".join(lines[start:])


QUESTION_HEADER = ["ID", "Question", "Spec ref", "Raised", "Status"]
BATCH_HEADER = ["Batch", "Rows", "Members"]
_DATE_IN_TEXT = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")

# A real batch row's first cell is the bold label plus a title, e.g.
# "**B7 · grounding findings — rulings raised by executing the spec (...)**"
# — the `\*{0,2}` and the `|$` alternative also admit a bare "B7" cell (no
# bold markup, no title), which is the shape unit tests use. The bold form
# mirrors tools/ci/check-spec-question-batches.py's own BATCH_LABEL_RE,
# already proven against this exact table by the batch-index CI gate.
BATCH_LABEL_RE = re.compile(r"^\*{0,2}([BDCXE][0-9]?)(?:\s*[·.]|$)")

# The status vocabulary as it is, not as it ought to be. Every non-"open" word
# already counts as resolved for the four citation gates, which ask only
# whether the cell begins with "open". This map preserves that reading
# exactly; changing it is a separate decision from moving the data. Measured
# 2026-08-12 over the real PLAN.md: open 166, resolved 389, ✅ 7, closed 7,
# ruled 7, reconciled 3, ratified 1, largely 1, oracle 1, diagnosed; 1 = 583.
STATUS_WORDS = {
    "open": "open",
    "resolved": "resolved",
    "✅": "resolved",
    "closed": "resolved",
    "ruled": "resolved",
    "reconciled": "resolved",
    "ratified": "resolved",
    "largely": "resolved",
    "oracle": "resolved",
    "diagnosed;": "resolved",
}

# Rows whose status word itself admits the question is only partly settled.
# They ship as resolved, unchanged from today, and the run reports them for a
# human ruling.
PARTIAL_WORDS = {"largely", "oracle", "diagnosed;"}

# SQ-593 is the fourth genuinely partial row ("ruled 2026-08-05; execution
# pending"), but its status word is the ordinary "ruled" that six other, fully
# resolved rows also use — word-level detection cannot separate it from them,
# so it is named explicitly rather than guessed at. Verified by reading the
# row (2026-08-12); do not extend this set without doing the same.
KNOWN_PARTIAL_IDS = {"SQ-593"}

# Sentinel `batch:` value for a resolved question the triage batches never
# named. The batch index exists to retire the *open* backlog in coherent
# units (PLAN.md's own words: "Every open row is assigned to exactly one
# batch below"); measured 2026-08-12, the 11 real batch rows' Members total
# exactly the 166 open ids and never a resolved one — the same rule
# tools/ci/check-spec-question-batches.py enforces the other way (a resolved
# id named by a batch is itself an error). So "resolved and unbatched" is the
# ordinary case, not a gap the converter failed to fill.
UNBATCHED = "none"


def _question_batches(section: str) -> dict[str, str]:
    """id -> short batch label (e.g. "B7", "X"), read from the batch index table.

    A duplicate assignment (one id named by two batch rows) raises immediately
    — the same "named by no batch, or by two, is an error" rule the question
    loop enforces for the open/unbatched case.
    """
    batches: dict[str, str] = {}
    for line in section.split("\n"):
        if not line.lstrip().startswith("|"):
            continue
        if is_separator_row(line):
            continue
        cells = split_cells(line)
        if cells == BATCH_HEADER or len(cells) != 3:
            continue
        label_cell, rows_cell, members_cell = cells
        match = BATCH_LABEL_RE.match(label_cell)
        if match is None:
            continue
        label = match.group(1)
        try:
            declared = int(rows_cell.strip())
        except ValueError:
            raise ValueError(f"batch {label}: row count {rows_cell!r} is not a number") from None
        # A closed batch (0 rows) uses its Members cell for disposition prose,
        # not a member list; a trailing "— annotation" clause on an open batch
        # is likewise not part of the list. Neither should be scanned for ids.
        head = re.split(r"\s+—\s+", unescape_cell(members_cell))[0]
        ids = re.findall(r"SQ-\d+", head) if declared else []
        if len(ids) != declared:
            raise ValueError(f"batch {label} declares {declared} rows but lists {len(ids)}")
        for member in ids:
            if member in batches:
                raise ValueError(f"{member} is named by both batch {batches[member]} and batch {label}")
            batches[member] = label
    return batches


def _iter_question_rows(section: str):
    """Yield (id, question, spec_ref, raised, status_cell) for every question row.

    Shared by migrate_questions (which writes the files) and the proofs (which
    need the same source cells independently of what got written), so the two
    can never drift against each other — matching `_iter_milestone_rows`.
    """
    for line in section.split("\n"):
        if not line.lstrip().startswith("|"):
            continue
        if is_separator_row(line):
            continue
        cells = [unescape_cell(cell) for cell in split_cells(line)]
        if cells == QUESTION_HEADER:
            continue
        # A 3-cell batch-index row is a different table sharing this heading;
        # it is not a malformed question row, so it is skipped here rather
        # than raised on — `_question_batches` reads it separately. Anything
        # whose id cell genuinely looks like a question id, though, is held
        # to the 5-cell shape: the converter never guesses a missing cell.
        if not cells or not re.fullmatch(r"SQ-\d+", cells[0]):
            continue
        if len(cells) != 5:
            raise ValueError(f"question row {cells[0]!r} has {len(cells)} cells, expected 5")
        yield cells[0], cells[1], cells[2], cells[3], cells[4]


def _frontmatter_title(question: str) -> str:
    """A frontmatter-safe rendering of the raw question text.

    Nearly every row's question passes straight through `_yaml_scalar`
    unmodified. One row in the real corpus (SQ-71) opens with a literal `"` —
    which forces quoting — and also carries embedded `"` characters elsewhere
    in the same cell, which the strict double-quoted grammar (model.py
    `_scalar`) forbids outright: there is no lossless single-line encoding for
    that shape (see `_yaml_scalar`'s own docstring). The frontmatter title is
    a readable label, not that row's record of truth: every question's raw
    cell survives untouched under the body's `## Question` heading, so folding
    embedded double quotes to the typographic '”' mark here is a legible,
    deterministic fallback, not a loss.
    """
    try:
        _yaml_scalar(question)
        return question
    except ValueError:
        folded = question.replace('"', "”")
        _yaml_scalar(folded)  # must now be safe; a still-failing fold is a new shape to look at, not paper over
        return folded


# Every question-row column, classified once exactly like
# COVERAGE_CHECKED_COLUMNS/MAPPING_CHECKED_COLUMNS above. `question` and
# `status_cell` are copied through unchanged — `question` into the body's
# `## Question` section (frontmatter `title` may be a folded rendering, per
# `_frontmatter_title`, so the coverage proof must not rely on it) and
# `status_cell` into `## Status` — so both are coverage-checked. `status` (the
# derived enum) and `batch` (an index lookup, not a row cell at all) are each
# transformed rather than copied, so both are mapping-checked instead.
QUESTION_COVERAGE_COLUMNS = ("id", "question", "spec_ref", "raised", "status_cell")
QUESTION_MAPPING_COLUMNS = ("status", "batch")


def question_source_cells_of(plan_text: str) -> list[str]:
    """The atomic units every emitted question file, together, must cover."""
    section = _section(plan_text, "## Spec questions")
    cells: list[str] = []
    for identifier, question, spec_ref, raised, status_cell in _iter_question_rows(section):
        per_column = {
            "id": [identifier],
            "question": [question],
            "spec_ref": [spec_ref],
            "raised": [raised],
            "status_cell": [status_cell],
        }
        assert set(per_column) == set(QUESTION_COVERAGE_COLUMNS), (
            f"question_source_cells_of's per-row columns {sorted(per_column)} must exactly match "
            f"QUESTION_COVERAGE_COLUMNS {sorted(QUESTION_COVERAGE_COLUMNS)}"
        )
        for column in QUESTION_COVERAGE_COLUMNS:
            cells.extend(per_column[column])
    return cells


def _status_word(status_cell: str) -> str:
    parts = status_cell.split()
    return parts[0].strip("*_`.,").lower() if parts else ""


def prove_question_status_mapping(plan_text: str, emitted: list[Path]) -> list[str]:
    """For every source row, the emitted status must map back to its source word.

    Per row, not aggregate — mirrors `prove_status_mapping`.
    """
    section = _section(plan_text, "## Spec questions")
    by_id = {path.stem: path for path in emitted}
    mismatches: list[str] = []
    for identifier, _question, _spec_ref, _raised, status_cell in _iter_question_rows(section):
        path = by_id.get(identifier)
        if path is None:
            mismatches.append(f"{identifier}: no emitted file to check")
            continue
        values, _body = parse_frontmatter(path)
        word = _status_word(status_cell)
        expected = STATUS_WORDS.get(word)
        actual = values.get("status")
        if actual != expected:
            mismatches.append(f"{identifier}: status word {word!r} maps to {expected!r}, emitted status {actual!r}")
    return mismatches


def prove_question_batch_mapping(plan_text: str, emitted: list[Path]) -> list[str]:
    """For every source row, the emitted `batch:` must match the id-to-batch map.

    An OPEN row must carry its real batch label; a resolved row the batch
    index never named must carry the `UNBATCHED` sentinel — never a guess.
    """
    section = _section(plan_text, "## Spec questions")
    batches = _question_batches(section)
    by_id = {path.stem: path for path in emitted}
    mismatches: list[str] = []
    for identifier, _question, _spec_ref, _raised, status_cell in _iter_question_rows(section):
        path = by_id.get(identifier)
        if path is None:
            mismatches.append(f"{identifier}: no emitted file to check")
            continue
        values, _body = parse_frontmatter(path)
        status = STATUS_WORDS.get(_status_word(status_cell))
        expected = batches.get(identifier, UNBATCHED if status != "open" else None)
        actual = values.get("batch")
        if actual != expected:
            mismatches.append(f"{identifier}: expected batch {expected!r}, emitted {actual!r}")
    return mismatches


def migrate_questions(plan_text: str, out: Path) -> list[Path]:
    """Write plan/questions/<ID>.md for every spec-question row. Returns the paths."""
    section = _section(plan_text, "## Spec questions")
    batches = _question_batches(section)
    directory = out / "plan" / "questions"
    directory.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    partial: list[str] = []
    seen: set[str] = set()

    for identifier, question, spec_ref, raised, status_cell in _iter_question_rows(section):
        if identifier in seen:
            raise ValueError(f"duplicate spec question id {identifier!r}")
        seen.add(identifier)

        word = _status_word(status_cell)
        if word not in STATUS_WORDS:
            raise ValueError(
                f"spec question {identifier}: unknown status word {word!r}. "
                f"Add it to STATUS_WORDS only after reading the row — do not default it."
            )
        status = STATUS_WORDS[word]
        if word in PARTIAL_WORDS or identifier in KNOWN_PARTIAL_IDS:
            partial.append(identifier)

        batch = batches.get(identifier)
        if batch is None:
            if status == "open":
                raise ValueError(f"spec question {identifier} is OPEN but named by no batch")
            batch = UNBATCHED

        # A resolved row may carry no date. 10 of the 389 "resolved"-word rows
        # (plus a further 2 among the ✅/closed/ruled family) do not, and
        # inventing one would be a fabrication the losslessness proof cannot
        # catch.
        found = _DATE_IN_TEXT.search(status_cell)
        resolved = found.group(1) if (status == "resolved" and found) else None

        # The source cell is root-relative (PLAN.md's own location); this
        # item file lives two directories deeper, so any doc citation the
        # cell carries must be re-based or it 404s for a reader on GitHub —
        # see `rewrite_repo_links`. `title` (derived from `question` below)
        # and `spec_ref` both land in frontmatter as plain text in the same
        # file check-doc-links.py scans whole, so they need the rewritten
        # form exactly like the body sections do — 14 real spec_ref cells
        # carry a citation as a Markdown link (e.g. "[11](docs/architecture/
        # 11-frontend-workflows.md) §11.8.2"), not only prose.
        question_rw = rewrite_repo_links(question, out, directory)
        status_cell_rw = rewrite_repo_links(status_cell, out, directory)
        spec_ref_rw = rewrite_repo_links(spec_ref, out, directory)

        # No `path.exists()` check here (unlike a first-draft version of this
        # function): re-running the converter over an already-populated
        # directory is the ordinary case, not a collision — `seen` above is
        # what actually catches two rows sharing one id within this run, the
        # same way `migrate_milestones` relies on its own `seen` set alone.
        path = directory / f"{identifier}.md"
        title = _frontmatter_title(question_rw)
        lines = [
            "---",
            f"id: {identifier}",
            f"title: {_yaml_scalar(title)}",
            f"spec_ref: {_yaml_scalar(spec_ref_rw)}",
            f"raised: {_yaml_scalar(raised)}",
            f"status: {status}",
        ]
        if resolved:
            lines.append(f"resolved: {resolved}")
        lines += [
            f"batch: {_yaml_scalar(batch)}",
            "---",
            "",
            "## Question",
            "",
            question_rw,
            "",
            "## Status",
            "",
            status_cell_rw,
            "",
        ]
        path.write_text("\n".join(lines), encoding="utf-8")

        expected_values: dict[str, str | list[str]] = {
            "id": identifier,
            "title": title,
            "spec_ref": spec_ref_rw,
            "raised": raised,
            "status": status,
            "batch": batch,
        }
        if resolved:
            expected_values["resolved"] = resolved
        expected_body = f"## Question\n\n{question_rw}\n\n## Status\n\n{status_cell_rw}"
        mismatches = verify_round_trip(path, expected_values, expected_body)
        if mismatches:
            raise ValueError(f"{path}: round-trip self-check failed: " + "; ".join(mismatches))

        written.append(path)
        print(f"wrote {path.relative_to(out)}", file=sys.stderr)

    for identifier in batches:
        if not (directory / f"{identifier}.md").exists():
            raise ValueError(f"batch names {identifier}, which is not a row of the question table")

    if partial:
        ordered = sorted(set(partial), key=lambda i: int(i.split("-")[1]))
        print(
            "PARTIAL — these shipped as resolved, unchanged from today, and need a human ruling: "
            + ", ".join(ordered),
            file=sys.stderr,
        )

    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["milestones", "questions"])
    parser.add_argument("--plan", type=Path, default=Path("PLAN.md"))
    parser.add_argument("--out", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    text = args.plan.read_text(encoding="utf-8")

    if args.kind == "milestones":
        directory = args.out / "plan" / "milestones"
        written = migrate_milestones(text, args.out)
    else:
        directory = args.out / "plan" / "questions"
        written = migrate_questions(text, args.out)

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

    if args.kind == "milestones":
        source_cells = source_cells_of(text)
    else:
        source_cells = question_source_cells_of(text)
    missing = prove_lossless(source_cells, written)
    print(f"{len(written)} files, {len(source_cells)} cells checked, {len(missing)} cells missing")
    if missing:
        for cell in missing[:20]:
            print(f"MISSING: {cell[:160]}", file=sys.stderr)
        print(f"{len(missing)} cells missing from the emitted tree", file=sys.stderr)
        return 1

    if args.kind == "milestones":
        mapping_mismatches = prove_status_mapping(text, written)
    else:
        mapping_mismatches = prove_question_status_mapping(text, written) + prove_question_batch_mapping(
            text, written
        )
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
