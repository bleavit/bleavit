//! Mock-runtime tests for `pallet-oracle` (15 §4.1): every extrinsic × every
//! error path × origin misuse, limit/boundary coverage, and `try_state`
//! assertions. Behavior is asserted against the **spec** (07 §3–§13, 02 §7.2)
//! and the reviewed `oracle-core` state machine (the differential oracle — the
//! shell's job is to reproduce it), never against incidental implementation.
//!
//! Numeric bond/stake expectations are derived from the core's `round_bond`
//! (the 07 §6.1 formula) and the 13-default core constants, never hand-computed
//! (15 §4.4). Each test is named after the obligation it discharges so coverage
//! against 15 §4.1 stays auditable.

use crate::mock::*;
use crate::pallet::{
    ComponentValues, MoneySettled, Recomputable, Reporters, ReserveHealth, ReserveProbeArmed,
    RoundActivity, RoundSchedules, Rounds, WatchtowerActive, Watchtowers,
};
use crate::{Error, Event};
use frame_support::traits::{ConstU32, StorageVersion};
use frame_support::{assert_noop, assert_ok, pallet_prelude::DispatchResult, BoundedVec};
use futarchy_primitives::{
    Balance, BlockNumber, EpochId, FixedU64, MetricId, MetricSpecVersion, H256,
};
use oracle_core::{
    hash_evidence, hash_report, round_bond, OracleParams, RoundState, SettlePath, SettledComponent,
    StoredRoundSchedule, COMPONENT_VALUE_MAX, COMPONENT_VALUE_REAP_BATCH, ORC_EXT_WINDOW_BLOCKS,
    ORC_REPORTER_STAKE, ORC_ROUNDS, ORC_WINDOW_BLOCKS, RES_PROBE_INTERVAL, RES_PROBE_TIMEOUT,
    WT_STAKE,
};
use parity_scale_codec::{Compact, Decode, Encode};
use sp_runtime::DispatchError;

// ------------------------------------------------------------- fixtures ----

/// The canonical game key, mirroring the 07 §5 worked example
/// ("integrations value 0.62 for epoch 41") and the core's own tests. `V`
/// is in the mock `ExpectedSpecs` default set so `report` accepts it.
const C: MetricId = 7;
const E: EpochId = 41;
const V: MetricSpecVersion = 3;

/// A 32-byte evidence/report hash.
fn h(n: u8) -> H256 {
    [n; 32]
}

/// The raw `[u8; 32]` a signed account collapses to inside the core (the
/// `RoundState.reporter` field is `oracle_core::AccountId`, not `T::AccountId`).
fn raw(n: u8) -> [u8; 32] {
    [n; 32]
}

/// Reported value 0.62 on the 05 §4.4 1e9 component grid (07 §5 example).
fn reported_value() -> FixedU64 {
    FixedU64(620_000_000)
}

/// Challenger counter-value 0.44 on the grid (07 §5 example).
fn counter_value() -> FixedU64 {
    FixedU64(440_000_000)
}

/// The value-scaled round-`r` bond for the mock's `StakeAtRisk` (07 §6.1), read
/// from the core formula so the expectation tracks 13 rather than a literal.
fn bond(round: u8) -> Balance {
    round_bond(StakeAtRiskValue::get(), round, &ParamsValue::get()).expect("round in 1..=R_max")
}

/// The `recompute_proof` argument type — its `ConstU32` bound is exactly
/// `orc.max_proof_bytes` (07 §9), so `ProofTooLarge` is unreachable via the
/// extrinsic and the boundary is enforced by SCALE decoding of the arg itself.
type ProofArg = BoundedVec<u8, ConstU32<{ crate::MAX_PROOF_BYTES_BOUND }>>;

fn proof_arg(bytes: Vec<u8>) -> ProofArg {
    ProofArg::try_from(bytes).expect("proof within orc.max_proof_bytes")
}

/// A committed-evidence payload whose first eight LE bytes decode to `value`
/// (the `oracle-core` recompute stand-in, 07 §9).
fn proof_for(value: FixedU64) -> Vec<u8> {
    let mut proof = vec![0u8; 24];
    proof[..8].copy_from_slice(&value.0.to_le_bytes());
    proof
}

/// Oracle events deposited since the last `reset_events`, in order.
fn oracle_events() -> Vec<Event<Test>> {
    System::events()
        .into_iter()
        .filter_map(|record| match record.event {
            RuntimeEvent::Oracle(e) => Some(e),
            _ => None,
        })
        .collect()
}

fn register_reporter(n: u8) {
    assert_ok!(Oracle::register_reporter(RuntimeOrigin::signed(acc(n))));
}

fn register_watchtower(n: u8) {
    assert_ok!(Oracle::register_watchtower(RuntimeOrigin::signed(acc(n))));
}

/// Post a report for `(C, epoch, V)` from account `reporter`.
fn do_report(reporter: u8, epoch: EpochId, value: FixedU64, evidence: H256) -> DispatchResult {
    Oracle::report(
        RuntimeOrigin::signed(acc(reporter)),
        C,
        epoch,
        V,
        value,
        evidence,
    )
}

/// Report `(C, epoch, V)` with recomputable evidence and settle it `Recomputed`
/// at `reported_value()` — the cheapest "just needs to be final" settle (07 §9,
/// no watchtowers/crank). Used where the F10 reconciliation replaces an
/// `adjudicate` that only served as a settlement shortcut.
fn settle_recomputed(reporter: u8, epoch: EpochId) {
    assert_ok!(Oracle::note_recomputable(C, V));
    let proof = proof_for(reported_value());
    assert_ok!(Oracle::report(
        RuntimeOrigin::signed(acc(reporter)),
        C,
        epoch,
        V,
        reported_value(),
        hash_evidence(&proof)
    ));
    assert_ok!(Oracle::recompute_proof(
        RuntimeOrigin::signed(acc(reporter)),
        C,
        epoch,
        V,
        proof_arg(proof)
    ));
}

/// Escalate a fresh game for `(C, epoch, V)` to a terminal round-`R_max` dispute
/// carrying a live challenger, so `adjudicate` is admissible (07 §5.3/§5.4;
/// Codex F10). Windows are half-open: challenge at `< deadline`, crank matures at
/// `>= deadline`. Leaves the block at the terminal round's `deadline - 1`.
fn escalate_to_terminal(reporter: u8, challenger: u8, epoch: EpochId) {
    assert_ok!(Oracle::report(
        RuntimeOrigin::signed(acc(reporter)),
        C,
        epoch,
        V,
        reported_value(),
        h(9)
    ));
    for _ in 1..ORC_ROUNDS {
        let d = Rounds::<Test>::get((C, epoch, V))
            .unwrap()
            .challenge_deadline;
        set_block(d - 1);
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(challenger)),
            C,
            epoch,
            V,
            counter_value(),
            h(10)
        ));
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(reporter)),
            C,
            epoch,
            V,
            counter_value(),
            h(11)
        ));
    }
    // The terminal-round challenge that makes the game adjudicable.
    let d = Rounds::<Test>::get((C, epoch, V))
        .unwrap()
        .challenge_deadline;
    set_block(d - 1);
    assert_ok!(Oracle::challenge(
        RuntimeOrigin::signed(acc(challenger)),
        C,
        epoch,
        V,
        counter_value(),
        h(10)
    ));
}

// =========================================================================
// 1. Registries (07 §3 reporters, §4 watchtowers; 02 §7.2 counted maps)
// =========================================================================

#[test]
fn register_reporter_happy_path_emits_and_counts() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_eq!(Reporters::<Test>::count(), 1);
        assert_eq!(
            Reporters::<Test>::get(acc(1)).unwrap().stake,
            ORC_REPORTER_STAKE
        );
        assert_eq!(Reporters::<Test>::get(acc(1)).unwrap().offenses, 0);
        System::assert_has_event(
            Event::ReporterRegistered {
                who: acc(1),
                stake: ORC_REPORTER_STAKE,
            }
            .into(),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn register_reporter_duplicate_is_already_registered() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_noop!(
            Oracle::register_reporter(RuntimeOrigin::signed(acc(1))),
            Error::<Test>::AlreadyRegistered
        );
        assert_eq!(Reporters::<Test>::count(), 1);
    });
}

#[test]
fn register_reporter_fills_to_bound_then_rejects() {
    // 02 §7.2 / core `MAX_REPORTERS = 64`: the 64 seats fill, the 65th is
    // rejected (I-21 bounded-by-construction), and `try_state` still holds.
    new_test_ext().execute_with(|| {
        for n in 1..=64u8 {
            register_reporter(n);
        }
        assert_eq!(Reporters::<Test>::count(), 64);
        assert_noop!(
            Oracle::register_reporter(RuntimeOrigin::signed(acc(65))),
            Error::<Test>::TooManyReporters
        );
        assert_eq!(Reporters::<Test>::count(), 64);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn register_watchtower_happy_path_emits_and_counts() {
    new_test_ext().execute_with(|| {
        register_watchtower(1);
        assert_eq!(Watchtowers::<Test>::count(), 1);
        assert_eq!(Watchtowers::<Test>::get(acc(1)).unwrap().stake, WT_STAKE);
        System::assert_has_event(
            Event::WatchtowerRegistered {
                who: acc(1),
                stake: WT_STAKE,
            }
            .into(),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn registration_stake_snapshots_follow_live_params_for_new_seats() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);

        let mut amended = ParamsValue::get();
        amended.reporter_stake = ORC_REPORTER_STAKE.saturating_add(1_000_000);
        amended.watchtower_stake = WT_STAKE.saturating_add(2_000_000);
        ParamsValue::set(amended);
        register_reporter(3);
        register_watchtower(4);

        // Existing registrations keep their creation-time stake snapshot.
        assert_eq!(
            Reporters::<Test>::get(acc(1)).map(|info| info.stake),
            Some(ORC_REPORTER_STAKE)
        );
        assert_eq!(
            Watchtowers::<Test>::get(acc(2)).map(|info| info.stake),
            Some(WT_STAKE)
        );
        // New registrations observe the amended live thresholds.
        assert_eq!(
            Reporters::<Test>::get(acc(3)).map(|info| info.stake),
            Some(amended.reporter_stake)
        );
        assert_eq!(
            Watchtowers::<Test>::get(acc(4)).map(|info| info.stake),
            Some(amended.watchtower_stake)
        );
    });
}

#[test]
fn register_watchtower_duplicate_is_already_registered() {
    new_test_ext().execute_with(|| {
        register_watchtower(1);
        assert_noop!(
            Oracle::register_watchtower(RuntimeOrigin::signed(acc(1))),
            Error::<Test>::AlreadyRegistered
        );
    });
}

#[test]
fn register_watchtower_fills_to_bound_then_rejects() {
    // limit-coverage: wt.max
    // 07 §4 `wt.max = 16` seats: the 16 fill, the 17th is rejected.
    new_test_ext().execute_with(|| {
        for n in 1..=16u8 {
            register_watchtower(n);
        }
        assert_eq!(Watchtowers::<Test>::count(), 16);
        assert_noop!(
            Oracle::register_watchtower(RuntimeOrigin::signed(acc(17))),
            Error::<Test>::TooManyWatchtowers
        );
        assert_eq!(Watchtowers::<Test>::count(), 16);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn live_round_bound_rejects_the_129th_game() {
    // limit-coverage: Oracle games (live rounds)
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let template = Rounds::<Test>::get((C, E, V)).expect("first round exists");
        let schedule = RoundSchedules::<Test>::get((C, E, V)).expect("first schedule exists");
        let mut epoch = 100u32;
        while Rounds::<Test>::iter().count() < oracle_core::MAX_ROUNDS {
            let mut round = template;
            round.epoch = epoch;
            Rounds::<Test>::insert((C, epoch, V), round);
            RoundSchedules::<Test>::insert((C, epoch, V), schedule);
            epoch = epoch.saturating_add(1);
        }

        assert_noop!(
            do_report(1, epoch, reported_value(), h(10)),
            Error::<Test>::RoundLimit
        );
        assert_eq!(Rounds::<Test>::iter().count(), oracle_core::MAX_ROUNDS);
    });
}

#[test]
fn deregister_reporter_happy_path_clears_seat() {
    // 07 §3: exit is permitted once every round the reporter participated in
    // is closed; with no open round the seat clears.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(Oracle::deregister_reporter(RuntimeOrigin::signed(acc(1))));
        assert_eq!(Reporters::<Test>::count(), 0);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn deregister_reporter_with_open_round_is_window_open() {
    // 07 §3: the stake is only returned after the reporter's rounds close; a
    // live round blocks exit.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_noop!(
            Oracle::deregister_reporter(RuntimeOrigin::signed(acc(1))),
            Error::<Test>::WindowOpen
        );
        assert_eq!(Reporters::<Test>::count(), 1);
    });
}

#[test]
fn deregister_reporter_unknown_is_not_registered() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Oracle::deregister_reporter(RuntimeOrigin::signed(acc(9))),
            Error::<Test>::NotRegistered
        );
    });
}

// =========================================================================
// 2. report (07 §5.1 window, §2(4) frozen version, §6.1 value-scaled bond)
// =========================================================================

#[test]
fn report_happy_path_opens_round_with_scaled_bond() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));

        let round = Rounds::<Test>::get((C, E, V)).expect("round populated at the triple key");
        assert_eq!(round.round, 1);
        assert_eq!(round.spec_version, V);
        assert_eq!(round.reporter, raw(1));
        assert_eq!(round.value, reported_value());
        assert_eq!(round.evidence_hash, h(9));
        // 07 §6.2: `B_1 = max(10k, 250 bps × StakeAtRisk)` — the mock's 400k
        // scaled hits the floor exactly (`= 10_000_000_000`).
        assert_eq!(round.bond, bond(1));
        assert_eq!(
            RoundSchedules::<Test>::get((C, E, V)),
            Some(StoredRoundSchedule {
                round_one_bond: bond(1),
                round_cap: ORC_ROUNDS,
            })
        );
        // 07 §5.2: 72 h (`orc.window`) challenge window from the report block.
        assert_eq!(round.challenge_deadline, 1 + ORC_WINDOW_BLOCKS);
        assert!(!round.extended);
        assert!(round.challenger.is_none());

        System::assert_has_event(
            Event::Reported {
                component: C,
                epoch: E,
                round: 1,
                reporter: acc(1),
                value: reported_value(),
                evidence_hash: h(9),
                bond: bond(1),
            }
            .into(),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn round_bond_uses_live_floor_and_basis_points() {
    new_test_ext().execute_with(|| {
        register_reporter(1);

        let mut amended = ParamsValue::get();
        amended.bond_floor = 12_000_000_000;
        amended.bond_bps = 100;
        ParamsValue::set(amended);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_eq!(
            Rounds::<Test>::get((C, E, V)).map(|round| round.bond),
            Some(amended.bond_floor)
        );

        amended.bond_bps = 500;
        ParamsValue::set(amended);
        assert_ok!(do_report(1, E + 1, reported_value(), h(9)));
        assert_eq!(
            Rounds::<Test>::get((C, E + 1, V)).map(|round| round.bond),
            Some(20_000_000_000)
        );
    });
}

#[test]
fn report_unregistered_reporter_is_not_registered() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            do_report(1, E, reported_value(), h(9)),
            Error::<Test>::NotRegistered
        );
    });
}

#[test]
fn report_after_window_close_is_window_closed() {
    // 07 §5.1: no report by the 2-day window close (mock `ReportWindowEnd = 10`).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        set_block(ReportWindowEnd::get() + 1);
        assert_noop!(
            do_report(1, E, reported_value(), h(9)),
            Error::<Test>::WindowClosed
        );
    });
}

#[test]
fn report_wrong_spec_version_is_mismatch() {
    // 07 §2(4)/I-16: a report naming a version other than the cohort's frozen
    // version is invalid at dispatch (mock `ExpectedSpecs = [3]`).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_noop!(
            Oracle::report(
                RuntimeOrigin::signed(acc(1)),
                C,
                E,
                4,
                reported_value(),
                h(9)
            ),
            Error::<Test>::SpecVersionMismatch
        );
    });
}

#[test]
fn report_with_no_consuming_cohort_is_spec_mismatch() {
    // 07 §2(4): a report against a `(component, epoch)` no live cohort consumes
    // is invalid (the mock's frozen-version set is empty ⇒ no version accepted).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        ExpectedSpecs::set(vec![]);
        assert_noop!(
            do_report(1, E, reported_value(), h(9)),
            Error::<Test>::SpecVersionMismatch
        );
        ExpectedSpecs::set(vec![3]); // restore default for suite isolation
    });
}

