"""Pins 05 §4.3/§4.5 pillar reachability and §5.1's launch gate ordering.

The suite derives component-zero C values, the IID gate-rate cliff, block
occupancy thresholds and the phase × equal-collator-set grid. It treats the
launch wedge as conditional: 08 §10 does not supply U's non-empty-block input,
so the zero-occupancy scenario is executed without pretending it is implied.
"""

import unittest
from dataclasses import replace
from decimal import Decimal
from fractions import Fraction

from bleavit_reference_model import decision, welfare
from bleavit_reference_model.pillars import (
    BLOCKS_PER_DAY,
    C_ONCHAIN_WEIGHTS,
    COLLATOR_N_TARGET_MAX,
    COLLATOR_N_TARGET_MIN,
    FULL_GATE_WINDOW_DAYS,
    GATE_P_MAX_DEFAULT,
    LAUNCH,
    MIN_RECORDED_GATE_DAYS,
    RES_PROBE_INTERVAL_BLOCKS,
    WELFARE_TH_C_LO,
    WELFARE_TH_S_HI,
    WELFARE_TH_S_LO,
    ZERO_NON_INHERENT_LAUNCH,
    PillarReachabilityError,
    block_production_u,
    c_daily_frontier,
    check_collator_reachability,
    check_launch_reachability,
    collator_adequacy,
    critical_per_day_rate,
    d_eff_grid,
    enumerated_failure_modes,
    failure_mode_results,
    flag_probability,
    launch_outcome,
    metric_spec_escape,
    minimum_non_empty_blocks_for_decision,
    non_empty_blocks_for,
    non_empty_fraction_for,
    runtime_integrity,
    veto_binds,
    veto_decision,
    weight_headroom,
    xcm_health,
)

D = Decimal


class CDailyFrontierTests(unittest.TestCase):
    """05 §4.3's weights composed through §4.4's actual aggregation."""

    def test_each_published_component_zero_value_is_reproduced(self):
        # These are derived by zeroing one input while every other input is 1;
        # changing a weight or the epsilon moves its row.
        expected = {
            "X": D("0.316227766"),
            "R": D("0.316227766"),
            "E": D("0.398107170"),
            "H": D("0.501187233"),
            "Pi": D("0.630957344"),
            "K": D("0.794328234"),
        }
        rows = c_daily_frontier(C_ONCHAIN_WEIGHTS).components
        self.assertEqual(
            {row.component: row.c_daily_when_zero for row in rows}, expected
        )

    def test_the_analytic_frontier_and_smallest_weight_ratio_are_pinned(self):
        result = c_daily_frontier(C_ONCHAIN_WEIGHTS)
        self.assertEqual(
            result.frontier.quantize(D("1e-18")), D("0.035290537142853633")
        )
        self.assertEqual(result.smallest_weight, D("0.05"))
        self.assertEqual(
            result.smallest_to_frontier.quantize(D("1e-10")),
            D("1.4168103987"),
        )

    def test_every_declared_component_is_a_single_point_of_failure(self):
        result = c_daily_frontier(C_ONCHAIN_WEIGHTS)
        self.assertTrue(result.every_component_is_single_point_of_failure)
        for row in result.components:
            with self.subTest(component=row.component):
                self.assertGreater(row.normalized_weight, result.frontier)
                self.assertLess(row.c_daily_when_zero, WELFARE_TH_C_LO)

    def test_a_weight_below_the_frontier_is_not_misclassified(self):
        # Wrong-world witness: lowering K to 0.03 without compensating another
        # weight gives normalized K ~= 0.0306, and K=0 no longer breaches.
        changed = dict(C_ONCHAIN_WEIGHTS)
        changed["K"] = D("0.03")
        result = c_daily_frontier(changed)
        k = next(row for row in result.components if row.component == "K")
        self.assertLess(k.normalized_weight, result.frontier)
        self.assertFalse(k.breaches)
        self.assertFalse(result.every_component_is_single_point_of_failure)

    def test_the_frontier_refuses_a_non_probability_domain(self):
        with self.assertRaises(PillarReachabilityError):
            c_daily_frontier(C_ONCHAIN_WEIGHTS, D("0.90"), D("0.85"))


