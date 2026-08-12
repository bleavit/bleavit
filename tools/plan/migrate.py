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
from dataclasses import dataclass
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
        # Preserve the source target's directory marker. Path normalization
        # drops a terminal slash, but the losslessness proof compares the
        # Markdown target itself and must not silently rewrite
        # `docs/proposals/` as `docs/proposals`.
        if path_part.endswith("/"):
            relative += "/"
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


## ---------------------------------------------------------------------
## Verification records (Task 8): one stable-id file per finding.
## ---------------------------------------------------------------------

VERIFICATION_HEADER = ["ID", "Item", "Spec ref", "Status", "Result"]
VERIFICATION_COVERAGE_COLUMNS = ("source_id", "item", "spec_ref", "status_cell", "result")

# Four ids each named two different findings in the legacy table (V-142).
# Keep the first occurrence at its cited id and give the second a fresh id.
# The original id remains in the item's body, so the migration loses no
# history while the new filesystem makes another collision impossible.
LEGACY_DUPLICATE_VERIFICATION_IDS = {
    ("V-72", 2): "V-386",
    ("V-73", 2): "V-387",
    ("V-98", 2): "V-388",
    ("V-99", 2): "V-389",
}


def _iter_verification_rows(plan_text: str):
    section = _section(plan_text, "## Verification log")
    occurrences: dict[str, int] = {}
    for line in section.split("\n"):
        if not line.lstrip().startswith("|") or is_separator_row(line):
            continue
        cells = [unescape_cell(cell) for cell in split_cells(line)]
        if cells == VERIFICATION_HEADER:
            continue
        if not cells or not re.fullmatch(r"V-\d+", cells[0]):
            continue
        if len(cells) != 5:
            raise ValueError(
                f"verification row {cells[0]!r} has {len(cells)} cells, expected 5"
            )
        source_id = cells[0]
        occurrences[source_id] = occurrences.get(source_id, 0) + 1
        identifier = LEGACY_DUPLICATE_VERIFICATION_IDS.get(
            (source_id, occurrences[source_id]), source_id
        )
        yield identifier, source_id, cells[1], cells[2], cells[3], cells[4]


def verification_source_cells_of(plan_text: str) -> list[str]:
    cells: list[str] = []
    for _identifier, source_id, item, spec_ref, status_cell, result in _iter_verification_rows(
        plan_text
    ):
        per_column = {
            "source_id": [source_id],
            "item": [item],
            "spec_ref": [spec_ref],
            "status_cell": [status_cell],
            "result": [result],
        }
        assert set(per_column) == set(VERIFICATION_COVERAGE_COLUMNS)
        for column in VERIFICATION_COVERAGE_COLUMNS:
            cells.extend(per_column[column])
    return cells


def _verification_milestone(result: str) -> str:
    match = re.search(r"(?<![A-Za-z0-9])([A-Z][A-Za-z]*\d+[a-z]?)(?![A-Za-z0-9])", result)
    return match.group(1) if match else "—"


def migrate_verifications(plan_text: str, out: Path) -> list[Path]:
    """Write plan/verifications/<ID>.md for every verification finding."""
    directory = out / "plan" / "verifications"
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    seen: set[str] = set()
    undated: list[str] = []

    for identifier, source_id, item, spec_ref, status_cell, result in _iter_verification_rows(
        plan_text
    ):
        if identifier in seen:
            raise ValueError(f"duplicate verification id {identifier!r}")
        seen.add(identifier)

        found = _DATE_IN_TEXT.search(status_cell)
        date = found.group(1) if found else None
        if date is None:
            undated.append(identifier)
        milestone = _verification_milestone(result)
        emit_dir = directory
        item_rw = rewrite_repo_links(item, out, emit_dir)
        spec_ref_rw = rewrite_repo_links(spec_ref, out, emit_dir)
        status_rw = rewrite_repo_links(status_cell, out, emit_dir)
        result_rw = rewrite_repo_links(result, out, emit_dir)
        title = _frontmatter_title(item_rw)
        path = directory / f"{identifier}.md"
        body_parts = []
        if source_id != identifier:
            body_parts += ["## Legacy ID", "", source_id, ""]
        body_parts += [
            "## Item",
            "",
            item_rw,
            "",
            "## Spec ref",
            "",
            spec_ref_rw,
            "",
            "## Status",
            "",
            status_rw,
        ]
        if result_rw:
            body_parts += ["", "## Result", "", result_rw]
        body = "\n".join(body_parts)
        lines = [
            "---",
            f"id: {identifier}",
        ]
        if date:
            lines.append(f"date: {date}")
        lines += [
            f"milestone: {_yaml_scalar(milestone)}",
            f"title: {_yaml_scalar(title)}",
            "---",
            "",
            body,
            "",
        ]
        path.write_text("\n".join(lines), encoding="utf-8")

        expected_values: dict[str, str | list[str]] = {
            "id": identifier,
            "milestone": milestone,
            "title": title,
        }
        if date:
            expected_values["date"] = date
        mismatches = verify_round_trip(path, expected_values, body)
        if mismatches:
            raise ValueError(f"{path}: round-trip self-check failed: " + "; ".join(mismatches))
        written.append(path)
        print(f"wrote {path.relative_to(out)}", file=sys.stderr)

    if undated:
        print("UNDATED verification records: " + ", ".join(undated), file=sys.stderr)
    return written


