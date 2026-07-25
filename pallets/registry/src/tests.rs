//! Unit / property tests for `pallet-registry` (15 §4.1).
//!
//! Covers, per call: the happy path, the error paths, origin misuse, real USDC
//! bond custody (escrow / refund / 40-60 slash), the 07 §4 quorum + extension
//! lifecycle, claimant-adverse aggregates, the close/reap lifecycle, both
//! instances (Incident + Milestone), the rule-4 `Params` read, and `try_state`.

use crate::mock::*;
use crate::{Aggregates, Error, FilingCount, Filings};
use frame_support::{assert_noop, assert_ok};
use futarchy_primitives::{keeper::CrankClass, Balance, FixedU64};
use registry_core::{
    FilingClass, FilingState, RegistryKind, MAX_FILINGS_PER_EPOCH, MAX_LIVE_EPOCHS,
    REG_BOND_INCIDENT, REG_BOND_MILESTONE, REG_CLOSE_BATCH, REG_EXT_WINDOW_BLOCKS,
    REG_WINDOW_BLOCKS, WT_QUORUM,
};

fn signed(n: u8) -> RuntimeOrigin {
    RuntimeOrigin::signed(acct(n))
}
const H: [u8; 32] = [9u8; 32];
const VER: u16 = 3;
/// A block past every filing challenge window and the default filing window.
const CLOSE_BLOCK: u64 = 1_000_002;
/// The mock's `reg.archive_delay` fixture (blocks); see `mock::ArchiveDelay`.
const ARCHIVE_DELAY: u64 = 100;

// ------------------------------------------------------------------- file

#[test]
fn incident_file_escrows_bond_and_records_filing() {
    new_test_ext().execute_with(|| {
        let a0 = usdc(&acct(ALICE));
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        let f = Filings::<Test, IncidentInstance>::get(5, 0).unwrap();
        assert_eq!(f.who, raw(ALICE));
        assert_eq!(f.bond, REG_BOND_INCIDENT);
        assert!(matches!(f.state, FilingState::Filed { .. }));
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 1);
        // Bond escrowed to the sovereign.
        assert_eq!(usdc(&acct(ALICE)), a0 - REG_BOND_INCIDENT);
        assert_eq!(usdc(&incident_account()), REG_BOND_INCIDENT);
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

#[test]
fn file_rejects_closed_window_bad_class_and_spec_mismatch() {
    new_test_ext().execute_with(|| {
        // Window closed: now (1) > filing_window_end.
        set_filing_window_end(0);
        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 5, FilingClass::S2, 0, H, VER),
            Error::<Test, IncidentInstance>::WindowClosed
        );
        set_filing_window_end(1_000_000);
        // Wrong class for the Incident instance.
        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 5, FilingClass::Scope(1), 0, H, VER),
            Error::<Test, IncidentInstance>::InvalidClass
        );
        // Spec version other than the frozen version (I-16); filer cannot forge it.
        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 5, FilingClass::S2, 0, H, VER + 1),
            Error::<Test, IncidentInstance>::SpecVersionMismatch
        );
        // No USDC moved on any rejected file.
        assert_eq!(usdc(&incident_account()), 0);
    });
}

#[test]
fn file_enforces_epoch_and_live_epoch_caps() {
    // limit-coverage: reg.max_filings_epoch, Registry filings (Incident/Milestone)
    new_test_ext().execute_with(|| {
        for i in 0..MAX_FILINGS_PER_EPOCH {
            assert_ok!(IncidentRegistry::file(
                signed(ALICE),
                7,
                FilingClass::S3,
                0,
                H,
                VER
            ));
            assert_eq!(FilingCount::<Test, IncidentInstance>::get(7), i + 1);
        }
        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 7, FilingClass::S3, 0, H, VER),
            Error::<Test, IncidentInstance>::EpochFull
        );
    });
}

#[test]
fn file_rejects_a_fifth_live_epoch() {
    new_test_ext().execute_with(|| {
        for e in 1..=(MAX_LIVE_EPOCHS as u32) {
            assert_ok!(IncidentRegistry::file(
                signed(ALICE),
                e,
                FilingClass::S3,
                0,
                H,
                VER
            ));
        }
        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 99, FilingClass::S3, 0, H, VER),
            Error::<Test, IncidentInstance>::TooManyLiveEpochs
        );
    });
}

#[test]
fn file_reads_bond_from_params_not_a_hardcode() {
    new_test_ext().execute_with(|| {
        // Rule 4: raise the live `reg.bond_incident` and prove the escrow follows.
        let raised = 7_000_000_000; // 7,000 USDC
        BondIncident::set(raised);
        let a0 = usdc(&acct(ALICE));
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_eq!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().bond,
            raised
        );
        assert_eq!(usdc(&acct(ALICE)), a0 - raised);
        assert_eq!(usdc(&incident_account()), raised);
    });
}

#[test]
fn sq296_floor_knee_uses_incident_floor_at_zero_exposure() {
    new_test_ext().execute_with(|| {
        IncidentExposure::set(Some(0));
        let before = usdc(&acct(ALICE));

        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));

        let stored = Filings::<Test, IncidentInstance>::get(5, 0).map(|filing| filing.bond);
        assert_eq!(stored, Some(5_000_000_000));
        assert_eq!(usdc(&acct(ALICE)), before - 5_000_000_000);
        assert_eq!(usdc(&incident_account()), 5_000_000_000);
    });
}

#[test]
fn sq296_fractional_base_unit_rounds_bond_up() {
    new_test_ext().execute_with(|| {
        // 250 × 200,000,000,001 / 10,000 =
        // 5,000,000,000.025 base units: custody rounds to 5,000,000,001.
        IncidentExposure::set(Some(200_000 * UNIT + 1));
        let before = usdc(&acct(ALICE));

        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));

        let stored = Filings::<Test, IncidentInstance>::get(5, 0).map(|filing| filing.bond);
        assert_eq!(stored, Some(35_000_000_001));
        assert_eq!(usdc(&acct(ALICE)), before - 35_000_000_001);
        assert_eq!(usdc(&incident_account()), 35_000_000_001);
    });
}

#[test]
fn sq296_unavailable_exposure_refuses_without_custody() {
    new_test_ext().execute_with(|| {
        IncidentExposure::set(None);
        let filer_before = usdc(&acct(ALICE));
        let custody_before = usdc(&incident_account());

        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 5, FilingClass::S2, 0, H, VER),
            Error::<Test, IncidentInstance>::ExposureUnavailable
        );

        assert_eq!(usdc(&acct(ALICE)), filer_before);
        assert_eq!(usdc(&incident_account()), custody_before);
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 0);
        assert!(Filings::<Test, IncidentInstance>::get(5, 0).is_none());
    });
}

