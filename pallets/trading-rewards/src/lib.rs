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
        tokens::Preservation,
    };
    use frame_support::{pallet_prelude::*, PalletId};
    use frame_system::pallet_prelude::*;
    use sp_runtime::traits::AccountIdConversion;
    #[cfg(any(feature = "try-runtime", test))]
    use sp_runtime::TryRuntimeError;
    use trading_rewards_core::{EpochScore, MarketScore};

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
        /// The whole bond was released and the record closed.
        BondWithdrawn { who: T::AccountId, amount: Balance },
        /// Accrued USDC was converted once, at the live rate, and paid in VIT.
        RewardsClaimed {
            who: T::AccountId,
            accrued: Balance,
            paid: Balance,
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
        /// Accrued reward is outstanding; claim it before closing the record.
        RewardsUnclaimed,
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

        /// Release the whole bond and close the record (08 §2.6).
        ///
        /// The gate is **epoch settlement**, never folding: folding deletes the
        /// last score entry while the debit settles at epoch close, so a
        /// fold-based gate would let a participant who folded a losing epoch
        /// release the whole bond ahead of the debit.
        #[pallet::call_index(2)]
        #[pallet::weight(T::WeightInfo::withdraw_bond())]
        pub fn withdraw_bond(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let record = Participants::<T>::get(&who).ok_or(Error::<T>::NotEnrolled)?;
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
                // Closing the record would destroy the claim, so refuse instead
                // and leave the claimant one call away from resolving it.
                ensure!(record.accrued == 0, Error::<T>::RewardsUnclaimed);
                let count = ParticipantCount::<T>::get()
                    .checked_sub(1)
                    .ok_or(Error::<T>::AccountingOverflow)?;
                Self::release_bond(&who, record.bond)?;
                Participants::<T>::remove(&who);
                ScoreCount::<T>::remove(&who);
                ParticipantCount::<T>::put(count);
                Self::deposit_event(Event::BondWithdrawn {
                    who: who.clone(),
                    amount: record.bond,
                });
                Ok(())
            })
        }

        /// Convert the accrued USDC figure to VIT once, at the live
        /// `fee.vit_usdc_rate`, and pay it from the authorized budget.
        ///
        /// 08 §2.6: both legs of the reward arithmetic are USDC and only the
        /// payout converts, rounding against the claimant. There is no vesting.
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
                Participants::<T>::insert(&who, record);
                TotalAccrued::<T>::put(total);
                Self::deposit_event(Event::RewardsClaimed {
                    who: who.clone(),
                    accrued,
                    paid,
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

        /// The single read TR4's hot path makes, once per fill.
        pub fn is_enrolled(who: &T::AccountId) -> bool {
            Participants::<T>::contains_key(who)
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
            for (who, _market, _score) in Scores::<T>::iter() {
                let counter = score_rows.entry(who).or_default();
                *counter = counter.checked_add(1).ok_or(TryRuntimeError::Other(
                    "trading-rewards: score row count overflow",
                ))?;
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
                // minimum. A zero bond is the post-debit suspended state.
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
                ensure!(
                    ScoreCount::<T>::get(&who) == score_rows.remove(&who).unwrap_or(0),
                    TryRuntimeError::Other("trading-rewards: ScoreCount disagrees with Scores")
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
    }
}
