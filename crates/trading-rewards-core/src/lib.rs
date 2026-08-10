#![cfg_attr(not(feature = "std"), no_std)]
//! Frame-free score kernel for the trading accuracy rewards program.
//! Design: `docs/proposals/2026-08-09-vit-trading-accuracy-rewards-design.md` §4.4–§4.5.

use futarchy_primitives::{
    bounds::SCORE_ENTRY_LIFETIME_BLOCKS,
    kernel::{RATE_HEADROOM, SCORE_SCALE},
    Balance, MarketId,
};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

const PERBILL: u128 = 1_000_000_000;

/// The fixed-point scale [`MarketSettlement::settled_value`] is expressed on:
/// `settled_value / SETTLED_VALUE_SCALE` is the branch's terminal redemption
/// value per unit, and par is exactly [`SETTLED_VALUE_SCALE`].
///
/// **A per-unit value is a fraction, so a plain integer cannot carry it.** A
/// scalar unit is denominated in the same base units as branch-USDC — the
/// market's `buy_branch` splits `cost` of branch-USDC into `cost` LONG plus
/// `cost` SHORT units — so one complete set redeems at par for **one** base
/// unit and one LONG unit redeems for `s / 1e9` of it, where `s` is the
/// settled score the ledger stores. Every value below par therefore floors to
/// zero as an integer, which would credit rule 3 with nothing at all and score
/// a trader who held an accurate position to settlement at `−spent`, the whole
/// notional. That is the SQ-1051 defect class exactly, arriving through the
/// other rule.
///
/// 08 §2.6 rule 3's own wording is the tell: *"Settlement adds
/// `min(position, book_acquired) × settled_value` to `received`, **rounded
/// down**"*. A product of two integers needs no rounding, so the value the
/// rule multiplies by was never an integer.
///
/// The scale is the ledger's own [`SCORE_SCALE`], so [`on_settle`] performs the
/// identical arithmetic `redeem_scalar` performs (`a × s / 1e9`, floored) and
/// the credit equals the USDC the redemption really pays.
pub const SETTLED_VALUE_SCALE: Balance = SCORE_SCALE as Balance;

#[derive(Debug, PartialEq, Eq)]
pub enum CoreError {
    Overflow,
}

/// The per-(account, market) accumulator. TR3 stores this in
/// `pallet-trading-rewards`, so it carries the SCALE derives a frame-free
/// kernel does not otherwise need; the arithmetic above is unchanged.
#[derive(
    Clone,
    Debug,
    Default,
    PartialEq,
    Eq,
    Encode,
    Decode,
    DecodeWithMemTracking,
    TypeInfo,
    MaxEncodedLen,
)]
pub struct MarketScore {
    pub spent: Balance,
    pub received: Balance,
    pub book_acquired: [Balance; 2],
    /// The mirror-branch branch-USDC the trade wrapper leaves with the buyer:
    /// the book-side `cost`, **without** the fee (08 §2.6 rule 1, SQ-1051).
    ///
    /// `buy_branch` (`crates/market-core/src/lib.rs`) splits `cost + fee` of
    /// plain USDC into both branches, sends `cost` of the traded branch to the
    /// book and one fee leg **from each branch** to the fee account, so exactly
    /// `cost` of mirror-branch branch-USDC stays with the buyer. Under 04 §6.2's
    /// G-3 that leg redeems at par when the branch is annulled, which is why
    /// rule 4's annulled arm scores `mirror_principal − spent` and not the whole
    /// notional.
    ///
    /// Rule 1 raises `spent` by `cost + fee` and this counter by `cost` on the
    /// same buy, so `spent >= mirror_principal` holds invariantly and their
    /// difference is exactly the fees the market's buys paid.
    pub mirror_principal: Balance,
    /// Block height at which this entry was created, for 08 §2.6's **absolute**
    /// timeout — "measured from the score entry's creation, independent of the
    /// market's state". `u64` for the same reason `market-core` takes `u64`
    /// block heights: the frame-free kernels never see `BlockNumberFor<T>`, and
    /// a widening conversion from any runtime's block number cannot lose a bit.
    pub created_at: u64,
}