#[test]
fn report_duplicate_key_is_already_final_for_live_and_settled() {
    // I-18: a live round, and a settled `(component, epoch, version)`, are both
    // final — a fresh report may not reopen the game or shadow the value.
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::note_recomputable(C, V));
        register_reporter(1);
        let proof = proof_for(reported_value());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&proof)));
        // Live round for the key.
        assert_noop!(
            do_report(1, E, reported_value(), hash_evidence(&proof)),
            Error::<Test>::AlreadyFinal
        );
        // Settle it via recompute (F10 makes adjudicate terminal-only), then a
        // repeat report still refuses (settled key).
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            V,
            proof_arg(proof)
        ));
        assert_noop!(
            do_report(1, E, FixedU64(1), h(9)),
            Error::<Test>::AlreadyFinal
        );
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 3. challenge (07 §5.2 — bonded challenge supersedes the quorum requirement)
// =========================================================================

#[test]
fn challenge_happy_path_supersedes_quorum_and_escalates_with_doubled_bond() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));

        System::reset_events();
        // Keep the escalation event from the signed counter-report; the close
        // crank itself is a no-op until the new round's deadline.
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        assert_eq!(
            oracle_events(),
            vec![Event::Challenged {
                component: C,
                epoch: E,
                round: 1,
                challenger: acc(4),
                counter_value: counter_value(),
                evidence_hash: h(10),
                bond: bond(1),
            }]
        );

        // A posted challenge is itself proof of observability, but the next
        // round requires the reporter's explicit signed consent (07 §5.3).
        System::reset_events();
        set_block(ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            V,
            counter_value(),
            h(11)
        ));
        set_block(1 + ORC_WINDOW_BLOCKS);
        // The crank at the old deadline is now an open-window no-op for round 2.
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert_eq!(
            oracle_events(),
            vec![Event::RoundEscalated {
                component: C,
                epoch: E,
                round: 2,
                new_bond: bond(2),
            }]
        );
        let round = Rounds::<Test>::get((C, E, V)).unwrap();
        assert_eq!(round.round, 2);
        assert_eq!(round.bond, bond(2));
        assert_eq!(round.challenger, Some(raw(4))); // challenger identity is durable
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn challenge_window_is_half_open_at_the_deadline() {
    // limit-coverage: orc.window
    // Codex F24 / 07 §5.2: the challenge window is `[open, deadline)` — a
    // challenge at `deadline - 1` is the last valid block, and one at the
    // `deadline` block (which the close crank treats as mature) is `WindowClosed`,
    // so a challenge can never race the close.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_ok!(do_report(1, E + 1, reported_value(), h(9)));
        let mut amended = ParamsValue::get();
        amended.window = ORC_WINDOW_BLOCKS + 10;
        ParamsValue::set(amended);
        assert_ok!(do_report(1, E + 2, reported_value(), h(9)));
        assert_ok!(do_report(1, E + 3, reported_value(), h(9)));
        let deadline = Rounds::<Test>::get((C, E, V)).unwrap().challenge_deadline;
        let amended_deadline = deadline + 10;
        assert_eq!(
            Rounds::<Test>::get((C, E + 2, V)).map(|round| round.challenge_deadline),
            Some(amended_deadline)
        );

        // Last valid block succeeds.
        set_block(deadline - 1);
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        // The deadline block itself is closed.
        set_block(deadline);
        assert_noop!(
            Oracle::challenge(
                RuntimeOrigin::signed(acc(4)),
                C,
                E + 1,
                V,
                counter_value(),
                h(10)
            ),
            Error::<Test>::WindowClosed
        );
        // The amended creation-time snapshot stays open at the old boundary.
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E + 2,
            V,
            counter_value(),
            h(10)
        ));
        // Its own moved boundary remains half-open.
        set_block(amended_deadline);
        assert_noop!(
            Oracle::challenge(
                RuntimeOrigin::signed(acc(4)),
                C,
                E + 3,
                V,
                counter_value(),
                h(10)
            ),
            Error::<Test>::WindowClosed
        );
    });
}

#[test]
fn challenge_second_time_is_already_challenged() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        assert_noop!(
            Oracle::challenge(RuntimeOrigin::signed(acc(5)), C, E, V, FixedU64(1), h(11)),
            Error::<Test>::AlreadyChallenged
        );
    });
}

#[test]
fn challenge_unknown_round_is_round_not_found() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Oracle::challenge(
                RuntimeOrigin::signed(acc(4)),
                C,
                E,
                V,
                counter_value(),
                h(10)
            ),
            Error::<Test>::RoundNotFound
        );
    });
}

// =========================================================================
// 4. crank_round_close lifecycle (07 §4 quorum, §5 escalation, §10 neutral)
// =========================================================================

#[test]
fn crank_quorum_and_no_challenge_settles_unchallenged() {
    // 07 §4: an unchallenged round finalizes at window close only if ≥ `wt.quorum
    // = 2` distinct watchtowers acknowledged it.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        register_watchtower(3);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let rh = hash_report(C, E, 1, reported_value(), h(9));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            E,
            V,
            1,
            rh
        ));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(3)),
            C,
            E,
            V,
            1,
            rh
        ));

        set_block(1 + ORC_WINDOW_BLOCKS);
        System::reset_events();
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));

        let settled = Oracle::settled_component(C, E, V).expect("settled");
        assert_eq!(settled.path, SettlePath::Unchallenged);
        assert_eq!(settled.value, reported_value());
        assert!(!settled.flagged);
        assert!(Rounds::<Test>::get((C, E, V)).is_none()); // round reaped
        System::assert_has_event(
            Event::ComponentSettled {
                component: C,
                epoch: E,
                value: reported_value(),
                path: SettlePath::Unchallenged,
            }
            .into(),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn quorum_finalization_reads_live_watchtower_quorum() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let report_hash = hash_report(C, E, 1, reported_value(), h(9));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            E,
            V,
            1,
            report_hash
        ));

        let mut amended = ParamsValue::get();
        amended.watchtower_quorum = 1;
        ParamsValue::set(amended);
        set_block(1 + ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert_eq!(
            Oracle::settled_component(C, E, V).map(|settled| settled.path),
            Some(SettlePath::Unchallenged)
        );
    });
}

#[test]
fn crank_no_quorum_extends_once_then_settles_neutral() {
    // limit-coverage: orc.ext_window
    // 07 §4/§10: no quorum and no challenge ⇒ one 48 h (`orc.ext_window`)
    // extension, then — still no quorum — the neutral path, carrying the last
    // valid value (0.5 with no history, 05 §10) with the epoch flagged.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));

        set_block(1 + ORC_WINDOW_BLOCKS);
        System::reset_events();
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        let ext_deadline = (1 + ORC_WINDOW_BLOCKS) + ORC_EXT_WINDOW_BLOCKS;
        assert_eq!(
            oracle_events(),
            vec![Event::WindowExtended {
                component: C,
                epoch: E,
                round: 1,
                new_deadline: ext_deadline,
            }]
        );
        assert!(Rounds::<Test>::get((C, E, V)).unwrap().extended);

        set_block(ext_deadline);
        System::reset_events();
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        let neutral = FixedU64(COMPONENT_VALUE_MAX / 2);
        assert_eq!(
            oracle_events(),
            vec![
                Event::QuorumFailed {
                    component: C,
                    epoch: E,
                    round: 1,
                },
                Event::NeutralSettlement {
                    component: C,
                    epoch: E,
                    carried_value: neutral,
                    flagged_epochs: 1,
                },
                Event::ComponentSettled {
                    component: C,
                    epoch: E,
                    value: neutral,
                    path: SettlePath::Neutral,
                },
            ]
        );
        let settled = Oracle::settled_component(C, E, V).unwrap();
        assert_eq!(settled.path, SettlePath::Neutral);
        assert_eq!(settled.value, neutral);
        assert!(settled.flagged);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn crank_round_close_batch_cap_is_honored() {
    // 07 §13: the crank is a bounded keeper batch. The shell clamps `batch` to
    // `MaxRoundCloseBatch`; a call asking for more than the cap processes no
    // more than the cap even when more rounds have matured.
    new_test_ext().execute_with(|| {
        let cap = MaxRoundCloseBatch::get();
        register_reporter(1);
        // One matured, unacked, unchallenged round per epoch: each takes the
        // single-extension branch, so "processed" is observable as `extended`.
        for epoch in 1..=(cap + 1) {
            assert_ok!(do_report(1, epoch, reported_value(), h(9)));
        }
        set_block(1 + ORC_WINDOW_BLOCKS + 1);
        assert_ok!(Oracle::crank_round_close(
            RuntimeOrigin::signed(acc(9)),
            cap + 5 // asks for more than the cap
        ));

        let extended = Rounds::<Test>::iter().filter(|(_, r)| r.extended).count();
        assert_eq!(extended as u32, cap); // exactly the cap advanced
        assert_eq!(Rounds::<Test>::iter().count() as u32, cap + 1); // none settled
        assert_eq!(
            oracle_events()
                .iter()
                .filter(|e| matches!(e, Event::WindowExtended { .. }))
                .count() as u32,
            cap
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn crank_round_close_with_nothing_matured_is_noop() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        // Window still open: the crank matures nothing.
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert!(Rounds::<Test>::get((C, E, V)).is_some());
        assert!(Oracle::settled_component(C, E, V).is_none());
    });
}

// =========================================================================
// 5. ack_observed (07 §4 — bonded watchtower acknowledgment)
// =========================================================================

#[test]
fn ack_observed_happy_path_increments_and_emits() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let rh = hash_report(C, E, 1, reported_value(), h(9));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            E,
            V,
            1,
            rh
        ));

        assert_eq!(Rounds::<Test>::get((C, E, V)).unwrap().acks, 1);
        System::assert_has_event(
            Event::WindowAcknowledged {
                component: C,
                epoch: E,
                round: 1,
                watchtower: acc(2),
            }
            .into(),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn ack_observed_non_watchtower_is_not_registered() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let rh = hash_report(C, E, 1, reported_value(), h(9));
        assert_noop!(
            Oracle::ack_observed(RuntimeOrigin::signed(acc(2)), C, E, V, 1, rh),
            Error::<Test>::NotRegistered
        );
    });
}

#[test]
fn ack_observed_window_is_half_open_at_the_deadline() {
    // Codex F24 / 07 §4: the acknowledgment window is `[open, deadline)` — an ack
    // at `deadline - 1` is valid, and one at the `deadline` block is
    // `WindowClosed` (boundary consistency with the close crank, so a late ack
    // cannot retro-finalize).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        register_watchtower(3);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let rh = hash_report(C, E, 1, reported_value(), h(9));
        let deadline = Rounds::<Test>::get((C, E, V)).unwrap().challenge_deadline;

        set_block(deadline - 1);
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            E,
            V,
            1,
            rh
        ));
        set_block(deadline);
        assert_noop!(
            Oracle::ack_observed(RuntimeOrigin::signed(acc(3)), C, E, V, 1, rh),
            Error::<Test>::WindowClosed
        );
        assert_eq!(Rounds::<Test>::get((C, E, V)).unwrap().acks, 1); // only the valid ack
    });
}

#[test]
fn ack_observed_duplicate_is_duplicate_ack() {
    // 07 §13: acks are per-round, keyed by `report_hash`; a replay is refused.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let rh = hash_report(C, E, 1, reported_value(), h(9));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            E,
            V,
            1,
            rh
        ));
        assert_noop!(
            Oracle::ack_observed(RuntimeOrigin::signed(acc(2)), C, E, V, 1, rh),
            Error::<Test>::DuplicateAck
        );
        assert_eq!(Rounds::<Test>::get((C, E, V)).unwrap().acks, 1);
    });
}

#[test]
fn ack_observed_inside_extension_window_still_counts_toward_quorum() {
    // Mirror of the core's `late_watchtower_acks_cannot_retro_finalize`: acks
    // rejected after the original close, then accepted inside the live 48 h
    // extension, drive an unchallenged settle (07 §4).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        register_watchtower(3);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        let rh = hash_report(C, E, 1, reported_value(), h(9));
        let deadline = Rounds::<Test>::get((C, E, V)).unwrap().challenge_deadline;

        // An acknowledgment at the deadline block is already closed (half-open)...
        set_block(deadline);
        assert_noop!(
            Oracle::ack_observed(RuntimeOrigin::signed(acc(2)), C, E, V, 1, rh),
            Error::<Test>::WindowClosed
        );
        // ...the uncranked round then extends rather than finalizing (the close
        // crank treats the deadline block as mature)...
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        let ext_deadline = Rounds::<Test>::get((C, E, V)).unwrap().challenge_deadline;
        assert!(ext_deadline > deadline);

        // ...and acks strictly inside the live extension window count toward quorum.
        set_block(ext_deadline - 1);
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            E,
            V,
            1,
            rh
        ));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(3)),
            C,
            E,
            V,
            1,
            rh
        ));
        set_block(ext_deadline);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert_eq!(
            Oracle::settled_component(C, E, V).unwrap().path,
            SettlePath::Unchallenged
        );
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 6. recompute_proof (07 §9 — permissionless mechanical resolution)
// =========================================================================

#[test]
fn recompute_proof_matching_evidence_settles_recomputed_without_offense() {
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::note_recomputable(C, V));
        register_reporter(1);
        let proof = proof_for(reported_value());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&proof)));

        System::reset_events();
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            V,
            proof_arg(proof)
        ));
        let settled = Oracle::settled_component(C, E, V).unwrap();
        assert_eq!(settled.path, SettlePath::Recomputed);
        assert_eq!(settled.value, reported_value());
        // Reporter's committed data agreed: no offense (07 §9).
        assert_eq!(Reporters::<Test>::get(acc(1)).unwrap().offenses, 0);
        System::assert_has_event(
            Event::RecomputeProven {
                component: C,
                epoch: E,
                value: reported_value(),
                prover: acc(5),
            }
            .into(),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn recompute_proof_disagreeing_evidence_settles_recomputed_and_records_offense() {
    // 07 §5/§9: committed data that disproves the reported value settles at the
    // recomputed value and forfeits the reporter's stack (records an offense).
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::note_recomputable(C, V));
        register_reporter(1);
        let proof = proof_for(counter_value()); // committed data says 0.44
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&proof))); // reported 0.62

        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            V,
            proof_arg(proof)
        ));
        let settled = Oracle::settled_component(C, E, V).unwrap();
        assert_eq!(settled.path, SettlePath::Recomputed);
        assert_eq!(settled.value, counter_value());
        assert_eq!(Reporters::<Test>::get(acc(1)).unwrap().offenses, 1);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn recompute_proof_non_recomputable_component_is_rejected() {
    // 07 §9: the flow is admissible only where the frozen spec declares the
    // component deterministically recomputable; otherwise it fails closed.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        let proof = proof_for(reported_value());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&proof)));
        assert_noop!(
            Oracle::recompute_proof(RuntimeOrigin::signed(acc(5)), C, E, V, proof_arg(proof)),
            Error::<Test>::NotRecomputable
        );
    });
}

#[test]
fn recompute_proof_evidence_mismatch_is_rejected() {
    // 07 §9: the proof must reproduce the committed content hash.
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::note_recomputable(C, V));
        register_reporter(1);
        let committed = proof_for(reported_value());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&committed)));
        let other = proof_for(counter_value()); // hashes differently
        assert_noop!(
            Oracle::recompute_proof(RuntimeOrigin::signed(acc(5)), C, E, V, proof_arg(other)),
            Error::<Test>::EvidenceMismatch
        );
    });
}

#[test]
fn recompute_proof_short_committed_payload_is_bad_proof() {
    // 07 §9 / 05 §4.4: a committed payload too short to decode a grid value is
    // a bad proof even when its content hash matches.
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::note_recomputable(C, V));
        register_reporter(1);
        let short = vec![3u8; 4];
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&short)));
        assert_noop!(
            Oracle::recompute_proof(RuntimeOrigin::signed(acc(5)), C, E, V, proof_arg(short)),
            Error::<Test>::BadProof
        );
    });
}

#[test]
fn recompute_proof_off_grid_committed_payload_is_bad_proof() {
    // 05 §4.4 determinism rule 1: a value off the [0, 1] 1e9 grid is a bad proof.
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::note_recomputable(C, V));
        register_reporter(1);
        let mut off_grid = vec![0u8; 24];
        off_grid[..8].copy_from_slice(&(COMPONENT_VALUE_MAX + 1).to_le_bytes());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&off_grid)));
        assert_noop!(
            Oracle::recompute_proof(RuntimeOrigin::signed(acc(5)), C, E, V, proof_arg(off_grid)),
            Error::<Test>::BadProof
        );
    });
}

#[test]
fn recompute_proof_arg_bound_rejects_oversized_payload() {
    // 07 §9: the `BoundedVec` call argument refuses a raw SCALE payload whose
    // declared proof length is exactly one byte over the bound. This happens at
    // call admission, before dispatch; weakening the argument to an unbounded
    // Vec just to make `ProofTooLarge` reachable would be unsafe.
    let mut encoded_call = vec![4u8]; // `recompute_proof` call index.
    encoded_call.extend(C.encode());
    encoded_call.extend(E.encode());
    encoded_call.extend(V.encode());
    encoded_call.extend(Compact(crate::MAX_PROOF_BYTES_BOUND + 1).encode());

    let error = crate::Call::<Test>::decode(&mut encoded_call.as_slice())
        .expect_err("a max+1 proof must fail SCALE call admission");
    assert_eq!(
        error.to_string(),
        "Could not decode `Call::recompute_proof::proof`:\n\tBoundedVec exceeds its limit\n"
    );
}

