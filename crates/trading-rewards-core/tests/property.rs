//! Anti-farm property suite for the 08 §2.6 score kernel (15 §4.2-4.3, R-8).
//!
//! The per-value arithmetic is pinned by the unit tests inside the crate and by
//! the independent Python model
//! (`reference-model/src/bleavit_reference_model/trading_rewards.py`). What
//! lives here is the set of claims that have to hold across the whole input
//! domain rather than at chosen points, and above all the one the program rests
//! on: a wash operator holding both sides of a market cannot come out ahead.
//!
//! Case count comes from `PROPTEST_CASES`, which `ProptestConfig::default()`
//! already reads, so `cargo test --workspace` runs the reduced count and
//! `tools/ci/property-gates.sh rewards` runs the gate count.

use constitution_core::{genesis_params, key16, ParamValue};
use proptest::prelude::*;
use std::sync::LazyLock;
use trading_rewards_core::{
    earning_cap, epoch_outcome, fold, on_buy, on_sell, on_settle, BranchDisposition, EpochScore,
    MarketScore, Outcome, SETTLED_VALUE_SCALE,
};

/// `Perbill` unity, the raw scalar unit 13 rule 8 fixes for a Perbill row.
const PERBILL: u128 = 1_000_000_000;

/// The `[min, max]` of one 13 §1 Perbill row, read from the genesis registry.
///
/// The sweep ranges below are 13-owned values, and runtime-code rule 4 forbids
/// restating one as a literal in tests as much as in code. Reading them here
/// also makes the sweep self-updating: a registry amendment that widens
/// `rwd.rate` widens the domain this suite proves the invariant over, instead
/// of leaving a range nobody re-checked.
fn perbill_bounds(name: &[u8]) -> (u32, u32) {
    let key = key16(name);
    let record = genesis_params()
        .into_iter()
        .find(|r| r.key == key)
        .expect("13 §1 seeds this row at genesis");
    let (ParamValue::Perbill(min), ParamValue::Perbill(max)) = (record.min, record.max) else {
        panic!("13 §1 declares this row Perbill");
    };
    (min, max)
}

/// 13 §1's `rwd.rate` ceiling, currently 60 bps. Zero is the row's minimum and
/// means "off", so the rate sweeps from one rather than from the floor --
/// `a_zero_rate_forgives_everything` covers zero on its own.
static RWD_RATE_MAX_PPB: LazyLock<u32> = LazyLock::new(|| perbill_bounds(b"rwd.rate").1);

/// 13 §1's `mkt.fee` bounds, currently 5 bps and 100 bps.
static MKT_FEE_MIN_PPB: LazyLock<u32> = LazyLock::new(|| perbill_bounds(b"mkt.fee").0);
static MKT_FEE_MAX_PPB: LazyLock<u32> = LazyLock::new(|| perbill_bounds(b"mkt.fee").1);

/// 13 §1's seeded `mkt.fee`, currently 30 bps. Read for the same reason as the
/// bounds: the published break-even figure is derived from it.
static MKT_FEE_DEFAULT_PPB: LazyLock<u32> = LazyLock::new(|| {
    let key = key16(b"mkt.fee");
    let record = genesis_params()
        .into_iter()
        .find(|r| r.key == key)
        .expect("13 §1 seeds mkt.fee at genesis");
    let ParamValue::Perbill(value) = record.value else {
        panic!("13 §1 declares mkt.fee Perbill");
    };
    value
});

/// Proptest's default `max_global_rejects` is 1,024, and the rate/fee coupling
/// screen below rejects about eleven per cent of the drawn pairs -- so the
/// suite aborts on rejects at anything past ten thousand cases and never
/// reaches the invariant at all. Measured: a 200,000-case run stopped after
/// 8,499 successes and 1,024 rejects.
///
/// Scaling the allowance with the case count keeps the screen live, which is
/// the point of drawing the fee at all. Widening the fee range instead, or
/// deriving the fee from the rate, would remove the rejects by removing the
/// hypothesis.
fn config() -> ProptestConfig {
    let mut cfg = ProptestConfig::default();
    cfg.max_global_rejects = cfg.cases.saturating_mul(4).max(1_024);
    cfg
}

/// The reward or debit an outcome carries, reading `Neutral` as zero.
///
/// `epoch_outcome` collapses a zero-valued payout to `Neutral`, so a match that
/// treated anything other than `Reward`/`Debit` as a failure would panic on
/// every small net. The invariants below are claims about amounts, and the
/// amount of a neutral outcome is zero.
fn amount(outcome: Outcome) -> u128 {
    match outcome {
        Outcome::Reward(v) | Outcome::Debit(v) => v,
        Outcome::Neutral => 0,
    }
}

