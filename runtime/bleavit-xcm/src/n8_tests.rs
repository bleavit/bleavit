//! N8 client-ingress boundary tests (09 §6.5; 15 I-35/I-38; 16 §3/§12).

use crate::{
    barrier::{AcceptedXcmOrigins, DenyOverCapInflows, DenyTransact, DenyUnsupportedInstructions},
    client::{matches_client_ingress, CLIENT_INGRESS_POSITION_COUNT},
    identity::{asset_hub_location, coretime_location, relay_location, usdc_location},
    mock::{
        new_test_ext, AccountId, BarrierWithKnownResponse, KnownResponse, MaxPrefixes, TestCaps,
        TestLocationToAccountId, UniversalLocation,
    },
};
use parity_scale_codec::Encode;
use proptest::prelude::*;
use scale_info::{TypeDef, TypeInfo};
use staging_xcm::latest::{prelude::*, Instruction};
use staging_xcm_builder::{
    AllowKnownQueryResponses, AllowSubscriptionsFrom, AllowTopLevelPaidExecutionFrom, DenyThenTry,
    TakeWeightCredit, TrailingSetTopicAsId, WithComputedOrigin,
};
use staging_xcm_executor::traits::{Properties, ShouldExecute};

const MAX_WEIGHT: Weight = Weight::from_parts(100, 100);

/// Frozen copy of the complete non-client legacy branch. Do not replace this
/// with a production alias: this type is the independent before-side of the
/// §16 differential and must keep spelling out all three deny components and
/// the legacy allow composition. The deny components include the authorized
/// post-N8 closed-allowlist amendment recorded on 2026-08-12.
type FrozenNonClientBarrier = DenyThenTry<
    (
        DenyTransact,
        DenyUnsupportedInstructions,
        DenyOverCapInflows<TestCaps, TestLocationToAccountId, AccountId>,
    ),
    TrailingSetTopicAsId<(
        TakeWeightCredit,
        AllowKnownQueryResponses<KnownResponse>,
        WithComputedOrigin<
            (
                AllowTopLevelPaidExecutionFrom<AcceptedXcmOrigins>,
                AllowSubscriptionsFrom<AcceptedXcmOrigins>,
            ),
            UniversalLocation,
            MaxPrefixes,
        >,
    )>,
>;

/// BLAKE2-256 of the exact `barrier.rs` source slice from `DenyTransact`
/// through the end of `DenyOverCapInflows`. The differential's non-client side
/// deliberately reuses those production types; this tripwire makes that reuse
/// a reviewed snapshot rather than a moving oracle. An authorized amendment to
/// any deny component must update this digest and the owning decision record.
const FROZEN_NON_CLIENT_DENY_SOURCE_HASH: [u8; 32] = [
    0x26, 0xe8, 0x0f, 0x55, 0x09, 0xf7, 0x54, 0x4c, 0x37, 0xe1, 0x3e, 0x8d, 0x93, 0xc7, 0x5c, 0x7d,
    0x00, 0x0c, 0xf6, 0x7c, 0xfe, 0xd6, 0xc9, 0x97, 0xb4, 0xee, 0x5f, 0xd3, 0x85, 0xd3, 0x86, 0x92,
];

#[test]
fn frozen_non_client_deny_implementations_have_not_drifted() {
    const START: &str = "pub struct DenyTransact;";
    const END: &str = "/// The exact non-client legacy barrier";
    let source = include_str!("barrier.rs");
    let observed = source.find(START).and_then(|start| {
        source[start..].find(END).map(|relative_end| {
            sp_io::hashing::blake2_256(&source.as_bytes()[start..start + relative_end])
        })
    });
    assert_eq!(observed, Some(FROZEN_NON_CLIENT_DENY_SOURCE_HASH));
}

#[derive(Debug, Eq, PartialEq)]
struct BarrierBytes {
    result: Vec<u8>,
    instructions: Vec<u8>,
    properties: Vec<u8>,
}

fn asset(location: Location, amount: u128) -> Asset {
    Asset {
        id: AssetId(location),
        fun: Fungible(amount),
    }
}

fn transact() -> Instruction<()> {
    Transact {
        origin_kind: OriginKind::Xcm,
        fallback_max_weight: None,
        call: ().encode().into(),
    }
}

