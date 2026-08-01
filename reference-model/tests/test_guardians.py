"""Pins 06 §5 and §6.3's guardian arithmetic to an executable derivation.

The suite prices the VIT bond across 13 §1's lawful rate envelope, executes the
fixed-slash liability ladder, composes the review deadline with every recall
track stage, and checks the freeze-renewal window against the same complete
track. Published figures are regression pins only after their inputs have been
derived; the zero-bond finding asserts the state that actually exists rather
than encoding the missing check as though it were present.
"""

from decimal import Decimal
from fractions import Fraction
import unittest

from bleavit_reference_model.guardians import (
    EPOCH_LENGTH_DAYS_MAX,
    GUARDIAN_BOND_VIT,
    GUARDIAN_SEATS,
    GUARDIAN_THRESHOLD,
    GUARDIAN_TRACK,
    LEDGER_FREEZE_RENEWALS,
    PLAYBOOK_FREEZE_WINDOW_DAYS,
    REVIEW_DEADLINE_EPOCHS_MAX,
    VIT_USDC_RATE_MAX,
    VIT_USDC_RATE_MIN,
    VIT_USDC_RATE_REF,
    GuardianDerivationError,
    accountability_findings,
    activation_freeze_budget,
    bond_stack,
    capture_run,
    incident_freeze_budget,
    lawful_bond_stack_envelope,
    lifetime_liability,
    member_can_propose_or_approve,
    renewal_record_available,
    renewal_slack,
    seat_bond_usdc,
)

D = Decimal


class BondPricingTests(unittest.TestCase):
    """06 §5.1's VIT bond, priced through 13 §1's USDC rate."""

    def test_launch_placeholder_reproduces_seat_coalition_and_set_values(self):
        # 50,000 VIT × the documented [VERIFY] placeholder 0.05 USDC/VIT.
        stack = bond_stack(VIT_USDC_RATE_REF)
        self.assertEqual(stack.seat_usdc, D("2500.000000"))
        self.assertEqual(stack.approving_coalition_usdc, D("12500.000000"))
        self.assertEqual(stack.full_set_usdc, D("17500.000000"))
        self.assertEqual(GUARDIAN_THRESHOLD, 5)
        self.assertEqual(GUARDIAN_SEATS, 7)

    def test_lawful_rate_envelope_prices_exact_extrema(self):
        low, high = lawful_bond_stack_envelope()
        self.assertEqual(VIT_USDC_RATE_MIN, D("0.005"))
        self.assertEqual(VIT_USDC_RATE_MAX, D("0.50"))
        self.assertEqual(low.seat_usdc, D("250.000000"))
        self.assertEqual(low.full_set_usdc, D("1750.000000"))
        self.assertEqual(high.seat_usdc, D("25000.000000"))
        self.assertEqual(high.full_set_usdc, D("175000.000000"))

    def test_bond_value_is_linear_through_the_rate_envelope(self):
        # Fails if an implementation clamps the endpoints or prices only the
        # placeholder instead of accepting the live 13 §1 rate.
        rates = (
            VIT_USDC_RATE_MIN,
            D("0.0125"),
            VIT_USDC_RATE_REF,
            D("0.2"),
            VIT_USDC_RATE_MAX,
        )
        values = [seat_bond_usdc(rate) for rate in rates]
        self.assertEqual(values, sorted(values))
        for rate, value in zip(rates, values):
            with self.subTest(rate=rate):
                self.assertEqual(
                    value,
                    (D(GUARDIAN_BOND_VIT) * rate).quantize(D("0.000001")),
                )

    def test_conversion_rounds_down_against_the_collateral_claimant(self):
        # 50,000 × 0.000000019 = 0.000950 USDC exactly. A coarser example
        # catches claimant-favouring rounding up to the next micro-USDC.
        self.assertEqual(seat_bond_usdc(D("0.000000000019")), D("0.000000"))

    def test_guardians_have_no_directly_movable_fund_value(self):
        # 06 §5.2's kernel prohibitions are why no invented "bond must exceed
        # action value" invariant belongs here.
        stack = bond_stack()
        self.assertEqual(stack.directly_movable_usdc, D("0.000000"))
        self.assertGreater(stack.full_set_usdc, stack.directly_movable_usdc)

    def test_non_positive_rate_refuses(self):
        for bad in (D(0), D("-0.01")):
            with self.subTest(rate=bad), self.assertRaises(GuardianDerivationError):
                seat_bond_usdc(bad)


