"""Pins every published figure in 08 §10 to the executable model.

Doc 08's preamble makes this obligatory: "all worked arithmetic is shown and MUST
be reproduced by the Phase-0 reference model". Two figures in §10 shipped wrong
before anything re-derived them (the 77,864 quiet-epoch cost and the 8.2-year
runway, both corrected 2026-07-30), which is exactly the failure this suite
exists to make impossible: a spec table and this module can no longer drift.

Tolerances are stated per assertion and are always display-rounding tolerances,
never fudge. Where the doc rounds a per-epoch figure for display and annualizes
the unrounded one (`ops.keepers` is 40,228.80/epoch printed as 40,229), the test
asserts the unrounded derivation and shows the rounding.
"""

from decimal import Decimal
import unittest

from bleavit_reference_model.sustainability import (
    CORETIME_PERIOD_DAYS,
    CORETIME_RENEWAL_CAP_KSM,
    coretime_annual_escalation,
    coretime_cost_after_years,
    coretime_renewals_per_year,
    runway_years_with_escalating_line,
    BASELINE_V_MIN,
    GENESIS_ENDOWMENT,
    NAV_FLOOR_CODE,
    NAV_FLOOR_META,
    NAV_FLOOR_PARAM,
    OBS_INTERVAL_MAX,
    POL_B,
    POL_B_BASELINE,
    POL_B_GATE,
    STALE_GAP_BLOCKS,
    CostParams,
    amendment_steps,
    annual_held_capital,
    baseline_held_capital,
    check_admissible,
    cost_base,
    crossover_held_capital,
    epochs_per_year,
    held_capital_at_saturation,
    held_capital_at_v_min,
    is_admissible,
    multiplicative_amendment_steps,
    quiet_epoch_cost,
    revenue,
    break_even_slots,
    break_even_slots_consistent,
    cost_at_occupancy,
    revenue_rate,
    runway_years,
    pre_e5_params,
    with_levers,
    COLLATOR_COMP_MIN,
    COLLATOR_COMP_MAX,
    PDOT_FUNDED_COLLATORS,
    PDOT_PER_COLLATOR_MONTH,
    collator_anchor_multiple,
    collator_comp_month,
    polkadot_collator_rate_epoch,
    polkadot_collator_rate_month,
)

D = Decimal


def pass1_params():
    """E5 pass 1: the SQ-531 fee-basis correction, before the SQ-536 reseed.

    Several published comparisons are against this intermediate point rather
    than against the pre-E5 world, because it isolates what re-anchoring
    `collator.comp_epoch` bought from what correcting the keeper fee basis
    bought. They were separate findings and the arithmetic keeps them separate.
    """
    return with_levers(collator_comp_epoch=2_000)


class EpochArithmeticTests(unittest.TestCase):
    def test_epochs_per_year_matches_the_doc_convention(self):
        # 08 §10.1: "Epoch = epoch.length = 302,400 blocks at 6 s = 21.0 days,
        # so 17.393 epochs/year (365.25/21)".
        self.assertAlmostEqual(epochs_per_year(), D("17.393"), places=3)


class CrankVolumeTests(unittest.TestCase):
    """13 §5 item 4 / 08 §6.1. The genesis registry sits EXACTLY on these."""

    def test_genesis_registry_reproduces_both_published_crank_figures(self):
        p = CostParams()
        self.assertEqual(p.trading_books(), D(31))  # epoch.slots*6 + 1
        self.assertEqual(p.decision_critical_cranks(), D(133_920))
        self.assertEqual(p.full_window_cranks(), D(580_320))

    def test_crank_volume_is_inversely_linear_in_the_observation_interval(self):
        """The whole E5 lever rests on this, so it is asserted, not assumed."""
        base = CostParams()
        for factor in (D(2), D("2.5"), D(5)):
            widened = with_levers(mkt_obs_interval=base.mkt_obs_interval * factor)
            self.assertEqual(
                widened.decision_critical_cranks() * factor,
                base.decision_critical_cranks(),
            )
            self.assertEqual(
                widened.full_window_cranks() * factor,
                base.full_window_cranks(),
            )


class CostBaseTests(unittest.TestCase):
    """08 §10.1's table, line by line."""

    def setUp(self):
        # The published 08 §10.1 table is the PRE-E5 operating point: its keeper
        # rows were computed from the assumed 0.03 USDC fee basis that SQ-531
        # replaced with the measured 0.000085. Pinning it here keeps the
        # superseded table reproducible and the size of the correction visible.
        self.cost = cost_base(pre_e5_params())

    def test_each_published_line_is_reproduced(self):
        for label, actual, published in (
            ("ops.collators", self.cost.collators, D(173_929)),
            ("KEEPER metered", self.cost.keeper_metered, D(208_714)),
            ("ops.keepers", self.cost.keeper_beyond_meter, D(699_694)),
            ("REWARDS ceiling", self.cost.proposer_rewards, D(43_482)),
            ("POL divergence", self.cost.pol_divergence, D(18_830)),
            ("ops.reserve_probe", self.cost.reserve_probe, D(913)),
        ):
            with self.subTest(line=label):
                self.assertLess(abs(actual - published), D(1), f"{label}: {actual}")

    def test_ops_keepers_is_the_unrounded_derivation_not_the_printed_figure(self):
        # 08 §6.3: 580,320 x 0.09 - 12,000. The table prints 40,229; the annual
        # column is computed from 40,228.80, and using the printed figure would
        # put the annual 3 USDC out. This is the shape of error the suite exists
        # to catch.
        p = pre_e5_params()
        per_epoch = p.full_window_cranks() * p.keeper_rebate - p.keeper_budget_epoch
        self.assertEqual(per_epoch, D("40228.80"))
        self.assertNotEqual(per_epoch, D(40_229))

    def test_subtotal_matches_the_published_floor(self):
        # 08 §10.1: "Subtotal (derivable from this doc set) ~ 1,145,562".
        self.assertLess(abs(self.cost.annual - D(1_145_562)), D(1))

    def test_the_cost_base_is_945_percent_keepers_and_collators(self):
        """The finding that motivates E5, asserted so it cannot rot."""
        shares = self.cost.shares()
        keeper_share = shares["keeper_metered"] + shares["keeper_beyond_meter"]
        self.assertAlmostEqual(keeper_share, D("0.793"), places=3)
        self.assertAlmostEqual(shares["collators"], D("0.152"), places=3)
        self.assertGreater(keeper_share + shares["collators"], D("0.94"))
        # And the single largest line is the one 08 §6.3 says buys chart density.
        self.assertAlmostEqual(shares["keeper_beyond_meter"], D("0.611"), places=3)

    def test_meta_only_reward_slate_reproduces_the_published_upper_bound(self):
        # 08 §10.1 last row: 5 x 25,000 = 188,364/epoch, 3,276,187/yr.
        meta = cost_base(pre_e5_params(proposer_reward=25_000))
        self.assertLess(abs(meta.annual - D(3_276_187)), D(2))


