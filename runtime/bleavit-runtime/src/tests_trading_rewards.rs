//! TR7 — 08 §2.6's trading-accuracy reward program, as the assembled runtime
//! runs it.
//!
//! Everything here needs the real `construct_runtime!`: the pallet's own mock
//! binds `SettledMarkets` to a hand-written table and `TradeObserver` to `()`,
//! so the seam between the book, the ledger and the score accumulator has no
//! test anywhere else. Three things are only checkable here, and each of them
//! was a live defect at some point in this plan:
//!
//! 1. **a call is reachable on both axes**, not just the one a test remembered
//!    (TR6 lost a milestone to a capability arm without a resource family);
//! 2. **the fill accumulator really runs on a real dispatch**, and its 13 §4
//!    per-account bound really stops it without stopping the trade; and
//! 3. **the settlement adapter reports the value the ledger will actually
//!    pay**, which is a fraction of par rather than an integer.

use crate::{
    configs::RuntimeSettledMarkets,
    tests::{account, development_ext},
    Balance, Balances, ConditionalLedger, ForeignAssets, FutarchyTreasury, Market, Runtime,
    RuntimeCall, RuntimeOrigin, TradingRewards,
};
use frame_support::traits::{fungibles::Mutate, Contains, PalletInfo, PalletInfoAccess};
use frame_support::{assert_noop, assert_ok};
use futarchy_primitives::{
    currency, kernel, Branch, FixedU64, GateType, MarketId, PositionId, PositionKind, ProposalId,
    ScalarSide, VaultState,
};
use pallet_market::core_market::BookKind;
use trading_rewards_core::{BranchDisposition, SettledMarkets, SETTLED_VALUE_SCALE};

const PID: ProposalId = 77_001;
const MARKET: MarketId = 77_001;
const BASELINE_EPOCH: futarchy_primitives::EpochId = 77_001;
const BASELINE_MARKET: MarketId = 77_003;

