//! N8 runtime intersection tests (09 §6.5; 15 I-34/I-35/I-38).
//!
//! This is the runtime-level review surface for the three independent SDK
//! checks. `bleavit-xcm::n8_tests` owns the whole-program matcher and frozen
//! barrier differential; `tests_s5` owns the metadata-exhaustive I-35 set
//! equality proof.
//!
//! Single reviewer entry points: I-34 is
//! `tests::n8_registry_and_service_negative_origin_matrix_is_exhaustive`;
//! I-35 is `i35_named_privileged_and_wrapper_calls_are_rejected_under_transact`
//! (which invokes the complete S5 inventory equality helper); I-38 is
//! `i34_i35_i38_intersection_dispatches_only_when_all_three_checks_pass`.

use alloc::{boxed::Box, vec, vec::Vec};

use frame_support::traits::{
    fungibles::{Inspect, Mutate},
    Contains,
};
use futarchy_primitives::{currency, kernel, FixedU64, QuestionPhase};
use parity_scale_codec::Encode;
use scale_info::{TypeDef, TypeInfo};
use sp_runtime::MultiAddress;
use staging_xcm::latest::{prelude::*, Error as XcmError, InstructionError, Outcome};
use staging_xcm::{VersionedLocation, VersionedXcm};
use staging_xcm_executor::traits::ConvertLocation;

use crate::{
    configs::{self, xcm_config},
    tests::{account, development_ext},
    AccountId, ForeignAssets, Runtime, RuntimeCall, System,
};

const CLIENT_ID: futarchy_primitives::ClientId = 7;
const QUESTION_ID: futarchy_primitives::QuestionId = kernel::SERVICE_ID_BASE;
const CLIENT_FUNDS: u128 = 10_000 * currency::USDC;
const CLIENT_FEE_LIMIT: u128 = 1_000 * currency::USDC;

fn client_location(para: u32) -> Location {
    Location::new(1, [Parachain(para)])
}

fn usdc(amount: u128) -> Asset {
    Asset {
        id: AssetId(bleavit_xcm::identity::usdc_location()),
        fun: Fungible(amount),
    }
}

fn register_location(client_id: futarchy_primitives::ClientId, location: &Location) {
    pallet_client_registry::ClientIdOf::<Runtime>::insert(location, client_id);
    pallet_client_registry::Clients::<Runtime>::insert(
        client_id,
        pallet_client_registry::ClientRecord::new_location(
            location.clone(),
            0,
            System::block_number(),
        ),
    );
    pallet_client_registry::ClientPolicies::<Runtime>::insert(
        client_id,
        pallet_client_registry::SubIdPolicy::Optional,
    );
}

fn fund_location(location: &Location) -> Option<AccountId> {
    let account = xcm_config::LocationToAccountId::convert_location(location)?;
    if ForeignAssets::mint_into(
        bleavit_xcm::identity::usdc_location(),
        &account,
        CLIENT_FUNDS,
    )
    .is_err()
    {
        return None;
    }
    Some(account)
}

fn seed_registered_question(client_id: futarchy_primitives::ClientId, funder: AccountId) {
    System::set_block_number(10);
    pallet_question_service::Questions::<Runtime>::insert(
        QUESTION_ID,
        pallet_question_service::QuestionRecord {
            client_id,
            phase: QuestionPhase::Registered,
            window_start: 10,
            window_end: 20,
            declared_stake: 1,
            epsilon_1e9: FixedU64(100_000_000),
            tolerance_1e9: FixedU64(10_000_000),
            markets: [QUESTION_ID.saturating_add(1), QUESTION_ID.saturating_add(2)],
        },
    );
    pallet_question_service::Terms::<Runtime>::insert(
        QUESTION_ID,
        pallet_question_service::QuestionTerms::<Runtime> {
            sub_id: [0; 32],
            funder,
            rule: pallet_question_service::ClientRule {
                min_accept_improvement_1e9: FixedU64(0),
            },
            b: 1,
            escrow: 0,
            fee: 0,
            bond_each: 0,
            oracle_window: 10,
            seal_deadline: 30,
            attestors: Default::default(),
            winner: None,
            sealed_at: None,
            settlement_deadline: None,
        },
    );
}

