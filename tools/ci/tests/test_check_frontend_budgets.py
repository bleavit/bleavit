"""Tests for the 10 §9 frontend-budget derivation gate.

Every case mutates one of the *sources* — doc 13's registry, doc 10's published cells,
or the runtime's pinned ceiling — and requires the gate to fail with a message that
names what broke. A gate that failed identically for every mutation would be no more
useful than one that never failed at all, and the defect this gate exists for (SQ-557)
survived precisely because a published number had nothing recomputing it.

The hosted-partition cases exist because the *repair* for SQ-557 reintroduced the same
shape one layer down: it counted the primary partition correctly and counted the hosted
one not at all. Those mutations are the ones that would have caught it.
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
PRIMITIVES = ROOT / "crates" / "futarchy-primitives" / "src" / "lib.rs"
BUNDLE_GATE = ROOT / "app" / "tools" / "check-bundle-budget.ts"
ARTIFACT_GATE = ROOT / "app" / "tools" / "check-artifact-budget.ts"
RENDER_GATE = ROOT / "app" / "tools" / "render-budget" / "check.ts"
QUOTA_MANAGER = ROOT / "app" / "packages" / "local-index" / "src" / "quota.ts"
QUOTA_CALLER = ROOT / "app" / "src" / "features" / "analysis" / "src" / "index-quota.ts"


def run() -> subprocess.CompletedProcess[str]:
    return subprocess.run(["python3", str(CHECKER)], cwd=ROOT, capture_output=True, text=True)


class FrontendBudgets(unittest.TestCase):
    def assert_mutations_caught(
        self, path: pathlib.Path, edits: list[tuple[str, str]], expect: str
    ) -> None:
        original = path.read_text(encoding="utf-8")
        mutated = original
        for old, new in edits:
            self.assertIn(old, mutated, f"anchor missing: {old[:70]!r}")
            mutated = mutated.replace(old, new, 1)
        path.write_text(mutated, encoding="utf-8")
        try:
            result = run()
            output = result.stdout + result.stderr
            self.assertNotEqual(result.returncode, 0, f"mutation was not caught:\n{output}")
            self.assertIn(expect, output)
            self.assertNotIn("Traceback", output, "the gate crashed instead of explaining")
        finally:
            path.write_text(original, encoding="utf-8")

    def assert_mutation_caught(
        self, path: pathlib.Path, old: str, new: str, expect: str
    ) -> None:
        self.assert_mutations_caught(path, [(old, new)], expect)

    def test_the_documents_and_the_runtime_agree_as_shipped(self) -> None:
        result = run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("93 fills/block = 70 primary + 23 external", result.stdout)
        self.assertIn("159 trading books = 31 primary + 128 hosted", result.stdout)

    # --- the load model itself ------------------------------------------------------

    def test_a_book_count_that_is_not_the_formula_fails(self) -> None:
        """The original defect: §9.1 published a book count nothing derived."""
        self.assert_mutation_caught(
            FRONTEND,
            "primary trading books = epoch.slots·6 + 1 = 31",
            "primary trading books = epoch.slots·6 + 1 = 196",
            "§9.1 states 196 trading books",
        )

    def test_a_slate_row_whose_books_do_not_follow_from_13_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| Primary, 3 of 5 slots | 19 | ~16.9 k | ~2.0 MB |",
            "| Primary, 3 of 5 slots | 20 | ~16.9 k | ~2.0 MB |",
            "publishes 20 trading books",
        )

    def test_a_stale_row_rate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| Primary, 5 of 5 slots — max | 31 | ~27.6 k | ~3.3 MB |",
            "| Primary, 5 of 5 slots — max | 31 | ~17.8 k | ~3.3 MB |",
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

    # --- the hosted partition, which the SQ-557 repair omitted -----------------------

    def test_a_hosted_row_whose_books_do_not_follow_from_svc_max_live_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| + hosted at `svc.max_live` = 16 (provisional) | 63 |",
            "| + hosted at `svc.max_live` = 16 (provisional) | 71 |",
            "publishes 71 trading books",
        )

    def test_dropping_the_registry_maximum_population_fails(self) -> None:
        """The client is budgeted against what governance can reach, not today's value."""
        self.assert_mutation_caught(
            FRONTEND,
            "| **+ hosted at `svc.max_live` = 64 (registry max)** | **159** | **~212.0 k** | **~25.4 MB** |\n",
            "",
            "hosted row(s)",
        )

    def test_hosted_books_counted_at_the_primary_duty_cycle_fail(self) -> None:
        """A hosted book trades while its question is Open, so its duty is 1, not 13/21."""
        self.assert_mutation_caught(
            FRONTEND,
            "| **+ hosted at `svc.max_live` = 64 (registry max)** | **159** | **~212.0 k** | **~25.4 MB** |",
            "| **+ hosted at `svc.max_live` = 64 (registry max)** | **159** | **~141.7 k** | **~25.4 MB** |",
            "rows/day",
        )

    def test_a_book_ceiling_disagreeing_with_svc_max_live_fails(self) -> None:
        """13 §4 states `MaxLiveExternalMarkets` as `2·64`; the pair cannot drift apart."""
        self.assert_mutation_caught(
            PARAMS,
            "not to appetite | 1 | 64 | ×2 | 2 | PARAM |",
            "not to appetite | 1 | 32 | ×2 | 2 | PARAM |",
            "cannot disagree",
        )

    def test_a_hosted_window_shorter_than_an_epoch_fails(self) -> None:
        """§9.1's duty-of-1 argument rests on the window reaching a full epoch."""
        self.assert_mutation_caught(
            PARAMS,
            "| `svc.max_window` | u32 | blocks | 302,400 (= `epoch.length`) |",
            "| `svc.max_window` | u32 | blocks | 151,200 (= `epoch.length`) |",
            "duty-cycle argument does not survive",
        )

    def test_a_depth_table_that_drops_the_hosted_columns_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| Primary max (31 books) | + hosted, provisional (63 books) | + hosted, registry max (159 books) |\n|---|---|---|---|---|\n| Desktop | ~240 days | ~54 days | ~20 days | **~7.1 days** |",
            "| Primary max (31 books) |\n|---|---|\n| Desktop | ~240 days | ~54 days |",
            "Four are required",
        )

    # --- the event stream, which §9.1 previously omitted ----------------------------

    def test_a_ceiling_that_disagrees_with_the_runtime_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "**93 fills per block**",
            "**36 fills per block**",
            "the runtime pins 93",
        )

    def test_a_ceiling_counting_only_the_primary_partition_fails(self) -> None:
        """Exactly the defect Codex found: 70 is the primary reservation, not the block."""
        self.assert_mutations_caught(
            FRONTEND,
            [
                ("**93 fills per block**", "**70 fills per block**"),
                ("**70 primary + 23 external = 93**", "**70 primary + 0 external = 70**"),
            ],
            "the runtime pins 93",
        )

    def test_a_split_that_disagrees_with_the_runtime_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "**70 primary + 23 external = 93**",
            "**47 primary + 46 external = 93**",
            "the runtime pins 70 + 23 = 93",
        )

    def test_runtime_partition_pins_that_do_not_sum_fail(self) -> None:
        self.assert_mutation_caught(
            POV_BUDGETS,
            "const MAX_TRADED_EVENTS_PER_BLOCK_EXTERNAL: u64 = 23;",
            "const MAX_TRADED_EVENTS_PER_BLOCK_EXTERNAL: u64 = 20;",
            "do not sum to its block pin",
        )

    def test_moving_the_runtime_pin_moves_the_document(self) -> None:
        """The binding is three-way: the pin is not doc 10's to choose."""
        self.assert_mutations_caught(
            POV_BUDGETS,
            [
                ("const MAX_TRADED_EVENTS_PER_BLOCK: u64 = 93;", "const MAX_TRADED_EVENTS_PER_BLOCK: u64 = 87;"),
                (
                    "const MAX_TRADED_EVENTS_PER_BLOCK_PRIMARY: u64 = 70;",
                    "const MAX_TRADED_EVENTS_PER_BLOCK_PRIMARY: u64 = 64;",
                ),
            ],
            "the runtime pins 87",
        )

    def test_a_stale_traded_row_rate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "**1,339,200 `Traded` rows/day",
            "**1,036,800 `Traded` rows/day",
            "`Traded` rows/day",
        )

    def test_a_stale_event_share_exhaustion_figure_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "~**6.7 h** desktop",
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
            "| Release-shipped historical metadata (gz, lazy) | ≤ 1.5 MB",
            "| Release-shipped historical metadata (gz, lazy) | ≤ 0.5 MB",
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

    def test_a_bundle_gate_enforcing_a_different_target_fails(self) -> None:
        """§9.4 states two thresholds; both are bound, so neither can rot into decoration."""
        self.assert_mutation_caught(
            BUNDLE_GATE,
            "const TARGET_GZ_BYTES = 350_000;",
            "const TARGET_GZ_BYTES = 500_000;",
            "initial-JS target is 350 KB",
        )

    def test_a_bundle_gate_enforcing_a_different_hard_fail_fails(self) -> None:
        self.assert_mutation_caught(
            BUNDLE_GATE,
            "const HARD_FAIL_GZ_BYTES = 450_000;",
            "const HARD_FAIL_GZ_BYTES = 450 * 1024;",
            "initial-JS hard fail is 450 KB",
        )

    def test_a_stale_depth_cell_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| Desktop | ~240 days | ~54 days | ~20 days | **~7.1 days** |",
            "| Desktop | ~240 days | ~54 days | ~20 days | **~8.5 days** |",
            "cell publishes 8.5 days",
        )

    def test_a_day_label_disagreeing_with_the_kernel_fails(self) -> None:
        """Blocks/day is the one input taken from a label; the kernel pins the same figure."""
        self.assert_mutation_caught(
            PARAMS,
            "| `epoch.length` | u32 | blocks | 302,400 (21 d) |",
            "| `epoch.length` | u32 | blocks | 302,400 (14 d) |",
            "kernel pins BLOCKS_PER_DAY",
        )

    def test_moving_the_kernel_constant_fails_too(self) -> None:
        self.assert_mutation_caught(
            PRIMITIVES,
            "pub const BLOCKS_PER_DAY: u32 = 14_400;",
            "pub const BLOCKS_PER_DAY: u32 = 7_200;",
            "kernel pins BLOCKS_PER_DAY = 7200",
        )

    # --- §9.4's lazy-artifact rows and their gate (F14) ------------------------------

    def test_an_artifact_gate_enforcing_a_different_chain_spec_budget_fails(self) -> None:
        self.assert_mutation_caught(
            ARTIFACT_GATE,
            "const CHAIN_SPEC_BUDGET_GZ_BYTES = 3.5e6;",
            "const CHAIN_SPEC_BUDGET_GZ_BYTES = 3.5 * 1024 * 1024;",
            "publishes chain specs as 3.5e+06",
        )

    def test_an_artifact_gate_enforcing_a_different_metadata_budget_fails(self) -> None:
        self.assert_mutation_caught(
            ARTIFACT_GATE,
            "const METADATA_BUDGET_GZ_BYTES = 1.5e6;",
            "const METADATA_BUDGET_GZ_BYTES = 2.0e6;",
            "publishes release-shipped metadata as 1.5e+06",
        )

    def test_an_artifact_gate_admitting_more_blobs_than_the_cache_fails(self) -> None:
        """§9.4 states it outright: the release cannot ship more blobs than the cache admits."""
        self.assert_mutation_caught(
            ARTIFACT_GATE,
            "const METADATA_BLOB_COUNT_BOUND = 8;",
            "const METADATA_BLOB_COUNT_BOUND = 16;",
            "publishes metadata blob count as 8",
        )

    def test_a_drifted_measured_blob_size_fails(self) -> None:
        """§9.3's blob figure is *measured*, and §9.4's metadata row is derived from it."""
        self.assert_mutation_caught(
            ARTIFACT_GATE,
            "const MEASURED_BLOB_GZ_MB = 0.15;",
            "const MEASURED_BLOB_GZ_MB = 0.14;",
            "publishes measured blob size as 0.15",
        )

    def test_a_drifted_raw_blob_size_fails(self) -> None:
        # 470_546 -> 472_998 at contract v29: `bond_quote` and `treasury_streams` and their
        # view types enter the metadata, so the committed blob is larger. The anchor moves
        # with the measurement by design — this test proves the gate notices a drift, and a
        # stale anchor would make it silently unable to apply its own mutation.
        self.assert_mutation_caught(
            ARTIFACT_GATE,
            "const MEASURED_BLOB_RAW_BYTES = 472_998;",
            "const MEASURED_BLOB_RAW_BYTES = 500_000;",
            "publishes measured blob raw size as 472998",
        )

    def test_moving_the_published_metadata_cell_without_the_gate_fails(self) -> None:
        """The binding is symmetric: the document may not drift away from the gate either."""
        self.assert_mutation_caught(
            FRONTEND,
            "| Release-shipped historical metadata (gz, lazy) | ≤ 1.5 MB combined",
            "| Release-shipped historical metadata (gz, lazy) | ≤ 2.5 MB combined",
            "enforces 1.5e+06",
        )

    # --- §9.4's first-meaningful-render row and the Lighthouse gate (F14) ------------

    def test_a_render_gate_enforcing_a_different_desktop_target_fails(self) -> None:
        self.assert_mutation_caught(
            RENDER_GATE,
            "const DESKTOP_TARGET_MS = 1_500;",
            "const DESKTOP_TARGET_MS = 2_500;",
            "first-meaningful-render desktop p50 is 1.5 s",
        )

    def test_a_render_gate_enforcing_a_different_desktop_hard_fail_fails(self) -> None:
        self.assert_mutation_caught(
            RENDER_GATE,
            "const DESKTOP_HARD_FAIL_MS = 3_000;",
            "const DESKTOP_HARD_FAIL_MS = 30_000;",
            "first-meaningful-render desktop p95 is 3 s",
        )

    def test_a_render_gate_enforcing_a_different_mobile_target_fails(self) -> None:
        self.assert_mutation_caught(
            RENDER_GATE,
            "const MOBILE_TARGET_MS = 3_000;",
            "const MOBILE_TARGET_MS = 4_000;",
            "first-meaningful-render mobile p50 is 3 s",
        )

    def test_a_render_gate_enforcing_a_different_mobile_hard_fail_fails(self) -> None:
        self.assert_mutation_caught(
            RENDER_GATE,
            "const MOBILE_HARD_FAIL_MS = 6_000;",
            "const MOBILE_HARD_FAIL_MS = 60_000;",
            "first-meaningful-render mobile p95 is 6 s",
        )

    def test_moving_the_published_render_cell_without_the_gate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "| First meaningful render (shell) | ≤ 1.5 s / 3 s desktop; ≤ 3 s / 6 s mobile |",
            "| First meaningful render (shell) | ≤ 1.5 s / 5 s desktop; ≤ 3 s / 6 s mobile |",
            "desktop p95 is 5 s",
        )

    def test_a_render_gate_throttling_a_different_desktop_fails(self) -> None:
        """Lighthouse's desktop preset is 1×, so this override *is* the reference machine."""
        self.assert_mutation_caught(
            RENDER_GATE,
            "const DESKTOP_CPU_SLOWDOWN = 4;",
            "const DESKTOP_CPU_SLOWDOWN = 1;",
            "states its desktop reference as a 4× CPU throttle",
        )

    def test_moving_the_published_reference_hardware_without_the_gate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "(desktop = mid-2023 laptop 4× throttle; mobile = Moto G-class Android)",
            "(desktop = mid-2023 laptop 2× throttle; mobile = Moto G-class Android)",
            "states its desktop reference as a 2× CPU throttle",
        )

    def test_a_render_gate_accepting_another_reference_phone_fails(self) -> None:
        """The gate takes Lighthouse's mobile preset unmodified, so this string is the check."""
        self.assert_mutation_caught(
            RENDER_GATE,
            "const MOBILE_REFERENCE_DEVICE = 'Moto G';",
            "const MOBILE_REFERENCE_DEVICE = 'Pixel';",
            "checks Lighthouse's preset against 'Pixel'",
        )

    def test_moving_the_published_reference_phone_without_the_gate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "mobile = Moto G-class Android)",
            "mobile = Pixel-class Android)",
            "names its reference mobile device as Pixel-class",
        )

    def test_an_even_run_count_fails(self) -> None:
        """A median over an even sample is an average of two runs, at a value neither produced."""
        self.assert_mutation_caught(
            RENDER_GATE,
            "const RUNS_PER_PROFILE = 3;",
            "const RUNS_PER_PROFILE = 4;",
            "takes 4 run(s) per profile",
        )

    def test_a_single_run_is_not_a_median(self) -> None:
        self.assert_mutation_caught(
            RENDER_GATE,
            "const RUNS_PER_PROFILE = 3;",
            "const RUNS_PER_PROFILE = 1;",
            "takes 1 run(s) per profile",
        )

    def test_a_run_count_that_leaves_the_published_sentence_behind_fails(self) -> None:
        """The sample size decides what the p95 comparison is, so it is published and bound."""
        self.assert_mutation_caught(
            RENDER_GATE,
            "const RUNS_PER_PROFILE = 3;",
            "const RUNS_PER_PROFILE = 5;",
            "§9.4 states the render gate takes 3 runs per profile",
        )

    def test_moving_the_published_run_count_without_the_gate_fails(self) -> None:
        self.assert_mutation_caught(
            FRONTEND,
            "The gate takes **3 runs** per profile",
            "The gate takes **9 runs** per profile",
            "§9.4 states the render gate takes 9 runs per profile",
        )

    # --- §9.4's IndexedDB-growth row and the quota manager that enforces it ---------
    #
    # This row's enforcement column names *"quota manager + tests"* rather than a size gate
    # over an artifact, so what its threshold has to be bound to is the retention module. Every
    # case below is a way that binding can rot, and the last two are the ones that matter most:
    # the manager can be right about every number and be reached by nothing.

    def test_a_cap_read_as_MiB_is_the_over_grant_this_binding_exists_for(self) -> None:
        """The `check-smoldot-budget.ts` defect, one module over: 300 MiB is 5 % more storage."""
        self.assert_mutation_caught(
            QUOTA_MANAGER,
            "desktop: 300 * 1000 * 1000,",
            "desktop: 300 * 1024 * 1024,",
            "enforces 314572800 B via STORAGE_CAP_BYTES",
        )

    def test_a_mobile_cap_the_document_does_not_publish_fails(self) -> None:
        self.assert_mutation_caught(
            QUOTA_MANAGER,
            "mobile: 75 * 1000 * 1000,",
            "mobile: 150 * 1000 * 1000,",
            "caps mobile local storage at 75 MB",
        )

    def test_a_share_table_that_left_the_document_behind_fails(self) -> None:
        """The shares turn one cap into the four budgets the ladder actually compares against."""
        self.assert_mutation_caught(
            QUOTA_MANAGER,
            "  rawSamples: 0.6,",
            "  rawSamples: 0.7,",
            "applies 0.7000 via QUOTA_SHARES.rawSamples",
        )

    def test_an_events_share_the_document_does_not_give_fails(self) -> None:
        self.assert_mutation_caught(
            QUOTA_MANAGER,
            "  eventsAndArchive: 0.15,",
            "  eventsAndArchive: 0.25,",
            "gives 'events+archive' 15%",
        )

    def test_a_metadata_blob_count_past_9_3_fails(self) -> None:
        self.assert_mutation_caught(
            QUOTA_MANAGER,
            "mobile: Object.freeze({ blobs: 3,",
            "mobile: Object.freeze({ blobs: 4,",
            "bounds the mobile metadata cache at 3 blobs",
        )

    def test_a_metadata_byte_bound_past_9_3_fails(self) -> None:
        """Both halves are bound: at the measured blob size the count binds and bytes are headroom,
        so a gate checking one would pass the 16 MB / 6 MB pair SQ-557 cut."""
        self.assert_mutation_caught(
            QUOTA_MANAGER,
            "bytes: 15 * 1000 * 1000 }",
            "bytes: 16 * 1000 * 1000 }",
            "bounds the desktop metadata cache at 15 MB",
        )

    def test_a_client_row_model_that_is_not_9_1s_fails(self) -> None:
        """§9.1 labels this a modelling assumption, so exactly one client module may name it."""
        self.assert_mutation_caught(
            QUOTA_CALLER,
            "export const MODELLED_ROW_BYTES = 120;",
            "export const MODELLED_ROW_BYTES = 100;",
            "charges 100 B via MODELLED_ROW_BYTES",
        )

    def test_9_1s_row_model_cannot_move_on_its_own(self) -> None:
        """The other direction of the same equality, and it fails one check earlier.

        Every §9.1 byte rate and every §9.2 depth divides by this figure, so moving it in the
        document is caught by the derivation before the client binding is reached. Asserted at
        the message that really fires rather than at the one this pairing would prefer: a test
        that named the binding's message would be claiming an ordering the gate does not have.
        """
        self.assert_mutation_caught(
            FRONTEND,
            "~120 B effective per row",
            "~140 B effective per row",
            "MB/day; derived",
        )

    def test_the_row_restating_9_2s_caps_must_restate_them_correctly(self) -> None:
        """One document, one figure, two places — which drifts exactly like a doc and a gate do."""
        self.assert_mutation_caught(
            FRONTEND,
            "| IndexedDB growth | §9.2 caps (300 MB / 75 MB)",
            "| IndexedDB growth | §9.2 caps (400 MB / 75 MB)",
            "restates §9.2's caps as 400 MB / 75 MB",
        )

    def test_a_quota_manager_no_client_module_runs_is_an_unenforced_row(self) -> None:
        """The whole finding. Every number can be right while nothing applies any of them."""
        self.assert_mutation_caught(
            QUOTA_CALLER,
            "await applyQuota(db, {",
            "await applyQuotaX(db, {",
            "does not call `applyQuota`",
        )

    def test_an_enforcement_column_that_names_no_call_site_fails(self) -> None:
        """A named mechanism with no implementation is SQ-557's shape — §9.4's bundle row named a
        *"bundle-size CI gate"* that did not exist for as long as the row did."""
        self.assert_mutation_caught(
            FRONTEND,
            "`app/src/features/analysis/src/index-quota.ts` is where the client runs it",
            "the client runs it somewhere",
            "cannot locate",
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
            "| Population | Trading books |",
            "| Population | Trading book counts |",
            "zero data rows",
        )

    def test_an_unparseable_load_row_is_an_error_not_a_skip(self) -> None:
        """A row shape the gate does not recognise must fail, never quietly pass."""
        self.assert_mutation_caught(
            FRONTEND,
            "| Primary, 1 of 5 slots | 7 |",
            "| A quiet week | 7 |",
            "cannot parse",
        )


if __name__ == "__main__":
    unittest.main()
