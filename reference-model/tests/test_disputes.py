"""Pins every published figure in 07 §5, §6 and §11, and the incentives they imply.

Doc 07's bond arithmetic appears in two worked example tables and an escalation
table. This suite reproduces all three, then checks the properties those numbers
are *for*: that a lie is unprofitable, that the §6.3 amendment screen is
directional rather than a freeze, and that the §11 budget closes by construction.

Two results here are consequences of doc 07's own numbers rather than restated
prose, and both are marked at their assertion: the honest challenger's
break-even confidence (5/7, not 1/2) and the `StakeAtRisk` below which §6.2's
`17.5 %` stops being a constant (400,000 USDC).
"""

import unittest
from fractions import Fraction

from bleavit_reference_model.disputes import (
    BOND_BPS_MAX,
    BOND_BPS_MIN,
    BOND_FLOOR_DEFAULT,
    BOND_FLOOR_MAX,
    BOND_FLOOR_MIN,
    DEFAULTS,
    DELTA_S_MAX_MAX,
    HONEST_SHARE,
    INSURANCE_SHARE,
    LATENCY_STAGES,
    MONEY_DEADLINE_DAY,
    PERBILL_PER_BPS,
    REG_BOND_INCIDENT,
    REG_BOND_MILESTONE,
    ROUNDS_MAX,
    ROUNDS_MIN,
    BondError,
    OracleParams,
    admits_component,
    amendment_admissible,
    attack_outcome,
    bond_1,
    bond_r,
    budget_days,
    challenger_breakeven_probability,
    challenger_expected_value,
    coverage_bps,
    coverage_makes_lying_unprofitable,
    cumulative_forfeit,
    default_slash_split,
    expiry_disposition,
    filing_bond,
    flat_bond_attack_outcome,
    floor_crossover_stake,
    ladder,
    ladder_representable,
    naive_amendment_admissible,
    naive_perbill_admits_component,
    per_round_extension_budget_days,
    retain_until_days,
    self_challenge_outcome,
    settles_neutrally,
    slash_split,
    terminal_forfeit_fraction,
    terminal_stack,
    worst_case_close_days,
)


class TestSection5WorkedExample(unittest.TestCase):
    """07 §5's worked example, restated under this spec."""

    STAKE = 400_000

    def test_bond_ladder(self):
        # "`B_1 = max(10k, 2.5% × 400k) = 10k`; challenger posts 0.44 … (10k);
        # round 2 (20k) counter-assert; round 3 (40k) opens".
        b1 = bond_1(self.STAKE)
        self.assertEqual(b1, 10_000)
        self.assertEqual(ladder(b1), (10_000, 20_000, 40_000))

    def test_forfeited_stack_and_split(self):
        # "The reporter forfeits the 70k stack (40/60)".
        stack = terminal_stack(self.STAKE)
        self.assertEqual(stack, 70_000)
        self.assertEqual(slash_split(stack), (28_000, 42_000))
        self.assertEqual(sum(slash_split(stack)), stack)

    def test_total_delay_is_inside_the_section_11_budget(self):
        # "total delay 9 days — inside the §11 budget".
        self.assertLess(9, budget_days())
        self.assertFalse(settles_neutrally(9))