// =========================================================================
// 7. adjudicate (07 §5.4 OracleResolution-only origin, §5.5 slashing)
// =========================================================================

#[test]
fn adjudicate_happy_path_settles_adjudicated() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        escalate_to_terminal(1, 4, E); // round `R_max` with a live challenger (F10)

        System::reset_events();
        let verdict = FixedU64(500_000_000);
        assert_ok!(Oracle::adjudicate(
            RuntimeOrigin::signed(oracle_resolution_acc()),
            C,
            E,
            V,
            verdict,
            false
        ));
        let settled = Oracle::settled_component(C, E, V).unwrap();
        assert_eq!(settled.path, SettlePath::Adjudicated);
        assert_eq!(settled.value, verdict);
        assert!(!Rounds::<Test>::contains_key((C, E, V)));
        assert!(!RoundSchedules::<Test>::contains_key((C, E, V)));
        assert_eq!(
            oracle_events(),
            vec![
                Event::Adjudicated {
                    component: C,
                    epoch: E,
                    value: verdict,
                },
                Event::ComponentSettled {
                    component: C,
                    epoch: E,
                    value: verdict,
                    path: SettlePath::Adjudicated,
                },
            ]
        );
        // reporter_wrong = false ⇒ no offense.
        assert_eq!(Reporters::<Test>::get(acc(1)).unwrap().offenses, 0);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn adjudicate_rejects_non_oracle_resolution_origins() {
    // 07 §5.4 / rule 6 (G-5): the sole privileged call admits only the
    // `OracleResolution` track — an ordinary signed account, Root, and an
    // unsigned origin are all `BadOrigin`, and no state moves.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        for bad in [
            RuntimeOrigin::signed(acc(1)),
            RuntimeOrigin::root(),
            RuntimeOrigin::none(),
        ] {
            assert_noop!(
                Oracle::adjudicate(bad, C, E, V, counter_value(), true),
                DispatchError::BadOrigin
            );
        }
        assert!(Oracle::settled_component(C, E, V).is_none());
        assert_eq!(Reporters::<Test>::get(acc(1)).unwrap().offenses, 0);
    });
}

#[test]
fn adjudicate_reporter_wrong_records_a_single_offense() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        escalate_to_terminal(1, 4, E);
        assert_ok!(Oracle::adjudicate(
            RuntimeOrigin::signed(oracle_resolution_acc()),
            C,
            E,
            V,
            counter_value(),
            true
        ));
        assert_eq!(Reporters::<Test>::get(acc(1)).unwrap().offenses, 1);
        // First offense does not slash or eject (07 §3).
        assert!(!oracle_events().iter().any(|e| matches!(
            e,
            Event::ReporterSlashed { .. } | Event::ReporterEjected { .. }
        )));
    });
}

#[test]
fn adjudicate_third_offense_slashes_and_ejects_reporter() {
    // 07 §3 / Codex F19: a 50 % slash of `orc.reporter_stake` on the *second*
    // adjudicated-false report, and *ejection-only* on the third (no further
    // slash). Three recompute-disproofs — each records an offense and settles the
    // game directly (07 §9, no crank; F10 makes adjudicate terminal-only) — walk
    // that discipline.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        let mut amended = ParamsValue::get();
        amended.reporter_stake = ORC_REPORTER_STAKE.saturating_add(1);
        ParamsValue::set(amended);
        register_reporter(2);
        assert_ok!(Oracle::note_recomputable(C, V));
        let disproof = proof_for(counter_value()); // recomputes to 0.44, disproving 0.62
        for (reporter, first_epoch) in [(1, E), (2, E + 3)] {
            for epoch in first_epoch..(first_epoch + 3) {
                assert_ok!(Oracle::report(
                    RuntimeOrigin::signed(acc(reporter)),
                    C,
                    epoch,
                    V,
                    reported_value(),
                    hash_evidence(&disproof)
                ));
                assert_ok!(Oracle::recompute_proof(
                    RuntimeOrigin::signed(acc(5)),
                    C,
                    epoch,
                    V,
                    proof_arg(disproof.clone())
                ));
            }
        }
        assert_eq!(Reporters::<Test>::count(), 0); // both ejected
        let evs = oracle_events();
        assert!(evs.iter().any(|e| matches!(
            e,
            Event::ReporterSlashed {
                who,
                amount,
                offense: 2
            } if *who == acc(1) && *amount == ORC_REPORTER_STAKE / 2
        )));
        assert!(evs.iter().any(|e| matches!(
            e,
            Event::ReporterSlashed {
                who,
                amount,
                offense: 2
            } if *who == acc(2)
                && *amount == (amended.reporter_stake / 2).saturating_add(1)
        )));
        // Codex F19: the third offense ejects only — no further `ReporterSlashed`.
        assert!(!evs
            .iter()
            .any(|e| matches!(e, Event::ReporterSlashed { offense: 3, .. })));
        assert!(evs
            .iter()
            .any(|e| matches!(e, Event::ReporterEjected { who } if *who == acc(1))));
        assert!(evs
            .iter()
            .any(|e| matches!(e, Event::ReporterEjected { who } if *who == acc(2))));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn third_offense_releases_remaining_reporter_stake() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(Oracle::note_recomputable(C, V));
        let disproof = proof_for(counter_value());
        for epoch in E..=E + 1 {
            assert_ok!(Oracle::report(
                RuntimeOrigin::signed(acc(1)),
                C,
                epoch,
                V,
                reported_value(),
                hash_evidence(&disproof)
            ));
            assert_ok!(Oracle::recompute_proof(
                RuntimeOrigin::signed(acc(5)),
                C,
                epoch,
                V,
                proof_arg(disproof.clone())
            ));
        }
        let released_before = CustodyReleased::get();
        let slashed_before = CustodySlashed::get();
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E + 2,
            V,
            reported_value(),
            hash_evidence(&disproof)
        ));
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E + 2,
            V,
            proof_arg(disproof)
        ));
        // The third losing recompute still forfeits its round bond; it must
        // not add another registration-stake slash.
        assert_eq!(CustodySlashed::get() - slashed_before, bond(1));
        assert_eq!(
            CustodyReleased::get() - released_before,
            ORC_REPORTER_STAKE - ORC_REPORTER_STAKE / 2
        );
        assert!(Reporters::<Test>::get(acc(1)).is_none());
    });
}

// =========================================================================
// 8. request_adjudication (07 §5.4 — runtime-internal escalation to the track)
// =========================================================================

#[test]
fn request_adjudication_at_round_three_emits_event() {
    // Drive the game to round 3 with a live challenger, then escalate to the
    // `OracleResolution` referendum (07 §5.3/§5.4).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        set_block(ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            V,
            counter_value(),
            h(11)
        ));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(11)
        ));
        set_block(2 * ORC_WINDOW_BLOCKS - 1);
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            V,
            counter_value(),
            h(12)
        ));
        let round = Rounds::<Test>::get((C, E, V)).unwrap();
        assert_eq!(round.round, 3);
        assert_eq!(round.bond, bond(3)); // 07 §6.2: `B_3 = 4·B_1`
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(13)
        ));

        System::reset_events();
        assert_ok!(Oracle::request_adjudication(C, E, V, 77));
        assert_eq!(
            oracle_events(),
            vec![Event::AdjudicationRequested {
                component: C,
                epoch: E,
                referendum: 77,
            }]
        );
    });
}

#[test]
fn request_adjudication_before_round_three_is_window_open() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_noop!(
            Oracle::request_adjudication(C, E, V, 1),
            Error::<Test>::WindowOpen
        );
    });
}

#[test]
fn amended_round_cap_moves_terminal_boundary_for_next_game_only() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));

        let mut amended = ParamsValue::get();
        amended.rounds = 2;
        ParamsValue::set(amended);
        assert_ok!(do_report(1, E + 1, reported_value(), h(19)));
        assert_eq!(
            RoundSchedules::<Test>::get((C, E, V)).map(|schedule| schedule.round_cap),
            Some(ORC_ROUNDS)
        );
        assert_eq!(
            RoundSchedules::<Test>::get((C, E + 1, V)).map(|schedule| schedule.round_cap),
            Some(2)
        );

        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(5)),
            C,
            E + 1,
            V,
            counter_value(),
            h(20)
        ));
        set_block(ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            V,
            counter_value(),
            h(11)
        ));
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E + 1,
            V,
            counter_value(),
            h(21)
        ));
        assert_eq!(
            Rounds::<Test>::get((C, E, V)).map(|round| round.round),
            Some(2)
        );
        assert_eq!(
            Rounds::<Test>::get((C, E + 1, V)).map(|round| round.round),
            Some(2)
        );
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(11)
        ));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(5)),
            C,
            E + 1,
            V,
            counter_value(),
            h(21)
        ));

        assert_noop!(
            Oracle::request_adjudication(C, E, V, 77),
            Error::<Test>::WindowOpen
        );
        assert_ok!(Oracle::request_adjudication(C, E + 1, V, 78));

        set_block(2 * ORC_WINDOW_BLOCKS - 1);
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            V,
            counter_value(),
            h(12)
        ));
        assert_eq!(
            Rounds::<Test>::get((C, E, V)).map(|round| round.round),
            Some(3)
        );
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(13)
        ));
        assert_ok!(Oracle::request_adjudication(C, E, V, 79));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn mid_game_bond_amendment_does_not_reprice_later_rounds() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        let opening = ParamsValue::get();
        let opening_bond = round_bond(StakeAtRiskValue::get(), 1, &opening)
            .expect("default game schedule is representable");
        assert_ok!(do_report(1, E, reported_value(), h(9)));

        let amended = OracleParams {
            bond_floor: opening_bond.saturating_mul(2),
            bond_bps: 1_000,
            ..opening
        };
        ParamsValue::set(amended);
        assert_ok!(do_report(1, E + 1, reported_value(), h(19)));
        let next_game =
            RoundSchedules::<Test>::get((C, E + 1, V)).expect("next game schedule freezes");
        assert_eq!(
            next_game.round_one_bond,
            round_bond(StakeAtRiskValue::get(), 1, &amended)
                .expect("amended game schedule is representable")
        );

        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        set_block(ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            V,
            counter_value(),
            h(11)
        ));
        let round_two = Rounds::<Test>::get((C, E, V)).expect("old game escalates");
        assert_eq!(round_two.round, 2);
        assert_eq!(
            RoundSchedules::<Test>::get((C, E, V)).map(|schedule| schedule.round_one_bond),
            Some(opening_bond)
        );
        assert_eq!(round_two.bond, opening_bond.saturating_mul(2));
        assert_ok!(Oracle::do_try_state());

        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(11)
        ));
        set_block(2 * ORC_WINDOW_BLOCKS - 1);
        assert_ok!(Oracle::counter_report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            V,
            counter_value(),
            h(12)
        ));
        let round_three = Rounds::<Test>::get((C, E, V)).expect("old game reaches its cap");
        assert_eq!(round_three.round, 3);
        assert_eq!(round_three.bond, opening_bond.saturating_mul(4));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn try_state_survives_schedule_params_amendment_for_open_game() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        ParamsValue::set(OracleParams {
            rounds: 2,
            bond_floor: 100_000_000_000,
            bond_bps: 1_000,
            ..OracleParams::DEFAULT
        });
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 9. Reserve health probe R (07 §8 — deterministic class-3, fail-static)
// =========================================================================

mod probe_dispatch_seam {
    use super::*;
    use crate as pallet_oracle;
    use frame_support::{derive_impl, parameter_types};
    use futarchy_primitives::keeper::{CrankClass, KeeperRebateSink};
    use sp_runtime::{traits::IdentityLookup, AccountId32, BuildStorage};
    use std::cell::{Cell, RefCell};

    type Block = frame_system::mocking::MockBlock<DispatchTest>;

    frame_support::construct_runtime!(
        pub enum DispatchTest {
            System: frame_system,
            Oracle: pallet_oracle,
        }
    );

    #[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
    impl frame_system::Config for DispatchTest {
        type Block = Block;
        type AccountId = AccountId32;
        type Lookup = IdentityLookup<AccountId32>;
    }

    pub struct DispatchReporting;

    impl pallet_oracle::ReportingContext for DispatchReporting {
        fn report_window_end(_: EpochId) -> futarchy_primitives::BlockNumber {
            10
        }

        fn is_expected_spec_version(_: MetricId, _: EpochId, _: MetricSpecVersion) -> bool {
            true
        }

        fn stake_at_risk(_: MetricId, _: EpochId) -> Balance {
            0
        }

        fn expected_components(_: EpochId) -> Vec<(MetricId, MetricSpecVersion)> {
            Vec::new()
        }
    }

    std::thread_local! {
        static DISPATCHED: RefCell<Vec<(u64, Balance)>> = const { RefCell::new(Vec::new()) };
        static REBATES: RefCell<Vec<(AccountId32, CrankClass)>> = const { RefCell::new(Vec::new()) };
        static TIMEOUTS: Cell<u32> = const { Cell::new(0) };
    }

    pub struct RecordingProbeDispatch;

    impl pallet_oracle::ProbeDispatch for RecordingProbeDispatch {
        fn live(_: &oracle_core::OracleParams) -> bool {
            true
        }

        fn probe_due(query_id: u64, amount: Balance) {
            DISPATCHED.with(|ids| ids.borrow_mut().push((query_id, amount)));
        }
    }

    pub struct DispatchParams;

    impl pallet_oracle::OracleParamsProvider for DispatchParams {
        fn get() -> oracle_core::OracleParams {
            oracle_core::OracleParams::DEFAULT
        }
    }

    pub struct RecordingProbeTimeoutSink;

    impl pallet_oracle::ProbeTimeoutSink for RecordingProbeTimeoutSink {
        fn probe_timed_out() {
            TIMEOUTS.with(|count| count.set(count.get().saturating_add(1)));
        }
    }

    pub struct RecordingKeeperRebate;

    impl KeeperRebateSink<AccountId32> for RecordingKeeperRebate {
        fn rebate(who: &AccountId32, class: CrankClass) {
            REBATES.with(|rebates| rebates.borrow_mut().push((who.clone(), class)));
        }
    }

    parameter_types! {
        pub const MaxRoundCloseBatch: u32 = 20;
    }

    impl pallet_oracle::Config for DispatchTest {
        type AdjudicationOrigin = frame_system::EnsureRoot<AccountId32>;
        type Reporting = DispatchReporting;
        type Params = DispatchParams;
        type Custody = ();
        type MaxRoundCloseBatch = MaxRoundCloseBatch;
        type ProbeDispatch = RecordingProbeDispatch;
        type ProbeTimeoutSink = RecordingProbeTimeoutSink;
        type ReserveHealthSink = ();
        type KeeperRebate = RecordingKeeperRebate;
        type WeightInfo = ();
        #[cfg(feature = "runtime-benchmarks")]
        type BenchmarkHelper = DispatchBenchmarkHelper;
    }

    #[cfg(feature = "runtime-benchmarks")]
    pub struct DispatchBenchmarkHelper;

    #[cfg(feature = "runtime-benchmarks")]
    impl pallet_oracle::BenchmarkHelper<RuntimeOrigin> for DispatchBenchmarkHelper {
        fn adjudication_origin() -> RuntimeOrigin {
            RuntimeOrigin::root()
        }

        fn prime_reporting(_: MetricId, _: EpochId, _: MetricSpecVersion) {}
    }

    fn new_ext() -> sp_io::TestExternalities {
        let storage = RuntimeGenesisConfig {
            system: Default::default(),
            oracle: Default::default(),
        }
        .build_storage()
        .expect("probe-dispatch test genesis must build");
        let mut ext = sp_io::TestExternalities::new(storage);
        ext.execute_with(|| {
            System::set_block_number(1);
            DISPATCHED.with(|ids| ids.borrow_mut().clear());
            REBATES.with(|rebates| rebates.borrow_mut().clear());
            TIMEOUTS.with(|count| count.set(0));
        });
        ext
    }

