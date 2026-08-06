"""Tests for the design-kit verbatim-copy gate.

The gate exists because two files declared themselves byte-identical to a spec document,
AGENTS.md obliged a regeneration after every spec change, and nothing compared the bytes —
so one of them had been three lines stale since a `[VERIFY]` tag was resolved. Each case
below mutates a copy, its header, or the kit itself and requires a failure that names what
broke; the last two are the anti-vacuity cases, because a gate that quietly checks nothing
is the condition this one ends.
"""

from __future__ import annotations

import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
CHECKER = ROOT / "tools" / "ci" / "check-verbatim-copies.py"
KIT = ROOT / "docs" / "design" / "claude-design-kit"
COPY = KIT / "03-frontend-architecture-VERBATIM.md"
SOURCE = ROOT / "docs" / "architecture" / "10-frontend-architecture.md"


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(CHECKER), *args], cwd=ROOT, capture_output=True, text=True
    )


class VerbatimCopies(unittest.TestCase):
    def assert_mutation_caught(
        self, path: pathlib.Path, old: str, new: str, expect: str
    ) -> None:
        original = path.read_text(encoding="utf-8")
        self.assertIn(old, original, f"anchor missing: {old[:70]!r}")
        path.write_text(original.replace(old, new, 1), encoding="utf-8")
        try:
            result = run()
            output = result.stdout + result.stderr
            self.assertNotEqual(result.returncode, 0, f"mutation was not caught:\n{output}")
            self.assertIn(expect, output)
            self.assertNotIn("Traceback", output, "the gate crashed instead of explaining")
        finally:
            path.write_text(original, encoding="utf-8")

    def test_the_copies_are_verbatim_as_shipped(self) -> None:
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.count("byte-identical"), 2)

    def test_an_edited_copy_fails(self) -> None:
        self.assert_mutation_caught(
            COPY,
            "## 9. Resource budgets — recomputed honestly",
            "## 9. Resource budgets — recomputed honestly (edited in the copy)",
            "line",
        )

    def test_a_source_change_the_copy_did_not_pick_up_fails(self) -> None:
        """The live failure: the source moved and the derived copy did not."""
        self.assert_mutation_caught(
            SOURCE,
            "## 9. Resource budgets — recomputed honestly",
            "## 9. Resource budgets — recomputed honestly and re-derived",
            "has drifted from",
        )

    def test_a_truncated_copy_fails(self) -> None:
        # Whole lines, so this exercises the length branch rather than the first-differing-
        # line one: a mid-line cut is already reported as a content difference.
        original = COPY.read_text(encoding="utf-8")
        COPY.write_text("\n".join(original.split("\n")[:-6]), encoding="utf-8")
        try:
            result = run()
            output = result.stdout + result.stderr
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("extra line(s)", output)
            self.assertIn("the source has", output, "the message must say which side is longer")
        finally:
            COPY.write_text(original, encoding="utf-8")

    def test_write_restores_a_drifted_copy(self) -> None:
        original = COPY.read_text(encoding="utf-8")
        COPY.write_text(original.replace("## 9. Resource budgets", "## 9. Budgets", 1), encoding="utf-8")
        try:
            self.assertNotEqual(run().returncode, 0, "the drift was not detected")
            written = run("--write")
            self.assertEqual(written.returncode, 0, written.stdout + written.stderr)
            self.assertEqual(run().returncode, 0, "--write did not restore the copy")
            self.assertEqual(COPY.read_text(encoding="utf-8"), original, "--write changed the header")
        finally:
            COPY.write_text(original, encoding="utf-8")

    # --- anti-vacuity ---------------------------------------------------------------

    def test_a_copy_that_names_no_source_fails(self) -> None:
        self.assert_mutation_caught(
            COPY,
            "Verbatim copy of `docs/architecture/10-frontend-architecture.md`",
            "A copy of the frontend architecture document",
            "does not say what it is a copy of",
        )

    def test_a_copy_naming_a_missing_source_fails(self) -> None:
        self.assert_mutation_caught(
            COPY,
            "Verbatim copy of `docs/architecture/10-frontend-architecture.md`",
            "Verbatim copy of `docs/architecture/10-frontend-architecture-moved.md`",
            "which does not exist",
        )

    def test_a_copy_with_no_heading_fails(self) -> None:
        self.assert_mutation_caught(
            COPY,
            "\n# 10 — Frontend Architecture",
            "\n## 10 — Frontend Architecture",
            "no level-1 heading",
        )


if __name__ == "__main__":
    unittest.main()
