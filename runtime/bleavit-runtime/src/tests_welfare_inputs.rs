//! Runtime-level welfare-input regressions (milestone A12): SQ-79, SQ-82, SQ-201.
//!
//! These exercise the runtime *composition* — the `WelfareSettlement` seam and
//! the real `pallet-welfare` storage — rather than the pallet in its mock. The
//! pallet-level rules themselves are pinned in `pallets/welfare/src/tests.rs`.

use alloc::{vec, vec::Vec};

use frame_support::{assert_ok, traits::Get};

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
    install_specs(
        version,
        vec![metric_spec(
            id,
            version,
            activation_epoch,
            pallet_welfare::Pillar::COnchain,
            pallet_welfare::SourceClass::Onchain,
        )],
    );
}

/// One well-formed `MetricSpec`, with the pillar and source class left to the
/// caller so the S-pillar and attested paths can be exercised too.
fn metric_spec(
    id: futarchy_primitives::MetricId,
    version: futarchy_primitives::MetricSpecVersion,
    activation_epoch: futarchy_primitives::EpochId,
    pillar: pallet_welfare::Pillar,
    source: pallet_welfare::SourceClass,
) -> pallet_welfare::MetricSpec {
    pallet_welfare::MetricSpec {
        id,
        version,
        pillar,
        weight: futarchy_primitives::FixedU64(pallet_welfare::ONE),
        epsilon_floor: pallet_welfare::EPSILON_PILLAR,
        activation_epoch,
        source,
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

/// Replace the registered spec set with `specs`, installed directly so these
/// tests do not depend on the (still absent) production genesis MetricSpec set.
fn install_specs(
    version: futarchy_primitives::MetricSpecVersion,
    specs: Vec<pallet_welfare::MetricSpec>,
) {
    for (stored, _) in pallet_welfare::MetricSpecs::<Runtime>::iter() {
        pallet_welfare::MetricSpecs::<Runtime>::remove(stored);
    }
    pallet_welfare::SnapshotDeadline::<Runtime>::kill();
    let specs = pallet_welfare::BoundedSpecSet::try_from(specs).expect("test spec set is bounded");
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
            &[pallet_epoch::SettlementTarget::Proposal {
                pid: 42,
                has_gate_books: true,
            }],
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

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        // The live epoch, so the day-level rule can resolve real timing; an
        // epoch whose timing is unknown is *unavailable*, not a failure,
        // because pre-arm days cannot be distinguished without it.
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let r_of = |day: u8| {
            crate::configs::RuntimeMetricInputs::daily_components(epoch, day, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        // Unarmed: absent entirely, so a spec registering R fails the crank
        // status-quo-safe rather than fabricating either health or breach.
        assert!(!crate::Oracle::reserve_probe_armed());
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 1, true);
        assert_eq!(r_of(1), None, "R must be unavailable before the probe arms");

        // Armed from the epoch's very start, so no day is pre-arm.
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_oracle::ReserveProbeArmedAt::<Runtime>::put(0);

        // Armed: a recorded pass scores 1, a recorded fail scores 0, and an
        // unrecorded day scores 0 — absence is never healthy (07 §8).
        assert_eq!(
            r_of(1),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE))
        );
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 2, false);
        assert_eq!(r_of(2), Some(futarchy_primitives::FixedU64(0)));
        assert_eq!(r_of(3), Some(futarchy_primitives::FixedU64(0)));

        // A failed day stays failed: a later success for the same day cannot
        // rewrite it, which is what makes recovery non-retroactive.
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 2, true);
        assert_eq!(r_of(2), Some(futarchy_primitives::FixedU64(0)));

        // Raw storage still holds exactly what was recorded — one pass, one
        // fail — but no consumer reads it without going through the measured
        // range, which is what keeps the daily and epoch rules in agreement.
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::reserve_probe_daily(epoch, 1),
            Some(true)
        );
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::reserve_probe_daily(epoch, 2),
            Some(false)
        );
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::reserve_probe_daily(epoch, 3),
            None
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

/// SQ-195 (R-6 round 7): the pre-arm exemption binds the **daily** value too.
///
/// The epoch projection excluded pre-arm days, but `daily_components` converted
/// every unrecorded day to `R = 0` on the strength of the *global* armed latch
/// alone. That latch says the probe is armed **now**, not that it was armed on
/// the day being scored, so a late daily crank could classify time before the
/// mechanism existed as a reserve outage and set a `C_daily` breach flag from
/// it — exactly what 07 §8 excludes.
#[test]
fn sq195_daily_value_exempts_days_that_ended_before_arming() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 47;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");
        let day_len = futarchy_primitives::kernel::BLOCKS_PER_DAY;

        // Armed at the start of day 2: days 0 and 1 ended before it.
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_oracle::ReserveProbeArmedAt::<Runtime>::put(timing.start + 2 * day_len);

        let r_of = |day: u8| {
            crate::configs::RuntimeMetricInputs::daily_components(epoch, day, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        assert_eq!(r_of(0), None, "day 0 ended before arming — not measured");
        assert_eq!(r_of(1), None, "day 1 ended before arming — not measured");
        // Day 2 is measured: unrecorded is a real failure from here on.
        assert_eq!(r_of(2), Some(futarchy_primitives::FixedU64(0)));
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 2, true);
        assert_eq!(
            r_of(2),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE))
        );
    });
}

/// SQ-195 (R-6 round 8): the daily rule must reject days **outside the measured
/// range**, whatever storage holds.
///
/// Two paths previously turned such a day into a false `C_daily` breach: a
/// keeper submitting a day index beyond the epoch, and a stale outcome recorded
/// by a retired probe generation. Both worked because the daily rule consulted
/// the record before the range; the range now decides membership, and both
/// granularities share it so they cannot drift apart again.
#[test]
fn sq195_daily_rule_rejects_days_outside_the_measured_range() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 48;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");
        let day_len = futarchy_primitives::kernel::BLOCKS_PER_DAY;
        let last_whole_day = timing.length / day_len;
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_oracle::ReserveProbeArmedAt::<Runtime>::put(0);

        let r_of = |day: u8| {
            crate::configs::RuntimeMetricInputs::daily_components(epoch, day, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value)
        };

        // A day index past the epoch's last whole day is not a cadence slot,
        // even with a recorded failure sitting on it.
        let beyond = u8::try_from(last_whole_day).expect("day fits u8");
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, beyond, false);
        assert_eq!(
            r_of(beyond),
            None,
            "a day beyond the epoch cannot manufacture a C_daily breach",
        );

        // A far-out index behaves the same way.
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 200, false);
        assert_eq!(r_of(200), None);

        // A day inside the range still scores normally.
        assert_eq!(r_of(0), Some(futarchy_primitives::FixedU64(0)));
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 0, true);
        assert_eq!(
            r_of(0),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE))
        );

        // A recorded *pre-arm* day is excluded by the range too, so a retired
        // generation's outcome cannot latch a breach after re-arming.
        pallet_oracle::ReserveProbeArmedAt::<Runtime>::put(timing.start + 2 * day_len);
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, 1, false);
        assert_eq!(
            r_of(1),
            None,
            "a recorded pre-arm day stays outside the range"
        );
    });
}

