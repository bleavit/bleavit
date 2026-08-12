"""The renderer emits narrow rows and escapes what it writes.

A generated table cannot drift, which serves the 2026-07-17 standing instruction
more strongly than a checker does — but only if the renderer escapes the pipe
that severed rows before.
"""

import tempfile
import unittest
from pathlib import Path

from tools.plan.migrate import migrate_day_records
from tools.plan.model import Milestone, Question
from tools.plan.render import _anchor, escape_cell, main, render_decisions, render_milestones, render_questions


def milestone(**kwargs):
    defaults = dict(
        id="F8",
        track="F",
        title="FE-6 local-index",
        spec=("10 §6",),
        depends=("F3",),
        status="done",
        verify=(),
        body="",
        path=Path("plan/milestones/F8.md"),
    )
    defaults.update(kwargs)
    return Milestone(**defaults)


def question(**kwargs):
    defaults = dict(
        id="SQ-616",
        title="Which arm raises QueueFull?",
        spec_ref="09 §1.2",
        raised="2026-07-20",
        status="open",
        resolved=None,
        batch="B7",
        body="",
        path=Path("plan/questions/SQ-616.md"),
    )
    defaults.update(kwargs)
    return Question(**defaults)


class RenderTests(unittest.TestCase):
    def test_row_carries_the_glyph_not_the_enum(self):
        out = render_milestones([milestone()])
        self.assertIn("| ✅ |", out)
        self.assertNotIn("done", out)

    def test_title_is_truncated_and_linked(self):
        long_title = "x" * 200
        out = render_milestones([milestone(title=long_title)])
        row = next(line for line in out.split("\n") if line.startswith("| F8 "))
        self.assertLess(len(row), 200)
        self.assertIn("[", row)
        self.assertIn("milestones/F8.md", row)

    def test_a_pipe_in_a_title_is_escaped(self):
        out = render_milestones([milestone(title="a | b")])
        self.assertIn("a \\| b", out)

    def test_escape_cell(self):
        self.assertEqual(escape_cell("a | b"), "a \\| b")

    def test_check_fails_on_a_hand_edited_index(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / "plan" / "milestones").mkdir(parents=True)
            (root / "plan" / "questions").mkdir(parents=True)
            (root / "plan" / "decisions").mkdir(parents=True)
            (root / "plan" / "milestones" / "F8.md").write_text(
                "---\nid: F8\ntrack: F\ntitle: t\nspec: [a]\ndepends: []\nstatus: done\n---\n\nbody\n",
                encoding="utf-8",
            )
            self.assertEqual(main(["--write", "--root", str(root)]), 0)
            self.assertEqual(main(["--check", "--root", str(root)]), 0)
            index = root / "plan" / "MILESTONES.md"
            index.write_text(index.read_text(encoding="utf-8") + "| tampered |\n", encoding="utf-8")
            self.assertEqual(main(["--check", "--root", str(root)]), 1)


class RenderQuestionsTests(unittest.TestCase):
    def test_open_group_precedes_resolved(self):
        out = render_questions(
            [question(id="SQ-1", status="resolved"), question(id="SQ-2", status="open")]
        )
        self.assertLess(out.index("## Open"), out.index("## Resolved"))
        self.assertLess(out.index("SQ-2"), out.index("SQ-1"))

    def test_title_is_truncated_and_linked(self):
        long_title = "x" * 200
        out = render_questions([question(title=long_title)])
        row = next(line for line in out.split("\n") if line.startswith("| SQ-616 "))
        self.assertLess(len(row), 200)
        self.assertIn("[", row)
        self.assertIn("questions/SQ-616.md", row)

    def test_a_pipe_in_a_title_is_escaped(self):
        out = render_questions([question(title="a | b")])
        self.assertIn("a \\| b", out)

    def test_batch_column_carries_the_batch_not_the_status(self):
        out = render_questions([question(batch="X")])
        row = next(line for line in out.split("\n") if line.startswith("| SQ-616 "))
        self.assertTrue(row.rstrip("|").rstrip().endswith("X"))

    def test_check_fails_on_a_hand_edited_index(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / "plan" / "milestones").mkdir(parents=True)
            (root / "plan" / "questions").mkdir(parents=True)
            (root / "plan" / "decisions").mkdir(parents=True)
            (root / "plan" / "milestones" / "F8.md").write_text(
                "---\nid: F8\ntrack: F\ntitle: t\nspec: [a]\ndepends: []\nstatus: done\n---\n\nbody\n",
                encoding="utf-8",
            )
            (root / "plan" / "questions" / "SQ-616.md").write_text(
                "---\nid: SQ-616\ntitle: t\nspec_ref: a\nraised: 2026-07-20\nstatus: open\nbatch: B7\n"
                "---\n\nbody\n",
                encoding="utf-8",
            )
            self.assertEqual(main(["--write", "--root", str(root)]), 0)
            self.assertEqual(main(["--check", "--root", str(root)]), 0)
            index = root / "plan" / "QUESTIONS.md"
            index.write_text(index.read_text(encoding="utf-8") + "| tampered |\n", encoding="utf-8")
            self.assertEqual(main(["--check", "--root", str(root)]), 1)