/// Every call the pallet exposes, as a `RuntimeCall`, so a call added later
/// cannot quietly escape the filter and origin assertions below. The list is
/// pinned against runtime metadata by `tests_s5`'s bidirectional inventory, so
/// it cannot drift short.
fn every_trading_reward_call() -> [RuntimeCall; 6] {
    [
        RuntimeCall::TradingRewards(pallet_trading_rewards::Call::enroll { bond: 1_000 }),
        RuntimeCall::TradingRewards(pallet_trading_rewards::Call::top_up_bond { amount: 1_000 }),
        RuntimeCall::TradingRewards(pallet_trading_rewards::Call::withdraw_bond {}),
        RuntimeCall::TradingRewards(pallet_trading_rewards::Call::claim_rewards {}),
        RuntimeCall::TradingRewards(pallet_trading_rewards::Call::settle_market_score {
            who: account(219),
            market: MARKET,
        }),
        RuntimeCall::TradingRewards(pallet_trading_rewards::Call::settle_epoch {
            who: account(219),
        }),
    ]
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

#[test]
fn the_trading_rewards_pallet_occupies_slot_68() {
    assert_eq!(
        <Runtime as frame_system::Config>::PalletInfo::index::<TradingRewards>(),
        Some(68),
    );
    assert_eq!(<TradingRewards as PalletInfoAccess>::index(), 68);
}

#[test]
fn the_market_observer_is_bound_to_the_rewards_pallet() {
    assert_eq!(
        core::any::type_name::<<Runtime as pallet_market::Config>::TradeObserver>(),
        core::any::type_name::<TradingRewards>(),
    );
}

/// The sovereign custodies USDC bonds and a VIT budget, never a conditional
/// position, so a Signed `ledger.transfer` into it must be refused the same
/// way every other protocol account is refused — or a position sent there
/// would be stranded permanently, and the frozen `is_reserved_protocol_
/// destination` surface would not have warned the client that sent it.
#[test]
fn the_reward_sovereign_refuses_a_signed_ledger_transfer_of_a_conditional_position() {
    development_ext().execute_with(|| {
        let trader = seeded_decision_book(Branch::Accept);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        let position = PositionId::Proposal {
            proposal: PID,
            branch: Branch::Accept,
            kind: PositionKind::Long,
        };
        let held = pallet_conditional_ledger::Positions::<Runtime>::get(position, &trader);
        assert!(held > 0, "the buy really left a position to try to strand");

        let sovereign = TradingRewards::account_id();
        assert!(
            crate::configs::ReservedProtocolAccounts::contains(&sovereign),
            "the sovereign must be a reserved protocol destination",
        );
        assert_noop!(
            ConditionalLedger::transfer(RuntimeOrigin::signed(trader), position, sovereign, held),
            pallet_conditional_ledger::Error::<Runtime>::ProtocolDestination,
        );
    });
}

// ---------------------------------------------------------------------------
// 06 §3 — the authority matrix, on both axes
// ---------------------------------------------------------------------------

/// **The plan's own wrapper assertion is false, and asserting it would have
/// been worse than omitting it.** It reads
/// `assert!(!SafetyFilter::contains(&wrap_in_batch(enroll)))`. `utility.batch`
/// is a member of the *permitted* wrapper set: the filter recurses through it
/// and admits whatever it finds, and a `CallDomain::Public` leaf is admitted
/// everywhere by definition — `Public` is the domain every origin may reach.
/// Making that assertion pass would mean denying ordinary users the ability to
/// batch an enrolment with anything else, which no spec text asks for and 06
/// §3.3 contradicts.
///
/// What the closed wrapper set really refuses for a Public leaf is the two
/// origin-laundering wrappers, and those it refuses for *every* inner call
/// whatever its domain. So this test asserts both halves in one place: the
/// permitted wrappers pass a trading-reward call through, and the denied ones
/// do not.
#[test]
fn a_trading_reward_call_survives_the_permitted_wrappers_and_never_the_denied_ones() {
    use crate::classifier::RuntimeBaseCallFilter;

    for call in every_trading_reward_call() {
        assert!(
            RuntimeBaseCallFilter::contains(&call),
            "a Public leaf must be admissible bare: {call:?}",
        );
        let batched = RuntimeCall::Utility(pallet_utility::Call::batch_all {
            calls: alloc::vec![call.clone()],
        });
        assert!(
            RuntimeBaseCallFilter::contains(&batched),
            "batching a Public leaf is lawful, and 06 §3.3 keeps it that way",
        );
        for laundered in [
            RuntimeCall::Utility(pallet_utility::Call::dispatch_as {
                as_origin: alloc::boxed::Box::new(
                    frame_system::RawOrigin::Signed(account(219)).into(),
                ),
                call: alloc::boxed::Box::new(call.clone()),
            }),
            RuntimeCall::Utility(pallet_utility::Call::as_derivative {
                index: 0,
                call: alloc::boxed::Box::new(call.clone()),
            }),
        ] {
            assert!(
                !RuntimeBaseCallFilter::contains(&laundered),
                "the origin-laundering wrappers are denied wholesale: {laundered:?}",
            );
        }
    }
}

/// **The other axis, which is the one TR6 lost a milestone to.** A call needs a
/// `RuntimeCapabilities::leaf_enabled` answer *and* a 05 §1.4 resource family
/// before a governance decision can carry it, and the two are checked at
/// different stages, so a test on either one alone passes while the call stays
/// dead.
///
/// For this program both answers are "no proposal carries it", and that is the
/// correct answer rather than an omission: the calls are Signed, and a class
/// origin dispatching one would be refused by `ensure_signed` in the pallet
/// body anyway. The point of pinning it is that the *reason* is the domain, not
/// a missing row — `leaf_enabled` admits every `Public` leaf through its
/// generic arm and refuses every privileged one, so if a later change
/// reclassified any of these calls the assertion below would start failing
/// instead of the call silently becoming unreachable.
#[test]
fn no_trading_reward_call_is_privileged_on_either_screening_axis() {
    use crate::classifier::derive_resource_footprint;

    development_ext().execute_with(|| {
        for call in every_trading_reward_call() {
            for class in [
                futarchy_primitives::ProposalClass::Param,
                futarchy_primitives::ProposalClass::Treasury,
                futarchy_primitives::ProposalClass::Code,
                futarchy_primitives::ProposalClass::Meta,
            ] {
                assert!(
                    <crate::configs::RuntimeCapabilities as pallet_execution_guard::Capabilities<
                        RuntimeCall,
                    >>::call_enabled(class, &call),
                    "a Public leaf is capability-admissible for every class: {call:?}",
                );
            }
            // 05 §1.4 T4 screens proposal payloads only, and a Signed call is
            // never one — the same answer `market.buy` gets.
            assert!(
                derive_resource_footprint(core::slice::from_ref(&call)).is_err(),
                "a Signed call must not claim a resource family: {call:?}",
            );
        }
    });
}

/// G-5/I-10: every call declares an explicit origin check, and the check is
/// `ensure_signed`. Root is the origin a misconfigured wrapper would supply.
#[test]
fn every_trading_reward_call_refuses_a_root_origin() {
    use frame_support::dispatch::GetDispatchInfo;
    use sp_runtime::traits::Dispatchable;

    development_ext().execute_with(|| {
        for call in every_trading_reward_call() {
            let _ = call.get_dispatch_info();
            assert_eq!(
                call.clone().dispatch(RuntimeOrigin::root()).map(|_| ()),
                Err(sp_runtime::DispatchError::BadOrigin.into()),
                "{call:?} must declare an explicit Signed origin check",
            );
        }
    });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// Open and seed a decision book on branch `branch` of `PID`, and hand back a
/// funded, enrolled trader.
fn seeded_decision_book(branch: Branch) -> crate::AccountId {
    let pol = crate::configs::pol_account();
    let b = crate::configs::balance_param(b"pol.b.param");
    let headroom = pallet_market::core_market::seed_headroom(b).expect("bounded live POL seed");
    assert_ok!(ForeignAssets::mint_into(usdc_location(), &pol, headroom));
    crate::tests::sync_pol_lines_to_custody();
    assert_ok!(Market::create_market(
        RuntimeOrigin::signed(crate::configs::epoch_account()),
        MARKET,
        BookKind::Decision {
            proposal: PID,
            branch,
        },
        0,
        crate::configs::market_book_account(MARKET),
        crate::configs::market_fee_account(MARKET),
        b,
    ));
    assert_ok!(Market::seed(
        RuntimeOrigin::signed(crate::configs::epoch_account()),
        MARKET,
        pol,
    ));
    enrolled_trader()
}

/// Open and seed a Baseline book for `epoch` (04 §6.1's unbranched degenerate
/// wrapper), and hand back a funded, enrolled trader. Mirrors
/// `seeded_decision_book` exactly, on the Baseline POL custody line rather
/// than the Decision one (`pol_baseline_account`, not `pol_account`).
fn seeded_baseline_book(epoch: futarchy_primitives::EpochId) -> crate::AccountId {
    let pol = crate::configs::pol_baseline_account();
    let b = crate::configs::balance_param(b"pol.b.param");
    let headroom = pallet_market::core_market::seed_headroom(b).expect("bounded live POL seed");
    assert_ok!(ForeignAssets::mint_into(usdc_location(), &pol, headroom));
    crate::tests::sync_pol_lines_to_custody();
    assert_ok!(Market::create_market(
        RuntimeOrigin::signed(crate::configs::epoch_account()),
        BASELINE_MARKET,
        BookKind::Baseline { epoch },
        epoch,
        crate::configs::market_book_account(BASELINE_MARKET),
        crate::configs::market_fee_account(BASELINE_MARKET),
        b,
    ));
    assert_ok!(Market::seed(
        RuntimeOrigin::signed(crate::configs::epoch_account()),
        BASELINE_MARKET,
        pol,
    ));
    enrolled_trader()
}

fn usdc_location() -> crate::AssetId {
    crate::usdc_location()
}

fn enrolled_trader() -> crate::AccountId {
    let trader = account(219);
    assert_ok!(ForeignAssets::mint_into(
        usdc_location(),
        &trader,
        currency::USDC.saturating_mul(50),
    ));
    let bond = TradingRewards::minimum_bond().expect("ledger.pos_dep is seeded at genesis");
    assert_ok!(TradingRewards::enroll(
        RuntimeOrigin::signed(trader.clone()),
        bond.saturating_mul(4),
    ));
    trader
}

fn settle_vault(winner: Branch, score: FixedU64) {
    pallet_conditional_ledger::Vaults::<Runtime>::mutate(PID, |vault| {
        if let Some(vault) = vault {
            vault.state = VaultState::ScalarSettled { winner, s: score };
        }
    });
}

fn settle_baseline(epoch: futarchy_primitives::EpochId, score: FixedU64) {
    use pallet_conditional_ledger::core_ledger::BaselineState;
    pallet_conditional_ledger::BaselineVaults::<Runtime>::mutate(epoch, |vault| {
        if let Some(vault) = vault {
            vault.state = BaselineState::Settled(score);
        }
    });
}

// ---------------------------------------------------------------------------
// The fill accumulator, through a real dispatch
// ---------------------------------------------------------------------------

#[test]
fn an_enrolled_trader_scores_a_real_fill_and_an_outsider_scores_nothing() {
    development_ext().execute_with(|| {
        let trader = seeded_decision_book(Branch::Accept);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        let score = pallet_trading_rewards::Scores::<Runtime>::get(&trader, MARKET)
            .expect("an enrolled trader's fill is scored");
        assert!(score.spent > 0, "the buy leg records what it cost");
        assert_eq!(
            score.book_acquired[0],
            kernel::MIN_TRADE_USDC,
            "the filled quantity lands on the LONG slot",
        );
        assert_eq!(
            pallet_trading_rewards::ScoreCount::<Runtime>::get(&trader),
            1
        );

        // The control: an identical fill by an account that never enrolled.
        let outsider = account(221);
        assert_ok!(ForeignAssets::mint_into(
            usdc_location(),
            &outsider,
            currency::USDC.saturating_mul(10),
        ));
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(outsider.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        assert!(
            pallet_trading_rewards::Scores::<Runtime>::get(&outsider, MARKET).is_none(),
            "the accumulator stops at the enrolment read for a non-participant",
        );
    });
}

/// 08 §2.6 failure behaviour, through a real dispatch: *"records no score and
/// never rejects the trade"*. TR4 proved this at the observer's own boundary
/// with `()` bound to the market; only here does a real `buy` extrinsic carry
/// it, which is the layer at which "never rejects the trade" is a claim about
/// anything.
#[test]
fn a_fill_past_the_scored_market_bound_records_nothing_and_still_trades() {
    // limit-coverage: MaxScoredMarketsPerAccount
    development_ext().execute_with(|| {
        let trader = seeded_decision_book(Branch::Accept);
        // Seat the counter at the 13 §4 bound. Creating 196 real books to get
        // there would measure the market pallet, not this rule.
        pallet_trading_rewards::ScoreCount::<Runtime>::insert(
            &trader,
            pallet_trading_rewards::MAX_SCORED_MARKETS_PER_ACCOUNT,
        );
        let q_long_before = pallet_market::Markets::<Runtime>::get(MARKET)
            .expect("book exists")
            .q_long;

        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));

        assert!(
            pallet_trading_rewards::Scores::<Runtime>::get(&trader, MARKET).is_none(),
            "an over-bound fill records nothing",
        );
        assert_eq!(
            pallet_trading_rewards::ScoreCount::<Runtime>::get(&trader),
            pallet_trading_rewards::MAX_SCORED_MARKETS_PER_ACCOUNT,
            "and it does not push the counter past its bound either",
        );
        assert_eq!(
            pallet_market::Markets::<Runtime>::get(MARKET)
                .expect("book exists")
                .q_long,
            q_long_before.saturating_add(kernel::MIN_TRADE_USDC),
            "the trade itself executed in full",
        );
    });
}

/// **The arm `sell`'s benchmark structurally cannot take** (TR7 review, I3).
///
/// The accumulator has two shapes on a sale. A sale into a market the account
/// already has a score row for reads the row and writes it back — two keys, one
/// write, and that is what the `sell` fixture measures. A **first** fill finds
/// no row and reads `TradingRewards::ScoreCount` as well before deciding
/// whether one may be created — three keys, and because a sale credits only
/// what `book_acquired` covers, it then writes nothing at all. Neither arm
/// dominates the other, so `sell`'s `#[pallet::weight]` composes the missing
/// read and its measured proof bound above the fixture.
///
/// This test pins the premise that makes that composition necessary: the arm is
/// reachable on an ordinary dispatch, by an enrolled account holding units the
/// book never sold it. `external_route_weight_composition_includes_measured_pov_surcharges`
/// pins the charge itself.
#[test]
fn a_first_fill_sale_takes_the_arm_that_reads_the_counter_and_writes_nothing() {
    development_ext().execute_with(|| {
        // The helper's own trader is only here to open and seed the book.
        let _seeder = seeded_decision_book(Branch::Accept);

        // Acquire the units *before* enrolling, so they exist and no score row
        // does. That is the same state a `split` or an inbound position
        // transfer leaves behind, which is precisely what the `book_acquired`
        // rule exists for.
        let trader = account(221);
        assert_ok!(ForeignAssets::mint_into(
            usdc_location(),
            &trader,
            currency::USDC.saturating_mul(50),
        ));
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        assert!(
            pallet_trading_rewards::Scores::<Runtime>::get(&trader, MARKET).is_none(),
            "the outsider's buy must leave no row, or the sale below is not a first fill",
        );

        let bond = TradingRewards::minimum_bond().expect("ledger.pos_dep is seeded at genesis");
        assert_ok!(TradingRewards::enroll(
            RuntimeOrigin::signed(trader.clone()),
            bond.saturating_mul(4),
        ));
        assert!(
            pallet_trading_rewards::Pallet::<Runtime>::scores_fills(&trader),
            "the seller must be on the scoring branch, or the accumulator stops at one read",
        );

        assert_ok!(Market::sell(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            0,
        ));

        assert!(
            pallet_trading_rewards::Scores::<Runtime>::get(&trader, MARKET).is_none(),
            "a sale out of off-book inventory credits nothing and so writes no row — \
             this is the arm that costs a key more and a write less",
        );
        assert_eq!(
            pallet_trading_rewards::ScoreCount::<Runtime>::get(&trader),
            0,
            "and it does not take a slot against the 13 §4 per-account bound either",
        );
    });
}

// ---------------------------------------------------------------------------
// The settlement adapter
// ---------------------------------------------------------------------------

/// The whole point of the TR7 adapter, and the assertion that separates a
/// correct one from the integer reading TR5 froze: a branch settling at any
/// score below par credits **that fraction** of the book-acquired parcel, not
/// zero.
#[test]
fn a_realized_decision_book_settles_at_the_ledgers_own_fraction_of_par() {
    development_ext().execute_with(|| {
        let trader = seeded_decision_book(Branch::Accept);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        let held = pallet_conditional_ledger::Positions::<Runtime>::get(
            PositionId::Proposal {
                proposal: PID,
                branch: Branch::Accept,
                kind: PositionKind::Long,
            },
            &trader,
        );
        assert_eq!(
            held,
            kernel::MIN_TRADE_USDC,
            "the buy really left a position"
        );

        // Three-fifths of par: an integer `settled_value` floors this to zero
        // and folds a debit of the whole notional instead.
        let score = FixedU64(kernel::SCORE_SCALE / 10 * 6);
        settle_vault(Branch::Accept, score);

        let settlement = RuntimeSettledMarkets::settlement(&trader, MARKET)
            .expect("a settled vault on the traded branch is terminal");
        assert_eq!(settlement.disposition, BranchDisposition::Realized);
        assert_eq!(
            settlement.settled_value,
            [
                Balance::from(score.0),
                SETTLED_VALUE_SCALE.saturating_sub(Balance::from(score.0)),
            ],
            "the two legs are `[s, par - s]`, exactly what `redeem_scalar` pays",
        );
        assert!(
            settlement.settled_value[0] < SETTLED_VALUE_SCALE,
            "and this one is strictly sub-par, which is where an integer would read 0",
        );

        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(account(221)),
            trader.clone(),
            MARKET,
        ));
        let record = pallet_trading_rewards::Participants::<Runtime>::get(&trader)
            .expect("the participant record survives the fold");
        assert_eq!(
            record.epoch.received,
            held / 10 * 6,
            "rule 3 credits `book_acquired x 0.6`, rounded down",
        );
        assert!(record.epoch.received > 0);
    });
}