## ---------------------------------------------------------------------
## Day records (Task 9): the four chronological record kinds.
##
## `## Session log`, `## Decision log` and `## Audit log` are 4-cell GFM
## tables; `## Unplanned changes` is a bullet list. All four are append-only
## history rather than entities with state, so they land as day files —
## `plan/<kind>/YYYY/MM/YYYY-MM-DD.md` — instead of one file per row.
##
## **Deviation from the task brief, recorded here rather than silently
## taken:** the brief's Interfaces section places `read_day_records` in
## `tools/plan/model.py`. The task's own Prohibitions list (separate from
## the brief, given by the orchestrating session) states plainly: "Do NOT
## modify `tools/plan/gfm.py` or `model.py` ... You may extend `migrate.py`
## and `render.py`." That is unambiguous and it is the more specific,
## more recently stated instruction, so `DayRecord` and `read_day_records`
## live here instead. Nothing about their behaviour changes as a result —
## `render.py` imports `read_day_records` from this module exactly as it
## would have imported it from `model.py`.
##
## **Per-record guarantee.** Milestones/questions get `verify_round_trip`
## against `parse_frontmatter`; day files carry no frontmatter at all (a
## day file holds several records, not one item), so there is no
## `---`-delimited block to parse. The equivalent here is `_parse_day_file`:
## after writing a day file, it is read straight back with the same strict
## grammar `read_day_records` uses, and the (heading, fields, body) tuple
## this run intended for every record in that file is compared against what
## the parser reports, by equality — exact, per-file, per-record, per-field,
## matching `verify_round_trip`'s own guarantee and no weaker. A file that
## fails this check raises immediately; nothing is written and left unverified.
##
## **Coverage, not mapping, for every column.** Unlike the milestone table's
## status glyph (an enum encoding transformed on write, MAPPING_CHECKED),
## every day-record column here is COPIED THROUGH, never re-encoded: the
## heading is a verbatim substring of its source cell (the leading `**bold**`
## run, markers stripped by `_split_lead`, exactly as `normalize_prose`
## already strips them for the coverage proof), the body is the verbatim
## remainder, and every field value is a verbatim column cell. So all four
## kinds are 100% coverage-checked and none needs a mapping proof:
## `day_source_cells_of` collects the raw cells position-for-position with
## `_iter_table_day_rows`/`_iter_change_bullets` (the same functions that
## write them), and `prove_day_lossless` is `prove_lossless`'s design
## re-applied to a day file's plain text instead of a frontmatter file's
## parsed values, because a day file has no keys to exclude in the first
## place — the whole file, modulo markup, is normalized_prose'd content.
## ---------------------------------------------------------------------

DAY_KINDS = ("log", "decisions", "audits", "changes")

# The source section each kind reads, and the title each day file opens
# with ("# <title> — YYYY-MM-DD"). `decisions`/`audits` intentionally do not
# echo their source section's exact name (`## Decision log`) — `decisions`
# matches the brief's own worked example ("# Decisions — 2026-08-09"), and
# `audits` keeps the source name because there is no shorter accepted one.
KIND_SECTION_HEADING = {
    "log": "## Session log",
    "decisions": "## Decision log",
    "audits": "## Audit log",
    "changes": "## Unplanned changes",
}
KIND_TITLE = {
    "log": "Session log",
    "decisions": "Decisions",
    "audits": "Audit log",
    "changes": "Unplanned changes",
}

# The real PLAN.md table headers (verified 2026-08-12 against the live file —
# the brief's own prose description, "Date | Milestone | What was done | What
# comes next", is NOT the literal header row; the real one reads "Date |
# Milestone(s) | Done | Next"). `changes` has no table header at all.
TABLE_HEADER: dict[str, list[str]] = {
    "log": ["Date", "Milestone(s)", "Done", "Next"],
    "decisions": ["Date", "Amendment", "Authorized by", "Docs touched"],
    "audits": ["Date", "Scope", "Verdict", "Pointer"],
}

# Declared `key: value` fields per kind, in write order. `log` and `changes`
# declare none: log's two remaining columns (What was done / What comes
# next) are prose that folds into the body, not fields; `changes` has no
# columns left over once the heading is drawn from the bullet's own bold
# lead. `span` (see `_day_and_span`) is always additionally permitted, on
# every kind, without being declared here — it is optional and per-record,
# not a property of the kind.
KIND_FIELDS: dict[str, tuple[str, ...]] = {
    "log": (),
    "decisions": ("authorized_by", "docs_touched"),
    "audits": ("verdict", "pointer"),
    "changes": (),
}

# A record's date cell begins with a date and may be a range
# ("2026-07-15–16", "2026-08-07/08"). Filed under its first day; the
# original string survives in a `span:` field so the range is never
# silently flattened. Verified 2026-08-12: exactly 3 such rows, all in the
# Session log; Decision log (262 rows) and Audit log (11 rows) have none.
_DAY_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def _day_and_span(cell: str) -> tuple[str, str | None]:
    text = cell.strip("*_` ")
    match = _DAY_RE.match(text)
    if match is None:
        raise ValueError(f"record date cell does not begin with a date: {cell[:40]!r}")
    day = match.group(1)
    return day, (text if text != day else None)