fn reward_of(outcome: Outcome) -> u128 {
    match outcome {
        Outcome::Reward(v) => v,
        _ => 0,
    }
}

fn debit_of(outcome: Outcome) -> u128 {
    match outcome {
        Outcome::Debit(v) => v,
        _ => 0,
    }
}

/// The fee a wash pair pays to manufacture a realized `net`, per 08 §2.6's own
/// derivation of the rate coupling.
///
/// **The `/ 0.99` is load-bearing and must not be simplified away.** The
/// subsection takes the worst case as "an extreme price where the winning leg's
/// profit approaches the whole notional `q`", reads that profit as `0.99q`, and
/// compares `r x 0.99q` against fees of `2fq`. Restated in terms of the
/// realized `net = 0.99q`, the pair's fee bill is therefore
/// `2 . f . net / 0.99` and not `2 . f . net`.
///
/// Dropping the factor states a bound one per cent tighter than the coupling
/// `99 . r <= 200 . f` guarantees, and the coupling's own boundary falsifies
/// it. `the_wash_bound_needs_the_notional_factor` below pins the witness the
/// sweep found.
///
/// Evaluated as one product rather than in stages: `floor(x) + floor(y)` can
/// fall a unit below `floor(x + y)`, and a unit understated here is a unit the
/// invariant would report as a breach. The drawn ranges keep the product well
/// inside `u128` -- `200 x 1e9 x 1e7` is `2e18`.
fn wash_pair_fee_cost(net: u128, fee_ppb: u32) -> u128 {
    200 * net * u128::from(fee_ppb) / (99 * PERBILL)
}

