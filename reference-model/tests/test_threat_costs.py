"""Pins doc 14's attack-cost arithmetic and exposes its three red claims.

The suite derives every cost from 03/08/13 inputs, reads the published TH-64
and TH-16 figures from the documents, and checks the two committed call weights
used to price the live attacks. A false threat-model claim is asserted as the
false value it actually has and is also returned by `check_threat_cost_claims`.
"""

import unittest
from dataclasses import replace
from fractions import Fraction
from pathlib import Path

from bleavit_reference_model.threat_costs import (
    ANNUAL_DISCOUNT_RATE,
    BASELINE_TERMINAL_STATES,
    DAYS_PER_YEAR,
    DEFAULT_EXTRINSIC_LENGTH,
    DEFAULT_INTAKE_PARAMS,
    EPOCH_DAYS,
    FEE_VIT_USDC_RATE_MAX,
    FEE_VIT_USDC_RATE_MIN,
    FEE_VIT_USDC_RATE_REF,
    INTAKE_MAX_PER_ACCOUNT,
    INTAKE_QUEUE,
    LEDGER_ARCHIVE_DEFAULT,
    LEDGER_ARCHIVE_MIN,
    LEDGER_MIN_SPLIT,
    LEDGER_POSITION_DEPOSIT,
    MAX_POSITIONS_PER_ACCOUNT,
    PRE_REVIEW_COMBINED_LOCKED,
    PRE_REVIEW_INTAKE_LOCKED,
    PROPOSAL_TERMINAL_STATES,
    REDEEM_SCALAR_WEIGHT,
    TRANSFER_WEIGHT,
    ThreatCostError,
    attacker_peak_position_deposit,
    avoidance_breakeven_vit_usdc_rate,
    capital_time_value,
    ceil_fraction,
    check_threat_cost_claims,
    dust_reach,
    dusting_cost,
    funded_accounts_required,
    generated_call_weight,
    intake_monopolization_cost,
    published_intake_forfeits,
    published_redemption_factors,
    queue_occupancy,
    raw_transaction_fee_usdc,
    redemption_fee_avoidance_ratio,
    sweep_recovery_eligible,
    transaction_fee_usdc,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


class CommittedWeightTests(unittest.TestCase):
    """The attacks are priced from the extrinsics they actually dispatch."""

    def test_redeem_scalar_weight_matches_the_generated_function(self):
        # A regenerated redeem_scalar weight must force this model to be
        # revisited; silently retaining a stale fee recreates TH-64's defect.
        self.assertEqual(
            generated_call_weight(REPO_ROOT, "redeem_scalar"), REDEEM_SCALAR_WEIGHT
        )
        self.assertEqual(REDEEM_SCALAR_WEIGHT.dispatch_ref_time(), 4_857_520_000)
        self.assertEqual(REDEEM_SCALAR_WEIGHT.fee_plancks(), 5_318_069_120)

    def test_transfer_weight_matches_the_generated_function(self):
        # TH-11 is a transfer attack, not a crank. This fails if the transfer
        # benchmark moves while the incidence model stays stale.
        self.assertEqual(generated_call_weight(REPO_ROOT, "transfer"), TRANSFER_WEIGHT)
        self.assertEqual(TRANSFER_WEIGHT.dispatch_ref_time(), 6_618_020_000)
        self.assertEqual(TRANSFER_WEIGHT.fee_plancks(), 7_078_569_120)

    def test_usdc_conversion_rounds_up_against_the_fee_payer(self):
        raw = raw_transaction_fee_usdc(
            FEE_VIT_USDC_RATE_REF, REDEEM_SCALAR_WEIGHT
        )
        charged = transaction_fee_usdc(
            FEE_VIT_USDC_RATE_REF, REDEEM_SCALAR_WEIGHT
        )
        self.assertEqual(raw, Fraction(8_309_483, 31_250_000_000))
        self.assertEqual(charged, Fraction(133, 500_000))  # 266 micro-USDC.
        self.assertGreater(charged, raw)

    def test_the_documented_approximate_length_does_not_move_evaluated_micro_fee(self):
        # 08 §6.2 says "~120 B" rather than publishing each call's SCALE
        # length. At both evaluated rates, even a 1,000-byte bracket stays in
        # the same micro-USDC bucket; the unresolved byte count cannot change
        # either red finding.
        for rate, expected in (
            (FEE_VIT_USDC_RATE_REF, Fraction(266, 1_000_000)),
            (FEE_VIT_USDC_RATE_MIN, Fraction(27, 1_000_000)),
        ):
            with self.subTest(rate=rate):
                self.assertEqual(
                    transaction_fee_usdc(rate, REDEEM_SCALAR_WEIGHT, 0), expected
                )
                self.assertEqual(
                    transaction_fee_usdc(rate, REDEEM_SCALAR_WEIGHT, 1_000),
                    expected,
                )


class RedemptionFeeAvoidanceTests(unittest.TestCase):
    """TH-64 and its two normative copies, repriced from redeem_scalar."""

    def test_all_three_documents_publish_the_same_factor(self):
        # This is a cross-document regression pin, not a correctness claim.
        # It fails if one copy is edited without the other two.
        factors = published_redemption_factors(REPO_ROOT)
        self.assertEqual(factors.values(), (Fraction(1_000),) * 3)

    def test_sq_556_the_published_default_factor_is_overstated_by_113_times(self):
        """SQ-556. Three normative texts publish ~1,000x; execution gives 8.8667x.

        100 `redeem_scalar` calls cost 0.0266 USDC at the documented reference
        rate and avoid 0.003 USDC. Overstating the attacker's cost is unsafe:
        TH-64 says this arithmetic is the mitigation and supplies no rule.
        """
        ratio = redemption_fee_avoidance_ratio(Fraction(1))
        self.assertEqual(ratio, Fraction(133, 15))
        self.assertLess(ratio, Fraction(1_000))
        finding = next(
            row
            for row in check_threat_cost_claims(REPO_ROOT)
            if row.key == "TH-64 published default avoidance factor"
        )
        self.assertFalse(finding.ok)
        self.assertEqual(finding.actual, ratio)

    def test_sq_556_the_lawful_rate_floor_makes_avoidance_profitable(self):
        """SQ-556. TH-64 claims its rate envelope bounds degradation; it does not.

        At the exact 08 §9 floor, one `redeem_scalar` costs 27 micro-USDC.
        One hundred calls cost 0.0027 USDC to avoid 0.003, so the ratio is 0.9
        and the griefer retains 0.0003 USDC before any off-chain value.
        """
        ratio = redemption_fee_avoidance_ratio(
            Fraction(1), vit_usdc_rate=FEE_VIT_USDC_RATE_MIN
        )
        self.assertEqual(ratio, Fraction(9, 10))
        self.assertLess(ratio, 1)
        finding = next(
            row
            for row in check_threat_cost_claims(REPO_ROOT)
            if row.key
            == "TH-64 ratio exceeds one across fee.vit_usdc_rate envelope"
        )
        self.assertFalse(finding.ok)

    def test_breakeven_is_inside_the_lawful_envelope(self):
        rate = avoidance_breakeven_vit_usdc_rate()
        self.assertEqual(rate, Fraction(46_875, 8_309_483))
        self.assertLess(FEE_VIT_USDC_RATE_MIN, rate)
        self.assertLess(rate, FEE_VIT_USDC_RATE_REF)
        self.assertEqual(
            redemption_fee_avoidance_ratio(Fraction(1), vit_usdc_rate=rate), 1
        )

    def test_ratio_is_monotone_in_the_vit_usdc_rate(self):
        floor = redemption_fee_avoidance_ratio(
            Fraction(1), vit_usdc_rate=FEE_VIT_USDC_RATE_MIN
        )
        reference = redemption_fee_avoidance_ratio(Fraction(1))
        ceiling = redemption_fee_avoidance_ratio(
            Fraction(1), vit_usdc_rate=FEE_VIT_USDC_RATE_MAX
        )
        self.assertLess(floor, reference)
        self.assertLess(reference, ceiling)
        self.assertGreater(ceiling, 1)

    def test_gross_cancels_at_exact_min_split_multiples(self):
        # This catches a per-call fee mistakenly applied once per whole payout.
        self.assertEqual(
            redemption_fee_avoidance_ratio(Fraction(1)),
            redemption_fee_avoidance_ratio(Fraction(2)),
        )


class PositionDustingTests(unittest.TestCase):
    """TH-11's deposit incidence, reach, and both recovery paths."""

    def test_sq_556_third_party_deposit_incidence_is_inverted(self):
        """SQ-556. TH-11 says deposits make third-party dusting uneconomic.

        At 64 slots the attacker spends 0.662656 USDC while the non-consenting
        recipient locks 6.4 USDC. The attacker spends less than one ninth of
        the forced victim outlay; the deposit prices the wrong party.
        """
        attacker, victim, recovery = dusting_cost(MAX_POSITIONS_PER_ACCOUNT)
        self.assertEqual(attacker, Fraction(10_354, 15_625))  # 0.662656.
        self.assertEqual(victim, Fraction(32, 5))  # 6.4.
        self.assertEqual(recovery, Fraction(354, 15_625))  # 0.022656.
        self.assertLess(attacker, victim)
        finding = next(
            row
            for row in check_threat_cost_claims(REPO_ROOT)
            if row.key == "TH-11 attacker outlay covers victim deposit outlay"
        )
        self.assertFalse(finding.ok)

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
        _, _, recovery = dusting_cost(MAX_POSITIONS_PER_ACCOUNT)
        per_transfer = transaction_fee_usdc(FEE_VIT_USDC_RATE_REF, TRANSFER_WEIGHT)
        self.assertEqual(per_transfer, Fraction(177, 500_000))
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

    def test_defect_survives_at_both_rate_envelope_ends(self):
        for rate in (FEE_VIT_USDC_RATE_MIN, FEE_VIT_USDC_RATE_MAX):
            with self.subTest(rate=rate):
                attacker, victim, _ = dusting_cost(64, vit_usdc_rate=rate)
                self.assertLess(attacker, victim)


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
        self.assertLess(outcome.cost_per_epoch, intake_monopolization_cost("combined").cost_per_epoch)

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
        """SQ-556. TH-16 publishes 10,900 while 08 §7 derives 18,900.

        The row's figure is exactly ten percent of its superseded 109,000-USDC
        locked total, not ten percent of the live 189,000 total. This direction
        is conservative—the real attack is dearer—but violates doc 14 §1's
        requirement that row constants are normative values.
        """
        published = published_intake_forfeits(REPO_ROOT)
        derived = intake_monopolization_cost("combined").cost_per_epoch
        self.assertEqual(published.threat_row_16, Fraction(10_900))
        self.assertEqual(published.treasury_section_7, Fraction(18_900))
        self.assertEqual(
            published.threat_row_16,
            PRE_REVIEW_COMBINED_LOCKED * DEFAULT_INTAKE_PARAMS.slash_fraction,
        )
        self.assertEqual(derived, published.treasury_section_7)
        self.assertLess(published.threat_row_16, derived)
        finding = next(
            row
            for row in check_threat_cost_claims(REPO_ROOT)
            if row.key == "TH-16 agrees with 08 §7 combined recurring cost"
        )
        self.assertFalse(finding.ok)

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
        with self.assertRaises(ThreatCostError):
            transaction_fee_usdc(Fraction(-1), REDEEM_SCALAR_WEIGHT)

    def test_position_count_beyond_the_kernel_cap_refuses(self):
        with self.assertRaises(ThreatCostError):
            dusting_cost(MAX_POSITIONS_PER_ACCOUNT + 1)

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