class FailureModeTests(unittest.TestCase):
    """The concrete 05 §4.3 / 07 §8 paths, not generic zero inputs."""

    def test_component_formulas_reach_both_healthy_and_failed_ends(self):
        self.assertEqual(xcm_health(0, 0, 0), D(1))
        self.assertEqual(xcm_health(0, 1, 0), D(0))
        self.assertEqual(weight_headroom(D("0.40")), D("1.000000000"))
        self.assertEqual(weight_headroom(D(1)), D("0E-9"))
        self.assertEqual(runtime_integrity(0), D("1.000000000"))
        self.assertEqual(runtime_integrity(4), D("0E-9"))
        self.assertEqual(collator_adequacy(4), D("1.000000000"))
        self.assertEqual(collator_adequacy(0), D("0E-9"))

    def test_the_default_probe_cadence_is_exactly_one_per_day(self):
        self.assertEqual(RES_PROBE_INTERVAL_BLOCKS, BLOCKS_PER_DAY)

    def test_one_integrity_event_is_not_silently_treated_as_four(self):
        self.assertEqual(runtime_integrity(1), D("0.750000000"))
        self.assertGreater(runtime_integrity(1), runtime_integrity(4))

    def test_every_enumerated_fully_degraded_mode_breaches_c_daily(self):
        modes = enumerated_failure_modes()
        self.assertEqual(
            tuple(mode.key for mode in modes),
            (
                "xcm.local_send_failure",
                "reserve.error_response",
                "reserve.timeout",
                "reserve.no_attempt",
                "reserve.malformed",
                "reserve.ambiguous",
                "security.zero_coverage",
                "headroom.saturated",
                "integrity.four_failures",
                "collators.no_active_author",
            ),
        )
        for mode in modes:
            with self.subTest(mode=mode.key):
                self.assertTrue(mode.breaches())

    def test_reserve_timeout_hits_both_x_and_r(self):
        timeout = next(
            mode for mode in enumerated_failure_modes() if mode.key == "reserve.timeout"
        )
        error = next(
            mode
            for mode in enumerated_failure_modes()
            if mode.key == "reserve.error_response"
        )
        # Q64 product floors make the two-zero result one FixedU64 unit below
        # the abstract 0.1; an R-only failure gives 0.316227766.
        self.assertEqual(timeout.c_daily(), D("0.099999999"))
        self.assertEqual(error.c_daily(), D("0.316227766"))
        self.assertLess(timeout.c_daily(), error.c_daily())

    def test_every_mode_vetoes_at_two_failures_per_thousand_days(self):
        rows = failure_mode_results(D("0.002"))
        for row in rows:
            with self.subTest(mode=row.mode.key):
                self.assertTrue(row.daily_breach)
                self.assertTrue(row.veto)
                self.assertGreater(row.window_probability, GATE_P_MAX_DEFAULT)

    def test_harmless_proposals_do_not_veto_below_the_absolute_cliff(self):
        rows = failure_mode_results(D("0.001"))
        for row in rows:
            with self.subTest(mode=row.mode.key):
                self.assertTrue(row.daily_breach)
                self.assertFalse(row.veto)
                self.assertLess(row.window_probability, GATE_P_MAX_DEFAULT)


