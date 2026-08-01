//! `frame-benchmarking` v2 benchmarks for every extrinsic (Track-A DoD, 15 §4.5).
//!
//! `pallet-oracle`'s only weight-bearing hook is the try-runtime `try_state`
//! (not benchmarked; it is try-runtime-only), so the eleven calls below are the
//! complete benchmark surface. B5 turns the generated output into the
//! PoV-calibrated `weights.rs`. The `QueryResponse` handler and
//! `request_adjudication` are runtime-internal (not extrinsics) and are covered
//! by unit tests.

use super::*;
use crate::pallet::{
    AckRecords, ComponentValues, MoneySettled, Pallet, Recomputable, Reporters, RoundSchedules,
    Rounds, WatchtowerActive, Watchtowers,
};

use frame_benchmarking::v2::*;
use frame_support::pallet_prelude::*;
use frame_system::RawOrigin;
use futarchy_primitives::{FixedU64, H256};
use oracle_core::{hash_evidence, hash_report, ORC_ROUNDS, ORC_WINDOW_BLOCKS, RES_PROBE_INTERVAL};

const COMPONENT: MetricId = 1;
const EPOCH: EpochId = 1;
const SPEC: MetricSpecVersion = 3;
// The assembled runtime charges and clamps `crank_round_close` at the shared
// keeper batch bound (`Runtime::MaxRoundCloseBatch = kernel::TICK_BATCH`).
const ROUND_CLOSE_BATCH_BOUND: u32 = futarchy_primitives::kernel::TICK_BATCH;

fn account<T: Config>(seed: u8) -> T::AccountId {
    [seed; 32].into()
}

fn seed_reporter<T: Config>(seed: u8) -> T::AccountId {
    let who = account::<T>(seed);
    T::BenchmarkHelper::prime_custody(
        seed,
        futarchy_primitives::currency::USDC.saturating_mul(1_000_000),
    );
    Pallet::<T>::register_reporter(RawOrigin::Signed(who.clone()).into())
        .expect("register_reporter");
    who
}

fn seed_report_for<T: Config>(
    reporter: &T::AccountId,
    component: MetricId,
    value: FixedU64,
    evidence: H256,
) {
    T::BenchmarkHelper::prime_reporting(component, EPOCH, SPEC);
    Pallet::<T>::report(
        RawOrigin::Signed(reporter.clone()).into(),
        component,
        EPOCH,
        SPEC,
        value,
        evidence,
    )
    .expect("report");
}

fn seed_report<T: Config>(reporter: &T::AccountId, value: FixedU64, evidence: H256) {
    seed_report_for::<T>(reporter, COMPONENT, value, evidence);
}

fn fill_reporters<T: Config>(first_seed: u8, count: u8) {
    for seed in first_seed..first_seed.saturating_add(count) {
        let who = account::<T>(seed);
        Reporters::<T>::insert(
            who,
            oracle_core::ReporterInfo {
                stake: oracle_core::ORC_REPORTER_STAKE,
                registered_at: 0,
                offenses: 0,
            },
        );
    }
}

/// Fill the retained 07 §3 record store to its bound so `load()` hydrates it at
/// worst case (contract v19). Called by every benchmark whose dispatch goes
/// through `mutate_core` — which is all of them except the two reserve-probe
/// entry points, whose narrow `mutate_reserve_health` path never reads it.
/// Seeds are disjoint from
/// `fill_reporters`' range: a retained record and a live seat are mutually
/// exclusive homes for the same account, and both `try_state` and the core
/// invariant forbid the overlap.
fn fill_reporter_records<T: Config>() {
    let mut records = crate::pallet::ReporterRecords::<T>::get();
    for i in 0..crate::MAX_REPORTER_RECORDS_BOUND {
        // Offset well past `fill_reporters`' seeded range so a retained record
        // never shadows a live seat.
        let account = [(128u32.saturating_add(i)) as u8; 32];
        if records
            .try_push(oracle_core::ReporterRecord {
                account,
                offenses: 1,
                ejected: false,
            })
            .is_err()
        {
            break;
        }
    }
    crate::pallet::ReporterRecords::<T>::put(records);
}