fn canonical_client_program(origin: &Location, topic: Option<[u8; 32]>) -> Vec<Instruction<()>> {
    let mut instructions = vec![
        WithdrawAsset(vec![asset(usdc_location(), 1_000)].into()),
        PayFees {
            asset: asset(usdc_location(), 100),
        },
        transact(),
        RefundSurplus,
        DepositAsset {
            assets: Wild(AllCounted(1)),
            beneficiary: origin.clone(),
        },
    ];
    if let Some(topic) = topic {
        instructions.push(SetTopic(topic));
    }
    instructions
}

fn barrier_accepts<B: ShouldExecute>(
    origin: &Location,
    mut instructions: Vec<Instruction<()>>,
) -> bool {
    let mut properties = Properties {
        weight_credit: Weight::zero(),
        message_id: None,
    };
    B::should_execute(origin, &mut instructions, MAX_WEIGHT, &mut properties).is_ok()
}

fn barrier_bytes<B: ShouldExecute>(
    origin: &Location,
    mut instructions: Vec<Instruction<()>>,
    max_weight: Weight,
    mut properties: Properties,
) -> BarrierBytes {
    let result = B::should_execute(origin, &mut instructions, max_weight, &mut properties);
    BarrierBytes {
        result: result.encode(),
        instructions: instructions.encode(),
        properties: (&properties.weight_credit, &properties.message_id).encode(),
    }
}

fn location_strategy() -> BoxedStrategy<Location> {
    prop_oneof![
        Just(Location::here()),
        Just(Location::parent()),
        Just(asset_hub_location()),
        Just(relay_location()),
        Just(coretime_location()),
        any::<u32>().prop_map(|id| Location::new(1, [Parachain(id)])),
        any::<[u8; 32]>().prop_map(|id| Location::new(0, [AccountId32 { network: None, id }],)),
    ]
    .boxed()
}

fn asset_strategy() -> BoxedStrategy<Asset> {
    (location_strategy(), any::<u128>())
        .prop_map(|(location, amount)| asset(location, amount))
        .boxed()
}

fn asset_filter_strategy() -> BoxedStrategy<AssetFilter> {
    prop_oneof![
        Just(Wild(All)),
        any::<u32>().prop_map(|count| Wild(AllCounted(count))),
        asset_strategy().prop_map(AssetFilter::from),
    ]
    .boxed()
}

/// Broad non-`Transact` leaf alphabet. It deliberately includes both the
/// closed non-client surface and unsupported origin/issuance/value-redirection
/// instructions so the differential exercises accept, reject and mutation
/// paths rather than degenerating into one result.
fn no_transact_leaf_strategy() -> BoxedStrategy<Instruction<()>> {
    let generated_asset = asset_strategy();
    let generated_assets = prop::collection::vec(generated_asset.clone(), 0..4)
        .prop_map(Assets::from)
        .boxed();
    let generated_location = location_strategy();
    prop_oneof![
        generated_assets.clone().prop_map(WithdrawAsset),
        generated_assets.clone().prop_map(ReserveAssetDeposited),
        generated_assets.clone().prop_map(ReceiveTeleportedAsset),
        Just(QueryResponse {
            query_id: 77,
            response: Response::Null,
            max_weight: MAX_WEIGHT,
            querier: None,
        }),
        (generated_assets.clone(), generated_location.clone()).prop_map(|(assets, beneficiary)| {
            TransferAsset {
                assets,
                beneficiary,
            }
        },),
        Just(ClearOrigin),
        any::<u8>().prop_map(|instance| DescendOrigin([PalletInstance(instance)].into())),
        (asset_filter_strategy(), generated_location.clone()).prop_map(|(assets, beneficiary)| {
            DepositAsset {
                assets,
                beneficiary,
            }
        },),
        (generated_asset.clone(), any::<u64>(), any::<u64>()).prop_map(
            |(fees, ref_time, proof_size)| BuyExecution {
                fees,
                weight_limit: Limited(Weight::from_parts(ref_time, proof_size)),
            },
        ),
        Just(RefundSurplus),
        Just(ClearError),
        (generated_assets.clone(), generated_location.clone())
            .prop_map(|(assets, ticket)| ClaimAsset { assets, ticket }),
        any::<u64>().prop_map(Trap),
        (any::<u64>(), any::<u64>(), any::<u64>()).prop_map(|(query_id, ref_time, proof_size)| {
            SubscribeVersion {
                query_id,
                max_response_weight: Weight::from_parts(ref_time, proof_size),
            }
        },),
        Just(UnsubscribeVersion),
        generated_assets.clone().prop_map(BurnAsset),
        generated_assets.clone().prop_map(ExpectAsset),
        proptest::option::of(generated_location.clone()).prop_map(ExpectOrigin),
        Just(ClearTransactStatus),
        Just(UniversalOrigin(GlobalConsensus(NetworkId::Polkadot))),
        (generated_asset.clone(), generated_location.clone())
            .prop_map(|(asset, unlocker)| LockAsset { asset, unlocker }),
        any::<bool>().prop_map(|jit_withdraw| SetFeesMode { jit_withdraw }),
        any::<[u8; 32]>().prop_map(SetTopic),
        Just(ClearTopic),
        generated_location.clone().prop_map(AliasOrigin),
        (
            any::<u64>(),
            any::<u64>(),
            proptest::option::of(generated_location)
        )
            .prop_map(|(ref_time, proof_size, check_origin)| UnpaidExecution {
                weight_limit: Limited(Weight::from_parts(ref_time, proof_size)),
                check_origin,
            },),
        generated_asset.prop_map(|asset| PayFees { asset }),
    ]
    .boxed()
}

