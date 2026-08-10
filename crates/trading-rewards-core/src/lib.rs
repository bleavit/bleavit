#![cfg_attr(not(feature = "std"), no_std)]
//! Frame-free score kernel for the trading accuracy rewards program.
//! Design: `docs/proposals/2026-08-09-vit-trading-accuracy-rewards-design.md` §4.4–§4.5.

use futarchy_primitives::{kernel::RATE_HEADROOM, Balance};

const PERBILL: u128 = 1_000_000_000;

#[derive(Debug, PartialEq, Eq)]
pub enum CoreError {
    Overflow,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarketScore {
    pub spent: Balance,
    pub received: Balance,
    pub book_acquired: [Balance; 2],
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EpochScore {
    pub spent: Balance,
    pub received: Balance,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Reward(Balance),
    Debit(Balance),
    Neutral,
}

pub fn on_buy(
    s: &mut MarketScore,
    side: usize,
    qty: Balance,
    cost: Balance,
    fee: Balance,
) -> Result<(), CoreError> {
    let slot = s.book_acquired.get_mut(side).ok_or(CoreError::Overflow)?;
    let outlay = cost.checked_add(fee).ok_or(CoreError::Overflow)?;
    s.spent = s.spent.checked_add(outlay).ok_or(CoreError::Overflow)?;
    *slot = slot.checked_add(qty).ok_or(CoreError::Overflow)?;
    Ok(())
}

pub fn on_sell(
    s: &mut MarketScore,
    side: usize,
    qty: Balance,
    proceeds: Balance,
) -> Result<(), CoreError> {
    let slot = s.book_acquired.get_mut(side).ok_or(CoreError::Overflow)?;
    // Only the book-acquired part of the sale is creditable (design §4.4).
    let creditable = core::cmp::min(qty, *slot);
    if creditable == 0 || qty == 0 {
        return Ok(());
    }
    // Pro-rate the proceeds, flooring against the claimant.
    let credited = proceeds
        .checked_mul(creditable)
        .ok_or(CoreError::Overflow)?
        / qty;
    s.received = s
        .received
        .checked_add(credited)
        .ok_or(CoreError::Overflow)?;
    *slot = slot.saturating_sub(creditable);
    Ok(())
}

pub fn on_settle(
    s: &mut MarketScore,
    position: [Balance; 2],
    settled_value: [Balance; 2],
) -> Result<(), CoreError> {
    for side in 0..2 {
        let eligible = core::cmp::min(position[side], s.book_acquired[side]);
        let credit = eligible
            .checked_mul(settled_value[side])
            .ok_or(CoreError::Overflow)?;
        s.received = s.received.checked_add(credit).ok_or(CoreError::Overflow)?;
        s.book_acquired[side] = s.book_acquired[side].saturating_sub(eligible);
    }
    Ok(())
}

pub fn fold(epoch: &mut EpochScore, market: &MarketScore) -> Result<(), CoreError> {
    epoch.spent = epoch
        .spent
        .checked_add(market.spent)
        .ok_or(CoreError::Overflow)?;
    epoch.received = epoch
        .received
        .checked_add(market.received)
        .ok_or(CoreError::Overflow)?;
    Ok(())
}

/// `snapshot_bond / (rate × RATE_HEADROOM)`, floored — a smaller cap is the
/// conservative direction. A zero rate yields a zero cap rather than dividing
/// by zero (G-1).
pub fn earning_cap(snapshot_bond: Balance, rate_ppb: u32) -> Balance {
    let divisor = u128::from(rate_ppb).saturating_mul(RATE_HEADROOM);
    if divisor == 0 {
        return 0;
    }
    snapshot_bond.saturating_mul(PERBILL) / divisor
}

pub fn epoch_outcome(e: &EpochScore, snapshot_bond: Balance, rate_ppb: u32) -> Outcome {
    let cap = earning_cap(snapshot_bond, rate_ppb);
    let rate = u128::from(rate_ppb);
    if e.received > e.spent {
        let net = core::cmp::min(e.received - e.spent, cap);
        // Reward floors, against the claimant.
        let reward = net.saturating_mul(rate) / PERBILL;
        if reward == 0 {
            Outcome::Neutral
        } else {
            Outcome::Reward(reward)
        }
    } else if e.spent > e.received {
        let net = core::cmp::min(e.spent - e.received, cap);
        // Debit ceils, against the claimant.
        let debit = net.saturating_mul(rate).div_ceil(PERBILL);
        if debit == 0 {
            Outcome::Neutral
        } else {
            Outcome::Debit(debit)
        }
    } else {
        Outcome::Neutral
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 2_500_000; // 0.25 %

    #[test]
    fn a_book_buy_records_cost_and_basis() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, 500, 3).expect("no overflow");
        assert_eq!(s.spent, 503, "cost and fee both count against the trader");
        assert_eq!(s.book_acquired[0], 1_000);
        assert_eq!(s.received, 0);
    }

    #[test]
    fn selling_off_book_inventory_scores_nothing() {
        // The account acquired nothing through the book, so a sale of a
        // split-created or transferred-in set credits zero. Design §4.4.
        let mut s = MarketScore::default();
        on_sell(&mut s, 0, 1_000, 990).expect("no overflow");
        assert_eq!(s.received, 0);
        assert_eq!(s.book_acquired[0], 0);
    }

    #[test]
    fn a_sale_is_credited_only_up_to_the_book_acquired_quantity() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 600, 300, 1).expect("no overflow");
        // Sell 1,000 units when only 600 came from the book.
        on_sell(&mut s, 0, 1_000, 1_000).expect("no overflow");
        assert_eq!(s.received, 600, "600/1000 of the proceeds are creditable");
        assert_eq!(s.book_acquired[0], 0);
    }

    // I1 (fix round 1): the test above sets proceeds == qty, so pro-rating by
    // value (`proceeds × creditable / qty`) collapses to the quantity
    // (`creditable`) alone — an implementation that credited *units sold*
    // instead of *value received* would still pass it. proceeds != qty here
    // so the two only agree if the division is actually performed:
    // 1_500 × 600 / 1_000 = 900, not 600.
    #[test]
    fn a_sale_prorates_by_value_not_by_quantity() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 600, 300, 0).expect("no overflow");
        on_sell(&mut s, 0, 1_000, 1_500).expect("no overflow");
        assert_eq!(
            s.received, 900,
            "1_500 * 600 / 1_000 = 900, not the quantity 600"
        );
    }

    // I3 (fix round 1): `CoreError::Overflow` was never produced by any test,
    // so a checked_add/checked_mul silently replaced by a saturating or
    // wrapping op would still pass every other test in this file.
    #[test]
    fn on_buy_reports_overflow_instead_of_panicking() {
        let mut s = MarketScore::default();
        assert_eq!(on_buy(&mut s, 0, 1, u128::MAX, 1), Err(CoreError::Overflow));
    }

    #[test]
    fn settlement_credits_only_the_book_acquired_remainder() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, 500, 3).expect("no overflow");
        on_settle(&mut s, [1_000, 0], [1, 0]).expect("no overflow");
        assert_eq!(s.received, 1_000);
    }

    // I2 (fix round 1): the test above sets position == book_acquired, so an
    // implementation that used `position` alone (ignoring the
    // `min(position, book_acquired)` clamp `book_acquired` exists to
    // enforce — design §4.4) would still pass it. Here position (1_000)
    // exceeds book_acquired (300), so crediting by position alone would give
    // 1_000 * 2 = 2_000 instead of the correct 300 * 2 = 600, and leaving
    // book_acquired un-decremented would also be visible.
    #[test]
    fn settlement_clamps_to_book_acquired_when_position_is_larger() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 300, 150, 0).expect("no overflow");
        on_settle(&mut s, [1_000, 0], [2, 0]).expect("no overflow");
        assert_eq!(
            s.received, 600,
            "eligible = min(1_000, 300) = 300, credit = 300 * 2"
        );
        assert_eq!(
            s.book_acquired[0], 0,
            "book_acquired decrements by the eligible amount"
        );
    }

    // I3 (fix round 1): every existing on_settle test only ever populated
    // side 0, so the loop's side == 1 (SHORT) iteration was dead code as far
    // as the suite could tell — an implementation that only credited side 0
    // would still pass every other test in this file. Both sides carry
    // different quantities and settled values here so a bug that swapped,
    // skipped, or zeroed either side would show up in the total.
    #[test]
    fn on_settle_credits_both_book_sides() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 200, 100, 0).expect("no overflow");
        on_buy(&mut s, 1, 300, 150, 0).expect("no overflow");
        on_settle(&mut s, [200, 300], [2, 3]).expect("no overflow");
        assert_eq!(
            s.received,
            200 * 2 + 300 * 3,
            "both branches credit: 400 + 900"
        );
        assert_eq!(s.book_acquired, [0, 0]);
    }

    // I3 (fix round 1): `fold` had no test at all, though TR3 and TR5 both
    // consume it directly. Folds two markets to confirm it accumulates
    // (adds into the running epoch total) rather than replacing it.
    #[test]
    fn fold_accumulates_across_markets_into_one_epoch_total() {
        let mut epoch = EpochScore::default();

        let mut market_a = MarketScore::default();
        on_buy(&mut market_a, 0, 500, 250, 2).expect("no overflow"); // spent 252
        fold(&mut epoch, &market_a).expect("no overflow");
        assert_eq!(epoch.spent, 252);
        assert_eq!(epoch.received, 0);

        let mut market_b = MarketScore::default();
        on_buy(&mut market_b, 0, 100, 40, 1).expect("no overflow"); // spent 41
        on_sell(&mut market_b, 0, 100, 60).expect("no overflow"); // received 60
        fold(&mut epoch, &market_b).expect("no overflow");
        assert_eq!(epoch.spent, 293, "252 (market_a) + 41 (market_b)");
        assert_eq!(
            epoch.received, 60,
            "market_b's received only; market_a scored none"
        );
    }

    #[test]
    fn the_earning_cap_is_the_bond_over_rate_times_headroom() {
        // 1_000 USDC bond at 0.25 % with headroom 10 caps scorable net at 40_000.
        assert_eq!(earning_cap(1_000, RATE), 40_000);
    }

    #[test]
    fn a_zero_rate_yields_a_zero_cap_rather_than_dividing_by_zero() {
        assert_eq!(earning_cap(1_000, 0), 0);
    }

    #[test]
    fn reward_rounds_down_and_debit_rounds_up() {
        // net = +401 at 0.25 % is 1.0025, which must floor to 1.
        let e = EpochScore {
            spent: 0,
            received: 401,
        };
        assert_eq!(epoch_outcome(&e, u128::MAX, RATE), Outcome::Reward(1));
        // net = -401 at 0.25 % must ceil to 2 against the claimant.
        let e = EpochScore {
            spent: 401,
            received: 0,
        };
        assert_eq!(epoch_outcome(&e, u128::MAX, RATE), Outcome::Debit(2));
    }

    #[test]
    fn the_cap_clamps_both_directions() {
        let bond = 1_000; // cap 40_000
        let e = EpochScore {
            spent: 0,
            received: 100_000,
        };
        assert_eq!(epoch_outcome(&e, bond, RATE), Outcome::Reward(100));
        let e = EpochScore {
            spent: 100_000,
            received: 0,
        };
        assert_eq!(epoch_outcome(&e, bond, RATE), Outcome::Debit(100));
    }

    #[test]
    fn a_wash_pair_never_nets_positive() {
        // The invariant the whole design rests on: for offsetting accounts
        // with equal snapshot bonds, the debit is at least the reward.
        //
        // Deviation from the brief, disclosed per task instructions: at
        // net = 1 and net = 7 the reward floors to zero, which
        // `epoch_outcome` collapses to `Outcome::Neutral` rather than
        // `Reward(0)` (and symmetrically for a zero-valued debit). The
        // brief's original match arms treated any non-`Reward`/non-`Debit`
        // result as a hard failure, which panics on exactly those two net
        // values against the brief's own Step 4 implementation — confirmed
        // by running the test verbatim (see task-2-report.md). The
        // implementation's zero-collapse is left unchanged (it is
        // deliberate, symmetric code, and a sound reading of "no payout"
        // is "no event"); this loop instead reads `Neutral` as the value
        // 0, which is what the design's `debit >= reward` invariant is
        // actually a claim about.
        let bond = 10_000;
        for net in [1u128, 7, 401, 40_000, 1_000_000] {
            let winner = EpochScore {
                spent: 0,
                received: net,
            };
            let loser = EpochScore {
                spent: net,
                received: 0,
            };
            let reward = match epoch_outcome(&winner, bond, RATE) {
                Outcome::Reward(v) => v,
                Outcome::Neutral => 0,
                other => panic!("expected a reward or neutral, got {other:?}"),
            };
            let debit = match epoch_outcome(&loser, bond, RATE) {
                Outcome::Debit(v) => v,
                Outcome::Neutral => 0,
                other => panic!("expected a debit or neutral, got {other:?}"),
            };
            assert!(
                debit >= reward,
                "net {net}: debit {debit} < reward {reward}"
            );
        }
    }
}
