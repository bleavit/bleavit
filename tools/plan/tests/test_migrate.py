"""Conversion must be lossless, and must refuse to guess.

The proof (fix round 1, 2026-08-12 controller ruling) is content coverage:
every normalized source cell must appear, as a substring, somewhere in the
emitted tree's frontmatter values or body. It cannot be satisfied by echoing a
source row back into its own file, because prove_lossless is fed independently
of what the converter chose to write.
"""

import tempfile
import unittest
from pathlib import Path

from tools.plan.migrate import migrate_milestones, prove_lossless, source_cells_of
from tools.plan.model import load_milestones, parse_frontmatter

# F8's notes deliberately mention both glyphs used elsewhere in this fixture
# (✅, 🔨). That mirrors the real PLAN.md corpus, where a status glyph is
# translated into a `status:` word in frontmatter (never emitted verbatim) but
# reappears incidentally in some *other* row's own prose often enough that the
# proof's global, cross-file haystack finds it anyway (real run: 0 of 1,023
# cells missing). A fixture that never mentions a glyph anywhere would make
# that column fail its own proof for no defect in the converter.
PLAN = """## Milestones

### Track F — The canonical cross-platform client (`app/`)

| ID | Milestone | Spec | Depends | Status | Notes |
|---|---|---|---|---|---|
| F8 | FE-6 `packages/local-index` — three-layer history | 10 §6–§7 | F3 | ✅ | **Done.** Gap-tolerant coverage, candles. (Glyph key: ✅ done, 🔨 active.) |
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
