"""Executes D-1 payouts and a named, non-normative pricing sensitivity.

D-1's half/quarter redemption schedule is normative. Every ``pi``/``w``
calculation below is conditional on an explicit risk-neutral quote-convergence
scenario that the documents do not establish. SQ-559 remains useful as a
sensitivity, while the findings accessor reports no mechanical contradiction.
"""

import unittest
from fractions import Fraction

from bleavit_reference_model.void_pricing import (
    BASELINE_NEUTRAL_SCORE,
    D1_SCHEDULE,
    DEC_DELTA_TRS,
    DEC_SIGMA_TRS,
    EXAMPLE_BASELINE,
    EXAMPLE_FULL_ACCEPT,
    EXAMPLE_FULL_REJECT,
    EXAMPLE_GATE_SECURITY,
    EXAMPLE_GATE_SURVIVAL,
    EXAMPLE_TRAILING_ACCEPT,
    EXAMPLE_TRAILING_REJECT,
    GATE_EPS,
    GATE_P_MAX,
    GateConditionalValues,
    PricingInputs,
    PricingRefused,
    RiskNeutralQuoteScenario,
    VoidSchedule,
    baseline_neutral_price as _baseline_neutral_price,
    branch_information_weight as _branch_information_weight,
    check_weight_safety,
    degenerate_branch_price as _degenerate_branch_price,
    degenerate_reject_probability_boundary as _degenerate_reject_probability_boundary,
    leg_price as _leg_price,
    price_readout,
    search_false_adopt,
    search_false_adopt_interval,
    symmetric_hurdle_boundary as _symmetric_hurdle_boundary,
    veto_breach_ratio as _veto_breach_ratio,
    void_probability_from_ratio,
    worked_example_boundaries as _worked_example_boundaries,
)


F = Fraction


def quote_scenario(
    pi: Fraction, *, converges: bool = True
) -> RiskNeutralQuoteScenario:
    """Build the explicit non-normative premise used by sensitivity tests."""
    return RiskNeutralQuoteScenario(
        void_probability=pi,
        quotes_converge_to_expected_value_ratio=converges,
    )


def leg_price(q: Fraction, pi: Fraction, w: Fraction) -> Fraction:
    return _leg_price(q, quote_scenario(pi), w)


def branch_information_weight(pi: Fraction, w: Fraction) -> Fraction:
    return _branch_information_weight(quote_scenario(pi), w)


def baseline_neutral_price(q: Fraction, pi: Fraction) -> Fraction:
    return _baseline_neutral_price(q, quote_scenario(pi))


def degenerate_branch_price(pi: Fraction) -> Fraction:
    return _degenerate_branch_price(quote_scenario(pi))


def veto_breach_ratio(
    q: Fraction, p_max: Fraction = GATE_P_MAX
) -> Fraction | None:
    return _veto_breach_ratio(
        q,
        p_max,
        quotes_converge_to_expected_value_ratio=True,
    )


def symmetric_hurdle_boundary(
    q_accept: Fraction, q_reject: Fraction, delta: Fraction
) -> Fraction | None:
    return _symmetric_hurdle_boundary(
        q_accept,
        q_reject,
        delta,
        quotes_converge_to_expected_value_ratio=True,
    )


def worked_example_boundaries():
    return _worked_example_boundaries(
        quotes_converge_to_expected_value_ratio=True
    )


def degenerate_reject_probability_boundary(
    pi: Fraction, delta: Fraction
) -> Fraction:
    return _degenerate_reject_probability_boundary(
        pi,
        delta,
        quotes_converge_to_expected_value_ratio=True,
    )


def asymmetric_inputs() -> PricingInputs:
    """A gate-clearing exact witness built from §12's two gate pairs."""
    return PricingInputs(
        decision_accept=F(2, 5),
        decision_reject=F(91, 250),
        baseline=F(91, 250),
        scenario=quote_scenario(F(1, 50)),
        gates=(
            GateConditionalValues("S", *EXAMPLE_GATE_SURVIVAL),
            GateConditionalValues("C", *EXAMPLE_GATE_SECURITY),
        ),
    )