def _independent_day(cell: str) -> str:
    """The day a record files under, computed WITHOUT calling `_day_and_span`.

    `_verify_day_placement_and_order` (fix round 1, finding 3) exists to
    catch a defect in `_day_and_span` itself — e.g. a mutation that misfiles
    every 2026-07-18 row under 2026-07-17. A derivation check built by
    calling `_day_and_span` again would share the same defect and pass
    silently, exactly as `migrate_day_records`'s own round-trip self-check
    already does (it compares against `grouped`, which `_day_and_span` built
    in the first place — self-consistent, not correct). This duplicates
    only the minimal regex match, deliberately, so the two paths cannot fail
    together.
    """
    match = _DAY_RE.match(cell.strip("*_` "))
    if match is None:
        raise ValueError(f"record date cell does not begin with a date: {cell[:40]!r}")
    return match.group(1)


# The cell's leading **bold** run becomes the record heading; everything
# after it (with one separating space, if any) becomes the body. A cell
# with no leading bold run — genuinely common: 5 of 262 Decision log rows, 2
# of 11 Audit log rows, 6 of 16 Unplanned-changes bullets, and every Session
# log Milestone cell — becomes its own heading verbatim, with an empty
# body. Nothing is lost by that fallback: the coverage proof reads the
# heading as a value exactly like the body, and the whole original cell is
# checked as one coverage unit by `day_source_cells_of` regardless of how
# `_split_lead` divided it.
_BOLD_LEAD_RE = re.compile(r"^\*\*(.+?)\*\*")


def _split_lead(cell: str) -> tuple[str, str]:
    match = _BOLD_LEAD_RE.match(cell)
    if match is not None:
        heading = match.group(1)
        rest = cell[match.end() :]
        if rest.startswith(" "):
            rest = rest[1:]
        return heading, rest
    # No leading bold run. The heading can never itself contain a newline —
    # written as `## {heading}`, an embedded "\n" would silently split into
    # further physical lines that read back as body prose on the very next
    # parse, corrupting the round trip (caught 2026-08-12 against the real
    # Unplanned-changes corpus: a bullet's indented continuation paragraph
    # is real embedded "\n"s, not markup, so `cell` alone can be multi-line
    # even with no bold run in it). So only the first line becomes the
    # heading; anything after it becomes body instead of being silently
    # dropped — for a single-line cell (every table lead cell; a bulletless
    # `changes` entry) `rest` is simply "".
    first_line, _, rest = cell.partition("\n")
    return first_line, rest


# Fix round 2, finding 4: a decision Amendment cell (and, less often, the
# other three kinds' lead cell) is a full sentence or paragraph, not a
# title — median 101 characters, p90 159, max 1,450 in the real Decision
# log. Round 1 tried to solve that at the anchor/label layer and both
# routes were wrong: a truncated-prefix anchor matched no real heading
# (259/262 broken), and a full-heading anchor is unusable Markdown and an
# unusable `DECISIONS.md` row (1,417 characters, round 1's own finding).
# The heading itself has to be bounded, once, at emit time, for every kind
# — "one behaviour rather than four" — with the untruncated text kept, not
# dropped, as the record body's own first paragraph.
#
# The width is derived from the one place a heading is embedded in
# something with its own hard limit — a `plan/DECISIONS.md` row must stay
# ≤ 200 characters — and is the largest width satisfying that, checked by
# generating the real row for every one of the 262 decisions at each
# candidate width. The row's fixed shape is
#
#   "| " + date(10) + " | [" + label + "](" + target + "#" + anchor + ") | " + authorized_by + " |"
#
# date is always 10 chars; target is always
# "decisions/YYYY/MM/YYYY-MM-DD.md" = 31 chars; authorized_by is bounded to
# `AUTHORIZED_BY_WIDTH` = 30 (render.py). The literal punctuation around
# them ("| ", " | [", "](", "#", ") | ", " |") is 25 chars. That leaves
# 200 - 25 - 31 - 30 = 114 characters for label + anchor, and both are
# derived from the same bounded heading (worst case each ≈ its width), so
# 2 * WIDTH <= 114 => WIDTH <= 57 — which is exactly where the measured
# search (`WIDTH` from 60 down to 40, computing every real row) crosses the
# line: 58 -> max row 202, 57 -> max row 197.
RECORD_HEADING_WIDTH = 57


def _bound_heading(text: str, width: int = RECORD_HEADING_WIDTH) -> tuple[str, str | None]:
    """(bounded, overflow): `bounded` is `text` truncated to `width` at the
    last word boundary at or before it, with a trailing ellipsis; `overflow`
    is the original `text` when truncation happened, `None` when it did not
    (so the caller can tell "nothing to move" from "moved text is the
    original", and never duplicate a heading that was already short enough).

    Word-boundary, not a hard character cut, so a truncated heading never
    ends mid-word — `_truncate` (render.py) cuts at a character boundary
    instead, which is fine for a table cell but reads worse in a Markdown
    heading, which is prose rather than a data cell.
    """
    if len(text) <= width:
        return text, None
    cut = text[: width - 1]
    space = cut.rfind(" ")
    if space > 0:
        cut = cut[:space]
    return cut.rstrip() + "…", text


