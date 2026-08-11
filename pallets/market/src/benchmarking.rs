//! FRAME v2 benchmarks for every public market call and internal admin operation.

use crate::*;
use alloc::vec::Vec;
use frame_benchmarking::v2::*;
use frame_support::{
    traits::{fungibles::Mutate, ConstU32, Contains, EnsureOrigin, Get},
    BoundedVec,
};
use frame_system::RawOrigin;
use futarchy_primitives::{
    bounds, kernel, Balance, Branch, EpochId, FixedU64, MarketId, ScalarSide,
};
use market_core::{BookKind, MarketPhase, TwapCumulative, TwapWindow};
use pallet_conditional_ledger::core_ledger::proposal_positions;
use sp_runtime::traits::Saturating;

const UNIT: Balance = 1_000_000;
const B: Balance = 1_000 * UNIT;
// Mid-range settlement score for terminal-latch fixtures (any admissible value).
const SETTLE_SCORE: FixedU64 = FixedU64(500_000_000);
// Keep the synthetic saturation range disjoint from compact mock-runtime ids.
// Production AccountId32 derivation remains canonical for the same ids.
const TRY_STATE_MARKET_ID_BASE: MarketId = 1 << 32;
// Disjoint from both the compact unit-test ids and the try-state saturation
// range, so the POL stand-in never collides with a book under test.
const POL_STAND_IN_MARKET_ID: MarketId = (1 << 32) + (1 << 24);
// Generated benchmark accounts are not necessarily runtime protocol accounts;
// keep the fee leg above the ledger's live position-creation floor.
const TRADE: Balance = 10 * UNIT;

fn fund<T: Config>(who: &T::AccountId, amount: Balance) {
    <T::Collateral as Mutate<T::AccountId>>::mint_into(T::UsdcAssetId::get(), who, amount)
        .expect("benchmark collateral mint succeeds");
}

/// A protocol-classified stand-in for the runtime's `POL` custody account.
/// The seeding treasury must be one: the 08 §8 step 5(b) return pays the seed
/// back to it, and that surface admits protocol custody only (03 §5.3a). The
/// canonical market namespace is permanently protocol-classified — before
/// creation and after reap — so a book address outside the ids under test is
/// the one such account a `T: Config`-generic fixture can name.
fn pol_stand_in<T: Config>() -> T::AccountId {
    T::MarketAccounts::book(POL_STAND_IN_MARKET_ID)
}

fn admin_origin<T: Config>() -> T::RuntimeOrigin {
    T::MarketAdmin::try_successful_origin().expect("benchmark MarketAdmin origin exists")
}

fn seeded_decision<T: Config>(market: MarketId) -> (T::AccountId, T::AccountId, T::AccountId) {
    let book = T::MarketAccounts::book(market);
    let fees = T::MarketAccounts::fees(market);
    let treasury = pol_stand_in::<T>();
    fund::<T>(&book, 10_000 * UNIT);
    fund::<T>(&fees, 10_000 * UNIT);
    fund::<T>(&treasury, 10_000 * UNIT);
    // The seed debits the subsidy budget line by the cash that leaves custody
    // (I-33), so the line must carry it before the measured call runs.
    <T as Config>::BenchmarkHelper::prime_pol_custody(PolLine::Proposal, 10_000 * UNIT);
    Pallet::<T>::create_market(
        admin_origin::<T>(),
        market,
        BookKind::Decision {
            proposal: market,
            branch: Branch::Accept,
        },
        0,
        book.clone(),
        fees.clone(),
        B,
    )
    .expect("benchmark market creation succeeds");
    Pallet::<T>::seed(admin_origin::<T>(), market, treasury.clone())
        .expect("benchmark seeding succeeds");
    (book, fees, treasury)
}