class LiabilityDepletionTests(unittest.TestCase):
    """06 §5.4(3)'s fixed slash, saturation, and membership-only gate."""

    def test_constant_slash_exhausts_the_bond_after_two_failures(self):
        ladder = [lifetime_liability(n) for n in range(4)]
        self.assertEqual(
            [row.remaining_bond_vit for row in ladder], [50_000, 25_000, 0, 0]
        )
        self.assertEqual(
            [row.cumulative_slashed_vit for row in ladder],
            [0, 25_000, 50_000, 50_000],
        )
        self.assertEqual(
            [row.next_failure_slash_vit for row in ladder], [25_000, 25_000, 0, 0]
        )
        self.assertTrue(ladder[2].exhausted)

    def test_lifetime_accountability_is_2500_per_seat_and_12500_per_coalition(self):
        exhausted = lifetime_liability(2)
        per_seat = (
            seat_bond_usdc()
            * D(exhausted.cumulative_slashed_vit)
            / D(GUARDIAN_BOND_VIT)
        )
        coalition = per_seat * D(GUARDIAN_THRESHOLD)
        self.assertEqual(per_seat, D("2500.000000"))
        self.assertEqual(coalition, D("12500.000000"))
        # 6,250 is one review's coalition slash, not lifetime accountability.
        one_failure = seat_bond_usdc() * D("0.5") * D(GUARDIAN_THRESHOLD)
        self.assertEqual(one_failure, D("6250.0000000"))
        self.assertEqual(coalition, one_failure * 2)

    def test_liability_is_monotone_but_its_marginal_cost_reaches_zero(self):
        rows = [lifetime_liability(n) for n in range(8)]
        self.assertEqual(
            [row.cumulative_slashed_vit for row in rows],
            sorted(row.cumulative_slashed_vit for row in rows),
        )
        self.assertEqual(rows[2].next_failure_slash_vit, 0)
        self.assertEqual(rows[-1].cumulative_slashed_vit, GUARDIAN_BOND_VIT)

    def test_sq_558_zero_bond_member_keeps_action_weight_if_recall_does_not_enact(self):
        """SQ-558. Two failed reviews exhaust the fixed seat bond.

        Each failure auto-schedules recall, so reaching the third requires the
        values layer to have declined or failed to enact both recalls. In that
        surviving state §5.1 and the shipped calls test membership only: the
        zero-bond member can still propose and approve, and failure three has
        zero marginal slash.
        """
        exhausted = lifetime_liability(2)
        self.assertEqual(exhausted.remaining_bond_vit, 0)
        self.assertEqual(exhausted.next_failure_slash_vit, 0)
        self.assertTrue(
            member_can_propose_or_approve(
                is_member=True, remaining_bond_vit=exhausted.remaining_bond_vit
            )
        )
        findings = {finding.key: finding for finding in accountability_findings(2)}
        self.assertFalse(findings["remaining liability after repeated review failures"].ok)
        self.assertFalse(findings["action eligibility requires remaining liability"].ok)

    def test_non_member_still_cannot_act(self):
        self.assertFalse(
            member_can_propose_or_approve(is_member=False, remaining_bond_vit=50_000)
        )

    def test_invalid_liability_inputs_refuse(self):
        for bad in (-1, True, D(2)):
            with self.subTest(failures=bad), self.assertRaises(GuardianDerivationError):
                lifetime_liability(bad)  # type: ignore[arg-type]


