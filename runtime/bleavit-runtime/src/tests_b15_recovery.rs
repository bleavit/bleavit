//! B15 release-specific recovery regressions for the conditional-ledger v1
//! `TotalEscrowed` backfill.
//!
//! This suite is intentionally runtime-level: the paired recovery image must
//! understand every cursor the primary image can persist, reject every cursor
//! outside that exact language, and keep FRAME's `OnlyInherents` posture until
//! the mirror and storage-version commit are both complete.

#[cfg(feature = "recovery")]
use alloc::vec::Vec;

use frame_support::migrations::{SteppedMigration, SteppedMigrations};
#[cfg(feature = "recovery")]
use frame_support::{
    migrations::MultiStepMigrator,
    storage::{unhashed, StoragePrefixedMap},
    traits::{GetStorageVersion, OnRuntimeUpgrade, QueryPreimage, StorageVersion, StorePreimage},
    weights::{Weight, WeightMeter},
    BoundedVec,
};
#[cfg(all(not(feature = "recovery"), not(feature = "runtime-benchmarks")))]
use futarchy_primitives::kernel;
#[cfg(feature = "recovery")]
use pallet_conditional_ledger::migration::BackfillCursor;
use pallet_conditional_ledger::migration::BackfillTotalEscrowedV1;
#[cfg(feature = "recovery")]
use parity_scale_codec::DecodeAll;
use parity_scale_codec::Encode;
#[cfg(feature = "recovery")]
use sp_runtime::traits::Header as _;

use crate::Runtime;
#[cfg(feature = "recovery")]
use crate::{tests, System};

type Backfill = BackfillTotalEscrowedV1<Runtime>;
type RuntimeMigrations = <Runtime as pallet_migrations::Config>::Migrations;

#[cfg(feature = "recovery")]
const EXPECTED_TOTAL: u128 = 111;

#[cfg(feature = "recovery")]
fn seed_legacy_vaults() {
    for (pid, escrowed) in [(41, 7), (3, 13), (99, 19)] {
        let mut vault = conditional_ledger_core::VaultInfo::open(0);
        vault.escrowed = escrowed;
        pallet_conditional_ledger::Vaults::<Runtime>::insert(pid, vault);
    }
    for (epoch, escrowed) in [(8, 31), (2, 41)] {
        let mut vault = conditional_ledger_core::BaselineVaultInfo::open();
        vault.escrowed = escrowed;
        pallet_conditional_ledger::BaselineVaults::<Runtime>::insert(epoch, vault);
    }
    pallet_conditional_ledger::TotalEscrowed::<Runtime>::kill();
    StorageVersion::new(0).put::<crate::ConditionalLedger>();
}

#[cfg(feature = "recovery")]
fn ample_meter() -> WeightMeter {
    WeightMeter::with_limit(Weight::from_parts(u64::MAX, u64::MAX))
}

/// Every cursor the primary migration can persist, including the initial
/// `inner_cursor = None`, the phase-only proposal→baseline transition, and the
/// final baseline cursor immediately before the terminal mirror/version write.
#[cfg(feature = "recovery")]
fn valid_cutpoints() -> Vec<Option<BackfillCursor>> {
    let mut cutpoints = vec![None];
    let mut cursor = None;
    loop {
        let next = Backfill::step(cursor, &mut ample_meter())
            .expect("the bounded legacy fixture has no malformed rows");
        let Some(next) = next else {
            break;
        };
        cutpoints.push(Some(next.clone()));
        cursor = Some(next);
    }
    cutpoints
}

#[cfg(feature = "recovery")]
fn active_cursor(inner: Option<Vec<u8>>, index: u32) -> pallet_migrations::CursorOf<Runtime> {
    pallet_migrations::MigrationCursor::Active(pallet_migrations::ActiveCursor {
        index,
        inner_cursor: inner.map(BoundedVec::truncate_from),
        started_at: 1,
    })
}

#[cfg(feature = "recovery")]
fn decode_cursor(bytes: Vec<u8>) -> BackfillCursor {
    BackfillCursor::decode_all(&mut &bytes[..]).expect("hand-built cursor follows SCALE shape")
}

