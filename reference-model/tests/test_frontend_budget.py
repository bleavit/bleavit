"""Pins 10 §9's frontend budgets against 02's ingest set and 13's chain load.

The suite first reproduces doc 10's own approximate cells, then asks whether
their inputs are the inputs the chain actually supplies.  SQ-557 is represented
as queryable false findings: 196 is not the sustained observing-book flow,
`Traded` is absent from the priced ingest set, both metadata byte bounds exceed
their shares, the measured blob is outside the stated range, the shipped-blob
bundle row is absent, and one doc-13 value citation does not resolve. Generated
weights and blob sizes are kept in explicit implementation-evidence accessors.

**SQ-557 was ruled on 2026-08-06 and doc 10 §9 was rewritten.** The findings that
read the *live* document — the bundle-budget row and the normative citations —
now assert the repaired state, each paired with an anti-vacuity case proving the
check can still go red; the constants above them remain a snapshot of the cells
as published when the question was filed, which is what makes the finding
records readable after the fact.  The load model itself moved again in the same
session: the repair counted the primary partition only, and hosted books emit
the same events on a duty cycle of 1.  That correction lives in
`tools/ci/check-frontend-budgets.py`, which derives §9 from doc 13 and the
runtime rather than from any snapshot here.
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
    MAX_POV_SIZE,
    METADATA_STATED_MIN_BYTES,
    MOBILE_QUOTA,
    NORMAL_LENGTH_CEILING,
    NORMAL_PROOF_BUDGET,
    NORMAL_REF_TIME_BUDGET,
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

    def test_the_normal_class_budgets_are_derived_and_are_not_the_length_ceiling(self):
        """The proof budget must never again be the block-*length* ceiling.

        `NORMAL_PROOF_BUDGET` read 3,932,160 until 2026-08-09, copied out of a
        13 §5 sentence that was itself wrong. That number is a real limit of
        this runtime and a different resource: 75 % of the 5 MiB `BlockLength`,
        which bounds an extrinsic's encoded length. This module divides a proof
        size by it, so the published trade capacity came out at half the true
        value, and no test noticed because every other test here is parametric
        in the budget.

        This one is not parametric on purpose. It asserts the derivation — 75 %
        of `MAX_POV_SIZE` — and asserts the two ceilings are distinct, so a
        future re-transcription fails here rather than shipping.
        """
        self.assertEqual(NORMAL_PROOF_BUDGET, MAX_POV_SIZE * 3 // 4)
        self.assertEqual(NORMAL_PROOF_BUDGET, 7_864_320)
        self.assertEqual(NORMAL_REF_TIME_BUDGET, 1_500_000_000_000)
        self.assertEqual(NORMAL_LENGTH_CEILING, 3_932_160)
        self.assertNotEqual(NORMAL_PROOF_BUDGET, NORMAL_LENGTH_CEILING)

    def test_observed_trade_capacity_agrees_with_the_runtime_within_the_surcharge(self):
        """The capacity here must land where the runtime's own pinned one does.

        `pov_budgets.rs` asserts at runtime that the primary reservation holds
        **70** `buy` calls. This module reaches the same figure from the same
        generated weight, and lands two higher for one stated reason: the
        runtime composes `EXTERNAL_TRADE_ROUTE_PROOF_SURCHARGE` (3,056 B) on top
        of the generated 108,804 B, and `parse_generated_weight` reads only the
        generated file. So the gap is a known 2, not an unknown drift.

        The load-bearing part is the order of magnitude. Against the old budget
        this returned 36 — half the runtime's own ceiling — and nothing here
        compared the two.
        """
        capacity = self.observed.capacity
        self.assertEqual(capacity.proof_limit, NORMAL_PROOF_BUDGET // self.observed.weight.proof_size)
        runtime_pinned = 70
        surcharge_free = NORMAL_PROOF_BUDGET // (self.observed.weight.proof_size + 3_056)
        self.assertEqual(surcharge_free, runtime_pinned)
        self.assertGreaterEqual(capacity.proof_limit, runtime_pinned)
        self.assertLessEqual(capacity.proof_limit - runtime_pinned, 2)
        # Proof still binds before ref-time, which is what makes the omitted
        # `Traded` stream an operational risk rather than a rounding note.
        self.assertEqual(capacity.binding_dimension, "proof_size")

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

    def test_sq_557_release_shipped_metadata_now_has_a_bundle_budget_row(self):
        """SQ-557, ruled 2026-08-06: §9.4 gained the row §9.3 always implied.

        §9.3 mandates release-shipped fallback blobs and §9.4 gated every other
        bundle artifact without a row for them, so the one release artifact
        whose size §9.3 bounds was the one nothing measured.  The finding is now
        green because the row exists, not because the check was relaxed — the
        row-label extraction is unchanged and the assertion below still requires
        a metadata row to be present by name.
        """
        doc10 = (REPO_ROOT / DOC_10).read_text(encoding="utf-8")
        finding = metadata_bundle_budget_finding(doc10)
        self.assertTrue(finding.ok, f"§9.4 rows: {finding.actual}")
        self.assertTrue(any("metadata" in row.lower() for row in finding.actual))

    def test_a_budget_table_that_loses_the_metadata_row_is_detected_again(self):
        """Anti-vacuity: the finding must still fire, or it stopped being a check."""
        doc10 = (REPO_ROOT / DOC_10).read_text(encoding="utf-8")
        # The anchor is deliberately the stem both spellings share. §4.2 made the blobs
        # *required* rather than an FE-P5 fallback, so this row was renamed "fallback" ->
        # "historical" on 2026-08-07 — and an anti-vacuity test anchored on the old word
        # silently stops stripping anything, so the finding it exists to prove can fire
        # never gets its chance. That is this test's own failure mode arriving through the
        # door it was built to watch. The assertion below proves the strip happened, so a
        # future rename fails loudly here instead of quietly passing.
        stripped = "\n".join(
            line
            for line in doc10.splitlines()
            if not line.startswith("| Release-shipped ")
        )
        self.assertNotEqual(stripped, doc10, "the strip removed nothing — re-anchor it")
        finding = metadata_bundle_budget_finding(stripped)
        self.assertFalse(finding.ok)
        self.assertFalse(any("metadata" in row.lower() for row in finding.actual))


class TestNormativeCitations(unittest.TestCase):
    """Every doc-10 `normative value(s): 13-parameters.md` citation, parsed."""

    def test_sq_557_every_normative_citation_now_resolves(self):
        """SQ-557, ruled 2026-08-06: doc 10 no longer cites doc 13 for a value it lacks.

        §9.2's *"Hard caps"* line carried a `normative values: 13-parameters.md`
        citation pointing at a document with no such row — a browser storage
        quota is not a chain parameter, and every other §9 budget value has
        always been owned by §9 itself.  The repair removed the citation rather
        than inventing a registry row, so the remaining citations are the ones
        that were always genuine.

        The resolver still checks *every* citation in doc 10, not a list of
        known-good ones, so this asserts a property rather than a snapshot.
        """
        findings = repo_normative_citation_findings(REPO_ROOT)
        self.assertGreater(len(findings), 0, "the resolver found no citations to check")
        dangling = [f for f in findings if not f.ok]
        self.assertEqual(dangling, [], f"dangling citations: {[f.claim for f in dangling]}")

    def test_a_citation_whose_value_leaves_doc_13_is_detected(self):
        """Anti-vacuity: an all-green resolver must still be able to go red.

        Mutating doc 10's cited value (rather than deleting a doc-13 row) keeps
        the mutation surgical: no other citation's numeric atoms move, so
        exactly one finding may flip.
        """
        doc10 = (REPO_ROOT / DOC_10).read_text(encoding="utf-8")
        doc13 = (REPO_ROOT / DOC_13).read_text(encoding="utf-8")
        self.assertIn("= 43,200 blocks = 72 h", doc10)
        broken = doc10.replace("= 43,200 blocks = 72 h", "= 43,201 blocks = 72 h", 1)
        findings = normative_citation_findings(broken, doc13)
        dangling = [f for f in findings if not f.ok]
        self.assertEqual(len(dangling), 1, f"expected exactly one dangling, got {len(dangling)}")
        self.assertIn("43,201", dangling[0].claim)


if __name__ == "__main__":
    unittest.main()