/// **The C1 regression, and 15 §4.1 point 3's redeem-then-fold obligation.**
///
/// 08 §2.6 rule 3 credits `book_acquired` and *"MUST NOT be clamped by the
/// account's ledger position"*. The retired rule read the position at fold
/// time, and `redeem_scalar` burns it. Settlement and redemption open at the
/// same instant — a settled vault is the sole precondition of each — and the
/// fold is a permissionless crank the trader does not control, so a trader who
/// redeemed, which is the ordinary thing to do and the only way to get the
/// money, was folded at `received = 0` against a real `spent` and rule 4's
/// realized arm debited them for a correct forecast.
///
/// **The claim is an equality between two orderings, and asserting that the
/// fold merely succeeded would prove nothing** — under the defect it succeeds,
/// folding a lawful zero. So both orderings are run against identical books and
/// the credited amounts are compared, and the amount is also pinned to the
/// arithmetic so a mutation that zeroed *both* sides could not pass either.
///
/// The `transfer`-out case is the same shape and 08 §2.6 credits it the same
/// way: *"the one disposal it still credits is a transfer out … the score
/// measures the forecast the account's book activity expressed, not the custody
/// it retained"*. Both disposals run here, because they burn the position by
/// different routes and only one of them was in the plan.
///
/// Mutations killed: reinstating any `min(position, book_acquired)` clamp in
/// `on_settle` (the two disposal legs credit 0 against the control's non-zero
/// amount); and re-reading `ConditionalLedger::Positions` in
/// `RuntimeSettledMarkets` for any purpose that reaches the credit.
#[test]
fn a_trader_who_disposes_of_the_position_before_the_fold_is_credited_the_same() {
    /// How the trader parts with the position before the keeper folds.
    ///
    /// **The two disposals sit on opposite sides of settlement, and the ledger
    /// is what puts them there.** `redeem_scalar` needs a settled vault, and
    /// `transfer` is refused once the vault leaves the live set
    /// (`ensure_position_live`, `WrongVaultState`). Both nonetheless reach the
    /// state 08 §2.6 rule 3 is about — the account holds nothing when the fold
    /// runs — which is the point: the credit must not depend on custody at all.
    #[derive(Clone, Copy)]
    enum Disposal {
        /// The control: keep the position, fold, and let the trader redeem
        /// afterwards. This is the ordering the retired clamp was right about.
        None,
        /// Redeem the whole leg the instant settlement opens, then be folded.
        RedeemAfterSettlement,
        /// Send the whole leg to another account while the vault is still live,
        /// then be folded.
        TransferBeforeSettlement,
    }

    const LONG_LEG: PositionId = PositionId::Proposal {
        proposal: PID,
        branch: Branch::Accept,
        kind: PositionKind::Long,
    };

    /// One trader buys `MIN_TRADE_USDC` of LONG on a book that settles at
    /// three-fifths of par, disposes of the position per `disposal`, and is
    /// folded by a third-party keeper. Returns what the fold credited.
    fn credited_after(disposal: Disposal) -> Balance {
        let mut credited = 0;
        development_ext().execute_with(|| {
            let trader = seeded_decision_book(Branch::Accept);
            assert_ok!(Market::buy(
                RuntimeOrigin::signed(trader.clone()),
                MARKET,
                ScalarSide::Long,
                kernel::MIN_TRADE_USDC,
                Balance::MAX,
            ));
            let held = pallet_conditional_ledger::Positions::<Runtime>::get(LONG_LEG, &trader);
            assert_eq!(held, kernel::MIN_TRADE_USDC, "the buy left a real position");
            assert_eq!(
                pallet_trading_rewards::Scores::<Runtime>::get(&trader, MARKET)
                    .expect("the fill was scored")
                    .book_acquired[0],
                held,
                "and the book recorded the same quantity",
            );

            if matches!(disposal, Disposal::TransferBeforeSettlement) {
                // The recipient gains no `book_acquired`, so no second account
                // can ever be credited for these units. It is funded because a
                // new ledger entry takes a `ledger.pos_dep` deposit from the
                // *destination*, not because the score program needs it.
                let recipient = account(222);
                assert_ok!(ForeignAssets::mint_into(
                    usdc_location(),
                    &recipient,
                    currency::USDC.saturating_mul(10),
                ));
                assert_ok!(ConditionalLedger::transfer(
                    RuntimeOrigin::signed(trader.clone()),
                    LONG_LEG,
                    recipient.clone(),
                    held,
                ));
                assert!(
                    pallet_trading_rewards::Scores::<Runtime>::get(&recipient, MARKET).is_none(),
                    "the recipient holds no book entry, so no second credit exists",
                );
            }

            // Three-fifths of par. Settlement and redemption open together.
            settle_vault(Branch::Accept, FixedU64(kernel::SCORE_SCALE / 10 * 6));

            if matches!(disposal, Disposal::RedeemAfterSettlement) {
                assert_ok!(ConditionalLedger::redeem_scalar(
                    RuntimeOrigin::signed(trader.clone()),
                    PID,
                    ScalarSide::Long,
                    held,
                ));
            }

            if matches!(disposal, Disposal::None) {
                assert_eq!(
                    pallet_conditional_ledger::Positions::<Runtime>::get(LONG_LEG, &trader),
                    held,
                    "the control still holds the position at fold time",
                );
            } else {
                assert_eq!(
                    pallet_conditional_ledger::Positions::<Runtime>::get(LONG_LEG, &trader),
                    0,
                    "the disposal really burned the position the clamp used to read",
                );
            }

            // The keeper cranks the fold, as it does in production.
            assert_ok!(TradingRewards::settle_market_score(
                RuntimeOrigin::signed(account(221)),
                trader.clone(),
                MARKET,
            ));
            credited = pallet_trading_rewards::Participants::<Runtime>::get(&trader)
                .expect("the record survives the fold")
                .epoch
                .received;
        });
        credited
    }

    let folded_first = credited_after(Disposal::None);
    assert_eq!(
        folded_first,
        kernel::MIN_TRADE_USDC / 10 * 6,
        "the control is the arithmetic rule 3 states, not merely 'something'",
    );
    assert!(folded_first > 0);

    assert_eq!(
        credited_after(Disposal::RedeemAfterSettlement),
        folded_first,
        "a trader who redeems before the fold is credited exactly as one who \
         redeems after it (08 §2.6 rule 3; 15 §4.1 point 3)",
    );
    assert_eq!(
        credited_after(Disposal::TransferBeforeSettlement),
        folded_first,
        "a transfer out is credited the same way (08 §2.6 rule 3)",
    );
}