class QuietEpochTests(unittest.TestCase):
    def test_quiet_epoch_reproduces_the_corrected_figure(self):
        # 08 §10.6, corrected 2026-07-30 from 77,864. The old figure
        # double-counted `keeper.budget_epoch`: it took the keeper cost gross
        # (580,320 x 0.09 = 52,229) while keeping the separate 12,000 row that
        # the gross figure already contains.
        self.assertLess(abs(quiet_epoch_cost(pre_e5_params()) - D(62_281)), D(1))

    def test_the_superseded_figure_is_exactly_the_double_count(self):
        """Pins the diagnosis, not just the corrected number."""
        # 08 §10.6: "77,864 is exactly §10.1's 65,864 plus a second copy of
        # `keeper.budget_epoch`" -- it counted the keeper cost GROSS
        # (580,320 x 0.09 = 52,229) while also keeping the separate 12,000 row
        # that the gross figure already contains.
        p = pre_e5_params()
        epoch_subtotal = cost_base(p).annual / epochs_per_year()
        self.assertLess(abs(epoch_subtotal - D(65_864)), D(1))
        double_counted = epoch_subtotal + p.keeper_budget_epoch
        self.assertLess(abs(double_counted - D(77_864)), D(1))
        # And the corrected figure drops the two rows a quiet epoch cannot incur.
        self.assertLess(
            abs(
                epoch_subtotal
                - quiet_epoch_cost(p)
                - (p.proposer_reward * p.epoch_slots + p.pol_divergence_annual / epochs_per_year())
            ),
            D(1),
        )


class HeldCapitalTests(unittest.TestCase):
    """08 §10.3's capacity tables."""

    def test_per_proposal_held_capital_at_the_v_min_floors(self):
        for cls, published in (
            ("param", D(240_000)),
            ("treasury", D(600_000)),
            ("code", D(1_440_000)),
            ("meta", D(2_880_000)),
        ):
            with self.subTest(cls=cls):
                self.assertEqual(held_capital_at_v_min(cls), published)

    def test_per_proposal_held_capital_at_flow_cap_saturation(self):
        for cls, published in (
            ("param", D(800_000)),
            ("treasury", D(1_280_000)),
            ("code", D(2_400_000)),
            ("meta", D(3_680_000)),
        ):
            with self.subTest(cls=cls):
                self.assertEqual(held_capital_at_saturation(cls), published)

    def test_the_baseline_row_uses_its_own_unbranched_formula(self):
        # 08 §10.3: the Baseline book is unbranched and carries no gate books
        # (04 §8.2), so saturation is flow_cap * pol.b_baseline = 400,000 --
        # NOT the branched pair-plus-gates formula. Getting this wrong was
        # explicitly called out in the doc as a previously unstated derivation.
        self.assertEqual(baseline_held_capital(saturated=False), BASELINE_V_MIN)
        self.assertEqual(baseline_held_capital(saturated=True), D(400_000))
        self.assertNotEqual(
            baseline_held_capital(saturated=True), held_capital_at_saturation("treasury")
        )

    def test_annualized_slate_table(self):
        for cls, slots, saturated, published in (
            ("param", D(5), False, D(25_219_643)),
            ("param", D(5), True, D(76_528_571)),
            ("treasury", D(5), False, D(56_526_786)),
            ("treasury", D(5), True, D(118_271_429)),
            ("code", D(5), False, D(129_576_786)),
            ("code", D(5), True, D(215_671_429)),
            ("code", D(12), False, D(304_896_786)),
            ("code", D(12), True, D(507_871_429)),
        ):
            with self.subTest(cls=cls, slots=int(slots), sat=saturated):
                self.assertLess(
                    abs(annual_held_capital(cls, slots, saturated) - published), D(1)
                )


class RevenueTests(unittest.TestCase):
    """08 §10.2 and §10.4."""

    def test_revenue_rate_at_the_central_turnover_ratio(self):
        # mkt.fee*rho*tau + redeem_fee*beta = 0.003*0.75*3 + 0.003*0.5.
        self.assertEqual(revenue_rate(D(3)), D("0.00825"))

    def test_instrument_b_share_is_182_percent_at_tau_3(self):
        # 08 §10.2 states this explicitly and notes the earlier "about a sixth"
        # understated it.
        share = (D("0.003") * D("0.50")) / revenue_rate(D(3))
        self.assertAlmostEqual(share, D("0.182"), places=3)

    def test_published_revenue_table(self):
        for cls, saturated, tau, published in (
            ("param", False, D(2), D(151_318)),
            ("param", False, D(3), D(208_062)),
            ("param", False, D("5.8"), D(366_946)),
            ("param", True, D(2), D(459_171)),
            ("param", True, D(3), D(631_361)),
            ("param", True, D("5.8"), D(1_113_491)),
            ("treasury", True, D(2), D(709_629)),
            ("treasury", True, D(3), D(975_739)),
            ("treasury", True, D("5.8"), D(1_720_849)),
            ("code", True, D(3), D(1_779_289)),
            ("code", True, D("5.8"), D(3_138_019)),
        ):
            with self.subTest(cls=cls, sat=saturated, tau=str(tau)):
                held = annual_held_capital(cls, D(5), saturated)
                self.assertLess(abs(revenue(held, tau) - published), D(2))

    def test_crossover_at_the_published_cost_base(self):
        # 08 §10.4: C = 1,145,562, tau = 3 => H = 138,855,943. The model derives
        # C unrounded (1,145,561.77), so V* lands ~29 USDC off a 138.9M figure.
        c = cost_base(pre_e5_params()).annual
        self.assertLess(abs(crossover_held_capital(c, D(3)) - D(138_855_943)), D(100))

    def test_the_crossover_sits_just_above_a_saturated_treasury_slate(self):
        # 08 §10.4's headline: V* is 1.17x the 5 x TREASURY saturated slate and
        # 0.64x the 5 x CODE one.
        c = cost_base(pre_e5_params()).annual
        v_star = crossover_held_capital(c, D(3))
        self.assertAlmostEqual(
            v_star / annual_held_capital("treasury", D(5), True), D("1.17"), places=2
        )
        self.assertAlmostEqual(
            v_star / annual_held_capital("code", D(5), True), D("0.64"), places=2
        )