class TestD1Schedule(unittest.TestCase):
    """00 D-1 / 03 §6.4, derived before any market arithmetic."""

    def test_quarter_over_half_is_the_void_redemption_value_ratio(self):
        # The ratio is not an asserted quote: it is the quotient of the two
        # independently specified D-1 redemption claims.
        self.assertEqual(D1_SCHEDULE.branch_value, F(1, 2))
        self.assertEqual(D1_SCHEDULE.leg_value, F(1, 4))
        self.assertEqual(
            D1_SCHEDULE.leg_value / D1_SCHEDULE.branch_value, F(1, 2)
        )
        self.assertEqual(D1_SCHEDULE.leg_value_in_branch_units, F(1, 2))

    def test_integer_redemption_rounds_against_the_claimant(self):
        # `floor(3/2) = 1` and `floor(3/4) = 0`; rounding either up would make
        # the claimant's aggregate entitlement exceed D-1's valuation.
        self.assertEqual(D1_SCHEDULE.payout(3, "branch_usdc"), 1)
        self.assertEqual(D1_SCHEDULE.payout(3, "leg"), 0)
        for amount in range(20):
            self.assertLessEqual(
                D1_SCHEDULE.payout(amount, "branch_usdc"), F(amount, 2)
            )
            self.assertLessEqual(D1_SCHEDULE.payout(amount, "leg"), F(amount, 4))

    def test_no_void_recovers_the_true_conditional_price(self):
        for q in (F(0), F(1, 100), F(2, 5), F(1)):
            for w in (F(1, 1_000), F(1, 2), F(1)):
                with self.subTest(q=q, w=w):
                    self.assertEqual(leg_price(q, F(0), w), q)

    def test_risk_neutral_sensitivity_is_an_exact_blend(self):
        # This verifies the named scenario equation, not a D-1 quote rule.
        q, pi, w = F(7, 20), F(3, 100), F(2, 5)
        information = branch_information_weight(pi, w)
        derived = (
            information * q
            + (1 - information) * D1_SCHEDULE.leg_value_in_branch_units
        )
        self.assertEqual(leg_price(q, pi, w), derived)
        self.assertGreater(leg_price(q, pi, w), q)  # q < 1/2: pull is upward.

    def test_nonzero_void_probability_puts_a_positive_floor_under_every_weight(self):
        # A zero-valued fact cannot price at zero once VOID carries claim mass.
        for pi in (F(1, 1_000_000), F(1, 100), F(1, 2), F(1)):
            for w in (F(0), F(1, 1_000), F(1, 2), F(1)):
                with self.subTest(pi=pi, w=w):
                    self.assertGreater(leg_price(F(0), pi, w), 0)

    def test_complementary_legs_still_sum_to_one_in_one_book(self):
        # The price floor must not manufacture value inside a YES/NO or
        # LONG/SHORT complete set; D-1 values the two legs at one bUSDC.
        for q in (F(0), F(1, 10), F(1, 2), F(9, 10), F(1)):
            for pi, w in ((F(1, 100), F(1, 5)), (F(1, 4), F(4, 5))):
                with self.subTest(q=q, pi=pi, w=w):
                    self.assertEqual(
                        leg_price(q, pi, w) + leg_price(1 - q, pi, w), F(1)
                    )

    def test_undefined_or_inexact_prices_refuse(self):
        # With no realization and no VOID the numeraire is worthless; treating
        # that as price zero would be a noisy-pass fallback.
        with self.assertRaises(PricingRefused):
            leg_price(F(1, 2), F(0), F(0))
        with self.assertRaises(PricingRefused):
            branch_information_weight(F(0), F(0))
        with self.assertRaises(PricingRefused):
            leg_price(0.4, F(1, 100), F(1, 2))
        with self.assertRaises(PricingRefused):
            leg_price(F(1, 2), F(101, 100), F(1, 2))
        with self.assertRaises(PricingRefused):
            VoidSchedule(branch_value=F(1, 4), leg_value=F(1, 2))
        with self.assertRaises(PricingRefused):
            VoidSchedule(branch_value=0.5, leg_value=0.25)


