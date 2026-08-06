"""Tests for the 11 §11.5 execute reason-code binding.

Every case mutates a real file and requires the gate to fail with a message naming what
broke. The first case is the one that matters: it restores the exact defect the gate was
written for — a client code the runtime has never returned — and that mutation **compiles**
under `tsc`, because a union member and its use sites move together. A gate proved only
against mutations the type checker already catches has proved nothing.
"""

from __future__ import annotations

import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
CHECKER = ROOT / "tools" / "ci" / "check-execute-error-codes.py"
CLIENT = ROOT / "app" / "src" / "features" / "tx" / "src" / "execution-queue.ts"
PALLET = ROOT / "pallets" / "execution-guard" / "src" / "lib.rs"
DOC_11 = ROOT / "docs" / "architecture" / "11-frontend-workflows.md"


def run() -> subprocess.CompletedProcess[str]:
    return subprocess.run(["python3", str(CHECKER)], cwd=ROOT, capture_output=True, text=True)


class ExecuteErrorCodes(unittest.TestCase):
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

    def test_the_client_and_the_pallet_agree_as_shipped(self) -> None:
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("client code(s) all declared", result.stdout)

    def test_a_code_the_runtime_never_returns_is_caught(self) -> None:
        """The live defect, restored: `MetersBlocked` shown to the user as `MeterExceeded`.

        Renaming the union member and its one use site together compiles cleanly, which is
        why this gate is not redundant with the type checker.
        """
        self.assert_mutation_caught(
            CLIENT,
            "  | 'MetersBlocked'",
            "  | 'MeterExceeded'",
            "the client reports ['MeterExceeded']",
        )

    def test_a_second_invented_code_is_caught(self) -> None:
        self.assert_mutation_caught(
            CLIENT, "  | 'StaleQueue'", "  | 'VersionMismatch'", "['VersionMismatch']"
        )

    def test_dropping_the_union_is_not_a_pass(self) -> None:
        self.assert_mutation_caught(
            CLIENT,
            "export type ExecuteErrorCode =",
            "export type ExecuteErrorCodeRenamed =",
            "cannot find `export type ExecuteErrorCode`",
        )

    def test_a_broken_pallet_parse_fails_rather_than_passing(self) -> None:
        self.assert_mutation_caught(
            PALLET, "#[pallet::error]", "#[pallet::error_moved]", "cannot find `#[pallet::error]`"
        )

    def test_losing_the_doc_obligation_is_reported(self) -> None:
        self.assert_mutation_caught(
            DOC_11,
            "blocks with the same reason code the runtime would return",
            "blocks with an explanation",
            "no longer states",
        )


if __name__ == "__main__":
    unittest.main()