class RunwayTests(unittest.TestCase):
    """08 §10.5."""

    def test_published_runway_row_at_the_derivable_cost_base(self):
        c = cost_base(pre_e5_params()).annual
        for floor, published in (
            (NAV_FLOOR_META, D("3.3")),
            (NAV_FLOOR_CODE, D("9.7")),
            (NAV_FLOOR_PARAM, D("17.8")),
        ):
            with self.subTest(floor=str(floor)):
                self.assertAlmostEqual(runway_years(c, floor), published, places=1)

    def test_the_superseded_82_year_figure_came_from_a_cost_base_in_no_table(self):
        # 08 §10.6, corrected 2026-07-30: 8.2 yr is the same quotient taken
        # against 1,354,279/yr -- the annualization of the erroneous
        # 77,864/epoch -- and 1,354,279 appears in no table in §10.
        stale = D(77_864) * epochs_per_year()
        # 1.6 USDC off the doc's 1,354,279 -- the doc annualized the rounded
        # 77,864. Immaterial against 1.35M and recorded rather than smoothed.
        self.assertLess(abs(stale - D(1_354_279)), D(2))
        self.assertAlmostEqual(
            runway_years(stale, NAV_FLOOR_CODE), D("8.2"), places=1
        )

    def test_revenue_covering_cost_yields_an_infinite_runway(self):
        self.assertTrue(runway_years(D(100), NAV_FLOOR_CODE, D(100)).is_infinite())
        self.assertTrue(runway_years(D(100), NAV_FLOOR_CODE, D(150)).is_infinite())
        self.assertFalse(runway_years(D(100), NAV_FLOOR_CODE, D(99)).is_infinite())

    def test_the_pre_e1_leak_reproduces_its_published_runway_row(self):
        # 08 §10.5: C = 2.954M with the gross 1,808,371 POL diversion added.
        leaked = cost_base(pre_e5_params()).annual + D(1_808_371)
        self.assertAlmostEqual(runway_years(leaked, NAV_FLOOR_CODE), D("3.8"), places=1)
        self.assertAlmostEqual(runway_years(leaked, NAV_FLOOR_META), D("1.3"), places=1)


class AdmissibilityTests(unittest.TestCase):
    """A cost reduction that governance cannot reach is not a proposal."""

    def test_the_genesis_keeper_meter_does_not_cover_its_own_derived_load(self):
        """SQ-527. 08 §6.2 asserts it does; the arithmetic says otherwise.

        The section derives 133,920 x 0.09 = 12,053 and then sets
        `keeper.budget_epoch` = 12,000, claiming "the budget covers the full
        decision-critical load". It is 52.80 USDC/epoch short, and 08 §6.3 makes
        exhaustion a LATCH -- once fired, no further metered rebate is paid for
        the rest of the epoch. So on a worst-case (zero-organic-trade) epoch the
        meter exhausts before the decision-critical load completes.
        """
        p = pre_e5_params()
        required = p.decision_critical_cranks() * p.keeper_rebate
        self.assertEqual(required, D("12052.80"))
        self.assertLess(p.keeper_budget_epoch, required)
        finding = next(
            f
            for f in check_admissible(p)
            if f.key == "keeper.budget_epoch covers decision-critical load"
        )
        self.assertFalse(finding.ok)

    def test_sq_526_the_interval_max_equals_the_kernel_staleness_gap(self):
        # The top of `mkt.obs_interval`'s own registry range guarantees
        # staleness events, and nothing screens the pair.
        self.assertEqual(OBS_INTERVAL_MAX, STALE_GAP_BLOCKS)
        at_max = with_levers(mkt_obs_interval=OBS_INTERVAL_MAX)
        finding = next(
            f
            for f in check_admissible(at_max)
            if f.key == "mkt.obs_interval vs MKT_STALE_GAP_BLOCKS"
        )
        self.assertFalse(finding.ok)

    def test_raising_the_interval_passes_the_occupancy_screen_and_lowering_fails(self):
        # 13 §5(b): the genesis registry sits exactly on the frozen figures, so
        # raising `mkt.obs_interval` is ordinary business and lowering is
        # refused at that registry.
        raised = with_levers(mkt_obs_interval=25)
        for key in (
            "13 §5 occupancy screen (decision-critical)",
            "13 §5 occupancy screen (full-window)",
        ):
            with self.subTest(key=key, direction="raise"):
                self.assertTrue(next(f for f in check_admissible(raised) if f.key == key).ok)
        lowered = with_levers(mkt_obs_interval=5)
        for key in (
            "13 §5 occupancy screen (decision-critical)",
            "13 §5 occupancy screen (full-window)",
        ):
            with self.subTest(key=key, direction="lower"):
                self.assertFalse(next(f for f in check_admissible(lowered) if f.key == key).ok)

    def test_amendment_walks_are_rate_limited_as_the_registry_says(self):
        # 13 §1: mkt.obs_interval carries an ADDITIVE max-delta of 5 and a
        # 1-epoch cooldown, so 10 -> 25 is three amendments, not one.
        self.assertEqual(amendment_steps(D(10), D(25), D(5)), 3)
        self.assertEqual(amendment_steps(D(10), D(20), D(5)), 2)
        # collator.comp_epoch carries a MULTIPLICATIVE x2, so 2,000 -> 500 is two.
        self.assertEqual(multiplicative_amendment_steps(D(2_000), D(500), D(2)), 2)


