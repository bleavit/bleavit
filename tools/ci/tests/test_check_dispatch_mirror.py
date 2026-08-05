"""Tests for the 15 §4.8 dispatch-check mirror.

The checker's own anti-vacuity: each case mutates the *documents* and requires the gate
to fail with a message that names what broke. A gate that failed for every mutation with
the same opaque error would be no more useful than one that never failed.
"""

from __future__ import annotations

import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
CHECKER = ROOT / "tools" / "ci" / "check-dispatch-mirror.py"
FRONTEND = ROOT / "docs" / "architecture" / "11-frontend-workflows.md"
BACKEND = ROOT / "docs" / "architecture" / "09-execution-upgrades-and-rollout.md"


def run() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(CHECKER)], cwd=ROOT, capture_output=True, text=True
    )


class DispatchMirror(unittest.TestCase):
    def assert_mutation_caught(
        self, path: pathlib.Path, old: str, new: str, expect: str
    ) -> None:
        original = path.read_text(encoding="utf-8")
        self.assertIn(old, original, f"anchor missing: {old[:60]!r}")
        path.write_text(original.replace(old, new, 1), encoding="utf-8")
        try:
            result = run()
            output = result.stdout + result.stderr
            self.assertNotEqual(result.returncode, 0, f"mutation was not caught:\n{output}")
            self.assertIn(expect, output)
            self.assertNotIn("Traceback", output, "the gate crashed instead of explaining")
        finally:
            path.write_text(original, encoding="utf-8")

    def test_the_documents_agree_as_shipped(self) -> None:
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("backend check(s)", result.stdout)

    def test_a_frontend_row_with_no_backend_check_is_caught(self) -> None:
        """The live defect: FE row 14 required a clock that `execute` itself starts."""
        self.assert_mutation_caught(
            FRONTEND,
            "The FE renders each of the 14 checks",
            "| 15. **Descriptor lead time** | `now ≥ authorized_at + DescriptorLeadTime` |\n\n"
            "The FE renders each of the 14 checks",
            "frontend row(s) [15]",
        )

    def test_a_backend_check_the_frontend_stops_reading_is_caught(self) -> None:
        self.assert_mutation_caught(
            FRONTEND, "BE 2–9, 11 ↔ FE 3–10, 14", "BE 2–8, 11 ↔ FE 3–9, 14", "backend check(s) [9]"
        )

    def test_mapping_an_effect_item_is_caught(self) -> None:
        """Items 12–13 are dispatch and record; there is nothing to pre-check about them."""
        self.assert_mutation_caught(
            FRONTEND, "**BE 10 ↔ FE 11–13**", "**BE 10, 12 ↔ FE 11–13**", "which are effects"
        )

    def test_a_deleted_mapping_fails_with_an_explanation_not_a_traceback(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "**The mapping, stated so the diff is checkable",
            "**The mapping, once stated but no longer,",
            "cannot locate",
        )

    def test_moving_the_check_effect_boundary_is_caught(self) -> None:
        self.assert_mutation_caught(
            BACKEND,
            "**Items 1–11 are the checks; items 12–13 are the effects",
            "**Items 1–10 are the checks; items 11–13 are the effects",
            "which are effects",
        )

    def test_a_reordered_frontend_table_is_caught(self) -> None:
        """Contiguity matters: the mapping addresses rows by number."""
        self.assert_mutation_caught(
            FRONTEND, "| 14. Batch bounds |", "| 16. Batch bounds |", "not a contiguous"
        )


if __name__ == "__main__":
    unittest.main()
