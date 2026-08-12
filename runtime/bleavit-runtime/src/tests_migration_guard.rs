//! B16 — migration stall predicate, MBM lockdown, the `MigrationHalted`
//! diagnostic, and this runtime's first storage migration (SQ-132, SQ-146,
//! SQ-309). Owning spec: 09 §3.1–§3.2. These live in their own file per the
//! standing instruction that `tests.rs` not grow concurrently.

use alloc::vec;

#[cfg(feature = "bootstrap")]
use alloc::borrow::Cow;
#[cfg(feature = "bootstrap")]
use core::sync::atomic::Ordering;

#[cfg(all(feature = "phase-four", not(feature = "recovery")))]
use frame_support::traits::Hooks;
use frame_support::{
    migrations::{FailedMigrationHandler, MultiStepMigrator, SteppedMigrations},
    storage::unhashed,
    traits::{GetStorageVersion, OnRuntimeUpgrade, StorageVersion},
    BoundedVec,
};
use futarchy_primitives::kernel;
use pallet_execution_guard::{PhaseState, RecoveryImages};
#[cfg(not(any(
    feature = "runtime-benchmarks",
    feature = "try-runtime",
    feature = "recovery"
)))]
use parity_scale_codec::Encode;
use parity_scale_codec::MaxEncodedLen;
use sp_runtime::traits::Header as _;

#[cfg(feature = "bootstrap")]
use frame_support::traits::EnsureOrigin;
#[cfg(any(feature = "bootstrap", feature = "recovery"))]
use frame_support::traits::{QueryPreimage, StorePreimage};

use crate::{tests, Constitution, ExecutionGuard, Oracle, Runtime, RuntimeEvent, System};

/// Raise spendable NAV above the PARAM §4.1 floor so the Phase-3→4 transition
/// clears the 08 §4.2 arming gate it must now satisfy (SQ-383). Uses the real
/// INSURANCE sweep rather than a test-only backdoor, matching the treasury
/// health suite's precedent.
#[cfg(any(feature = "phase-four", feature = "recovery"))]
fn fund_nav_above_param_floor() {
    use frame_support::traits::fungibles::Mutate;
    let target =
        crate::FutarchyTreasury::floor(futarchy_primitives::ProposalClass::Param).saturating_mul(2);
    assert!(
        <crate::ForeignAssets as Mutate<crate::AccountId>>::mint_into(
            bleavit_xcm::identity::usdc_location(),
            &crate::configs::insurance_account(),
            target,
        )
        .is_ok()
    );
    assert!(crate::FutarchyTreasury::sweep_insurance(
        pallet_origins::Origin::FutarchyTreasury.into(),
        target
    )
    .is_ok());
    assert!(
        crate::FutarchyTreasury::nav().spendable_nav
            >= crate::FutarchyTreasury::floor(futarchy_primitives::ProposalClass::Param)
    );
}

#[cfg(not(any(
    feature = "runtime-benchmarks",
    feature = "try-runtime",
    feature = "recovery"
)))]
use frame_support::storage::StoragePrefixedMap;

#[cfg(not(any(
    feature = "runtime-benchmarks",
    feature = "try-runtime",
    feature = "recovery"
)))]
#[test]
fn ledger_backfill_completes_through_the_real_migration_framework() {
    tests::development_ext().execute_with(|| {
        let mut proposal = conditional_ledger_core::VaultInfo::open(0);
        proposal.escrowed = 7;
        pallet_conditional_ledger::Vaults::<Runtime>::insert(41, proposal);
        let mut baseline = conditional_ledger_core::BaselineVaultInfo::open();
        baseline.escrowed = 11;
        pallet_conditional_ledger::BaselineVaults::<Runtime>::insert(9, baseline);
        pallet_conditional_ledger::TotalEscrowed::<Runtime>::kill();
        StorageVersion::new(0).put::<crate::ConditionalLedger>();

        let _ = <pallet_migrations::Pallet<Runtime> as OnRuntimeUpgrade>::on_runtime_upgrade();
        assert!(matches!(
            pallet_migrations::Cursor::<Runtime>::get(),
            Some(pallet_migrations::MigrationCursor::Active(_))
        ));

        for block in 2..=8 {
            System::set_block_number(block);
            let _ = <pallet_migrations::Pallet<Runtime> as MultiStepMigrator>::step();
            if !pallet_migrations::Cursor::<Runtime>::exists() {
                break;
            }
        }

        assert!(!pallet_migrations::Cursor::<Runtime>::exists());
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(1)
        );
        assert_eq!(
            pallet_conditional_ledger::TotalEscrowed::<Runtime>::get(),
            18
        );
        assert_eq!(crate::configs::MigrationHaltSources::get(), 0);
    });
}

#[cfg(not(any(
    feature = "runtime-benchmarks",
    feature = "try-runtime",
    feature = "recovery"
)))]
#[test]
fn corrupt_ledger_row_sticks_the_real_migration_and_raises_the_halt() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<crate::ConditionalLedger>();
        pallet_conditional_ledger::TotalEscrowed::<Runtime>::kill();

        let mut malformed = <pallet_conditional_ledger::Vaults<Runtime> as StoragePrefixedMap<
            conditional_ledger_core::VaultInfo,
        >>::final_prefix()
        .to_vec();
        malformed.push(0xff);
        unhashed::put_raw(
            &malformed,
            &conditional_ledger_core::VaultInfo::open(0).encode(),
        );

        let _ = <pallet_migrations::Pallet<Runtime> as OnRuntimeUpgrade>::on_runtime_upgrade();
        System::set_block_number(2);
        let _ = <pallet_migrations::Pallet<Runtime> as MultiStepMigrator>::step();

        assert!(matches!(
            pallet_migrations::Cursor::<Runtime>::get(),
            Some(pallet_migrations::MigrationCursor::Stuck)
        ));
        assert_eq!(crate::configs::MigrationFailedStep::get(), Some(0));
        assert!(crate::configs::MigrationHaltSources::get() != 0);
        assert!(pallet_execution_guard::MigrationHalt::<Runtime>::get());
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(0)
        );
        assert_eq!(
            pallet_conditional_ledger::TotalEscrowed::<Runtime>::get(),
            0
        );
        assert!(unhashed::exists(&malformed));
    });
}

/// SQ-132(d): "stalled" is a pure function of the SDK cursor's own `started_at`,
/// never of the cursor bytes failing to change. The retired byte-equality
/// predicate false-raised on a lawful migration that drains a map for hours
/// while returning byte-identical cursors; this one cannot.
#[test]
fn stall_is_derived_from_started_at_not_cursor_bytes() {
    tests::development_ext().execute_with(|| {
        System::set_block_number(10_000);
        // Bytes are identical across every case below; only `started_at` varies.
        let at = |started_at| pallet_migrations::ActiveCursor {
            index: 3,
            inner_cursor: Some(BoundedVec::truncate_from(vec![7u8, 7, 7])),
            started_at,
        };
        let now = System::block_number();

        // A cursor that has only just started is never stalled, regardless of
        // how long an identical-byte cursor may have existed before it.
        assert!(!crate::configs::active_migration_stall_is_live(&at(now)));

        // Exactly at the budget (now - started_at == MIGRATION_STALL_BLOCKS): the
        // predicate is strict `>`, so this is NOT yet stalled.
        assert!(!crate::configs::active_migration_stall_is_live(&at(
            now - kernel::MIGRATION_STALL_BLOCKS
        )));

        // One block past the budget: stalled.
        assert!(crate::configs::active_migration_stall_is_live(&at(now
            - kernel::MIGRATION_STALL_BLOCKS
            - 1)));
    });
}

/// SQ-309 / SQ-132(d)(ii)/(iii): this primary is the first profile allowed to
/// register an MBM because its paired recovery image carries the
/// release-specific cutpoint-total ledger repair.
#[cfg(all(not(feature = "runtime-benchmarks"), not(feature = "recovery")))]
#[test]
fn registered_mbms_obey_the_b16_lockdown() {
    type Migrations = <Runtime as pallet_migrations::Config>::Migrations;

    assert_eq!(
        <Migrations as SteppedMigrations>::len(),
        1,
        "this primary release must register exactly its paired ledger backfill",
    );
    let mut aggregate: u64 = 0;
    for i in 0..<Migrations as SteppedMigrations>::len() {
        let max = Migrations::nth_max_steps(i)
            .expect("index < len is in range")
            .expect("every registered MBM must declare max_steps = Some(n) (09 §3.2(d)(ii))");
        assert!(
            max < kernel::MIGRATION_STALL_BLOCKS,
            "each MBM max_steps must be strictly < MIGRATION_STALL_BLOCKS",
        );
        aggregate = aggregate.saturating_add(u64::from(max));
    }
    assert!(
        aggregate < u64::from(kernel::MIGRATION_STALL_BLOCKS),
        "the aggregate MBM run budget must be strictly < MIGRATION_STALL_BLOCKS (09 §3.2(d)(iii))",
    );
}

#[cfg(all(feature = "recovery", not(feature = "runtime-benchmarks")))]
#[test]
fn recovery_profile_has_zero_multi_block_migrations() {
    type Migrations = <Runtime as pallet_migrations::Config>::Migrations;

    assert_eq!(
        <Migrations as SteppedMigrations>::len(),
        0,
        "the terminal recovery image must not introduce an MBM cursor of its own",
    );
}

#[cfg(feature = "bootstrap")]
#[test]
fn phase_three_predicate_accepts_only_exact_shadow_plus_live_sudo() {
    tests::development_ext().execute_with(|| {
        let exact = pallet_constitution::PhaseFlagsValue::SHADOW_MODE
            | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT;
        assert_eq!(pallet_constitution::PhaseFlags::<Runtime>::get(), exact);
        assert!(crate::configs::RuntimePhaseState::exact_phase_three());
        for class in [
            futarchy_primitives::ProposalClass::Param,
            futarchy_primitives::ProposalClass::Treasury,
            futarchy_primitives::ProposalClass::Code,
            futarchy_primitives::ProposalClass::Meta,
        ] {
            assert!(
                !crate::configs::RuntimePhaseState::class_execution_enabled(class),
                "{class:?} must remain shadow-only in exact Phase 3",
            );
        }

        for flags in [
            0,
            pallet_constitution::PhaseFlagsValue::SHADOW_MODE,
            pallet_constitution::PhaseFlagsValue::SUDO_PRESENT,
            exact | pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            exact | pallet_constitution::PhaseFlagsValue::TREASURY_ARMED,
            exact | pallet_constitution::PhaseFlagsValue::CODE_META_ARMED,
            exact | pallet_constitution::PhaseFlagsValue::LEDGER_FROZEN,
            exact | pallet_constitution::PhaseFlagsValue::DEAD_MAN_ENGAGED,
            exact | pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG,
            exact | (1 << 31),
        ] {
            pallet_constitution::PhaseFlags::<Runtime>::put(flags);
            assert!(
                !crate::configs::RuntimePhaseState::exact_phase_three(),
                "non-exact PhaseFlags value {flags:#010x} must refuse the bridge",
            );
        }

        pallet_constitution::PhaseFlags::<Runtime>::put(exact);
        pallet_sudo::Key::<Runtime>::kill();
        assert!(
            !crate::configs::RuntimePhaseState::exact_phase_three(),
            "SUDO_PRESENT storage cannot substitute for a live sudo key",
        );
    });
}

#[cfg(feature = "bootstrap")]
#[test]
fn phase_four_bridge_origin_is_only_the_signed_current_sudo_key() {
    tests::development_ext().execute_with(|| {
        let sudo = pallet_sudo::Key::<Runtime>::get().expect("bootstrap preset has sudo");
        let admitted = crate::configs::EnsureCurrentSudoKey::try_origin(
            crate::RuntimeOrigin::signed(sudo.clone()),
        );
        assert!(
            admitted.is_ok(),
            "the signed current sudo key must be admitted"
        );
        let Ok(admitted) = admitted else {
            return;
        };
        assert_eq!(admitted, sudo);
        assert!(
            crate::configs::EnsureCurrentSudoKey::try_origin(crate::RuntimeOrigin::signed(
                tests::account(0xfe),
            ))
            .is_err()
        );
        assert!(
            crate::configs::EnsureCurrentSudoKey::try_origin(crate::RuntimeOrigin::root()).is_err()
        );

        pallet_sudo::Key::<Runtime>::kill();
        assert!(
            crate::configs::EnsureCurrentSudoKey::try_origin(crate::RuntimeOrigin::signed(sudo,))
                .is_err()
        );
    });
}

