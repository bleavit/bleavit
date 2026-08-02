#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! Fixed wire ABI shared by Bleavit's N9 report sender and N10's drop-in
//! client receiver. It intentionally encodes fixed pallet/call selectors and
//! the exact SCALE shapes from architecture 02 §4a. Nothing in this crate
//! depends on Bleavit's runtime, so a client runtime, an ink! contract, or an
//! EVM-side encoder can use the same bytes.

extern crate alloc;

use alloc::{vec, vec::Vec};
use futarchy_primitives::{
    bounds, AccountId, Balance, BlockNumber, BoundedVec, FixedU64, ReportView,
};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;
use staging_xcm::latest::{
    Asset, AssetFilter, AssetId, Fungibility, Instruction, Location, OriginKind, WildAsset, Xcm,
};

/// Bleavit's frozen `QuestionService` pallet slot (02 §4a; runtime slot 66).
pub const QUESTION_SERVICE_PALLET_INDEX: u8 = 66;
/// `QuestionService::register` (the only call that creates a question).
pub const REGISTER_QUESTION_CALL_INDEX: u8 = 0;
/// `QuestionService::bond_attestor` (a named attestor's local signed call).
pub const BOND_ATTESTOR_CALL_INDEX: u8 = 1;
/// `QuestionService::open` (exposes the already-funded books to trading).
pub const OPEN_QUESTION_CALL_INDEX: u8 = 2;
/// `QuestionService::seal` (publishes the report and fixes the branch).
pub const SEAL_QUESTION_CALL_INDEX: u8 = 3;
/// `QuestionService::submit_attestation` (a named attestor's local signed call).
pub const SUBMIT_ATTESTATION_CALL_INDEX: u8 = 4;
/// `QuestionService::settle` (permissionless signed crank; not an XCM client call).
pub const SETTLE_QUESTION_CALL_INDEX: u8 = 5;

/// Required runtime pallet slot for the N10 drop-in receiver. Reusing
/// Bleavit's own QuestionService slot (66) grounds the value in the existing
/// service domain rather than inventing a second index.
pub const CLIENT_RECEIVER_PALLET_INDEX: u8 = 66;
/// The receiver pallet's append-only `receive_report(report)` call.
pub const RECEIVE_REPORT_CALL_INDEX: u8 = 0;

/// The exact fixed-data rule accepted by `QuestionService::register`.
#[derive(
    Clone,
    Copy,
    Debug,
    Decode,
    DecodeWithMemTracking,
    Encode,
    MaxEncodedLen,
    PartialEq,
    Eq,
    TypeInfo,
)]
pub struct ClientRule {
    pub min_accept_improvement_1e9: FixedU64,
}

/// The exact argument shape of `QuestionService::register`.
///
/// The on-chain pallet uses FRAME's bounded vector for `attestors`. The
/// shared primitives crate intentionally exposes the same SCALE-compatible
/// bounded wrapper, so the client never needs Bleavit's runtime crate or
/// metadata to encode this argument.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, MaxEncodedLen, PartialEq, Eq, TypeInfo,
)]
pub struct RegisterInput {
    pub sub_id: Option<[u8; 32]>,
    pub declared_stake: Balance,
    pub epsilon_1e9: FixedU64,
    pub tolerance_1e9: FixedU64,
    pub window_start: BlockNumber,
    pub window_end: BlockNumber,
    pub b: Balance,
    pub rule: ClientRule,
    pub attestors: BoundedVec<AccountId, { bounds::MAX_SERVICE_ATTESTORS }>,
}

/// Calls that the positional client-ingress template is allowed to carry.
///
/// `settle` is intentionally absent: Bleavit's settle crank requires a signed
/// origin and is therefore not an `ExternalClient` call. It is still exposed
/// by [`settle_call`] for an off-chain signed client/keeper.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClientIngressCall {
    Register(RegisterInput),
    Open { question_id: u64 },
    Seal { question_id: u64 },
}

/// Deterministic ABI/build failures. These are local construction failures;
/// no XCM sender is touched when one is returned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IngressBuildError {
    FeeExceedsWithdrawal,
    EmptyWithdrawal,
    EmptyFee,
}

fn prefixed_call(call_index: u8, payload: impl Encode) -> Vec<u8> {
    let encoded_payload = payload.encode();
    let mut encoded = Vec::with_capacity(2usize.saturating_add(encoded_payload.len()));
    encoded.push(QUESTION_SERVICE_PALLET_INDEX);
    encoded.push(call_index);
    encoded.extend(encoded_payload);
    encoded
}