class TestSection62EscalationTable(unittest.TestCase):
    """07 §6.2's defaults table, row by row."""

    def setUp(self):
        self.b1 = bond_1(400_000)

    def test_per_round_bonds_double(self):
        for round_index, expected in ((1, 1), (2, 2), (3, 4)):
            with self.subTest(round=round_index):
                self.assertEqual(bond_r(self.b1, round_index), expected * self.b1)

    def test_cumulative_forfeit_column(self):
        for round_index, multiple in ((1, 1), (2, 3), (3, 7)):
            with self.subTest(round=round_index):
                self.assertEqual(
                    cumulative_forfeit(self.b1, round_index), multiple * self.b1
                )

    def test_terminal_row_is_17_5_percent_at_the_default_bps(self):
        # "`7·B_1 = 17.5% × StakeAtRisk` at the default bps".
        self.assertEqual(terminal_forfeit_fraction(400_000), Fraction(175, 1000))
        self.assertEqual(coverage_bps(DEFAULTS), 1_750)

    def test_the_17_5_percent_figure_holds_only_above_the_floor_crossover(self):
        # DERIVED, not restated: §6.2's table reads as a constant, and is one
        # only at and above `orc.bond_floor / orc.bond_bps` = 400,000 USDC.
        # Below it the floor binds and the terminal forfeit is a *larger*
        # fraction of stake — the safe direction, but not a constant.
        crossover = floor_crossover_stake()
        self.assertEqual(crossover, 400_000)
        self.assertEqual(terminal_forfeit_fraction(int(crossover)), Fraction(7, 40))
        self.assertEqual(terminal_forfeit_fraction(1_200_000), Fraction(7, 40))
        self.assertEqual(terminal_forfeit_fraction(40_000), Fraction(7, 4))  # 175 %
        self.assertEqual(terminal_forfeit_fraction(4_000), Fraction(35, 2))  # 1,750 %
        for stake in (1_000, 40_000, 399_999):
            with self.subTest(stake=stake):
                self.assertGreater(terminal_forfeit_fraction(stake), Fraction(7, 40))

    def test_honest_challenger_revenue_floor(self):
        # "winning any round pays 40% of the loser's stack, ≥ `0.4·B_1` = 1% of
        # StakeAtRisk" — at and above the crossover.
        for round_index in (1, 2, 3):
            stack = cumulative_forfeit(self.b1, round_index)
            honest, _ = slash_split(stack)
            with self.subTest(round=round_index):
                self.assertGreaterEqual(honest, int(HONEST_SHARE * self.b1))
        self.assertEqual(
            Fraction(int(HONEST_SHARE * bond_1(1_200_000)), 1_200_000), Fraction(1, 100)
        )


class TestBondDefinitions(unittest.TestCase):
    """07 §6.1's units, rounding and per-game freezing."""

    def test_division_rounds_up_and_floor_applies_after(self):
        # §6.1 *Units and rounding*: "That division rounds **up** … The `max(·)`
        # against `orc.bond_floor` is applied after rounding." Rounding a bond
        # down is the under-custody direction.
        params = OracleParams(bond_floor=1, bond_bps=250)
        self.assertEqual(bond_1(1, params), 1)  # ceil(250/10,000) = 1, not 0
        self.assertEqual(bond_1(40_001, params), 1_001)  # 1000.025 → 1,001

    def test_floor_binds_below_the_crossover(self):
        self.assertEqual(bond_1(1), BOND_FLOOR_DEFAULT)
        self.assertEqual(bond_1(399_999), BOND_FLOOR_DEFAULT)
        self.assertEqual(bond_1(400_001), 10_001)

    def test_sum_over_cohorts_is_what_the_bond_prices(self):
        # §6.1: "with k = 2, epochs `m` are consumed by two overlapping cohorts
        # … so the value a false `v(c, m)` can move is the *sum* of their
        # escrows, and the bond prices that sum."
        escrows = (600_000, 600_000)
        self.assertEqual(bond_1(sum(escrows)), 30_000)
        self.assertGreater(bond_1(sum(escrows)), bond_1(escrows[0]))

    def test_ladder_representability_is_tested_on_the_whole_ladder(self):
        # §6.1: refuse to open a game whose complete frozen ladder is not
        # representable, "so that a lawfully opened round can never become
        # uncloseable". `B_1` alone always fits where the top round may not.
        b1 = bond_1(400_000)
        self.assertTrue(ladder_representable(b1, DEFAULTS, 40_000))
        self.assertFalse(ladder_representable(b1, DEFAULTS, 39_999))
        self.assertGreaterEqual(39_999, b1)  # B_1 fits; the ladder does not

    def test_round_outside_the_frozen_ladder_refuses(self):
        with self.assertRaises(BondError):
            bond_r(10_000, 4, DEFAULTS)
        with self.assertRaises(BondError):
            bond_r(10_000, 0, DEFAULTS)

    def test_negative_stake_refuses(self):
        with self.assertRaises(BondError):
            bond_1(-1)