    #[test]
    fn reserve_probe_crank_dispatches_only_a_fresh_pending_query() {
        new_ext().execute_with(|| {
            let keeper = AccountId32::new([9; 32]);
            System::set_block_number(u64::from(RES_PROBE_INTERVAL));
            assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(
                keeper.clone()
            )));
            assert_eq!(
                pallet_oracle::ReserveHealth::<DispatchTest>::get().last_query_id,
                1
            );
            DISPATCHED.with(|ids| {
                assert_eq!(
                    &*ids.borrow(),
                    &[(1, oracle_core::OracleParams::DEFAULT.probe_amount)]
                )
            });
            TIMEOUTS.with(|count| assert_eq!(count.get(), 0));
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[(keeper.clone(), CrankClass::OracleLine)]
                )
            });

            // The timeout matures before the next send interval. This crank
            // commits the fail-static fold but creates no pending query, so the
            // runtime dispatcher must not be invoked a second time (07 §8).
            System::set_block_number(u64::from(RES_PROBE_INTERVAL + RES_PROBE_TIMEOUT));
            assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(
                keeper.clone()
            )));
            let health = pallet_oracle::ReserveHealth::<DispatchTest>::get();
            assert_eq!(health.last_query_id, 1);
            assert_eq!(health.pending_since, None);
            assert_eq!(health.consecutive_fails, 1);
            DISPATCHED.with(|ids| {
                assert_eq!(
                    &*ids.borrow(),
                    &[(1, oracle_core::OracleParams::DEFAULT.probe_amount)]
                )
            });
            TIMEOUTS.with(|count| assert_eq!(count.get(), 1));
            // The live dispatcher makes the fail-static timeout fold genuine
            // state-advancing keeper work, paid once even without a fresh send.
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[
                        (keeper.clone(), CrankClass::OracleLine),
                        (keeper, CrankClass::OracleLine),
                    ]
                )
            });
        });
    }

    #[test]
    fn round_close_rebates_progress_once_but_not_an_idempotent_noop() {
        new_ext().execute_with(|| {
            let reporter = AccountId32::new([1; 32]);
            let keeper = AccountId32::new([9; 32]);
            assert_ok!(Oracle::register_reporter(RuntimeOrigin::signed(
                reporter.clone()
            )));
            assert_ok!(Oracle::report(
                RuntimeOrigin::signed(reporter),
                C,
                E,
                V,
                reported_value(),
                h(9)
            ));

            // Open-window crank is a successful no-op: the drain-vector case.
            assert_ok!(Oracle::crank_round_close(
                RuntimeOrigin::signed(keeper.clone()),
                1
            ));
            REBATES.with(|rebates| assert!(rebates.borrow().is_empty()));

            System::set_block_number(u64::from(ORC_WINDOW_BLOCKS + 1));
            assert_ok!(Oracle::crank_round_close(
                RuntimeOrigin::signed(keeper.clone()),
                1
            ));
            // The latch-once extension is genuine progress and pays exactly once.
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[(keeper.clone(), CrankClass::OracleLine)]
                )
            });

            // An immediate retry cannot re-extend the latched window and pays
            // nothing further.
            assert_ok!(Oracle::crank_round_close(
                RuntimeOrigin::signed(keeper.clone()),
                1
            ));
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[(keeper.clone(), CrankClass::OracleLine)]
                )
            });

            System::set_block_number(u64::from(ORC_WINDOW_BLOCKS + 1 + ORC_EXT_WINDOW_BLOCKS));
            assert_ok!(Oracle::crank_round_close(
                RuntimeOrigin::signed(keeper.clone()),
                1
            ));
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[
                        (keeper.clone(), CrankClass::OracleLine),
                        (keeper, CrankClass::OracleLine),
                    ]
                )
            });
        });
    }

    /// 08 §6.3 / 07 §11(1): expiring a retained game is the one form of real
    /// progress `crank_round_close` makes that settles **no** component — the
    /// money leg went neutral at d20 — so it emits no `ComponentSettled` and
    /// would have been unpaid. It returns a `MAX_ROUNDS` slot and releases two
    /// bond stacks from custody; a permissionless crank nobody is paid to run
    /// is a liveness assumption, not a mechanism (SQ-492).
    #[test]
    fn sq492_expiring_a_retained_game_earns_the_oracle_line_rebate() {
        new_ext().execute_with(|| {
            let reporter = AccountId32::new([1; 32]);
            let challenger = AccountId32::new([4; 32]);
            let keeper = AccountId32::new([9; 32]);
            assert_ok!(Oracle::register_reporter(RuntimeOrigin::signed(
                reporter.clone()
            )));
            assert_ok!(Oracle::report(
                RuntimeOrigin::signed(reporter.clone()),
                C,
                E,
                V,
                reported_value(),
                h(9)
            ));
            for _ in 1..oracle_core::ORC_ROUNDS {
                let deadline = pallet_oracle::Rounds::<DispatchTest>::get((C, E, V))
                    .expect("live round")
                    .challenge_deadline;
                frame_system::Pallet::<DispatchTest>::set_block_number(u64::from(deadline - 1));
                assert_ok!(Oracle::challenge(
                    RuntimeOrigin::signed(challenger.clone()),
                    C,
                    E,
                    V,
                    counter_value(),
                    h(10)
                ));
                assert_ok!(Oracle::counter_report(
                    RuntimeOrigin::signed(reporter.clone()),
                    C,
                    E,
                    V,
                    counter_value(),
                    h(11)
                ));
            }
            let deadline = pallet_oracle::Rounds::<DispatchTest>::get((C, E, V))
                .expect("live round")
                .challenge_deadline;
            frame_system::Pallet::<DispatchTest>::set_block_number(u64::from(deadline - 1));
            assert_ok!(Oracle::challenge(
                RuntimeOrigin::signed(challenger),
                C,
                E,
                V,
                counter_value(),
                h(10)
            ));

            let neutralized_at =
                u32::try_from(frame_system::Pallet::<DispatchTest>::block_number()).unwrap();
            assert_ok!(Oracle::note_settle_deadline(E));
            REBATES.with(|rebates| rebates.borrow_mut().clear());

            // One block early there is nothing to pay for: the crank correctly
            // leaves the round alone while a verdict can still land.
            frame_system::Pallet::<DispatchTest>::set_block_number(u64::from(
                neutralized_at + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS - 1,
            ));
            assert_ok!(Oracle::crank_round_close(
                RuntimeOrigin::signed(keeper.clone()),
                20
            ));
            REBATES.with(|rebates| assert!(rebates.borrow().is_empty()));

            frame_system::Pallet::<DispatchTest>::set_block_number(u64::from(
                neutralized_at + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS,
            ));
            assert_ok!(Oracle::crank_round_close(
                RuntimeOrigin::signed(keeper.clone()),
                20
            ));
            assert!(pallet_oracle::Rounds::<DispatchTest>::get((C, E, V)).is_none());
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[(keeper.clone(), CrankClass::OracleLine)]
                )
            });

            // And the drained crank pays nothing further.
            assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(keeper), 20));
            REBATES.with(|rebates| assert_eq!(rebates.borrow().len(), 1));
        });
    }

    #[test]
    fn watchtower_ack_rebates_once_and_duplicate_pays_nothing() {
        new_ext().execute_with(|| {
            let reporter = AccountId32::new([1; 32]);
            let watchtower = AccountId32::new([2; 32]);
            assert_ok!(Oracle::register_reporter(RuntimeOrigin::signed(
                reporter.clone()
            )));
            assert_ok!(Oracle::register_watchtower(RuntimeOrigin::signed(
                watchtower.clone()
            )));
            assert_ok!(Oracle::report(
                RuntimeOrigin::signed(reporter),
                C,
                E,
                V,
                reported_value(),
                h(9)
            ));
            let round = pallet_oracle::Rounds::<DispatchTest>::get((C, E, V))
                .expect("report opens a round");

            assert_ok!(Oracle::ack_observed(
                RuntimeOrigin::signed(watchtower.clone()),
                C,
                E,
                V,
                round.round,
                round.report_hash,
            ));
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[(watchtower.clone(), CrankClass::OracleLine)]
                )
            });

            assert_noop!(
                Oracle::ack_observed(
                    RuntimeOrigin::signed(watchtower.clone()),
                    C,
                    E,
                    V,
                    round.round,
                    round.report_hash,
                ),
                pallet_oracle::Error::<DispatchTest>::DuplicateAck
            );
            REBATES.with(|rebates| {
                assert_eq!(&*rebates.borrow(), &[(watchtower, CrankClass::OracleLine)])
            });
        });
    }

    #[test]
    fn recompute_rebates_exactly_once_only_after_resolution() {
        new_ext().execute_with(|| {
            let reporter = AccountId32::new([1; 32]);
            let keeper = AccountId32::new([5; 32]);
            let proof = proof_for(reported_value());
            assert_ok!(Oracle::note_recomputable(C, V));
            assert_ok!(Oracle::register_reporter(RuntimeOrigin::signed(
                reporter.clone()
            )));
            assert_ok!(Oracle::report(
                RuntimeOrigin::signed(reporter),
                C,
                E,
                V,
                reported_value(),
                hash_evidence(&proof)
            ));
            assert_ok!(Oracle::recompute_proof(
                RuntimeOrigin::signed(keeper.clone()),
                C,
                E,
                V,
                proof_arg(proof.clone())
            ));
            REBATES.with(|rebates| {
                assert_eq!(
                    &*rebates.borrow(),
                    &[(keeper.clone(), CrankClass::OracleLine)]
                )
            });

            assert_noop!(
                Oracle::recompute_proof(RuntimeOrigin::signed(keeper), C, E, V, proof_arg(proof)),
                Error::<DispatchTest>::RoundNotFound
            );
            REBATES.with(|rebates| assert_eq!(rebates.borrow().len(), 1));
        });
    }

    mod unit_dispatcher {
        use super::*;

        type Block = frame_system::mocking::MockBlock<NoDispatchTest>;

        frame_support::construct_runtime!(
            pub enum NoDispatchTest {
                System: frame_system,
                Oracle: pallet_oracle,
            }
        );

        #[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
        impl frame_system::Config for NoDispatchTest {
            type Block = Block;
            type AccountId = AccountId32;
            type Lookup = IdentityLookup<AccountId32>;
        }

        impl pallet_oracle::Config for NoDispatchTest {
            type AdjudicationOrigin = frame_system::EnsureRoot<AccountId32>;
            type Reporting = DispatchReporting;
            type Params = DispatchParams;
            type Custody = ();
            type MaxRoundCloseBatch = MaxRoundCloseBatch;
            type ProbeDispatch = ();
            type ProbeTimeoutSink = ();
            type ReserveHealthSink = ();
            type KeeperRebate = RecordingKeeperRebate;
            type WeightInfo = ();
            #[cfg(feature = "runtime-benchmarks")]
            type BenchmarkHelper = NoDispatchBenchmarkHelper;
        }

        #[cfg(feature = "runtime-benchmarks")]
        pub struct NoDispatchBenchmarkHelper;

        #[cfg(feature = "runtime-benchmarks")]
        impl pallet_oracle::BenchmarkHelper<RuntimeOrigin> for NoDispatchBenchmarkHelper {
            fn adjudication_origin() -> RuntimeOrigin {
                RuntimeOrigin::root()
            }

            fn prime_reporting(_: MetricId, _: EpochId, _: MetricSpecVersion) {}
        }

        fn new_ext() -> sp_io::TestExternalities {
            let storage = RuntimeGenesisConfig {
                system: Default::default(),
                oracle: Default::default(),
            }
            .build_storage()
            .expect("no-dispatch test genesis must build");
            let mut ext = sp_io::TestExternalities::new(storage);
            ext.execute_with(|| {
                System::set_block_number(1);
                REBATES.with(|rebates| rebates.borrow_mut().clear());
            });
            ext
        }

        #[test]
        fn unavailable_dispatcher_refuses_before_creating_health_work() {
            new_ext().execute_with(|| {
                let keeper = AccountId32::new([9; 32]);
                System::set_block_number(u64::from(RES_PROBE_INTERVAL));
                assert_noop!(
                    Oracle::crank_reserve_probe(RuntimeOrigin::signed(keeper)),
                    Error::<NoDispatchTest>::ProbeUnavailable
                );
                assert_eq!(
                    pallet_oracle::ReserveHealth::<NoDispatchTest>::get().last_query_id,
                    0
                );
                assert!(!Oracle::reserve_probe_armed());
                REBATES.with(|rebates| assert!(rebates.borrow().is_empty()));
            });
        }
    }
}

#[test]
fn reserve_probe_first_ready_call_arms_immediately_and_anchors_cadence() {
    // limit-coverage: res.probe_int
    new_test_ext().execute_with(|| {
        // The first readiness-qualified call does not wait for one interval:
        // it opens query 1 now and makes this block the cadence anchor.
        set_block(1);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert!(Oracle::reserve_probe_armed());
        assert_eq!(ReserveHealth::<Test>::get().last_query_id, 1);
        assert_eq!(ReserveHealth::<Test>::get().pending_since, Some(1));
        assert_eq!(ReserveHealth::<Test>::get().consecutive_fails, 0);
        assert_eq!(ProbeTimeoutCount::get(), 0);
        assert_ok!(Oracle::reserve_probe_result(1, true));

        // Amend the interval and observe the next boundary move from the first
        // successful send's block, not from genesis block zero.
        let mut amended = ParamsValue::get();
        amended.probe_interval = RES_PROBE_INTERVAL + 100;
        ParamsValue::set(amended);
        let next_due = 1u32.saturating_add(amended.probe_interval);
        set_block(next_due - 1);
        assert_noop!(
            Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))),
            Error::<Test>::ProbeTooEarly
        );
        set_block(next_due);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
    });
}

#[test]
fn reserve_probe_first_late_arm_opens_current_attempt_without_scoring_prearm_slots() {
    new_test_ext().execute_with(|| {
        ProbeDispatchLive::set(true);
        set_block(RES_PROBE_INTERVAL.saturating_mul(300));

        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));

        let health = ReserveHealth::<Test>::get();
        assert_eq!(health.consecutive_fails, 0);
        assert!(!health.unhealthy);
        assert_eq!(health.last_query_id, 1);
        assert_eq!(
            health.pending_since,
            Some(RES_PROBE_INTERVAL.saturating_mul(300))
        );
        assert!(Oracle::reserve_probe_armed());
        assert_eq!(ProbeDispatches::get().len(), 1);
        assert_eq!(ProbeTimeoutCount::get(), 0);
        assert!(ReserveHealthSinkCalls::get().is_empty());
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reserve_probe_late_keeper_scores_every_post_arm_missed_slot_in_one_bounded_fold() {
    new_test_ext().execute_with(|| {
        ProbeDispatchLive::set(true);
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(1, true));
        ReserveHealthSinkCalls::set(Vec::new());
        set_block(RES_PROBE_INTERVAL.saturating_mul(4));

        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));

        let health = ReserveHealth::<Test>::get();
        assert_eq!(health.consecutive_fails, 2);
        assert!(health.unhealthy);
        assert_eq!(health.last_query_id, 2);
        assert_eq!(
            health.pending_since,
            Some(RES_PROBE_INTERVAL.saturating_mul(4))
        );
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);
        assert_eq!(ProbeDispatches::get().len(), 2);
        assert_eq!(ProbeTimeoutCount::get(), 0);
    });
}

#[test]
fn reserve_probe_long_post_arm_outage_saturates_in_one_bounded_fold() {
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(1, true));
        ReserveHealthSinkCalls::set(Vec::new());
        set_block(RES_PROBE_INTERVAL.saturating_mul(301));

        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));

        let health = ReserveHealth::<Test>::get();
        assert_eq!(health.consecutive_fails, u8::MAX);
        assert!(health.unhealthy);
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);
        assert_eq!(ProbeDispatches::get().len(), 2);
    });
}

