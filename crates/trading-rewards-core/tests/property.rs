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
// 13 §4's `ScoreEntryLifetime` is derived from a kernel constant rather than
// stored, so `futarchy-primitives` is its one home (runtime-code rule 4).
use futarchy_primitives::bounds::SCORE_ENTRY_LIFETIME_BLOCKS;
use proptest::prelude::*;
use std::sync::LazyLock;
use trading_rewards_core::{
    earning_cap, epoch_outcome, fold, on_buy, on_sell, on_settle, score_entry_expired,
    BranchDisposition, EpochScore, MarketScore, Outcome, SETTLED_VALUE_SCALE,
};

/// `Perbill` unity, the raw scalar unit 13 rule 8 fixes for a Perbill row.
const PERBILL: u128 = 1_000_000_000;

/// 08 §2.6's wash derivation, as the one pair of integers every use of it reads.
///
/// The subsection takes the worst case as "an extreme price where the winning
/// leg's profit approaches the whole notional `q`", reads that profit as
/// `0.99q`, and compares `r x 0.99q` against fees of `2fq`. Every appearance of
/// `99` and `200` below is one of these two, cross-multiplied -- the coupling
/// `WASH_PROFIT_NUM . r <= WASH_FEE_LEGS . WASH_PROFIT_DEN . f` and the fee
/// bill `2 . f . net / 0.99`.
///
/// The reference model carries the same relation as
/// `WASH_PROFIT_SHARE = Fraction(99, 100)` in `trading_rewards.py`. It is an
/// 08 §2.6 constant with no 13 row, so runtime-code rule 4 is not engaged and
/// neither copy can be derived from the registry; keeping each language's copy
/// in one place is what stops the two drifting apart inside a language.
const WASH_PROFIT_NUM: u128 = 99;
const WASH_PROFIT_DEN: u128 = 100;
const WASH_FEE_LEGS: u128 = 2;

/// Whether a `(rwd.rate, mkt.fee)` pair satisfies `r <= 2f / 0.99`.
fn inside_the_coupling(rate_ppb: u32, fee_ppb: u32) -> bool {
    WASH_PROFIT_NUM * u128::from(rate_ppb) <= WASH_FEE_LEGS * WASH_PROFIT_DEN * u128::from(fee_ppb)
}

/// The smallest `mkt.fee` the coupling admits at this rate: `ceil(99r / 200)`.
fn coupling_fee_floor_ppb(rate_ppb: u32) -> u32 {
    let numerator = WASH_PROFIT_NUM * u128::from(rate_ppb);
    let denominator = WASH_FEE_LEGS * WASH_PROFIT_DEN;
    u32::try_from(numerator.div_ceil(denominator)).expect("a ppb rate fits u32")
}

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

/// 08 §2.6's minimum bond, which is `ledger.pos_dep` and not a value of its
/// own: *"`ledger.pos_dep` already prices an entry against bloat, so the
/// minimum reuses that live row and adds no key."*
///
/// It is the bond at which the loser's forfeit -- and therefore the slack in
/// the wash bound -- is smallest, so it is the lower end of every bond the
/// properties draw. Read from the registry per runtime-code rule 4.
static MIN_BOND_USDC: LazyLock<u128> = LazyLock::new(|| {
    let key = key16(b"ledger.pos_dep");
    let record = genesis_params()
        .into_iter()
        .find(|r| r.key == key)
        .expect("13 §1 seeds ledger.pos_dep at genesis");
    let ParamValue::Balance(value) = record.value else {
        panic!("13 §1 declares ledger.pos_dep a Balance");
    };
    value
});

/// The lowest `rwd.rate` whose coupling floor `ceil(99r / 200)` clears 13 §1's
/// own `mkt.fee` minimum.
///
/// Below it the registry floor binds first, the coupling is slack at every
/// admissible fee, and the anti-farm bound cannot be evaluated anywhere near
/// its boundary. The wash property therefore draws most of its rates from
/// above this point -- and it is derived, so a `mkt.fee` amendment moves it.
static COUPLING_BINDING_RATE_PPB: LazyLock<u32> = LazyLock::new(|| {
    let numerator = WASH_FEE_LEGS * WASH_PROFIT_DEN * u128::from(*MKT_FEE_MIN_PPB);
    u32::try_from(numerator / WASH_PROFIT_NUM + 1).expect("a ppb rate fits u32")
});

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
    WASH_FEE_LEGS * WASH_PROFIT_DEN * net * u128::from(fee_ppb) / (WASH_PROFIT_NUM * PERBILL)
}

