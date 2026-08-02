//! N7 resource-partition and finite PT-10-clause containment sample (16 §8.5;
//! 15 PT-10).
//!
//! The service leg uses the same runtime call dispatcher that the XCM
//! `Transact` adapter uses.  It therefore exercises the hard external quota
//! without duplicating N8's barrier/converter tests here.  The decision leg
//! reads the exact immutable assembly consumed by `pallet-epoch::decide`.

use alloc::{vec, vec::Vec};

use frame_support::{
    assert_ok,
    dispatch::{DispatchClass, DispatchInfo, GetDispatchInfo, Pays},
    traits::{fungibles::Mutate, ConstU32, Get},
    BoundedVec,
};
use futarchy_primitives::{
    bounds, currency, kernel, metric_ids, FixedU64, MarketSet, ProposalState,
};
use pallet_welfare::MetricInputs;
use parity_scale_codec::Encode;
use sp_keyring::Sr25519Keyring;
use sp_runtime::{
    generic::{Era, SignedPayload},
    traits::{Dispatchable, TransactionExtension, TxBaseImplication},
    transaction_validity::TransactionSource,
    MultiAddress, MultiSignature,
};
use staging_xcm::latest::{Junction, Location};
use staging_xcm_executor::traits::{CallDispatcher, ConvertLocation};

use crate::{
    configs::{self, RuntimeMeasurementWindow, RuntimeMetricInputs},
    resource_partition::{ResourcePartition, ResourcePartitionCallDispatcher},
    tests::{account, development_ext, seed_decision_markets, seed_live_proposal},
    BlockNumber, Epoch, Executive, ForeignAssets, Runtime, RuntimeCall, RuntimeOrigin, System,
    TxExtension, UncheckedExtrinsic, Welfare,
};