#[test]
fn reserve_probe_exhausted_query_namespace_scores_every_unopenable_slot() {
    new_test_ext().execute_with(|| {
        ReserveProbeArmed::<Test>::put(true);
        ReserveHealth::<Test>::put(oracle_core::ReserveHealth {
            consecutive_fails: 0,
            consecutive_passes: 0,
            unhealthy: false,
            last_query_id: oracle_core::MAX_RESERVE_PROBE_QUERY_ID,
            last_probe_at: RES_PROBE_INTERVAL,
            pending_since: None,
        });
        set_block(RES_PROBE_INTERVAL.saturating_mul(3));
        System::reset_events();

        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert!(Oracle::reserve_probe_armed());

        let health = ReserveHealth::<Test>::get();
        assert_eq!(
            health.last_query_id,
            oracle_core::MAX_RESERVE_PROBE_QUERY_ID
        );
        assert_eq!(health.last_probe_at, RES_PROBE_INTERVAL.saturating_mul(3));
        assert_eq!(health.pending_since, None);
        assert_eq!(health.consecutive_fails, 2);
        assert!(health.unhealthy);
        assert!(ProbeDispatches::get().is_empty());
        assert_eq!(ProbeTimeoutCount::get(), 0);
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);
        assert!(!System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::Oracle(Event::ReserveProbeSent { .. })
        )));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reserve_probe_exhaustion_commits_expired_pending_and_all_due_slots() {
    new_test_ext().execute_with(|| {
        ReserveProbeArmed::<Test>::put(true);
        ReserveHealth::<Test>::put(oracle_core::ReserveHealth {
            consecutive_fails: 0,
            consecutive_passes: 0,
            unhealthy: false,
            last_query_id: oracle_core::MAX_RESERVE_PROBE_QUERY_ID,
            last_probe_at: RES_PROBE_INTERVAL,
            pending_since: Some(RES_PROBE_INTERVAL),
        });
        set_block(RES_PROBE_INTERVAL.saturating_mul(3));
        System::reset_events();

        // The expired prior attempt scores once, and both completed cadence
        // slots score as unopenable misses. Query-id exhaustion must not roll
        // either class of failure back or leave the stale attempt pending.
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));

        let health = ReserveHealth::<Test>::get();
        assert_eq!(
            health.last_query_id,
            oracle_core::MAX_RESERVE_PROBE_QUERY_ID
        );
        assert_eq!(health.last_probe_at, RES_PROBE_INTERVAL.saturating_mul(3));
        assert_eq!(health.pending_since, None);
        assert_eq!(health.consecutive_fails, 3);
        assert!(health.unhealthy);
        assert_eq!(ProbeTimeoutCount::get(), 1);
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);
        assert!(ProbeDispatches::get().is_empty());
        assert!(!System::events().iter().any(|record| matches!(
            &record.event,
            RuntimeEvent::Oracle(Event::ReserveProbeSent { .. })
        )));

        // The cadence anchor advanced, so retrying the same block is bounded
        // and cannot rescore the old outage. A newly elapsed slot scores once.
        assert_noop!(
            Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))),
            Error::<Test>::ProbeTooEarly
        );
        set_block(RES_PROBE_INTERVAL.saturating_mul(4));
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let later = ReserveHealth::<Test>::get();
        assert_eq!(later.consecutive_fails, 4);
        assert_eq!(later.last_probe_at, RES_PROBE_INTERVAL.saturating_mul(4));
        assert_eq!(ProbeTimeoutCount::get(), 1);
        assert!(ProbeDispatches::get().is_empty());
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reserve_probe_timeout_longer_than_interval_never_overwrites_pending() {
    new_test_ext().execute_with(|| {
        let mut amended = ParamsValue::get();
        amended.probe_timeout = amended.probe_interval.saturating_mul(2);
        ParamsValue::set(amended);
        set_block(amended.probe_interval);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let pending = ReserveHealth::<Test>::get();

        set_block(amended.probe_interval.saturating_mul(2));
        assert_noop!(
            Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))),
            Error::<Test>::ProbeTooEarly
        );
        assert_eq!(ReserveHealth::<Test>::get(), pending);

        set_block(amended.probe_interval.saturating_mul(3));
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let folded = ReserveHealth::<Test>::get();
        assert_eq!(folded.last_query_id, 2);
        // One failure for the timed-out first attempt and one for the cadence
        // slot at 2×interval that could not open while it remained pending.
        assert_eq!(folded.consecutive_fails, 2);
        assert_eq!(ProbeTimeoutCount::get(), 1);
    });
}

#[test]
fn reserve_probe_zero_interval_and_timeout_remain_bounded_and_fail_static() {
    new_test_ext().execute_with(|| {
        set_block(1);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(1, true));

        let mut amended = ParamsValue::get();
        amended.probe_interval = 0;
        amended.probe_timeout = 0;
        ParamsValue::set(amended);
        set_block(2);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_eq!(ReserveHealth::<Test>::get().last_query_id, 2);

        set_block(3);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let health = ReserveHealth::<Test>::get();
        assert_eq!(health.last_query_id, 3);
        assert_eq!(health.consecutive_fails, 1);
        assert_eq!(ProbeTimeoutCount::get(), 1);
    });
}

#[test]
fn reserve_probe_first_arm_rejects_each_structurally_zero_field() {
    let mut cases = Vec::new();
    let defaults = OracleParams::DEFAULT;
    let mut params = defaults;
    params.probe_interval = 0;
    cases.push(params);
    params = defaults;
    params.probe_timeout = 0;
    cases.push(params);
    params = defaults;
    params.probe_amount = 0;
    cases.push(params);
    params = defaults;
    params.fail_threshold = 0;
    cases.push(params);
    params = defaults;
    params.recover_threshold = 0;
    cases.push(params);

    for params in cases {
        new_test_ext().execute_with(|| {
            ParamsValue::set(params);
            set_block(1);
            assert_noop!(
                Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))),
                Error::<Test>::ProbeUnavailable
            );
            assert!(!Oracle::reserve_probe_armed());
            assert_eq!(ReserveHealth::<Test>::get(), Default::default());
            assert!(ProbeDispatches::get().is_empty());
        });
    }
}

#[test]
fn reserve_probe_invalid_live_threshold_cannot_turn_pending_response_into_health() {
    new_test_ext().execute_with(|| {
        set_block(1);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let mut amended = ParamsValue::get();
        amended.recover_threshold = 0;
        ParamsValue::set(amended);

        assert_ok!(Oracle::reserve_probe_result(1, true));
        let health = ReserveHealth::<Test>::get();
        assert_eq!(health.consecutive_passes, 0);
        assert_eq!(health.consecutive_fails, 1);
        assert!(!health.unhealthy);
    });
}

#[test]
fn reserve_probe_first_send_emits_query_one() {
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        System::reset_events();
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_eq!(ReserveHealth::<Test>::get().last_query_id, 1);
        System::assert_has_event(Event::ReserveProbeSent { query_id: 1 }.into());
        assert!(!Oracle::reserve_unhealthy());
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reserve_probe_dispatch_uses_live_probe_amount() {
    new_test_ext().execute_with(|| {
        let mut amended = ParamsValue::get();
        amended.probe_amount = OracleParams::DEFAULT.probe_amount.saturating_add(77);
        ParamsValue::set(amended);
        ProbeDispatchLive::set(true);
        set_block(amended.probe_interval);

        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_eq!(ProbeDispatches::get(), vec![(1, amended.probe_amount)]);
    });
}

#[test]
fn reserve_probe_arm_latch_never_disables_fail_static_dispatch() {
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert!(Oracle::reserve_probe_armed());
        assert_ok!(Oracle::reserve_probe_result(1, true));

        // `live()` is only the first-arm readiness gate. Once armed, a later
        // loss of budget/readiness must still open an attempt which can timeout.
        ProbeDispatchLive::set(false);
        set_block(RES_PROBE_INTERVAL * 2);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_eq!(
            ReserveHealth::<Test>::get().pending_since,
            Some(RES_PROBE_INTERVAL * 2)
        );
        assert_eq!(ProbeDispatches::get().len(), 2);
        assert!(Oracle::reserve_probe_armed());
    });
}

#[test]
fn reserve_health_latches_read_live_fail_and_recover_thresholds() {
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let mut amended = ParamsValue::get();
        amended.fail_threshold = 1;
        ParamsValue::set(amended);
        assert_ok!(Oracle::reserve_probe_result(1, false));
        assert!(Oracle::reserve_unhealthy());

        set_block(RES_PROBE_INTERVAL * 2);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        amended.recover_threshold = 1;
        ParamsValue::set(amended);
        assert_ok!(Oracle::reserve_probe_result(2, true));
        assert!(!Oracle::reserve_unhealthy());
    });
}

#[test]
fn reserve_probe_result_reads_live_timeout() {
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let mut amended = ParamsValue::get();
        amended.probe_timeout = 5;
        amended.fail_threshold = 1;
        ParamsValue::set(amended);

        // A success at the amended half-open timeout boundary counts as fail.
        set_block(RES_PROBE_INTERVAL + amended.probe_timeout);
        assert_ok!(Oracle::reserve_probe_result(1, true));
        assert!(Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealth::<Test>::get().consecutive_fails, 1);
    });
}

#[test]
fn reserve_probe_crank_folds_at_live_timeout_boundary() {
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let mut amended = ParamsValue::get();
        amended.probe_timeout = 5;
        ParamsValue::set(amended);

        set_block(RES_PROBE_INTERVAL + amended.probe_timeout);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let health = ReserveHealth::<Test>::get();
        assert_eq!(health.pending_since, None);
        assert_eq!(health.consecutive_fails, 1);
        assert_eq!(ProbeTimeoutCount::get(), 1);
    });
}

#[test]
fn reserve_probe_two_consecutive_fails_go_unhealthy() {
    // 07 §8: `res.fail_threshold = 2` consecutive failed probes ⇒ unhealthy.
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(1, false));
        assert!(!Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealth::<Test>::get().consecutive_fails, 1);
        assert_eq!(ProbeTimeoutCount::get(), 0);

        set_block(RES_PROBE_INTERVAL * 2);
        System::reset_events();
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(2, false));
        assert!(Oracle::reserve_unhealthy());
        // Response-driven failures are not timeout folds and never notify the
        // timeout sink (07 §8; 09 §6.4).
        assert_eq!(ProbeTimeoutCount::get(), 0);
        System::assert_has_event(Event::ReserveUnhealthy.into());
        System::assert_has_event(
            Event::ReserveProbeResult {
                query_id: 2,
                passed: false,
            }
            .into(),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reserve_probe_three_consecutive_passes_recover() {
    // 07 §8: `res.recover_threshold = 3` consecutive passes clears the state.
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(1, false));
        set_block(RES_PROBE_INTERVAL * 2);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(2, false));
        assert!(Oracle::reserve_unhealthy());

        System::reset_events();
        for i in 3..=5u64 {
            set_block(RES_PROBE_INTERVAL * i as u32);
            assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
            assert_ok!(Oracle::reserve_probe_result(i, true));
        }
        assert!(!Oracle::reserve_unhealthy());
        System::assert_has_event(Event::ReserveRecovered.into());
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reserve_probe_result_for_unknown_or_stale_query_is_rejected() {
    // 07 §8/§13: an unknown or already-consumed `query_id` is dropped and never
    // moves the fail-static state (mirror of `reserve_probe_results_count_once`).
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        // Wrong id: no state move.
        assert_noop!(
            Oracle::reserve_probe_result(999, false),
            Error::<Test>::UnknownQuery
        );
        assert_eq!(ReserveHealth::<Test>::get().consecutive_fails, 0);
        // Consume the live probe, then a replay of it is rejected too.
        assert_ok!(Oracle::reserve_probe_result(1, false));
        assert_noop!(
            Oracle::reserve_probe_result(1, false),
            Error::<Test>::UnknownQuery
        );
        assert_eq!(ReserveHealth::<Test>::get().consecutive_fails, 1);
    });
}

#[test]
fn reserve_probe_timeout_fold_counts_an_unanswered_probe_as_a_fail() {
    // 07 §8: a probe still unanswered when the next crank fires past
    // `res.probe_timeout` counts as a fail (absence is never healthy). Two such
    // timeouts, with no `QueryResponse` at all, reach the unhealthy state.
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9)))); // probe 1 pending
        assert_eq!(ProbeTimeoutCount::get(), 0);

        set_block(RES_PROBE_INTERVAL * 2);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9)))); // probe 1 times out, probe 2 sent
        assert!(!Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealth::<Test>::get().consecutive_fails, 1);
        assert_eq!(ProbeTimeoutCount::get(), 1);

        set_block(RES_PROBE_INTERVAL * 3);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9)))); // probe 2 times out
        assert!(Oracle::reserve_unhealthy());
        assert_eq!(ProbeTimeoutCount::get(), 2);
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 10. Per-version games (SQ-2; 07 §2(4) — one game per frozen spec version)
// =========================================================================

#[test]
fn per_version_games_settle_independently_across_an_activation_boundary() {
    // 07 §2(4): where two live cohorts consume the same `(component, epoch)`
    // under different frozen versions, one game runs per version; settling one
    // must not settle or shadow the other, and each lands its own triple entry.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(Oracle::note_recomputable(C, 3));
        assert_ok!(Oracle::note_recomputable(C, 4));
        ExpectedSpecs::set(vec![3, 4]);
        // Version-3 game.
        let proof3 = proof_for(reported_value());
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            3,
            reported_value(),
            hash_evidence(&proof3)
        ));
        // Version-4 game opens independently while v3 is live.
        let v4_value = FixedU64(500_000_000);
        let proof4 = proof_for(v4_value);
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            4,
            v4_value,
            hash_evidence(&proof4)
        ));

        assert!(Rounds::<Test>::get((C, E, 3)).is_some());
        assert!(Rounds::<Test>::get((C, E, 4)).is_some());

        // Settle only v3 (recompute — F10 makes adjudicate terminal-only).
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            3,
            proof_arg(proof3)
        ));
        assert!(Oracle::settled_component(C, E, 3).is_some());
        assert!(Oracle::settled_component(C, E, 4).is_none()); // not shadowed
        assert!(Rounds::<Test>::get((C, E, 4)).is_some()); // still live

        // v4 settles on its own track ⇒ two distinct triple entries.
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            4,
            proof_arg(proof4)
        ));
        assert_eq!(
            Oracle::settled_component(C, E, 3).unwrap().value,
            reported_value()
        );
        assert_eq!(Oracle::settled_component(C, E, 4).unwrap().value, v4_value);

        // A repeat report for a settled version stays final.
        ExpectedSpecs::set(vec![3]);
        assert_noop!(
            Oracle::report(RuntimeOrigin::signed(acc(1)), C, E, 3, FixedU64(1), h(9)),
            Error::<Test>::AlreadyFinal
        );
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 11. Origin misuse across the Signed call surface (15 §4.1; rule 6)
// =========================================================================

#[test]
fn signed_calls_reject_unsigned_origin() {
    // Every reporter/watchtower/keeper call is ordinary `Signed` (07 §3/§4/§5;
    // `ValidateUnsigned` is implemented for no call) — an unsigned origin is
    // `BadOrigin` before any state is touched.
    new_test_ext().execute_with(|| {
        assert_noop!(
            Oracle::register_reporter(RuntimeOrigin::none()),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::deregister_reporter(RuntimeOrigin::none()),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::report(RuntimeOrigin::none(), C, E, V, reported_value(), h(9)),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::challenge(RuntimeOrigin::none(), C, E, V, counter_value(), h(10)),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::recompute_proof(RuntimeOrigin::none(), C, E, V, ProofArg::default()),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::register_watchtower(RuntimeOrigin::none()),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::ack_observed(RuntimeOrigin::none(), C, E, V, 1, h(9)),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::crank_round_close(RuntimeOrigin::none(), 20),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::crank_reserve_probe(RuntimeOrigin::none()),
            DispatchError::BadOrigin
        );
    });
}

// =========================================================================
// 12. try_state (15 §1; I-18 — only challenge-closed values settle money)
// =========================================================================

#[test]
fn try_state_holds_across_the_representative_lifecycle() {
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::do_try_state()); // empty genesis
        register_reporter(1);
        assert_ok!(Oracle::note_recomputable(C, V));
        let proof = proof_for(reported_value());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&proof)));
        assert_ok!(Oracle::do_try_state()); // post-report

        // Settle via recompute (F10 makes adjudicate terminal-only).
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            V,
            proof_arg(proof)
        ));
        assert_ok!(Oracle::do_try_state()); // post-settle

        // A second key walks the neutral path.
        assert_ok!(do_report(1, E + 1, reported_value(), h(9)));
        set_block(1 + ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20)); // extend
        let ext = Rounds::<Test>::get((C, E + 1, V))
            .unwrap()
            .challenge_deadline;
        set_block(ext);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20)); // neutral
        assert_ok!(Oracle::do_try_state()); // post-neutral

        set_block(ext + RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(1, true));
        assert_ok!(Oracle::do_try_state()); // post-probe
    });
}

