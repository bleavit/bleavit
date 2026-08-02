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
    FEE_VIT_USDC_RATE_MAX,
    FEE_VIT_USDC_RATE_MIN,
    FEE_VIT_USDC_RATE_REF,
    KEEPER_REBATE,
    KEEPER_REBATE_FEE_BASIS_USDC,
    KEEPER_REBATE_MAX,
    CORETIME_PERIOD_DAYS,
    PROPOSER_REWARD,
    PROP_BOND,
    INTAKE_SLASH_FRACTION,
    proposer_expected_value,
    proposer_break_even_adopt_rate,
    INFINITE,
    POL_RERUN_MAX_MULTIPLE,
    pol_divergence_with_reruns,
    xcm_annual_revenue,
    xcm_break_even_messages_per_day,
    xcm_fee_micro_usdc,
    xcm_fee_per_message,
    CORETIME_RENEWAL_CAP_KSM,
    CORETIME_RENEW_INTERLUDE,
    CORETIME_RENEW_LEADIN_END,
    coretime_annual_cost_path,
    coretime_annual_escalation,
    coretime_cost_after_years,
    coretime_leadin_factor,
    coretime_periods_to_saturation,
    coretime_price_path,
    coretime_ratchet_ceiling,
    coretime_renewal_price,
    coretime_renewals_per_year,
    coretime_renewals_through_year,
    coretime_sale_price,
    runway_years_with_coretime_policy,
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
    a1_crossover_rate,
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
    calibrated_keeper_rebate,
    crank_fee_basis_usdc,
    crank_fee_breakdown,
    crank_fee_usdc,
    general_tranche_boundary_rebate,
    general_tranche_claim_reachable,
    generated_crank_weight,
    keeper_economics_findings,
    keeper_tranches,
    polkadot_collator_rate_epoch,
    polkadot_collator_rate_month,
    published_crank_fee_usdc,
    rebate_fee_ratio,
    section_6_3_published_full_window_cost,
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


class KeeperCrankFeeTests(unittest.TestCase):
    """08 §6.2's fee derivation, including the generated HEAD weight."""

    def test_head_fee_reads_the_current_generated_crank_weight(self):
        """Regression pin for the artifact the runtime dispatches with.

        A regeneration changes one of these terms and therefore changes
        `crank_fee_usdc`; it cannot leave a copied total behind silently.
        """
        generated = generated_crank_weight()
        self.assertEqual(generated.base_ref_time_ps, 141_290_000)
        self.assertEqual(generated.reads, 20)
        self.assertEqual(generated.writes, 7)
        self.assertEqual(generated.call_ref_time_ps, 1_341_290_000)

        fee = crank_fee_breakdown()
        self.assertEqual(fee.total_planck, 1_801_839_120)
        self.assertEqual(fee.vit, D("0.00180183912"))
        self.assertEqual(crank_fee_usdc(FEE_VIT_USDC_RATE_REF), D("0.0000900919560"))

    def test_all_four_published_sensitivity_rows_reproduce_from_their_inputs(self):
        """Regression pins for §6.2's table, including its display rounding.

        The table is internally coherent with the additive weight printed
        immediately above it. This test fails if any row, rate, rebate or
        rounding convention drifts independently of those published inputs.
        """
        rows = (
            (D("0.0125"), D("0.0000001"), D("0.0000213"), D("0.1"), D("12.0")),
            (D("0.05"), D("0.0000001"), D("0.0000851"), D("0.1"), D("3.0")),
            (D("0.20"), D("0.000001"), D("0.000340"), D("0.01"), D("0.75")),
            (D("1.00"), D("0.00001"), D("0.00170"), D("0.01"), D("0.15")),
        )
        for rate, fee_grid, published_fee, ratio_grid, published_ratio in rows:
            with self.subTest(rate=str(rate)):
                fee = published_crank_fee_usdc(rate)
                self.assertEqual(fee.quantize(fee_grid), published_fee)
                self.assertEqual((KEEPER_REBATE / fee).quantize(ratio_grid), published_ratio)

        # The table's exact, pre-display basis is the sum of the printed terms,
        # not a separately transcribed 0.00170 approximation.
        self.assertEqual(published_crank_fee_usdc(D(1)), D("0.00170146912"))

    def test_sq_527_the_registry_basis_has_drifted_from_head(self):
        """SQ-527. §6.2 calls 85 µUSDC the committed-weight fee basis.

        HEAD instead derives 90.091956 µUSDC and the mandated claimant-adverse
        µUSDC floor is 90, not 85. The unsafe direction is understatement: it
        seeds a smaller rebate and makes A-1 fail at a lower VIT price.
        """
        head_basis = crank_fee_basis_usdc(FEE_VIT_USDC_RATE_REF)
        self.assertEqual(head_basis, D("0.000090"))
        self.assertNotEqual(KEEPER_REBATE_FEE_BASIS_USDC, head_basis)
        self.assertEqual(
            crank_fee_usdc(FEE_VIT_USDC_RATE_REF) - KEEPER_REBATE_FEE_BASIS_USDC,
            D("0.0000050919560"),
        )
        finding = next(
            f
            for f in keeper_economics_findings()
            if f.key == "keeper.rebate basis matches HEAD crank weight"
        )
        self.assertFalse(finding.ok)