/// SQ-195 (R-6 round 9): the sub-day floor must not manufacture a required day
/// for an epoch the probe never reached.
///
/// `last` is floored at one day so a sub-day epoch cannot pass vacuously. But
/// for such an epoch an `armed_at` past its end still floor-divides to day 0, so
/// the floor produced the range `[0, 1)` and reported an **entirely unmeasured**
/// epoch as *failed* rather than unmeasured — settleable, on data that never
/// existed. The unmeasured case is now decided before the floor applies.
#[test]
fn sq195_sub_day_epoch_armed_after_its_end_is_unmeasured_not_failed() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 49;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let day_len = futarchy_primitives::kernel::BLOCKS_PER_DAY;

        // A sub-day epoch, with the probe arming after it ended.
        pallet_epoch::Schedule::<Runtime>::mutate(|schedule| {
            schedule.length = day_len / 4;
        });
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");
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
            "an epoch the probe never reached must be unmeasured, not failed",
        );
        // The daily rule agrees — day 0 is outside the measured range.
        assert_eq!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, 0, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value),
            None,
        );
    });
}

// ----------------------------------------------------------------- A14
//
// 05 §4.3 `K` — collator-set adequacy — and the `(epoch, day)` authorship series
// it reads. The series is written by the block-authorship event handler and
// shared with the later `U` and `D_eff` bindings; the series' own bounded and
// fail-soft properties are pinned in `pallets/welfare/src/tests.rs`, and what
// follows is the runtime *projection*: the live `collator.n_min` divisor, the
// `min(1, ·)` saturation, and the two granularities agreeing.

/// The live 13 §1 divisor, read exactly as the production path reads it.
/// Hardcoding 4 here would make the suite pass on a chain whose governance had
/// legitimately amended the key (rule 4).
fn collator_n_min() -> u64 {
    u64::from(crate::configs::u8_param(b"collator.n_min"))
}

/// `min(1, distinct / collator.n_min)` on the 1e9 grid — the expectation
/// derived from the spec formula and the live key, never a copied constant.
fn expected_k(distinct: u64) -> futarchy_primitives::FixedU64 {
    let n_min = collator_n_min();
    assert!(n_min > 0, "the genesis registry seeds a positive n_min");
    futarchy_primitives::FixedU64((distinct * pallet_welfare::ONE / n_min).min(pallet_welfare::ONE))
}

fn author(n: u8) -> crate::AccountId {
    crate::tests::account(n)
}

#[test]
fn a14_collator_adequacy_is_projected_at_both_granularities() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 50;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::K);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let n_min = collator_n_min();
        assert!(n_min >= 3, "13 §1 bounds collator.n_min below at 3");

        let k_day = |day: u8| {
            crate::configs::RuntimeMetricInputs::daily_components(epoch, day, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::K)
                .map(|c| c.value)
        };
        let k_epoch = || {
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::K)
                .map(|c| c.value)
        };

        // An empty window is `K = 0`, not an unavailable component: 05 §4.3
        // gives `K` no missing-data rule because "nobody authored" is itself the
        // collator-set failure `K` measures, and it needs no mechanism to be
        // armed first (unlike `R`).
        assert_eq!(k_day(0), Some(futarchy_primitives::FixedU64(0)));
        assert_eq!(k_epoch(), Some(futarchy_primitives::FixedU64(0)));

        // Day 0: two distinct authors, one of them twice. Repeat blocks by one
        // author do not raise `K` — the formula counts *distinct* authors.
        pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 0, author(1));
        pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 0, author(1));
        pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 0, author(2));
        assert_eq!(k_day(0), Some(expected_k(2)));

        // Day 1: one distinct author, strictly below day 0 — the daily value
        // tracks that day only and does not inherit day 0's coverage.
        pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 1, author(1));
        assert_eq!(k_day(1), Some(expected_k(1)));

        // The epoch projection is the union across days: {1, 2}, not the sum of
        // the per-day counts (which would be 3) and not the last day's value.
        assert_eq!(k_epoch(), Some(expected_k(2)));

        // Enough distinct authors on one day to exceed `n_min`: `min(1, ·)`
        // saturates and never exceeds 1, which the pillar aggregation requires
        // of every component (05 §4.4).
        let over = u8::try_from(n_min).expect("n_min fits u8") + 2;
        for n in 10..(10 + over) {
            pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 2, author(n));
        }
        assert_eq!(
            k_day(2),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE)),
            "more distinct authors than n_min must saturate at 1, not exceed it",
        );
        assert_eq!(
            k_epoch(),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE)),
        );
    });
}

#[test]
fn a14_the_authorship_handler_feeds_both_the_payout_and_the_metric() {
    // The `pallet_authorship::EventHandler` drives two independent consumers off
    // one authored block: 08 §2.4's payout accumulator and 05 §4.3's measurement
    // series. Wiring only one of them is the silent failure this pins.
    crate::tests::development_ext().execute_with(|| {
        use pallet_authorship::EventHandler;

        let who = author(21);
        crate::configs::RuntimeCollatorAuthorship::note_author(who.clone());

        assert!(
            pallet_futarchy_treasury::CollatorAuthoredBlocks::<Runtime>::get()
                .iter()
                .any(|(stored, blocks)| *stored == who && *blocks == 1),
            "the authorship handler must still credit the 08 §2.4 payout accumulator",
        );
        // The measurement series is attributed by the *same* `(epoch, day)`
        // derivation the XCM-health and reserve-probe recorders use.
        assert!(
            pallet_welfare::CollatorAuthorship::<Runtime>::iter().any(|(_, _, window)| window
                .authors
                .iter()
                .any(|(stored, blocks)| *stored == who && *blocks == 1)),
            "the authorship handler must record the 05 §4.3 measurement series",
        );
        // And its epoch aggregate, which is what `record_snapshot` reads: a
        // writer that maintained only the day window would leave every epoch
        // projection reading zero authors.
        assert!(
            pallet_welfare::CollatorAuthorshipEpoch::<Runtime>::iter().any(|(_, window)| window
                .authors
                .iter()
                .any(|(stored, blocks)| *stored == who && *blocks == 1)),
            "the authorship handler must maintain the 05 §4.3 epoch aggregate",
        );
    });
}

#[test]
fn a14_a_zero_n_min_leaves_k_absent_and_fails_the_crank_closed() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 51;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::K);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 0, author(1));
        pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 0, author(2));

        // A healthy divisor gives a value, so the refusal below is attributable
        // to the divisor and to nothing else in the fixture.
        assert!(
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .any(|c| c.id == futarchy_primitives::metric_ids::K)
        );

        // Zero has no defined quotient. 13 §1 bounds the key below at 3, so this
        // is unreachable through governance; it is the defensive branch for a
        // key read that answers zero for any other reason.
        let key = pallet_constitution::key16(b"collator.n_min");
        pallet_constitution::Params::<Runtime>::mutate(key, |record| {
            let record = record
                .as_mut()
                .expect("collator.n_min is seeded at genesis");
            record.value = pallet_constitution::ParamValue::U8(0);
        });

        assert!(
            !crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .any(|c| c.id == futarchy_primitives::metric_ids::K),
            "a zero divisor must leave K absent, never substitute a value",
        );
        assert!(
            !crate::configs::RuntimeMetricInputs::daily_components(epoch, 0, VERSION)
                .into_iter()
                .any(|c| c.id == futarchy_primitives::metric_ids::K),
        );

        // And the crank fails status-quo-safe on the absence (G-1) rather than
        // recording a snapshot whose `C_onchain` was computed from a fabricated
        // component.
        let due = crate::Epoch::scheduled_epoch_end(epoch).expect("the live epoch is scheduled");
        crate::System::set_block_number(due);
        assert_ok!(crate::Epoch::tick(
            crate::RuntimeOrigin::signed(author(77)),
            Default::default(),
        ));
        assert!(
            crate::Welfare::record_snapshot(
                crate::RuntimeOrigin::signed(author(77)),
                epoch,
                VERSION,
            )
            .is_err(),
            "a snapshot must not be recorded over an unavailable component",
        );
        assert!(!pallet_welfare::Snapshots::<Runtime>::contains_key((
            epoch, VERSION
        )));
    });
}