class GateRateTests(unittest.TestCase):
    """05 §5.1's absolute and relative tests through the real engine."""

    def test_full_coverage_iid_critical_rate_is_one_day_per_819(self):
        q = critical_per_day_rate(GATE_P_MAX_DEFAULT, FULL_GATE_WINDOW_DAYS)
        self.assertEqual(
            q.quantize(D("1e-18")), D("0.001220523468603134")
        )
        interval = D(1) / q
        self.assertEqual(interval.quantize(D("0.001")), D("819.321"))
        self.assertEqual(
            (interval / D("365.25")).quantize(D("0.0001")), D("2.2432")
        )

    def test_spec_minimum_recording_has_a_different_iid_cliff(self):
        # §4.7 deliberately permits one sampled day per measurement epoch. A
        # test hardcoding 42 as protocol-enforced coverage would miss this.
        full = critical_per_day_rate(
            GATE_P_MAX_DEFAULT, FULL_GATE_WINDOW_DAYS
        )
        minimum = critical_per_day_rate(
            GATE_P_MAX_DEFAULT, MIN_RECORDED_GATE_DAYS
        )
        self.assertEqual(
            minimum.quantize(D("1e-18")), D("0.025320565519103609")
        )
        self.assertGreater(minimum, full * D(20))

    def test_two_per_thousand_gives_the_published_eight_percent_window(self):
        probability = flag_probability(D("0.002"), FULL_GATE_WINDOW_DAYS)
        self.assertEqual(
            probability.quantize(D("1e-18")), D("0.080646076009068933")
        )
        verdict = veto_decision(D("0.002"))
        self.assertEqual(verdict.outcome, decision.Outcome.REJECT)
        self.assertEqual(
            verdict.reason, decision.RejectReason.GATE_VETO_SECURITY
        )

    def test_the_absolute_cap_is_strict_around_the_derived_root(self):
        q = critical_per_day_rate(GATE_P_MAX_DEFAULT, FULL_GATE_WINDOW_DAYS)
        margin = D("1e-30")
        self.assertLessEqual(
            flag_probability(q, FULL_GATE_WINDOW_DAYS), GATE_P_MAX_DEFAULT
        )
        self.assertFalse(veto_binds(q))
        self.assertFalse(veto_binds(q - margin))
        self.assertTrue(veto_binds(q + margin))

    def test_equal_books_disable_only_the_relative_leg(self):
        # At q=0.001 the 42-day rate is 4.115%, below p_max but > gate.eps.
        # Equal adopt/reject books do not veto; a zero reject rate does. This
        # kills the over-general claim that the relative test can never fire.
        self.assertFalse(veto_binds(D("0.001")))
        self.assertTrue(
            veto_binds(D("0.001"), reject_per_day_failure=D(0))
        )

    def test_probability_helpers_refuse_invalid_domains(self):
        with self.assertRaises(PillarReachabilityError):
            flag_probability(D("1.01"), 42)
        with self.assertRaises(PillarReachabilityError):
            critical_per_day_rate(D("0.05"), 0)