proptest! {
    #![proptest_config(config())]

    /// The invariant the whole design rests on. For any set of accounts whose
    /// positions offset, total payout minus total forfeit is never positive --
    /// evaluated at every rate the registry admits.
    ///
    /// **Two independent bonds, and this is not a detail.** An earlier revision
    /// drew one `bond` and passed it to both legs, which proves only the
    /// equal-bond case and returns green -- that is exactly how the TR2 review
    /// found the invariant did not hold. The pair is one operator, so the bonds
    /// are theirs to choose, and the unequal split is the interesting one: it
    /// caps the loser's forfeit while leaving the winner's reward uncapped, so
    /// the forfeit contributes almost nothing and the fee bill carries the
    /// bound alone.
    ///
    /// The fee is swept for the same reason. An earlier draft swept only the
    /// rate and asserted the screen with a `prop_assume!` the registry ceiling
    /// already satisfied at every drawn value, so the assume filtered nothing.
    /// The invariant depends on the PAIR, so the pair is drawn.
    #[test]
    fn offsetting_accounts_never_net_positive(
        net in 1u128..1_000_000_000u128,
        bond_w in 100_000u128..1_000_000_000u128,
        bond_l in 100_000u128..1_000_000_000u128,
        rate_ppb in 1u32..=*RWD_RATE_MAX_PPB,
        fee_ppb in *MKT_FEE_MIN_PPB..=*MKT_FEE_MAX_PPB,
    ) {
        // The rate coupling is what makes this hold. Respect it, and let the
        // sweep prove the pairs it admits are the safe ones. It binds whenever
        // `mkt.fee` is below 2.97e6 ppb, about a quarter of the drawn range.
        prop_assume!(99 * u128::from(rate_ppb) <= 200 * u128::from(fee_ppb));

        let winner = EpochScore { spent: 0, received: net };
        let loser = EpochScore { spent: net, received: 0 };
        let reward = reward_of(epoch_outcome(&winner, bond_w, rate_ppb));
        let debit = debit_of(epoch_outcome(&loser, bond_l, rate_ppb));

        // The kernel alone cannot bound this: the loser's cap truncates the
        // forfeit while the winner's leaves the reward whole. What the suite
        // asserts is the economic invariant including the pair's own fee cost,
        // which is what the coupling guarantees.
        let fee_cost = wash_pair_fee_cost(net, fee_ppb);
        prop_assert!(
            reward <= debit + fee_cost,
            "reward {reward} > debit {debit} + fees {fee_cost} \
             (net {net}, bonds {bond_w}/{bond_l}, rate {rate_ppb}, fee {fee_ppb})",
        );
    }

    /// What makes the bound above a claim about this kernel rather than about
    /// its hypothesis: a reward is never more than `r x net`, so the cap and
    /// the clamp can only ever lower it. A cap that rounded the wrong way, a
    /// reward that ceiled, or a clamp applied to the wrong side would each show
    /// up here, and each of them would break the wash bound through a term the
    /// rate coupling has no view of.
    #[test]
    fn a_reward_never_exceeds_the_rate_times_the_score(
        net in 1u128..u128::from(u64::MAX),
        bond in 0u128..1_000_000_000_000_000u128,
        rate_ppb in 0u32..=*RWD_RATE_MAX_PPB,
    ) {
        let winner = EpochScore { spent: 0, received: net };
        let reward = reward_of(epoch_outcome(&winner, bond, rate_ppb));
        // `floor(net . r / 1e9)`, split so the product cannot leave `u128`.
        let ceiling = net / PERBILL * u128::from(rate_ppb)
            + net % PERBILL * u128::from(rate_ppb) / PERBILL;
        prop_assert!(reward <= ceiling, "reward {reward} above r x net = {ceiling}");
    }

    /// At equal bonds the caps are equal, so the kernel bounds the pair on its
    /// own and no fee argument is needed. This is the claim the retired
    /// single-bond draft actually proved, kept because it is true and because
    /// it isolates which half of the design each defense carries.
    #[test]
    fn at_equal_bonds_the_forfeit_alone_covers_the_reward(
        net in 1u128..u128::from(u64::MAX),
        bond in 1u128..1_000_000_000_000u128,
        rate_ppb in 1u32..=*RWD_RATE_MAX_PPB,
    ) {
        let winner = EpochScore { spent: 0, received: net };
        let loser = EpochScore { spent: net, received: 0 };
        let reward = reward_of(epoch_outcome(&winner, bond, rate_ppb));
        let debit = debit_of(epoch_outcome(&loser, bond, rate_ppb));
        prop_assert!(debit >= reward, "debit {debit} < reward {reward} at net {net}");
    }

    /// Selling inventory that never came through the book scores nothing,
    /// whatever the proceeds. The `book_acquired` rule closes the hole an
    /// account would otherwise have through the ledger's `split*` family: mint
    /// a complete branch set outside the book, sell every leg, and post the
    /// whole proceeds against a `spent` of zero.
    #[test]
    fn off_book_inventory_never_scores(
        side in 0usize..2,
        qty in 1u128..1_000_000u128,
        proceeds in 0u128..1_000_000_000u128,
    ) {
        let mut s = MarketScore::default();
        on_sell(&mut s, side, qty, proceeds).expect("an empty book cannot overflow");
        prop_assert_eq!(s.received, 0);
        prop_assert_eq!(s.book_acquired, [0, 0]);
    }

    /// A sale credits at most the net proceeds it was handed, and only ever the
    /// book-acquired share of them. Off-book inventory is under-credited and
    /// never over-credited, which is the R-7 direction.
    #[test]
    fn a_sale_never_credits_more_than_the_book_acquired_share(
        side in 0usize..2,
        acquired in 0u128..1_000_000u128,
        cost in 0u128..1_000_000_000u128,
        qty in 1u128..1_000_000u128,
        proceeds in 0u128..1_000_000_000u128,
    ) {
        let mut s = MarketScore::default();
        on_buy(&mut s, side, acquired, cost, 0).expect("bounded magnitudes cannot overflow");
        on_sell(&mut s, side, qty, proceeds).expect("bounded magnitudes cannot overflow");
        prop_assert!(s.received <= proceeds);
        let covered = core::cmp::min(qty, acquired);
        prop_assert_eq!(s.received, proceeds * covered / qty);
        prop_assert_eq!(s.book_acquired[side], acquired - covered);
    }

    /// Rule 3 credits a fraction of par and never more than par. A unit cannot
    /// redeem above par, so the clamp bounds the credit by the book-acquired
    /// quantity whatever the settlement adapter supplies -- including a value
    /// far above the grid, which crosses a runtime seam and is untrusted.
    #[test]
    fn settlement_never_credits_above_par(
        acquired in 0u128..1_000_000_000u128,
        position in 0u128..u128::from(u64::MAX),
        raw_value in 0u128..u128::from(u64::MAX),
    ) {
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, acquired, 0, 0).expect("a zero-cost buy cannot overflow");
        on_settle(&mut s, [position, 0], [raw_value, 0])
            .expect("the split product cannot overflow");
        let eligible = core::cmp::min(position, acquired);
        prop_assert!(s.received <= eligible);
        let value = core::cmp::min(raw_value, SETTLED_VALUE_SCALE);
        prop_assert_eq!(s.received, eligible * value / SETTLED_VALUE_SCALE);
        prop_assert_eq!(s.book_acquired[0], acquired - eligible);
    }

    /// The invariant the annulled arm rests on: rule 1 raises `spent` by
    /// `cost + fee` and `mirror_principal` by `cost` on the same buy, so the
    /// mirror leg can never exceed what was spent however the buys interleave
    /// with a sale -- and the annulled arm can therefore never pay a reward,
    /// whatever the sale credited.
    #[test]
    fn the_annulled_arm_never_pays_a_reward(
        buys in prop::collection::vec(
            (0usize..2, 0u128..1_000_000u128, 0u128..1_000_000u128, 0u128..10_000u128),
            0..8,
        ),
        proceeds in 0u128..u128::from(u64::MAX),
        rate_ppb in 1u32..=*RWD_RATE_MAX_PPB,
        bond in 1u128..1_000_000_000_000u128,
    ) {
        let mut s = MarketScore::default();
        for (side, qty, cost, fee) in buys {
            on_buy(&mut s, side, qty, cost, fee).expect("bounded magnitudes cannot overflow");
        }
        prop_assert!(s.mirror_within_spent());
        on_sell(&mut s, 0, 1_000_000, proceeds).expect("bounded magnitudes cannot overflow");
        prop_assert!(s.mirror_within_spent());

        let mut epoch = EpochScore::default();
        fold(&mut epoch, &s, BranchDisposition::Annulled).expect("bounded magnitudes");
        prop_assert!(epoch.spent >= epoch.received);
        prop_assert!(!matches!(epoch_outcome(&epoch, bond, rate_ppb), Outcome::Reward(_)));
    }

    /// A VOID entry folds to nothing on both counters, so it can move neither
    /// the epoch net nor the outcome. It is the same disposition the absolute
    /// timeout escape uses, which is why nothing here may depend on the score
    /// the entry had accumulated.
    #[test]
    fn a_voided_entry_moves_neither_counter(
        spent in 0u128..u128::from(u64::MAX),
        received in 0u128..u128::from(u64::MAX),
        mirror in 0u128..u128::from(u64::MAX),
        epoch_spent in 0u128..u128::from(u64::MAX),
        epoch_received in 0u128..u128::from(u64::MAX),
    ) {
        let s = MarketScore {
            spent: spent.max(mirror),
            received,
            mirror_principal: mirror,
            ..Default::default()
        };
        let mut epoch = EpochScore { spent: epoch_spent, received: epoch_received };
        fold(&mut epoch, &s, BranchDisposition::Void).expect("VOID folds nothing");
        prop_assert_eq!(epoch.spent, epoch_spent);
        prop_assert_eq!(epoch.received, epoch_received);
    }

    /// The cap is what the bond buys: a payout can never exceed a tenth of the
    /// snapshot bond, at any rate the registry admits and any score. This is
    /// the rate-independent half of the defense, and it is the half that still
    /// holds after a `mkt.fee` amendment retires the other one. The `+ 1` is
    /// the debit's own ceiling, which is the R-7 direction.
    #[test]
    fn no_payout_exceeds_a_tenth_of_the_snapshot_bond(
        spent in 0u128..u128::from(u64::MAX),
        received in 0u128..u128::from(u64::MAX),
        bond in 0u128..1_000_000_000_000_000u128,
        rate_ppb in 1u32..=*RWD_RATE_MAX_PPB,
    ) {
        let e = EpochScore { spent, received };
        prop_assert!(amount(epoch_outcome(&e, bond, rate_ppb)) <= bond / 10 + 1);
    }

    /// A zero or unset rate gives a zero cap, so `settle_epoch` closes at
    /// `Neutral` whatever was folded. 08 §2.6 states the cost outright: a loss
    /// already folded is forgiven in full and the bond is released untouched.
    #[test]
    fn a_zero_rate_forgives_everything(
        spent in 0u128..u128::from(u64::MAX),
        received in 0u128..u128::from(u64::MAX),
        bond in 0u128..1_000_000_000_000_000u128,
    ) {
        prop_assert_eq!(earning_cap(bond, 0), 0);
        let e = EpochScore { spent, received };
        prop_assert_eq!(epoch_outcome(&e, bond, 0), Outcome::Neutral);
    }

    /// The cap is monotone: more bond can only raise it, a higher rate can only
    /// lower it. Neither direction may be reversed by the flooring, because an
    /// operator who tops up must never end with a smaller cap than before --
    /// 08 §2.6 makes a top-up take effect only from the next epoch, which is a
    /// timing rule and not a licence for the amount to move the wrong way.
    #[test]
    fn the_cap_is_monotone_in_both_arguments(
        bond in 0u128..1_000_000_000_000_000u128,
        extra in 0u128..1_000_000_000_000u128,
        rate_ppb in 1u32..=*RWD_RATE_MAX_PPB,
        faster in 0u32..*RWD_RATE_MAX_PPB,
    ) {
        prop_assert!(earning_cap(bond + extra, rate_ppb) >= earning_cap(bond, rate_ppb));
        let raised = core::cmp::min(rate_ppb.saturating_add(faster), *RWD_RATE_MAX_PPB);
        prop_assert!(earning_cap(bond, raised) <= earning_cap(bond, rate_ppb));
    }
}