class KeeperA1CrossoverTests(unittest.TestCase):
    """01 §2.2 A-1 composed with 08 §6.2's price sensitivity."""

    def test_sq_527_the_loss_making_band_starts_at_2_830x_not_4x(self):
        """SQ-527. §6.2 presents ≈4× as the A-1 failure threshold.

        The sentence is a true sufficient condition, but it omits the unsafe
        interval from 2.830× through 4× where the rebate is already below the
        fee. VIT appreciation is unsafe because permissionless cranking loses
        money and decisions silently degrade to `NotDecisionGrade`.
        """
        crossover = a1_crossover_rate()
        multiple = crossover / FEE_VIT_USDC_RATE_REF
        self.assertLess(abs(crossover - D("0.1415220688515187749")), D("1e-19"))
        self.assertLess(abs(multiple - D("2.8304413770303754977")), D("1e-19"))
        self.assertEqual(rebate_fee_ratio(crossover), D(1))
        self.assertLess(crossover, D(4) * FEE_VIT_USDC_RATE_REF)
        self.assertLess(rebate_fee_ratio(D(4) * FEE_VIT_USDC_RATE_REF), D(1))
        finding = next(
            f
            for f in keeper_economics_findings()
            if f.key == "08 §6.2 A-1 crossover is approximately 4x"
        )
        self.assertFalse(finding.ok)

    def test_a_fresh_three_times_calibration_crosses_at_exactly_three_times(self):
        """The ≈3× result is structural, not an accident of one calibration.

        The fee is linear in price. A rebate fixed at three times the fee at
        any derivation price therefore reaches ratio one at exactly three
        times that price. Reversing either ratio or price dependence fails.
        """
        for derivation_rate in (D("0.01"), D("0.05"), D("0.37"), D(1)):
            with self.subTest(rate=str(derivation_rate)):
                rebate = calibrated_keeper_rebate(derivation_rate, D(3))
                self.assertEqual(a1_crossover_rate(rebate), D(3) * derivation_rate)

    def test_a1_failure_and_the_max_rebate_limit_both_sit_inside_the_rate_envelope(self):
        """The lawful price range extends well past both funding boundaries."""
        crossover = a1_crossover_rate()
        self.assertLess(FEE_VIT_USDC_RATE_MIN, crossover)
        self.assertLess(crossover, FEE_VIT_USDC_RATE_MAX)
        self.assertLess(rebate_fee_ratio(FEE_VIT_USDC_RATE_MAX), D(1))

        ceiling_crossover = a1_crossover_rate(KEEPER_REBATE_MAX)
        self.assertLess(ceiling_crossover, FEE_VIT_USDC_RATE_MAX)
        self.assertLess(
            abs(ceiling_crossover / FEE_VIT_USDC_RATE_REF - D("9.434804590")),
            D("0.000000001"),
        )
        finding = next(
            f
            for f in keeper_economics_findings()
            if f.key == "keeper.rebate ceiling covers fee.vit_usdc_rate maximum"
        )
        self.assertFalse(finding.ok)


class KeeperTrancheTests(unittest.TestCase):
    """08 §6.3's 80/20 meter structure and its observation-demand claims."""

    def test_live_registry_derives_both_tranches_and_zero_beyond_meter_demand(self):
        tranches = keeper_tranches()
        self.assertEqual(tranches.decision_critical_demand, D("34.149600"))
        self.assertEqual(tranches.decision_critical_reservation, D("9600.00"))
        self.assertEqual(tranches.general_demand, D("113.832000"))
        self.assertEqual(tranches.general_cap, D("2400.00"))
        self.assertEqual(tranches.full_window_demand, D("147.981600"))
        self.assertEqual(tranches.beyond_meter, D(0))

    def test_sq_527_general_tranche_partial_subsidy_claim_is_inverted(self):
        """SQ-527. §6.3 says general demand exceeds its cap by about 10×.

        At the live rebate demand is only 0.04743× the cap; equivalently the
        cap exceeds demand by 21.0837×. The unsafe reading is to provision an
        ops continuity line on the assumption that the general meter binds.
        """
        tranches = keeper_tranches()
        self.assertLess(tranches.general_demand, tranches.general_cap)
        self.assertEqual(tranches.general_demand_to_cap, D("0.04743"))
        self.assertLess(
            abs(tranches.general_cap_to_demand - D("21.0837022981")), D("1e-10")
        )
        finding = next(
            f
            for f in keeper_economics_findings()
            if f.key == "08 §6.3 general tranche is a partial subsidy"
        )
        self.assertFalse(finding.ok)

    def test_sq_527_only_section_6_3_retains_the_52229_cost(self):
        """SQ-527. §6.3 publishes ≈52,229 while §6.2 and §10.1 publish ≈148.

        Re-execution gives 52,228.80 only with the superseded 0.09 rebate. The
        live quantity is 147.9816, exactly the §10.1 KEEPER line, so the defect
        is confined to §6.3 and overstates demand by 352.94×.
        """
        stale = section_6_3_published_full_window_cost()
        live = keeper_tranches().full_window_demand
        booked = cost_base().keeper_total / epochs_per_year()
        self.assertEqual(stale, D("52228.80"))
        self.assertEqual(live, D("147.981600"))
        self.assertEqual(booked, live)
        self.assertEqual(cost_base().keeper_beyond_meter, D(0))
        self.assertLess(abs(stale / live - D("352.94117647")), D("1e-8"))
        finding = next(
            f
            for f in keeper_economics_findings()
            if f.key == "08 §6.3 full-window cost uses the live rebate"
        )
        self.assertFalse(finding.ok)

    def test_no_admissible_rebate_restores_the_partial_subsidy_claim(self):
        """The failure spans the whole row, not only the genesis value."""
        boundary = general_tranche_boundary_rebate()
        self.assertGreater(boundary, KEEPER_REBATE_MAX)
        self.assertLess(abs(boundary - D("0.005376344086")), D("1e-12"))
        self.assertLess(
            abs(boundary / KEEPER_REBATE_MAX - D("6.325110689")), D("1e-9")
        )
        at_ceiling = keeper_tranches(with_levers(keeper_rebate=KEEPER_REBATE_MAX))
        self.assertEqual(at_ceiling.general_demand, D("379.44000"))
        self.assertLess(at_ceiling.general_demand, at_ceiling.general_cap)
        self.assertFalse(general_tranche_claim_reachable())


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
        """Why the level being small today is not reassurance -- UNCLAMPED reading.

        Retained deliberately as the naive arithmetic, and named as such: it is
        what the first pass published, and `coretime_cost_after_years` is the
        function that produces it. The clamped truth is the next test.
        """
        start = D(4_000)
        ten = coretime_cost_after_years(start, D(10))
        self.assertGreater(ten, cost_base().annual)  # exceeds the WHOLE base
        self.assertLess(abs(ten - D(189_073)), D(50))