#[test]
fn consumed_phase_four_bridge_accepts_later_binding_masks_but_never_sudo_or_shadow() {
    tests::development_ext().execute_with(|| {
        let mut sudo_key = [0u8; 32];
        sudo_key[..16].copy_from_slice(&sp_io::hashing::twox_128(b"Sudo"));
        sudo_key[16..].copy_from_slice(&sp_io::hashing::twox_128(b"Key"));
        sp_io::storage::clear(&sudo_key);
        pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
            pallet_execution_guard::PhaseFourBridgeState::Consumed,
        );

        for flags in [
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED
                | pallet_constitution::PhaseFlagsValue::TREASURY_ARMED,
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED
                | pallet_constitution::PhaseFlagsValue::TREASURY_ARMED
                | pallet_constitution::PhaseFlagsValue::CODE_META_ARMED,
        ] {
            pallet_constitution::PhaseFlags::<Runtime>::put(flags);
            assert!(
                crate::configs::RuntimePhaseState::post_sudo_phase(),
                "post-Sudo history must accept monotone later binding mask {flags:#010x}",
            );
            assert!(
                ExecutionGuard::do_try_state().is_ok(),
                "Consumed bridge try-state must accept later binding mask {flags:#010x}",
            );
        }

        for flags in [
            pallet_constitution::PhaseFlagsValue::TREASURY_ARMED
                | pallet_constitution::PhaseFlagsValue::CODE_META_ARMED,
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED
                | pallet_constitution::PhaseFlagsValue::SHADOW_MODE,
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED
                | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT,
        ] {
            pallet_constitution::PhaseFlags::<Runtime>::put(flags);
            assert!(
                !crate::configs::RuntimePhaseState::post_sudo_phase(),
                "post-Sudo history must reject regressive mask {flags:#010x}",
            );
            assert!(
                ExecutionGuard::do_try_state().is_err(),
                "Consumed bridge try-state must reject regressive mask {flags:#010x}",
            );
        }
    });
}

/// The production Phase-3→4 payload is one exact META batch: primary
/// authorization, terminal recovery commitment, and both scheduled exposure
/// cap raises. Pin the whole path against the real classifier, constitution
/// origins, attestor records, queue, and guard dispatcher.
#[cfg(feature = "bootstrap")]
#[test]
fn exact_phase_four_meta_payload_queues_and_commits_both_cap_raises() {
    let recovery = b"phase-four-terminal-recovery-runtime".to_vec();
    let wrong_name_recovery = b"phase-four-wrong-name-recovery-runtime".to_vec();
    let mut recovery_version = crate::VERSION;
    recovery_version.spec_version = recovery_version.spec_version.saturating_add(2);
    let mut wrong_name_version = recovery_version.clone();
    wrong_name_version.spec_name = Cow::Borrowed("not-bleavit");
    let (mut ext, version_reads) = tests::upgrade_ext_with_artifact_versions_and_counter(vec![
        (recovery.clone(), recovery_version),
        (wrong_name_recovery.clone(), wrong_name_version),
    ]);
    ext.execute_with(|| {
        const PID: futarchy_primitives::ProposalId = 4_003;
        const RATIFY_REF: u32 = 403;
        let candidate = b"phase-four-primary-runtime".to_vec();
        let candidate_hash = sp_io::hashing::blake2_256(&candidate);
        let recovery_hash = sp_io::hashing::blake2_256(&recovery);
        let wrong_name_recovery_hash = sp_io::hashing::blake2_256(&wrong_name_recovery);
        let members = [
            tests::account(0xd0),
            tests::account(0xd1),
            tests::account(0xd2),
        ];
        tests::fund_attestor_members(&members);
        assert!(crate::Attestor::set_members(
            pallet_origins::Origin::ConstitutionalValues.into(),
            members.to_vec(),
        )
        .is_ok());
        // `attest` requires the proposal to exist (06 §7; MAX-02).
        tests::seed_live_proposal(PID);
        for (artifact, statement_base) in [
            (candidate_hash, 0x41_u8),
            (recovery_hash, 0x51_u8),
            (wrong_name_recovery_hash, 0x61_u8),
        ] {
            for (member, statement) in members
                .iter()
                .take(2)
                .zip([statement_base, statement_base.saturating_add(1)])
            {
                assert!(crate::Attestor::attest(
                    crate::RuntimeOrigin::signed(member.clone()),
                    PID,
                    artifact,
                    [statement; 32],
                )
                .is_ok());
            }
        }
        let records = pallet_attestor::Attestations::<Runtime>::get();
        let primary_attestation = *records
            .iter()
            .find(|record| record.pid == PID && record.artifact_hash == candidate_hash)
            .expect("primary attestation is stored");
        let recovery_attestation = *records
            .iter()
            .find(|record| record.pid == PID && record.artifact_hash == recovery_hash)
            .expect("recovery attestation is stored");
        let wrong_name_recovery_attestation = *records
            .iter()
            .find(|record| record.pid == PID && record.artifact_hash == wrong_name_recovery_hash)
            .expect("wrong-name recovery attestation is stored");
        System::set_block_number(
            primary_attestation
                .challenge_deadline
                .max(recovery_attestation.challenge_deadline)
                .max(wrong_name_recovery_attestation.challenge_deadline)
                .saturating_add(1),
        );
        assert!(crate::Attestor::has_quorum(PID, candidate_hash));
        assert!(crate::Attestor::has_quorum(PID, recovery_hash));
        assert!(crate::Attestor::has_quorum(PID, wrong_name_recovery_hash));

        let noted_recovery = <crate::Preimage as StorePreimage>::note(recovery.clone().into())
            .expect("terminal recovery preimage is stored");
        assert_eq!(noted_recovery.0, recovery_hash);
        let noted_wrong_name_recovery =
            <crate::Preimage as StorePreimage>::note(wrong_name_recovery.clone().into())
                .expect("wrong-name recovery preimage is stored");
        assert_eq!(noted_wrong_name_recovery.0, wrong_name_recovery_hash);
        tests::seed_parachain_upgrade_boundary(recovery.len().max(wrong_name_recovery.len()));
        let current = pallet_execution_guard::CurrentSpecName::<Runtime>::get()
            .expect("genesis seeds the frozen runtime identity");
        let tvl_key = pallet_constitution::key16(b"phase3.tvl_cap");
        let deposit_key = pallet_constitution::key16(b"phase3.dep_cap");
        let tvl_before =
            pallet_constitution::Params::<Runtime>::get(tvl_key).expect("TVL cap is registered");
        let deposit_before = pallet_constitution::Params::<Runtime>::get(deposit_key)
            .expect("deposit cap is registered");
        let tvl_after =
            pallet_constitution::ParamValue::Balance(tvl_before.value.as_u128().saturating_add(1));
        let deposit_after = pallet_constitution::ParamValue::Balance(
            deposit_before.value.as_u128().saturating_add(1),
        );
        let calls = vec![
            crate::RuntimeCall::System(frame_system::Call::authorize_upgrade {
                code_hash: sp_core::H256::from(candidate_hash),
            }),
            crate::RuntimeCall::ExecutionGuard(
                pallet_execution_guard::Call::commit_recovery_image {
                    hash: recovery_hash,
                    len: u32::try_from(recovery.len()).expect("test recovery length fits u32"),
                    target_spec_version: current.spec_version.saturating_add(2),
                    attestation_id: recovery_attestation.id,
                },
            ),
            crate::RuntimeCall::Constitution(pallet_constitution::Call::set_param {
                key: tvl_key,
                value: tvl_after,
            }),
            crate::RuntimeCall::Constitution(pallet_constitution::Call::set_param {
                key: deposit_key,
                value: deposit_after,
            }),
        ];
        let footprint = crate::classifier::derive_resource_footprint(&calls)
            .expect("the exact bridge has a bounded resource footprint");
        let (payload_hash, payload_len) =
            tests::note_runtime_batch(calls.clone()).expect("exact bridge batch is encodable");
        <crate::Preimage as QueryPreimage>::request(&payload_hash);

        let now = System::block_number();
        let maturity = now.saturating_add(
            <crate::configs::ExecutionParams as pallet_execution_guard::Params>::exec_timelock(
                futarchy_primitives::ProposalClass::Meta,
            ),
        );
        let grace_end = maturity.saturating_add(
            <crate::configs::ExecutionParams as pallet_execution_guard::Params>::exec_grace(
                futarchy_primitives::ProposalClass::Meta,
            ),
        );
        let epoch = pallet_epoch::EpochOf::<Runtime>::get().index;
        let schedule = pallet_epoch::Schedule::<Runtime>::get();
        let first_market = PID.saturating_mul(10);
        let mut proposal = futarchy_primitives::Proposal {
            id: PID,
            proposer: tests::account(0xd3),
            funder: tests::account(0xd3),
            class: futarchy_primitives::ProposalClass::Meta,
            state: futarchy_primitives::ProposalState::Submitted,
            epoch,
            submitted_at: now,
            payload_hash: payload_hash.0,
            payload_len,
            ask: 0,
            bond: 0,
            resources: futarchy_primitives::BoundedVec::try_from(footprint.clone().into_inner())
                .expect("bridge resources fit the proposal bound"),
            metric_spec: 1,
            decide_at: now,
            rerun: false,
            extended: false,
            delayed_once: false,
            markets: Some(futarchy_primitives::MarketSet {
                accept: first_market.saturating_add(1),
                reject: first_market.saturating_add(2),
                gates: Some([
                    first_market.saturating_add(3),
                    first_market.saturating_add(4),
                    first_market.saturating_add(5),
                    first_market.saturating_add(6),
                ]),
                baseline: 9_000_u64.saturating_add(epoch.into()),
            }),
            maturity: Some(maturity),
            grace_end: Some(grace_end),
            version_constraint: Some(current.clone()),
            decision: Some(futarchy_primitives::DecisionOutcome::Adopt),
        };
        proposal.bond =
            <crate::configs::RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<
                crate::AccountId,
            >>::required_bond(&proposal)
            .expect("META bond floor is configured");
        pallet_epoch::IntakeProposals::<Runtime>::insert(PID, proposal.clone());
        assert!(crate::ExecutionGuard::qualify_recovery_image(
            crate::RuntimeOrigin::signed(tests::account(0xd4)),
            PID,
        )
        .is_ok());
        assert!(
            version_reads.load(Ordering::Relaxed) > 0,
            "qualification must inspect the full recovery image in its own operation",
        );
        assert_eq!(
            pallet_execution_guard::QualifiedRecoveryImages::<Runtime>::get(PID),
            Some(pallet_execution_guard::QualifiedRecoveryImage {
                payload_hash: payload_hash.0,
                primary_hash: candidate_hash,
                version_constraint: current.clone(),
                descriptor: pallet_execution_guard::RecoveryImageDescriptor {
                    hash: recovery_hash,
                    len: u32::try_from(recovery.len()).expect("test recovery length fits u32"),
                    target_spec_version: current.spec_version.saturating_add(2),
                    attestation_id: recovery_attestation.id,
                },
            }),
        );

        let qualified = pallet_execution_guard::QualifiedRecoveryImages::<Runtime>::take(PID)
            .expect("qualification is cached");
        assert_eq!(
            <crate::configs::RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<
                crate::AccountId,
            >>::static_check(&proposal),
            pallet_epoch::StaticCheckDisposition::Refund(
                futarchy_primitives::RejectReason::ProcessHold,
            ),
            "static screening must fail closed while qualification is missing",
        );
        pallet_execution_guard::QualifiedRecoveryImages::<Runtime>::insert(PID, qualified);

        version_reads.store(0, Ordering::Relaxed);
        assert_eq!(
            <crate::configs::RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<
                crate::AccountId,
            >>::static_check(&proposal),
            pallet_epoch::StaticCheckDisposition::Eligible,
            "the exact four-call bridge must survive production static screening",
        );
        assert_eq!(
            version_reads.load(Ordering::Relaxed),
            0,
            "static screening must consume only the cached descriptor, never full recovery Wasm",
        );

        let mut wrong_name_calls = calls.clone();
        wrong_name_calls[1] = crate::RuntimeCall::ExecutionGuard(
            pallet_execution_guard::Call::commit_recovery_image {
                hash: wrong_name_recovery_hash,
                len: u32::try_from(wrong_name_recovery.len())
                    .expect("test recovery length fits u32"),
                target_spec_version: current.spec_version.saturating_add(2),
                attestation_id: wrong_name_recovery_attestation.id,
            },
        );
        let (wrong_name_hash, wrong_name_len) = tests::note_runtime_batch(wrong_name_calls)
            .expect("wrong-name bridge batch is encodable");
        <crate::Preimage as QueryPreimage>::request(&wrong_name_hash);
        let mut wrong_name_proposal = proposal.clone();
        wrong_name_proposal.payload_hash = wrong_name_hash.0;
        wrong_name_proposal.payload_len = wrong_name_len;
        pallet_epoch::IntakeProposals::<Runtime>::insert(PID, wrong_name_proposal.clone());
        assert_eq!(
            crate::ExecutionGuard::qualify_recovery_image(
                crate::RuntimeOrigin::signed(tests::account(0xd4)),
                PID,
            ),
            Err(pallet_execution_guard::Error::<Runtime>::UpgradeVersionMismatch.into()),
            "a terminal image with the wrong spec_name must fail in the qualifier",
        );
        assert_eq!(
            <crate::configs::RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<
                crate::AccountId,
            >>::static_check(&wrong_name_proposal),
            pallet_epoch::StaticCheckDisposition::Refund(
                futarchy_primitives::RejectReason::ProcessHold,
            ),
            "a terminal recovery image with the wrong spec_name must fail qualification",
        );

        let mut wrong_target_calls = calls.clone();
        wrong_target_calls[1] = crate::RuntimeCall::ExecutionGuard(
            pallet_execution_guard::Call::commit_recovery_image {
                hash: recovery_hash,
                len: u32::try_from(recovery.len()).expect("test recovery length fits u32"),
                target_spec_version: current.spec_version.saturating_add(1),
                attestation_id: recovery_attestation.id,
            },
        );
        let (wrong_target_hash, wrong_target_len) = tests::note_runtime_batch(wrong_target_calls)
            .expect("wrong-target bridge batch is encodable");
        <crate::Preimage as QueryPreimage>::request(&wrong_target_hash);
        let mut wrong_target_proposal = proposal.clone();
        wrong_target_proposal.payload_hash = wrong_target_hash.0;
        wrong_target_proposal.payload_len = wrong_target_len;
        pallet_epoch::IntakeProposals::<Runtime>::insert(PID, wrong_target_proposal.clone());
        assert_eq!(
            crate::ExecutionGuard::qualify_recovery_image(
                crate::RuntimeOrigin::signed(tests::account(0xd4)),
                PID,
            ),
            Err(pallet_execution_guard::Error::<Runtime>::RecoveryImageInvalid.into()),
            "a terminal image targeting N+1 instead of N+2 must fail in the qualifier",
        );
        assert_eq!(
            <crate::configs::RuntimeConstitutionAccess as pallet_epoch::ConstitutionAccess<
                crate::AccountId,
            >>::static_check(&wrong_target_proposal),
            pallet_epoch::StaticCheckDisposition::Refund(
                futarchy_primitives::RejectReason::ProcessHold,
            ),
            "a terminal recovery image targeting N+1 instead of N+2 must fail qualification",
        );

        let saved_host = cumulus_pallet_parachain_system::HostConfiguration::<Runtime>::get()
            .expect("the valid preflight boundary is seeded");
        pallet_epoch::IntakeProposals::<Runtime>::insert(PID, proposal.clone());
        cumulus_pallet_parachain_system::HostConfiguration::<Runtime>::mutate(|host| {
            host.as_mut()
                .expect("the host boundary remains present")
                .max_code_size = u32::try_from(recovery.len().saturating_sub(1))
                .expect("test recovery length fits u32");
        });
        assert_eq!(
            crate::ExecutionGuard::qualify_recovery_image(
                crate::RuntimeOrigin::signed(tests::account(0xd4)),
                PID,
            ),
            Err(pallet_execution_guard::Error::<Runtime>::RecoveryImageInvalid.into()),
            "a recovery image over the relay host maximum must fail qualifier preflight",
        );
        cumulus_pallet_parachain_system::HostConfiguration::<Runtime>::put(saved_host);

        pallet_epoch::IntakeProposals::<Runtime>::remove(PID);
        proposal.state = futarchy_primitives::ProposalState::Queued;
        pallet_epoch::Proposals::<Runtime>::insert(PID, proposal);
        pallet_epoch::ProposalSchedules::<Runtime>::insert(
            PID,
            pallet_epoch::ProposalSchedule {
                epoch,
                epoch_start_block: schedule.epoch_start_block,
                epoch_length: schedule.length,
                decide_at: now,
                metric_spec: 1,
            },
        );
        pallet_conditional_ledger::Vaults::<Runtime>::insert(
            PID,
            pallet_conditional_ledger::core_ledger::VaultInfo::open(1),
        );
        let declared_domains = pallet_execution_guard::pallet::StoredDomains::try_from(vec![
            pallet_execution_guard::CallDomain::InternalRootAuthorizeUpgrade,
            pallet_execution_guard::CallDomain::Code,
            pallet_execution_guard::CallDomain::Meta,
        ])
        .expect("bridge domains fit");
        let meters_declared =
            pallet_execution_guard::pallet::StoredMeters::try_from(footprint.clone().into_inner())
                .expect("bridge resources fit");
        assert!(crate::ExecutionGuard::enqueue(
            crate::RuntimeOrigin::signed(crate::configs::epoch_account()),
            pallet_execution_guard::pallet::StoredQueuedExecution {
                pid: PID,
                payload_hash: payload_hash.0,
                payload_len,
                class: futarchy_primitives::ProposalClass::Meta,
                maturity,
                grace_end,
                version_constraint: current,
                meters_declared,
                ratify_ref: None,
                ratification_passed: false,
                attestation_id: Some(primary_attestation.id),
                pre_upgrade_checkpoint: None,
                cancelled: false,
                declared_domains,
                failed_at: None,
            },
            false,
        )
        .is_ok());
        assert!(crate::ExecutionGuard::bind_ratification(PID, RATIFY_REF).is_ok());
        assert!(crate::ExecutionGuard::ratify(
            pallet_origins::Origin::ConstitutionalValues.into(),
            PID,
            RATIFY_REF,
        )
        .is_ok());
        System::set_block_number(maturity);
        assert!(
            <crate::classifier::RuntimeDispatcher as pallet_execution_guard::BatchDispatcher<
                crate::RuntimeCall,
            >>::phase_four_plan(futarchy_primitives::ProposalClass::Meta, &calls)
            .is_some(),
            "the exact queued payload must remain the Phase-4 bridge at authorization time",
        );
        let sudo = pallet_sudo::Key::<Runtime>::get().expect("bootstrap preset has sudo");
        let authorization = crate::ExecutionGuard::authorize_phase_four(
            crate::RuntimeOrigin::signed(sudo),
            PID,
            [0x61; 32],
        );
        assert!(
            authorization.is_ok(),
            "exact bridge authorization failed: {authorization:?}",
        );

        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(tvl_key).map(|record| record.value),
            Some(tvl_before.value),
            "the cap commitment must not dispatch before the no-Sudo image applies",
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(deposit_key).map(|record| record.value),
            Some(deposit_before.value),
            "the cap commitment must not dispatch before the no-Sudo image applies",
        );
        assert_eq!(
            System::authorized_upgrade().map(|authorization| authorization.code_hash().0),
            Some(candidate_hash),
        );
        assert!(matches!(
            pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
            pallet_execution_guard::PhaseFourBridgeState::Pending {
                pid: PID,
                code_hash,
                plan,
            } if code_hash == candidate_hash
                && plan == (pallet_execution_guard::PhaseFourPlan {
                    tvl_cap: tvl_after.as_u128(),
                    deposit_cap: deposit_after.as_u128(),
                })
        ));
        assert!(
            pallet_execution_guard::RecoveryImage::<Runtime>::get().is_some_and(|commitment| {
                commitment.pid == PID
                    && commitment.primary_hash == candidate_hash
                    && commitment.hash == recovery_hash
            })
        );
    });
}