fn fill_watchtowers<T: Config>(first_seed: u8, count: u8) {
    for seed in first_seed..first_seed.saturating_add(count) {
        let who = account::<T>(seed);
        Watchtowers::<T>::insert(
            who,
            oracle_core::WatchtowerInfo {
                stake: oracle_core::WT_STAKE,
                registered_at: 0,
                inactive_epochs: 0,
            },
        );
    }
}

fn fill_future_rounds<T: Config>(first_component: MetricId) {
    for component in first_component..=MAX_ROUNDS_BOUND as u16 {
        let value = FixedU64(500_000_000);
        let evidence = [component as u8; 32];
        Rounds::<T>::insert(
            (component, EPOCH, SPEC),
            oracle_core::RoundState {
                component,
                epoch: EPOCH,
                round: 1,
                spec_version: SPEC,
                reporter: [2; 32],
                value,
                evidence_hash: evidence,
                bond: oracle_core::ORC_BOND_FLOOR,
                cumulative_reporter_bond: oracle_core::ORC_BOND_FLOOR,
                cumulative_challenger_bond: 0,
                challenge_deadline: u32::MAX,
                extended: false,
                challenger: None,
                counter_value: None,
                acks: 0,
                report_hash: hash_report(component, EPOCH, 1, value, evidence),
                stake_at_risk: oracle_core::ORC_REPORTER_STAKE,
            },
        );
        RoundSchedules::<T>::insert(
            (component, EPOCH, SPEC),
            oracle_core::StoredRoundSchedule {
                round_one_bond: oracle_core::ORC_BOND_FLOOR,
                round_cap: oracle_core::ORC_ROUNDS,
            },
        );
    }
}

/// Fill every watchtower-backed collection the whole-aggregate adapter
/// hydrates. `count` is 15 only while `register_watchtower` needs one free seat;
/// all other calls use the full 16-seat set.
fn fill_watchtower_capacity<T: Config>(count: u8) {
    fill_watchtowers::<T>(2, count);
    let active = (2..2u8.saturating_add(count))
        .map(|seed| {
            let who: [u8; 32] = account::<T>(seed).into();
            who
        })
        .collect::<alloc::vec::Vec<_>>();
    WatchtowerActive::<T>::put(BoundedVec::truncate_from(active));
}

/// Populate acknowledgements for every live round, keeping the measured target
/// at `target_acks` and all other games at the 16-watchtower ceiling. The round
/// counter and dedup ledger are updated together, so the fixture is reachable.
fn fill_ack_capacity<T: Config>(target_acks: u8, other_acks: u8) {
    let mut records = alloc::vec::Vec::new();
    for (key, mut round) in Rounds::<T>::iter() {
        let count =
            if round.component == COMPONENT && round.epoch == EPOCH && round.spec_version == SPEC {
                target_acks
            } else {
                other_acks
            };
        round.acks = count;
        for seed in 2..2u8.saturating_add(count) {
            records.push((
                round.component,
                round.epoch,
                round.spec_version,
                round.round,
                [seed; 32],
                round.report_hash,
            ));
        }
        Rounds::<T>::insert(key, round);
    }
    AckRecords::<T>::put(BoundedVec::truncate_from(records));
}

fn fill_component_values<T: Config>(count: u32) {
    for index in 0..count {
        let component = 1_000u16.saturating_add(index as u16);
        ComponentValues::<T>::insert(
            (component, 0, SPEC),
            oracle_core::SettledComponent {
                value: FixedU64(500_000_000),
                path: oracle_core::SettlePath::Unchallenged,
                flagged: false,
            },
        );
    }
}