#[cfg(feature = "recovery")]
fn raw_cursor(phase: u8, last: Option<Vec<u8>>, total: u128) -> BackfillCursor {
    let mut bytes = phase.encode();
    bytes.extend(last.encode());
    bytes.extend(total.encode());
    decode_cursor(bytes)
}

#[cfg(feature = "recovery")]
fn assert_only_inherents() {
    assert!(crate::configs::RecoveryAwareMigrations::ongoing());
    let header = crate::Header::new(
        System::block_number().saturating_add(1),
        Default::default(),
        Default::default(),
        System::block_hash(0),
        Default::default(),
    );
    assert!(matches!(
        crate::Executive::initialize_block(&header),
        sp_runtime::ExtrinsicInclusionMode::OnlyInherents
    ));
}

#[cfg(feature = "recovery")]
fn assert_repair_source_is_locked() {
    assert!(crate::configs::RecoveryAwareMigrations::ongoing());
    assert!(crate::configs::RecoveryLockdown::get());
    assert!(crate::configs::RecoveryCodeApplied::get());
    assert_eq!(
        crate::ConditionalLedger::on_chain_storage_version(),
        StorageVersion::new(0)
    );
    assert!(!pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists());
}

#[cfg(feature = "recovery")]
fn drive_repair_to_completion() {
    let mut nonterminal_steps = 0u32;
    while crate::configs::RecoveryAwareMigrations::ongoing() {
        let used = crate::configs::RecoveryAwareMigrations::step();
        let measured_step =
            <crate::weights::pallet_conditional_ledger::WeightInfo<Runtime> as
                pallet_conditional_ledger::WeightInfo>::migration_step_row()
            .max(
                <crate::weights::pallet_conditional_ledger::WeightInfo<Runtime> as
                    pallet_conditional_ledger::WeightInfo>::migration_step_terminal(),
            );
        assert!(
            used.all_gte(
                measured_step
                    .saturating_add(crate::configs::recovery_ledger_bookkeeping_weight())
                    .saturating_add(crate::configs::recovery_guard_finalization_weight())
                    .saturating_add(
                        crate::configs::recovery_aware_migration_detector_weight(),
                    )
            ),
            "each recovery block precharges the generated ledger, maximal guard finalization, and runtime-local proof envelopes"
        );
        assert!(
            used.all_lte(crate::configs::MigrationMaxServiceWeight::get()),
            "the conservative recovery envelope must fit the configured per-block migration service budget"
        );
        if crate::configs::RecoveryAwareMigrations::ongoing() {
            assert_repair_source_is_locked();
            assert!(!crate::configs::RecoveryLedgerRepairFailed::get());
            nonterminal_steps = nonterminal_steps.saturating_add(1);
            assert!(
                nonterminal_steps < pallet_conditional_ledger::migration::MAX_BACKFILL_STEPS,
                "the bounded fixture must terminate before the release step ceiling"
            );
        }
    }
}

#[cfg(feature = "recovery")]
fn with_recovery_state(retired: pallet_migrations::CursorOf<Runtime>, test: impl FnOnce([u8; 32])) {
    let recovery = b"b15-ledger-terminal-recovery".to_vec();
    tests::upgrade_ext_with_artifact_versions(vec![(recovery.clone(), crate::VERSION)])
        .execute_with(|| {
            seed_legacy_vaults();
            let recovery_hash = sp_io::hashing::blake2_256(&recovery);
            let noted = <crate::Preimage as StorePreimage>::note(recovery.clone().into())
                .expect("recovery preimage is stored");
            assert_eq!(noted.0, recovery_hash);
            <crate::Preimage as QueryPreimage>::request(&noted);
            sp_io::storage::set(sp_core::storage::well_known_keys::CODE, &recovery);

            crate::configs::RecoveryCodeApplied::put(true);
            crate::configs::RecoveryLockdown::put(true);
            crate::configs::RecoveryScheduledHash::put(recovery_hash);
            crate::configs::RetiredMigrationCursor::put(retired);
            crate::configs::MigrationFailedStep::kill();
            pallet_execution_guard::pallet::PendingUpgrade::<Runtime>::put(
                pallet_execution_guard::PendingUpgrade {
                    hash: [0x15; 32],
                    authorized_at: 1,
                    applicable_at: 1,
                    target_spec_version: crate::VERSION.spec_version.saturating_sub(1),
                },
            );
            pallet_execution_guard::RecoveryImage::<Runtime>::put(
                pallet_execution_guard::RecoveryImageCommitment {
                    pid: 15_001,
                    primary_hash: [0x15; 32],
                    hash: recovery_hash,
                    len: u32::try_from(recovery.len()).expect("test recovery length fits u32"),
                    target_spec_version: crate::VERSION.spec_version,
                    attestation_id: 15,
                    committed_at: System::block_number(),
                },
            );
            test(recovery_hash);
        });
}