fn open_call() -> RuntimeCall {
    RuntimeCall::QuestionService(pallet_question_service::Call::open {
        question_id: QUESTION_ID,
    })
}

fn client_program(origin: &Location, call: RuntimeCall) -> Xcm<RuntimeCall> {
    Xcm(vec![
        WithdrawAsset(vec![usdc(CLIENT_FUNDS)].into()),
        PayFees {
            asset: usdc(CLIENT_FEE_LIMIT),
        },
        Transact {
            origin_kind: OriginKind::Xcm,
            fallback_max_weight: None,
            call: call.encode().into(),
        },
        RefundSurplus,
        DepositAsset {
            assets: Wild(AllCounted(1)),
            beneficiary: origin.clone(),
        },
        SetTopic([0x8a; 32]),
    ])
}

fn execute_client_program(origin: Location, program: Xcm<RuntimeCall>) -> Outcome {
    let mut message_id = [0x8b; 32];
    <xcm_config::Executor as ExecuteXcm<RuntimeCall>>::prepare_and_execute(
        origin,
        program,
        &mut message_id,
        configs::RuntimeBlockWeights::get().max_block,
        Weight::zero(),
    )
}

fn assert_instruction_error(outcome: Outcome, expected: XcmError) {
    assert!(
        matches!(
            &outcome,
            Outcome::Incomplete {
                error: InstructionError {
                    index: 2,
                    error,
                },
                ..
            } if *error == expected
        ),
        "expected instruction 2 to fail with {expected:?}; observed {outcome:?}",
    );
}