/// Saturate `MoneySettled` so every `mutate_core` on this path reads (and, on a
/// dirty path, writes) the real bounded value rather than an empty one.
///
/// A conservative **synthetic** envelope, like `crank_reserve_probe`'s: the keys
/// are deliberately outside the live-round space, because an entry that matched
/// a round would send that round down the 07 §11(1) retained branch and change
/// which paths the batch exercises. What is being measured here is the value's
/// encoded size — which grew when each entry gained its retention deadline
/// (SQ-492) — not the retained branch, which `sq492_*` covers behaviourally.
fn fill_money_settled<T: Config>() {
    let entries = (0..MAX_ROUNDS_BOUND)
        .map(|index| {
            (
                oracle_core::RoundKey {
                    component: 3_000u16.saturating_add(index as u16),
                    epoch: 0,
                    spec_version: SPEC,
                },
                u32::MAX,
            )
        })
        .collect::<alloc::vec::Vec<_>>();
    MoneySettled::<T>::put(BoundedVec::truncate_from(entries));
}

fn fill_recomputable<T: Config>(include_target: bool) {
    let mut values = alloc::vec::Vec::new();
    if include_target {
        values.push((COMPONENT, SPEC));
    }
    let remaining = MAX_RECOMPUTABLE_BOUND as usize - values.len();
    values.extend((0..remaining).map(|index| (2_000u16.saturating_add(index as u16), SPEC)));
    Recomputable::<T>::put(BoundedVec::truncate_from(values));
}

/// Fill all globally hydrated collections after the measured call's target
/// round has been prepared. Settling calls reserve `settlement_slots` in
/// `ComponentValues`; creators reserve `round_slots` in `Rounds`.
fn fill_hydration<T: Config>(
    first_future_round: MetricId,
    target_acks: u8,
    watchtowers: u8,
    settlement_slots: u32,
    include_target_recomputable: bool,
) {
    fill_future_rounds::<T>(first_future_round);
    fill_watchtower_capacity::<T>(watchtowers);
    fill_ack_capacity::<T>(target_acks, watchtowers);
    fill_component_values::<T>(MAX_COMPONENT_VALUES_BOUND.saturating_sub(settlement_slots));
    fill_recomputable::<T>(include_target_recomputable);
    fill_reporter_records::<T>();
}