#[test]
fn try_state_requires_v1_but_does_not_infer_arming_from_a_legacy_query_id() {
    new_test_ext().execute_with(|| {
        ReserveHealth::<Test>::mutate(|health| health.last_query_id = 7);
        assert!(!Oracle::reserve_probe_armed());
        assert_ok!(Oracle::do_try_state());

        StorageVersion::new(0).put::<Oracle>();
        assert!(Oracle::do_try_state().is_err());
        StorageVersion::new(1).put::<Oracle>();
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn try_state_rejects_armed_probe_without_an_opened_v1_query_id() {
    new_test_ext().execute_with(|| {
        ReserveProbeArmed::<Test>::put(true);
        assert_eq!(ReserveHealth::<Test>::get().last_query_id, 0);
        assert_eq!(
            Oracle::do_try_state(),
            Err(sp_runtime::TryRuntimeError::Other(
                "ReserveProbeArmed requires an opened v1 probe id"
            ))
        );
    });
}

/// Build a well-formed round for corrupt-state injection (valid up to the
/// invariant being violated).
fn valid_round(round: u8) -> RoundState {
    let stake = StakeAtRiskValue::get();
    RoundState {
        component: C,
        epoch: E,
        round,
        spec_version: V,
        reporter: raw(1),
        value: reported_value(),
        evidence_hash: h(9),
        bond: bond(round),
        challenge_deadline: 0,
        extended: false,
        challenger: None,
        counter_value: None,
        acks: 0,
        report_hash: h(0),
        stake_at_risk: stake,
        cumulative_reporter_bond: bond(round),
        cumulative_challenger_bond: 0,
    }
}

fn valid_schedule() -> StoredRoundSchedule {
    StoredRoundSchedule {
        round_one_bond: bond(1),
        round_cap: ORC_ROUNDS,
    }
}

fn insert_round_with_schedule(round: RoundState) {
    Rounds::<Test>::insert((round.component, round.epoch, round.spec_version), round);
    RoundSchedules::<Test>::insert(
        (round.component, round.epoch, round.spec_version),
        valid_schedule(),
    );
}

#[test]
fn try_state_rejects_an_out_of_range_round() {
    // 07 §13 machine invariant: every live round is in its frozen cap.
    new_test_ext().execute_with(|| {
        assert_ok!(Oracle::do_try_state());
        let mut bad = valid_round(1);
        bad.round = 5; // out of `1..=3`
        insert_round_with_schedule(bad);
        assert!(Oracle::do_try_state().is_err());
    });
}

#[test]
fn try_state_rejects_a_bond_outside_the_frozen_schedule() {
    new_test_ext().execute_with(|| {
        let mut bad = valid_round(2);
        bad.bond = bad.bond.saturating_add(1);
        insert_round_with_schedule(bad);
        assert!(Oracle::do_try_state().is_err());
    });
}

#[test]
fn try_state_rejects_a_round_cap_outside_the_kernel_envelope() {
    new_test_ext().execute_with(|| {
        Rounds::<Test>::insert((C, E, V), valid_round(1));
        RoundSchedules::<Test>::insert(
            (C, E, V),
            StoredRoundSchedule {
                round_one_bond: bond(1),
                round_cap: futarchy_primitives::kernel::ORC_ROUNDS_MAX.saturating_add(1),
            },
        );
        assert!(Oracle::do_try_state().is_err());
    });
}

#[test]
fn try_state_rejects_a_live_round_without_its_frozen_schedule() {
    new_test_ext().execute_with(|| {
        Rounds::<Test>::insert((C, E, V), valid_round(1));
        assert!(Oracle::do_try_state().is_err());
    });
}

#[test]
fn try_state_rejects_a_frozen_schedule_without_its_live_round() {
    new_test_ext().execute_with(|| {
        RoundSchedules::<Test>::insert((C, E, V), valid_schedule());
        assert!(Oracle::do_try_state().is_err());
    });
}

#[test]
fn try_state_rejects_a_live_round_for_a_settled_key() {
    // I-18 (07 §13): no live round may survive for an already-settled
    // `(component, epoch, version)`, or a second settlement could shadow the
    // final value.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        settle_recomputed(1, E); // F10: settle without adjudicate
        assert_ok!(Oracle::do_try_state()); // settled, no live round

        // Inject a live round shadowing the settled entry.
        insert_round_with_schedule(valid_round(1));
        assert!(Oracle::do_try_state().is_err());
    });
}

// =========================================================================
// 13. Genesis (07 §2(4)/§9 recomputable seed; default emptiness)
// =========================================================================

#[test]
fn genesis_recomputable_seed_enables_recompute_at_dispatch() {
    let genesis = crate::GenesisConfig::<Test> {
        recomputable_components: vec![(C, V)],
        ..Default::default()
    };
    new_test_ext_with(genesis).execute_with(|| {
        register_reporter(1);
        let proof = proof_for(reported_value());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&proof)));
        // Seeded at genesis ⇒ recompute is admissible (contrast:
        // `recompute_proof_non_recomputable_component_is_rejected`).
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            V,
            proof_arg(proof)
        ));
        assert_eq!(
            Oracle::settled_component(C, E, V).unwrap().path,
            SettlePath::Recomputed
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn default_genesis_is_empty_and_reserve_is_healthy() {
    new_test_ext().execute_with(|| {
        assert_eq!(Reporters::<Test>::count(), 0);
        assert_eq!(Watchtowers::<Test>::count(), 0);
        assert!(Recomputable::<Test>::get().is_empty());
        assert!(!Oracle::reserve_unhealthy());
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 14. Read/reap accessors for sibling pallets (07 §13; A8/B1a wiring)
// =========================================================================

#[test]
fn settled_component_reads_and_reap_clears_the_entry() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(Oracle::note_recomputable(C, V));
        let proof = proof_for(reported_value());
        assert_ok!(do_report(1, E, reported_value(), hash_evidence(&proof)));
        assert!(Oracle::settled_component(C, E, V).is_none()); // not yet settled
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            V,
            proof_arg(proof)
        ));
        assert!(Oracle::settled_component(C, E, V).is_some());
        Oracle::reap_component(C, E, V);
        assert!(Oracle::settled_component(C, E, V).is_none());
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 15. Watchtower liveness discipline (07 §4 — epoch-boundary sweep)
// =========================================================================
// `note_epoch_boundary(ended_epoch)` is runtime-internal (the epoch pallet drives
// it at B1a); it is called directly here, not as an extrinsic. The just-ended
// epoch's activity set is `WatchtowerActive`.
//
// 07 §4's "an epoch with ≥ 1 open round" is *derived* from oracle state, not
// supplied by the caller (SQ-491) — the epoch clock knows the schedule, not the
// round history — so each test below arranges the predicate it needs:
// `open_and_close_game` / `open_live_game` for a chargeable epoch, and simply
// nothing for an exempt one. `RoundActivity` is the cross-call latch, so these
// tests also exercise its hydrate/persist round trip through storage.

/// The block at which `epoch`'s liveness fixture opens its game: one full
/// `orc.window + orc.ext_window` lane per epoch (plus slack), so a game's whole
/// quorum-failure closure lands before the next game opens.
fn game_open_block(epoch: EpochId) -> BlockNumber {
    1 + epoch * (ORC_WINDOW_BLOCKS + ORC_EXT_WINDOW_BLOCKS + 2)
}

/// Open a game for `(C, epoch, V)` and leave it **live**, returning its
/// `report_hash`. The mock's report window is a constant, so it is moved to this
/// game's opening block for the duration of the report — which therefore also
/// lands on the last admissible block of its window (07 §5.1 admits
/// `now <= report_window_end`) — and restored, since `new_test_ext` does not
/// reset that static and no other test may inherit a widened window.
fn open_live_game(reporter: u8, epoch: EpochId) -> H256 {
    let at = game_open_block(epoch);
    let window = ReportWindowEnd::get();
    ReportWindowEnd::set(at);
    set_block(at);
    assert_ok!(do_report(reporter, epoch, reported_value(), h(9)));
    ReportWindowEnd::set(window);
    hash_report(C, epoch, 1, reported_value(), h(9))
}

/// Arrange a chargeable 07 §4 epoch: a game opens **and closes inside it**, on
/// the quorum-failure path (no acknowledgments ⇒ one `orc.ext_window` extension,
/// then the §10 neutral settlement). No watchtower is acknowledged, so none is
/// marked active, and `Rounds` is empty again at the boundary — the state in
/// which only the `RoundActivity` latch records that the epoch carried work.
fn open_and_close_game(reporter: u8, epoch: EpochId) {
    let at = game_open_block(epoch);
    open_live_game(reporter, epoch);
    set_block(at + ORC_WINDOW_BLOCKS);
    assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
    set_block(at + ORC_WINDOW_BLOCKS + ORC_EXT_WINDOW_BLOCKS);
    assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
    assert!(
        Rounds::<Test>::get((C, epoch, V)).is_none(),
        "the quorum-failure close reaps the round"
    );
}

#[test]
fn watchtower_liveness_registration_grace_charges_nothing() {
    // 07 §4: a watchtower is active for the epoch it registered in — the first
    // sweep does not charge it, and the activity set clears afterward. The epoch
    // is genuinely chargeable (a game ran in it) and a seat already past its
    // grace pays in the very same sweep, so it is grace that spares the new seat
    // and not the no-open-round exemption.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(3);
        open_and_close_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // consumes seat 3's grace

        register_watchtower(2);
        // Registration marked the seat active for the current epoch.
        assert!(WatchtowerActive::<Test>::get().contains(&raw(2)));
        open_and_close_game(1, 2);

        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(2, true));
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 0);
        assert!(!oracle_events().iter().any(|e| matches!(
            e,
            Event::WatchtowerInactive { who, .. } if *who == acc(2)
        )));
        // Same epoch, same absence of acknowledgments: the seat past grace pays.
        assert_eq!(Watchtowers::<Test>::get(acc(3)).unwrap().inactive_epochs, 1);
        assert!(WatchtowerActive::<Test>::get().is_empty()); // swept clean
        assert!(!RoundActivity::<Test>::get()); // and the epoch's record consumed
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn watchtower_liveness_inactive_epoch_accrues_and_emits() {
    // 07 §4: a watchtower that acknowledges no round in an epoch that carried an
    // open round is marked inactive for that epoch.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        open_and_close_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // grace consumed

        open_and_close_game(1, 2);
        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(2, true));
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 1);
        assert_eq!(
            oracle_events(),
            vec![Event::WatchtowerInactive {
                who: acc(2),
                epoch: 2,
            }]
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn watchtower_liveness_second_consecutive_miss_slashes_and_ejects() {
    // 07 §4: two consecutive inactive epochs slash 10 % of `wt.stake` and eject.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        open_and_close_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // grace
        open_and_close_game(1, 2);
        assert_ok!(Oracle::note_epoch_boundary(2, true)); // inactive #1
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 1);

        let mut amended = ParamsValue::get();
        amended.watchtower_stake = WT_STAKE.saturating_add(1);
        ParamsValue::set(amended);
        register_watchtower(3);
        open_and_close_game(1, 3);
        System::reset_events();
        let released_before = CustodyReleased::get();
        let slashed_before = CustodySlashed::get();
        assert_ok!(Oracle::note_epoch_boundary(3, true)); // inactive #2 ⇒ slash + eject
        assert!(oracle_events().iter().any(|e| matches!(
            e,
            Event::WatchtowerSlashed { who, amount }
                if *who == acc(2) && *amount == WT_STAKE / 10
        )));
        assert_eq!(Watchtowers::<Test>::count(), 1);
        assert!(Watchtowers::<Test>::get(acc(2)).is_none());
        assert_eq!(CustodySlashed::get() - slashed_before, WT_STAKE / 10);
        assert_eq!(
            CustodyReleased::get() - released_before,
            WT_STAKE - WT_STAKE / 10
        );

        open_and_close_game(1, 4);
        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(4, true)); // amended seat inactive #1
        open_and_close_game(1, 5);
        assert_ok!(Oracle::note_epoch_boundary(5, true)); // amended seat slash + eject
        assert!(oracle_events().iter().any(|e| matches!(
            e,
            Event::WatchtowerSlashed { who, amount }
                if *who == acc(3)
                    && *amount == (amended.watchtower_stake / 10).saturating_add(1)
        )));
        assert_eq!(Watchtowers::<Test>::count(), 0);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn watchtower_liveness_acknowledgment_resets_the_counter() {
    // 07 §4: a watchtower active this epoch (it acknowledged a round) has its
    // inactivity counter reset — verified by moving a genuinely non-zero counter
    // back to 0 rather than merely holding it there.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        open_and_close_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // grace
        open_and_close_game(1, 2);
        assert_ok!(Oracle::note_epoch_boundary(2, true)); // inactive #1
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 1);

        // The watchtower does its job next epoch: acknowledge a live round.
        let rh = open_live_game(1, 3);
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            3,
            V,
            1,
            rh
        ));

        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(3, true));
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 0); // reset
        assert_eq!(Watchtowers::<Test>::count(), 1); // not ejected
        assert!(!oracle_events().iter().any(|e| matches!(
            e,
            Event::WatchtowerInactive { .. } | Event::WatchtowerSlashed { .. }
        )));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn watchtower_liveness_no_open_round_epoch_charges_nobody() {
    // 07 §4: an epoch with no open round is not a liveness failure — a genuinely
    // idle (non-active) watchtower is exempt when the epoch carried no round at
    // all: none opened in it (`RoundActivity` clear) and none is open (`Rounds`
    // empty).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        open_and_close_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // grace clears the active set

        // No game opened in epoch 2 (no `report` since the boundary) and none is
        // open.
        assert_eq!(Rounds::<Test>::iter().count(), 0);
        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(2, true)); // idle, but no open round
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 0);
        assert_eq!(Watchtowers::<Test>::count(), 1);
        assert!(!oracle_events()
            .iter()
            .any(|e| matches!(e, Event::WatchtowerInactive { .. })));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn watchtower_liveness_no_open_round_breaks_the_inactivity_streak() {
    // Codex F5 / 07 §4: an epoch with no open round resets the inactivity
    // counter, breaking the "two *consecutive*" streak — so a miss on either side
    // of an exempt epoch cannot combine to force a slash.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        open_and_close_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // grace
        open_and_close_game(1, 2);
        assert_ok!(Oracle::note_epoch_boundary(2, true)); // miss #1 ⇒ inactive 1
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 1);

        // Epoch 3 carries no round at all ⇒ exempt.
        assert_eq!(Rounds::<Test>::iter().count(), 0);
        assert_ok!(Oracle::note_epoch_boundary(3, true)); // exempt ⇒ streak resets
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 0);

        open_and_close_game(1, 4);
        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(4, true)); // a fresh miss #1, not #2
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 1);
        assert_eq!(Watchtowers::<Test>::count(), 1); // not ejected
        assert!(!oracle_events()
            .iter()
            .any(|e| matches!(e, Event::WatchtowerSlashed { .. })));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn watchtower_liveness_charges_a_game_still_open_across_the_whole_epoch() {
    // 07 §4's other reading of "an epoch with ≥ 1 open round": a game opened in
    // an earlier epoch and drawing no fresh report still makes every epoch it
    // spans chargeable, so the seat that never acknowledges it pays at the
    // boundary after the one whose report opened it.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2);
        open_live_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // registration grace
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 0);

        // Epoch 2 opened no game of its own — its liveness rests entirely on the
        // round still sitting in `Rounds`.
        assert!(!RoundActivity::<Test>::get());
        assert_eq!(Rounds::<Test>::iter().count(), 1);
        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(2, true));
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 1);
        assert_eq!(
            oracle_events(),
            vec![Event::WatchtowerInactive {
                who: acc(2),
                epoch: 2,
            }]
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn watchtower_liveness_charges_idle_seat_after_a_cleanly_closed_game() {
    // 07 §4 charges "a watchtower that acknowledges no round in an epoch with
    // ≥ 1 open round" — a property of the *epoch*, not of what survives to the
    // boundary. A healthy game that opens and closes inside the epoch is reaped
    // from `Rounds`, so a survival-based predicate would read "no open round" in
    // exactly the healthy case and take the arm that RESETS the counter, leaving
    // §4's charge/slash/eject unreachable and free-riding costless (SQ-491).
    // Asserted through the pallet as well as the core, because the latch has to
    // survive the storage round trip between the report and the boundary sweep.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_watchtower(2); // acknowledges
        register_watchtower(3); // acknowledges
        register_watchtower(4); // free rider
        open_and_close_game(1, 1);
        assert_ok!(Oracle::note_epoch_boundary(1, true)); // consumes all three graces
        assert!(WatchtowerActive::<Test>::get().is_empty());

        // Epoch 2 runs the healthy path: reported, acknowledged to `wt.quorum`,
        // closed `Unchallenged` at window close, and therefore reaped.
        let rh = open_live_game(1, 2);
        // Only seats 2 and 3 acknowledge; seat 4 free-rides.
        for who in [2u8, 3] {
            assert_ok!(Oracle::ack_observed(
                RuntimeOrigin::signed(acc(who)),
                C,
                2,
                V,
                1,
                rh
            ));
        }
        set_block(game_open_block(2) + ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert_eq!(
            Oracle::settled_component(C, 2, V).map(|s| s.path),
            Some(SettlePath::Unchallenged)
        );
        assert_eq!(
            Rounds::<Test>::iter().count(),
            0,
            "the healthy close leaves no round to infer liveness from"
        );
        // The epoch's work is recorded in storage across the calls that reaped
        // the round — the latch survives the hydrate/persist round trip.
        assert!(
            RoundActivity::<Test>::get(),
            "the closed game is still recorded for the epoch that carried it"
        );

        System::reset_events();
        assert_ok!(Oracle::note_epoch_boundary(2, true));
        assert_eq!(Watchtowers::<Test>::get(acc(4)).unwrap().inactive_epochs, 1);
        assert_eq!(
            oracle_events(),
            vec![Event::WatchtowerInactive {
                who: acc(4),
                epoch: 2,
            }]
        );
        // The two that did the work are reset, not charged.
        assert_eq!(Watchtowers::<Test>::get(acc(2)).unwrap().inactive_epochs, 0);
        assert_eq!(Watchtowers::<Test>::get(acc(3)).unwrap().inactive_epochs, 0);
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 16. Component value range (Codex F15; 05 §4.4 [0,1] 1e9 grid, I-18)
// =========================================================================

#[test]
fn report_value_over_grid_max_is_out_of_bounds() {
    // Codex F15: a value above `COMPONENT_VALUE_MAX` can never be a valid settled
    // value, so `report` rejects it at the door rather than let an out-of-range
    // attestation settle unchallenged (I-18). The grid maximum itself is valid.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_noop!(
            do_report(1, E, FixedU64(COMPONENT_VALUE_MAX + 1), h(9)),
            Error::<Test>::ValueOutOfBounds
        );
        assert!(Rounds::<Test>::get((C, E, V)).is_none()); // nothing opened
        assert_ok!(do_report(1, E, FixedU64(COMPONENT_VALUE_MAX), h(9)));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn adjudicate_value_over_grid_max_is_out_of_bounds() {
    // Codex F15: the terminal verdict is itself a settled value and must lie on
    // the grid — an out-of-range verdict is rejected and settles nothing.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_noop!(
            Oracle::adjudicate(
                RuntimeOrigin::signed(oracle_resolution_acc()),
                C,
                E,
                V,
                FixedU64(COMPONENT_VALUE_MAX + 1),
                false
            ),
            Error::<Test>::ValueOutOfBounds
        );
        assert!(Oracle::settled_component(C, E, V).is_none());
        assert!(Rounds::<Test>::get((C, E, V)).is_some()); // round untouched
    });
}