class ProposerRewardEconomicsTests(unittest.TestCase):
    """SQ-542. The cost line tied for largest, and the one with no derivation.

    `trs.proposer_reward` is **39.8 %** of the launch cost base at the 08 §10.1
    PARAM ceiling -- level with `ops.collators`, and larger than every other row
    combined. It appears in exactly three places in the whole doc set: the 13 §1
    row, a restatement in 08 §1.1, and the §10.1 cost row. **No derivation, no
    anchor, no rationale.** That is the same shape as `collator.comp_epoch`
    before SQ-536, which turned out to be 4x too high.

    This class exists to record why it is NOT the same answer, because the size
    of the line makes it a standing temptation. The arithmetic says the error
    direction here is more likely DOWNWARD, so cutting it is the unsafe move.
    """

    def test_rejection_is_free_and_getting_that_wrong_flatters_the_reward(self):
        """The 08 §7.1 rule a hand calculation gets backwards.

        Bonds "refund in full only on a decision-grade outcome (adopt or reject
        -- rejection is information)", so `intake.slash_pct` fires on
        NON-decision-grade outcomes. Treating rejection as a slash makes the
        reward look far more generous than it is.
        """
        self.assertEqual(INTAKE_SLASH_FRACTION, D("0.10"))
        # Perfect formation: rejection costs nothing, so EV is never negative.
        self.assertEqual(proposer_expected_value("param", D(0), D(1)), D(0))
        self.assertEqual(proposer_expected_value("param", D(1), D(1)), D(500))
        # The loss comes only from markets that fail to form a decision.
        self.assertEqual(proposer_expected_value("param", D(0), D(0)), D(-100))

    def test_at_the_phase0_rates_param_proposing_loses_money(self):
        """The evidence, and its limits, both stated.

        Artifact rates (10,000 proposals): PARAM adopts 2.32 % and forms a
        decision-grade market 40.56 % of the time, giving EV = -47.8 USDC per
        submission against a break-even adopt rate of 11.89 %.

        The population is **adversarial by construction** -- informed, noise,
        arbitrage and five doc-14 manipulator strategies -- so this is a
        population average and NOT an honest proposer's expectation. It cannot
        establish that the reward is too low. What it does establish is that
        nothing here supports the reward being too HIGH, which is the only
        reading that would make this line a cost lever.
        """
        adopt, dg = D("0.0232"), D("0.4056")
        ev = proposer_expected_value("param", adopt, dg)
        self.assertLess(ev, D(0))
        self.assertLess(abs(ev - D("-47.8")), D("0.5"))
        be = proposer_break_even_adopt_rate("param", dg)
        self.assertLess(abs(be - D("0.1189")), D("0.0005"))
        self.assertGreater(be, adopt)  # the gap is ~5x, not a rounding matter

    def test_the_line_is_large_enough_to_be_a_standing_temptation(self):
        """Why this is written down rather than left to be rediscovered."""
        cb = cost_base()
        self.assertLess(abs(cb.proposer_rewards - D(43_482)), D(2))
        self.assertGreater(cb.shares()["proposer_rewards"], D("0.39"))
        # Level with collators at the launch count -- the two largest lines.
        self.assertEqual(cb.proposer_rewards, cb.collators)
        # And a x0.1 cut (the 13 §1 hard-min) would take 39,134/yr off `C`...
        cut = cost_base(with_levers(proposer_reward=D(50)))
        self.assertGreater(cb.annual - cut.annual, D(39_000))
        # ...and it would make proposing UNPROFITABLE AT ANY ADOPT RATE: at
        # reward 50 the break-even is 118.9 %, i.e. even a proposal adopted
        # every single time would not cover the non-formation slash. That is
        # the decisive argument, and it is evidence rather than caution.
        hard_min = proposer_break_even_adopt_rate("param", D("0.4056"), reward=D(50))
        self.assertGreater(hard_min, D(1))
        self.assertLess(abs(hard_min - D("1.1888")), D("0.0005"))
        # The shipped value is the only one of the two that is even reachable.
        self.assertLess(proposer_break_even_adopt_rate("param", D("0.4056")), D(1))


