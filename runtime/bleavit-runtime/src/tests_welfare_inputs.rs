//! Runtime-level welfare-input regressions (milestone A12): SQ-79, SQ-82, SQ-201.
//!
//! These exercise the runtime *composition* — the `WelfareSettlement` seam and
//! the real `pallet-welfare` storage — rather than the pallet in its mock. The
//! pallet-level rules themselves are pinned in `pallets/welfare/src/tests.rs`.

use alloc::{vec, vec::Vec};

use frame_support::traits::Get;

use crate::{configs::RuntimeEpochWelfare, Runtime};

use pallet_epoch::WelfareSettlement;

/// A single-component `C_onchain` spec active from `activation_epoch`, installed
/// directly so these tests do not depend on the (still absent) production
/// genesis MetricSpec set — see the SQ-181 note in PLAN.md.
fn install_spec(
    version: futarchy_primitives::MetricSpecVersion,
    activation_epoch: futarchy_primitives::EpochId,
) {
    install_spec_for(
        version,
        activation_epoch,
        futarchy_primitives::metric_ids::X,
    );
}

/// As [`install_spec`], for an explicitly chosen `C_onchain` component id.
fn install_spec_for(
    version: futarchy_primitives::MetricSpecVersion,
    activation_epoch: futarchy_primitives::EpochId,
    id: futarchy_primitives::MetricId,
) {
    for (stored, _) in pallet_welfare::MetricSpecs::<Runtime>::iter() {
        pallet_welfare::MetricSpecs::<Runtime>::remove(stored);
    }
    pallet_welfare::SnapshotDeadline::<Runtime>::kill();
    let spec = pallet_welfare::MetricSpec {
        id,
        version,
        pillar: pallet_welfare::Pillar::COnchain,
        weight: futarchy_primitives::FixedU64(pallet_welfare::ONE),
        epsilon_floor: pallet_welfare::EPSILON_PILLAR,
        activation_epoch,
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
    };
    let specs = pallet_welfare::BoundedSpecSet::try_from(vec![spec]).expect("one spec is bounded");
    pallet_welfare::MetricSpecs::<Runtime>::insert(version, specs);
}

/// Seed `count` consecutive epochs of welfare history directly, bypassing the
/// keeper cranks: the point of these tests is the *retirement* path, and the
/// recording path already has pallet-level coverage.
fn seed_history(first: futarchy_primitives::EpochId, count: u32) {
    for offset in 0..count {
        let epoch = first + offset;
        pallet_welfare::GateBreachFlags::<Runtime>::insert(
            epoch,
            pallet_welfare::CoreGateBreachFlags {
                s_breached: false,
                c_breached: false,
                day_bitmap: [0; 2],
            },
        );
        pallet_welfare::SampledGateDays::<Runtime>::insert(epoch, [1u32, 0]);
    }
}

// --------------------------------------------------------------- SQ-201
//
// 05 §3.3 made cohort reap the only prune trigger, and `pallet-epoch` calls
// `WelfareSettlement::prune` only from `settle_cohort`. An epoch that never
// forms a cohort is therefore unreachable by cohort-keyed cleanup, and welfare
// history accumulates until `record_snapshot`/`record_daily_gate` jam at their
// hard bounds — a chain wedge, not idle storage. The epoch-roll seam runs on
// every successful tick instead. The bound is what matters here: no number of
// cohortless rolls may grow welfare state without limit.

#[test]
fn sq201_cohortless_rolls_keep_welfare_history_inside_its_bound() {
    crate::tests::development_ext().execute_with(|| {
        install_spec(1, 1);
        // Far more cohortless epochs than the retained window is deep.
        let rolls = 6 * pallet_welfare::MAX_SNAPSHOTS_BOUND;
        let mut observed_peak = 0usize;
        for current in 1..=rolls {
            // One epoch of history arrives per roll and no cohort ever settles,
            // so `WelfareSettlement::prune` is never reached.
            seed_history(current, 1);
            RuntimeEpochWelfare::roll_maintenance(current).expect("roll maintenance is infallible");
            observed_peak = observed_peak.max(pallet_welfare::GateBreachFlags::<Runtime>::iter().count());
        }
        assert!(
            observed_peak <= pallet_welfare::MAX_GATE_FLAGS,
            "welfare gate history grew past its bound over {rolls} cohortless rolls (peak {observed_peak})",
        );
        assert!(
            pallet_welfare::SampledGateDays::<Runtime>::iter().count()
                <= pallet_welfare::MAX_GATE_FLAGS,
            "sampled-day markers grew past their bound",
        );
    });
}

