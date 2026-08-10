#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! # `pallet-trading-rewards` — the incentive pot's delivery mechanism (TR3)
//!
//! A FRAME shell over [`trading_rewards_core`]. A participant locks a USDC
//! bond and opens a record; the book scores their fills (TR4); folding and
//! epoch settlement apply the reward or the debit (TR5); the accrued USDC
//! figure converts to VIT once, at claim.
//!
//! Spec: architecture [08](../../../docs/architecture/08-treasury-and-economics.md)
//! §2.6 is the owning section. Bonds, the snapshot rule and the withdrawal gate
//! are its *"two rules make the bond a real backstop"* paragraph.
//!
//! **The earning cap is not the anti-farm defense.** It bounds one account's
//! per-epoch exposure and makes program cost predictable. The anti-farm
//! invariant is delivered by the rate coupling `rwd.rate <= 2 x mkt.fee / 0.99`,
//! which is screened at the amendment boundary; the cap is proportional to each
//! account's own bond, and one wash operator funds both accounts, so it cannot
//! deliver it.

extern crate alloc;

pub use pallet::*;
pub use trading_rewards_core;
pub use weights::WeightInfo;

pub mod weights;

#[cfg(feature = "runtime-benchmarks")]
mod benchmarking;
#[cfg(test)]
mod mock;
#[cfg(test)]
mod tests;

use futarchy_primitives::{Balance, EpochId};

/// 13 §4 bound on the enrolled participant roster. The value is derived from
/// the sibling allocation pot's lifetime bound rather than restated here.
pub const MAX_PARTICIPANTS: u32 = futarchy_primitives::bounds::MAX_TRADING_REWARD_PARTICIPANTS;

/// 13 §4 bound on one account's unfolded score entries. 08 §2.6 fixes the
/// anchor: it is `MaxLiveMarkets`, "because a score row tracks an open book",
/// and `MaxPositionsPerAccount` "is the wrong anchor and MUST NOT be used".
/// Derived from the same constant `pallet-market` bounds itself with, so the
/// two cannot drift.
pub const MAX_SCORED_MARKETS_PER_ACCOUNT: u32 = futarchy_primitives::bounds::MAX_LIVE_MARKETS;