#[test]
fn i34_i35_i38_intersection_dispatches_only_when_all_three_checks_pass() {
    // All three pass: the external-client call dispatches and the existing
    // local USDC supply is conserved exactly (I-38).
    development_ext().execute_with(|| {
        let origin = client_location(4_242);
        register_location(CLIENT_ID, &origin);
        let funder = fund_location(&origin);
        assert!(
            funder.is_some(),
            "client sovereign must map and hold the seeded USDC"
        );
        let Some(funder) = funder else {
            return;
        };
        seed_registered_question(CLIENT_ID, funder);
        let issuance_before = ForeignAssets::total_issuance(bleavit_xcm::identity::usdc_location());
        let cap_before = pallet_constitution::Params::<Runtime>::get(pallet_constitution::key16(
            b"phase3.tvl_cap",
        ));

        let outcome =
            execute_client_program(origin, client_program(&client_location(4_242), open_call()));
        assert!(outcome.ensure_complete().is_ok());
        assert_eq!(
            pallet_question_service::Questions::<Runtime>::get(QUESTION_ID)
                .map(|question| question.phase),
            Some(QuestionPhase::Open),
        );
        assert_eq!(
            pallet_client_registry::IngressMeters::<Runtime>::get(CLIENT_ID).accepted_total,
            1,
        );
        assert_eq!(
            ForeignAssets::total_issuance(bleavit_xcm::identity::usdc_location()),
            issuance_before,
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(pallet_constitution::key16(
                b"phase3.tvl_cap"
            ),),
            cap_before,
        );
    });

    // Barrier fails: position zero is the forbidden minting instruction, so
    // execution never starts and neither dispatch nor issuance can move.
    development_ext().execute_with(|| {
        let origin = client_location(4_242);
        register_location(CLIENT_ID, &origin);
        let funder = fund_location(&origin);
        assert!(
            funder.is_some(),
            "client sovereign must map and hold the seeded USDC"
        );
        let Some(funder) = funder else {
            return;
        };
        seed_registered_question(CLIENT_ID, funder);
        let issuance_before = ForeignAssets::total_issuance(bleavit_xcm::identity::usdc_location());
        let invalid = Xcm(vec![
            ReserveAssetDeposited(vec![usdc(CLIENT_FUNDS)].into()),
            PayFees {
                asset: usdc(CLIENT_FEE_LIMIT),
            },
            Transact {
                origin_kind: OriginKind::Xcm,
                fallback_max_weight: None,
                call: open_call().encode().into(),
            },
            RefundSurplus,
            DepositAsset {
                assets: Wild(AllCounted(1)),
                beneficiary: origin.clone(),
            },
        ]);
        let outcome = execute_client_program(origin, invalid);
        assert!(
            matches!(
                &outcome,
                Outcome::Incomplete {
                    error: InstructionError {
                        index: 0,
                        error: XcmError::Barrier,
                    },
                    ..
                }
            ),
            "expected pre-execution barrier refusal; observed {outcome:?}"
        );
        assert_eq!(
            pallet_question_service::Questions::<Runtime>::get(QUESTION_ID)
                .map(|question| question.phase),
            Some(QuestionPhase::Registered),
        );
        assert_eq!(
            pallet_client_registry::IngressMeters::<Runtime>::get(CLIENT_ID).accepted_total,
            0,
        );
        assert_eq!(
            ForeignAssets::total_issuance(bleavit_xcm::identity::usdc_location()),
            issuance_before,
        );
    });

    // Converter fails: the program and call match, but the exact location is
    // absent from the registry, so the call is never dispatched.
    development_ext().execute_with(|| {
        let origin = client_location(4_244);
        let funder = fund_location(&origin);
        assert!(
            funder.is_some(),
            "client sovereign must map and hold the seeded USDC"
        );
        let Some(funder) = funder else {
            return;
        };
        seed_registered_question(CLIENT_ID, funder);
        let outcome = execute_client_program(origin.clone(), client_program(&origin, open_call()));
        assert_instruction_error(outcome, XcmError::BadOrigin);
        assert_eq!(
            pallet_question_service::Questions::<Runtime>::get(QUESTION_ID)
                .map(|question| question.phase),
            Some(QuestionPhase::Registered),
        );
        assert_eq!(
            pallet_client_registry::IngressMeters::<Runtime>::get(CLIENT_ID).accepted_total,
            0,
        );
    });

    // SafeCallFilter fails: shape and registry match, but a non-client domain
    // dies before origin conversion/dispatch.
    development_ext().execute_with(|| {
        let origin = client_location(4_245);
        register_location(CLIENT_ID, &origin);
        let funder = fund_location(&origin);
        assert!(
            funder.is_some(),
            "client sovereign must map and hold the seeded USDC"
        );
        let Some(funder) = funder else {
            return;
        };
        seed_registered_question(CLIENT_ID, funder);
        let key = b":n8:must-not-write".to_vec();
        let call = RuntimeCall::System(frame_system::Call::set_storage {
            items: vec![(key.clone(), b"forbidden".to_vec())],
        });
        assert!(!xcm_config::SafeCallFilter::contains(&call));
        let outcome = execute_client_program(origin.clone(), client_program(&origin, call));
        assert_instruction_error(outcome, XcmError::NoPermission);
        assert!(sp_io::storage::get(&key).is_none());
        assert_eq!(
            pallet_question_service::Questions::<Runtime>::get(QUESTION_ID)
                .map(|question| question.phase),
            Some(QuestionPhase::Registered),
        );
    });
}