/// Encode `QuestionService::register` without metadata.
pub fn register_call(input: &RegisterInput) -> Vec<u8> {
    prefixed_call(REGISTER_QUESTION_CALL_INDEX, input)
}

/// Encode a named attestor's `QuestionService::bond_attestor` call without metadata.
pub fn bond_attestor_call(question_id: u64) -> Vec<u8> {
    prefixed_call(BOND_ATTESTOR_CALL_INDEX, question_id)
}

/// Encode `QuestionService::open` without metadata.
pub fn open_call(question_id: u64) -> Vec<u8> {
    prefixed_call(OPEN_QUESTION_CALL_INDEX, question_id)
}

/// Encode `QuestionService::seal` without metadata.
pub fn seal_call(question_id: u64) -> Vec<u8> {
    prefixed_call(SEAL_QUESTION_CALL_INDEX, question_id)
}

/// Encode a named attestor's `QuestionService::submit_attestation` call without metadata.
pub fn submit_attestation_call(question_id: u64, value_1e9: FixedU64) -> Vec<u8> {
    prefixed_call(SUBMIT_ATTESTATION_CALL_INDEX, (question_id, value_1e9))
}

/// Encode the permissionless signed `QuestionService::settle` crank without
/// metadata. This call is for a local signed submission, not for the XCM
/// `ExternalClient` origin and therefore cannot be passed to the ingress
/// builder.
pub fn settle_call(question_id: u64) -> Vec<u8> {
    prefixed_call(SETTLE_QUESTION_CALL_INDEX, question_id)
}

/// Encode one of the three calls admitted by the positional ingress template.
pub fn encode_client_ingress_call(call: &ClientIngressCall) -> Vec<u8> {
    match call {
        ClientIngressCall::Register(input) => register_call(input),
        ClientIngressCall::Open { question_id } => open_call(*question_id),
        ClientIngressCall::Seal { question_id } => seal_call(*question_id),
    }
}

/// Build the exact five-position v5 client-ingress program plus its optional
/// trailing topic position from typed inputs.
///
/// The caller supplies only the chain-owned locations, the fee envelope, the
/// refund beneficiary, and a typed service call. The instruction order and
/// every filter-bearing instruction are fixed here and cannot be hand-authored
/// by an integration.
pub fn build_ingress_program(
    usdc_location: Location,
    withdrawal: Balance,
    fee: Balance,
    refund_beneficiary: Location,
    call: ClientIngressCall,
    topic: Option<[u8; 32]>,
) -> Result<Xcm<()>, IngressBuildError> {
    if withdrawal == 0 {
        return Err(IngressBuildError::EmptyWithdrawal);
    }
    if fee == 0 {
        return Err(IngressBuildError::EmptyFee);
    }
    if fee > withdrawal {
        return Err(IngressBuildError::FeeExceedsWithdrawal);
    }

    let withdrawal_asset = Asset {
        id: AssetId(usdc_location.clone()),
        fun: Fungibility::Fungible(withdrawal),
    };
    let fee_asset = Asset {
        id: AssetId(usdc_location),
        fun: Fungibility::Fungible(fee),
    };
    let mut instructions = alloc::vec![
        Instruction::WithdrawAsset(vec![withdrawal_asset].into()),
        Instruction::PayFees { asset: fee_asset },
        Instruction::Transact {
            origin_kind: OriginKind::Xcm,
            fallback_max_weight: None,
            call: encode_client_ingress_call(&call).into(),
        },
        Instruction::RefundSurplus,
        Instruction::DepositAsset {
            assets: AssetFilter::Wild(WildAsset::AllCounted(1)),
            beneficiary: refund_beneficiary,
        },
    ];
    if let Some(topic) = topic {
        instructions.push(Instruction::SetTopic(topic));
    }
    Ok(Xcm(instructions))
}