// =========================================================================
// 17. Concurrent per-version games (Codex F7; 07 §2(4))
// =========================================================================

#[test]
fn concurrent_per_version_reports_coexist_without_toggling() {
    // Codex F7: with both frozen versions in the live set, a single reporter can
    // post both the version-3 and version-4 reports for one `(component, epoch)`
    // without toggling the provider — the two per-version games coexist.
    new_test_ext().execute_with(|| {
        ExpectedSpecs::set(vec![3, 4]);
        register_reporter(1);
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            3,
            reported_value(),
            h(9)
        ));
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            4,
            FixedU64(500_000_000),
            h(4)
        ));
        assert!(Rounds::<Test>::get((C, E, 3)).is_some());
        assert!(Rounds::<Test>::get((C, E, 4)).is_some());
        assert_ok!(Oracle::do_try_state());
        ExpectedSpecs::set(vec![3]); // restore default for suite isolation
    });
}

// =========================================================================
// 18. Version-scoped ack pruning (Codex F8; 07 §2(4)/§13)
// =========================================================================

#[test]
fn per_version_acks_survive_a_sibling_version_settlement() {
    // Codex F8: `AckRecords` are keyed by the full game triple, so settling one
    // per-version game must NOT prune a sibling version's acknowledgments — the
    // core bug the fix addresses. Here v4 gathers quorum, v3 is recompute-settled,
    // and v4's acks survive to settle it Unchallenged on its own quorum.
    new_test_ext().execute_with(|| {
        ExpectedSpecs::set(vec![3, 4]);
        register_reporter(1);
        register_watchtower(2);
        register_watchtower(3);
        assert_ok!(Oracle::note_recomputable(C, 3));
        let proof3 = proof_for(reported_value());
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            3,
            reported_value(),
            hash_evidence(&proof3)
        ));
        let v4_value = FixedU64(500_000_000);
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            C,
            E,
            4,
            v4_value,
            h(4)
        ));
        let rh4 = hash_report(C, E, 1, v4_value, h(4));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(2)),
            C,
            E,
            4,
            1,
            rh4
        ));
        assert_ok!(Oracle::ack_observed(
            RuntimeOrigin::signed(acc(3)),
            C,
            E,
            4,
            1,
            rh4
        ));
        assert_eq!(Rounds::<Test>::get((C, E, 4)).unwrap().acks, 2);

        // Settle v3 by recompute (F10) — must not touch v4's acks.
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            C,
            E,
            3,
            proof_arg(proof3)
        ));
        assert_eq!(Rounds::<Test>::get((C, E, 4)).unwrap().acks, 2); // survived
        assert_ok!(Oracle::do_try_state());

        // v4 still reaches quorum and settles Unchallenged on its own acks.
        set_block(1 + ORC_WINDOW_BLOCKS);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        let settled = Oracle::settled_component(C, E, 4).unwrap();
        assert_eq!(settled.path, SettlePath::Unchallenged);
        assert_eq!(settled.value, v4_value);
        assert_ok!(Oracle::do_try_state());
        ExpectedSpecs::set(vec![3]); // restore default for suite isolation
    });
}

// =========================================================================
// 19. Late reserve-probe response (Codex F2; 07 §8 fail-static)
// =========================================================================

#[test]
fn reserve_probe_response_at_or_after_timeout_counts_as_fail() {
    // Codex F2 / 07 §8: a probe response that lands at or after the
    // `res.probe_timeout` deadline is counted as a FAIL regardless of the
    // reported outcome — a late answer is never healthy.
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9)))); // probe 1 pending

        // A "passed" response arriving exactly at the timeout deadline is a fail.
        set_block(RES_PROBE_INTERVAL + RES_PROBE_TIMEOUT);
        assert_ok!(Oracle::reserve_probe_result(1, true));
        assert_eq!(ReserveHealth::<Test>::get().consecutive_fails, 1);
        assert_eq!(ReserveHealth::<Test>::get().consecutive_passes, 0);
        assert_eq!(ProbeTimeoutCount::get(), 0);
        assert!(!Oracle::reserve_unhealthy());
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 20. adjudicate is terminal-only (Codex F10; 07 §5.4)
// =========================================================================

#[test]
fn adjudicate_on_a_fresh_round_is_window_open() {
    // Codex F10 / 07 §5.4: adjudication is the TERMINAL step of the game — the
    // `OracleResolution` origin cannot settle a fresh, unchallenged round-1
    // report and thereby bypass the escalation ladder.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_noop!(
            Oracle::adjudicate(
                RuntimeOrigin::signed(oracle_resolution_acc()),
                C,
                E,
                V,
                counter_value(),
                false
            ),
            Error::<Test>::WindowOpen
        );
        assert!(Oracle::settled_component(C, E, V).is_none());
        assert!(Rounds::<Test>::get((C, E, V)).is_some()); // round untouched
    });
}

// =========================================================================
// 21. Money deadline / force-neutralize (Codex F11/F12; 07 §11, I-18)
// =========================================================================

#[test]
fn note_settle_deadline_neutralizes_contested_round_and_blocks_late_verdict() {
    // limit-coverage: OracleSettleDeadline(m)
    // 07 §11 rule 1: any `(component, m)` not challenge-closed by its
    // `OracleSettleDeadline` settles NEUTRALLY while retaining the round's bond
    // stack. A late terminal verdict resolves bonds only and cannot overwrite
    // the money (I-18).
    new_test_ext().execute_with(|| {
        register_reporter(1);
        escalate_to_terminal(1, 4, E);

        // The money deadline fires while the round is still contested.
        assert_ok!(Oracle::note_settle_deadline(E));
        let settled = Oracle::settled_component(C, E, V).expect("neutral-settled");
        assert_eq!(settled.path, SettlePath::Neutral);
        assert!(settled.flagged);
        assert_eq!(settled.value, FixedU64(COMPONENT_VALUE_MAX / 2)); // 0.5, no history
        assert!(Rounds::<Test>::get((C, E, V)).is_some()); // bond-only round survives
        assert_ok!(Oracle::do_try_state());

        // A late terminal verdict can no longer overwrite the settled money.
        assert_ok!(Oracle::adjudicate(
            RuntimeOrigin::signed(oracle_resolution_acc()),
            C,
            E,
            V,
            counter_value(),
            false
        ));
        assert!(Rounds::<Test>::get((C, E, V)).is_none());
        assert_noop!(
            Oracle::adjudicate(
                RuntimeOrigin::signed(oracle_resolution_acc()),
                C,
                E,
                V,
                counter_value(),
                false
            ),
            Error::<Test>::RoundNotFound
        );
    });
}

/// 07 §11(1) bounds retention by the `OracleResolution` track's own schedule.
/// Through the FRAME shell that has to mean real custody moving: the refund is
/// a `release` of each stack to its poster, and **nothing** reaches INSURANCE,
/// because no side was adjudicated wrong (SQ-492; R-7).
#[test]
fn sq492_expired_retention_refunds_both_stacks_and_frees_the_slot() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        escalate_to_terminal(1, 4, E);
        let round = Rounds::<Test>::get((C, E, V)).expect("terminal round");
        let stacks = round.cumulative_reporter_bond + round.cumulative_challenger_bond;
        assert!(round.cumulative_challenger_bond > 0);

        let neutralized_at = u32::try_from(System::block_number()).unwrap();
        assert_ok!(Oracle::note_settle_deadline(E));
        assert!(Rounds::<Test>::get((C, E, V)).is_some());
        assert_eq!(
            MoneySettled::<Test>::get()
                .into_inner()
                .iter()
                .find(|(key, _)| key.component == C && key.epoch == E)
                .map(|(_, until)| *until),
            Some(neutralized_at + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS)
        );
        CustodyReleased::set(0);
        CustodySlashed::set(0);

        // Before the deadline the close crank leaves the round alone: a verdict
        // can still land, and §5.5's forfeiture is the whole griefing price.
        set_block(neutralized_at + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS - 1);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert!(Rounds::<Test>::get((C, E, V)).is_some());
        assert_eq!(CustodyReleased::get(), 0);

        set_block(neutralized_at + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert!(
            Rounds::<Test>::get((C, E, V)).is_none(),
            "the retained round is reaped, returning its MAX_ROUNDS slot"
        );
        assert!(RoundSchedules::<Test>::get((C, E, V)).is_none());
        assert!(MoneySettled::<Test>::get().is_empty());
        assert_eq!(CustodyReleased::get(), stacks, "both stacks go back");
        assert_eq!(CustodySlashed::get(), 0, "no finding, so no forfeiture");
        assert_eq!(
            Oracle::settled_component(C, E, V).map(|s| s.path),
            Some(SettlePath::Neutral),
            "the money leg is final and untouched (I-18)"
        );
        assert_ok!(Oracle::do_try_state());
    });
}

/// The shell must reproduce the core's retained-round exemption: a value a
/// still-retained game rests on is never reaped, whatever the cutoff says.
/// Removing it would leave a live `Rounds` entry with no settled counterpart —
/// money-bearing past its own deadline, which `do_try_state` catches (SQ-492).
#[test]
fn sq492_reaper_never_strands_a_retained_round() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        escalate_to_terminal(1, 4, E);
        assert_ok!(Oracle::note_settle_deadline(E));
        assert!(Rounds::<Test>::get((C, E, V)).is_some());
        assert!(Oracle::settled_component(C, E, V).is_some());

        // A cutoff far past the retained epoch — what a stalled close crank
        // leaves, since the cutoff advances on the clock while retention ends
        // only when someone cranks.
        assert_eq!(Oracle::reap_settled_components(E + 9_999), 0);
        assert!(Oracle::settled_component(C, E, V).is_some());
        assert_ok!(Oracle::do_try_state());

        // Once the retention expires and the round is reaped, the value is
        // ordinary history and the sweep takes it.
        set_block(
            u32::try_from(System::block_number()).unwrap()
                + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS,
        );
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(9)), 20));
        assert!(Rounds::<Test>::get((C, E, V)).is_none());
        assert_eq!(
            Oracle::reap_settled_components(E + 9_999),
            0,
            "the sole value for a component is its carry checkpoint"
        );
        ComponentValues::<Test>::insert(
            (C, E + 1, V),
            SettledComponent {
                value: reported_value(),
                path: SettlePath::Unchallenged,
                flagged: false,
            },
        );
        assert_eq!(Oracle::reap_settled_components(E + 9_999), 1);
        assert!(Oracle::settled_component(C, E, V).is_none());
        assert!(Oracle::settled_component(C, E + 1, V).is_some());
        assert_ok!(Oracle::do_try_state());
    });
}

/// 07 §13's settled-value reaping, which had no production caller anywhere until
/// the epoch clock gained one: `ComponentValues` otherwise grows by an entry per
/// admitted component per epoch until `MAX_COMPONENT_VALUES` turns every further
/// settlement into `AlreadyFinal` (SQ-492).
#[test]
fn sq492_reap_settled_components_is_epoch_cutoff_and_bounded() {
    new_test_ext().execute_with(|| {
        for epoch in 0u32..6 {
            for component in 0u16..2 {
                ComponentValues::<Test>::insert(
                    (component, epoch, V),
                    SettledComponent {
                        value: reported_value(),
                        path: SettlePath::Unchallenged,
                        flagged: false,
                    },
                );
            }
        }

        // Nothing is due before the retention window has even elapsed.
        assert_eq!(Oracle::reap_settled_components(2), 0);
        assert_eq!(ComponentValues::<Test>::iter().count(), 12);

        // At epoch 8 the cutoff is 5, so epochs 0..4 go and 5 stays — the
        // cutoff epoch itself is retained because welfare may still read it.
        assert_eq!(Oracle::reap_settled_components(8), 10);
        assert_eq!(ComponentValues::<Test>::iter().count(), 2);
        assert!(ComponentValues::<Test>::iter_keys().all(|(_, epoch, _)| epoch == 5));
        // Idempotent: a keeper may drive the boundary crank every block.
        assert_eq!(Oracle::reap_settled_components(8), 0);
        assert_ok!(Oracle::do_try_state());
    });
}

