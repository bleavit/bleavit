#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! Hosted conditional-question service (architecture 16, milestone N7).
//!
//! This pallet owns the bounded question lifecycle and service-fee/attestor
//! custody. Conditional claims are routed exclusively to ledger `Instance1`;
//! the two LMSR books are created through N6's external-pair API.

extern crate alloc;

pub use pallet::*;
pub use weights::WeightInfo;

pub mod weights;

#[cfg(feature = "runtime-benchmarks")]
mod benchmarking;
#[cfg(test)]
mod mock;
#[cfg(test)]
mod tests;

use frame_support::dispatch::DispatchResult;
use futarchy_primitives::{Balance, BlockNumber, ClientId, FixedU64};
use sp_runtime::Perbill;

/// Live constitution values consumed by registration and settlement. The fee
/// rate is intentionally optional: absence is the service arming gate.
pub trait ServiceParamsProvider {
    fn fee_rate() -> Option<Perbill>;
    fn max_live() -> u32;
    fn max_window() -> BlockNumber;
    fn epsilon_min() -> FixedU64;
    fn oracle_window() -> BlockNumber;
    fn oracle_rounds() -> u8;
    fn oracle_bond_bps() -> u32;
    fn attestor_bond_floor() -> Balance;
    fn flow_cap() -> FixedU64;
    /// 16 §8.6 ceiling on the scarcity multiplier. `None` while the row is
    /// unset, and that is **not** a refusal — it means `M = 1`, i.e. the flat
    /// two-part tariff. Contrast `fee_rate`, whose absence *is* the arming gate.
    fn price_cap() -> Option<FixedU64>;
}

/// Best-effort delivery result. Only the registry's isolated diagnostic meter
/// may observe it; report, lifecycle, settlement and welfare state may not.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReportPushOutcome {
    Sent,
    Failed,
    /// Local clients have no XCM destination and use the authoritative pull
    /// surface without creating a false failure alert.
    NotApplicable,
}

pub trait ReportPush {
    fn push(client: ClientId, report: &futarchy_primitives::ReportView) -> ReportPushOutcome;
}

impl ReportPush for () {
    fn push(_: ClientId, _: &futarchy_primitives::ReportView) -> ReportPushOutcome {
        ReportPushOutcome::NotApplicable
    }
}

/// Builds the exact N4 custom origin used by N6's external-book API.
pub trait ExternalMarketOrigin<RuntimeOrigin> {
    fn for_client(client: ClientId) -> RuntimeOrigin;
}

/// Read-only primary-decision schedule collision check.
pub trait DecisionWindowGuard {
    fn collides(start: BlockNumber, end: BlockNumber) -> bool;
}

/// Conservative global TVL reservation preflight for new service escrow.
pub trait TvlCapGate<AccountId> {
    fn escrow_admissible(funder: &AccountId, amount: Balance) -> bool;
}

/// Canonical conversion used only to feed N5's frame-free attestor core.
pub trait AccountIdBytes<AccountId> {
    fn into_bytes(account: &AccountId) -> [u8; 32];
}

/// Benchmark-only fixture seam.
#[cfg(feature = "runtime-benchmarks")]
pub trait BenchmarkHelper<RuntimeOrigin, AccountId> {
    fn client_origin(client: ClientId) -> RuntimeOrigin;
    fn report_egress_origin(client: ClientId) -> RuntimeOrigin;
    fn funder(client: ClientId) -> AccountId;
    fn attestor(index: u32) -> AccountId;
    fn prime_params();
    fn prime_client(client: ClientId, funder: &AccountId);
    fn prime_usdc(who: &AccountId, amount: Balance);
    fn prime_report_egress(client: ClientId);
    fn prime_register_scan(funder: &AccountId);
    fn prime_keeper_rebate() {}
    fn assert_keeper_rebate_paid(_: futarchy_primitives::keeper::CrankClass) {}
    fn advance_to(block: BlockNumber);
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use alloc::{collections::BTreeMap, vec::Vec};
    use frame_support::{
        pallet_prelude::*,
        traits::{
            fungibles::{Inspect, Mutate},
            tokens::Preservation,
            Contains, EnsureOrigin,
        },
        PalletId,
    };
    use frame_system::{ensure_signed, pallet_prelude::*};
    use futarchy_primitives::keeper::KeeperRebateSink;
    use futarchy_primitives::{
        bounds, kernel, Branch, MarketId, QuestionId, QuestionPhase, ReportView,
        SettlementTrust as SettlementTrustView, VaultState, VoidReason, H256,
    };
    use pallet_conditional_ledger::Instance1;
    use pallet_conditional_ledger::MainRevenueSink;
    use pallet_market::MarketAccountProvider;
    use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
    use question_service_core::{
        assemble_report, attestor_median, b_min, AttestorError, AttestorReport, ReportDraft,
        SettlementTrust,
    };
    use scale_info::TypeInfo;
    use sp_runtime::{
        traits::{AccountIdConversion, SaturatedConversion},
        DispatchError, TryRuntimeError,
    };

    type CollateralOf<T> = <T as pallet_conditional_ledger::Config<Instance1>>::Collateral;
    type AssetIdOf<T> =
        <CollateralOf<T> as Inspect<<T as frame_system::Config>::AccountId>>::AssetId;

    const STORAGE_VERSION: StorageVersion = StorageVersion::new(0);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config:
        frame_system::Config<RuntimeEvent: From<Event<Self>>>
        + pallet_client_registry::Config
        + pallet_market::Config
        + pallet_conditional_ledger::Config<Instance1>
    {
        type ServiceParams: ServiceParamsProvider;
        type ExternalMarketOrigin: ExternalMarketOrigin<Self::RuntimeOrigin>;
        type DecisionWindows: DecisionWindowGuard;
        type TvlCapGate: TvlCapGate<Self::AccountId>;
        /// Independent 03 §1a inflow-meter exemption predicate. Neither
        /// ledger's local account predicate may stand in for this one.
        type InflowCapExemptAccounts: Contains<Self::AccountId>;
        type AccountIdBytes: AccountIdBytes<Self::AccountId>;
        type ReportPush: ReportPush;

        /// Service-lifecycle sovereign. Distinct from both ledger sovereigns.
        #[pallet::constant]
        type PalletId: Get<PalletId>;

        type KeeperRebate: futarchy_primitives::keeper::KeeperRebateSink<Self::AccountId>;
        type WeightInfo: WeightInfo;

        #[cfg(feature = "runtime-benchmarks")]
        type BenchmarkHelper: BenchmarkHelper<Self::RuntimeOrigin, Self::AccountId>;
    }