#[test]
fn sq296_filing_bond_is_frozen_for_matching_challenge() {
    new_test_ext().execute_with(|| {
        // Creation: 400,000 USDC × 1,750 bps (the 07 §6.3 one-round coverage rate,
        // 7 × 250) = 70,000 USDC, above the floor.
        IncidentExposure::set(Some(400_000 * UNIT));
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        let stored_bond = 70_000_000_000;
        assert_eq!(
            Filings::<Test, IncidentInstance>::get(5, 0).map(|filing| filing.bond),
            Some(stored_bond)
        );

        // A live META amendment would price a new filing at 140,000 USDC.
        CoverageBps::set(3_500);
        let challenger_before = usdc(&acct(BOB));
        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));

        // The existing claim and its matching challenge remain frozen at the
        // creation-time 70,000-USDC amount, never the live 140,000-USDC quote.
        assert_eq!(
            Filings::<Test, IncidentInstance>::get(5, 0).map(|filing| filing.bond),
            Some(stored_bond)
        );
        assert_eq!(usdc(&acct(BOB)), challenger_before - stored_bond);
        assert_eq!(usdc(&incident_account()), 2 * stored_bond);
    });
}

#[test]
fn sq296_scaled_bond_overflow_refuses_without_custody() {
    new_test_ext().execute_with(|| {
        IncidentExposure::set(Some(Balance::MAX));
        let filer_before = usdc(&acct(ALICE));
        let custody_before = usdc(&incident_account());

        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 5, FilingClass::S2, 0, H, VER),
            Error::<Test, IncidentInstance>::Overflow
        );

        assert_eq!(usdc(&acct(ALICE)), filer_before);
        assert_eq!(usdc(&incident_account()), custody_before);
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 0);
        assert!(Filings::<Test, IncidentInstance>::get(5, 0).is_none());
    });
}

// ------------------------------------------------------------- challenge

#[test]
fn challenge_escrows_matching_bond_and_is_single_round() {
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Challenged { .. }
        ));
        // Both bonds now escrowed.
        assert_eq!(usdc(&incident_account()), 2 * REG_BOND_INCIDENT);
        // Registry games do not escalate: a second challenge is refused.
        assert_noop!(
            IncidentRegistry::challenge_filing(signed(CHARLIE), 5, 0, H),
            Error::<Test, IncidentInstance>::AlreadyChallenged
        );
    });
}

#[test]
fn challenge_unknown_filing_fails() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H),
            Error::<Test, IncidentInstance>::FilingNotFound
        );
    });
}

// ------------------------------------------------------------- ack_observed

#[test]
fn ack_requires_registered_watchtower_and_dedups() {
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        // Unregistered acker rejected (07 §4).
        assert_noop!(
            IncidentRegistry::ack_observed(signed(WT1), 5, 0),
            Error::<Test, IncidentInstance>::NotRegistered
        );
        register_watchtower(WT1);
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_eq!(
            KeeperRebates::get(),
            vec![(acct(WT1), CrankClass::OracleLine)]
        );
        // One ack per watchtower per filing.
        assert_noop!(
            IncidentRegistry::ack_observed(signed(WT1), 5, 0),
            Error::<Test, IncidentInstance>::DuplicateAck
        );
        assert_eq!(
            KeeperRebates::get(),
            vec![(acct(WT1), CrankClass::OracleLine)]
        );

        // The second registry instance has its own Config binding and receives
        // the same mandated keeper-class ack rebate.
        assert_ok!(MilestoneRegistry::file(
            signed(ALICE),
            6,
            FilingClass::Scope(1),
            10,
            H,
            VER
        ));
        assert_ok!(MilestoneRegistry::ack_observed(signed(WT1), 6, 0));
        assert_eq!(
            KeeperRebates::get(),
            vec![
                (acct(WT1), CrankClass::OracleLine),
                (acct(WT1), CrankClass::OracleLine),
            ]
        );
        assert!(System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::IncidentRegistry(crate::Event::WindowAcknowledged {
                epoch: 5,
                filing_id: 0,
                watchtower,
            }) if watchtower == &acct(WT1)
        )));
        assert!(System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::MilestoneRegistry(crate::Event::WindowAcknowledged {
                epoch: 6,
                filing_id: 0,
                watchtower,
            }) if watchtower == &acct(WT1)
        )));
    });
}

// ------------------------------------------------------------- crank_close

#[test]
fn crank_close_upholds_with_quorum_and_refunds_filer() {
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        let after_file = usdc(&acct(ALICE));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Upheld
        ));
        // Filer bond refunded in full; sovereign flat.
        assert_eq!(usdc(&acct(ALICE)), after_file + REG_BOND_INCIDENT);
        assert_eq!(usdc(&incident_account()), 0);
    });
}

#[test]
fn crank_close_extends_once_then_rejects_and_refunds() {
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S3,
            0,
            H,
            VER
        ));
        let after_file = usdc(&acct(ALICE));
        // First crank past the 72 h window: no quorum ⇒ single 48 h extension.
        System::set_block_number(REG_WINDOW_BLOCKS as u64 + 2);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Filed { extended: true, .. }
        ));
        assert!(System::events().iter().any(|record| matches!(
            record.event,
            RuntimeEvent::IncidentRegistry(crate::Event::WindowExtended {
                epoch: 5,
                filing_id: 0,
                new_deadline,
            }) if new_deadline == REG_WINDOW_BLOCKS + REG_EXT_WINDOW_BLOCKS + 1
        )));
        assert_eq!(
            KeeperRebates::get(),
            vec![(acct(BOB), CrankClass::OracleLine)]
        );
        // Second crank past the extension: rejected-as-unobservable, bond refunded.
        System::set_block_number((REG_WINDOW_BLOCKS + REG_EXT_WINDOW_BLOCKS) as u64 + 3);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Rejected
        ));
        assert_eq!(usdc(&acct(ALICE)), after_file + REG_BOND_INCIDENT);
        assert_eq!(usdc(&incident_account()), 0);
        // The extension cannot latch twice, and the terminal quorum-failure
        // rejection is unpaid hygiene work.
        assert_eq!(
            KeeperRebates::get(),
            vec![(acct(BOB), CrankClass::OracleLine)]
        );
    });
}