fn forbidden_transact_calls() -> Vec<(&'static str, RuntimeCall)> {
    let allowed_leaf = open_call();
    let mut calls = vec![
        (
            "system.set_storage",
            RuntimeCall::System(frame_system::Call::set_storage {
                items: vec![(b":n8:forbidden".to_vec(), b"value".to_vec())],
            }),
        ),
        (
            "system.set_code",
            RuntimeCall::System(frame_system::Call::set_code { code: vec![0] }),
        ),
        (
            "pallet_xcm.send",
            RuntimeCall::PolkadotXcm(pallet_xcm::Call::send {
                dest: Box::new(VersionedLocation::V5(Location::parent())),
                message: Box::new(VersionedXcm::V5(Xcm(Vec::new()))),
            }),
        ),
        (
            "Balances.transfer",
            RuntimeCall::Balances(pallet_balances::Call::transfer_allow_death {
                dest: MultiAddress::Id(account(201)),
                value: 1,
            }),
        ),
        (
            "Utility.batch",
            RuntimeCall::Utility(pallet_utility::Call::batch {
                calls: vec![allowed_leaf.clone()],
            }),
        ),
        (
            "Proxy.proxy",
            RuntimeCall::Proxy(pallet_proxy::Call::proxy {
                real: MultiAddress::Id(account(202)),
                force_proxy_type: None,
                call: Box::new(allowed_leaf.clone()),
            }),
        ),
    ];
    #[cfg(feature = "bootstrap")]
    calls.push((
        "sudo.sudo",
        RuntimeCall::Sudo(pallet_sudo::Call::sudo {
            call: Box::new(allowed_leaf),
        }),
    ));
    calls
}

fn assert_external_client_origin_caller_variant_tripwire() {
    let type_info = <crate::OriginCaller as TypeInfo>::type_info();
    assert!(
        matches!(&type_info.type_def, TypeDef::Variant(_)),
        "OriginCaller must remain an enum"
    );
    let TypeDef::Variant(variants) = type_info.type_def else {
        return;
    };
    let client_variants: Vec<_> = variants
        .variants
        .iter()
        .filter(|variant| variant.name == "ClientRegistry")
        .map(|variant| (variant.index, variant.fields.len()))
        .collect();
    assert_eq!(client_variants, [(65, 1)]);
}

#[test]
fn i35_named_privileged_and_wrapper_calls_are_rejected_under_transact() {
    assert_external_client_origin_caller_variant_tripwire();
    crate::tests_s5::assert_n8_external_client_safe_call_filter_equals_complete_inventory_domain();
    let calls = forbidden_transact_calls();
    assert_eq!(calls.len(), if cfg!(feature = "bootstrap") { 7 } else { 6 });
    for (name, call) in calls {
        development_ext().execute_with(|| {
            let origin = client_location(4_246);
            register_location(CLIENT_ID, &origin);
            let funder = fund_location(&origin);
            assert!(
                funder.is_some(),
                "{name}: client sovereign must be fundable"
            );
            let Some(funder) = funder else {
                return;
            };
            seed_registered_question(CLIENT_ID, funder);
            assert!(
                !xcm_config::SafeCallFilter::contains(&call),
                "{name} unexpectedly entered the external-client domain",
            );
            let outcome = execute_client_program(origin.clone(), client_program(&origin, call));
            assert_instruction_error(outcome, XcmError::NoPermission);
            assert_eq!(
                pallet_question_service::Questions::<Runtime>::get(QUESTION_ID)
                    .map(|question| question.phase),
                Some(QuestionPhase::Registered),
                "{name} dispatched despite the N8 filter",
            );
            assert_eq!(
                pallet_client_registry::IngressMeters::<Runtime>::get(CLIENT_ID).accepted_total,
                0,
                "{name} reached origin conversion despite filter refusal",
            );
        });
    }
}

#[test]
fn n8_executor_config_binds_all_three_independent_admission_components() {
    use staging_xcm_executor::Config as ExecutorConfig;

    fn same_type<T, U>()
    where
        T: ?Sized + SameType<U>,
        U: ?Sized,
    {
    }
    trait SameType<T: ?Sized> {}
    impl<T: ?Sized> SameType<T> for T {}

    same_type::<<xcm_config::XcmConfig as ExecutorConfig>::Barrier, xcm_config::Barrier>();
    same_type::<
        <xcm_config::XcmConfig as ExecutorConfig>::OriginConverter,
        xcm_config::OriginConverter,
    >();
    same_type::<
        <xcm_config::XcmConfig as ExecutorConfig>::SafeCallFilter,
        xcm_config::SafeCallFilter,
    >();
}
