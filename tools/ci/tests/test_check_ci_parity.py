"""Gates for the CI-parity checker.

The checker exists because batch X wave 1 shipped a red CI job that every local
gate run reported green: `check-weight-regression.py` defaults its comparison
base to `git merge-base HEAD origin/main`, the developer worktree had that ref
fetched, and the Rust CI job's bare `actions/checkout@v7` did not.

These tests pin the two properties that make the checker trustworthy:

  1. It classifies a command that passes locally and fails in a CI-shaped
     checkout as DIVERGED.
  2. Its `GUARDED` suppressions **expire on their own**. The first draft of this
     checker keyed suppressions on (script, checker) alone and blindly trusted
     them — deleting the guard left the suppression firing, so the checker
     reported PASS on exactly the state it was built to catch. A suppression that
     outlives its guard rebuilds the false confidence the tool exists to prevent,
     so `resolve_guard` re-reads the script and the entry lapses when the guard
     pattern is gone.
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check-ci-parity.py"
SPEC = importlib.util.spec_from_file_location("check_ci_parity", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)

ROOT = Path(__file__).resolve().parents[3]


class DiscoveryTests(unittest.TestCase):
    def test_extracts_embedded_python_invocations_from_gate_scripts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools" / "ci").mkdir(parents=True)
            (root / "tools" / "ci" / "rust-workspace-gates.sh").write_text(
                "#!/usr/bin/env bash\n"
                "cargo test --workspace --locked\n"
                "python3 tools/ci/check-weight-regression.py\n"
            )
            gates = checker.discover_embedded(root)
        commands = [g.command for g in gates]
        self.assertIn(("python3", "tools/ci/check-weight-regression.py"), commands)

    def test_carries_flags_on_the_invocation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools" / "ci").mkdir(parents=True)
            (root / "tools" / "ci" / "fuzz-gates.sh").write_text(
                "python3 tools/reference-model/generate-vectors.py --check\n"
            )
            gates = checker.discover_embedded(root)
        self.assertEqual(
            gates[0].command,
            ("python3", "tools/reference-model/generate-vectors.py", "--check"),
        )

    def test_cargo_lines_are_not_collected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools" / "ci").mkdir(parents=True)
            (root / "tools" / "ci" / "rust-workspace-gates.sh").write_text(
                "cargo clippy --workspace --all-targets --locked -- -D warnings\n"
            )
            self.assertEqual(checker.discover_embedded(root), [])


class GuardExpiryTests(unittest.TestCase):
    """The property whose absence made the first draft unsound."""

    ORIGIN = "tools/ci/rust-workspace-gates.sh"
    CHECKER = "tools/ci/check-weight-regression.py"

    def _root_with_script(self, body: str) -> Path:
        tmp = tempfile.mkdtemp()
        root = Path(tmp)
        (root / "tools" / "ci").mkdir(parents=True)
        (root / self.ORIGIN).write_text(body)
        return root

    def test_suppression_applies_while_the_guard_is_present(self) -> None:
        root = self._root_with_script(
            "if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then\n"
            "  python3 tools/ci/check-weight-regression.py\n"
            "fi\n"
        )
        self.assertIsNotNone(checker.resolve_guard(root, self.ORIGIN, self.CHECKER))

    def test_suppression_lapses_when_the_guard_is_deleted(self) -> None:
        root = self._root_with_script("python3 tools/ci/check-weight-regression.py\n")
        self.assertIsNone(checker.resolve_guard(root, self.ORIGIN, self.CHECKER))

    def test_suppression_does_not_transfer_to_another_script(self) -> None:
        """A new, unguarded call site elsewhere must still be caught."""
        root = self._root_with_script("guarded: rev-parse --verify --quiet origin/main\n")
        self.assertIsNone(
            checker.resolve_guard(root, "tools/ci/property-gates.sh", self.CHECKER)
        )

    def test_committed_tree_has_no_stale_suppressions(self) -> None:
        """Every GUARDED entry in the real repo still points at a live guard.

        This is the fast counterpart to the full parity run: if someone removes a
        guard, the unit suite goes red immediately rather than waiting for a
        developer to run the slower clone-based check.
        """
        for (origin, target) in checker.GUARDED:
            with self.subTest(origin=origin, target=target):
                self.assertIsNotNone(
                    checker.resolve_guard(ROOT, origin, target),
                    f"GUARDED entry for {target} in {origin} no longer matches a guard "
                    f"in that script — the suppression is stale and must be removed or "
                    f"the guard restored.",
                )


class ClassificationTests(unittest.TestCase):
    def _result(self, tree_ok: bool, clone_ok: bool, guard: str | None) -> object:
        gate = checker.Gate(("python3", "tools/x.py"), "tools/ci/g.sh", guard)
        return checker.Result(gate, tree_ok, clone_ok, "")

    def test_passes_locally_fails_in_clone_is_diverged(self) -> None:
        result = self._result(True, False, None)
        self.assertTrue(result.diverged)
        self.assertFalse(result.guarded)

    def test_same_case_is_guarded_when_a_live_guard_is_recorded(self) -> None:
        result = self._result(True, False, "guarded because ...")
        self.assertFalse(result.diverged)
        self.assertTrue(result.guarded)

    def test_failing_in_both_is_not_a_parity_defect(self) -> None:
        result = self._result(False, False, None)
        self.assertFalse(result.diverged)
        self.assertTrue(result.failed_both)

    def test_passing_in_both_is_clean(self) -> None:
        result = self._result(True, True, None)
        self.assertFalse(result.diverged)
        self.assertFalse(result.guarded)
        self.assertFalse(result.failed_both)


class SkipTests(unittest.TestCase):
    def test_skipped_checkers_are_excluded_with_a_recorded_reason(self) -> None:
        for target, reason in checker.SKIP.items():
            with self.subTest(target=target):
                self.assertTrue(reason.strip(), f"{target} is skipped with no reason")

    def test_skip_removes_the_command_from_the_gate_set(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools" / "ci").mkdir(parents=True)
            skipped = next(iter(checker.SKIP))
            (root / "tools" / "ci" / "supply-chain-gates.sh").write_text(
                f"python3 {skipped}\n"
            )
            gates = checker.gate_commands(root)
        self.assertNotIn(skipped, [g.checker for g in gates])


class DedupTests(unittest.TestCase):
    def test_script_origin_wins_over_the_standalone_listing(self) -> None:
        """Otherwise a guarded command would also be run bare and misreported."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools" / "ci").mkdir(parents=True)
            (root / "tools" / "ci" / "rust-workspace-gates.sh").write_text(
                "python3 tools/ci/check-doc-links.py\n"
            )
            gates = checker.gate_commands(root)
        matching = [g for g in gates if g.checker == "tools/ci/check-doc-links.py"]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0].origin, "tools/ci/rust-workspace-gates.sh")

    def test_a_guarded_site_does_not_suppress_an_unguarded_one(self) -> None:
        """A guarded call site must not swallow an unguarded one elsewhere.

        The first draft keyed the dedup on the command alone. Because
        `rust-workspace-gates.sh` is scanned first and carries the *guarded*
        `check-weight-regression.py`, an unguarded copy added later to another
        gate script was discarded before `resolve_guard` was ever consulted — so
        the run reported the guarded call site as handled and passed, while the
        genuinely unguarded one would still fail in CI's checkout. That is the
        exact false negative this checker exists to prevent, rebuilt one level up.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools" / "ci").mkdir(parents=True)
            (root / "tools" / "ci" / "rust-workspace-gates.sh").write_text(
                "if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then\n"
                "  python3 tools/ci/check-weight-regression.py\n"
                "fi\n"
            )
            (root / "tools" / "ci" / "property-gates.sh").write_text(
                "python3 tools/ci/check-weight-regression.py\n"
            )
            gates = checker.gate_commands(root)

        matching = [
            g for g in gates if g.checker == "tools/ci/check-weight-regression.py"
        ]
        self.assertEqual(
            len(matching),
            2,
            "the unguarded call site was dropped by the dedup and will never be "
            "evaluated — a new unguarded invocation must still fail the run",
        )
        by_origin = {g.origin: g.guard_reason for g in matching}
        self.assertIsNotNone(by_origin["tools/ci/rust-workspace-gates.sh"])
        self.assertIsNone(by_origin["tools/ci/property-gates.sh"])

    def test_equivalent_duplicates_still_collapse_in_the_real_tree(self) -> None:
        """The dedup must keep earning its place.

        Three standalone gates are also embedded in `rust-workspace-gates.sh`;
        widening the key must not start running them twice.
        """
        gates = checker.gate_commands(ROOT)
        keys = [(g.command, g.guard_reason) for g in gates]
        self.assertEqual(len(keys), len(set(keys)), "duplicate gate entries")
        for target in (
            "tools/limit-coverage/check-limit-coverage.py",
            "tools/reference-model/check-doc-table.py",
            "tools/reference-model/generate-vectors.py",
        ):
            with self.subTest(target=target):
                matching = [g for g in gates if g.checker == target]
                self.assertEqual(len(matching), 1)
                self.assertEqual(matching[0].origin, "tools/ci/rust-workspace-gates.sh")


if __name__ == "__main__":
    unittest.main()