#[test]
fn quorum_failure_refund_path_cannot_farm_close_rebates() {
    new_test_ext().execute_with(|| {
        let before = usdc(&acct(ALICE));
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S3,
            0,
            H,
            VER
        ));
        assert_eq!(usdc(&acct(ALICE)), before - REG_BOND_INCIDENT);

        // A keeper first arriving after both windows causes the one-time
        // extension and rejection in one bounded call. No quorum was supplied,
        // the filing bond is refunded, and the close earns no rebate.
        System::set_block_number((REG_WINDOW_BLOCKS + REG_EXT_WINDOW_BLOCKS) as u64 + 3);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Rejected
        ));
        assert_eq!(usdc(&acct(ALICE)), before);
        assert!(KeeperRebates::get().is_empty());
    });
}

#[test]
fn crank_close_rejects_oversized_batch() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            IncidentRegistry::crank_close(signed(BOB), 5, REG_CLOSE_BATCH as u32 + 1),
            Error::<Test, IncidentInstance>::BatchTooLarge
        );
    });
}

#[test]
fn keeper_rebate_is_instance_scoped_and_skips_noop_or_error_cranks() {
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S3,
            0,
            H,
            VER
        ));

        // An open-window crank succeeds but advances nothing: no drain-vector
        // rebate. A rejected oversized batch likewise never reaches the sink.
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_noop!(
            IncidentRegistry::crank_close(signed(BOB), 5, REG_CLOSE_BATCH as u32 + 1),
            Error::<Test, IncidentInstance>::BatchTooLarge
        );
        assert!(KeeperRebates::get().is_empty());

        // The due crank advances the filing to its latch-once extension and
        // earns exactly one rebate.
        System::set_block_number(REG_WINDOW_BLOCKS as u64 + 2);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_eq!(
            KeeperRebates::get(),
            vec![(acct(BOB), CrankClass::OracleLine)]
        );

        // Once the extension expires, the quorum-failure rejection closes and
        // refunds the filing but earns nothing further.
        System::set_block_number((REG_WINDOW_BLOCKS + REG_EXT_WINDOW_BLOCKS) as u64 + 3);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_eq!(
            KeeperRebates::get(),
            vec![(acct(BOB), CrankClass::OracleLine)]
        );

        // The second instance chooses its own Config seam too. A late
        // extension-plus-rejection there is equally unpaid.
        assert_ok!(MilestoneRegistry::file(
            signed(ALICE),
            6,
            FilingClass::Scope(1),
            10,
            H,
            VER
        ));
        System::set_block_number(
            System::block_number()
                + u64::from(REG_WINDOW_BLOCKS)
                + u64::from(REG_EXT_WINDOW_BLOCKS)
                + 1,
        );
        assert_ok!(MilestoneRegistry::crank_close(
            signed(BOB),
            6,
            REG_CLOSE_BATCH as u32
        ));
        assert_eq!(KeeperRebates::get().len(), 1);
    });
}

// --------------------------------------------------------- resolve_challenge

#[test]
fn resolve_reject_slashes_the_filer_40_60_to_challenger_and_insurance() {
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));
        let alice0 = usdc(&acct(ALICE));
        let bob0 = usdc(&acct(BOB));
        let ins0 = usdc(&acct(INSURANCE));
        // SQ-294: the verdict is admissible only strictly after the counter-round
        // window the challenge opened.
        System::set_block_number(REG_WINDOW_BLOCKS as u64 + 2);
        // uphold=false ⇒ the filing is rejected; ALICE (filer) is the loser.
        assert_ok!(IncidentRegistry::resolve_challenge(
            signed(RESOLVER),
            5,
            0,
            false,
            H
        ));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Rejected
        ));
        let cs = REG_BOND_INCIDENT * 40 / 100;
        let is = REG_BOND_INCIDENT - cs;
        // Winner BOB: own bond back + 40 %. INSURANCE: 60 %. Loser ALICE: nothing.
        assert_eq!(usdc(&acct(BOB)), bob0 + REG_BOND_INCIDENT + cs);
        assert_eq!(usdc(&acct(INSURANCE)), ins0 + is);
        assert_eq!(usdc(&acct(ALICE)), alice0);
        assert_eq!(usdc(&incident_account()), 0);
    });
}

#[test]
fn resolve_uphold_slashes_the_challenger() {
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));
        let alice0 = usdc(&acct(ALICE));
        let bob0 = usdc(&acct(BOB));
        System::set_block_number(REG_WINDOW_BLOCKS as u64 + 2);
        // uphold=true ⇒ filing upheld; BOB (challenger) is the loser.
        assert_ok!(IncidentRegistry::resolve_challenge(
            signed(RESOLVER),
            5,
            0,
            true,
            H
        ));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Upheld
        ));
        let cs = REG_BOND_INCIDENT * 40 / 100;
        assert_eq!(usdc(&acct(ALICE)), alice0 + REG_BOND_INCIDENT + cs);
        assert_eq!(usdc(&acct(BOB)), bob0);
    });
}

#[test]
fn resolve_challenge_rejects_public_origin() {
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));
        // A signed non-authority cannot resolve a challenge (rule 6). Note the
        // block has not advanced: the origin check must win over SQ-294's window
        // and evidence checks, so a public caller never learns anything from them.
        assert_noop!(
            IncidentRegistry::resolve_challenge(signed(ALICE), 5, 0, false, H),
            sp_runtime::DispatchError::BadOrigin
        );
    });
}

#[test]
fn sq294_resolution_binds_the_challenge_committed_evidence_hash() {
    // 07 §7 terminal resolution. `(epoch, filing_id)` are two integers, so a
    // mis-parameterised governance verdict would otherwise slash the wrong
    // party's bond silently. Restating the committed hash makes that fail closed.
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));
        System::set_block_number(REG_WINDOW_BLOCKS as u64 + 2);
        let alice0 = usdc(&acct(ALICE));
        let bob0 = usdc(&acct(BOB));
        let escrow0 = usdc(&incident_account());
        assert!(escrow0 > 0, "both bonds must be custodied while challenged");

        let other: [u8; 32] = [7u8; 32];
        assert_noop!(
            IncidentRegistry::resolve_challenge(signed(RESOLVER), 5, 0, false, other),
            Error::<Test, IncidentInstance>::EvidenceMismatch
        );
        // Nothing moved and nothing resolved: the filing is still challenged and
        // both bonds are still custodied (G-1).
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).unwrap().state,
            FilingState::Challenged { .. }
        ));
        assert_eq!(usdc(&incident_account()), escrow0);
        assert_eq!(usdc(&acct(ALICE)), alice0);
        assert_eq!(usdc(&acct(BOB)), bob0);

        // The committed hash resolves it.
        assert_ok!(IncidentRegistry::resolve_challenge(
            signed(RESOLVER),
            5,
            0,
            false,
            H
        ));
        assert_eq!(usdc(&incident_account()), 0);
    });
}