/// The `(rate, fee)` pairs the coupling admits, **drawn rather than filtered**.
///
/// This is the round-1 fix for two separate defects at once, and the reason it
/// is a strategy rather than a `prop_assume!`.
///
/// 1. **A filtered boundary is never sampled.** The bound is tight only where
///    `200f - 99r` approaches zero, and a uniform fee draw lands there with
///    probability zero. Filtering with `prop_assume!` kept every admissible
///    pair and reached the boundary at none of them, which is why the property
///    below killed 0 of 32 kernel mutations. The floor is drawn explicitly,
///    with weight, so the tight case is the common case.
/// 2. **The filter aborted the shard.** Proptest's default `max_global_rejects`
///    is 1,024 and the screen rejected about eleven per cent of pairs, so a
///    200,000-case run stopped after 8,499 successes without evaluating the
///    invariant once. Deriving the fee removes the rejects entirely rather than
///    raising the allowance to outrun them.
///
/// The hypothesis stays visible: the property asserts the coupling holds for
/// every pair this yields, so a derivation that drifted outside it fails rather
/// than quietly widening the claim.
fn admissible_rate_and_fee() -> impl Strategy<Value = (u32, u32)> {
    let rate = prop_oneof![
        // Where the coupling floor clears 13 §1's `mkt.fee` minimum, so the
        // boundary is reachable at all.
        4 => *COUPLING_BINDING_RATE_PPB..=*RWD_RATE_MAX_PPB,
        1 => 1u32..=*RWD_RATE_MAX_PPB,
    ];
    rate.prop_flat_map(|rate_ppb| {
        let floor = coupling_fee_floor_ppb(rate_ppb).max(*MKT_FEE_MIN_PPB);
        let fee = prop_oneof![
            // Exactly at the boundary, where the fee bill is the whole bound.
            4 => Just(floor),
            2 => floor..=floor.saturating_add(1_000).min(*MKT_FEE_MAX_PPB),
            1 => floor..=*MKT_FEE_MAX_PPB,
        ];
        (Just(rate_ppb), fee)
    })
}

/// The registry bounds must admit the coupling at all, and this says so by name.
///
/// `admissible_rate_and_fee` builds `floor..=mkt.fee max`, which **inverts and
/// panics inside the strategy** once the coupling floor for the highest lawful
/// rate passes `mkt.fee`'s ceiling — at a `rwd.rate` maximum above 20,202,020
/// ppb, about 3.4x the current headroom. That is reachable: a 13 §1 row's
/// `max` is ordinary META-amendable metadata.
///
/// A panic from inside a proptest strategy is a stack trace about `Range`, not
/// about the registry, so the amendment that caused it would be the last place
/// anybody looked. Asserting it here turns the same condition into a named
/// failure that says what is wrong. It is also a real statement about the two
/// rows and not only test hygiene: if no lawful `mkt.fee` satisfies the
/// coupling at the highest lawful `rwd.rate`, then the screen TR9 installs can
/// refuse every amendment of one row, and the values layer is self-sealing.
#[test]
fn the_registry_bounds_admit_at_least_one_lawful_pair_at_every_rate() {
    let floor_at_max = coupling_fee_floor_ppb(*RWD_RATE_MAX_PPB);
    assert!(
        floor_at_max <= *MKT_FEE_MAX_PPB,
        "13 §1 now admits a rwd.rate of {} ppb, whose coupling floor is {} ppb, \
         above mkt.fee's ceiling of {} ppb. No lawful fee satisfies the coupling \
         at that rate, so the pair is unscreenable and the sweep below cannot \
         build its range.",
        *RWD_RATE_MAX_PPB,
        floor_at_max,
        *MKT_FEE_MAX_PPB,
    );
    assert!(
        *COUPLING_BINDING_RATE_PPB <= *RWD_RATE_MAX_PPB,
        "the coupling never binds inside the lawful rate range, so the sweep's \
         boundary draw is dead and the screen is untested by it",
    );
}