#[cfg(feature = "recovery")]
fn assert_terminal_evidence_preserved(
    retired: pallet_migrations::CursorOf<Runtime>,
    recovery_hash: [u8; 32],
) {
    assert!(crate::configs::RecoveryLockdown::get());
    assert!(crate::configs::RecoveryCodeApplied::get());
    assert_eq!(
        crate::configs::RecoveryScheduledHash::get(),
        Some(recovery_hash)
    );
    assert_eq!(crate::configs::RetiredMigrationCursor::get(), Some(retired));
    assert_eq!(
        pallet_execution_guard::RecoveryImage::<Runtime>::get().map(|commitment| commitment.hash),
        Some(recovery_hash)
    );
    assert!(crate::configs::RecoveryAwareMigrations::ongoing());
}

#[cfg(all(not(feature = "recovery"), not(feature = "runtime-benchmarks")))]
#[test]
fn primary_profile_registers_exactly_the_b15_backfill_with_a_strict_step_bound() {
    assert_eq!(<RuntimeMigrations as SteppedMigrations>::len(), 1);
    assert_eq!(
        <RuntimeMigrations as SteppedMigrations>::nth_id(0),
        Some(Backfill::id().encode()),
        "the primary release must register exactly the audited ledger backfill",
    );
    let max_steps = <RuntimeMigrations as SteppedMigrations>::nth_max_steps(0)
        .expect("migration zero exists")
        .expect("the release MBM must publish a finite max_steps");
    assert!(
        max_steps < kernel::MIGRATION_STALL_BLOCKS,
        "the MBM must fail before the independent stall detector"
    );
}

#[cfg(all(feature = "recovery", not(feature = "runtime-benchmarks")))]
#[test]
fn recovery_profile_registers_no_sdk_multi_block_migrations() {
    assert_eq!(
        <RuntimeMigrations as SteppedMigrations>::len(),
        0,
        "the terminal recovery performs one bounded release repair, never a second SDK MBM"
    );
}

#[cfg(feature = "recovery")]
#[test]
fn terminal_recovery_repairs_every_primary_cutpoint_and_unlocks_only_after_commit() {
    let cutpoints = tests::development_ext().execute_with(|| {
        seed_legacy_vaults();
        valid_cutpoints()
            .into_iter()
            .map(|cursor| cursor.map(|cursor| cursor.encode()))
            .collect::<Vec<_>>()
    });

    // The fixture has three proposal rows, one phase transition, and two
    // baseline rows: start + 3 + 1 + 2 = seven recoverable cutpoints.
    assert_eq!(cutpoints.len(), 7);
    assert_eq!(
        cutpoints
            .iter()
            .filter(|cursor| cursor
                .as_ref()
                .is_some_and(|bytes| bytes.first() == Some(&0)))
            .count(),
        3,
        "every persisted proposal cursor is present"
    );
    assert_eq!(
        cutpoints
            .iter()
            .filter(|cursor| cursor
                .as_ref()
                .is_some_and(|bytes| bytes.first() == Some(&1)))
            .count(),
        3,
        "the baseline phase transition and both persisted baseline cursors are present"
    );

    for inner in cutpoints {
        with_recovery_state(active_cursor(inner, 0), |recovery_hash| {
            assert_only_inherents();
            assert_repair_source_is_locked();

            let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
            assert!(crate::configs::RecoveryLedgerRepairActive::get());
            assert_repair_source_is_locked();
            drive_repair_to_completion();

            assert_eq!(
                pallet_conditional_ledger::TotalEscrowed::<Runtime>::get(),
                EXPECTED_TOTAL
            );
            assert_eq!(
                crate::ConditionalLedger::on_chain_storage_version(),
                StorageVersion::new(1)
            );
            assert!(!crate::configs::RecoveryLockdown::get());
            assert!(!crate::configs::RecoveryCodeApplied::get());
            assert!(!crate::configs::RecoveryScheduledHash::exists());
            assert!(!crate::configs::RetiredMigrationCursor::exists());
            assert!(!pallet_execution_guard::RecoveryImage::<Runtime>::exists());
            assert!(!crate::configs::RecoveryAwareMigrations::ongoing());
            assert_ne!(recovery_hash, [0; 32]);
        });
    }
}