#[test]
fn sq294_resolution_waits_for_the_counter_round_and_names_the_state_correctly() {
    // The `Challenged { window_end }` the state machine stores had no reader at
    // all before SQ-294, so a verdict could land in the same block the challenge
    // was filed. The `Filed`/terminal distinction was likewise collapsed into one
    // `WindowOpen`.
    new_test_ext().execute_with(|| {
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        // Unchallenged: there is no counter-round to resolve, and the filing's own
        // challenge window is genuinely still open.
        assert_noop!(
            IncidentRegistry::resolve_challenge(signed(RESOLVER), 5, 0, false, H),
            Error::<Test, IncidentInstance>::WindowOpen
        );

        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));
        // Same block as the challenge, and one block short of the deadline.
        assert_noop!(
            IncidentRegistry::resolve_challenge(signed(RESOLVER), 5, 0, false, H),
            Error::<Test, IncidentInstance>::WindowOpen
        );
        System::set_block_number(REG_WINDOW_BLOCKS as u64 + 1);
        assert_noop!(
            IncidentRegistry::resolve_challenge(signed(RESOLVER), 5, 0, false, H),
            Error::<Test, IncidentInstance>::WindowOpen
        );

        // Strictly after it, the verdict lands.
        System::set_block_number(REG_WINDOW_BLOCKS as u64 + 2);
        assert_ok!(IncidentRegistry::resolve_challenge(
            signed(RESOLVER),
            5,
            0,
            false,
            H
        ));
        // A terminal filing reports `AlreadyFinal`, not `WindowOpen`.
        assert_noop!(
            IncidentRegistry::resolve_challenge(signed(RESOLVER), 5, 0, false, H),
            Error::<Test, IncidentInstance>::AlreadyFinal
        );
    });
}

// --------------------------------------------------------- close / reap

#[test]
fn close_epoch_incident_aggregate_is_claimant_adverse_and_notifies_welfare() {
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        // One upheld S2 (severity 0.4) ⇒ max(0, 1 − 0.4) = 0.6.
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 3),
            Some(FixedU64(600_000_000))
        );
        assert_eq!(
            WelfareLog::get(),
            vec![(RegistryKind::Incident, 5, 3, 600_000_000)]
        );
        // The FilingCount slot is reaped so the live-epoch bound stays concurrent.
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 0);
        // Re-closing the **same version** is refused as already final. Before
        // SQ-141 this reported `NothingToClose`, because dropping the shared
        // count was the only "already closed" marker; the per-version aggregate
        // is now the marker, and it says the more precise thing — the epoch was
        // filed, and this version's record already exists. `NothingToClose`
        // still means what it says: nothing was ever filed here.
        assert_noop!(
            IncidentRegistry::close_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::AlreadyFinal
        );
        // An epoch with no filings and no aggregate at all is still refused, so
        // the anti-griefing guard the disjunction relaxed is intact.
        assert_noop!(
            IncidentRegistry::close_epoch(signed(BOB), 6, 3),
            Error::<Test, IncidentInstance>::NothingToClose
        );
    });
}

#[test]
fn close_epoch_requires_terminal_filings() {
    new_test_ext().execute_with(|| {
        set_filing_window_end(10);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        System::set_block_number(20); // past the filing window, filing still live
        assert_noop!(
            IncidentRegistry::close_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::WindowOpen
        );
    });
}

#[test]
fn reap_epoch_needs_close_out_then_the_archive_delay() {
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        // Cannot reap a not-yet-closed epoch.
        assert_noop!(
            IncidentRegistry::reap_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::ReapNotDue
        );
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        // Still not reapable until the archive delay elapses since close — so
        // welfare has consumed the aggregate before the records are destroyed.
        assert_noop!(
            IncidentRegistry::reap_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::ReapNotDue
        );
        System::set_block_number(CLOSE_BLOCK + ARCHIVE_DELAY + 1);
        assert_ok!(IncidentRegistry::reap_epoch(signed(BOB), 5, 3));
        assert!(Filings::<Test, IncidentInstance>::get(5, 0).is_none());
        assert!(Aggregates::<Test, IncidentInstance>::get(5, 3).is_none());
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

#[test]
fn reap_epoch_rebates_once_only_after_bounded_cleanup_succeeds() {
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        KeeperRebates::set(Vec::new());

        assert_noop!(
            IncidentRegistry::reap_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::ReapNotDue
        );
        assert!(KeeperRebates::get().is_empty());

        System::set_block_number(CLOSE_BLOCK + ARCHIVE_DELAY + 1);
        assert_ok!(IncidentRegistry::reap_epoch(signed(BOB), 5, 3));
        // 07 §7 *Crank funding lines* / 08 §6.3 (SQ-297): reaping is archival
        // cleanup, so it is rebated from the metered GENERAL tranche — not the
        // oracle budget line that funds `ack_observed` / `crank_close`.
        assert_eq!(KeeperRebates::get(), vec![(acct(BOB), CrankClass::General)]);
        assert_noop!(
            IncidentRegistry::reap_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::ReapNotDue
        );
        assert_eq!(KeeperRebates::get().len(), 1);
    });
}

#[test]
fn a_reaped_epoch_cannot_be_reclosed_to_the_favorable_value() {
    // Dual-review HIGH: a permissionless reap + reap-of-the-finality-marker let an
    // attacker erase an incident and re-close the empty epoch to the favorable
    // "no filings ⇒ 1" value. The archive-delay gate + the FilingCount-present
    // precondition close it.
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        // An S1 incident (severity 1.0) ⇒ aggregate 0 (maximally adverse).
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S1,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 3),
            Some(FixedU64(0))
        );
        System::set_block_number(CLOSE_BLOCK + ARCHIVE_DELAY + 1);
        assert_ok!(IncidentRegistry::reap_epoch(signed(BOB), 5, 3));
        // The replay: re-close the now-empty epoch → refused (no FilingCount).
        assert_noop!(
            IncidentRegistry::close_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::NothingToClose
        );
        // Welfare was notified exactly once, with the real adverse value.
        assert_eq!(WelfareLog::get(), vec![(RegistryKind::Incident, 5, 3, 0)]);
    });
}

#[test]
fn close_epoch_refuses_an_unfiled_epoch() {
    new_test_ext().execute_with(|| {
        set_filing_window_end(10);
        System::set_block_number(20);
        // Never filed ⇒ nothing to close (welfare's pull-side "no record ⇒ 1"
        // handles genuinely-empty epochs; a permissionless empty close would grief).
        assert_noop!(
            IncidentRegistry::close_epoch(signed(BOB), 9, 3),
            Error::<Test, IncidentInstance>::NothingToClose
        );
    });
}

