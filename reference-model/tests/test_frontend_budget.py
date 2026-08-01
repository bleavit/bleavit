"""Pins 10 §9's frontend budgets against 02's ingest set and 13's chain load.

The suite first reproduces doc 10's own approximate cells, then asks whether
their inputs are the inputs the chain actually supplies.  SQ-557 is represented
as queryable false findings: 196 is not the sustained observing-book flow,
`Traded` is absent from the priced ingest set, both metadata byte bounds exceed
their shares, the measured blob is outside the stated range, the shipped-blob
bundle row is absent, and one of seven doc-13 value citations does not resolve.
Tests assert those facts rather than encoding the defective prose as truth.
"""

import unittest
from dataclasses import replace
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model.frontend_budget import (
    BYTES_PER_MB,
    CANDLES_SHARE,
    DELAY_ONCE_ALLOWANCE_PER_EPOCH,
    DESKTOP_CAP_BYTES,
    DESKTOP_QUOTA,
    DOC10_MAX_BOOKS,
    DOC10_TABLE,
    DOC_10,
    DOC_13,
    EVENTS_SHARE,
    FORCE_RERUN_ALLOWANCE_PER_EPOCH,
    HALF_LOAD_BOOKS,
    MARKET_WEIGHT_FIXTURE,
    METADATA_FIXTURE,
    METADATA_SHARE,
    MOBILE_CAP_BYTES,
    MOBILE_QUOTA,
    NORMAL_PROOF_BUDGET,
    NORMAL_REF_TIME_BUDGET,
    PINNED_METADATA_BLOBS,
    RAW_SHARE,
    ROCKSDB_READ_REF_TIME,
    ROCKSDB_WRITE_REF_TIME,
    ROW_BYTES,
    TYPICAL_BOOKS,
    BudgetError,
    DispatchWeight,
    candle_depth_days,
    chain_rows_per_book_day,
    corrected_budget_cells,
    doc10_derived_cells,
    doc10_rows_per_book_day,
    events_share_exhaustion_hours,
    ingest_coverage,
    instantaneous_observing_books,
    load_findings,
    measure_metadata,
    metadata_bundle_budget_finding,
    metadata_size_finding,
    normative_citation_findings,
    observed_rows_per_day,
    parse_generated_weight,
    raw_depth_days,
    repo_normative_citation_findings,
    rows_per_day_for_books,
    saturated_traded_rows_per_day,
    traded_events_per_block,
)
from bleavit_reference_model.occupancy import (
    FROZEN,
    GENESIS,
    Registry,
    books,
    item4_full_window,
    reachable_slots_max,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


class TestPublishedObservationModel(unittest.TestCase):
    """10 §9.1–§9.2's own arithmetic before chain reconciliation."""

    def test_the_two_per_book_models_agree_exactly(self):
        # Independent frontend formula: 14,400/10 observations per full day,
        # active for 13/21. Chain formula: item 4 / books / epoch days.
        frontend = doc10_rows_per_book_day()
        chain = chain_rows_per_book_day()
        self.assertEqual(frontend, Fraction(6_240, 7))
        self.assertEqual(chain, Fraction(6_240, 7))
        finding = next(f for f in load_findings() if f.key == "observed.per-book-rate")
        self.assertTrue(finding.ok)

    def test_every_published_load_and_depth_cell_reproduces_at_its_precision(self):
        derived = doc10_derived_cells()
        self.assertEqual(set(derived), set(DOC10_TABLE))
        for key, published in DOC10_TABLE.items():
            with self.subTest(cell=key, unit=published.unit):
                self.assertTrue(
                    published.contains(derived[key]),
                    f"{key}: derived {derived[key]}, published {published.value} ± "
                    f"{published.tolerance}",
                )

    def test_the_three_published_book_counts_share_one_rate(self):
        self.assertEqual(rows_per_day_for_books(TYPICAL_BOOKS), Fraction(124_800, 7))
        self.assertEqual(rows_per_day_for_books(HALF_LOAD_BOOKS), Fraction(87_360))
        self.assertEqual(rows_per_day_for_books(DOC10_MAX_BOOKS), Fraction(174_720))

    def test_depth_functions_refuse_inputs_that_could_claim_unbounded_retention(self):
        with self.assertRaises(BudgetError):
            raw_depth_days(1_000, 0)
        with self.assertRaises(BudgetError):
            candle_depth_days(1_000, 0)
        with self.assertRaises(BudgetError):
            candle_depth_days(1_000, 1, hours_per_candle=5)


class TestChainReconciliation(unittest.TestCase):
    """13 §4–§5's sustained flow, distinct from live-book capacity and peaks."""

    def test_sq_557_196_is_not_the_sustained_observing_book_count(self):
        """SQ-557. 10 §9.1 publishes 196 as maximum sustained active load.

        13 §4 calls 196 the no-terminal-latch/POL capacity and separately
        states 31 concurrently trading books; item 4 executes that distinction.
        The resulting `Observed` rate is 27,634.2857…/day, not 174,720/day.
        """
        self.assertEqual(reachable_slots_max(), 5)
        sustained_books = books(reachable_slots_max())
        self.assertEqual(sustained_books, 31)
        self.assertEqual(item4_full_window(GENESIS), 580_320)
        self.assertEqual(observed_rows_per_day(), Fraction(193_440, 7))
        self.assertEqual(rows_per_day_for_books(DOC10_MAX_BOOKS), 174_720)
        self.assertEqual(Fraction(DOC10_MAX_BOOKS, sustained_books), Fraction(196, 31))
        finding = next(
            f for f in load_findings() if f.key == "observed.max-sustained-book-count"
        )
        self.assertFalse(finding.ok)
        self.assertEqual(finding.actual, 31)
        self.assertEqual(finding.expected, 196)

    def test_corrected_retention_cells_follow_from_the_chain_flow(self):
        cells = corrected_budget_cells()
        self.assertEqual(cells["load.books"], 31)
        self.assertEqual(cells["load.rows_per_day"], Fraction(193_440, 7))
        self.assertEqual(cells["load.bytes_per_day"], Fraction(23_212_800, 7))
        self.assertEqual(cells["load.megabytes_per_day"], Fraction(14_508, 4_375))
        self.assertEqual(cells["raw.desktop.days"], Fraction(21_875, 403))
        self.assertEqual(cells["raw.mobile.days"], Fraction(21_875, 1_612))
        self.assertEqual(cells["candles1h.desktop.days"], Fraction(62_500, 93))
        self.assertEqual(cells["candles1h.mobile.days"], Fraction(15_625, 93))
        # Brackets pin the human-facing ~54.3/~13.6/~672/~168 cells without
        # converting the model to binary float or promising rounded-up depth.
        self.assertTrue(Fraction(542, 10) < cells["raw.desktop.days"] < Fraction(543, 10))
        self.assertTrue(Fraction(135, 10) < cells["raw.mobile.days"] < Fraction(136, 10))
        self.assertTrue(672 < cells["candles1h.desktop.days"] < 673)
        self.assertTrue(168 < cells["candles1h.mobile.days"] < 169)

    def test_reruns_make_thirty_one_a_flow_count_not_an_instantaneous_ceiling(self):
        # T13: up to two delayed proposals reopen at Seed; T25: one force rerun
        # per epoch. If all three come from distinct older epochs, their shared
        # Baselines are distinct too and the documented overlap is 52.
        scheduled = instantaneous_observing_books(
            scheduled_reruns=1,
            additional_baseline_epochs=1,
        )
        forced = instantaneous_observing_books(
            forced_reruns=1,
            additional_baseline_epochs=1,
        )
        ordinary = instantaneous_observing_books(
            scheduled_reruns=DELAY_ONCE_ALLOWANCE_PER_EPOCH,
            forced_reruns=FORCE_RERUN_ALLOWANCE_PER_EPOCH,
            additional_baseline_epochs=3,
        )
        self.assertEqual(scheduled, 38)
        self.assertEqual(forced, 38)
        self.assertEqual(ordinary, 52)
        self.assertGreater(ordinary, books(5))
        self.assertLess(ordinary, DOC10_MAX_BOOKS)

    def test_peak_scenarios_refuse_impossible_baseline_multiplicity(self):
        with self.assertRaises(BudgetError):
            instantaneous_observing_books(scheduled_reruns=1, additional_baseline_epochs=2)

    def test_a_longer_registry_epoch_moves_the_chain_rate_not_the_doc10_count(self):
        # A wrong implementation that hardcodes 27,634/day cannot survive an
        # admissible scenario variant.  Item 4 remains the sole rate source.
        longer = Registry(epoch_length=604_800, mkt_obs_interval=20)
        self.assertEqual(item4_full_window(longer), FROZEN.full_window_obs)
        self.assertEqual(observed_rows_per_day(longer), Fraction(96_720, 7))


class TestTradedStream(unittest.TestCase):
    """02 §5's unmodelled, transaction-volume-controlled event family."""

    @classmethod
    def setUpClass(cls):
        cls.weight = parse_generated_weight(REPO_ROOT / MARKET_WEIGHT_FIXTURE)
        cls.capacity = traded_events_per_block(
            NORMAL_PROOF_BUDGET, NORMAL_REF_TIME_BUDGET, cls.weight
        )

    def test_the_generated_buy_weight_includes_its_database_addend(self):
        self.assertEqual(self.weight.ref_time, 1_167_142_000)
        self.assertEqual(self.weight.proof_size, 108_804)
        self.assertEqual((self.weight.reads, self.weight.writes), (77, 67))
        self.assertEqual(
            self.weight.database_ref_time,
            77 * ROCKSDB_READ_REF_TIME + 67 * ROCKSDB_WRITE_REF_TIME,
        )
        self.assertEqual(self.weight.database_ref_time, 8_625_000_000)
        self.assertEqual(self.weight.total_ref_time, 9_792_142_000)
        self.assertGreater(
            Fraction(self.weight.database_ref_time, self.weight.total_ref_time),
            Fraction(88, 100),
        )

    def test_proof_size_binds_the_traded_block_capacity(self):
        self.assertEqual(self.capacity.proof_limit, 36)
        self.assertEqual(self.capacity.ref_time_limit, 153)
        self.assertEqual(self.capacity.events, 36)
        self.assertEqual(self.capacity.binding_dimension, "proof_size")
        # Dropping DbWeight gives the audit's wrong 1,285 ref-time ceiling.
        self.assertEqual(NORMAL_REF_TIME_BUDGET // self.weight.ref_time, 1_285)
        self.assertNotEqual(self.capacity.ref_time_limit, 1_285)

    def test_sq_557_section_9_1_does_not_cover_the_frozen_minimal_ingest_set(self):
        """SQ-557. 02 §5 requires `Traded` + `Observed`; 10 §9.1 prices one.

        `Observed` is registry-bounded. `Traded` is controlled by adversarial
        successful transaction volume, so omitting it is the unsafe direction:
        the events share can fill without violating any §13 parameter.
        """
        coverage = ingest_coverage(REPO_ROOT)
        self.assertEqual(coverage.required, ("Traded", "Observed"))
        self.assertEqual(coverage.modelled, ("Observed",))
        self.assertEqual(coverage.missing, ("Traded",))
        self.assertFalse(coverage.ok)

    def test_saturation_rate_and_share_exhaustion_are_capacity_bounds(self):
        traded = saturated_traded_rows_per_day(self.capacity)
        observed = observed_rows_per_day()
        self.assertEqual(traded, 518_400)
        self.assertEqual(Fraction(traded, observed), Fraction(7_560, 403))
        self.assertGreater(Fraction(traded, observed), Fraction(187, 10))
        desktop_hours = events_share_exhaustion_hours(
            DESKTOP_CAP_BYTES * EVENTS_SHARE, traded
        )
        mobile_hours = events_share_exhaustion_hours(MOBILE_CAP_BYTES * EVENTS_SHARE, traded)
        self.assertEqual(desktop_hours, Fraction(625, 36))
        self.assertEqual(mobile_hours, Fraction(625, 144))

    def test_one_trade_per_block_is_already_half_the_observed_stream(self):
        one_per_block = saturated_traded_rows_per_day(
            replace(self.capacity, proof_limit=1, ref_time_limit=1)
        )
        self.assertEqual(one_per_block, 14_400)
        self.assertGreater(Fraction(one_per_block, observed_rows_per_day()), Fraction(1, 2))
        desktop_days = raw_depth_days(DESKTOP_CAP_BYTES * EVENTS_SHARE, one_per_block)
        self.assertEqual(desktop_days, Fraction(625, 24))

    def test_weight_and_budget_fail_closed_on_malformed_dimensions(self):
        zero_proof = DispatchWeight(1, 0, 0, 0, 1)
        with self.assertRaises(BudgetError):
            traded_events_per_block(1, 1, zero_proof)
        with self.assertRaises(BudgetError):
            traded_events_per_block(-1, 1, self.weight)


class TestQuotaAndMetadata(unittest.TestCase):
    """10 §9.2–§9.4 internal shares and the real committed blob."""

    @classmethod
    def setUpClass(cls):
        cls.measurement = measure_metadata(REPO_ROOT / METADATA_FIXTURE)

    def test_fixed_shares_exhaust_the_platform_cap_exactly(self):
        self.assertEqual(RAW_SHARE + CANDLES_SHARE + EVENTS_SHARE + METADATA_SHARE, 1)
        for plan in (DESKTOP_QUOTA, MOBILE_QUOTA):
            finding = next(
                f
                for f in plan.validate(self.measurement.gzip_bytes)
                if f.key.endswith("shares-sum")
            )
            self.assertTrue(finding.ok)

    def test_sq_557_each_declared_metadata_bound_exceeds_its_own_share(self):
        """SQ-557. 10 §9.3's byte caps do not fit 10 §9.2's fixed shares.

        Desktop declares 16 MB inside 15 MB; mobile declares 6 MB inside
        3.75 MB. The error is an internal over-allocation; borrowing is not
        specified and the four shares already sum to 100 percent.
        """
        expected = {
            "desktop": (16 * BYTES_PER_MB, 15 * BYTES_PER_MB),
            "mobile": (6 * BYTES_PER_MB, Fraction(15, 4) * BYTES_PER_MB),
        }
        for plan in (DESKTOP_QUOTA, MOBILE_QUOTA):
            with self.subTest(platform=plan.platform):
                finding = next(
                    f
                    for f in plan.validate(self.measurement.gzip_bytes)
                    if f.key.endswith("metadata-declared-byte-bound")
                )
                self.assertFalse(finding.ok)
                self.assertEqual((finding.actual, finding.expected), expected[plan.platform])

    def test_the_real_metadata_blob_falsifies_the_stated_one_to_two_mb_range(self):
        """SQ-557. 10 §9.3 states each compressed blob is about 1–2 MB.

        Deterministic gzip-9 of the repository's bootstrap metadata is 106,875
        bytes. The prose errs high by roughly an order of magnitude; that is
        capacity-safe, while a prose estimate below reality would be unsafe.
        """
        self.assertEqual(self.measurement.raw_bytes, 360_119)
        self.assertEqual(self.measurement.gzip_bytes, 106_875)
        finding = metadata_size_finding(self.measurement)
        self.assertFalse(finding.ok)
        self.assertLess(self.measurement.gzip_bytes, BYTES_PER_MB)

    def test_measured_count_limits_and_the_pinned_pair_fit_both_shares(self):
        for plan in (DESKTOP_QUOTA, MOBILE_QUOTA):
            findings = {
                f.key.rsplit(".", 1)[-1]: f
                for f in plan.validate(self.measurement.gzip_bytes)
            }
            with self.subTest(platform=plan.platform, bound="count"):
                self.assertTrue(findings["metadata-count-at-measured-size"].ok)
            with self.subTest(platform=plan.platform, bound="pinned"):
                self.assertTrue(findings["metadata-pinned-pair-at-measured-size"].ok)
                self.assertEqual(
                    findings["metadata-pinned-pair-at-measured-size"].actual,
                    PINNED_METADATA_BLOBS * self.measurement.gzip_bytes,
                )

    def test_sq_557_release_shipped_metadata_has_no_bundle_budget_row(self):
        """SQ-557. §9.3 mandates release-shipped fallback blobs.

        Section 9.4 gates bundle artifacts but contains no row for those blobs.
        The measured blob makes the omission smaller than the prose suggests;
        it does not make an unbudgeted release artifact a budgeted one.
        """
        doc10 = (REPO_ROOT / DOC_10).read_text(encoding="utf-8")
        finding = metadata_bundle_budget_finding(doc10)
        self.assertFalse(finding.ok)
        self.assertFalse(any("metadata" in row.lower() for row in finding.actual))


class TestNormativeCitations(unittest.TestCase):
    """Every doc-10 `normative value(s): 13-parameters.md` citation, parsed."""

    def test_sq_557_six_of_seven_citations_resolve_and_the_quota_caps_do_not(self):
        """SQ-557. 10 §9.2 calls 300/75 MB values normative in doc 13.

        Doc 13 contains neither cap. The resolver checks all seven citations,
        so this is not a grep special-cased to the known bad line.
        """
        findings = repo_normative_citation_findings(REPO_ROOT)
        self.assertEqual(len(findings), 7)
        self.assertEqual(sum(f.ok for f in findings), 6)
        dangling = [f for f in findings if not f.ok]
        self.assertEqual(len(dangling), 1)
        self.assertIn("Hard caps", dangling[0].claim)
        self.assertEqual(set(dangling[0].values), {"300", "75"})

    def test_the_resolver_turns_green_when_the_normative_home_gains_the_values(self):
        # Anti-vacuity: do not pin the defect to itself. A doc-13 correction
        # resolves the existing citation without changing code or expected ids.
        doc10 = (REPO_ROOT / DOC_10).read_text(encoding="utf-8")
        doc13 = (REPO_ROOT / DOC_13).read_text(encoding="utf-8")
        repaired = doc13 + "\n| Frontend IndexedDB caps | 300 MB desktop / 75 MB mobile |\n"
        findings = normative_citation_findings(doc10, repaired)
        self.assertTrue(all(f.ok for f in findings))


if __name__ == "__main__":
    unittest.main()