class TestSection63CoverageRule(unittest.TestCase):
    """07 §6.3's admission rule, evaluated against live parameters."""

    def test_default_and_hard_minimum_coverage(self):
        self.assertEqual(coverage_bps(DEFAULTS), 1_750)  # 7 × 2.5 % = 17.5 %
        self.assertEqual(coverage_bps(OracleParams(bond_bps=150)), 1_050)  # 10.5 %

    def test_the_10_5_percent_figure_is_illustrative_not_a_floor(self):
        # §6.3 (SQ-341): "[13] admits `orc.rounds ∈ [2, 4]`, and at `(2, 150)`
        # coverage is 450 bps, not 1,050. … an implementation MUST NOT hardcode
        # the 10.5% figure or assume `R_max = 3`."
        self.assertEqual(coverage_bps(OracleParams(bond_bps=150, rounds=2)), 450)
        self.assertEqual(coverage_bps(OracleParams(bond_bps=150, rounds=4)), 2_250)
        self.assertTrue(admits_component(1_000, DEFAULTS))
        self.assertFalse(admits_component(1_000, OracleParams(bond_bps=150, rounds=2)))

    def test_delta_s_max_bounds_are_enforced(self):
        # 05 §4.4 fixes `0 < Δs_max ≤ 10,000` and its basis-point units.
        with self.assertRaises(BondError):
            admits_component(0, DEFAULTS)
        with self.assertRaises(BondError):
            admits_component(DELTA_S_MAX_MAX + 1, DEFAULTS)

    def test_perbill_unit_confusion_admits_what_the_rule_refuses(self):
        # §6.3: a screen comparing the raw `Perbill` against a bps `Δs_max`
        # "reads every proposed rate as ~100,000× more generous than it is and
        # admits precisely the amendments this rule exists to refuse".
        self.assertEqual(PERBILL_PER_BPS, 100_000)
        weakest = OracleParams(bond_bps=BOND_BPS_MIN, rounds=ROUNDS_MIN)
        self.assertFalse(admits_component(DELTA_S_MAX_MAX, weakest))
        self.assertTrue(naive_perbill_admits_component(DELTA_S_MAX_MAX, weakest))

    def test_coverage_rule_delivers_unprofitability_on_the_money(self):
        # The rule is an inequality on rates; check it on the cash, for a
        # reporter holding the whole winning side.
        for stake in (400_000, 1_200_000, 10_000_000):
            for delta in (100, 1_000, 1_750):
                with self.subTest(stake=stake, delta=delta):
                    if admits_component(delta, DEFAULTS):
                        self.assertTrue(
                            coverage_makes_lying_unprofitable(stake, delta, DEFAULTS)
                        )

    def test_an_uncovered_component_is_profitable_to_lie_about(self):
        # The converse, which is why the rule exists: at (2, 150) a component
        # with Δs_max = 1,000 bps is inadmissible, and admitting it anyway pays.
        weak = OracleParams(bond_bps=150, rounds=2)
        self.assertFalse(admits_component(1_000, weak))
        self.assertTrue(attack_outcome(10_000_000, 1_000, weak).profitable)


class TestSection63MetaWorkedExample(unittest.TestCase):
    """07 §6.3's "The review's scenario, recomputed" table."""

    STAKE = 1_200_000
    DELTA_S_BPS = 1_000  # shifting `s` by 0.10

    def test_gross_gain_bound(self):
        # "gross gain bounded by `0.10 × 1,200,000 = 120,000` USDC (attained
        # only if the attacker holds *every* winning scalar unit)".
        outcome = attack_outcome(self.STAKE, self.DELTA_S_BPS)
        self.assertEqual(outcome.gross_gain, 120_000)

    def test_old_flat_regime_row(self):
        # "Old (flat) | 10,000 | 70,000 | **+50,000** (profitable)".
        old = flat_bond_attack_outcome(self.STAKE, self.DELTA_S_BPS)
        self.assertEqual((old.b1, old.stack, old.net), (10_000, 70_000, 50_000))
        self.assertTrue(old.profitable)

    def test_this_spec_row(self):
        # "This spec | `max(10,000; 2.5% × 1.2M) = 30,000` | `7 × 30,000 =
        # 210,000` | `120,000 − 210,000 =` **−90,000**".
        new = attack_outcome(self.STAKE, self.DELTA_S_BPS)
        self.assertEqual((new.b1, new.stack, new.net), (30_000, 210_000, -90_000))
        self.assertFalse(new.profitable)

    def test_any_realistic_position_share_deepens_the_loss(self):
        # "At any realistic position share (< 100% of the winning side) the loss
        # deepens".
        full = attack_outcome(self.STAKE, self.DELTA_S_BPS)
        for share in (Fraction(1, 2), Fraction(3, 4), Fraction(9, 10)):
            partial = attack_outcome(
                self.STAKE, self.DELTA_S_BPS, position_share=share
            )
            with self.subTest(share=share):
                self.assertLess(partial.net, full.net)

    def test_position_share_outside_the_unit_interval_refuses(self):
        with self.assertRaises(BondError):
            attack_outcome(self.STAKE, self.DELTA_S_BPS, position_share=Fraction(2))