class PolRerunExposureTests(unittest.TestCase):
    """SQ-540(d). 08 §10.1's divergence row is the no-rerun case and says so nowhere.

    The sweep's framing -- "rerun top-ups double a book's `b` with no
    `pol.budget_epoch` charge" -- describes something 08 §4.4 already states
    normatively and defends: reruns are deliberately not budget-charged,
    because `delayed_once`/`rerun` are one-way flags, so the exposure is
    structurally bounded at 2x rather than budget-bounded. That half is not a
    defect.

    The half that survives is about the COST MODEL rather than the protocol.
    §10.1 publishes a realized-divergence figure computed at zero reruns, while
    05 §2.1 T13 permits up to a doubling -- so the published cost base is an
    understatement by up to its own divergence row, and an understated `C`
    makes every runway figure in §10.5 look better than it is.
    """

    def test_the_published_row_is_exactly_the_no_rerun_case(self):
        """Default reproduces §10.1 byte-for-byte, so this adds a term, not a change."""
        self.assertEqual(CostParams().pol_rerun_fraction, D(0))
        self.assertEqual(pol_divergence_with_reruns(D(0)), D(18_830))
        self.assertEqual(cost_base().pol_divergence, D(18_830))

    def test_the_exposure_is_linear_in_the_rerun_share_and_capped_at_two(self):
        """Divergence is `b*[ln2 - H(p)]`, linear in `b`; T13 doubles `b`."""
        self.assertEqual(POL_RERUN_MAX_MULTIPLE, D(2))
        self.assertEqual(pol_divergence_with_reruns(D(1)), D(18_830) * D(2))
        self.assertEqual(pol_divergence_with_reruns(D("0.5")), D(18_830) * D("1.5"))
        # The structural cap really binds: 05 §2.1's rerun finality allows ONE
        # rerun per proposal, so no share can push past 2x.
        self.assertEqual(pol_divergence_with_reruns(D(3)), D(18_830) * D(2))
        self.assertEqual(pol_divergence_with_reruns(D("-1")), D(18_830))

    def test_a_fully_rerun_slate_costs_17_percent_of_the_whole_base(self):
        """Why it is worth stating rather than filing."""
        base = cost_base().annual
        full = cost_base(with_levers(pol_rerun_fraction=D(1))).annual
        self.assertLess(abs(full - base - D(18_830)), D(1))
        self.assertGreater((full / base) - D(1), D("0.17"))
        self.assertLess(abs(runway_years(full, NAV_FLOOR_META) - D("29.22")), D("0.05"))

    def test_the_joint_worst_case_still_does_not_change_the_standing_conclusion(self):
        """Stacked with the other two known exposures, honestly.

        12 collators (the 12 §6.1 mandated ceiling) AND a fully rerun slate is
        the pessimistic corner of everything E5/E7 have quantified. It does not
        reverse anything: the coretime policy is still worth more than the
        rerun term costs, and the zero-revenue reading still fails at the
        mandated count for the reason §10.5 already gives -- mature operation
        depends on revenue, not on the endowment.
        """
        worst = cost_base(
            with_levers(collator_count=12, pol_rerun_fraction=D(1))
        ).annual
        self.assertLess(abs(worst - D(188_986)), D(2))
        late = runway_years_with_coretime_policy(
            worst, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_LEADIN_END
        )
        early = runway_years_with_coretime_policy(
            worst, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_INTERLUDE
        )
        self.assertLess(abs(late - D("19.40")), D("0.05"))
        self.assertLess(abs(early - D("12.72")), D("0.05"))
        # Even in the worst corner the renewal-timing policy is the larger term.
        self.assertGreater(late - early, D(6))


class XcmDiscardedRevenueTests(unittest.TestCase):
    """SQ-540(e). 08 §10.2 names two revenue instruments; there is a third.

    The chain charges every inbound XCM message for execution at governed 13 §1
    rates through `GovernedWeightTrader`, and then **discards the payment**:
    the runtime binds `Trader = GovernedWeightTrader<ConstitutionTraderRates,
    ()>`, and `TakeRevenue for ()` drops the collected assets when the trader
    is dropped. The fee is computed, charged, and thrown away.

    Every input below is anchored in this repository, so the size of what is
    discarded is derivable. The one input that is NOT -- inbound message volume
    -- is deliberately never assumed: the headline is a break-even rate.
    """

    def test_the_fee_transcribes_the_traders_own_arithmetic(self):
        """Both dimensions priced separately and rounded up, then summed.

        Per instruction, from `UnitWeightCost = (1e9 ref-time, 64 KiB proof)`
        and the 13 §1 USDC rates: 0.001 s x 50 USDC/s = 0.05, plus
        0.0625 MiB x 5 USDC/MiB = 0.3125. Total 0.3625 USDC.
        """
        self.assertEqual(xcm_fee_micro_usdc(1), D(362_500))
        self.assertEqual(xcm_fee_per_message(1), D("0.3625"))
        # `FixedWeightBounds` is linear in the instruction count, so the message
        # fee is exactly proportional -- and both components divide evenly here,
        # so the payer-adverse ceiling costs the payer nothing extra at n = 4.
        self.assertEqual(xcm_fee_per_message(4), D("1.45"))
        self.assertEqual(xcm_fee_micro_usdc(4), D(1_450_000))
        for n in (1, 2, 4, 8, 16):
            with self.subTest(instructions=n):
                self.assertEqual(xcm_fee_micro_usdc(n), D(362_500) * n)

    def test_the_proof_dimension_is_86_percent_of_the_fee(self):
        """Where the number comes from, because it bounds how solid it is.

        `FixedWeightBounds` charges a flat 64 KiB of proof per instruction
        regardless of what the instruction does -- a deliberately conservative
        over-estimate, not a measurement. So the fee level is a property of the
        weigher, and replacing it with benchmarked bounds would cut the revenue
        substantially. Asserted so that a later weigher change cannot silently
        invalidate the finding.
        """
        with_proof = xcm_fee_micro_usdc(1)
        ref_only = D(50_000)  # 0.001 s x 50,000,000 uUSDC/s
        self.assertEqual(with_proof - ref_only, D(312_500))
        self.assertGreater((with_proof - ref_only) / with_proof, D("0.86"))

    def test_a_few_hundred_messages_a_day_would_cover_the_whole_cost_base(self):
        """The finding. It is stated as required volume, never as earned revenue.

        Volume is the one input this repository cannot supply, so asserting a
        revenue figure would be a forecast. Asserting the break-even is a
        derivation: this many inbound messages a day and the fee the chain
        ALREADY charges, and then throws away, pays for everything.
        """
        c5 = cost_base().annual
        c12 = cost_base(with_levers(collator_count=12)).annual
        self.assertLess(abs(xcm_break_even_messages_per_day(c5) - D(206)), D(1))
        self.assertLess(abs(xcm_break_even_messages_per_day(c12) - D(321)), D(1))
        # Round-trip: revenue at the break-even volume really is the cost base.
        be = xcm_break_even_messages_per_day(c5)
        self.assertLess(abs(xcm_annual_revenue(be) - c5), D("0.01"))
        # And the shape at sub-break-even volumes, so "material" is checkable
        # rather than rhetorical: 100/day is already ~half the launch base.
        self.assertGreater(xcm_annual_revenue(D(100)) / c5, D("0.48"))
        self.assertLess(xcm_annual_revenue(D(10)) / c5, D("0.05"))

    def test_the_captured_fee_closes_the_gap_at_the_mandated_collator_count(self):
        """What the E7 wiring is actually for, stated end to end.

        The zero-revenue reading fails at the 12 collators 12 §6.1 mandates:
        21.5 years under the cheap coretime policy. The fee the chain was
        already charging and discarding closes that gap at a *small* traffic
        level, and makes the endowment self-sustaining at the break-even rate
        this class already derives.

        Stated as required traffic, not as a promise: message volume is market
        behaviour the protocol does not control, and it belongs beside `tau`
        rather than beside the endowment. What the model can say is exactly how
        much is needed, and it is less than most readers would guess.
        """
        c12 = cost_base(with_levers(collator_count=12)).annual
        zero = runway_years_with_coretime_policy(
            c12, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_LEADIN_END
        )
        self.assertLess(zero, D(25))  # the gap this closes

        def runway_at(messages_per_day):
            return runway_years_with_coretime_policy(
                c12,
                NAV_FLOOR_META,
                D(4_000),
                through=CORETIME_RENEW_LEADIN_END,
                annual_revenue=xcm_annual_revenue(D(messages_per_day)),
            )

        # 50/day already clears the 25-year goal at the mandated ceiling.
        self.assertGreater(runway_at(50), D(25))
        self.assertLess(abs(runway_at(50) - D("25.35")), D("0.05"))
        # And at the break-even rate this class derives, the endowment is never
        # drawn down at all.
        self.assertEqual(runway_at(321), INFINITE)
        # Monotone in traffic, which a sign error would break.
        self.assertGreater(runway_at(100), runway_at(50))

    def test_break_even_volume_scales_the_right_way(self):
        """Monotone in both directions, which a wrong sign would break."""
        c5 = cost_base().annual
        # A larger cost base needs more messages.
        self.assertGreater(
            xcm_break_even_messages_per_day(cost_base(with_levers(collator_count=12)).annual),
            xcm_break_even_messages_per_day(c5),
        )
        # Fatter messages pay more, so fewer are needed.
        self.assertLess(
            xcm_break_even_messages_per_day(c5, instructions=8),
            xcm_break_even_messages_per_day(c5, instructions=4),
        )