#[cfg(all(feature = "recovery", feature = "phase-four"))]
#[test]
fn sq383_terminal_recovery_completes_the_phase_transition_below_the_nav_floor() {
    // SQ-383 added 08 §4.2's arming gate to the Phase-3->4 migration. That gate
    // MUST NOT bind on the terminal recovery lane, which shares the same
    // function: a recovery image runs under `OnlyInherents`/`RecoveryLockdown`,
    // where no ordinary call — including any that could fund the treasury — is
    // dispatchable. Enforcing the floor here would make a below-floor primary
    // install unrecoverable forever, trading the SQ-383 defect for a bricked
    // chain (R-7). Found by adversarial review of the SQ-383 commit.
    with_recovery_state(active_cursor(None, 0), |_| {
        let plan = pallet_execution_guard::PhaseFourPlan {
            tvl_cap: pallet_constitution::Params::<Runtime>::get(pallet_constitution::key16(
                b"phase3.tvl_cap",
            ))
            .expect("TVL cap is registered")
            .value
            .as_u128()
            .saturating_add(1),
            deposit_cap: 1,
        };
        let image = pallet_execution_guard::RecoveryImage::<Runtime>::get()
            .expect("the recovery fixture commits an image");
        pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
            pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                pid: image.pid,
                code_hash: image.primary_hash,
                plan,
            },
        );
        crate::configs::RetiredMigrationCursor::kill();
        // The scenario: a Phase-3 chain whose primary Phase-3->4 install failed
        // below floor. Its *state* is still Phase 3, so reconstruct that rather
        // than inheriting the profile's already-armed genesis.
        crate::configs::PhaseTransitionLock::put(true);
        pallet_constitution::PhaseFlags::<Runtime>::put(
            pallet_constitution::PhaseFlagsValue::SHADOW_MODE
                | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT,
        );

        // Precondition: the chain cannot possibly clear the PARAM floor, and
        // under recovery lockdown it has no way to ever get there.
        assert!(
            crate::FutarchyTreasury::nav().spendable_nav
                < crate::FutarchyTreasury::floor(futarchy_primitives::ProposalClass::Param)
        );
        assert!(crate::configs::RecoveryLockdown::get());
        assert_ne!(
            pallet_constitution::PhaseFlags::<Runtime>::get(),
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            "precondition: PARAM must not already be armed, or the check below is vacuous",
        );

        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();

        // The fixture's ledger segment is un-migrated, so the transition is
        // owed its repair first (MAX-03/round 6). SQ-383's property is about
        // the arming gate, not the sequencing: drive the repair and the
        // below-floor transition must still complete at its terminal step.
        assert!(crate::configs::RecoveryLedgerRepairActive::get());
        assert_ne!(
            pallet_constitution::PhaseFlags::<Runtime>::get(),
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            "Phase 4 must not be entered before the registered segment is repaired",
        );
        drive_repair_to_completion();

        assert_eq!(
            pallet_constitution::PhaseFlags::<Runtime>::get(),
            pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
            "terminal recovery must complete the already-authorized transition",
        );
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(1),
            "and only on a ledger segment that actually migrated",
        );
        // The rest of the transition committed with it: the scheduled cap
        // raise landed, which also exercises SQ-197's ordering (the arming bits
        // are written first, so the raise passes the ordinary Phase-4 gate).
        assert_eq!(
            pallet_constitution::Params::<Runtime>::get(pallet_constitution::key16(
                b"phase3.tvl_cap"
            ))
            .map(|record| record.value.as_u128()),
            Some(2_000_000_000_001),
        );
    });
}