class TestSelfChallengeDefault(unittest.TestCase):
    """07 §5.3/§5.5 contract v18 — one account on both sides of the game.

    The same META cohort §6.3 recomputes its worked example on, priced along
    the path the coverage rule never modelled: terminating at round 1 by
    default instead of riding the ladder to `R_max`. §6.3 sizes `B_1` so that
    forfeiting `(2^R_max − 1)·B_1` exceeds the gross gain; that argument holds
    only if landing a false value *costs* the full ladder.
    """

    STAKE = 1_200_000
    DELTA_S_BPS = 1_000  # shifting `s` by 0.10, as in §6.3

    def test_pre_v18_forward_settlement_inverted_the_coverage_promise(self):
        # The honest attacker nets −90,000 (`test_this_spec_row`); the same
        # attacker occupying both roles netted **+102,000** on the same cohort.
        old = self_challenge_outcome(self.STAKE, self.DELTA_S_BPS, neutralized=False)
        self.assertEqual(old.b1, 30_000)
        self.assertEqual(old.required_ladder, 210_000)
        self.assertEqual(old.gross_gain, 120_000)
        self.assertEqual(old.bounty, 12_000)  # its own 40 % counterparty share
        self.assertEqual(old.net_cost, 18_000)
        self.assertEqual(old.net, 102_000)
        self.assertTrue(old.profitable)
        self.assertLess(attack_outcome(self.STAKE, self.DELTA_S_BPS).net, 0)

    def test_it_paid_8_6_percent_of_the_ladder_the_rule_required(self):
        # The rule was bypassed, not beaten: it can be satisfied exactly and
        # still be paid in a fraction of the stack it sized.
        old = self_challenge_outcome(self.STAKE, self.DELTA_S_BPS, neutralized=False)
        self.assertEqual(old.ladder_fraction, Fraction(18_000, 210_000))
        self.assertAlmostEqual(float(old.ladder_fraction), 0.0857, places=4)

    def test_v18_neutralization_removes_the_gain_entirely(self):
        # The repair is on the value side: the false value never lands, so the
        # gross gain is zero rather than merely outweighed.
        new = self_challenge_outcome(self.STAKE, self.DELTA_S_BPS, neutralized=True)
        self.assertEqual(new.gross_gain, 0)
        self.assertEqual(new.bounty, 0)  # §5.5's round-1 exception
        self.assertEqual(new.net, -30_000)
        self.assertFalse(new.profitable)

    def test_no_position_share_makes_the_neutralized_attack_pay(self):
        # Outweighing a gain depends on how much of the winning side the
        # attacker holds; removing it does not.
        for share in (Fraction(1, 4), Fraction(1, 2), Fraction(1)):
            with self.subTest(share=share):
                out = self_challenge_outcome(
                    self.STAKE,
                    self.DELTA_S_BPS,
                    position_share=share,
                    neutralized=True,
                )
                self.assertEqual(out.gross_gain, 0)
                self.assertEqual(out.net, -30_000)

    def test_no_lawful_parameter_set_makes_the_neutralized_attack_pay(self):
        # Unprofitability must not depend on the defaults: `orc.rounds` carries
        # no max-Δ, so 3 → 2 is a single lawful META step.
        for floor in (BOND_FLOOR_MIN, BOND_FLOOR_DEFAULT, BOND_FLOOR_MAX):
            for bps in (BOND_BPS_MIN, BOND_BPS_MAX):
                for rounds in range(ROUNDS_MIN, ROUNDS_MAX + 1):
                    params = OracleParams(floor, bps, rounds)
                    with self.subTest(params=params):
                        out = self_challenge_outcome(
                            self.STAKE, DELTA_S_MAX_MAX, params, neutralized=True
                        )
                        self.assertFalse(out.profitable)
                        self.assertEqual(out.gross_gain, 0)

    def test_the_residual_is_a_priced_griefing_vector_not_a_profit(self):
        # Honest reporting of the residual: neutralization removes the *gain*,
        # it does not remove the *move*. An attacker may still burn `B_1` to
        # force a neutral flagged settlement — which is exactly what §11(4)
        # prices as riding a dispute for a status-quo outcome, and what §10's
        # two-consecutive-flag renormalization exists to absorb. The point is
        # that the price is now paid for nothing.
        new = self_challenge_outcome(self.STAKE, self.DELTA_S_BPS, neutralized=True)
        self.assertEqual(new.net_cost, new.b1)
        self.assertEqual(new.gross_gain, 0)

    def test_round_one_default_pays_no_bounty(self):
        # §5.5 v18: the whole stack routes to INSURANCE. Paying a bounty here
        # is what makes challenging an honest *offline* reporter profitable.
        self.assertEqual(default_slash_split(30_000, 1), (0, 30_000))

    def test_from_round_two_the_ordinary_split_applies(self):
        for round_ in (2, 3):
            with self.subTest(round=round_):
                self.assertEqual(
                    default_slash_split(70_000, round_), slash_split(70_000)
                )

    def test_the_default_split_never_creates_an_unbacked_claim(self):
        for round_ in (1, 2, 3):
            for stack in (0, 1, 999, 30_000, 210_001):
                with self.subTest(round=round_, stack=stack):
                    counterparty, insurance = default_slash_split(stack, round_)
                    self.assertGreaterEqual(counterparty, 0)
                    self.assertGreaterEqual(insurance, 0)
                    self.assertEqual(counterparty + insurance, stack)

    def test_degenerate_inputs_refuse(self):
        with self.assertRaises(BondError):
            default_slash_split(-1, 1)
        with self.assertRaises(BondError):
            default_slash_split(10_000, 0)
        with self.assertRaises(BondError):
            self_challenge_outcome(
                self.STAKE,
                self.DELTA_S_BPS,
                position_share=Fraction(2),
                neutralized=False,
            )


