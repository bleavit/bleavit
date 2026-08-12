"""The renderer emits narrow rows and escapes what it writes.

A generated table cannot drift, which serves the 2026-07-17 standing instruction
more strongly than a checker does — but only if the renderer escapes the pipe
that severed rows before.
"""

import tempfile
import unittest
from pathlib import Path

from tools.plan.model import Milestone
from tools.plan.render import escape_cell, main, render_milestones


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
            (root / "plan" / "milestones" / "F8.md").write_text(
                "---\nid: F8\ntrack: F\ntitle: t\nspec: [a]\ndepends: []\nstatus: done\n---\n\nbody\n",
                encoding="utf-8",
            )
            self.assertEqual(main(["--write", "--root", str(root)]), 0)
            self.assertEqual(main(["--check", "--root", str(root)]), 0)
            index = root / "plan" / "MILESTONES.md"
            index.write_text(index.read_text(encoding="utf-8") + "| tampered |\n", encoding="utf-8")
            self.assertEqual(main(["--check", "--root", str(root)]), 1)