class TestGateVetoBoundary(unittest.TestCase):
    """04 §9 / 05 §5.1 absolute-veto sensitivity."""

    def test_published_gate_values_reproduce_the_exact_mass_ratios(self):
        # Equality in `(q+r/4)/(1+r/2) = 0.05`, derived from D-1.
        self.assertEqual(veto_breach_ratio(F(0)), F(2, 9))
        self.assertEqual(veto_breach_ratio(F(11, 1_000)), F(13, 75))
        self.assertEqual(veto_breach_ratio(F(17, 1_000)), F(11, 75))

    def test_equal_branch_weights_reproduce_the_void_probabilities(self):
        self.assertEqual(void_probability_from_ratio(F(2, 9), F(1, 2)), F(1, 10))
        self.assertEqual(
            void_probability_from_ratio(F(13, 75), F(1, 2)), F(13, 163)
        )
        self.assertEqual(
            void_probability_from_ratio(F(11, 75), F(1, 2)), F(11, 161)
        )

    def test_veto_is_strict_at_the_equality_boundary(self):
        boundary = F(11, 161)
        at_boundary = leg_price(F(17, 1_000), boundary, F(1, 2))
        above_boundary = leg_price(
            F(17, 1_000), boundary + F(1, 10**9), F(1, 2)
        )
        self.assertEqual(at_boundary, GATE_P_MAX)
        self.assertFalse(at_boundary > GATE_P_MAX)
        self.assertTrue(above_boundary > GATE_P_MAX)

    def test_void_contamination_can_only_advance_this_absolute_veto(self):
        # Under the sensitivity, q below both p_max and the 1/2 VOID target
        # moves upward monotonically as pi rises; the hypothetical decision
        # consequence of crossing this gate is the safe G-1 direction: REJECT.
        for q in (F(0), F(11, 1_000), F(17, 1_000), F(49, 1_000)):
            prices = [leg_price(q, pi, F(1, 2)) for pi in (F(0), F(1, 100), F(1, 10))]
            with self.subTest(q=q):
                self.assertEqual(prices, sorted(prices))
                self.assertGreater(prices[-1], prices[0])