class OperatingPointTests(unittest.TestCase):
    """What the E5 levers actually buy, asserted rather than asserted-about."""

    def test_under_the_superseded_fee_basis_no_lawful_lever_reached_25_years(self):
        """Why this could not be closed by a parameter sweep alone.

        With `keeper.rebate` at its assumed-0.03-basis seed, every lawful
        values-layer move applied together still left the keeper subsidy
        dominant and the 25-year target out of reach. That negative result is
        what forced the question "is the fee basis actually right?" -- and it
        was not (SQ-531).
        """
        best = pre_e5_params(
            mkt_obs_interval=25, keeper_budget_epoch=6_000, collator_comp_epoch=500
        )
        self.assertTrue(is_admissible(best), [f.detail for f in check_admissible(best) if not f.ok])
        self.assertLess(runway_years(cost_base(best).annual, NAV_FLOOR_CODE), D(25))

    def test_correcting_the_fee_basis_is_most_of_the_reduction(self):
        """The correction dwarfs every discretionary lever, and is not a cut.

        `keeper.rebate` claimed to be 3x the crank fee. Measured against the
        committed weights it was ~1,058x. Resolving that one [VERIFY] -- which
        R-2 requires rather than permits -- removes 79 % of the cost base
        without changing a single policy.
        """
        before = cost_base(pre_e5_params()).annual
        after = cost_base(CostParams()).annual
        self.assertLess(abs(before - D(1_145_562)), D(1))
        self.assertLess(after, D(240_000))
        self.assertGreater((before - after) / before, D("0.79"))
        # And the keeper lines specifically collapse by three orders of magnitude.
        self.assertGreater(
            cost_base(pre_e5_params()).keeper_total / cost_base(CostParams()).keeper_total,
            D(300),
        )

    def test_the_shipped_e5_operating_point_clears_25_years(self):
        """The goal, asserted against what actually SHIPS.

        `CostParams()` is the shipped genesis operating point: the SQ-531
        fee-basis correction AND the SQ-536 `collator.comp_epoch` reseed.

        Measured to the 13,862,944 CODE **seeding** floor, which is the
        operating constraint: below it no CODE proposal fits an epoch's POL
        budget. Zero revenue is assumed.

        The goal is also asserted against the 21,256,533 shared CODE/META
        **arming** floor, which BINDS earlier than the seeding floor and is
        therefore the honest test of "25 years". Pass 1 cleared the seeding
        floor but not this one; pass 2 clears both.
        """
        p = CostParams()
        self.assertTrue(is_admissible(p), [f.detail for f in check_admissible(p) if not f.ok])
        c = cost_base(p).annual
        self.assertLess(c, D(110_000))
        self.assertGreater(runway_years(c, NAV_FLOOR_CODE), D(100))
        self.assertGreater(runway_years(c, NAV_FLOOR_PARAM), D(180))
        # The binding floor, at ZERO revenue -- this is the goal statement.
        self.assertGreater(runway_years(c, NAV_FLOOR_META), D(25))
        # And it was NOT cleared at pass 1, so the reseed is what carried it.
        self.assertLess(runway_years(cost_base(pass1_params()).annual, NAV_FLOOR_META), D(25))

    def test_self_funding_is_conditional_on_slate_occupancy_not_just_depth(self):
        """The correction a Codex review forced, and the claim it replaces.

        E5 originally reported the shipped point as "self-funding at minimum
        viable activity", taking a FIVE-slot PARAM slate at the `dec.v_min`
        floor as that minimum. That conflates two axes. Five slots at the floor
        is the minimum *depth* at which five proposals are decision-grade; the
        minimum *activity* at which the chain decides anything is ONE proposal,
        and held capital scales with occupancy.

        The correction stands and is kept, because it is what makes the
        occupancy axis visible at all. What pass 2 changed is the ANSWER, not
        the question: at the pass-1 cost base one occupied slot earned ~70.3k
        against 239.7k and did not self-fund; at the shipped base the same
        single slot covers it. The dependence on sustained slate utilisation
        (SQ-506) is therefore discharged for the shipped point rather than
        assumed away -- and the test still pins the pass-1 shortfall so the
        claim cannot quietly revert.
        """
        shipped = cost_base(CostParams()).annual
        pass1 = cost_base(pass1_params()).annual

        one_slot = annual_held_capital("param", D(1), saturated=False)
        self.assertLess(abs(one_slot - D(8_522_500)), D(1))
        self.assertLess(abs(revenue(one_slot, D(3)) - D(70_311)), D(2))

        # Two readings, and they must not be conflated -- conflating them is
        # the exact error that produced the claim this test replaces.
        #
        # (a) CONSISTENT: cost and revenue both evaluated at the occupancy in
        #     question. This is the correct comparison, and one occupied slot
        #     covers the shipped base (70,311 against 58,808).
        self.assertGreaterEqual(revenue(one_slot, D(3)), cost_at_occupancy(D(1)))
        self.assertEqual(break_even_slots_consistent(D(3)), 1)
        # (b) FIXED full-slate cost: conservative, since it charges five slots'
        #     per-proposal rows against one slot's trading. One slot does NOT
        #     clear it; three do, and three is inside the lawful slate.
        self.assertLess(revenue(one_slot, D(3)), shipped)
        self.assertEqual(break_even_slots(shipped, D(3)), 3)
        self.assertLessEqual(D(3), CostParams().epoch_slots)
        # At the measured median turnover even the conservative reading is one.
        self.assertEqual(break_even_slots(shipped, D("5.8")), 1)

        # Against pass 1, one slot fell short under BOTH readings, and the
        # conservative reading needed SIX occupied slots -- above
        # `epoch.slots` = 5, so unreachable without also amending that key.
        self.assertLess(revenue(one_slot, D(3)), pass1)
        self.assertLess(revenue(one_slot, D(3)), cost_at_occupancy(D(1), pass1_params()))
        self.assertEqual(break_even_slots(pass1, D(3)), 6)
        self.assertGreater(D(6), CostParams().epoch_slots)
        self.assertEqual(break_even_slots(pass1, D("5.8")), 3)

    def test_the_shipped_point_needs_both_occupancy_and_turnover(self):
        """Both conditions stated together, since either alone is misleading.

        At pass 1 a full floor slate was SHORT at the conservative tau and only
        covered at the measured median. The reseed clears both, so what this
        test now pins is the pass-1 shortfall (as the historical statement it
        is) alongside the shipped surplus -- the point being that the shipped
        conclusion no longer needs the more favourable turnover assumption.
        """
        shipped = cost_base(CostParams()).annual
        pass1 = cost_base(pass1_params()).annual
        full_slate = annual_held_capital("param", D(5), saturated=False)

        # Pass 1: short at the conservative churn-excluded tau...
        self.assertLess(revenue(full_slate, D(3)), pass1)
        self.assertLess(pass1 - revenue(full_slate, D(3)), D(35_000))
        # ...covered only at the measured median all-book turnover.
        self.assertGreater(revenue(full_slate, D("5.8")), pass1)

        # Shipped: covered at BOTH, so the conclusion no longer rests on tau.
        for tau in (D(2), D(3), D("5.8")):
            with self.subTest(tau=str(tau)):
                r = revenue(full_slate, tau)
                self.assertGreater(r, shipped)
                self.assertTrue(runway_years(shipped, NAV_FLOOR_CODE, r).is_infinite())

    def test_cost_must_be_evaluated_at_the_same_occupancy_as_revenue(self):
        """The mirror of the occupancy error, found while fixing it.

        `break_even_slots` holds the FULL-slate cost fixed while varying revenue
        occupancy, which charges five slots' proposer rewards against one slot's
        trading. Two §10.1 rows are per-proposal rather than standing --
        `REWARDS` (paid only on `Executed`) and the realized POL divergence
        (needs a seeded book) -- so the consistent comparison scales them.
        """
        p = CostParams()
        full = cost_base(p).annual
        # Tolerance, not equality: the two are computed in different
        # working-precision contexts and differ only in trailing digits.
        self.assertLess(abs(cost_at_occupancy(p.epoch_slots, p) - full), D("0.000001"))
        self.assertLess(cost_at_occupancy(D(1), p), full)

        # The structural claim, stated as the comparison it actually is rather
        # than as a bare threshold: revenue is linear in occupancy, so at one
        # of five slots it is exactly 1/5 of full; cost is not, because part of
        # it is standing. Cost therefore falls MORE SLOWLY than revenue, which
        # is the whole reason occupancy has to be held common between them.
        cost_ratio = cost_at_occupancy(D(1), p) / full
        revenue_ratio = D(1) / p.epoch_slots
        self.assertGreater(cost_ratio, revenue_ratio)

        # The SQ-536 reseed cut the standing share materially but did not
        # remove it: one-slot cost was 79.0 % of full-slate cost at pass 1 and
        # is 53.8 % at the shipped point. Pinned in both directions so neither
        # "collator compensation is standing" nor "occupancy scaling now
        # dominates" can be overstated later.
        self.assertLess(abs(cost_ratio - D("0.5381")), D("0.0002"))
        self.assertLess(
            abs(cost_at_occupancy(D(1), pass1_params()) / cost_base(pass1_params()).annual
                - D("0.7895")),
            D("0.0002"),
        )

    def test_the_pol_row_splits_by_b_not_into_equal_proposal_parts(self):
        """Realized divergence loss is linear in `b`, so the split follows `b`.

        A PARAM proposal carries `2*pol.b + 4*pol.b_gate` = 50,000 against the
        Baseline's `pol.b_baseline` = 25,000, making the Baseline 1/11 of a
        five-slot row -- not 1/6.

        The 1/6 reading comes from 08 §10.5, where the Baseline's cash happens
        to equal PARAM's per-proposal cash. That is a different quantity: §10.5
        measures custody AT RISK, in which a branched proposal contributes only
        half its commitment because one `split` funds a branch pair. The
        coincidence there does not carry to a loss linear in `b`.
        """
        p = CostParams()
        b_per_proposal = POL_B["param"] * D(2) + POL_B_GATE * D(4)
        self.assertEqual(b_per_proposal, D(50_000))
        self.assertEqual(POL_B_BASELINE, D(25_000))
        baseline_share = POL_B_BASELINE / (b_per_proposal * p.epoch_slots + POL_B_BASELINE)
        self.assertEqual(baseline_share, D(1) / D(11))

        # The standing (Baseline-only) POL residue at zero occupancy.
        standing = cost_at_occupancy(D(0), p) - cost_at_occupancy(D(0), with_levers(pol_divergence_annual=0))
        self.assertLess(abs(standing - p.pol_divergence_annual / D(11)), D("0.01"))

    def test_keeper_cost_scales_with_occupancy_like_the_crank_load_does(self):
        """Raised by review. 13 §5 item 4 derives observation load from
        `epoch.slots * 6 + 1` books, so keeper cost scales with OCCUPIED slots
        and only the epoch's single Baseline book is observed at zero
        occupancy. Treating it as standing charged five slots' observations at
        one-slot occupancy and, worse, capped it at five when the break-even
        search evaluated six through twelve.
        """
        p = CostParams()
        full = cost_base(p).keeper_total
        # At zero occupancy only the Baseline book is observed: 1 of 31.
        self.assertLess(
            abs(cost_at_occupancy(D(0), p) - cost_at_occupancy(D(0), with_levers(keeper_rebate=0))
                - full / D(31)),
            D("0.01"),
        )
        # And it keeps scaling above the default slate rather than saturating.
        self.assertGreater(cost_at_occupancy(D(7), p), cost_at_occupancy(D(5), p))

    def test_the_break_even_conclusion_survives_the_pol_split_uncertainty(self):
        """Bounds the P1 rather than guessing per-book settlement prices.

        Realized POL loss is `b*[ln2 - H(p)]` and 04 §12 gives different prices
        for Baseline, decision and gate books, so the standing-versus-scaling
        split of that row is genuinely uncertain -- the `b`-weighted 1/11 is a
        first-order model, not a derivation from prices.

        Rather than invent prices the spec does not pin, drive the whole row to
        BOTH extremes: entirely scaling with proposals, and entirely standing.
        The published break-even is unchanged in three of four cells and moves
        by one slot in the fourth, so the conclusions do not rest on the split.
        """
        for params, tau, expected in (
            (pass1_params(), D(3), {7}),
            (pass1_params(), D("5.8"), {3}),
            (CostParams(), D(3), {1, 2}),
            (CostParams(), D("5.8"), {1}),
        ):
            with self.subTest(tau=str(tau), collator=str(params.collator_comp_epoch)):
                actual = break_even_slots_consistent(tau, params)
                self.assertIn(actual, expected)
                # The whole POL row is at most 17.3 % of the cost base, which
                # is why the extremes cannot move the answer far. The share
                # ROSE with the SQ-536 reseed -- not because POL grew, but
                # because the base it is measured against shrank -- so this
                # bound is restated rather than inherited.
                self.assertLess(
                    params.pol_divergence_annual / cost_base(params).annual, D("0.18")
                )

    def test_the_standing_collator_line_decides_whether_one_proposal_suffices(self):
        """The most decision-relevant result in E5, and it is not a value choice.

        `ops.collators` is STANDING: it bills whether or not the chain decides
        anything, which is the wrong shape for a protocol whose revenue is
        activity-linked. Evaluating cost and revenue at the same occupancy
        makes the consequence exact, and it is a single number: the occupied
        slot count at which revenue first covers cost.

        At pass 1 that line was 72.6 % of the base and the standing weight
        dominated so heavily that break-even needed SEVEN occupied slots at
        tau = 3 -- above `epoch.slots` = 5, so not reachable without also
        amending that key. At the shipped point (SQ-536) it is 39.8 %, and ONE
        occupied slot covers the base at the same turnover.

        This is why the question was worth answering rather than deferring: the
        `collator.comp_epoch` value does not merely change a cost line by a
        percentage, it decides whether the protocol requires sustained
        full-slate demand to break even or a single proposal.
        """
        shipped = CostParams()
        pass1 = pass1_params()

        # Pass 1: seven slots, above the lawful slate size.
        self.assertEqual(break_even_slots_consistent(D(3), pass1), 7)
        self.assertGreater(D(7), pass1.epoch_slots)
        # At the measured median turnover pass 1 needed three, inside the slate.
        self.assertEqual(break_even_slots_consistent(D("5.8"), pass1), 3)

        # Shipped: one slot, at both turnovers.
        self.assertEqual(break_even_slots_consistent(D(3), shipped), 1)
        self.assertEqual(break_even_slots_consistent(D("5.8"), shipped), 1)
        self.assertLessEqual(D(1), shipped.epoch_slots)

        # The standing share, pinned on both sides of the reseed.
        self.assertLess(abs(cost_base(pass1).collators / cost_base(pass1).annual - D("0.726")), D("0.001"))
        self.assertLess(
            abs(cost_base(shipped).collators / cost_base(shipped).annual - D("0.398")), D("0.001")
        )

    def test_the_collator_reseed_is_worth_130k_a_year(self):
        """The magnitude of the SQ-536 reseed, and what it decides.

        `collator.comp_epoch` 2,000 -> 500 (its 13 §1 registry minimum) is
        worth ~130,447/yr -- 72.6 % of the pass-1 base -- and it is what
        carries the runway past 25 years against the 21,256,533 shared
        CODE/META **arming** floor, which binds earlier than the seeding floor
        and is therefore the real test of the goal.

        E5 pass 1 declined this on R-2 grounds: unsafe error direction
        (underpaid collators stop producing blocks) and no evidence anchor,
        since 12 §6.1 mandates growth to 8-12 bonded permissionless collators
        and gives counts, never costs. Pass 2 found the anchor outside this
        repository instead of inventing one -- see the anchor tests below.
        """
        shipped = cost_base(CostParams()).annual
        pass1 = cost_base(pass1_params()).annual
        self.assertLess(abs((pass1 - shipped) - D(130_447)), D(2))
        # Pass 1 left the binding arming floor short of 25 years...
        self.assertLess(runway_years(pass1, NAV_FLOOR_META), D(25))
        # ...and the reseed clears it, at ZERO assumed revenue.
        self.assertGreater(runway_years(shipped, NAV_FLOOR_META), D(25))