/// Cumulus retaining the candidate is still relay-abortable. The bridge stays
/// pending and unlocked until the relay applies the exact code; the
/// `OnSystemEvent` callback owns the atomic Pending→Scheduled + lock boundary.
#[cfg(feature = "bootstrap")]
#[test]
fn real_upgrade_dispatcher_preserves_abortable_bridge_until_relay_application() {
    tests::upgrade_ext().execute_with(|| {
        type Dispatcher = crate::classifier::RuntimeDispatcher;

        let candidate = b"phase-four-dispatch-boundary".to_vec();
        let candidate_hash = sp_io::hashing::blake2_256(&candidate);
        pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
            pallet_execution_guard::PhaseFourBridgeState::Pending {
                pid: 4_004,
                code_hash: candidate_hash,
                plan: pallet_execution_guard::PhaseFourPlan {
                    tvl_cap: 2,
                    deposit_cap: 3,
                },
            },
        );

        assert!(
            <Dispatcher as pallet_execution_guard::BatchDispatcher<crate::RuntimeCall>>::dispatch_authorize_upgrade(
                candidate_hash,
            )
            .is_ok()
        );
        let current = pallet_execution_guard::CurrentSpecName::<Runtime>::get()
            .expect("genesis seeds the frozen runtime identity");
        let now = System::block_number();
        pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
            pallet_execution_guard::PendingUpgrade {
                hash: candidate_hash,
                authorized_at: now,
                applicable_at: now,
                target_spec_version: current.spec_version.saturating_add(1),
            },
        );
        assert!(!crate::configs::PhaseTransitionLock::get());
        assert!(!crate::configs::RecoveryAwareMigrations::ongoing());

        tests::seed_parachain_upgrade_boundary(candidate.len());
        assert!(
            <Dispatcher as pallet_execution_guard::BatchDispatcher<crate::RuntimeCall>>::dispatch_apply_authorized_upgrade(
                candidate.clone(),
            )
            .is_ok()
        );
        assert_eq!(
            cumulus_pallet_parachain_system::PendingValidationCode::<Runtime>::get(),
            candidate,
        );
        assert_eq!(
            pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
            pallet_execution_guard::PhaseFourBridgeState::Pending {
                pid: 4_004,
                code_hash: candidate_hash,
                plan: pallet_execution_guard::PhaseFourPlan {
                    tvl_cap: 2,
                    deposit_cap: 3,
                },
            },
        );
        assert!(!crate::configs::PhaseTransitionLock::get());
        assert!(!crate::configs::RecoveryAwareMigrations::ongoing());
    });
}

/// Regression for the canonical public application surface in 09 §2.1(4).
///
/// A Phase-3→4 bridge cannot rely on the execution-guard wrapper being called:
/// `System::apply_authorized_upgrade` is itself public and is the normative
/// application call. Relay GoAhead must therefore turn that direct schedule
/// into a locked `Scheduled` bridge before the configured `on_runtime_upgrade`
/// chain consumes the transition atomically.
#[cfg(all(feature = "phase-four", not(feature = "recovery")))]
#[test]
fn direct_system_apply_then_go_ahead_completes_phase_four_transition() {
    let candidate = b"phase-four-direct-system-apply".to_vec();
    let mut candidate_version = crate::VERSION;
    candidate_version.spec_version = candidate_version.spec_version.saturating_add(1);
    let current_spec_version = candidate_version.spec_version.saturating_sub(1);
    tests::upgrade_ext_with_artifact_versions(vec![(candidate.clone(), candidate_version.clone())])
        .execute_with(|| {
            fund_nav_above_param_floor();
            let candidate_hash = sp_io::hashing::blake2_256(&candidate);
            let current = futarchy_primitives::RuntimeVersionConstraint {
                spec_name: candidate_version
                    .spec_name
                    .as_bytes()
                    .to_vec()
                    .try_into()
                    .expect("frozen spec name fits"),
                spec_version: current_spec_version,
            };
            pallet_execution_guard::CurrentSpecName::<Runtime>::put(current);

            let source_flags = pallet_constitution::PhaseFlagsValue::SHADOW_MODE
                | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT;
            pallet_constitution::PhaseFlags::<Runtime>::put(source_flags);
            let mut sudo_key = [0u8; 32];
            sudo_key[..16].copy_from_slice(&sp_io::hashing::twox_128(b"Sudo"));
            sudo_key[16..].copy_from_slice(&sp_io::hashing::twox_128(b"Key"));
            sp_io::storage::set(&sudo_key, &[1]);

            let tvl_key = pallet_constitution::key16(b"phase3.tvl_cap");
            let deposit_key = pallet_constitution::key16(b"phase3.dep_cap");
            let tvl_cap = pallet_constitution::Params::<Runtime>::get(tvl_key)
                .expect("TVL cap is registered")
                .value
                .as_u128()
                .saturating_add(1);
            let deposit_cap = pallet_constitution::Params::<Runtime>::get(deposit_key)
                .expect("deposit cap is registered")
                .value
                .as_u128()
                .saturating_add(1);
            let plan = pallet_execution_guard::PhaseFourPlan {
                tvl_cap,
                deposit_cap,
            };
            pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
                pallet_execution_guard::PhaseFourBridgeState::Pending {
                    pid: 4_004,
                    code_hash: candidate_hash,
                    plan,
                },
            );
            pallet_execution_guard::RecoveryImage::<Runtime>::put(
                pallet_execution_guard::RecoveryImageCommitment {
                    pid: 4_004,
                    primary_hash: candidate_hash,
                    hash: [0x55; 32],
                    len: 1,
                    target_spec_version: candidate_version.spec_version.saturating_add(1),
                    attestation_id: 7,
                    committed_at: System::block_number(),
                },
            );
            pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
                pallet_execution_guard::PendingUpgrade {
                    hash: candidate_hash,
                    authorized_at: System::block_number(),
                    applicable_at: System::block_number(),
                    target_spec_version: candidate_version.spec_version,
                },
            );

            assert!(
                <crate::classifier::RuntimeDispatcher as pallet_execution_guard::BatchDispatcher<
                    crate::RuntimeCall,
                >>::dispatch_authorize_upgrade(candidate_hash)
                .is_ok()
            );
            tests::seed_parachain_upgrade_boundary(candidate.len());
            assert!(
                System::apply_authorized_upgrade(
                    crate::RuntimeOrigin::signed(tests::account(0x44)),
                    candidate.clone(),
                )
                .is_ok(),
                "the exact public FRAME application call must schedule the authorized image",
            );

            assert_eq!(
                pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
                pallet_execution_guard::PhaseFourBridgeState::Pending {
                    pid: 4_004,
                    code_hash: candidate_hash,
                    plan,
                },
                "code scheduling alone is still relay-abortable and must preserve the pending bridge",
            );
            assert!(!crate::configs::PhaseTransitionLock::get());
            assert!(!crate::configs::PhaseTransitionApplied::get());

            System::set_block_number(System::block_number().saturating_add(1));
            let _ = ExecutionGuard::on_initialize(System::block_number());
            assert_eq!(
                pallet_execution_guard::ScheduledUpgrade::<Runtime>::get(),
                Some(candidate_hash),
                "the ordinary next-block hook must observe the Cumulus schedule for Abort handling",
            );

            tests::submit_relay_upgrade_go_ahead();
            assert!(
                crate::configs::PhaseTransitionApplied::get(),
                "relay GoAhead must mark the installed Phase-4 image for the next runtime-upgrade hook",
            );
            assert!(
                crate::configs::PhaseTransitionLock::get(),
                "the GoAhead callback must arm OnlyInherents before on_runtime_upgrade",
            );
            assert_eq!(
                pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
                pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                    pid: 4_004,
                    code_hash: candidate_hash,
                    plan,
                },
                "the GoAhead callback must schedule the bridge before on_runtime_upgrade",
            );

            let _ = crate::Executive::execute_on_runtime_upgrade();

            assert!(!sp_io::storage::exists(&sudo_key));
            assert_eq!(
                pallet_constitution::PhaseFlags::<Runtime>::get(),
                pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            );
            assert_eq!(
                pallet_constitution::Params::<Runtime>::get(tvl_key)
                    .map(|record| record.value.as_u128()),
                Some(tvl_cap),
            );
            assert_eq!(
                pallet_constitution::Params::<Runtime>::get(deposit_key)
                    .map(|record| record.value.as_u128()),
                Some(deposit_cap),
            );
            assert!(pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::get().is_none());
            assert_eq!(
                pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
                pallet_execution_guard::PhaseFourBridgeState::Consumed,
            );
            assert!(!crate::configs::PhaseTransitionApplied::get());
            assert!(!crate::configs::PhaseTransitionLock::get());
            assert!(crate::configs::RuntimePhaseState::exact_phase_four());
        });
}