#[test]
fn a14_try_state_holds_over_the_populated_authorship_series() {
    crate::tests::development_ext().execute_with(|| {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        for day in 0..3u8 {
            for n in 1..4u8 {
                pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, day, author(n));
            }
        }
        assert_ok!(pallet_welfare::Pallet::<Runtime>::do_try_state());

        // Severing the shared prefix index leaves the series unreachable by the
        // bounded reaper, which try-state must catch (I-20).
        pallet_welfare::XcmTrafficEpochs::<Runtime>::kill();
        assert!(pallet_welfare::Pallet::<Runtime>::do_try_state().is_err());
    });
}

// ----------------------------------------------------------------- A14
//
// The overflow sentinel. Dropping an author for want of room lowers a *count*,
// which is conservative for `K` (and `U`), but it does **not** lower a
// *concentration*: a window full of early low-count authors that drops a newly
// rotated author producing most of the remaining blocks keeps a near-uniform
// retained distribution while the real one is concentrated, so `D_eff` would
// read better than the truth. The window therefore withdraws its distribution
// while keeping its counts readable.

#[test]
fn a14_a_truncated_window_withdraws_the_distribution_but_not_the_count() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 52;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::K);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let bound =
            <<Runtime as pallet_welfare::Config>::MaxCollatorAuthorshipEntries as Get<u32>>::get();

        // Fill day 0 exactly to its bound: nothing dropped yet.
        for n in 0..bound {
            let author = crate::tests::account(u8::try_from(n).expect("the bound fits u8"));
            pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 0, author);
        }
        let full = crate::configs::AuthorshipWindowInput::day(epoch, 0);
        assert_eq!(full.distinct_active(), bound as usize);
        assert!(
            full.distribution().is_some(),
            "an untruncated window's distribution is the real one",
        );

        // A newly rotated author now produces most of the window's blocks and is
        // dropped every time. The retained distribution stays flat at one block
        // each — which is exactly why it must not be read.
        let rotated = crate::tests::account(u8::try_from(bound).expect("bound + 1 fits u8"));
        for _ in 0..40 {
            pallet_welfare::Pallet::<Runtime>::note_collator_authorship(epoch, 0, rotated.clone());
        }

        let truncated = crate::configs::AuthorshipWindowInput::day(epoch, 0);
        assert!(
            truncated.distribution().is_none(),
            "a truncated window must read as unavailable to a concentration consumer",
        );
        assert_eq!(
            truncated.distinct_active(),
            bound as usize,
            "the counts that survived are still readable and still conservative",
        );

        // `K` is a count component, so it still computes — and at this many
        // distinct authors it saturates at 1.
        assert_eq!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, 0, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::K)
                .map(|c| c.value),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE)),
        );
        // The epoch aggregate dropped the same author, so it latched too.
        assert!(crate::configs::AuthorshipWindowInput::epoch(epoch)
            .distribution()
            .is_none());

        // An **empty** window is unavailable to concentration for a different
        // reason and the same direction: `K` reads it as 0 (nobody authored —
        // the failure `K` measures), while 05 §4.5's HHI has no value over an
        // empty author set and the arithmetic that falls out of one would score
        // a perfect `D_eff` from no observations at all.
        let unwritten = crate::configs::AuthorshipWindowInput::day(epoch, 200);
        assert_eq!(unwritten.distinct_active(), 0);
        assert!(
            unwritten.distribution().is_none(),
            "an empty window must not read as an available, perfectly-diverse distribution",
        );
        assert_eq!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, 200, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::K)
                .map(|c| c.value),
            Some(futarchy_primitives::FixedU64(0)),
            "the same empty window is a real `K = 0`, not an unavailable count",
        );
    });
}

// ---------------------------------------------------------------- SQ-181
//
// 05 §4.7's measurable day set, normative: an epoch's whole days, floored at
// one. `MAX_DAILY_GATE_SAMPLES` (64) is the storage bound on the breach bitmap
// and not the semantic bound, so for every permitted `epoch.length` there are
// day indices below it that the epoch never contained. Resolving one of those
// would let a signed keeper drive `C_daily` down out of components that were
// never measured — `X` reads its no-traffic 1, `K` reads 0 because nobody
// authored in a day that never elapsed, and `R` refuses.

#[test]
fn sq181_measurable_days_are_the_epochs_whole_days_floored_at_one() {
    use pallet_welfare::{MetricInputs, SnapshotSchedule};

    crate::tests::development_ext().execute_with(|| {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let day_len = futarchy_primitives::kernel::BLOCKS_PER_DAY;
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");

        assert_eq!(
            crate::configs::RuntimeSnapshotSchedule::measurable_days(epoch),
            Some(timing.length / day_len),
        );

        // A trailing partial day is not a completed cadence slot.
        pallet_epoch::Schedule::<Runtime>::mutate(|schedule| {
            schedule.length = 3 * day_len + day_len / 2;
        });
        assert_eq!(
            crate::configs::RuntimeSnapshotSchedule::measurable_days(epoch),
            Some(3),
        );

        // Floored at one, so a sub-day `fast-timing` epoch cannot pass
        // vacuously by having an empty measurable set.
        pallet_epoch::Schedule::<Runtime>::mutate(|schedule| {
            schedule.length = day_len / 4;
        });
        assert_eq!(
            crate::configs::RuntimeSnapshotSchedule::measurable_days(epoch),
            Some(1),
        );

        // An epoch whose timing is unknown admits no day at all.
        assert_eq!(
            crate::configs::RuntimeSnapshotSchedule::measurable_days(epoch + 5),
            None,
        );

        // And the day domain is the *same* one 07 §8's `R` range is built from,
        // which is the point of single-homing it: the first day outside the set
        // is refused by the guard and unavailable to `R`, not scored 0.
        const VERSION: futarchy_primitives::MetricSpecVersion = 53;
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::R);
        pallet_epoch::Schedule::<Runtime>::mutate(|schedule| {
            schedule.length = 3 * day_len;
        });
        pallet_oracle::ReserveProbeArmed::<Runtime>::put(true);
        pallet_oracle::ReserveProbeArmedAt::<Runtime>::put(0);
        let measurable = crate::configs::RuntimeSnapshotSchedule::measurable_days(epoch)
            .expect("the live epoch has timing");
        let outside = u8::try_from(measurable).expect("day fits u8");
        pallet_welfare::Pallet::<Runtime>::note_reserve_probe(epoch, outside, false);
        assert_eq!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, outside, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::R)
                .map(|c| c.value),
            None,
            "the two consumers of the day domain must agree on its last day",
        );
    });
}