proptest! {
    /// The invariant the whole design rests on. For any set of accounts whose
    /// positions offset, total payout minus total forfeit is never positive --
    /// evaluated at every rate the registry admits.
    ///
    /// **Two independent bonds, and this is not a detail.** An earlier revision
    /// drew one `bond` and passed it to both legs, which proves only the
    /// equal-bond case and returns green -- that is exactly how the TR2 review
    /// found the invariant did not hold. The pair is one operator, so the bonds
    /// are theirs to choose, and the unequal split is the interesting one: it
    /// caps the loser's forfeit while leaving the winner's reward uncapped.
    ///
    /// **What this property can and cannot detect, measured rather than
    /// assumed.** Two terms give the bound slack, and only one of them was an
    /// accident:
    ///
    /// * the fee term, which is slack everywhere except at the coupling floor.
    ///   That was the accident, and [`admissible_rate_and_fee`] fixes it by
    ///   drawing the floor;
    /// * the forfeit, which at a binding loser cap is `bond_l / 10` -- real
    ///   money the pair pays, and therefore slack the design genuinely has.
    ///   `bond_l` is drawn from `ledger.pos_dep`, the lawful minimum bond, so
    ///   the smallest slack the program admits is sampled; but a mutation that
    ///   inflates the reward by less than that is invisible **here** by
    ///   construction, and no amount of drawing changes it.
    ///
    /// So this property owns the composed economic claim, and the two
    /// properties after it own the per-leg contracts a single-unit mutation
    /// moves. All three are needed and none subsumes another.
    #[test]
    fn offsetting_accounts_never_net_positive(
        net in 1u128..1_000_000_000u128,
        bond_w in *MIN_BOND_USDC..1_000_000_000u128,
        bond_l in *MIN_BOND_USDC..1_000_000_000u128,
        (rate_ppb, fee_ppb) in admissible_rate_and_fee(),
    ) {
        // Drawn rather than filtered, so this is a claim about the generator
        // instead of a screen that silently discards work.
        prop_assert!(
            inside_the_coupling(rate_ppb, fee_ppb),
            "the strategy produced rate {rate_ppb} / fee {fee_ppb} outside the coupling",
        );

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

    /// The debit leg's own contract, and the mirror of the property above:
    /// a forfeit is exactly `ceil(r x min(|net|, cap))`. R-7 puts the debit's
    /// rounding in the opposite direction from the reward's, and stating both
    /// as equalities is what stops a change that keeps the two legs symmetric
    /// from passing every comparison between them.
    #[test]
    fn a_debit_is_the_rate_times_the_score_rounded_up(
        net in 1u128..u128::from(u64::MAX),
        bond in 0u128..1_000_000_000_000_000u128,
        rate_ppb in 0u32..=*RWD_RATE_MAX_PPB,
    ) {
        let loser = EpochScore { spent: net, received: 0 };
        let debit = debit_of(epoch_outcome(&loser, bond, rate_ppb));
        let scored = core::cmp::min(net, earning_cap(bond, rate_ppb));
        let exact = scored
            .checked_mul(u128::from(rate_ppb))
            .expect("the drawn magnitudes stay inside u128");
        prop_assert_eq!(debit, exact.div_ceil(PERBILL));
    }

    /// At equal bonds the caps are equal, so the kernel bounds the pair on its
    /// own and no fee argument is needed. This is the claim the retired
    /// single-bond draft actually proved, kept because it is true and because
    /// it isolates which half of the design each defense carries.
    ///
    /// **It is near-tautological in one direction, and that is worth naming.**
    /// With one cap the property reduces to `ceil(x) >= floor(x)` on a single
    /// quantity, so it cannot detect any change that keeps the two legs
    /// symmetric -- both legs flooring passes it. What it does detect is
    /// asymmetry: a cap applied to one side only, or a reward that overpays.
    /// `a_debit_is_the_rate_times_the_score_rounded_up` is what pins the
    /// symmetric case.
    #[test]
    fn at_equal_bonds_the_forfeit_alone_covers_the_reward(
        net in 1u128..u128::from(u64::MAX),
        bond in *MIN_BOND_USDC..1_000_000_000_000u128,
        rate_ppb in 1u32..=*RWD_RATE_MAX_PPB,
    ) {
        let winner = EpochScore { spent: 0, received: net };
        let loser = EpochScore { spent: net, received: 0 };
        let reward = reward_of(epoch_outcome(&winner, bond, rate_ppb));
        let debit = debit_of(epoch_outcome(&loser, bond, rate_ppb));
        prop_assert!(debit >= reward, "debit {debit} < reward {reward} at net {net}");
    }

    /// Rule 1's two counters move together on every buy and differ by exactly
    /// the fees: `spent - mirror_principal == sum(fee)`.
    ///
    /// This is the split the annulled arm is built on. Nothing else in the
    /// suite pins it, and both ways of breaking it are R-7-adverse: charging
    /// the fee to the mirror leg under-punishes an annulled branch by the whole
    /// fee bill (the SQ-1051 direction), and dropping it from `spent` inflates
    /// every net and therefore every reward.
    #[test]
    fn the_gap_between_spent_and_the_mirror_leg_is_exactly_the_fees(
        buys in prop::collection::vec(
            (0usize..2, 0u128..1_000_000u128, 0u128..1_000_000u128, 0u128..10_000u128),
            0..8,
        ),
    ) {
        let mut s = MarketScore::default();
        let mut fees = 0u128;
        let mut costs = 0u128;
        for (side, qty, cost, fee) in buys {
            on_buy(&mut s, side, qty, cost, fee).expect("bounded magnitudes cannot overflow");
            fees += fee;
            costs += cost;
        }
        prop_assert_eq!(s.mirror_principal, costs, "the mirror leg is the cost alone");
        prop_assert_eq!(s.spent, costs + fees, "the charge is cost plus fee");
        prop_assert_eq!(s.spent - s.mirror_principal, fees);
        // The annulled arm therefore folds a debit of exactly the fees, which
        // is 04 §6.2's G-3 promise restated.
        let mut epoch = EpochScore::default();
        fold(&mut epoch, &s, BranchDisposition::Annulled).expect("bounded magnitudes");
        prop_assert_eq!(epoch.spent - epoch.received, fees);
    }

    /// The absolute timeout is `>=`, not `>`: an entry at exactly the lifetime
    /// has expired. The boundary is the whole content of the rule -- an
    /// off-by-one here is a bond released a block late or a block early on the
    /// only escape a never-settling market has.
    #[test]
    fn an_entry_expires_at_the_lifetime_and_not_a_block_later(
        created_at in 0u64..1_000_000_000u64,
        elapsed in 0u64..u64::from(SCORE_ENTRY_LIFETIME_BLOCKS) * 2,
    ) {
        let lifetime = u64::from(SCORE_ENTRY_LIFETIME_BLOCKS);
        prop_assert_eq!(
            score_entry_expired(created_at, created_at.saturating_add(elapsed)),
            elapsed >= lifetime,
        );
        // Stated again at the boundary itself, which a uniform draw over a
        // ten-million-block window reaches once in ten million cases.
        prop_assert!(!score_entry_expired(created_at, created_at + lifetime - 1));
        prop_assert!(score_entry_expired(created_at, created_at + lifetime));
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

    /// Rule 3 credits a fraction of par and never more than par, on the branch
    /// the units were acquired on.
    ///
    /// **The value is drawn on the grid the rule lives on.** An earlier draft
    /// drew it from `0..u64::MAX`, which reaches a sub-par value with
    /// probability `1e9 / 1.8e19` -- about `5e-11`, so `0.00005` expected
    /// sub-par cases across the whole million-case gate. The clamp then made
    /// `value` par at every drawn point, the equality below degenerated to
    /// `received == eligible`, and rule 3's fractional arithmetic was never
    /// executed. Four mutations survived, including 08 §2.6's own
    /// `"read as an integer, every sub-par settlement floors to zero"` defect
    /// verbatim -- the one the rule spends three paragraphs on. The
    /// above-par arm is kept with real weight, because the untrusted-seam clamp
    /// is a separate claim and dropping it would trade one blind spot for
    /// another.
    #[test]
    fn settlement_never_credits_above_par(
        side in 0usize..2,
        acquired in 0u128..1_000_000_000u128,
        position in 0u128..u128::from(u64::MAX),
        raw_value in prop_oneof![
            // Sub-par: where rule 3's fraction of par actually lives.
            5 => 0u128..SETTLED_VALUE_SCALE,
            // The three exact points the fraction degenerates at.
            2 => prop::sample::select(vec![
                0u128,
                1,
                SETTLED_VALUE_SCALE - 1,
                SETTLED_VALUE_SCALE,
            ]),
            // Above par, from just over the grid to the far end of the type:
            // the adapter is outside this kernel and its value is untrusted.
            2 => SETTLED_VALUE_SCALE..(4 * SETTLED_VALUE_SCALE),
            1 => SETTLED_VALUE_SCALE..u128::from(u64::MAX),
        ],
    ) {
        let mut s = MarketScore::default();
        on_buy(&mut s, side, acquired, 0, 0).expect("a zero-cost buy cannot overflow");
        let mut positions = [0u128; 2];
        positions[side] = position;
        let mut values = [0u128; 2];
        values[side] = raw_value;
        on_settle(&mut s, positions, values).expect("the split product cannot overflow");
        let eligible = core::cmp::min(position, acquired);
        prop_assert!(s.received <= eligible);
        let value = core::cmp::min(raw_value, SETTLED_VALUE_SCALE);
        prop_assert_eq!(s.received, eligible * value / SETTLED_VALUE_SCALE);
        prop_assert_eq!(s.book_acquired[side], acquired - eligible);
        prop_assert_eq!(s.book_acquired[1 - side], 0, "the other branch is untouched");
    }

    /// Both branches are credited, each at its own settled value. Every other
    /// settlement property populates one side, and the kernel's loop over the
    /// pair is the kind of thing that reads as covered while a `0..1` bound
    /// would pass every one of them.
    ///
    /// The pair `[s, SCORE_SCALE - s]` is the shape the runtime adapter
    /// produces, because 03 §2.3 pays a LONG unit `s` and a SHORT unit `1 - s`.
    #[test]
    fn settlement_credits_each_branch_at_its_own_value(
        long_units in 0u128..1_000_000u128,
        short_units in 0u128..1_000_000u128,
        long_value in 0u128..=SETTLED_VALUE_SCALE,
    ) {
        let short_value = SETTLED_VALUE_SCALE - long_value;
        let mut s = MarketScore::default();
        on_buy(&mut s, 0, long_units, 0, 0).expect("bounded magnitudes cannot overflow");
        on_buy(&mut s, 1, short_units, 0, 0).expect("bounded magnitudes cannot overflow");
        on_settle(&mut s, [long_units, short_units], [long_value, short_value])
            .expect("bounded magnitudes cannot overflow");
        prop_assert_eq!(
            s.received,
            long_units * long_value / SETTLED_VALUE_SCALE
                + short_units * short_value / SETTLED_VALUE_SCALE,
        );
        prop_assert_eq!(s.book_acquired, [0, 0]);
    }

    /// Rule 3 decrements `book_acquired` by the credited quantity, so no unit
    /// is ever credited twice however many times an entry is settled.
    ///
    /// 08 §2.6 stated the decrement on 2026-08-11, after the reference model
    /// disagreed with the kernel over the field. Without it a repeated
    /// settlement credits the same units again, which is the over-credit
    /// direction R-7 forbids -- and the exact-value assertions below are what
    /// makes that visible, since the two calls have identical arguments and a
    /// missing decrement simply doubles the credit.
    #[test]
    fn no_unit_is_credited_by_two_settlements(
        side in 0usize..2,
        acquired in 0u128..1_000_000u128,
        position in 0u128..1_000_000u128,
        value in 0u128..=SETTLED_VALUE_SCALE,
    ) {
        let mut s = MarketScore::default();
        on_buy(&mut s, side, acquired, 0, 0).expect("bounded magnitudes cannot overflow");
        let mut positions = [0u128; 2];
        positions[side] = position;
        let mut values = [0u128; 2];
        values[side] = value;

        on_settle(&mut s, positions, values).expect("bounded magnitudes cannot overflow");
        let first_units = core::cmp::min(position, acquired);
        prop_assert_eq!(s.received, first_units * value / SETTLED_VALUE_SCALE);
        prop_assert_eq!(s.book_acquired[side], acquired - first_units);
        let after_first = s.received;

        // The same call again. It may consume a second tranche when the first
        // settlement was partial, but it may never re-credit a unit the first
        // one already consumed.
        on_settle(&mut s, positions, values).expect("bounded magnitudes cannot overflow");
        let second_units = core::cmp::min(position, acquired - first_units);
        prop_assert_eq!(
            s.received,
            after_first + second_units * value / SETTLED_VALUE_SCALE,
        );
        prop_assert_eq!(s.book_acquired[side], acquired - first_units - second_units);
        // Total units credited never exceeds what the book supplied.
        prop_assert!(first_units + second_units <= acquired);
        if position >= acquired {
            // A full settlement leaves nothing, so the repeat is a strict no-op.
            prop_assert_eq!(s.received, after_first);
            prop_assert_eq!(s.book_acquired[side], 0);
        }
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