class TestSection63AmendmentScreen(unittest.TestCase):
    """07 §6.3's SQ-495 screen and its three normative properties."""

    ADMITTED = (1_750,)  # a component admitted at (3, 250)

    def test_the_lawful_single_step_the_screen_exists_to_refuse(self):
        # §6.3: "`orc.rounds` carries no max-Δ at all, and `orc.bond_bps`
        # 250 → 150 sits inside its `Factor(2)` band. A component admitted at
        # `(3, 250)` — 1,750 bps — could therefore keep settling money at
        # `(2, 150)`, which is 450."
        live = DEFAULTS
        for proposed in (
            OracleParams(bond_bps=150, rounds=3),
            OracleParams(bond_bps=250, rounds=2),
        ):
            with self.subTest(proposed=proposed):
                verdict = amendment_admissible(live, proposed, self.ADMITTED)
                self.assertFalse(verdict.admitted)
                self.assertLess(verdict.coverage_after, verdict.required)

    def test_raising_is_always_legal(self):
        # "Any amendment that leaves coverage **non-decreasing** MUST be
        # permitted, even when the resulting rate is still short of some
        # admitted component's `Δs_max`."
        under = OracleParams(bond_bps=150, rounds=2)  # 450 bps, under-covered
        repair = OracleParams(bond_bps=150, rounds=3)  # 1,050 — still short
        verdict = amendment_admissible(under, repair, self.ADMITTED)
        self.assertTrue(verdict.admitted)
        self.assertLess(verdict.coverage_after, verdict.required)

    def test_no_admitted_component_means_no_claim_to_leave_unbacked(self):
        # "so must any amendment while no attested component is admitted, since
        # with none there is no claim to leave unbacked."
        verdict = amendment_admissible(
            DEFAULTS, OracleParams(bond_bps=BOND_BPS_MIN, rounds=ROUNDS_MIN), ()
        )
        self.assertTrue(verdict.admitted)

    def test_a_decrease_that_still_covers_is_permitted(self):
        live = OracleParams(bond_bps=1_000, rounds=3)  # 7,000 bps
        proposed = OracleParams(bond_bps=500, rounds=3)  # 3,500 — still ≥ 1,750
        self.assertTrue(amendment_admissible(live, proposed, self.ADMITTED).admitted)

    def test_the_naive_screen_freezes_both_inputs(self):
        # "An implementation that tests only `coverage ≥ required` freezes
        # **both** inputs permanently in exactly the under-covered state this
        # rule exists to leave … every repair would be refused."
        under = OracleParams(bond_bps=150, rounds=2)
        # Every *partial* repair — a strict raise that does not yet reach 1,750.
        # "no single lawful step necessarily restores full coverage, so every
        # repair would be refused."
        partial = (
            OracleParams(bond_bps=150, rounds=3),  # 450 → 1,050
            OracleParams(bond_bps=300, rounds=2),  # 450 → 900
            OracleParams(bond_bps=500, rounds=2),  # 450 → 1,500
        )
        for repair in partial:
            with self.subTest(repair=repair):
                self.assertGreater(coverage_bps(repair), coverage_bps(under))
                self.assertLess(coverage_bps(repair), max(self.ADMITTED))
                self.assertTrue(
                    amendment_admissible(under, repair, self.ADMITTED).admitted
                )
                self.assertFalse(
                    naive_amendment_admissible(under, repair, self.ADMITTED).admitted
                )
        # A repair that fully restores coverage is admitted by both screens —
        # the two differ exactly on the partial ones, which is the whole point.
        full = OracleParams(bond_bps=250, rounds=3)
        self.assertEqual(coverage_bps(full), max(self.ADMITTED))
        self.assertTrue(amendment_admissible(under, full, self.ADMITTED).admitted)
        self.assertTrue(naive_amendment_admissible(under, full, self.ADMITTED).admitted)

    def test_scope_is_every_registered_version(self):
        # "The scope is every *registered* version, not only the versions live
        # cohorts froze" — the binding requirement is the largest Δs_max.
        frozen_only, registered = (500,), (500, 1_750)
        proposed = OracleParams(bond_bps=150, rounds=3)  # 1,050 bps
        self.assertTrue(amendment_admissible(DEFAULTS, proposed, frozen_only).admitted)
        self.assertFalse(amendment_admissible(DEFAULTS, proposed, registered).admitted)

    def test_out_of_bounds_proposals_are_refused(self):
        for proposed in (
            OracleParams(bond_bps=BOND_BPS_MIN - 1),
            OracleParams(bond_bps=BOND_BPS_MAX + 1),
            OracleParams(rounds=ROUNDS_MAX + 1),
        ):
            with self.subTest(proposed=proposed):
                self.assertFalse(
                    amendment_admissible(DEFAULTS, proposed, self.ADMITTED).admitted
                )

    def test_no_reachable_amendment_pair_leaves_an_admitted_component_uncovered(self):
        # The property the screen buys, searched over every lawful (bps, rounds)
        # pair rather than argued from the two the document names.
        live = DEFAULTS
        for rounds in range(ROUNDS_MIN, ROUNDS_MAX + 1):
            for bps in range(BOND_BPS_MIN, BOND_BPS_MAX + 1, 10):
                proposed = OracleParams(bond_bps=bps, rounds=rounds)
                verdict = amendment_admissible(live, proposed, self.ADMITTED)
                if not verdict.admitted:
                    continue
                with self.subTest(bps=bps, rounds=rounds):
                    # Admitted ⇒ either still covered, or strictly better than
                    # where we started. Never a further lowering below cover.
                    self.assertTrue(
                        coverage_bps(proposed) >= max(self.ADMITTED)
                        or coverage_bps(proposed) >= coverage_bps(live)
                    )