@dataclass(frozen=True)
class DayRecord:
    date: str
    heading: str
    fields: dict[str, str]
    body: str
    path: Path


_DAY_TITLE_RE = re.compile(r"^# (.+) — (\d{4}-\d{2}-\d{2})$")
_DAY_HEADING_RE = re.compile(r"^## (.+)$")
_FIELD_LINE_RE_CACHE: dict[frozenset[str], re.Pattern[str]] = {}


def _field_line_re(allowed_keys: frozenset[str]) -> re.Pattern[str]:
    """A `^(key1|key2|...): (.*)$` pattern over exactly `allowed_keys`.

    Anchoring on the declared key names (rather than any `[a-z_]+:` prefix)
    is what lets ordinary body prose safely start a line with a word and a
    colon without being misread as a field — the same reasoning
    `tools/plan/model.py`'s `TOP_LEVEL_RE` states for frontmatter, applied
    here to a body block that is not frontmatter and so is not that file's
    concern to police.
    """
    if allowed_keys not in _FIELD_LINE_RE_CACHE:
        alternation = "|".join(sorted(allowed_keys))
        _FIELD_LINE_RE_CACHE[allowed_keys] = re.compile(rf"^({alternation}): (.*)$")
    return _FIELD_LINE_RE_CACHE[allowed_keys]


def _day_path(out: Path, kind: str, day: str) -> Path:
    year, month, _ = day.split("-")
    return out / "plan" / kind / year / month / f"{day}.md"


def _parse_day_file(path: Path, kind: str) -> list[DayRecord]:
    """Read one day file back into its records. Refuses, never guesses:

    a missing/garbled title line, a title date that disagrees with the
    file's own path, a `## ` heading whose field block is incomplete when
    the kind declares fields, or a duplicate field key within one record.
    """
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if not lines or not lines[0].startswith("# "):
        raise ValueError(f"{path}: must open with a '# <Title> — <date>' line")
    title_match = _DAY_TITLE_RE.match(lines[0])
    if title_match is None:
        raise ValueError(f"{path}: title line does not match '# <Title> — YYYY-MM-DD': {lines[0]!r}")
    title, title_date = title_match.groups()
    if title != KIND_TITLE[kind]:
        raise ValueError(f"{path}: title {title!r} does not match {KIND_TITLE[kind]!r} for kind {kind!r}")
    year, month, _ = title_date.split("-")
    expected_tail = (kind, year, month, f"{title_date}.md")
    if path.parts[-4:] != expected_tail:
        raise ValueError(f"{path}: title date {title_date} does not match its path {path}")

    declared = frozenset(KIND_FIELDS[kind])
    field_re = _field_line_re(declared | {"span"})

    records: list[DayRecord] = []
    index = 1
    while index < len(lines):
        if lines[index].strip() == "":
            index += 1
            continue
        heading_match = _DAY_HEADING_RE.match(lines[index])
        if heading_match is None:
            raise ValueError(f"{path}:{index + 1}: expected a '## ' record heading, found {lines[index]!r}")
        heading = heading_match.group(1)
        index += 1

        fields: dict[str, str] = {}
        while index < len(lines):
            field_match = field_re.match(lines[index])
            if field_match is None:
                break
            key, value = field_match.groups()
            if key in fields:
                raise ValueError(f"{path}:{index + 1}: duplicate field {key!r} in record {heading!r}")
            fields[key] = value
            index += 1

        missing = declared - fields.keys()
        if missing:
            raise ValueError(
                f"{path}: record {heading!r} is missing required field(s) {sorted(missing)} "
                f"— kind {kind!r} declares fields but this heading's field block is incomplete"
            )

        if index < len(lines) and lines[index] == "":
            index += 1
        body_lines: list[str] = []
        while index < len(lines) and not lines[index].startswith("## "):
            body_lines.append(lines[index])
            index += 1
        body = "\n".join(body_lines).strip("\n")

        records.append(DayRecord(date=title_date, heading=heading, fields=fields, body=body, path=path))
    return records


def read_day_records(root: Path, kind: str) -> tuple[list[DayRecord], list[str]]:
    """Read every day file under plan/<kind>/ back into DayRecords, in file order.

    File order is chronological by construction: `YYYY/MM/YYYY-MM-DD.md`
    sorts lexicographically exactly as it sorts by date.
    """
    directory = root / "plan" / kind
    errors: list[str] = []
    records: list[DayRecord] = []
    if not directory.is_dir():
        errors.append(f"plan/{kind}: directory is missing")
        return records, errors
    for path in sorted(directory.rglob("*.md")):
        # Honest holding area for Current-focus blocks whose first bold lead
        # has no date. It is deliberately not a day file and must not be
        # parsed as one merely because it lives beside them.
        if kind == "log" and path.name == "unsorted-current-focus.md":
            continue
        try:
            records.extend(_parse_day_file(path, kind))
        except ValueError as error:
            errors.append(str(error))
    return records, errors