#[test]
fn an_annulled_branch_reports_the_annulled_arm_and_reads_no_position() {
    development_ext().execute_with(|| {
        let trader = seeded_decision_book(Branch::Accept);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        // The other branch wins.
        settle_vault(Branch::Reject, FixedU64(kernel::SCORE_SCALE / 2));
        let settlement =
            RuntimeSettledMarkets::settlement(&trader, MARKET).expect("terminal either way");
        assert_eq!(settlement.disposition, BranchDisposition::Annulled);
        assert_eq!(
            settlement.settled_value,
            [0, 0],
            "rule 4's annulled arm discards every credit, so rule 3 never runs",
        );

        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(account(221)),
            trader.clone(),
            MARKET,
        ));
        let record =
            pallet_trading_rewards::Participants::<Runtime>::get(&trader).expect("record survives");
        assert!(
            record.epoch.spent > record.epoch.received,
            "an annulled branch can never pay a reward (04 §6.2 G-3)",
        );
    });
}

#[test]
fn a_voided_proposal_and_an_open_one_report_the_two_non_folding_dispositions() {
    development_ext().execute_with(|| {
        let trader = seeded_decision_book(Branch::Accept);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        // Still Open: not terminal, so the timeout escape governs.
        assert!(RuntimeSettledMarkets::settlement(&trader, MARKET).is_none());
        assert_noop!(
            TradingRewards::settle_market_score(
                RuntimeOrigin::signed(account(221)),
                trader.clone(),
                MARKET,
            ),
            pallet_trading_rewards::Error::<Runtime>::MarketNotSettled,
        );

        pallet_conditional_ledger::Vaults::<Runtime>::mutate(PID, |vault| {
            if let Some(vault) = vault {
                vault.state = VaultState::Voided;
            }
        });
        let settlement = RuntimeSettledMarkets::settlement(&trader, MARKET).expect("terminal");
        assert_eq!(settlement.disposition, BranchDisposition::Void);
        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(account(221)),
            trader.clone(),
            MARKET,
        ));
        let record =
            pallet_trading_rewards::Participants::<Runtime>::get(&trader).expect("record survives");
        assert_eq!(
            record.epoch,
            Default::default(),
            "VOID drops the entry at zero and folds nothing",
        );
    });
}