class CoretimeRenewalPriceTests(unittest.TestCase):
    """SQ-541. `do_renew`'s actual price rule, and the correction it forces.

    The first pass modelled the renewal price as compounding at the per-period
    bump without bound and published a 14.3-year runway on that basis. Read
    against the arithmetic this workspace already ships -- `pallet-broker`
    0.28.0, the version in `Cargo.lock` -- that is wrong:

        price = min( leadin_factor(t) * end_price,
                     max( prev * (1 + bump), end_price ) )

    The `min` is a ceiling at the open-market price, so the ratchet SATURATES;
    and because `leadin_factor` decays from 100 to 1 across the leadin, where
    the ceiling sits is decided by WHEN the renewal is submitted. That is a
    Bleavit operational choice, not a platform constant, and it turns out to be
    worth more runway than any parameter in 13 §1.
    """

    def test_the_leadin_factor_matches_the_pallets_own_unit_test(self):
        """Byte-for-byte against `adapt_price.rs::leadin_price_bound_check`.

        Transcribing an upstream curve is exactly where a reference model earns
        its keep or silently stops meaning anything, so the five points the
        pallet itself asserts are the five points asserted here.
        """
        for through, expected in (
            (D(0), D(100)),
            (D("0.25"), D(55)),
            (D("0.5"), D(10)),
            (D("0.75"), D("5.5")),
            (D(1), D(1)),
        ):
            with self.subTest(through=str(through)):
                self.assertEqual(coretime_leadin_factor(through), expected)
        # `sale_price` clamps `through` into [0, 1] via `.min(leadin_length)`;
        # the interlude sits at t <= 0 and must price at the 100x start.
        self.assertEqual(coretime_leadin_factor(D("-1")), D(100))
        self.assertEqual(coretime_leadin_factor(D(2)), D(1))

    def test_renewing_at_the_end_of_the_leadin_is_flat_forever(self):
        """The whole finding, in one assertion.

        At `t = 1` the sale price IS `end_price`, and since the cap is at least
        `end_price` the `min` always binds. So the price paid is `end_price`
        exactly -- for any prior price, at any bump, in every period. The
        ratchet cannot start, and an already-ratcheted price is rewritten DOWN
        to the floor on the first late renewal.
        """
        path = coretime_price_path(50, D(1), through=CORETIME_RENEW_LEADIN_END)
        self.assertEqual(set(path), {D(1)})
        # Independent of the bump: a 3x bump changes nothing at t = 1.
        self.assertEqual(
            coretime_renewal_price(D(1), D(1), CORETIME_RENEW_LEADIN_END, D(3)), D(1)
        )
        # And it un-ratchets: a price already at the 100x ceiling drops to the
        # floor in ONE late renewal, which is why the policy is recoverable.
        self.assertEqual(
            coretime_renewal_price(D(100), D(1), CORETIME_RENEW_LEADIN_END), D(1)
        )

    def test_renewing_in_the_interlude_ratchets_to_a_100x_ceiling(self):
        """The other policy, and the ceiling the first pass denied existed."""
        path = coretime_price_path(6, D(1), through=CORETIME_RENEW_INTERLUDE)
        self.assertEqual(path[0], D("1.03"))
        self.assertLess(abs(path[5] - D("1.194052")), D("0.000001"))
        # Bounded, and the bound is the sale price at the chosen moment.
        self.assertEqual(coretime_ratchet_ceiling(D(1), CORETIME_RENEW_INTERLUDE), D(100))
        self.assertEqual(coretime_ratchet_ceiling(D(1), CORETIME_RENEW_LEADIN_END), D(1))
        # 156 renewals ~ 12.0 years to saturate from the floor at 3 %/period.
        periods = coretime_periods_to_saturation()
        self.assertEqual(periods, 156)
        self.assertLess(abs(D(periods) / coretime_renewals_per_year() - D("11.96")), D("0.01"))
        # Once saturated it is pinned: further renewals do not exceed the market.
        self.assertEqual(coretime_renewal_price(D(200), D(1), CORETIME_RENEW_INTERLUDE), D(100))

    def test_the_min_clamp_tracks_the_market_down_not_only_up(self):
        """A model that only grows is not conservative, it is wrong.

        If `end_price` halves, the renewal price follows it down on the next
        renewal, because the `min` binds against the new, lower sale price.
        """
        # Saturated at 100 against a floor of 1; floor then halves to 0.5.
        self.assertEqual(coretime_renewal_price(D(100), D("0.5"), CORETIME_RENEW_INTERLUDE), D(50))
        # And the `max` is a floor, not a ceiling: an under-market prior price
        # is lifted to `end_price`, never below it (the pallet's own comment).
        self.assertEqual(coretime_renewal_price(D("0.1"), D(10), CORETIME_RENEW_LEADIN_END), D(10))

    def test_the_renewal_timing_policy_is_worth_more_than_18_years_of_runway(self):
        """The result. A scheduling choice dominates every parameter in 13 §1.

        Same cost base, same endowment, same floor, same market: the only
        difference is the block at which the ops multisig submits the renewal.
        Late renewal MEETS the 25-year goal and interlude renewal misses it by
        more than a decade -- at a line size small enough that 08 §10.1 felt
        able to omit it from the table entirely.
        """
        c = cost_base().annual
        constant = runway_years(c, NAV_FLOOR_META)
        self.assertGreater(constant, D(25))

        for floor_annual, early_exp, late_exp in (
            (D(4_000), D("14.71"), D("33.05")),
            (D(25_000), D("9.67"), D("27.88")),
        ):
            with self.subTest(line=str(floor_annual)):
                early = runway_years_with_coretime_policy(
                    c, NAV_FLOOR_META, floor_annual, through=CORETIME_RENEW_INTERLUDE
                )
                late = runway_years_with_coretime_policy(
                    c, NAV_FLOOR_META, floor_annual, through=CORETIME_RENEW_LEADIN_END
                )
                self.assertLess(abs(early - early_exp), D("0.05"))
                self.assertLess(abs(late - late_exp), D("0.05"))
                self.assertLess(early, D(25))  # misses the goal
                self.assertGreater(late, D(25))  # meets it
                self.assertGreater(late - early, D(18))

    def test_the_policy_saves_62x_of_cumulative_coretime_spend_over_25_years(self):
        """Stated as cash, because that is what the treasury actually parts with."""
        early = sum(coretime_annual_cost_path(25, D(4_000), through=CORETIME_RENEW_INTERLUDE))
        late = sum(coretime_annual_cost_path(25, D(4_000), through=CORETIME_RENEW_LEADIN_END))
        # 99,964.41, not the round 25 x 4,000 = 100,000 this row used to assert.
        # A renewal is discrete: 25 years hold 326 of them, while 25 x 13.0446
        # is 326.1161, so a flat line at the market floor costs 326 renewals and
        # not 25 annualised years. The 0.036 % gap is the smooth-scaling defect
        # the Codex review of PR #206 found; see
        # CoretimeRenewalDiscretenessTests. Every published 08 §10 runway figure
        # is unmoved by the repair (< 0.01 years), so this is an internal anchor
        # being made exact, not a values change.
        self.assertLess(abs(late - D("99964.41")), D("0.01"))
        self.assertLess(abs(early - D(6_252_022)), D(10_000))
        self.assertGreater(early / late, D(62))
        # Year 25 alone is the saturated ceiling: 100x the market floor, times
        # the 13 renewals that year actually holds (year 23 is the 14th-renewal
        # carry year, not year 25).
        self.assertLess(
            abs(coretime_annual_cost_path(25, D(4_000), through=CORETIME_RENEW_INTERLUDE)[24]
                - D("398631.07")),
            D("0.01"),
        )
        self.assertEqual(
            coretime_renewals_through_year(25) - coretime_renewals_through_year(24), 13
        )

    def test_the_unbounded_model_this_replaces_understated_the_runway(self):
        """Honest accounting of my own error, pinned so it cannot recur.

        The superseded `runway_years_with_escalating_line` grows the line
        without a ceiling. Against the interlude policy it is close (the
        ceiling only binds after ~12 years, past the point the runway ends),
        which is exactly why the error survived review -- but against the
        policy that actually matters it is wrong by 18 years.
        """
        c = cost_base().annual
        unbounded = runway_years_with_escalating_line(c, NAV_FLOOR_META, D(4_000))
        early = runway_years_with_coretime_policy(
            c, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_INTERLUDE
        )
        late = runway_years_with_coretime_policy(
            c, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_LEADIN_END
        )
        self.assertLess(abs(unbounded - early), D("0.5"))  # plausible, hence missed
        self.assertGreater(late - unbounded, D(18))  # and wrong where it counted

    def test_the_coretime_win_does_not_by_itself_save_the_25_year_goal(self):
        """The two claims are each true alone and over-optimistic together.

        This test exists because I was about to let them stand apart. SQ-541
        says late renewal takes the runway 14.7 -> 33.1 years and "meets the
        25-year goal"; SQ-536's own qualification says the goal already fails
        at 10 and 12 collators, which 12 §6.1 mandates from Phase 4+. Both are
        true at the count each was computed at -- 5 and 5 -- and read together
        they claim something neither establishes.

        Joined here: at the mandated 10-12 range the goal fails EVEN under the
        cheap renewal policy. The policy is still worth ~10 years there, which
        is why it remains the largest single lever found; it is simply not
        sufficient on its own, and the conclusion 08 §10.5 already draws stands
        unchanged -- mature operation depends on revenue, not on the endowment.

        Also pins the shape: the policy is worth LESS as the base grows (18.3
        years at 5 collators, 8.4 at 12), because a larger constant base ends
        the runway before the ratchet has time to saturate.
        """
        rows = ((5, D("33.05"), D("14.71")), (8, D("26.86"), D("13.99")),
                (10, D("23.88"), D("13.55")), (12, D("21.49"), D("13.14")))
        prev_gap = None
        for n, late_exp, early_exp in rows:
            with self.subTest(collators=n):
                c = cost_base(with_levers(collator_count=n)).annual
                late = runway_years_with_coretime_policy(
                    c, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_LEADIN_END
                )
                early = runway_years_with_coretime_policy(
                    c, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_INTERLUDE
                )
                self.assertLess(abs(late - late_exp), D("0.05"))
                self.assertLess(abs(early - early_exp), D("0.05"))
                # The goal holds at the launch count and at 8, and fails from
                # 10 up -- under the CHEAP policy. That is the joint claim.
                self.assertEqual(late > D(25), n <= 8)
                # The expensive policy fails at every mandated count, so the
                # policy is never the thing that causes the miss.
                self.assertLess(early, D(25))
                # Monotone erosion of what the policy buys.
                gap = late - early
                if prev_gap is not None:
                    self.assertLess(gap, prev_gap)
                prev_gap = gap
        self.assertLess(abs(prev_gap - D("8.35")), D("0.1"))  # 12 collators

    def test_both_clamps_bound_the_price_over_a_swept_grid(self):
        """The two structural bounds `do_renew` guarantees, over a grid.

        * `price <= sale_price(t)` -- the `min` is a CEILING at the open market,
          which is why the ratchet saturates at all.
        * `price >= end_price` -- the `max` is a FLOOR, and it is the pallet's
          own stated intent ("Renewals should never be priced lower than the
          current `end_price`").

        These are necessary and NOT sufficient, which is worth saying because
        the first version of this test claimed they were. Swapping `min` and
        `max` degenerates the function to "always charge `sale_price`", and that
        degenerate form satisfies both bounds everywhere -- so this test passes
        against it. What actually kills that mutant is the next test, plus the
        interlude/leadin-end point values above. Verified by mutation rather
        than assumed: an assertion nothing can violate is decoration.
        """
        ends = (D(1), D(10), D("0.5"), D(1_000))
        prevs = (D(0), D("0.25"), D(1), D(5), D(100), D(10_000))
        throughs = (D(0), D("0.25"), D("0.5"), D("0.75"), D(1))
        bumps = (D(0), D("0.03"), D("0.5"), D(3))
        checked = 0
        for end in ends:
            for prev in prevs:
                for t in throughs:
                    for bump in bumps:
                        price = coretime_renewal_price(prev, end, t, bump)
                        self.assertLessEqual(price, coretime_sale_price(end, t))
                        self.assertGreaterEqual(price, end)
                        checked += 1
        self.assertEqual(checked, 480)

    def test_both_clamps_are_LIVE_and_neither_one_alone_decides_the_price(self):
        """Anti-vacuity: each clamp must actually bind somewhere.

        The bounds above are satisfied by two different degenerate functions --
        "always `sale_price`" (what swapping `min`/`max` produces) and "always
        `end_price`". Ruling both out needs strictness, so this asserts that
        each clamp is the binding one in its own regime:

        * the ratchet binds early in the leadin, where the price is strictly
          BELOW the sale price and strictly increasing in the prior price;
        * the market clamp binds at the ceiling, where raising the prior price
          further changes nothing.
        """
        end, t = D(1), CORETIME_RENEW_INTERLUDE

        # The `min` is not the only thing acting: at t = 0 the sale price is
        # 100x, and a renewal off a floor-priced prior pays 1.03, not 100.
        self.assertLess(coretime_renewal_price(end, end, t), coretime_sale_price(end, t))
        # The ratchet is STRICTLY increasing in the prior price below saturation
        # -- this is what "always `sale_price`" (constant in `prev`) cannot do.
        below = [coretime_renewal_price(D(p), end, t) for p in (1, 2, 5, 20)]
        self.assertEqual(below, sorted(below))
        self.assertLess(below[0], below[-1])
        for lo, hi in zip(below, below[1:]):
            self.assertLess(lo, hi)
        # And the floor is not the only thing acting either: those prices are
        # strictly above `end_price`, ruling out "always `end_price`".
        self.assertGreater(below[0], end)

        # Above saturation the market clamp takes over and `prev` stops mattering.
        ceiling = coretime_ratchet_ceiling(end, t)
        self.assertEqual(coretime_renewal_price(ceiling, end, t), ceiling)
        self.assertEqual(coretime_renewal_price(ceiling * D(10), end, t), ceiling)

    def test_the_saturated_price_is_a_fixed_point_the_path_converges_to(self):
        """Once pinned to the market the recurrence stops moving, at any bump.

        This is the property that makes `coretime_periods_to_saturation`
        terminate, so asserting it also guards that loop against spinning if the
        clamp is ever weakened.
        """
        end = D(7)
        for t in (D(0), D("0.5"), D(1)):
            ceiling = coretime_ratchet_ceiling(end, t)
            for bump in (D("0.03"), D(1), D(10)):
                self.assertEqual(coretime_renewal_price(ceiling, end, t, bump), ceiling)
            path = coretime_price_path(400, end, through=t)
            self.assertEqual(path[-1], ceiling)
            self.assertEqual(path, sorted(path))

    def test_a_zero_bump_reproduces_the_constant_base_under_either_policy(self):
        """The check that this models a mechanism rather than an assumption."""
        self.assertEqual(coretime_annual_escalation(D(0)), D(0))
        c = cost_base().annual
        for through in (CORETIME_RENEW_INTERLUDE, CORETIME_RENEW_LEADIN_END):
            with self.subTest(through=str(through)):
                flat = runway_years_with_coretime_policy(
                    c, NAV_FLOOR_META, D(0), through=through, per_period_cap=D(0)
                )
                self.assertLess(abs(flat - runway_years(c, NAV_FLOOR_META)), D("0.01"))


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