impl MarketScore {
    /// True when a fill moved nothing a score is made of.
    ///
    /// [`created_at`](Self::created_at) is a stamp rather than an accumulator,
    /// so it is normalised away before the comparison. Doing it this way rather
    /// than by listing the accounting fields keeps a field added later inside
    /// the comparison automatically — the TR4 review's finding 7 was that a
    /// freshly stamped entry never compares equal to `unwrap_or_default()`, so
    /// the observer's "a fill that moved nothing writes nothing" skip would
    /// have stopped firing silently the moment this field landed.
    pub fn unchanged_from(&self, before: &Self) -> bool {
        let mut probe = self.clone();
        probe.created_at = before.created_at;
        &probe == before
    }

    /// The invariant rule 1 establishes: every buy raises `spent` by
    /// `cost + fee` and `mirror_principal` by `cost`, so the mirror leg can
    /// never exceed what was spent and the annulled arm can never pay a reward.
    pub fn mirror_within_spent(&self) -> bool {
        self.spent >= self.mirror_principal
    }
}

/// How the branch a score entry tracks ended (08 §2.6 rule 4).
///
/// A conditional market pays a buyer in two currencies and only one survives,
/// so a single-arm `received − spent` has to be wrong in one state of the world
/// (SQ-1051). The arm is selected from the branch's terminal disposition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BranchDisposition {
    /// The branch realized: `received − spent`.
    Realized,
    /// The branch was annulled: `mirror_principal − spent`, discarding every
    /// `received` credit, because those are annulled-branch units worth nothing.
    Annulled,
    /// The proposal was VOIDed: the entry drops at zero and folds to nothing,
    /// the same disposition as the absolute-timeout escape.
    Void,
}

/// The terminal facts 08 §2.6 rules 3 and 4 need about one scored book.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarketSettlement {
    pub disposition: BranchDisposition,
    /// The account's terminal branch position, per scalar side.
    pub position: [Balance; 2],
    /// The branch's terminal redemption value per unit, per scalar side, on the
    /// [`SETTLED_VALUE_SCALE`] fixed-point grid — see that constant for why a
    /// bare integer cannot carry a per-unit value.
    ///
    /// Par is `SETTLED_VALUE_SCALE`, and no unit can redeem above par: the
    /// ledger's `ensure_score` refuses a settled score above the scale, and a
    /// complete LONG+SHORT set is worth exactly one base unit. [`on_settle`]
    /// clamps to par anyway, because the supplier of this value is a runtime
    /// adapter outside this kernel.
    pub settled_value: [Balance; 2],
}

/// Read-only source of one scored book's terminal facts.
///
/// The rewards pallet is the consumer, so the interface lives with it; the
/// runtime supplies the adapter that reads the market pallet and the ledger.
/// It is infallible by construction: `None` means "not terminal yet", which is
/// exactly the state the absolute-timeout escape exists for, and there is no
/// channel by which a settlement source could make folding fail.
pub trait SettledMarkets<AccountId> {
    fn settlement(who: &AccountId, market: MarketId) -> Option<MarketSettlement>;
}

impl<AccountId> SettledMarkets<AccountId> for () {
    fn settlement(_who: &AccountId, _market: MarketId) -> Option<MarketSettlement> {
        None
    }
}

/// 08 §2.6's absolute escape: a score entry expires
/// [`SCORE_ENTRY_LIFETIME_BLOCKS`] after its creation, whatever the market is
/// doing. Anchoring it to `ledger.archive` instead would be circular, because
/// the archive sweep needs a terminal vault and a market that never settles
/// never becomes one.
pub fn score_entry_expired(created_at: u64, now: u64) -> bool {
    now.saturating_sub(created_at) >= u64::from(SCORE_ENTRY_LIFETIME_BLOCKS)
}

/// The folded per-account epoch total. Stored inside TR3's participant record,
/// hence the same SCALE derives as [`MarketScore`].
#[derive(
    Clone,
    Debug,
    Default,
    PartialEq,
    Eq,
    Encode,
    Decode,
    DecodeWithMemTracking,
    TypeInfo,
    MaxEncodedLen,
)]
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
    let mirror = s
        .mirror_principal
        .checked_add(cost)
        .ok_or(CoreError::Overflow)?;
    s.spent = s.spent.checked_add(outlay).ok_or(CoreError::Overflow)?;
    // 08 §2.6 rule 1: the wrapper leaves the buyer `cost` of mirror-branch
    // branch-USDC. Raised together with `spent` and by a strictly smaller
    // amount, which is what makes `mirror_within_spent` invariant.
    s.mirror_principal = mirror;
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