/// A vault the archive crank already swept has nothing left to value, so the
/// adapter reports `None` and the absolute timeout — not this adapter —
/// disposes of the entry. Reporting anything else would fold a market on a
/// position that no longer exists.
#[test]
fn an_archived_vault_reports_nothing_and_leaves_the_timeout_in_charge() {
    development_ext().execute_with(|| {
        let trader = seeded_decision_book(Branch::Accept);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        pallet_conditional_ledger::Vaults::<Runtime>::remove(PID);
        assert!(RuntimeSettledMarkets::settlement(&trader, MARKET).is_none());
        assert_noop!(
            TradingRewards::settle_market_score(
                RuntimeOrigin::signed(account(221)),
                trader.clone(),
                MARKET,
            ),
            pallet_trading_rewards::Error::<Runtime>::MarketNotSettled,
        );
    });
}

/// A gate leg is all-or-nothing, and the outcome picks which slot is worth par.
/// Both outcomes are exercised so a hardcoded `[par, 0]` cannot pass.
///
/// **The score entry carries a deliberately asymmetric YES/NO parcel and the
/// credited amount is asserted, not only the reported value.** The ordering
/// claim — 04 §6.1 maps LONG to YES, and `market_core::gate_kind` is what the
/// fill accumulator's two `book_acquired` slots actually follow — is exactly
/// what a swap of `gate_values`'s two arms breaks, and it would credit the
/// wrong leg on every gate market. Equal parcels would hide the swap, so the
/// two differ.
///
/// Before 08 §2.6 rule 3 was amended this test held asymmetric *ledger
/// positions* and asserted `settlement.position`. The adapter reads no position
/// now, so the same claim is made one layer down, where it was always the real
/// one: the fold.
#[test]
fn a_gate_book_pays_par_on_the_outcome_side_and_nothing_on_the_other() {
    for (outcome, expected) in [
        (true, [SETTLED_VALUE_SCALE, 0]),
        (false, [0, SETTLED_VALUE_SCALE]),
    ] {
        development_ext().execute_with(|| {
            let trader = enrolled_trader();
            const GATE_MARKET: MarketId = 77_002;
            assert_ok!(ConditionalLedger::create_vault(
                RuntimeOrigin::signed(crate::configs::market_account()),
                PID,
                0,
            ));
            pallet_market::Markets::<Runtime>::insert(
                GATE_MARKET,
                pallet_market::core_market::MarketBook::open(
                    GATE_MARKET,
                    BookKind::Gate {
                        proposal: PID,
                        branch: Branch::Accept,
                        gate: GateType::Survival,
                    },
                    crate::configs::market_book_account(GATE_MARKET),
                    crate::configs::market_fee_account(GATE_MARKET),
                    crate::configs::balance_param(b"pol.b.param"),
                ),
            );
            // Written directly rather than traded into existence, exactly as
            // the market row above is: this test is about the adapter and the
            // fold, not about LMSR mechanics. Asymmetric on purpose — a swap of
            // the two arms is invisible if both parcels match.
            let yes_bought: Balance = currency::USDC.saturating_mul(7);
            let no_bought: Balance = currency::USDC.saturating_mul(3);
            pallet_trading_rewards::Scores::<Runtime>::insert(
                &trader,
                GATE_MARKET,
                trading_rewards_core::MarketScore {
                    book_acquired: [yes_bought, no_bought],
                    ..Default::default()
                },
            );
            pallet_trading_rewards::ScoreCount::<Runtime>::insert(&trader, 1);

            // A settled vault whose gate has no outcome yet is not terminal for
            // this book: it waits rather than folding on a missing value.
            settle_vault(Branch::Accept, FixedU64(kernel::SCORE_SCALE / 2));
            assert!(RuntimeSettledMarkets::settlement(&trader, GATE_MARKET).is_none());

            pallet_conditional_ledger::Vaults::<Runtime>::mutate(PID, |vault| {
                if let Some(vault) = vault {
                    vault.gate_outcomes[0] = Some(outcome);
                }
            });
            let settlement =
                RuntimeSettledMarkets::settlement(&trader, GATE_MARKET).expect("terminal now");
            assert_eq!(settlement.disposition, BranchDisposition::Realized);
            assert_eq!(settlement.settled_value, expected);

            assert_ok!(TradingRewards::settle_market_score(
                RuntimeOrigin::signed(account(221)),
                trader.clone(),
                GATE_MARKET,
            ));
            let credited = pallet_trading_rewards::Participants::<Runtime>::get(&trader)
                .expect("the record survives the fold")
                .epoch
                .received;
            assert_eq!(
                credited,
                if outcome { yes_bought } else { no_bought },
                "slot 0 is the YES parcel and slot 1 is the NO parcel; a swap \
                 of `gate_values`'s arms credits the wrong leg on every gate market",
            );
            assert_ne!(
                credited,
                if outcome { no_bought } else { yes_bought },
                "and the two parcels differ, so the swap is visible",
            );
        });
    }
}