/// The pallet-removal image consumes the exact Phase-3 source state once. The
/// migration may remain wired in later Phase-4 images, but must never reset a
/// subsequently expanded phase mask back to PARAM-only.
#[cfg(feature = "phase-four")]
#[test]
fn sq383_phase_four_transition_refuses_below_the_param_nav_floor() {
    // 08 §4.2 binds *every* writer of the arming bits, not only
    // `constitution.set_phase_flag`. The Phase-3→4 migration used to write
    // `PhaseFlags = PARAM_ARMED` directly, so the minimum-viable-NAV floor
    // stopped binding at exactly the point the chain loses sudo. The refusal
    // must be fail-static: nothing armed, sudo retained, caps unchanged, lock
    // held, and the loud halt-source marker set.
    tests::development_ext().execute_with(|| {
        let mut sudo_key = [0u8; 32];
        sudo_key[..16].copy_from_slice(&sp_io::hashing::twox_128(b"Sudo"));
        sudo_key[16..].copy_from_slice(&sp_io::hashing::twox_128(b"Key"));
        sp_io::storage::set(&sudo_key, &[1]);

        // Precondition: spendable NAV is below the PARAM floor.
        assert!(
            crate::FutarchyTreasury::nav().spendable_nav
                < crate::FutarchyTreasury::floor(futarchy_primitives::ProposalClass::Param)
        );

        let source_flags = pallet_constitution::PhaseFlagsValue::SHADOW_MODE
            | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT;
        pallet_constitution::PhaseFlags::<Runtime>::put(source_flags);
        crate::configs::PhaseTransitionLock::put(true);
        crate::configs::PhaseTransitionApplied::put(true);
        let tvl_key = pallet_constitution::key16(b"phase3.tvl_cap");
        let tvl_before = pallet_constitution::Params::<Runtime>::get(tvl_key)
            .expect("TVL cap is registered")
            .value
            .as_u128();
        pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
            pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                pid: 4_005,
                code_hash: [0x46; 32],
                plan: pallet_execution_guard::PhaseFourPlan {
                    tvl_cap: tvl_before.saturating_add(1),
                    deposit_cap: 1,
                },
            },
        );

        let _ = crate::migrations::PhaseFourTransition::on_runtime_upgrade();

        assert_eq!(
            pallet_constitution::PhaseFlags::<Runtime>::get(),
            source_flags,
            "an under-floor transition must leave the Phase-3 arming bits exactly as they were",
        );
        assert!(
            sp_io::storage::exists(&sudo_key),
            "the sudo key is the operator recourse the refusal must preserve",
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(tvl_key)
                .map(|record| record.value.as_u128()),
            Some(tvl_before),
            "the cap raise rolls back with the rest of the transition",
        );
        assert!(crate::configs::PhaseTransitionLock::get());
        assert!(crate::configs::PhaseTransitionApplied::get());
        assert!(!crate::configs::RuntimePhaseState::exact_phase_four());
        assert_eq!(
            pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
            pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                pid: 4_005,
                code_hash: [0x46; 32],
                plan: pallet_execution_guard::PhaseFourPlan {
                    tvl_cap: tvl_before.saturating_add(1),
                    deposit_cap: 1,
                },
            },
            "the bridge is not consumed, so a funded retry can still transition",
        );

        // Proof that the NAV floor is the *only* thing refusing here: funding
        // past it makes the same gate admit. The full funded transition is
        // covered by `phase_four_profile_removes_sudo_and_never_rearms_…`.
        fund_nav_above_param_floor();
        assert!(<crate::configs::TreasuryPhaseArmingGate as pallet_constitution::PhaseArmingGate>
            ::ensure_armable(futarchy_primitives::ProposalClass::Param)
            .is_ok());
    });
}

#[cfg(all(feature = "phase-four", not(feature = "recovery")))]
#[test]
fn phase_four_profile_removes_sudo_and_never_rearms_the_one_shot_transition() {
    tests::development_ext().execute_with(|| {
        fund_nav_above_param_floor();
        let mut sudo_key = [0u8; 32];
        sudo_key[..16].copy_from_slice(&sp_io::hashing::twox_128(b"Sudo"));
        sudo_key[16..].copy_from_slice(&sp_io::hashing::twox_128(b"Key"));
        sp_io::storage::set(&sudo_key, &[1]);

        let source_flags = pallet_constitution::PhaseFlagsValue::SHADOW_MODE
            | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT;
        pallet_constitution::PhaseFlags::<Runtime>::put(source_flags);
        crate::configs::PhaseTransitionLock::put(true);
        crate::configs::PhaseTransitionApplied::put(true);
        let tvl_key = pallet_constitution::key16(b"phase3.tvl_cap");
        let deposit_key = pallet_constitution::key16(b"phase3.dep_cap");
        let tvl_cap = pallet_constitution::Params::<Runtime>::get(tvl_key)
            .expect("TVL cap is registered")
            .value
            .as_u128()
            .saturating_add(1);
        let deposit_cap = pallet_constitution::Params::<Runtime>::get(deposit_key)
            .expect("deposit cap is registered")
            .value
            .as_u128()
            .saturating_add(1);
        let current = pallet_execution_guard::CurrentSpecName::<Runtime>::get()
            .expect("genesis seeds the frozen runtime identity");
        let authorized_at = System::block_number();
        let applicable_at =
            authorized_at.saturating_add(pallet_execution_guard::DESCRIPTOR_LEAD_TIME);
        let target_spec_version = current.spec_version.saturating_add(1);
        System::set_block_number(applicable_at);
        pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
            pallet_execution_guard::PendingUpgrade {
                hash: [0x44; 32],
                authorized_at,
                applicable_at,
                target_spec_version,
            },
        );
        pallet_execution_guard::RecoveryImage::<Runtime>::put(
            pallet_execution_guard::RecoveryImageCommitment {
                pid: 4_004,
                primary_hash: [0x44; 32],
                hash: [0x55; 32],
                len: 1,
                target_spec_version: target_spec_version.saturating_add(1),
                attestation_id: 7,
                committed_at: authorized_at,
            },
        );
        pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
            pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                pid: 4_004,
                code_hash: [0x44; 32],
                plan: pallet_execution_guard::PhaseFourPlan {
                    tvl_cap,
                    deposit_cap,
                },
            },
        );

        let _ = crate::migrations::PhaseFourTransition::on_runtime_upgrade();
        assert!(!sp_io::storage::exists(&sudo_key));
        assert_eq!(
            pallet_constitution::PhaseFlags::<Runtime>::get(),
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(tvl_key)
                .map(|record| record.value.as_u128()),
            Some(tvl_cap),
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(deposit_key)
                .map(|record| record.value.as_u128()),
            Some(deposit_cap),
        );
        assert!(!crate::configs::PhaseTransitionApplied::get());
        assert!(!crate::configs::PhaseTransitionLock::get());
        assert_eq!(
            pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
            pallet_execution_guard::PhaseFourBridgeState::Consumed,
        );
        assert!(crate::configs::RuntimePhaseState::exact_phase_four());

        let later_flags = pallet_constitution::PhaseFlagsValue::PARAM_ARMED
            | pallet_constitution::PhaseFlagsValue::TREASURY_ARMED;
        pallet_constitution::PhaseFlags::<Runtime>::put(later_flags);

        let _ = crate::migrations::PhaseFourTransition::on_runtime_upgrade();
        assert_eq!(
            pallet_constitution::PhaseFlags::<Runtime>::get(),
            later_flags,
            "a later runtime upgrade must not replay the Phase-3→4 flag rewrite",
        );
        assert!(!crate::configs::PhaseTransitionApplied::get());
        assert!(!sp_io::storage::exists(&sudo_key));
    });
}

#[cfg(feature = "recovery")]
#[test]
fn phase_transition_terminal_recovery_applies_the_committed_plan_and_unlocks() {
    let recovery = b"phase-transition-terminal-recovery".to_vec();
    tests::upgrade_ext_with_artifact_versions(vec![(recovery.clone(), crate::VERSION)])
        .execute_with(|| {
            let recovery_hash = sp_io::hashing::blake2_256(&recovery);
            let noted = <crate::Preimage as StorePreimage>::note(recovery.clone().into())
                .expect("recovery preimage is stored");
            assert_eq!(noted.0, recovery_hash);
            <crate::Preimage as QueryPreimage>::request(&noted);
            sp_io::storage::set(sp_core::storage::well_known_keys::CODE, &recovery);

            let mut sudo_key = [0u8; 32];
            sudo_key[..16].copy_from_slice(&sp_io::hashing::twox_128(b"Sudo"));
            sudo_key[16..].copy_from_slice(&sp_io::hashing::twox_128(b"Key"));
            sp_io::storage::set(&sudo_key, &[1]);
            pallet_constitution::PhaseFlags::<Runtime>::put(
                pallet_constitution::PhaseFlagsValue::SHADOW_MODE
                    | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT,
            );
            let tvl_key = pallet_constitution::key16(b"phase3.tvl_cap");
            let deposit_key = pallet_constitution::key16(b"phase3.dep_cap");
            let tvl_cap = pallet_constitution::Params::<Runtime>::get(tvl_key)
                .expect("TVL cap exists")
                .value
                .as_u128()
                .saturating_add(1);
            let deposit_cap = pallet_constitution::Params::<Runtime>::get(deposit_key)
                .expect("deposit cap exists")
                .value
                .as_u128()
                .saturating_add(1);
            let primary_hash = [0x44; 32];
            let pid = 4_006;
            pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
                pallet_execution_guard::PendingUpgrade {
                    hash: primary_hash,
                    authorized_at: 1,
                    applicable_at: 1,
                    target_spec_version: crate::VERSION.spec_version.saturating_sub(1),
                },
            );
            pallet_execution_guard::RecoveryImage::<Runtime>::put(
                pallet_execution_guard::RecoveryImageCommitment {
                    pid,
                    primary_hash,
                    hash: recovery_hash,
                    len: u32::try_from(recovery.len()).expect("recovery length fits"),
                    target_spec_version: crate::VERSION.spec_version,
                    attestation_id: 8,
                    committed_at: 1,
                },
            );
            pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
                pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                    pid,
                    code_hash: primary_hash,
                    plan: pallet_execution_guard::PhaseFourPlan {
                        tvl_cap,
                        deposit_cap,
                    },
                },
            );
            crate::configs::PhaseTransitionLock::put(true);
            crate::configs::PhaseTransitionApplied::put(true);
            crate::configs::RecoveryCodeApplied::put(true);
            crate::configs::RecoveryLockdown::put(true);
            crate::configs::RecoveryScheduledHash::put(recovery_hash);

            let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();

            assert!(!sp_io::storage::exists(&sudo_key));
            assert_eq!(
                pallet_constitution::PhaseFlags::<Runtime>::get(),
                pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            );
            assert_eq!(
                pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
                pallet_execution_guard::PhaseFourBridgeState::Consumed,
            );
            assert!(!crate::configs::RecoveryAwareMigrations::ongoing());
            assert!(!pallet_execution_guard::RecoveryImage::<Runtime>::exists());
            assert!(!crate::configs::RecoveryScheduledHash::exists());
        });
}