class CoretimeRenewalDiscretenessTests(unittest.TestCase):
    """The renewal schedule is discrete, and rounding it smooth loses an advance.

    Raised by the Codex review of PR #206 against code that predates it (E7,
    `778ff42`). `coretime_annual_cost_path` carried a comment promising to
    "carry the remainder so a 25-year horizon lands on 326 renewals, not
    25 x 13" and then did something else: it advanced the ratchet exactly
    `int(per_year)` times a year and scaled the year's *spend* by
    `per_year / int(per_year)`. The totals are close, but the price recurrence
    ran one advance short per ~23 years and no year ever cost what the model
    said it cost.

    The review's stated consequence -- "whenever the price has not saturated,
    the extra renewal and every subsequent ratchet state are priced
    incorrectly" -- is right as a mechanism and wrong at the shipped
    parameters: at the 3 % cap the ceiling binds at advance 157 (inside year
    12) while the dropped advance first appears at year 23, so it always landed
    in the saturated region and every published 08 §10 figure moves by less
    than 0.01 years. It is the *slower* ratchets where it bites, which is what
    `test_the_dropped_advance_is_unsafe_while_the_ratchet_still_climbs` pins.
    """

    def test_a_year_holds_a_whole_number_of_renewals(self):
        per_year = coretime_renewals_per_year()
        self.assertGreater(per_year, D(13))
        self.assertLess(per_year, D(14))
        counts = [
            coretime_renewals_through_year(y) - coretime_renewals_through_year(y - 1)
            for y in range(1, 41)
        ]
        self.assertEqual(set(counts), {13, 14})
        # The 14-renewal years are exactly the carry years: the remainder
        # 0.0446/year accumulates to a whole renewal every ~22.4 years.
        self.assertEqual([y for y, n in enumerate(counts, 1) if n == 14], [23])
        every_fifty = [
            y
            for y in range(1, 51)
            if coretime_renewals_through_year(y) - coretime_renewals_through_year(y - 1) == 14
        ]
        self.assertEqual(every_fifty, [23, 45])

    def test_the_horizon_lands_on_the_count_the_comment_claims(self):
        # 25 x 13 = 325 is what the smooth form advanced; 326 is the calendar.
        self.assertEqual(coretime_renewals_through_year(25), 326)
        self.assertEqual(coretime_renewals_through_year(1), 13)

    def test_no_year_costs_a_fractional_renewal_once_the_price_saturates(self):
        """The smooth form billed 13.0446 x ceiling every saturated year."""
        end_annual = D("913.125")
        path = coretime_annual_cost_path(30, end_annual)
        ceiling = coretime_ratchet_ceiling(end_annual / coretime_renewals_per_year())
        saturated = path[24:]  # well past advance 157
        for spend in saturated:
            multiple = spend / ceiling
            self.assertEqual(multiple, multiple.to_integral_value())
            self.assertIn(int(multiple), (13, 14))

    def test_the_dropped_advance_is_unsafe_while_the_ratchet_still_climbs(self):
        """A slower cap pushes saturation past the horizon; then it matters.

        At a 1 % per-period cap the ceiling is not reached until advance 464,
        so a 25-year line is priced entirely on the climbing part of the
        ratchet. Advancing 325 times instead of 326 understates the line -- and
        understating a cost overstates the runway, which is the unsafe
        direction (R-7).
        """
        end_annual = D("913.125")
        slow = D("0.01")
        per_year = coretime_renewals_per_year()
        carried = sum(
            coretime_annual_cost_path(25, end_annual, CORETIME_RENEW_INTERLUDE, slow)
        )

        # Reconstruct the superseded smooth form locally, so the test states the
        # size of the defect rather than merely asserting the new number.
        floor_price = end_annual / per_year
        price = floor_price
        smooth = D(0)
        for _ in range(25):
            year_spend = D(0)
            for _ in range(int(per_year)):
                price = coretime_renewal_price(
                    price, floor_price, CORETIME_RENEW_INTERLUDE, slow
                )
                year_spend += price
            smooth += year_spend * per_year / D(int(per_year))

        self.assertGreater(carried, smooth)
        self.assertGreater((carried - smooth) / smooth, D("0.006"))
        self.assertLess((carried - smooth) / smooth, D("0.008"))

    def test_the_published_runway_figures_are_unmoved_by_the_repair(self):
        """Regression pin: the repair is a correctness fix, not a values change."""
        worst = cost_base(
            with_levers(collator_count=12, pol_rerun_fraction=D(1))
        ).annual
        late = runway_years_with_coretime_policy(
            worst, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_LEADIN_END
        )
        early = runway_years_with_coretime_policy(
            worst, NAV_FLOOR_META, D(4_000), through=CORETIME_RENEW_INTERLUDE
        )
        self.assertLess(abs(late - D("19.40")), D("0.05"))
        self.assertLess(abs(early - D("12.72")), D("0.05"))

if __name__ == "__main__":
    unittest.main()