/// Round-6 regression. The phase-recovery lane completed the Phase-3→4
/// transition and cleared `OnlyInherents` **without** running the registered
/// ledger segment's repair.
///
/// 09 §3.2 admits a primary MBM only against a "cutpoint-total repair for every
/// registered segment", and this segment's nonterminal steps are read-only —
/// only its terminal step writes `TotalEscrowed` and storage version 1. So the
/// chain entered Phase 4 with the mirror never committed, and since
/// `TotalEscrowed` is `ValueQuery` it reads 0 rather than absent:
/// `maintained_collateral_totals` understates the I-4 liability by every
/// pre-migration vault, and the drift detector reports healthy.
///
/// Nothing repaired it afterwards either — `onboard_new_mbms` runs only on a
/// runtime upgrade, `progress_mbms` returns early on a `None` cursor, and the
/// recovery profile registers no MBMs.
///
/// Both entry shapes are covered: a cursor that survived retirement, and none
/// at all (what `discard_unserviceable_cursor` leaves one block earlier, which
/// reaches the same hole without any retired cursor).
///
/// Fails at baseline on the first assertion — recovery completed, the ledger
/// still at version 0 with `TotalEscrowed` absent.
#[cfg(feature = "recovery")]
#[test]
fn round6_phase_recovery_cannot_enter_phase_four_on_an_unrepaired_ledger_segment() {
    for retired_survives in [true, false] {
        with_recovery_state(active_cursor(None, 0), |_| {
            let image = pallet_execution_guard::RecoveryImage::<Runtime>::get()
                .expect("the recovery fixture commits an image");
            pallet_execution_guard::PhaseFourBridge::<Runtime>::put(
                pallet_execution_guard::PhaseFourBridgeState::Scheduled {
                    pid: image.pid,
                    code_hash: image.primary_hash,
                    plan: pallet_execution_guard::PhaseFourPlan {
                        tvl_cap: 2_000_000_000_001,
                        deposit_cap: 1,
                    },
                },
            );
            if !retired_survives {
                crate::configs::RetiredMigrationCursor::kill();
            }
            crate::configs::PhaseTransitionLock::put(true);
            pallet_constitution::PhaseFlags::<Runtime>::put(
                pallet_constitution::PhaseFlagsValue::SHADOW_MODE
                    | pallet_constitution::PhaseFlagsValue::SUDO_PRESENT,
            );

            // Precondition: the segment is registered and un-migrated.
            assert_eq!(
                crate::ConditionalLedger::on_chain_storage_version(),
                StorageVersion::new(0)
            );
            assert!(!pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists());

            let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();

            assert!(
                crate::configs::RecoveryLedgerRepairActive::get(),
                "the registered segment must be repaired, not discarded \
                 (retired cursor present: {retired_survives})",
            );
            assert_only_inherents();
            assert_ne!(
                pallet_constitution::PhaseFlags::<Runtime>::get(),
                pallet_constitution::PhaseFlagsValue::PARAM_ARMED,
                "Phase 4 must not be entered before the repair commits",
            );

            drive_repair_to_completion();

            // Both causes clear, once, and only after the mirror commits.
            assert_eq!(
                pallet_conditional_ledger::TotalEscrowed::<Runtime>::get(),
                EXPECTED_TOTAL
            );
            assert_eq!(
                crate::ConditionalLedger::on_chain_storage_version(),
                StorageVersion::new(1)
            );
            assert_eq!(
                pallet_constitution::PhaseFlags::<Runtime>::get(),
                pallet_constitution::PhaseFlagsValue::PARAM_ARMED
            );
            assert!(matches!(
                pallet_execution_guard::PhaseFourBridge::<Runtime>::get(),
                pallet_execution_guard::PhaseFourBridgeState::Consumed
            ));
            assert!(!crate::configs::PhaseTransitionLock::get());
            assert!(!crate::configs::RecoveryLockdown::get());
            assert!(!crate::configs::RecoveryAwareMigrations::ongoing());
        });
    }
}

