#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! # `pallet-client-registry` — bonded external-client roster (N4)
//!
//! A thin FRAME shell over [`client_registry_core`]. Values governance admits
//! and removes exact XCM `Location`s; each admission places a native VIT hold.
//! Removal closes new-question admission immediately while retaining the
//! location, origin, bond, and live counter until the last question reaches a
//! terminal state. Spec: architecture 16 §2/§3.1/§9/§11, architecture 15 I-34.

extern crate alloc;

pub use client_registry_core;
pub use pallet::*;
pub use weights::WeightInfo;

pub mod weights;

#[cfg(feature = "runtime-benchmarks")]
mod benchmarking;
#[cfg(test)]
mod mock;
#[cfg(test)]
mod tests;

pub use client_registry_core::{
    ClientId, ClientRecord, Error as CoreError, IngressMeter, SubIdPolicy,
};

use futarchy_primitives::Balance;

/// Resolves one admitted identity to its only permissible USDC funder. The
/// caller never supplies this account on a float mutation.
pub trait ClientFunding<AccountId> {
    fn funding_account(client: ClientId) -> Option<AccountId>;
}

/// Maximum simultaneous registrations. Derived from the hard maximum of
/// `svc.max_live`: 64 distinct clients can own all 64 live service slots, while
/// idle registrations add no service capacity and can be replaced by values
/// governance. Architecture 13 §4 owns the bound.
pub const MAX_CLIENTS: u32 = futarchy_primitives::bounds::MAX_CLIENTS;

/// Live optional value for `svc.client_bond`. `None` is the intentional
/// `[VERIFY]` fail-closed state and admission returns `ClientBondUnset`.
pub trait ClientBondProvider {
    fn client_bond() -> Option<Balance>;
}

/// Origin and state construction used only by the benchmark harness.
#[cfg(feature = "runtime-benchmarks")]
pub trait BenchmarkHelper<RuntimeOrigin, AccountId> {
    fn values() -> RuntimeOrigin;
    fn client(client: ClientId) -> RuntimeOrigin;
    fn bond_owner() -> AccountId;
    fn prime_client_bond(value: Balance);
    fn prime_funds(who: &AccountId, value: Balance);
    fn prime_delivery_funds(who: &AccountId, value: Balance);
}

/// Succeeds only for this pallet's single custom-origin constructor and returns
/// the compact client id. The generic bounds are exactly those supplied by
/// `construct_runtime!` for a `#[pallet::origin]` enum.
pub struct EnsureExternalClient;