#[test]
fn close_epoch_rolls_back_when_welfare_refuses() {
    // G-1: a refusing welfare sink must roll the whole close back — no aggregate,
    // no ClosedAt, FilingCount still live, no welfare log entry — so registry and
    // welfare never silently disagree (dual-review re-pass minor).
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        WelfareFails::set(true);
        assert!(IncidentRegistry::close_epoch(signed(BOB), 5, 3).is_err());
        // Fully rolled back.
        assert!(Aggregates::<Test, IncidentInstance>::get(5, 3).is_none());
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 1);
        assert!(WelfareLog::get().is_empty());
        // With welfare healthy the same close succeeds.
        WelfareFails::set(false);
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 3),
            Some(FixedU64(600_000_000))
        );
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

#[test]
fn acks_are_capped_at_quorum() {
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        register_watchtower(WT3);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        // Quorum reached — a third distinct watchtower's ack is refused, so the
        // per-filing ack set stays bounded.
        assert_noop!(
            IncidentRegistry::ack_observed(signed(WT3), 5, 0),
            Error::<Test, IncidentInstance>::AlreadyQuorum
        );
    });
}

#[test]
fn ack_on_a_challenged_filing_is_rejected() {
    // PR #54 Codex-bot P2: once a filing is challenged, 07 §4's "a challenge
    // supersedes the quorum requirement" makes acks moot — they must be rejected,
    // not recorded, or the `Challenged` state (which has no ack cap) would grow
    // `AckRecords` past the per-filing `WT_QUORUM` bound `do_try_state` and
    // `reap_epoch`'s bounded reap assume.
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        register_watchtower(WT3);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::challenge_filing(signed(BOB), 5, 0, H));
        // No registered watchtower can ack a challenged filing — the ack set never
        // grows, however many watchtowers try.
        assert_noop!(
            IncidentRegistry::ack_observed(signed(WT1), 5, 0),
            Error::<Test, IncidentInstance>::AlreadyChallenged
        );
        assert_noop!(
            IncidentRegistry::ack_observed(signed(WT3), 5, 0),
            Error::<Test, IncidentInstance>::AlreadyChallenged
        );
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

// --------------------------------------------------------- milestone instance

#[test]
fn milestone_instance_is_independent_and_scores_points_over_target() {
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        // A milestone filing and an incident filing for the same epoch are
        // separate storage (distinct instances).
        assert_ok!(MilestoneRegistry::file(
            signed(ALICE),
            3,
            FilingClass::Scope(1),
            25,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::file(
            signed(BOB),
            3,
            FilingClass::S1,
            0,
            H,
            VER
        ));
        assert!(Filings::<Test, MilestoneInstance>::get(3, 0).is_some());
        assert!(Filings::<Test, IncidentInstance>::get(3, 0).is_some());
        // Milestone bond is the smaller reg.bond_milestone.
        assert_eq!(
            Filings::<Test, MilestoneInstance>::get(3, 0).unwrap().bond,
            REG_BOND_MILESTONE
        );
        assert_ok!(MilestoneRegistry::ack_observed(signed(WT1), 3, 0));
        assert_ok!(MilestoneRegistry::ack_observed(signed(WT2), 3, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(MilestoneRegistry::crank_close(
            signed(CHARLIE),
            3,
            REG_CLOSE_BATCH as u32
        ));
        assert_ok!(MilestoneRegistry::close_epoch(signed(CHARLIE), 3, 3));
        // points 25 / target 100 = 0.25.
        assert_eq!(
            Aggregates::<Test, MilestoneInstance>::get(3, 3),
            Some(FixedU64(250_000_000))
        );
        assert_eq!(
            WelfareLog::get(),
            vec![(RegistryKind::Milestone, 3, 3, 250_000_000)]
        );
        // The incident instance's epoch 3 is untouched by the milestone close.
        assert!(Aggregates::<Test, IncidentInstance>::get(3, 3).is_none());
    });
}

#[test]
fn milestone_rejects_incident_class() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            MilestoneRegistry::file(signed(ALICE), 3, FilingClass::S1, 5, H, VER),
            Error::<Test, MilestoneInstance>::InvalidClass
        );
    });
}

/// Helper: file `points`, quorum-uphold, and close milestone epoch 3, returning
/// the derived aggregate.
fn milestone_close_with_points(points: u16) -> FixedU64 {
    register_watchtower(WT1);
    register_watchtower(WT2);
    assert_ok!(MilestoneRegistry::file(
        signed(ALICE),
        3,
        FilingClass::Scope(1),
        points,
        H,
        VER
    ));
    assert_ok!(MilestoneRegistry::ack_observed(signed(WT1), 3, 0));
    assert_ok!(MilestoneRegistry::ack_observed(signed(WT2), 3, 0));
    System::set_block_number(CLOSE_BLOCK);
    assert_ok!(MilestoneRegistry::crank_close(
        signed(BOB),
        3,
        REG_CLOSE_BATCH as u32
    ));
    assert_ok!(MilestoneRegistry::close_epoch(signed(BOB), 3, 3));
    Aggregates::<Test, MilestoneInstance>::get(3, 3).unwrap()
}

#[test]
fn milestone_target_is_a_seam_not_a_hardcode() {
    new_test_ext().execute_with(|| {
        // Divisor comes from the frozen-MetricSpec seam (I-16), not the core's
        // default 100: target 50 ⇒ 25 / 50 = 0.5.
        MilestoneTarget::set(50);
        assert_eq!(milestone_close_with_points(25), FixedU64(500_000_000));
    });
}

#[test]
fn milestone_over_ship_clamps_to_one() {
    new_test_ext().execute_with(|| {
        // 65_535 / 100 = 655.35 would violate the welfare component's [0,1] range;
        // the aggregate is clamped to 1.0 (dual-review HIGH).
        assert_eq!(
            milestone_close_with_points(u16::MAX),
            FixedU64(1_000_000_000)
        );
    });
}

// --------------------------------------- milestone normalization (07 §7)