#[test]
fn sq181_record_daily_gate_refuses_a_day_the_epoch_never_had() {
    const VERSION: futarchy_primitives::MetricSpecVersion = 54;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::X);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let day_len = futarchy_primitives::kernel::BLOCKS_PER_DAY;
        let timing =
            pallet_epoch::Pallet::<Runtime>::epoch_timing(epoch).expect("live epoch has timing");
        let whole_days = timing.length / day_len;
        assert!(
            whole_days < u32::from(pallet_welfare::MAX_DAILY_GATE_SAMPLES),
            "the exploit needs a day the bitmap can address and the epoch cannot",
        );

        // Close the epoch so a keeper may crank its days at all.
        let due = crate::Epoch::scheduled_epoch_end(epoch).expect("the live epoch is scheduled");
        crate::System::set_block_number(due);
        assert_ok!(crate::Epoch::tick(
            crate::RuntimeOrigin::signed(author(77)),
            Default::default(),
        ));
        assert!(pallet_epoch::CurrentEpoch::<Runtime>::get() > epoch);

        let keeper = crate::RuntimeOrigin::signed(author(78));
        let last_day = u8::try_from(whole_days - 1).expect("day fits u8");

        // The last day inside the measurable set is admitted.
        assert_ok!(crate::Welfare::record_daily_gate(
            keeper.clone(),
            epoch,
            last_day,
            VERSION,
        ));
        assert!(pallet_welfare::GateBreachFlags::<Runtime>::contains_key(
            epoch
        ));
        let sampled = pallet_welfare::SampledGateDays::<Runtime>::get(epoch);

        // The first day outside it is refused, and nothing about the epoch's
        // recorded state moves: no sample, no breach flag, no `C_daily` input
        // resolved for a window that never existed.
        let beyond = u8::try_from(whole_days).expect("day fits u8");
        frame_support::assert_noop!(
            crate::Welfare::record_daily_gate(keeper.clone(), epoch, beyond, VERSION),
            pallet_welfare::Error::<Runtime>::DayOutsideEpoch,
        );
        frame_support::assert_noop!(
            crate::Welfare::record_daily_gate(
                keeper,
                epoch,
                pallet_welfare::MAX_DAILY_GATE_SAMPLES - 1,
                VERSION,
            ),
            pallet_welfare::Error::<Runtime>::DayOutsideEpoch,
        );
        assert_eq!(
            pallet_welfare::SampledGateDays::<Runtime>::get(epoch),
            sampled,
        );
    });
}

// --------------------------------------- A14 · 05 §4.3.2 block production `U`
//
// `U = clamp((non_empty_blocks + 0.25 · empty_blocks) / relay_slots, 0, 1)`, over
// a denominator that is the **sum of per-block relay-parent deltas**. The pallet
// owns the accumulator and is covered in `pallets/welfare/src/tests.rs`; these
// pin the runtime projection — the arithmetic, the zero-denominator rule, the
// source-class filter, and the two per-block hooks that feed it.

/// Record one block's two observations the way the runtime's hooks do.
fn note_block(epoch: futarchy_primitives::EpochId, day: u8, slots: u32, empty: bool) {
    pallet_welfare::Pallet::<Runtime>::note_block_production(
        epoch,
        day,
        pallet_welfare::BlockProductionSignal::RelaySlots(slots),
    );
    pallet_welfare::Pallet::<Runtime>::note_block_production(
        epoch,
        day,
        pallet_welfare::BlockProductionSignal::Authored { empty },
    );
}

/// Install a single S-pillar `U` spec and return the live epoch.
fn install_u_spec(version: futarchy_primitives::MetricSpecVersion) -> futarchy_primitives::EpochId {
    install_specs(
        version,
        vec![metric_spec(
            futarchy_primitives::metric_ids::U,
            version,
            0,
            pallet_welfare::Pillar::S,
            pallet_welfare::SourceClass::Onchain,
        )],
    );
    pallet_epoch::CurrentEpoch::<Runtime>::get()
}

/// A `PersistedValidationData` carrying nothing but the relay parent — the only
/// field this seam reads (I-24).
fn validation_data(relay_parent_number: u32) -> cumulus_primitives_core::PersistedValidationData {
    cumulus_primitives_core::PersistedValidationData {
        parent_head: Default::default(),
        relay_parent_number,
        relay_parent_storage_root: Default::default(),
        max_pov_size: 0,
    }
}

fn component_ids(components: Vec<pallet_welfare::ComponentValue>) -> Vec<u16> {
    let mut ids = components.into_iter().map(|c| c.id).collect::<Vec<_>>();
    ids.sort_unstable();
    ids
}

#[test]
fn u_weights_empty_blocks_at_a_quarter_over_the_relay_slot_denominator() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 60;

    crate::tests::development_ext().execute_with(|| {
        let epoch = install_u_spec(VERSION);
        let u_day = |day: u8| {
            crate::configs::RuntimeMetricInputs::daily_components(epoch, day, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::U)
                .map(|c| c.value.0)
        };

        // Four non-empty blocks, one per relay slot: a chain filling every slot
        // scores exactly 1.
        for _ in 0..4 {
            note_block(epoch, 0, 1, false);
        }
        assert_eq!(u_day(0), Some(pallet_welfare::ONE));

        // A fifth block, empty, on its own relay slot: (4 + 0.25) / 5 = 0.85.
        note_block(epoch, 0, 1, true);
        assert_eq!(u_day(0), Some(850_000_000));

        // Day 1: a collator outage widens the denominator without adding
        // blocks, and `U` falls in proportion — 1 / 5 = 0.2.
        note_block(epoch, 1, 5, false);
        assert_eq!(u_day(1), Some(200_000_000));

        // The epoch projection sums the same per-block terms over both days:
        // (5 + 0.25) / 10 = 0.525.
        assert_eq!(
            crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::U)
                .map(|c| c.value.0),
            Some(525_000_000),
        );
    });
}

#[test]
fn u_clamps_above_one_when_blocks_outrun_relay_slots() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 61;

    crate::tests::development_ext().execute_with(|| {
        let epoch = install_u_spec(VERSION);
        // Elastic scaling: two parachain blocks share one relay parent, so the
        // second contributes a delta of zero. The ratio exceeds 1 and clamps —
        // producing more blocks than relay slots is maximum liveness.
        note_block(epoch, 0, 1, false);
        note_block(epoch, 0, 0, false);

        assert_eq!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, 0, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::U)
                .map(|c| c.value.0),
            Some(pallet_welfare::ONE),
        );
    });
}

/// One block in the window is a well-defined score, not a division by zero:
/// §4.3.2's per-block deltas give it a denominator of its own, which an endpoint
/// difference could not.
#[test]
fn a_one_block_window_scores_rather_than_dividing_by_zero() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 64;

    crate::tests::development_ext().execute_with(|| {
        let epoch = install_u_spec(VERSION);
        note_block(epoch, 3, 1, false);

        assert_eq!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, 3, VERSION)
                .into_iter()
                .find(|c| c.id == futarchy_primitives::metric_ids::U)
                .map(|c| c.value.0),
            Some(pallet_welfare::ONE),
        );
    });
}