/// `floor(a × v / SETTLED_VALUE_SCALE)` for any `a`, with `v` already clamped
/// to par — **and it cannot overflow**, which is the point.
///
/// Writing it as `a.checked_mul(v)? / SCALE` would fail for
/// `a > u128::MAX / 1e9`, and a failure here is not a no-op like every other
/// failure in this program: it comes back out of `settle_market_score`, and a
/// market that has already settled can never take the timeout arm, so the score
/// entry can neither fold nor expire and the bond behind it is locked for good.
/// Splitting `a = q × SCALE + r` removes the failure instead of reporting it:
/// `q × v ≤ q × SCALE ≤ a`, and `r × v < SCALE²= 1e18`, so neither product can
/// leave `u128` and `floor(a × v / SCALE) = q × v + floor(r × v / SCALE)`
/// exactly.
fn scale_down(a: Balance, v: Balance) -> Option<Balance> {
    let whole = (a / SETTLED_VALUE_SCALE).checked_mul(v)?;
    let part = (a % SETTLED_VALUE_SCALE).checked_mul(v)? / SETTLED_VALUE_SCALE;
    whole.checked_add(part)
}

/// 08 §2.6 rule 3: credit the book-acquired part of the terminal position at
/// the branch's per-unit redemption value, rounded down.
///
/// `settled_value` is on the [`SETTLED_VALUE_SCALE`] grid and is **clamped to
/// par here**, not refused above it. The value crosses a runtime seam
/// ([`SettledMarkets`]), so this kernel treats it as untrusted input; refusing
/// would be the one refusal in this program that strands a bond permanently
/// (see [`scale_down`]), while par is the largest value any unit can lawfully
/// redeem for, so the clamp cannot credit more than the market could pay.
pub fn on_settle(
    s: &mut MarketScore,
    position: [Balance; 2],
    settled_value: [Balance; 2],
) -> Result<(), CoreError> {
    for side in 0..2 {
        let eligible = core::cmp::min(position[side], s.book_acquired[side]);
        let value = core::cmp::min(settled_value[side], SETTLED_VALUE_SCALE);
        let credit = scale_down(eligible, value).ok_or(CoreError::Overflow)?;
        s.received = s.received.checked_add(credit).ok_or(CoreError::Overflow)?;
        s.book_acquired[side] = s.book_acquired[side].saturating_sub(eligible);
    }
    Ok(())
}