#[test]
fn a_zero_milestone_target_refuses_the_close_instead_of_recording_zero() {
    // 07 §7 *Milestone normalization* (SQ-291): a zero or absent frozen-MetricSpec
    // `target` MUST NOT be normalized to an aggregate of 0 — that records a
    // fail-*adverse* A-pillar component as if it were a real measurement. The
    // close refuses; welfare then sees no record at all, not a fabricated 0.0.
    new_test_ext().execute_with(|| {
        register_watchtower(WT1);
        register_watchtower(WT2);
        assert_ok!(MilestoneRegistry::file(
            signed(ALICE),
            3,
            FilingClass::Scope(1),
            25,
            H,
            VER
        ));
        assert_ok!(MilestoneRegistry::ack_observed(signed(WT1), 3, 0));
        assert_ok!(MilestoneRegistry::ack_observed(signed(WT2), 3, 0));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(MilestoneRegistry::crank_close(
            signed(BOB),
            3,
            REG_CLOSE_BATCH as u32
        ));
        WelfareLog::set(Vec::new());

        // The frozen MetricSpec carries no positive target at close time.
        MilestoneTarget::set(0);
        assert_noop!(
            MilestoneRegistry::close_epoch(signed(BOB), 3, 3),
            Error::<Test, MilestoneInstance>::MilestoneTargetUnset
        );
        // Status quo on the failure path (G-1): no aggregate, no welfare
        // hand-off, no close stamp — so the archive gate keeps the records too.
        assert!(Aggregates::<Test, MilestoneInstance>::get(3, 3).is_none());
        assert!(WelfareLog::get().is_empty());
        assert_eq!(FilingCount::<Test, MilestoneInstance>::get(3), 1);
        assert!(Filings::<Test, MilestoneInstance>::get(3, 0).is_some());
        System::set_block_number(CLOSE_BLOCK + ARCHIVE_DELAY + 1);
        assert_noop!(
            MilestoneRegistry::reap_epoch(signed(BOB), 3, 3),
            Error::<Test, MilestoneInstance>::ReapNotDue
        );
        assert_ok!(MilestoneRegistry::do_try_state());

        // The refusal is not terminal: a spec that carries the field again closes
        // to the real measurement (25 / 100 = 0.25), never to 0.0.
        MilestoneTarget::set(100);
        assert_ok!(MilestoneRegistry::close_epoch(signed(BOB), 3, 3));
        assert_eq!(
            Aggregates::<Test, MilestoneInstance>::get(3, 3),
            Some(FixedU64(250_000_000))
        );
        assert_eq!(
            WelfareLog::get(),
            vec![(RegistryKind::Milestone, 3, 3, 250_000_000)]
        );
    });
}

