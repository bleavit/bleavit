"""Re-derives 08 §2.6's trading-accuracy arithmetic and pins its claims.

Every figure the subsection publishes is asserted against the live 13 rows
rather than against a copied literal, so a parameter amendment that closes a
margin turns a test red instead of leaving a stale number in place.
"""

import unittest
from fractions import Fraction

from bleavit_reference_model.registry import REGISTRY
from bleavit_reference_model.trading_rewards import (
    MAX_BUDGET_AUTHORIZATIONS,
    MAX_PARTICIPANTS,
    MAX_SCORED_MARKETS_PER_ACCOUNT,
    MIN_BOND,
    PERBILL_ONE,
    RATE_HEADROOM,
    SCORE_ENTRY_LIFETIME_BLOCKS,
    SCORE_SCALE,
    VIT_USDC_RATE_MAX_FIXED,
    VIT_USDC_RATE_MIN_FIXED,
    VIT_USDC_RATE_REF_FIXED,
    BranchDisposition,
    EpochScore,
    MarketScore,
    OutcomeKind,
    admits_scoring,
    applied_debit,
    book_fee,
    check_fee_floor_retires_the_rate_defense,
    check_rate_defense,
    check_unstated_roundings,
    check_wash_bound_needs_the_notional_factor,
    claim_vit,
    clamp_reward_to_budget,
    differential_scenarios,
    earning_cap,
    epoch_outcome,
    fold,
    genesis_param_ppb,
    market_result,
    on_buy,
    on_sell,
    on_settle,
    replay_scenario,
    reserve_vit,
    score_entry_expired,
    wash_breakeven_rate_ppb,
    wash_fee_floor_ppb,
    wash_pair_fee_cost,
)


F = Fraction

BPS = PERBILL_ONE // 10_000


class RateDerivation(unittest.TestCase):
    """08 §2.6 *The rate is `rwd.rate`* and 13 §1's row for it."""

    def test_rwd_rate_stays_inside_the_wash_breakeven(self):
        """Asserts the live relation, not the literal, so that a `mkt.fee`
        amendment closing the margin turns this red."""
        fee_ppb = genesis_param_ppb("mkt.fee")
        rate_ppb = genesis_param_ppb("rwd.rate")
        breakeven = F(2 * fee_ppb, 1) / F(99, 100)
        self.assertLess(
            rate_ppb,
            breakeven,
            f"rwd.rate {rate_ppb} ppb has reached the {breakeven} ppb wash "
            "break-even; the rate defense has lapsed and only the bond remains",
        )

    def test_breakeven_is_60_point_6_bps_at_the_mkt_fee_default(self):
        """The published figure, re-derived rather than copied."""
        fee_ppb = genesis_param_ppb("mkt.fee")
        self.assertEqual(fee_ppb, 30 * BPS)
        self.assertEqual(wash_breakeven_rate_ppb(fee_ppb), F(2 * 30 * BPS * 100, 99))
        self.assertEqual(
            wash_breakeven_rate_ppb(fee_ppb) / BPS,
            F(6000, 99),
        )
        self.assertAlmostEqual(float(wash_breakeven_rate_ppb(fee_ppb) / BPS), 60.6, places=1)

    def test_the_adopted_rate_sits_2_point_4_times_inside_the_breakeven(self):
        fee_ppb = genesis_param_ppb("mkt.fee")
        rate_ppb = genesis_param_ppb("rwd.rate")
        self.assertEqual(rate_ppb, 25 * BPS)
        margin = wash_breakeven_rate_ppb(fee_ppb) / F(rate_ppb)
        self.assertGreater(margin, F(24, 10))
        self.assertLess(margin, F(25, 10))

    def test_the_rate_defense_lapses_at_12_point_375_bps_per_leg(self):
        rate_ppb = genesis_param_ppb("rwd.rate")
        self.assertEqual(wash_fee_floor_ppb(rate_ppb), F(12_375, 1_000) * BPS)

    def test_mkt_fee_is_amendable_below_that_floor(self):
        """The boundary 08 §2.6 states outright, kept visible as a finding."""
        findings = check_fee_floor_retires_the_rate_defense()
        self.assertEqual(len(findings), 1, findings)
        self.assertEqual(REGISTRY["mkt.fee"].minimum, 5 * BPS)

    def test_the_registry_ceiling_is_the_largest_clean_value_inside_breakeven(self):
        fee_ppb = genesis_param_ppb("mkt.fee")
        ceiling = REGISTRY["rwd.rate"].maximum
        self.assertEqual(ceiling, 60 * BPS)
        self.assertLess(ceiling, wash_breakeven_rate_ppb(fee_ppb))

    def test_the_rate_defense_finding_is_empty_at_the_adopted_values(self):
        self.assertEqual(check_rate_defense(), ())


