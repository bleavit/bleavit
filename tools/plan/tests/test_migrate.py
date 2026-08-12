"""Conversion must be lossless, and must refuse to guess.

The proof has two halves, because a column the converter copies through
unchanged and a column it transforms need different tests (fix round 2,
2026-08-12 controller ruling, finding 3):

- `prove_lossless` is content coverage: every normalized source cell must
  appear, as a substring, somewhere in the emitted tree's frontmatter values
  or body. It cannot be satisfied by echoing a source row back into its own
  file (fix round 1), because it is fed independently of what the converter
  chose to write. It covers `COVERAGE_CHECKED_COLUMNS`.
- `prove_status_mapping` is a per-row mapping assertion for the one
  transformed column, status: the glyph never appears verbatim in any emitted
  file (it becomes an enum word), so coverage cannot check it at all — a
  coverage check that happened to pass on it was passing by coincidence, not
  by design (round 1's version did exactly that).
"""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from tools.plan.migrate import (
    COVERAGE_CHECKED_COLUMNS,
    MAPPING_CHECKED_COLUMNS,
    find_orphans,
    main,
    migrate_milestones,
    prove_lossless,
    prove_status_mapping,
    source_cells_of,
    verify_round_trip,
)
from tools.plan.model import STATUS_GLYPHS, load_milestones, parse_frontmatter

PLAN = """## Milestones

### Track F — The canonical cross-platform client (`app/`)

| ID | Milestone | Spec | Depends | Status | Notes |
|---|---|---|---|---|---|
| F8 | FE-6 `packages/local-index` — three-layer history | 10 §6–§7 | F3 | ✅ | **Done.** Gap-tolerant coverage, candles. |
| F11 | FE-9 distribution — Vite build | 12 §1, §5 | F0 | 🔨 | Pipeline landed 2026-08-04. |

### Track S — Systemic verification

| ID | Milestone | Spec | Depends | Status | Notes |
|---|---|---|---|---|---|
| S7 | graph (a \\| b \\| c) | 13 §1 | S6 | ✅ | Done 2026-08-01. |
| S8 | comma-bearing refs | 13 §1, §2, §5; 15 §1 (I-6, I-14); 05 §5 | S7 | ✅ | Regression fixture for the comma bug. |
"""


class MigrateMilestonesTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_writes_one_file_per_milestone(self):
        written = migrate_milestones(PLAN, self.root)
        self.assertEqual(
            sorted(p.name for p in written), ["F11.md", "F8.md", "S7.md", "S8.md"]
        )

    def test_files_load_back_through_the_model(self):
        migrate_milestones(PLAN, self.root)
        items, errors = load_milestones(self.root)
        self.assertEqual(errors, [])
        by_id = {item.id: item for item in items}
        self.assertEqual(by_id["F8"].status, "done")
        self.assertEqual(by_id["F11"].status, "active")
        self.assertEqual(by_id["F8"].track, "F")
        self.assertEqual(by_id["F8"].depends, ("F3",))

    def test_escaped_pipes_survive_as_literal_pipes(self):
        migrate_milestones(PLAN, self.root)
        items, _ = load_milestones(self.root)
        s7 = next(item for item in items if item.id == "S7")
        self.assertEqual(s7.title, "graph (a | b | c)")
        self.assertEqual(s7.status, "done")

    def test_comma_bearing_spec_refs_survive_as_one_ref_each(self):
        """Regression for fix round 1 finding 2: an unquoted flow-list item
        containing a comma used to re-split on read, so one source ref like
        "13 §1, §2, §5" silently became three fragments. `load_milestones`
        reported 0 errors throughout, because every fragment is a valid
        scalar on its own — only comparing the parsed value against what the
        converter intended catches it."""
        migrate_milestones(PLAN, self.root)
        items, errors = load_milestones(self.root)
        self.assertEqual(errors, [])
        s8 = next(item for item in items if item.id == "S8")
        self.assertEqual(
            s8.spec, ("13 §1, §2, §5", "15 §1 (I-6, I-14)", "05 §5")
        )

    def test_every_emitted_file_round_trips_spec_and_depends_exactly(self):
        """Prove the round trip rather than asserting it: re-read every
        emitted file and check its parsed spec/depends against the semicolon-
        or comma/slash-split values the converter intended to write."""
        written = migrate_milestones(PLAN, self.root)
        expected = {
            "F8": (("10 §6–§7",), ("F3",)),
            "F11": (("12 §1, §5",), ("F0",)),
            "S7": (("13 §1",), ("S6",)),
            "S8": (("13 §1, §2, §5", "15 §1 (I-6, I-14)", "05 §5"), ("S7",)),
        }
        for path in written:
            values, _body = parse_frontmatter(path)
            spec_expected, depends_expected = expected[path.stem]
            self.assertEqual(tuple(values["spec"]), spec_expected, path)
            self.assertEqual(tuple(values["depends"]), depends_expected, path)

    def test_conversion_is_lossless(self):
        """Every source cell — the atomic units `source_cells_of` derives from
        the same _iter_milestone_rows the converter itself walks — must
        appear, normalized, somewhere in the emitted tree. This is the exact
        function the CLI (main()) uses for its own proof."""
        written = migrate_milestones(PLAN, self.root)
        missing = prove_lossless(source_cells_of(PLAN), written)
        self.assertEqual(missing, [])

    def test_prove_lossless_reports_a_genuinely_missing_cell(self):
        written = migrate_milestones(PLAN, self.root)
        missing = prove_lossless(["nothing in the source says this"], written)
        self.assertEqual(missing, ["nothing in the source says this"])

    def test_an_unknown_status_glyph_raises(self):
        bad = PLAN.replace("| ✅ | **Done.**", "| 🎉 | **Done.**")
        with self.assertRaises(ValueError):
            migrate_milestones(bad, self.root)

    def test_a_row_with_the_wrong_cell_count_raises(self):
        """The converter must never guess a missing or extra cell (fix round 3
        fold-in): tested directly, not merely exercised by a controller
        review."""
        bad = PLAN.replace(
            "| F8 | FE-6 `packages/local-index` — three-layer history | 10 §6–§7 | F3 | ✅ | "
            "**Done.** Gap-tolerant coverage, candles. |",
            "| F8 | FE-6 `packages/local-index` — three-layer history | 10 §6–§7 | F3 | ✅ |",
        )
        with self.assertRaises(ValueError):
            migrate_milestones(bad, self.root)

    def test_a_row_before_any_track_heading_raises(self):
        no_heading = """## Milestones

| ID | Milestone | Spec | Depends | Status | Notes |
|---|---|---|---|---|---|
| X1 | orphan row | — | — | ✅ | No `### Track` heading precedes this row. |
"""
        with self.assertRaises(ValueError):
            migrate_milestones(no_heading, self.root)

    def test_a_duplicate_milestone_id_raises(self):
        dup = PLAN + "| F8 | duplicate of the F8 above | — | — | ✅ | Must raise, not overwrite. |\n"
        with self.assertRaises(ValueError):
            migrate_milestones(dup, self.root)

    def test_verify_round_trip_passes_for_a_correctly_written_file(self):
        written = migrate_milestones(PLAN, self.root)
        f8 = next(p for p in written if p.stem == "F8")
        mismatches = verify_round_trip(
            f8,
            {
                "id": "F8",
                "track": "F",
                "title": "FE-6 `packages/local-index` — three-layer history",
                "spec": ["10 §6–§7"],
                "depends": ["F3"],
                "status": "done",
            },
            "**Done.** Gap-tolerant coverage, candles.",
        )
        self.assertEqual(mismatches, [])

    def test_verify_round_trip_reports_a_field_that_disagrees(self):
        """This is the check finding 4 says actually holds per row — unlike
        prove_lossless, which cannot distinguish a right value from a wrong
        one that merely recurs elsewhere in the tree."""
        written = migrate_milestones(PLAN, self.root)
        f8 = next(p for p in written if p.stem == "F8")
        mismatches = verify_round_trip(
            f8,
            {
                "id": "F8",
                "track": "F",
                "title": "a title the converter never actually wrote",
                "spec": ["10 §6–§7"],
                "depends": ["F3"],
                "status": "done",
            },
            "**Done.** Gap-tolerant coverage, candles.",
        )
        self.assertEqual(len(mismatches), 1)
        self.assertIn("title", mismatches[0])

    def test_coverage_and_mapping_columns_partition_every_row_field(self):
        """Fix round 3, finding 4 item 3: COVERAGE_CHECKED_COLUMNS and
        MAPPING_CHECKED_COLUMNS must together be exactly the six row cells
        plus the track letter, and must not overlap — pinned independently of
        source_cells_of's own (also asserting) use of the tuple."""
        all_columns = {"id", "title", "spec", "depends", "status", "notes", "track"}
        self.assertEqual(set(COVERAGE_CHECKED_COLUMNS) | set(MAPPING_CHECKED_COLUMNS), all_columns)
        self.assertEqual(set(COVERAGE_CHECKED_COLUMNS) & set(MAPPING_CHECKED_COLUMNS), set())

    def test_find_orphans_detects_a_stale_file_without_deleting_it(self):
        written = migrate_milestones(PLAN, self.root)
        directory = self.root / "plan" / "milestones"
        stray = directory / "ZZZ-not-a-real-row.md"
        stray.write_text("stray file this run did not write", encoding="utf-8")
        orphans = find_orphans(directory, written)
        self.assertEqual(orphans, [stray])
        self.assertTrue(stray.exists(), "find_orphans must never delete anything")

    def test_find_orphans_reports_nothing_for_a_clean_rerun(self):
        written = migrate_milestones(PLAN, self.root)
        directory = self.root / "plan" / "milestones"
        self.assertEqual(find_orphans(directory, written), [])

    def test_main_fails_loudly_and_names_an_orphaned_file(self):
        """Demonstrates fix round 3, finding 5 end to end through the CLI: a
        clean run succeeds; planting a stray file the next run did not write
        makes main() fail (exit 1) and name the file on stderr, rather than
        silently deleting it or silently ignoring it."""
        plan_path = self.root / "PLAN.md"
        plan_path.write_text(PLAN, encoding="utf-8")

        exit_code = main(["milestones", "--plan", str(plan_path), "--out", str(self.root)])
        self.assertEqual(exit_code, 0)

        orphan = self.root / "plan" / "milestones" / "ZZZ-not-a-real-row.md"
        orphan.write_text(
            "---\nid: ZZZ-not-a-real-row\ntrack: Z\ntitle: stray\nspec: []\ndepends: []\nstatus: done\n---\n\nstray\n",
            encoding="utf-8",
        )

        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = main(["milestones", "--plan", str(plan_path), "--out", str(self.root)])
        self.assertEqual(exit_code, 1)
        self.assertIn("ZZZ-not-a-real-row.md", stderr.getvalue())
        self.assertTrue(orphan.exists(), "main() must never delete an orphan itself")

    def test_status_glyph_is_excluded_from_coverage_checked_cells(self):
        """Fix round 2, finding 3: the status glyph is never written to any
        emitted file (it becomes an enum word), so a coverage check on it can
        only pass by coincidence — some *other* row's notes happening to
        mention the same glyph character. It must not be in the cell list
        `prove_lossless` checks at all."""
        cells = source_cells_of(PLAN)
        self.assertNotIn("✅", cells)
        self.assertNotIn("🔨", cells)

    def test_prove_status_mapping_passes_for_a_correct_conversion(self):
        written = migrate_milestones(PLAN, self.root)
        self.assertEqual(prove_status_mapping(PLAN, written), [])

    def test_prove_status_mapping_fails_if_the_glyph_map_were_inverted(self):
        """Proves the mapping assertion is not vacuous: feeding it a
        deliberately wrong table (done and active glyphs swapped) must fail,
        on every row whose status the swap actually changes — otherwise this
        check could not have caught the finding-3 defect it exists for."""
        written = migrate_milestones(PLAN, self.root)
        inverted = dict(STATUS_GLYPHS)
        inverted["done"], inverted["active"] = inverted["active"], inverted["done"]
        mismatches = prove_status_mapping(PLAN, written, glyphs=inverted)
        mismatched_ids = {m.split(":")[0] for m in mismatches}
        # F8, S7 and S8 are "done" (✅); F11 is "active" (🔨) — every one of
        # them is affected by swapping exactly those two glyphs.
        self.assertEqual(mismatched_ids, {"F8", "F11", "S7", "S8"})