class CoretimeEscalationTests(unittest.TestCase):
    """SQ-538. The cost line 08 §10.1 excludes, and why excluding it flatters.

    §10.1 leaves `ops.coretime` out of the table because the `broker.renew`
    price is an off-chain quote and "the renewal *period* is not stated
    anywhere in this document set". The second half is resolvable -- the period
    is a property of Polkadot, not a Bleavit choice -- and resolving it exposes
    that the level was never the interesting quantity. The growth rate is.
    """

    def test_the_renewal_period_is_a_platform_constant_not_a_missing_value(self):
        """28 days, so 13.0446 renewals a year. Not 12: a period is not a month."""
        self.assertEqual(CORETIME_PERIOD_DAYS, D(28))
        self.assertLess(abs(coretime_renewals_per_year() - D("13.0446")), D("0.0001"))
        # The off-by-8.7% a reader gets from assuming monthly renewals.
        self.assertGreater(coretime_renewals_per_year(), D(12))

    def test_the_rent_control_compounds_into_a_47_percent_annual_ceiling(self):
        """The finding. A 3 %/period cap is not a 3 % problem.

        Bulk renewals are price-capped, which reads as protection and per
        period is. Applied 13.04 times a year it is +47 %, and 08 §10.5's
        runway table holds `C` constant, so nothing there accounts for it.
        """
        self.assertLess(
            abs(coretime_annual_escalation(CORETIME_RENEWAL_CAP_KSM) - D("0.470")), D("0.001")
        )
        # Bracketed rather than pinned to one cap, because Polkadot's own value
        # is [VERIFY] -- the 3 % is Kusama's configuration.
        for cap, expected in ((D("0.01"), D("0.139")), (D("0.02"), D("0.295"))):
            with self.subTest(cap=str(cap)):
                self.assertLess(abs(coretime_annual_escalation(cap) - expected), D("0.001"))
        # Monotone in the cap, and strictly worse than the naive reading of it.
        self.assertGreater(coretime_annual_escalation(D("0.03")), D("0.03") * D(13))

    def test_a_small_coretime_line_becomes_the_largest_line_within_a_decade(self):
        """Why the level being small today is not reassurance."""
        start = D(4_000)
        ten = coretime_cost_after_years(start, D(10))
        self.assertGreater(ten, cost_base().annual)  # exceeds the WHOLE base
        self.assertLess(abs(ten - D(189_073)), D(50))

    def test_the_25_year_goal_does_not_survive_an_escalating_coretime_line(self):
        """The correction this milestone owes its own headline.

        SQ-536 reported 34.3 years to the binding arming floor at zero revenue,
        computed against a constant `C`. Adding the one unavoidable external
        cost, with the escalation its own price cap permits, more than halves
        it -- and it does so at a starting level small enough that §10.1 felt
        able to omit the line entirely.
        """
        c = cost_base().annual
        constant = runway_years(c, NAV_FLOOR_META)
        self.assertGreater(constant, D(25))

        for initial, expected in ((D(4_000), D("14.3")), (D(25_000), D("10.1"))):
            with self.subTest(initial=str(initial)):
                escalating = runway_years_with_escalating_line(c, NAV_FLOOR_META, initial)
                self.assertLess(abs(escalating - expected), D("0.15"))
                self.assertLess(escalating, D(25))
                self.assertLess(escalating, constant / D(2))

    def test_the_escalation_is_a_ceiling_and_the_model_says_so(self):
        """Stated as a bound, because claiming it as a forecast would be wrong.

        Renewals escalate only while the market price rises; the cap limits how
        fast a renewal may track it, it does not push the price up. A zero cap
        must therefore reproduce the constant-`C` answer exactly, which is the
        check that this model adds a bound rather than an assumption.
        """
        self.assertEqual(coretime_annual_escalation(D(0)), D(0))
        c = cost_base().annual
        flat = runway_years_with_escalating_line(c, NAV_FLOOR_META, D(0), per_period_cap=D(0))
        self.assertLess(abs(flat - runway_years(c, NAV_FLOOR_META)), D("1.0"))