#[cfg(feature = "recovery")]
#[test]
fn terminal_recovery_with_a_malformed_retired_cursor_fails_closed() {
    let recovery = b"terminal-recovery-with-unrepairable-retired-cursor".to_vec();
    tests::upgrade_ext_with_artifact_versions(vec![(recovery.clone(), crate::VERSION)])
        .execute_with(|| {
            let recovery_hash = sp_io::hashing::blake2_256(&recovery);
            let retired =
                pallet_migrations::MigrationCursor::Active(pallet_migrations::ActiveCursor {
                    index: 0,
                    inner_cursor: Some(BoundedVec::truncate_from(vec![0x71, 0x72])),
                    started_at: 3,
                });
            sp_io::storage::set(sp_core::storage::well_known_keys::CODE, &recovery);
            crate::configs::RecoveryCodeApplied::put(true);
            crate::configs::RecoveryLockdown::put(true);
            crate::configs::RecoveryScheduledHash::put(recovery_hash);
            crate::configs::RetiredMigrationCursor::put(retired.clone());
            pallet_execution_guard::RecoveryImage::<Runtime>::put(
                pallet_execution_guard::RecoveryImageCommitment {
                    pid: 4_005,
                    primary_hash: [0x44; 32],
                    hash: recovery_hash,
                    len: u32::try_from(recovery.len()).expect("test recovery length fits u32"),
                    target_spec_version: crate::VERSION.spec_version,
                    attestation_id: 8,
                    committed_at: System::block_number(),
                },
            );

            let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();

            assert!(crate::configs::RecoveryLockdown::get());
            assert!(crate::configs::RecoveryCodeApplied::get());
            assert_eq!(
                crate::configs::RecoveryScheduledHash::get(),
                Some(recovery_hash),
            );
            assert_eq!(crate::configs::RetiredMigrationCursor::get(), Some(retired),);
            assert!(
                pallet_execution_guard::RecoveryImage::<Runtime>::exists(),
                "the unconsumed recovery commitment must remain pinned for a corrected image",
            );
            assert!(
                crate::configs::RecoveryAwareMigrations::ongoing(),
                "an unrepairable ordinary MBM cutpoint must leave OnlyInherents engaged",
            );
            assert!(
                pallet_execution_guard::MigrationHalt::<Runtime>::get(),
                "the failed terminal repair must preserve the migration halt",
            );
        });
}

#[test]
fn recovery_lockdown_persists_only_inherents_after_cursor_retirement() {
    tests::development_ext().execute_with(|| {
        assert!(!pallet_migrations::Cursor::<Runtime>::exists());
        crate::configs::RecoveryLockdown::put(true);
        assert!(crate::configs::RecoveryAwareMigrations::ongoing());
        assert_eq!(
            crate::configs::RecoveryAwareMigrations::step(),
            crate::configs::recovery_aware_migration_detector_weight(),
        );
        assert!(crate::configs::RecoveryLockdown::get());

        crate::configs::RecoveryBypass::put(true);
        assert!(
            !crate::configs::RecoveryAwareMigrations::ongoing(),
            "only the internal scheduling scope may temporarily bypass lockdown",
        );
        crate::configs::RecoveryBypass::kill();
        assert!(
            crate::configs::RecoveryAwareMigrations::ongoing(),
            "removing the scheduling bypass immediately restores lockdown",
        );

        let header = crate::Header::new(
            1,
            Default::default(),
            Default::default(),
            System::block_hash(0),
            Default::default(),
        );
        let mode = crate::Executive::initialize_block(&header);
        assert!(matches!(
            mode,
            sp_runtime::ExtrinsicInclusionMode::OnlyInherents
        ));
        assert!(
            crate::configs::RecoveryLockdown::get(),
            "block initialization must not consume the relay-wait lockdown",
        );
        assert!(!pallet_migrations::Cursor::<Runtime>::exists());
    });
}

#[test]
fn relay_abort_restores_exact_cursor_and_keeps_recovery_lockdown() {
    use cumulus_pallet_parachain_system::OnSystemEvent;
    use cumulus_primitives_core::relay_chain::UpgradeGoAhead;

    tests::development_ext().execute_with(|| {
        let retired = pallet_migrations::MigrationCursor::Active(pallet_migrations::ActiveCursor {
            index: 3,
            inner_cursor: Some(BoundedVec::truncate_from(vec![0x31, 0x32, 0x33])),
            started_at: 17,
        });
        let recovery_hash = [0xa5; 32];
        crate::configs::RecoveryLockdown::put(true);
        crate::configs::RetiredMigrationCursor::put(retired.clone());
        crate::configs::RecoveryScheduledHash::put(recovery_hash);
        cumulus_pallet_parachain_system::PendingValidationCode::<Runtime>::kill();
        cumulus_pallet_parachain_system::UpgradeGoAhead::<Runtime>::put(Some(
            UpgradeGoAhead::Abort,
        ));
        pallet_migrations::Cursor::<Runtime>::kill();

        crate::configs::ExecutionGuardSystemEvent::on_validation_data(
            &cumulus_primitives_core::PersistedValidationData::default(),
        );

        assert_eq!(pallet_migrations::Cursor::<Runtime>::get(), Some(retired));
        assert!(crate::configs::RecoveryLockdown::get());
        assert!(crate::configs::RecoveryAborted::get());
        assert!(crate::configs::RecoveryScheduledHash::get().is_none());
        assert!(crate::configs::RetiredMigrationCursor::exists());
        assert!(crate::configs::RecoveryAwareMigrations::ongoing());

        // The Abort is consumed exactly once. A repeated validation-data hook
        // cannot erase the restored cursor or silently reopen transactions.
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(
            &cumulus_primitives_core::PersistedValidationData::default(),
        );
        assert!(pallet_migrations::Cursor::<Runtime>::exists());
        assert!(crate::configs::RecoveryLockdown::get());
        assert!(crate::configs::RecoveryAwareMigrations::ongoing());
    });
}

/// 09 §3.2(4) requires the diagnostic to carry the SDK cursor's exact bytes.
/// `CursorMaxLen` bounds only the migration-owned inner cursor, so the event
/// envelope must also cover the outer enum/index/option/length/block fields.
#[test]
fn migration_halted_cursor_bound_covers_the_full_sdk_cursor_encoding() {
    let sdk_max = <pallet_migrations::CursorOf<Runtime> as MaxEncodedLen>::max_encoded_len();
    assert!(
        sdk_max <= pallet_execution_guard::MAX_MIGRATION_HALT_CURSOR_BOUND as usize,
        "MigrationHalted cursor bound must cover the full encoded SDK cursor: {sdk_max} > {}",
        pallet_execution_guard::MAX_MIGRATION_HALT_CURSOR_BOUND,
    );
}

/// SQ-132 + SQ-146: the first storage migration retires both inert items and
/// advances `pallet-execution-guard`'s storage version 0 -> 1, and its version
/// gate makes a re-run a no-op. It creates no `pallet-migrations` cursor, so it
/// never engages the `OnlyInherents` lockdown.
#[test]
fn first_migration_retires_both_keys_bumps_version_and_is_idempotent() {
    tests::development_ext().execute_with(|| {
        // Model a pre-B16 upgraded chain: version 0, both keys populated.
        StorageVersion::new(0).put::<ExecutionGuard>();
        let bm = crate::migrations::retired::blocked_meters_key();
        let pm = crate::migrations::retired::progress_marker_key();
        // Cross-check each retired key against a *live* sibling that shares its
        // prefix, so a future pallet/instance rename cannot silently point the
        // migration at a non-existent key and orphan the real bytes (SQ-66 class).
        assert_eq!(
            bm[..16],
            pallet_execution_guard::HardGateBreach::<Runtime>::hashed_key()[..16],
            "BlockedMeters must share the live ExecutionGuard pallet prefix",
        );
        assert_eq!(
            pm[..16],
            crate::configs::MigrationHaltSources::hashed_key()[..16],
            "ProgressMarker must share the live BleavitRuntimeMigration instance prefix",
        );
        unhashed::put_raw(&bm, &[1u8, 2, 3]);
        unhashed::put_raw(&pm, &[4u8, 5, 6, 7]);
        assert!(unhashed::exists(&bm) && unhashed::exists(&pm));

        let _weight = <crate::migrations::RetireB16State as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert!(!unhashed::exists(&bm), "BlockedMeters key retired");
        assert!(
            !unhashed::exists(&pm),
            "MigrationProgressMarker key retired"
        );
        assert_eq!(
            ExecutionGuard::on_chain_storage_version(),
            StorageVersion::new(1),
            "execution-guard storage version advanced 0 -> 1",
        );
        assert!(
            !pallet_migrations::Cursor::<Runtime>::exists(),
            "a single-block migration creates no MBM cursor (09 §3.2)",
        );

        // Re-run on the already-migrated chain: version 1 != FROM(0) -> no-op, so
        // re-seeded state is left untouched (the version gate, SQ-66 discipline).
        unhashed::put_raw(&bm, &[9u8]);
        let _ = <crate::migrations::RetireB16State as OnRuntimeUpgrade>::on_runtime_upgrade();
        assert!(
            unhashed::exists(&bm),
            "a version-gated re-run is a no-op and clears nothing",
        );
    });
}

#[test]
fn oracle_v1_migration_retires_legacy_query_and_reconciles_both_health_mirrors() {
    for unhealthy in [false, true] {
        tests::development_ext().execute_with(|| {
            StorageVersion::new(0).put::<Oracle>();
            let legacy = pallet_oracle::ReserveHealthValue {
                consecutive_fails: 17,
                consecutive_passes: 19,
                unhealthy,
                last_query_id: 77,
                last_probe_at: 91,
                pending_since: Some(83),
            };
            pallet_oracle::ReserveHealth::<Runtime>::put(legacy);
            pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
            pallet_constitution::PhaseFlags::<Runtime>::mutate(|bits| {
                if unhealthy {
                    *bits &= !pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG;
                } else {
                    *bits |= pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG;
                }
            });
            pallet_futarchy_treasury::State::<Runtime>::mutate(|state| {
                state.reserve_impaired = !unhealthy;
            });

            let _ = <crate::migrations::MigrateOracleReserveProbeV1 as OnRuntimeUpgrade>::on_runtime_upgrade();

            assert_eq!(StorageVersion::get::<Oracle>(), StorageVersion::new(1));
            assert_eq!(
                pallet_oracle::ReserveHealth::<Runtime>::get(),
                pallet_oracle::ReserveHealthValue {
                    last_query_id: 0,
                    last_probe_at: 0,
                    pending_since: None,
                    ..legacy
                }
            );
            assert!(!pallet_oracle::ReserveProbeArmed::<Runtime>::get());
            assert_eq!(
                pallet_constitution::PhaseFlags::<Runtime>::get()
                    & pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG
                    != 0,
                unhealthy
            );
            assert_eq!(
                pallet_futarchy_treasury::State::<Runtime>::get().reserve_impaired,
                unhealthy
            );

            let snapshot = (
                pallet_oracle::ReserveHealth::<Runtime>::get(),
                pallet_oracle::ReserveProbeArmed::<Runtime>::get(),
                pallet_constitution::PhaseFlags::<Runtime>::get(),
                pallet_futarchy_treasury::State::<Runtime>::get(),
            );
            let _ = <crate::migrations::MigrateOracleReserveProbeV1 as OnRuntimeUpgrade>::on_runtime_upgrade();
            assert_eq!(
                snapshot,
                (
                    pallet_oracle::ReserveHealth::<Runtime>::get(),
                    pallet_oracle::ReserveProbeArmed::<Runtime>::get(),
                    pallet_constitution::PhaseFlags::<Runtime>::get(),
                    pallet_futarchy_treasury::State::<Runtime>::get(),
                )
            );
        });
    }
}

#[cfg(feature = "try-runtime")]
#[test]
fn oracle_v1_try_runtime_proves_the_full_legacy_transition() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<Oracle>();
        let legacy = pallet_oracle::ReserveHealthValue {
            consecutive_fails: 7,
            consecutive_passes: 11,
            unhealthy: true,
            last_query_id: 99,
            last_probe_at: 123,
            pending_since: Some(117),
        };
        pallet_oracle::ReserveHealth::<Runtime>::put(legacy);
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_constitution::PhaseFlags::<Runtime>::mutate(|bits| {
            *bits &= !pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG;
        });
        pallet_futarchy_treasury::State::<Runtime>::mutate(|state| {
            state.reserve_impaired = false;
        });

        let state =
            <crate::migrations::MigrateOracleReserveProbeV1 as OnRuntimeUpgrade>::pre_upgrade()
                .expect("oracle pre-upgrade snapshot");
        let _ = <crate::migrations::MigrateOracleReserveProbeV1 as OnRuntimeUpgrade>::on_runtime_upgrade();
        <crate::migrations::MigrateOracleReserveProbeV1 as OnRuntimeUpgrade>::post_upgrade(state)
            .expect("oracle post-upgrade checks");

        assert_eq!(StorageVersion::get::<Oracle>(), StorageVersion::new(1));
        assert_eq!(
            pallet_oracle::ReserveHealth::<Runtime>::get(),
            pallet_oracle::ReserveHealthValue {
                last_query_id: 0,
                last_probe_at: 0,
                pending_since: None,
                ..legacy
            }
        );
        assert!(!pallet_oracle::ReserveProbeArmed::<Runtime>::get());
    });
}

fn unrelated_constitution_params() -> Vec<(
    futarchy_primitives::ParamKey,
    pallet_constitution::ParamRecord,
)> {
    let fee = pallet_constitution::key16(b"ops.probe_fee");
    let rate = pallet_constitution::key16(b"ops.probe_rate");
    pallet_constitution::Params::<Runtime>::iter()
        .filter(|(key, _)| *key != fee && *key != rate)
        .collect()
}

fn legacy_probe_control_records() -> [pallet_constitution::ParamRecord; 5] {
    let mut records = crate::migrations::reserve_probe_control_param_records()
        .expect("reserve control rows exist in the registry template");
    for record in &mut records {
        record.min = match record.value {
            pallet_constitution::ParamValue::U32(_) => pallet_constitution::ParamValue::U32(0),
            pallet_constitution::ParamValue::U8(_) => pallet_constitution::ParamValue::U8(0),
            pallet_constitution::ParamValue::Balance(_) => {
                pallet_constitution::ParamValue::Balance(0)
            }
            _ => panic!("unexpected reserve control value kind"),
        };
        record.kernel_bounded = false;
    }
    records
}