/// The witness for the `/ 0.99` in [`wash_pair_fee_cost`], pinned as its own
/// test so the factor cannot be simplified back out.
///
/// These are not chosen numbers. They are the shrunk counterexample the sweep
/// itself produced against the `2 . f . net` reading at 20,000,000 cases, and
/// every one of them is inside the ranges the property draws. The rate/fee pair
/// sits one part in eight million inside the coupling, which is why a
/// million-case run finds it only sometimes -- the wrong bound would have
/// shipped green and then failed intermittently, which is worse than either.
#[test]
fn the_wash_bound_needs_the_notional_factor() {
    let (net, bond_w, bond_l, rate_ppb, fee_ppb) = (
        416_305_178u128,
        16_532_741u128,
        100_000u128,
        3_969_648u32,
        1_964_976u32,
    );
    assert!(
        99 * u128::from(rate_ppb) <= 200 * u128::from(fee_ppb),
        "the witness must sit inside the coupling"
    );
    // The witness is only evidence about this suite while the suite can still
    // draw it, so the registry bounds are checked rather than assumed. A 13
    // amendment that moves either row out from under it fails here loudly.
    assert!(
        rate_ppb <= *RWD_RATE_MAX_PPB,
        "the witness rate left the registry range"
    );
    assert!(
        (*MKT_FEE_MIN_PPB..=*MKT_FEE_MAX_PPB).contains(&fee_ppb),
        "the witness fee left the registry range"
    );

    let winner = EpochScore {
        spent: 0,
        received: net,
    };
    let loser = EpochScore {
        spent: net,
        received: 0,
    };
    let reward = reward_of(epoch_outcome(&winner, bond_w, rate_ppb));
    let debit = debit_of(epoch_outcome(&loser, bond_l, rate_ppb));
    assert_eq!((reward, debit), (1_652_585, 10_000));

    let without_factor = 2 * net * u128::from(fee_ppb) / PERBILL;
    assert_eq!(without_factor, 1_636_059);
    assert!(
        reward > debit + without_factor,
        "the `2 . f . net` reading was expected to fail here: \
         reward {reward}, debit {debit}, fees {without_factor}"
    );

    let with_factor = wash_pair_fee_cost(net, fee_ppb);
    // Exactly the reward, so the corrected bound is tight rather than padded:
    // what remains between the two sides is the forfeit alone.
    assert_eq!(with_factor, 1_652_585);
    assert!(reward <= debit + with_factor);
}