/// The rule 05 §4.3.2 makes normative: a zero denominator resolves `U`
/// **absent**, never a fabricated 1.0 — which is exactly the reading the
/// superseded parachain-block denominator produced, and the reason it measured
/// nothing. An unavailable registered component fails the crank status-quo-safe.
#[test]
fn zero_denominator_leaves_u_absent_and_fails_the_crank_closed() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 62;

    crate::tests::development_ext().execute_with(|| {
        let epoch = install_u_spec(VERSION);
        // Nothing observed at all.
        assert!(crate::configs::RuntimeMetricInputs::onchain_components(epoch, VERSION).is_empty());
        assert!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, 0, VERSION).is_empty()
        );

        // A window that recorded authorship but no relay slot is equally
        // unmeasured: the denominator, not the numerator, is what `U` divides by.
        pallet_welfare::Pallet::<Runtime>::note_block_production(
            epoch,
            0,
            pallet_welfare::BlockProductionSignal::Authored { empty: false },
        );
        assert!(
            crate::configs::RuntimeMetricInputs::daily_components(epoch, 0, VERSION).is_empty()
        );

        // And the crank refuses rather than snapshotting a fabricated score.
        pallet_epoch::EpochOf::<Runtime>::mutate(|info| info.index = epoch.saturating_add(1));
        assert!(
            pallet_welfare::Pallet::<Runtime>::record_snapshot(
                crate::RuntimeOrigin::signed(crate::tests::account(1)),
                epoch,
                VERSION,
            )
            .is_err(),
            "a registered component with no value must fail the crank closed",
        );
    });
}

// ------------------------------------------------------- A14: `H` and `Π`
//
// 05 §4.3's two remaining on-chain `C_onchain` components. The pallet owns the
// accumulators (pinned in `pallets/welfare/src/tests.rs`); what is composed here
// is the projection into component values — the 40 % mapping for `H`, the
// `max(0, 1 − 0.25·n)` step for `Π`, and the deliberate asymmetry in how the two
// treat an empty window.

fn seed_sample(epoch: futarchy_primitives::EpochId, day: u8, utilization: u64, blocks: u32) {
    // Bind the epoch to the shared retention index the way a real recorder
    // would, so the seeded rows stay reachable by the bounded reaper.
    pallet_welfare::Pallet::<Runtime>::note_xcm_traffic(
        epoch,
        day,
        pallet_welfare::XcmTrafficKind::Accepted,
    );
    pallet_welfare::BlockWeightSamples::<Runtime>::insert(
        epoch,
        day,
        pallet_welfare::BlockWeightSample {
            utilization_sum: utilization,
            blocks,
        },
    );
}

fn component_of(
    id: futarchy_primitives::MetricId,
    epoch: futarchy_primitives::EpochId,
    version: futarchy_primitives::MetricSpecVersion,
) -> Option<futarchy_primitives::FixedU64> {
    use pallet_welfare::MetricInputs;
    crate::configs::RuntimeMetricInputs::onchain_components(epoch, version)
        .into_iter()
        .find(|c| c.id == id)
        .map(|c| c.value)
}

fn daily_component_of(
    id: futarchy_primitives::MetricId,
    epoch: futarchy_primitives::EpochId,
    day: u8,
    version: futarchy_primitives::MetricSpecVersion,
) -> Option<futarchy_primitives::FixedU64> {
    use pallet_welfare::MetricInputs;
    crate::configs::RuntimeMetricInputs::daily_components(epoch, day, version)
        .into_iter()
        .find(|c| c.id == id)
        .map(|c| c.value)
}

/// 05 §4.3: `H = 1 − mean(used ÷ limit)`, "mapped so 40% target utilization ⇒ 1".
///
/// The two properties that fix the mapping: **exactly** 1 at the 40 % target,
/// and falling from there as utilization rises. Below target it clamps — spare
/// capacity is healthy, not better than healthy, and an unclamped `H` would push
/// `C_onchain` off the [0,1] domain both §4.1 gates are defined on.
#[test]
fn a14_h_reads_one_at_target_falls_above_it_and_clamps_below() {
    const VERSION: futarchy_primitives::MetricSpecVersion = 61;
    const ONE: u64 = pallet_welfare::ONE;
    // The 40 % is a kernel constant, never a literal in the consumer (rule 4).
    let target = futarchy_primitives::kernel::WEIGHT_HEADROOM_TARGET_UTILIZATION;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::H);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let h_at = |utilization: u64| {
            seed_sample(epoch, 0, utilization, 1);
            component_of(futarchy_primitives::metric_ids::H, epoch, VERSION)
        };

        // Exactly at target: exactly 1. Not 0.999…, not the raw 1 − 0.4 = 0.6.
        assert_eq!(h_at(target), Some(futarchy_primitives::FixedU64(ONE)));

        // Above target it falls, strictly and monotonically.
        let just_above = h_at(target + 1).expect("sampled");
        assert!(
            just_above.0 < ONE,
            "H must fall the moment utilization passes the target",
        );
        let seventy = h_at(700_000_000).expect("sampled");
        // (1 − 0.7) / (1 − 0.4) = 0.5 exactly on the 1e9 grid.
        assert_eq!(seventy, futarchy_primitives::FixedU64(500_000_000));
        assert!(
            seventy.0 < just_above.0,
            "H must be monotone in utilization"
        );
        // A saturated block leaves no headroom at all.
        assert_eq!(h_at(ONE), Some(futarchy_primitives::FixedU64(0)));

        // Below target it clamps at 1 rather than exceeding the pillar domain.
        assert_eq!(h_at(target - 1), Some(futarchy_primitives::FixedU64(ONE)));
        assert_eq!(h_at(100_000_000), Some(futarchy_primitives::FixedU64(ONE)));
        assert_eq!(h_at(0), Some(futarchy_primitives::FixedU64(ONE)));
    });
}

/// Both granularities read the same accumulator, and the epoch projection is
/// **block-weighted**: a day that produced two blocks must not weigh the same as
/// a full one.
#[test]
fn a14_h_is_block_weighted_across_the_epoch_and_day_resolved_within_it() {
    const VERSION: futarchy_primitives::MetricSpecVersion = 62;
    const ONE: u64 = pallet_welfare::ONE;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::H);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        // Day 0: one saturated block. Day 1: one idle block.
        seed_sample(epoch, 0, ONE, 1);
        seed_sample(epoch, 1, 0, 1);

        // Day-resolved: the two days disagree completely.
        assert_eq!(
            daily_component_of(futarchy_primitives::metric_ids::H, epoch, 0, VERSION),
            Some(futarchy_primitives::FixedU64(0)),
        );
        assert_eq!(
            daily_component_of(futarchy_primitives::metric_ids::H, epoch, 1, VERSION),
            Some(futarchy_primitives::FixedU64(ONE)),
        );

        // Epoch-wide: mean 0.5 ⇒ (1 − 0.5)/0.6 = 0.8333…, truncated down.
        assert_eq!(
            component_of(futarchy_primitives::metric_ids::H, epoch, VERSION),
            Some(futarchy_primitives::FixedU64(833_333_333)),
        );

        // Two more idle blocks on day 1 move the epoch mean to 0.25 — below
        // target — while day 0 is unchanged. That is only possible because the
        // epoch sums blocks, not daily means.
        seed_sample(epoch, 1, 0, 3);
        assert_eq!(
            component_of(futarchy_primitives::metric_ids::H, epoch, VERSION),
            Some(futarchy_primitives::FixedU64(ONE)),
        );
        assert_eq!(
            daily_component_of(futarchy_primitives::metric_ids::H, epoch, 0, VERSION),
            Some(futarchy_primitives::FixedU64(0)),
        );
    });
}