fn unrelated_to_probe_controls() -> Vec<(
    futarchy_primitives::ParamKey,
    pallet_constitution::ParamRecord,
)> {
    let keys = crate::migrations::reserve_probe_control_param_records()
        .expect("reserve control rows exist")
        .map(|record| record.key);
    pallet_constitution::Params::<Runtime>::iter()
        .filter(|(key, _)| !keys.contains(key))
        .collect()
}

#[test]
fn constitution_v1_migration_inserts_only_missing_exact_probe_rows() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<Constitution>();
        let (fee, rate) = crate::migrations::reserve_probe_param_records()
            .expect("probe rows exist in the registry template");
        pallet_constitution::Params::<Runtime>::remove(fee.key);
        pallet_constitution::Params::<Runtime>::remove(rate.key);
        let unrelated_before = unrelated_constitution_params();

        let _ = <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(1));
        assert_eq!(pallet_constitution::Params::<Runtime>::get(fee.key), Some(fee));
        assert_eq!(pallet_constitution::Params::<Runtime>::get(rate.key), Some(rate));
        assert_eq!(unrelated_constitution_params(), unrelated_before);
    });
}

#[test]
fn constitution_v1_migration_preserves_exact_existing_rows_and_advances_version() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<Constitution>();
        let (fee, rate) = crate::migrations::reserve_probe_param_records()
            .expect("probe rows exist in the registry template");

        let _ = <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(1));
        assert_eq!(pallet_constitution::Params::<Runtime>::get(fee.key), Some(fee));
        assert_eq!(pallet_constitution::Params::<Runtime>::get(rate.key), Some(rate));
    });
}

#[test]
fn constitution_v1_migration_is_atomic_on_one_mismatched_existing_row() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<Constitution>();
        let (fee, mut rate) = crate::migrations::reserve_probe_param_records()
            .expect("probe rows exist in the registry template");
        pallet_constitution::Params::<Runtime>::remove(fee.key);
        rate.last_change_block = 123;
        pallet_constitution::Params::<Runtime>::insert(rate.key, rate);
        let unrelated_before = unrelated_constitution_params();

        let _ = <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(0));
        assert!(pallet_constitution::Params::<Runtime>::get(fee.key).is_none());
        assert_eq!(pallet_constitution::Params::<Runtime>::get(rate.key), Some(rate));
        assert_eq!(unrelated_constitution_params(), unrelated_before);
    });
}

#[test]
fn constitution_v2_migration_preserves_values_history_and_unrelated_rows() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(1).put::<Constitution>();
        let mut legacy = legacy_probe_control_records();
        for (index, record) in legacy.iter_mut().enumerate() {
            record.last_changed_epoch = 10 + index as u32;
            record.last_change_block = 100 + index as u32;
            pallet_constitution::Params::<Runtime>::insert(record.key, *record);
        }
        let unrelated_before = unrelated_to_probe_controls();
        let expected = crate::migrations::reserve_probe_control_param_records().unwrap();

        let _ = <crate::migrations::MigrateConstitutionReserveProbeV2 as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(2));
        for (index, definition) in expected.into_iter().enumerate() {
            let actual = pallet_constitution::Params::<Runtime>::get(definition.key).unwrap();
            assert_eq!(actual.value, legacy[index].value);
            assert_eq!(actual.last_changed_epoch, legacy[index].last_changed_epoch);
            assert_eq!(actual.last_change_block, legacy[index].last_change_block);
            assert_eq!(actual.min, definition.min);
            assert_eq!(actual.max, definition.max);
            assert_eq!(actual.max_delta, definition.max_delta);
            assert_eq!(actual.cooldown_epochs, definition.cooldown_epochs);
            assert_eq!(actual.class, definition.class);
            assert!(actual.kernel_bounded);
        }
        assert_eq!(unrelated_to_probe_controls(), unrelated_before);
    });
}

#[test]
fn constitution_v2_migration_is_atomic_on_zero_missing_or_wrong_kind_rows() {
    for defect in 0..3 {
        tests::development_ext().execute_with(|| {
            StorageVersion::new(1).put::<Constitution>();
            let legacy = legacy_probe_control_records();
            for record in legacy {
                pallet_constitution::Params::<Runtime>::insert(record.key, record);
            }
            let key = legacy[0].key;
            match defect {
                0 => pallet_constitution::Params::<Runtime>::mutate(key, |record| {
                    record.as_mut().unwrap().value = pallet_constitution::ParamValue::U32(0);
                }),
                1 => pallet_constitution::Params::<Runtime>::remove(key),
                2 => pallet_constitution::Params::<Runtime>::mutate(key, |record| {
                    record.as_mut().unwrap().value = pallet_constitution::ParamValue::U8(1);
                }),
                _ => unreachable!(),
            }
            let before: Vec<_> = pallet_constitution::Params::<Runtime>::iter().collect();

            let _ = <crate::migrations::MigrateConstitutionReserveProbeV2 as OnRuntimeUpgrade>::on_runtime_upgrade();

            assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(1));
            assert_eq!(pallet_constitution::Params::<Runtime>::iter().collect::<Vec<_>>(), before);
        });
    }
}

#[test]
fn constitution_composite_v0_migration_is_atomic_before_pricing_insertion() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<Constitution>();
        let (fee, rate) = crate::migrations::reserve_probe_param_records().unwrap();
        pallet_constitution::Params::<Runtime>::remove(fee.key);
        pallet_constitution::Params::<Runtime>::remove(rate.key);
        let legacy = legacy_probe_control_records();
        for record in legacy {
            pallet_constitution::Params::<Runtime>::insert(record.key, record);
        }
        pallet_constitution::Params::<Runtime>::mutate(legacy[0].key, |record| {
            record.as_mut().unwrap().value = pallet_constitution::ParamValue::U8(1);
        });
        let before: Vec<_> = pallet_constitution::Params::<Runtime>::iter().collect();

        let _ = <crate::migrations::MigrateConstitutionReserveProbeV2 as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(0));
        assert_eq!(pallet_constitution::Params::<Runtime>::iter().collect::<Vec<_>>(), before);
        assert!(!pallet_constitution::Params::<Runtime>::contains_key(fee.key));
        assert!(!pallet_constitution::Params::<Runtime>::contains_key(rate.key));
    });
}

#[test]
fn constitution_v2_migration_is_an_idempotent_current_version_noop() {
    tests::development_ext().execute_with(|| {
        // SQ-173 advanced the Constitution to v3 and SQ-486 to v4, so a genesis
        // chain is already past the v2 migration's window and it must do nothing
        // at all.
        assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(4));
        let before: Vec<_> = pallet_constitution::Params::<Runtime>::iter().collect();
        let _ = <crate::migrations::MigrateConstitutionReserveProbeV2 as OnRuntimeUpgrade>::on_runtime_upgrade();
        assert_eq!(StorageVersion::get::<Constitution>(), StorageVersion::new(4));
        assert_eq!(pallet_constitution::Params::<Runtime>::iter().collect::<Vec<_>>(), before);
    });
}

/// SQ-486 / connector review of #166: the `sec.flow_cap` row is seeded at genesis
/// but an already-live chain never runs genesis, so it needs the v4 migration
/// that 13 §1 (*Existing-chain introduction of new rows*) makes mandatory.
///
/// The bug this pins is deliberately quiet: `sec_flow_cap_1e9` falls back to the
/// compile-time default, so the *gate* stays correct at ×16 while `Params` holds
/// no record — leaving a ceiling the frontend cannot read and governance cannot
/// amend. A test that only checked the computed ceiling would pass either way, so
/// this one asserts on the **record**.
#[test]
fn constitution_v4_migration_seeds_sec_flow_cap_on_an_existing_chain() {
    tests::development_ext().execute_with(|| {
        let record = crate::migrations::security_flow_cap_param_record()
            .expect("sec.flow_cap is in the genesis registry template");

        // An existing chain that predates SQ-486: at v3, with no row.
        StorageVersion::new(3).put::<Constitution>();
        pallet_constitution::Params::<Runtime>::remove(record.key);
        assert!(!pallet_constitution::Params::<Runtime>::contains_key(
            record.key
        ));

        let used = <crate::migrations::MigrateConstitutionSecurityFlowCapV4 as OnRuntimeUpgrade>::on_runtime_upgrade();
        // Strictly more than the version-read-only early return, i.e. the row
        // write and the version write were actually charged for.
        let noop = <Runtime as frame_system::Config>::DbWeight::get().reads(1);
        assert!(used.ref_time() > noop.ref_time());

        assert_eq!(
            StorageVersion::get::<Constitution>(),
            StorageVersion::new(4)
        );
        // Byte-identical to a chain that genesised with the row.
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(record.key),
            Some(record)
        );
    });
}

/// Insert-if-absent, never overwrite: a chain whose governance already moved the
/// ceiling inside its ×7–×32 bounds keeps its own value across the upgrade.
#[test]
fn constitution_v4_migration_never_overwrites_an_amended_flow_cap() {
    tests::development_ext().execute_with(|| {
        let record = crate::migrations::security_flow_cap_param_record()
            .expect("sec.flow_cap is in the genesis registry template");
        let mut amended = record;
        amended.value = pallet_constitution::ParamValue::Fixed(
            futarchy_primitives::FixedU64(24_000_000_000),
        );
        assert_ne!(amended.value, record.value);

        StorageVersion::new(3).put::<Constitution>();
        pallet_constitution::Params::<Runtime>::insert(record.key, amended);

        let _ = <crate::migrations::MigrateConstitutionSecurityFlowCapV4 as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert_eq!(
            StorageVersion::get::<Constitution>(),
            StorageVersion::new(4)
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(record.key),
            Some(amended),
            "a lawful live value must survive the migration untouched",
        );
    });
}