/// Drive the game to a terminal (round `R_max`, challenged) state so
/// `adjudicate` is admissible (07 §5.4 / F10).
fn seed_terminal<T: Config>(reporter: &T::AccountId, challenger: &T::AccountId) {
    seed_report::<T>(reporter, FixedU64(500_000_000), [9u8; 32]);
    let challenge = |now: u32| {
        frame_system::Pallet::<T>::set_block_number(now.into());
        Pallet::<T>::challenge(
            RawOrigin::Signed(challenger.clone()).into(),
            COMPONENT,
            EPOCH,
            SPEC,
            FixedU64(440_000_000),
            [10u8; 32],
        )
        .expect("challenge");
    };
    for _ in 1..ORC_ROUNDS {
        let deadline = Rounds::<T>::get((COMPONENT, EPOCH, SPEC))
            .expect("round")
            .challenge_deadline;
        challenge(deadline - 1);
        Pallet::<T>::counter_report(
            RawOrigin::Signed(reporter.clone()).into(),
            COMPONENT,
            EPOCH,
            SPEC,
            FixedU64(440_000_000),
            [11u8; 32],
        )
        .expect("counter_report");
    }
    let deadline = Rounds::<T>::get((COMPONENT, EPOCH, SPEC))
        .expect("round")
        .challenge_deadline;
    challenge(deadline - 1);
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn register_reporter() {
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        fill_hydration::<T>(1, 16, 16, 0, false);
        let who = account::<T>(1);
        T::BenchmarkHelper::prime_custody(
            1,
            futarchy_primitives::currency::USDC.saturating_mul(1_000_000),
        );

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()));

        assert_eq!(Reporters::<T>::count(), MAX_REPORTERS_BOUND);
    }

    #[benchmark]
    fn deregister_reporter() {
        let who = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        fill_hydration::<T>(1, 16, 16, 0, false);

        #[extrinsic_call]
        _(RawOrigin::Signed(who));

        assert_eq!(Reporters::<T>::count(), MAX_REPORTERS_BOUND - 1);
    }

    #[benchmark]
    fn report() {
        let who = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        T::BenchmarkHelper::prime_reporting(COMPONENT, EPOCH, SPEC);
        // Leave one round slot for the measured report; every existing round
        // carries the full admissible 16 acknowledgement records.
        fill_hydration::<T>(2, 16, 16, 0, false);

        #[extrinsic_call]
        _(
            RawOrigin::Signed(who),
            COMPONENT,
            EPOCH,
            SPEC,
            FixedU64(500_000_000),
            [9u8; 32],
        );

        let round = Rounds::<T>::get((COMPONENT, EPOCH, SPEC)).expect("measured reporting round");
        assert!(
            round.bond > T::Params::get().bond_floor,
            "benchmark fixture must exercise the value-scaled path above the floor knee"
        );
    }

    #[benchmark]
    fn challenge() {
        let reporter = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        seed_report::<T>(&reporter, FixedU64(500_000_000), [9u8; 32]);
        fill_hydration::<T>(2, 16, 16, 0, false);
        let challenger = account::<T>(2);
        T::BenchmarkHelper::prime_custody(
            2,
            futarchy_primitives::currency::USDC.saturating_mul(1_000_000),
        );

        #[extrinsic_call]
        _(
            RawOrigin::Signed(challenger),
            COMPONENT,
            EPOCH,
            SPEC,
            FixedU64(440_000_000),
            [10u8; 32],
        );

        assert!(Rounds::<T>::get((COMPONENT, EPOCH, SPEC))
            .map(|r| r.challenger.is_some())
            .unwrap_or(false));
    }

    #[benchmark]
    fn counter_report() {
        let reporter = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        seed_report::<T>(&reporter, FixedU64(500_000_000), [9u8; 32]);
        fill_hydration::<T>(2, 16, 16, 0, false);
        let challenger = account::<T>(2);
        T::BenchmarkHelper::prime_custody(
            2,
            futarchy_primitives::currency::USDC.saturating_mul(1_000_000),
        );
        let deadline = Rounds::<T>::get((COMPONENT, EPOCH, SPEC))
            .expect("round")
            .challenge_deadline;
        frame_system::Pallet::<T>::set_block_number((deadline - 1).into());
        Pallet::<T>::challenge(
            RawOrigin::Signed(challenger).into(),
            COMPONENT,
            EPOCH,
            SPEC,
            FixedU64(440_000_000),
            [10u8; 32],
        )
        .expect("challenge");

        #[extrinsic_call]
        _(
            RawOrigin::Signed(reporter),
            COMPONENT,
            EPOCH,
            SPEC,
            FixedU64(440_000_000),
            [11u8; 32],
        );

        assert_eq!(
            Rounds::<T>::get((COMPONENT, EPOCH, SPEC)).map(|r| r.round),
            Some(2)
        );
    }

    #[benchmark]
    fn recompute_proof(n: Linear<8, MAX_PROOF_BYTES_BOUND>) {
        let reporter = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        let value = FixedU64(500_000_000);
        let mut proof_bytes = alloc::vec![0u8; n as usize];
        proof_bytes[..8].copy_from_slice(&value.0.to_le_bytes());
        let evidence = hash_evidence(&proof_bytes);
        seed_report::<T>(&reporter, value, evidence);
        fill_hydration::<T>(2, 16, 16, 1, true);
        let prover = account::<T>(3);
        let proof: BoundedVec<u8, ConstU32<MAX_PROOF_BYTES_BOUND>> =
            BoundedVec::truncate_from(proof_bytes);
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(prover), COMPONENT, EPOCH, SPEC, proof);

        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::OracleLine,
        );
        assert!(Pallet::<T>::settled_component(COMPONENT, EPOCH, SPEC).is_some());
    }

    #[benchmark]
    fn register_watchtower() {
        fill_watchtowers::<T>(2, (MAX_WATCHTOWERS_BOUND - 1) as u8);
        fill_reporters::<T>(1, MAX_REPORTERS_BOUND as u8);
        fill_reporter_records::<T>();
        fill_future_rounds::<T>(1);
        fill_ack_capacity::<T>(15, 15);
        fill_component_values::<T>(MAX_COMPONENT_VALUES_BOUND);
        fill_recomputable::<T>(false);
        let active = (2..17u8)
            .map(|seed| [seed; 32])
            .collect::<alloc::vec::Vec<_>>();
        WatchtowerActive::<T>::put(BoundedVec::truncate_from(active));
        let who = account::<T>(1);
        T::BenchmarkHelper::prime_custody(
            1,
            futarchy_primitives::currency::USDC.saturating_mul(1_000_000),
        );

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()));

        assert_eq!(Watchtowers::<T>::count(), MAX_WATCHTOWERS_BOUND);
    }

    #[benchmark]
    fn ack_observed() {
        let reporter = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        fill_reporter_records::<T>();
        let value = FixedU64(500_000_000);
        let evidence = [9u8; 32];
        seed_report::<T>(&reporter, value, evidence);
        fill_future_rounds::<T>(2);
        fill_watchtower_capacity::<T>(MAX_WATCHTOWERS_BOUND as u8);
        // Fifteen target acks leave the sixteenth registered watchtower for the
        // measured call while every other round remains at its ceiling.
        fill_ack_capacity::<T>(15, 16);
        fill_component_values::<T>(MAX_COMPONENT_VALUES_BOUND);
        fill_recomputable::<T>(false);
        let watchtower = account::<T>(17);
        let report_hash = hash_report(COMPONENT, EPOCH, 1, value, evidence);
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(
            RawOrigin::Signed(watchtower),
            COMPONENT,
            EPOCH,
            SPEC,
            1,
            report_hash,
        );

        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::OracleLine,
        );
        assert_eq!(
            Rounds::<T>::get((COMPONENT, EPOCH, SPEC)).map(|r| r.acks),
            Some(MAX_WATCHTOWERS_BOUND as u8)
        );
    }

    #[benchmark]
    fn crank_round_close(n: Linear<1, ROUND_CLOSE_BATCH_BOUND>) {
        let reporter = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        let value = FixedU64(500_000_000);
        for component in 1..=n as u16 {
            let evidence = [component as u8; 32];
            seed_report_for::<T>(&reporter, component, value, evidence);
        }
        fill_future_rounds::<T>(n as u16 + 1);
        fill_watchtower_capacity::<T>(MAX_WATCHTOWERS_BOUND as u8);
        fill_ack_capacity::<T>(16, 16);
        fill_component_values::<T>(MAX_COMPONENT_VALUES_BOUND.saturating_sub(n));
        fill_money_settled::<T>();
        fill_recomputable::<T>(false);
        fill_reporter_records::<T>();
        // Seed every round onto the 07 §5.3 **default** branch, which since
        // contract v19 is strictly the heavier arm: it scans the settled history
        // for the carried value, emits an extra `NeutralSettlement`, and settles
        // a bond stack with an INSURANCE transfer. With saturated acks alone
        // every round closed `Unchallenged` and the default branch was never
        // measured — 15 §4.5 forbids weighing a batched crank on an undersized
        // fixture, and the growth-only regression gate cannot see work that was
        // never measured at all.
        //
        // `account::<T>(2)` is a registered reporter (via `fill_reporters`) but
        // is never the *round's* reporter, so the new distinctness guard passes.
        // That is exactly why the guard is `who != r.reporter` rather than
        // "challengers must not be reporters" — the latter has no 07 §5.2 basis
        // and would abort this fixture and two others.
        let challenger = account::<T>(2);
        T::BenchmarkHelper::prime_custody(
            2,
            futarchy_primitives::currency::USDC.saturating_mul(1_000_000),
        );
        for component in 1..=n as u16 {
            Pallet::<T>::challenge(
                RawOrigin::Signed(challenger.clone()).into(),
                component,
                EPOCH,
                SPEC,
                FixedU64(440_000_000),
                [10u8; 32],
            )
            .expect("challenge opens the default branch");
        }
        frame_system::Pallet::<T>::set_block_number((ORC_WINDOW_BLOCKS + 2).into());
        let keeper = account::<T>(5);
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(keeper), n);

        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::OracleLine,
        );
        assert_eq!(Rounds::<T>::iter().count() as u32, MAX_ROUNDS_BOUND - n);
        // Prove the measured arm really was the default branch, so a future
        // fixture change cannot silently fall back to the cheaper one.
        for component in 1..=n as u16 {
            let settled = ComponentValues::<T>::get((component, EPOCH, SPEC))
                .expect("default branch settled the component");
            assert_eq!(settled.path, oracle_core::SettlePath::Neutral);
            assert!(settled.flagged);
        }
    }

    #[benchmark]
    fn crank_reserve_probe() {
        // Conservative synthetic upper envelope: combine the recurring path's
        // timeout/missed-slot/sink work with the first-arm readiness check. No
        // single reachable branch performs more work than this union.
        //
        // No `fill_reporter_records` here, deliberately: this crank goes
        // through the narrow `mutate_reserve_health` path, not `mutate_core`,
        // so it never hydrates the aggregate and the generated weights carry
        // no `Oracle::ReporterRecords` read. Seeding a store the dispatch
        // provably does not touch would misstate the fixture.
        ReserveHealth::<T>::put(ReserveHealthValue {
            consecutive_fails: oracle_core::RES_FAIL_THRESHOLD.saturating_sub(1),
            consecutive_passes: 0,
            unhealthy: false,
            last_query_id: 1,
            last_probe_at: RES_PROBE_INTERVAL,
            pending_since: Some(RES_PROBE_INTERVAL),
        });
        ReserveProbeArmed::<T>::put(true);
        // Two cadence slots elapsed: fold the pending timeout, score the one
        // unopened middle slot, then dispatch the current attempt.
        let now = RES_PROBE_INTERVAL.saturating_mul(3);
        frame_system::Pallet::<T>::set_block_number(now.into());
        let keeper = account::<T>(1);
        T::BenchmarkHelper::prime_reserve_probe();
        T::BenchmarkHelper::prime_keeper_rebate();

        #[extrinsic_call]
        _(RawOrigin::Signed(keeper));

        T::BenchmarkHelper::assert_keeper_rebate_paid(
            futarchy_primitives::keeper::CrankClass::OracleLine,
        );
        let health = ReserveHealth::<T>::get();
        assert_eq!(health.last_query_id, 2);
        assert_eq!(health.pending_since, Some(now));
        assert_eq!(
            health.consecutive_fails,
            oracle_core::RES_FAIL_THRESHOLD.saturating_add(1)
        );
    }

    /// Worst-case authenticated response: the failure crosses the unhealthy
    /// edge and therefore measures the production constitution+treasury sink as
    /// well as the O(1) oracle record/event update.
    #[benchmark]
    fn reserve_probe_result() {
        let now = RES_PROBE_INTERVAL;
        // As in `crank_reserve_probe`: the authenticated-response path uses
        // `mutate_reserve_health`, so no `ReporterRecords` hydration applies.
        ReserveHealth::<T>::put(ReserveHealthValue {
            consecutive_fails: oracle_core::RES_FAIL_THRESHOLD.saturating_sub(1),
            consecutive_passes: 0,
            unhealthy: false,
            last_query_id: 1,
            last_probe_at: now,
            pending_since: Some(now),
        });
        frame_system::Pallet::<T>::set_block_number(now.into());

        #[block]
        {
            Pallet::<T>::reserve_probe_result(1, false).expect("probe callback");
        }

        let health = ReserveHealth::<T>::get();
        assert!(health.unhealthy);
        assert!(health.pending_since.is_none());
    }

    #[benchmark]
    fn adjudicate() {
        let reporter = seed_reporter::<T>(1);
        fill_reporters::<T>(2, (MAX_REPORTERS_BOUND - 1) as u8);
        let challenger = account::<T>(2);
        T::BenchmarkHelper::prime_custody(
            2,
            futarchy_primitives::currency::USDC.saturating_mul(1_000_000),
        );
        seed_terminal::<T>(&reporter, &challenger);
        fill_hydration::<T>(2, 16, 16, 1, false);
        let origin = T::BenchmarkHelper::adjudication_origin();

        #[extrinsic_call]
        _(
            origin as T::RuntimeOrigin,
            COMPONENT,
            EPOCH,
            SPEC,
            FixedU64(440_000_000),
            false,
        );

        assert!(Pallet::<T>::settled_component(COMPONENT, EPOCH, SPEC).is_some());
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