def _iter_table_day_rows(section: str, header: list[str]):
    """Yield each 4-cell row's cells, unescaped, skipping the header/separator rows."""
    for line in section.split("\n"):
        if not line.lstrip().startswith("|"):
            continue
        if is_separator_row(line):
            continue
        cells = split_cells(line)
        if cells == header:
            continue
        if len(cells) != 4:
            raise ValueError(f"day-record row has {len(cells)} cells, expected 4: {line[:80]!r}")
        yield [unescape_cell(cell) for cell in cells]


_CHANGE_BULLET_START_RE = re.compile(r"(?m)^(?=- \d{4}-\d{2}-\d{2} — )")
_CHANGE_BULLET_HEAD_RE = re.compile(r"^- (\d{4}-\d{2}-\d{2}) — (.*)$")


def _iter_change_bullets(section: str):
    """Yield (date_cell, full_text) for every `## Unplanned changes` bullet.

    `full_text` is the bullet's first line plus every indented continuation
    paragraph up to the next bullet (or end of section), joined by real
    newlines — `_split_lead` then draws the heading from its bold lead the
    same way a table row's lead cell does.
    """
    start_match = re.search(r"(?m)^- \d{4}-\d{2}-\d{2} — ", section)
    if start_match is None:
        raise ValueError("'## Unplanned changes' has no bullet in the expected '- YYYY-MM-DD — ' shape")
    body = section[start_match.start() :]
    for block in _CHANGE_BULLET_START_RE.split(body):
        if not block:
            continue
        first_line, _, rest = block.partition("\n")
        head_match = _CHANGE_BULLET_HEAD_RE.match(first_line)
        if head_match is None:
            raise ValueError(f"unplanned-change bullet does not match the expected shape: {first_line[:80]!r}")
        date_cell, first_text = head_match.groups()
        full_text = first_text if not rest else f"{first_text}\n{rest}"
        yield date_cell, full_text.rstrip("\n")


def _source_day_and_heading_rows(section: str, kind: str, columns: list[str]) -> list[tuple[str, str]]:
    """(date_cell, heading) for every record, in source order — the same
    shape `migrate_day_records` folds into `grouped`, but read fresh from
    `section` every time it is called rather than reused from any prior
    call's state."""
    if kind == "changes":
        return [(date_cell, _split_lead(full_text)[0]) for date_cell, full_text in _iter_change_bullets(section)]
    if kind == "log":
        return [(date_cell, milestone) for date_cell, milestone, _done, _next in _iter_table_day_rows(section, columns)]
    if kind in ("decisions", "audits"):
        return [
            (date_cell, _split_lead(lead_cell)[0])
            for date_cell, lead_cell, _field1, _field2 in _iter_table_day_rows(section, columns)
        ]
    raise ValueError(f"unknown day-record kind {kind!r}")


def _verify_day_placement_and_order(section: str, kind: str, out: Path, columns: list[str]) -> None:
    """Prove, against the SOURCE rows rather than against `grouped`, that

    1. every record was written into the day file its own date cell
       designates (via `_independent_day`, never `_day_and_span` — see that
       function's docstring for why the two must not share a bug), and
    2. the records within each file appear in the same order the source
       rows for that day appeared in `section`.

    `migrate_day_records`'s round-trip self-check compares what was written
    against `rewritten`/`grouped` — the very structure that chose the file
    and the order — so it is self-consistent by construction and cannot
    catch either kind of misfiling (fix round 1, finding 3, demonstrated by
    mutation: patching `_day_and_span` to misfile every 2026-07-18 log row
    under 2026-07-17, and reversing the row-iteration order before
    grouping, both produced `0 cells missing`, 0 parse errors, silently).
    This function re-derives the expected shape from `section` independently
    of anything `migrate_day_records` computed, and raises loudly on the
    first disagreement — never silently.
    """
    expected_by_day: dict[str, list[str]] = {}
    for date_cell, heading in _source_day_and_heading_rows(section, kind, columns):
        day = _independent_day(date_cell)
        # Bound before rewrite, matching migrate_day_records's own order
        # (bounding happens in `add()`, before `grouped`; rewrite_repo_links
        # runs per-record in the write loop, after).
        bounded_heading, _overflow = _bound_heading(heading)
        heading_rw = rewrite_repo_links(bounded_heading, out, _day_path(out, kind, day).parent)
        expected_by_day.setdefault(day, []).append(heading_rw)

    for day, expected_headings in expected_by_day.items():
        path = _day_path(out, kind, day)
        if not path.exists():
            raise ValueError(
                f"derivation check: source rows designate day {day} ({expected_headings!r}) "
                f"but {path} was never written"
            )
        actual_headings = [record.heading for record in _parse_day_file(path, kind)]
        if actual_headings != expected_headings:
            raise ValueError(
                f"derivation check failed for {path}: source rows designate heading order "
                f"{expected_headings!r}, but the file holds {actual_headings!r}"
            )