/// A genesis chain is already at v4, so the migration is a version-read no-op.
#[test]
fn constitution_v4_migration_is_an_idempotent_current_version_noop() {
    tests::development_ext().execute_with(|| {
        assert_eq!(
            StorageVersion::get::<Constitution>(),
            StorageVersion::new(4)
        );
        let before: Vec<_> = pallet_constitution::Params::<Runtime>::iter().collect();
        let _ = <crate::migrations::MigrateConstitutionSecurityFlowCapV4 as OnRuntimeUpgrade>::on_runtime_upgrade();
        assert_eq!(
            StorageVersion::get::<Constitution>(),
            StorageVersion::new(4)
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::iter().collect::<Vec<_>>(),
            before
        );
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn constitution_v1_try_runtime_rejects_a_mismatched_existing_v0_row() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<Constitution>();
        let (_, mut rate) = crate::migrations::reserve_probe_param_records()
            .expect("probe rows exist in the registry template");
        rate.last_change_block = rate.last_change_block.saturating_add(1);
        pallet_constitution::Params::<Runtime>::insert(rate.key, rate);

        assert!(
            <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::pre_upgrade(
            )
            .is_err(),
            "try-runtime must block a release over a mismatched v0 probe row",
        );
        assert_eq!(
            StorageVersion::get::<Constitution>(),
            StorageVersion::new(0)
        );
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn constitution_v1_try_runtime_noop_preserves_lawfully_amended_values() {
    tests::development_ext().execute_with(|| {
        let (fee, mut rate) = crate::migrations::reserve_probe_param_records()
            .expect("probe rows exist in the registry template");
        rate.value = pallet_constitution::ParamValue::Balance(
            rate.value.as_u128().saturating_add(1),
        );
        pallet_constitution::Params::<Runtime>::insert(rate.key, rate);
        let state = <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::pre_upgrade()
            .expect("current-version pre-upgrade is a lawful no-op");
        let _ = <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();
        <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::post_upgrade(state)
            .expect("lawfully amended rows survive the no-op");
        assert_eq!(pallet_constitution::Params::<Runtime>::get(fee.key), Some(fee));
        assert_eq!(pallet_constitution::Params::<Runtime>::get(rate.key), Some(rate));
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn constitution_v1_try_runtime_inserts_absent_rows() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<Constitution>();
        let (fee, rate) = crate::migrations::reserve_probe_param_records()
            .expect("probe rows exist in the registry template");
        pallet_constitution::Params::<Runtime>::remove(fee.key);
        pallet_constitution::Params::<Runtime>::remove(rate.key);

        let state = <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::pre_upgrade()
            .expect("absent v0 rows are migratable");
        let _ = <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();
        <crate::migrations::MigrateConstitutionProbeParamsV1 as OnRuntimeUpgrade>::post_upgrade(state)
            .expect("inserted v1 rows satisfy post-upgrade checks");
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn composed_runtime_upgrade_migrates_all_reserve_probe_v0_state_and_passes_try_state() {
    use frame_support::traits::TryState;
    use parity_scale_codec::{Decode, Encode};

    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<ExecutionGuard>();
        let blocked_meters = crate::migrations::retired::blocked_meters_key();
        let progress_marker = crate::migrations::retired::progress_marker_key();
        unhashed::put_raw(&blocked_meters, &[1u8]);
        unhashed::put_raw(&progress_marker, &[2u8]);

        StorageVersion::new(0).put::<Constitution>();
        let (fee, rate) = crate::migrations::reserve_probe_param_records()
            .expect("probe rows exist in the registry template");
        pallet_constitution::Params::<Runtime>::remove(fee.key);
        pallet_constitution::Params::<Runtime>::remove(rate.key);
        pallet_constitution::PhaseFlags::<Runtime>::mutate(|bits| {
            *bits &= !pallet_constitution::PhaseFlagsValue::TREASURY_ARMED;
            *bits &= !pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG;
        });

        StorageVersion::new(0).put::<Oracle>();
        let legacy = pallet_oracle::ReserveHealthValue {
            consecutive_fails: 5,
            consecutive_passes: 3,
            unhealthy: true,
            last_query_id: 71,
            last_probe_at: 81,
            pending_since: Some(79),
        };
        pallet_oracle::ReserveHealth::<Runtime>::put(legacy);
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_futarchy_treasury::State::<Runtime>::mutate(|state| {
            state.reserve_impaired = false;
        });

        StorageVersion::new(0).put::<crate::FutarchyTreasury>();
        pallet_futarchy_treasury::BootstrapOpsFundingClosed::<Runtime>::put(true);

        // This is the real Executive path: System executes the production
        // SingleBlockMigrations tuple, pallet hooks execute the treasury v1
        // migration, and try-runtime runs every registered pre/post check.
        let input = frame_try_runtime::UpgradeCheckSelect::All.encode();
        let output = crate::apis::api::dispatch("TryRuntime_on_runtime_upgrade", &input)
            .expect("TryRuntime runtime API method");
        let (used, maximum) = <(
            frame_support::weights::Weight,
            frame_support::weights::Weight,
        ) as Decode>::decode(&mut &output[..])
        .expect("TryRuntime result");
        assert!(used.all_lte(maximum));

        assert_eq!(
            StorageVersion::get::<ExecutionGuard>(),
            StorageVersion::new(1)
        );
        assert!(!unhashed::exists(&blocked_meters));
        assert!(!unhashed::exists(&progress_marker));
        // SQ-173's `MigrateConstitutionSecurityPrizeV3` and SQ-486's
        // `MigrateConstitutionSecurityFlowCapV4` compose after the v2 probe
        // migration, so a composed upgrade lands the Constitution at v4 with all
        // three capability-envelope rows *and* the `sec.flow_cap` ceiling seeded.
        assert_eq!(
            StorageVersion::get::<Constitution>(),
            StorageVersion::new(4)
        );
        for name in [
            b"sec.prize.param".as_slice(),
            b"sec.prize.code".as_slice(),
            b"sec.prize.meta".as_slice(),
            b"sec.flow_cap".as_slice(),
        ] {
            assert!(pallet_constitution::Params::<Runtime>::contains_key(
                pallet_constitution::key16(name)
            ));
        }
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(fee.key),
            Some(fee)
        );
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(rate.key),
            Some(rate)
        );
        assert_eq!(StorageVersion::get::<Oracle>(), StorageVersion::new(1));
        assert_eq!(
            pallet_oracle::ReserveHealth::<Runtime>::get(),
            pallet_oracle::ReserveHealthValue {
                last_query_id: 0,
                last_probe_at: 0,
                pending_since: None,
                ..legacy
            }
        );
        assert!(!pallet_oracle::ReserveProbeArmed::<Runtime>::get());
        assert_ne!(
            pallet_constitution::PhaseFlags::<Runtime>::get()
                & pallet_constitution::PhaseFlagsValue::RESERVE_HEALTH_FLAG,
            0,
        );
        assert!(pallet_futarchy_treasury::State::<Runtime>::get().reserve_impaired);
        // 3 -> 4 with TR6 (08 §2.6): the treasury gained the trading-reward
        // budget authorization path, whose migration seeds `IncentiveRemaining`
        // for a chain that predates it. The composed upgrade runs that migration
        // too, so this is the version the whole set lands on.
        assert_eq!(
            StorageVersion::get::<crate::FutarchyTreasury>(),
            StorageVersion::new(4),
        );
        // The version alone would pass on a migration that bumped and did
        // nothing. Assert the state it exists to establish: the full 08 §2.1
        // allocation is available, because nothing has been authorized yet on a
        // chain that is only now learning the program exists. Reading the
        // constant rather than restating it keeps 13 the single home for the
        // value (runtime-code rule 4).
        assert_eq!(
            pallet_futarchy_treasury::IncentiveRemaining::<Runtime>::get(),
            crate::configs::IncentiveAllocationAmount::get(),
        );
        assert!(!pallet_futarchy_treasury::BootstrapOpsFundingClosed::<
            Runtime,
        >::get());
        assert!(
            <crate::AllPalletsWithSystem as TryState<crate::BlockNumber>>::try_state(
                System::block_number(),
                frame_try_runtime::TryStateSelect::All,
            )
            .is_ok()
        );
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn composed_runtime_upgrade_migrates_constitution_v1_to_v2() {
    use parity_scale_codec::{Decode, Encode};

    tests::development_ext().execute_with(|| {
        StorageVersion::new(1).put::<Constitution>();
        let mut legacy = legacy_probe_control_records();
        for (index, record) in legacy.iter_mut().enumerate() {
            record.last_changed_epoch = 20 + index as u32;
            record.last_change_block = 200 + index as u32;
            pallet_constitution::Params::<Runtime>::insert(record.key, *record);
        }

        let input = frame_try_runtime::UpgradeCheckSelect::All.encode();
        let output = crate::apis::api::dispatch("TryRuntime_on_runtime_upgrade", &input)
            .expect("TryRuntime runtime API method");
        let (used, maximum) = <(
            frame_support::weights::Weight,
            frame_support::weights::Weight,
        ) as Decode>::decode(&mut &output[..])
        .expect("TryRuntime result");
        assert!(used.all_lte(maximum));
        // SQ-173's `MigrateConstitutionSecurityPrizeV3` and SQ-486's
        // `MigrateConstitutionSecurityFlowCapV4` compose after the v2 probe
        // migration, so a composed upgrade lands the Constitution at v4 with all
        // three capability-envelope rows *and* the `sec.flow_cap` ceiling seeded.
        assert_eq!(
            StorageVersion::get::<Constitution>(),
            StorageVersion::new(4)
        );
        for name in [
            b"sec.prize.param".as_slice(),
            b"sec.prize.code".as_slice(),
            b"sec.prize.meta".as_slice(),
            b"sec.flow_cap".as_slice(),
        ] {
            assert!(pallet_constitution::Params::<Runtime>::contains_key(
                pallet_constitution::key16(name)
            ));
        }
        assert!(pallet_constitution::Pallet::<Runtime>::do_try_state().is_ok());
        for record in legacy {
            let migrated = pallet_constitution::Params::<Runtime>::get(record.key).unwrap();
            assert_eq!(migrated.value, record.value);
            assert_eq!(migrated.last_changed_epoch, record.last_changed_epoch);
            assert_eq!(migrated.last_change_block, record.last_change_block);
            assert_eq!(migrated.min.as_u128(), 1);
            assert!(migrated.kernel_bounded);
        }
    });
}

/// The migration's try-runtime hooks prove the before/after transition: pre
/// records both keys present, post asserts both absent. Compiles only under
/// `try-runtime` (the hooks are `#[cfg(feature = \"try-runtime\")]`).
#[cfg(feature = "try-runtime")]
#[test]
fn first_migration_pre_and_post_upgrade_prove_the_transition() {
    use frame_support::traits::UncheckedOnRuntimeUpgrade;

    tests::development_ext().execute_with(|| {
        let bm = crate::migrations::retired::blocked_meters_key();
        let pm = crate::migrations::retired::progress_marker_key();
        unhashed::put_raw(&bm, &[1u8, 2, 3]);
        unhashed::put_raw(&pm, &[4u8]);

        let recorded = crate::migrations::RetireB16StateInner::pre_upgrade()
            .expect("pre_upgrade records present state");
        assert_eq!(
            recorded,
            vec![1u8, 1u8],
            "pre_upgrade sees both keys present"
        );

        let _ = crate::migrations::RetireB16StateInner::on_runtime_upgrade();

        crate::migrations::RetireB16StateInner::post_upgrade(recorded)
            .expect("post_upgrade proves both keys absent");
    });
}

/// 09 §3.2(4): the `MigrationHalted` diagnostic is emitted exactly once, on the
/// first activation of an execution-halt source, carrying the SDK failed step.
/// A second activation while the halt already stands does not re-emit.
#[test]
fn migration_halted_diagnostic_emits_once_on_first_activation() {
    tests::development_ext().execute_with(|| {
        System::set_block_number(1);

        let count_halted = || {
            System::events()
                .into_iter()
                .filter(|record| {
                    matches!(
                        record.event,
                        RuntimeEvent::ExecutionGuard(
                            pallet_execution_guard::Event::MigrationHalted { .. }
                        )
                    )
                })
                .count()
        };
        assert_eq!(count_halted(), 0);

        // First activation of the failure source emits the diagnostic.
        assert_eq!(
            crate::configs::MigrationFailureToGuard::failed(Some(5)),
            frame_support::migrations::FailedMigrationHandling::KeepStuck,
        );

        let emitted = System::events()
            .into_iter()
            .find_map(|record| match record.event {
                RuntimeEvent::ExecutionGuard(pallet_execution_guard::Event::MigrationHalted {
                    cursor,
                    failed_step,
                }) => Some((cursor, failed_step)),
                _ => None,
            });
        let (cursor, failed_step) = emitted.expect("a MigrationHalted diagnostic was emitted");
        assert_eq!(failed_step, Some(5), "carries the SDK-reported failed step");
        assert!(
            cursor.is_empty(),
            "no active cursor in this scenario -> empty diagnostic cursor bytes",
        );
        assert_eq!(count_halted(), 1);

        // A second source activation while already halted does NOT re-emit.
        let _ = crate::configs::MigrationFailureToGuard::failed(Some(6));
        assert_eq!(
            count_halted(),
            1,
            "first-activation-only: no re-emit while the halt still stands",
        );
    });
}

/// SQ-493: an upgraded chain's retained snapshots get their 07 §10 context, and
/// the pairing `do_try_state` enforces holds afterwards.
#[test]
fn welfare_snapshot_context_migration_backfills_every_retained_snapshot() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<crate::Welfare>();
        // A pre-SQ-493 chain: snapshots present, no contexts at all.
        for epoch in 3..=6u32 {
            pallet_welfare::Snapshots::<Runtime>::insert(
                (epoch, 1u16),
                pallet_welfare::StoredSnapshot {
                    epoch,
                    spec_version: 1,
                    s_pillar: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    c_onchain: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    c_attested: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    p_pillar: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    a_pillar: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    gate_s: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    gate_c: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    welfare: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                    components: frame_support::BoundedVec::default(),
                },
            );
        }
        assert_eq!(pallet_welfare::SnapshotContexts::<Runtime>::iter().count(), 0);

        let _ = <crate::migrations::MigrateWelfareSnapshotContextsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<crate::Welfare>(), StorageVersion::new(1));
        assert_eq!(pallet_welfare::SnapshotContexts::<Runtime>::iter().count(), 4);
        for epoch in 3..=6u32 {
            let context = pallet_welfare::SnapshotContexts::<Runtime>::get((epoch, 1u16))
                .expect("context backfilled");
            assert_eq!(context.epoch, epoch);
            assert_eq!(context.spec_version, 1);
            // Empty is the exact history: a snapshot recorded before the flag bit
            // existed cannot carry a two-consecutive streak, so it keeps settling
            // on its recorded `W` and the other two fields are never read.
            assert!(context.flagged.is_empty());
            assert_eq!(context.incident_multiplier, futarchy_primitives::FixedU64(pallet_welfare::ONE));
        }

        // Idempotent, and never overwrites a real context.
        let mut real = pallet_welfare::SnapshotContexts::<Runtime>::get((3u32, 1u16))
            .expect("context present");
        real.flagged = frame_support::BoundedVec::truncate_from(vec![7u16]);
        pallet_welfare::SnapshotContexts::<Runtime>::insert((3u32, 1u16), real.clone());
        let _ = <crate::migrations::MigrateWelfareSnapshotContextsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();
        assert_eq!(
            pallet_welfare::SnapshotContexts::<Runtime>::get((3u32, 1u16)),
            Some(real),
            "a completed migration must not run again"
        );
    });
}

#[cfg(feature = "try-runtime")]
#[test]
fn welfare_snapshot_context_migration_try_runtime_proves_the_pairing() {
    tests::development_ext().execute_with(|| {
        StorageVersion::new(0).put::<crate::Welfare>();
        pallet_welfare::Snapshots::<Runtime>::insert(
            (9u32, 2u16),
            pallet_welfare::StoredSnapshot {
                epoch: 9,
                spec_version: 2,
                s_pillar: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                c_onchain: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                c_attested: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                p_pillar: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                a_pillar: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                gate_s: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                gate_c: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                welfare: futarchy_primitives::FixedU64(pallet_welfare::ONE),
                components: frame_support::BoundedVec::default(),
            },
        );

        let state =
            <crate::migrations::MigrateWelfareSnapshotContextsV1 as OnRuntimeUpgrade>::pre_upgrade()
                .expect("welfare pre-upgrade snapshot");
        let _ = <crate::migrations::MigrateWelfareSnapshotContextsV1 as OnRuntimeUpgrade>::on_runtime_upgrade();
        <crate::migrations::MigrateWelfareSnapshotContextsV1 as OnRuntimeUpgrade>::post_upgrade(
            state,
        )
        .expect("welfare post-upgrade checks");

        assert_eq!(StorageVersion::get::<crate::Welfare>(), StorageVersion::new(1));
        pallet_welfare::Pallet::<Runtime>::do_try_state()
            .expect("the SQ-493 pairing holds after the backfill");
    });
}

/// SQ-504/SR-13: a failed recovery-image release is a first-class runtime halt
/// source, not a direct write racing the source bitmap. It emits the ordinary
/// first-activation diagnostic, survives migration completion, and remains
/// retryable even though the capture latch and SDK cursor are already gone.
#[cfg(not(any(
    feature = "runtime-benchmarks",
    feature = "try-runtime",
    feature = "recovery"
)))]
#[test]
fn completed_migration_keeps_the_halt_when_the_recovery_image_cannot_be_released() {
    tests::development_ext().execute_with(|| {
        // FRAME deliberately drops events at genesis block zero.
        System::set_block_number(1);
        // A committed recovery image whose preimage was never requested: the
        // `RecoveryImages::unpin` seam refuses with `Unavailable`, which is
        // exactly the corrupt-pin state the guard halts on.
        pallet_execution_guard::RecoveryImage::<Runtime>::put(
            pallet_execution_guard::RecoveryImageCommitment {
                pid: 1,
                primary_hash: [0xa1; 32],
                hash: [0xb2; 32],
                len: 32,
                target_spec_version: 2,
                attestation_id: 1,
                committed_at: 1,
            },
        );
        assert_eq!(crate::configs::MigrationHaltSources::get(), 0);
        assert!(!pallet_execution_guard::MigrationHalt::<Runtime>::get());
        let mandatory_before = *System::block_weight()
            .get(frame_support::dispatch::DispatchClass::Mandatory);

        <crate::configs::MigrationStatusToGuard as frame_support::migrations::MigrationStatusHandler>::completed();

        let mandatory_after = *System::block_weight()
            .get(frame_support::dispatch::DispatchClass::Mandatory);
        type PreimageWeight = crate::weights::pallet_preimage::WeightInfo<Runtime>;
        let expected_unpin =
            <PreimageWeight as pallet_preimage::WeightInfo>::ensure_updated(1).saturating_add(
                <PreimageWeight as pallet_preimage::WeightInfo>::unrequest_preimage(),
            );
        assert_eq!(
            <crate::configs::RuntimePreimages as RecoveryImages>::unpin_weight(),
            expected_unpin,
        );
        let expected_callback = <Runtime as frame_system::Config>::DbWeight::get()
            // PreMigrationAnchor kill + bridge-source read + RecoveryImage get.
            .reads_writes(2, 1)
            .saturating_add(expected_unpin)
            .saturating_add(crate::configs::migration_validation_hook_weight());
        type WelfareWeight = <Runtime as pallet_welfare::Config>::WeightInfo;
        let expected_integrity =
            <WelfareWeight as pallet_welfare::WeightInfo>::note_integrity_failure();
        assert_eq!(
            mandatory_after,
            mandatory_before
                .saturating_add(expected_callback)
                .saturating_add(expected_integrity),
        );

        // The unreleasable image commitment remains, so the latch MUST stand.
        assert!(pallet_execution_guard::RecoveryImage::<Runtime>::get().is_some());
        assert!(
            pallet_execution_guard::MigrationHalt::<Runtime>::get(),
            "the recovery-image release source did not engage the aggregate halt"
        );
        assert_ne!(
            crate::configs::MigrationHaltSources::get()
                & crate::configs::RECOVERY_IMAGE_RELEASE_HALT,
            0,
        );
        assert_eq!(crate::configs::recovery_trigger(), None);
        let diagnostics = System::events()
            .into_iter()
            .filter(|record| {
                matches!(
                    &record.event,
                    RuntimeEvent::ExecutionGuard(pallet_execution_guard::Event::MigrationHalted {
                        cursor,
                        failed_step: None,
                    }) if cursor.is_empty()
                )
            })
            .count();
        assert_eq!(diagnostics, 1);

        // A repair clears only this source. Seed another live halt cause to
        // prove the aggregate cannot resume merely because the pin recovered.
        crate::configs::note_migration_stall_halt_for_test();

        // Repair only the missing request/pin. The guard's next-block retry
        // releases the image and clears exactly the dedicated source.
        <crate::Preimage as frame_support::traits::QueryPreimage>::request(
            &sp_core::H256::from([0xb2; 32]),
        );
        System::set_block_number(System::block_number().saturating_add(1));
        let repaired_weight = <ExecutionGuard as frame_support::traits::Hooks<_>>::on_initialize(
            System::block_number(),
        );
        let expected_repaired = <Runtime as frame_system::Config>::DbWeight::get()
            // Seven fixed hook reads + bridge-source read + RecoveryImage
            // get/kill + repaired-source read/two writes.
            .reads_writes(10, 3)
            .saturating_add(expected_unpin);
        assert_eq!(repaired_weight, expected_repaired);

        assert!(!pallet_execution_guard::RecoveryImage::<Runtime>::exists());
        assert_eq!(
            crate::configs::MigrationHaltSources::get(),
            crate::configs::MIGRATION_STALL_HALT,
        );
        assert!(pallet_execution_guard::MigrationHalt::<Runtime>::get());

        // The ordinary completion transition can still clear the independent
        // cursor-owned source once its own condition has resolved.
        <crate::configs::MigrationStatusToGuard as frame_support::migrations::MigrationStatusHandler>::completed();
        assert_eq!(crate::configs::MigrationHaltSources::get(), 0);
        assert!(!pallet_execution_guard::MigrationHalt::<Runtime>::get());
    });
}