#[cfg(feature = "recovery")]
#[test]
fn stuck_cursor_restarts_the_bounded_release_repair_from_the_beginning() {
    with_recovery_state(pallet_migrations::MigrationCursor::Stuck, |_| {
        crate::configs::MigrationFailedStep::put(0);
        assert_only_inherents();
        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
        assert!(crate::configs::RecoveryLedgerRepairActive::get());
        assert_repair_source_is_locked();
        drive_repair_to_completion();
        assert_eq!(
            pallet_conditional_ledger::TotalEscrowed::<Runtime>::get(),
            EXPECTED_TOTAL
        );
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(1)
        );
        assert!(!crate::configs::RecoveryAwareMigrations::ongoing());
        assert!(!pallet_execution_guard::RecoveryImage::<Runtime>::exists());
    });
}

#[cfg(feature = "recovery")]
fn assert_recovery_rejects_without_partial_writes(retired: pallet_migrations::CursorOf<Runtime>) {
    with_recovery_state(retired.clone(), |recovery_hash| {
        assert_only_inherents();
        let commitment =
            pallet_execution_guard::RecoveryImage::<Runtime>::get().expect("commitment exists");

        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
        for _ in 0..=pallet_conditional_ledger::migration::MAX_BACKFILL_STEPS {
            if !crate::configs::RecoveryLedgerRepairActive::get()
                || crate::configs::RecoveryLedgerRepairFailed::get()
            {
                break;
            }
            let _ = crate::configs::RecoveryAwareMigrations::step();
        }

        assert!(!pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists());
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(0)
        );
        assert!(crate::configs::RecoveryLockdown::get());
        assert!(crate::configs::RecoveryCodeApplied::get());
        assert_eq!(
            crate::configs::RecoveryScheduledHash::get(),
            Some(recovery_hash)
        );
        assert_eq!(
            crate::configs::RetiredMigrationCursor::get(),
            Some(retired.clone())
        );
        assert_eq!(
            pallet_execution_guard::RecoveryImage::<Runtime>::get(),
            Some(commitment)
        );
        assert_terminal_evidence_preserved(retired, recovery_hash);
        assert!(pallet_execution_guard::MigrationHalt::<Runtime>::get());
    });
}

#[cfg(feature = "recovery")]
#[test]
fn syntactically_valid_stale_progress_is_validated_then_safely_restarted() {
    let stale = tests::development_ext().execute_with(|| {
        seed_legacy_vaults();
        vec![
            raw_cursor(
                0,
                Some(pallet_conditional_ledger::Vaults::<Runtime>::hashed_key_for(777)),
                u128::MAX,
            ),
            raw_cursor(1, None, u128::MAX),
        ]
    });

    for cursor in stale {
        with_recovery_state(active_cursor(Some(cursor.encode()), 0), |_| {
            let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
            assert!(crate::configs::RecoveryLedgerRepairActive::get());
            drive_repair_to_completion();
            assert_eq!(
                pallet_conditional_ledger::TotalEscrowed::<Runtime>::get(),
                EXPECTED_TOTAL
            );
            assert_eq!(
                crate::ConditionalLedger::on_chain_storage_version(),
                StorageVersion::new(1)
            );
        });
    }
}

#[cfg(feature = "recovery")]
#[test]
fn malformed_cursor_and_wrong_sdk_index_fail_closed() {
    assert_recovery_rejects_without_partial_writes(active_cursor(Some(vec![0xff, 0x00, 0x7f]), 0));

    let valid = tests::development_ext().execute_with(|| {
        seed_legacy_vaults();
        valid_cutpoints()[1]
            .as_ref()
            .expect("first proposal cursor")
            .encode()
    });
    assert_recovery_rejects_without_partial_writes(active_cursor(Some(valid), 1));
}