def migrate_day_records(section: str, kind: str, out: Path, columns: list[str]) -> list[Path]:
    """Write plan/<kind>/YYYY/MM/YYYY-MM-DD.md for every record in `section`.

    `columns` is the source table's real header row (`TABLE_HEADER[kind]`);
    it is unused for `kind == "changes"`, whose own bullet reader validates
    shape by regex instead of by header comparison. Two records on the same
    date land in one file, in source order.
    """
    grouped: dict[str, list[tuple[str, dict[str, str], str]]] = {}

    def add(day: str, span: str | None, heading: str, fields: dict[str, str], body: str) -> None:
        if span is not None:
            fields = {**fields, "span": span}
        # Fix round 2, finding 4: bound the heading for every kind, in this
        # one place, and move anything it lost to the front of the body
        # rather than dropping it — nothing is lost, it moves one line down.
        bounded_heading, overflow = _bound_heading(heading)
        if overflow is not None:
            body = f"{overflow}\n\n{body}" if body else overflow
        grouped.setdefault(day, []).append((bounded_heading, fields, body))

    if kind == "changes":
        for date_cell, full_text in _iter_change_bullets(section):
            day, span = _day_and_span(date_cell)
            heading, body = _split_lead(full_text)
            add(day, span, heading, {}, body)
    elif kind == "log":
        for date_cell, milestone, done, next_ in _iter_table_day_rows(section, columns):
            day, span = _day_and_span(date_cell)
            body = f"{done}\n\n**What comes next:** {next_}"
            add(day, span, milestone, {}, body)
    elif kind in ("decisions", "audits"):
        field_names = KIND_FIELDS[kind]
        for date_cell, lead_cell, field1, field2 in _iter_table_day_rows(section, columns):
            day, span = _day_and_span(date_cell)
            heading, body = _split_lead(lead_cell)
            add(day, span, heading, {field_names[0]: field1, field_names[1]: field2}, body)
    else:
        raise ValueError(f"unknown day-record kind {kind!r}")

    written: list[Path] = []
    for day in sorted(grouped):
        records = grouped[day]
        path = _day_path(out, kind, day)
        path.parent.mkdir(parents=True, exist_ok=True)

        rewritten: list[tuple[str, dict[str, str], str]] = []
        lines = [f"# {KIND_TITLE[kind]} — {day}", ""]
        for heading, fields, body in records:
            heading_rw = rewrite_repo_links(heading, out, path.parent)
            if not heading_rw:
                raise ValueError(f"{path}: refusing to emit a record with an empty heading")
            fields_rw = {key: rewrite_repo_links(value, out, path.parent) for key, value in fields.items()}
            # `.strip("\n")` matches `_parse_day_file`'s own body extraction
            # exactly (`"\n".join(body_lines).strip("\n")`): a `changes`
            # bullet's continuation paragraph is separated from its first
            # line by a real blank line, so `_split_lead`'s body can open
            # with a leading "\n" that the file format never actually
            # stores — reading the file back trims it, so the in-memory
            # expectation must be trimmed the same way or the round-trip
            # self-check below sees a mismatch that was never really written.
            body_rw = rewrite_repo_links(body, out, path.parent).strip("\n")

            lines.append(f"## {heading_rw}")
            for key in (*KIND_FIELDS[kind], "span"):
                if key in fields_rw:
                    lines.append(f"{key}: {fields_rw[key]}")
            lines.append("")
            if body_rw:
                lines.append(body_rw)
                lines.append("")
            rewritten.append((heading_rw, fields_rw, body_rw))

        path.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")

        actual = _parse_day_file(path, kind)
        actual_tuples = [(record.heading, record.fields, record.body) for record in actual]
        if actual_tuples != rewritten:
            raise ValueError(f"{path}: round-trip self-check failed: wrote {rewritten!r}, read {actual_tuples!r}")

        written.append(path)
        print(f"wrote {path.relative_to(out)}", file=sys.stderr)

    _verify_day_placement_and_order(section, kind, out, columns)

    return written


def find_day_orphans(directory: Path, written: list[Path]) -> list[Path]:
    """`find_orphans`'s design, recursive: day files nest under YYYY/MM/."""
    if not directory.is_dir():
        return []
    written_set = {p.resolve() for p in written}
    return sorted(p for p in directory.rglob("*.md") if p.resolve() not in written_set)


def day_source_cells_of(plan_text: str, kind: str) -> list[str]:
    """The atomic units every emitted day file, together, must cover.

    Every column is coverage-checked (see the module-level note above), but
    a lead cell that `_split_lead` divides is checked as its **two** derived
    pieces (heading, body) rather than as the whole original cell — measured
    necessary, not assumed: `decisions` and `audits` write field lines
    (`authorized_by`/`docs_touched`, `verdict`/`pointer`) *between* the
    heading and the body, so the two pieces are no longer contiguous in the
    emitted file and a whole-cell substring search on the pre-split text
    reliably fails even though every word survived. `log` and `changes`
    declare no fields, so heading and body stay contiguous there and either
    check would pass — split checking is used for all four anyway, so one
    rule governs every kind instead of one rule that happens to work for two
    of them. This mirrors how `source_cells_of` checks a milestone's split
    `spec`/`depends` refs rather than the whole raw column text.
    """
    section = _section(plan_text, KIND_SECTION_HEADING[kind])
    cells: list[str] = []
    if kind == "changes":
        for date_cell, full_text in _iter_change_bullets(section):
            heading, body = _split_lead(full_text)
            cells.extend([date_cell, heading, body])
    elif kind == "log":
        for date_cell, milestone, done, next_ in _iter_table_day_rows(section, TABLE_HEADER[kind]):
            cells.extend([date_cell, milestone, done, next_])
    else:
        for date_cell, lead_cell, field1, field2 in _iter_table_day_rows(section, TABLE_HEADER[kind]):
            heading, body = _split_lead(lead_cell)
            cells.extend([date_cell, heading, body, field1, field2])
    return cells