class TestChallengerIncentives(unittest.TestCase):
    """What §5.5's 40/60 split implies for the honest side."""

    def test_break_even_confidence_is_five_sevenths(self):
        # DERIVED, not restated. §5.5 sends 40 % of the loser's stack to the
        # winner and 60 % to INSURANCE, so a challenger stakes `S` to win
        # `0.4·S`. EV = p·0.4·S − (1−p)·S is zero at p = 1/1.4 = 5/7 ≈ 71.4 %.
        # §6.2's "challenge incentives grow with exactly the value that needs
        # defending" describes the scale of the reward, not its sign.
        p_star = challenger_breakeven_probability()
        self.assertEqual(p_star, Fraction(5, 7))
        self.assertAlmostEqual(float(p_star), 0.714285, places=5)

    def test_break_even_is_round_independent(self):
        p_star = challenger_breakeven_probability()
        b1 = bond_1(400_000)
        for round_index in (1, 2, 3):
            stack = cumulative_forfeit(b1, round_index)
            with self.subTest(round=round_index):
                self.assertEqual(challenger_expected_value(stack, p_star), 0)

    def test_a_coin_flip_challenge_is_negative_ev(self):
        stack = terminal_stack(400_000)
        self.assertLess(challenger_expected_value(stack, Fraction(1, 2)), 0)
        self.assertGreater(challenger_expected_value(stack, Fraction(9, 10)), 0)

    def test_split_never_creates_an_unbacked_claim(self):
        # Rounding sends the residual base unit to INSURANCE, not to the winner.
        for stack in (0, 1, 3, 7, 70_001, 210_003):
            honest, insurance = slash_split(stack)
            with self.subTest(stack=stack):
                self.assertEqual(honest + insurance, stack)
                self.assertLessEqual(Fraction(honest), HONEST_SHARE * stack)
                self.assertGreaterEqual(Fraction(insurance), INSURANCE_SHARE * stack)