class LaunchReachabilityTests(unittest.TestCase):
    """05's U requirement composed against 08 §10's launch statement."""

    def test_u_requires_thirteen_fifteenths_non_empty_at_the_daily_floor(self):
        self.assertEqual(non_empty_fraction_for(WELFARE_TH_S_LO), Fraction(13, 15))
        self.assertEqual(non_empty_blocks_for(WELFARE_TH_S_LO), 12_480)
        self.assertEqual(
            Fraction(non_empty_blocks_for(WELFARE_TH_S_LO), BLOCKS_PER_DAY),
            Fraction(13, 15),
        )

    def test_u_requires_seventy_three_seventy_fifths_for_a_full_gate(self):
        self.assertEqual(non_empty_fraction_for(WELFARE_TH_S_HI), Fraction(73, 75))
        self.assertEqual(non_empty_blocks_for(WELFARE_TH_S_HI), 14_016)

    def test_sq_555_launch_occupancy_is_not_specified_by_zero_revenue_volume(self):
        """SQ-555. The unconditional launch-wedge premise is underdetermined.

        08 §10 says trading/revenue volume is zero; 05 §4.3.2 defines U from
        every non-inherent-bearing block. No text maps the first quantity to
        the second, so the model refuses to invent a launch occupancy. The
        zero-occupancy counterfactual is tested separately below.
        """
        finding = next(
            row
            for row in check_launch_reachability(LAUNCH)
            if row.key == "launch.non_empty_fraction specified"
        )
        self.assertFalse(finding.ok)
        with self.assertRaises(PillarReachabilityError):
            launch_outcome(LAUNCH)

    def test_zero_non_inherent_launch_composes_to_epsilon_settlement(self):
        outcome = launch_outcome(ZERO_NON_INHERENT_LAUNCH)
        self.assertEqual(outcome.u, D("0.250000000"))
        self.assertEqual(outcome.d_eff, D("0.960000000"))
        self.assertEqual(outcome.survival, D("0.250000000"))
        self.assertEqual(outcome.survival_gate, D(0))
        self.assertEqual(outcome.welfare, D("0E-9"))
        self.assertEqual(outcome.settlement_score, D("1E-9"))
        self.assertTrue(outcome.daily_breach)

    def test_sq_555_gate_veto_fires_before_the_sanity_band(self):
        """SQ-555. In the explicit zero-occupancy scenario, the gate is first.

        The settlement score is below the welfare sanity band and grades
        Invalid, but 05 §5.4 orders the S gate before that grade. The real
        decision engine therefore reports GateVetoSurvival, not
        NotDecisionGrade.
        """
        outcome = launch_outcome(ZERO_NON_INHERENT_LAUNCH)
        self.assertEqual(outcome.welfare_grade, decision.Grade.INVALID)
        self.assertEqual(outcome.decision.outcome, decision.Outcome.REJECT)
        self.assertEqual(
            outcome.decision.reason,
            decision.RejectReason.GATE_VETO_SURVIVAL,
        )
        finding = next(
            row
            for row in check_launch_reachability(ZERO_NON_INHERENT_LAUNCH)
            if row.key == "launch.survival_gate clears"
        )
        self.assertFalse(finding.ok)

    def test_exact_daily_floor_avoids_the_flag_but_still_zeroes_welfare(self):
        at_floor = replace(LAUNCH, non_empty_fraction=Fraction(13, 15))
        outcome = launch_outcome(at_floor)
        self.assertEqual(outcome.u, D("0.900000000"))
        self.assertFalse(outcome.daily_breach)  # §4.7 uses strict x < theta.
        self.assertEqual(outcome.survival_gate, D("0E-9"))
        self.assertEqual(outcome.welfare, D("0E-9"))
        self.assertEqual(
            outcome.decision.reason, decision.RejectReason.NOT_DECISION_GRADE
        )

    def test_ninety_percent_non_empty_reproduces_the_pipeline_value(self):
        outcome = launch_outcome(
            replace(LAUNCH, non_empty_fraction=Fraction(9, 10))
        )
        self.assertEqual(outcome.u, D("0.925000000"))
        self.assertEqual(outcome.survival, D("0.925000000"))
        self.assertEqual(outcome.survival_gate, D("0.231933593"))
        self.assertEqual(outcome.welfare, D("0.231933593"))
        self.assertEqual(outcome.settlement_score, D("0.231933593"))
        self.assertEqual(outcome.decision.outcome, decision.Outcome.ADOPT)

    def test_first_decision_grade_whole_day_is_12610_non_empty_blocks(self):
        minimum = minimum_non_empty_blocks_for_decision()
        self.assertEqual(minimum, 12_610)
        below = launch_outcome(
            replace(LAUNCH, non_empty_fraction=Fraction(12_609, BLOCKS_PER_DAY))
        )
        at = launch_outcome(
            replace(LAUNCH, non_empty_fraction=Fraction(12_610, BLOCKS_PER_DAY))
        )
        self.assertEqual(below.settlement_score, D("0.019975378"))
        self.assertEqual(
            below.decision.reason, decision.RejectReason.NOT_DECISION_GRADE
        )
        self.assertEqual(at.settlement_score, D("0.020276943"))
        self.assertEqual(at.decision.outcome, decision.Outcome.ADOPT)

    def test_phase_four_five_collators_cap_even_perfect_block_occupancy(self):
        outcome = launch_outcome(replace(LAUNCH, non_empty_fraction=Fraction(1)))
        self.assertEqual(block_production_u(Fraction(1)), D("1.000000000"))
        self.assertEqual(outcome.d_eff, D("0.960000000"))
        self.assertEqual(outcome.survival, D("0.960000000"))
        self.assertEqual(outcome.survival_gate, D("0.843750000"))

    def test_the_metric_track_is_a_slow_non_market_escape(self):
        route = metric_spec_escape()
        self.assertFalse(route.market_bearing)
        self.assertEqual(route.governance_days, 32)
        self.assertEqual(route.activation_epochs, 2)
        self.assertEqual(route.tabled_total_days, 74)