/// The filter selects on **source class**, not pillar. Before A14 it read
/// `pillar == COnchain`, which made every S component structurally unemittable
/// however it was registered — `U` included.
#[test]
fn the_source_class_filter_admits_s_and_still_excludes_attested() {
    use pallet_welfare::MetricInputs;
    const VERSION: futarchy_primitives::MetricSpecVersion = 63;

    crate::tests::development_ext().execute_with(|| {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        install_specs(
            VERSION,
            vec![
                // `C_onchain`: emitted before and after the change.
                metric_spec(
                    futarchy_primitives::metric_ids::X,
                    VERSION,
                    0,
                    pallet_welfare::Pillar::COnchain,
                    pallet_welfare::SourceClass::Onchain,
                ),
                // `S`: newly reachable.
                metric_spec(
                    futarchy_primitives::metric_ids::U,
                    VERSION,
                    0,
                    pallet_welfare::Pillar::S,
                    pallet_welfare::SourceClass::Onchain,
                ),
                // `C_attested`: never emitted by this path. `welfare-core`'s
                // `source_matches_pillar` guarantees an attested pillar carries
                // an attested source, so the source filter excludes it as
                // strictly as the pillar filter did.
                metric_spec(
                    futarchy_primitives::metric_ids::A_RUNTIME_PERF,
                    VERSION,
                    0,
                    pallet_welfare::Pillar::CAttested,
                    pallet_welfare::SourceClass::Attested,
                ),
            ],
        );
        note_block(epoch, 0, 1, false);

        // No local XCM traffic means `X = 1` (absence of failure, 09 §6.4), so
        // both deterministic components resolve and the attested one does not.
        assert_eq!(
            component_ids(crate::configs::RuntimeMetricInputs::daily_components(
                epoch, 0, VERSION
            )),
            vec![
                futarchy_primitives::metric_ids::X,
                futarchy_primitives::metric_ids::U,
            ],
        );
        // `onchain_components` adds attested values only from the oracle's own
        // settled records, and there are none — so the attested component stays
        // absent there too rather than being computed by this path.
        assert_eq!(
            component_ids(crate::configs::RuntimeMetricInputs::onchain_components(
                epoch, VERSION
            )),
            vec![
                futarchy_primitives::metric_ids::X,
                futarchy_primitives::metric_ids::U,
            ],
        );
    });
}

/// The two per-block hooks: the relay delta rides the parachain inherent's
/// single `relay_parent_number` read, and the emptiness classification waits for
/// the extrinsic count to be final.
#[test]
fn the_per_block_hooks_record_the_relay_delta_and_the_emptiness_class() {
    use cumulus_pallet_parachain_system::OnSystemEvent;
    use frame_support::traits::{PostInherents, PostTransactions};

    crate::tests::development_ext().execute_with(|| {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();

        // No baseline yet: 05 §4.3.2's nominal-cadence rule gives the first
        // block a delta of one rather than a zero denominator or an arbitrary
        // jump.
        assert!(pallet_epoch::LastRelayParent::<Runtime>::get().is_none());
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(&validation_data(1_000));
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch).relay_slots,
            1,
        );
        // The detector's baseline is the one that advanced — a single
        // observation, read by both consumers.
        assert_eq!(pallet_epoch::LastRelayParent::<Runtime>::get(), Some(1_000));

        // Emptiness: the inherent published the window, `post_inherents`
        // captures the inherent boundary, and `post_transactions` classifies
        // against the final extrinsic count. Two inherents and nothing else is
        // an all-inherent block.
        frame_system::Pallet::<Runtime>::set_extrinsic_index(2);
        crate::configs::BlockProductionInherentBoundary::post_inherents();
        frame_system::Pallet::<Runtime>::note_finished_extrinsics();
        crate::configs::BlockProductionRecorder::post_transactions();
        let counters = pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch);
        assert_eq!((counters.empty_blocks, counters.non_empty_blocks), (1, 0));
        // The window is consumed, so nothing can be attributed twice.
        assert!(crate::configs::BlockProductionWindow::get().is_none());

        // Next block: two inherents plus one transaction is not empty. A block
        // whose call failed or was filtered lands here too — it consumed its
        // slot, and `note_applied_extrinsic` counted it whatever the dispatch
        // returned. The delta is measured against the previous block's baseline.
        frame_system::Pallet::<Runtime>::set_block_number(2);
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(&validation_data(1_007));
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch).relay_slots,
            8,
        );
        frame_system::Pallet::<Runtime>::set_extrinsic_index(2);
        crate::configs::BlockProductionInherentBoundary::post_inherents();
        frame_system::Pallet::<Runtime>::set_extrinsic_index(3);
        frame_system::Pallet::<Runtime>::note_finished_extrinsics();
        crate::configs::BlockProductionRecorder::post_transactions();
        let counters = pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch);
        assert_eq!((counters.empty_blocks, counters.non_empty_blocks), (1, 1));

        // A block with no inherents at all is still classified, not skipped:
        // the boundary is zero and its transactions decide.
        frame_system::Pallet::<Runtime>::set_block_number(3);
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(&validation_data(1_008));
        frame_system::Pallet::<Runtime>::set_extrinsic_index(0);
        crate::configs::BlockProductionInherentBoundary::post_inherents();
        frame_system::Pallet::<Runtime>::note_finished_extrinsics();
        crate::configs::BlockProductionRecorder::post_transactions();
        let counters = pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch);
        assert_eq!((counters.empty_blocks, counters.non_empty_blocks), (2, 1));
    });
}

/// A post-transaction hook with no window published for **this** block records
/// nothing: an observation that cannot be attributed is dropped, not guessed.
///
/// Reachable through the inherent's own early returns — a recovery-abort block
/// returns before publishing a window, and its authored count must not be
/// recorded either. A numerator with no denominator is the direction that
/// *overstates* liveness, which is the one G-1 forbids.
#[test]
fn an_unattributable_block_is_dropped_rather_than_guessed_into_a_window() {
    use cumulus_pallet_parachain_system::OnSystemEvent;
    use frame_support::traits::{PostInherents, PostTransactions};

    crate::tests::development_ext().execute_with(|| {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();

        // No inherent ran, so no window exists.
        frame_system::Pallet::<Runtime>::set_extrinsic_index(3);
        crate::configs::BlockProductionInherentBoundary::post_inherents();
        frame_system::Pallet::<Runtime>::note_finished_extrinsics();
        crate::configs::BlockProductionRecorder::post_transactions();
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch),
            pallet_welfare::BlockProductionCounters::default(),
        );

        // A window left behind by an earlier block is equally unusable: the
        // stamp, not merely the presence of a value, is what authorizes the
        // attribution.
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(&validation_data(2_000));
        frame_system::Pallet::<Runtime>::set_block_number(9);
        frame_system::Pallet::<Runtime>::set_extrinsic_index(1);
        crate::configs::BlockProductionInherentBoundary::post_inherents();
        frame_system::Pallet::<Runtime>::note_finished_extrinsics();
        crate::configs::BlockProductionRecorder::post_transactions();
        let counters = pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch);
        // The relay slot the inherent did record stands; the authored block does
        // not, because it could not be attributed to the window that recorded it.
        assert_eq!(counters.relay_slots, 1);
        assert_eq!((counters.empty_blocks, counters.non_empty_blocks), (0, 0));
        // And the stale capture is gone, so it cannot be reused a third time.
        assert!(crate::configs::BlockProductionWindow::get().is_none());
    });
}

