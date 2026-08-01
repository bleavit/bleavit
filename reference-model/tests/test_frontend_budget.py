"""Pins 10 §9's frontend budgets against 02's ingest set and 13's chain load.

The suite first reproduces doc 10's own approximate cells, then asks whether
their inputs are the inputs the chain actually supplies.  SQ-557 is represented
as queryable false findings: 196 is not the sustained observing-book flow,
`Traded` is absent from the priced ingest set, both metadata byte bounds exceed
their shares, the measured blob is outside the stated range, the shipped-blob
bundle row is absent, and one doc-13 value citation does not resolve. Generated
weights and blob sizes are kept in explicit implementation-evidence accessors.
"""

import unittest
from dataclasses import replace
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model.frontend_budget import (
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
    METADATA_SHARE,
    METADATA_STATED_MIN_BYTES,
    MOBILE_QUOTA,
    PINNED_METADATA_BLOBS,
    RAW_SHARE,
    ROW_BYTES,
    TYPICAL_BOOKS,
    BudgetError,
    DispatchWeight,
    candle_depth_days,
    chain_rows_per_book_day,
    check_frontend_budget_claims,
    corrected_budget_cells,
    doc10_derived_cells,
    doc10_rows_per_book_day,
    events_share_exhaustion_hours,
    ingest_coverage,
    instantaneous_observing_books,
    load_findings,
    metadata_bundle_budget_finding,
    metadata_size_finding,
    normative_citation_findings,
    observed_metadata,
    observed_rows_per_day,
    observed_trade_evidence,
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
        """SQ-557. The derived sustained flow is the reachable cohort's books.

        13 §4 separates active/POL capacity from concurrently trading books;
        item 4 executes that distinction. The falsification pins the derived
        31-book flow and leaves the stale source value in ``load_findings``.
        """
        self.assertEqual(reachable_slots_max(), 5)
        sustained_books = books(reachable_slots_max())
        self.assertEqual(sustained_books, 31)
        self.assertEqual(item4_full_window(GENESIS), 580_320)
        self.assertEqual(observed_rows_per_day(), Fraction(193_440, 7))
        finding = next(
            f for f in load_findings() if f.key == "observed.max-sustained-book-count"
        )
        self.assertEqual(finding.actual, sustained_books)
        self.assertEqual(finding.sq_id, "SQ-557")

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
    """02 §5's omitted stream, with current weight evidence kept separate."""

    @classmethod
    def setUpClass(cls):
        cls.observed = observed_trade_evidence(REPO_ROOT)

    def test_observed_buy_weight_is_current_artifact_evidence(self):
        weight = parse_generated_weight(self.observed.source)
        self.assertEqual(self.observed.weight, weight)
        self.assertEqual(
            weight.database_ref_time,
            weight.reads * weight.read_ref_time + weight.writes * weight.write_ref_time,
        )
        self.assertGreater(weight.total_ref_time, weight.ref_time)
        self.assertGreater(weight.proof_size, 0)

    def test_capacity_and_exhaustion_are_parametric_in_per_event_weight(self):
        weight = DispatchWeight(
            ref_time=20,
            proof_size=10,
            reads=2,
            writes=1,
            minimum_ref_time=10,
            read_ref_time=5,
            write_ref_time=10,
        )
        capacity = traded_events_per_block(105, 95, weight)
        self.assertEqual(weight.total_ref_time, 40)
        self.assertEqual(capacity.proof_limit, 10)
        self.assertEqual(capacity.ref_time_limit, 2)
        self.assertEqual(capacity.events, 2)
        self.assertEqual(capacity.binding_dimension, "ref_time")
        rows = saturated_traded_rows_per_day(capacity)
        self.assertEqual(rows, 2 * 14_400)
        self.assertEqual(events_share_exhaustion_hours(120, rows), Fraction(1, 1_200))

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
        finding = check_frontend_budget_claims(REPO_ROOT)[0]
        self.assertEqual(finding.sq_id, "SQ-557")
        self.assertEqual(finding.actual, coverage.modelled)
        self.assertEqual(finding.expected, coverage.required)
        self.assertEqual(finding.supporting_evidence, self.observed)

    def test_observed_capacity_is_supporting_evidence_not_a_frozen_expectation(self):
        self.assertEqual(
            self.observed.rows_per_day,
            saturated_traded_rows_per_day(self.observed.capacity),
        )
        self.assertGreater(self.observed.capacity.events, 0)
        self.assertGreater(self.observed.desktop_exhaustion_hours, 0)
        self.assertGreater(self.observed.mobile_exhaustion_hours, 0)

    def test_one_trade_per_block_is_already_half_the_observed_stream(self):
        one_per_block = saturated_traded_rows_per_day(
            replace(self.observed.capacity, proof_limit=1, ref_time_limit=1)
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
            traded_events_per_block(-1, 1, self.observed.weight)


class TestQuotaAndMetadata(unittest.TestCase):
    """10 §9.2–§9.4 internal shares and the real committed blob."""

    @classmethod
    def setUpClass(cls):
        cls.measurement = observed_metadata(REPO_ROOT)

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
        """SQ-557. Each declared byte cap exceeds its derived fixed share.

        The error is an internal over-allocation; borrowing is not specified
        and the four shares already sum to 100 percent. The stale source caps
        remain in the finding rather than becoming expected test values.
        """
        for plan in (DESKTOP_QUOTA, MOBILE_QUOTA):
            with self.subTest(platform=plan.platform):
                finding = next(
                    f
                    for f in plan.validate(self.measurement.gzip_bytes)
                    if f.key.endswith("metadata-declared-byte-bound")
                )
                derived_share = plan.share_bytes(plan.metadata_share)
                self.assertEqual(finding.expected, derived_share)
                self.assertEqual(finding.sq_id, "SQ-557")

    def test_the_real_metadata_blob_falsifies_the_stated_one_to_two_mb_range(self):
        """SQ-557. 10 §9.3 states each compressed blob is about 1–2 MB.

        The observed gzip-9 blob is below the range. Its exact byte count is
        not normative and is not stable across all zlib implementations; only
        the specification-relevant range relationship is asserted.
        """
        finding = metadata_size_finding(self.measurement)
        self.assertFalse(finding.ok)
        self.assertGreater(self.measurement.raw_bytes, 0)
        self.assertGreater(self.measurement.gzip_bytes, 0)
        self.assertLess(self.measurement.gzip_bytes, METADATA_STATED_MIN_BYTES)

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
        """SQ-557. 10 §9.2's cap citation has no normative home in doc 13.

        The resolver checks every citation, so this is not a grep special-cased
        to the known bad line. The stale cap values remain source data only.
        """
        findings = repo_normative_citation_findings(REPO_ROOT)
        self.assertEqual(len(findings), 7)
        self.assertEqual(sum(f.ok for f in findings), 6)
        dangling = [f for f in findings if not f.ok]
        self.assertEqual(len(dangling), 1)
        self.assertIn("Hard caps", dangling[0].claim)

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
