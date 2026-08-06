"""Tests for the 10 §9 frontend-budget derivation gate.

Every case mutates one of the *sources* — doc 13's registry, doc 10's published cells,
or the runtime's pinned ceiling — and requires the gate to fail with a message that
names what broke. A gate that failed identically for every mutation would be no more
useful than one that never failed at all, and the defect this gate exists for (SQ-557)
survived precisely because a published number had nothing recomputing it.
"""

from __future__ import annotations

import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
CHECKER = ROOT / "tools" / "ci" / "check-frontend-budgets.py"
FRONTEND = ROOT / "docs" / "architecture" / "10-frontend-architecture.md"
PARAMS = ROOT / "docs" / "architecture" / "13-parameters.md"
POV_BUDGETS = ROOT / "runtime" / "bleavit-runtime" / "src" / "pov_budgets.rs"
SMOLDOT_GATE = ROOT / "app" / "tools" / "check-smoldot-budget.ts"


def run() -> subprocess.CompletedProcess[str]:
    return subprocess.run(["python3", str(CHECKER)], cwd=ROOT, capture_output=True, text=True)


class FrontendBudgets(unittest.TestCase):
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

    def test_the_documents_and_the_runtime_agree_as_shipped(self) -> None:
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("70 fills/block", result.stdout)
        self.assertIn("31 trading books", result.stdout)

    # --- the load model itself ------------------------------------------------------

    def test_a_book_count_that_is_not_the_formula_fails(self) -> None:
        """The original defect: §9.1 published a book count nothing derived."""
        self.assert_mutation_caught(
            FRONTEND,
            "trading books = epoch.slots·6 + 1 = 31",
            "trading books = epoch.slots·6 + 1 = 196",
            "§9.1 states 196 trading books",
        )

    def test_a_slate_row_whose_books_do_not_follow_from_13_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| 3 of 5 | 19 | ~16.9 k | ~2.0 MB |",
            "| 3 of 5 | 20 | ~16.9 k | ~2.0 MB |",
            "publishes 20 trading books",
        )

    def test_a_stale_row_rate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| **5 of 5 — max sustained** | **31** | **~27.6 k** | **~3.3 MB** |",
            "| **5 of 5 — max sustained** | **31** | **~17.8 k** | **~3.3 MB** |",
            "rows/day",
        )

    def test_changing_the_observation_interval_moves_every_cell(self) -> None:
        """13 §1 is the source; doc 10 must not survive a parameter change untouched."""
        self.assert_mutation_caught(
            PARAMS,
            "| `mkt.obs_interval` | u32 | blocks | 10 | 5 | 50 | 5 | 1 | PARAM |",
            "| `mkt.obs_interval` | u32 | blocks | 20 | 5 | 50 | 5 | 1 | PARAM |",
            "rows/day",
        )

    def test_a_wider_slate_than_the_vault_envelope_admits_fails(self) -> None:
        """31 is a *maximum* only because 13 §5 item 2 caps the slate at five slots."""
        self.assert_mutation_caught(
            PARAMS,
            "| `MaxLiveProposals` | **32** |",
            "| `MaxLiveProposals` | **28** |",
            "slate",
        )

    # --- the event stream, which §9.1 previously omitted ----------------------------

    def test_a_ceiling_that_disagrees_with_the_runtime_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "**70 fills per block**",
            "**36 fills per block**",
            "the runtime pins 70",
        )

    def test_moving_the_runtime_pin_moves_the_document(self) -> None:
        """The binding is three-way: the pin is not doc 10's to choose."""
        self.assert_mutation_caught(
            POV_BUDGETS,
            "const MAX_TRADED_EVENTS_PER_BLOCK: u64 = 70;",
            "const MAX_TRADED_EVENTS_PER_BLOCK: u64 = 64;",
            "the runtime pins 64",
        )

    def test_a_stale_traded_row_rate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "**1,008,000 `Traded` rows/day",
            "**1,036,800 `Traded` rows/day",
            "`Traded` rows/day",
        )

    def test_a_stale_event_share_exhaustion_figure_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "~**8.9 h** desktop",
            "~**17.4 h** desktop",
            "events share holds 17.4 h",
        )

    # --- retention shares and the bounds drawn from them ----------------------------

    def test_shares_that_do_not_sum_to_the_cap_fail(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "raw samples 60%, candles 20%, events+archive 15%, metadata 5%",
            "raw samples 60%, candles 20%, events+archive 15%, metadata 10%",
            "shares sum to",
        )

    def test_a_metadata_cap_above_its_own_share_fails(self) -> None:
        """The shipped defect: §9.3 bounded the cache above the share §9.2 allots it."""
        self.assert_mutation_caught(
            FRONTEND,
            "**≤ 8 blobs / ≤ 15 MB desktop, ≤ 3 blobs / ≤ 3.75 MB mobile**",
            "**≤ 8 blobs / ≤ 16 MB desktop, ≤ 3 blobs / ≤ 6 MB mobile**",
            "cannot bind",
        )

    def test_a_bundle_budget_below_what_the_cache_admits_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| Release-shipped fallback metadata (gz, lazy) | ≤ 1.5 MB",
            "| Release-shipped fallback metadata (gz, lazy) | ≤ 0.5 MB",
            "budgets 0.5 MB for release-shipped metadata",
        )

    def test_a_mib_reading_of_the_smoldot_budget_fails(self) -> None:
        """The gate held its own copy of §9.4's bound and read MB as MiB until 2026-08-06."""
        self.assert_mutation_caught(
            SMOLDOT_GATE,
            "const BUDGET_GZ_BYTES = 3.5e6;",
            "const BUDGET_GZ_BYTES = 3.5 * 1024 * 1024;",
            "grants ~5 % the document does not",
        )

    def test_a_stale_depth_cell_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| Desktop | ~240 days | **~54 days** |",
            "| Desktop | ~240 days | **~8.5 days** |",
            "cell publishes 8.5 days",
        )

    # --- anti-vacuity: a parse that finds nothing must fail, not pass ---------------

    def test_a_deleted_section_is_an_error_not_a_pass(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "## 9. Resource budgets",
            "## 9. Resource envelopes",
            "cannot locate",
        )

    def test_a_deleted_load_table_is_an_error_not_a_pass(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| Slate (`epoch.slots` occupied) | Trading books |",
            "| Slate (`epoch.slots` occupied) | Trading book counts |",
            "zero data rows",
        )


if __name__ == "__main__":
    unittest.main()
