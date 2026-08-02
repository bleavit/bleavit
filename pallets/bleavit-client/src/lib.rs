#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! Drop-in client-side FRAME pallet for Bleavit's hosted question service.
//!
//! A client runtime configures the destination, asset, funding envelope,
//! timing lead, and report handler. The pallet owns the positional XCM
//! program and the frozen service-call ABI; no client call site constructs an
//! XCM instruction or reads Bleavit metadata. Spec: architecture 16 §2/§3/§5,
//! architecture 09 §6.5, and contract v22 §4a/§12.

extern crate alloc;

use bleavit_client_abi::{
    build_ingress_program, ClientIngressCall, ClientRule, IngressBuildError, RegisterInput,
};
use frame_support::traits::{EnsureOrigin, Get};
use futarchy_primitives::{
    bounds, AccountId, Balance, BlockNumber, BoundedVec, ClientId, FixedU64, H256,
};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;
use staging_xcm::latest::{Location, SendXcm, XcmHash};

pub use bleavit_client_abi::{
    bond_attestor_call, open_call, receive_report_call, register_call, seal_call, settle_call,
    submit_attestation_call, BOND_ATTESTOR_CALL_INDEX, CLIENT_RECEIVER_PALLET_INDEX,
    OPEN_QUESTION_CALL_INDEX, QUESTION_SERVICE_PALLET_INDEX, RECEIVE_REPORT_CALL_INDEX,
    REGISTER_QUESTION_CALL_INDEX, SEAL_QUESTION_CALL_INDEX, SETTLE_QUESTION_CALL_INDEX,
    SUBMIT_ATTESTATION_CALL_INDEX,
};
pub use pallet::*;
pub use weights::WeightInfo;

pub mod weights;

/// The exact report payload delivered by the v22 egress ABI.
pub use futarchy_primitives::ReportView;

/// Client-local decision policy. All fields are copied into the frozen
/// `QuestionService::register` argument by [`Pallet::ask`].
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct Question {
    /// Optional client correlation id. The admitted Bleavit client policy
    /// decides whether this field is required.
    pub sub_id: Option<[u8; 32]>,
    /// Stake exposed to the service's manipulation certificate.
    pub declared_stake: Balance,
    /// Epsilon on the contract's 1e9 score grid.
    pub epsilon_1e9: FixedU64,
    /// Attestor deviation tolerance on the contract's 1e9 score grid.
    pub tolerance_1e9: FixedU64,
    /// Relative window width. The pallet adds `WindowLead` and derives the
    /// absolute remote window start/end values.
    pub window: BlockNumber,
    /// The three or more client-named attestors.
    pub attestors: BoundedVec<AccountId, { bounds::MAX_SERVICE_ATTESTORS }>,
    /// Fixed-data rule committed before either book opens.
    pub rule: ClientRule,
}

#[cfg(test)]
mod mock;
#[cfg(test)]
mod tests;

/// What a successful outbound message asked Bleavit to do.
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
pub enum Action {
    Register,
    Open,
    Seal,
}

/// A report consumer is deliberately a runtime trait rather than an opaque
/// callback: the client runtime decides what a certified answer changes.
pub trait OnReport {
    fn on_report(report: &ReportView) -> frame_support::dispatch::DispatchResult;
}

impl OnReport for () {
    fn on_report(_: &ReportView) -> frame_support::dispatch::DispatchResult {
        Ok(())
    }
}

fn map_build_error(error: IngressBuildError) -> ErrorCode {
    match error {
        IngressBuildError::FeeExceedsWithdrawal => ErrorCode::IngressFeeExceedsWithdrawal,
        IngressBuildError::EmptyWithdrawal => ErrorCode::IngressWithdrawalEmpty,
        IngressBuildError::EmptyFee => ErrorCode::IngressFeeEmpty,
    }
}