#[test]
fn sq201_the_roll_seam_retires_nothing_inside_the_retained_window() {
    // The roll prune takes the same 05 §3.3 `current - 19` cutoff as the
    // reap-driven prune, so it can never remove state reap would have kept.
    crate::tests::development_ext().execute_with(|| {
        install_spec(1, 1);
        let current = pallet_welfare::MAX_SNAPSHOTS_BOUND;
        let first = current.saturating_sub(pallet_welfare::MAX_SNAPSHOTS_BOUND - 1);
        seed_history(first, pallet_welfare::MAX_SNAPSHOTS_BOUND);
        let before = pallet_welfare::GateBreachFlags::<Runtime>::iter().count();
        RuntimeEpochWelfare::roll_maintenance(current).expect("roll maintenance is infallible");
        assert_eq!(
            pallet_welfare::GateBreachFlags::<Runtime>::iter().count(),
            before,
            "the roll prune retired state inside the retained window",
        );
    });
}

#[test]
fn sq201_a_backlog_is_drained_across_rolls_not_in_one_call() {
    // I-20: the catch-up is cursor-bounded, so a pathological historical
    // backlog is spread over successive ticks instead of one unbounded call.
    crate::tests::development_ext().execute_with(|| {
        install_spec(1, 1);
        seed_history(1, pallet_welfare::MAX_SNAPSHOTS_BOUND);
        let seeded = pallet_welfare::GateBreachFlags::<Runtime>::iter().count();
        // A clock far past the whole seeded history: every epoch is retirable.
        let current = 10 * pallet_welfare::MAX_SNAPSHOTS_BOUND;
        RuntimeEpochWelfare::roll_maintenance(current).expect("roll maintenance is infallible");
        let after_one = pallet_welfare::GateBreachFlags::<Runtime>::iter().count();
        assert_eq!(
            seeded - after_one,
            pallet_welfare::EPOCH_ROLL_PRUNE_MAX_EPOCHS,
            "one roll retired more than its bounded batch",
        );
        // Repeated rolls do drain it.
        for _ in 0..seeded {
            RuntimeEpochWelfare::roll_maintenance(current).expect("roll maintenance is infallible");
        }
        assert_eq!(
            pallet_welfare::GateBreachFlags::<Runtime>::iter().count(),
            0
        );
    });
}

// ---------------------------------------------------------------- SQ-79
//
// The runtime binds `RuntimeEpochWelfare::compute_settlement` to the welfare
// pallet's measured settlement path (05 §6). A cohort whose e+1…e+2 gate window
// carries no observation at all must fail there, holding the ledger at the
// status quo, rather than settling gate books at "no breach".

#[test]
fn sq79_the_runtime_settlement_seam_refuses_an_unsampled_gate_window() {
    crate::tests::development_ext().execute_with(|| {
        install_spec(1, 1);
        let result = RuntimeEpochWelfare::compute_settlement(
            10,
            1,
            pallet_epoch::SettlementTarget::Proposal {
                pid: 42,
                has_gate_books: true,
            },
        );
        assert!(
            result.is_err(),
            "settlement over a wholly unobserved gate window must not succeed",
        );
    });
}

// ---------------------------------------------------------------- SQ-82
//
// `register_spec` is a live dispatch and must never reach the genesis
// activation relaxation, whatever the epoch clock reads. The runtime binds
// `CurrentEpoch = pallet_epoch::CurrentEpoch`, so this pins the composed
// behavior rather than the mock's.

#[test]
fn sq82_the_runtime_register_spec_origin_set_is_closed_and_lead_bound() {
    crate::tests::development_ext().execute_with(|| {
        let current = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let specs: Vec<pallet_welfare::MetricSpec> = vec![];
        // Negative origin: a signed account is never the metric-track authority
        // (06 §3.2), so the call is refused before any activation check.
        let refused = pallet_welfare::Pallet::<Runtime>::register_spec(
            crate::RuntimeOrigin::signed(crate::tests::account(1)),
            9,
            pallet_welfare::BoundedSpecSet::try_from(specs).expect("empty set is bounded"),
        );
        assert!(refused.is_err(), "a signed origin must not register specs");
        // The clock the live path reads is the real epoch clock, never a
        // genesis sentinel supplied by the caller.
        assert_eq!(
            current,
            <Runtime as pallet_welfare::Config>::CurrentEpoch::get(),
        );
    });
}