def day_item_text(path: Path) -> str:
    """Everything a day file carries, normalized — no frontmatter to strip,
    unlike `item_text`, because a day file holds several records rather than
    one item's frontmatter-plus-body."""
    return normalize_prose(path.read_text(encoding="utf-8"))


def prove_day_lossless(source_cells: list[str], emitted: list[Path]) -> list[str]:
    """`prove_lossless`'s design, re-applied to plain day-file text.

    Same coverage-only guarantee and the same limits (see `prove_lossless`'s
    own docstring): tells you a piece of source text survived *somewhere in
    the tree*, never that it landed in the right record. The per-record
    guarantee for day files comes from the round-trip self-check inside
    `migrate_day_records`, exactly as `verify_round_trip` is the real
    guarantee for milestones/questions.
    """
    haystack = "\n".join(day_item_text(path) for path in emitted)
    return [c for c in source_cells if normalize_prose(c) and normalize_prose(c) not in haystack]


def _current_focus_blocks(plan_text: str) -> list[str]:
    section = _section(plan_text, "## Current focus")
    body = section.split("\n", 1)[1] if "\n" in section else ""
    blocks: list[str] = []
    current: list[str] = []
    for line in body.split("\n"):
        if line == "---":
            block = "\n".join(current).strip("\n")
            if block:
                blocks.append(block)
            current = []
        else:
            current.append(line)
    block = "\n".join(current).strip("\n")
    if block:
        blocks.append(block)
    return blocks


def migrate_current_focus(plan_text: str, out: Path) -> tuple[list[Path], Path]:
    """Archive dated Current-focus blocks; keep ambiguous blocks intact.

    Only a date in the block's first bold run is accepted. Position and a
    neighbouring block's date are never evidence. Dated blocks append to the
    Task-9 day file; undated blocks retain source order in the holding file.
    """
    blocks = _current_focus_blocks(plan_text)
    grouped: dict[str, list[str]] = {}
    holding_blocks: list[str] = []
    for block in blocks:
        lead = re.search(r"\*\*(.+?)\*\*", block, re.S)
        found = _DATE_IN_TEXT.search(lead.group(1)) if lead else None
        if found is None:
            holding_blocks.append(block)
        else:
            grouped.setdefault(found.group(1), []).append(block)

    written: list[Path] = []
    for day, day_blocks in sorted(grouped.items()):
        path = _day_path(out, "log", day)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            text = path.read_text(encoding="utf-8").rstrip("\n")
        else:
            text = f"# {KIND_TITLE['log']} — {day}"
        additions: list[str] = []
        for block in day_blocks:
            lead = re.search(r"\*\*(.+?)\*\*", block, re.S)
            assert lead is not None
            heading, _overflow = _bound_heading(normalize_prose(lead.group(1)))
            body = rewrite_repo_links(block, out, path.parent)
            additions.extend([f"## {heading}", "", body])
        path.write_text(text + "\n\n" + "\n\n".join(additions) + "\n", encoding="utf-8")
        written.append(path)

    holding = out / "plan" / "log" / "unsorted-current-focus.md"
    holding.parent.mkdir(parents=True, exist_ok=True)
    holding_text = "# Unsorted current-focus history\n"
    if holding_blocks:
        rewritten = [
            "\n".join(
                line.rstrip()
                for line in rewrite_repo_links(block, out, holding.parent).splitlines()
            )
            for block in holding_blocks
        ]
        holding_text += "\n" + "\n\n---\n\n".join(rewritten) + "\n"
    holding.write_text(holding_text, encoding="utf-8")

    haystack = "\n".join(
        normalize_prose(path.read_text(encoding="utf-8")) for path in [*written, holding]
    )
    missing = [block for block in blocks if normalize_prose(block) not in haystack]
    if missing:
        raise ValueError(f"current-focus losslessness proof failed for {len(missing)} block(s)")
    return written, holding


def shrink_plan(plan_text: str) -> str:
    """Return the post-split PLAN.md shell, preserving the Track-E analysis.

    The full Current-focus stack must already have been archived by
    `migrate_current_focus`; this function intentionally retains only the
    current handoff. All seven converted sections are represented by the
    generated index that `render.py --write` appends next.
    """
    track_e = _section(
        plan_text, "## Track E — crossover arithmetic and the self-funding statement"
    ).rstrip()
    return f"""# PLAN.md — Implementation Roadmap and Status

**`PLAN.md` and the `plan/` tree are the single source of implementation
status.** The files reference `docs/architecture/` and never restate normative
behaviour (AGENTS.md R-4).

Work the active milestone, otherwise the first pending milestone whose
dependencies are done. A milestone is done only after its verification gates
and blocker-free spec-compliance review. Record each session in
`plan/log/<YYYY>/<MM>/<YYYY-MM-DD>.md`.

Legend: ⬜ pending · 🔨 active · ✅ done · ⛔ blocked

## Current focus

> **PARKED: 2026-08-09 — Track F's code is complete; four milestones wait on
> external inputs.** F1 needs the user's SQ-940 ruling plus a device lab/live
> chain/hardware/ar.io credentials. F11 needs the production rollout inputs and
> FE-P7 evidence. F13 needs the key ceremony, real signer identities/keys and a
> live gateway. F14 needs the physical device lab and Playwright probe. The
> merged implementation is `acf9c1ae`; Track F is 26/30 done.

> The complete historical focus stack is archived in
> `plan/log/2026/08/2026-08-09.md` and
> `plan/log/unsorted-current-focus.md`. The latter is intentionally unsorted:
> its first bold lead contains no date, and the migration never inferred one
> from position.

{track_e}
"""