/// Recursively generates all nine XCM-v5 inner-program carriers around a
/// non-`Transact` alphabet. The strategy therefore covers local handlers,
/// descended local execution and every remote-program carrier while preserving
/// the differential's no-`Transact` precondition by construction.
fn no_transact_instruction_strategy() -> BoxedStrategy<Instruction<()>> {
    no_transact_leaf_strategy()
        .prop_recursive(3, 96, 8, |inner| {
            let inner_xcm = prop::collection::vec(inner, 0..4).prop_map(Xcm).boxed();
            prop_oneof![
                inner_xcm.clone().prop_map(SetErrorHandler),
                inner_xcm.clone().prop_map(SetAppendix),
                inner_xcm.clone().prop_map(|xcm| ExecuteWithOrigin {
                    descendant_origin: Some([PalletInstance(7)].into()),
                    xcm,
                }),
                (asset_strategy(), location_strategy(), inner_xcm.clone()).prop_map(
                    |(asset, dest, xcm)| TransferReserveAsset {
                        assets: vec![asset].into(),
                        dest,
                        xcm,
                    },
                ),
                (
                    asset_filter_strategy(),
                    location_strategy(),
                    inner_xcm.clone()
                )
                    .prop_map(|(assets, dest, xcm)| DepositReserveAsset {
                        assets,
                        dest,
                        xcm
                    },),
                (
                    asset_filter_strategy(),
                    location_strategy(),
                    inner_xcm.clone()
                )
                    .prop_map(|(assets, reserve, xcm)| InitiateReserveWithdraw {
                        assets,
                        reserve,
                        xcm,
                    },),
                (
                    asset_filter_strategy(),
                    location_strategy(),
                    inner_xcm.clone()
                )
                    .prop_map(|(assets, dest, xcm)| InitiateTeleport {
                        assets,
                        dest,
                        xcm
                    },),
                inner_xcm.clone().prop_map(|xcm| ExportMessage {
                    network: NetworkId::Kusama,
                    destination: [Parachain(42)].into(),
                    xcm,
                }),
                (location_strategy(), inner_xcm).prop_map(|(destination, remote_xcm)| {
                    InitiateTransfer {
                        destination,
                        remote_fees: None,
                        preserve_origin: true,
                        assets: Default::default(),
                        remote_xcm,
                    }
                }),
            ]
        })
        .boxed()
}

fn no_transact_program_strategy() -> BoxedStrategy<Vec<Instruction<()>>> {
    prop::collection::vec(no_transact_instruction_strategy(), 0..16).boxed()
}

fn inner_program_instructions() -> Vec<(&'static str, Instruction<()>)> {
    let remote = Xcm(vec![transact()]);
    let local = Xcm(vec![transact()]);
    vec![
        (
            "TransferReserveAsset",
            TransferReserveAsset {
                assets: vec![asset(usdc_location(), 1)].into(),
                dest: Location::new(1, [Parachain(7)]),
                xcm: remote.clone(),
            },
        ),
        (
            "DepositReserveAsset",
            DepositReserveAsset {
                assets: Wild(AllCounted(1)),
                dest: Location::new(1, [Parachain(7)]),
                xcm: remote.clone(),
            },
        ),
        (
            "InitiateReserveWithdraw",
            InitiateReserveWithdraw {
                assets: Wild(AllCounted(1)),
                reserve: Location::parent(),
                xcm: remote.clone(),
            },
        ),
        (
            "InitiateTeleport",
            InitiateTeleport {
                assets: Wild(AllCounted(1)),
                dest: Location::new(1, [Parachain(7)]),
                xcm: remote.clone(),
            },
        ),
        (
            "InitiateTransfer",
            InitiateTransfer {
                destination: Location::new(1, [Parachain(7)]),
                remote_fees: None,
                preserve_origin: true,
                assets: Default::default(),
                remote_xcm: remote.clone(),
            },
        ),
        (
            "ExportMessage",
            ExportMessage {
                network: NetworkId::Kusama,
                destination: [Parachain(7)].into(),
                xcm: remote,
            },
        ),
        ("SetErrorHandler", SetErrorHandler(local.clone())),
        ("SetAppendix", SetAppendix(local.clone())),
        (
            "ExecuteWithOrigin",
            ExecuteWithOrigin {
                descendant_origin: Some([PalletInstance(7)].into()),
                xcm: local,
            },
        ),
    ]
}