/// A boundary block carrying a real `Epoch::tick` is **one** block in **one**
/// window.
///
/// The relay-slot delta is recorded by the parachain inherent, before any
/// transaction; the emptiness classification cannot be decided until after all
/// of them. `Epoch::tick` is a permissionless *transaction*, so it lands between
/// the two and advances `EpochOf`/`Schedule`. Recomputing the window in the
/// post-transaction hook therefore split the block across two epochs — the
/// completed epoch received a relay slot with no authored block (depressing its
/// `U`, an `S`-pillar input to gate settlement) and the opening epoch received an
/// authored block with no slot of its own.
#[test]
fn a_boundary_block_with_a_real_tick_lands_wholly_in_one_window() {
    use cumulus_pallet_parachain_system::OnSystemEvent;
    use frame_support::traits::{PostInherents, PostTransactions};

    crate::tests::development_ext().execute_with(|| {
        let closing = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let schedule = pallet_epoch::Schedule::<Runtime>::get();
        let boundary = schedule.epoch_start_block.saturating_add(schedule.length);
        let closing_day = u8::try_from(
            boundary.saturating_sub(schedule.epoch_start_block)
                / futarchy_primitives::kernel::BLOCKS_PER_DAY,
        )
        .expect("the epoch's day index fits the u8 second key");
        frame_system::Pallet::<Runtime>::set_block_number(boundary);

        // 1. The parachain inherent: relay slot recorded, window published.
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(&validation_data(7_000));
        assert_eq!(
            crate::configs::BlockProductionWindow::get(),
            Some((boundary, closing, closing_day)),
        );

        // 2. `post_inherents` — two inherents in this block.
        frame_system::Pallet::<Runtime>::set_extrinsic_index(2);
        crate::configs::BlockProductionInherentBoundary::post_inherents();

        // 3. The block's transaction is a real `Epoch::tick`, which crosses the
        //    epoch clock. This is the hazard: the window the recomputation would
        //    now see is not the one this block's relay slot went into.
        frame_system::Pallet::<Runtime>::set_extrinsic_index(3);
        frame_support::assert_ok!(crate::Epoch::tick(
            crate::RuntimeOrigin::signed(crate::tests::account(94)),
            Default::default(),
        ));
        let opening = pallet_epoch::CurrentEpoch::<Runtime>::get();
        assert_eq!(opening, closing.saturating_add(1), "the tick must cross");
        assert_ne!(
            crate::configs::xcm_traffic_epoch_and_day(),
            (closing, closing_day),
            "the recomputed window must differ, or this test proves nothing",
        );

        // 4. `post_transactions` classifies the block and attributes it to the
        //    window captured in step 1 — not the one the clock reads now.
        frame_system::Pallet::<Runtime>::note_finished_extrinsics();
        crate::configs::BlockProductionRecorder::post_transactions();

        // Both halves in the closing epoch's window: one slot, one non-empty
        // authored block. `U` for it is 1, not 0.
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production(closing, closing_day),
            pallet_welfare::BlockProductionCounters {
                non_empty_blocks: 1,
                empty_blocks: 0,
                relay_slots: 1,
            },
        );
        // And the opening epoch is untouched — no authored block without a slot,
        // so no window whose ratio exceeds 1 and clamps the inflation out of
        // sight.
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production_epoch(opening),
            pallet_welfare::BlockProductionCounters::default(),
        );
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production_epoch(closing),
            pallet_welfare::BlockProductionCounters {
                non_empty_blocks: 1,
                empty_blocks: 0,
                relay_slots: 1,
            },
        );
    });
}

/// The cross-window baseline, end to end through the inherent hook: an outage
/// whose catch-up block lands on a new window's first block is charged to that
/// window, and to exactly one window.
#[test]
fn an_outage_across_a_window_boundary_is_lost_by_neither_window() {
    use cumulus_pallet_parachain_system::OnSystemEvent;

    crate::tests::development_ext().execute_with(|| {
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let day_len = futarchy_primitives::kernel::BLOCKS_PER_DAY;
        let start = pallet_epoch::Schedule::<Runtime>::get().epoch_start_block;

        // Last block of day 0.
        frame_system::Pallet::<Runtime>::set_block_number(start.saturating_add(day_len - 1));
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(&validation_data(5_000));
        // First block of day 1, after a 500-slot stall.
        frame_system::Pallet::<Runtime>::set_block_number(start.saturating_add(day_len));
        crate::configs::ExecutionGuardSystemEvent::on_validation_data(&validation_data(5_500));

        // Day 0 keeps only its own opening slot — the outage is not back-dated.
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production(epoch, 0).relay_slots,
            1,
        );
        // Day 1 carries the whole jump, because its baseline is the previous
        // *window's* last block. An endpoint difference would have lost it.
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production(epoch, 1).relay_slots,
            500,
        );
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_production_epoch(epoch).relay_slots,
            501,
        );
    });
}

/// A window with no sampled block resolves `H` **absent**, and the crank then
/// fails status-quo-safe (G-1).
///
/// The fabricated alternative — reading 1 — would raise `C_onchain` out of a
/// window nothing measured. 05 §4.3's missing-data column gives `H` no
/// "no data ⇒ 1" rule precisely because absence of a *measurement* is not the
/// same fact as absence of an *event*.
#[test]
fn a14_h_is_absent_without_a_sampled_block_and_the_crank_fails_closed() {
    const VERSION: futarchy_primitives::MetricSpecVersion = 63;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::H);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();

        assert_eq!(
            component_of(futarchy_primitives::metric_ids::H, epoch, VERSION),
            None,
            "an unsampled epoch must not fabricate headroom",
        );
        assert_eq!(
            daily_component_of(futarchy_primitives::metric_ids::H, epoch, 0, VERSION),
            None,
            "an unsampled day must not fabricate headroom",
        );

        // The composed consequence: with `H` registered and absent, the keeper
        // crank refuses rather than snapshotting a fabricated pillar.
        pallet_epoch::EpochOf::<Runtime>::mutate(|info| {
            info.index = epoch.saturating_add(1);
        });
        assert!(
            pallet_welfare::Pallet::<Runtime>::record_snapshot(
                crate::RuntimeOrigin::signed(crate::tests::account(77)),
                epoch,
                VERSION,
            )
            .is_err(),
            "a registered-but-unmeasured H must fail the crank status-quo-safe",
        );

        // One sampled block is all it takes for the same crank to proceed.
        seed_sample(
            epoch,
            0,
            futarchy_primitives::kernel::WEIGHT_HEADROOM_TARGET_UTILIZATION,
            1,
        );
        assert_eq!(
            component_of(futarchy_primitives::metric_ids::H, epoch, VERSION),
            Some(futarchy_primitives::FixedU64(pallet_welfare::ONE)),
        );
        assert!(pallet_welfare::Pallet::<Runtime>::record_snapshot(
            crate::RuntimeOrigin::signed(crate::tests::account(77)),
            epoch,
            VERSION,
        )
        .is_ok());
    });
}