/// The source bridge must not turn the ordinary case into a stuck halt: a
/// completed migration whose recovery image releases cleanly leaves the queue
/// running and the source mask empty.
#[cfg(not(any(
    feature = "runtime-benchmarks",
    feature = "try-runtime",
    feature = "recovery"
)))]
#[test]
fn completed_migration_without_a_pinned_image_lifts_the_halt() {
    tests::development_ext().execute_with(|| {
        crate::configs::note_migration_stall_halt_for_test();
        assert!(pallet_execution_guard::MigrationHalt::<Runtime>::get());
        assert!(!pallet_execution_guard::RecoveryImage::<Runtime>::exists());

        <crate::configs::MigrationStatusToGuard as frame_support::migrations::MigrationStatusHandler>::completed();

        assert_eq!(crate::configs::MigrationHaltSources::get(), 0);
        assert!(!pallet_execution_guard::MigrationHalt::<Runtime>::get());
    });
}

/// MAX-03 regression. `PhaseFourTransition` is deliberately fail-static: on
/// refusal `with_storage_layer` rolls back and the Phase-3 flags, sudo key and
/// `OnlyInherents` lock survive, with terminal recovery named as the repair.
/// That repair provably could not execute.
///
/// `frame_executive` runs `on_runtime_upgrade` before `MultiStepMigrations`,
/// and `pallet_migrations::onboard_new_mbms` writes an `Active` cursor
/// unconditionally whenever the runtime registers any MBM — the phase-four
/// primary profile always registers one. `RecoveryAwareMigrations::step()`
/// then refuses to service the migrator while `PhaseTransitionLock` is set, so
/// the cursor never advanced; after `MIGRATION_STALL_BLOCKS` it raised
/// `MIGRATION_STALL_HALT`, and `recovery_trigger`'s `PhaseTransition` arm
/// required `Cursor == None` and was therefore structurally unreachable. The
/// cursor branch ran instead, wrote `RetiredMigrationCursor`, and
/// `TerminalRecoveryTransition` hard-refused with "conflicting phase and MBM
/// causes" — so `complete_terminal_recovery_state()` never ran,
/// `RecoveryLockdown` and `PhaseTransitionLock` stayed set with no dispatchable
/// writer, and `extrinsic_mode()` returned `OnlyInherents` forever.
///
/// This drives the genuinely refused transition rather than seeding its
/// post-state, which is what the existing `cfg(recovery)` coverage does.
///
/// Fails at baseline on the `recovery_trigger` assertion: it returned
/// `Cursor(..)`, not `PhaseTransition`.
#[cfg(all(feature = "phase-four", not(feature = "recovery")))]
#[test]
fn max03_a_refused_phase_four_transition_still_reaches_terminal_recovery() {
    tests::development_ext().execute_with(|| {
        let mut sudo_key = [0u8; 32];
        sudo_key[..16].copy_from_slice(&sp_io::hashing::twox_128(b"Sudo"));
        sudo_key[16..].copy_from_slice(&sp_io::hashing::twox_128(b"Key"));
        sp_io::storage::set(&sudo_key, &[1]);

        // The SQ-383 condition the arming gate exists for: spendable NAV below
        // the PARAM floor. No adversary is involved.
        assert!(
            crate::FutarchyTreasury::nav().spendable_nav
                < crate::FutarchyTreasury::floor(futarchy_primitives::ProposalClass::Param)
        );
        pallet_constitution::PhaseFlags::<Runtime>::put(
            pallet_constitution::PhaseFlagsValue::SHADOW_MODE
                | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT,
        );
        crate::configs::PhaseTransitionLock::put(true);
        crate::configs::PhaseTransitionApplied::put(true);
        pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
            pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                pid: 4_010,
                code_hash: [0x47; 32],
                plan: pallet_execution_guard::PhaseFourPlan {
                    tvl_cap: 1,
                    deposit_cap: 1,
                },
            },
        );

        let _ = crate::migrations::PhaseFourTransition::on_runtime_upgrade();

        // Fail-static, exactly as designed: the lock survives the rollback and
        // the failure is marked.
        assert!(crate::configs::PhaseTransitionLock::get());
        assert!(!crate::configs::RuntimePhaseState::exact_phase_four());
        assert_ne!(
            crate::configs::MigrationHaltSources::get() & 0b100,
            0,
            "the refusal raises the applied-detection halt source",
        );

        // Now reproduce what `pallet_migrations::on_runtime_upgrade` does in
        // the very same block: onboard a cursor unconditionally.
        pallet_migrations::Cursor::<Runtime>::put(
            pallet_migrations::MigrationCursor::Active(pallet_migrations::ActiveCursor {
                index: 0,
                inner_cursor: None,
                started_at: frame_system::Pallet::<Runtime>::block_number(),
            }),
        );

        // The wrapper refuses to service that cursor, so it discards it rather
        // than leaving unreachable state behind.
        let _ = <crate::configs::RecoveryAwareMigrations as frame_support::migrations::MultiStepMigrator>::step();
        assert!(
            !pallet_migrations::Cursor::<Runtime>::exists(),
            "an auto-onboarded cursor nothing will service must not survive",
        );

        // And the phase cause is reachable — the property that was structurally
        // false before.
        assert_eq!(
            crate::configs::recovery_trigger(),
            Some(crate::configs::RecoveryTrigger::PhaseTransition),
        );
        assert!(
            !crate::configs::RetiredMigrationCursor::exists(),
            "the cursor branch must not claim a phase-transition refusal",
        );
    });
}

/// The phase cause takes precedence even over a cursor that *did* progress, so
/// no cursor state can bury the only repair for a refused transition.
#[cfg(all(feature = "phase-four", not(feature = "recovery")))]
#[test]
fn max03_a_progressed_cursor_is_preserved_but_cannot_bury_the_phase_cause() {
    tests::development_ext().execute_with(|| {
        crate::configs::PhaseTransitionLock::put(true);
        crate::configs::note_phase_transition_failure();
        pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
            pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                pid: 4_011,
                code_hash: [0x48; 32],
                plan: pallet_execution_guard::PhaseFourPlan {
                    tvl_cap: 1,
                    deposit_cap: 1,
                },
            },
        );
        // A cursor that has produced progress: index advanced past 0.
        pallet_migrations::Cursor::<Runtime>::put(pallet_migrations::MigrationCursor::Active(
            pallet_migrations::ActiveCursor {
                index: 1,
                inner_cursor: None,
                started_at: frame_system::Pallet::<Runtime>::block_number(),
            },
        ));

        let _ = <crate::configs::RecoveryAwareMigrations as frame_support::migrations::MultiStepMigrator>::step();

        assert!(
            pallet_migrations::Cursor::<Runtime>::exists(),
            "a cursor that advanced is a genuine cause and is never discarded",
        );
        let trigger = crate::configs::recovery_trigger();
        assert_eq!(
            trigger,
            Some(crate::configs::RecoveryTrigger::PhaseTransition),
        );

        // Selecting the phase cause is only half of it. The selected cause must
        // also be *schedulable*, and this is the step that decides: the phase
        // arm formerly refused outright while a cursor existed, so scheduling
        // rolled back every block and the runtime stayed in `OnlyInherents`
        // with nothing able to clear either flag. Fails at baseline, where this
        // was an `ensure!` both cursors are absent.
        //
        // Driven here rather than through `schedule_committed_recovery_image`
        // because the surrounding path applies a real authorized upgrade: it
        // needs a genuine runtime blob and preimage, which this harness does
        // not build (every other recovery test seeds the post-scheduling state
        // for the same reason).
        crate::configs::retire_cursor_for(trigger.expect("the phase cause is selected"));

        assert!(
            !pallet_migrations::Cursor::<Runtime>::exists(),
            "the cursor is moved out of the recovery image's way, not refused",
        );
        assert_eq!(
            crate::configs::RetiredMigrationCursor::get(),
            Some(pallet_migrations::MigrationCursor::Active(
                pallet_migrations::ActiveCursor {
                    index: 1,
                    inner_cursor: None,
                    started_at: frame_system::Pallet::<Runtime>::block_number(),
                }
            )),
            "retired, so an aborted image restores the pre-recovery state",
        );
    });
}