fn replace_each_position_and_reject(origin: &Location, name: &str, replacement: &Instruction<()>) {
    for position in 0..CLIENT_INGRESS_POSITION_COUNT {
        let mut candidate = canonical_client_program(origin, Some([9; 32]));
        let replaced = candidate.get_mut(position).map(|slot| {
            *slot = replacement.clone();
        });
        assert!(replaced.is_some(), "missing admitted position {position}");
        assert!(
            !matches_client_ingress(origin, &candidate),
            "{name} matched at admitted position {position}",
        );
        assert!(
            !barrier_accepts::<BarrierWithKnownResponse>(origin, candidate),
            "{name} passed the barrier at admitted position {position}",
        );
    }
}

#[test]
fn client_template_has_exactly_six_pinned_positions_and_optional_final_topic() {
    // This metadata inventory makes an SDK instruction-set change fail this
    // test rather than relying on the incorrect claim that it must fail to
    // compile. It is intentionally pinned alongside staging-xcm = 24.0.0.
    const XCM_V5_INSTRUCTION_VARIANTS: [&str; 52] = [
        "WithdrawAsset",
        "ReserveAssetDeposited",
        "ReceiveTeleportedAsset",
        "QueryResponse",
        "TransferAsset",
        "TransferReserveAsset",
        "Transact",
        "HrmpNewChannelOpenRequest",
        "HrmpChannelAccepted",
        "HrmpChannelClosing",
        "ClearOrigin",
        "DescendOrigin",
        "ReportError",
        "DepositAsset",
        "DepositReserveAsset",
        "ExchangeAsset",
        "InitiateReserveWithdraw",
        "InitiateTeleport",
        "ReportHolding",
        "BuyExecution",
        "RefundSurplus",
        "SetErrorHandler",
        "SetAppendix",
        "ClearError",
        "ClaimAsset",
        "Trap",
        "SubscribeVersion",
        "UnsubscribeVersion",
        "BurnAsset",
        "ExpectAsset",
        "ExpectOrigin",
        "ExpectError",
        "ExpectTransactStatus",
        "QueryPallet",
        "ExpectPallet",
        "ReportTransactStatus",
        "ClearTransactStatus",
        "UniversalOrigin",
        "ExportMessage",
        "LockAsset",
        "UnlockAsset",
        "NoteUnlockable",
        "RequestUnlock",
        "SetFeesMode",
        "SetTopic",
        "ClearTopic",
        "AliasOrigin",
        "UnpaidExecution",
        "PayFees",
        "InitiateTransfer",
        "ExecuteWithOrigin",
        "SetHints",
    ];
    const ADMITTED_POSITIONS: [&str; 6] = [
        "WithdrawAsset",
        "PayFees",
        "Transact",
        "RefundSurplus",
        "DepositAsset",
        "SetTopic",
    ];

    let type_info = <Instruction<()> as TypeInfo>::type_info();
    let actual_variants: Vec<&str> = match &type_info.type_def {
        TypeDef::Variant(variants) => variants
            .variants
            .iter()
            .map(|variant| variant.name)
            .collect(),
        _ => Vec::new(),
    };
    assert_eq!(actual_variants, XCM_V5_INSTRUCTION_VARIANTS);
    assert_eq!(CLIENT_INGRESS_POSITION_COUNT, ADMITTED_POSITIONS.len());

    let origin = Location::new(1, [Parachain(4_242)]);
    let without_topic = canonical_client_program(&origin, None);
    let with_topic = canonical_client_program(&origin, Some([3; 32]));
    assert_eq!(without_topic.len(), CLIENT_INGRESS_POSITION_COUNT - 1);
    assert_eq!(with_topic.len(), CLIENT_INGRESS_POSITION_COUNT);
    assert!(matches_client_ingress(&origin, &without_topic));
    assert!(matches_client_ingress(&origin, &with_topic));

    new_test_ext().execute_with(|| {
        assert!(barrier_accepts::<BarrierWithKnownResponse>(
            &origin,
            without_topic,
        ));
        assert!(barrier_accepts::<BarrierWithKnownResponse>(
            &origin, with_topic,
        ));

        for position in 0..CLIENT_INGRESS_POSITION_COUNT - 1 {
            let base = canonical_client_program(&origin, None);
            let mut misplaced = Vec::with_capacity(CLIENT_INGRESS_POSITION_COUNT);
            for (index, instruction) in base.into_iter().enumerate() {
                if index == position {
                    misplaced.push(SetTopic([5; 32]));
                }
                misplaced.push(instruction);
            }
            assert_eq!(misplaced.len(), CLIENT_INGRESS_POSITION_COUNT);
            assert!(!matches_client_ingress(&origin, &misplaced));
            assert!(!barrier_accepts::<BarrierWithKnownResponse>(
                &origin, misplaced,
            ));
        }

        let mut seventh_position = canonical_client_program(&origin, Some([6; 32]));
        seventh_position.push(ClearTopic);
        assert!(!matches_client_ingress(&origin, &seventh_position));
        assert!(!barrier_accepts::<BarrierWithKnownResponse>(
            &origin,
            seventh_position,
        ));
    });
}