/// 05 §4.3: `Π = max(0, 1 − 0.25 · defensive_failure_events)` per window, and
/// §4.3's missing-data rule makes **no events ⇒ 1** — the asymmetry with `H`.
///
/// `Π` counts occurrences of a fault, so a window with none is a window in which
/// the runtime's assumptions held; that *is* the healthy observation. `H`
/// averages a quantity, and a window with no sample has no average at all.
#[test]
fn a14_pi_steps_down_by_a_quarter_and_saturates_at_zero() {
    const VERSION: futarchy_primitives::MetricSpecVersion = 64;
    const ONE: u64 = pallet_welfare::ONE;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::PI);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let pi = || component_of(futarchy_primitives::metric_ids::PI, epoch, VERSION);
        let pi_daily =
            |day: u8| daily_component_of(futarchy_primitives::metric_ids::PI, epoch, day, VERSION);

        // No events: legitimately 1, and available — never absent.
        assert_eq!(pi(), Some(futarchy_primitives::FixedU64(ONE)));
        assert_eq!(pi_daily(0), Some(futarchy_primitives::FixedU64(ONE)));

        let note = |day: u8| {
            pallet_welfare::Pallet::<Runtime>::note_integrity_failure(
                epoch,
                day,
                futarchy_primitives::integrity::IntegrityFault::FailStaticLatch,
            )
        };

        note(0);
        assert_eq!(pi(), Some(futarchy_primitives::FixedU64(750_000_000)));
        note(0);
        assert_eq!(pi(), Some(futarchy_primitives::FixedU64(500_000_000)));
        note(0);
        assert_eq!(pi(), Some(futarchy_primitives::FixedU64(250_000_000)));
        // The fourth zeroes it — the saturation point the kernel constant fixes.
        note(0);
        assert_eq!(pi(), Some(futarchy_primitives::FixedU64(0)));
        assert_eq!(
            futarchy_primitives::kernel::INTEGRITY_FAILURES_TO_ZERO,
            4,
            "the step and the saturation point are one constant, not two",
        );
        // A fifth stays at zero rather than wrapping below it.
        note(0);
        assert_eq!(pi(), Some(futarchy_primitives::FixedU64(0)));

        // Day-resolved: a fault on day 0 leaves day 1 healthy, and the epoch
        // projection is the sum across days.
        assert_eq!(pi_daily(1), Some(futarchy_primitives::FixedU64(ONE)));
        note(1);
        assert_eq!(
            pi_daily(1),
            Some(futarchy_primitives::FixedU64(750_000_000))
        );
        assert_eq!(pi(), Some(futarchy_primitives::FixedU64(0)));
    });
}

/// The two runtime-side `Π` sites, and the one that deliberately is not.
///
/// 05 §4.3.2 admits a fail-static latch engaged out of a detected inconsistency.
/// `UPGRADE_ABORT_TRIGGER` is not one: the relay preserved the status quo,
/// nothing was discarded, and a fresh proposal is the defined path — which is
/// why it is excluded from `EXECUTION_HALT_SOURCES` and therefore from the
/// counter by construction rather than by a hand-maintained exception.
#[test]
fn a14_the_execution_halt_latch_counts_once_and_an_upgrade_abort_never_does() {
    const VERSION: futarchy_primitives::MetricSpecVersion = 65;

    crate::tests::development_ext().execute_with(|| {
        install_spec_for(VERSION, 0, futarchy_primitives::metric_ids::PI);
        let epoch = pallet_epoch::CurrentEpoch::<Runtime>::get();
        let count = || pallet_welfare::Pallet::<Runtime>::integrity_failures_epoch(epoch);

        // A relay-aborted upgrade raises the guardian-visible trigger without
        // halting execution. Not a §4.3.2 event.
        crate::configs::note_upgrade_abort_trigger_for_test();
        assert_eq!(count(), 0, "an upgrade abort must never reach Π");

        // A genuine migration failure engages the fail-static latch: one event.
        crate::configs::note_migration_stall_halt_for_test();
        assert_eq!(count(), 1);

        // A second source setting while the halt is already engaged is the same
        // latch re-described, not a new one.
        crate::configs::note_migration_stall_halt_for_test();
        crate::configs::note_upgrade_abort_trigger_for_test();
        assert_eq!(
            count(),
            1,
            "the activation edge is the event, not each write"
        );
    });
}

/// The `H` sampler runs in `pallet-welfare`'s `on_finalize`, so it can only see
/// weight registered by pallets ordered at or before index 54. That is sound
/// **because** no pallet after it consumes any — 55–64 are all custom pallets
/// with no `on_finalize` at all — and this pins that ordering property rather
/// than leaving it as a comment that a later `construct_runtime!` edit could
/// silently falsify.
#[test]
fn a14_no_pallet_ordered_after_welfare_consumes_finalization_weight() {
    use frame_support::traits::OnFinalize;

    crate::tests::development_ext().execute_with(|| {
        let now = frame_system::Pallet::<Runtime>::block_number();
        frame_system::Pallet::<Runtime>::register_extra_weight_unchecked(
            crate::configs::RuntimeBlockWeights::get().max_block / 4,
            frame_support::dispatch::DispatchClass::Mandatory,
        );
        // Sample exactly as the hook would.
        pallet_welfare::Pallet::<Runtime>::sample_block_weight();
        let sampled = frame_system::Pallet::<Runtime>::block_weight().total();

        // Every pallet at a `construct_runtime!` index above Welfare's 54.
        <pallet_oracle::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);
        <pallet_registry::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);
        <pallet_registry::Pallet<Runtime, pallet_registry::Instance1> as OnFinalize<_>>::on_finalize(now);
        <pallet_futarchy_treasury::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);
        <pallet_guardian::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);
        <pallet_attestor::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);
        <pallet_epoch::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);
        <pallet_execution_guard::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);
        <pallet_inflow_caps::Pallet<Runtime> as OnFinalize<_>>::on_finalize(now);

        assert_eq!(
            frame_system::Pallet::<Runtime>::block_weight().total(),
            sampled,
            "a pallet ordered after Welfare now consumes finalization weight the H sampler cannot see",
        );

        // And what was sampled really is this block's whole utilization.
        let (epoch, day) = <Runtime as pallet_welfare::Config>::CurrentWindow::get();
        let expected = pallet_welfare::block_utilization(
            sampled,
            crate::configs::RuntimeBlockWeights::get().max_block,
        )
        .expect("the runtime block limit is measurable");
        assert_eq!(
            pallet_welfare::Pallet::<Runtime>::block_weight_sample(epoch, day).utilization_sum,
            expected,
        );
    });
}