#[test]
fn a_zero_milestone_target_refuses_the_filing_at_the_door() {
    // 07 §7 *Milestone normalization*: "until the MetricSpec surface carries the
    // field no milestone component may be admitted". Admitting a filing whose
    // epoch can never close would escrow a bond into an epoch that holds its
    // `FilingCount` slot forever (close refuses ⇒ no `ClosedAt` ⇒ no reap),
    // wedging the instance at `MAX_LIVE_EPOCHS`.
    new_test_ext().execute_with(|| {
        MilestoneTarget::set(0);
        let before = usdc(&acct(ALICE));
        assert_noop!(
            MilestoneRegistry::file(signed(ALICE), 3, FilingClass::Scope(1), 25, H, VER),
            Error::<Test, MilestoneInstance>::MilestoneTargetUnset
        );
        assert_eq!(usdc(&acct(ALICE)), before);
        assert_eq!(FilingCount::<Test, MilestoneInstance>::get(3), 0);
        assert!(Filings::<Test, MilestoneInstance>::get(3, 0).is_none());
        // The Incident instance never divides by a target and is unaffected.
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            3,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(MilestoneRegistry::do_try_state());
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

// ------------------------------------- fixed windows and quorum (07 §7)

#[test]
fn registry_windows_do_not_track_a_raised_orc_window() {
    // limit-coverage: orc.window
    // 07 §7 *Fixed windows and quorum* (SQ-290): the registry pins the kernel
    // floor `REG_WINDOW_BLOCKS` (72 h) as a fixed constant. Unlike the §5 oracle
    // game — which reads live `orc.window` and therefore tracks a META raise to
    // ≤ 120 h (see `pallet-oracle`'s `challenge_window_is_half_open_at_the_deadline`)
    // — both registry instances stay at 72 h after such an amendment. The
    // divergence is deliberate, so this test fails loudly if a refactor ever
    // points the registry at the live value.
    new_test_ext().execute_with(|| {
        // A META amendment raises `orc.window` 72 h → 120 h (07 §14).
        LiveOrcWindow::set(REG_WINDOW_BLOCKS + REG_EXT_WINDOW_BLOCKS);
        assert!(LiveOrcWindow::get() > REG_WINDOW_BLOCKS);

        System::set_block_number(7);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        // The stored deadline is the kernel floor, not the raised live value.
        let window_end = Filings::<Test, IncidentInstance>::get(5, 0).and_then(|f| match f.state {
            FilingState::Filed { window_end, .. } => Some(window_end),
            _ => None,
        });
        assert_eq!(window_end, Some(7 + REG_WINDOW_BLOCKS));
        assert_ne!(window_end, Some(7 + LiveOrcWindow::get()));

        // One block past the kernel deadline the challenge surface is shut —
        // proving the window did not stretch to the amended `orc.window`.
        System::set_block_number(u64::from(REG_WINDOW_BLOCKS) + 8);
        assert_noop!(
            IncidentRegistry::challenge_filing(signed(CHARLIE), 5, 0, H),
            Error::<Test, IncidentInstance>::WindowClosed
        );
        // The same block is already mature for the close crank (the crank closes
        // strictly after the deadline), so no challenge can race it.
        register_watchtower(WT1);
        register_watchtower(WT2);
        assert_noop!(
            IncidentRegistry::ack_observed(signed(WT1), 5, 0),
            Error::<Test, IncidentInstance>::WindowClosed
        );
        assert_ok!(IncidentRegistry::do_try_state());

        // The Milestone instance is pinned identically.
        System::set_block_number(9);
        assert_ok!(MilestoneRegistry::file(
            signed(ALICE),
            6,
            FilingClass::Scope(1),
            10,
            H,
            VER
        ));
        let milestone_end =
            Filings::<Test, MilestoneInstance>::get(6, 0).and_then(|f| match f.state {
                FilingState::Filed { window_end, .. } => Some(window_end),
                _ => None,
            });
        assert_eq!(milestone_end, Some(9 + REG_WINDOW_BLOCKS));
    });
}

#[test]
fn registry_quorum_does_not_track_a_raised_wt_quorum() {
    // 07 §7 *Fixed windows and quorum* (SQ-290): the registry pins `WT_QUORUM = 2`
    // as the kernel floor. A META raise moves the oracle's §4 quorum, never the
    // registry's — unchallenged closure still upholds at two acknowledgments, and
    // the third is refused (`AlreadyQuorum`) so the per-filing ack set stays
    // bounded. `wt.quorum` is classed `param-bounds`, so this pin carries no
    // limit-coverage marker; the amendment-bounds path is the generated suite's.
    new_test_ext().execute_with(|| {
        // A META amendment raises `wt.quorum` 2 → 3 (07 §14).
        LiveWtQuorum::set(WT_QUORUM + 1);
        assert!(LiveWtQuorum::get() > WT_QUORUM);

        register_watchtower(WT1);
        register_watchtower(WT2);
        register_watchtower(WT3);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            VER
        ));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT1), 5, 0));
        assert_ok!(IncidentRegistry::ack_observed(signed(WT2), 5, 0));
        // Quorum is the kernel floor: a third acknowledgment adds nothing and is
        // refused, rather than being counted toward the raised live value.
        assert_noop!(
            IncidentRegistry::ack_observed(signed(WT3), 5, 0),
            Error::<Test, IncidentInstance>::AlreadyQuorum
        );
        let acks = Filings::<Test, IncidentInstance>::get(5, 0).and_then(|f| match f.state {
            FilingState::Filed { acks, .. } => Some(acks),
            _ => None,
        });
        assert_eq!(acks, Some(WT_QUORUM));

        // Two acknowledgments still satisfy unchallenged closure: the filing is
        // upheld with no 48 h quorum-failure extension, exactly as at the floor.
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert!(matches!(
            Filings::<Test, IncidentInstance>::get(5, 0).map(|f| f.state),
            Some(FilingState::Upheld)
        ));
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

// ------------------------------------------- SQ-141: per-version lifecycle

/// 07 §7 (contract v14): at a MetricSpec activation boundary two cohorts measure
/// the same epoch under **different** frozen versions, and the registry runs an
/// independent lifecycle per version.
///
/// The pre-SQ-141 seam collapsed a multi-version epoch to "no unique version"
/// and turned that into `SpecVersionMismatch`, so an activation boundary refused
/// **every** filing for the epoch — including one naming a version that was
/// unambiguously frozen. This is the closed→open transition 07 §7 requires be
/// pinned rather than inferred.
#[test]
fn sq141_an_activation_boundary_admits_a_filing_under_either_frozen_version() {
    new_test_ext().execute_with(|| {
        FrozenSpecs::set(vec![3, 4]);
        // Both versions are admissible; neither shadows the other.
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            3
        ));
        assert_ok!(IncidentRegistry::file(
            signed(BOB),
            5,
            FilingClass::S1,
            0,
            H,
            4
        ));
        // A version no cohort froze is still refused — the gate is membership,
        // not absence of a gate.
        assert_noop!(
            IncidentRegistry::file(signed(ALICE), 5, FilingClass::S3, 0, H, 5),
            Error::<Test, IncidentInstance>::SpecVersionMismatch
        );
        // Filing ids stay unique across versions, which is what keeps the ten
        // 02 §6 filing events (keyed `(epoch, filing_id)`) untouched by the
        // re-key.
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 2);
        assert_eq!(
            Filings::<Test, IncidentInstance>::get(5, 0)
                .unwrap()
                .spec_version,
            3
        );
        assert_eq!(
            Filings::<Test, IncidentInstance>::get(5, 1)
                .unwrap()
                .spec_version,
            4
        );
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

/// Each version folds **only its own** filings, and one version's close neither
/// produces nor blocks the other's aggregate. Folding them together would
/// combine claims governed by different frozen specs (G-1).
#[test]
fn sq141_each_version_closes_to_its_own_aggregate() {
    new_test_ext().execute_with(|| {
        FrozenSpecs::set(vec![3, 4]);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            3
        ));
        assert_ok!(IncidentRegistry::file(
            signed(BOB),
            5,
            FilingClass::S1,
            0,
            H,
            4
        ));
        for wt in [WT1, WT2] {
            register_watchtower(wt);
            assert_ok!(IncidentRegistry::ack_observed(signed(wt), 5, 0));
            assert_ok!(IncidentRegistry::ack_observed(signed(wt), 5, 1));
        }
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        // v3 carries one upheld S2 (0.4) ⇒ 0.6; v4 one upheld S1 (1.0) ⇒ 0.0.
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 3),
            Some(FixedU64(600_000_000))
        );
        // The sibling has no aggregate yet — a welfare read for v4 here must
        // find nothing rather than inherit v3's number.
        assert_eq!(Aggregates::<Test, IncidentInstance>::get(5, 4), None);
        // ...and it can still be closed, even though the first close dropped the
        // epoch-wide FilingCount that the anti-griefing guard used to require.
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 0);
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 4));
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 4),
            Some(FixedU64(0))
        );
        assert_eq!(
            WelfareLog::get(),
            vec![
                (RegistryKind::Incident, 5, 3, 600_000_000),
                (RegistryKind::Incident, 5, 4, 0),
            ]
        );
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

/// Reaping one version must not destroy the sibling's records. The durable ack
/// set is keyed `(epoch, filing_id, who)` and carries no version, so a
/// whole-prefix clear — correct while an epoch closed once — would now wipe live
/// acks belonging to a version that has not been reaped.
#[test]
fn sq141_reaping_one_version_leaves_the_sibling_intact() {
    new_test_ext().execute_with(|| {
        FrozenSpecs::set(vec![3, 4]);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            3
        ));
        assert_ok!(IncidentRegistry::file(
            signed(BOB),
            5,
            FilingClass::S1,
            0,
            H,
            4
        ));
        for wt in [WT1, WT2] {
            register_watchtower(wt);
            assert_ok!(IncidentRegistry::ack_observed(signed(wt), 5, 0));
            assert_ok!(IncidentRegistry::ack_observed(signed(wt), 5, 1));
        }
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 4));
        System::set_block_number(CLOSE_BLOCK + ARCHIVE_DELAY);
        assert_ok!(IncidentRegistry::reap_epoch(signed(BOB), 5, 3));
        // v3 is gone; v4's filing, ack rows and aggregate all survive.
        assert!(Filings::<Test, IncidentInstance>::get(5, 0).is_none());
        assert!(Filings::<Test, IncidentInstance>::get(5, 1).is_some());
        assert_eq!(Aggregates::<Test, IncidentInstance>::get(5, 3), None);
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 4),
            Some(FixedU64(0))
        );
        assert!(
            crate::AckRecords::<Test, IncidentInstance>::iter_key_prefix((5u32, 1u32))
                .next()
                .is_some()
        );
        assert!(
            crate::AckRecords::<Test, IncidentInstance>::iter_key_prefix((5u32, 0u32))
                .next()
                .is_none()
        );
        assert_ok!(IncidentRegistry::do_try_state());
        // Reaping the last version clears the epoch entirely, and a re-close is
        // then refused as never-filed rather than admitted to the favourable
        // "no filings ⇒ 1" value.
        assert_ok!(IncidentRegistry::reap_epoch(signed(BOB), 5, 4));
        assert_noop!(
            IncidentRegistry::close_epoch(signed(BOB), 5, 4),
            Error::<Test, IncidentInstance>::NothingToClose
        );
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