const PT10_VERSION: futarchy_primitives::MetricSpecVersion = 91;
const PT10_PID: futarchy_primitives::ProposalId = 90_700;
const PT10_CLIENT: futarchy_primitives::ClientId = 90_701;
const PT10_SERVICE_PARA: u32 = 9_070;
const PT10_SERVICE_FLOAT: u128 = currency::USDC;
const PT10_SERVICE_START_OFFSET: BlockNumber = 1;
const PT10_SERVICE_OPEN_OFFSET: BlockNumber = PT10_SERVICE_START_OFFSET + 1;
const PT10_SERVICE_END_OFFSET: BlockNumber = 22;
// Every block has ten schedulable points: before the first primary call, between
// each adjacent primary call, and after the last primary call. The rotated
// patterns make the service trace vary at every point over the whole lifecycle
// rather than replaying one fixed schedule.
const SERVICE_CONTAINMENT_SCHEDULES: [[u8; 10]; 2] = [
    [1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
    [2, 1, 2, 2, 1, 2, 2, 1, 2, 2],
];

#[derive(Clone, Debug, Eq, PartialEq)]
struct ReplayObservation {
    /// The total sample is diagnostic evidence that service traffic really ran
    /// and consumed physical block weight. It is expected to differ.
    total: pallet_welfare::BlockWeightSample,
    /// This is the welfare input: it must remain byte-identical.
    primary: pallet_welfare::BlockWeightSample,
    /// `H` as emitted through the production metric projection.
    components: Vec<pallet_welfare::ComponentValue>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ReplayResult {
    observations: Vec<ReplayObservation>,
    /// SCALE bytes of every `(storage key, stored snapshot)` pair. Comparing
    /// the encoded pairs catches both value and key/order changes without
    /// reducing the assertion to Rust structural equality.
    welfare_snapshots: Vec<Vec<u8>>,
    /// SCALE bytes of every `(CoreEpochParams, DecisionInputs)` pair supplied
    /// to a `decide()` invocation in this replay.
    decision_inputs: Vec<Vec<u8>>,
    /// SCALE bytes of every recorded decision outcome.
    decisions: Vec<Vec<u8>>,
}

fn primary_metric_spec() -> pallet_welfare::MetricSpec {
    pallet_welfare::MetricSpec {
        id: metric_ids::H,
        version: PT10_VERSION,
        pillar: pallet_welfare::Pillar::COnchain,
        weight: futarchy_primitives::FixedU64(pallet_welfare::ONE),
        epsilon_floor: pallet_welfare::EPSILON_PILLAR,
        activation_epoch: 0,
        source: pallet_welfare::SourceClass::Onchain,
        formula_ref: [1; 32],
        units: [2; 16],
        repr: [3; 16],
        cadence_blocks: 1,
        sanity_min: futarchy_primitives::FixedU64(0),
        sanity_max: futarchy_primitives::FixedU64(pallet_welfare::ONE),
        has_normalization_rule: true,
        has_missing_data_rule: true,
        has_gaming_vectors: true,
        has_challenge_procedure: true,
        prior_bounds: [futarchy_primitives::FixedU64(pallet_welfare::ONE);
            pallet_welfare::HISTORY_PRIORS],
        target: 100,
        delta_s_max_bps: 1_000,
    }
}

fn seed_pt10_metric_spec() {
    pallet_welfare::MetricSpecs::<Runtime>::insert(
        PT10_VERSION,
        pallet_welfare::BoundedSpecSet::truncate_from(vec![primary_metric_spec()]),
    );
}

fn seed_pt10_service_params() {
    for record in pallet_constitution::genesis_params() {
        pallet_constitution::Params::<Runtime>::insert(record.key, record);
    }
    let key = pallet_constitution::key16(b"svc.fee_bps");
    pallet_constitution::Params::<Runtime>::insert(
        key,
        pallet_constitution::ParamRecord {
            key,
            value: pallet_constitution::ParamValue::Perbill(10_000_000),
            min: pallet_constitution::ParamValue::Perbill(0),
            max: pallet_constitution::ParamValue::Perbill(100_000_000),
            max_delta: None,
            cooldown_epochs: 0,
            last_changed_epoch: 0,
            last_change_block: 0,
            class: pallet_constitution::ParamClass::Param,
            kernel_bounded: false,
        },
    );
}

fn seed_pt10_client() {
    let location = Location::new(1, [Junction::Parachain(PT10_SERVICE_PARA)]);
    let funder = configs::xcm_config::LocationToAccountId::convert_location(&location);
    assert!(
        funder.is_some(),
        "the PT-10 client location must map to a funder"
    );
    let Some(funder) = funder else {
        return;
    };
    pallet_client_registry::Clients::<Runtime>::insert(
        PT10_CLIENT,
        pallet_client_registry::ClientRecord::new_location(location, 0, System::block_number()),
    );
    pallet_client_registry::ClientPolicies::<Runtime>::insert(
        PT10_CLIENT,
        pallet_client_registry::SubIdPolicy::Optional,
    );
    assert_ok!(<ForeignAssets as Mutate<_>>::mint_into(
        bleavit_xcm::identity::usdc_location(),
        &funder,
        1_000_000 * currency::USDC,
    ));
}

type ServiceAttestors = BoundedVec<crate::AccountId, ConstU32<{ bounds::MAX_SERVICE_ATTESTORS }>>;

fn pt10_attestors(count: u32, first: u8) -> ServiceAttestors {
    BoundedVec::truncate_from(
        (0..count)
            .map(|offset| account(first.saturating_add(offset as u8)))
            .collect(),
    )
}

fn pt10_register_input(
    window_start: BlockNumber,
    window_end: BlockNumber,
    attestors: ServiceAttestors,
    declared_stake: u128,
) -> pallet_question_service::RegisterInput<crate::AccountId> {
    pallet_question_service::RegisterInput {
        sub_id: Some([7; 32]),
        declared_stake,
        epsilon_1e9: FixedU64(100_000_000),
        tolerance_1e9: FixedU64(10_000_000),
        window_start,
        window_end,
        // 10,000 USDC is above b_min for the 1,000-USDC declared stake at
        // epsilon 0.10, while keeping this fixture comfortably below the
        // existing service-collateral bounds.
        b: 10_000 * currency::USDC,
        rule: pallet_question_service::ClientRule {
            min_accept_improvement_1e9: FixedU64(0),
        },
        attestors,
    }
}

fn seed_pt10_service_question(start: BlockNumber) -> u64 {
    let question =
        pallet_question_service::NextServiceId::<Runtime>::get().max(kernel::SERVICE_ID_BASE);
    let before = System::block_weight().total();
    let input = pt10_register_input(
        start.saturating_add(PT10_SERVICE_OPEN_OFFSET),
        start.saturating_add(PT10_SERVICE_END_OFFSET),
        pt10_attestors(3, 30),
        1_000 * currency::USDC,
    );
    assert!(
        input.window_start > System::block_number(),
        "PT-10 registration must be future-dated: start={}, now={}, input={:?}",
        start,
        System::block_number(),
        input
    );
    let register = RuntimeCall::QuestionService(pallet_question_service::Call::register { input });
    let result = ResourcePartitionCallDispatcher::dispatch(
        register,
        pallet_client_registry::Origin::ExternalClient(PT10_CLIENT).into(),
    );
    assert!(result.is_ok(), "service register was refused: {result:?}");
    let Some(usage) = Welfare::resource_usage() else {
        panic!("service register must leave a resource ledger entry");
    };
    let physical = System::block_weight().total().saturating_sub(before);
    assert!(
        usage.external_used.all_gte(physical),
        "nested register/market/ledger work escaped external accounting: {usage:?}, physical={physical:?}",
    );
    assert!(
        usage.primary_used.all_lte(before),
        "service registration was attributed to primary work: {usage:?}, before={before:?}",
    );
    assert!(
        pallet_question_service::Questions::<Runtime>::contains_key(question),
        "successful register must create the service question",
    );

    let attestors = [account(30), account(31), account(32)];
    for attestor in attestors {
        assert_ok!(<ForeignAssets as Mutate<_>>::mint_into(
            bleavit_xcm::identity::usdc_location(),
            &attestor,
            100_000 * currency::USDC,
        ));
        // `bond_attestor` is a signed keeper/attestor call, not a client call,
        // so it is not one of the external-domain dispatches this containment
        // sample is proving
        // to contain. Seed the bounded bond records directly after the real
        // registration; otherwise charging this setup call to the primary
        // side would make the two replay arms differ for a reason unrelated to
        // hosted traffic.
        pallet_question_service::AttestorBonds::<Runtime>::insert(question, attestor, ());
    }
    question
}

fn dispatch_service_open(question: u64) {
    let result = ResourcePartitionCallDispatcher::dispatch(
        RuntimeCall::QuestionService(pallet_question_service::Call::open {
            question_id: question,
        }),
        pallet_client_registry::Origin::ExternalClient(PT10_CLIENT).into(),
    );
    assert!(result.is_ok(), "service open was refused: {result:?}");
}

fn observe_pt10_service_question(question: u64) {
    let Some(question) = pallet_question_service::Questions::<Runtime>::get(question) else {
        panic!("service observations require a registered question");
    };
    for market in question.markets {
        let result = ResourcePartitionCallDispatcher::dispatch(
            RuntimeCall::Market(pallet_market::Call::crank_observe { market }),
            RuntimeOrigin::signed(account(1)),
        );
        assert!(result.is_ok(), "service observe was refused: {result:?}");
    }
}

fn dispatch_service_seal(question: u64) {
    let result = ResourcePartitionCallDispatcher::dispatch(
        RuntimeCall::QuestionService(pallet_question_service::Call::seal {
            question_id: question,
        }),
        pallet_client_registry::Origin::ExternalClient(PT10_CLIENT).into(),
    );
    assert!(result.is_ok(), "service seal was refused: {result:?}");
}

fn dispatch_failed_service_register(attestor_count: u32, first: u8) {
    let current = System::block_number();
    let result = ResourcePartitionCallDispatcher::dispatch(
        RuntimeCall::QuestionService(pallet_question_service::Call::register {
            input: pt10_register_input(
                current.saturating_add(1),
                current.saturating_add(21),
                pt10_attestors(attestor_count, first),
                0,
            ),
        }),
        pallet_client_registry::Origin::ExternalClient(PT10_CLIENT).into(),
    );
    assert!(
        result.is_err(),
        "zero-stake service register must exercise its failure path",
    );
}

fn dispatch_primary_marker(marker: u8) {
    let call = RuntimeCall::System(frame_system::Call::remark {
        remark: vec![marker],
    });
    let result = ResourcePartitionCallDispatcher::dispatch(call, RuntimeOrigin::signed(account(1)));
    assert!(
        result.is_ok(),
        "primary marker dispatch was refused: {result:?}"
    );
}

fn signed_extrinsic(call: RuntimeCall, nonce: u32) -> UncheckedExtrinsic {
    let extensions: TxExtension = (
        frame_system::AuthorizeCall::<Runtime>::new(),
        frame_system::CheckNonZeroSender::<Runtime>::new(),
        frame_system::CheckSpecVersion::<Runtime>::new(),
        frame_system::CheckTxVersion::<Runtime>::new(),
        frame_system::CheckGenesis::<Runtime>::new(),
        frame_system::CheckEra::<Runtime>::from(Era::Immortal),
        frame_system::CheckNonce::<Runtime>::from(nonce),
        frame_system::CheckWeight::<Runtime>::new(),
        pallet_asset_tx_payment::ChargeAssetTxPayment::<Runtime>::from(0, None),
        (
            frame_metadata_hash_extension::CheckMetadataHash::<Runtime>::new(false),
            crate::StorageWeightReclaim::new(),
        ),
        ResourcePartition,
    );
    let payload = match SignedPayload::new(call, extensions) {
        Ok(payload) => payload,
        Err(error) => panic!("signed PT-10 payload must be constructible: {error:?}"),
    };
    let signature = payload.using_encoded(|bytes| Sr25519Keyring::Alice.sign(bytes));
    let (call, extensions, _) = payload.deconstruct();
    UncheckedExtrinsic::new_signed(
        call,
        MultiAddress::Id(Sr25519Keyring::Alice.to_account_id()),
        MultiSignature::Sr25519(signature),
        extensions,
    )
}

fn dispatch_signed_call(call: RuntimeCall, nonce: &mut u32) {
    let result = Executive::apply_extrinsic(signed_extrinsic(call, *nonce));
    assert!(
        result.is_ok(),
        "signed PT-10 extrinsic failed validation: {result:?}"
    );
    *nonce = nonce.saturating_add(1);
}

fn dispatch_signed_primary_marker(marker: u8, nonce: &mut u32) {
    dispatch_signed_call(
        RuntimeCall::System(frame_system::Call::remark {
            remark: vec![marker, marker.saturating_add(1)],
        }),
        nonce,
    );
}

fn dispatch_signed_external_failure(nonce: &mut u32) {
    // The signed origin is intentionally not a registered local client, so the
    // pallet fails after the real signed-extension validation/reservation path.
    // The reservation must remain external on this failure.
    dispatch_signed_call(
        RuntimeCall::ClientRegistry(pallet_client_registry::Call::top_up_delivery_float {
            amount: 0,
        }),
        nonce,
    );
}

fn dispatch_external_marker() {
    let call = RuntimeCall::ClientRegistry(pallet_client_registry::Call::top_up_delivery_float {
        amount: PT10_SERVICE_FLOAT,
    });
    let result = ResourcePartitionCallDispatcher::dispatch(
        call,
        pallet_client_registry::Origin::ExternalClient(PT10_CLIENT).into(),
    );
    assert!(
        result.is_ok(),
        "admissible service dispatch was refused: {result:?}"
    );
}

fn dispatch_scheduled_service(schedule: &[u8; 10], slot: usize, rotation: usize) {
    for _ in 0..schedule[(slot + rotation) % schedule.len()] {
        dispatch_external_marker();
    }
}

fn execute_partition_block(
    number: BlockNumber,
    start: BlockNumber,
    service_schedule: Option<&[u8; 10]>,
    question: Option<u64>,
    signed_nonce: &mut u32,
) {
    System::initialize(
        &number,
        &Default::default(),
        &sp_runtime::generic::Digest::default(),
    );

    if let (Some(question), Some(_)) = (question, service_schedule) {
        match number.saturating_sub(start) {
            PT10_SERVICE_START_OFFSET => {
                // Registration and its nested market/ledger work are inside
                // the measured replay. Opening waits for the next block so
                // the registration's future window start is valid.
                assert_eq!(
                    seed_pt10_service_question(start),
                    question,
                    "PT-10 registration must allocate the predicted service id"
                );
            }
            PT10_SERVICE_OPEN_OFFSET => {
                // Opening and all following lifecycle calls are likewise in
                // the measured trace.
                dispatch_service_open(question);
                observe_pt10_service_question(question);
            }
            11 => observe_pt10_service_question(question),
            PT10_SERVICE_END_OFFSET => {
                observe_pt10_service_question(question);
                dispatch_service_seal(question);
            }
            _ => {}
        }
    }

    // Every primary call has service traffic before it, after it, and between
    // the adjacent unsigned/signed calls. The final slot is after the last
    // primary call. The successful signed primary marker plus the failed signed
    // service call exercise the actual TransactionExtension pipeline alongside
    // the XCM dispatcher.
    let rotation = usize::try_from(number.saturating_sub(start + 1)).unwrap_or_default() % 10;
    for point in 0..3_u8 {
        let slot = usize::from(point) * 3;
        if let Some(schedule) = service_schedule {
            dispatch_scheduled_service(schedule, slot, rotation);
        }
        dispatch_primary_marker(point);
        if let Some(schedule) = service_schedule {
            dispatch_scheduled_service(schedule, slot + 1, rotation);
        }
        dispatch_signed_primary_marker(point.saturating_add(16), signed_nonce);
        if point == 1
            && number.saturating_sub(start) == PT10_SERVICE_START_OFFSET.saturating_add(2)
            && service_schedule.is_some()
        {
            dispatch_failed_service_register(3, 60);
        }
        if point == 2
            && number.saturating_sub(start) == PT10_SERVICE_START_OFFSET.saturating_add(8)
            && service_schedule.is_some()
        {
            dispatch_failed_service_register(bounds::MAX_SERVICE_ATTESTORS, 80);
        }
        if point == 0 && service_schedule.is_some() {
            dispatch_signed_external_failure(signed_nonce);
        }
        if let Some(schedule) = service_schedule {
            dispatch_scheduled_service(schedule, slot + 2, rotation);
        }
        dispatch_primary_marker(point.saturating_add(3));
    }
    if let Some(schedule) = service_schedule {
        dispatch_scheduled_service(schedule, 9, rotation);
    }
    // This is the production Welfare `on_finalize` action. Calling it
    // directly keeps the fixture independent of Timestamp's separate
    // inherent requirement while still sampling after every dispatch.
    Welfare::sample_block_weight();
}

fn seed_pt10_decision_fixture() {
    let params = <configs::RuntimeEpochParams as pallet_epoch::EpochParamsProvider>::get();
    let end = params.decision_window;
    System::set_block_number(end);
    seed_live_proposal(PT10_PID);
    let markets = MarketSet {
        accept: 90_701,
        reject: 90_702,
        gates: Some([90_703, 90_704, 90_705, 90_706]),
        baseline: 90_707,
    };
    pallet_epoch::Proposals::<Runtime>::mutate(PT10_PID, |proposal| {
        if let Some(proposal) = proposal {
            proposal.class = futarchy_primitives::ProposalClass::Treasury;
            proposal.state = ProposalState::Trading;
            proposal.decide_at = end;
            proposal.markets = Some(markets);
            proposal.maturity = None;
            proposal.grace_end = None;
            proposal.decision = None;
        }
    });
    assert_ok!(seed_decision_markets(
        PT10_PID,
        futarchy_primitives::ProposalClass::Treasury,
        end,
        futarchy_primitives::FixedU64(700_000_000),
        futarchy_primitives::FixedU64(500_000_000),
        futarchy_primitives::FixedU64(500_000_000),
    ));
    pallet_conditional_ledger::Vaults::<Runtime>::insert(
        PT10_PID,
        pallet_conditional_ledger::core_ledger::VaultInfo::open(1),
    );
}

fn run_containment_sample(service_schedule: Option<&[u8; 10]>) -> ReplayResult {
    seed_pt10_metric_spec();
    seed_pt10_service_params();
    seed_pt10_client();
    seed_pt10_decision_fixture();

    let mut observations = Vec::new();
    let start = System::block_number();
    // Predict the id without mutating state. The real registration happens at
    // offset 1, after `System::initialize`, so its reservation and nested work
    // belong to the measured replay rather than to setup.
    let question = service_schedule.map(|_| {
        pallet_question_service::NextServiceId::<Runtime>::get().max(kernel::SERVICE_ID_BASE)
    });
    let mut signed_nonce = System::account_nonce(Sr25519Keyring::Alice.to_account_id());
    for offset in 1..=PT10_SERVICE_END_OFFSET {
        execute_partition_block(
            start.saturating_add(offset),
            start,
            service_schedule,
            question,
            &mut signed_nonce,
        );
        let (epoch, day) = RuntimeMeasurementWindow::get();
        observations.push(ReplayObservation {
            total: Welfare::block_weight_sample(epoch, day),
            primary: Welfare::primary_block_weight_sample(epoch, day),
            components: RuntimeMetricInputs::onchain_components(epoch, PT10_VERSION),
        });
    }

    let sampled_epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
    let saved_epoch = pallet_epoch::EpochOf::<Runtime>::get();
    pallet_epoch::EpochOf::<Runtime>::mutate(|epoch| {
        epoch.index = epoch.index.saturating_add(1);
    });
    assert_ok!(Welfare::record_snapshot(
        RuntimeOrigin::signed(account(69)),
        sampled_epoch,
        PT10_VERSION,
    ));
    let welfare_snapshots = pallet_welfare::Snapshots::<Runtime>::iter()
        .map(|(key, snapshot)| (key, snapshot).encode())
        .collect::<Vec<_>>();
    pallet_epoch::EpochOf::<Runtime>::put(saved_epoch);
    assert!(
        !welfare_snapshots.is_empty(),
        "the containment sample must produce every stored welfare snapshot it compares"
    );
    let snapshot = Epoch::decision_input_snapshot(PT10_PID);
    assert!(
        snapshot.is_some(),
        "the containment sample must assemble a decision input"
    );
    let Some(snapshot) = snapshot else {
        return ReplayResult {
            observations,
            welfare_snapshots,
            decision_inputs: Vec::new(),
            decisions: Vec::new(),
        };
    };
    let decision_inputs = vec![(snapshot.params, snapshot.inputs).encode()];
    assert_ok!(Epoch::decide(RuntimeOrigin::signed(account(69)), PT10_PID));
    let decisions = pallet_epoch::Proposals::<Runtime>::get(PT10_PID)
        .and_then(|proposal| proposal.decision)
        .map(|decision| vec![decision.encode()])
        .unwrap_or_default();
    ReplayResult {
        observations,
        welfare_snapshots,
        decision_inputs,
        decisions,
    }
}

fn assert_containment_sample(primary: &ReplayResult, service: &ReplayResult) {
    assert_eq!(
        primary
            .observations
            .iter()
            .map(|observation| (&observation.primary, &observation.components))
            .collect::<Vec<_>>(),
        service
            .observations
            .iter()
            .map(|observation| (&observation.primary, &observation.components))
            .collect::<Vec<_>>(),
        "N7 containment-sample regression: external traffic changed a primary welfare input",
    );
    assert_eq!(
        primary.welfare_snapshots, service.welfare_snapshots,
        "N7 containment-sample regression: external traffic changed byte-encoded welfare snapshots",
    );
    assert_eq!(
        primary.decision_inputs, service.decision_inputs,
        "N7 containment-sample regression: external traffic changed a byte-encoded decide input",
    );
    assert_eq!(
        primary.decisions, service.decisions,
        "N7 containment-sample regression: external traffic changed a byte-encoded decision outcome",
    );
    assert!(
        service
            .observations
            .iter()
            .zip(&primary.observations)
            .any(|(service, primary)| service.total != primary.total),
        "N7 containment sample did not exercise physical external block weight",
    );
}

#[test]
fn n7_resource_partition_is_hard_in_both_weight_dimensions() {
    development_ext().execute_with(|| {
        let external = Welfare::external_capacity();
        assert!(external.is_some(), "external quota must be configured");
        let Some(external) = external else {
            return;
        };
        let before = System::block_weight().total();
        assert!(!Welfare::can_reserve_resource(
            true,
            frame_support::weights::Weight::from_parts(external.ref_time().saturating_add(1), 0,),
            before,
        ));
        assert!(!Welfare::can_reserve_resource(
            true,
            frame_support::weights::Weight::from_parts(0, external.proof_size().saturating_add(1),),
            before,
        ));

        // Filling the primary reservation still leaves only the separately
        // bounded external quota; it does not enlarge the service side.
        let primary = Welfare::primary_capacity();
        let primary_available = primary.saturating_sub(before);
        assert!(Welfare::reserve_resource(false, primary_available, before).is_some());
        assert!(!Welfare::can_reserve_resource(
            true,
            external.saturating_add(frame_support::weights::Weight::from_parts(1, 0)),
            before,
        ));
    });
}

#[test]
fn n7_operational_dispatch_is_admitted_at_the_primary_partition_cap() {
    development_ext().execute_with(|| {
        let primary = Welfare::primary_capacity();
        let before = System::block_weight().total();
        assert!(
            Welfare::reserve_resource(false, primary.saturating_sub(before), before,).is_some()
        );

        // System::remark is normally Normal; supplying the actual Operational
        // dispatch metadata here isolates the partition decision from the
        // runtime's current call inventory. The call itself must still dispatch
        // successfully after the extension declines to reserve a second
        // primary-side slot. FRAME's CheckWeight remains the owner of this
        // class budget.
        let call = RuntimeCall::System(frame_system::Call::remark { remark: vec![7] });
        let maximum = configs::RuntimeBlockWeights::get().max_block;
        let operational_weight = frame_support::weights::Weight::from_parts(
            maximum.ref_time() / 100,
            maximum.proof_size() / 100,
        );
        let info = DispatchInfo {
            // One percent is large enough to make the residual-fold assertion
            // observable on the 1e9 utilization grid, while FRAME's
            // Operational max still admits it after the 75% primary fill.
            call_weight: operational_weight,
            extension_weight: frame_support::weights::Weight::zero(),
            class: DispatchClass::Operational,
            pays_fee: Pays::Yes,
        };
        let implication = TxBaseImplication(call.clone());
        let validation = <ResourcePartition as TransactionExtension<RuntimeCall>>::validate(
            &ResourcePartition,
            RuntimeOrigin::signed(account(1)),
            &call,
            &info,
            call.encode().len(),
            (),
            &implication,
            TransactionSource::InBlock,
        );
        assert!(
            validation.is_ok(),
            "Operational admission must not be refused by the partition: {validation:?}"
        );
        let (_, val, origin) = match validation {
            Ok(value) => value,
            Err(_) => return,
        };
        let pre = <ResourcePartition as TransactionExtension<RuntimeCall>>::prepare(
            ResourcePartition,
            val,
            &origin,
            &call,
            &info,
            call.encode().len(),
        );
        assert_eq!(pre, Ok(None));
        // The partition has no side reservation for this class. FRAME's
        // registration is still physical block weight, and finalization must
        // fold that residual into the saturating physical-coordinate primary
        // estimate rather than losing it between the two ledgers.
        System::register_extra_weight_unchecked(operational_weight, DispatchClass::Operational);
        assert!(call.dispatch(origin).is_ok());
        Welfare::sample_block_weight();
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let total = pallet_welfare::BlockWeightSamples::<Runtime>::get(epoch, 0);
        let primary_sample = pallet_welfare::PrimaryBlockWeightSamples::<Runtime>::get(epoch, 0);
        assert!(
            primary_sample.utilization_sum > total.utilization_sum,
            "Operational weight must remain visible in the primary estimate: total={total:?}, primary={primary_sample:?}",
        );
        assert!(
            primary_sample.utilization_sum
                <= u64::from(primary_sample.blocks).saturating_mul(pallet_welfare::ONE),
            "primary sample must stay clamped to physical coordinates: {primary_sample:?}",
        );
        assert!(
            pallet_welfare::Pallet::<Runtime>::do_try_state().is_ok(),
            "try_state must accept the clamped physical primary sample",
        );
    });
}

#[test]
fn n7_check_weight_precedes_resource_partition_in_the_signed_extension_stack() {
    let identifiers = <TxExtension as TransactionExtension<RuntimeCall>>::metadata()
        .into_iter()
        .map(|metadata| metadata.identifier)
        .collect::<Vec<_>>();
    let check_weight = identifiers.iter().position(|id| *id == "CheckWeight");
    let partition = identifiers.iter().position(|id| *id == "ResourcePartition");
    assert!(
        check_weight.is_some(),
        "TxExtension must retain CheckWeight"
    );
    assert!(
        partition.is_some(),
        "TxExtension must retain ResourcePartition"
    );
    let (Some(check_weight), Some(partition)) = (check_weight, partition) else {
        return;
    };
    assert!(
        check_weight < partition,
        "ResourcePartition reads the pre-CheckWeight total; extension order changed: {identifiers:?}"
    );
}

#[test]
fn n7_failed_external_dispatch_keeps_its_full_reservation() {
    development_ext().execute_with(|| {
        let call =
            RuntimeCall::ClientRegistry(pallet_client_registry::Call::top_up_delivery_float {
                amount: 0,
            });
        let info = call.get_dispatch_info();
        let len = call.encode().len();
        let amount = Welfare::dispatch_resource_weight(
            &info,
            len,
            Welfare::resource_partition_weight(crate::classifier::market_leaf_count(&call)),
        );
        let result = ResourcePartitionCallDispatcher::dispatch(
            call,
            pallet_client_registry::Origin::ExternalClient(PT10_CLIENT).into(),
        );
        assert!(result.is_err(), "zero top-up must fail after admission");
        let usage = Welfare::resource_usage();
        assert!(
            usage.is_some(),
            "failed dispatch must retain its ledger entry"
        );
        let Some(usage) = usage else {
            return;
        };
        assert!(usage.external_used.all_gte(amount));
    });
}

#[test]
fn n7_runtime_metric_ids_have_owned_hosted_book_provenance() {
    use pallet_welfare::MetricProvenanceProvider;

    for declared in [
        pallet_welfare::SourceClass::Onchain,
        pallet_welfare::SourceClass::RelayDerived,
        pallet_welfare::SourceClass::Attested,
    ] {
        assert_eq!(
            configs::RuntimeMetricProvenance::provenance(metric_ids::HOSTED_BOOK_MIN, declared,),
            pallet_welfare::MetricProvenance::HostedBook,
        );
    }
    assert_eq!(
        configs::RuntimeMetricProvenance::provenance(
            metric_ids::H,
            pallet_welfare::SourceClass::Attested,
        ),
        pallet_welfare::MetricProvenance::Primary(pallet_welfare::SourceClass::Onchain),
    );
    #[cfg(not(feature = "runtime-benchmarks"))]
    assert_eq!(
        configs::RuntimeMetricProvenance::provenance(
            metric_ids::HOSTED_BOOK_MIN.saturating_sub(1),
            pallet_welfare::SourceClass::Onchain,
        ),
        pallet_welfare::MetricProvenance::Unassigned,
    );
    #[cfg(feature = "runtime-benchmarks")]
    {
        assert_eq!(
            configs::RuntimeMetricProvenance::provenance(15, pallet_welfare::SourceClass::Onchain,),
            pallet_welfare::MetricProvenance::Primary(pallet_welfare::SourceClass::Attested),
        );
    }
}

#[test]
fn n7_normal_dispatch_escape_hatches_are_inventory_tripwired() {
    // These are the complete local raw-dispatch inventory. The partition
    // dispatcher is the one intended admission path; each other entry is
    // deliberately authority-gated and is therefore an allowed Normal.max_total
    // residual path, not an external-client ingress.
    const MARKERS: [&str; 8] = [
        "N7-DISPATCH-TRIPWIRE: partition-dispatcher",
        "N7-DISPATCH-TRIPWIRE: guardian-playbook",
        "N7-DISPATCH-TRIPWIRE: recovery-authorize",
        "N7-DISPATCH-TRIPWIRE: recovery-apply",
        "N7-DISPATCH-TRIPWIRE: benchmark-authorize",
        "N7-DISPATCH-TRIPWIRE: execution-guard-payload",
        "N7-DISPATCH-TRIPWIRE: execution-guard-authorize",
        "N7-DISPATCH-TRIPWIRE: execution-guard-apply",
    ];

    let sources = [
        ("lib.rs", include_str!("lib.rs")),
        ("configs.rs", include_str!("configs.rs")),
        ("classifier.rs", include_str!("classifier.rs")),
        (
            "resource_partition.rs",
            include_str!("resource_partition.rs"),
        ),
    ];
    for marker in MARKERS {
        let occurrences = sources
            .iter()
            .map(|(_, source)| source.matches(marker).count())
            .sum::<usize>();
        assert_eq!(
            occurrences, 1,
            "the combined Normal dispatch inventory must contain exactly one entry for {marker}"
        );
    }
    for (name, source) in sources {
        let lines = source.lines().collect::<Vec<_>>();
        for (index, line) in lines.iter().enumerate() {
            if line.contains(".dispatch(") || line.contains(".dispatch_bypass_filter(") {
                let context_start = index.saturating_sub(4);
                assert!(
                    lines[context_start..=index]
                        .iter()
                        .any(|context| MARKERS.iter().any(|marker| context.contains(marker))),
                    "new raw dispatch in {name}:{} is outside the N7 authority inventory",
                    index + 1,
                );
            }
        }
        for line in lines
            .iter()
            .filter(|line| line.contains("N7-DISPATCH-TRIPWIRE:"))
        {
            assert!(
                MARKERS.iter().any(|marker| line.contains(marker)),
                "unknown N7 dispatch inventory entry in {name}: {line}"
            );
        }
    }

    // The SDK scheduler's actual dispatch is not present in this repository's
    // source, so the mechanizable guard is its exact runtime binding plus the
    // complete local production-source inventory above.
    assert!(include_str!("configs.rs").contains("type ScheduleOrigin = InternalSchedulerOnly;"));
    assert!(include_str!("configs.rs").contains("type Scheduler = Scheduler;"));
}

#[test]
fn n7_service_traffic_containment_sample() {
    let primary = development_ext().execute_with(|| run_containment_sample(None));
    for service_schedule in SERVICE_CONTAINMENT_SCHEDULES {
        let service =
            development_ext().execute_with(|| run_containment_sample(Some(&service_schedule)));
        assert_containment_sample(&primary, &service);
    }
}

/// Every market call shape that names one book, for both partitions to be
/// checked against the same list.
fn book_call_shapes(market: futarchy_primitives::MarketId) -> Vec<RuntimeCall> {
    vec![
        RuntimeCall::Market(pallet_market::Call::buy {
            market,
            side: futarchy_primitives::ScalarSide::Long,
            amount: currency::USDC,
            max_cost: currency::USDC,
        }),
        RuntimeCall::Market(pallet_market::Call::sell {
            market,
            side: futarchy_primitives::ScalarSide::Long,
            amount: currency::USDC,
            min_proceeds: 0,
        }),
        RuntimeCall::Market(pallet_market::Call::crank_observe { market }),
        RuntimeCall::Market(pallet_market::Call::sweep_revenue { market }),
        RuntimeCall::Market(pallet_market::Call::reap { market }),
    ]
}

/// The partition classifies by *resource domain*, which is not the authority
/// domain. Hosted work is charged to the client quota whoever signs it —
/// otherwise an ordinary signed trade in a hosted book is booked as primary
/// work, and hosted volume walks straight back into `PrimaryUsed` and moves
/// `H` (05 §4.3), which is the one channel 16 §8.5 exists to close.
///
/// The inverse direction matters just as much and is asserted here too:
/// Bleavit's own books, its own ledger instance and its own emergency
/// authority over the hosted pallets must never be charged to a quota an
/// external client can saturate.
#[test]
fn n7_hosted_domain_work_is_external_whoever_signs_it() {
    development_ext().execute_with(|| {
        seed_pt10_metric_spec();
        seed_pt10_service_params();
        seed_pt10_client();
        seed_pt10_decision_fixture();

        let start = System::block_number();
        System::set_block_number(start.saturating_add(PT10_SERVICE_START_OFFSET));
        let question = seed_pt10_service_question(start);
        let hosted = pallet_question_service::Questions::<Runtime>::get(question)
            .expect("the fixture registers a hosted question")
            .markets;
        assert!(
            !hosted.is_empty(),
            "a hosted question must own at least one book for this test to bind",
        );

        // Permissionless, ordinarily-signed work against a hosted book.
        for market in hosted.iter().copied() {
            for call in book_call_shapes(market) {
                assert!(
                    crate::classifier::is_external_client_call(&call),
                    "hosted-book work must be charged externally: {call:?}",
                );
            }
        }

        // The identical call shapes against Bleavit's own decision books.
        for market in [90_701, 90_702, 90_703, 90_707] {
            for call in book_call_shapes(market) {
                assert!(
                    !crate::classifier::is_external_client_call(&call),
                    "Bleavit-book work must stay primary: {call:?}",
                );
            }
        }

        // The hosted ledger instance and the settlement game are hosted work
        // by call shape alone — no storage read decides it.
        for call in [
            RuntimeCall::ServiceLedger(pallet_conditional_ledger::Call::redeem {
                pid: question,
                amount: currency::USDC,
            }),
            RuntimeCall::ServiceLedger(pallet_conditional_ledger::Call::sweep_dust {
                pid: question,
            }),
            RuntimeCall::QuestionService(pallet_question_service::Call::settle {
                question_id: question,
            }),
            RuntimeCall::QuestionService(pallet_question_service::Call::void {
                question_id: question,
            }),
            RuntimeCall::QuestionService(pallet_question_service::Call::archive {
                question_id: question,
            }),
        ] {
            assert!(
                crate::classifier::is_external_client_call(&call),
                "hosted-domain call must be charged externally: {call:?}",
            );
        }

        // Bleavit's own ledger instance, and Bleavit's own emergency authority
        // over the hosted pallets. A saturated client quota must never be able
        // to block a pause or a freeze (R-7).
        for call in [
            RuntimeCall::ConditionalLedger(pallet_conditional_ledger::Call::redeem {
                pid: PT10_PID,
                amount: currency::USDC,
            }),
            RuntimeCall::ServiceLedger(pallet_conditional_ledger::Call::set_frozen {
                frozen: true,
            }),
            RuntimeCall::ServiceLedger(pallet_conditional_ledger::Call::set_split_paused {
                paused: true,
                expiry: System::block_number().saturating_add(1),
            }),
            RuntimeCall::QuestionService(pallet_question_service::Call::set_paused { until: None }),
        ] {
            assert!(
                !crate::classifier::is_external_client_call(&call),
                "Bleavit's own authority must never be charged to the client quota: {call:?}",
            );
        }
    });
}

/// A wrapper reserves once, against one side. So a wrapper holding hosted
/// leaves cannot be accounted honestly either way — charging it to primary
/// launders hosted volume back into `H`, charging it to external hides primary
/// load from `H` — and the partition refuses the shape instead of guessing.
///
/// Without this, `Utility::batch` was a complete bypass: the batch classified
/// as primary, so hosted trades got the 75 % primary budget *and* moved `H`.
#[test]
fn n7_wrappers_cannot_launder_hosted_work_into_the_primary_quota() {
    development_ext().execute_with(|| {
        seed_pt10_metric_spec();
        seed_pt10_service_params();
        seed_pt10_client();
        seed_pt10_decision_fixture();

        let start = System::block_number();
        System::set_block_number(start.saturating_add(PT10_SERVICE_START_OFFSET));
        let question = seed_pt10_service_question(start);
        let hosted = pallet_question_service::Questions::<Runtime>::get(question)
            .expect("the fixture registers a hosted question")
            .markets;
        let hosted_call =
            RuntimeCall::Market(pallet_market::Call::crank_observe { market: hosted[0] });
        let primary_call =
            RuntimeCall::Market(pallet_market::Call::crank_observe { market: 90_701 });

        // Every closed wrapper shape, hosted-only and mixed, at one and two
        // levels of nesting.
        let wrap_batch =
            |calls: Vec<RuntimeCall>| RuntimeCall::Utility(pallet_utility::Call::batch { calls });
        let refused = [
            wrap_batch(vec![hosted_call.clone()]),
            wrap_batch(vec![hosted_call.clone(), primary_call.clone()]),
            wrap_batch(vec![primary_call.clone(), hosted_call.clone()]),
            RuntimeCall::Utility(pallet_utility::Call::batch_all {
                calls: vec![hosted_call.clone()],
            }),
            RuntimeCall::Utility(pallet_utility::Call::force_batch {
                calls: vec![hosted_call.clone()],
            }),
            RuntimeCall::Utility(pallet_utility::Call::as_derivative {
                index: 0,
                call: alloc::boxed::Box::new(hosted_call.clone()),
            }),
            RuntimeCall::Utility(pallet_utility::Call::with_weight {
                call: alloc::boxed::Box::new(hosted_call.clone()),
                weight: frame_support::weights::Weight::from_parts(1, 1),
            }),
            RuntimeCall::Multisig(pallet_multisig::Call::as_multi_threshold_1 {
                other_signatories: vec![account(2)],
                call: alloc::boxed::Box::new(hosted_call.clone()),
            }),
            // Nested two deep — the walk must not stop at the first level.
            wrap_batch(vec![wrap_batch(vec![hosted_call.clone()])]),
        ];
        for call in refused {
            assert!(
                crate::classifier::is_wrapped_hosted_work(&call),
                "a wrapper carrying hosted work must be refused: {call:?}",
            );
        }

        // Wrappers with no hosted leaf keep their existing behaviour exactly.
        let admitted = [
            wrap_batch(vec![primary_call.clone()]),
            wrap_batch(vec![primary_call.clone(), primary_call.clone()]),
            wrap_batch(vec![wrap_batch(vec![primary_call.clone()])]),
        ];
        for call in admitted {
            assert!(
                !crate::classifier::is_wrapped_hosted_work(&call),
                "an all-primary wrapper must be unaffected: {call:?}",
            );
        }

        // A bare call is never "wrapped", on either side of the partition.
        assert!(!crate::classifier::is_wrapped_hosted_work(&hosted_call));
        assert!(!crate::classifier::is_wrapped_hosted_work(&primary_call));

        // A tree deeper than the projection's own depth bound is refused HERE,
        // not admitted for a later filter to reject. Otherwise it reserves
        // primary capacity and — because a failed dispatch keeps its full
        // reservation — never gives it back. The bound is MAX_NESTED_LEVELS
        // (4), not MAX_NESTED_CALLS (16): using the call-count limit as a depth
        // limit leaves exactly this gap.
        let mut deep = RuntimeCall::System(frame_system::Call::remark { remark: vec![] });
        for _ in 0..(kernel::MAX_NESTED_LEVELS + 1) {
            deep = wrap_batch(vec![deep]);
        }
        assert!(
            crate::classifier::is_wrapped_hosted_work(&deep),
            "a wrapper nested past MAX_NESTED_LEVELS must be refused by the partition",
        );

        // The classification walk's dynamic reads are charged per call, because
        // a wrapper multiplies them. A flat worst case would tax every
        // transaction for the rare batch.
        assert_eq!(crate::classifier::market_leaf_count(&primary_call), 1);
        assert_eq!(crate::classifier::market_leaf_count(&hosted_call), 1);
        assert_eq!(
            crate::classifier::market_leaf_count(&RuntimeCall::System(
                frame_system::Call::remark { remark: vec![] }
            )),
            0,
        );
        let many = wrap_batch((0..15).map(|_| primary_call.clone()).collect());
        assert_eq!(
            crate::classifier::market_leaf_count(&many),
            15,
            "a batch pays one Markets lookup per market leaf, not one in total",
        );
        // `RuntimeDbWeight::reads_writes` populates ref_time only, so compare
        // that dimension rather than asserting on both.
        assert!(
            Welfare::resource_partition_weight(15).ref_time()
                > Welfare::resource_partition_weight(1).ref_time(),
            "the declared weight must grow with the number of dynamic reads",
        );

        // And the refusal is real at the dispatch boundary, not just in the
        // classifier: the XCM adapter rejects the batch before dispatching it.
        let result = ResourcePartitionCallDispatcher::dispatch(
            wrap_batch(vec![hosted_call]),
            RuntimeOrigin::signed(account(1)),
        );
        assert!(
            result.is_err(),
            "the partition dispatcher must refuse wrapped hosted work",
        );
    });
}