def archive_section_notes(plan_text: str, out: Path) -> Path:
    """Preserve prose outside converted table rows from the seven old sections.

    Item/day migration accounts for every row cell. The section introductions,
    track leads and batch-priority prose are not row cells, so they need their
    own non-normative archive rather than disappearing when PLAN.md shrinks.
    """
    headings = (
        "## Milestones",
        "## Spec questions",
        "## Verification log",
        "## Decision log",
        "## Audit log",
        "## Unplanned changes",
        "## Session log",
    )
    parts = ["# Pre-split section notes", ""]
    for heading in headings:
        section = _section(plan_text, heading)
        kept = [line for line in section.split("\n") if not line.lstrip().startswith("|")]
        text = "\n".join(kept).strip("\n")
        parts.extend([text, ""])
    path = out / "plan" / "SECTION-NOTES.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = rewrite_repo_links("\n".join(parts).rstrip() + "\n", out, path.parent)
    path.write_text(rendered, encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "kind",
        choices=[
            "milestones",
            "questions",
            "verifications",
            "current-focus",
            "section-notes",
            "shrink",
            *DAY_KINDS,
        ],
    )
    parser.add_argument("--plan", type=Path, default=Path("PLAN.md"))
    parser.add_argument("--out", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    text = args.plan.read_text(encoding="utf-8")
    if args.kind == "current-focus":
        days, holding = migrate_current_focus(text, args.out)
        print(f"{len(days)} dated files, holding file {holding}")
        print("losslessness proof: OK")
        return 0
    if args.kind == "shrink":
        args.plan.write_text(shrink_plan(text), encoding="utf-8")
        print(f"wrote {args.plan}")
        return 0
    if args.kind == "section-notes":
        path = archive_section_notes(text, args.out)
        print(f"wrote {path}")
        print("section-prose preservation: OK")
        return 0
    is_day_kind = args.kind in DAY_KINDS

    if args.kind == "milestones":
        directory = args.out / "plan" / "milestones"
        written = migrate_milestones(text, args.out)
    elif args.kind == "questions":
        directory = args.out / "plan" / "questions"
        written = migrate_questions(text, args.out)
    elif args.kind == "verifications":
        directory = args.out / "plan" / "verifications"
        written = migrate_verifications(text, args.out)
    else:
        directory = args.out / "plan" / args.kind
        section = _section(text, KIND_SECTION_HEADING[args.kind])
        columns = TABLE_HEADER.get(args.kind, [])
        written = migrate_day_records(section, args.kind, args.out, columns)

    orphans = (find_day_orphans if is_day_kind else find_orphans)(directory, written)
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
    elif args.kind == "questions":
        source_cells = question_source_cells_of(text)
    elif args.kind == "verifications":
        source_cells = verification_source_cells_of(text)
    else:
        source_cells = day_source_cells_of(text, args.kind)
    missing = (prove_day_lossless if is_day_kind else prove_lossless)(source_cells, written)
    print(f"{len(written)} files, {len(source_cells)} cells checked, {len(missing)} cells missing")
    if missing:
        for cell in missing[:20]:
            print(f"MISSING: {cell[:160]}", file=sys.stderr)
        print(f"{len(missing)} cells missing from the emitted tree", file=sys.stderr)
        return 1

    if is_day_kind:
        # Every day-record column is coverage-checked; none is transformed
        # the way the milestone status glyph or question status/batch are,
        # so there is no separate mapping proof to run (see the module-level
        # note above `DAY_KINDS`).
        print(f"{len(written)} files, 0 status-mapping mismatches (all columns are coverage-checked)")
    elif args.kind == "milestones":
        mapping_mismatches = prove_status_mapping(text, written)
        print(f"{len(written)} rows, {len(mapping_mismatches)} status-mapping mismatches")
        if mapping_mismatches:
            for row in mapping_mismatches[:20]:
                print(f"STATUS MISMATCH: {row}", file=sys.stderr)
            print(f"{len(mapping_mismatches)} rows failed the status mapping proof", file=sys.stderr)
            return 1
    elif args.kind == "questions":
        mapping_mismatches = prove_question_status_mapping(text, written) + prove_question_batch_mapping(
            text, written
        )
        print(f"{len(written)} rows, {len(mapping_mismatches)} status-mapping mismatches")
        if mapping_mismatches:
            for row in mapping_mismatches[:20]:
                print(f"STATUS MISMATCH: {row}", file=sys.stderr)
            print(f"{len(mapping_mismatches)} rows failed the status mapping proof", file=sys.stderr)
            return 1
    else:
        print(f"{len(written)} rows, 0 mapping mismatches (all source columns are coverage-checked)")

    print("losslessness proof: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
