"""Gates for the spec-question batch-index checker.

Two of this checker's original invariants disappeared when the spec-question
table became `plan/questions/<ID>.md` item files (Task 6): an id cannot
collide because the id IS the filename, and a question cannot be named by two
batches because `batch:` is one scalar on one file.

The other four did NOT disappear — an earlier revision of the checker wrongly
deleted them along with the two that had, and a review round caught it before
this suite (which it was supposed to prove) ever ran green on the mistake.
`batch:` (per-item frontmatter) and PLAN.md's batch-index table (hand-
maintained prose) are now two independent artifacts that CAN drift, which is
exactly the incident class the original docstring named ("batch B1 was left
declaring rows that a later PR had already resolved"). These tests pin all
four surviving invariants and construct a violating fixture for each.
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
    """Invariant 1: a question's batch: value must name a declared batch."""

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


class TestOpenQuestionMustBeBatched(unittest.TestCase):
    """Invariant 2: an OPEN question must not carry batch: none."""

    def test_an_open_question_with_no_batch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            write_question(root, "SQ-7", status="open", batch="none")
            errors = checker.check(root)
            self.assertTrue(
                any("SQ-7" in e and "OPEN but assigned to no batch" in e for e in errors),
                errors,
            )

    def test_an_open_question_with_a_live_batch_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            write_question(root, "SQ-7", status="open", batch="X")
            errors = checker.check(root)
            # Row count for X now mismatches (3 items, index still says 2), which
            # is invariant 4's job, not this one — filter it out to isolate the
            # assertion this test is actually making.
            self.assertFalse(any("SQ-7" in e and "no batch" in e for e in errors), errors)


class TestResolvedQuestionMustNotStayBatched(unittest.TestCase):
    """Invariant 3: a RESOLVED question must carry batch: none.

    This is the B1 incident restated per-item: a question resolved without its
    batch: field (or the index) being updated to match.
    """

    def test_a_resolved_question_still_naming_a_live_batch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            write_question(root, "SQ-1", status="resolved", batch="B2", resolved="2026-02-01")
            errors = checker.check(root)
            self.assertTrue(
                any("SQ-1" in e and "RESOLVED but still named by batch" in e and "'B2'" in e for e in errors),
                errors,
            )

    def test_a_resolved_question_correctly_unbatched_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            errors = checker.check(root)  # SQ-2 is already resolved/none in the base fixture
            self.assertFalse(any("SQ-2" in e for e in errors), errors)


class TestRowCountMatchesTheItemTree(unittest.TestCase):
    """Invariant 4: a declared row count must equal the item tree's actual count."""

    def test_a_row_count_short_of_the_actual_items_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            # A third item joins X, but the index's Rows cell (2) is not updated.
            write_question(root, "SQ-9", status="open", batch="X")
            errors = checker.check(root)
            self.assertTrue(
                any("batch X declares 2 rows but 3 plan/questions/ item(s) name it" in e for e in errors),
                errors,
            )

    def test_a_row_count_exceeding_the_actual_items_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            # SQ-4 is removed from X (reassigned to B2) without the index's Rows
            # cell for X (still 2) being brought down to 1.
            write_question(root, "SQ-4", status="open", batch="B2")
            errors = checker.check(root)
            self.assertTrue(
                any("batch X declares 2 rows but 1 plan/questions/ item(s) name it" in e for e in errors),
                errors,
            )

    def test_a_matching_row_count_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = _fixture_root(raw)
            errors = checker.check(root)
            self.assertFalse(any("declares" in e and "rows but" in e for e in errors), errors)


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