/// SQ-195: the 07 §8 reserve-health input `R` is day-resolved, fail-static, and
/// **not measured before the probe arms**.
///
/// The last property is the one the row warned about: with the probe unarmed,
/// scoring absence as 0 would drive `R = 0` on every day and set the daily C
/// breach flag out of a mechanism that never ran — fail-destructive, not
/// fail-safe. `ReserveProbeArmed` is exactly the latch that distinguishes
/// "measured and failed" from "not measuring yet".
#[test]
fn sq195_reserve_health_is_day_resolved_and_unmeasured_before_arming() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 41;
    const EPOCH: futarchy_primitives::EpochId = 4;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        let r_of = |day: u8| {
            crate::configs::RuntimeMetricInputs::daily_components(EPOCH, day, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        // Unarmed: absent entirely, so a spec registering R fails the crank
        // status-quo-safe rather than fabricating either health or breach.
        assert!(!crate::Oracle::reserve_probe_armed());
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(EPOCH, 1, true);
        assert_eq!(r_of(1), None, "R must be unavailable before the probe arms");

        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);

        // Armed: a recorded pass scores 1, a recorded fail scores 0, and an
        // unrecorded day scores 0 — absence is never healthy (07 §8).
        assert_eq!(
            r_of(1),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE))
        );
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(EPOCH, 2, false);
        assert_eq!(r_of(2), Some(futarchy_primitives::FixedU64(0)));
        assert_eq!(r_of(3), Some(futarchy_primitives::FixedU64(0)));

        // A failed day stays failed: a later success for the same day cannot
        // rewrite it, which is what makes recovery non-retroactive.
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(EPOCH, 2, true);
        assert_eq!(r_of(2), Some(futarchy_primitives::FixedU64(0)));

        // The epoch tally is raw, not a verdict: one failed day and one passed
        // day, with every other day of the epoch simply unrecorded.
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::reserve_probe_epoch_tally(EPOCH),
            (1, 1)
        );
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::reserve_probe_epoch_tally(EPOCH + 1),
            (0, 0)
        );
    });
}

/// SQ-195 (R-6 round 4 blocker): a partially-covered epoch must never read as
/// healthy. The first implementation projected the epoch as the minimum over
/// *recorded* days, so an epoch with one passing day and every other day
/// unrecorded returned `R = 1` — precisely the "absence is never healthy"
/// violation 07 §8 forbids, and it would have raised settlement-time `C_e`
/// (05 §4.4) on an epoch the probe barely ran in.
#[test]
fn sq195_epoch_projection_requires_complete_day_cover() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 42;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);

        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let timing = pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch)
            .expect("the live epoch has timing");
        let expected_days = timing.length / futarchy_primitives::kernel::BLOCKS_PER_DAY;
        assert!(expected_days > 1, "the epoch must span several probe days");

        let epoch_r = || {
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        // One passing day, the rest unrecorded: NOT healthy.
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 0, true);
        assert_eq!(
            epoch_r(),
            Some(futarchy_primitives::FixedU64(0)),
            "a single passing day cannot carry an epoch the probe did not cover",
        );

        // Every expected day passing: healthy.
        for day in 1..expected_days {
            let day = u8::try_from(day).expect("epoch days fit u8");
            pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, day, true);
        }
        assert_eq!(
            epoch_r(),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE)),
        );

        // One failed day flips it back, regardless of cover.
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 0, false);
        assert_eq!(epoch_r(), Some(futarchy_primitives::FixedU64(0)));
    });
}

