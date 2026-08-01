"""Pins doc 14's parametric attack costs and exposes its three red claims.

Document-derived tests require explicit call fees. Generated Rust weights are
read only by implementation-evidence tests and by the supporting-evidence field
of ``check_threat_cost_claims``; they never decide a specification assertion.
"""

import tempfile
import unittest
from dataclasses import replace
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model.threat_costs import (
    ANNUAL_DISCOUNT_RATE,
    BASELINE_TERMINAL_STATES,
    DAYS_PER_YEAR,
    DEFAULT_INTAKE_PARAMS,
    EPOCH_DAYS,
    FEE_VIT_USDC_RATE_REF,
    INTAKE_MAX_PER_ACCOUNT,
    INTAKE_QUEUE,
    LEDGER_ARCHIVE_DEFAULT,
    LEDGER_ARCHIVE_MIN,
    LEDGER_POSITION_DEPOSIT,
    MAX_POSITIONS_PER_ACCOUNT,
    PRE_REVIEW_COMBINED_LOCKED,
    PRE_REVIEW_INTAKE_LOCKED,
    PROPOSAL_TERMINAL_STATES,
    ThreatCostError,
    attacker_peak_position_deposit,
    avoidance_breakeven_call_fee,
    capital_time_value,
    ceil_fraction,
    check_threat_cost_claims,
    dust_reach,
    dusting_breakeven_call_fee,
    dusting_cost,
    funded_accounts_required,
    intake_monopolization_cost,
    observed_call_fee,
    observed_call_weight,
    parse_generated_call_weight,
    published_intake_forfeits,
    published_redemption_factors,
    queue_occupancy,
    raw_transaction_fee_usdc,
    redemption_fee_avoidance_ratio,
    sweep_recovery_eligible,
    transaction_fee_usdc,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


class ImplementationEvidenceTests(unittest.TestCase):
    """Generated Rust values are observable without becoming expected truth."""

    def test_observed_accessors_read_the_current_artifact_without_copied_weights(self):
        for function in ("redeem_scalar", "transfer"):
            with self.subTest(function=function):
                weight = observed_call_weight(REPO_ROOT, function)
                evidence = observed_call_fee(REPO_ROOT, function)
                self.assertEqual(weight.function, function)
                self.assertEqual(evidence.weight, weight)
                self.assertGreater(weight.call_ref_time, weight.minimum_ref_time)
                self.assertGreater(weight.proof_size, 0)
                self.assertGreater(evidence.charged_usdc, 0)
                self.assertGreaterEqual(evidence.charged_usdc, evidence.raw_usdc)

    def test_usdc_conversion_rounds_up_against_the_fee_payer(self):
        weight = observed_call_weight(REPO_ROOT, "redeem_scalar")
        raw = raw_transaction_fee_usdc(FEE_VIT_USDC_RATE_REF, weight)
        charged = transaction_fee_usdc(FEE_VIT_USDC_RATE_REF, weight)
        self.assertGreaterEqual(charged, raw)
        self.assertEqual((charged * 1_000_000).denominator, 1)

    def test_parser_rejects_extra_ref_time_and_database_terms(self):
        """A later generated term must not disappear behind the first match."""
        malformed = """
impl<T> WeightInfo for T {
	fn redeem_scalar() -> Weight {
		// Minimum execution time: 218_060_000 picoseconds.
		Weight::from_parts(232_520_000, 0)
			.saturating_add(Weight::from_parts(0, 36928))
			.saturating_add(T::DbWeight::get().reads(41))
			.saturating_add(Weight::from_parts(999_000_000, 0))
			.saturating_add(T::DbWeight::get().reads(999))
			.saturating_add(T::DbWeight::get().writes(36))
	}
}
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "weights.rs"
            path.write_text(malformed, encoding="utf-8")
            with self.assertRaises(ThreatCostError):
                parse_generated_call_weight(path, "redeem_scalar")

    def test_parser_rejects_component_bearing_generated_weights(self):
        malformed = """
impl<T> WeightInfo for T {
	fn redeem_scalar() -> Weight {
		// Minimum execution time: 218_060_000 picoseconds.
		Weight::from_parts(232_520_000, 0)
			.saturating_add(Weight::from_parts(0, 36928))
			.saturating_add(Weight::from_parts(1, 0).saturating_mul(n.into()))
			.saturating_add(T::DbWeight::get().reads(41))
			.saturating_add(T::DbWeight::get().writes(36))
	}
}
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "weights.rs"
            path.write_text(malformed, encoding="utf-8")
            with self.assertRaises(ThreatCostError):
                parse_generated_call_weight(path, "redeem_scalar")

    def test_parser_rejects_each_duplicate_generated_term_family(self):
        base = """
impl<T> WeightInfo for T {
	fn redeem_scalar() -> Weight {
		// Minimum execution time: 218_060_000 picoseconds.
		Weight::from_parts(232_520_000, 0)
			.saturating_add(Weight::from_parts(0, 36928))
EXTRA
			.saturating_add(T::DbWeight::get().reads(41))
			.saturating_add(T::DbWeight::get().writes(36))
	}
}
"""
        mutations = {
            "ref-time": "\t\t\t.saturating_add(Weight::from_parts(999_000_000, 0))",
            "database": "\t\t\t.saturating_add(T::DbWeight::get().reads(999))",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "weights.rs"
            for label, extra in mutations.items():
                with self.subTest(term=label):
                    path.write_text(base.replace("EXTRA", extra), encoding="utf-8")
                    with self.assertRaises(ThreatCostError):
                        parse_generated_call_weight(path, "redeem_scalar")

    def test_parser_rejects_an_unfamiliar_addend(self):
        malformed = """
impl<T> WeightInfo for T {
	fn redeem_scalar() -> Weight {
		// Minimum execution time: 218_060_000 picoseconds.
		Weight::from_parts(232_520_000, 0)
			.saturating_add(Weight::from_parts(0, 36928))
			.saturating_add(Weight::zero())
			.saturating_add(T::DbWeight::get().reads(41))
			.saturating_add(T::DbWeight::get().writes(36))
	}
}
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "weights.rs"
            path.write_text(malformed, encoding="utf-8")
            with self.assertRaises(ThreatCostError):
                parse_generated_call_weight(path, "redeem_scalar")


class RedemptionFeeAvoidanceTests(unittest.TestCase):
    """TH-64 as a function of the per-redemption-call fee."""

    def test_all_three_documents_publish_the_same_factor(self):
        # This is a cross-document regression pin, not a correctness claim.
        # It fails if one copy is edited without the other two.
        factors = published_redemption_factors(REPO_ROOT)
        self.assertEqual(len(set(factors.values())), 1)

    def test_sq_556_the_derived_break_even_is_thirty_micro_usdc_per_call(self):
        """SQ-556. The fixed factor has no normative per-call fee beneath it.

        The documents do fix the useful result: 100 calls avoid 0.003 USDC at
        a one-USDC gross, so the ratio crosses one at exactly 0.00003 USDC per
        call. A measured runtime fee may support severity, never this derivation.
        """
        threshold = avoidance_breakeven_call_fee(Fraction(1))
        self.assertEqual(threshold, Fraction(3, 100_000))
        self.assertEqual(
            redemption_fee_avoidance_ratio(
                Fraction(1), per_call_fee_usdc=threshold
            ),
            1,
        )
        finding = next(
            row
            for row in check_threat_cost_claims(REPO_ROOT)
            if row.key
            == "TH-64 fixed avoidance factor has a normative redeem-call fee basis"
        )
        self.assertEqual(finding.sq_id, "SQ-556")
        self.assertEqual(finding.derived, threshold)
        self.assertIsNotNone(finding.supporting_evidence)

    def test_ratio_is_linear_in_the_explicit_per_call_fee(self):
        threshold = avoidance_breakeven_call_fee(Fraction(1))
        self.assertEqual(
            redemption_fee_avoidance_ratio(
                Fraction(1), per_call_fee_usdc=threshold / 2
            ),
            Fraction(1, 2),
        )
        self.assertEqual(
            redemption_fee_avoidance_ratio(
                Fraction(1), per_call_fee_usdc=threshold * 2
            ),
            2,
        )

    def test_gross_cancels_at_exact_min_split_multiples(self):
        # This catches a per-call fee mistakenly applied once per whole payout.
        per_call_fee = Fraction(7, 1_000_000)
        self.assertEqual(
            redemption_fee_avoidance_ratio(
                Fraction(1), per_call_fee_usdc=per_call_fee
            ),
            redemption_fee_avoidance_ratio(
                Fraction(2), per_call_fee_usdc=per_call_fee
            ),
        )


class PositionDustingTests(unittest.TestCase):
    """TH-11's deposit incidence, reach, and both recovery paths."""

    def test_sq_556_third_party_deposit_incidence_is_inverted(self):
        """SQ-556. TH-11 says deposits make third-party dusting uneconomic.

        Before an explicit per-call fee, 64 dust transfers cost the attacker
        0.64 USDC while the recipient locks 6.4 USDC. Direct attacker outlay
        catches that forced lock only at 0.09 USDC per call; the specification
        supplies no normative transfer-call fee and prices the wrong party.
        """
        attacker, victim, recovery = dusting_cost(
            MAX_POSITIONS_PER_ACCOUNT, per_call_fee_usdc=Fraction(0)
        )
        threshold = dusting_breakeven_call_fee()
        self.assertEqual(attacker, Fraction(16, 25))
        self.assertEqual(victim, Fraction(32, 5))
        self.assertEqual(recovery, 0)
        self.assertEqual(threshold, Fraction(9, 100))
        self.assertLess(attacker, victim)
        at_threshold = dusting_cost(
            MAX_POSITIONS_PER_ACCOUNT, per_call_fee_usdc=threshold
        )
        self.assertEqual(at_threshold[0], at_threshold[1])
        finding = next(
            row
            for row in check_threat_cost_claims(REPO_ROOT)
            if row.key == "TH-11 attacker is charged the position deposit it cites"
        )
        self.assertEqual(finding.sq_id, "SQ-556")
        self.assertEqual(finding.derived, threshold)
        self.assertIsNotNone(finding.supporting_evidence)

    def test_attacker_deposits_are_peak_exposure_not_cumulative_cost(self):
        peak = attacker_peak_position_deposit(MAX_POSITIONS_PER_ACCOUNT)
        cumulative_wrong_reading = MAX_POSITIONS_PER_ACCOUNT * LEDGER_POSITION_DEPOSIT
        self.assertEqual(peak, Fraction(1, 10))
        self.assertEqual(cumulative_wrong_reading, Fraction(32, 5))
        self.assertLess(peak, cumulative_wrong_reading)

    def test_only_funded_non_protocol_accounts_are_reachable(self):
        # The transfer rejects protocol destinations, and recipient-side
        # deposits bound a 6.39-USDC account to 63 slots.
        self.assertEqual(dust_reach(Fraction(64, 10), recipient_is_protocol=True), 0)
        self.assertEqual(
            dust_reach(Fraction(639, 100), recipient_is_protocol=False), 63
        )
        self.assertEqual(
            dust_reach(Fraction(64, 10), recipient_is_protocol=False), 64
        )
        self.assertEqual(
            dust_reach(Fraction(100), recipient_is_protocol=False),
            MAX_POSITIONS_PER_ACCOUNT,
        )

    def test_fast_recovery_is_another_transfer_per_slot(self):
        per_transfer = Fraction(7, 1_000_000)
        _, _, recovery = dusting_cost(
            MAX_POSITIONS_PER_ACCOUNT, per_call_fee_usdc=per_transfer
        )
        self.assertEqual(recovery, MAX_POSITIONS_PER_ACCOUNT * per_transfer)
        self.assertGreater(recovery, 0)

    def test_archive_sweep_requires_terminal_delay_and_seeded_book_sweeps(self):
        # Each missing gate independently blocks the deposit-releasing path.
        for state in PROPOSAL_TERMINAL_STATES:
            with self.subTest(state=state):
                self.assertTrue(
                    sweep_recovery_eligible(
                        state,
                        LEDGER_ARCHIVE_DEFAULT,
                        seeded_books_swept=True,
                    )
                )
        self.assertFalse(
            sweep_recovery_eligible(
                "Resolved", LEDGER_ARCHIVE_DEFAULT, seeded_books_swept=True
            )
        )
        self.assertFalse(
            sweep_recovery_eligible(
                "Voided", LEDGER_ARCHIVE_DEFAULT - 1, seeded_books_swept=True
            )
        )
        self.assertFalse(
            sweep_recovery_eligible(
                "Voided", LEDGER_ARCHIVE_DEFAULT, seeded_books_swept=False
            )
        )

    def test_baseline_has_its_own_terminal_spelling(self):
        self.assertEqual(BASELINE_TERMINAL_STATES, frozenset({"Settled"}))
        self.assertTrue(
            sweep_recovery_eligible(
                "Settled",
                LEDGER_ARCHIVE_DEFAULT,
                seeded_books_swept=True,
                baseline=True,
            )
        )
        self.assertFalse(
            sweep_recovery_eligible(
                "ScalarSettled",
                LEDGER_ARCHIVE_DEFAULT,
                seeded_books_swept=True,
                baseline=True,
            )
        )

    def test_outlay_order_follows_the_explicit_fee_threshold(self):
        threshold = dusting_breakeven_call_fee()
        below = dusting_cost(64, per_call_fee_usdc=threshold - Fraction(1, 100))
        above = dusting_cost(64, per_call_fee_usdc=threshold + Fraction(1, 100))
        self.assertLess(below[0], below[1])
        self.assertGreater(above[0], above[1])


class IntakeMonopolizationTests(unittest.TestCase):
    """08 §7's strategy table and TH-16's stale copy."""

    def test_intake_denial_row_reproduces_exactly(self):
        outcome = intake_monopolization_cost("intake_denial")
        self.assertEqual(outcome.locked, Fraction(64_000))
        self.assertEqual(outcome.cost_per_epoch, Fraction(6_400))
        self.assertEqual(outcome.funded_accounts, 16)

    def test_slot_capture_row_reproduces_its_lower_bound(self):
        outcome = intake_monopolization_cost("slot_capture")
        self.assertEqual(outcome.locked, Fraction(125_000))
        self.assertEqual(outcome.cost_per_epoch, Fraction(12_500))
        self.assertEqual(outcome.funded_accounts, 2)

    def test_combined_row_reproduces_exactly(self):
        outcome = intake_monopolization_cost("combined")
        self.assertEqual(outcome.locked, Fraction(189_000))
        self.assertEqual(outcome.cost_per_epoch, Fraction(18_900))
        self.assertEqual(outcome.funded_accounts, 16)

    def test_refund_path_reproduces_the_fee_floor(self):
        outcome = intake_monopolization_cost("refund_path")
        self.assertEqual(outcome.locked, Fraction(3_000_000))
        self.assertEqual(outcome.cost_per_epoch, Fraction(18_000))
        self.assertLess(
            outcome.cost_per_epoch,
            intake_monopolization_cost("combined").cost_per_epoch,
        )

    def test_queue_occupancy_requires_sixteen_funded_accounts(self):
        self.assertEqual(queue_occupancy(15), 60)
        self.assertLess(queue_occupancy(15), INTAKE_QUEUE)
        self.assertEqual(queue_occupancy(16), INTAKE_QUEUE)
        self.assertEqual(
            funded_accounts_required(INTAKE_QUEUE, INTAKE_MAX_PER_ACCOUNT), 16
        )

    def test_pre_review_time_value_reproduces_the_published_rounding(self):
        combined = capital_time_value(PRE_REVIEW_COMBINED_LOCKED)
        intake = capital_time_value(PRE_REVIEW_INTAKE_LOCKED)
        self.assertEqual(
            combined,
            PRE_REVIEW_COMBINED_LOCKED
            * ANNUAL_DISCOUNT_RATE
            * Fraction(EPOCH_DAYS, DAYS_PER_YEAR),
        )
        self.assertEqual(int(combined + Fraction(1, 2)), 314)
        self.assertEqual(int(intake + Fraction(1, 2)), 92)
        current_multiple = intake_monopolization_cost("combined").cost_per_epoch / 314
        self.assertGreater(current_multiple, 60)
        self.assertLess(current_multiple, 61)

    def test_sq_556_th16_uses_the_superseded_bond_total(self):
        """SQ-556. TH-16 disagrees with 08 §7's derived combined cost.

        The derived side is 10 percent of the live combined locked capital.
        TH-16's lower source value is conservative—the real attack is dearer—
        but violates doc 14 §1's requirement that row constants are normative.
        """
        published = published_intake_forfeits(REPO_ROOT)
        derived = intake_monopolization_cost("combined").cost_per_epoch
        self.assertEqual(
            derived,
            intake_monopolization_cost("combined").locked
            * DEFAULT_INTAKE_PARAMS.slash_fraction,
        )
        self.assertEqual(derived, published.treasury_section_7)
        finding = next(
            row
            for row in check_threat_cost_claims(REPO_ROOT)
            if row.key == "TH-16 agrees with 08 §7 combined recurring cost"
        )
        self.assertEqual(finding.sq_id, "SQ-556")
        self.assertEqual(finding.derived, derived)

    def test_costs_follow_amended_inputs_instead_of_freezing_table_values(self):
        # Halving the queue and doubling the slash changes every affected term;
        # hardcoded 64/10% table outputs fail this variant.
        amended = replace(
            DEFAULT_INTAKE_PARAMS, intake_queue=32, slash_fraction=Fraction(1, 5)
        )
        outcome = intake_monopolization_cost("combined", amended)
        self.assertEqual(outcome.locked, Fraction(157_000))
        self.assertEqual(outcome.cost_per_epoch, Fraction(31_400))
        self.assertEqual(outcome.funded_accounts, 8)


class RefusalTests(unittest.TestCase):
    """Invalid inputs fail closed rather than producing a reassuring zero."""

    def test_negative_fee_rate_refuses(self):
        weight = observed_call_weight(REPO_ROOT, "redeem_scalar")
        with self.assertRaises(ThreatCostError):
            transaction_fee_usdc(Fraction(-1), weight)

    def test_position_count_beyond_the_kernel_cap_refuses(self):
        with self.assertRaises(ThreatCostError):
            dusting_cost(
                MAX_POSITIONS_PER_ACCOUNT + 1, per_call_fee_usdc=Fraction(0)
            )

    def test_negative_parametric_call_fees_refuse(self):
        with self.assertRaises(ThreatCostError):
            redemption_fee_avoidance_ratio(
                Fraction(1), per_call_fee_usdc=Fraction(-1)
            )
        with self.assertRaises(ThreatCostError):
            dusting_cost(1, per_call_fee_usdc=Fraction(-1))

    def test_archive_delay_outside_its_registry_bounds_refuses(self):
        with self.assertRaises(ThreatCostError):
            sweep_recovery_eligible(
                "Voided", LEDGER_ARCHIVE_MIN - 1, seeded_books_swept=True,
                archive_delay=LEDGER_ARCHIVE_MIN - 1,
            )

    def test_unknown_intake_strategy_refuses(self):
        with self.assertRaises(ThreatCostError):
            intake_monopolization_cost("wishful_thinking")

    def test_document_extractors_refuse_the_wrong_root(self):
        with self.assertRaises(FileNotFoundError):
            published_redemption_factors(REPO_ROOT / "not-a-repository")

    def test_ceil_refuses_negative_cost(self):
        with self.assertRaises(ThreatCostError):
            ceil_fraction(Fraction(-1, 2))


if __name__ == "__main__":
    unittest.main()