/// A version MUST NOT be reaped while a sibling version of the same epoch still
/// holds unclosed records.
///
/// Found by an independent review of the SQ-141 re-key, and it is a hole the
/// re-key itself opened. `close_epoch` drops the epoch-wide `FilingCount` on the
/// **first** close, so afterwards the only evidence the epoch was ever filed is
/// its aggregates. Reaping the first version while a second still holds a
/// non-terminal filing erases that evidence, and the damage runs both ways: the
/// sibling becomes permanently uncloseable (`NothingToClose`), and welfare's
/// reader — seeing no footprint at all — reads the epoch as never-filed and
/// returns the favourable neutral 1.0 for a version whose incident filings are
/// still in storage. That is the exact fail-adverse substitution the fail-closed
/// reader exists to prevent, reached through a different door.
#[test]
fn sq141_a_version_cannot_be_reaped_while_a_sibling_is_still_open() {
    new_test_ext().execute_with(|| {
        FrozenSpecs::set(vec![3, 4]);
        assert_ok!(IncidentRegistry::file(
            signed(ALICE),
            5,
            FilingClass::S2,
            0,
            H,
            3
        ));
        assert_ok!(IncidentRegistry::file(
            signed(BOB),
            5,
            FilingClass::S1,
            0,
            H,
            4
        ));
        for wt in [WT1, WT2] {
            register_watchtower(wt);
            assert_ok!(IncidentRegistry::ack_observed(signed(wt), 5, 0));
        }
        // Filing 1 (version 4) is challenged, so it stays non-terminal until a
        // values verdict arrives — the realistic way a sibling stays open.
        assert_ok!(IncidentRegistry::challenge_filing(signed(CHARLIE), 5, 1, H));
        System::set_block_number(CLOSE_BLOCK);
        assert_ok!(IncidentRegistry::crank_close(
            signed(BOB),
            5,
            REG_CLOSE_BATCH as u32
        ));
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        assert_eq!(FilingCount::<Test, IncidentInstance>::get(5), 0);
        // The intermediate state is legitimate and must satisfy try-state:
        // version 4's filing is neither counted-live (the shared count went with
        // version 3's close) nor closed. The pre-SQ-141 partition had only those
        // two states, so it reads this as an orphan.
        assert_ok!(IncidentRegistry::do_try_state());
        System::set_block_number(CLOSE_BLOCK + ARCHIVE_DELAY);
        // Version 4 has no aggregate and still holds a filing, so version 3's
        // archive delay elapsing is not enough.
        assert_noop!(
            IncidentRegistry::reap_epoch(signed(BOB), 5, 3),
            Error::<Test, IncidentInstance>::ReapNotDue
        );
        // Version 3's aggregate therefore survives, which is what keeps the
        // sibling closeable and keeps the epoch legible to welfare.
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 3),
            Some(FixedU64(600_000_000))
        );
        // Resolve the challenge and close version 4; only then may version 3 go.
        assert_ok!(IncidentRegistry::resolve_challenge(
            RuntimeOrigin::signed(acct(RESOLVER)),
            5,
            1,
            true,
            H
        ));
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 4));
        assert_ok!(IncidentRegistry::reap_epoch(signed(BOB), 5, 3));
        assert_ok!(IncidentRegistry::do_try_state());
    });
}

/// `close_epoch` must refuse a version the epoch never froze.
///
/// Codex review of PR #173, and the attack is specific to the versioned
/// lifecycle: once an epoch has any filing and its window ends, the per-version
/// filing filter is empty for *any* unfrozen version number, so the fold records
/// the neutral "no filings ⇒ 1" aggregate for it. Each bogus close consumes one
/// of the eight `MAX_AGGREGATES` slots **and** satisfies the `NothingToClose`
/// disjunct for the next, so a signed caller could fill the map and make the
/// legitimate version's close fail `TooManyAggregates` — permanently, since
/// nothing reaps an aggregate whose epoch never closes.
#[test]
fn sq141_close_refuses_a_version_the_epoch_never_froze() {
    new_test_ext().execute_with(|| {
        FrozenSpecs::set(vec![3]);
        // Two epochs filed under version 3 while the filing window is open.
        for epoch in [5, 6] {
            assert_ok!(IncidentRegistry::file(
                signed(ALICE),
                epoch,
                FilingClass::S2,
                0,
                H,
                3
            ));
        }
        for wt in [WT1, WT2] {
            register_watchtower(wt);
            assert_ok!(IncidentRegistry::ack_observed(signed(wt), 5, 0));
            assert_ok!(IncidentRegistry::ack_observed(signed(wt), 6, 0));
        }
        System::set_block_number(CLOSE_BLOCK);
        for epoch in [5, 6] {
            assert_ok!(IncidentRegistry::crank_close(
                signed(BOB),
                epoch,
                REG_CLOSE_BATCH as u32
            ));
        }
        // The griefing close: version 999 was never frozen and holds no filings.
        assert_noop!(
            IncidentRegistry::close_epoch(signed(CHARLIE), 5, 999),
            Error::<Test, IncidentInstance>::SpecVersionMismatch
        );
        assert!(!Aggregates::<Test, IncidentInstance>::contains_key(5, 999));
        // The legitimate version still closes, and the slot budget is intact.
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 5, 3));
        assert_eq!(
            Aggregates::<Test, IncidentInstance>::get(5, 3),
            Some(FixedU64(600_000_000))
        );
        // A late close stays legal for a version that still holds filings even
        // after its cohorts settle and the frozen set is pruned out from under
        // it — otherwise its records could never be reaped.
        FrozenSpecs::set(vec![]);
        assert_noop!(
            IncidentRegistry::close_epoch(signed(BOB), 6, 4),
            Error::<Test, IncidentInstance>::SpecVersionMismatch
        );
        assert_ok!(IncidentRegistry::close_epoch(signed(BOB), 6, 3));
        assert_ok!(IncidentRegistry::do_try_state());
    });
}