class CollatorAnchorTests(unittest.TestCase):
    """SQ-536. The external evidence that made `collator.comp_epoch` decidable.

    R-2 permits a values-layer number only when it is DERIVED -- tied to a
    kernel constant, an existing key, or published calibration evidence -- and
    reserves escalation for a value whose error direction is unsafe AND which
    no evidence anchors. Collator compensation is a market price, so the first
    two anchors are unavailable by construction; pass 1 concluded the third was
    too and deferred. It was not. Polkadot's own treasury funds the identical
    role and its rate is public, governance-approved and executed.
    """

    def test_the_anchor_is_a_governance_approved_rate_for_the_same_role(self):
        """Referendum #1870: 38 funded system-parachain collators at $250/mo.

        Recorded as constants rather than as a derived quotient so the source
        figures stay checkable against the referendum itself.
        """
        self.assertEqual(PDOT_FUNDED_COLLATORS, D(38))
        self.assertEqual(PDOT_PER_COLLATOR_MONTH, D(250))
        # Loading the referendum's own shared overheads (hosting, curators,
        # coordinator) across the funded set gives the honest comparand.
        self.assertLess(abs(polkadot_collator_rate_month(loaded=False) - D("250.00")), D("0.01"))
        self.assertLess(abs(polkadot_collator_rate_month(loaded=True) - D("307.24")), D("0.01"))

    def test_the_rate_is_converted_into_registry_units_not_read_as_monthly(self):
        """An epoch is 21.0 days, NOT a month.

        Reading the monthly rate straight into 13 §1's row would understate it
        by 12/17.393 = 0.69x. The conversion is the step most likely to be got
        wrong silently, so it is pinned on its own.
        """
        self.assertLess(abs(polkadot_collator_rate_epoch(loaded=True) - D("211.97")), D("0.01"))
        self.assertLess(abs(polkadot_collator_rate_epoch(loaded=False) - D("172.48")), D("0.01"))
        # Round-trip: the registry row expressed back in USD/month.
        self.assertLess(abs(collator_comp_month(D(500)) - D("724.70")), D("0.01"))
        self.assertLess(abs(collator_comp_month(D(2_000)) - D("2898.81")), D("0.01"))

    def test_the_shipped_seed_clears_the_anchor_with_margin(self):
        """The safety argument, which is a MULTIPLE and not an absolute.

        The unsafe direction is underpaying, so what has to hold is headroom
        above a rate real operators demonstrably accepted for the same job.
        The shipped seed pays 2.36x the fully-loaded anchored rate -- margin
        that has to absorb the one real disanalogy, namely that a Polkadot
        system-parachain operator is already running Polkadot infrastructure
        and so is quoting a MARGINAL cost, where a new chain's operators
        amortize nothing.
        """
        shipped = CostParams().collator_comp_epoch
        self.assertEqual(shipped, COLLATOR_COMP_MIN)
        self.assertGreater(collator_anchor_multiple(shipped, loaded=True), D(2))
        self.assertLess(abs(collator_anchor_multiple(shipped, loaded=True) - D("2.359")), D("0.001"))
        # The conclusion does not depend on whether the anchor is loaded.
        self.assertGreater(collator_anchor_multiple(shipped, loaded=False), D(2))

    def test_the_superseded_seed_was_an_order_of_magnitude_above_the_anchor(self):
        """Why this was worth revisiting at all: 2,000 was 9.4x the anchor."""
        self.assertGreater(collator_anchor_multiple(D(2_000), loaded=True), D(9))
        self.assertLess(abs(collator_anchor_multiple(D(2_000), loaded=True) - D("9.435")), D("0.001"))

    def test_the_value_is_the_registry_bound_and_not_a_chosen_number(self):
        """R-2: derive the value, never pick it.

        The derivation is: take the lowest LAWFUL value, then show it clears
        the anchor with margin. That is reproducible from the registry plus one
        external source, and it leaves no room for a preference. Choosing an
        intermediate value -- 1,000, say -- would be a pick, because nothing in
        the evidence distinguishes it.
        """
        self.assertEqual(CostParams().collator_comp_epoch, COLLATOR_COMP_MIN)
        # The registry bound itself is UNCHANGED by this milestone: the seed
        # moves to the floor, the floor does not move to the seed.
        self.assertEqual(COLLATOR_COMP_MIN, D(500))
        self.assertEqual(COLLATOR_COMP_MAX, D(10_000))

    def test_all_remaining_headroom_is_in_the_safe_direction(self):
        """Seeding at the floor is only safe because recovery is cheap.

        `collator.comp_epoch` is PARAM with a x2 max-delta and a 1-epoch
        cooldown, so if the anchor turns out to understate what real operators
        demand, governance doubles it in one amendment and reaches the old
        2,000 in two. The unsafe direction is bounded and fast to exit; the
        safe direction has 20x of headroom.

        What this does NOT rest on, and an earlier revision of this docstring
        wrongly claimed it did: the 08 §2.4 fail-soft payout. That catches an
        underfunded *line* -- the pool the configured value implies cannot be
        paid, so the accumulator survives for a retry. It does not catch an
        underpriced *row*: the pool is computed FROM this value, a payout at
        that value succeeds in full, the accumulator is cleared, and no unpaid
        difference is retained. Underpricing degrades to collators leaving, not
        to a delayed payment.

        Nor does invulnerability of the launch set, which an even earlier
        revision also cited: that fixes an account's *selection* status and
        does not oblige anyone to keep authoring at a rate they will not
        accept -- and the launch operators are the most likely to be standing
        up infrastructure for this chain, which is precisely the case the
        marginal-cost anchor does not cover.

        The real protections are the margin asserted above, this recovery
        path, and the 13 §1 gate requiring operator quotes for THIS chain
        before production launch and before each enlargement of the set.
        """
        self.assertEqual(multiplicative_amendment_steps(D(500), D(1_000), D(2)), 1)
        self.assertEqual(multiplicative_amendment_steps(D(500), D(2_000), D(2)), 2)
        self.assertEqual(COLLATOR_COMP_MAX / COLLATOR_COMP_MIN, D(20))

    def test_the_25_year_goal_does_not_survive_the_mandated_collator_growth(self):
        """The qualification the headline figure needs, stated as a test.

        SQ-536's headline is 34.3 years to the binding 21.26M CODE/META
        arming floor at ZERO revenue. That is the LAUNCH count of 5. 12 §6.1
        mandates growth to 8-12 bonded permissionless collators from Phase 4+,
        and `collator.comp_epoch` is already at its registry floor, so the only
        remaining lever on this line is the count -- which is a liveness
        posture, not an economics choice.

        At 10 and at 12 the zero-revenue runway falls BELOW 25 years. Asserted
        rather than noted, because a headline that holds only at the launch
        count while the specification mandates a larger one is exactly the kind
        of claim that goes stale silently.

        The honest full statement, which the two halves below pin together:
        the endowment-only reading fails at the mandated ceiling, but
        break-even occupancy stays INSIDE the lawful five-slot slate at every
        mandated count -- so zero-revenue is the pessimistic bound, not the
        expected case, and the conclusion to draw is that mature operation
        depends on revenue rather than on the endowment.
        """
        # Launch count clears it; the mandated range does not, from 10 up.
        self.assertGreater(runway_years(cost_base().annual, NAV_FLOOR_META), D(25))
        for n, clears in ((8, True), (10, False), (12, False)):
            with self.subTest(collators=n):
                c = cost_base(with_levers(collator_count=n)).annual
                years = runway_years(c, NAV_FLOOR_META)
                self.assertEqual(years > D(25), clears)

        # At the mandated ceiling: 170,156/yr and 22.0 years.
        c12 = cost_base(with_levers(collator_count=12)).annual
        self.assertLess(abs(c12 - D(170_156)), D(2))
        self.assertLess(abs(runway_years(c12, NAV_FLOOR_META) - D("22.0")), D("0.1"))

        # But break-even stays inside the lawful slate throughout, so the
        # zero-revenue reading is a bound and not a forecast.
        for n in (5, 8, 10, 12):
            with self.subTest(collators=n, axis="break-even"):
                p = with_levers(collator_count=n)
                self.assertLessEqual(
                    D(break_even_slots_consistent(D(3), p)), CostParams().epoch_slots
                )

    def test_collators_earn_nothing_else_so_the_comparison_is_like_for_like(self):
        """The premise that makes referendum #1870 comparable rather than loose.

        D-15 routes collected USDC fees to treasury MAIN and BURNS collected
        VIT fees; the runtime wires `OnChargeTransaction = FungibleAdapter<
        Balances, ()>`, whose `()` drops (burns) the imbalance. So a Bleavit
        collator's entire compensation is this one treasury line. Polkadot's
        system parachains are treasury-funded for exactly the same reason.

        This is asserted here as the documented premise of the anchor. If a
        future change routes fees to block authors, the anchor stops being
        like-for-like and this reasoning must be redone -- which is why the
        premise is written down as a test rather than left in a commit message.
        """
        self.assertEqual(CostParams().collator_comp_epoch, COLLATOR_COMP_MIN)

    def test_the_e5_operating_point_is_self_funding_at_minimum_activity(self):
        """R >= C at the least activity for which the chain decides anything.

        Minimum activity is a five-slot PARAM slate held at exactly the
        `dec.v_min` floor -- the depth below which a proposal is not
        decision-grade at all -- so this is not an optimistic scenario.
        """
        # Stated for the SHIPPED point. Until the SQ-536 reseed this held only
        # for the lowered collator line -- at the pass-1 seed revenue covered
        # cost only from tau ~ 3.6 upward, and that gap was exactly the
        # collator line. Asserted for `CostParams()` now that they coincide.
        c = cost_base(CostParams()).annual
        minimum_activity = annual_held_capital("param", D(5), saturated=False)
        for tau in (D(2), D(3), D("5.8")):
            with self.subTest(tau=str(tau)):
                r = revenue(minimum_activity, tau)
                self.assertGreaterEqual(r, c)
                self.assertTrue(runway_years(c, NAV_FLOOR_CODE, r).is_infinite())

    def test_where_self_funding_stops_and_what_happens_below_it(self):
        """Locates the boundary honestly instead of asserting the happy case.

        `tau = 1` is the arithmetic floor -- every unit of held capital was
        bought at least once. Minimum activity clears `tau >= 2` but NOT
        `tau = 1`, and the shortfall is stated rather than rounded away.

        That scenario is also internally strained: it pairs `REWARDS` at its
        ALL-PASS five-slot ceiling (08 §1.1 pays only on `Executed`) with zero
        secondary turnover. An epoch in which five proposals execute is not an
        epoch with no trading. It is kept as the pessimistic bound anyway,
        because the honest reading of a bound is the one that does not assume
        its own conclusion.
        """
        c = cost_base(CostParams()).annual
        minimum_activity = annual_held_capital("param", D(5), saturated=False)
        shortfall = c - revenue(minimum_activity, D(1))
        self.assertGreater(shortfall, D(0))
        self.assertLess(shortfall, D(20_000))
        # Even at that floor the endowment outlives any planning horizon.
        self.assertGreater(
            runway_years(c, NAV_FLOOR_CODE, revenue(minimum_activity, D(1))),
            D(700),
        )

    def test_endowment_is_untouched_by_any_lever_here(self):
        """E5 must not move the frozen 08 §4.1 floors or the funding target."""
        self.assertEqual(GENESIS_ENDOWMENT, D(25_000_000))
        self.assertEqual(NAV_FLOOR_CODE, D(13_862_944))
        self.assertEqual(NAV_FLOOR_META, D(21_256_533))


if __name__ == "__main__":
    unittest.main()