/// The pair fee helper is `2 . f . net / 0.99` and is never below the
/// `2 . f . net` reading, so a later "simplify the constant" edit changes a
/// value this test reads rather than passing quietly.
#[test]
fn the_pair_fee_helper_carries_the_notional_factor() {
    // The middle fee is where the coupling turns from binding to slack at the
    // rate ceiling, derived rather than typed.
    let hinge = (99 * *RWD_RATE_MAX_PPB).div_ceil(200);
    for net in [0u128, 1, 2, 98, 99, 100, 12_345, 1_000_000_000] {
        for fee_ppb in [
            *MKT_FEE_MIN_PPB,
            hinge,
            *MKT_FEE_DEFAULT_PPB,
            *MKT_FEE_MAX_PPB,
        ] {
            let with_factor = wash_pair_fee_cost(net, fee_ppb);
            let without_factor = 2 * net * u128::from(fee_ppb) / PERBILL;
            assert_eq!(
                with_factor,
                200 * net * u128::from(fee_ppb) / (99 * PERBILL),
                "net {net}, fee {fee_ppb}"
            );
            assert!(
                with_factor >= without_factor,
                "the factor may only raise the bill: net {net}, fee {fee_ppb}"
            );
        }
    }
    // At the magnitudes the property draws, the gap is real rather than a
    // rounding artefact: a full per cent of a 1e9 net at the `mkt.fee` default,
    // which is the whole margin the coupling leaves.
    let net = 1_000_000_000u128;
    let fee = *MKT_FEE_DEFAULT_PPB;
    let with_factor = wash_pair_fee_cost(net, fee);
    let without_factor = 2 * net * u128::from(fee) / PERBILL;
    assert_eq!(with_factor - without_factor, without_factor / 99);
}