/// A seeded **Baseline** book (SQ-520).
///
/// `buy` and `sweep_revenue` each carry **one** weight across all three book
/// kinds, so 15 §4.5 requires their fixtures to be the *heaviest* kind, not a
/// representative one. Before this helper existed the harness could only build
/// decision books, so the Baseline arm of both calls was unmeasured — and after
/// SQ-519 gave `buy_baseline` two extra fee-segregation transfers, the
/// regenerated file still showed no change, because the fixture could not reach
/// them. This helper is what makes the comparison possible; the measured
/// outcome is recorded at each `#[benchmark]` below.
///
/// 04 §8.2's wrapper degenerates here: no mirror leg, and a two-instrument
/// vault instead of the proposal universe's fourteen.
///
/// Deliberately retained while unused. It is the *comparison* arm: a fixture
/// selects one kind, so the losing kind's builder is dead by construction, and
/// deleting it is exactly what left the Baseline path unmeasured across three
/// book kinds until SQ-520. Re-point `buy` or `sweep_revenue` at it to re-check
/// the worst case whenever either wrapper changes shape.
#[allow(dead_code)]
fn seeded_baseline<T: Config>(
    market: MarketId,
    epoch: EpochId,
) -> (T::AccountId, T::AccountId, T::AccountId) {
    let book = T::MarketAccounts::book(market);
    let fees = T::MarketAccounts::fees(market);
    let treasury = pol_stand_in::<T>();
    fund::<T>(&book, 10_000 * UNIT);
    fund::<T>(&fees, 10_000 * UNIT);
    fund::<T>(&treasury, 10_000 * UNIT);
    // 08 §4.3: a Baseline book is funded from `POL_BASELINE`, a different line
    // from the proposal books', and the seed debits it by the cash that leaves
    // custody (I-33) plus the 03 §7 R-4 `min_balance` endowment.
    <T as Config>::BenchmarkHelper::prime_pol_custody(PolLine::Baseline, 10_000 * UNIT);
    Pallet::<T>::create_market(
        admin_origin::<T>(),
        market,
        BookKind::Baseline { epoch },
        epoch,
        book.clone(),
        fees.clone(),
        B,
    )
    .expect("benchmark baseline market creation succeeds");
    Pallet::<T>::seed(admin_origin::<T>(), market, treasury.clone())
        .expect("benchmark baseline seeding succeeds");
    (book, fees, treasury)
}

/// Drive a proposal vault to **`Voided`** and latch the market-side
/// observation (SQ-520).
///
/// The `Voided` terminal is what makes a decision book's sweep heaviest: under
/// D-1 every branch pays ½, so the fee account holds a *paying* position on
/// **both** branches and `withdraw_fees` performs two `do_redeem_void`
/// operations where the scalar-settled fixture performs one winning-branch
/// redemption and discards the loser.
fn void_and_latch<T: Config>(proposal: u64) {
    let resolve_origin =
        <T as pallet_conditional_ledger::Config>::ResolveAuthority::try_successful_origin()
            .expect("benchmark resolve authority origin exists");
    pallet_conditional_ledger::Pallet::<T>::void(resolve_origin, proposal)
        .expect("benchmark vault void succeeds");
    Pallet::<T>::observe_proposal_terminal(proposal)
        .expect("benchmark terminal observation succeeds");
}

/// Settle an epoch's Baseline vault and latch the market-side observation
/// (SQ-520), the Baseline counterpart of [`settle_and_latch`].
///
/// Retained unused for the same reason as [`seeded_baseline`]: it is the other
/// half of the Baseline comparison arm, and a fixture can only select one
/// terminal.
#[allow(dead_code)]
fn settle_baseline_and_latch<T: Config>(epoch: EpochId) {
    let settle_origin =
        <T as pallet_conditional_ledger::Config>::SettleAuthority::try_successful_origin()
            .expect("benchmark settle authority origin exists");
    pallet_conditional_ledger::Pallet::<T>::settle_baseline(settle_origin, epoch, SETTLE_SCORE)
        .expect("benchmark baseline settlement succeeds");
    Pallet::<T>::observe_baseline_terminal(epoch)
        .expect("benchmark baseline terminal observation succeeds");
}