#[cfg(feature = "recovery")]
#[test]
fn wrong_stuck_step_and_wrong_source_version_fail_closed() {
    with_recovery_state(pallet_migrations::MigrationCursor::Stuck, |recovery_hash| {
        crate::configs::MigrationFailedStep::put(1);
        let commitment =
            pallet_execution_guard::RecoveryImage::<Runtime>::get().expect("commitment exists");
        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
        assert!(!crate::configs::RecoveryLedgerRepairActive::get());
        assert!(!pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists());
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(0)
        );
        assert_eq!(
            crate::configs::RetiredMigrationCursor::get(),
            Some(pallet_migrations::MigrationCursor::Stuck)
        );
        assert_eq!(
            crate::configs::RecoveryScheduledHash::get(),
            Some(recovery_hash)
        );
        assert_eq!(
            pallet_execution_guard::RecoveryImage::<Runtime>::get(),
            Some(commitment)
        );
        assert_terminal_evidence_preserved(
            pallet_migrations::MigrationCursor::Stuck,
            recovery_hash,
        );
    });

    with_recovery_state(active_cursor(None, 0), |recovery_hash| {
        let retired = active_cursor(None, 0);
        StorageVersion::new(1).put::<crate::ConditionalLedger>();
        pallet_conditional_ledger::TotalEscrowed::<Runtime>::put(EXPECTED_TOTAL);
        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
        assert!(!crate::configs::RecoveryLedgerRepairActive::get());
        assert_eq!(
            pallet_conditional_ledger::TotalEscrowed::<Runtime>::get(),
            EXPECTED_TOTAL
        );
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(1)
        );
        assert_terminal_evidence_preserved(retired, recovery_hash);
    });
}

#[cfg(feature = "recovery")]
#[test]
fn malformed_row_overflow_and_release_row_bound_fail_closed_without_partial_commit() {
    with_recovery_state(active_cursor(None, 0), |recovery_hash| {
        let mut malformed = <pallet_conditional_ledger::Vaults<Runtime> as StoragePrefixedMap<
            conditional_ledger_core::VaultInfo,
        >>::final_prefix()
        .to_vec();
        malformed.push(0xff);
        unhashed::put_raw(
            &malformed,
            &conditional_ledger_core::VaultInfo::open(0).encode(),
        );
        let retired = active_cursor(None, 0);
        let commitment =
            pallet_execution_guard::RecoveryImage::<Runtime>::get().expect("commitment exists");
        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
        for _ in 0..10 {
            let _ = crate::configs::RecoveryAwareMigrations::step();
            if crate::configs::RecoveryLedgerRepairFailed::get() {
                break;
            }
        }
        assert!(crate::configs::RecoveryLedgerRepairFailed::get());
        assert!(!pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists());
        assert_eq!(
            crate::configs::RetiredMigrationCursor::get(),
            Some(retired.clone())
        );
        assert_eq!(
            crate::configs::RecoveryScheduledHash::get(),
            Some(recovery_hash)
        );
        assert_eq!(
            pallet_execution_guard::RecoveryImage::<Runtime>::get(),
            Some(commitment)
        );
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(0)
        );
        assert_terminal_evidence_preserved(retired, recovery_hash);
    });

    with_recovery_state(active_cursor(None, 0), |recovery_hash| {
        let retired = active_cursor(None, 0);
        let mut overflow = conditional_ledger_core::VaultInfo::open(0);
        overflow.escrowed = u128::MAX;
        pallet_conditional_ledger::Vaults::<Runtime>::insert(1, overflow);
        let mut one = conditional_ledger_core::VaultInfo::open(0);
        one.escrowed = 1;
        pallet_conditional_ledger::Vaults::<Runtime>::insert(2, one);
        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
        for _ in 0..5 {
            let _ = crate::configs::RecoveryAwareMigrations::step();
            if crate::configs::RecoveryLedgerRepairFailed::get() {
                break;
            }
        }
        assert!(crate::configs::RecoveryLedgerRepairFailed::get());
        assert!(!pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists());
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(0)
        );
        assert_terminal_evidence_preserved(retired, recovery_hash);
    });

    with_recovery_state(active_cursor(None, 0), |recovery_hash| {
        let retired = active_cursor(None, 0);
        let _ = pallet_conditional_ledger::Vaults::<Runtime>::clear(u32::MAX, None);
        let _ = pallet_conditional_ledger::BaselineVaults::<Runtime>::clear(u32::MAX, None);
        for pid in 0..=u64::from(pallet_conditional_ledger::migration::MAX_BACKFILL_ROWS) {
            pallet_conditional_ledger::Vaults::<Runtime>::insert(
                pid,
                conditional_ledger_core::VaultInfo::open(0),
            );
        }
        let _ = crate::migrations::TerminalRecoveryTransition::on_runtime_upgrade();
        for _ in 0..=pallet_conditional_ledger::migration::MAX_BACKFILL_STEPS {
            let _ = crate::configs::RecoveryAwareMigrations::step();
            if crate::configs::RecoveryLedgerRepairFailed::get() {
                break;
            }
        }
        assert!(crate::configs::RecoveryLedgerRepairFailed::get());
        assert!(!pallet_conditional_ledger::TotalEscrowed::<Runtime>::exists());
        assert_eq!(
            crate::ConditionalLedger::on_chain_storage_version(),
            StorageVersion::new(0)
        );
        assert_terminal_evidence_preserved(retired, recovery_hash);
    });
}