class TestRegistryFilingBond(unittest.TestCase):
    """07 §7 / 13 §1 — the coverage rate's second consumer (SQ-296)."""

    def test_filing_bond_uses_the_coverage_rate_not_the_round_rate(self):
        # `F(kind, m) = max(reg.bond_kind, ceil((2^orc.rounds − 1)·orc.bond_bps
        # × Exposure / 10,000))` — "a one-round game must post the whole ladder
        # up front".
        exposure = 1_000_000
        self.assertEqual(filing_bond("incident", exposure), 175_000)  # 17.5 %
        self.assertEqual(bond_1(exposure), 25_000)  # 2.5 % — the round rate
        self.assertEqual(filing_bond("incident", exposure), terminal_stack(exposure))

    def test_floors_bind_at_small_exposure(self):
        self.assertEqual(filing_bond("incident", 0), REG_BOND_INCIDENT)
        self.assertEqual(filing_bond("milestone", 0), REG_BOND_MILESTONE)

    def test_a_bond_bps_raise_moves_both_surfaces_in_the_safe_direction(self):
        # 13 §1: "an amendment here moves registry filing cost as well as oracle
        # round cost — in the safe direction, since a raise makes false claims
        # dearer on both surfaces."
        exposure = 1_000_000
        raised = OracleParams(bond_bps=500)
        self.assertGreater(filing_bond("incident", exposure, raised),
                           filing_bond("incident", exposure))
        self.assertGreater(bond_1(exposure, raised), bond_1(exposure))

    def test_unknown_kind_refuses(self):
        with self.assertRaises(BondError):
            filing_bond("nonsense", 1)


class TestSection11LatencyBudget(unittest.TestCase):
    """07 §11's table and the rules that make it hold by construction."""

    def test_worst_case_close_column(self):
        # d2 / d7 / d10 / d13 / d21.
        self.assertEqual(worst_case_close_days(), [2, 7, 10, 13, 21])
        self.assertEqual(len(LATENCY_STAGES), 5)

    def test_maximally_delayed_path_lands_at_d21(self):
        self.assertEqual(budget_days(), 21)

    def test_per_round_extensions_would_add_four_days(self):
        # §11 rule 3: "The single-extension rule (§4) is what keeps the sum at
        # 21 d; per-round extensions would add 4 d and are prohibited."
        self.assertEqual(per_round_extension_budget_days(), 25)
        self.assertEqual(per_round_extension_budget_days() - budget_days(), 4)

    def test_the_delayed_path_settles_neutrally(self):
        # §11(2)/I-18: "The maximally delayed path … lands at d21 — past the
        # deadline — so its money settles neutrally and the verdict resolves
        # bonds only."
        self.assertEqual(MONEY_DEADLINE_DAY, 20)
        self.assertTrue(settles_neutrally(budget_days()))
        for early_close in (13, 17, 20):
            with self.subTest(day=early_close):
                self.assertFalse(settles_neutrally(early_close))

    def test_retention_deadline_is_a_deadline_not_a_hope(self):
        # §11(1)/SQ-492: `retain_until = neutralized_at + (decision + confirm)`.
        self.assertEqual(retain_until_days(), 28)
        self.assertGreater(retain_until_days(), budget_days())

    def test_expiry_refunds_both_stacks(self):
        # "Disposition at expiry: both stacks are refunded to their posters;
        # neither is forfeit." §5.5's split disposes of the adjudicated-wrong
        # side's stack, and at expiry there is no adjudicated side at all.
        reporter, challenger = 70_000, 70_000
        self.assertEqual(
            expiry_disposition(reporter, challenger), (70_000, 70_000, 0)
        )
        # Contrast: a verdict inside the window still forfeits per §5.5.
        self.assertEqual(slash_split(reporter), (28_000, 42_000))


if __name__ == "__main__":
    unittest.main()