/// The Baseline arm mirrors the Decision arm exactly (04 §6.1's degenerate
/// wrapper: unbranched, but scored and settled the same way) — and nothing
/// exercised it before this test. Replacing its `settled_value` with a
/// hardcoded `[par, 0]` got 485/485 green: every Baseline holder would be
/// credited at par whatever the epoch settled at, the exact defect rule 3 was
/// amended to prevent, one book kind over from where TR7 first found it.
#[test]
fn a_settled_baseline_book_settles_at_the_ledgers_own_fraction_of_par() {
    development_ext().execute_with(|| {
        let trader = seeded_baseline_book(BASELINE_EPOCH);
        assert_ok!(Market::buy(
            RuntimeOrigin::signed(trader.clone()),
            BASELINE_MARKET,
            ScalarSide::Long,
            kernel::MIN_TRADE_USDC,
            Balance::MAX,
        ));
        let held = pallet_conditional_ledger::Positions::<Runtime>::get(
            PositionId::Baseline {
                epoch: BASELINE_EPOCH,
                side: ScalarSide::Long,
            },
            &trader,
        );
        assert_eq!(
            held,
            kernel::MIN_TRADE_USDC,
            "the buy really left a position"
        );

        // Three-fifths of par, the same fraction the Decision test uses, so a
        // hardcoded `[par, 0]` cannot agree by coincidence.
        let score = FixedU64(kernel::SCORE_SCALE / 10 * 6);
        settle_baseline(BASELINE_EPOCH, score);

        let settlement = RuntimeSettledMarkets::settlement(&trader, BASELINE_MARKET)
            .expect("a settled baseline vault is terminal");
        assert_eq!(settlement.disposition, BranchDisposition::Realized);
        assert_eq!(
            settlement.settled_value,
            [
                Balance::from(score.0),
                SETTLED_VALUE_SCALE.saturating_sub(Balance::from(score.0)),
            ],
            "the two legs are `[s, par - s]`, exactly what the baseline \
             redemption pays — not `[par, 0]` regardless of `s`",
        );
        assert!(
            settlement.settled_value[0] < SETTLED_VALUE_SCALE,
            "strictly sub-par, so an always-par mutation cannot pass by accident",
        );

        assert_ok!(TradingRewards::settle_market_score(
            RuntimeOrigin::signed(account(221)),
            trader.clone(),
            BASELINE_MARKET,
        ));
        let record = pallet_trading_rewards::Participants::<Runtime>::get(&trader)
            .expect("the participant record survives the fold");
        assert_eq!(
            record.epoch.received,
            held / 10 * 6,
            "rule 3 credits `book_acquired x 0.6`, rounded down, on the \
             Baseline book exactly as it does on a Decision book",
        );
        assert!(record.epoch.received > 0);
    });
}