class TestWorkedExample(unittest.TestCase):
    """04 §12's normative observations under a non-normative sensitivity."""

    def test_full_window_boundary_is_seven_eighty_seconds(self):
        # `0.041·(1-pi) = 0.0375` at pi = 7/82.  This reproduces the audit's
        # 8.5366% number, but only for the full-window line.
        boundary = symmetric_hurdle_boundary(
            EXAMPLE_FULL_ACCEPT, EXAMPLE_FULL_REJECT, DEC_DELTA_TRS
        )
        self.assertEqual(boundary, F(7, 82))
        self.assertEqual(
            leg_price(EXAMPLE_FULL_ACCEPT, F(2, 25), F(1, 2))
            - leg_price(EXAMPLE_FULL_REJECT, F(2, 25), F(1, 2)),
            F(943, 25_000),  # 0.037720
        )

    def test_sq_559_the_stated_adopt_first_flips_at_the_trailing_hurdle(self):
        """SQ-559 sensitivity: 7/82 is not the first conditional boundary.

        The same section publishes trailing values 0.5620 / 0.5222 and 05
        §5.4 requires that hurdle too.  They reach 0.0375 at pi = 23/398;
        immediately above it the full window still passes and both absolute
        gate caps remain clear, but full/trailing disagreement returns Extend.
        """
        boundaries = worked_example_boundaries()
        self.assertEqual(boundaries.trailing_hurdle, F(23, 398))
        self.assertEqual(boundaries.first_documented_failure, F(23, 398))

        at = boundaries.trailing_hurdle
        above = at + F(1, 10**9)
        trailing_at = leg_price(EXAMPLE_TRAILING_ACCEPT, at, F(1, 2)) - leg_price(
            EXAMPLE_TRAILING_REJECT, at, F(1, 2)
        )
        trailing_above = leg_price(
            EXAMPLE_TRAILING_ACCEPT, above, F(1, 2)
        ) - leg_price(EXAMPLE_TRAILING_REJECT, above, F(1, 2))
        full_above = leg_price(EXAMPLE_FULL_ACCEPT, above, F(1, 2)) - leg_price(
            EXAMPLE_FULL_REJECT, above, F(1, 2)
        )
        self.assertEqual(trailing_at, DEC_DELTA_TRS)  # `>=` still passes.
        self.assertLess(trailing_above, DEC_DELTA_TRS)
        self.assertGreater(full_above, DEC_DELTA_TRS)
        self.assertLess(
            leg_price(EXAMPLE_GATE_SECURITY[0], above, F(1, 2)), GATE_P_MAX
        )

    def test_all_four_boundaries_have_their_derived_order(self):
        boundaries = worked_example_boundaries()
        self.assertEqual(boundaries.security_gate, F(11, 161))
        self.assertEqual(boundaries.survival_gate, F(13, 163))
        self.assertEqual(boundaries.full_hurdle, F(7, 82))
        self.assertLess(boundaries.trailing_hurdle, boundaries.security_gate)
        self.assertLess(boundaries.security_gate, boundaries.survival_gate)
        self.assertLess(boundaries.survival_gate, boundaries.full_hurdle)

    def test_equal_weights_are_status_quo_favouring_for_every_true_reject(self):
        # A common affine pull multiplies the true uplift by an information
        # weight in [0,1].  Search values on both sides of 1/2, including true
        # uplifts just below the hurdle; none can become an ADOPT.
        values = (F(1, 100), F(2, 5), F(49, 100), F(51, 100), F(9, 10))
        for q_accept in values:
            for q_reject in values:
                if q_accept - q_reject >= DEC_DELTA_TRS:
                    continue
                for pi in (F(1, 1_000), F(1, 20), F(1, 2)):
                    contaminated = leg_price(
                        q_accept, pi, F(1, 2)
                    ) - leg_price(q_reject, pi, F(1, 2))
                    with self.subTest(q_accept=q_accept, q_reject=q_reject, pi=pi):
                        self.assertLess(contaminated, DEC_DELTA_TRS)

    def test_baseline_floor_stays_nonbinding_but_by_a_different_mechanism(self):
        # §12's full-window floor uses REJECT.  Neutral Baseline settlement
        # cannot make it start binding as pi rises, and is priced without D-1.
        for pi in (
            F(0),
            worked_example_boundaries().trailing_hurdle,
            worked_example_boundaries().full_hurdle,
        ):
            baseline_floor = baseline_neutral_price(EXAMPLE_BASELINE, pi) - DEC_SIGMA_TRS
            reject = leg_price(EXAMPLE_FULL_REJECT, pi, F(1, 2))
            with self.subTest(pi=pi):
                self.assertLessEqual(baseline_floor, reject)
        self.assertEqual(BASELINE_NEUTRAL_SCORE, F(1, 2))
        self.assertNotEqual(
            baseline_neutral_price(F(2, 5), F(1, 50)),
            leg_price(F(2, 5), F(1, 50), F(1, 5)),
        )


class TestDegenerateBranch(unittest.TestCase):
    """The near-certain-branch limit and its exact welfare boundary."""

    def test_every_truth_prices_at_one_half_when_only_void_values_the_branch(self):
        for pi in (F(1, 10**9), F(1, 1_000), F(1, 2), F(1)):
            self.assertEqual(degenerate_branch_price(pi), F(1, 2))
            for q in (F(0), F(2, 5), F(9, 10), F(1)):
                with self.subTest(pi=pi, q=q):
                    self.assertEqual(leg_price(q, pi, F(0)), F(1, 2))

    def test_positive_weights_converge_to_the_degenerate_price(self):
        q, pi = F(9, 10), F(1, 50)
        distances = [
            abs(leg_price(q, pi, weight) - F(1, 2))
            for weight in (F(1, 100), F(1, 1_000), F(1, 10_000))
        ]
        self.assertGreater(distances[0], distances[1])
        self.assertGreater(distances[1], distances[2])

    def test_degenerate_reject_probability_boundary_is_exact(self):
        boundary = degenerate_reject_probability_boundary(F(1, 50), DEC_DELTA_TRS)
        self.assertEqual(boundary, F(3_623, 7_840))
        self.assertEqual(
            degenerate_branch_price(F(1, 50))
            - leg_price(boundary, F(1, 50), F(1)),
            DEC_DELTA_TRS,
        )
        self.assertGreater(
            degenerate_branch_price(F(1, 50))
            - leg_price(boundary - F(1, 10_000), F(1, 50), F(1)),
            DEC_DELTA_TRS,
        )
        self.assertLess(
            degenerate_branch_price(F(1, 50))
            - leg_price(boundary + F(1, 10_000), F(1, 50), F(1)),
            DEC_DELTA_TRS,
        )

    def test_the_exact_degenerate_case_is_stopped_by_the_gate_veto(self):
        # This is why a welfare-only extreme witness is insufficient: every
        # ACCEPT gate YES leg also tends to 0.5, far above p_max = 0.05.
        for q_gate in (EXAMPLE_GATE_SURVIVAL[0], EXAMPLE_GATE_SECURITY[0]):
            self.assertEqual(leg_price(q_gate, F(1, 50), F(0)), F(1, 2))
            self.assertGreater(leg_price(q_gate, F(1, 50), F(0)), GATE_P_MAX)


