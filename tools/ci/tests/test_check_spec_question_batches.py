"""Gates for the spec-question batch-index checker.

Most of this checker's original job disappeared when the spec-question table
became `plan/questions/<ID>.md` item files (Task 6): an id cannot collide
because the id IS the filename, and a question cannot be named by two batches
because `batch:` is one scalar on one file. What is left is the one thing that
IS still possible to get wrong: a `batch:` value naming a label PLAN.md's
batch-index table does not declare (a typo, or a retired label).
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-spec-question-batches.py"
SPEC = importlib.util.spec_from_file_location("check_spec_question_batches", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)

REPO_ROOT = Path(__file__).resolve().parents[3]

BATCH_INDEX = """## Spec questions

| Batch | Rows | Members |
|---|---:|---|
| **B1 · ratify 05 — lifecycle** | 0 | **closed.** All rows disposed; SQ-3 reclassified to X. |
| **B2 · ratify 06 — governance** | 1 | SQ-1 |
| **X · code — real implementation work** | 2 | SQ-3, SQ-4 |
"""


def write_question(
    root: Path,
    identifier: str,
    *,
    status: str,
    batch: str,
    spec_ref: str = "02 §7",
    raised: str = "2026-01-01",
    resolved: str | None = None,
) -> None:
    """Write a minimal `plan/questions/<identifier>.md` frontmatter fixture."""
    directory = root / "plan" / "questions"
    directory.mkdir(parents=True, exist_ok=True)
    lines = [
        "---",
        f"id: {identifier}",
        f"title: {identifier} title",
        f"spec_ref: {spec_ref}",
        f"raised: {raised}",
        f"status: {status}",
    ]
    if resolved:
        lines.append(f"resolved: {resolved}")
    lines += [
        f"batch: {batch}",
        "---",
        "",
        "## Question",
        "",
        f"{identifier} question body.",
        "",
        "## Status",
        "",
        status,
        "",
    ]
    (directory / f"{identifier}.md").write_text("\n".join(lines), encoding="utf-8")


def _fixture_root(raw: str) -> Path:
    root = Path(raw)
    (root / "PLAN.md").write_text(BATCH_INDEX, encoding="utf-8")
    write_question(root, "SQ-1", status="open", batch="B2")
    write_question(root, "SQ-2", status="resolved", batch="none", resolved="2026-02-01")
    write_question(root, "SQ-3", status="open", batch="X")
    write_question(root, "SQ-4", status="open", batch="X")
    return root


class TestDeclaredBatches(unittest.TestCase):
    def test_reads_the_index_labels_plus_the_unbatched_sentinel(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            self.assertEqual(checker.declared_batches(root), {"B1", "B2", "X", "none"})


class TestWellFormed(unittest.TestCase):
    def test_passes(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            self.assertEqual(checker.check(root), [])


class TestUndeclaredBatch(unittest.TestCase):
    def test_an_undeclared_batch_label_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            write_question(root, "SQ-5", status="open", batch="Q99")
            errors = checker.check(root)
            self.assertTrue(
                any("SQ-5" in e and "Q99" in e and "not a declared batch" in e for e in errors),
                errors,
            )

    def test_a_resolved_question_missing_the_unbatched_sentinel_is_rejected(self) -> None:
        # A resolved question whose batch: value is neither "none" nor a real
        # index label — the same shape of typo, on the resolved side.
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            write_question(root, "SQ-6", status="resolved", batch="B99", resolved="2026-02-01")
            errors = checker.check(root)
            self.assertTrue(any("SQ-6" in e and "B99" in e for e in errors), errors)


class TestLoadErrorsPropagate(unittest.TestCase):
    def test_a_broken_plan_questions_tree_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "PLAN.md").write_text(BATCH_INDEX, encoding="utf-8")
            # No plan/questions/ directory at all.
            errors = checker.check(root)
            self.assertTrue(errors, "a missing plan/questions/ tree must report an error, not silence")


class TestRepository(unittest.TestCase):
    def test_the_real_tree_is_consistent(self) -> None:
        self.assertEqual(checker.check(REPO_ROOT), [])


if __name__ == "__main__":
    unittest.main()