/// 16 §8.4's external arming bound must bind the **terminal recovery lane**,
/// and the way it binds there cannot be a refusal.
///
/// Adversarial review, 2026-08-03 (blocker). The bound first shipped inside
/// `transition_phase_four`'s `enforce_arming_gate` branch, which exists so
/// recovery can skip the *treasury* floor -- a chain wedged under
/// `OnlyInherents` cannot dispatch anything that would fund the treasury, so
/// enforcing that floor there bricks it. The external bound inherited the
/// exemption and recovery armed Phase 4 with external depth dominant: exactly
/// the state the clause forbids, via the one path nobody watches.
///
/// Refusing on the recovery lane would recreate the brick -- under
/// `OnlyInherents` no call can void a hosted question or seed POL either, so
/// the bound could never be satisfied. The lane therefore PAUSES the hosted
/// service: no new question is admitted, live ones drain to their own
/// deadlines, and the bound is restored by the lifecycle instead of by a vote.
#[cfg(any(feature = "phase-four", feature = "recovery"))]
#[test]
fn terminal_recovery_pauses_the_service_instead_of_arming_past_the_external_bound() {
    crate::tests::development_ext().execute_with(|| {
        let plan = pallet_execution_guard::PhaseFourPlan {
            tvl_cap: u128::MAX,
            deposit_cap: u128::MAX,
        };
        // External depth with no protocol depth behind it: the violating state.
        pallet_question_service::LiveExternalDepth::<Runtime>::put(2_000u128);
        assert!(
            crate::Market::live_pol_commitments().is_empty(),
            "fixture requires zero protocol commitments"
        );
        assert!(pallet_question_service::PausedUntil::<Runtime>::get().is_none());

        // The primary lane refuses, and leaves the service unpaused.
        assert!(
            frame_support::storage::with_storage_layer(|| {
                crate::migrations::transition_phase_four(plan, true)
            })
            .is_err(),
            "the primary arming path must refuse while external depth dominates"
        );
        assert!(
            pallet_question_service::PausedUntil::<Runtime>::get().is_none(),
            "a refused transition must roll back, pausing nothing"
        );

        // The recovery lane completes -- and pauses.
        frame_support::assert_ok!(frame_support::storage::with_storage_layer(|| {
            crate::migrations::transition_phase_four(plan, false)
        }));
        assert!(
            pallet_question_service::PausedUntil::<Runtime>::get().is_some(),
            "recovery must pause the hosted service rather than arm past the bound"
        );
    });
}

/// The mirror: when the bound already holds, recovery must NOT pause. A fix
/// that paused unconditionally would pass the test above while silently
/// switching the hosted service off on every recovery.
#[cfg(any(feature = "phase-four", feature = "recovery"))]
#[test]
fn terminal_recovery_leaves_the_service_running_when_the_bound_holds() {
    crate::tests::development_ext().execute_with(|| {
        let plan = pallet_execution_guard::PhaseFourPlan {
            tvl_cap: u128::MAX,
            deposit_cap: u128::MAX,
        };
        pallet_question_service::LiveExternalDepth::<Runtime>::put(0u128);
        frame_support::assert_ok!(frame_support::storage::with_storage_layer(|| {
            crate::migrations::transition_phase_four(plan, false)
        }));
        assert!(
            pallet_question_service::PausedUntil::<Runtime>::get().is_none(),
            "recovery must not pause a service that is within its bound"
        );
    });
}