/// SQ-195: the cover-complete projection must never be **vacuous**.
///
/// `expected_days = epoch.length / BLOCKS_PER_DAY` is zero wherever an epoch is
/// shorter than the frozen 14,400-block day — which the default-off
/// `fast-timing` build produces, since it compresses `MIN_EPOCH_LENGTH_BLOCKS`
/// while `BLOCKS_PER_DAY` stays frozen. Without a floor, `passed >= 0` reports
/// an epoch healthy with no probe recorded at all: release timing never reaches
/// that branch, but a compressed drill runtime would have been handed false
/// confidence. Found by inspection, not by the suite, so it is pinned here.
#[test]
fn sq195_sub_day_epoch_still_requires_a_recorded_pass() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 43;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);

        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        // Force the sub-day case directly: an epoch shorter than one frozen
        // day, which is the shape the compressed `fast-timing` build produces.
        pallet_epoch::Schedule::<Runtime>::mutate(|schedule| {
            schedule.length = futarchy_primitives::kernel::BLOCKS_PER_DAY / 4;
        });
        assert!(
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch)
                .expect("live epoch has timing")
                .length
                < futarchy_primitives::kernel::BLOCKS_PER_DAY,
            "precondition: the epoch must be shorter than one frozen day",
        );

        let epoch_r = || {
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        // Nothing recorded: must NOT be healthy, even though the epoch is
        // shorter than a day and the naive expected count would be zero.
        assert_eq!(
            epoch_r(),
            Some(futarchy_primitives::FixedU64(0)),
            "a sub-day epoch with no recorded probe must not read healthy",
        );

        // One recorded pass satisfies the floored requirement.
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 0, true);
        assert_eq!(
            epoch_r(),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE)),
        );
    });
}

/// SQ-195 (R-6 round 5): **counting passes is not covering days.**
///
/// The superseded projection compared `passed >= expected_days`, so passes
/// recorded on out-of-range days satisfied the count while the epoch's actual
/// probe days went unprobed — "absence is never healthy" defeated by
/// arithmetic. The check now walks the days themselves.
#[test]
fn sq195_projection_covers_days_not_just_a_pass_count() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 44;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");
        let days = timing.length / futarchy_primitives::kernel::BLOCKS_PER_DAY;
        assert!(days >= 3, "the epoch must span several probe days");

        let epoch_r = || {
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        // `days` passes, but all recorded *outside* the epoch's day range. A
        // count-based check reads this as full coverage; a cover check does not.
        for offset in 0..days {
            let day = u8::try_from(days + offset).expect("day fits u8");
            pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, day, true);
        }
        assert_eq!(
            epoch_r(),
            Some(futarchy_primitives::FixedU64(0)),
            "out-of-range passes must not satisfy the epoch's own day cover",
        );
    });
}

/// SQ-195 (R-6 round 5): 07 §8 scores **zero** pre-arm slots, so an epoch in
/// which the probe arms partway through must still be able to read healthy on
/// complete post-arm coverage. Requiring day 0 of such an epoch would make it
/// permanently unhealthy for a mechanism that did not yet exist.
#[test]
fn sq195_pre_arm_days_are_outside_the_measured_range() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 45;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");
        let day_len = futarchy_primitives::kernel::BLOCKS_PER_DAY;
        let days = timing.length / day_len;
        assert!(days >= 3);

        // The probe arms on day 2 of this epoch.
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_oracle::ReserveProbeArmedAt::<Runtime>::put(timing.start + 2 * day_len);

        let epoch_r = || {
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        // Days 0 and 1 are pre-arm and never recorded; days 2.. all pass.
        for day in 2..days {
            let day = u8::try_from(day).expect("day fits u8");
            pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, day, true);
        }
        assert_eq!(
            epoch_r(),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE)),
            "pre-arm days must not hold a fully-covered post-arm epoch unhealthy",
        );

        // A post-arm gap still fails.
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 2, false);
        assert_eq!(epoch_r(), Some(futarchy_primitives::FixedU64(0)));
    });
}

/// SQ-195 (R-6 round 6): an **empty measured range** must not read as healthy.
///
/// Round 5's fix returned `Some(true)` when the probe armed inside an epoch's
/// trailing partial day, reasoning that no completed cadence slot existed so
/// there was nothing to score. That is the same "absence is healthy" defect in
/// a new guise: `R = 1` was emitted for an epoch the probe never measured. The
/// honest answer is that the metric is not measured — `None`, exactly as for an
/// unarmed chain — so the crank fails status-quo-safe.
#[test]
fn sq195_empty_measured_range_is_unavailable_not_healthy() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 46;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");

        // Armed past the epoch's last whole day: nothing was ever measured.
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_oracle::ReserveProbeArmedAt::<Runtime>::put(
            timing.start.saturating_add(timing.length),
        );

        assert_eq!(
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value),
            None,
            "an epoch the probe never measured must be unavailable, never healthy",
        );
    });
}