class CollatorScheduleTests(unittest.TestCase):
    """05 §4.5's published pair and the phase × actual-set grid."""

    def test_n_cap_ladder_is_monotone_and_phase_keyed(self):
        cells = d_eff_grid(range(8), (5,))
        ladder = [cell.n_cap for cell in cells]
        self.assertEqual(ladder, [5, 5, 5, 5, 6, 7, 8, 8])
        self.assertEqual(ladder, sorted(ladder))

    def test_the_published_0914_and_008_pair_reproduces_exactly(self):
        cell = d_eff_grid((6,), (5,))[0]
        self.assertEqual(cell.d_eff, D("0.914285714"))
        self.assertEqual(cell.survival_gate, D("0.084274776"))
        self.assertEqual(cell.d_eff.quantize(D("0.001")), D("0.914"))
        self.assertEqual(cell.survival_gate.quantize(D("0.01")), D("0.08"))

    def test_the_published_concentrated_five_author_example_reproduces(self):
        # 40/40/10/5/5% => HHI = 0.335. At phases 0-3 n_cap=5.
        shares = (D("0.40"), D("0.40"), D("0.10"), D("0.05"), D("0.05"))
        hhi = sum((share * share for share in shares), D(0))
        self.assertEqual(hhi, D("0.3350"))
        self.assertEqual(welfare.collator_d_eff(hhi, 3), D("0.831250000"))

    def test_every_collapsed_cell_in_the_registry_target_range_is_reported(self):
        cells = d_eff_grid(
            range(8), range(COLLATOR_N_TARGET_MIN, COLLATOR_N_TARGET_MAX + 1)
        )
        collapsed = [
            (cell.phase, cell.collator_set_size) for cell in cells if cell.collapsed
        ]
        self.assertEqual(collapsed, [(4, 4), (5, 4), (6, 4), (7, 4)])

    def test_phase_advance_without_set_growth_can_create_the_collapse(self):
        cells = d_eff_grid(range(4, 7), (4,))
        self.assertEqual(
            [cell.d_eff for cell in cells],
            [D("0.900000000"), D("0.875000000"), D("0.857142857")],
        )
        self.assertTrue(all(cell.collapsed for cell in cells))

    def test_five_equal_authors_lose_the_launch_cap_as_phases_advance(self):
        cells = d_eff_grid(range(3, 7), (5,))
        self.assertEqual(
            [cell.d_eff for cell in cells],
            [
                D("1.000000000"),
                D("0.960000000"),
                D("0.933333333"),
                D("0.914285714"),
            ],
        )
        self.assertEqual(
            [cell.survival_gate for cell in cells],
            [D(1), D("0.843750000"), D("0.376157400"), D("0.084274776")],
        )

    def test_the_unqualified_five_author_neutralization_claim_is_false(self):
        """05 §4.5 says five equal authors score D_eff=1 without a phase qualifier.

        That is true only in phases 0-3. The same fixed set scores 0.96 in
        Phase 4 and falls to 0.914285714 in Phase 6, because n_cap advances
        independently of actual set size and collator.n_target is still
        [VERIFY].
        """
        finding = next(
            row
            for row in check_collator_reachability()
            if row.key == "five equal authors remain neutralized"
        )
        self.assertFalse(finding.ok)

    def test_the_target_minimum_has_no_phase_advance_safety_binding(self):
        finding = next(
            row
            for row in check_collator_reachability()
            if row.key
            == "phase advance at target minimum keeps survival nonzero"
        )
        self.assertFalse(finding.ok)
        self.assertIn("phase 4", finding.detail)


if __name__ == "__main__":
    unittest.main()