    /// Exact 02 §4a direct-read row. Do not append internal settlement data.
    #[derive(
        Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
    )]
    pub struct QuestionRecord {
        pub client_id: ClientId,
        pub phase: QuestionPhase,
        pub window_start: BlockNumber,
        pub window_end: BlockNumber,
        pub declared_stake: Balance,
        pub epsilon_1e9: FixedU64,
        pub tolerance_1e9: FixedU64,
        pub markets: [MarketId; 2],
    }

    /// Fixed-data rule committed before either book trades (16 §4).
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
    pub struct ClientRule {
        pub min_accept_improvement_1e9: FixedU64,
    }

    #[derive(
        Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
    )]
    #[scale_info(skip_type_params(T))]
    pub struct QuestionTerms<T: Config> {
        pub sub_id: [u8; 32],
        pub funder: T::AccountId,
        pub rule: ClientRule,
        pub b: Balance,
        pub escrow: Balance,
        pub fee: Balance,
        pub bond_each: Balance,
        pub oracle_window: BlockNumber,
        pub seal_deadline: BlockNumber,
        pub attestors: BoundedVec<T::AccountId, ConstU32<{ bounds::MAX_SERVICE_ATTESTORS }>>,
        pub winner: Option<Branch>,
        pub sealed_at: Option<BlockNumber>,
        pub settlement_deadline: Option<BlockNumber>,
    }

    #[derive(
        Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
    )]
    pub struct RegisterInput<AccountId> {
        pub sub_id: Option<[u8; 32]>,
        pub declared_stake: Balance,
        pub epsilon_1e9: FixedU64,
        pub tolerance_1e9: FixedU64,
        pub window_start: BlockNumber,
        pub window_end: BlockNumber,
        pub b: Balance,
        pub rule: ClientRule,
        pub attestors: BoundedVec<AccountId, ConstU32<{ bounds::MAX_SERVICE_ATTESTORS }>>,
    }

    /// Contract-v22 question index (introduced at v21; 02 §4a).
    #[pallet::storage]
    pub type Questions<T: Config> =
        CountedStorageMap<_, Blake2_128Concat, QuestionId, QuestionRecord, OptionQuery>;

    /// Contract-v22 immutable report index (introduced at v21; 02 §4a).
    #[pallet::storage]
    pub type Reports<T: Config> =
        StorageMap<_, Blake2_128Concat, QuestionId, ReportView, OptionQuery>;

    /// Bounded internal terms not sold as part of the frozen frontend row.
    #[pallet::storage]
    pub type Terms<T: Config> =
        StorageMap<_, Blake2_128Concat, QuestionId, QuestionTerms<T>, OptionQuery>;

    /// One marker per named attestor, bounded by 16 per retained question.
    #[pallet::storage]
    pub type AttestorBonds<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        QuestionId,
        Blake2_128Concat,
        T::AccountId,
        (),
        OptionQuery,
    >;

    /// Latest in-window submission; overwrites are intentional (16 §6.3).
    #[pallet::storage]
    pub type Attestations<T: Config> = StorageDoubleMap<
        _,
        Blake2_128Concat,
        QuestionId,
        Blake2_128Concat,
        T::AccountId,
        FixedU64,
        OptionQuery,
    >;

    /// Pause impact is snapshotted per bounded live question so expiry or
    /// playbook reversion cannot erase the question's mandatory VOID edge.
    #[pallet::storage]
    pub type PauseAffected<T: Config> =
        StorageMap<_, Blake2_128Concat, QuestionId, (), OptionQuery>;

    #[pallet::storage]
    pub type PausedUntil<T: Config> = StorageValue<_, BlockNumber, OptionQuery>;

    #[pallet::storage]
    pub type NextServiceId<T: Config> = StorageValue<_, u64, ValueQuery>;

    #[pallet::storage]
    pub type LiveQuestionCount<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Aggregate posted external subsidy over live questions, in cash
    /// (`Σ 2·b·ln 2`) — the external side of 16 §8.4's arming condition.
    ///
    /// Exists because that condition had no implementation at all (SQ-575). It
    /// is a running total rather than a fold over `Terms` because the check runs
    /// on every `register` and `Terms` is unbounded in principle; a fold would
    /// put an O(live) read on an extrinsic that must stay O(1).
    #[pallet::storage]
    pub type LiveExternalDepth<T: Config> = StorageValue<_, Balance, ValueQuery>;

    /// 16 §8.6 scarcity state: `(multiplier, block it was last raised)`.
    ///
    /// `None` means the multiplier is at its floor of 1 — the flat tariff — so
    /// the common case costs one read and no arithmetic. Decay is applied
    /// lazily on read rather than by a hook: nothing else needs the value
    /// between registrations, and a hook would spend block weight every block
    /// to maintain a number only `register` consumes.
    #[pallet::storage]
    pub type ScarcityMultiplier<T: Config> = StorageValue<_, (FixedU64, BlockNumber), OptionQuery>;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        // Exact contract-v22 events (byte-identical to their v21 introduction).
        QuestionRegistered {
            question_id: QuestionId,
            client_id: ClientId,
            window_end: BlockNumber,
        },
        QuestionSealed {
            question_id: QuestionId,
            provenance_hash: H256,
        },
        QuestionSettled {
            question_id: QuestionId,
            value_1e9: FixedU64,
        },
        QuestionVoided {
            question_id: QuestionId,
            reason: VoidReason,
        },
        // Pallet-local diagnostics.
        AttestorBonded {
            question_id: QuestionId,
            attestor: T::AccountId,
            amount: Balance,
        },
        AttestationSubmitted {
            question_id: QuestionId,
            attestor: T::AccountId,
            value_1e9: FixedU64,
        },
        ServicePauseSet {
            until: BlockNumber,
        },
        ServicePauseCleared,
        QuestionArchived {
            question_id: QuestionId,
        },
    }

    #[pallet::error]
    pub enum Error<T> {
        NotRegistered,
        ClientRemoved,
        ServicePaused,
        ServiceRateUnset,
        CertificationUnavailable,
        StakeBelowFloor,
        /// 16 §8.4: admitting this question would push `Σ b_ext` above
        /// `Σ pol.b(live)`, making the external side the dominant market.
        ArmingBoundExceeded,
        SubsidyBelowMinimum,
        EpsilonOutOfRange,
        WindowTooLong,
        WindowTooShort,
        WindowCollidesWithDecision,
        SlotsExhausted,
        TvlCapWouldBind,
        AttestorSetTooSmall,
        AttestorBondInsufficient,
        ClientIsProtocolAccount,
        EscrowInsufficient,
        NotSealed,
        AlreadySealed,
        AlreadyTerminal,
        QuorumNotReached,
        MedianOutOfRange,
        DeadlineNotReached,
        UnknownQuestion,
        DeadlinePassed,
        CreationFrozen,
        DuplicateAttestor,
        UnknownAttestor,
        AlreadyBonded,
        InvalidSubId,
        ArithmeticOverflow,
        ArchiveNotReady,
        TryStateViolation,
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
        #[pallet::constant_name(FeeFloor)]
        fn fee_floor() -> Balance {
            kernel::SVC_FEE_FLOOR_USDC
        }

        #[pallet::constant_name(MaxLive)]
        fn max_live() -> u32 {
            T::ServiceParams::max_live()
        }

        #[pallet::constant_name(MaxWindow)]
        fn max_window() -> BlockNumber {
            T::ServiceParams::max_window()
        }

        #[pallet::constant_name(EpsilonMin)]
        fn epsilon_min() -> FixedU64 {
            T::ServiceParams::epsilon_min()
        }

        #[pallet::constant_name(AttestorsMin)]
        fn attestors_min() -> u32 {
            kernel::SVC_ATTESTORS_MIN
        }
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Register, escrow and create the exact two external books atomically.
        #[pallet::call_index(0)]
        #[pallet::weight(<T as Config>::WeightInfo::register(input.attestors.len() as u32))]
        pub fn register(
            origin: OriginFor<T>,
            input: RegisterInput<T::AccountId>,
        ) -> DispatchResult {
            let client = <T as pallet_client_registry::Config>::ClientOrigin::ensure_origin(origin)
                .map_err(|_| Error::<T>::NotRegistered)?;
            frame_support::storage::with_storage_layer(|| Self::do_register(client, input))
        }

        /// Authenticate and fund one client-named attestor promise.
        #[pallet::call_index(1)]
        #[pallet::weight(<T as Config>::WeightInfo::bond_attestor())]
        pub fn bond_attestor(origin: OriginFor<T>, question_id: QuestionId) -> DispatchResult {
            let attestor = ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| {
                let question =
                    Questions::<T>::get(question_id).ok_or(Error::<T>::UnknownQuestion)?;
                ensure!(
                    question.phase == QuestionPhase::Registered,
                    Error::<T>::AlreadySealed
                );
                let terms = Terms::<T>::get(question_id).ok_or(Error::<T>::TryStateViolation)?;
                ensure!(
                    terms.attestors.contains(&attestor),
                    Error::<T>::UnknownAttestor
                );
                ensure!(
                    !AttestorBonds::<T>::contains_key(question_id, &attestor),
                    Error::<T>::AlreadyBonded
                );
                Self::transfer(&attestor, &Self::account_id(), terms.bond_each)
                    .map_err(|_| Error::<T>::AttestorBondInsufficient)?;
                AttestorBonds::<T>::insert(question_id, &attestor, ());
                Self::deposit_event(Event::AttestorBonded {
                    question_id,
                    attestor,
                    amount: terms.bond_each,
                });
                Ok(())
            })
        }

        /// Atomically expose both pre-seeded books to trading.
        #[pallet::call_index(2)]
        #[pallet::weight(<T as Config>::WeightInfo::open())]
        pub fn open(origin: OriginFor<T>, question_id: QuestionId) -> DispatchResult {
            let client = <T as pallet_client_registry::Config>::ClientOrigin::ensure_origin(origin)
                .map_err(|_| Error::<T>::NotRegistered)?;
            frame_support::storage::with_storage_layer(|| {
                Questions::<T>::try_mutate(question_id, |maybe_question| -> DispatchResult {
                    let question = maybe_question.as_mut().ok_or(Error::<T>::UnknownQuestion)?;
                    ensure!(question.client_id == client, Error::<T>::NotRegistered);
                    ensure!(
                        question.phase == QuestionPhase::Registered,
                        Error::<T>::AlreadySealed
                    );
                    let now = Self::now();
                    ensure!(
                        now >= question.window_start && now < question.window_end,
                        Error::<T>::WindowTooShort
                    );
                    let terms =
                        Terms::<T>::get(question_id).ok_or(Error::<T>::TryStateViolation)?;
                    ensure!(
                        terms
                            .attestors
                            .iter()
                            .all(|who| AttestorBonds::<T>::contains_key(question_id, who)),
                        Error::<T>::AttestorBondInsufficient
                    );
                    question.phase = QuestionPhase::Open;
                    Ok(())
                })
            })
        }

        /// Seal both TWAP windows, publish the sold report, resolve the branch,
        /// and earn instrument D exactly once.
        #[pallet::call_index(3)]
        #[pallet::weight(<T as Config>::WeightInfo::seal())]
        pub fn seal(origin: OriginFor<T>, question_id: QuestionId) -> DispatchResult {
            let client = <T as pallet_client_registry::Config>::ClientOrigin::ensure_origin(origin)
                .map_err(|_| Error::<T>::NotRegistered)?;
            // The authoritative report commits before egress is attempted.
            // The outcome is then deliberately swallowed: a client can break
            // only its optional push leg, never publication or settlement.
            let report =
                frame_support::storage::with_storage_layer(|| Self::do_seal(client, question_id))?;
            Self::attempt_report_push(client, &report);
            Ok(())
        }

        /// Store the signed attestor's latest in-window value.
        #[pallet::call_index(4)]
        #[pallet::weight(<T as Config>::WeightInfo::submit_attestation())]
        pub fn submit_attestation(
            origin: OriginFor<T>,
            question_id: QuestionId,
            value_1e9: FixedU64,
        ) -> DispatchResult {
            let attestor = ensure_signed(origin)?;
            ensure!(
                value_1e9.0 <= kernel::SCORE_SCALE,
                Error::<T>::MedianOutOfRange
            );
            let question = Questions::<T>::get(question_id).ok_or(Error::<T>::UnknownQuestion)?;
            ensure!(
                question.phase == QuestionPhase::Sealed,
                Error::<T>::NotSealed
            );
            let terms = Terms::<T>::get(question_id).ok_or(Error::<T>::TryStateViolation)?;
            ensure!(
                terms.attestors.contains(&attestor),
                Error::<T>::UnknownAttestor
            );
            let sealed_at = terms.sealed_at.ok_or(Error::<T>::TryStateViolation)?;
            let deadline = terms
                .settlement_deadline
                .ok_or(Error::<T>::TryStateViolation)?;
            let now = Self::now();
            ensure!(now >= sealed_at, Error::<T>::DeadlineNotReached);
            ensure!(now < deadline, Error::<T>::DeadlinePassed);
            Attestations::<T>::insert(question_id, &attestor, value_1e9);
            Self::deposit_event(Event::AttestationSubmitted {
                question_id,
                attestor,
                value_1e9,
            });
            Ok(())
        }

        /// Permissionless successful/failing settlement crank after the frozen
        /// report window. Every error path becomes VOID in the same transaction.
        #[pallet::call_index(5)]
        #[pallet::weight(<T as Config>::WeightInfo::settle(bounds::MAX_SERVICE_ATTESTORS))]
        pub fn settle(origin: OriginFor<T>, question_id: QuestionId) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| Self::do_finalize_sealed(question_id))?;
            <T as Config>::KeeperRebate::rebate(
                &who,
                futarchy_primitives::keeper::CrankClass::General,
            );
            Ok(())
        }

        /// Permissionless clock-driven failure crank. For a sealed question it
        /// shares the terminalizer with `settle`, so transaction ordering can
        /// never VOID a valid quorum.
        #[pallet::call_index(6)]
        #[pallet::weight(<T as Config>::WeightInfo::void(bounds::MAX_SERVICE_ATTESTORS))]
        pub fn void(origin: OriginFor<T>, question_id: QuestionId) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| Self::do_void_crank(question_id))?;
            <T as Config>::KeeperRebate::rebate(
                &who,
                futarchy_primitives::keeper::CrankClass::General,
            );
            Ok(())
        }

        /// PB-HALT-INTAKE effect: stop new registration/seal work and mark every
        /// bounded live question for VOID at its next clock deadline.
        #[pallet::call_index(7)]
        #[pallet::weight(<T as Config>::WeightInfo::set_paused(bounds::MAX_CLIENTS))]
        pub fn set_paused(origin: OriginFor<T>, until: Option<BlockNumber>) -> DispatchResult {
            <T as pallet_conditional_ledger::Config<Instance1>>::EmergencyPlaybookOrigin::ensure_origin(origin)?;
            match until {
                Some(until) => {
                    ensure!(until > Self::now(), Error::<T>::DeadlineNotReached);
                    for (question_id, question) in Questions::<T>::iter() {
                        if !matches!(
                            question.phase,
                            QuestionPhase::Settled | QuestionPhase::Voided
                        ) {
                            PauseAffected::<T>::insert(question_id, ());
                        }
                    }
                    PausedUntil::<T>::put(until);
                    Self::deposit_event(Event::ServicePauseSet { until });
                }
                None => {
                    PausedUntil::<T>::kill();
                    Self::deposit_event(Event::ServicePauseCleared);
                }
            }
            Ok(())
        }

        /// Remove the external-pair capacity row and service-owned retained rows
        /// only after both books and the service-ledger vault completed reaping.
        #[pallet::call_index(8)]
        #[pallet::weight(<T as Config>::WeightInfo::archive(bounds::MAX_SERVICE_ATTESTORS))]
        pub fn archive(origin: OriginFor<T>, question_id: QuestionId) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::storage::with_storage_layer(|| -> DispatchResult {
                let question =
                    Questions::<T>::get(question_id).ok_or(Error::<T>::UnknownQuestion)?;
                ensure!(
                    matches!(
                        question.phase,
                        QuestionPhase::Settled | QuestionPhase::Voided
                    ),
                    Error::<T>::AlreadyTerminal
                );
                ensure!(
                    !pallet_conditional_ledger::Vaults::<T, Instance1>::contains_key(question_id),
                    Error::<T>::ArchiveNotReady
                );
                // The N6 pair row is the retained-capacity latch. It has no
                // independent public call: the service owns its lifecycle and
                // removes it atomically with the question rows after the market
                // helper proves both books and their vault are gone.
                pallet_market::Pallet::<T>::archive_external_pair(
                    frame_system::RawOrigin::Signed(who.clone()).into(),
                    question_id,
                )
                .map_err(|_| Error::<T>::ArchiveNotReady)?;
                let terms = Terms::<T>::take(question_id).ok_or(Error::<T>::TryStateViolation)?;
                for attestor in terms.attestors {
                    AttestorBonds::<T>::remove(question_id, &attestor);
                    Attestations::<T>::remove(question_id, &attestor);
                }
                Questions::<T>::remove(question_id);
                Reports::<T>::remove(question_id);
                PauseAffected::<T>::remove(question_id);
                Self::deposit_event(Event::QuestionArchived { question_id });
                Ok(())
            })?;
            <T as Config>::KeeperRebate::rebate(
                &who,
                futarchy_primitives::keeper::CrankClass::General,
            );
            Ok(())
        }
    }

    impl<T: Config> Pallet<T> {
        /// Run the optional delivery leg after authoritative publication. This
        /// is deliberately non-dispatchable: neither destination nor payload
        /// is supplied by a user, and no outcome escapes into protocol state.
        pub fn attempt_report_push(client: ClientId, report: &ReportView) {
            match T::ReportPush::push(client, report) {
                ReportPushOutcome::Sent => {
                    let _ = pallet_client_registry::Pallet::<T>::note_report_push(client, true);
                }
                ReportPushOutcome::Failed => {
                    let _ = pallet_client_registry::Pallet::<T>::note_report_push(client, false);
                }
                ReportPushOutcome::NotApplicable => {}
            }
        }

        pub fn account_id() -> T::AccountId {
            <T as Config>::PalletId::get().into_account_truncating()
        }

        pub fn trading_open(question_id: QuestionId) -> bool {
            Questions::<T>::get(question_id)
                .is_some_and(|question| question.phase == QuestionPhase::Open)
        }

        pub fn hosted_report(question_id: QuestionId) -> Option<ReportView> {
            Reports::<T>::get(question_id)
        }

        /// 16 §8.6: the scarcity multiplier as of now, on the `SCORE_SCALE` grid.
        ///
        /// Linear decay toward 1 over `svc.max_window`, so a price cannot
        /// outlive the demand that set it. Linear rather than exponential
        /// because runtime code carries no transcendentals outside the
        /// `futarchy-fixed` kernel, and the property that matters — a freed slot
        /// descends rather than dropping — holds under either shape.
        ///
        /// Returns exactly `SCORE_SCALE` (M = 1) when the ceiling row is unset,
        /// when nothing has been raised, or once a full window has elapsed.
        pub fn scarcity_multiplier() -> FixedU64 {
            let one = FixedU64(kernel::SCORE_SCALE);
            if T::ServiceParams::price_cap().is_none() {
                return one;
            }
            let Some((raised_to, raised_at)) = ScarcityMultiplier::<T>::get() else {
                return one;
            };
            if raised_to.0 <= one.0 {
                return one;
            }
            let window = T::ServiceParams::max_window();
            if window == 0 {
                return one;
            }
            let elapsed = Self::now().saturating_sub(raised_at);
            if elapsed >= window {
                return one;
            }
            // excess * (window - elapsed) / window, in u128 so the product of a
            // 1e9-grid excess and a block count cannot overflow.
            let excess = u128::from(raised_to.0.saturating_sub(one.0));
            let remaining = u128::from(window.saturating_sub(elapsed));
            let decayed = excess
                .saturating_mul(remaining)
                .checked_div(u128::from(window))
                .unwrap_or(0);
            FixedU64(one.0.saturating_add(decayed.try_into().unwrap_or(u64::MAX)))
        }

        /// Test-only alias. `raise_scarcity` stays private so no production
        /// caller can move the price outside `register`.
        #[cfg(test)]
        pub fn raise_scarcity_for_test() {
            Self::raise_scarcity();
        }

        /// Raise the multiplier by one admission's worth, capped.
        ///
        /// The step is additive — `(cap - 1) / max_live` — so taking every slot
        /// at once arrives exactly at the ceiling and never past it, in exact
        /// integer arithmetic.
        fn raise_scarcity() {
            let Some(cap) = T::ServiceParams::price_cap() else {
                return;
            };
            let one = kernel::SCORE_SCALE;
            if cap.0 <= one {
                return;
            }
            let max_live = T::ServiceParams::max_live();
            if max_live == 0 {
                return;
            }
            let step = cap.0.saturating_sub(one) / u64::from(max_live);
            let current = Self::scarcity_multiplier().0;
            let raised = current.saturating_add(step).min(cap.0);
            ScarcityMultiplier::<T>::put((FixedU64(raised), Self::now()));
        }

        fn do_register(client: ClientId, input: RegisterInput<T::AccountId>) -> DispatchResult {
            let fee_rate = T::ServiceParams::fee_rate().ok_or(Error::<T>::ServiceRateUnset)?;
            Self::ensure_not_paused()?;
            let client_record = pallet_client_registry::Pallet::<T>::active_client(client)
                .map_err(Self::map_client_registration_error)?;
            let funder = <<T as pallet_client_registry::Config>::ClientFunding as
                pallet_client_registry::ClientFunding<T::AccountId>>::funding_account(client)
                .ok_or(Error::<T>::NotRegistered)?;
            ensure!(client_record.identity_is_valid(), Error::<T>::NotRegistered);
            ensure!(
                !<T as pallet_conditional_ledger::Config<()>>::ReservedProtocolDestinations::contains(&funder)
                    && !<T as pallet_conditional_ledger::Config<()>>::ProtocolAccounts::contains(&funder)
                    && !<T as pallet_conditional_ledger::Config<Instance1>>::ProtocolAccounts::contains(&funder)
                    && !T::InflowCapExemptAccounts::contains(&funder),
                Error::<T>::ClientIsProtocolAccount
            );

            let max_live = T::ServiceParams::max_live();
            ensure!(
                max_live > 0
                    && max_live <= bounds::MAX_CLIENTS
                    && LiveQuestionCount::<T>::get() < max_live,
                Error::<T>::SlotsExhausted
            );
            ensure!(
                Questions::<T>::count() < bounds::MAX_CLIENTS,
                Error::<T>::SlotsExhausted
            );
            ensure!(
                Self::service_ledger_solvent(),
                Error::<T>::EscrowInsufficient
            );
            ensure!(input.declared_stake > 0, Error::<T>::StakeBelowFloor);
            ensure!(
                input.epsilon_1e9.0 >= T::ServiceParams::epsilon_min().0
                    && input.epsilon_1e9.0 < kernel::SCORE_SCALE / 2,
                Error::<T>::EpsilonOutOfRange
            );
            ensure!(
                input.tolerance_1e9.0 <= kernel::SVC_TOLERANCE_MAX_1E9,
                Error::<T>::MedianOutOfRange
            );
            ensure!(
                input.rule.min_accept_improvement_1e9.0 <= kernel::SCORE_SCALE,
                Error::<T>::EpsilonOutOfRange
            );
            let now = Self::now();
            ensure!(
                input.window_start > now && input.window_end > input.window_start,
                Error::<T>::WindowTooShort
            );
            let width = input
                .window_end
                .checked_sub(input.window_start)
                .ok_or(Error::<T>::WindowTooShort)?;
            let oracle_window = T::ServiceParams::oracle_window();
            let seal_deadline = input
                .window_end
                .checked_add(oracle_window)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let minimum_width = <T as pallet_market::Config>::ObsInterval::get()
                .checked_mul(2)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            ensure!(
                u64::from(width) >= minimum_width,
                Error::<T>::WindowTooShort
            );
            ensure!(
                width <= T::ServiceParams::max_window(),
                Error::<T>::WindowTooLong
            );
            ensure!(
                !T::DecisionWindows::collides(input.window_start, input.window_end),
                Error::<T>::WindowCollidesWithDecision
            );
            ensure!(
                input.attestors.len() >= kernel::SVC_ATTESTORS_MIN as usize,
                Error::<T>::AttestorSetTooSmall
            );
            ensure!(
                !input.attestors.iter().enumerate().any(|(index, who)| input
                    .attestors
                    .iter()
                    .skip(index.saturating_add(1))
                    .any(|other| other == who)),
                Error::<T>::DuplicateAttestor
            );
            let policy = pallet_client_registry::Pallet::<T>::sub_id_policy(client)
                .ok_or(Error::<T>::NotRegistered)?;
            let sub_id = match (policy, input.sub_id) {
                (pallet_client_registry::SubIdPolicy::Required, None) => {
                    return Err(Error::<T>::InvalidSubId.into())
                }
                (_, Some(value)) => value,
                (pallet_client_registry::SubIdPolicy::Optional, None) => [0; 32],
            };

            let minimum_b = b_min(input.declared_stake, input.epsilon_1e9)
                .map_err(|_| Error::<T>::CertificationUnavailable)?;
            ensure!(input.b >= minimum_b, Error::<T>::SubsidyBelowMinimum);
            // N6 posts the claimant-adverse ceiling of `b * ln(2)` per book.
            // Preflighting the downward diagnostic floor understates real
            // custody by up to one base unit per book, weakening both the TVL
            // gate and the value-scaled attestor bond.
            let headroom = pallet_market::core_market::seed_headroom(input.b)
                .map_err(|_| Error::<T>::CertificationUnavailable)?;
            let escrow = headroom
                .checked_mul(2)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let proportional_fee = Self::mul_perbill_ceil(input.declared_stake, fee_rate)?;
            let base_fee = proportional_fee.max(kernel::SVC_FEE_FLOOR_USDC);
            // 16 §8.6: scale the tariff by the scarcity multiplier. Rounds UP
            // (R-7, against the party relying on the charge being small), and
            // is exactly `base_fee` whenever `M = 1`, which is the unset-ceiling
            // default — so the flat-tariff path is bit-identical to pre-N14.
            let multiplier = Self::scarcity_multiplier();
            let fee = if multiplier.0 == kernel::SCORE_SCALE {
                base_fee
            } else {
                let scaled = base_fee
                    .checked_mul(u128::from(multiplier.0))
                    .ok_or(Error::<T>::ArithmeticOverflow)?;
                let one = u128::from(kernel::SCORE_SCALE);
                scaled
                    .checked_add(one.saturating_sub(1))
                    .ok_or(Error::<T>::ArithmeticOverflow)?
                    .checked_div(one)
                    .ok_or(Error::<T>::ArithmeticOverflow)?
            };
            let required = escrow
                .checked_add(fee)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            ensure!(
                T::TvlCapGate::escrow_admissible(&funder, escrow),
                Error::<T>::TvlCapWouldBind
            );
            ensure!(
                CollateralOf::<T>::balance(Self::usdc(), &funder) >= required,
                Error::<T>::EscrowInsufficient
            );
            // 16 §8.4's external side (SQ-575). `Σ b_ext` is *accounted* here and
            // asserted by try-state; it is deliberately **not** compared against
            // `Σ pol.b(live)` at this site, and the reason is a measured one
            // rather than an omission.
            //
            // `LivePolCommitments` holds protocol subsidy only while decision
            // books are seeded, so the instantaneous sum is zero for most of an
            // epoch. Enforcing `Σ b_ext ≤ Σ pol.b(live)` here would therefore
            // refuse essentially every registration outside Bleavit's own
            // decision windows — 21 of this pallet's 28 tests fail that way, not
            // because the tests are wrong but because the mock has no live POL,
            // which is also the chain's ordinary state between windows.
            //
            // 16 §8.4 says the bound holds "at switch-on"; the Phase-4 transition
            // enforces exactly that, against this total. Whether it must also
            // hold *continuously* — and if so against what non-blinking measure,
            // since the instantaneous one cannot be it — is a design question
            // with no derivable answer yet and is tracked in SQ-575 rather than
            // guessed at here. Accounting first; the bound it enables can only
            // be as good as the measure it compares against.
            let external_after = LiveExternalDepth::<T>::get()
                .checked_add(escrow)
                .ok_or(Error::<T>::ArithmeticOverflow)?;

            let bond_each = Self::attestor_bond(escrow)?;
            let bond_total = bond_each
                .checked_mul(input.attestors.len() as u128)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            ensure!(bond_total > 0, Error::<T>::AttestorBondInsufficient);
            let (question_id, accept, reject, next) = Self::allocate_ids()?;
            let market_origin = T::ExternalMarketOrigin::for_client(client);
            let accept_account = <T as pallet_market::Config>::MarketAccounts::book(accept);
            let accept_fees = <T as pallet_market::Config>::MarketAccounts::fees(accept);
            let reject_account = <T as pallet_market::Config>::MarketAccounts::book(reject);
            let reject_fees = <T as pallet_market::Config>::MarketAccounts::fees(reject);

            pallet_market::Pallet::<T>::create_external_pair(
                market_origin,
                pallet_market::ExternalPairInput {
                    question: question_id,
                    client,
                    funder: funder.clone(),
                    accept,
                    accept_account,
                    accept_fees,
                    reject,
                    reject_account,
                    reject_fees,
                    b: input.b,
                },
            )
            .map_err(Self::map_external_market_error)?;
            pallet_market::Pallet::<T>::seed_external_pair(
                T::ExternalMarketOrigin::for_client(client),
                question_id,
                funder.clone(),
            )
            .map_err(Self::map_external_market_error)?;
            let trailing_start = input.window_start + width / 2;
            for market in [accept, reject] {
                pallet_market::Pallet::<T>::register_decision_window(
                    T::ExternalMarketOrigin::for_client(client),
                    market,
                    question_id,
                    input.window_start,
                    trailing_start,
                    input.window_end,
                )
                .map_err(Self::map_external_market_error)?;
            }
            // Registration is allowed to consume the client's exact
            // escrow-plus-fee balance. The fee is the final debit from that
            // funding account, so preserving an asset account minimum here
            // would manufacture a hidden extra funding requirement.
            Self::transfer_expendable(&funder, &Self::account_id(), fee)?;
            pallet_client_registry::Pallet::<T>::note_question_registered(client)
                .map_err(Self::map_client_registration_error)?;

            Questions::<T>::insert(
                question_id,
                QuestionRecord {
                    client_id: client,
                    phase: QuestionPhase::Registered,
                    window_start: input.window_start,
                    window_end: input.window_end,
                    declared_stake: input.declared_stake,
                    epsilon_1e9: input.epsilon_1e9,
                    tolerance_1e9: input.tolerance_1e9,
                    markets: [accept, reject],
                },
            );
            Terms::<T>::insert(
                question_id,
                QuestionTerms::<T> {
                    sub_id,
                    funder,
                    rule: input.rule,
                    b: input.b,
                    escrow,
                    fee,
                    bond_each,
                    oracle_window,
                    seal_deadline,
                    attestors: input.attestors,
                    winner: None,
                    sealed_at: None,
                    settlement_deadline: None,
                },
            );
            NextServiceId::<T>::put(next);
            LiveQuestionCount::<T>::put(
                LiveQuestionCount::<T>::get()
                    .checked_add(1)
                    .ok_or(Error::<T>::ArithmeticOverflow)?,
            );
            // `external_after` was computed under the same admission checks
            // above and is the post-state by construction, so this cannot
            // disagree with what the arming bound was evaluated against.
            LiveExternalDepth::<T>::put(external_after);
            // Raise AFTER the fee for this admission is fixed: the arriving
            // client pays the price its arrival found, not the one it created.
            Self::raise_scarcity();
            Self::deposit_event(Event::QuestionRegistered {
                question_id,
                client_id: client,
                window_end: input.window_end,
            });
            Ok(())
        }

        fn do_seal(client: ClientId, question_id: QuestionId) -> Result<ReportView, DispatchError> {
            Self::ensure_not_paused()?;
            let mut question =
                Questions::<T>::get(question_id).ok_or(Error::<T>::UnknownQuestion)?;
            ensure!(question.client_id == client, Error::<T>::NotRegistered);
            match question.phase {
                QuestionPhase::Open => {}
                QuestionPhase::Registered => return Err(Error::<T>::NotSealed.into()),
                QuestionPhase::Sealed => return Err(Error::<T>::AlreadySealed.into()),
                QuestionPhase::Settled | QuestionPhase::Voided => {
                    return Err(Error::<T>::AlreadyTerminal.into())
                }
            }
            ensure!(
                Self::now() >= question.window_end,
                Error::<T>::DeadlineNotReached
            );
            let mut terms = Terms::<T>::get(question_id).ok_or(Error::<T>::TryStateViolation)?;
            ensure!(
                Self::now() < terms.seal_deadline,
                Error::<T>::DeadlinePassed
            );
            for market in question.markets {
                pallet_market::Pallet::<T>::seal_decision_window(
                    T::ExternalMarketOrigin::for_client(client),
                    market,
                    question.window_end,
                )?;
            }
            let width = question
                .window_end
                .checked_sub(question.window_start)
                .ok_or(Error::<T>::CertificationUnavailable)?;
            let twap_accept = pallet_market::Pallet::<T>::twap_at(
                question.markets[0],
                question.window_end,
                width,
            )
            .ok_or(Error::<T>::CertificationUnavailable)?;
            let twap_reject = pallet_market::Pallet::<T>::twap_at(
                question.markets[1],
                question.window_end,
                width,
            )
            .ok_or(Error::<T>::CertificationUnavailable)?;
            let observations = question
                .markets
                .into_iter()
                .filter_map(|market| {
                    pallet_market::DecisionWindows::<T>::get(market)
                        .into_iter()
                        .find(|window| window.end == question.window_end)
                        .map(|window| window.observations)
                })
                .min()
                .ok_or(Error::<T>::CertificationUnavailable)?;
            let contest_accept = pallet_market::Pallet::<T>::average_contest_at(
                question.markets[0],
                question.window_end,
                width,
            )
            .ok_or(Error::<T>::CertificationUnavailable)?;
            let contest_reject = pallet_market::Pallet::<T>::average_contest_at(
                question.markets[1],
                question.window_end,
                width,
            )
            .ok_or(Error::<T>::CertificationUnavailable)?;
            let contest = contest_accept
                .checked_add(contest_reject)
                .ok_or(Error::<T>::CertificationUnavailable)?;
            let mut attestor_bytes: futarchy_primitives::BoundedVec<
                [u8; 32],
                { bounds::MAX_SERVICE_ATTESTORS },
            > = futarchy_primitives::BoundedVec::new();
            for attestor in &terms.attestors {
                attestor_bytes
                    .try_push(T::AccountIdBytes::into_bytes(attestor))
                    .map_err(|_| Error::<T>::AttestorSetTooSmall)?;
            }
            let bond_total = terms
                .bond_each
                .checked_mul(terms.attestors.len() as u128)
                .ok_or(Error::<T>::CertificationUnavailable)?;
            let trust = SettlementTrust::new(attestor_bytes, bond_total)
                .map_err(|_| Error::<T>::AttestorSetTooSmall)?;
            let report = assemble_report(
                ReportDraft {
                    question_id,
                    client_id: client,
                    sub_id: terms.sub_id,
                    twap_accept_1e9: twap_accept,
                    twap_reject_1e9: twap_reject,
                    observations,
                    window_start: question.window_start,
                    window_end: question.window_end,
                    b_accept: terms.b,
                    b_reject: terms.b,
                    declared_stake: question.declared_stake,
                    epsilon_1e9: question.epsilon_1e9,
                    // Frozen at registration and republished verbatim: 02 §4a
                    // makes it contract surface precisely so a widened value
                    // cannot excuse an otherwise-slashable submission unseen.
                    tolerance_1e9: question.tolerance_1e9,
                    settlement_trust: trust,
                },
                contest,
                T::ServiceParams::flow_cap(),
                sp_io::hashing::blake2_256,
            )
            .map_err(|_| Error::<T>::CertificationUnavailable)?;
            let threshold = twap_reject
                .0
                .checked_add(terms.rule.min_accept_improvement_1e9.0);
            let winner = if threshold.is_some_and(|minimum| twap_accept.0 >= minimum) {
                Branch::Accept
            } else {
                Branch::Reject
            };
            pallet_conditional_ledger::Pallet::<T, Instance1>::resolve(
                frame_system::RawOrigin::Signed(Self::account_id()).into(),
                question_id,
                winner,
            )?;
            // The WHOLE fee — floor plus any 16 §8.6 scarcity premium — lands in
            // `MAIN`. Crediting the premium straight to POL would need this
            // pallet to name Bleavit's protocol subsidy custody account, which
            // is a second money path into that custody where §7.2-§7.5 leave
            // exactly one (the Sweep returning what POL itself spent). The
            // premium is recoverable off-chain without a new event or field:
            // `terms.fee - max(fee_floor, fee_rate * declared_stake)`.
            Self::transfer(
                &Self::account_id(),
                &<T as pallet_conditional_ledger::Config<Instance1>>::TreasuryMainAccount::get(),
                terms.fee,
            )?;
            <T as pallet_conditional_ledger::Config<Instance1>>::MainRevenueSink::credit_main(
                terms.fee,
            )?;
            let now = Self::now();
            let deadline = now
                .checked_add(terms.oracle_window)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let view = ReportView {
                question_id: report.question_id,
                client_id: report.client_id,
                sub_id: report.sub_id,
                twap_accept_1e9: report.twap_accept_1e9,
                twap_reject_1e9: report.twap_reject_1e9,
                observations: report.observations,
                window_start: report.window_start,
                window_end: report.window_end,
                b_accept: report.b_accept,
                b_reject: report.b_reject,
                manip_floor: report.manip_floor,
                declared_stake: report.declared_stake,
                epsilon_1e9: report.epsilon_1e9,
                tolerance_1e9: report.tolerance_1e9,
                certified: report.certified,
                settlement_trust: SettlementTrustView {
                    attestors: report.settlement_trust.attestor_count() as u32,
                    quorum: report.settlement_trust.quorum(),
                    bond_total: report.settlement_trust.bond_total(),
                },
                provenance_hash: report.provenance_hash,
            };
            ensure!(
                question_service_core::verify_report_view_provenance(
                    &view,
                    sp_io::hashing::blake2_256,
                ),
                Error::<T>::CertificationUnavailable
            );
            question.phase = QuestionPhase::Sealed;
            terms.winner = Some(winner);
            terms.sealed_at = Some(now);
            terms.settlement_deadline = Some(deadline);
            Reports::<T>::insert(question_id, &view);
            Questions::<T>::insert(question_id, question);
            Terms::<T>::insert(question_id, terms);
            Self::deposit_event(Event::QuestionSealed {
                question_id,
                provenance_hash: view.provenance_hash,
            });
            Ok(view)
        }

        fn do_finalize_sealed(question_id: QuestionId) -> DispatchResult {
            let question = Questions::<T>::get(question_id).ok_or(Error::<T>::UnknownQuestion)?;
            ensure!(
                question.phase == QuestionPhase::Sealed,
                Error::<T>::NotSealed
            );
            let terms = Terms::<T>::get(question_id).ok_or(Error::<T>::TryStateViolation)?;
            let deadline = terms
                .settlement_deadline
                .ok_or(Error::<T>::TryStateViolation)?;
            ensure!(Self::now() >= deadline, Error::<T>::DeadlineNotReached);
            if !Self::service_ledger_solvent() {
                return Self::terminal_void(
                    question_id,
                    question,
                    &terms,
                    VoidReason::EscrowInsufficient,
                );
            }
            if PauseAffected::<T>::contains_key(question_id) {
                return Self::terminal_void(
                    question_id,
                    question,
                    &terms,
                    VoidReason::ServicePaused,
                );
            }
            let reports = Self::attestor_reports(question_id, &terms);
            match attestor_median(
                &terms
                    .attestors
                    .iter()
                    .map(T::AccountIdBytes::into_bytes)
                    .collect::<Vec<_>>(),
                &reports,
                question.tolerance_1e9,
            ) {
                Ok(median) => {
                    let _winner = terms.winner.ok_or(Error::<T>::TryStateViolation)?;
                    pallet_conditional_ledger::Pallet::<T, Instance1>::settle_scalar(
                        frame_system::RawOrigin::Signed(Self::account_id()).into(),
                        question_id,
                        median.value(),
                    )?;
                    pallet_market::Pallet::<T>::observe_external_terminal(question_id)?;
                    Self::distribute_bonds(question_id, &terms, Some(median))?;
                    Self::finish_question(question_id, question.client_id, QuestionPhase::Settled)?;
                    Self::deposit_event(Event::QuestionSettled {
                        question_id,
                        value_1e9: median.value(),
                    });
                    Ok(())
                }
                Err(AttestorError::QuorumNotReached) => {
                    Self::terminal_void(question_id, question, &terms, VoidReason::NoQuorum)
                }
                Err(AttestorError::MedianOutOfRange | AttestorError::ToleranceOutOfRange) => {
                    Self::terminal_void(question_id, question, &terms, VoidReason::MedianOutOfRange)
                }
                Err(_) => Self::terminal_void(
                    question_id,
                    question,
                    &terms,
                    VoidReason::AttestorSetCollapsed,
                ),
            }
        }

        fn do_void_crank(question_id: QuestionId) -> DispatchResult {
            let question = Questions::<T>::get(question_id).ok_or(Error::<T>::UnknownQuestion)?;
            let terms = Terms::<T>::get(question_id).ok_or(Error::<T>::TryStateViolation)?;
            match question.phase {
                QuestionPhase::Registered | QuestionPhase::Open => {
                    ensure!(
                        Self::now() >= terms.seal_deadline,
                        Error::<T>::DeadlineNotReached
                    );
                    let reason = if !Self::service_ledger_solvent() {
                        VoidReason::EscrowInsufficient
                    } else if PauseAffected::<T>::contains_key(question_id) {
                        VoidReason::ServicePaused
                    } else {
                        VoidReason::DeadlineMissed
                    };
                    Self::terminal_void(question_id, question, &terms, reason)
                }
                QuestionPhase::Sealed => Self::do_finalize_sealed(question_id),
                QuestionPhase::Settled | QuestionPhase::Voided => {
                    Err(Error::<T>::AlreadyTerminal.into())
                }
            }
        }

        fn terminal_void(
            question_id: QuestionId,
            question: QuestionRecord,
            terms: &QuestionTerms<T>,
            reason: VoidReason,
        ) -> DispatchResult {
            pallet_conditional_ledger::Pallet::<T, Instance1>::void(
                frame_system::RawOrigin::Signed(Self::account_id()).into(),
                question_id,
            )?;
            pallet_market::Pallet::<T>::observe_external_terminal(question_id)?;
            Self::distribute_bonds(question_id, terms, None)?;
            if !Reports::<T>::contains_key(question_id) {
                Self::transfer(&Self::account_id(), &terms.funder, terms.fee)?;
            }
            Self::finish_question(question_id, question.client_id, QuestionPhase::Voided)?;
            Self::deposit_event(Event::QuestionVoided {
                question_id,
                reason,
            });
            Ok(())
        }

        fn finish_question(
            question_id: QuestionId,
            client: ClientId,
            phase: QuestionPhase,
        ) -> DispatchResult {
            Questions::<T>::try_mutate(question_id, |maybe| -> DispatchResult {
                let question = maybe.as_mut().ok_or(Error::<T>::UnknownQuestion)?;
                question.phase = phase;
                Ok(())
            })?;
            LiveQuestionCount::<T>::try_mutate(|count| -> DispatchResult {
                *count = count.checked_sub(1).ok_or(Error::<T>::TryStateViolation)?;
                Ok(())
            })?;
            // Release this question's contribution to the 16 §8.4 external side.
            // Saturating rather than checked on the *floor* only: a terminal
            // transition must never be blocked by an accounting slip, because a
            // question stuck live is a worse failure than a total that reads
            // low — and try-state below catches any divergence loudly.
            let released = Terms::<T>::get(question_id)
                .map(|terms| terms.escrow)
                .unwrap_or_default();
            LiveExternalDepth::<T>::mutate(|depth| {
                *depth = depth.saturating_sub(released);
            });
            pallet_client_registry::Pallet::<T>::note_question_terminal(client)
                .map_err(|_| Error::<T>::TryStateViolation.into())
        }

        fn distribute_bonds(
            question_id: QuestionId,
            terms: &QuestionTerms<T>,
            median: Option<question_service_core::AttestorMedian>,
        ) -> DispatchResult {
            let mut honest = Vec::new();
            let mut slashed = Vec::new();
            for attestor in &terms.attestors {
                if !AttestorBonds::<T>::contains_key(question_id, attestor) {
                    continue;
                }
                let value = Attestations::<T>::get(question_id, attestor);
                if median.is_some_and(|accepted| {
                    value.is_some_and(|reported| accepted.within_tolerance(reported))
                }) {
                    honest.push(attestor.clone());
                } else if median.is_some() && value.is_some() {
                    slashed.push(attestor.clone());
                } else {
                    Self::transfer(&Self::account_id(), attestor, terms.bond_each)?;
                }
                AttestorBonds::<T>::remove(question_id, attestor);
            }
            if median.is_none() {
                return Ok(());
            }
            for attestor in &honest {
                Self::transfer(&Self::account_id(), attestor, terms.bond_each)?;
            }
            let forfeited = terms
                .bond_each
                .checked_mul(slashed.len() as u128)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let reward_pool = forfeited
                .checked_mul(40)
                .ok_or(Error::<T>::ArithmeticOverflow)?
                / 100;
            let each_reward = if honest.is_empty() {
                0
            } else {
                reward_pool / honest.len() as u128
            };
            let paid_rewards = each_reward
                .checked_mul(honest.len() as u128)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            for attestor in honest {
                Self::transfer(&Self::account_id(), &attestor, each_reward)?;
            }
            let insurance = forfeited
                .checked_sub(paid_rewards)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            Self::transfer(
                &Self::account_id(),
                &<T as pallet_conditional_ledger::Config<Instance1>>::InsuranceAccount::get(),
                insurance,
            )
        }

        fn attestor_reports(
            question_id: QuestionId,
            terms: &QuestionTerms<T>,
        ) -> Vec<AttestorReport> {
            terms
                .attestors
                .iter()
                .filter_map(|attestor| {
                    Attestations::<T>::get(question_id, attestor).map(|value| AttestorReport {
                        attestor: T::AccountIdBytes::into_bytes(attestor),
                        value,
                    })
                })
                .collect()
        }

        fn allocate_ids() -> Result<(QuestionId, MarketId, MarketId, u64), DispatchError> {
            let question = NextServiceId::<T>::get().max(kernel::SERVICE_ID_BASE);
            let accept = question
                .checked_add(1)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let reject = accept
                .checked_add(1)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let next = reject
                .checked_add(1)
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            Ok((question, accept, reject, next))
        }

        fn attestor_bond(escrow: Balance) -> Result<Balance, DispatchError> {
            let ladder = (1u128
                .checked_shl(u32::from(T::ServiceParams::oracle_rounds()))
                .ok_or(Error::<T>::ArithmeticOverflow)?)
            .checked_sub(1)
            .ok_or(Error::<T>::ArithmeticOverflow)?;
            let numerator = escrow
                .checked_mul(ladder)
                .and_then(|value| {
                    value.checked_mul(u128::from(T::ServiceParams::oracle_bond_bps()))
                })
                .ok_or(Error::<T>::ArithmeticOverflow)?;
            let scaled = numerator.div_ceil(10_000);
            Ok(scaled.max(T::ServiceParams::attestor_bond_floor()))
        }

        fn mul_perbill_ceil(value: Balance, rate: Perbill) -> Result<Balance, DispatchError> {
            value
                .checked_mul(u128::from(rate.deconstruct()))
                .map(|product| product.div_ceil(1_000_000_000))
                .ok_or_else(|| Error::<T>::ArithmeticOverflow.into())
        }

        fn transfer(from: &T::AccountId, to: &T::AccountId, amount: Balance) -> DispatchResult {
            if amount == 0 {
                return Ok(());
            }
            // Client and attestor debits preserve their asset account. The
            // service sovereign must be allowed to pay its final exact
            // liability and return to zero; `Preserve` would strand that last
            // fee/bond behind the asset minimum.
            let preservation = if *from == Self::account_id() {
                Preservation::Expendable
            } else {
                Preservation::Preserve
            };
            CollateralOf::<T>::transfer(Self::usdc(), from, to, amount, preservation)
                .map(|_| ())
                .map_err(|_| Error::<T>::EscrowInsufficient.into())
        }

        fn transfer_expendable(
            from: &T::AccountId,
            to: &T::AccountId,
            amount: Balance,
        ) -> DispatchResult {
            if amount == 0 {
                return Ok(());
            }
            CollateralOf::<T>::transfer(Self::usdc(), from, to, amount, Preservation::Expendable)
                .map(|_| ())
                .map_err(|_| Error::<T>::EscrowInsufficient.into())
        }

        fn usdc() -> AssetIdOf<T> {
            <T as pallet_conditional_ledger::Config<Instance1>>::UsdcAssetId::get()
        }

        fn service_ledger_solvent() -> bool {
            pallet_conditional_ledger::Pallet::<T, Instance1>::maintained_collateral_totals()
                .is_ok_and(|(custody, liability)| custody >= liability)
        }

        fn now() -> BlockNumber {
            frame_system::Pallet::<T>::block_number().saturated_into::<BlockNumber>()
        }

        fn is_paused() -> bool {
            PausedUntil::<T>::get().is_some_and(|until| Self::now() < until)
        }

        fn ensure_not_paused() -> DispatchResult {
            ensure!(!Self::is_paused(), Error::<T>::ServicePaused);
            Ok(())
        }

        fn map_client_registration_error(error: DispatchError) -> DispatchError {
            if error == pallet_client_registry::Error::<T>::ClientRemoved.into() {
                Error::<T>::ClientRemoved.into()
            } else if error == pallet_client_registry::Error::<T>::NotRegistered.into() {
                Error::<T>::NotRegistered.into()
            } else if error == pallet_client_registry::Error::<T>::QuestionCounterOverflow.into() {
                // Preserve the documented registry refusal instead of
                // collapsing it into a missing-client diagnostic.
                error
            } else {
                Error::<T>::TryStateViolation.into()
            }
        }

        fn map_external_market_error(error: DispatchError) -> DispatchError {
            if error == pallet_market::Error::<T>::CreationFrozen.into() {
                Error::<T>::CreationFrozen.into()
            } else if error == pallet_market::Error::<T>::TooManyExternalMarkets.into() {
                Error::<T>::SlotsExhausted.into()
            } else if error == pallet_market::Error::<T>::Ledger.into() {
                Error::<T>::EscrowInsufficient.into()
            } else if error == pallet_market::Error::<T>::FunderMismatch.into()
                || error == pallet_market::Error::<T>::UnreservedProtocolAccount.into()
            {
                Error::<T>::ClientIsProtocolAccount.into()
            } else if error == pallet_market::Error::<T>::ArithmeticOverflow.into() {
                Error::<T>::ArithmeticOverflow.into()
            } else {
                Error::<T>::TryStateViolation.into()
            }
        }

        pub fn do_try_state() -> Result<(), TryRuntimeError> {
            let mut live = 0u32;
            let mut fee_liability = 0u128;
            let mut bond_liability = 0u128;
            let mut service_ids = BTreeMap::<u64, ()>::new();
            let mut live_by_client = BTreeMap::<ClientId, u32>::new();
            ensure!(
                Questions::<T>::count() <= bounds::MAX_CLIENTS,
                TryRuntimeError::Other("question-service: retained question bound exceeded")
            );
            for (question_id, question) in Questions::<T>::iter() {
                ensure!(
                    question_id >= kernel::SERVICE_ID_BASE
                        && question.markets[0] >= kernel::SERVICE_ID_BASE
                        && question.markets[1] >= kernel::SERVICE_ID_BASE
                        && question_id != question.markets[0]
                        && question_id != question.markets[1]
                        && question.markets[0] != question.markets[1]
                        && service_ids.insert(question_id, ()).is_none()
                        && service_ids.insert(question.markets[0], ()).is_none()
                        && service_ids.insert(question.markets[1], ()).is_none(),
                    TryRuntimeError::Other("question-service: id below service band")
                );
                let terms = Terms::<T>::get(question_id)
                    .ok_or(TryRuntimeError::Other("question-service: missing terms"))?;
                let expected_seal_deadline =
                    question.window_end.checked_add(terms.oracle_window).ok_or(
                        TryRuntimeError::Other("question-service: seal deadline overflow"),
                    )?;
                ensure!(
                    terms.oracle_window > 0 && terms.seal_deadline == expected_seal_deadline,
                    TryRuntimeError::Other("question-service: frozen seal deadline mismatch")
                );
                ensure!(
                    !<T as pallet_conditional_ledger::Config<()>>::ReservedProtocolDestinations::contains(&terms.funder)
                        && !<T as pallet_conditional_ledger::Config<()>>::ProtocolAccounts::contains(&terms.funder)
                        && !<T as pallet_conditional_ledger::Config<Instance1>>::ProtocolAccounts::contains(&terms.funder)
                        && !T::InflowCapExemptAccounts::contains(&terms.funder),
                    TryRuntimeError::Other("question-service: client is protocol account")
                );
                let is_live = !matches!(
                    question.phase,
                    QuestionPhase::Settled | QuestionPhase::Voided
                );
                let pair = pallet_market::ExternalBookPairs::<T>::get(question_id);
                if let Some(pair) = &pair {
                    ensure!(
                        pair.client == question.client_id
                            && pair.funder == terms.funder
                            && [pair.accept, pair.reject] == question.markets,
                        TryRuntimeError::Other("question-service: external pair mismatch")
                    );
                }
                let market_books = question.markets.map(pallet_market::Markets::<T>::get);
                if is_live {
                    ensure!(
                        market_books.iter().all(Option::is_some),
                        TryRuntimeError::Other("question-service: live question missing market")
                    );
                }
                ensure!(
                    market_books.iter().flatten().all(|book| book.b == terms.b),
                    TryRuntimeError::Other("question-service: market liquidity mismatch")
                );
                if is_live {
                    ensure!(
                        pair.is_some(),
                        TryRuntimeError::Other("question-service: live question missing book pair")
                    );
                    ensure!(
                        pallet_conditional_ledger::Vaults::<T, Instance1>::contains_key(
                            question_id
                        ),
                        TryRuntimeError::Other(
                            "question-service: live question missing service vault"
                        )
                    );
                }
                if let Some(vault) =
                    pallet_conditional_ledger::Vaults::<T, Instance1>::get(question_id)
                {
                    let state_matches = match question.phase {
                        QuestionPhase::Registered | QuestionPhase::Open => {
                            vault.state == VaultState::Open
                        }
                        QuestionPhase::Sealed => terms
                            .winner
                            .is_some_and(|winner| vault.state == VaultState::Resolved(winner)),
                        QuestionPhase::Settled => matches!(
                            vault.state,
                            VaultState::ScalarSettled { winner, .. }
                                if Some(winner) == terms.winner
                        ),
                        QuestionPhase::Voided => vault.state == VaultState::Voided,
                    };
                    ensure!(
                        state_matches,
                        TryRuntimeError::Other("question-service: phase/vault mismatch")
                    );
                }
                let report = Reports::<T>::get(question_id);
                ensure!(
                    report.is_some()
                        == matches!(
                            question.phase,
                            QuestionPhase::Sealed | QuestionPhase::Settled
                        )
                        || (question.phase == QuestionPhase::Voided && report.is_some()),
                    TryRuntimeError::Other("question-service: report/phase mismatch")
                );
                if let Some(report) = report {
                    let attestor_count = u32::try_from(terms.attestors.len()).map_err(|_| {
                        TryRuntimeError::Other("question-service: attestor count overflow")
                    })?;
                    let expected_quorum = question_service_core::quorum(terms.attestors.len())
                        .map_err(|_| {
                            TryRuntimeError::Other("question-service: invalid report quorum")
                        })?;
                    let expected_bond_total = terms
                        .bond_each
                        .checked_mul(u128::from(attestor_count))
                        .ok_or(TryRuntimeError::Other(
                            "question-service: report bond total overflow",
                        ))?;
                    ensure!(
                        report.question_id == question_id
                            && report.client_id == question.client_id
                            && report.sub_id == terms.sub_id
                            && report.window_start == question.window_start
                            && report.window_end == question.window_end
                            && report.b_accept == terms.b
                            && report.b_reject == terms.b
                            && report.declared_stake == question.declared_stake
                            && report.epsilon_1e9 == question.epsilon_1e9
                            && report.settlement_trust
                                == (SettlementTrustView {
                                    attestors: attestor_count,
                                    quorum: expected_quorum,
                                    bond_total: expected_bond_total,
                                }),
                        TryRuntimeError::Other("question-service: report source mismatch")
                    );
                    ensure!(
                        terms.winner.is_some()
                            && terms.sealed_at.is_some()
                            && terms.settlement_deadline.is_some(),
                        TryRuntimeError::Other("question-service: report missing sealed terms")
                    );
                    ensure!(
                        question_service_core::verify_report_view_provenance(
                            &report,
                            sp_io::hashing::blake2_256,
                        ),
                        TryRuntimeError::Other("question-service: report provenance mismatch")
                    );
                    let accept_threshold = report
                        .twap_reject_1e9
                        .0
                        .checked_add(terms.rule.min_accept_improvement_1e9.0);
                    let expected_winner = if accept_threshold
                        .is_some_and(|threshold| report.twap_accept_1e9.0 >= threshold)
                    {
                        Branch::Accept
                    } else {
                        Branch::Reject
                    };
                    ensure!(
                        terms.winner == Some(expected_winner),
                        TryRuntimeError::Other("question-service: deterministic winner mismatch")
                    );
                    let sealed_at = terms.sealed_at.ok_or(TryRuntimeError::Other(
                        "question-service: report missing seal time",
                    ))?;
                    let settlement_deadline = sealed_at.checked_add(terms.oracle_window).ok_or(
                        TryRuntimeError::Other("question-service: settlement deadline overflow"),
                    )?;
                    ensure!(
                        sealed_at >= question.window_end
                            && sealed_at < terms.seal_deadline
                            && terms.settlement_deadline == Some(settlement_deadline),
                        TryRuntimeError::Other("question-service: frozen deadline mismatch")
                    );
                }
                if matches!(
                    question.phase,
                    QuestionPhase::Registered | QuestionPhase::Open
                ) {
                    ensure!(
                        terms.winner.is_none()
                            && terms.sealed_at.is_none()
                            && terms.settlement_deadline.is_none(),
                        TryRuntimeError::Other("question-service: pre-seal terms are terminal")
                    );
                }
                let all_named_bonded = terms
                    .attestors
                    .iter()
                    .all(|attestor| AttestorBonds::<T>::contains_key(question_id, attestor));
                let any_named_bonded = terms
                    .attestors
                    .iter()
                    .any(|attestor| AttestorBonds::<T>::contains_key(question_id, attestor));
                let any_named_attestation = terms
                    .attestors
                    .iter()
                    .any(|attestor| Attestations::<T>::contains_key(question_id, attestor));
                match question.phase {
                    QuestionPhase::Registered => ensure!(
                        !any_named_attestation,
                        TryRuntimeError::Other(
                            "question-service: registered question has attestation"
                        )
                    ),
                    QuestionPhase::Open => ensure!(
                        all_named_bonded && !any_named_attestation,
                        TryRuntimeError::Other(
                            "question-service: open question bond/attestation mismatch"
                        )
                    ),
                    QuestionPhase::Sealed => ensure!(
                        all_named_bonded,
                        TryRuntimeError::Other("question-service: sealed question missing bond")
                    ),
                    QuestionPhase::Settled | QuestionPhase::Voided => ensure!(
                        !any_named_bonded && (terms.sealed_at.is_some() || !any_named_attestation),
                        TryRuntimeError::Other(
                            "question-service: terminal attestor liability mismatch"
                        )
                    ),
                }
                if is_live {
                    live = live.checked_add(1).ok_or(TryRuntimeError::Other(
                        "question-service: live count overflow",
                    ))?;
                    let count = live_by_client.entry(question.client_id).or_insert(0);
                    *count = count.checked_add(1).ok_or(TryRuntimeError::Other(
                        "question-service: client live count overflow",
                    ))?;
                }
                if matches!(
                    question.phase,
                    QuestionPhase::Registered | QuestionPhase::Open
                ) {
                    fee_liability =
                        fee_liability
                            .checked_add(terms.fee)
                            .ok_or(TryRuntimeError::Other(
                                "question-service: fee liability overflow",
                            ))?;
                }
            }
            for question_id in Terms::<T>::iter_keys() {
                ensure!(
                    Questions::<T>::contains_key(question_id),
                    TryRuntimeError::Other("question-service: orphan terms")
                );
            }
            for question_id in Reports::<T>::iter_keys() {
                ensure!(
                    Questions::<T>::contains_key(question_id),
                    TryRuntimeError::Other("question-service: orphan report")
                );
            }
            for (question_id, attestor, ()) in AttestorBonds::<T>::iter() {
                let terms = Terms::<T>::get(question_id).ok_or(TryRuntimeError::Other(
                    "question-service: orphan attestor bond",
                ))?;
                let question = Questions::<T>::get(question_id).ok_or(TryRuntimeError::Other(
                    "question-service: orphan attestor bond",
                ))?;
                ensure!(
                    !matches!(
                        question.phase,
                        QuestionPhase::Settled | QuestionPhase::Voided
                    ) && terms.attestors.contains(&attestor),
                    TryRuntimeError::Other("question-service: bond outside named attestor set")
                );
                bond_liability =
                    bond_liability
                        .checked_add(terms.bond_each)
                        .ok_or(TryRuntimeError::Other(
                            "question-service: bond liability overflow",
                        ))?;
            }
            for (question_id, attestor, value) in Attestations::<T>::iter() {
                let terms = Terms::<T>::get(question_id).ok_or(TryRuntimeError::Other(
                    "question-service: orphan attestation",
                ))?;
                let question = Questions::<T>::get(question_id).ok_or(TryRuntimeError::Other(
                    "question-service: orphan attestation",
                ))?;
                ensure!(
                    terms.attestors.contains(&attestor)
                        && (matches!(
                            question.phase,
                            QuestionPhase::Sealed | QuestionPhase::Settled
                        ) || (question.phase == QuestionPhase::Voided
                            && terms.sealed_at.is_some()))
                        && value.0 <= kernel::SCORE_SCALE,
                    TryRuntimeError::Other("question-service: attestation outside named set")
                );
            }
            for question_id in PauseAffected::<T>::iter_keys() {
                ensure!(
                    Questions::<T>::contains_key(question_id),
                    TryRuntimeError::Other("question-service: orphan pause marker")
                );
            }
            for (client_id, record) in pallet_client_registry::Clients::<T>::iter() {
                let observed = live_by_client
                    .remove(&client_id)
                    .map_or(0, core::convert::identity);
                ensure!(
                    record.questions_live == observed,
                    TryRuntimeError::Other("question-service: client live count mismatch")
                );
            }
            ensure!(
                live_by_client.is_empty(),
                TryRuntimeError::Other("question-service: live question missing client")
            );
            ensure!(
                live == LiveQuestionCount::<T>::get(),
                TryRuntimeError::Other("question-service: LiveQuestionCount mismatch",)
            );
            // 16 §8.4 / SQ-575. The running total is the only thing standing
            // between the arming condition and the sentence it used to be, so it
            // is folded from scratch here rather than trusted. A drift low would
            // silently re-open the bound; a drift high would deny honest clients.
            let mut folded_external: Balance = 0;
            for (question_id, question) in Questions::<T>::iter() {
                if matches!(
                    question.phase,
                    QuestionPhase::Settled | QuestionPhase::Voided
                ) {
                    continue;
                }
                let escrow = Terms::<T>::get(question_id)
                    .map(|terms| terms.escrow)
                    .ok_or(TryRuntimeError::Other(
                        "question-service: live question without terms",
                    ))?;
                folded_external =
                    folded_external
                        .checked_add(escrow)
                        .ok_or(TryRuntimeError::Other(
                            "question-service: external depth overflow",
                        ))?;
            }
            ensure!(
                folded_external == LiveExternalDepth::<T>::get(),
                TryRuntimeError::Other("question-service: LiveExternalDepth mismatch")
            );
            let custody = CollateralOf::<T>::balance(Self::usdc(), &Self::account_id());
            let total_liability =
                fee_liability
                    .checked_add(bond_liability)
                    .ok_or(TryRuntimeError::Other(
                        "question-service: total liability overflow",
                    ))?;
            ensure!(
                custody >= total_liability,
                TryRuntimeError::Other("question-service: custody below liabilities",)
            );
            Ok(())
        }
    }
}