class TestAsymmetricWeightSearch(unittest.TestCase):
    """SQ-559's risk-neutral sensitivity over complementary branch weights."""

    def test_corrected_witness_turns_a_true_reject_into_a_pricing_adopt(self):
        """SQ-559 sensitivity under the explicit quote-convergence premise.

        05 §5 reads the raw gate, decision and Baseline TWAPs and then applies
        a status-quo default. Under the non-normative risk-neutral model, this
        complementary weight pair makes the hypothetical readings clear both
        gate vetoes and the hurdle. The documents do not claim convergence to
        these readings.
        """
        readout = price_readout(asymmetric_inputs(), F(1, 5))
        self.assertEqual(readout.w_accept + readout.w_reject, F(1))
        self.assertEqual(readout.true_uplift, F(9, 250))
        self.assertLess(readout.true_uplift, DEC_DELTA_TRS)
        self.assertFalse(readout.true_pricing_adopt)

        self.assertEqual(readout.accept_price, F(417, 1_030))
        self.assertEqual(readout.reject_price, F(36_297, 99_250))
        self.assertEqual(readout.priced_uplift, F(200_067, 5_111_375))
        self.assertGreater(readout.priced_uplift, DEC_DELTA_TRS)
        self.assertTrue(readout.priced_pricing_adopt)
        self.assertTrue(readout.false_adopt)

    def test_corrected_witness_clears_absolute_and_relative_gate_vetoes(self):
        readout = price_readout(asymmetric_inputs(), F(1, 5))
        self.assertTrue(readout.true_gates_clear)
        self.assertTrue(readout.priced_gates_clear)
        for gate in readout.gates:
            with self.subTest(gate=gate.values.name):
                self.assertLessEqual(gate.accept_price, GATE_P_MAX)
                self.assertLessEqual(
                    gate.accept_price, gate.reject_price + GATE_EPS
                )

    def test_baseline_is_nonbinding_without_using_the_d1_denominator(self):
        readout = price_readout(asymmetric_inputs(), F(1, 5))
        self.assertEqual(readout.baseline_price, F(1_146, 3_125))
        self.assertLess(
            readout.baseline_price - DEC_SIGMA_TRS, readout.reject_price
        )
        self.assertEqual(readout.priced_reject_floor, readout.reject_price)

    def test_exact_millipercent_search_has_a_nonempty_false_adopt_interval(self):
        # Search every positive millipercent weight, not selected witnesses.
        # The first supplied grid point clears the S relative veto at 0.197; the
        # last still clears the welfare hurdle at 0.288.
        inputs = asymmetric_inputs()
        weights = tuple(F(n, 1_000) for n in range(1, 1_000))
        vulnerable = [w for w in weights if price_readout(inputs, w).false_adopt]
        self.assertEqual(vulnerable[0], F(197, 1_000))
        self.assertEqual(vulnerable[-1], F(288, 1_000))
        self.assertGreater(len(vulnerable), 1)

    def test_search_is_stable_and_returns_the_first_scenario_witness(self):
        inputs = asymmetric_inputs()
        descending = (F(n, 1_000) for n in range(999, 0, -1))
        witness = search_false_adopt(inputs, descending)
        self.assertIsNotNone(witness)
        self.assertEqual(witness.w_accept, F(197, 1_000))
        self.assertEqual(witness.w_reject, F(803, 1_000))

    def test_continuous_search_brackets_both_boundaries_exactly(self):
        # Exact Fraction bisection closes the gaps between grid points.  Entry
        # is the S relative-veto equality; exit is the welfare-hurdle equality.
        interval = search_false_adopt_interval(asymmetric_inputs())
        self.assertIsNotNone(interval)
        self.assertLess(interval.entry_width, F(1, 10**20))
        self.assertLess(interval.exit_width, F(1, 10**20))
        self.assertLess(interval.gate_fails_below, F(196_360, 1_000_000))
        self.assertGreater(interval.gate_clears_from, F(196_359, 1_000_000))
        self.assertLess(interval.hurdle_passes_through, F(288_021, 1_000_000))
        self.assertGreater(interval.hurdle_fails_above, F(288_020, 1_000_000))

        before = price_readout(asymmetric_inputs(), interval.gate_fails_below)
        inside_entry = price_readout(asymmetric_inputs(), interval.gate_clears_from)
        inside_exit = price_readout(
            asymmetric_inputs(), interval.hurdle_passes_through
        )
        after = price_readout(asymmetric_inputs(), interval.hurdle_fails_above)
        self.assertFalse(before.priced_gates_clear)
        self.assertTrue(inside_entry.false_adopt)
        self.assertTrue(inside_exit.false_adopt)
        self.assertFalse(after.priced_hurdle_pass)

    def test_structured_finding_reports_observation_and_conditional_sensitivity(self):
        inputs = asymmetric_inputs()
        findings = check_weight_safety(
            inputs, (F(n, 1_000) for n in range(1, 1_000))
        )
        raw_twap = next(
            finding
            for finding in findings
            if finding.key
            == "decision rule reads raw TWAP without a VOID-adjusted series"
        )
        sensitivity = next(
            finding
            for finding in findings
            if finding.key == "risk-neutral VOID sensitivity"
        )
        self.assertTrue(raw_twap.ok)
        self.assertIsNone(raw_twap.witness)
        self.assertTrue(sensitivity.ok)
        self.assertIsNotNone(sensitivity.witness)
        self.assertTrue(sensitivity.witness.false_adopt)
        self.assertIn("conditional on", sensitivity.detail)

    def test_sensitivity_is_not_run_without_the_explicit_convergence_premise(self):
        inputs = asymmetric_inputs()
        inputs = PricingInputs(
            decision_accept=inputs.decision_accept,
            decision_reject=inputs.decision_reject,
            baseline=inputs.baseline,
            scenario=quote_scenario(F(1, 50), converges=False),
            gates=inputs.gates,
        )
        findings = check_weight_safety(inputs, (F(1, 5),))
        self.assertTrue(all(finding.ok for finding in findings))
        self.assertTrue(all(finding.witness is None for finding in findings))
        self.assertIn("not evaluated", findings[1].detail)
        with self.assertRaisesRegex(PricingRefused, "convergence premise"):
            price_readout(inputs, F(1, 5))
        with self.assertRaisesRegex(PricingRefused, "convergence premise"):
            _worked_example_boundaries(
                quotes_converge_to_expected_value_ratio=False
            )

    def test_extreme_welfare_flip_alone_is_not_a_valid_final_witness(self):
        # At the audit's near-degenerate shape the welfare uplift flips much
        # harder, but the ACCEPT gate books also approach 0.5 and veto first.
        # A test that ignored §5.1 would overstate the finding.
        readout = price_readout(asymmetric_inputs(), F(1, 1_000))
        self.assertGreater(readout.priced_uplift, DEC_DELTA_TRS)
        self.assertFalse(readout.priced_gates_clear)
        self.assertFalse(readout.priced_pricing_adopt)
        self.assertFalse(readout.false_adopt)


if __name__ == "__main__":
    unittest.main()