class RecallLatencyTests(unittest.TestCase):
    """Review deadline plus every guardian-track recall stage."""

    def test_guardian_track_latency_includes_confirmation(self):
        self.assertEqual(GUARDIAN_TRACK.prepare_days, 1)
        self.assertEqual(GUARDIAN_TRACK.decision_days, 7)
        self.assertEqual(GUARDIAN_TRACK.confirm_days, 1)
        self.assertEqual(GUARDIAN_TRACK.enactment_days, 2)
        self.assertEqual(GUARDIAN_TRACK.latency_days, 11)

    def test_shipped_default_worst_case_is_74_days_or_74_over_21_cycles(self):
        run = capture_run()
        self.assertEqual(run.review_wait_days, 63)
        self.assertEqual(run.recall_track_days, 11)
        self.assertEqual(run.obstruction_days, 74)
        self.assertEqual(run.obstruction_cycles, Fraction(74, 21))

    def test_exact_duration_deadline_would_reduce_default_to_53_days(self):
        strict = capture_run()
        exact = capture_run(deadline_mode="exact-duration")
        self.assertEqual(exact.review_wait_days, 42)
        self.assertEqual(exact.obstruction_days, 53)
        self.assertEqual(strict.obstruction_days - exact.obstruction_days, 21)

    def test_lawful_maximum_is_221_days_or_221_over_42_cycles(self):
        run = capture_run(REVIEW_DEADLINE_EPOCHS_MAX, EPOCH_LENGTH_DAYS_MAX)
        self.assertEqual(run.review_wait_days, 210)
        self.assertEqual(run.obstruction_days, 221)
        self.assertEqual(run.obstruction_cycles, Fraction(221, 42))

    def test_lawful_box_extrema_are_39_and_221_days(self):
        runs = [
            capture_run(review, epoch)
            for review in range(1, REVIEW_DEADLINE_EPOCHS_MAX + 1)
            for epoch in (14, 21, 42)
        ]
        self.assertEqual(min(run.obstruction_days for run in runs), 39)
        self.assertEqual(max(run.obstruction_days for run in runs), 221)

    def test_out_of_range_timing_inputs_refuse(self):
        for args in ((0, 21), (5, 21), (2, 13), (2, 43)):
            with self.subTest(args=args), self.assertRaises(GuardianDerivationError):
                capture_run(*args)
        with self.assertRaises(GuardianDerivationError):
            capture_run(deadline_mode="inclusive")  # type: ignore[arg-type]


class LedgerFreezeRenewalTests(unittest.TestCase):
    """06 §6.3's first-window sufficiency and per-activation budget."""

    def test_complete_renewal_path_leaves_three_days_not_seven(self):
        # The parenthetical's decision-only fact is true (7 < 14), but it is
        # not the operative submission-to-enactment calculation.
        self.assertLess(GUARDIAN_TRACK.decision_days, PLAYBOOK_FREEZE_WINDOW_DAYS)
        self.assertEqual(GUARDIAN_TRACK.latency_days, 11)
        self.assertEqual(renewal_slack(), 3)

    def test_shorter_window_exposes_negative_slack(self):
        self.assertEqual(renewal_slack(10), -1)
        self.assertLess(renewal_slack(10), 0)

    def test_expired_record_is_unavailable_to_late_renewal(self):
        self.assertTrue(renewal_record_available(Fraction(14) - Fraction(1, 10), 14))
        self.assertFalse(renewal_record_available(14, 14))
        self.assertFalse(renewal_record_available(15, 14))

    def test_one_activation_and_renewal_has_a_28_day_budget(self):
        self.assertEqual(LEDGER_FREEZE_RENEWALS, 1)
        self.assertEqual(activation_freeze_budget(0), 14)
        self.assertEqual(activation_freeze_budget(1), 28)
        with self.assertRaises(GuardianDerivationError):
            activation_freeze_budget(2)

    def test_28_days_is_not_a_per_incident_bound(self):
        """SQ-558. The prose's "total freeze duration" is under-qualified.

        One active record has a 28-day upper budget, but expiry removes it and
        a fresh 5-of-7 activation resets ``renewals_used``. With the I-4
        trigger still live, two successive records have a 56-day aggregate
        upper budget; neither §6.2 nor §6.3 publishes an incident-wide
        activation count.
        """
        self.assertEqual(incident_freeze_budget(1), 28)
        self.assertEqual(incident_freeze_budget(2), 56)
        self.assertGreater(incident_freeze_budget(2), activation_freeze_budget())

    def test_invalid_playbook_inputs_refuse(self):
        for call in (
            lambda: renewal_slack(0),
            lambda: renewal_record_available(-1, 14),
            lambda: activation_freeze_budget(True),
            lambda: incident_freeze_budget(-1),
        ):
            with self.assertRaises(GuardianDerivationError):
                call()


if __name__ == "__main__":
    unittest.main()