impl<O> frame_support::traits::EnsureOrigin<O> for EnsureExternalClient
where
    O: Into<Result<Origin, O>> + From<Origin>,
{
    type Success = ClientId;

    fn try_origin(origin: O) -> Result<Self::Success, O> {
        origin.into().map(|origin| match origin {
            Origin::ExternalClient(client_id) => client_id,
        })
    }

    #[cfg(feature = "runtime-benchmarks")]
    fn try_successful_origin() -> Result<O, ()> {
        Ok(O::from(Origin::ExternalClient(0)))
    }
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use alloc::vec::Vec;
    use frame_support::traits::{
        fungible::{Inspect, InspectHold, MutateHold},
        fungibles::{Inspect as InspectAsset, Mutate as MutateAsset},
        tokens::{Precision, Preservation},
        EnsureOrigin,
    };
    use frame_support::{pallet_prelude::*, PalletId};
    use frame_system::pallet_prelude::*;
    use sp_runtime::{SaturatedConversion, TryRuntimeError};
    use staging_xcm::latest::Location;

    const STORAGE_VERSION: StorageVersion = StorageVersion::new(0);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    /// Native VIT hold namespace owned by this pallet (B19 custody pattern).
    #[pallet::composite_enum]
    pub enum HoldReason {
        ClientBond,
    }

    #[pallet::config]
    pub trait Config: frame_system::Config<RuntimeEvent: From<Event<Self>>> {
        /// Values-track authority for both roster mutations (16 §2).
        type ValuesOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Exact registered-client authority for float top-up/withdrawal.
        type ClientOrigin: EnsureOrigin<Self::RuntimeOrigin, Success = ClientId>;

        /// Runtime-owned derivation of the only account allowed to fund or
        /// receive this client's delivery float.
        type ClientFunding: ClientFunding<Self::AccountId>;

        /// Optional live `svc.client_bond` value. Absence fails closed.
        type ClientBond: ClientBondProvider;

        /// Native VIT custody for registration bonds.
        type Currency: Inspect<Self::AccountId, Balance = Balance>
            + InspectHold<Self::AccountId, Reason = Self::RuntimeHoldReason>
            + MutateHold<Self::AccountId>;

        /// Aggregate runtime hold reason.
        type RuntimeHoldReason: From<HoldReason>;

        /// USDC custody. This is deliberately independent of native VIT holds.
        type DeliveryAssets: InspectAsset<Self::AccountId, Balance = Balance>
            + MutateAsset<Self::AccountId>;

        #[pallet::constant]
        type DeliveryAssetId: Get<<Self::DeliveryAssets as InspectAsset<Self::AccountId>>::AssetId>;

        /// Root for deterministic, disjoint per-client USDC escrow accounts.
        #[pallet::constant]
        type DeliveryFloatPalletId: Get<PalletId>;

        type WeightInfo: WeightInfo;

        #[cfg(feature = "runtime-benchmarks")]
        type BenchmarkHelper: BenchmarkHelper<Self::RuntimeOrigin, Self::AccountId>;
    }

    /// Canonical forward registry (16 §2).
    #[pallet::storage]
    pub type Clients<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        ClientId,
        ClientRecord<Location, T::AccountId>,
        OptionQuery,
    >;

    /// Exact-equality reverse registry. No prefix, alias, or descended-origin
    /// matching exists anywhere in this pallet.
    #[pallet::storage]
    pub type ClientIdOf<T: Config> =
        StorageMap<_, Blake2_128Concat, Location, ClientId, OptionQuery>;

    /// Exact-equality reverse index for locally authenticated services.
    #[pallet::storage]
    pub type ClientIdOfSigner<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, ClientId, OptionQuery>;

    /// The sub-id presence policy is not part of 02 §4a's frozen client row.
    #[pallet::storage]
    pub type ClientPolicies<T: Config> =
        StorageMap<_, Twox64Concat, ClientId, SubIdPolicy, OptionQuery>;

    /// Local account funding the native hold. Kept out of the canonical record
    /// because it is custody metadata, not external client identity.
    #[pallet::storage]
    pub type BondOwners<T: Config> =
        StorageMap<_, Twox64Concat, ClientId, T::AccountId, OptionQuery>;

    /// Removal tombstone. The canonical rows stay live while questions drain.
    #[pallet::storage]
    pub type RemovedClients<T: Config> = StorageMap<_, Twox64Concat, ClientId, (), OptionQuery>;

    /// TH-67 ingress plus I-36's isolated per-client egress diagnostics.
    #[pallet::storage]
    pub type IngressMeters<T: Config> =
        StorageMap<_, Twox64Concat, ClientId, IngressMeter, ValueQuery>;

    #[pallet::storage]
    pub type ClientCount<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Monotone allocator. Client ids are never reused after removal.
    #[pallet::storage]
    pub type NextClientId<T: Config> = StorageValue<_, ClientId, ValueQuery>;

    /// I-34's only custom-origin value. Carrying `ClientId` instead of
    /// `Location` keeps `OriginCaller` and scheduler agenda entries bounded.
    #[derive(
        Clone,
        Copy,
        Debug,
        Decode,
        DecodeWithMemTracking,
        Encode,
        Eq,
        MaxEncodedLen,
        PartialEq,
        TypeInfo,
    )]
    #[pallet::origin]
    pub enum Origin {
        ExternalClient(ClientId),
    }

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        ClientAdmitted {
            client_id: ClientId,
            location: Location,
            bond_owner: T::AccountId,
            bond: Balance,
            sub_id_policy: SubIdPolicy,
        },
        LocalClientAdmitted {
            client_id: ClientId,
            local_signer: T::AccountId,
            bond_owner: T::AccountId,
            bond: Balance,
            sub_id_policy: SubIdPolicy,
        },
        ClientRemovalStarted {
            client_id: ClientId,
            questions_live: u32,
        },
        ClientRemoved {
            client_id: ClientId,
            bond_owner: T::AccountId,
            bond_released: Balance,
        },
        EgressPrepaid {
            client_id: ClientId,
            beneficiary: T::AccountId,
            amount: Balance,
            delivery_float_remaining: Balance,
        },
        DeliveryFloatToppedUp {
            client_id: ClientId,
            amount: Balance,
            delivery_float: Balance,
        },
        DeliveryFloatWithdrawn {
            client_id: ClientId,
            amount: Balance,
            delivery_float: Balance,
        },
    }

    #[pallet::error]
    pub enum Error<T> {
        ClientBondUnset,
        DuplicateLocation,
        ClientsFull,
        ClientIdExhausted,
        NotRegistered,
        ClientRemoved,
        QuestionCounterOverflow,
        NoLiveQuestions,
        BondInsufficient,
        BondAccounting,
        DeliveryFloatAmountZero,
        DeliveryFloatInsufficient,
        DeliveryFloatWouldDrain,
        DeliveryFloatBelowMinimum,
        DeliveryFundingWouldDust,
        DeliveryFloatOverflow,
        DeliveryFloatAccounting,
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
        /// 13 §4's hard cap on simultaneous registered clients.
        #[pallet::constant_name(MaxClients)]
        fn max_clients() -> u32 {
            MAX_CLIENTS
        }

        /// Live optional admission bond. `None` is the intentional
        /// calibration-pending state and is visible without inventing a zero.
        #[pallet::constant_name(ClientBond)]
        fn client_bond() -> Option<Balance> {
            T::ClientBond::client_bond()
        }
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Admit an exact XCM location and hold the live `svc.client_bond`
        /// amount from its nominated local funder.
        #[pallet::call_index(0)]
        #[pallet::weight(T::WeightInfo::admit_client())]
        pub fn admit_client(
            origin: OriginFor<T>,
            location: Location,
            bond_owner: T::AccountId,
            sub_id_policy: SubIdPolicy,
        ) -> DispatchResult {
            T::ValuesOrigin::ensure_origin(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let location_taken = ClientIdOf::<T>::contains_key(&location);
                let admission = client_registry_core::admit_location::<_, T::AccountId>(
                    location,
                    sub_id_policy,
                    T::ClientBond::client_bond(),
                    client_registry_core::AdmissionContext {
                        admitted_at: Self::now(),
                        client_count: ClientCount::<T>::get(),
                        max_clients: MAX_CLIENTS,
                        next_client_id: NextClientId::<T>::get(),
                        location_taken,
                    },
                )
                .map_err(Self::map_core_error)?;

                let reason = Self::bond_reason();
                T::Currency::hold(&reason, &bond_owner, admission.record.bond)
                    .map_err(|_| Error::<T>::BondInsufficient)?;

                let client_id = admission.client_id;
                let bond = admission.record.bond;
                let location = admission
                    .record
                    .location
                    .clone()
                    .ok_or(Error::<T>::BondAccounting)?;
                ClientIdOf::<T>::insert(&location, client_id);
                ClientPolicies::<T>::insert(client_id, admission.sub_id_policy);
                BondOwners::<T>::insert(client_id, &bond_owner);
                Clients::<T>::insert(client_id, &admission.record);
                NextClientId::<T>::put(admission.next_client_id);
                ClientCount::<T>::put(ClientCount::<T>::get().saturating_add(1));
                Self::deposit_event(Event::ClientAdmitted {
                    client_id,
                    location,
                    bond_owner,
                    bond,
                    sub_id_policy,
                });
                Ok(())
            })
        }

        /// Admit one exact local signer. The identity account is also the only
        /// account the question service may debit for USDC escrow.
        #[pallet::call_index(2)]
        #[pallet::weight(T::WeightInfo::admit_local_client())]
        pub fn admit_local_client(
            origin: OriginFor<T>,
            local_signer: T::AccountId,
            bond_owner: T::AccountId,
            sub_id_policy: SubIdPolicy,
        ) -> DispatchResult {
            T::ValuesOrigin::ensure_origin(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let signer_taken = ClientIdOfSigner::<T>::contains_key(&local_signer);
                let admission = client_registry_core::admit_local::<Location, _>(
                    local_signer.clone(),
                    sub_id_policy,
                    T::ClientBond::client_bond(),
                    client_registry_core::AdmissionContext {
                        admitted_at: Self::now(),
                        client_count: ClientCount::<T>::get(),
                        max_clients: MAX_CLIENTS,
                        next_client_id: NextClientId::<T>::get(),
                        location_taken: signer_taken,
                    },
                )
                .map_err(Self::map_core_error)?;

                T::Currency::hold(&Self::bond_reason(), &bond_owner, admission.record.bond)
                    .map_err(|_| Error::<T>::BondInsufficient)?;
                let client_id = admission.client_id;
                let bond = admission.record.bond;
                ClientIdOfSigner::<T>::insert(&local_signer, client_id);
                ClientPolicies::<T>::insert(client_id, admission.sub_id_policy);
                BondOwners::<T>::insert(client_id, &bond_owner);
                Clients::<T>::insert(client_id, &admission.record);
                NextClientId::<T>::put(admission.next_client_id);
                ClientCount::<T>::put(ClientCount::<T>::get().saturating_add(1));
                Self::deposit_event(Event::LocalClientAdmitted {
                    client_id,
                    local_signer,
                    bond_owner,
                    bond,
                    sub_id_policy,
                });
                Ok(())
            })
        }

        /// Close new-question admission immediately. Existing questions retain
        /// the origin and bond until the final terminal notification.
        #[pallet::call_index(1)]
        #[pallet::weight(T::WeightInfo::remove_client())]
        pub fn remove_client(origin: OriginFor<T>, client_id: ClientId) -> DispatchResult {
            T::ValuesOrigin::ensure_origin(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let mut record = Clients::<T>::get(client_id).ok_or(Error::<T>::NotRegistered)?;
                ensure!(
                    !RemovedClients::<T>::contains_key(client_id),
                    Error::<T>::ClientRemoved
                );
                // Return the whole postage escrow before tombstoning. A failed
                // USDC refund rolls the values-track removal back whole.
                Self::refund_delivery_float(client_id, &mut record)?;
                RemovedClients::<T>::insert(client_id, ());
                Self::deposit_event(Event::ClientRemovalStarted {
                    client_id,
                    questions_live: record.questions_live,
                });
                if record.questions_live == 0 {
                    Self::finalize_removal(client_id, record)?;
                } else {
                    Clients::<T>::insert(client_id, record);
                }
                Ok(())
            })
        }

        /// Move exact USDC from this client's runtime-derived funding account
        /// into its deterministic delivery escrow.
        #[pallet::call_index(3)]
        #[pallet::weight(T::WeightInfo::top_up_delivery_float())]
        pub fn top_up_delivery_float(origin: OriginFor<T>, amount: Balance) -> DispatchResult {
            let client_id =
                T::ClientOrigin::ensure_origin(origin).map_err(|_| Error::<T>::NotRegistered)?;
            ensure!(amount > 0, Error::<T>::DeliveryFloatAmountZero);
            frame_support::storage::with_storage_layer(|| {
                ensure!(
                    !RemovedClients::<T>::contains_key(client_id),
                    Error::<T>::ClientRemoved
                );
                let mut record = Clients::<T>::get(client_id).ok_or(Error::<T>::NotRegistered)?;
                let funder = T::ClientFunding::funding_account(client_id)
                    .ok_or(Error::<T>::DeliveryFloatAccounting)?;
                // Keep an ordinary underfunded top-up distinct from a validly
                // funded amount that cannot create a live asset account.
                let funder_balance = T::DeliveryAssets::balance(T::DeliveryAssetId::get(), &funder);
                let funder_remaining = funder_balance
                    .checked_sub(amount)
                    .ok_or(Error::<T>::DeliveryFloatInsufficient)?;
                let minimum = T::DeliveryAssets::minimum_balance(T::DeliveryAssetId::get());
                let preservation = if funder_remaining == 0 {
                    Preservation::Expendable
                } else {
                    ensure!(
                        funder_remaining >= minimum,
                        Error::<T>::DeliveryFundingWouldDust
                    );
                    Preservation::Preserve
                };
                let after = record
                    .delivery_float
                    .checked_add(amount)
                    .ok_or(Error::<T>::DeliveryFloatOverflow)?;
                ensure!(after >= minimum, Error::<T>::DeliveryFloatBelowMinimum);
                let moved = T::DeliveryAssets::transfer(
                    T::DeliveryAssetId::get(),
                    &funder,
                    &Self::delivery_account(client_id),
                    amount,
                    preservation,
                )
                .map_err(|_| Error::<T>::DeliveryFloatAccounting)?;
                ensure!(moved == amount, Error::<T>::DeliveryFloatAccounting);
                record.delivery_float = after;
                Clients::<T>::insert(client_id, record);
                Self::deposit_event(Event::DeliveryFloatToppedUp {
                    client_id,
                    amount,
                    delivery_float: after,
                });
                Ok(())
            })
        }

        /// Return exact USDC only to the runtime-derived client funder.
        #[pallet::call_index(4)]
        #[pallet::weight(T::WeightInfo::withdraw_delivery_float())]
        pub fn withdraw_delivery_float(origin: OriginFor<T>, amount: Balance) -> DispatchResult {
            let client_id =
                T::ClientOrigin::ensure_origin(origin).map_err(|_| Error::<T>::NotRegistered)?;
            ensure!(amount > 0, Error::<T>::DeliveryFloatAmountZero);
            frame_support::storage::with_storage_layer(|| {
                ensure!(
                    !RemovedClients::<T>::contains_key(client_id),
                    Error::<T>::ClientRemoved
                );
                let mut record = Clients::<T>::get(client_id).ok_or(Error::<T>::NotRegistered)?;
                let after = record
                    .delivery_float
                    .checked_sub(amount)
                    .ok_or(Error::<T>::DeliveryFloatInsufficient)?;
                let preservation = if after == 0 {
                    Preservation::Expendable
                } else {
                    ensure!(
                        after >= T::DeliveryAssets::minimum_balance(T::DeliveryAssetId::get()),
                        Error::<T>::DeliveryFloatBelowMinimum
                    );
                    Preservation::Preserve
                };
                let funder = T::ClientFunding::funding_account(client_id)
                    .ok_or(Error::<T>::DeliveryFloatAccounting)?;
                let moved = T::DeliveryAssets::transfer(
                    T::DeliveryAssetId::get(),
                    &Self::delivery_account(client_id),
                    &funder,
                    amount,
                    preservation,
                )
                .map_err(|_| Error::<T>::DeliveryFloatAccounting)?;
                ensure!(moved == amount, Error::<T>::DeliveryFloatAccounting);
                record.delivery_float = after;
                Clients::<T>::insert(client_id, record);
                Self::deposit_event(Event::DeliveryFloatWithdrawn {
                    client_id,
                    amount,
                    delivery_float: after,
                });
                Ok(())
            })
        }
    }

    impl<T: Config> Pallet<T> {
        /// Exact registry lookup used by N8's converter. I-34's one-success-
        /// expression review point lives in that `ConvertOrigin` implementation;
        /// `RuntimeOrigin` itself is intentionally not a narrow return type.
        pub fn origin_for(location: &Location) -> Option<Origin> {
            ClientIdOf::<T>::get(location).map(Origin::ExternalClient)
        }

        pub fn client_id_of(location: &Location) -> Option<ClientId> {
            ClientIdOf::<T>::get(location)
        }

        pub fn client_id_of_signer(signer: &T::AccountId) -> Option<ClientId> {
            ClientIdOfSigner::<T>::get(signer)
        }

        pub fn sub_id_policy(client_id: ClientId) -> Option<SubIdPolicy> {
            ClientPolicies::<T>::get(client_id)
        }

        /// Read a client only when new-question admission remains open.
        pub fn active_client(
            client_id: ClientId,
        ) -> Result<ClientRecord<Location, T::AccountId>, DispatchError> {
            let record = Clients::<T>::get(client_id).ok_or(Error::<T>::NotRegistered)?;
            ensure!(
                !RemovedClients::<T>::contains_key(client_id),
                Error::<T>::ClientRemoved
            );
            Ok(record)
        }

        /// Question-service seam: atomically increment both client counters.
        pub fn note_question_registered(client_id: ClientId) -> DispatchResult {
            frame_support::storage::with_storage_layer(|| {
                let removed = RemovedClients::<T>::contains_key(client_id);
                Clients::<T>::try_mutate(client_id, |maybe_record| {
                    let record = maybe_record.as_mut().ok_or(Error::<T>::NotRegistered)?;
                    record
                        .register_question(removed)
                        .map_err(Self::map_core_error)
                })
            })
        }

        /// Question-service seam: decrement the live count and finalize a
        /// draining removal after its last question reaches terminal state.
        pub fn note_question_terminal(client_id: ClientId) -> DispatchResult {
            frame_support::storage::with_storage_layer(|| {
                let mut record = Clients::<T>::get(client_id).ok_or(Error::<T>::NotRegistered)?;
                let removed = RemovedClients::<T>::contains_key(client_id);
                let finalize = record
                    .finish_question(removed)
                    .map_err(Self::map_core_error)?;
                if finalize {
                    Self::finalize_removal(client_id, record)?;
                } else {
                    Clients::<T>::insert(client_id, record);
                }
                Ok(())
            })
        }

        /// N8 ingress seam. Metering remains available to a removed client
        /// while its live questions drain; missing/finalized clients fail.
        pub fn note_ingress(client_id: ClientId) -> DispatchResult {
            ensure!(
                Clients::<T>::contains_key(client_id),
                Error::<T>::NotRegistered
            );
            IngressMeters::<T>::mutate(client_id, |meter| meter.note(Self::now()));
            Ok(())
        }

        /// Isolated I-36 diagnostic. Saturation and even a missing row are
        /// never allowed to affect report publication or welfare state.
        pub fn note_report_push(client_id: ClientId, succeeded: bool) -> DispatchResult {
            ensure!(
                Clients::<T>::contains_key(client_id),
                Error::<T>::NotRegistered
            );
            IngressMeters::<T>::mutate(client_id, |meter| meter.note_report_push(succeeded));
            Ok(())
        }

        /// §9 seam: move an exact USDC fee out of the client's delivery escrow
        /// before egress. The native VIT bond is intentionally untouched.
        /// The caller is another runtime pallet/router, never an extrinsic; the
        /// destination and fee are chosen by that bounded path.
        ///
        /// Exact transfer, storage-layer rollback and the nonzero remainder are
        /// retained from N4's custody proof. `ForeignAssets` exposes no hold
        /// provider, so its deterministic keyless escrow is the USDC analogue
        /// of the old held balance; SQ-565 changes the asset and custody carrier,
        /// never the exact-debit/beneficiary semantics.
        pub fn prepay_egress(
            client_id: ClientId,
            beneficiary: &T::AccountId,
            amount: Balance,
        ) -> DispatchResult {
            frame_support::storage::with_storage_layer(|| {
                let mut record = Clients::<T>::get(client_id).ok_or(Error::<T>::NotRegistered)?;
                ensure!(amount > 0, Error::<T>::DeliveryFloatAmountZero);
                let delivery_float_remaining = record
                    .delivery_float
                    .checked_sub(amount)
                    .ok_or(Error::<T>::DeliveryFloatInsufficient)?;
                ensure!(
                    delivery_float_remaining > 0,
                    Error::<T>::DeliveryFloatWouldDrain
                );
                ensure!(
                    delivery_float_remaining
                        >= T::DeliveryAssets::minimum_balance(T::DeliveryAssetId::get()),
                    Error::<T>::DeliveryFloatBelowMinimum
                );
                let moved = T::DeliveryAssets::transfer(
                    T::DeliveryAssetId::get(),
                    &Self::delivery_account(client_id),
                    beneficiary,
                    amount,
                    Preservation::Preserve,
                )
                .map_err(|_| Error::<T>::DeliveryFloatAccounting)?;
                ensure!(moved == amount, Error::<T>::DeliveryFloatAccounting);
                record.delivery_float = delivery_float_remaining;
                Clients::<T>::insert(client_id, record);
                Self::deposit_event(Event::EgressPrepaid {
                    client_id,
                    beneficiary: beneficiary.clone(),
                    amount,
                    delivery_float_remaining,
                });
                Ok(())
            })
        }

        pub fn delivery_account(client_id: ClientId) -> T::AccountId {
            use sp_runtime::traits::AccountIdConversion;
            T::DeliveryFloatPalletId::get().into_sub_account_truncating(client_id)
        }

        pub fn is_removed(client_id: ClientId) -> bool {
            RemovedClients::<T>::contains_key(client_id)
        }

        pub fn do_try_state() -> Result<(), TryRuntimeError> {
            let mut rows = 0u32;
            let mut expected_holds: Vec<(T::AccountId, Balance)> = Vec::new();
            let reason = Self::bond_reason();

            for (client_id, record) in Clients::<T>::iter() {
                rows = rows.checked_add(1).ok_or(TryRuntimeError::Other(
                    "client-registry: client count overflow",
                ))?;
                ensure!(
                    rows <= MAX_CLIENTS,
                    TryRuntimeError::Other("client-registry: Clients over MaxClients")
                );
                ensure!(
                    record.identity_is_valid(),
                    TryRuntimeError::Other("client-registry: invalid identity cardinality")
                );
                let reverse_ok = record
                    .location
                    .as_ref()
                    .is_some_and(|location| ClientIdOf::<T>::get(location) == Some(client_id))
                    || record.local_signer.as_ref().is_some_and(|signer| {
                        ClientIdOfSigner::<T>::get(signer) == Some(client_id)
                    });
                ensure!(
                    reverse_ok,
                    TryRuntimeError::Other("client-registry: reverse identity index mismatch")
                );
                ensure!(
                    record.bond > 0,
                    TryRuntimeError::Other("client-registry: zero remaining bond")
                );
                ensure!(
                    record.questions_total >= record.questions_live,
                    TryRuntimeError::Other("client-registry: live questions exceed total")
                );
                ensure!(
                    record.delivery_float == 0
                        || record.delivery_float
                            >= T::DeliveryAssets::minimum_balance(T::DeliveryAssetId::get()),
                    TryRuntimeError::Other(
                        "client-registry: nonzero delivery float below asset minimum"
                    )
                );
                // The deterministic account is publicly addressable, so an
                // unrelated account can donate USDC to it. Surplus must not
                // make try-state (and therefore an upgrade) externally
                // haltable; only an under-backed accounting claim is unsafe.
                ensure!(
                    T::DeliveryAssets::balance(
                        T::DeliveryAssetId::get(),
                        &Self::delivery_account(client_id)
                    ) >= record.delivery_float,
                    TryRuntimeError::Other("client-registry: delivery float custody mismatch")
                );
                ensure!(
                    ClientPolicies::<T>::contains_key(client_id),
                    TryRuntimeError::Other("client-registry: missing client policy")
                );
                if RemovedClients::<T>::contains_key(client_id) {
                    ensure!(
                        record.questions_live > 0,
                        TryRuntimeError::Other(
                            "client-registry: removable tombstone not finalized"
                        )
                    );
                    ensure!(
                        record.delivery_float == 0,
                        TryRuntimeError::Other("client-registry: removed client retains float")
                    );
                }
                ensure!(
                    client_id < NextClientId::<T>::get(),
                    TryRuntimeError::Other("client-registry: allocated id beyond allocator")
                );
                let owner = BondOwners::<T>::get(client_id).ok_or(TryRuntimeError::Other(
                    "client-registry: missing bond owner",
                ))?;
                if let Some((_, expected)) = expected_holds
                    .iter_mut()
                    .find(|(known_owner, _)| known_owner == &owner)
                {
                    *expected = expected
                        .checked_add(record.bond)
                        .ok_or(TryRuntimeError::Other(
                            "client-registry: expected hold overflow",
                        ))?;
                } else {
                    expected_holds.push((owner, record.bond));
                }
            }

            ensure!(
                rows == ClientCount::<T>::get(),
                TryRuntimeError::Other("client-registry: ClientCount mismatch")
            );
            for (location, client_id) in ClientIdOf::<T>::iter() {
                let record = Clients::<T>::get(client_id).ok_or(TryRuntimeError::Other(
                    "client-registry: reverse index names missing client",
                ))?;
                ensure!(
                    record.location.as_ref() == Some(&location),
                    TryRuntimeError::Other("client-registry: reverse index location differs")
                );
            }
            for (signer, client_id) in ClientIdOfSigner::<T>::iter() {
                let record = Clients::<T>::get(client_id).ok_or(TryRuntimeError::Other(
                    "client-registry: signer index names missing client",
                ))?;
                ensure!(
                    record.local_signer.as_ref() == Some(&signer),
                    TryRuntimeError::Other("client-registry: reverse signer differs")
                );
            }
            for client_id in ClientPolicies::<T>::iter_keys() {
                ensure!(
                    Clients::<T>::contains_key(client_id),
                    TryRuntimeError::Other("client-registry: orphan client policy")
                );
            }
            for client_id in BondOwners::<T>::iter_keys() {
                ensure!(
                    Clients::<T>::contains_key(client_id),
                    TryRuntimeError::Other("client-registry: orphan bond owner")
                );
            }
            for client_id in RemovedClients::<T>::iter_keys() {
                ensure!(
                    Clients::<T>::contains_key(client_id),
                    TryRuntimeError::Other("client-registry: orphan removal tombstone")
                );
            }
            for (client_id, meter) in IngressMeters::<T>::iter() {
                ensure!(
                    Clients::<T>::contains_key(client_id),
                    TryRuntimeError::Other("client-registry: orphan ingress meter")
                );
                ensure!(
                    meter.report_push_failures_total <= meter.report_pushes_total,
                    TryRuntimeError::Other("client-registry: push failures exceed push attempts")
                );
                ensure!(
                    u64::from(meter.report_push_failures_consecutive)
                        <= meter.report_push_failures_total,
                    TryRuntimeError::Other(
                        "client-registry: consecutive push failures exceed failures"
                    )
                );
            }
            for (owner, expected) in expected_holds {
                ensure!(
                    T::Currency::balance_on_hold(&reason, &owner) == expected,
                    TryRuntimeError::Other("client-registry: native hold mismatch")
                );
            }
            Ok(())
        }

        fn finalize_removal(
            client_id: ClientId,
            record: ClientRecord<Location, T::AccountId>,
        ) -> DispatchResult {
            let owner = BondOwners::<T>::get(client_id).ok_or(Error::<T>::BondAccounting)?;
            let next_count = ClientCount::<T>::get()
                .checked_sub(1)
                .ok_or(Error::<T>::BondAccounting)?;
            if record.bond > 0 {
                T::Currency::release(&Self::bond_reason(), &owner, record.bond, Precision::Exact)
                    .map_err(|_| Error::<T>::BondAccounting)?;
            }
            if let Some(location) = record.location {
                ClientIdOf::<T>::remove(location);
            }
            if let Some(local_signer) = record.local_signer {
                ClientIdOfSigner::<T>::remove(local_signer);
            }
            Clients::<T>::remove(client_id);
            ClientPolicies::<T>::remove(client_id);
            BondOwners::<T>::remove(client_id);
            RemovedClients::<T>::remove(client_id);
            IngressMeters::<T>::remove(client_id);
            ClientCount::<T>::put(next_count);
            Self::deposit_event(Event::ClientRemoved {
                client_id,
                bond_owner: owner,
                bond_released: record.bond,
            });
            Ok(())
        }

        fn refund_delivery_float(
            client_id: ClientId,
            record: &mut ClientRecord<Location, T::AccountId>,
        ) -> DispatchResult {
            if record.delivery_float == 0 {
                return Ok(());
            }
            let funder = T::ClientFunding::funding_account(client_id)
                .ok_or(Error::<T>::DeliveryFloatAccounting)?;
            let amount = record.delivery_float;
            let moved = T::DeliveryAssets::transfer(
                T::DeliveryAssetId::get(),
                &Self::delivery_account(client_id),
                &funder,
                amount,
                Preservation::Expendable,
            )
            .map_err(|_| Error::<T>::DeliveryFloatAccounting)?;
            ensure!(moved == amount, Error::<T>::DeliveryFloatAccounting);
            record.delivery_float = 0;
            Ok(())
        }

        fn now() -> futarchy_primitives::BlockNumber {
            frame_system::Pallet::<T>::block_number().saturated_into::<u32>()
        }

        fn bond_reason() -> T::RuntimeHoldReason {
            HoldReason::ClientBond.into()
        }

        fn map_core_error(error: CoreError) -> DispatchError {
            match error {
                CoreError::ClientBondUnset => Error::<T>::ClientBondUnset.into(),
                CoreError::DuplicateLocation => Error::<T>::DuplicateLocation.into(),
                CoreError::ClientsFull => Error::<T>::ClientsFull.into(),
                CoreError::ClientIdExhausted => Error::<T>::ClientIdExhausted.into(),
                CoreError::NotRegistered => Error::<T>::NotRegistered.into(),
                CoreError::ClientRemoved => Error::<T>::ClientRemoved.into(),
                CoreError::QuestionCounterOverflow => Error::<T>::QuestionCounterOverflow.into(),
                CoreError::NoLiveQuestions => Error::<T>::NoLiveQuestions.into(),
            }
        }
    }
}