/// Stable refusal vocabulary for the client pallet. The variant names are
/// the machine-readable error codes documented in `docs/integration/errors.md`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    UnsignedCaller,
    BadBleavitOrigin,
    QuestionStakeEmpty,
    QuestionBudgetUnavailable,
    RegistrationBudgetOverflow,
    WindowOverflow,
    IngressWithdrawalEmpty,
    IngressFeeEmpty,
    IngressFeeExceedsWithdrawal,
    XcmSendFailed,
    WrongClient,
    InvalidReportProvenance,
    ReportAlreadyReceived,
    ReportCapacityReached,
    ReportHandlerRejected,
    TryStateViolation,
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use frame_support::{pallet_prelude::*, storage::with_storage_layer};
    use frame_system::{ensure_signed, pallet_prelude::*};
    use sp_runtime::{traits::SaturatedConversion, TryRuntimeError};

    const STORAGE_VERSION: StorageVersion = StorageVersion::new(0);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config<RuntimeEvent: From<Event<Self>>> {
        /// Exact Bleavit parachain destination. This is a runtime constant,
        /// not a user-supplied call argument.
        #[pallet::constant]
        type BleavitLocation: Get<Location>;

        /// Canonical USDC location accepted by Bleavit's ingress trader.
        #[pallet::constant]
        type UsdcLocation: Get<Location>;

        /// Client sovereign location used by `DepositAsset` for surplus.
        #[pallet::constant]
        type RefundLocation: Get<Location>;

        /// The client id admitted by Bleavit's client registry.
        #[pallet::constant]
        type ClientId: Get<ClientId>;

        /// A conservative USDC envelope for the service's protocol fee. It
        /// includes the live proportional fee and the kernel floor; clients
        /// configure it once and never calculate it in a transaction.
        #[pallet::constant]
        type RegistrationFeeBuffer: Get<Balance>;

        /// The USDC paid by each outbound XCM program. It is fixed by the
        /// client's route configuration, not inferred from metadata.
        #[pallet::constant]
        type XcmFee: Get<Balance>;

        /// Lead blocks added to the local block number before sending a
        /// registration, absorbing normal XCM delivery latency. The remote
        /// service still performs its own strict `window_start > now` check.
        #[pallet::constant]
        type WindowLead: Get<BlockNumber>;

        /// Router selected by the client runtime. The pallet supplies the
        /// complete destination and positional program.
        type XcmSender: SendXcm;

        /// Exact origin converter for the client's Bleavit sovereign. A
        /// signed, root, or unrelated XCM origin must not pass this check.
        type BleavitOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Local application action on a verified report.
        type OnReport: OnReport;

        /// Bound retained report rows so this reusable pallet cannot grow
        /// unbounded state on a client chain.
        #[pallet::constant]
        type MaxReports: Get<u32>;

        type WeightInfo: WeightInfo;
    }

    /// Immutable reports pulled from the client runtime after provenance and
    /// origin verification. `CountedStorageMap` makes the retained set
    /// explicitly countable for the configured bound.
    #[pallet::storage]
    pub type Reports<T: Config> =
        CountedStorageMap<_, Blake2_128Concat, u64, ReportView, OptionQuery>;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// An exact ingress program was handed to the configured router.
        IngressSent { action: Action, message_id: XcmHash },
        /// A report passed both provenance and client-id checks and was
        /// accepted by the local handler.
        ReportReceived {
            question_id: u64,
            provenance_hash: H256,
        },
    }

    #[pallet::error]
    pub enum Error<T> {
        /// CLIENT-001: the outbound dispatch must be signed by the local
        /// application account.
        UnsignedCaller,
        /// CLIENT-002: the inbound origin was not the configured Bleavit
        /// sovereign origin.
        BadBleavitOrigin,
        /// CLIENT-003: declared stake must be non-zero.
        QuestionStakeEmpty,
        /// CLIENT-004: exact fixed-point subsidy arithmetic refused the
        /// requested question parameters.
        QuestionBudgetUnavailable,
        /// CLIENT-005: the configured service-fee envelope or escrow sum
        /// overflowed; no message was sent.
        RegistrationBudgetOverflow,
        /// CLIENT-006: the derived remote block window overflowed.
        WindowOverflow,
        /// CLIENT-007: the ingress withdrawal amount was empty.
        IngressWithdrawalEmpty,
        /// CLIENT-008: the configured XCM fee was empty.
        IngressFeeEmpty,
        /// CLIENT-009: the XCM fee exceeded the withdrawn asset.
        IngressFeeExceedsWithdrawal,
        /// CLIENT-010: the configured router refused delivery.
        XcmSendFailed,
        /// CLIENT-011: the report was delivered for a different admitted
        /// client id.
        WrongClient,
        /// CLIENT-012: the report hash did not match its canonical v22
        /// provenance preimage.
        InvalidReportProvenance,
        /// CLIENT-013: this question id was already retained.
        ReportAlreadyReceived,
        /// CLIENT-014: the bounded report retention set is full.
        ReportCapacityReached,
        /// CLIENT-015: the local application rejected the report; all local
        /// writes are rolled back and status quo is preserved.
        ReportHandlerRejected,
        /// CLIENT-016: the retained report invariant failed.
        TryStateViolation,
    }

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        #[cfg(feature = "try-runtime")]
        fn try_state(_now: BlockNumberFor<T>) -> Result<(), TryRuntimeError> {
            Self::do_try_state()
        }
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Fixed call index 0: this is the v22 client receiver ABI.
        #[pallet::call_index(0)]
        #[pallet::weight(T::WeightInfo::receive_report())]
        pub fn receive_report(origin: OriginFor<T>, report: ReportView) -> DispatchResult {
            T::BleavitOrigin::ensure_origin(origin).map_err(|_| Error::<T>::BadBleavitOrigin)?;
            ensure!(
                report.client_id == T::ClientId::get(),
                Error::<T>::WrongClient
            );
            ensure!(
                question_service_core::verify_report_view_provenance(
                    &report,
                    sp_io::hashing::blake2_256,
                ),
                Error::<T>::InvalidReportProvenance
            );
            ensure!(
                !Reports::<T>::contains_key(report.question_id),
                Error::<T>::ReportAlreadyReceived
            );
            ensure!(
                Reports::<T>::count() < T::MaxReports::get(),
                Error::<T>::ReportCapacityReached
            );

            with_storage_layer(|| {
                T::OnReport::on_report(&report).map_err(|_| Error::<T>::ReportHandlerRejected)?;
                Reports::<T>::insert(report.question_id, &report);
                Self::deposit_event(Event::ReportReceived {
                    question_id: report.question_id,
                    provenance_hash: report.provenance_hash,
                });
                Ok(())
            })
        }

        /// Build and send the complete register ingress from client-level
        /// question terms. The remote call and six-position XCM template are
        /// both supplied by `bleavit-client-abi`.
        #[pallet::call_index(1)]
        #[pallet::weight(T::WeightInfo::ask())]
        pub fn ask(origin: OriginFor<T>, question: Question) -> DispatchResult {
            ensure_signed(origin).map_err(|_| Error::<T>::UnsignedCaller)?;
            let (input, withdrawal) = Self::registration_input(question)?;
            let topic = sp_io::hashing::blake2_256(&input.encode());
            let program = build_ingress_program(
                T::UsdcLocation::get(),
                withdrawal,
                T::XcmFee::get(),
                T::RefundLocation::get(),
                ClientIngressCall::Register(input),
                Some(topic),
            )
            .map_err(|error| Self::map_error(map_build_error(error)))?;
            let message_id = Self::send(program)?;
            Self::deposit_event(Event::IngressSent {
                action: Action::Register,
                message_id,
            });
            Ok(())
        }

        /// Open an already registered question. The client supplies only its
        /// question id; no remote metadata or XCM is needed.
        #[pallet::call_index(2)]
        #[pallet::weight(T::WeightInfo::open())]
        pub fn open(origin: OriginFor<T>, question_id: u64) -> DispatchResult {
            ensure_signed(origin).map_err(|_| Error::<T>::UnsignedCaller)?;
            let program = Self::program(ClientIngressCall::Open { question_id }, question_id)?;
            let message_id = Self::send(program)?;
            Self::deposit_event(Event::IngressSent {
                action: Action::Open,
                message_id,
            });
            Ok(())
        }

        /// Seal a question and publish its authoritative report on Bleavit.
        #[pallet::call_index(3)]
        #[pallet::weight(T::WeightInfo::seal())]
        pub fn seal(origin: OriginFor<T>, question_id: u64) -> DispatchResult {
            ensure_signed(origin).map_err(|_| Error::<T>::UnsignedCaller)?;
            let program = Self::program(ClientIngressCall::Seal { question_id }, question_id)?;
            let message_id = Self::send(program)?;
            Self::deposit_event(Event::IngressSent {
                action: Action::Seal,
                message_id,
            });
            Ok(())
        }
    }

    impl<T: Config> Pallet<T> {
        fn map_error(code: ErrorCode) -> Error<T> {
            match code {
                ErrorCode::UnsignedCaller => Error::<T>::UnsignedCaller,
                ErrorCode::BadBleavitOrigin => Error::<T>::BadBleavitOrigin,
                ErrorCode::QuestionStakeEmpty => Error::<T>::QuestionStakeEmpty,
                ErrorCode::QuestionBudgetUnavailable => Error::<T>::QuestionBudgetUnavailable,
                ErrorCode::RegistrationBudgetOverflow => Error::<T>::RegistrationBudgetOverflow,
                ErrorCode::WindowOverflow => Error::<T>::WindowOverflow,
                ErrorCode::IngressWithdrawalEmpty => Error::<T>::IngressWithdrawalEmpty,
                ErrorCode::IngressFeeEmpty => Error::<T>::IngressFeeEmpty,
                ErrorCode::IngressFeeExceedsWithdrawal => Error::<T>::IngressFeeExceedsWithdrawal,
                ErrorCode::XcmSendFailed => Error::<T>::XcmSendFailed,
                ErrorCode::WrongClient => Error::<T>::WrongClient,
                ErrorCode::InvalidReportProvenance => Error::<T>::InvalidReportProvenance,
                ErrorCode::ReportAlreadyReceived => Error::<T>::ReportAlreadyReceived,
                ErrorCode::ReportCapacityReached => Error::<T>::ReportCapacityReached,
                ErrorCode::ReportHandlerRejected => Error::<T>::ReportHandlerRejected,
                ErrorCode::TryStateViolation => Error::<T>::TryStateViolation,
            }
        }

        fn registration_input(question: Question) -> Result<(RegisterInput, Balance), Error<T>> {
            ensure!(question.declared_stake > 0, Error::<T>::QuestionStakeEmpty);
            let b = question_service_core::b_min(question.declared_stake, question.epsilon_1e9)
                .map_err(|_| Error::<T>::QuestionBudgetUnavailable)?;
            let headroom =
                market_core::seed_headroom(b).map_err(|_| Error::<T>::QuestionBudgetUnavailable)?;
            let escrow = headroom
                .checked_mul(2)
                .ok_or(Error::<T>::RegistrationBudgetOverflow)?;
            let start = frame_system::Pallet::<T>::block_number()
                .saturated_into::<BlockNumber>()
                .checked_add(T::WindowLead::get())
                .and_then(|value| value.checked_add(1))
                .ok_or(Error::<T>::WindowOverflow)?;
            let end = start
                .checked_add(question.window)
                .ok_or(Error::<T>::WindowOverflow)?;
            let withdrawal = escrow
                .checked_add(T::RegistrationFeeBuffer::get())
                .and_then(|value| value.checked_add(T::XcmFee::get()))
                .ok_or(Error::<T>::RegistrationBudgetOverflow)?;
            let input = RegisterInput {
                sub_id: question.sub_id,
                declared_stake: question.declared_stake,
                epsilon_1e9: question.epsilon_1e9,
                tolerance_1e9: question.tolerance_1e9,
                window_start: start,
                window_end: end,
                b,
                rule: question.rule,
                attestors: question.attestors,
            };
            Ok((input, withdrawal))
        }

        fn program(
            call: ClientIngressCall,
            topic_seed: u64,
        ) -> Result<staging_xcm::latest::Xcm<()>, Error<T>> {
            build_ingress_program(
                T::UsdcLocation::get(),
                T::XcmFee::get(),
                T::XcmFee::get(),
                T::RefundLocation::get(),
                call,
                Some(sp_io::hashing::blake2_256(&topic_seed.encode())),
            )
            .map_err(|error| Self::map_error(map_build_error(error)))
        }

        fn send(program: staging_xcm::latest::Xcm<()>) -> Result<XcmHash, Error<T>> {
            staging_xcm::latest::send_xcm::<T::XcmSender>(T::BleavitLocation::get(), program)
                .map(|(hash, _)| hash)
                .map_err(|_| Error::<T>::XcmSendFailed)
        }

        pub fn do_try_state() -> Result<(), TryRuntimeError> {
            if Reports::<T>::count() > T::MaxReports::get() {
                return Err(TryRuntimeError::Other(
                    "bleavit-client: report retention bound exceeded",
                ));
            }
            for (_, report) in Reports::<T>::iter() {
                if report.client_id != T::ClientId::get()
                    || !question_service_core::verify_report_view_provenance(
                        &report,
                        sp_io::hashing::blake2_256,
                    )
                {
                    return Err(TryRuntimeError::Other(
                        "bleavit-client: retained report failed provenance invariant",
                    ));
                }
            }
            Ok(())
        }
    }
}