/// Drive a proposal vault to its scalar-settled terminal through the production
/// authorities and latch the market-side observation, releasing the POL
/// obligation exactly as `pallet-epoch` does (04 §2 "Reap interleavings").
fn settle_and_latch<T: Config>(proposal: u64) {
    let resolve_origin =
        <T as pallet_conditional_ledger::Config>::ResolveAuthority::try_successful_origin()
            .expect("benchmark resolve authority origin exists");
    pallet_conditional_ledger::Pallet::<T>::resolve(resolve_origin, proposal, Branch::Accept)
        .expect("benchmark vault resolution succeeds");
    let settle_origin =
        <T as pallet_conditional_ledger::Config>::SettleAuthority::try_successful_origin()
            .expect("benchmark settle authority origin exists");
    pallet_conditional_ledger::Pallet::<T>::settle_scalar(settle_origin, proposal, SETTLE_SCORE)
        .expect("benchmark vault settlement succeeds");
    Pallet::<T>::observe_proposal_terminal(proposal)
        .expect("benchmark terminal observation succeeds");
}

#[benchmarks]
mod benchmarks {
    use super::*;

    /// One weight covers all three book kinds, so this fixture must be the
    /// heaviest of them (15 §4.5), not a representative one (SQ-520).
    ///
    /// **Measured at 50x20: the decision book is the worst case, by a wide
    /// margin.** Re-pointing this fixture at `seeded_baseline` moves every
    /// block-bounding dimension sharply *down* — proof_size 108,804 -> 16,632
    /// (-84.7 %), reads 77 -> 29, writes 67 -> 19, ref_time -55 %. The decision
    /// wrapper walks the proposal vault's fourteen-instrument universe
    /// (`Positions` r:42 w:42, `PositionTotals` r:14 w:14) and posts the mirror
    /// credit; 04 §8.2's Baseline wrapper degenerates to a two-instrument vault
    /// with no mirror leg, so even after SQ-519 added its two fee-segregation
    /// transfers it stays far below. That is why SQ-519's regeneration showed
    /// no storage change: the delta was real but three orders of magnitude
    /// below the fixture that sets the weight. `seeded_baseline` is retained so
    /// this stays a measurement — re-point and re-run whenever either wrapper
    /// changes shape.
    ///
    /// **The trader is primed into the observer's program, and that is not
    /// cosmetic** (TR7). The 08 §2.6 fill accumulator's first act is one read
    /// answering "is this trader enrolled", and a non-participant stops there.
    /// So a fixture that trades as an outsider measures 1 read where a real
    /// worst-case fill costs 3 reads and 2 writes, the figure changes, and the
    /// drift gate goes green on it — `buy` carries no fitted component, so
    /// nothing downstream re-checks it at a higher fidelity. This fixture takes
    /// the expensive arm on both counts: enrolled, and filling into a market
    /// with no score row yet, which is what pays the third read and the second
    /// write.
    #[benchmark]
    fn buy() {
        let caller: T::AccountId = whitelisted_caller();
        fund::<T>(&caller, 10_000 * UNIT);
        <T as Config>::BenchmarkHelper::prime_trade_observer(&caller);
        seeded_decision::<T>(1);
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            ScalarSide::Long,
            TRADE,
            Balance::MAX,
        );
        assert_eq!(Markets::<T>::get(1).expect("book exists").q_long, TRADE);
    }

    /// **A sell cannot reach `buy`'s 3-read/2-write arm, and the reason is
    /// structural rather than a fixture choice** (TR7). The accumulator credits
    /// a sale only for the part covered by `book_acquired`, and `book_acquired`
    /// lives in the score row itself — so a sale into a market with no row
    /// credits nothing, compares unchanged, and writes nothing. Every sale that
    /// writes is therefore a sale into a market that is *already* scored, which
    /// is 2 reads and 1 write, and that is what the setup buy below arranges.
    ///
    /// The one arm this misses is a first-fill sale (3 reads, 0 writes: the
    /// absent row makes the accumulator read the per-account counter as well).
    /// It is not the maximum — it does no write at all, so it is cheaper in
    /// ref_time — but it does touch one key more. The two arms are therefore
    /// incomparable by a single measurement, and this fixture takes the one
    /// that mutates.
    ///
    /// **The key the other arm touches is charged rather than described.** A
    /// comment naming an under-declared key is not a resolution: PoV is the
    /// scarce resource on a parachain and this is the hottest extrinsic on the
    /// chain. `sell`'s `#[pallet::weight]` therefore composes one read and
    /// `FIRST_FILL_SCORE_PROOF_SURCHARGE` — `TradingRewards::ScoreCount`'s
    /// measured `MaxEncodedLen` proof bound, taken off the generated `buy`
    /// annotation — above this fixture, so the declared envelope dominates both
    /// arms. `external_route_weight_composition_includes_measured_pov_surcharges`
    /// fails if that composition is removed.
    #[benchmark]
    fn sell() {
        let caller: T::AccountId = whitelisted_caller();
        fund::<T>(&caller, 10_000 * UNIT);
        <T as Config>::BenchmarkHelper::prime_trade_observer(&caller);
        seeded_decision::<T>(1);
        Pallet::<T>::buy(
            RawOrigin::Signed(caller.clone()).into(),
            1,
            ScalarSide::Long,
            TRADE,
            Balance::MAX,
        )
        .expect("benchmark buy succeeds");
        #[extrinsic_call]
        _(
            RawOrigin::Signed(caller.clone()),
            1,
            ScalarSide::Long,
            TRADE,
            0,
        );
        assert_eq!(Markets::<T>::get(1).expect("book exists").q_long, 0);
    }

    #[benchmark]
    fn crank_observe() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_decision::<T>(1);
        let now = frame_system::Pallet::<T>::block_number();
        frame_system::Pallet::<T>::set_block_number(now.saturating_add(100u32.into()));
        <T as Config>::BenchmarkHelper::prime_keeper_rebate();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1);
        <T as Config>::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
        assert!(
            Markets::<T>::get(1)
                .expect("book exists")
                .last_observed_block
                > 0
        );
    }

    /// The 04 §2 Sweep worst case: a **`Voided`** decision book whose inventory
    /// is unbalanced (SQ-520).
    ///
    /// This fixture measured the *settled* terminal until SQ-520, and that
    /// understated the call. The two legs move in opposite directions and only
    /// one of them dominates:
    ///
    /// * **Book leg** — comparable either way. `withdraw_settled_scalar` runs a
    ///   paired redemption, the floored residual legs and the branch-USDC par
    ///   leg; `withdraw_voided` runs a merge, the residual legs and the merged
    ///   branch-USDC leg. Roughly four ledger operations each.
    /// * **Fee leg** — strictly heavier under `Voided`, and this is the whole
    ///   of the difference. Under D-1 every branch pays ½, so the fee account
    ///   holds a *paying* position on **both** branches and `withdraw_fees`
    ///   performs two `do_redeem_void` operations. The settled arm redeems the
    ///   winning branch once and discards the loser as provably worthless.
    ///
    /// **Measured at 50x20, the cost lands entirely in execution time:**
    /// ref_time 773,310,000 -> 857,390,000 (+10.9 %), while reads (72), writes
    /// (55) and estimated PoV (72,866) are *identical* on both terminals. Worth
    /// stating precisely, because the review that raised this described the
    /// committed weight as omitting the second redemption "outright" — true of
    /// ref_time, but not of the storage dimensions, which the settled fixture
    /// already covered. Both paths touch the same fixed instrument universe;
    /// only the work done over it differs.
    ///
    /// The Baseline arm is lighter than both — a two-instrument vault settling
    /// through a single `do_redeem_baseline_pair` — so it is not the fixture.
    /// Staging un-recycled branch-USDC while the vault is still Open keeps the
    /// par-redemption path in the measurement (04 §6.3).
    #[benchmark]
    fn sweep_revenue() {
        let caller: T::AccountId = whitelisted_caller();
        let trader: T::AccountId = account("trader", 0, 0);
        fund::<T>(&trader, 10_000 * UNIT);
        let (book, _, _) = seeded_decision::<T>(1);
        // Un-recycled branch-USDC is the one leg ordinary flow clears (04 §6.3);
        // stage it while the vault is still Open so the measured sweep also
        // drives the par redemption path.
        pallet_conditional_ledger::Pallet::<T>::do_split(
            RawOrigin::Signed(Pallet::<T>::account_id()).into(),
            1,
            book.clone(),
            kernel::MIN_SPLIT_USDC,
        )
        .expect("benchmark branch-USDC stage succeeds");
        Pallet::<T>::buy(
            RawOrigin::Signed(trader.clone()).into(),
            1,
            ScalarSide::Long,
            TRADE,
            Balance::MAX,
        )
        .expect("benchmark buy succeeds");
        Pallet::<T>::close(admin_origin::<T>(), 1).expect("benchmark close succeeds");
        void_and_latch::<T>(1);
        <T as Config>::BenchmarkHelper::prime_keeper_rebate();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1);
        <T as Config>::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
        assert!(SweptMarkets::<T>::contains_key(1));
    }

    #[benchmark]
    fn reap() {
        let caller: T::AccountId = whitelisted_caller();
        seeded_decision::<T>(1);
        Pallet::<T>::close(admin_origin::<T>(), 1).expect("benchmark close succeeds");
        // The archive delay anchors at the ledger terminal marker, not ClosedAt
        // (04 §2): drive the shared vault to its scalar-settled terminal through
        // the production authorities and latch the market-side settlement
        // observation so the POL obligation is released before the book ages.
        settle_and_latch::<T>(1);
        // 04 §2 also makes the Sweep stage a precondition of reap; run it here
        // so the measured call is the discard of the worthless residue alone.
        Pallet::<T>::sweep_revenue(RawOrigin::Signed(caller.clone()).into(), 1)
            .expect("benchmark sweep succeeds");
        let market = Markets::<T>::get(1).expect("benchmark book exists");
        // Saturate the bounded protocol-inventory cleanup: two owners across all
        // 14 proposal instruments. These writes are setup, while the measured
        // reap must read and remove every cell plus its aggregate total.
        for id in proposal_positions(1) {
            pallet_conditional_ledger::Positions::<T>::insert(id, &market.account, 1);
            pallet_conditional_ledger::Positions::<T>::insert(id, &market.fees_account, 1);
            pallet_conditional_ledger::PositionTotals::<T>::insert(id, 2);
        }
        let now = frame_system::Pallet::<T>::block_number();
        frame_system::Pallet::<T>::set_block_number(
            now.saturating_add(<T as Config>::ArchiveDelay::get())
                .saturating_add(1u32.into()),
        );
        <T as Config>::BenchmarkHelper::prime_keeper_rebate();
        #[extrinsic_call]
        _(RawOrigin::Signed(caller.clone()), 1);
        <T as Config>::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::General,
        );
        assert!(!Markets::<T>::contains_key(1));
    }

    #[benchmark]
    fn freeze_creation() -> Result<(), BenchmarkError> {
        let origin = <T as Config>::EmergencyPlaybookOrigin::try_successful_origin()
            .map_err(|_| BenchmarkError::Stop("EmergencyPlaybook origin unavailable"))?;
        let expiry = frame_system::Pallet::<T>::block_number()
            .saturating_add(kernel::MIN_EPOCH_LENGTH_BLOCKS.into());
        #[extrinsic_call]
        _(origin as T::RuntimeOrigin, expiry);
        assert_eq!(CreationFrozenUntil::<T>::get(), Some(expiry));
        Ok(())
    }

    #[benchmark]
    fn set_frozen() -> Result<(), BenchmarkError> {
        let origin = <T as Config>::EmergencyPlaybookOrigin::try_successful_origin()
            .map_err(|_| BenchmarkError::Stop("EmergencyPlaybook origin unavailable"))?;
        #[extrinsic_call]
        _(origin as T::RuntimeOrigin, true);
        assert!(FrozenUntil::<T>::get().is_some());
        Ok(())
    }

    #[benchmark]
    fn create_market() {
        let book = T::MarketAccounts::book(1);
        let fees = T::MarketAccounts::fees(1);
        #[block]
        {
            Pallet::<T>::create_market(
                admin_origin::<T>(),
                1,
                BookKind::Decision {
                    proposal: 1,
                    branch: Branch::Accept,
                },
                0,
                book,
                fees,
                B,
            )
            .expect("benchmark market creation succeeds");
        }
        assert!(Markets::<T>::contains_key(1));
    }

    #[benchmark]
    fn seed() {
        let book = T::MarketAccounts::book(1);
        let fees = T::MarketAccounts::fees(1);
        let treasury = pol_stand_in::<T>();
        fund::<T>(&book, 10_000 * UNIT);
        fund::<T>(&fees, 10_000 * UNIT);
        fund::<T>(&treasury, 10_000 * UNIT);
        <T as Config>::BenchmarkHelper::prime_pol_custody(PolLine::Proposal, 10_000 * UNIT);
        Pallet::<T>::create_market(
            admin_origin::<T>(),
            1,
            BookKind::Decision {
                proposal: 1,
                branch: Branch::Accept,
            },
            0,
            book,
            fees,
            B,
        )
        .expect("benchmark market creation succeeds");
        #[block]
        {
            Pallet::<T>::seed(admin_origin::<T>(), 1, treasury)
                .expect("benchmark seeding succeeds");
        }
    }

    #[benchmark]
    fn close() {
        seeded_decision::<T>(1);
        #[block]
        {
            Pallet::<T>::close(admin_origin::<T>(), 1).expect("benchmark close succeeds");
        }
        assert!(matches!(
            Markets::<T>::get(1).expect("book exists").phase,
            MarketPhase::Closed
        ));
    }

    #[benchmark]
    fn try_state() -> Result<(), BenchmarkError> {
        seeded_decision::<T>(1);
        frame_system::Pallet::<T>::set_block_number(10_000_u32.into());
        let now = frame_system::Pallet::<T>::block_number();
        let vault_template = pallet_conditional_ledger::Vaults::<T>::get(1)
            .expect("benchmark proposal vault exists");
        let mut template = Markets::<T>::get(1).expect("benchmark book exists");
        template.phase = MarketPhase::Closed;
        Markets::<T>::insert(1, template.clone());
        ClosedAt::<T>::insert(1, now);
        SettlementObservedAt::<T>::insert(1, now);
        pallet_conditional_ledger::VaultTerminalAt::<T>::insert(1, now);
        ActiveMarketCount::<T>::put(0);
        LivePolCommitments::<T>::kill();
        // Book 1's vault is deliberately RETAINED. It used to be removed here to
        // stand for an already-archived vault, but book 1 is seeded and carries no
        // 04 §2 swept marker, and the ordering guard added with the
        // `MarketSweepStatus` seam makes "seeded, unswept, vault archived"
        // unreachable on-chain — the dust sweep now refuses while a seeded book is
        // unswept. A benchmark fixture that builds state the runtime cannot reach
        // measures a scan that cannot happen, so the removal is dropped rather
        // than the invariant weakened. The vault-absent branch is still measured:
        // the 2,239 bulk books below are swept *and* keep settled vaults, which is
        // the archive's real resting state and the heavier scan of the two.
        RerunSeededMarkets::<T>::insert(1, ());

        // `try_state` has no dispatch parameter, so its benchmark fixture must
        // itself saturate every bounded map it scans. It retains 2,240 books and
        // 4,480 distinct ownership-index accounts, while 196 active books carry
        // full checkpoint/window/owner vectors (including the bounded quadratic
        // duplicate-owner check), seed/rerun markers and the full POL vector.
        // The remaining books are seeded/rerun/swept terminal archives,
        // maximizing both unbounded-map scans under their Markets-derived bound
        // — including the I-33 book-half return check, which is only reached for
        // a book that carries the 04 §2 swept marker.
        let seed_funder: T::AccountId = account("treasury", 0, 0);
        let mut settled_vault = vault_template;
        settled_vault.state = futarchy_primitives::VaultState::ScalarSettled {
            winner: Branch::Accept,
            s: SETTLE_SCORE,
        };
        let mut commitments =
            BoundedVec::<(MarketId, Balance), ConstU32<{ bounds::MAX_LIVE_MARKETS }>>::default();
        for offset in 0..u64::from(bounds::MAX_STORED_MARKETS).saturating_sub(1) {
            let id = TRY_STATE_MARKET_ID_BASE.saturating_add(offset);
            let book_account = T::MarketAccounts::book(id);
            let fees_account = T::MarketAccounts::fees(id);
            let mut book = template.clone();
            book.id = id;
            book.kind = BookKind::Decision {
                proposal: id,
                branch: Branch::Accept,
            };
            book.account = book_account.clone();
            book.fees_account = fees_account.clone();
            let active = offset < u64::from(bounds::MAX_LIVE_MARKETS);
            if active {
                book.phase = MarketPhase::Trading;
            }
            Markets::<T>::insert(id, book);
            MarketProtocolAccounts::<T>::insert(book_account, 1);
            MarketProtocolAccounts::<T>::insert(fees_account, 1);
            ProposalMarketIds::<T>::try_mutate(id, |ids| {
                ids.try_push(id).map_err(|_| "proposal market id fits")
            })
            .expect("one market id fits the proposal bound");
            SeededMarkets::<T>::insert(id, seed_funder.clone());
            RerunSeededMarkets::<T>::insert(id, ());
            if active {
                pallet_conditional_ledger::Vaults::<T>::insert(id, vault_template);
                let original_b = template.b.checked_div(2).expect("benchmark b is even");
                let commitment = market_core::seed_headroom(original_b)
                    .expect("benchmark b is in the LMSR domain")
                    .checked_mul(2)
                    .expect("rerun commitment fits Balance");
                commitments
                    .try_push((id, commitment))
                    .expect("active commitment fits the live bound");
                let windows: Vec<_> = (0..bounds::MAX_TWAP_WINDOWS_PER_MARKET)
                    .map(|window| {
                        let start = window.saturating_mul(3).saturating_add(1);
                        TwapWindow {
                            start,
                            trailing_start: start.saturating_add(1),
                            end: start.saturating_add(2),
                            observations: 0,
                            stale_events: 0,
                            contest_capital_blocks: 0,
                            contest_accrued_until: start.saturating_add(2),
                            contest_valid: true,
                            close_spot: Some(FixedU64(500_000_000)),
                            sealed: true,
                        }
                    })
                    .collect();
                let checkpoints: Vec<_> = windows
                    .iter()
                    .map(|window| (window.end, TwapCumulative::ZERO))
                    .collect();
                let owners: Vec<_> = (0..bounds::MAX_LIVE_PROPOSALS)
                    .flat_map(|owner| {
                        windows.iter().map(move |window| {
                            (
                                u64::from(owner),
                                window.start,
                                window.trailing_start,
                                window.end,
                            )
                        })
                    })
                    .collect();
                TwapCheckpoints::<T>::insert(id, BoundedVec::truncate_from(checkpoints));
                DecisionWindows::<T>::insert(id, BoundedVec::truncate_from(windows));
                DecisionWindowOwners::<T>::insert(id, BoundedVec::truncate_from(owners));
            } else {
                ClosedAt::<T>::insert(id, now);
                SettlementObservedAt::<T>::insert(id, now);
                pallet_conditional_ledger::VaultTerminalAt::<T>::insert(id, now);
                // Swept-but-not-yet-reapable is the archive's normal resting
                // state: the sweep is permissionless while reap still waits out
                // `ledger.archive_delay`. Give each one a settled vault so the
                // measured scan actually runs the I-33 return check rather than
                // short-circuiting on an already-archived vault.
                pallet_conditional_ledger::Vaults::<T>::insert(id, settled_vault);
                SweptMarkets::<T>::insert(id, ());
            }
        }
        LivePolCommitments::<T>::put(commitments);
        ActiveMarketCount::<T>::put(bounds::MAX_LIVE_MARKETS);
        T::PolCommitmentSync::sync_pol_commitments()
            .expect("benchmark POL mirror accepts the saturated commitment set");

        // N7 adds a second independently bounded partition to every scan above.
        // Populate it through the real pair constructor/seed/window APIs so the
        // measured fixture includes all 64 pair rows, 128 live external books,
        // their service-ledger vaults and their ownership/window indexes.
        <T as Config>::BenchmarkHelper::prime_external_capacity();
        let external_origin = T::ExternalMarketAdmin::try_successful_origin()
            .map_err(|_| BenchmarkError::Stop("benchmark external-client origin unavailable"))?;
        let external_client = T::ExternalMarketAdmin::ensure_origin(external_origin.clone())
            .map_err(|_| BenchmarkError::Stop("benchmark external-client origin unresolved"))?;
        let external_funder = <T as Config>::BenchmarkHelper::external_funder();
        assert!(!<T as Config>::ReservedProtocolDestinations::contains(
            &external_funder
        ));
        assert!(!T::ProtocolAccounts::contains(&external_funder));
        assert!(!T::ServiceLedger::is_local_protocol_account(
            &external_funder
        ));
        fund::<T>(&external_funder, 1_000_000 * UNIT);
        for offset in 0..bounds::MAX_EXTERNAL_BOOK_PAIRS {
            let question =
                kernel::SERVICE_ID_BASE.saturating_add(u64::from(offset).saturating_mul(3));
            let accept = question.saturating_add(1);
            let reject = question.saturating_add(2);
            Pallet::<T>::create_external_pair(
                external_origin.clone(),
                ExternalPairInput {
                    question,
                    client: external_client,
                    funder: external_funder.clone(),
                    accept,
                    accept_account: T::MarketAccounts::book(accept),
                    accept_fees: T::MarketAccounts::fees(accept),
                    reject,
                    reject_account: T::MarketAccounts::book(reject),
                    reject_fees: T::MarketAccounts::fees(reject),
                    b: B,
                },
            )
            .map_err(|_| BenchmarkError::Stop("benchmark external pair creation failed"))?;
            Pallet::<T>::seed_external_pair(
                external_origin.clone(),
                question,
                external_funder.clone(),
            )
            .map_err(|_| BenchmarkError::Stop("benchmark external pair seed failed"))?;
            for market in [accept, reject] {
                Pallet::<T>::register_decision_window(
                    external_origin.clone(),
                    market,
                    question,
                    10_000,
                    10_001,
                    10_002,
                )
                .map_err(|_| {
                    BenchmarkError::Stop("benchmark external window registration failed")
                })?;
            }
        }

        assert_eq!(Markets::<T>::count(), bounds::MAX_ALL_STORED_MARKETS);
        assert_eq!(
            MarketProtocolAccounts::<T>::count(),
            bounds::MAX_ALL_STORED_MARKETS.saturating_mul(2),
        );
        assert_eq!(
            SeededMarkets::<T>::iter_keys().count(),
            bounds::MAX_ALL_STORED_MARKETS as usize
        );
        assert_eq!(
            RerunSeededMarkets::<T>::iter_keys().count(),
            bounds::MAX_STORED_MARKETS as usize,
        );
        assert_eq!(
            SweptMarkets::<T>::iter_keys().count(),
            bounds::MAX_STORED_MARKETS
                .saturating_sub(bounds::MAX_LIVE_MARKETS)
                .saturating_sub(1) as usize,
        );
        assert_eq!(
            LivePolCommitments::<T>::get().len(),
            bounds::MAX_LIVE_MARKETS as usize,
        );
        assert_eq!(
            ExternalBookPairs::<T>::count(),
            bounds::MAX_EXTERNAL_BOOK_PAIRS
        );
        assert_eq!(
            ActiveExternalMarketCount::<T>::get(),
            bounds::MAX_LIVE_EXTERNAL_MARKETS
        );
        assert_eq!(
            StoredExternalMarketCount::<T>::get(),
            bounds::MAX_STORED_EXTERNAL_MARKETS
        );
        #[block]
        {
            Pallet::<T>::do_try_state().expect("benchmark try-state succeeds");
        }
        Ok(())
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