/// 13 §2 · `ComponentReapBatch`: a crank facing more stale values than the bound
/// retires exactly the bound, oldest epoch first, and resumes on the next crank
/// — the resumable `ReapBatch` shape, never a rejection.
#[test]
fn sq492_component_reap_batch_is_resumable_not_a_rejection() {
    // limit-coverage: ComponentReapBatch
    new_test_ext().execute_with(|| {
        let per_epoch = 8u16;
        let stale_epochs = 6u32;
        for epoch in 0..stale_epochs {
            for component in 0..per_epoch {
                ComponentValues::<Test>::insert(
                    (component, epoch, V),
                    SettledComponent {
                        value: reported_value(),
                        path: SettlePath::Unchallenged,
                        flagged: false,
                    },
                );
            }
        }
        // Every component's newest entry is its 07 §10 carry checkpoint and is
        // exempt, so only the older generations are reapable.
        let total = u32::from(per_epoch) * stale_epochs;
        let checkpoints = u32::from(per_epoch);
        let reapable = total - checkpoints;
        assert!(
            reapable > COMPONENT_VALUE_REAP_BATCH as u32,
            "the cap must bind"
        );

        // One crank retires exactly the batch — a dispatch past the limit is
        // capped, not refused (G-1 leaves the excess for the next crank).
        assert_eq!(
            Oracle::reap_settled_components(20),
            COMPONENT_VALUE_REAP_BATCH as u32
        );
        let remaining_after_first_component_reap = ComponentValues::<Test>::iter().count() as u32;
        assert_eq!(
            remaining_after_first_component_reap,
            total - COMPONENT_VALUE_REAP_BATCH as u32
        );
        // Oldest first: the batch drained whole epochs from the bottom, so the
        // survivors are the newest ones (I-20, and deterministic across nodes
        // regardless of storage-hasher order).
        let oldest_surviving = ComponentValues::<Test>::iter_keys()
            .map(|(_, epoch, _)| epoch)
            .min()
            .expect("survivors");
        assert_eq!(
            oldest_surviving,
            COMPONENT_VALUE_REAP_BATCH as u32 / u32::from(per_epoch)
        );

        // The next crank drains the rest of the reapable set and then goes
        // quiet, leaving exactly one carry checkpoint per component standing.
        assert_eq!(
            Oracle::reap_settled_components(20),
            reapable - COMPONENT_VALUE_REAP_BATCH as u32
        );
        assert_eq!(Oracle::reap_settled_components(20), 0);
        assert_eq!(ComponentValues::<Test>::iter().count() as u32, checkpoints);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn note_settle_deadline_neutralizes_no_report_components() {
    // Codex P1 / 07 §11(1): an admitted component that produced NO report has no
    // round, so the live-round sweep never touches it — yet the money-deadline
    // guarantee is that welfare finds a (neutral) value for EVERY expected
    // component. The crank reads the expected `(component, version)` set from the
    // `ReportingContext` provider and neutral-settles the no-report members
    // (07 §10 no-report path).
    new_test_ext().execute_with(|| {
        // Component C reports (opens a round); component 8 is also consumed by the
        // epoch's cohorts but never reports.
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        ExpectedComponents::set(vec![(C, V), (8, V)]);

        assert_ok!(Oracle::note_settle_deadline(E));

        // C settled neutrally via its round; 8 via the no-report path.
        let reported = Oracle::settled_component(C, E, V).expect("C neutral-settled");
        assert_eq!(reported.path, SettlePath::Neutral);
        assert!(reported.flagged);
        let no_report = Oracle::settled_component(8, E, V).expect("no-report component settled");
        assert_eq!(no_report.path, SettlePath::Neutral);
        assert!(no_report.flagged);
        assert_eq!(no_report.value, FixedU64(COMPONENT_VALUE_MAX / 2)); // 0.5, no history
        assert!(Rounds::<Test>::get((8, E, V)).is_none());
        assert_ok!(Oracle::do_try_state());

        ExpectedComponents::set(vec![]); // restore default for suite isolation
    });
}

// =========================================================================
// 22. Offense against an ejected reporter is a no-op (Codex F17; 07 §3)
// =========================================================================

#[test]
fn offense_against_an_ejected_reporter_does_not_strand_a_valid_recompute() {
    // Codex F17: a reporter ejected on one game can still have another live round
    // settled by `recompute_proof` — the further offense against the (now absent)
    // reporter is a no-op, not a `NotRegistered` error that strands the settle.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        let disproof = proof_for(counter_value()); // recomputes to 0.44, disproving 0.62

        // A pre-existing game on component 30, reported now, recomputed later.
        assert_ok!(Oracle::note_recomputable(30, V));
        assert_ok!(Oracle::report(
            RuntimeOrigin::signed(acc(1)),
            30,
            E,
            V,
            reported_value(),
            hash_evidence(&disproof)
        ));

        // Eject acc(1) via three recompute-disproofs on other components.
        for component in 31..34u16 {
            assert_ok!(Oracle::note_recomputable(component, V));
            assert_ok!(Oracle::report(
                RuntimeOrigin::signed(acc(1)),
                component,
                E,
                V,
                reported_value(),
                hash_evidence(&disproof)
            ));
            assert_ok!(Oracle::recompute_proof(
                RuntimeOrigin::signed(acc(5)),
                component,
                E,
                V,
                proof_arg(disproof.clone())
            ));
        }
        assert_eq!(Reporters::<Test>::count(), 0); // ejected

        // The pre-existing game still settles despite the ejection (no `NotRegistered`).
        assert_ok!(Oracle::recompute_proof(
            RuntimeOrigin::signed(acc(5)),
            30,
            E,
            V,
            proof_arg(disproof)
        ));
        assert!(Oracle::settled_component(30, E, V).is_some());
        assert_ok!(Oracle::do_try_state());
    });
}

// ------------------------------------- reserve-health sink (SQ-205) --------
//
// 07 §8 hands the reserve-health flag `R` to 08 §1.2, which makes
// `spendable_nav` zero exactly while it is set. The seam is therefore fallible
// and edge-triggered, and a sink failure MUST leave the oracle transition
// unwritten — otherwise `PhaseFlags` and NAV can disagree about solvency.

#[test]
fn reserve_health_sink_fires_once_per_transition_not_per_probe() {
    new_test_ext().execute_with(|| {
        let mut amended = ParamsValue::get();
        amended.fail_threshold = 1;
        amended.recover_threshold = 1;
        ParamsValue::set(amended);

        // Healthy → unhealthy: exactly one edge.
        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(1, false));
        assert!(Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);
        assert_eq!(
            sp_io::storage::get(RESERVE_HEALTH_SINK_MARKER).as_deref(),
            Some(&[1][..])
        );

        // A second failing probe keeps the flag set — no new edge, no new call.
        set_block(RES_PROBE_INTERVAL * 2);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(2, false));
        assert!(Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);

        // Unhealthy → healthy: the clearing edge is delivered too.
        set_block(RES_PROBE_INTERVAL * 3);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::reserve_probe_result(3, true));
        assert!(!Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true, false]);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn failing_reserve_health_sink_rolls_back_the_oracle_transition() {
    new_test_ext().execute_with(|| {
        let mut amended = ParamsValue::get();
        amended.fail_threshold = 1;
        ParamsValue::set(amended);

        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let before = ReserveHealth::<Test>::get();

        // The sibling-pallet write refuses (a treasury/constitution failure).
        ReserveHealthSinkFails::set(true);
        assert_noop!(
            Oracle::reserve_probe_result(1, false),
            DispatchError::Other("reserve health sink refused")
        );

        // The sink really ran (the thread-local witness survives the rollback)…
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);
        assert_eq!(sp_io::storage::get(RESERVE_HEALTH_SINK_MARKER), None);
        // …but nothing about the oracle transition committed: the flag is still
        // clear and the whole `ReserveHealth` record is byte-identical.
        assert!(!Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealth::<Test>::get(), before);
        assert_ok!(Oracle::do_try_state());

        // With the sink healthy again the same transition applies normally,
        // proving the rollback left no poisoned state behind.
        ReserveHealthSinkFails::set(false);
        assert_ok!(Oracle::reserve_probe_result(1, false));
        assert!(Oracle::reserve_unhealthy());
        assert_eq!(
            sp_io::storage::get(RESERVE_HEALTH_SINK_MARKER).as_deref(),
            Some(&[1][..])
        );
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn failing_reserve_health_sink_rolls_back_a_timeout_fold_crank() {
    new_test_ext().execute_with(|| {
        let mut amended = ParamsValue::get();
        amended.fail_threshold = 1;
        ParamsValue::set(amended);

        set_block(RES_PROBE_INTERVAL);
        assert_ok!(Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))));
        let before = ReserveHealth::<Test>::get();

        // The other edge producer: a keeper crank folding an unanswered probe.
        ReserveHealthSinkFails::set(true);
        set_block(RES_PROBE_INTERVAL + RES_PROBE_TIMEOUT);
        assert_noop!(
            Oracle::crank_reserve_probe(RuntimeOrigin::signed(acc(9))),
            DispatchError::Other("reserve health sink refused")
        );
        assert_eq!(ReserveHealthSinkCalls::get(), vec![true]);
        assert_eq!(sp_io::storage::get(RESERVE_HEALTH_SINK_MARKER), None);
        assert!(!Oracle::reserve_unhealthy());
        assert_eq!(ReserveHealth::<Test>::get(), before);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reserve_probe_crank_rejects_unsigned_and_root_origins() {
    new_test_ext().execute_with(|| {
        set_block(RES_PROBE_INTERVAL);
        assert_noop!(
            Oracle::crank_reserve_probe(RuntimeOrigin::none()),
            DispatchError::BadOrigin
        );
        assert_noop!(
            Oracle::crank_reserve_probe(RuntimeOrigin::root()),
            DispatchError::BadOrigin
        );
        assert_eq!(ReserveHealth::<Test>::get().last_query_id, 0);
        assert_ok!(Oracle::do_try_state());
    });
}

// ---------------------------------------------------------------------------
// Contract v19 — the two confirmed oracle vulnerabilities, at the extrinsic
// layer. See `oracle-core`'s own suite for the state-machine-level proofs.
// ---------------------------------------------------------------------------

#[test]
fn self_challenge_by_the_round_reporter_is_refused() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        // The whole of VULN 1's entry point: at baseline this was `assert_ok!`
        // and the reporter owned both sides of their own game.
        assert_noop!(
            Oracle::challenge(
                RuntimeOrigin::signed(acc(1)),
                C,
                E,
                V,
                reported_value(),
                h(10)
            ),
            Error::<Test>::SelfChallenge
        );
        let round = Rounds::<Test>::get((C, E, V)).expect("live round");
        assert!(round.challenger.is_none());
        assert_eq!(round.cumulative_challenger_bond, 0);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn the_reporter_gets_self_challenge_not_already_challenged() {
    // Guard ordering: the reporter's own attempt must name the real reason even
    // once a legitimate challenger holds the slot.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(4)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        assert_noop!(
            Oracle::challenge(RuntimeOrigin::signed(acc(1)), C, E, V, FixedU64(1), h(11)),
            Error::<Test>::SelfChallenge
        );
    });
}

#[test]
fn round_one_default_settles_the_carried_value_not_the_counter_value() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        // A real prior value, so the carry is distinguishable from the neutral
        // 0.5 fallback and from the challenger's assertion.
        ComponentValues::<Test>::insert(
            (C, E - 1, V),
            SettledComponent {
                value: FixedU64(900_000_000),
                path: SettlePath::Unchallenged,
                flagged: false,
            },
        );
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        // Challenged from a *second funded account*, not the reporter — this
        // proves the fix does not rest on the identity guard.
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(9)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        set_block(ORC_WINDOW_BLOCKS + 2);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(8)), 20));
        let settled = ComponentValues::<Test>::get((C, E, V)).expect("settled");
        // Baseline: `{ counter_value(), ChallengerDefault, flagged: false }`.
        assert_eq!(settled.path, SettlePath::Neutral);
        assert!(settled.flagged);
        assert_eq!(settled.value, FixedU64(900_000_000));
        assert_ne!(settled.value, counter_value());
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn round_one_default_pays_the_challenger_no_bounty() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(9)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        let slashed_before = CustodySlashed::get();
        set_block(ORC_WINDOW_BLOCKS + 2);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(8)), 20));
        // 07 §5.5 (contract v19): the whole forfeited stack routes to INSURANCE.
        // Baseline paid the challenger 40 % of it — which, when one purse held
        // both roles, was a rebate to the attacker.
        assert_eq!(CustodySlashed::get() - slashed_before, bond(1));
        assert_eq!(CustodyPaid::get().get(&acc(9)).copied().unwrap_or(0), 0);
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn deregister_of_a_live_rounds_challenger_is_window_open() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        register_reporter(9);
        assert_ok!(do_report(1, E, reported_value(), h(9)));
        assert_ok!(Oracle::challenge(
            RuntimeOrigin::signed(acc(9)),
            C,
            E,
            V,
            counter_value(),
            h(10)
        ));
        // 07 §3: a challenger's bond is held in the round, so challenging is
        // "participating" and exit must wait for the round to close.
        assert_noop!(
            Oracle::deregister_reporter(RuntimeOrigin::signed(acc(9))),
            Error::<Test>::WindowOpen
        );
        set_block(ORC_WINDOW_BLOCKS + 2);
        assert_ok!(Oracle::crank_round_close(RuntimeOrigin::signed(acc(8)), 20));
        assert_ok!(Oracle::deregister_reporter(RuntimeOrigin::signed(acc(9))));
        assert_ok!(Oracle::do_try_state());
    });
}

#[test]
fn reporter_records_round_trip_through_storage() {
    // Goes through the extrinsics deliberately: `persist` writes nothing for a
    // field it does not know about, so a core-only test would pass even if the
    // `ReporterRecords` arm were missing.
    new_test_ext().execute_with(|| {
        register_reporter(1);
        settle_recomputed(1, E);
        // A clean exit retains nothing, so ordinary rotation cannot fill the
        // bound.
        assert_ok!(Oracle::deregister_reporter(RuntimeOrigin::signed(acc(1))));
        assert!(crate::pallet::ReporterRecords::<Test>::get().is_empty());
        assert_ok!(Oracle::do_try_state());
    });
}

// =========================================================================
// 12. `bond_quote`'s oracle arm (02 §3 contract v29; 07 §6.1, SQ-598)
//
// The whole design rests on one property: the amount a reporter is *shown*
// and the amount `report` *freezes* are one number, not two. 07 §6.1 freezes
// `B_1` at round-one creation, so the pre-game figure has no record to read
// and must be recomputed — and a second implementation of the same rate is a
// second answer to "what will this hold?". These tests bind the two.
// =========================================================================

/// 07 §6.1 / 02 §3: `report_bond_quote(c, m)` is exactly the `B_1` that a
/// subsequent `report` freezes on the round it creates — in **both** pricing
/// regimes, because the two differ by which term of `max(floor, ceil(bps·X /
/// 10,000))` binds and a quote that agreed only on one of them would still walk
/// a reporter to the wrong number on the other.
///
/// The expectations come from `oracle_core::round_bond` (the 07 §6.1 formula at
/// the live params), never from a hand-computed literal (15 §4.4).
#[test]
fn v29_report_bond_quote_is_the_b1_report_freezes_in_both_regimes() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        let params = ParamsValue::get();

        // Two `StakeAtRisk` values, one per regime, each on its own game key so
        // the second `report` opens a fresh game rather than escalating.
        //   floor regime: 100,000 USDC × 250 bps = 2,500 USDC < the 10,000 floor
        //   bps  regime: 1,000,000 USDC × 250 bps = 25,000 USDC > the floor
        let regimes: [(EpochId, Balance, bool); 2] = [
            (E, 100_000_000_000, true),
            (E + 1, 1_000_000_000_000, false),
        ];

        for (epoch, stake, floor_binds) in regimes {
            StakeAtRiskValue::set(stake);
            let expected = round_bond(stake, 1, &params).expect("round one is representable");
            // The regime is asserted, not assumed: a fixture that silently
            // collapsed both cases onto the floor would test one thing twice.
            if floor_binds {
                assert_eq!(expected, params.bond_floor, "fixture must sit at the floor");
            } else {
                assert!(
                    expected > params.bond_floor,
                    "fixture must sit above the floor so the bps term binds",
                );
            }

            // The quote, taken *before* the object that would freeze it exists.
            let quote = Oracle::report_bond_quote(C, epoch);
            assert_eq!(
                quote,
                Some((expected, stake)),
                "the quote must publish the amount and the StakeAtRisk it scaled",
            );

            // The dispatch that freezes it.
            assert_ok!(do_report(1, epoch, reported_value(), h(9)));
            let round = Rounds::<Test>::get((C, epoch, V)).expect("round one exists");
            let schedule = RoundSchedules::<Test>::get((C, epoch, V)).expect("schedule freezes");

            assert_eq!(
                Some((round.bond, round.stake_at_risk)),
                quote,
                "the frozen round must hold exactly the quoted amount",
            );
            assert_eq!(
                schedule.round_one_bond, expected,
                "the frozen ladder's `B_1` is the quoted amount too",
            );
            // And the event a client reconciles against carries the same figure.
            assert!(oracle_events().iter().any(|event| matches!(
                event,
                Event::Reported { component, epoch: e, round: 1, bond, .. }
                    if *component == C && *e == epoch && *bond == expected
            )));
        }
        assert_ok!(Oracle::do_try_state());
    });
}

/// 07 §6.1: the quote is a **quote**. `CohortEscrow` is read when round one is
/// created and frozen for the lifecycle, so the figure moves with the exposure
/// right up to submission and stops moving after it.
#[test]
fn v29_report_bond_quote_tracks_exposure_until_the_game_freezes_it() {
    new_test_ext().execute_with(|| {
        register_reporter(1);
        let params = ParamsValue::get();
        StakeAtRiskValue::set(1_000_000_000_000);
        let at_submission = round_bond(StakeAtRiskValue::get(), 1, &params).expect("representable");
        assert_ok!(do_report(1, E, reported_value(), h(9)));

        // Exposure doubles after the game opened.
        StakeAtRiskValue::set(2_000_000_000_000);
        let repriced = round_bond(StakeAtRiskValue::get(), 1, &params).expect("representable");
        assert!(repriced > at_submission);

        // A *new* game is priced at the new exposure — the quote is live …
        assert_eq!(
            Oracle::report_bond_quote(C, E + 1),
            Some((repriced, 2_000_000_000_000)),
        );
        // … while the open game keeps the amount it froze (I-28).
        assert_eq!(
            RoundSchedules::<Test>::get((C, E, V)).map(|schedule| schedule.round_one_bond),
            Some(at_submission),
        );
        assert_ok!(Oracle::do_try_state());
    });
}

/// 02 §3 / 07 §6.1: when the live parameters cannot price a round-one bond at
/// all, the quote answers **`None`** — the same refusal `report` makes, reached
/// before the reporter commits rather than after (G-1).
///
/// The adversarial half is what it must *not* answer: `Some(bond_floor)`. A
/// floor here would be a real number for an action the runtime refuses, which is
/// exactly the "walked to a signature the chain rejects" defect contract v29
/// exists to close.
#[test]
fn v29_report_bond_quote_refuses_when_orc_rounds_leaves_its_kernel_band() {
    use oracle_core::{ORC_ROUND_CAP_MAX, ORC_ROUND_CAP_MIN};

    new_test_ext().execute_with(|| {
        register_reporter(1);
        let lawful = ParamsValue::get();
        // Inside the band the same fixture quotes a real amount, so the refusals
        // below are attributable to `orc.rounds` and to nothing else.
        assert!(Oracle::report_bond_quote(C, E).is_some());

        for rounds in [ORC_ROUND_CAP_MIN - 1, ORC_ROUND_CAP_MAX + 1] {
            ParamsValue::set(OracleParams { rounds, ..lawful });
            let quote = Oracle::report_bond_quote(C, E);
            assert_eq!(quote, None, "an unpriceable ladder must answer nothing");
            assert_ne!(
                quote,
                Some((lawful.bond_floor, StakeAtRiskValue::get())),
                "a floor would under-collateralize an action `report` refuses",
            );
            // The mirror: the dispatch refuses on the same state, and refuses
            // as a true no-op (G-1).
            assert_noop!(
                do_report(1, E, reported_value(), h(9)),
                Error::<Test>::RoundNotFound
            );
            assert!(Rounds::<Test>::get((C, E, V)).is_none());
            assert!(RoundSchedules::<Test>::get((C, E, V)).is_none());
        }

        ParamsValue::set(lawful);
        assert!(Oracle::report_bond_quote(C, E).is_some());
        assert_ok!(Oracle::do_try_state());
    });
}