/// `FixedU64`'s fixed-point divisor. `fee.vit_usdc_rate` is a 13 §1 `Fixed`
/// row in USDC per VIT, so its stored integer is the rate times this.
const FIXED_DIV: u128 = 1_000_000_000;

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    #[cfg(any(feature = "try-runtime", test))]
    use alloc::collections::BTreeMap;
    use frame_support::traits::{
        fungible::{Inspect as InspectNative, Mutate as MutateNative},
        fungibles::{Inspect as InspectAsset, Mutate as MutateAsset},
        tokens::{Fortitude, Preservation},
    };
    use frame_support::{pallet_prelude::*, PalletId};
    use frame_system::pallet_prelude::*;
    use sp_runtime::traits::{AccountIdConversion, UniqueSaturatedInto};
    #[cfg(any(feature = "try-runtime", test))]
    use sp_runtime::TryRuntimeError;
    use trading_rewards_core::{
        BranchDisposition, EpochScore, MarketScore, Outcome, SettledMarkets,
    };

    const STORAGE_VERSION: StorageVersion = StorageVersion::new(0);

    /// The USDC asset id, as the configured collateral adapter names it.
    pub type AssetIdOf<T> = <<T as Config>::Collateral as InspectAsset<
        <T as frame_system::Config>::AccountId,
    >>::AssetId;

    /// One enrolled account (08 §2.6).
    ///
    /// `snapshot_bond` is the bond the account carried when the epoch in flight
    /// opened, and it is what a debit takes from and what the earning cap is
    /// sized on. `bond` is what is actually held. A top-up raises `bond` alone,
    /// so no caller-visible action inside an epoch can move the cap.
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
    pub struct ParticipantRecord {
        /// USDC actually held for this account in the pallet sovereign.
        pub bond: Balance,
        /// The bond as of `snapshot_epoch` — the earning cap's basis.
        pub snapshot_bond: Balance,
        /// The epoch `snapshot_bond` was taken for.
        pub snapshot_epoch: EpochId,
        /// Folded, not yet settled, score for the epoch in flight.
        pub epoch: EpochScore,
        /// Reward accrued and not yet claimed, denominated in **USDC**.
        pub accrued: Balance,
        /// Set when a debit took the whole bond; cleared by a top-up that
        /// restores the minimum.
        pub suspended: bool,
    }

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config<RuntimeEvent: From<Event<Self>>> {
        /// USDC custody for participation bonds. Bonds are USDC rather than
        /// VIT because the only externally signable VIT at genesis is the
        /// founding and ops allocation (08 §2.6).
        type Collateral: InspectAsset<Self::AccountId, Balance = Balance>
            + MutateAsset<Self::AccountId>;

        #[pallet::constant]
        type UsdcAssetId: Get<AssetIdOf<Self>>;

        /// Native VIT custody. Claims are paid from the budget the treasury
        /// moved into this pallet's sovereign account, never from `MAIN`.
        type Rewards: InspectNative<Self::AccountId, Balance = Balance>
            + MutateNative<Self::AccountId>;

        /// Root of the pallet's own sovereign account, which custodies both the
        /// USDC bonds and the authorized VIT budget.
        #[pallet::constant]
        type PalletId: Get<PalletId>;

        /// Live `rwd.rate` in parts per billion (13 §1). `None` is the
        /// fail-closed state — absent, malformed, or zero, since a zero rate is
        /// the program switched off and must not take a hold (08 §2.6).
        type RewardRate: Get<Option<u32>>;

        /// Live `fee.vit_usdc_rate` as its stored `FixedU64` integer, in USDC
        /// per VIT (13 §1, key `fee.vit_usdc`). The row is unseeded at genesis,
        /// so `None` is an ordinary state and fails `claim_rewards` closed.
        type VitUsdcRate: Get<Option<u64>>;

        /// Live `ledger.pos_dep` — the minimum bond. 08 §2.6 reuses this row
        /// rather than adding a key, because the minimum only prevents state
        /// bloat and this row already prices an entry against bloat.
        type PositionDeposit: Get<Balance>;

        /// The protocol epoch of `epoch.length`. The program adds no clock.
        type CurrentEpoch: Get<EpochId>;

        /// Where forfeited USDC goes: `INSURANCE`, 08 §1.2/§1.4's standing
        /// destination for USDC taken from an account.
        type InsuranceAccount: Get<Self::AccountId>;

        /// Terminal facts for one scored book (08 §2.6 rules 3 and 4). `()`
        /// reports nothing settled, which folds nothing and leaves the absolute
        /// timeout as the only escape — the fail-closed default until TR7 binds
        /// the market pallet's adapter.
        type SettledMarkets: SettledMarkets<Self::AccountId>;

        type WeightInfo: WeightInfo;

        #[cfg(feature = "runtime-benchmarks")]
        type BenchmarkHelper: BenchmarkHelper<Self::AccountId>;
    }

    /// The enrolled roster (08 §2.6). Bounded by [`MAX_PARTICIPANTS`] through
    /// [`ParticipantCount`], which `enroll` checks before taking any hold.
    #[pallet::storage]
    pub type Participants<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, ParticipantRecord, OptionQuery>;

    /// Per-account, per-market accumulators. TR4 writes them on each fill and
    /// TR5 folds and deletes them.
    #[pallet::storage]
    pub type Scores<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        T::AccountId,
        Twox64Concat,
        futarchy_primitives::MarketId,
        MarketScore,
        OptionQuery,
    >;

    /// O(1) mirror of each account's [`Scores`] prefix length. TR4 bounds it.
    #[pallet::storage]
    pub type ScoreCount<T: Config> = StorageMap<_, Blake2_128Concat, T::AccountId, u32, ValueQuery>;

    /// O(1) mirror of the [`Participants`] map length, so the roster bound is
    /// enforced without iterating a map.
    #[pallet::storage]
    pub type ParticipantCount<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// O(1) mirror of the summed unclaimed `accrued` USDC across the roster.
    /// TR5's budget scaling reads it; `try-state` binds it to the records.
    #[pallet::storage]
    pub type TotalAccrued<T: Config> = StorageValue<_, Balance, ValueQuery>;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// A bond was held and a participant record opened.
        Enrolled {
            who: T::AccountId,
            bond: Balance,
            snapshot_epoch: EpochId,
        },
        /// The hold grew. The earning cap did not.
        BondToppedUp {
            who: T::AccountId,
            amount: Balance,
            bond: Balance,
        },
        /// The whole bond was released. `record_retained` is true when an
        /// unclaimed accrual kept the record alive at a zero bond, which is
        /// the one case where a withdrawal does not close the account.
        BondWithdrawn {
            who: T::AccountId,
            amount: Balance,
            record_retained: bool,
        },
        /// Accrued USDC was converted once, at the live rate, and paid in VIT.
        /// `record_closed` is true when the claim was the last thing holding a
        /// zero-bond record open, so the roster slot was freed with it.
        RewardsClaimed {
            who: T::AccountId,
            accrued: Balance,
            paid: Balance,
            record_closed: bool,
        },
        /// A settled market was folded into the epoch total and its entry
        /// deleted. `spent` and `received` are what the fold contributed, which
        /// is not the entry's own pair when 08 §2.6 rule 4's annulled arm
        /// substitutes the mirror leg for the sale credits.
        MarketScoreFolded {
            who: T::AccountId,
            market: futarchy_primitives::MarketId,
            spent: Balance,
            received: Balance,
        },
        /// A score entry was deleted without folding anything: the proposal was
        /// VOIDed, or the absolute timeout elapsed on a market that never
        /// settled. `timed_out` separates the two, because one is a resolved
        /// constitutional emergency and the other is a liveness escape.
        MarketScoreDropped {
            who: T::AccountId,
            market: futarchy_primitives::MarketId,
            timed_out: bool,
        },
        /// One participant's epoch closed. `accrued` is the reward, clamped to
        /// the authorized budget's unpromised remainder; `forfeited` is the
        /// debit, which budget pressure never reduces. `snapshot_bond` is the
        /// cap the next epoch carries.
        EpochSettled {
            who: T::AccountId,
            epoch: EpochId,
            accrued: Balance,
            forfeited: Balance,
            snapshot_bond: Balance,
        },
    }

    #[pallet::error]
    pub enum Error<T> {
        /// The account already holds a participant record.
        AlreadyEnrolled,
        /// No participant record exists for the account.
        NotEnrolled,
        /// `rwd.rate` is absent, malformed, or zero. Fails before any hold.
        RateUnset,
        /// `ledger.pos_dep` is unreadable, so no minimum can be enforced.
        MinimumBondUnset,
        /// The offered bond is below the live minimum.
        BondBelowMinimum,
        /// The roster is at its 13 §4 bound.
        TooManyParticipants,
        /// A zero-amount bond mutation.
        AmountZero,
        /// The bond, the roster count or the accrual total would overflow.
        AccountingOverflow,
        /// Some epoch the account participated in has not settled.
        EpochUnsettled,
        /// Nothing is accrued, or the conversion floors to zero VIT.
        NothingToClaim,
        /// `fee.vit_usdc_rate` is absent, malformed, or zero.
        VitRateUnset,
        /// USDC custody refused the move, or moved the wrong amount.
        BondCustody,
        /// VIT custody refused the payout, or paid the wrong amount.
        RewardCustody,
        /// Transferring the bond would leave the funder below the asset minimum.
        BondFundingWouldDust,
        /// No score entry exists for that account and market.
        NoScoreEntry,
        /// The book has not reached a terminal state and the absolute timeout
        /// has not elapsed, so there is nothing to fold and nothing to escape.
        MarketNotSettled,
        /// The account's epoch in flight has not closed. This is also the
        /// refusal a second `settle_epoch` for a settled epoch meets, because
        /// settling re-snapshots the record onto the current epoch.
        EpochNotClosed,
        /// The account still holds an unfolded score entry for the epoch, so
        /// settling would apply the arithmetic to part of its own score.
        UnfoldedScore,
        /// The accrual would promise more than the authorized budget.
        /// Unreachable by construction while the reward clamp
        /// (`budget_headroom_usdc`) is in place; kept as a tripwire against a
        /// future change that breaks it. If it ever fires, the failure mode is
        /// a stuck settlement, not a skipped reward: the whole dispatch
        /// aborts, so the epoch stays unclosed and the bond stays locked until
        /// a later call succeeds.
        BudgetExceeded,
    }

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        #[cfg(feature = "try-runtime")]
        fn try_state(_now: BlockNumberFor<T>) -> Result<(), TryRuntimeError> {
            Self::do_try_state()
        }
    }

    #[pallet::extra_constants]
    impl<T: Config> Pallet<T> {
        /// 13 §4's bound on the enrolled roster.
        #[pallet::constant_name(MaxParticipants)]
        fn max_participants() -> u32 {
            MAX_PARTICIPANTS
        }

        /// 13 §4's bound on one account's unfolded score entries.
        #[pallet::constant_name(MaxScoredMarketsPerAccount)]
        fn max_scored_markets_per_account() -> u32 {
            MAX_SCORED_MARKETS_PER_ACCOUNT
        }
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Hold a USDC bond and open a participant record (08 §2.6).
        ///
        /// Every refusal precedes every state change, and the `rwd.rate` read
        /// is first of all: 08 §2.6's failure behaviour requires an unset rate
        /// to fail closed **before any hold**.
        #[pallet::call_index(0)]
        #[pallet::weight(T::WeightInfo::enroll())]
        pub fn enroll(origin: OriginFor<T>, bond: Balance) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(T::RewardRate::get().is_some(), Error::<T>::RateUnset);
            ensure!(
                !Participants::<T>::contains_key(&who),
                Error::<T>::AlreadyEnrolled
            );
            let minimum = Self::minimum_bond().ok_or(Error::<T>::MinimumBondUnset)?;
            ensure!(bond >= minimum, Error::<T>::BondBelowMinimum);
            let count = ParticipantCount::<T>::get();
            ensure!(count < MAX_PARTICIPANTS, Error::<T>::TooManyParticipants);
            let next = count.checked_add(1).ok_or(Error::<T>::AccountingOverflow)?;

            frame_support::storage::with_storage_layer(|| {
                Self::hold_bond(&who, bond)?;
                let snapshot_epoch = T::CurrentEpoch::get();
                Participants::<T>::insert(
                    &who,
                    ParticipantRecord {
                        bond,
                        // The account joins the epoch at this bond, and it has
                        // no score for any earlier one, so there is no settled
                        // outcome for this snapshot to re-cap. That is what the
                        // top-up deferral protects, and enrolment cannot reach
                        // it: an account scores nothing before it is enrolled.
                        snapshot_bond: bond,
                        snapshot_epoch,
                        epoch: EpochScore::default(),
                        accrued: 0,
                        suspended: false,
                    },
                );
                ParticipantCount::<T>::put(next);
                Self::deposit_event(Event::Enrolled {
                    who: who.clone(),
                    bond,
                    snapshot_epoch,
                });
                Ok(())
            })
        }

        /// Raise the hold. The earning cap moves only at the next settlement.
        ///
        /// 08 §2.6: an immediate cap raise would let a wash operator wait for
        /// the outcome, enlarge only the winning account's cap, and leave the
        /// loser at the minimum. `snapshot_bond` and `snapshot_epoch` are
        /// therefore untouched here, unconditionally.
        #[pallet::call_index(1)]
        #[pallet::weight(T::WeightInfo::top_up_bond())]
        pub fn top_up_bond(origin: OriginFor<T>, amount: Balance) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(amount > 0, Error::<T>::AmountZero);
            frame_support::storage::with_storage_layer(|| {
                let mut record = Participants::<T>::get(&who).ok_or(Error::<T>::NotEnrolled)?;
                let bond = record
                    .bond
                    .checked_add(amount)
                    .ok_or(Error::<T>::AccountingOverflow)?;
                Self::hold_bond(&who, amount)?;
                record.bond = bond;
                // 08 §2.6: a debit "takes the whole bond and suspends the
                // participant until they top up". A top-up that still leaves
                // the account under the live minimum has restored nothing.
                if record.suspended {
                    if let Some(minimum) = Self::minimum_bond() {
                        record.suspended = bond < minimum;
                    }
                }
                Participants::<T>::insert(&who, record);
                Self::deposit_event(Event::BondToppedUp {
                    who: who.clone(),
                    amount,
                    bond,
                });
                Ok(())
            })
        }

        /// Release the whole bond (08 §2.6).
        ///
        /// The gate is **epoch settlement**, never folding: folding deletes the
        /// last score entry while the debit settles at epoch close, so a
        /// fold-based gate would let a participant who folded a losing epoch
        /// release the whole bond ahead of the debit.
        ///
        /// **Settlement is the only condition, per 08 §2.6, and an unclaimed
        /// accrual is deliberately not a second one.** An accrual is a VIT
        /// claim against a budget that §2.6 returns to the pot at epoch close,
        /// so an accrual outstanding past that boundary routinely meets an
        /// empty budget — and refusing here would then leave the participant
        /// able to neither claim nor withdraw, with the only remedy a
        /// `FutarchyParam` call they cannot make. §2.6 separately forbids a
        /// bond being locked forever. So the bond always comes back, and the
        /// record survives at a zero bond to carry the claim.
        #[pallet::call_index(2)]
        #[pallet::weight(T::WeightInfo::withdraw_bond())]
        pub fn withdraw_bond(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let mut record = Participants::<T>::get(&who).ok_or(Error::<T>::NotEnrolled)?;
                // The counter is the O(1) mirror; the prefix probe is the real
                // guard, so a drifted counter can never release a bond that a
                // live score entry still backs.
                ensure!(ScoreCount::<T>::get(&who) == 0, Error::<T>::EpochUnsettled);
                ensure!(
                    Scores::<T>::iter_key_prefix(&who).next().is_none(),
                    Error::<T>::EpochUnsettled
                );
                // A folded but unsettled epoch is the same refusal, whatever
                // its sign: the reward is sized on the same snapshot the debit
                // would take from.
                ensure!(
                    record.epoch == EpochScore::default(),
                    Error::<T>::EpochUnsettled
                );
                let amount = record.bond;
                // Only the closing path touches the roster count, so a retained
                // record keeps exactly the one slot it already occupied.
                let closing_count = if record.accrued == 0 {
                    Some(
                        ParticipantCount::<T>::get()
                            .checked_sub(1)
                            .ok_or(Error::<T>::AccountingOverflow)?,
                    )
                } else {
                    None
                };
                Self::release_bond(&who, amount)?;
                match closing_count {
                    Some(count) => {
                        Participants::<T>::remove(&who);
                        ScoreCount::<T>::remove(&who);
                        ParticipantCount::<T>::put(count);
                    }
                    None => {
                        record.bond = 0;
                        // The cap follows the bond down. Leaving a snapshot
                        // above a released bond would leave a cap nothing backs.
                        record.snapshot_bond = 0;
                        Participants::<T>::insert(&who, record);
                    }
                }
                Self::deposit_event(Event::BondWithdrawn {
                    who: who.clone(),
                    amount,
                    record_retained: closing_count.is_none(),
                });
                Ok(())
            })
        }

        /// Convert the accrued USDC figure to VIT once, at the live
        /// `fee.vit_usdc_rate`, and pay it from the authorized budget.
        ///
        /// 08 §2.6: both legs of the reward arithmetic are USDC and only the
        /// payout converts, rounding against the claimant. There is no vesting.
        ///
        /// A claim that empties a record `withdraw_bond` already released also
        /// **closes** it and returns its roster slot. That is what keeps the
        /// retained-record path from starving [`MAX_PARTICIPANTS`]: the slot is
        /// freed by the call the claimant already wants to make, rather than by
        /// a second one they might never send.
        #[pallet::call_index(3)]
        #[pallet::weight(T::WeightInfo::claim_rewards())]
        pub fn claim_rewards(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let mut record = Participants::<T>::get(&who).ok_or(Error::<T>::NotEnrolled)?;
                let accrued = record.accrued;
                ensure!(accrued > 0, Error::<T>::NothingToClaim);
                let paid = Self::usdc_to_vit(accrued)?;
                // A payout that floors to nothing is refused rather than
                // spending the claim for zero.
                ensure!(paid > 0, Error::<T>::NothingToClaim);
                let total = TotalAccrued::<T>::get()
                    .checked_sub(accrued)
                    .ok_or(Error::<T>::AccountingOverflow)?;
                // `Preserve`: the same sovereign custodies every USDC bond, so
                // a VIT payout must never be allowed to reap its account.
                let moved =
                    T::Rewards::transfer(&Self::account_id(), &who, paid, Preservation::Preserve)
                        .map_err(|_| Error::<T>::RewardCustody)?;
                ensure!(moved == paid, Error::<T>::RewardCustody);
                record.accrued = 0;
                // Nothing is left to keep the record open: no bond, no score
                // row, no folded epoch total and now no claim. The same three
                // settlement conditions `withdraw_bond` checks apply, so a
                // close here can never step over a pending debit.
                let record_closed = record.bond == 0
                    && record.epoch == EpochScore::default()
                    && ScoreCount::<T>::get(&who) == 0
                    && Scores::<T>::iter_key_prefix(&who).next().is_none();
                if record_closed {
                    let count = ParticipantCount::<T>::get()
                        .checked_sub(1)
                        .ok_or(Error::<T>::AccountingOverflow)?;
                    Participants::<T>::remove(&who);
                    ScoreCount::<T>::remove(&who);
                    ParticipantCount::<T>::put(count);
                } else {
                    Participants::<T>::insert(&who, record);
                }
                TotalAccrued::<T>::put(total);
                Self::deposit_event(Event::RewardsClaimed {
                    who: who.clone(),
                    accrued,
                    paid,
                    record_closed,
                });
                Ok(())
            })
        }

        /// Fold one settled market into the account's epoch total and delete
        /// the entry (08 §2.6).
        ///
        /// **Permissionless, and it names a target rather than the caller.**
        /// That is safe because it acts only on already-recorded values: every
        /// caller reaches the same result and no caller can choose it. The
        /// keeper cranks it (01 §4.2).
        ///
        /// It succeeds on one of exactly two conditions. Either the book has
        /// reached a terminal state, in which case rule 3 credits the
        /// book-acquired remainder and rule 4 selects the arm from the branch's
        /// disposition; or the **absolute timeout** has elapsed, in which case
        /// the entry drops at zero without folding. Settlement is checked
        /// first: §2.6 sizes the timeout above the longest lawful settlement
        /// horizon precisely so no settling market reaches it, and dropping a
        /// settled market would turn the liveness escape into an exit from a
        /// live debit.
        #[pallet::call_index(4)]
        #[pallet::weight(T::WeightInfo::settle_market_score())]
        pub fn settle_market_score(
            origin: OriginFor<T>,
            who: T::AccountId,
            market: futarchy_primitives::MarketId,
        ) -> DispatchResult {
            ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let mut record = Participants::<T>::get(&who).ok_or(Error::<T>::NotEnrolled)?;
                let mut score = Scores::<T>::get(&who, market).ok_or(Error::<T>::NoScoreEntry)?;

                let event = match T::SettledMarkets::settlement(&who, market) {
                    Some(settlement) => {
                        // Rule 3 runs only on the arm that keeps `received`.
                        // The annulled arm discards every credit and VOID folds
                        // nothing, so crediting them is work whose only
                        // reachable effect would be an overflow refusing a
                        // lawful fold.
                        if matches!(settlement.disposition, BranchDisposition::Realized) {
                            trading_rewards_core::on_settle(
                                &mut score,
                                settlement.position,
                                settlement.settled_value,
                            )
                            .map_err(|_| Error::<T>::AccountingOverflow)?;
                        }
                        let before = record.epoch.clone();
                        // `fold` stays the single owner of rule 4's arms; what
                        // follows only reports what it did.
                        trading_rewards_core::fold(
                            &mut record.epoch,
                            &score,
                            settlement.disposition,
                        )
                        .map_err(|_| Error::<T>::AccountingOverflow)?;
                        if matches!(settlement.disposition, BranchDisposition::Void) {
                            Event::MarketScoreDropped {
                                who: who.clone(),
                                market,
                                timed_out: false,
                            }
                        } else {
                            Event::MarketScoreFolded {
                                who: who.clone(),
                                market,
                                spent: record.epoch.spent.saturating_sub(before.spent),
                                received: record.epoch.received.saturating_sub(before.received),
                            }
                        }
                    }
                    None => {
                        ensure!(
                            trading_rewards_core::score_entry_expired(
                                score.created_at,
                                Self::now_u64()
                            ),
                            Error::<T>::MarketNotSettled
                        );
                        Event::MarketScoreDropped {
                            who: who.clone(),
                            market,
                            timed_out: true,
                        }
                    }
                };

                Scores::<T>::remove(&who, market);
                // Saturating rather than checked: the counter is an O(1) mirror
                // that `try-state` binds to the map, and a counter that had
                // drifted low must not be able to hold a bond behind a row that
                // no longer exists.
                ScoreCount::<T>::mutate(&who, |count| *count = count.saturating_sub(1));
                Participants::<T>::insert(&who, record);
                Self::deposit_event(event);
                Ok(())
            })
        }

        /// Close one participant's epoch, applying the reward or the debit
        /// exactly once (08 §2.6). Permissionless and named-target for the same
        /// reason as [`Pallet::settle_market_score`].
        ///
        /// Three obligations §2.6 states normatively, and each is a refusal
        /// above rather than a correction below:
        ///
        /// 1. **Idempotent per participant per epoch.** Settling re-snapshots
        ///    the record onto the current epoch, so a second call meets the
        ///    closed-epoch refusal. There is no separate settled marker to keep
        ///    in step with the snapshot.
        /// 2. **Refuses an epoch that has not closed.**
        /// 3. **Refuses while an unfolded score entry remains** — otherwise a
        ///    partially folded account settles on part of its own score, which
        ///    is the one ordering in which a losing epoch pays a reward.
        ///
        /// It also re-snapshots the bond **whenever an epoch closes, including
        /// when there was nothing to settle**. Nothing else re-snapshots, so
        /// without that an account that tops up in a quiet epoch would keep the
        /// smaller cap indefinitely and §2.6's "a top-up takes effect from the
        /// next epoch" would not be what the code does (TR3 §6.2).
        #[pallet::call_index(5)]
        #[pallet::weight(T::WeightInfo::settle_epoch())]
        pub fn settle_epoch(origin: OriginFor<T>, who: T::AccountId) -> DispatchResult {
            ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let mut record = Participants::<T>::get(&who).ok_or(Error::<T>::NotEnrolled)?;
                let epoch = T::CurrentEpoch::get();
                ensure!(record.snapshot_epoch < epoch, Error::<T>::EpochNotClosed);
                // The counter is the O(1) mirror; the prefix probe is the real
                // guard, exactly as `withdraw_bond` reads the same pair, so a
                // drifted counter can never let a score settle unfolded.
                ensure!(ScoreCount::<T>::get(&who) == 0, Error::<T>::UnfoldedScore);
                ensure!(
                    Scores::<T>::iter_key_prefix(&who).next().is_none(),
                    Error::<T>::UnfoldedScore
                );

                // An unset or zero `rwd.rate` gives a zero cap, so the epoch
                // closes at `Neutral` whatever the folded score. That is not a
                // neutral consequence: a loss already folded into the epoch
                // accumulator is discharged in full and the bond released
                // untouched, which is the under-punishing direction that funds
                // the farm (08 §2.6) — a real cost of the G-1 direction, not a
                // side effect. 13 §1 calls a zero rate "off, the safe
                // direction" for *new* scoring only; that reading does not
                // cover a debit already folded. The behaviour stands anyway:
                // refusing would hold the bond behind a governed row the
                // participant cannot move, which the *bond MUST NOT be locked
                // forever* rule forbids.
                let rate = T::RewardRate::get().unwrap_or_default();
                let outcome =
                    trading_rewards_core::epoch_outcome(&record.epoch, record.snapshot_bond, rate);

                let mut accrued: Balance = 0;
                let mut forfeited: Balance = 0;
                match outcome {
                    Outcome::Reward(demand) => {
                        // **One read of each figure, used by both the clamp
                        // and the guard.** Calling `budget_headroom_usdc()`
                        // here and `authorized_budget_usdc()` again inside the
                        // `ensure!` is what the code used to do, and it read
                        // `fee.vit_usdc_rate`, the sovereign's VIT balance and
                        // `TotalAccrued` twice each for one settlement. The
                        // duplication was invisible in the declared weight
                        // (which counted call sites, 11) and equally invisible
                        // in a measured one (`frame-benchmarking` charges a
                        // repeat access to an already-tracked key as one
                        // read, 8), so nothing would ever have reported it.
                        // Caching costs nothing and makes the code, the
                        // comment and the measurement agree at 8.
                        let budget = Self::authorized_budget_usdc().unwrap_or_default();
                        let promised = TotalAccrued::<T>::get();
                        accrued = core::cmp::min(demand, budget.saturating_sub(promised));
                        if accrued > 0 {
                            record.accrued = record
                                .accrued
                                .checked_add(accrued)
                                .ok_or(Error::<T>::AccountingOverflow)?;
                            let total = promised
                                .checked_add(accrued)
                                .ok_or(Error::<T>::AccountingOverflow)?;
                            // 08 §2.6: an exhausted budget clamps the reward
                            // and leaves the debit whole, so nothing strands
                            // and the pot never overdraws. The clamp above
                            // already establishes it, so this is unreachable
                            // by construction — a tripwire, not a reachable
                            // refusal. Unlike a skipped reward, tripping it
                            // fails the *whole* dispatch: the epoch stays
                            // unclosed and the bond stays locked until a later
                            // call succeeds.
                            ensure!(total <= budget, Error::<T>::BudgetExceeded);
                            TotalAccrued::<T>::put(total);
                        }
                    }
                    Outcome::Debit(demand) => {
                        // "A debit never drives the bond below zero. It takes
                        // the whole bond and suspends the participant until they
                        // top up."
                        forfeited = core::cmp::min(demand, record.bond);
                        if forfeited > 0 {
                            Self::forfeit_to_insurance(forfeited)?;
                            record.bond = record.bond.saturating_sub(forfeited);
                            // Conditional on a debit having actually been taken:
                            // a record `withdraw_bond` retained at a zero bond
                            // must not be suspended by a settlement that took
                            // nothing from it.
                            if record.bond == 0 {
                                record.suspended = true;
                            }
                        }
                    }
                    Outcome::Neutral => {}
                }

                record.epoch = EpochScore::default();
                // After the debit, so the snapshot never claims a cap the bond
                // no longer backs — the `snapshot_bond <= bond` try-state leg.
                record.snapshot_bond = record.bond;
                record.snapshot_epoch = epoch;
                let snapshot_bond = record.snapshot_bond;
                Participants::<T>::insert(&who, record);
                Self::deposit_event(Event::EpochSettled {
                    who: who.clone(),
                    epoch,
                    accrued,
                    forfeited,
                    snapshot_bond,
                });
                Ok(())
            })
        }
    }

    impl<T: Config> Pallet<T> {
        /// The pallet's sovereign account: USDC bonds and the authorized VIT
        /// budget both sit here, in two different assets.
        pub fn account_id() -> T::AccountId {
            T::PalletId::get().into_account_truncating()
        }

        /// Move `amount` USDC from the participant into the sovereign.
        fn hold_bond(who: &T::AccountId, amount: Balance) -> DispatchResult {
            let usdc = T::UsdcAssetId::get();
            let remaining = T::Collateral::balance(usdc.clone(), who)
                .checked_sub(amount)
                .ok_or(Error::<T>::BondCustody)?;
            let preservation = if remaining == 0 {
                Preservation::Expendable
            } else {
                ensure!(
                    remaining >= T::Collateral::minimum_balance(usdc.clone()),
                    Error::<T>::BondFundingWouldDust
                );
                Preservation::Preserve
            };
            let moved =
                T::Collateral::transfer(usdc, who, &Self::account_id(), amount, preservation)
                    .map_err(|_| Error::<T>::BondCustody)?;
            ensure!(moved == amount, Error::<T>::BondCustody);
            Ok(())
        }

        /// Move a forfeited bond to `INSURANCE` — 08 §1.2/§1.4's standing
        /// destination for USDC taken from an account.
        ///
        /// `Expendable` on the sovereign side for the same reason
        /// [`Pallet::release_bond`] uses it: every tracked bond is at least the
        /// asset minimum, so the only balance a reap there can dust is donated
        /// surplus, while `Preserve` would let a one-unit donation wedge the
        /// last forfeit for good.
        fn forfeit_to_insurance(amount: Balance) -> DispatchResult {
            if amount == 0 {
                return Ok(());
            }
            let moved = T::Collateral::transfer(
                T::UsdcAssetId::get(),
                &Self::account_id(),
                &T::InsuranceAccount::get(),
                amount,
                Preservation::Expendable,
            )
            .map_err(|_| Error::<T>::BondCustody)?;
            ensure!(moved == amount, Error::<T>::BondCustody);
            Ok(())
        }

        /// The authorized budget, valued in USDC — the VIT the treasury moved
        /// into this pallet's sovereign account (08 §2.6: the funding call
        /// "transfers VIT to the reward pallet's own sovereign account", so the
        /// budget *is* that balance).
        ///
        /// `Preserve`/`Polite`, so the existential deposit is never counted as
        /// budget and a payout can never reap the account that also custodies
        /// every USDC bond. Floored, and `None` on an unreadable rate or an
        /// arithmetic edge — both are the claimant-adverse direction, because a
        /// budget that cannot be valued promises nothing.
        pub fn authorized_budget_usdc() -> Option<Balance> {
            let rate = u128::from(T::VitUsdcRate::get()?);
            let vit = T::Rewards::reducible_balance(
                &Self::account_id(),
                Preservation::Preserve,
                Fortitude::Polite,
            );
            // The exact inverse of `usdc_to_vit`, arranged so the product is
            // `vit x rate` rather than a triple: the divisor is derived from
            // the same three constants that function divides by.
            let divisor = FIXED_DIV
                .checked_mul(futarchy_primitives::currency::VIT)?
                .checked_div(futarchy_primitives::currency::USDC)?;
            vit.checked_mul(rate)?.checked_div(divisor)
        }

        /// What the authorized budget can still promise: the part of it no
        /// outstanding accrual already claims.
        ///
        /// **Only the reward leg reads this, and the debit leg deliberately
        /// does not.** Scaling a debit by budget consumption would be farmable
        /// by settlement timing, because both settlement steps are pull-based
        /// and the caller chooses when to crank: a wash operator settles the
        /// winning account while the budget is full, waits for other
        /// participants to exhaust it, and settles the losing account into a
        /// headroom of zero. The pair then nets **positive**, which is the one
        /// invariant the whole design rests on. An unscaled debit keeps the
        /// pair non-positive at every budget level and in every settlement
        /// order. The cost is the one 08 §2.6 names — a loser in a starved
        /// epoch is over-punished relative to a scaled winner — and it is the
        /// R-7 direction. See the TR5 report for the derivation and for what
        /// closing it properly would need from TR6.
        pub fn budget_headroom_usdc() -> Balance {
            Self::authorized_budget_usdc()
                .unwrap_or_default()
                .saturating_sub(TotalAccrued::<T>::get())
        }

        /// Return `amount` USDC from the sovereign to the participant.
        fn release_bond(who: &T::AccountId, amount: Balance) -> DispatchResult {
            if amount == 0 {
                return Ok(());
            }
            let usdc = T::UsdcAssetId::get();
            // `Expendable` on the sovereign side. Every tracked bond is at
            // least the asset minimum, so the only balance a reap can dust is
            // donated surplus; `Preserve` would instead let a one-unit donation
            // wedge the last participant's withdrawal for good.
            let moved = T::Collateral::transfer(
                usdc,
                &Self::account_id(),
                who,
                amount,
                Preservation::Expendable,
            )
            .map_err(|_| Error::<T>::BondCustody)?;
            ensure!(moved == amount, Error::<T>::BondCustody);
            Ok(())
        }

        /// `accrued / rate`, floored — against the claimant (08 §2.6).
        ///
        /// `rate` is `fee.vit_usdc_rate`'s stored `FixedU64` integer, so it is
        /// USDC per VIT scaled by [`FIXED_DIV`]; the two currency units differ
        /// in decimals, so both appear. This is the inverse of the runtime's
        /// own fee conversion, which rounds the other way because there the
        /// payer is the one the rounding must not favour.
        pub fn usdc_to_vit(accrued: Balance) -> Result<Balance, DispatchError> {
            let rate = u128::from(T::VitUsdcRate::get().ok_or(Error::<T>::VitRateUnset)?);
            let numerator = accrued
                .checked_mul(FIXED_DIV)
                .and_then(|value| value.checked_mul(futarchy_primitives::currency::VIT))
                .ok_or(Error::<T>::AccountingOverflow)?;
            let denominator = rate
                .checked_mul(futarchy_primitives::currency::USDC)
                .ok_or(Error::<T>::AccountingOverflow)?;
            numerator
                .checked_div(denominator)
                .ok_or(Error::<T>::VitRateUnset.into())
        }

        /// The single read the fill observer makes, once per fill, before it
        /// can do anything else (08 §2.6 *Three accepted costs*: "the book must
        /// check enrollment before it can skip the accumulator").
        ///
        /// **Enrolment alone is the wrong predicate, and a live bond is the
        /// right one.** `withdraw_bond` retains the record at `bond = 0` while
        /// an accrual is unclaimed, and a debit that takes the whole bond
        /// leaves the same shape. Scoring such a record costs something real:
        /// each row it creates blocks its own `claim_rewards` from closing the
        /// record (that path requires `ScoreCount == 0`), so a bond-free
        /// account could hold a roster slot against [`MAX_PARTICIPANTS`]
        /// indefinitely, just by trading.
        ///
        /// **What makes skipping safe is the `book_acquired` rule, not the
        /// zero cap.** The cap argument is tempting and does not carry: a zero
        /// `snapshot_bond` makes every outcome `Neutral` for the epoch *in
        /// flight*, but a score folds into whichever epoch is open when its
        /// market settles, by which time a top-up and an epoch boundary can
        /// have restored a real cap. The load-bearing property is that an
        /// unscored buy raises no `book_acquired`, so 08 §2.6 rule 3 credits
        /// `min(position, book_acquired) × settled_value` = 0 at settlement for
        /// exactly the units whose `spent` was skipped. The omission is
        /// therefore symmetric, and where it is not symmetric it only
        /// under-credits — the R-7 direction.
        ///
        /// The one asymmetric case is a **sale** of book-acquired units while
        /// `bond == 0`, which would drop a credit rule 2 mandates. That state
        /// is unreachable: both routes to a zero bond pass a gate requiring
        /// `ScoreCount == 0`, and `do_try_state` asserts the implication so a
        /// later milestone cannot quietly open it.
        ///
        /// The predicate is `bond`, never `snapshot_bond`. A participant who
        /// was debited to zero and then topped up carries `bond > 0` with
        /// `snapshot_bond` still 0 until settlement re-snapshots it, and their
        /// fills MUST be scored: 08 §2.6 defers the *cap* to the next epoch,
        /// not the accounting. Skipping them would drop the losses too, which
        /// is the direction that costs the program money.
        ///
        /// **The admission condition is a conjunction, and neither half implies
        /// the other** (SQ-1050, 08 §2.6). *"Suspension suspends scoring, and
        /// the accumulator MUST test the suspension flag rather than infer it
        /// from a nonzero bond."* [`Pallet::top_up_bond`] clears `suspended`
        /// only once the bond is back at the minimum `enroll` demands, so a
        /// **sub-minimum** top-up leaves a suspended account holding a nonzero
        /// bond and a balance gate alone would resume scoring while the flag
        /// says otherwise. Going the other way, a voluntary `withdraw_bond`
        /// retains the record at a zero bond and never sets the flag, so the
        /// flag alone would score an account with nothing behind it. The
        /// earning cap is not a backstop for either half: a zero cap makes the
        /// reward *round* to zero, which is an arithmetic accident of the floor
        /// rather than a refusal, and it is the argument §2.6 retired once.
        ///
        /// Reading the record rather than probing for the key costs the same
        /// one storage access, and both halves come out of that one read.
        pub fn scores_fills(who: &T::AccountId) -> bool {
            Participants::<T>::get(who).is_some_and(|record| record.bond > 0 && !record.suspended)
        }

        /// The current block height, widened for the frame-free kernel exactly
        /// as `pallet-market`'s `now_u64` does.
        pub fn now_u64() -> u64 {
            frame_system::Pallet::<T>::block_number().unique_saturated_into()
        }

        /// The live minimum bond: `ledger.pos_dep`, never below the USDC asset
        /// minimum, because a bond under that cannot create the sovereign's
        /// asset account. `None` when `ledger.pos_dep` is unreadable, which
        /// fails `enroll` closed rather than admitting an unpriced entry.
        pub fn minimum_bond() -> Option<Balance> {
            let deposit = T::PositionDeposit::get();
            if deposit == 0 {
                return None;
            }
            Some(deposit.max(T::Collateral::minimum_balance(T::UsdcAssetId::get())))
        }

        #[cfg(any(feature = "try-runtime", test))]
        pub fn do_try_state() -> Result<(), TryRuntimeError> {
            let usdc = T::UsdcAssetId::get();
            let minimum = Self::minimum_bond();
            let mut rows = 0u32;
            let mut held = 0u128;
            let mut accrued = 0u128;

            let mut score_rows: BTreeMap<T::AccountId, u32> = BTreeMap::new();
            for (who, _market, score) in Scores::<T>::iter() {
                let counter = score_rows.entry(who).or_default();
                *counter = counter.checked_add(1).ok_or(TryRuntimeError::Other(
                    "trading-rewards: score row count overflow",
                ))?;
                // 08 §2.6 rule 1 raises `spent` by `cost + fee` and
                // `mirror_principal` by `cost` on the same buy, so the mirror
                // leg can never exceed what was spent. It is checked here
                // rather than argued in a comment because the edit that breaks
                // it — adding to one counter and not the other — is easy to
                // make and silent otherwise: it would surface as an **annulled
                // market paying a reward**, which is the one direction rule 4
                // makes unreachable.
                ensure!(
                    score.mirror_within_spent(),
                    TryRuntimeError::Other("trading-rewards: mirror principal above spent")
                );
            }

            for (who, record) in Participants::<T>::iter() {
                rows = rows.checked_add(1).ok_or(TryRuntimeError::Other(
                    "trading-rewards: participant count overflow",
                ))?;
                ensure!(
                    rows <= MAX_PARTICIPANTS,
                    TryRuntimeError::Other("trading-rewards: roster over MaxParticipants")
                );
                // 08 §2.6: the epoch's cap is sized on `snapshot_bond` and the
                // debit takes from the bond, so an unsettled epoch's snapshot
                // must be backed by a bond that is still held. Every write path
                // keeps it: enrolment sets the two equal, a top-up raises only
                // the bond, and settlement re-snapshots after the debit.
                ensure!(
                    record.snapshot_bond <= record.bond,
                    TryRuntimeError::Other("trading-rewards: snapshot cap exceeds the held bond")
                );
                // 08 §2.6 reuses the frozen `ledger.pos_dep` row as the
                // minimum. A zero bond is the post-debit suspended state, or a
                // record `withdraw_bond` released and retained for its claim.
                if let Some(minimum) = minimum {
                    ensure!(
                        record.bond == 0 || record.bond >= minimum,
                        TryRuntimeError::Other("trading-rewards: live bond below the minimum")
                    );
                }
                held = held.checked_add(record.bond).ok_or(TryRuntimeError::Other(
                    "trading-rewards: held bond total overflow",
                ))?;
                accrued = accrued
                    .checked_add(record.accrued)
                    .ok_or(TryRuntimeError::Other(
                        "trading-rewards: accrual total overflow",
                    ))?;
                let score_count = ScoreCount::<T>::get(&who);
                ensure!(
                    score_count == score_rows.remove(&who).unwrap_or(0),
                    TryRuntimeError::Other("trading-rewards: ScoreCount disagrees with Scores")
                );
                // 13 §4's per-account score-entry bound. The observer refuses a
                // new entry at the bound, so no lawful state reaches this; the
                // check is what makes that a proven property of the state at
                // rest rather than of one write path (rule 8).
                ensure!(
                    score_count <= MAX_SCORED_MARKETS_PER_ACCOUNT,
                    TryRuntimeError::Other(
                        "trading-rewards: score entries over MaxScoredMarketsPerAccount"
                    )
                );
                // The precondition [`Pallet::scores_fills`] rests on. A live
                // score row under a zero bond would be the one state where the
                // narrowing is not symmetric: the buy leg is already recorded,
                // while the matching sale would be skipped and so lose the
                // credit 08 §2.6 rule 2 mandates, leaving a full-notional loss.
                //
                // It is unreachable today, and by two different gates:
                // `withdraw_bond` refuses unless `ScoreCount == 0`, and 08 §2.6
                // requires `settle_epoch` to refuse a participant who "still
                // holds an unfolded score entry". TR5 writes that second gate,
                // which is exactly why this is checked here rather than argued
                // in a comment (rule 8).
                ensure!(
                    record.bond > 0 || score_count == 0,
                    TryRuntimeError::Other("trading-rewards: score rows under a zero bond")
                );
                // The suspension half of the same narrowing (SQ-1050). It is
                // unreachable for the same shape of reason and by its own two
                // gates: `settle_epoch` sets the flag only on a debit that took
                // the whole bond, and it refuses while any unfolded row remains;
                // once set, `scores_fills` admits no new row. Checking it makes
                // the asymmetry argument a property of the state at rest rather
                // than of two write paths (rule 8) — a suspended account holding
                // a live row would have its sales skipped and keep the buy leg,
                // which is the full-notional direction R-7 forbids.
                ensure!(
                    !record.suspended || score_count == 0,
                    TryRuntimeError::Other("trading-rewards: score rows under a suspension")
                );
            }

            ensure!(
                score_rows.is_empty(),
                TryRuntimeError::Other("trading-rewards: score row without a participant")
            );
            ensure!(
                ParticipantCount::<T>::get() == rows,
                TryRuntimeError::Other("trading-rewards: ParticipantCount disagrees with the map")
            );
            // **DECLARED DEVIATION (TR3).** Design §8 and TR3's brief both ask
            // this hook for *"accruals never exceed the authorized budget"*.
            // This is not that property. It asserts the weaker one that the
            // O(1) mirror equals the records it mirrors, and the substitution
            // is deliberate rather than an oversight.
            //
            // Three reasons. `accrued` is USDC while the authorized budget is
            // the VIT the treasury moved into the sovereign, so the comparison
            // needs `fee.vit_usdc_rate` — a 13 §1 row that is unseeded at
            // genesis, which would make the leg unevaluable on a lawful chain.
            // That row is also PARAM-amendable, so a governed move could turn
            // this hook red on a state no code here created, and a try-state a
            // parameter amendment can break is one that blocks an upgrade for
            // the wrong reason. And 08 §2.6 puts the real property at accrual
            // time rather than at rest: the reward is clamped to the budget's
            // unpromised remainder and the debit is never reduced by budget
            // pressure, which is a post-condition `settle_epoch` establishes.
            //
            // **The real leg is TR5's**, and it belongs beside the clamp that
            // creates it. What this one buys meanwhile is the precondition that
            // makes the real one checkable at all: an accrual total TR5 can
            // compare a budget against, bound to the records it summarises so
            // it cannot drift away from them unnoticed.
            ensure!(
                TotalAccrued::<T>::get() == accrued,
                TryRuntimeError::Other("trading-rewards: TotalAccrued disagrees with the records")
            );
            for (who, _) in ScoreCount::<T>::iter() {
                ensure!(
                    Participants::<T>::contains_key(&who),
                    TryRuntimeError::Other("trading-rewards: score counter without a participant")
                );
            }
            // The sovereign is publicly addressable, so an unrelated account can
            // donate USDC to it. Surplus must not make try-state — and therefore
            // an upgrade — externally haltable; only an under-backed accounting
            // claim is unsafe, which is why this is `>=` and not equality.
            ensure!(
                T::Collateral::balance(usdc, &Self::account_id()) >= held,
                TryRuntimeError::Other("trading-rewards: bond custody under the held total")
            );
            Ok(())
        }
    }

    /// The book's per-fill report, accumulated into the 08 §2.6 score.
    ///
    /// **Every failure here is a silent no-op, and that is the specified
    /// direction.** 08 §2.6 puts an over-bound fill and an arithmetic edge at
    /// "records no score and never rejects the trade": refusing a lawful trade
    /// to protect a rewards accumulator is the wrong way round under G-1. The
    /// trait is infallible for the same reason, so there is no channel by
    /// which this code could refuse one even by mistake.
    impl<T: Config> market_core::TradeObserver<T::AccountId> for Pallet<T> {
        fn observe_fill(
            who: &T::AccountId,
            market: futarchy_primitives::MarketId,
            side: usize,
            qty: Balance,
            cost: Balance,
            fee: Balance,
            is_buy: bool,
        ) {
            // The one read every trade pays, enrolled or not (08 §2.6's first
            // accepted cost). Nothing above it touches storage, so a
            // non-participant's fill costs exactly this and stops here.
            if !Self::scores_fills(who) {
                return;
            }
            let existing = Scores::<T>::get(who, market);
            // Read the counter only when a new entry would be created, so the
            // ordinary fill — one into a market already scored — pays two reads
            // rather than three.
            let count = match existing {
                Some(_) => None,
                None => {
                    let count = ScoreCount::<T>::get(who);
                    if count >= MAX_SCORED_MARKETS_PER_ACCOUNT {
                        return;
                    }
                    match count.checked_add(1) {
                        Some(next) => Some(next),
                        None => return,
                    }
                }
            };
            let before = existing.unwrap_or_default();
            let mut score = before.clone();
            // This is the only place that knows an entry is being created, so
            // it is where 08 §2.6's absolute timeout is anchored — before the
            // accumulator runs, so the stamp is a property of creation rather
            // than of whichever branch of the arithmetic happens to run.
            if count.is_some() {
                score.created_at = Self::now_u64();
            }
            // The accumulator works on a local copy, so a mid-way arithmetic
            // failure cannot leave a partly-applied score in storage: `on_buy`
            // raises `spent` before it touches the branch slot.
            let outcome = if is_buy {
                trading_rewards_core::on_buy(&mut score, side, qty, cost, fee)
            } else {
                // 08 §2.6 credits a sale with what the seller received. The
                // book withholds the fee out of the gross proceeds `cost`
                // carries, exactly as the buy leg adds it, so crediting the
                // gross figure would hand the trader a fee they never got —
                // the one rounding direction R-7 forbids. `saturating_sub`
                // keeps that direction even if the two ever disagreed.
                trading_rewards_core::on_sell(&mut score, side, qty, cost.saturating_sub(fee))
            };
            if outcome.is_err() {
                return;
            }
            // A fill that moved nothing writes nothing. The reachable case is a
            // sale entirely out of off-book inventory, which credits zero by
            // the `book_acquired` rule: recording it would take a slot against
            // the 13 §4 per-account bound for a row that folds to nothing, and
            // an unfolded row blocks both `withdraw_bond` and the close in
            // `claim_rewards`. So an account holding only split-created or
            // transferred-in units could lock its own bond behind markets it
            // has no stake in. Nothing is lost, because the score is identical.
            //
            // TR4's review (finding 7) predicted the trap this comparison walks
            // into once `MarketScore` carries a creation height: `before` is
            // `unwrap_or_default()`, so a stamped entry never compares equal to
            // it and the skip stops firing silently. `unchanged_from` normalises
            // the stamp away rather than listing the accounting fields, so a
            // field added later stays inside the comparison automatically.
            if score.unchanged_from(&before) {
                return;
            }
            Scores::<T>::insert(who, market, score);
            if let Some(next) = count {
                ScoreCount::<T>::insert(who, next);
            }
        }
    }

    /// Runtime-supplied fixtures for the benchmark harness.
    #[cfg(feature = "runtime-benchmarks")]
    pub trait BenchmarkHelper<AccountId> {
        /// Give `who` enough USDC to post a bond.
        fn prime_usdc(who: &AccountId, amount: Balance);
        /// Fund the pallet sovereign with claimable VIT.
        fn prime_reward_budget(vit: Balance);
        /// Seed `fee.vit_usdc_rate`. The row is unseeded at genesis, so the
        /// claim benchmark cannot run without this.
        fn prime_vit_rate(rate: u64);
        /// Close the epoch in flight. `settle_epoch` refuses an epoch that has
        /// not closed, and the program reads the protocol epoch rather than
        /// owning a clock, so only the runtime can move it. TR7 implements this
        /// against `pallet-epoch`.
        fn advance_epoch();
    }
}