DECISION_SECTION = """## Decision log

| Date | Amendment | Authorized by | Docs touched |
|---|---|---|---|
| 2026-08-09 | **Track F compat verdict reaches the shell without a new contract bump.** The classifier probes exactly the frozen set. | user | 10 §5.2 |
"""

# A single 250-character, no-bold Amendment cell: exercises `render_decisions`'s
# link-target-and-anchor truncation without the whole cell landing in the row.
LONG_AMENDMENT = "x" * 250
DECISION_SECTION_LONG = f"""## Decision log

| Date | Amendment | Authorized by | Docs touched |
|---|---|---|---|
| 2026-08-10 | {LONG_AMENDMENT} | user | none |
"""


class RenderDecisionsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_only_decisions_get_an_index_row_per_record(self):
        migrate_day_records(
            DECISION_SECTION,
            "decisions",
            self.root,
            ["Date", "Amendment", "Authorized by", "Docs touched"],
        )
        text, errors = render_decisions(self.root)
        self.assertEqual(errors, [])
        self.assertIn("| 2026-08-09 |", text)
        self.assertIn("decisions/2026/08/2026-08-09.md#", text)
        self.assertIn("user", text)

    def test_the_link_label_stays_truncated_for_a_long_no_bold_amendment(self):
        """The label (visible text) is still bounded; only the anchor is
        full-length now (fix round 1, finding 1)."""
        migrate_day_records(
            DECISION_SECTION_LONG,
            "decisions",
            self.root,
            ["Date", "Amendment", "Authorized by", "Docs touched"],
        )
        text, errors = render_decisions(self.root)
        self.assertEqual(errors, [])
        row = next(line for line in text.split("\n") if line.startswith("| 2026-08-10 "))
        label = row.split("[", 1)[1].split("]", 1)[0]
        self.assertLess(len(label), 70)

    def test_anchor_matches_a_real_heading_in_the_target_file(self):
        """The core of finding 1: a full-heading anchor must resolve, even
        for a long no-bold-lead Amendment cell that a truncated-prefix
        anchor (the pre-fix behaviour) could never match."""
        migrate_day_records(
            DECISION_SECTION_LONG,
            "decisions",
            self.root,
            ["Date", "Amendment", "Authorized by", "Docs touched"],
        )
        text, errors = render_decisions(self.root)
        self.assertEqual(errors, [])
        row = next(line for line in text.split("\n") if line.startswith("| 2026-08-10 "))
        target = row.split("(", 1)[1].split(")", 1)[0]
        path_part, _, fragment = target.partition("#")
        day_file = (self.root / "plan" / path_part).read_text(encoding="utf-8")
        headings = [line[len("## ") :] for line in day_file.split("\n") if line.startswith("## ")]
        self.assertIn(fragment, [_anchor(h) for h in headings])

    def test_anchor_is_the_full_slug_of_the_heading_not_a_truncated_prefix(self):
        self.assertEqual(_anchor("Track F compat verdict"), "track-f-compat-verdict")
        long_heading = "x " * 200
        self.assertGreater(len(_anchor(long_heading)), 40)

    def test_repeated_headings_in_one_file_are_disambiguated_like_github(self):
        section = """## Decision log

| Date | Amendment | Authorized by | Docs touched |
|---|---|---|---|
| 2026-08-06 | **Same title.** First occurrence. | a | x |
| 2026-08-06 | **Same title.** Second occurrence. | b | y |
| 2026-08-06 | **Same title.** Third occurrence. | c | z |
"""
        migrate_day_records(
            section, "decisions", self.root, ["Date", "Amendment", "Authorized by", "Docs touched"]
        )
        text, errors = render_decisions(self.root)
        self.assertEqual(errors, [])
        anchors = [line.split("#", 1)[1].split(")", 1)[0] for line in text.split("\n") if "#same-title" in line]
        self.assertEqual(anchors, ["same-title", "same-title-1", "same-title-2"])

    def test_missing_decisions_directory_is_reported_as_an_error_not_a_crash(self):
        # No plan/decisions directory at all under this empty root.
        text, errors = render_decisions(self.root)
        self.assertEqual(text, "")
        self.assertTrue(errors)
