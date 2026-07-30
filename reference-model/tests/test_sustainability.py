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
    BASELINE_V_MIN,
    GENESIS_ENDOWMENT,
    NAV_FLOOR_CODE,
    NAV_FLOOR_META,
    NAV_FLOOR_PARAM,
    OBS_INTERVAL_MAX,
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
    revenue_rate,
    runway_years,
    pre_e5_params,
    with_levers,
)

D = Decimal


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

    def test_the_e5_operating_point_is_admissible_and_clears_25_years(self):
        """The goal, asserted against the HARDEST floor rather than the easiest.

        25 years is measured to the 21,256,533 shared CODE/META arming floor --
        the binding one, above CODE's own 13,862,944 seeding floor -- and with
        ZERO revenue assumed.
        """
        p = with_levers(collator_comp_epoch=500)
        self.assertTrue(is_admissible(p), [f.detail for f in check_admissible(p) if not f.ok])
        c = cost_base(p).annual
        self.assertGreater(runway_years(c, NAV_FLOOR_META), D(25))
        self.assertGreater(runway_years(c, NAV_FLOOR_CODE), D(100))

    def test_the_e5_operating_point_is_self_funding_at_minimum_activity(self):
        """R >= C at the least activity for which the chain decides anything.

        Minimum activity is a five-slot PARAM slate held at exactly the
        `dec.v_min` floor -- the depth below which a proposal is not
        decision-grade at all -- so this is not an optimistic scenario.
        """
        c = cost_base(with_levers(collator_comp_epoch=500)).annual
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
        c = cost_base(with_levers(collator_comp_epoch=500)).annual
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
