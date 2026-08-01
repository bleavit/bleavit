"""Executes 07 §4/§8's reserve-probe and watchtower liveness claims.

The reserve tests separate three facts the prose places close together: the
``F + R`` first-arm floor covers exactly one threshold-length failure streak
plus recovery; longer outages can exhaust recovery envelopes; and an already
armed TREASURY refill remains executable after the flag rises.  The outage
closed form is checked against every pass/fail string through length 16.

The watchtower tests exercise the SQ-491 work latch, liveness ejection, live
quorum amendment and permissionless re-seating.  They also resolve every
cross-document target linked from 07 §4/§8 and expose the two behavioral
delegations whose target text is absent rather than treating a Markdown link as
a specification.
"""

from dataclasses import replace
from decimal import Decimal, ROUND_HALF_UP, localcontext
from fractions import Fraction
from pathlib import Path
import unittest

from bleavit_reference_model.oracle import (
    MICRO_USDC_PER_USDC,
    OPS_RESERVE_PROBE_BUDGET_DEFAULT_MICRO_USDC,
    RES_RECOVER_THRESHOLD_DEFAULT,
    RES_THRESHOLD_MAX,
    WT_MAX,
    WT_QUORUM_DEFAULT,
    WT_STAKE_DEFAULT,
    OracleModelError,
    ReserveProbe,
    ReserveThresholds,
    WatchtowerSet,
    amendment_findings,
    can_finalize_unchallenged,
    can_reach_healthy,
    cheapest_specified_exit,
    check_cross_document_delegations,
    declared_delegation_document_counts,
    declared_delegation_documents,
    documented_oracle_calls,
    evaluate_threshold_amendment,
    exit_cost_table,
    first_arm_runway_envelopes,
    first_unsafe_quorum_amendment,
    funding_findings,
    is_absorbing,
    lawful_quorum_amendments,
    linked_architecture_document_counts,
    linked_architecture_documents,
    max_survivable_outage,
    max_survivable_outage_exhaustive,
    minimum_capacity_for_outage,
    probe_envelope_micro_usdc,
    probe_funding,
    reachable_probe_states,
    runway_micro_usdc,
    screen_reserve_thresholds,
    simulate_watchtower_attrition,
    state_after_outage,
    unhealthy_duty_cycle,
    unresolved_delegations,
    watchtower_findings,
)
from bleavit_reference_model.welfare import (
    drop_and_renormalize,
    emptied_pillar_groups,
    welfare_value,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def percent_2(value: Fraction) -> Decimal:
    """Render an exact ratio as a two-decimal percentage without float."""
    with localcontext() as context:
        context.prec = 50
        percent = Decimal(value.numerator) * 100 / Decimal(value.denominator)
        return percent.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class ReserveFundingArithmeticTests(unittest.TestCase):
    """07 §8's debit/runway formula composed with 08 §10's cadence."""

    def test_genesis_envelope_is_exactly_two_and_a_half_usdc(self):
        self.assertEqual(probe_envelope_micro_usdc(), 2_500_000)
        self.assertEqual(
            Fraction(probe_envelope_micro_usdc(), MICRO_USDC_PER_USDC),
            Fraction(5, 2),
        )

    def test_probe_debit_rounds_up_against_the_treasury(self):
        # A positive sub-micro-USDC quotient authorizes one micro-USDC, never 0.
        self.assertEqual(probe_envelope_micro_usdc(1, 1), 1)
        self.assertEqual(probe_envelope_micro_usdc(10_000_000_000, 1), 1)

    def test_first_arm_runway_reproduces_five_envelopes_and_12_5_usdc(self):
        self.assertEqual(first_arm_runway_envelopes(), 5)
        self.assertEqual(runway_micro_usdc(), 12_500_000)

    def test_exact_cadence_reproduces_the_published_approximate_row(self):
        funding = probe_funding(allocation_epoch_micro_usdc=None)
        self.assertEqual(funding.probes_per_epoch, 21)
        self.assertEqual(funding.probes_per_year, Fraction(1_461, 4))
        self.assertEqual(funding.cost_basis_epoch_micro_usdc, 52_500_000)
        self.assertEqual(funding.cost_basis_year_micro_usdc, 913_125_000)
        self.assertEqual(funding.routine_epoch_micro_usdc, 52_500_000)
        self.assertEqual(funding.routine_year_micro_usdc, 913_125_000)
        # The printed ≈52/≈913 are close presentations, not exact allocations.
        self.assertEqual(funding.display_epoch_margin_micro_usdc, -500_000)
        self.assertEqual(funding.display_year_margin_micro_usdc, -125_000)
        self.assertEqual(funding.display_epoch_margin_fraction, Fraction(-1, 105))
        self.assertEqual(funding.display_year_margin_fraction, Fraction(-1, 7_305))

    def test_sq_554_cost_basis_equality_is_informational(self):
        """SQ-554. The derived cost-basis difference is zero, not headroom.

        Its stated basis is exactly 21 attempts × the 2.5-USDC envelope, so the
        cost estimate equals routine demand. Because the row is not the actual
        allocation, that equality proves neither funding nor lack of buffer.
        """
        funding = probe_funding(allocation_epoch_micro_usdc=None)
        self.assertEqual(funding.cost_basis_difference_epoch_micro_usdc, 0)
        self.assertIsNone(funding.allocation_buffer_epoch_micro_usdc)
        finding = next(
            item
            for item in funding_findings(allocation_epoch_micro_usdc=None)
            if item.key == "ops.reserve_probe cost basis equals routine demand"
        )
        self.assertTrue(finding.ok)
        self.assertIn("informational", finding.detail)

    def test_the_actual_budget_line_value_is_still_unsettled(self):
        # 13 §1 says [VERIFY].  §10's cost row is not a balance allocation.
        self.assertIsNone(OPS_RESERVE_PROBE_BUDGET_DEFAULT_MICRO_USDC)
        finding = next(
            item
            for item in funding_findings(allocation_epoch_micro_usdc=None)
            if item.key == "ops.reserve_probe funding scenario"
        )
        self.assertTrue(finding.ok)
        self.assertIn("not evaluated", finding.detail)

    def test_explicit_allocation_scenarios_report_conditional_headroom(self):
        routine = 52_500_000
        for allocation, expected in (
            (52_000_000, Fraction(-500_000)),
            (routine, Fraction(0)),
            (60_000_000, Fraction(7_500_000)),
        ):
            with self.subTest(allocation=allocation):
                funding = probe_funding(
                    allocation_epoch_micro_usdc=allocation
                )
                self.assertEqual(
                    funding.allocation_buffer_epoch_micro_usdc, expected
                )
                finding = next(
                    item
                    for item in funding_findings(
                        allocation_epoch_micro_usdc=allocation
                    )
                    if item.key == "ops.reserve_probe funding scenario"
                )
                self.assertTrue(finding.ok)
                self.assertIn(str(expected), finding.detail)


class ReserveProbeStateMachineTests(unittest.TestCase):
    """The envelope ledger, hysteresis counters, first arm and refill authority."""

    def test_first_arm_refuses_below_the_live_runway(self):
        with self.assertRaisesRegex(OracleModelError, "needs 5 envelopes"):
            ReserveProbe.unarmed(4).arm_probe()
        armed = ReserveProbe.unarmed(5).arm_probe()
        self.assertTrue(armed.probe_armed)
        self.assertEqual(armed.envelopes, 5)

    def test_pre_arm_wall_clock_is_not_scored(self):
        with self.assertRaisesRegex(OracleModelError, "pre-arm"):
            ReserveProbe.unarmed(5).advance(False)

    def test_first_arm_floor_covers_exactly_threshold_failures_plus_recovery(self):
        # No interim refill: F,F arms unhealthy; P,P,P clears it on the final
        # envelope.  This is the narrow claim §8's F+R arithmetic does prove.
        state = ReserveProbe(5)
        for passed in (False, False, True, True, True):
            state = state.advance(passed).state
        self.assertFalse(state.unhealthy)
        self.assertEqual(state.envelopes, 0)
        self.assertEqual((state.consecutive_fails, state.consecutive_passes), (0, 0))

    def test_fail_and_pass_streaks_reset_each_other(self):
        state = ReserveProbe(8)
        state = state.advance(False).state
        self.assertEqual(state.consecutive_fails, 1)
        state = state.advance(True).state
        self.assertEqual(state.consecutive_fails, 0)
        state = state.advance(False).state
        state = state.advance(False).state
        self.assertTrue(state.unhealthy)
        state = state.advance(True).state
        state = state.advance(True).state
        self.assertEqual(state.consecutive_passes, 2)
        state = state.advance(False).state
        self.assertEqual(state.consecutive_passes, 0)
        self.assertTrue(state.unhealthy)

    def test_an_unfunded_hypothetical_success_scores_fail_static(self):
        state = ReserveProbe(
            0,
            consecutive_fails=1,
        )
        step = state.advance(True)
        self.assertFalse(step.attempted)
        self.assertFalse(step.scored_pass)
        self.assertTrue(step.state.unhealthy)
        self.assertEqual(step.state.envelopes, 0)

    def test_prearmed_refill_executes_under_the_flag_but_new_arming_refuses(self):
        state = ReserveProbe(5).arm_refill(3)
        state = state.advance(False).state
        state = state.advance(False).state
        self.assertTrue(state.unhealthy)
        with self.assertRaisesRegex(OracleModelError, "blocks a new refill"):
            state.arm_refill(1)
        state = state.execute_refill()
        self.assertEqual(state.envelopes, 6)
        for _ in range(3):
            state = state.advance(True).state
        self.assertFalse(state.unhealthy)

    def test_absorption_is_conditional_on_balance_and_inflight_refill(self):
        wedged = state_after_outage(5, 4)
        self.assertTrue(wedged.unhealthy)
        self.assertEqual(wedged.envelopes, 0)
        self.assertTrue(is_absorbing(wedged))

        prearmed = replace(
            wedged,
            armed_refill_envelopes=RES_RECOVER_THRESHOLD_DEFAULT,
        )
        self.assertFalse(is_absorbing(prearmed))
        state = prearmed.execute_refill()
        for _ in range(RES_RECOVER_THRESHOLD_DEFAULT):
            state = state.advance(True).state
        self.assertFalse(state.unhealthy)

        # Upgrade compatibility can preserve unhealthy while resetting the
        # probe-arm latch.  A pre-armed five-envelope refill can still execute,
        # satisfy first-arm readiness, and recover; three envelopes cannot even
        # pass first arm despite being enough for the remaining pass streak.
        migrated = replace(wedged, probe_armed=False, armed_refill_envelopes=5)
        self.assertFalse(is_absorbing(migrated))
        self.assertTrue(can_reach_healthy(migrated, actions=5))
        self.assertTrue(
            is_absorbing(
                replace(wedged, probe_armed=False, armed_refill_envelopes=3)
            )
        )

    def test_absorbing_predicate_agrees_with_reachability_on_every_reachable_state(self):
        states = reachable_probe_states(ReserveProbe(5), actions=9, refill_envelopes=2)
        unhealthy = [state for state in states if state.unhealthy]
        self.assertTrue(any(is_absorbing(state) for state in unhealthy))
        self.assertTrue(any(not is_absorbing(state) for state in unhealthy))
        for state in unhealthy:
            with self.subTest(state=state):
                self.assertEqual(
                    is_absorbing(state),
                    not can_reach_healthy(
                        state, actions=state.recover_threshold + 1
                    ),
                )


class ReserveOutageSearchTests(unittest.TestCase):
    """The outage closed form and its independent exhaustive check."""

    def test_closed_form_gives_three_days_and_first_wedge_on_day_four(self):
        self.assertEqual(max_survivable_outage(5), 3)
        self.assertFalse(state_after_outage(5, 3).unhealthy)
        self.assertTrue(is_absorbing(state_after_outage(5, 4)))

    def test_twenty_one_envelopes_survive_nineteen_days_not_twenty(self):
        self.assertEqual(max_survivable_outage(21), 19)
        self.assertFalse(state_after_outage(21, 19).unhealthy)
        self.assertTrue(is_absorbing(state_after_outage(21, 20)))

    def test_outage_capacity_table_is_derived_from_the_closed_form(self):
        for outage, expected in ((4, 6), (7, 9), (14, 16), (30, 32)):
            with self.subTest(outage=outage):
                capacity = minimum_capacity_for_outage(outage)
                self.assertEqual(capacity, expected)
                self.assertFalse(state_after_outage(capacity, outage).unhealthy)
                self.assertTrue(
                    is_absorbing(state_after_outage(capacity - 1, outage))
                )
        self.assertEqual(
            minimum_capacity_for_outage(30) * probe_envelope_micro_usdc(),
            80 * MICRO_USDC_PER_USDC,
        )

    def test_every_outcome_string_through_length_sixteen_agrees_with_closed_form(self):
        result = max_survivable_outage_exhaustive(5, max_length=16)
        self.assertEqual(result.checked_strings, sum(2**n for n in range(17)))
        self.assertGreater(result.checked_fresh_outages, result.checked_strings)
        self.assertEqual(result.counterexamples, ())
        self.assertEqual(result.max_survivable, max_survivable_outage(5))

    def test_exhaustive_search_agrees_for_other_threshold_shapes(self):
        for capacity, fail, recover in ((4, 1, 2), (6, 3, 2), (7, 2, 4)):
            closed = max_survivable_outage(capacity, fail, recover)
            result = max_survivable_outage_exhaustive(
                capacity,
                fail,
                recover,
                max_length=max(8, closed + 1),
            )
            with self.subTest(capacity=capacity, fail=fail, recover=recover):
                self.assertEqual(result.counterexamples, ())
                self.assertEqual(result.max_survivable, closed)


class ReserveStationaryDutyCycleTests(unittest.TestCase):
    """Exact stationary duty cycle with funding removed as a confounder."""

    def test_audited_sensitivity_figures_reproduce_exactly(self):
        expected = {
            Fraction(5, 100): (Fraction(163, 20_740), Decimal("0.79")),
            Fraction(10, 100): (Fraction(271, 8_290), Decimal("3.27")),
            Fraction(20, 100): (Fraction(61, 445), Decimal("13.71")),
            Fraction(40, 100): (Fraction(28, 55), Decimal("50.91")),
        }
        for failure_probability, (exact, displayed_percent) in expected.items():
            value = unhealthy_duty_cycle(failure_probability)
            with self.subTest(failure_probability=failure_probability):
                self.assertEqual(value, exact)
                self.assertEqual(percent_2(value), displayed_percent)

    def test_probability_endpoints_are_absorbing_in_opposite_directions(self):
        self.assertEqual(unhealthy_duty_cycle(Fraction(0)), 0)
        self.assertEqual(unhealthy_duty_cycle(Fraction(1)), 1)
        with self.assertRaisesRegex(OracleModelError, "exact Fraction"):
            unhealthy_duty_cycle(0.05)  # type: ignore[arg-type]


class ReserveThresholdAmendmentTests(unittest.TestCase):
    """The 07-specific consequence of 13 §1's un-delta-limited u8 rows."""

    def test_one_recovery_threshold_amendment_reaches_u8_max(self):
        amended = ReserveThresholds().amend(
            "res.recover_threshold", RES_THRESHOLD_MAX
        )
        self.assertEqual(amended, ReserveThresholds(fail=2, recover=255))
        self.assertEqual(amended.runway_envelopes, 257)

    def test_sq_554_amendment_is_not_rechecked_against_the_live_line(self):
        """SQ-554. The first-arm runway relation is not an amendment screen.

        From the genesis line, one lawful ``recover_threshold: 3 -> 255``
        amendment raises required runway from 5 to 257 envelopes (642.5 USDC).
        07 says "First arming" and 13's exhaustive coupling list names no
        reserve threshold screen, so the stored value can outrun live funding.
        """
        result = evaluate_threshold_amendment(
            "res.recover_threshold", RES_THRESHOLD_MAX
        )
        self.assertEqual(result.line_envelopes, 5)
        self.assertEqual(result.required_envelopes, 257)
        self.assertEqual(result.required_micro_usdc, 642_500_000)
        self.assertTrue(result.undercollateralized)
        self.assertFalse(result.runway_rechecked_by_spec)
        finding = next(
            item
            for item in amendment_findings()
            if item.key == "reserve runway rechecked on threshold amendment"
        )
        self.assertFalse(finding.ok)

    def test_a_fail_closed_runway_screen_accepts_default_and_refuses_the_raise(self):
        self.assertTrue(screen_reserve_thresholds(5, ReserveThresholds()))
        self.assertFalse(
            screen_reserve_thresholds(
                5, ReserveThresholds(fail=2, recover=RES_THRESHOLD_MAX)
            )
        )


class WatchtowerLivenessTests(unittest.TestCase):
    """07 §4 registration, SQ-491 latch semantics and liveness ejection."""

    @staticmethod
    def two_seats() -> WatchtowerSet:
        return WatchtowerSet().register("alice", "entity-a").register(
            "bob", "entity-b"
        )

    def test_registration_is_entity_unique_stably_ordered_and_bounded(self):
        watchtowers = WatchtowerSet().register("z", "entity-z").register(
            "a", "entity-a"
        )
        self.assertEqual(tuple(seat.account for seat in watchtowers.seats), ("a", "z"))
        with self.assertRaisesRegex(OracleModelError, "already has a seat"):
            watchtowers.register("other", "entity-a")

        full = WatchtowerSet()
        for index in range(WT_MAX):
            full = full.register(f"account-{index:02}", f"entity-{index:02}")
        with self.assertRaisesRegex(OracleModelError, "set is full"):
            full.register("overflow", "overflow-entity")

    def test_round_existed_latch_survives_close_and_is_not_caller_supplied(self):
        watchtowers = self.two_seats().note_round_opened().ack("alice")
        watchtowers = watchtowers.note_round_closed()
        sweep = watchtowers.sweep_liveness()
        self.assertTrue(sweep.had_work)
        self.assertEqual(sweep.marked_inactive, ("bob",))
        bob = next(seat for seat in sweep.watchtowers.seats if seat.account == "bob")
        self.assertEqual(bob.inactive_epochs, 1)

    def test_a_swept_no_work_epoch_breaks_the_inactive_streak(self):
        first = (
            self.two_seats()
            .note_round_opened()
            .ack("alice")
            .note_round_closed()
            .sweep_liveness()
        )
        bob = next(seat for seat in first.watchtowers.seats if seat.account == "bob")
        self.assertEqual(bob.inactive_epochs, 1)
        no_work = first.watchtowers.sweep_liveness()
        self.assertFalse(no_work.had_work)
        bob = next(seat for seat in no_work.watchtowers.seats if seat.account == "bob")
        self.assertEqual(bob.inactive_epochs, 0)

    def test_two_consecutive_misses_slash_once_and_release_ninety_percent(self):
        watchtowers = self.two_seats()
        for epoch in range(2):
            watchtowers = (
                watchtowers.note_round_opened().ack("alice").note_round_closed()
            )
            sweep = watchtowers.sweep_liveness()
            watchtowers = sweep.watchtowers
            if epoch == 0:
                self.assertEqual(sweep.ejected, ())
        self.assertEqual(tuple(seat.account for seat in watchtowers.seats), ("alice",))
        self.assertEqual(len(sweep.ejected), 1)
        self.assertEqual(sweep.ejected[0].account, "bob")
        self.assertEqual(sweep.ejected[0].slashed, 2_500)
        self.assertEqual(sweep.ejected[0].released, 22_500)

    def test_attrition_breaks_quorum_but_permissionless_reseating_repairs_it(self):
        run = simulate_watchtower_attrition(
            self.two_seats(),
            (frozenset({"alice"}), frozenset({"alice"})),
        )
        watchtowers = run.watchtowers
        self.assertEqual(run.first_below_quorum_epoch, 2)
        self.assertEqual(watchtowers.seat_count, 1)
        self.assertFalse(
            can_finalize_unchallenged(watchtowers.seat_count, WT_QUORUM_DEFAULT)
        )
        watchtowers = watchtowers.register("carol", "entity-c")
        self.assertTrue(
            can_finalize_unchallenged(watchtowers.seat_count, WT_QUORUM_DEFAULT)
        )

    def test_one_lawful_quorum_raise_strands_the_minimum_live_set(self):
        self.assertEqual(lawful_quorum_amendments(2), (3,))
        self.assertEqual(first_unsafe_quorum_amendment(seats=2), 3)
        self.assertTrue(can_finalize_unchallenged(2, 2))
        self.assertFalse(can_finalize_unchallenged(2, 3))
        finding = next(
            item
            for item in watchtower_findings()
            if item.key == "watchtower quorum preserved by every one-step amendment"
        )
        self.assertFalse(finding.ok)

    def test_cheapest_specified_exit_is_one_ten_percent_slash(self):
        calls = documented_oracle_calls(REPO_ROOT)
        self.assertIn("deregister_reporter", calls)
        self.assertNotIn("deregister_watchtower", calls)
        routes = {route.name: route for route in exit_cost_table()}
        self.assertFalse(routes["guardian recall"].specified)
        ejection = routes["deliberate liveness ejection"]
        self.assertEqual(ejection.observed_work_epochs, 2)
        self.assertEqual(ejection.cost_usdc, 2_500)
        self.assertEqual(ejection.released_usdc, 22_500)
        self.assertEqual(
            Fraction(ejection.cost_usdc, WT_STAKE_DEFAULT), Fraction(1, 10)
        )
        self.assertEqual(cheapest_specified_exit(), ejection)

    def test_quorum_loss_can_remove_the_attested_pillar_until_reseating(self):
        # Two missed work epochs eject bob, leaving the minimum set below
        # quorum.  Unchallenged rounds then neutralize; after two consecutive
        # flags, 07 §10 removes affected attested inputs.  Within a surviving
        # group the remaining A component takes weight 1; if all A components
        # drop, the P/A composite renormalizes to P, so W = g(S)·g(C)·P.
        run = simulate_watchtower_attrition(
            self.two_seats(),
            (frozenset({"alice"}), frozenset({"alice"})),
        )
        watchtowers = run.watchtowers
        self.assertEqual(run.first_below_quorum_epoch, 2)
        self.assertFalse(can_finalize_unchallenged(watchtowers.seat_count, 2))

        values = {"a1": Decimal("0.25"), "a2": Decimal("1")}
        weights = {"a1": Decimal("0.5"), "a2": Decimal("0.5")}
        self.assertEqual(
            drop_and_renormalize(values, weights, dropped={"a1"}),
            Decimal("1.000000000"),
        )
        emptied = emptied_pillar_groups(
            {"a1", "a2"},
            p_components={"p": Decimal("0.64")},
            a_components=values,
        )
        self.assertEqual(emptied, frozenset({"A"}))
        self.assertEqual(
            welfare_value(
                Decimal(1),
                Decimal(1),
                Decimal("0.64"),
                Decimal("0.25"),
                emptied_pillars=emptied,
            ),
            Decimal("0.640000000"),
        )


class CrossDocumentDelegationTests(unittest.TestCase):
    """Every architecture target linked from 07 §4/§8 is checked semantically."""

    def test_delegation_registry_covers_every_linked_target_document(self):
        self.assertEqual(
            declared_delegation_documents(),
            linked_architecture_documents(REPO_ROOT),
        )
        self.assertEqual(
            declared_delegation_document_counts(),
            linked_architecture_document_counts(REPO_ROOT),
        )

    def test_sq_554_two_watchtower_delegations_do_not_resolve(self):
        """SQ-554. Markdown targets are present but the delegated rules are not.

        07 §4 delegates recall to doc 06, which has no occurrence of
        "watchtower".  It also delegates entity independence to doc 05, which
        mentions registry entities only as a D_eff input and defines neither
        ``entity_ref`` nor the promised no-two-seats rule.
        """
        dangling = unresolved_delegations(REPO_ROOT)
        self.assertEqual(
            tuple(item.key for item in dangling),
            (
                "watchtower entity-independence rule",
                "watchtower recall",
            ),
        )
        self.assertTrue(all(item.source_present for item in dangling))
        self.assertEqual(
            dangling[0].missing_target_terms,
            ("entity_ref", "no two seats per entity"),
        )
        self.assertEqual(dangling[1].missing_target_terms, ("watchtower",))

    def test_every_other_delegation_resolves_in_its_target(self):
        findings = check_cross_document_delegations(REPO_ROOT)
        resolved = [item for item in findings if item.ok]
        self.assertEqual(len(resolved), len(findings) - 2)
        self.assertTrue(all(item.source_present for item in findings))
        self.assertTrue(all(not item.missing_target_terms for item in resolved))


if __name__ == "__main__":
    unittest.main()