// ---------------------------------------------------------------------------
// The treasury funding adapter — and its units trap
// ---------------------------------------------------------------------------

/// **`TotalAccrued` is USDC and the reserve must be VIT.** Reporting the raw
/// figure would under-report the reserve by the whole exchange rate, and the
/// return leg inside `fund_trading_rewards` would sweep VIT that is backing an
/// unclaimed accrual — a claim `claim_rewards` could then not pay.
///
/// The two currencies differ by six decimals *and* by the rate, so the test
/// picks a rate at which the raw and converted figures cannot be confused, and
/// asserts the converted one exactly.
#[test]
fn the_accrual_reserve_is_denominated_in_vit_and_not_in_usdc() {
    use pallet_futarchy_treasury::TradingRewardFunding;

    development_ext().execute_with(|| {
        crate::tests::set_fee_vit_usdc_rate(2_000_000_000);
        let accrued_usdc: Balance = 1_500_000;
        pallet_trading_rewards::TotalAccrued::<Runtime>::put(accrued_usdc);

        let reserve = <crate::configs::RuntimeTradingRewardFunding as TradingRewardFunding<
            crate::AccountId,
        >>::reward_accrual_reserve();
        let expected = TradingRewards::usdc_to_vit(accrued_usdc).expect("the rate is set");
        assert_eq!(reserve, expected);
        assert_ne!(
            reserve, accrued_usdc,
            "the USDC figure is not the VIT figure, which is the whole trap",
        );
        assert!(
            reserve > accrued_usdc,
            "VIT carries twelve decimals against USDC's six, so the converted \
             reserve is far larger and a raw figure would under-reserve",
        );
    });
}

#[test]
fn nothing_accrued_reserves_nothing_and_an_unvaluable_accrual_reserves_everything() {
    use pallet_futarchy_treasury::TradingRewardFunding;
    type Funding = crate::configs::RuntimeTradingRewardFunding;

    development_ext().execute_with(|| {
        // The rate row is unseeded at genesis, so this is the live state.
        assert_eq!(
            <Funding as TradingRewardFunding<crate::AccountId>>::reward_accrual_reserve(),
            0,
            "a program that owes nobody anything must not wedge the return leg",
        );

        pallet_trading_rewards::TotalAccrued::<Runtime>::put(1);
        assert_eq!(
            <Funding as TradingRewardFunding<crate::AccountId>>::reward_accrual_reserve(),
            Balance::MAX,
            "VIT that cannot be valued against a live promise must not leave (G-1)",
        );
    });
}

/// The end-to-end 08 §2.6 cycle through the real adapter: authorize, then
/// authorize again and watch the first budget come home first. TR6 could only
/// test this against a refusing stub.
#[test]
fn a_second_authorization_returns_the_first_budget_before_it_funds() {
    development_ext().execute_with(|| {
        let sovereign = TradingRewards::account_id();
        let pot = crate::genesis::incentives_account();
        let param = pallet_origins::Origin::FutarchyParam;
        let first: Balance = currency::VIT.saturating_mul(1_000);
        let second: Balance = currency::VIT.saturating_mul(400);

        assert_ok!(FutarchyTreasury::fund_trading_rewards(param.into(), first));
        assert_eq!(
            Balances::free_balance(&sovereign),
            first,
            "the authorization really moved VIT out of the pot",
        );
        let pot_after_first = Balances::free_balance(&pot);

        let param = pallet_origins::Origin::FutarchyParam;
        assert_ok!(FutarchyTreasury::fund_trading_rewards(param.into(), second));
        // **One existential deposit stays behind, permanently and on purpose.**
        // The return reads the sovereign's *reducible* balance under
        // `Preservation::Preserve`, so it can never reap the account — and the
        // account it would be reaping is the one custodying every participant's
        // USDC bond. The pallet's own `authorized_budget_usdc` reads the same
        // figure the same way, so the ED is invisible to the budget on both
        // sides rather than being budget nobody can spend.
        let ed = currency::VIT_EXISTENTIAL_DEPOSIT;
        assert_eq!(
            Balances::free_balance(&sovereign),
            second.saturating_add(ed),
            "return-then-fund leaves the new budget plus the ED; fund-then-return \
             would leave the ED alone and no return at all would leave 1,400",
        );
        assert_eq!(
            Balances::free_balance(&pot),
            pot_after_first
                .saturating_add(first)
                .saturating_sub(second)
                .saturating_sub(ed),
        );
    });
}

/// The same cycle with an unclaimed accrual outstanding: the return must leave
/// the VIT that backs it behind. This is the assertion the units trap defeats —
/// with a raw USDC reserve the sovereign is emptied and the claim cannot pay.
#[test]
fn the_return_leaves_behind_the_vit_that_backs_an_unclaimed_accrual() {
    development_ext().execute_with(|| {
        crate::tests::set_fee_vit_usdc_rate(2_000_000_000);
        let sovereign = TradingRewards::account_id();
        let budget: Balance = currency::VIT.saturating_mul(1_000);
        let param = pallet_origins::Origin::FutarchyParam;
        assert_ok!(FutarchyTreasury::fund_trading_rewards(param.into(), budget));

        let accrued_usdc: Balance = 1_500_000;
        pallet_trading_rewards::TotalAccrued::<Runtime>::put(accrued_usdc);
        let reserved = TradingRewards::usdc_to_vit(accrued_usdc).expect("the rate is set");
        assert!(reserved > 0 && reserved < budget);

        // The wind-down: `amount == 0` returns everything returnable.
        let param = pallet_origins::Origin::FutarchyParam;
        assert_ok!(FutarchyTreasury::fund_trading_rewards(param.into(), 0));
        assert_eq!(
            Balances::free_balance(&sovereign),
            reserved.saturating_add(currency::VIT_EXISTENTIAL_DEPOSIT),
            "exactly the VIT backing the accrual stays, plus the un-reapable ED; \
             the rest goes home",
        );
        assert!(
            Balances::free_balance(&sovereign) >= reserved,
            "and the claim it backs is still payable",
        );
    });
}