/// Fold one settled market into the epoch total, selecting 08 §2.6 rule 4's arm
/// from the branch's terminal disposition.
///
/// The arm is expressed on the two unsigned counters rather than as a signed
/// score, so no subtraction happens here and none can underflow. The annulled
/// arm substitutes `mirror_principal` for `received`, which reduces to
/// `Σcost − Σ(cost + fee) = −Σfee` — 04 §6.2's G-3 promise restated, and always
/// a debit rather than a reward, because rule 1 raises both counters on the
/// same buy and `spent >= mirror_principal` invariantly.
pub fn fold(
    epoch: &mut EpochScore,
    market: &MarketScore,
    disposition: BranchDisposition,
) -> Result<(), CoreError> {
    let (spent, received) = match disposition {
        BranchDisposition::Realized => (market.spent, market.received),
        // Every `received` credit is discarded: those are traded-branch
        // branch-USDC and are worth nothing once the branch is annulled.
        BranchDisposition::Annulled => (market.spent, market.mirror_principal),
        // VOID is a constitutional emergency rather than a resolved forecast,
        // so nothing is folded at all.
        BranchDisposition::Void => return Ok(()),
    };
    epoch.spent = epoch.spent.checked_add(spent).ok_or(CoreError::Overflow)?;
    epoch.received = epoch
        .received
        .checked_add(received)
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
        // 08 §2.6 rule 1 (SQ-1051): the wrapper leaves the buyer `cost` of
        // mirror-branch branch-USDC — the book-side cost **without** the fee,
        // verified against `buy_branch` in `crates/market-core/src/lib.rs`,
        // which takes one fee leg from each branch.
        assert_eq!(s.mirror_principal, 500, "the mirror leg excludes the fee");
        assert_ne!(
            s.mirror_principal, s.spent,
            "cost and cost+fee must be distinguishable in this fixture"
        );
    }

    // The invariant the annulled arm rests on, and the reason it can never pay
    // a reward: rule 1 raises both counters on the same buy and their
    // difference is exactly the fees.
    #[test]
    fn the_mirror_leg_never_exceeds_what_was_spent_and_the_gap_is_the_fees() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, 500, 3).expect("no overflow");
        on_buy(&mut s, 1, 400, 200, 2).expect("no overflow");
        assert!(s.mirror_within_spent());
        assert_eq!(s.spent - s.mirror_principal, 5, "3 + 2 fees, exactly");
        // A sale credits `received` and must move neither leg of the identity.
        on_sell(&mut s, 0, 1_000, 900).expect("no overflow");
        assert!(s.mirror_within_spent());
        assert_eq!(s.spent - s.mirror_principal, 5);
    }

    #[test]
    fn a_zero_fee_buy_leaves_the_mirror_leg_equal_to_what_was_spent() {
        // A governed fee of 0 bps is legal — `buy_branch` skips the zero-sized
        // fee legs — and the annulled arm then scores exactly zero, not a
        // reward.
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, 500, 0).expect("no overflow");
        assert_eq!(s.spent, s.mirror_principal);
        let mut epoch = EpochScore::default();
        fold(&mut epoch, &s, BranchDisposition::Annulled).expect("no overflow");
        assert_eq!(
            epoch_outcome(&epoch, u128::MAX, RATE),
            Outcome::Neutral,
            "no fee paid, so an annulled branch costs nothing"
        );
    }

    #[test]
    fn an_overflowing_mirror_leg_is_reported_rather_than_wrapped() {
        let mut s = MarketScore {
            mirror_principal: u128::MAX,
            ..Default::default()
        };
        assert_eq!(on_buy(&mut s, 0, 1, 1, 0), Err(CoreError::Overflow));
    }

    // `created_at` is a stamp rather than an accumulator. Without the
    // normalisation a freshly stamped entry never compares equal to the
    // default, and TR4's "a fill that moved nothing writes nothing" skip would
    // have stopped firing the moment this field landed (TR4 review finding 7).
    #[test]
    fn the_unchanged_probe_ignores_the_creation_stamp_and_nothing_else() {
        let before = MarketScore::default();
        let stamped = MarketScore {
            created_at: 900,
            ..Default::default()
        };
        assert!(stamped.unchanged_from(&before), "the stamp is not a score");
        let mut moved = stamped.clone();
        moved.mirror_principal = 1;
        assert!(
            !moved.unchanged_from(&before),
            "a moved accounting field is a change"
        );
        let mut moved = stamped.clone();
        moved.received = 1;
        assert!(!moved.unchanged_from(&before));
    }

    #[test]
    fn a_score_entry_expires_on_the_absolute_lifetime_and_not_before() {
        let lifetime = u64::from(futarchy_primitives::bounds::SCORE_ENTRY_LIFETIME_BLOCKS);
        assert!(!score_entry_expired(100, 100));
        assert!(!score_entry_expired(100, 100 + lifetime - 1));
        assert!(score_entry_expired(100, 100 + lifetime));
        assert!(score_entry_expired(100, 100 + lifetime + 1));
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
        on_settle(&mut s, [1_000, 0], [SETTLED_VALUE_SCALE, 0]).expect("no overflow");
        assert_eq!(s.received, 1_000, "1_000 units redeeming at par");
    }

    // TR7: the defect the scale exists to prevent, stated as its own test.
    // A branch that settles anywhere below par is the ordinary case — the
    // settled score is a metric reading, not a coin flip — and under an
    // integer `settled_value` every one of those readings floors to zero.
    // The trader would then score `received = 0` against a real `spent` and
    // fold a debit of the whole notional, which is the SQ-1051 failure
    // arriving through rule 3 instead of rule 4. Two sub-par values, so an
    // implementation that hardcoded one cannot pass.
    #[test]
    fn a_sub_par_branch_credits_its_fraction_rather_than_nothing() {
        for (numerator, expected) in [(6_u128, 600_u128), (1, 100)] {
            let mut s = MarketScore::default();
            on_buy(&mut s, 0, 1_000, 500, 3).expect("no overflow");
            let value = numerator * SETTLED_VALUE_SCALE / 10;
            on_settle(&mut s, [1_000, 0], [value, 0]).expect("no overflow");
            assert_eq!(
                s.received, expected,
                "1_000 units at 0.{numerator} of par credits {expected}, never 0"
            );
        }
    }

    // The value crosses a runtime seam, so the kernel does not trust it. Par
    // is the largest any unit can lawfully redeem for, and clamping is the
    // only response that neither over-credits nor strands the bond.
    #[test]
    fn a_settled_value_above_par_is_clamped_rather_than_refused() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, 500, 3).expect("no overflow");
        on_settle(&mut s, [1_000, 0], [SETTLED_VALUE_SCALE * 7, 0]).expect("no overflow");
        assert_eq!(s.received, 1_000, "clamped to par, not 7 000");
    }

    // The obligation the plan states in words: the largest value the adapter
    // can produce (par) against the largest `eligible` the type admits, and
    // the fold must succeed. `checked_mul(eligible, par)` would return `None`
    // here, and that error reaches `settle_market_score`, where the market is
    // already terminal — so the timeout arm can never fire and the bond is
    // locked permanently. The credit is also exact rather than merely
    // non-erroring.
    #[test]
    fn the_largest_eligible_at_par_folds_instead_of_locking_the_bond() {
        let mut s = MarketScore {
            book_acquired: [Balance::MAX, 0],
            ..Default::default()
        };
        on_settle(&mut s, [Balance::MAX, 0], [SETTLED_VALUE_SCALE, 0]).expect("no overflow");
        assert_eq!(s.received, Balance::MAX, "par credits one-for-one, exactly");
        assert_eq!(s.book_acquired, [0, 0]);
    }

    // `scale_down` splits the product to stay inside u128, so it has to agree
    // with the naive form everywhere the naive form is defined.
    #[test]
    fn scaling_down_agrees_with_the_naive_product_it_replaces() {
        for a in [
            0_u128,
            1,
            7,
            SETTLED_VALUE_SCALE - 1,
            SETTLED_VALUE_SCALE,
            1_234_567_891,
        ] {
            for v in [0_u128, 1, 3, SETTLED_VALUE_SCALE / 3, SETTLED_VALUE_SCALE] {
                assert_eq!(
                    scale_down(a, v),
                    Some(a * v / SETTLED_VALUE_SCALE),
                    "scale_down({a}, {v})"
                );
            }
        }
    }

    // I2 (fix round 1): the test above sets position == book_acquired, so an
    // implementation that used `position` alone (ignoring the
    // `min(position, book_acquired)` clamp `book_acquired` exists to
    // enforce — design §4.4) would still pass it. Here position (1_000)
    // exceeds book_acquired (300), so crediting by position alone would give
    // 1_000 * 0.5 = 500 instead of the correct 300 * 0.5 = 150, and leaving
    // book_acquired un-decremented would also be visible. The half-par value
    // keeps the two figures apart under the TR7 scale too.
    #[test]
    fn settlement_clamps_to_book_acquired_when_position_is_larger() {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 300, 150, 0).expect("no overflow");
        on_settle(&mut s, [1_000, 0], [SETTLED_VALUE_SCALE / 2, 0]).expect("no overflow");
        assert_eq!(
            s.received, 150,
            "eligible = min(1_000, 300) = 300, credit = 300 * 0.5"
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
        // The two sides of one scalar book always sum to par, which is the
        // shape the runtime adapter produces: `[s, SCORE_SCALE - s]`.
        let long = SETTLED_VALUE_SCALE / 4;
        on_settle(&mut s, [200, 300], [long, SETTLED_VALUE_SCALE - long]).expect("no overflow");
        assert_eq!(
            s.received,
            200 / 4 + 300 * 3 / 4,
            "both branches credit: 50 + 225"
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
        fold(&mut epoch, &market_a, BranchDisposition::Realized).expect("no overflow");
        assert_eq!(epoch.spent, 252);
        assert_eq!(epoch.received, 0);

        let mut market_b = MarketScore::default();
        on_buy(&mut market_b, 0, 100, 40, 1).expect("no overflow"); // spent 41
        on_sell(&mut market_b, 0, 100, 60).expect("no overflow"); // received 60
        fold(&mut epoch, &market_b, BranchDisposition::Realized).expect("no overflow");
        assert_eq!(epoch.spent, 293, "252 (market_a) + 41 (market_b)");
        assert_eq!(
            epoch.received, 60,
            "market_b's received only; market_a scored none"
        );
    }

    // ----------------------------------------------------------------------
    // 08 §2.6 rule 4's three arms (SQ-1051)
    // ----------------------------------------------------------------------

    /// One buy at `cost`/`fee`, then a sale of the whole book-acquired parcel.
    /// `received` is deliberately large, so the annulled arm's discard is
    /// visible: an implementation that kept `received` would score a reward.
    fn bought_and_sold(cost: Balance, fee: Balance, proceeds: Balance) -> MarketScore {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, 1_000, cost, fee).expect("no overflow");
        on_sell(&mut s, 0, 1_000, proceeds).expect("no overflow");
        s
    }

    #[test]
    fn a_realized_branch_scores_received_minus_spent() {
        let market = bought_and_sold(500, 3, 900);
        let mut epoch = EpochScore::default();
        fold(&mut epoch, &market, BranchDisposition::Realized).expect("no overflow");
        assert_eq!(epoch.spent, 503);
        assert_eq!(epoch.received, 900, "the realized arm keeps every credit");
    }

    // The test the ruling exists for. `−(cost + fee)` is also negative, and it
    // is the defect, so this asserts the exact value rather than the sign.
    #[test]
    fn an_annulled_branch_scores_exactly_the_fees_and_discards_every_credit() {
        let market = bought_and_sold(500, 3, 900);
        let mut epoch = EpochScore::default();
        fold(&mut epoch, &market, BranchDisposition::Annulled).expect("no overflow");
        assert_eq!(epoch.spent, 503);
        assert_eq!(
            epoch.received, 500,
            "the mirror leg replaces `received`, which is discarded whole"
        );
        // `spent − received` = 3 = Σfee, which is 04 §6.2's G-3 restated. The
        // one-arm rule would have given 503 − 900 = a reward, and on a losing
        // sale it would have given the whole notional as a debit.
        assert_eq!(epoch.spent - epoch.received, 3, "exactly the fees paid");
        // The three values a wrong arm lands on are all distinct here: 3 (right),
        // 503 (`−(cost + fee)`, the defect) and −397 (the one-arm reward).
        assert_ne!(epoch.spent - epoch.received, 503);
    }

    #[test]
    fn an_annulled_branch_that_lost_the_whole_notional_still_scores_only_the_fees() {
        // The case 08 §2.6 quantifies: a buyer whose branch is annulled has a
        // realized loss of `fee`, roughly 1/333 of the notional at the `mkt.fee`
        // default, and the retired one-arm rule debited the whole notional.
        let mut market = MarketScore::default();
        on_buy(&mut market, 0, 1_000, 1_000, 3).expect("no overflow");
        let mut epoch = EpochScore::default();
        fold(&mut epoch, &market, BranchDisposition::Annulled).expect("no overflow");
        assert_eq!(epoch.spent - epoch.received, 3);
        assert_eq!(
            epoch_outcome(&epoch, u128::MAX, RATE),
            Outcome::Debit(1),
            "0.25 % of 3, ceiled against the claimant"
        );
        // What the retired rule would have charged, for contrast.
        let one_arm = EpochScore {
            spent: market.spent,
            received: market.received,
        };
        assert_eq!(epoch_outcome(&one_arm, u128::MAX, RATE), Outcome::Debit(3));
    }

    #[test]
    fn a_voided_proposal_folds_to_nothing() {
        let market = bought_and_sold(500, 3, 900);
        let mut epoch = EpochScore {
            spent: 70,
            received: 40,
        };
        fold(&mut epoch, &market, BranchDisposition::Void).expect("no overflow");
        assert_eq!(
            (epoch.spent, epoch.received),
            (70, 40),
            "VOID adds nothing to either counter, in either direction"
        );
    }

    #[test]
    fn the_annulled_arm_can_never_pay_a_reward() {
        // Exhaustive over the shapes a market can take: whatever the sale
        // credits, the annulled arm folds `spent >= received` and
        // `epoch_outcome` can only be a debit or neutral.
        for (cost, fee, proceeds) in [
            (500u128, 3u128, 0u128),
            (500, 3, 900),
            (500, 3, u64::MAX as u128),
            (1, 0, 1_000_000),
            (0, 0, 0),
        ] {
            let market = bought_and_sold(cost, fee, proceeds);
            let mut epoch = EpochScore::default();
            fold(&mut epoch, &market, BranchDisposition::Annulled).expect("no overflow");
            assert!(epoch.spent >= epoch.received, "{cost}/{fee}/{proceeds}");
            assert!(
                !matches!(epoch_outcome(&epoch, u128::MAX, RATE), Outcome::Reward(_)),
                "an annulled branch paid a reward at {cost}/{fee}/{proceeds}"
            );
        }
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