#[test]
fn all_nine_inner_program_instructions_fail_at_every_admitted_position() {
    let origin = Location::new(1, [Parachain(4_242)]);
    let carriers = inner_program_instructions();
    assert_eq!(carriers.len(), 9);
    new_test_ext().execute_with(|| {
        for (name, carrier) in &carriers {
            replace_each_position_and_reject(&origin, name, carrier);
        }
    });
}

#[test]
fn origin_mutation_and_issuance_instructions_fail_at_every_admitted_position() {
    let origin = Location::new(1, [Parachain(4_242)]);
    let forbidden = [
        ("DescendOrigin", DescendOrigin([PalletInstance(11)].into())),
        (
            "AliasOrigin",
            AliasOrigin(Location::new(
                0,
                [AccountId32 {
                    network: None,
                    id: [8; 32],
                }],
            )),
        ),
        (
            "ReserveAssetDeposited",
            ReserveAssetDeposited(vec![asset(usdc_location(), 1)].into()),
        ),
    ];

    new_test_ext().execute_with(|| {
        for (name, instruction) in &forbidden {
            replace_each_position_and_reject(&origin, name, instruction);
        }
    });

    for admitted in [
        canonical_client_program(&origin, None),
        canonical_client_program(&origin, Some([1; 32])),
    ] {
        assert!(matches!(admitted.first(), Some(WithdrawAsset(_))));
        assert!(!admitted
            .iter()
            .any(|instruction| matches!(instruction, ReserveAssetDeposited(_))));
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2_048))]

    /// The highest-value N8 regression: adding the client shape is a pure
    /// extension. Every no-`Transact` program sees the exact non-client result and
    /// exact post-barrier mutations, byte for byte.
    #[test]
    fn frozen_non_client_barrier_is_byte_identical_for_programs_without_transact(
        origin in location_strategy(),
        instructions in no_transact_program_strategy(),
        max_ref_time in any::<u64>(),
        max_proof_size in any::<u64>(),
        credit_ref_time in any::<u64>(),
        credit_proof_size in any::<u64>(),
        message_id in proptest::option::of(any::<[u8; 32]>()),
    ) {
        let max_weight = Weight::from_parts(max_ref_time, max_proof_size);
        let properties = Properties {
            weight_credit: Weight::from_parts(credit_ref_time, credit_proof_size),
            message_id,
        };

        let (before, after) = new_test_ext().execute_with(|| {
            (
                barrier_bytes::<FrozenNonClientBarrier>(
                    &origin,
                    instructions.clone(),
                    max_weight,
                    properties.clone(),
                ),
                barrier_bytes::<BarrierWithKnownResponse>(
                    &origin,
                    instructions.clone(),
                    max_weight,
                    properties,
                ),
            )
        });

        prop_assert_eq!(after.result, before.result);
        prop_assert_eq!(after.instructions, before.instructions);
        prop_assert_eq!(after.properties, before.properties);
    }
}
