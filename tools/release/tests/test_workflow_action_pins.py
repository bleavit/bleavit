from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CHECKER_PATH = ROOT / "tools/release/check-workflow-action-pins.py"


def load_checker():
    spec = importlib.util.spec_from_file_location("check_workflow_action_pins", CHECKER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHECKER = load_checker()
SHA = "1" * 40


class WorkflowActionPinTests(unittest.TestCase):
    def test_repository_workflows_are_immutable_and_version_commented(self) -> None:
        self.assertEqual(CHECKER.check_directory(ROOT / ".github/workflows"), [])

    def test_mutable_ref_is_rejected_even_with_a_version_comment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ci.yml"
            path.write_text(
                "steps:\n  - uses: actions/checkout@v7 # v7.0.1\n",
                encoding="utf-8",
            )
            failures = CHECKER.check_workflow(path)
            self.assertTrue(any("mutable/non-full ref" in value for value in failures))

    def test_unreviewed_sha_without_version_comment_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ci.yml"
            path.write_text(
                f"steps:\n  - uses: actions/checkout@{SHA}\n",
                encoding="utf-8",
            )
            failures = CHECKER.check_workflow(path)
            self.assertTrue(any("exact version comment" in value for value in failures))

    def test_full_sha_with_exact_version_and_local_action_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ci.yaml"
            path.write_text(
                f"steps:\n  - uses: actions/checkout@{SHA} # v7.0.1\n"
                "  - uses: ./actions/local\n",
                encoding="utf-8",
            )
            self.assertEqual(CHECKER.check_workflow(path), [])

    def test_exact_rust_release_and_nightly_labels_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ci.yml"
            path.write_text(
                f"steps:\n  - uses: dtolnay/rust-toolchain@{SHA} # 1.89.0\n"
                f"  - uses: dtolnay/rust-toolchain@{SHA} # nightly-2025-11-24\n",
                encoding="utf-8",
            )
            self.assertEqual(CHECKER.check_workflow(path), [])

    def test_free_form_review_comment_is_not_a_version_label(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ci.yml"
            path.write_text(
                f"steps:\n  - uses: actions/checkout@{SHA} # current stable\n",
                encoding="utf-8",
            )
            failures = CHECKER.check_workflow(path)
            self.assertTrue(any("exact version comment" in value for value in failures))

    def test_inline_mapping_cannot_hide_a_mutable_ref(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ci.yml"
            path.write_text(
                "steps:\n  - { uses: actions/checkout@v7 }\n",
                encoding="utf-8",
            )
            failures = CHECKER.check_workflow(path)
            self.assertTrue(failures)

    def test_yaml_alias_cannot_hide_a_mutable_ref(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ci.yml"
            path.write_text(
                "mutable: &mutable actions/checkout@v7\nsteps:\n  - uses: *mutable\n",
                encoding="utf-8",
            )
            failures = CHECKER.check_workflow(path)
            self.assertTrue(failures)

    def test_empty_workflow_directory_is_not_green(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            failures = CHECKER.check_directory(Path(directory))
            self.assertTrue(any("vacuous" in value for value in failures))


if __name__ == "__main__":
    unittest.main()