// ---------------------------------------------------------------------------
// The parameter adapters this runtime binds to the pallet's Config
// ---------------------------------------------------------------------------

/// **A zero `rwd.rate` must arrive at the pallet as `None`, and only the
/// runtime can prove it.** The Config item requires it — absent, malformed *or
/// zero* is the fail-closed state, because a zero rate is the program switched
/// off and must not take a hold (08 §2.6) — and the pallet's mock implements
/// the requirement itself. So `enroll_refuses_a_zero_rate_before_any_hold` in
/// `pallets/trading-rewards/src/tests.rs` asserts the mock's own guard and says
/// nothing about the adapter the chain actually runs, which returned `Some(0)`
/// until this test existed.
///
/// The premise is asserted rather than assumed: zero is inside the registry
/// row's own bounds, so an ordinary amendment reaches it with no governance
/// error at all.
#[test]
fn a_zero_reward_rate_reads_as_off_and_takes_no_bond() {
    development_ext().execute_with(|| {
        let key = pallet_constitution::key16(b"rwd.rate");
        let seeded = pallet_constitution::Params::<Runtime>::get(key)
            .expect("13 §1 seeds rwd.rate at genesis");
        assert_eq!(
            seeded.min,
            pallet_constitution::ParamValue::Perbill(0),
            "zero is the row's lawful floor, so this state is reachable by amendment",
        );
        pallet_constitution::Params::<Runtime>::insert(
            key,
            pallet_constitution::ParamRecord {
                value: pallet_constitution::ParamValue::Perbill(0),
                ..seeded
            },
        );

        assert_eq!(
            <crate::configs::TradingRewardRate as frame_support::traits::Get<Option<u32>>>::get(),
            None,
            "the switched-off program must reach the pallet as the fail-closed state",
        );

        let trader = account(219);
        assert_ok!(ForeignAssets::mint_into(
            usdc_location(),
            &trader,
            currency::USDC.saturating_mul(50),
        ));
        let bond = TradingRewards::minimum_bond().expect("ledger.pos_dep is seeded at genesis");
        let funds = ForeignAssets::balance(usdc_location(), &trader);
        let sovereign = TradingRewards::account_id();
        let held = ForeignAssets::balance(usdc_location(), &sovereign);

        assert_noop!(
            TradingRewards::enroll(
                RuntimeOrigin::signed(trader.clone()),
                bond.saturating_mul(4),
            ),
            pallet_trading_rewards::Error::<Runtime>::RateUnset,
        );
        assert_eq!(
            ForeignAssets::balance(usdc_location(), &trader),
            funds,
            "no hold was taken",
        );
        assert_eq!(
            ForeignAssets::balance(usdc_location(), &sovereign),
            held,
            "and the sovereign custodies nothing it could never pay against",
        );
        assert!(pallet_trading_rewards::Participants::<Runtime>::get(&trader).is_none());
        assert_eq!(
            pallet_trading_rewards::ParticipantCount::<Runtime>::get(),
            0
        );
    });
}

// ---------------------------------------------------------------------------
// The benchmark fixtures' own preconditions
// ---------------------------------------------------------------------------

/// **A fixture hook that silently stops working regenerates a cheaper weight,
/// and no gate can see it.** Both hooks below decide which arm a benchmark
/// measures, and both are opt-in by design so a mock can decline. This runtime
/// cannot decline: if `prime_trade_observer` stopped enrolling, `buy`/`sell`
/// would measure the accumulator's 1-read early exit; if
/// `prime_settled_market` returned `false`, `settle_market_score` would measure
/// the timeout arm instead of the fold. Both are *decreases*, which the
/// growth-only weight-regression gate is structurally blind to, and the drift
/// gate would simply agree with the new lower number.
///
/// So the preconditions are asserted here, in an ordinary test, against exactly
/// the state a benchmark run would build.
#[cfg(feature = "runtime-benchmarks")]
#[test]
fn the_trade_and_settlement_fixtures_really_prime_the_expensive_arms() {
    use crate::configs::RuntimeBenchmarkHelper;
    use pallet_trading_rewards::BenchmarkHelper as RewardHelper;

    development_ext().execute_with(|| {
        let who = account(219);
        <RuntimeBenchmarkHelper as pallet_market::BenchmarkHelper<crate::AccountId>>::prime_trade_observer(&who);
        assert!(
            pallet_trading_rewards::Pallet::<Runtime>::scores_fills(&who),
            "the trade fixture must put its caller on the accumulator's scoring branch",
        );

        assert!(
            <RuntimeBenchmarkHelper as RewardHelper<crate::AccountId>>::prime_settled_market(
                &who, MARKET,
            ),
            "this runtime can build a terminal market and must never decline",
        );
        let settlement = RuntimeSettledMarkets::settlement(&who, MARKET)
            .expect("the primed market must be terminal");
        assert_eq!(
            settlement.disposition,
            BranchDisposition::Realized,
            "the fold arm is the expensive one, and the fixture must reach it",
        );
        // Since 08 §2.6 rule 3 was amended the quantity comes from the score
        // entry — which the benchmark seeds on both slots — so what the fixture
        // has to supply is a value on both legs that is strictly inside the
        // grid: then both multiplications and both floors run.
        assert!(
            settlement.settled_value
                .iter()
                .all(|value| *value > 0 && *value < SETTLED_VALUE_SCALE),
            "both legs sub-par and non-zero, or rule 3 measures half its work",
        );
    });
}
