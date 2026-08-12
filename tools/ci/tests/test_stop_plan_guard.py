"""The Stop guard must accept a plan/ edit as satisfying rule R-3.

After the split, a session records its work in plan/log/<date>.md rather than in
PLAN.md's Session log. A guard that watches PLAN.md alone would block every such
session, which is the opposite of what R-3 asks for.
"""

import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / ".claude" / "hooks" / "stop-plan-guard.sh"


def run_guard(repo: Path) -> str:
    result = subprocess.run(
        ["bash", str(GUARD)],
        input='{"stop_hook_active":false}',
        capture_output=True,
        text=True,
        cwd=repo,
        env={"PATH": "/usr/bin:/bin", "CLAUDE_PROJECT_DIR": str(repo)},
    )
    return result.stdout


class StopPlanGuardTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        (self.repo / "PLAN.md").write_text("# plan\n", encoding="utf-8")
        (self.repo / "src.txt").write_text("one\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True)
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
            cwd=self.repo,
            check=True,
        )

    def tearDown(self):
        self._tmp.cleanup()

    def test_blocks_when_nothing_in_the_plan_tree_moved(self):
        (self.repo / "src.txt").write_text("two\n", encoding="utf-8")
        self.assertIn('"block"', run_guard(self.repo))

    def test_accepts_a_plan_directory_edit(self):
        (self.repo / "src.txt").write_text("two\n", encoding="utf-8")
        (self.repo / "plan" / "log" / "2026" / "08").mkdir(parents=True)
        (self.repo / "plan" / "log" / "2026" / "08" / "2026-08-12.md").write_text(
            "# Session log — 2026-08-12\n", encoding="utf-8"
        )
        self.assertEqual(run_guard(self.repo).strip(), "")

    def test_accepts_a_plan_md_edit(self):
        (self.repo / "src.txt").write_text("two\n", encoding="utf-8")
        (self.repo / "PLAN.md").write_text("# plan\nchanged\n", encoding="utf-8")
        self.assertEqual(run_guard(self.repo).strip(), "")