class ScoreRules(unittest.TestCase):
    """08 §2.6 *The score*, rules 1-3."""

    def test_a_buy_charges_cost_plus_fee_and_credits_the_mirror_principal(self):
        score = MarketScore()
        on_buy(score, 0, cost=1_000, fee=book_fee(1_000, 30 * BPS), quantity=400)
        self.assertEqual(score.spent, 1_003)
        self.assertEqual(score.mirror_principal, 1_000)
        self.assertEqual(score.book_acquired, [400, 0])
        self.assertEqual(score.received, 0)

    def test_the_book_fee_rounds_up_on_both_sides(self):
        self.assertEqual(book_fee(1, 30 * BPS), 1)
        self.assertEqual(book_fee(0, 30 * BPS), 0)
        self.assertEqual(book_fee(1_000_000, 30 * BPS), 3_000)
        self.assertEqual(book_fee(1_000_001, 30 * BPS), 3_001)

    def test_a_sale_credits_proceeds_net_of_the_withheld_fee(self):
        score = MarketScore()
        on_buy(score, 0, cost=1_000, fee=3, quantity=400)
        credited = on_sell(score, 0, proceeds=1_200, fee=book_fee(1_200, 30 * BPS), quantity=400)
        self.assertEqual(credited, 1_196)
        self.assertEqual(score.received, 1_196)
        self.assertEqual(score.book_acquired, [0, 0])

    def test_off_book_inventory_never_scores(self):
        """The `book_acquired` rule: a complete set created through `split*`
        and sold into the book posts nothing against a `spent` of zero."""
        score = MarketScore()
        credited = on_sell(score, 0, proceeds=1_000_000, fee=0, quantity=1_000)
        self.assertEqual(credited, 0)
        self.assertEqual(score.received, 0)
        self.assertEqual(score.book_acquired, [0, 0])

    def test_only_the_covered_part_of_a_mixed_sale_scores(self):
        score = MarketScore()
        on_buy(score, 0, cost=1_000, fee=3, quantity=100)
        credited = on_sell(score, 0, proceeds=800, fee=0, quantity=400)
        self.assertEqual(credited, 200)
        self.assertEqual(score.book_acquired, [0, 0])

    def test_the_covered_share_rounds_down(self):
        score = MarketScore()
        on_buy(score, 0, cost=10, fee=0, quantity=1)
        credited = on_sell(score, 0, proceeds=10, fee=1, quantity=3)
        self.assertEqual(credited, 3)

    def test_settlement_credits_a_fraction_of_par(self):
        """Rule 3: a unit of a branch that settled at 0.6 is worth six tenths
        of a base unit, never a whole one."""
        score = MarketScore()
        on_buy(score, 0, cost=600, fee=2, quantity=1_000)
        credited = on_settle(score, position=[1_000, 0], settled_value=[6 * SCORE_SCALE // 10, 0])
        self.assertEqual(credited, 600)
        self.assertEqual(score.received, 600)

    def test_a_sub_par_settlement_does_not_floor_to_zero(self):
        """The defect the fraction-of-par wording exists to prevent: read as a
        whole number, every sub-par settlement would credit nothing."""
        score = MarketScore()
        on_buy(score, 0, cost=990, fee=3, quantity=1_000)
        on_settle(score, position=[1_000, 0], settled_value=[SCORE_SCALE - 1, 0])
        self.assertEqual(score.received, 999)
        self.assertGreater(score.received, 0)

    def test_settlement_is_clamped_to_par(self):
        score = MarketScore()
        on_buy(score, 0, cost=1_000, fee=3, quantity=1_000)
        credited = on_settle(score, position=[1_000, 0], settled_value=[5 * SCORE_SCALE, 0])
        self.assertEqual(credited, 1_000)

    def test_settlement_credits_only_the_book_acquired_part_of_the_position(self):
        score = MarketScore()
        on_buy(score, 0, cost=100, fee=0, quantity=100)
        credited = on_settle(score, position=[10_000, 0], settled_value=[SCORE_SCALE, 0])
        self.assertEqual(credited, 100)

    def test_settlement_decrements_the_credited_quantity(self):
        """Rule 3's decrement, stated 2026-08-11 after this model disagreed
        with the kernel on the field for 59 % of 30,000 replayed vectors."""
        score = MarketScore()
        on_buy(score, 0, cost=900, fee=3, quantity=1_000)
        on_settle(score, position=[400, 0], settled_value=[SCORE_SCALE, 0])
        self.assertEqual(score.book_acquired, [600, 0])

    def test_settling_the_same_entry_twice_credits_it_once(self):
        """What the decrement is for: without it a repeated call credits the
        same units again, which is the over-credit direction R-7 forbids."""
        score = MarketScore()
        on_buy(score, 0, cost=900, fee=3, quantity=1_000)
        first = on_settle(score, position=[1_000, 0], settled_value=[SCORE_SCALE, 0])
        second = on_settle(score, position=[1_000, 0], settled_value=[SCORE_SCALE, 0])
        self.assertEqual(first, 1_000)
        self.assertEqual(second, 0)
        self.assertEqual(score.received, 1_000)
        self.assertEqual(score.book_acquired, [0, 0])

    def test_a_sale_after_settlement_credits_nothing(self):
        score = MarketScore()
        on_buy(score, 0, cost=900, fee=3, quantity=1_000)
        on_settle(score, position=[1_000, 0], settled_value=[SCORE_SCALE, 0])
        self.assertEqual(on_sell(score, 0, proceeds=5_000, fee=15, quantity=1_000), 0)

    def test_the_two_branch_sides_carry_independent_counters(self):
        """Rule 1 records the filled quantity "for that branch", and 03 §2.3
        settles a LONG unit at `s` and a SHORT unit at `1 - s`."""
        score = MarketScore()
        on_buy(score, 0, cost=100, fee=0, quantity=200)
        on_buy(score, 1, cost=150, fee=0, quantity=300)
        self.assertEqual(score.book_acquired, [200, 300])
        long_value = SCORE_SCALE // 4
        credited = on_settle(
            score,
            position=[200, 300],
            settled_value=[long_value, SCORE_SCALE - long_value],
        )
        self.assertEqual(credited, 200 // 4 + 300 * 3 // 4)
        self.assertEqual(score.book_acquired, [0, 0])

    def test_a_sale_on_one_side_leaves_the_other_untouched(self):
        score = MarketScore()
        on_buy(score, 0, cost=100, fee=0, quantity=200)
        on_buy(score, 1, cost=150, fee=0, quantity=300)
        on_sell(score, 1, proceeds=600, fee=0, quantity=300)
        self.assertEqual(score.book_acquired, [200, 0])
        self.assertEqual(score.received, 600)

    def test_a_side_outside_the_pair_is_refused(self):
        score = MarketScore()
        with self.assertRaises(ValueError):
            on_buy(score, 2, cost=1, fee=0, quantity=1)

    def test_a_sale_may_not_be_credited_gross_of_the_fee(self):
        """Rule 2's own reason: crediting the gross figure would score a trader
        on value the protocol took."""
        gross = MarketScore()
        net = MarketScore()
        on_buy(gross, 0, cost=1_000, fee=3, quantity=1_000)
        on_buy(net, 0, cost=1_000, fee=3, quantity=1_000)
        fee = book_fee(1_200, 30 * BPS)
        on_sell(gross, 0, proceeds=1_200, fee=0, quantity=1_000)
        on_sell(net, 0, proceeds=1_200, fee=fee, quantity=1_000)
        self.assertEqual(gross.received - net.received, fee)


class Dispositions(unittest.TestCase):
    """Rule 4's three arms."""

    def _bought(self, buys):
        score = MarketScore()
        for cost, quantity in buys:
            on_buy(score, 0, cost=cost, fee=book_fee(cost, 30 * BPS), quantity=quantity)
        return score

    def test_realized_scores_received_minus_spent(self):
        score = self._bought([(1_000, 1_000)])
        on_settle(score, position=[1_000, 0], settled_value=[SCORE_SCALE, 0])
        self.assertEqual(market_result(score, BranchDisposition.REALIZED), 1_000 - 1_003)

    def test_the_annulled_arm_is_exactly_minus_the_fees(self):
        """`mirror_principal - spent = sum(cost) - sum(cost + fee) = -sum(fee)`,
        which is 04 §6.2's G-3 promise restated."""
        buys = [(1_000, 1_000), (2_500, 2_000), (7, 3)]
        score = self._bought(buys)
        fees = sum(book_fee(cost, 30 * BPS) for cost, _ in buys)
        self.assertEqual(market_result(score, BranchDisposition.ANNULLED), -fees)

    def test_the_annulled_arm_discards_every_received_credit(self):
        score = self._bought([(1_000, 1_000)])
        without_sale = market_result(score, BranchDisposition.ANNULLED)
        on_sell(score, 0, proceeds=900, fee=book_fee(900, 30 * BPS), quantity=1_000)
        self.assertEqual(market_result(score, BranchDisposition.ANNULLED), without_sale)

    def test_a_one_arm_rule_would_debit_the_whole_notional_of_an_annulled_buyer(self):
        """The defect the annulled arm exists to prevent, measured: the one-arm
        reading scores the whole notional against a trader whose realized loss
        is the fee alone."""
        score = self._bought([(300_000, 300_000)])
        one_arm = score.received - score.spent
        annulled = market_result(score, BranchDisposition.ANNULLED)
        self.assertEqual(annulled, -book_fee(300_000, 30 * BPS))
        self.assertEqual(one_arm, -(300_000 + book_fee(300_000, 30 * BPS)))
        self.assertGreater(F(-one_arm, -annulled), 300)

    def test_void_drops_the_entry_at_zero(self):
        score = self._bought([(1_000, 1_000)])
        on_settle(score, position=[1_000, 0], settled_value=[SCORE_SCALE, 0])
        self.assertEqual(market_result(score, BranchDisposition.VOID), 0)

    def test_both_arms_stay_claimant_adverse(self):
        """Each arm discards value the trader did not realize rather than
        crediting value they did not receive."""
        score = self._bought([(1_000, 1_000)])
        on_settle(score, position=[1_000, 0], settled_value=[SCORE_SCALE, 0])
        realized = market_result(score, BranchDisposition.REALIZED)
        annulled = market_result(score, BranchDisposition.ANNULLED)
        self.assertLessEqual(annulled, 0)
        self.assertLessEqual(realized, score.received)


class Folding(unittest.TestCase):
    """`settle_market_score` folds one settled market into the epoch total."""

    def test_a_realized_fold_moves_both_counters(self):
        epoch = EpochScore()
        score = MarketScore(spent=1_003, received=1_200, mirror_principal=1_000)
        self.assertEqual(fold(epoch, score, BranchDisposition.REALIZED), 197)
        self.assertEqual((epoch.spent, epoch.received), (1_003, 1_200))
        self.assertEqual(epoch.net(), 197)

    def test_an_annulled_fold_folds_the_mirror_principal(self):
        epoch = EpochScore()
        score = MarketScore(spent=1_003, received=1_200, mirror_principal=1_000)
        self.assertEqual(fold(epoch, score, BranchDisposition.ANNULLED), -3)
        self.assertEqual((epoch.spent, epoch.received), (1_003, 1_000))

    def test_a_void_fold_moves_neither_counter(self):
        epoch = EpochScore()
        score = MarketScore(spent=1_003, received=1_200, mirror_principal=1_000)
        self.assertEqual(fold(epoch, score, BranchDisposition.VOID), 0)
        self.assertEqual((epoch.spent, epoch.received), (0, 0))

    def test_the_epoch_net_is_the_sum_of_the_folded_market_results(self):
        epoch = EpochScore()
        total = 0
        for spent, received, mirror, disposition in (
            (1_003, 1_200, 1_000, BranchDisposition.REALIZED),
            (2_006, 0, 2_000, BranchDisposition.ANNULLED),
            (500, 900, 500, BranchDisposition.REALIZED),
            (9_000, 9_000, 9_000, BranchDisposition.VOID),
        ):
            score = MarketScore(spent=spent, received=received, mirror_principal=mirror)
            total += fold(epoch, score, disposition)
        self.assertEqual(epoch.net(), total)

    def test_an_entry_expires_on_an_absolute_height_from_its_creation(self):
        created = 1_000
        self.assertFalse(score_entry_expired(created, created))
        self.assertFalse(
            score_entry_expired(created, created + SCORE_ENTRY_LIFETIME_BLOCKS - 1)
        )
        self.assertTrue(score_entry_expired(created, created + SCORE_ENTRY_LIFETIME_BLOCKS))


class RewardAndDebit(unittest.TestCase):
    """08 §2.6 *Reward and debit, both computed in USDC*."""

    def test_the_cap_is_the_bond_over_the_rate_times_the_headroom(self):
        rate_ppb = genesis_param_ppb("rwd.rate")
        bond = 1_000 * 1_000_000
        self.assertEqual(earning_cap(bond, rate_ppb), bond * PERBILL_ONE // (rate_ppb * 10))
        self.assertEqual(RATE_HEADROOM, 10)

    def test_the_headroom_is_the_top_of_the_fee_vit_usdc_envelope(self):
        """A restatement of an existing bound, not a new constant: 13 §1 fixes
        the `fee.vit_usdc_rate` maximum at 10x the reference."""
        self.assertEqual(VIT_USDC_RATE_MAX_FIXED, RATE_HEADROOM * VIT_USDC_RATE_REF_FIXED)
        self.assertEqual(VIT_USDC_RATE_REF_FIXED, RATE_HEADROOM * VIT_USDC_RATE_MIN_FIXED)

    def test_a_reward_never_exceeds_a_tenth_of_the_bond(self):
        """`r x cap = bond / rate_headroom`, at every rate the envelope admits."""
        for rate_ppb in (1, 25 * BPS, 60 * BPS, REGISTRY["rwd.rate"].maximum):
            for bond in (100_000, 1_000_000, 10**12):
                epoch = EpochScore(received=10**18)
                outcome = epoch_outcome(epoch, bond, rate_ppb)
                self.assertLessEqual(outcome.amount, bond // RATE_HEADROOM)

    def test_a_reward_rounds_down_and_a_debit_rounds_up(self):
        rate_ppb = genesis_param_ppb("rwd.rate")
        bond = 10**12
        # 25 bps of 401 is 1.0025, so the two directions are visibly apart.
        gain = EpochScore(received=401)
        loss = EpochScore(spent=401)
        self.assertEqual(epoch_outcome(gain, bond, rate_ppb).kind, OutcomeKind.REWARD)
        self.assertEqual(epoch_outcome(gain, bond, rate_ppb).amount, 1)
        self.assertEqual(epoch_outcome(loss, bond, rate_ppb).kind, OutcomeKind.DEBIT)
        self.assertEqual(epoch_outcome(loss, bond, rate_ppb).amount, 2)

    def test_a_zero_score_is_neutral(self):
        rate_ppb = genesis_param_ppb("rwd.rate")
        self.assertEqual(
            epoch_outcome(EpochScore(spent=7, received=7), 10**12, rate_ppb).kind,
            OutcomeKind.NEUTRAL,
        )

    def test_a_zero_rate_gives_a_zero_cap_and_closes_at_neutral(self):
        """The stated cost of the G-1 direction: a folded loss is forgiven in
        full and the bond is released untouched."""
        self.assertEqual(earning_cap(10**12, 0), 0)
        self.assertEqual(
            epoch_outcome(EpochScore(spent=10**9), 10**12, 0).kind,
            OutcomeKind.NEUTRAL,
        )

    def test_the_cap_binds_symmetrically(self):
        rate_ppb = REGISTRY["rwd.rate"].maximum
        bond = 1_000_000
        cap = earning_cap(bond, rate_ppb)
        big = 10 * cap
        reward = epoch_outcome(EpochScore(received=big), bond, rate_ppb)
        debit = epoch_outcome(EpochScore(spent=big), bond, rate_ppb)
        self.assertEqual(reward.amount, rate_ppb * cap // PERBILL_ONE)
        self.assertEqual(debit.amount, -(-(rate_ppb * cap) // PERBILL_ONE))

    def test_the_budget_clamp_only_lowers_a_reward(self):
        self.assertEqual(clamp_reward_to_budget(500, 1_000), 500)
        self.assertEqual(clamp_reward_to_budget(1_500, 1_000), 1_000)
        self.assertEqual(clamp_reward_to_budget(1_500, 0), 0)

    def test_a_debit_never_drives_the_bond_below_zero(self):
        self.assertEqual(applied_debit(400, 1_000), (400, False))
        self.assertEqual(applied_debit(1_000, 1_000), (1_000, True))
        self.assertEqual(applied_debit(4_000, 1_000), (1_000, True))

    def test_scoring_admission_is_a_conjunction(self):
        """Neither side derives the other: a sub-minimum top-up leaves a
        suspended participant with a nonzero bond, and a voluntary withdrawal
        leaves a record at zero bond that was never suspended."""
        self.assertTrue(admits_scoring(bond=1, suspended=False))
        self.assertFalse(admits_scoring(bond=1, suspended=True))
        self.assertFalse(admits_scoring(bond=0, suspended=False))
        self.assertFalse(admits_scoring(bond=0, suspended=True))


class VitConversion(unittest.TestCase):
    """08 §2.6 *Both legs are USDC, and only the payout converts*."""

    def _rate_fixed(self):
        return VIT_USDC_RATE_REF_FIXED

    def test_one_usdc_converts_at_the_documented_placeholder(self):
        """0.05 USDC/VIT places 20 VIT behind one USDC of accrual."""
        one_usdc = 1_000_000
        self.assertEqual(claim_vit(one_usdc, self._rate_fixed()), 20 * 10**12)

    def test_the_claim_conversion_rounds_against_the_claimant(self):
        rate_fixed = SCORE_SCALE * 3
        self.assertEqual(claim_vit(1, rate_fixed), 10**15 // (3 * 10**9))
        self.assertLessEqual(
            claim_vit(1, rate_fixed) * rate_fixed,
            1 * 10**15,
        )

    def test_the_reserve_rounds_the_other_way(self):
        rate_fixed = SCORE_SCALE * 3
        self.assertGreaterEqual(reserve_vit(1, rate_fixed), claim_vit(1, rate_fixed))
        self.assertGreaterEqual(reserve_vit(1, rate_fixed) * rate_fixed, 1 * 10**15)

    def test_a_downward_rate_amendment_leaves_the_reserve_short(self):
        """The stated liveness exposure, bounded by the same 10x envelope."""
        held = reserve_vit(1_000_000, VIT_USDC_RATE_REF_FIXED)
        needed = claim_vit(1_000_000, VIT_USDC_RATE_MIN_FIXED)
        self.assertLess(held, needed)
        self.assertEqual(needed // held, RATE_HEADROOM)


class AntiFarm(unittest.TestCase):
    """The invariant the whole design rests on, in the reference model."""

    def _pair(self, net, bond_winner, bond_loser, rate_ppb):
        winner = EpochScore(spent=0, received=net)
        loser = EpochScore(spent=net, received=0)
        reward = epoch_outcome(winner, bond_winner, rate_ppb)
        debit = epoch_outcome(loser, bond_loser, rate_ppb)
        return (
            reward.amount if reward.kind is OutcomeKind.REWARD else 0,
            debit.amount if debit.kind is OutcomeKind.DEBIT else 0,
        )

    def test_offsetting_accounts_never_net_positive_under_the_rate_coupling(self):
        """Swept over both bonds independently, and over the rate/fee pair the
        coupling admits.  Two independent bonds is not a detail: the operator
        holds both sides, so the unequal split is theirs to choose."""
        nets = (1, 999, 10**6, 10**9)
        bonds = (100_000, 1_000_000, 10**9, 10**12)
        rates = (1, 25 * BPS, 60 * BPS)
        fees = (5 * BPS, 30 * BPS, 100 * BPS)
        exercised = 0
        for net in nets:
            for bond_winner in bonds:
                for bond_loser in bonds:
                    for rate_ppb in rates:
                        for fee_ppb in fees:
                            if 99 * rate_ppb > 200 * fee_ppb:
                                continue
                            exercised += 1
                            reward, debit = self._pair(
                                net, bond_winner, bond_loser, rate_ppb
                            )
                            self.assertLessEqual(
                                reward,
                                debit + wash_pair_fee_cost(net, fee_ppb),
                                (net, bond_winner, bond_loser, rate_ppb, fee_ppb),
                            )
        self.assertGreater(exercised, 0)

    def test_the_coupling_screen_is_not_vacuous_over_that_sweep(self):
        filtered = sum(
            1
            for rate_ppb in (1, 25 * BPS, 60 * BPS)
            for fee_ppb in (5 * BPS, 30 * BPS, 100 * BPS)
            if 99 * rate_ppb > 200 * fee_ppb
        )
        self.assertGreater(filtered, 0)

    def test_the_bound_is_false_if_the_pair_fee_drops_the_notional_factor(self):
        """08 §2.6 reads the pair's fees as `2fq` against a profit of `0.99q`.
        Restated in terms of the realized `net`, the fee bill is
        `2 . f . net / 0.99`; the `2 . f . net` form is one per cent tighter
        than the coupling guarantees and the coupling's own boundary falsifies
        it.  Pinned here so the corrected form cannot be simplified back."""
        findings = check_wash_bound_needs_the_notional_factor()
        self.assertEqual(len(findings), 1, findings)
        rate_ppb = REGISTRY["rwd.rate"].maximum
        fee_ppb = -(-(99 * rate_ppb) // 200)
        net = 10**9
        reward, debit = self._pair(net, 10**9, 100_000, rate_ppb)
        naive = 2 * net * fee_ppb // PERBILL_ONE
        self.assertGreater(reward, debit + naive)
        self.assertLessEqual(reward, debit + wash_pair_fee_cost(net, fee_ppb))

    def test_a_lone_winner_with_no_offsetting_loser_is_bounded_by_the_bond(self):
        """The bond is the rate-independent defense and holds at any rate."""
        for rate_ppb in (1, 25 * BPS, REGISTRY["rwd.rate"].maximum):
            bond = 10**6
            outcome = epoch_outcome(EpochScore(received=10**18), bond, rate_ppb)
            self.assertLessEqual(outcome.amount, bond // RATE_HEADROOM)


class Bounds(unittest.TestCase):
    """08 §2.6 *Bounds* and the 13 §4 rows that own each value."""

    def test_the_participant_set_reuses_the_community_schedule_bound(self):
        self.assertEqual(MAX_PARTICIPANTS, 4_096)
        self.assertEqual(MAX_BUDGET_AUTHORIZATIONS, MAX_PARTICIPANTS)

    def test_the_score_entry_bound_is_max_live_markets(self):
        self.assertEqual(MAX_SCORED_MARKETS_PER_ACCOUNT, 196)

    def test_the_score_entry_lifetime_sits_above_the_settlement_horizon(self):
        """13 §4: five cohorts at the epoch ceiling is 3,024,000 blocks."""
        horizon = 5 * 604_800
        self.assertEqual(horizon, 3_024_000)
        self.assertGreater(SCORE_ENTRY_LIFETIME_BLOCKS, horizon)


class UnstatedRoundings(unittest.TestCase):
    def test_the_unstated_directions_are_recorded(self):
        findings = check_unstated_roundings()
        self.assertEqual(len(findings), 2, findings)
        self.assertEqual(
            {finding.name for finding in findings},
            {
                "earning cap rounding is unstated",
                "the credited share of a partly covered sale is unstated",
            },
        )


class DifferentialCorpus(unittest.TestCase):
    """The family `generate-vectors.py` writes and the Rust replay consumes."""

    def test_the_family_is_deterministic(self):
        """Rule 3 of the reference-model rules: byte-identical output for
        identical inputs, or the corpus cannot be a freshness gate."""
        self.assertEqual(differential_scenarios(), differential_scenarios())

    def test_every_row_carries_the_inputs_needed_to_replay_it(self):
        """04 §5's standalone-replay rule."""
        for row in differential_scenarios():
            with self.subTest(row["name"]):
                inputs = row["inputs"]
                self.assertEqual(
                    set(inputs),
                    {
                        "operations",
                        "disposition",
                        "snapshot_bond",
                        "rate_ppb",
                        "created_at",
                        "now",
                    },
                )
                for operation in inputs["operations"]:
                    self.assertIn(operation["op"], {"buy", "sell", "settle"})
                # Every balance is a decimal string: the family reaches above
                # `u64::MAX`, which a JSON number cannot carry to a `u128`.
                for key in ("snapshot_bond",):
                    self.assertIsInstance(inputs[key], str)
                for key in ("spent", "received", "mirror_principal"):
                    self.assertIsInstance(row["score"][key], str)
                self.assertIsInstance(row["market_result"], str)
                self.assertIsInstance(row["earning_cap"], str)
                self.assertIsInstance(row["outcome"]["amount"], str)

    def test_row_names_are_unique(self):
        names = [row["name"] for row in differential_scenarios()]
        self.assertEqual(len(names), len(set(names)))

    def test_every_recorded_output_is_reproduced_by_the_model(self):
        """The corpus is generated, never hand-maintained (rule 2)."""
        for row in differential_scenarios():
            with self.subTest(row["name"]):
                inputs = row["inputs"]
                replayed = replay_scenario(
                    inputs["operations"],
                    BranchDisposition(inputs["disposition"]),
                    int(inputs["snapshot_bond"]),
                    inputs["rate_ppb"],
                    inputs["created_at"],
                    inputs["now"],
                )
                replayed["name"] = row["name"]
                self.assertEqual(replayed, row)

    def test_the_family_reaches_the_corners_it_claims_to(self):
        """A corpus is only a differential over the ground it covers, so the
        coverage is asserted rather than asserted-by-construction."""
        rows = differential_scenarios()
        sub_par = 0
        above_par = 0
        short_leg = 0
        expired = 0
        zero_rate = 0
        capped = 0
        dispositions = set()
        for row in rows:
            dispositions.add(row["inputs"]["disposition"])
            if row["expired"]:
                expired += 1
            if row["inputs"]["rate_ppb"] == 0:
                zero_rate += 1
            net = int(row["epoch"]["received"]) - int(row["epoch"]["spent"])
            if int(row["earning_cap"]) < abs(net):
                capped += 1
            for operation in row["inputs"]["operations"]:
                if operation["op"] == "buy" and operation["side"] == 1:
                    short_leg += 1
                if operation["op"] == "settle":
                    for text in operation["settled_value"]:
                        value = int(text)
                        if 0 < value < SCORE_SCALE:
                            sub_par += 1
                        elif value > SCORE_SCALE:
                            above_par += 1
        self.assertEqual(dispositions, {"realized", "annulled", "void"})
        self.assertGreater(sub_par, 100, "rule 3's fractional arithmetic")
        self.assertGreater(above_par, 20, "the untrusted-seam clamp")
        self.assertGreater(short_leg, 40, "the SHORT leg")
        self.assertGreater(expired, 20, "the timeout escape")
        self.assertGreater(zero_rate, 20, "the zero-rate forgiveness")
        self.assertGreater(capped, 20, "the earning cap binding")

    def test_the_minimum_bond_is_the_position_deposit(self):
        """08 §2.6 reuses `ledger.pos_dep` as the minimum bond, and 13 §1
        freezes that row at 0.1 USDC."""
        record = REGISTRY["ledger.pos_dep"]
        self.assertEqual(record.unit, "µUSDC")
        self.assertEqual(record.value, MIN_BOND)
        # 13 §1 freezes the row, so the floor cannot move under the program.
        self.assertEqual((record.minimum, record.maximum), (MIN_BOND, MIN_BOND))


if __name__ == "__main__":
    unittest.main()