/// Encode the only remote runtime call N9 can author.
pub fn receive_report_call(report: &ReportView) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(2usize.saturating_add(report.encoded_size()));
    encoded.push(CLIENT_RECEIVER_PALLET_INDEX);
    encoded.push(RECEIVE_REPORT_CALL_INDEX);
    encoded.extend(report.encode());
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use futarchy_primitives::{FixedU64, SettlementTrust};

    fn report() -> ReportView {
        ReportView {
            question_id: 7,
            client_id: 3,
            sub_id: [4; 32],
            twap_accept_1e9: FixedU64(600_000_000),
            twap_reject_1e9: FixedU64(400_000_000),
            observations: 9,
            window_start: 10,
            window_end: 20,
            b_accept: 30,
            b_reject: 30,
            manip_floor: 11,
            declared_stake: 12,
            epsilon_1e9: FixedU64(10_000_000),
            tolerance_1e9: FixedU64(20_000_000),
            certified: true,
            settlement_trust: SettlementTrust {
                attestors: 3,
                quorum: 2,
                bond_total: 99,
            },
            provenance_hash: [5; 32],
        }
    }

    #[test]
    fn report_call_has_exact_fixed_prefix_and_payload() {
        let report = report();
        let encoded = receive_report_call(&report);
        assert_eq!(encoded.get(..2), Some([66, 0].as_slice()));
        assert_eq!(encoded.get(2..), Some(report.encode().as_slice()));
    }

    fn register_input() -> RegisterInput {
        let mut attestors = BoundedVec::new();
        assert!(attestors.try_push([9; 32]).is_ok());
        assert!(attestors.try_push([10; 32]).is_ok());
        assert!(attestors.try_push([11; 32]).is_ok());
        RegisterInput {
            sub_id: Some([7; 32]),
            declared_stake: 100_000,
            epsilon_1e9: FixedU64(50_000_000),
            tolerance_1e9: FixedU64(20_000_000),
            window_start: 100,
            window_end: 200,
            b: 1_423_683_300,
            rule: ClientRule {
                min_accept_improvement_1e9: FixedU64(10_000_000),
            },
            attestors,
        }
    }

    #[test]
    fn question_service_call_indices_are_frozen() {
        assert_eq!(
            register_call(&register_input()).get(..2),
            Some([66, 0].as_slice())
        );
        assert_eq!(bond_attestor_call(7).get(..2), Some([66, 1].as_slice()));
        assert_eq!(open_call(7).get(..2), Some([66, 2].as_slice()));
        assert_eq!(seal_call(7).get(..2), Some([66, 3].as_slice()));
        assert_eq!(
            submit_attestation_call(7, FixedU64(500_000_000)).get(..2),
            Some([66, 4].as_slice())
        );
        assert_eq!(settle_call(7).get(..2), Some([66, 5].as_slice()));
        let attestation = submit_attestation_call(7, FixedU64(500_000_000));
        let mut attestation_payload = &attestation[2..];
        assert_eq!(
            <(u64, FixedU64)>::decode(&mut attestation_payload),
            Ok((7, FixedU64(500_000_000)))
        );
        assert!(attestation_payload.is_empty());
        assert_eq!(CLIENT_RECEIVER_PALLET_INDEX, QUESTION_SERVICE_PALLET_INDEX);
        assert_eq!(RECEIVE_REPORT_CALL_INDEX, 0);
    }

    #[test]
    fn register_shape_is_the_runtime_shape_without_metadata() {
        let input = register_input();
        let encoded = register_call(&input);
        let mut payload = &encoded[2..];
        let decoded = RegisterInput::decode(&mut payload).expect("ABI register input");
        assert_eq!(decoded, input);
        assert!(payload.is_empty());
    }

    #[test]
    fn builder_emits_only_the_positional_template() {
        let program = build_ingress_program(
            Location::here(),
            1_000,
            100,
            Location::new(1, []),
            ClientIngressCall::Seal { question_id: 7 },
            Some([8; 32]),
        )
        .expect("valid ingress");
        assert_eq!(program.0.len(), 6);
        assert!(matches!(program.0[0], Instruction::WithdrawAsset(_)));
        assert!(matches!(program.0[1], Instruction::PayFees { .. }));
        assert!(matches!(
            program.0[2],
            Instruction::Transact {
                origin_kind: OriginKind::Xcm,
                fallback_max_weight: None,
                ..
            }
        ));
        assert!(matches!(program.0[3], Instruction::RefundSurplus));
        assert!(matches!(
            program.0[4],
            Instruction::DepositAsset {
                assets: AssetFilter::Wild(WildAsset::AllCounted(1)),
                ..
            }
        ));
        assert!(matches!(
            program.0[5],
            Instruction::SetTopic(topic) if topic == [8; 32]
        ));
    }

    #[test]
    fn builder_rejects_invalid_fee_envelopes_before_xcm_creation() {
        let args = (
            Location::here(),
            Location::here(),
            ClientIngressCall::Open { question_id: 7 },
            None,
        );
        assert_eq!(
            build_ingress_program(args.0.clone(), 0, 1, args.1.clone(), args.2.clone(), args.3),
            Err(IngressBuildError::EmptyWithdrawal)
        );
        assert_eq!(
            build_ingress_program(args.0.clone(), 1, 0, args.1.clone(), args.2.clone(), args.3),
            Err(IngressBuildError::EmptyFee)
        );
        assert_eq!(
            build_ingress_program(args.0, 1, 2, args.1, args.2, args.3),
            Err(IngressBuildError::FeeExceedsWithdrawal)
        );
    }
}
