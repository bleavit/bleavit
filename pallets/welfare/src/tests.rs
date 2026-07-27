use crate::mock::*;
use crate::*;
use frame_support::{assert_noop, assert_ok, traits::Get, BoundedVec};
use futarchy_primitives::{keeper::CrankClass, kernel, FixedU64};

fn bounded(specs: Vec<MetricSpec>) -> BoundedSpecSet {
    BoundedVec::try_from(specs).expect("test spec set is bounded")
}

fn components(s: u64, c: u64, p: u64, a: u64) -> Vec<ComponentValue> {
    vec![
        ComponentValue {
            id: 1,
            value: FixedU64(s),
        },
        ComponentValue {
            id: 2,
            value: FixedU64(c),
        },
        ComponentValue {
            id: 3,
            value: FixedU64(p),
        },
        ComponentValue {
            id: 4,
            value: FixedU64(a),
        },
    ]
}

#[test]
fn genesis_seeds_the_frontend_named_metric_specs() {
    new_test_ext().execute_with(|| {
        assert_eq!(MetricSpecs::<Test>::iter().count(), 1);
        assert_eq!(Snapshots::<Test>::iter().count(), 0);
        assert_eq!(GateBreachFlags::<Test>::iter().count(), 0);
        assert_eq!(SampledGateDays::<Test>::iter().count(), 0);
        assert_eq!(Welfare::welfare_state().specs, vec![(1, genesis_specs(1))]);
        assert_ok!(Welfare::seed(&Welfare::welfare_state()));
    });
}

#[test]
fn register_spec_happy_path_deposits_core_event() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(default_specs(2)),
        ));
        System::assert_last_event(RuntimeEvent::Welfare(Event::MetricSpecRegistered {
            version: 2,
        }));
        assert_eq!(MetricSpecs::<Test>::iter().count(), 2);
    });
}

#[test]
fn register_spec_rejects_closed_origin_misuse_set() {
    new_test_ext().execute_with(|| {
        for origin in [
            RuntimeOrigin::root(),
            RuntimeOrigin::signed(nobody()),
            RuntimeOrigin::none(),
        ] {
            assert_noop!(
                Welfare::register_spec(origin, 2, bounded(default_specs(2))),
                sp_runtime::DispatchError::BadOrigin
            );
        }
    });
}

#[test]
fn keeper_calls_reject_unsigned_and_root_origins() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::none(), 7, 1),
            sp_runtime::DispatchError::BadOrigin
        );
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::root(), 7, 1),
            sp_runtime::DispatchError::BadOrigin
        );
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::none(), 7, 0, 1),
            sp_runtime::DispatchError::BadOrigin
        );
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::root(), 7, 0, 1),
            sp_runtime::DispatchError::BadOrigin
        );
    });
}

#[test]
fn snapshot_happy_path_persists_and_emits() {
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        let snapshot = Snapshots::<Test>::get((7, 1)).expect("snapshot was stored by key");
        assert_eq!(snapshot.welfare, FixedU64(ONE));
        System::assert_last_event(RuntimeEvent::Welfare(Event::SnapshotRecorded {
            epoch: 7,
            spec_version: 1,
            welfare: FixedU64(ONE),
        }));
    });
}

#[test]
fn snapshot_deadline_is_strict_and_a_due_snapshot_advances_it() {
    new_test_ext().execute_with(|| {
        let due_epoch = 7;
        let due_at = TestSnapshotSchedule::snapshot_due(due_epoch);
        assert!(due_at.is_some(), "mock epoch schedule must be finite");
        let due_at = due_at.unwrap_or_default();
        SnapshotDeadline::<Test>::put(SnapshotProgress {
            last_snapshot_epoch: Some(due_epoch - 1),
            due_epoch,
        });
        let boundary =
            due_at.checked_add(futarchy_primitives::kernel::DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS);
        assert!(boundary.is_some(), "test deadline must fit");
        let boundary = boundary.unwrap_or_default();

        assert!(!Welfare::snapshot_overdue(boundary.saturating_sub(1)));
        assert!(!Welfare::snapshot_overdue(boundary));
        assert!(Welfare::snapshot_overdue(boundary.saturating_add(1)));

        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            due_epoch,
            1,
        ));
        let progress = SnapshotDeadline::<Test>::get();
        assert!(progress.is_some(), "deadline remains armed");
        let progress = progress.unwrap_or(SnapshotProgress {
            last_snapshot_epoch: None,
            due_epoch: 0,
        });
        assert_eq!(progress.last_snapshot_epoch, Some(due_epoch));
        assert_eq!(progress.due_epoch, due_epoch.saturating_add(1));
        let next_due = TestSnapshotSchedule::snapshot_due(due_epoch.saturating_add(1));
        assert!(
            next_due.is_some(),
            "next mock epoch schedule must be finite"
        );
        let next_due = next_due.unwrap_or_default();
        assert_eq!(
            TestSnapshotSchedule::snapshot_due(progress.due_epoch),
            Some(next_due)
        );
        assert!(!Welfare::snapshot_overdue(boundary.saturating_add(1)));
        assert!(Welfare::do_try_state().is_ok());
    });
}

#[test]
fn first_snapshot_does_not_become_overdue_before_its_activation_epoch_close() {
    new_test_ext().execute_with(|| {
        SnapshotDeadline::<Test>::kill();
        let first_due = TestSnapshotSchedule::snapshot_due(1);
        assert!(
            first_due.is_some(),
            "genesis MetricSpec activation must have a due block"
        );
        let first_due = first_due.unwrap_or_default();
        assert!(!Welfare::snapshot_overdue(first_due));
        assert_eq!(
            SnapshotDeadline::<Test>::get(),
            Some(SnapshotProgress {
                last_snapshot_epoch: None,
                due_epoch: 1,
            })
        );
    });
}

#[test]
fn daily_gate_happy_path_persists_and_emits() {
    new_test_ext().execute_with(|| {
        DailyInput::set(components(800_000_000, ONE, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            3,
            1,
        ));
        let flags = GateBreachFlags::<Test>::get(7).expect("gate flags were stored by epoch");
        assert!(flags.s_breached);
        assert_eq!(flags.day_bitmap, [1 << 3, 0]);
        assert_eq!(SampledGateDays::<Test>::get(7), Some([1 << 3, 0]));
        System::assert_last_event(RuntimeEvent::Welfare(Event::GateBreachRecorded {
            epoch: 7,
            day: 3,
            s_breached: true,
            c_breached: false,
        }));
    });
}

#[test]
fn healthy_daily_gate_marks_sampling_without_marking_a_breach() {
    new_test_ext().execute_with(|| {
        DailyInput::set(components(ONE, ONE, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            4,
            1,
        ));

        let flags = GateBreachFlags::<Test>::get(7).expect("epoch gate record exists");
        assert!(!flags.s_breached);
        assert!(!flags.c_breached);
        assert_eq!(flags.day_bitmap, [0, 0]);
        assert_eq!(SampledGateDays::<Test>::get(7), Some([1 << 4, 0]));
    });
}

#[test]
fn keeper_rebates_only_after_useful_snapshot_and_daily_gate_work() {
    new_test_ext().execute_with(|| {
        RecordKeeperRebates::set(true);

        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), FINALIZED_NOW, 1),
            Error::<Test>::EpochNotFinalized
        );
        assert!(KeeperRebates::get().is_empty());

        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        assert_eq!(
            KeeperRebates::get(),
            vec![(keeper(), CrankClass::DecisionCritical)]
        );

        // The duplicate/error retry cannot become a rebate drain vector.
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 7, 1),
            Error::<Test>::DuplicateSnapshot
        );
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 7, 0, 99),
            Error::<Test>::SpecNotFound
        );
        assert_eq!(
            KeeperRebates::get(),
            vec![(keeper(), CrankClass::DecisionCritical)]
        );

        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            0,
            1,
        ));
        assert_eq!(
            GateBreachFlags::<Test>::get(7)
                .expect("healthy epoch gate record exists")
                .day_bitmap,
            [0, 0]
        );
        assert_eq!(SampledGateDays::<Test>::get(7), Some([1, 0]));
        assert_eq!(
            KeeperRebates::get(),
            vec![
                (keeper(), CrankClass::DecisionCritical),
                (keeper(), CrankClass::General),
            ]
        );
        // An identical successful re-record is repeat-tolerant but state-neutral,
        // so it cannot drain the keeper meter.
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            0,
            1,
        ));
        assert_eq!(
            KeeperRebates::get(),
            vec![
                (keeper(), CrankClass::DecisionCritical),
                (keeper(), CrankClass::General),
            ]
        );
        // Re-recording the same day with a newly breached gate advances the
        // epoch-wide latch and therefore earns one further rebate.
        DailyInput::set(components(800_000_000, ONE, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            0,
            1,
        ));
        assert_eq!(
            KeeperRebates::get(),
            vec![
                (keeper(), CrankClass::DecisionCritical),
                (keeper(), CrankClass::General),
                (keeper(), CrankClass::General),
            ]
        );
        assert_eq!(
            GateBreachFlags::<Test>::get(7)
                .expect("augmented epoch gate record exists")
                .day_bitmap,
            [1, 0]
        );
        assert_eq!(SampledGateDays::<Test>::get(7), Some([1, 0]));
    });
}

#[test]
fn duplicate_spec_version_is_rejected_without_storage_change() {
    new_test_ext().execute_with(|| {
        let before = MetricSpecs::<Test>::iter().collect::<Vec<_>>();
        assert_noop!(
            Welfare::register_spec(
                RuntimeOrigin::signed(governance_acc()),
                1,
                bounded(default_specs(1)),
            ),
            Error::<Test>::DuplicateSpecVersion
        );
        assert_eq!(MetricSpecs::<Test>::iter().collect::<Vec<_>>(), before);
    });
}

#[test]
fn snapshot_deadline_uses_latest_unique_activation_not_largest_version() {
    new_test_ext().execute_with(|| {
        for (version, _) in MetricSpecs::<Test>::iter() {
            MetricSpecs::<Test>::remove(version);
        }
        MetricSpecs::<Test>::insert(9, bounded(specs_activating(9, 5)));
        MetricSpecs::<Test>::insert(2, bounded(specs_activating(2, 7)));
        SnapshotDeadline::<Test>::put(SnapshotProgress {
            last_snapshot_epoch: None,
            due_epoch: 7,
        });

        assert_eq!(Welfare::active_snapshot_spec(7), Some(2));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            2,
        ));
        assert_eq!(
            SnapshotDeadline::<Test>::get().map(|progress| progress.due_epoch),
            Some(8)
        );
    });
}

#[test]
fn tied_latest_activations_cannot_suppress_the_snapshot_detector() {
    new_test_ext().execute_with(|| {
        for (version, _) in MetricSpecs::<Test>::iter() {
            MetricSpecs::<Test>::remove(version);
        }
        MetricSpecs::<Test>::insert(9, bounded(specs_activating(9, 7)));
        MetricSpecs::<Test>::insert(2, bounded(specs_activating(2, 7)));
        SnapshotDeadline::<Test>::put(SnapshotProgress {
            last_snapshot_epoch: None,
            due_epoch: 7,
        });

        assert_eq!(Welfare::active_snapshot_spec(7), None);
        // A tie leaves no active spec, so the only admissible versions are the
        // ones live cohorts froze. Seeding one keeps this test about the
        // detector rather than about admission.
        FrozenSpecVersions::set(vec![9]);
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            9,
        ));
        assert_eq!(
            SnapshotDeadline::<Test>::get().map(|progress| progress.due_epoch),
            Some(7)
        );
    });
}

#[test]
fn snapshot_deadline_overflow_is_not_spuriously_overdue() {
    new_test_ext().execute_with(|| {
        let due_epoch = u32::MAX / 100 - 1;
        SnapshotDeadline::<Test>::put(SnapshotProgress {
            last_snapshot_epoch: None,
            due_epoch,
        });
        assert!(!Welfare::snapshot_overdue(u32::MAX));
    });
}

#[test]
fn try_state_rejects_snapshot_progress_without_its_prior_snapshot() {
    new_test_ext().execute_with(|| {
        SnapshotDeadline::<Test>::put(SnapshotProgress {
            last_snapshot_epoch: Some(7),
            due_epoch: 8,
        });
        assert!(Welfare::do_try_state().is_err());
    });
}

#[test]
fn bad_activation_epoch_is_rejected() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(5);
        let mut specs = default_specs(2);
        specs[0].activation_epoch = 6;
        assert_noop!(
            Welfare::register_spec(RuntimeOrigin::signed(governance_acc()), 2, bounded(specs),),
            Error::<Test>::BadActivationEpoch
        );
    });
}

#[test]
fn missing_metric_discipline_is_rejected() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        let mut specs = default_specs(2);
        specs[0].has_challenge_procedure = false;
        assert_noop!(
            Welfare::register_spec(RuntimeOrigin::signed(governance_acc()), 2, bounded(specs),),
            Error::<Test>::MissingMetricDiscipline
        );
    });
}

#[test]
fn bad_weight_sum_is_rejected() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        let mut specs = default_specs(2);
        specs[1].weight = FixedU64(ONE - 1);
        assert_noop!(
            Welfare::register_spec(RuntimeOrigin::signed(governance_acc()), 2, bounded(specs),),
            Error::<Test>::BadWeightSum
        );
    });
}

#[test]
fn bad_epsilon_floor_and_source_class_are_rejected() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        let mut specs = default_specs(2);
        specs[0].epsilon_floor = FixedU64(EPSILON_PILLAR.0 - 1);
        assert_noop!(
            Welfare::register_spec(RuntimeOrigin::signed(governance_acc()), 2, bounded(specs),),
            Error::<Test>::BadEpsilonFloor
        );

        let mut specs = default_specs(2);
        specs[3].source = SourceClass::Onchain;
        assert_noop!(
            Welfare::register_spec(RuntimeOrigin::signed(governance_acc()), 2, bounded(specs),),
            Error::<Test>::BadSourceClass
        );
    });
}

#[test]
fn genesis_spec_is_active_from_epoch_one() {
    // 05 §4.6 cold start: the genesis MetricSpec activates at epoch 1, so W₁ is
    // computable. The ext-builder clock is finalized-high, so epoch 1 is past.
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            1,
            1,
        ));
        assert!(Snapshots::<Test>::contains_key((1, 1)));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            1,
            0,
            1,
        ));
        assert!(GateBreachFlags::<Test>::contains_key(1));
    });
}

#[test]
fn post_genesis_spec_before_activation_is_rejected() {
    new_test_ext().execute_with(|| {
        // Register v2 post-genesis (clock 5) activating at epoch 10 (>= 5 + 2).
        CurrentEpochValue::set(5);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(specs_activating(2, 10)),
        ));
        // Epoch 9 is finalized (clock 20) but still before v2's activation (10).
        CurrentEpochValue::set(20);
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 9, 2),
            Error::<Test>::SpecNotActive
        );
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 9, 0, 2),
            Error::<Test>::SpecNotActive
        );
        assert!(!Snapshots::<Test>::contains_key((9, 2)));
        assert!(!GateBreachFlags::<Test>::contains_key(9));
    });
}

#[test]
fn snapshot_for_an_unfinalized_or_future_epoch_is_rejected() {
    // 05 §4.6: only a finalized (strictly past) epoch may be snapshotted. The
    // current epoch (still in progress) and any future epoch are rejected, so an
    // early keeper cannot lock a wrong W or consume the bounded window early.
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(7);
        for epoch in [7u32, 8, 100] {
            assert_noop!(
                Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), epoch, 1),
                Error::<Test>::EpochNotFinalized
            );
        }
        assert_eq!(Snapshots::<Test>::iter().count(), 0);
        // Once the clock passes epoch 7, its snapshot becomes admissible.
        CurrentEpochValue::set(8);
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
    });
}

#[test]
fn daily_gate_for_an_unfinalized_or_future_epoch_is_rejected() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(7);
        for epoch in [7u32, 8, 100] {
            assert_noop!(
                Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), epoch, 0, 1),
                Error::<Test>::EpochNotFinalized
            );
        }
        assert_eq!(GateBreachFlags::<Test>::iter().count(), 0);
        CurrentEpochValue::set(8);
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            0,
            1,
        ));
    });
}

#[test]
fn metric_inputs_are_scoped_by_spec_version() {
    new_test_ext().execute_with(|| {
        // Register v2 with the two-epoch lead honored (clock 0 → activation 2),
        // then advance the clock so epoch 7 is finalized before the cranks.
        CurrentEpochValue::set(0);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(default_specs(2)),
        ));
        CurrentEpochValue::set(FINALIZED_NOW);
        // Epoch 7's active spec is v2; v1 is admissible only because a live
        // cohort froze it (I-16), which is the whole two-version regime.
        FrozenSpecVersions::set(vec![1]);
        OnchainInputsByVersion::set(vec![
            (1, components(ONE, ONE, ONE, ONE)),
            (2, components(ONE, 900_000_000, ONE, ONE)),
        ]);

        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            2,
        ));
        let v1 = Snapshots::<Test>::get((7, 1)).expect("version 1 snapshot exists");
        let v2 = Snapshots::<Test>::get((7, 2)).expect("version 2 snapshot exists");
        assert_ne!(v1.c_onchain, v2.c_onchain);
    });
}

#[test]
fn duplicate_snapshot_is_rejected() {
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 7, 1),
            Error::<Test>::DuplicateSnapshot
        );
        assert_eq!(Snapshots::<Test>::iter().count(), 1);
    });
}

#[test]
fn missing_spec_is_rejected() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 7, 99),
            Error::<Test>::SpecNotFound
        );
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 7, 0, 99),
            Error::<Test>::SpecNotFound
        );
    });
}

#[test]
fn metric_spec_history_accepts_16_and_rejects_17th() {
    // limit-coverage: MetricSpecs
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        // Distinct activation epochs per version: registrations may no longer
        // tie on their maximum activation epoch (AUD-4), and `default_specs`
        // hardcodes epoch 2 for every version. The bound under test is
        // unchanged — only the fixture's activation spread is.
        for version in 2..=16 {
            assert_ok!(Welfare::register_spec(
                RuntimeOrigin::signed(governance_acc()),
                version,
                bounded(specs_activating(version, u32::from(version))),
            ));
        }
        assert_eq!(MetricSpecs::<Test>::iter().count(), MAX_METRIC_SPECS);
        assert_noop!(
            Welfare::register_spec(
                RuntimeOrigin::signed(governance_acc()),
                17,
                bounded(specs_activating(17, 17)),
            ),
            Error::<Test>::TooManyMetricSpecs
        );
    });
}

#[test]
fn snapshot_history_fills_the_record_bound_and_rejects_the_next() {
    // limit-coverage: Snapshots
    // The bound is `SNAPSHOT_RETENTION_EPOCHS × MAX_CONCURRENT_FROZEN_VERSIONS`
    // records, not 20 epochs — see `welfare_core::MAX_SNAPSHOTS`.
    new_test_ext().execute_with(|| {
        for epoch in 2..MAX_SNAPSHOTS as u32 + 2 {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
        }
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), MAX_SNAPSHOTS as u32 + 2, 1,),
            Error::<Test>::TooManySnapshots
        );
    });
}

#[test]
fn gate_history_accepts_20_epochs_and_rejects_21st() {
    new_test_ext().execute_with(|| {
        for epoch in 2..MAX_GATE_FLAGS as u32 + 2 {
            assert_ok!(Welfare::record_daily_gate(
                RuntimeOrigin::signed(keeper()),
                epoch,
                0,
                1,
            ));
        }
        assert_noop!(
            Welfare::record_daily_gate(
                RuntimeOrigin::signed(keeper()),
                MAX_GATE_FLAGS as u32 + 2,
                0,
                1,
            ),
            Error::<Test>::TooManyGateFlags
        );
    });
}

#[test]
fn prune_rolls_the_snapshot_and_gate_windows() {
    new_test_ext().execute_with(|| {
        // One version per epoch, so both windows are driven by the epoch bound.
        for epoch in 2..SNAPSHOT_RETENTION_EPOCHS as u32 + 2 {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
            assert_ok!(Welfare::record_daily_gate(
                RuntimeOrigin::signed(keeper()),
                epoch,
                0,
                1,
            ));
        }
        assert_eq!(Snapshots::<Test>::iter().count(), SNAPSHOT_RETENTION_EPOCHS);
        assert_eq!(GateBreachFlags::<Test>::iter().count(), MAX_GATE_FLAGS);
        assert_eq!(SampledGateDays::<Test>::iter().count(), MAX_GATE_FLAGS);
        Welfare::note_xcm_traffic(2, 0, XcmTrafficKind::Accepted);
        Welfare::note_xcm_traffic(2, u8::MAX, XcmTrafficKind::ProbeTimeout);
        Welfare::note_xcm_traffic(3, 0, XcmTrafficKind::SendFailed);
        // No snapshot/gate owns epoch 1: its traffic-only prefix must still reap.
        Welfare::note_xcm_traffic(1, 7, XcmTrafficKind::Accepted);

        assert_ok!(Welfare::prune(3));
        assert!(!Snapshots::<Test>::contains_key((2, 1)));
        assert!(!GateBreachFlags::<Test>::contains_key(2));
        assert!(!SampledGateDays::<Test>::contains_key(2));
        assert_eq!(XcmTraffic::<Test>::iter_prefix(2).count(), 0);
        assert_eq!(XcmTraffic::<Test>::iter_prefix(1).count(), 0);
        assert!(XcmTraffic::<Test>::contains_key(3, 0));
        assert_eq!(XcmTrafficEpochs::<Test>::get().into_inner(), vec![3]);
        assert_eq!(MetricSpecs::<Test>::iter().count(), 1);

        let next = SNAPSHOT_RETENTION_EPOCHS as u32 + 2;
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            next,
            1,
        ));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            next,
            0,
            1,
        ));
        assert!(Snapshots::<Test>::contains_key((next, 1)));
        assert!(GateBreachFlags::<Test>::contains_key(next));
        assert!(SampledGateDays::<Test>::contains_key(next));
        assert_eq!(Snapshots::<Test>::iter().count(), SNAPSHOT_RETENTION_EPOCHS);
        assert_eq!(GateBreachFlags::<Test>::iter().count(), MAX_GATE_FLAGS);
        assert_eq!(SampledGateDays::<Test>::iter().count(), MAX_GATE_FLAGS);
    });
}

#[test]
fn xcm_traffic_prune_is_bounded_and_oldest_first() {
    new_test_ext().execute_with(|| {
        for epoch in [7, 3, 5, 9, 1, 8] {
            Welfare::note_xcm_traffic(epoch, 0, XcmTrafficKind::Accepted);
            Welfare::note_xcm_traffic(epoch, u8::MAX, XcmTrafficKind::ProbeTimeout);
        }

        assert_ok!(Welfare::prune_xcm_traffic(8));

        assert_eq!(XcmTraffic::<Test>::iter_prefix(1).count(), 0);
        assert_eq!(XcmTraffic::<Test>::iter_prefix(3).count(), 0);
        for epoch in [5, 7, 8, 9] {
            assert_eq!(XcmTraffic::<Test>::iter_prefix(epoch).count(), 2);
        }
        assert_eq!(
            XcmTrafficEpochs::<Test>::get().into_inner(),
            vec![7, 5, 9, 8]
        );
    });
}

#[test]
fn xcm_traffic_recorder_saturates_each_counter() {
    new_test_ext().execute_with(|| {
        XcmTraffic::<Test>::insert(
            7,
            3,
            XcmTrafficCounters {
                accepted: u64::MAX,
                failed: u64::MAX,
                probe_timeouts: u64::MAX,
            },
        );

        Welfare::note_xcm_traffic(7, 3, XcmTrafficKind::Accepted);
        Welfare::note_xcm_traffic(7, 3, XcmTrafficKind::SendFailed);
        Welfare::note_xcm_traffic(7, 3, XcmTrafficKind::ProbeTimeout);

        assert_eq!(
            Welfare::xcm_traffic(7, 3),
            XcmTrafficCounters {
                accepted: u64::MAX,
                failed: u64::MAX,
                probe_timeouts: u64::MAX,
            }
        );
    });
}

#[test]
fn xcm_traffic_is_isolated_by_epoch_and_day() {
    new_test_ext().execute_with(|| {
        Welfare::note_xcm_traffic(7, 1, XcmTrafficKind::Accepted);
        Welfare::note_xcm_traffic(7, 2, XcmTrafficKind::SendFailed);
        Welfare::note_xcm_traffic(8, 1, XcmTrafficKind::ProbeTimeout);

        assert_eq!(
            Welfare::xcm_traffic(7, 1),
            XcmTrafficCounters {
                accepted: 1,
                failed: 0,
                probe_timeouts: 0,
            }
        );
        assert_eq!(
            Welfare::xcm_traffic(7, 2),
            XcmTrafficCounters {
                accepted: 0,
                failed: 1,
                probe_timeouts: 0,
            }
        );
        assert_eq!(
            Welfare::xcm_traffic(8, 1),
            XcmTrafficCounters {
                accepted: 0,
                failed: 0,
                probe_timeouts: 1,
            }
        );
        assert_eq!(Welfare::xcm_traffic(8, 2), XcmTrafficCounters::default());
    });
}

#[test]
fn xcm_traffic_epoch_sum_is_field_wise_and_saturating() {
    new_test_ext().execute_with(|| {
        XcmTraffic::<Test>::insert(
            7,
            0,
            XcmTrafficCounters {
                accepted: u64::MAX,
                failed: 1,
                probe_timeouts: 0,
            },
        );
        XcmTraffic::<Test>::insert(
            7,
            u8::MAX,
            XcmTrafficCounters {
                accepted: 1,
                failed: u64::MAX,
                probe_timeouts: u64::MAX,
            },
        );
        XcmTraffic::<Test>::insert(
            8,
            0,
            XcmTrafficCounters {
                accepted: 0,
                failed: 0,
                probe_timeouts: 1,
            },
        );

        assert_eq!(
            Welfare::xcm_traffic_epoch(7),
            XcmTrafficCounters {
                accepted: u64::MAX,
                failed: u64::MAX,
                probe_timeouts: u64::MAX,
            }
        );
    });
}

#[test]
fn xcm_traffic_recorder_is_infallible_across_epoch_and_day_boundaries() {
    new_test_ext().execute_with(|| {
        for epoch in [0, u32::MAX / 2, u32::MAX] {
            for day in u8::MIN..=u8::MAX {
                let kind = match day % 3 {
                    0 => XcmTrafficKind::Accepted,
                    1 => XcmTrafficKind::SendFailed,
                    _ => XcmTrafficKind::ProbeTimeout,
                };
                Welfare::note_xcm_traffic(epoch, day, kind);
            }
            let counters = Welfare::xcm_traffic_epoch(epoch);
            assert_eq!(
                counters.accepted + counters.failed + counters.probe_timeouts,
                256
            );
        }
    });
}

#[test]
fn xcm_traffic_recorder_drops_only_a_new_epoch_when_the_index_is_full() {
    new_test_ext().execute_with(|| {
        for epoch in 0..MAX_XCM_TRAFFIC_EPOCHS_BOUND {
            Welfare::note_xcm_traffic(epoch, 0, XcmTrafficKind::Accepted);
        }
        Welfare::note_xcm_traffic(MAX_XCM_TRAFFIC_EPOCHS_BOUND, 0, XcmTrafficKind::SendFailed);
        Welfare::note_xcm_traffic(0, 0, XcmTrafficKind::ProbeTimeout);

        assert_eq!(
            XcmTrafficEpochs::<Test>::get().len(),
            MAX_XCM_TRAFFIC_EPOCHS_BOUND as usize
        );
        assert!(!XcmTraffic::<Test>::contains_key(
            MAX_XCM_TRAFFIC_EPOCHS_BOUND,
            0
        ));
        assert_eq!(
            Welfare::xcm_traffic(0, 0),
            XcmTrafficCounters {
                accepted: 1,
                failed: 0,
                probe_timeouts: 1,
            }
        );
    });
}

// ------------------------------------------------ 05 §4.3.2 block production
//
// The pallet owns only the accumulator: the per-block observation, its two
// granularities, the shared index and the shared reaper. `U` itself — the
// clamp, the 25 % weight and the zero-denominator rule — is computed in the
// runtime binding beside the other 05 §4.3 projections and is pinned in
// `runtime/bleavit-runtime/src/tests_welfare_inputs.rs`.

/// Record one block: its relay delta and its emptiness classification, the way
/// the two runtime hooks do.
fn note_block(epoch: EpochId, day: u8, slots: u32, empty: bool) {
    Welfare::note_block_production(epoch, day, BlockProductionSignal::RelaySlots(slots));
    Welfare::note_block_production(epoch, day, BlockProductionSignal::Authored { empty });
}

#[test]
fn block_production_accumulates_at_both_granularities() {
    new_test_ext().execute_with(|| {
        // Day 0: two non-empty blocks at nominal cadence, then a three-slot gap
        // before an empty one.
        note_block(7, 0, 1, false);
        note_block(7, 0, 1, false);
        note_block(7, 0, 3, true);
        // Day 1: one non-empty block.
        note_block(7, 1, 1, false);
        // A different epoch must not leak into either projection.
        note_block(8, 0, 9, true);

        assert_eq!(
            Welfare::block_production(7, 0),
            BlockProductionCounters {
                non_empty_blocks: 2,
                empty_blocks: 1,
                relay_slots: 5,
            }
        );
        assert_eq!(
            Welfare::block_production(7, 1),
            BlockProductionCounters {
                non_empty_blocks: 1,
                empty_blocks: 0,
                relay_slots: 1,
            }
        );
        // The epoch total is the field-wise sum of its day slots: the two
        // granularities are sums of the same per-block observation (§4.3.2).
        // It is maintained on write, so this is one read and not a 256-key fold.
        assert_eq!(
            Welfare::block_production_epoch(7),
            BlockProductionCounters {
                non_empty_blocks: 3,
                empty_blocks: 1,
                relay_slots: 6,
            }
        );
        assert_eq!(
            Welfare::block_production_epoch(8),
            BlockProductionCounters {
                non_empty_blocks: 0,
                empty_blocks: 1,
                relay_slots: 9,
            }
        );
        // An unobserved window is all-zero, which the runtime reads as
        // unavailable rather than as a score.
        assert_eq!(
            Welfare::block_production_epoch(9),
            BlockProductionCounters::default()
        );
    });
}

#[test]
fn an_outage_spanning_a_window_boundary_is_charged_to_exactly_one_window() {
    new_test_ext().execute_with(|| {
        // Day 0 closes on a healthy block, then the chain stalls for 100 relay
        // slots and the catch-up block lands on day 1 — the boundary case
        // §4.3.2 rules on, because an endpoint difference would attribute it to
        // neither window.
        note_block(7, 0, 1, false);
        note_block(7, 1, 100, false);
        note_block(7, 1, 1, false);

        // Day 0 keeps only its own slot: the outage is not back-dated into it.
        assert_eq!(Welfare::block_production(7, 0).relay_slots, 1);
        // Day 1 carries the whole catch-up jump, once.
        assert_eq!(Welfare::block_production(7, 1).relay_slots, 101);
        // And the epoch sees every slot exactly once — nothing lost at the
        // boundary, nothing double-counted across it.
        let epoch = Welfare::block_production_epoch(7);
        assert_eq!(epoch.relay_slots, 102);
        assert_eq!(epoch.non_empty_blocks, 3);
    });
}

#[test]
fn a_one_block_window_is_well_defined() {
    new_test_ext().execute_with(|| {
        // The case an endpoint difference divides by zero on.
        note_block(7, 4, 1, false);

        assert_eq!(
            Welfare::block_production(7, 4),
            BlockProductionCounters {
                non_empty_blocks: 1,
                empty_blocks: 0,
                relay_slots: 1,
            }
        );
    });
}

#[test]
fn a_zero_relay_delta_writes_nothing_at_all() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(30);
        // Two parachain blocks sharing a relay parent: the second contributes a
        // delta of zero, which is a genuine no-op. Writing it would index the
        // epoch and store an all-zero triple — a stored zero denominator, which
        // try-state rejects because it cannot be told apart from a window that
        // was never observed.
        Welfare::note_block_production(7, 0, BlockProductionSignal::RelaySlots(0));

        assert!(!BlockProduction::<Test>::contains_key(7, 0));
        assert!(XcmTrafficEpochs::<Test>::get().is_empty());
        assert_ok!(Welfare::do_try_state());

        // It is still a no-op once the window is live, and the authored block it
        // shares its relay parent with is counted normally.
        note_block(7, 0, 1, false);
        Welfare::note_block_production(7, 0, BlockProductionSignal::RelaySlots(0));
        Welfare::note_block_production(7, 0, BlockProductionSignal::Authored { empty: false });
        assert_eq!(
            Welfare::block_production(7, 0),
            BlockProductionCounters {
                non_empty_blocks: 2,
                empty_blocks: 0,
                relay_slots: 1,
            }
        );
        assert_ok!(Welfare::do_try_state());
    });
}

#[test]
fn block_production_counters_saturate() {
    new_test_ext().execute_with(|| {
        let full = BlockProductionCounters {
            non_empty_blocks: u64::MAX,
            empty_blocks: u64::MAX,
            relay_slots: u64::MAX,
        };
        BlockProduction::<Test>::insert(7, 3, full);
        BlockProductionEpoch::<Test>::insert(7, full);

        note_block(7, 3, u32::MAX, false);
        Welfare::note_block_production(7, 3, BlockProductionSignal::Authored { empty: true });

        // Both granularities saturate at the same ceiling, so the try-state
        // equality between them survives the saturating regime.
        assert_eq!(Welfare::block_production(7, 3), full);
        assert_eq!(Welfare::block_production_epoch(7), full);
    });
}

/// The epoch total is storage, not arithmetic, so its agreement with the day
/// slots it summarizes is a try-state invariant — bound in **both** directions.
#[test]
fn try_state_binds_the_epoch_total_to_its_day_slots() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(30);
        note_block(29, 0, 1, false);
        note_block(29, 1, 2, true);
        assert_ok!(Welfare::do_try_state());

        // A total that drifted high would inflate `U` against a window nobody
        // can audit from the day slots.
        BlockProductionEpoch::<Test>::mutate(29, |total| total.relay_slots += 1);
        assert!(Welfare::do_try_state().is_err());
        BlockProductionEpoch::<Test>::mutate(29, |total| total.relay_slots -= 1);
        assert_ok!(Welfare::do_try_state());

        // A missing total reads as a never-observed window and drops `U` for an
        // epoch that did produce blocks — silently, which is the whole reason
        // this is checked rather than assumed.
        BlockProductionEpoch::<Test>::remove(29);
        assert!(Welfare::do_try_state().is_err());

        // A total whose day slots are gone is the reaper's other half left
        // behind: a `U` denominator for a window with no record.
        let _ = BlockProduction::<Test>::clear_prefix(29, u32::MAX, None);
        BlockProductionEpoch::<Test>::insert(
            29,
            BlockProductionCounters {
                non_empty_blocks: 1,
                empty_blocks: 1,
                relay_slots: 3,
            },
        );
        assert!(Welfare::do_try_state().is_err());
    });
}

#[test]
fn block_production_recorder_is_infallible_across_epoch_and_day_boundaries() {
    new_test_ext().execute_with(|| {
        for epoch in [0, u32::MAX / 2, u32::MAX] {
            for day in u8::MIN..=u8::MAX {
                note_block(epoch, day, 1, day % 2 == 0);
            }
            let counters = Welfare::block_production_epoch(epoch);
            assert_eq!(counters.non_empty_blocks + counters.empty_blocks, 256);
            assert_eq!(counters.relay_slots, 256);
        }
    });
}

/// The 13 §4 bound on the shared prefix index, from the block-production side.
/// Classed `value` in `tools/limit-coverage/registry.toml` and therefore not
/// marker-bound: the writer is a per-block hook, not a dispatch, so the overflow
/// has no error surface to bind a `// limit-coverage:` marker to.
#[test]
fn a_full_index_drops_the_whole_window() {
    new_test_ext().execute_with(|| {
        for epoch in 0..MAX_XCM_TRAFFIC_EPOCHS_BOUND {
            Welfare::note_xcm_traffic(epoch, 0, XcmTrafficKind::Accepted);
        }
        // The index is at its 13 §4 bound, so the new epoch cannot be admitted.
        note_block(MAX_XCM_TRAFFIC_EPOCHS_BOUND, 0, 50, false);

        assert_eq!(
            XcmTrafficEpochs::<Test>::get().len(),
            MAX_XCM_TRAFFIC_EPOCHS_BOUND as usize
        );
        // Numerator and denominator are refused *together*, so the window keeps
        // a zero denominator and the runtime resolves `U` absent — backpressure
        // can never make an unmeasured window look healthy (G-1).
        assert_eq!(
            Welfare::block_production_epoch(MAX_XCM_TRAFFIC_EPOCHS_BOUND),
            BlockProductionCounters::default()
        );
        // An already-indexed epoch keeps recording normally.
        note_block(0, 0, 1, false);
        assert_eq!(
            Welfare::block_production(0, 0),
            BlockProductionCounters {
                non_empty_blocks: 1,
                empty_blocks: 0,
                relay_slots: 1,
            }
        );
    });
}

#[test]
fn the_shared_reaper_clears_block_production_in_the_same_walk() {
    new_test_ext().execute_with(|| {
        for epoch in [1, 2, 3] {
            note_block(epoch, 0, 1, false);
            note_block(epoch, u8::MAX, 1, true);
        }
        // Epoch 4 carries block production only — no XCM, no probe — which is
        // the ordinary case for a quiet epoch and must still be indexed.
        note_block(4, 0, 1, false);
        Welfare::note_xcm_traffic(2, 5, XcmTrafficKind::Accepted);
        Welfare::note_reserve_probe(3, 5, true);

        assert_ok!(Welfare::prune_xcm_traffic(3));

        // Epochs 1 and 2 retire in one bounded walk, and every co-indexed series
        // retires with them rather than accruing behind the one that moved.
        for epoch in [1, 2] {
            assert_eq!(BlockProduction::<Test>::iter_prefix(epoch).count(), 0);
            // The epoch total retires with the prefix it summarizes; left
            // behind it would be a `U` denominator for a vanished window.
            assert!(!BlockProductionEpoch::<Test>::contains_key(epoch));
            assert_eq!(XcmTraffic::<Test>::iter_prefix(epoch).count(), 0);
            assert_eq!(ReserveProbeDaily::<Test>::iter_prefix(epoch).count(), 0);
        }
        assert_eq!(BlockProduction::<Test>::iter_prefix(3).count(), 2);
        assert_eq!(BlockProduction::<Test>::iter_prefix(4).count(), 1);
        assert!(BlockProductionEpoch::<Test>::contains_key(3));
        assert!(BlockProductionEpoch::<Test>::contains_key(4));
        assert_eq!(XcmTrafficEpochs::<Test>::get().into_inner(), vec![3, 4]);
    });
}

#[test]
fn try_state_binds_block_production_to_the_shared_index() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(30);
        // A block-production-only prefix is correct state: a block is produced
        // in every epoch, including one that sent no XCM and ran no probe.
        note_block(29, 0, 1, false);
        assert_ok!(Welfare::do_try_state());

        // An unindexed record is unreachable by the bounded reaper (I-20).
        XcmTrafficEpochs::<Test>::kill();
        assert!(Welfare::do_try_state().is_err());

        // A record attributed to an epoch the clock has not reached. The day
        // slot and the epoch total move together, so the *only* violation left
        // is the future attribution this case is about.
        let one_block = BlockProductionCounters {
            non_empty_blocks: 1,
            empty_blocks: 0,
            relay_slots: 1,
        };
        BlockProduction::<Test>::remove(29, 0);
        BlockProductionEpoch::<Test>::remove(29);
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![31]));
        BlockProduction::<Test>::insert(31, 0, one_block);
        BlockProductionEpoch::<Test>::insert(31, one_block);
        assert!(Welfare::do_try_state().is_err());

        // An all-zero triple: the writer never stores one, and `U` divides by
        // `relay_slots`, so a stored zero-denominator row is indistinguishable
        // from a window that was never observed.
        BlockProduction::<Test>::remove(31, 0);
        BlockProductionEpoch::<Test>::remove(31);
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![29]));
        BlockProduction::<Test>::insert(29, 0, BlockProductionCounters::default());
        BlockProductionEpoch::<Test>::insert(29, BlockProductionCounters::default());
        assert!(Welfare::do_try_state().is_err());

        BlockProduction::<Test>::remove(29, 0);
        BlockProductionEpoch::<Test>::remove(29);
        note_block(29, 0, 1, true);
        assert_ok!(Welfare::do_try_state());
    });
}

#[test]
fn try_state_accepts_a_bounded_backlog_and_rejects_structural_corruption() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(30);
        // Bounded pruning may legitimately leave an old indexed prefix queued
        // for a later tick; age alone is no longer a try-state violation.
        XcmTraffic::<Test>::insert(
            9,
            0,
            XcmTrafficCounters {
                accepted: 1,
                ..Default::default()
            },
        );
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![9]));
        assert_ok!(Welfare::do_try_state());

        XcmTraffic::<Test>::remove(9, 0);
        XcmTrafficEpochs::<Test>::kill();
        XcmTraffic::<Test>::insert(
            31,
            0,
            XcmTrafficCounters {
                probe_timeouts: 1,
                ..Default::default()
            },
        );
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![31]));
        assert!(Welfare::do_try_state().is_err());

        XcmTraffic::<Test>::remove(31, 0);
        XcmTrafficEpochs::<Test>::kill();
        XcmTraffic::<Test>::insert(10, 0, XcmTrafficCounters::default());
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![10]));
        assert!(Welfare::do_try_state().is_err());

        XcmTraffic::<Test>::remove(10, 0);
        XcmTrafficEpochs::<Test>::kill();
        Welfare::note_xcm_traffic(30, u8::MAX, XcmTrafficKind::SendFailed);
        assert_ok!(Welfare::do_try_state());

        XcmTrafficEpochs::<Test>::kill();
        assert!(Welfare::do_try_state().is_err());

        XcmTraffic::<Test>::remove(30, u8::MAX);
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![30]));
        assert!(Welfare::do_try_state().is_err());

        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![30, 30]));
        Welfare::note_xcm_traffic(30, 0, XcmTrafficKind::Accepted);
        assert!(Welfare::do_try_state().is_err());
    });
}

// ---------------------------------------------------------------- A14
//
// The 05 §4.3 collator-authorship series. It is written by the block-authorship
// event handler, shares the `XcmTrafficEpochs` prefix index and the one bounded
// reaper with the other two daily series, and feeds `K` today plus `U` and
// `D_eff` later. Every property below is about the *series*, not about `K`: the
// component projection is runtime composition and is pinned in
// `runtime/bleavit-runtime/src/tests_welfare_inputs.rs`.

fn author(n: u8) -> sp_core::crypto::AccountId32 {
    sp_core::crypto::AccountId32::new([n; 32])
}

fn window(authors: Vec<(sp_core::crypto::AccountId32, u32)>) -> AuthorshipWindow<Test> {
    AuthorshipWindow {
        authors: BoundedVec::truncate_from(authors),
        truncated: false,
    }
}

#[test]
fn collator_authorship_accumulates_per_author_per_day_and_per_epoch() {
    new_test_ext().execute_with(|| {
        // Day 0: author 1 twice, author 2 once.
        Welfare::note_collator_authorship(7, 0, author(1));
        Welfare::note_collator_authorship(7, 0, author(1));
        Welfare::note_collator_authorship(7, 0, author(2));
        // Day 1: author 1 once, author 3 once.
        Welfare::note_collator_authorship(7, 1, author(1));
        Welfare::note_collator_authorship(7, 1, author(3));
        // A different epoch must not leak into either.
        Welfare::note_collator_authorship(8, 0, author(9));

        assert_eq!(
            Welfare::collator_authorship(7, 0).authors.into_inner(),
            vec![(author(1), 2), (author(2), 1)]
        );
        assert_eq!(
            Welfare::collator_authorship(7, 1).authors.into_inner(),
            vec![(author(1), 1), (author(3), 1)]
        );
        assert_eq!(
            Welfare::collator_authorship(7, 2).authors.into_inner(),
            vec![]
        );

        // The epoch aggregate is maintained on write, one entry per author —
        // author 1's three blocks are one entry, not two — so a consumer pays
        // one bounded read instead of folding up to 256 day slots.
        assert_eq!(
            Welfare::collator_authorship_epoch(7).authors.into_inner(),
            vec![(author(1), 3), (author(2), 1), (author(3), 1)]
        );
        assert_eq!(
            Welfare::collator_authorship_epoch(8).authors.into_inner(),
            vec![(author(9), 1)]
        );
        assert_eq!(
            Welfare::collator_authorship_epoch(9).authors.into_inner(),
            vec![]
        );
        // Nothing was dropped, so every window's distribution is the real one.
        assert!(!Welfare::collator_authorship(7, 0).truncated);
        assert!(!Welfare::collator_authorship_epoch(7).truncated);
    });
}

#[test]
fn collator_authorship_saturates_rather_than_overflowing_a_count() {
    new_test_ext().execute_with(|| {
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![7]));
        CollatorAuthorship::<Test>::insert(7, 0, window(vec![(author(1), u32::MAX)]));
        CollatorAuthorshipEpoch::<Test>::insert(7, window(vec![(author(1), u32::MAX)]));

        Welfare::note_collator_authorship(7, 0, author(1));

        assert_eq!(
            Welfare::collator_authorship(7, 0).authors.into_inner(),
            vec![(author(1), u32::MAX)]
        );
        assert_eq!(
            Welfare::collator_authorship_epoch(7).authors.into_inner(),
            vec![(author(1), u32::MAX)]
        );
    });
}

#[test]
fn a_full_day_vector_drops_only_the_new_author() {
    new_test_ext().execute_with(|| {
        for n in 0..MAX_AUTHORSHIP_ENTRIES {
            Welfare::note_collator_authorship(7, 0, author(n as u8));
        }
        let full = Welfare::collator_authorship(7, 0);
        assert_eq!(full.authors.len(), MAX_AUTHORSHIP_ENTRIES as usize);
        assert!(!full.truncated);

        // The overflowing author is dropped: no panic, no error, and no state
        // growth — the vector is still exactly at its bound.
        Welfare::note_collator_authorship(7, 0, author(200));
        let after = Welfare::collator_authorship(7, 0);
        assert_eq!(
            after.authors, full.authors,
            "a full day vector must not admit a new author"
        );
        assert!(!after.authors.iter().any(|(who, _)| *who == author(200)));
        assert_eq!(CollatorAuthorship::<Test>::iter().count(), 1);

        // Authors already recorded for the day keep accumulating; the drop
        // costs the *new* observation only.
        Welfare::note_collator_authorship(7, 0, author(0));
        assert_eq!(
            Welfare::collator_authorship(7, 0).authors[0],
            (author(0), 2)
        );

        // Dropping understates `K`/`U`, never overstates them: the
        // distinct-author count is capped by the bound, never inflated past it.
        assert_eq!(
            Welfare::collator_authorship_epoch(7).authors.len(),
            MAX_AUTHORSHIP_ENTRIES as usize
        );
    });
}

#[test]
fn a_dropped_author_latches_the_truncation_sentinel_in_the_affected_window() {
    // The asymmetry the sentinel exists for: a drop is conservative for
    // a *count* (`K`, `U`) and misleading for a *distribution* (`D_eff`), so the
    // window records that its distribution is no longer the real one instead of
    // letting a concentration consumer trust it.
    new_test_ext().execute_with(|| {
        for n in 0..MAX_AUTHORSHIP_ENTRIES {
            Welfare::note_collator_authorship(7, 0, author(n as u8));
        }
        assert!(!Welfare::collator_authorship(7, 0).truncated);
        assert!(!Welfare::collator_authorship_epoch(7).truncated);

        // A newly rotated author arrives with the window full. This is exactly
        // the shape that makes the *retained* distribution look uniform while
        // the real one is concentrated in the dropped author.
        for _ in 0..50 {
            Welfare::note_collator_authorship(7, 0, author(200));
        }

        let day = Welfare::collator_authorship(7, 0);
        assert!(day.truncated, "the day window must latch the drop");
        assert!(
            Welfare::collator_authorship_epoch(7).truncated,
            "the epoch aggregate dropped the same author and must latch it too",
        );
        // The counts that survived are unchanged and still usable: the sentinel
        // withdraws the distribution, not the data.
        assert_eq!(day.authors.len(), MAX_AUTHORSHIP_ENTRIES as usize);
        assert!(day.authors.iter().all(|(_, blocks)| *blocks == 1));

        // A different day of the same epoch is a different window: it never
        // dropped anything, so its own distribution stays available.
        Welfare::note_collator_authorship(7, 1, author(0));
        assert!(!Welfare::collator_authorship(7, 1).truncated);
    });
}

#[test]
fn a_day_drop_alone_does_not_taint_the_epoch_aggregate() {
    // The two windows are maintained independently, so a day that ran out of
    // room does not make the epoch-wide distribution wrong — and vice versa.
    // Pinning this stops the flags being collapsed into one, which would make
    // every epoch containing one full day unusable for concentration.
    new_test_ext().execute_with(|| {
        // Fill day 0 to its bound with authors 0..N.
        for n in 0..MAX_AUTHORSHIP_ENTRIES {
            Welfare::note_collator_authorship(7, 0, author(n as u8));
        }
        // The same authors on day 1, so the epoch aggregate is also exactly at
        // its bound with no room for a new one.
        for n in 0..MAX_AUTHORSHIP_ENTRIES {
            Welfare::note_collator_authorship(7, 1, author(n as u8));
        }
        assert!(!Welfare::collator_authorship_epoch(7).truncated);

        // Author 200 is new to both windows, so both drop it and both latch.
        Welfare::note_collator_authorship(7, 0, author(200));
        assert!(Welfare::collator_authorship(7, 0).truncated);
        assert!(Welfare::collator_authorship_epoch(7).truncated);

        // Now the inverse: a fresh epoch whose day 0 is full but whose aggregate
        // has room, reached by seeding storage directly (the writer cannot
        // produce it, which is why the read path must not assume it away).
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![7, 8]));
        let mut full_day = Vec::new();
        for n in 0..MAX_AUTHORSHIP_ENTRIES {
            full_day.push((author(n as u8), 1));
        }
        CollatorAuthorship::<Test>::insert(
            8,
            0,
            AuthorshipWindow::<Test> {
                authors: BoundedVec::truncate_from(full_day.clone()),
                truncated: true,
            },
        );
        CollatorAuthorshipEpoch::<Test>::insert(8, window(full_day));
        assert!(Welfare::collator_authorship(8, 0).truncated);
        assert!(
            !Welfare::collator_authorship_epoch(8).truncated,
            "a day's drop is not the epoch aggregate's drop",
        );
    });
}

#[test]
fn a_full_traffic_index_drops_the_whole_authorship_observation() {
    // The same rule `note_xcm_traffic` follows: recording into an unindexed
    // prefix would create state the bounded retention walk can never reach.
    new_test_ext().execute_with(|| {
        for epoch in 0..MAX_XCM_TRAFFIC_EPOCHS_BOUND {
            Welfare::note_xcm_traffic(epoch, 0, XcmTrafficKind::Accepted);
        }
        assert_eq!(
            XcmTrafficEpochs::<Test>::get().len(),
            MAX_XCM_TRAFFIC_EPOCHS_BOUND as usize
        );

        Welfare::note_collator_authorship(MAX_XCM_TRAFFIC_EPOCHS_BOUND, 0, author(1));

        assert!(!CollatorAuthorship::<Test>::contains_key(
            MAX_XCM_TRAFFIC_EPOCHS_BOUND,
            0
        ));
        // Nor an aggregate: an unindexed epoch is unreachable by the reaper in
        // either map, so the whole observation is dropped and no window exists
        // to carry a sentinel.
        assert!(!CollatorAuthorshipEpoch::<Test>::contains_key(
            MAX_XCM_TRAFFIC_EPOCHS_BOUND
        ));
        assert_eq!(
            XcmTrafficEpochs::<Test>::get().len(),
            MAX_XCM_TRAFFIC_EPOCHS_BOUND as usize
        );

        // An already-indexed epoch keeps recording normally.
        Welfare::note_collator_authorship(0, 0, author(1));
        assert_eq!(
            Welfare::collator_authorship(0, 0).authors.into_inner(),
            vec![(author(1), 1)]
        );
    });
}

#[test]
fn the_reaper_retires_authorship_in_the_same_bounded_walk_as_traffic() {
    new_test_ext().execute_with(|| {
        for epoch in [1, 3, 5] {
            Welfare::note_xcm_traffic(epoch, 0, XcmTrafficKind::Accepted);
            Welfare::note_collator_authorship(epoch, 0, author(1));
            Welfare::note_collator_authorship(epoch, u8::MAX, author(2));
        }
        // An authorship-only epoch: no XCM was sent and no probe ran, which is
        // ordinary. It must be reaped by the same walk, not stranded.
        Welfare::note_collator_authorship(2, 0, author(3));

        // One call retires its bounded batch, oldest first, from *every* map the
        // shared index governs — including the epoch aggregate, which is keyed
        // by epoch alone and would otherwise outlive its day series.
        assert_ok!(Welfare::prune_xcm_traffic(5));
        assert_eq!(XcmTraffic::<Test>::iter_prefix(1).count(), 0);
        assert_eq!(CollatorAuthorship::<Test>::iter_prefix(1).count(), 0);
        assert_eq!(CollatorAuthorship::<Test>::iter_prefix(2).count(), 0);
        assert!(!CollatorAuthorshipEpoch::<Test>::contains_key(1));
        assert!(!CollatorAuthorshipEpoch::<Test>::contains_key(2));
        assert_eq!(XcmTrafficEpochs::<Test>::get().into_inner(), vec![3, 5]);

        // Epoch 3 is still eligible; the next call takes it, and 5 (not below
        // the cutoff) is retained with its authorship intact.
        assert_ok!(Welfare::prune_xcm_traffic(5));
        assert_eq!(CollatorAuthorship::<Test>::iter_prefix(3).count(), 0);
        assert!(!CollatorAuthorshipEpoch::<Test>::contains_key(3));
        assert_eq!(CollatorAuthorship::<Test>::iter_prefix(5).count(), 2);
        assert_eq!(XcmTrafficEpochs::<Test>::get().into_inner(), vec![5]);
        assert_eq!(
            Welfare::collator_authorship_epoch(5).authors.into_inner(),
            vec![(author(1), 1), (author(2), 1)]
        );
    });
}

#[test]
fn try_state_binds_the_authorship_series_to_the_shared_index() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(30);

        // Populated through the writer: indexed, in the past, inside its bound.
        Welfare::note_collator_authorship(29, 0, author(1));
        Welfare::note_collator_authorship(29, 0, author(2));
        Welfare::note_collator_authorship(29, 4, author(1));
        assert_ok!(Welfare::do_try_state());

        // An authorship-only epoch is legitimate state: the index check must not
        // demand an XCM counter or a probe outcome alongside it.
        assert_eq!(XcmTraffic::<Test>::iter_prefix(29).count(), 0);
        assert_eq!(ReserveProbeDaily::<Test>::iter_prefix(29).count(), 0);

        // An epoch present in the map but absent from the index is unreachable
        // by the bounded reaper — the exact corruption the index exists to
        // exclude (I-20).
        XcmTrafficEpochs::<Test>::kill();
        assert!(Welfare::do_try_state().is_err());

        // Restoring the index restores the invariant.
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![29]));
        assert_ok!(Welfare::do_try_state());

        // Authorship attributed to an epoch the clock has not reached.
        CollatorAuthorship::<Test>::insert(31, 0, window(vec![(author(1), 1)]));
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![29, 31]));
        assert!(Welfare::do_try_state().is_err());

        // An empty stored author set is not a legal record either: the writer
        // never produces one, so its presence is corruption.
        CollatorAuthorship::<Test>::remove(31, 0);
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![29]));
        assert_ok!(Welfare::do_try_state());
        CollatorAuthorship::<Test>::insert(29, 9, window(Vec::new()));
        assert!(Welfare::do_try_state().is_err());
    });
}

#[test]
fn try_state_binds_the_epoch_aggregate_to_its_day_series() {
    // The aggregate is derived state maintained on write, so nothing but
    // try-state can catch a writer that stopped updating one of its two windows
    // — the failure would otherwise be silent and move every component reading
    // the aggregate.
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(30);
        Welfare::note_collator_authorship(29, 0, author(1));
        Welfare::note_collator_authorship(29, 1, author(1));
        Welfare::note_collator_authorship(29, 1, author(2));
        assert_ok!(Welfare::do_try_state());

        // The aggregate under-counts the day series: three blocks were authored
        // and the aggregate accounts for two.
        CollatorAuthorshipEpoch::<Test>::insert(29, window(vec![(author(1), 1), (author(2), 1)]));
        assert!(Welfare::do_try_state().is_err());

        // Restoring the true total restores the invariant.
        CollatorAuthorshipEpoch::<Test>::insert(29, window(vec![(author(1), 2), (author(2), 1)]));
        assert_ok!(Welfare::do_try_state());

        // An aggregate whose epoch is absent from the shared index is
        // unreachable by the bounded reaper, exactly like a day window (I-20).
        CollatorAuthorshipEpoch::<Test>::insert(28, window(vec![(author(1), 1)]));
        assert!(Welfare::do_try_state().is_err());
        XcmTrafficEpochs::<Test>::put(BoundedVec::truncate_from(vec![28, 29]));
        // Epoch 28 has an aggregate and no day series: the totals disagree, and
        // that is a real divergence rather than a legal shape.
        assert!(Welfare::do_try_state().is_err());

        // A truncated aggregate is excused from the totals check — it admits it
        // dropped observations the day series may still hold.
        CollatorAuthorshipEpoch::<Test>::insert(
            28,
            AuthorshipWindow::<Test> {
                authors: BoundedVec::truncate_from(vec![(author(1), 1)]),
                truncated: true,
            },
        );
        assert_ok!(Welfare::do_try_state());

        // The pairing binds in the other direction too. Iterating aggregates
        // alone would *skip* an epoch whose aggregate went missing, so the
        // totals check cannot see the failure that matters most: a writer that
        // stopped maintaining the aggregate while the day series kept growing.
        CollatorAuthorshipEpoch::<Test>::remove(29);
        assert!(Welfare::do_try_state().is_err());
        CollatorAuthorshipEpoch::<Test>::insert(29, window(vec![(author(1), 2), (author(2), 1)]));
        assert_ok!(Welfare::do_try_state());
    });
}

// ---------------------------------------------------------------- SQ-181
//
// 05 §4.7's measurable day set: a day index is a measurement window only if the
// epoch actually contained it. `MAX_DAILY_GATE_SAMPLES` is the storage bound on
// the breach bitmap, not the semantic bound, so a day below it can still be
// outside the epoch — and resolving such a day would let a keeper manufacture a
// `C_daily` breach out of components that were never measured.

#[test]
fn record_daily_gate_refuses_a_day_the_epoch_never_had() {
    new_test_ext().execute_with(|| {
        RecordKeeperRebates::set(true);
        // A 14-whole-day epoch: days 0..=13 are measurement windows, day 14 is
        // not, and every one of them is below `MAX_DAILY_GATE_SAMPLES`.
        MeasurableDays::set(Some(14));

        // The last day inside the set is admitted.
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            5,
            13,
            1
        ));
        assert_eq!(SampledGateDays::<Test>::get(5), Some([1 << 13, 0]));
        assert_eq!(KeeperRebates::get().len(), 1);

        // The first day outside it is refused — not resolved to any value, so no
        // sample is recorded, no breach flag is set, and no rebate is paid.
        let flags_before = GateBreachFlags::<Test>::get(5);
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 5, 14, 1),
            Error::<Test>::DayOutsideEpoch
        );
        assert_eq!(SampledGateDays::<Test>::get(5), Some([1 << 13, 0]));
        assert_eq!(GateBreachFlags::<Test>::get(5), flags_before);
        assert_eq!(KeeperRebates::get().len(), 1);

        // And so is a day the storage bitmap could hold.
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 5, 63, 1),
            Error::<Test>::DayOutsideEpoch
        );
        // The bitmap bound still answers first for a day it cannot even address.
        assert_noop!(
            Welfare::record_daily_gate(
                RuntimeOrigin::signed(keeper()),
                5,
                MAX_DAILY_GATE_SAMPLES,
                1
            ),
            Error::<Test>::ValueOutOfRange
        );
    });
}

#[test]
fn a_sub_day_epoch_still_requires_one_recorded_day() {
    // The floor at one day: a `fast-timing` epoch shorter than a day has one
    // measurable day, so it cannot pass vacuously — and it has exactly one, so
    // day 1 is already outside it.
    new_test_ext().execute_with(|| {
        MeasurableDays::set(Some(1));

        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            5,
            0,
            1
        ));
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 5, 1, 1),
            Error::<Test>::DayOutsideEpoch
        );
    });
}

#[test]
fn an_epoch_whose_timing_is_unknown_admits_no_day_at_all() {
    // Membership in the measurable set cannot be decided, so every day is
    // refused rather than assumed inside it (G-1).
    new_test_ext().execute_with(|| {
        MeasurableDays::set(None);

        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 5, 0, 1),
            Error::<Test>::DayOutsideEpoch
        );
        assert_eq!(SampledGateDays::<Test>::get(5), None);
    });
}

#[test]
fn injected_component_vector_over_limit_is_rejected() {
    new_test_ext().execute_with(|| {
        OnchainInput::set(
            (0..=MAX_COMPONENTS_PER_SPEC as u16)
                .map(|id| ComponentValue {
                    id,
                    value: FixedU64(ONE),
                })
                .collect(),
        );
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 7, 1),
            Error::<Test>::TooManyComponents
        );
        DailyInput::set(OnchainInput::get());
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 7, 0, 1),
            Error::<Test>::TooManyComponents
        );
    });
}

#[test]
fn try_state_passes_after_representative_sequence() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(default_specs(2)),
        ));
        CurrentEpochValue::set(FINALIZED_NOW);
        // v2 activates at epoch 2, so it is epoch 7's active spec: the daily
        // gate must take it, and v1 is recordable only as a frozen cohort's
        // version.
        FrozenSpecVersions::set(vec![1]);
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            0,
            2,
        ));
        assert_ok!(Welfare::do_try_state());
    });
}

#[test]
fn try_state_rejects_a_snapshot_stored_under_the_wrong_map_key() {
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        let snapshot = Snapshots::<Test>::take((7, 1)).expect("snapshot exists");
        Snapshots::<Test>::insert((8, 1), snapshot);
        assert!(Welfare::do_try_state().is_err());
    });
}

#[test]
fn try_state_rejects_an_orphan_sampled_gate_marker() {
    new_test_ext().execute_with(|| {
        SampledGateDays::<Test>::insert(7, [1, 0]);
        assert!(!GateBreachFlags::<Test>::contains_key(7));
        assert!(Welfare::do_try_state().is_err());
    });
}

#[test]
fn live_param_flip_changes_gate_and_welfare() {
    new_test_ext().execute_with(|| {
        OnchainInput::set(components(ONE, 900_000_000, 500_000_000, ONE));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        let before = Snapshots::<Test>::get((7, 1)).expect("first snapshot exists");

        ThetaCHi::set(FixedU64(990_000_000));
        WP::set(FixedU64(650_000_000));
        WA::set(FixedU64(350_000_000));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            8,
            1,
        ));
        let after = Snapshots::<Test>::get((8, 1)).expect("second snapshot exists");
        assert!(after.gate_c.0 < before.gate_c.0);
        assert_ne!(after.welfare, before.welfare);
    });
}

#[test]
fn invalid_live_params_fail_closed_as_bad_params() {
    new_test_ext().execute_with(|| {
        WP::set(FixedU64(900_000_000));
        WA::set(FixedU64(400_000_000));
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 7, 1),
            Error::<Test>::BadParams
        );
        assert_eq!(Snapshots::<Test>::iter().count(), 0);

        WP::set(crate::W_P);
        WA::set(crate::W_A);
        ThetaSLo::set(FixedU64(crate::THETA_S_LO.0 - 1));
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 7, 0, 1),
            Error::<Test>::BadParams
        );
        assert_eq!(GateBreachFlags::<Test>::iter().count(), 0);
    });
}

#[test]
fn compute_settlement_dispatches_scalar_gates_and_baseline() {
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            11,
            1,
        ));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            12,
            1,
        ));

        DailyInput::set(components(800_000_000, ONE, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            11,
            0,
            1,
        ));
        DailyInput::set(components(ONE, 800_000_000, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            12,
            1,
            1,
        ));

        LedgerCalls::set(Vec::new());
        assert_ok!(Welfare::compute_settlement(
            10,
            1,
            &[SettleTarget::Proposal {
                pid: 42,
                has_gate_books: true,
            }]
        ));
        assert_eq!(
            LedgerCalls::get(),
            vec![
                LedgerCall::Scalar(42, FixedU64(ONE)),
                LedgerCall::Gate(42, GateKind::Survival, true),
                LedgerCall::Gate(42, GateKind::Security, true),
            ]
        );
        System::assert_last_event(RuntimeEvent::Welfare(Event::SettlementComputed {
            epoch: 10,
            spec_version: 1,
            score: FixedU64(ONE),
        }));

        LedgerCalls::set(Vec::new());
        assert_ok!(Welfare::compute_settlement(
            10,
            1,
            &[SettleTarget::Proposal {
                pid: 43,
                has_gate_books: false,
            }]
        ));
        assert_eq!(
            LedgerCalls::get(),
            vec![LedgerCall::Scalar(43, FixedU64(ONE))]
        );

        assert_ok!(Welfare::compute_settlement(
            10,
            1,
            &[SettleTarget::Baseline]
        ));
        assert_eq!(
            LedgerCalls::get().last(),
            Some(&LedgerCall::Baseline(10, FixedU64(ONE)))
        );
    });
}

#[test]
fn ledger_failure_is_atomic_and_emits_no_settlement_event() {
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            11,
            1,
        ));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            12,
            1,
        ));
        // SQ-79: the gate window must carry at least one observation per
        // measurement epoch before gate books may settle at all, so sample both
        // — this test is about ledger atomicity, not about the window rule.
        for epoch in [11, 12] {
            assert_ok!(Welfare::record_daily_gate(
                RuntimeOrigin::signed(keeper()),
                epoch,
                0,
                1,
            ));
        }
        let before_state = Welfare::welfare_state();
        let before_events = System::events();
        LedgerCalls::set(Vec::new());
        LedgerFailure::set(Some(LedgerCall::Gate(42, GateKind::Security, false)));

        assert_noop!(
            Welfare::compute_settlement(
                10,
                1,
                &[SettleTarget::Proposal {
                    pid: 42,
                    has_gate_books: true,
                }]
            ),
            sp_runtime::DispatchError::Other("injected ledger failure")
        );
        assert_eq!(Welfare::welfare_state(), before_state);
        assert_eq!(System::events(), before_events);
        assert!(LedgerCalls::get().is_empty());
        assert!(!System::events().iter().any(|record| matches!(
            record.event,
            RuntimeEvent::Welfare(Event::SettlementComputed { .. })
        )));
    });
}

// -------------------------------- 03 §2.3/§5.2 epoch-VOID Baseline settlement
//
// 03 §5.2 (owning transition, normative): "Under an epoch VOID, the
// SettleAuthority settles the Baseline vault at `s = 0.5` … The settlement is
// mandatory and unconditional on that path … Implementations MUST treat 'no
// Baseline vault for the epoch' and 'already `Settled`' as no-ops rather than
// failures — a VOID must never fail on this leg (G-1)." 05 §7(5) names welfare
// as the sole SettleAuthority holder that performs it. SQ-92 regression.

#[test]
fn sq92_settle_baseline_void_settles_only_the_named_epoch_at_the_kernel_void_score() {
    // 03 §2.3 transition row `Baseline Open → Settled(s)` ("epoch VOID settles
    // at `s = 0.5`"): the score is the kernel constant, never a literal, and it
    // is the neutral midpoint of the 1e9 score scale (03 §5.2).
    assert_eq!(
        kernel::VOID_BASELINE_SCORE.0.saturating_mul(2),
        kernel::SCORE_SCALE
    );
    new_test_ext().execute_with(|| {
        LedgerCalls::set(Vec::new());

        assert_ok!(Welfare::settle_baseline_void(10));

        // Exactly one settlement, for exactly the voided epoch: the Baseline
        // vault is keyed per epoch, so a VOID of `e` may not touch `e ± 1`.
        assert_eq!(
            LedgerCalls::get(),
            vec![LedgerCall::Baseline(10, kernel::VOID_BASELINE_SCORE)]
        );
    });
}

#[test]
fn sq92_settle_baseline_void_reads_no_welfare_state_and_needs_no_snapshots() {
    // A VOID means no measurement is trusted (05 §7(4)), so the Baseline
    // settlement carries a spec-fixed constant rather than a computed score
    // (05 §7(5): "a terminal transition carrying a spec-fixed constant, not a
    // computation — which is exactly why it survives a VOID"). Pinned by
    // contrast: the scored path for the same epoch cannot run at all here.
    new_test_ext().execute_with(|| {
        assert_noop!(
            Welfare::compute_settlement(10, 1, &[SettleTarget::Baseline]),
            Error::<Test>::MissingComponent
        );
        LedgerCalls::set(Vec::new());

        assert_ok!(Welfare::settle_baseline_void(10));

        assert_eq!(
            LedgerCalls::get(),
            vec![LedgerCall::Baseline(10, kernel::VOID_BASELINE_SCORE)]
        );
    });
}

#[test]
fn sq92_settle_baseline_void_is_a_silent_noop_when_no_baseline_vault_is_open() {
    // G-1 leg of 03 §5.2: both benign cases — the epoch never had a Baseline
    // vault, and the vault is already `Settled` — reach this seam as
    // `baseline_open == false` and MUST be no-ops rather than failures. The two
    // cases are distinguished where the distinction is real (ledger/runtime).
    new_test_ext().execute_with(|| {
        BaselineClosed::set(vec![10]);
        LedgerCalls::set(Vec::new());

        assert_ok!(Welfare::settle_baseline_void(10));

        assert!(LedgerCalls::get().is_empty());
        // The precondition is per epoch: a sibling epoch still settles.
        assert_ok!(Welfare::settle_baseline_void(11));
        assert_eq!(
            LedgerCalls::get(),
            vec![LedgerCall::Baseline(11, kernel::VOID_BASELINE_SCORE)]
        );
    });
}

#[test]
fn sq92_settle_baseline_void_propagates_a_real_ledger_failure() {
    // 03 §5.2 enumerates the no-op cases exhaustively; anything else is a
    // genuine failure and must not be swallowed. G-1 then makes the caller's
    // VOID fail closed rather than record a Void cohort over an `Open`
    // Baseline vault — the exact stranding state the spec forbids.
    new_test_ext().execute_with(|| {
        LedgerFailure::set(Some(LedgerCall::Baseline(10, kernel::VOID_BASELINE_SCORE)));
        LedgerCalls::set(Vec::new());

        assert_noop!(
            Welfare::settle_baseline_void(10),
            sp_runtime::DispatchError::Other("injected ledger failure")
        );

        assert!(LedgerCalls::get().is_empty());
    });
}

fn assert_last_matches_core(event: CoreEvent) {
    let expected = match event {
        CoreEvent::MetricSpecRegistered { version } => {
            RuntimeEvent::Welfare(Event::MetricSpecRegistered { version })
        }
        CoreEvent::SnapshotRecorded {
            epoch,
            spec_version,
            welfare,
        } => RuntimeEvent::Welfare(Event::SnapshotRecorded {
            epoch,
            spec_version,
            welfare,
        }),
        CoreEvent::GateBreachRecorded {
            epoch,
            day,
            s_breached,
            c_breached,
        } => RuntimeEvent::Welfare(Event::GateBreachRecorded {
            epoch,
            day,
            s_breached,
            c_breached,
        }),
        CoreEvent::SettlementComputed {
            epoch,
            spec_version,
            score,
        } => RuntimeEvent::Welfare(Event::SettlementComputed {
            epoch,
            spec_version,
            score,
        }),
        CoreEvent::SettlementRenormalized {
            epoch,
            spec_version,
            dropped,
        } => RuntimeEvent::Welfare(Event::SettlementRenormalized {
            epoch,
            spec_version,
            dropped: frame_support::BoundedVec::truncate_from(dropped),
        }),
    };
    System::assert_last_event(expected);
}

#[test]
fn shell_matches_core_over_400_step_fixed_seed_sequence() {
    new_test_ext().execute_with(|| {
        let mut core = WelfareState::new();
        core.register_metric_spec(
            Registration::Genesis,
            1,
            genesis_specs(1),
            &crate::mock::SeatedOracle::admission(),
        )
        .expect("seed spec is valid");
        core.events.clear();
        let params = CoreWelfareParams::DEFAULT;
        let mut seed = 0x6d2b_79f5_u64;

        for step in 0..400u32 {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let selector = (seed >> 61) as u8 % 5;
            let version = 1 + ((seed >> 8) % 19) as u16;
            LedgerCalls::set(Vec::new());
            let mut expected_ledger_calls = Vec::new();
            let expected_ok = match selector {
                0 => {
                    let version = 2 + ((seed >> 16) % 18) as u16;
                    // Register at the live clock with the two-epoch lead honored,
                    // exactly as the extrinsic does; both sides use the same
                    // `now`, so shell ≡ core holds. These post-genesis specs
                    // activate at `now + 2`, past every snapshot epoch below, so
                    // the snapshot steps exercise the SpecNotActive mirror while
                    // the genesis version (active from epoch 1) drives success.
                    let now = CurrentEpochValue::get();
                    let specs = specs_activating(version, now + 2);
                    let core_result = core.register_metric_spec(
                        Registration::Live { current_epoch: now },
                        version,
                        specs.clone(),
                        &crate::mock::SeatedOracle::admission(),
                    );
                    let pallet_result = Welfare::register_spec(
                        RuntimeOrigin::signed(governance_acc()),
                        version,
                        bounded(specs),
                    );
                    let expected_ok = core_result.is_ok();
                    assert_eq!(pallet_result.is_ok(), expected_ok, "register step {step}");
                    expected_ok
                }
                1 => {
                    let epoch = 100 + ((seed >> 20) % 25) as u32;
                    let c = 850_000_000 + (seed % 150_000_001);
                    let p = 500_000_000 + ((seed >> 7) % 500_000_001);
                    let values = components(ONE, c, p, ONE);
                    OnchainInput::set(values.clone());
                    // The admissible set is runtime state, so the shell reads
                    // it and hands the core the same answer — the seam, not a
                    // second derivation that could drift.
                    let admissible = Welfare::admissible_snapshot_specs(epoch);
                    let core_result = core.record_snapshot(
                        epoch,
                        version,
                        &admissible,
                        values,
                        FixedU64(ONE),
                        Vec::new(),
                        &params,
                    );
                    let pallet_result =
                        Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), epoch, version);
                    let expected_ok = core_result.is_ok();
                    assert_eq!(pallet_result.is_ok(), expected_ok, "snapshot step {step}");
                    expected_ok
                }
                2 => {
                    let epoch = 200 + ((seed >> 24) % 25) as u32;
                    let day = ((seed >> 32) % 64) as u8;
                    let s = 800_000_000 + (seed % 200_000_001);
                    let c = 800_000_000 + ((seed >> 6) % 200_000_001);
                    let values = components(s, c, ONE, ONE);
                    DailyInput::set(values.clone());
                    let active = Welfare::active_snapshot_spec(epoch);
                    let core_result =
                        core.record_daily_gate(epoch, day, version, active, values, &params);
                    let pallet_result = Welfare::record_daily_gate(
                        RuntimeOrigin::signed(keeper()),
                        epoch,
                        day,
                        version,
                    );
                    let expected_ok = core_result.is_ok();
                    assert_eq!(pallet_result.is_ok(), expected_ok, "daily step {step}");
                    expected_ok
                }
                3 => {
                    let cohort = 99 + ((seed >> 28) % 25) as u32;
                    let core_result = core.compute_settlement(cohort, version);
                    if let Ok(score) = core_result {
                        expected_ledger_calls.push(LedgerCall::Baseline(cohort, score));
                    }
                    let pallet_result =
                        Welfare::compute_settlement(cohort, version, &[SettleTarget::Baseline]);
                    let expected_ok = core_result.is_ok();
                    assert_eq!(pallet_result.is_ok(), expected_ok, "settle step {step}");
                    expected_ok
                }
                _ => {
                    let cohort = 99 + ((seed >> 28) % 25) as u32;
                    let pid = 42_u64 + u64::from((seed >> 40) as u8);
                    // SQ-79: the gate leg now consults the core's window rule,
                    // so the oracle must too — a zero-sample window makes the
                    // whole proposal settlement fail, scalar leg included. The
                    // window is checked first so a refusal leaves the core's
                    // event log untouched, exactly as the shell's discarded
                    // working state does.
                    let core_result = match core.gate_window_outcomes(cohort) {
                        Ok(gates) => core
                            .compute_settlement(cohort, version)
                            .map(|score| (score, gates)),
                        Err(error) => Err(error),
                    };
                    if let Ok((score, (s_breached, c_breached))) = core_result {
                        expected_ledger_calls.extend([
                            LedgerCall::Scalar(pid, score),
                            LedgerCall::Gate(pid, GateKind::Survival, s_breached),
                            LedgerCall::Gate(pid, GateKind::Security, c_breached),
                        ]);
                    }
                    let pallet_result = Welfare::compute_settlement(
                        cohort,
                        version,
                        &[SettleTarget::Proposal {
                            pid,
                            has_gate_books: true,
                        }],
                    );
                    let expected_ok = core_result.is_ok();
                    assert_eq!(
                        pallet_result.is_ok(),
                        expected_ok,
                        "proposal settle step {step}"
                    );
                    expected_ok
                }
            };

            assert_eq!(
                LedgerCalls::get(),
                expected_ledger_calls,
                "ledger calls diverged at step {step}"
            );

            if expected_ok {
                assert_eq!(core.events.len(), 1, "event cardinality at step {step}");
                assert_last_matches_core(core.events[0].clone());
            } else {
                assert!(core.events.is_empty(), "failed core emitted at step {step}");
            }
            core.events.clear();

            let mut shell = Welfare::welfare_state();
            shell.specs.sort_by_key(|(version, _)| *version);
            shell
                .snapshots
                .sort_by_key(|snapshot| (snapshot.epoch, snapshot.spec_version));
            shell.gate_flags.sort_by_key(|(epoch, _)| *epoch);
            core.specs.sort_by_key(|(version, _)| *version);
            core.snapshots
                .sort_by_key(|snapshot| (snapshot.epoch, snapshot.spec_version));
            core.gate_flags.sort_by_key(|(epoch, _)| *epoch);
            assert_eq!(shell.specs, core.specs, "specs diverged at step {step}");
            assert_eq!(
                shell.snapshots, core.snapshots,
                "snapshots diverged at step {step}"
            );
            assert_eq!(
                shell.gate_flags, core.gate_flags,
                "gate flags diverged at step {step}"
            );
        }
    });
}

#[test]
fn rolling_window_with_the_runtime_prune_cutoff_never_jams() {
    // Regression for the 2026-07-17 re-review blocker: the runtime seam prunes
    // with cutoff = current − (MAX_SNAPSHOTS_BOUND − 1) — the 05 §3.3 "snapshot
    // e−20 and older" reading — which must always leave one free slot in the
    // 20-capacity window so the next epoch's snapshot records. A cutoff of
    // current − MAX_SNAPSHOTS_BOUND retains a full window and jams recording
    // permanently (settlement deadlock → dead-man; PLAN SQ-200).
    new_test_ext().execute_with(|| {
        // The mock genesis spec activates at epoch 1, so the first recordable
        // snapshot epoch is 1 (clock 2).
        for current in 2..=(3 * MAX_SNAPSHOTS_BOUND) {
            CurrentEpochValue::set(current);
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                current - 1,
                1,
            ));
            assert_ok!(Welfare::prune(
                current.saturating_sub(MAX_SNAPSHOTS_BOUND - 1)
            ));
        }
        // The window is at steady state: 19 retained + the slot just used.
        assert!(Snapshots::<Test>::iter().count() <= MAX_SNAPSHOTS);
    });
}

// ---------------------------------------------------------------- SQ-79
//
// 05 §4.7 owns the daily gate-breach flags; doc 07 §10 owns the fail-static
// disposition of an unavailable gate input ("if the failed component is a gate
// input, affected cohorts VOID"). A cohort whose whole e+1…e+2 measurement
// window carries **no** recorded daily observation has no gate input at all,
// and the pre-fix code settled its gate books at "no breach" — an
// adopt-favourable claim paid out of absent data (against G-1/R-7). The ruled
// disposition is to refuse: settlement holds at the status quo and the cohort
// takes the existing VoidAuthority path.
//
// *Partial* coverage is deliberately unclassified (05 §4.7 declares no
// expected-day count), so one sampled day per measurement epoch is enough —
// `sq79_one_sampled_day_per_epoch_is_enough` pins that boundary so a later
// completeness rule cannot be introduced by accident.

#[test]
fn sq79_a_wholly_unsampled_gate_window_refuses_settlement_instead_of_reading_no_breach() {
    new_test_ext().execute_with(|| {
        for epoch in [11, 12] {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
        }
        // No `record_daily_gate` for either measurement epoch at all.
        assert!(!GateBreachFlags::<Test>::contains_key(11));
        assert!(!GateBreachFlags::<Test>::contains_key(12));

        LedgerCalls::set(Vec::new());
        assert_noop!(
            Welfare::compute_settlement(
                10,
                1,
                &[SettleTarget::Proposal {
                    pid: 42,
                    has_gate_books: true,
                }]
            ),
            Error::<Test>::GateWindowUnsampled
        );
        // Status quo: nothing settled, no scalar leg leaked out either.
        assert!(LedgerCalls::get().is_empty());
        assert!(!System::events().iter().any(|record| matches!(
            record.event,
            RuntimeEvent::Welfare(Event::SettlementComputed { .. })
        )));
    });
}

#[test]
fn sq79_a_half_sampled_window_is_still_an_unavailable_gate_input() {
    new_test_ext().execute_with(|| {
        for epoch in [11, 12] {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
        }
        // Only e+1 is observed; e+2 is a blank window.
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            11,
            0,
            1,
        ));
        assert_noop!(
            Welfare::compute_settlement(
                10,
                1,
                &[SettleTarget::Proposal {
                    pid: 42,
                    has_gate_books: true,
                }]
            ),
            Error::<Test>::GateWindowUnsampled
        );
    });
}

#[test]
fn sq79_one_sampled_day_per_epoch_is_enough() {
    // The ruling stops at zero-sample. Any completeness measure over the days
    // *within* an epoch would need a normative expected-day count, which 05 §4.7
    // does not declare — so a single healthy day per measurement epoch settles.
    new_test_ext().execute_with(|| {
        for epoch in [11, 12] {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
            assert_ok!(Welfare::record_daily_gate(
                RuntimeOrigin::signed(keeper()),
                epoch,
                0,
                1,
            ));
        }
        LedgerCalls::set(Vec::new());
        assert_ok!(Welfare::compute_settlement(
            10,
            1,
            &[SettleTarget::Proposal {
                pid: 42,
                has_gate_books: true,
            }]
        ));
        assert_eq!(
            LedgerCalls::get(),
            vec![
                LedgerCall::Scalar(42, FixedU64(ONE)),
                LedgerCall::Gate(42, GateKind::Survival, false),
                LedgerCall::Gate(42, GateKind::Security, false),
            ]
        );
    });
}

#[test]
fn sq79_refusal_is_scoped_to_gate_books_only() {
    // A gateless proposal and the Baseline book consume the scalar score, never
    // the §4.7 flags, so an unsampled window must not block them (G-1: refusing
    // more than the missing input would itself be a liveness failure).
    new_test_ext().execute_with(|| {
        for epoch in [11, 12] {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
        }
        LedgerCalls::set(Vec::new());
        assert_ok!(Welfare::compute_settlement(
            10,
            1,
            &[SettleTarget::Proposal {
                pid: 43,
                has_gate_books: false,
            }]
        ));
        assert_ok!(Welfare::compute_settlement(
            10,
            1,
            &[SettleTarget::Baseline]
        ));
        assert_eq!(
            LedgerCalls::get(),
            vec![
                LedgerCall::Scalar(43, FixedU64(ONE)),
                LedgerCall::Baseline(10, FixedU64(ONE)),
            ]
        );
    });
}

#[test]
fn sq79_view_path_keeps_the_frozen_permissive_default() {
    // 02 §4 `WelfareView.{s_breached, c_breached}` is a frozen display surface:
    // an unsampled current epoch must still render as "no breach so far" rather
    // than erroring. Only the settlement path changed.
    new_test_ext().execute_with(|| {
        let state = Welfare::welfare_state();
        let flags = state.gate_breach(11);
        assert!(!flags.s_breached && !flags.c_breached);
        assert!(!state.gate_window_sampled(11));
    });
}

// ---------------------------------------------------------------- SQ-82
//
// 05 §4.4/§4.6: the `>= current + 2` activation lead protects in-flight cohorts
// (I-16); genesis has none, so a genesis registration activates at epoch 1. The
// pre-fix core inferred "this is genesis" from the ambient `current_epoch == 0`,
// which cannot distinguish the genesis build from an unset/booting clock — so a
// *live* `register_spec` observed against a zero clock inherited the relaxation
// and could activate one epoch early. The context is now explicit.

#[test]
fn sq82_a_live_register_spec_at_a_zero_clock_does_not_inherit_the_genesis_relaxation() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        // The genesis relaxation would have admitted activation at epoch 1.
        assert_noop!(
            Welfare::register_spec(
                RuntimeOrigin::signed(governance_acc()),
                2,
                bounded(specs_activating(2, 1)),
            ),
            Error::<Test>::BadActivationEpoch
        );
        // The live `current + 2` lead is what actually binds.
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(specs_activating(2, 2)),
        ));
    });
}

#[test]
fn sq82_genesis_registration_still_activates_at_epoch_one() {
    // The relaxation itself is unchanged — 05 §4.6's cold start requires welfare
    // to be computable from epoch 1 — it is now reachable only from the genesis
    // build. The mock genesis registers `genesis_specs` (activation 1).
    new_test_ext().execute_with(|| {
        assert_eq!(Welfare::welfare_state().specs, vec![(1, genesis_specs(1))]);
    });
}

// --------------------------------------------------------------- SQ-201
//
// 05 §3.3 tied the full welfare prune to cohort reap, and `settle_cohort` is its
// only caller. An epoch that never forms a cohort is therefore unreachable by
// cohort-keyed cleanup: after MAX_SNAPSHOTS consecutive cohortless epochs
// `record_snapshot` jams at its hard bound and the §4.8 snapshot-overdue trigger
// fires — a deterministic chain wedge, not idle storage. The epoch-roll prune
// runs on every clock roll and applies the *same* §3.3 cutoff, so it retires
// nothing reap would have retained.

#[test]
fn sq201_cohortless_epochs_wedge_snapshot_recording_without_the_epoch_roll_prune() {
    // The pre-fix failure mode, pinned: with cohort reap never firing, the
    // 20-deep window fills and the 21st epoch cannot record.
    new_test_ext().execute_with(|| {
        for epoch in 2..MAX_SNAPSHOTS as u32 + 2 {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
        }
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), MAX_SNAPSHOTS as u32 + 2, 1,),
            Error::<Test>::TooManySnapshots
        );
        // The epoch-roll prune clears the jam with no cohort in sight.
        assert_ok!(Welfare::prune_epoch_roll(3));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            MAX_SNAPSHOTS as u32 + 2,
            1,
        ));
    });
}

#[test]
fn sq201_epoch_roll_prune_is_bounded_and_retires_oldest_first() {
    new_test_ext().execute_with(|| {
        for epoch in 2..SNAPSHOT_RETENTION_EPOCHS as u32 + 2 {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
            assert_ok!(Welfare::record_daily_gate(
                RuntimeOrigin::signed(keeper()),
                epoch,
                0,
                1,
            ));
        }
        // A cutoff far above the window: only EPOCH_ROLL_PRUNE_MAX_EPOCHS go per
        // call, oldest first, so a backlog is spread across ticks (I-20).
        assert_ok!(Welfare::prune_epoch_roll(
            SNAPSHOT_RETENTION_EPOCHS as u32 + 2
        ));
        assert_eq!(
            Snapshots::<Test>::iter().count(),
            SNAPSHOT_RETENTION_EPOCHS - EPOCH_ROLL_PRUNE_MAX_EPOCHS
        );
        for epoch in 2..2 + EPOCH_ROLL_PRUNE_MAX_EPOCHS as u32 {
            assert!(!Snapshots::<Test>::contains_key((epoch, 1)));
            assert!(!GateBreachFlags::<Test>::contains_key(epoch));
            assert!(!SampledGateDays::<Test>::contains_key(epoch));
        }
        assert!(Snapshots::<Test>::contains_key((
            2 + EPOCH_ROLL_PRUNE_MAX_EPOCHS as u32,
            1
        )));
    });
}

#[test]
fn sq201_epoch_roll_prune_never_retires_inside_the_retained_window() {
    // It must be impossible for the roll prune to remove state the reap-driven
    // prune would have kept: both take the same 05 §3.3 cutoff.
    new_test_ext().execute_with(|| {
        for epoch in 2..MAX_SNAPSHOTS as u32 + 2 {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
        }
        let before = Snapshots::<Test>::iter().count();
        assert_ok!(Welfare::prune_epoch_roll(2));
        assert_eq!(Snapshots::<Test>::iter().count(), before);
    });
}

#[test]
fn sq201_epoch_roll_prune_protects_the_snapshot_deadline_binding() {
    // do_try_state binds SnapshotDeadline.last_snapshot_epoch to a live
    // snapshot; maintenance must not be able to break that binding even if a
    // caller supplies an absurd cutoff.
    new_test_ext().execute_with(|| {
        for epoch in 1..4 {
            assert_ok!(Welfare::record_snapshot(
                RuntimeOrigin::signed(keeper()),
                epoch,
                1,
            ));
        }
        let last = SnapshotDeadline::<Test>::get()
            .and_then(|progress| progress.last_snapshot_epoch)
            .expect("snapshot progress advanced");
        assert_ok!(Welfare::prune_epoch_roll(u32::MAX));
        assert!(Snapshots::<Test>::contains_key((last, 1)));
        assert_ok!(Welfare::do_try_state());
    });
}

// ---- SQ-493: 07 §10 two-consecutive-flag renormalization, shell wiring -------

/// Component values kept strictly interior so every gate and geometric term is
/// live. At the mock's healthy 1.0 inputs the whole composite short-circuits and
/// a renormalization test would compare two identical saturated scores.
fn interior_components() -> Vec<ComponentValue> {
    components(950_000_000, 930_000_000, 800_000_000, 600_000_000)
}

fn record_window(flagged: Vec<((EpochId, MetricSpecVersion), Vec<MetricId>)>) {
    OnchainInput::set(interior_components());
    FlaggedInputs::set(flagged);
    for epoch in 10..=12 {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            epoch,
            1,
        ));
    }
}

fn settled_score() -> FixedU64 {
    LedgerCalls::set(Vec::new());
    assert_ok!(Welfare::compute_settlement(
        10,
        1,
        &[SettleTarget::Baseline]
    ));
    match LedgerCalls::get().last() {
        Some(LedgerCall::Baseline(_, score)) => *score,
        other => panic!("expected a baseline settlement, got {other:?}"),
    }
}

#[test]
fn sq493_flags_reach_storage_and_renormalize_the_settlement_score() {
    new_test_ext().execute_with(|| {
        // The A component (id 4, attested) is flagged in both measured epochs.
        record_window(vec![((11, 1), vec![4]), ((12, 1), vec![4])]);

        // The flags land in the pallet-internal context beside each snapshot —
        // never in `Snapshots`, which is a frozen 02 §7.4 frontend surface.
        for epoch in 11..=12 {
            let context = SnapshotContexts::<Test>::get((epoch, 1)).expect("context stored");
            assert_eq!(context.flagged.into_inner(), vec![4]);
            assert_eq!(context.incident_multiplier, FixedU64(ONE));
            assert_eq!(
                context.params,
                Welfare::welfare_state().snapshot_contexts[0].params
            );
        }
        assert!(SnapshotContexts::<Test>::get((10, 1))
            .expect("context stored")
            .flagged
            .is_empty());

        let renormalized = settled_score();
        let events = System::events()
            .into_iter()
            .filter_map(|record| match record.event {
                RuntimeEvent::Welfare(event) => Some(event),
                _ => None,
            })
            .collect::<Vec<_>>();
        let dropped = BoundedVec::try_from(vec![4u16]).expect("bounded");
        assert_eq!(
            events[events.len() - 2],
            Event::SettlementRenormalized {
                epoch: 10,
                spec_version: 1,
                dropped,
            },
            "the renormalization must be reported immediately before the score"
        );
        assert!(matches!(
            events[events.len() - 1],
            Event::SettlementComputed { epoch: 10, .. }
        ));
        assert_ok!(Welfare::do_try_state());
        // The drop is load-bearing: the same inputs unflagged settle lower,
        // because the 0.6 A value was still voting.
        let carried = new_test_ext().execute_with(|| {
            record_window(Vec::new());
            let score = settled_score();
            assert!(!System::events().into_iter().any(|record| matches!(
                record.event,
                RuntimeEvent::Welfare(Event::SettlementRenormalized { .. })
            )));
            score
        });
        assert!(
            carried.0 < renormalized.0,
            "carried {carried:?} vs renormalized {renormalized:?}"
        );
        // Both scores must be strictly interior, or the comparison above proves
        // nothing: a zeroed gate or a saturated composite compares equal
        // whatever the renormalization did.
        for score in [carried, renormalized] {
            assert!(
                (100_000_000..900_000_000).contains(&score.0),
                "degenerate settlement fixture: {score:?}"
            );
        }
    });
}

#[test]
fn sq493_a_flag_on_a_non_attested_component_refuses_the_crank() {
    new_test_ext().execute_with(|| {
        OnchainInput::set(interior_components());
        // Component 2 is the on-chain C input: 07 §11(1)(i) makes class-4
        // components the only reportable ones, so a flag here would be feeding
        // §10's renormalization with a value the oracle never owned. The crank
        // refuses rather than recording it (G-1).
        FlaggedInputs::set(vec![((11, 1), vec![2])]);
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 11, 1),
            Error::<Test>::BadFlaggedComponent
        );
        assert!(SnapshotContexts::<Test>::get((11, 1)).is_none());
    });
}

#[test]
fn sq493_contexts_retire_with_their_snapshots_on_both_prune_paths() {
    new_test_ext().execute_with(|| {
        record_window(vec![((11, 1), vec![4]), ((12, 1), vec![4])]);
        assert_eq!(SnapshotContexts::<Test>::iter().count(), 3);
        assert_ok!(Welfare::prune(11));
        assert_eq!(SnapshotContexts::<Test>::iter().count(), 2);
        assert!(SnapshotContexts::<Test>::get((10, 1)).is_none());
        assert_ok!(Welfare::do_try_state());
        assert_ok!(Welfare::prune_epoch_roll(12));
        assert_eq!(
            SnapshotContexts::<Test>::iter().count(),
            Snapshots::<Test>::iter().count()
        );
        assert_ok!(Welfare::do_try_state());
    });
}

/// SQ-497: a batch settles every target and computes the score **once**.
///
/// The seam takes the targets rather than a score, so welfare still owns the
/// number (05 §6) — what changes is that `(cohort_epoch, spec_version)` fixes it
/// for the whole batch, which `epoch-core` guarantees by freezing one
/// `metric_spec` per cohort. The observable proof is the event stream: the
/// computation deposits `SettlementComputed` once, while the ledger sees every
/// target.
#[test]
fn sq497_batched_settlement_settles_every_target_and_computes_the_score_once() {
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            11,
            1,
        ));
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            12,
            1,
        ));
        DailyInput::set(components(800_000_000, ONE, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            11,
            0,
            1,
        ));
        DailyInput::set(components(ONE, 800_000_000, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            12,
            1,
            1,
        ));

        LedgerCalls::set(Vec::new());
        System::reset_events();
        let score = Welfare::compute_settlement(
            10,
            1,
            &[
                SettleTarget::Proposal {
                    pid: 42,
                    has_gate_books: true,
                },
                SettleTarget::Proposal {
                    pid: 43,
                    has_gate_books: false,
                },
                SettleTarget::Baseline,
            ],
        );
        assert_ok!(score);

        // Every target settled, in order, at the one shared score.
        assert_eq!(
            LedgerCalls::get(),
            vec![
                LedgerCall::Scalar(42, FixedU64(ONE)),
                LedgerCall::Gate(42, GateKind::Survival, true),
                LedgerCall::Gate(42, GateKind::Security, true),
                LedgerCall::Scalar(43, FixedU64(ONE)),
                LedgerCall::Baseline(10, FixedU64(ONE)),
            ]
        );

        // ... and the computation was reported exactly once, not once per item.
        let settlements = System::events()
            .into_iter()
            .filter(|record| {
                matches!(
                    record.event,
                    RuntimeEvent::Welfare(Event::SettlementComputed { .. })
                )
            })
            .count();
        assert_eq!(settlements, 1);
    });
}

/// SQ-497: `persist` writes the difference, so both edges of "difference" must
/// hold — an in-place value change is still written, and a key the new state
/// drops is still removed.
///
/// This is the risk the diff introduced. The old shape removed every key and
/// re-inserted every key, which is wasteful but cannot miss an update; a diff
/// that compares the wrong thing silently keeps stale state. The comparison is
/// against **stored** values for exactly that reason — the core → stored
/// conversions change representation, so comparing core values would be
/// comparing something other than what is written.
#[test]
fn sq497_diffed_persist_still_writes_updates_and_still_removes_dropped_keys() {
    new_test_ext().execute_with(|| {
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            11,
            1,
        ));
        DailyInput::set(components(800_000_000, ONE, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            11,
            0,
            1,
        ));
        let after_first = GateBreachFlags::<Test>::get(11).expect("flags recorded");

        // An in-place update of a key that already exists.
        DailyInput::set(components(ONE, 800_000_000, ONE, ONE));
        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            11,
            1,
            1,
        ));
        let after_second = GateBreachFlags::<Test>::get(11).expect("flags still recorded");
        assert_ne!(
            after_first, after_second,
            "a changed value must reach storage",
        );
        assert!(Snapshots::<Test>::contains_key((11, 1)));

        // A key the new state drops.
        assert_ok!(Welfare::prune(12));
        assert!(!GateBreachFlags::<Test>::contains_key(11));
        assert!(!Snapshots::<Test>::contains_key((11, 1)));
    });
}

// ------------------------------------------------------- A14: `H` and `Π`
//
// 05 §4.3 adds two `C_onchain` components with on-chain inputs this pallet
// owns: the block-weight utilization accumulator behind `H`, and the single
// saturating defensive-failure counter behind `Π`. The 40 % mapping and the
// `max(0, 1 − 0.25·n)` projection are runtime-composition work and are pinned in
// `runtime/bleavit-runtime/src/tests_welfare_inputs.rs`; what belongs here is
// the recording, the bounds, the reaper and try-state.

/// The block limit the mock's `frame_system` declares, so tests express
/// utilization as a fraction of the real denominator rather than a literal.
fn block_limit() -> frame_support::weights::Weight {
    <<Test as frame_system::Config>::BlockWeights as Get<frame_system::limits::BlockWeights>>::get()
        .max_block
}

#[test]
fn utilization_takes_the_worse_of_the_two_weight_dimensions() {
    let limit = frame_support::weights::Weight::from_parts(1_000, 2_000);
    // ref_time saturated, proof idle: headroom is exhausted, so the ratio is 1.
    assert_eq!(
        crate::block_utilization(frame_support::weights::Weight::from_parts(1_000, 0), limit),
        Some(ONE),
    );
    // proof saturated, ref_time idle: same answer, which is the whole point of
    // `max` — either dimension alone can exhaust the block.
    assert_eq!(
        crate::block_utilization(frame_support::weights::Weight::from_parts(0, 2_000), limit),
        Some(ONE),
    );
    // Balanced at half of each: 0.5, not the 1.0 a sum would report.
    assert_eq!(
        crate::block_utilization(
            frame_support::weights::Weight::from_parts(500, 1_000),
            limit
        ),
        Some(ONE / 2),
    );
    // Rounding is against the score: 1/1000 of ref_time rounds *up*.
    let sliver = crate::block_utilization(frame_support::weights::Weight::from_parts(1, 0), limit)
        .expect("measurable");
    assert_eq!(sliver, ONE / 1_000, "exact ratios are not inflated");
    let ragged = crate::block_utilization(
        frame_support::weights::Weight::from_parts(1, 0),
        frame_support::weights::Weight::from_parts(3, 3),
    )
    .expect("measurable");
    assert_eq!(ragged, ONE / 3 + 1, "an inexact ratio must round up");
    // Over the limit clamps at full rather than overflowing the grid.
    assert_eq!(
        crate::block_utilization(
            frame_support::weights::Weight::from_parts(u64::MAX, u64::MAX),
            limit
        ),
        Some(ONE),
    );
    // A limit with no measurable dimension yields no ratio at all.
    assert_eq!(
        crate::block_utilization(
            frame_support::weights::Weight::from_parts(1, 1),
            frame_support::weights::Weight::from_parts(0, 0)
        ),
        None,
    );
}

#[test]
fn the_finalization_sampler_accumulates_into_its_window() {
    new_test_ext().execute_with(|| {
        CurrentWindowValue::set((4, 2));
        // A known consumed weight, so the recorded ratio is checkable rather
        // than merely non-zero.
        let used = block_limit() / 2;
        frame_system::Pallet::<Test>::register_extra_weight_unchecked(
            used,
            frame_support::dispatch::DispatchClass::Mandatory,
        );
        let before = frame_system::Pallet::<Test>::block_weight().total();
        Welfare::sample_block_weight();

        let sample = Welfare::block_weight_sample(4, 2);
        assert_eq!(sample.blocks, 1);
        // The sampler charges its own benchmarked weight *before* reading, so
        // the recorded ratio is at least the pre-hook utilization — the
        // sampler's own cost is part of the block's real utilization.
        let floor = crate::block_utilization(before, block_limit()).expect("measurable");
        assert!(
            sample.utilization_sum >= floor,
            "sampled {} < pre-hook {floor}",
            sample.utilization_sum,
        );
        assert!(sample.utilization_sum <= ONE);
        // The window is bound to the shared retention index, so the reaper can
        // always reach it (I-20).
        assert!(XcmTrafficEpochs::<Test>::get().contains(&4));

        // A second sample in the same window adds, and both granularities read
        // the same accumulator.
        Welfare::sample_block_weight();
        assert_eq!(Welfare::block_weight_sample(4, 2).blocks, 2);
        assert_eq!(Welfare::block_weight_epoch(4).blocks, 2);
    });
}

#[test]
fn the_epoch_accumulator_is_block_weighted_across_days() {
    new_test_ext().execute_with(|| {
        // Day 0 samples once at full utilization; day 1 samples three times at
        // zero. The epoch mean must be 1/4, not the 1/2 a mean-of-daily-means
        // would give.
        Welfare::note_xcm_traffic(6, 0, XcmTrafficKind::Accepted);
        BlockWeightSamples::<Test>::insert(
            6,
            0,
            BlockWeightSample {
                utilization_sum: ONE,
                blocks: 1,
            },
        );
        BlockWeightSamples::<Test>::insert(
            6,
            1,
            BlockWeightSample {
                utilization_sum: 0,
                blocks: 3,
            },
        );
        let epoch = Welfare::block_weight_epoch(6);
        assert_eq!(epoch.utilization_sum, ONE);
        assert_eq!(epoch.blocks, 4);
    });
}

#[test]
fn an_unsampled_window_stores_nothing_at_all() {
    new_test_ext().execute_with(|| {
        // `ValueQuery` means an unwritten key reads as the default. The default
        // carries `blocks == 0`, which is what makes "never sampled" a distinct
        // fact from "sampled and idle" — the difference between `H` absent and
        // `H` = 1.
        assert_eq!(Welfare::block_weight_sample(9, 0).blocks, 0);
        assert_eq!(Welfare::block_weight_epoch(9).blocks, 0);
        assert_eq!(BlockWeightSamples::<Test>::iter().count(), 0);
    });
}

#[test]
fn the_sampler_drops_the_window_when_the_shared_index_is_full() {
    new_test_ext().execute_with(|| {
        // 05 §4.3.2's excluded class: a bounded index at its limit while the
        // reaper catches up. The observation is dropped and — critically — this
        // does **not** increment `Π`.
        CurrentEpochValue::set(MAX_XCM_TRAFFIC_EPOCHS_BOUND + 1);
        for epoch in 0..MAX_XCM_TRAFFIC_EPOCHS_BOUND {
            Welfare::note_xcm_traffic(epoch, 0, XcmTrafficKind::Accepted);
        }
        assert_eq!(
            XcmTrafficEpochs::<Test>::get().len(),
            MAX_XCM_TRAFFIC_EPOCHS_BOUND as usize
        );
        CurrentWindowValue::set((MAX_XCM_TRAFFIC_EPOCHS_BOUND, 0));

        Welfare::sample_block_weight();

        assert_eq!(
            Welfare::block_weight_sample(MAX_XCM_TRAFFIC_EPOCHS_BOUND, 0).blocks,
            0
        );
        assert_eq!(
            Welfare::integrity_failures_epoch(MAX_XCM_TRAFFIC_EPOCHS_BOUND),
            0
        );
        assert!(Welfare::do_try_state().is_ok());
    });
}

#[test]
fn a_qualifying_site_increments_the_counter_exactly_once_and_emits() {
    new_test_ext().execute_with(|| {
        frame_system::Pallet::<Test>::set_block_number(1);
        Welfare::note_integrity_failure(3, 5, IntegrityFault::FailStaticLatch);

        assert_eq!(Welfare::integrity_failures(3, 5), 1);
        assert_eq!(Welfare::integrity_failures_epoch(3), 1);
        // Every increment is evented: an integrity failure visible only as a
        // lower welfare score two cranks later is unactionable (12 §6.3).
        assert!(frame_system::Pallet::<Test>::events().iter().any(|record| {
            matches!(
                record.event,
                RuntimeEvent::Welfare(Event::IntegrityFailureRecorded {
                    epoch: 3,
                    day: 5,
                    fault: IntegrityFault::FailStaticLatch,
                    count: 1,
                })
            )
        }));

        // Distinct faults accumulate, and the event carries the running total.
        Welfare::note_integrity_failure(3, 5, IntegrityFault::LostAccounting);
        assert_eq!(Welfare::integrity_failures(3, 5), 2);
        assert!(frame_system::Pallet::<Test>::events().iter().any(|record| {
            matches!(
                record.event,
                RuntimeEvent::Welfare(Event::IntegrityFailureRecorded { count: 2, .. })
            )
        }));
        // Days are isolated, and the epoch total is their sum.
        Welfare::note_integrity_failure(3, 6, IntegrityFault::DiscardedInternalCall);
        assert_eq!(Welfare::integrity_failures(3, 6), 1);
        assert_eq!(Welfare::integrity_failures_epoch(3), 3);
        assert!(Welfare::do_try_state().is_ok());
    });
}

#[test]
fn the_integrity_counter_saturates_rather_than_wrapping() {
    new_test_ext().execute_with(|| {
        Welfare::note_xcm_traffic(3, 5, XcmTrafficKind::Accepted);
        IntegrityFailures::<Test>::insert(3, 5, u32::MAX);
        Welfare::note_integrity_failure(3, 5, IntegrityFault::FailStaticLatch);
        // Wrapping to zero would report a perfectly healthy `Π` out of the
        // worst possible state (G-1).
        assert_eq!(Welfare::integrity_failures(3, 5), u32::MAX);
    });
}

#[test]
fn the_integrity_recorder_drops_the_record_when_the_index_is_full() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(MAX_XCM_TRAFFIC_EPOCHS_BOUND + 1);
        for epoch in 0..MAX_XCM_TRAFFIC_EPOCHS_BOUND {
            Welfare::note_xcm_traffic(epoch, 0, XcmTrafficKind::Accepted);
        }
        Welfare::note_integrity_failure(
            MAX_XCM_TRAFFIC_EPOCHS_BOUND,
            0,
            IntegrityFault::FailStaticLatch,
        );
        // An unindexed counter would be unreachable by the reaper and would
        // depress `Π` for a window nothing can retire.
        assert_eq!(
            Welfare::integrity_failures(MAX_XCM_TRAFFIC_EPOCHS_BOUND, 0),
            0
        );
        assert!(Welfare::do_try_state().is_ok());
    });
}

#[test]
fn the_reaper_retires_both_new_series_with_their_shared_prefix() {
    new_test_ext().execute_with(|| {
        for epoch in [1u32, 2, 3] {
            CurrentWindowValue::set((epoch, 0));
            Welfare::sample_block_weight();
            Welfare::note_integrity_failure(epoch, 1, IntegrityFault::FailStaticLatch);
        }
        assert_eq!(BlockWeightSamples::<Test>::iter().count(), 3);
        assert_eq!(IntegrityFailures::<Test>::iter().count(), 3);

        // Bounded, oldest first: at most `XCM_TRAFFIC_PRUNE_MAX_EPOCHS` per call.
        assert_ok!(Welfare::prune_xcm_traffic(3));
        assert_eq!(BlockWeightSamples::<Test>::iter_prefix(1).count(), 0);
        assert_eq!(BlockWeightSamples::<Test>::iter_prefix(2).count(), 0);
        assert_eq!(IntegrityFailures::<Test>::iter_prefix(1).count(), 0);
        assert_eq!(IntegrityFailures::<Test>::iter_prefix(2).count(), 0);
        assert_eq!(BlockWeightSamples::<Test>::iter_prefix(3).count(), 1);
        assert_eq!(IntegrityFailures::<Test>::iter_prefix(3).count(), 1);
        assert_eq!(XcmTrafficEpochs::<Test>::get().into_inner(), vec![3]);
        assert!(Welfare::do_try_state().is_ok());
    });
}

#[test]
fn try_state_rejects_an_unindexed_or_future_or_empty_series_row() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(5);

        // Unindexed: the bounded reaper could never reach it.
        BlockWeightSamples::<Test>::insert(
            4,
            0,
            BlockWeightSample {
                utilization_sum: 1,
                blocks: 1,
            },
        );
        assert!(Welfare::do_try_state().is_err());
        BlockWeightSamples::<Test>::remove(4, 0);

        IntegrityFailures::<Test>::insert(4, 0, 1);
        assert!(Welfare::do_try_state().is_err());
        IntegrityFailures::<Test>::remove(4, 0);

        // Indexed but in the future: no observation can belong to an epoch the
        // clock has not reached.
        Welfare::note_xcm_traffic(4, 0, XcmTrafficKind::Accepted);
        XcmTrafficEpochs::<Test>::mutate(|epochs| {
            assert!(epochs.try_push(99).is_ok());
        });
        BlockWeightSamples::<Test>::insert(
            99,
            0,
            BlockWeightSample {
                utilization_sum: 1,
                blocks: 1,
            },
        );
        assert!(Welfare::do_try_state().is_err());
        BlockWeightSamples::<Test>::remove(99, 0);
        IntegrityFailures::<Test>::insert(99, 0, 1);
        assert!(Welfare::do_try_state().is_err());
        IntegrityFailures::<Test>::remove(99, 0);
        XcmTrafficEpochs::<Test>::mutate(|epochs| {
            let position = epochs.iter().position(|e| *e == 99).expect("pushed above");
            epochs.remove(position);
        });
        assert!(Welfare::do_try_state().is_ok());

        // A zero block count stored on disk would make "never sampled"
        // indistinguishable from "sampled and idle".
        BlockWeightSamples::<Test>::insert(
            4,
            1,
            BlockWeightSample {
                utilization_sum: 0,
                blocks: 0,
            },
        );
        assert!(Welfare::do_try_state().is_err());
        BlockWeightSamples::<Test>::remove(4, 1);

        // A mean above full utilization can only come from a recorder that
        // skipped the clamp.
        BlockWeightSamples::<Test>::insert(
            4,
            1,
            BlockWeightSample {
                utilization_sum: ONE + 1,
                blocks: 1,
            },
        );
        assert!(Welfare::do_try_state().is_err());
        BlockWeightSamples::<Test>::remove(4, 1);

        IntegrityFailures::<Test>::insert(4, 1, 0);
        assert!(Welfare::do_try_state().is_err());
        IntegrityFailures::<Test>::remove(4, 1);
        assert!(Welfare::do_try_state().is_ok());
    });
}

#[test]
fn the_index_admits_an_epoch_that_only_ever_sampled_block_weight() {
    new_test_ext().execute_with(|| {
        // The first block of a fresh epoch indexes it through the sampler,
        // typically long before any XCM is sent or any probe answered. try-state
        // must accept that state, or every epoch roll would fail it.
        CurrentWindowValue::set((2, 0));
        Welfare::sample_block_weight();
        assert_eq!(XcmTraffic::<Test>::iter_prefix(2).count(), 0);
        assert_eq!(ReserveProbeDaily::<Test>::iter_prefix(2).count(), 0);
        assert!(Welfare::do_try_state().is_ok());
    });
}

/// **Regression (audit 2026-07-27, AUD-4).** 05 §4.6 / I-16 resolve the active
/// spec as "the unique version with the latest activation epoch", and a tie
/// means *no active spec* — permanently, for every epoch from that activation
/// onward. Nothing stopped two lawful `register_spec` calls from creating that
/// tie, and there is no re-derivation path once it exists: `active_snapshot_spec`
/// returns `None` forever, so `note_snapshot_recorded` can never advance
/// `SnapshotDeadline`, the 05 §4.8 dead-man latches on its snapshot-overdue
/// cause, and the deadline's own try-state pairing fails once the wedged epoch's
/// timing is reaped. Admission control keeps the tie unreachable.
#[test]
fn a_second_registration_may_not_tie_the_latest_activation_epoch() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(5);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(specs_activating(2, 9)),
        ));
        // Lawful in every other respect — distinct version, valid lead time,
        // well-formed spec set — and refused solely for the activation tie.
        assert_noop!(
            Welfare::register_spec(
                RuntimeOrigin::signed(governance_acc()),
                3,
                bounded(specs_activating(3, 9)),
            ),
            Error::<Test>::BadActivationEpoch
        );
        // One epoch over is admissible, and the selector stays unambiguous.
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            3,
            bounded(specs_activating(3, 10)),
        ));
        assert_eq!(Welfare::active_snapshot_spec(9), Some(2));
        assert_eq!(Welfare::active_snapshot_spec(10), Some(3));
        assert_eq!(Welfare::active_snapshot_spec(11), Some(3));
    });
}

/// **Regression (audit 2026-07-27, AUD-4, Codex round 2).** Admission control in
/// `register_metric_spec` cannot see a tie that predates it — an upgrading chain
/// carrying two versions registered under the previous runtime, or any raw
/// storage write. `try-state` is what makes activation uniqueness an invariant
/// rather than a property of one code path (15 §1 try-state coverage rule).
#[test]
fn try_state_rejects_a_pre_existing_activation_tie() {
    new_test_ext().execute_with(|| {
        for (version, _) in MetricSpecs::<Test>::iter() {
            MetricSpecs::<Test>::remove(version);
        }
        // Written directly, exactly as an upgrade carrying legacy state would.
        MetricSpecs::<Test>::insert(2, bounded(specs_activating(2, 9)));
        MetricSpecs::<Test>::insert(3, bounded(specs_activating(3, 9)));
        assert!(Welfare::do_try_state().is_err());

        // One epoch apart is lawful and try-state accepts it.
        MetricSpecs::<Test>::insert(3, bounded(specs_activating(3, 10)));
        assert_ok!(Welfare::do_try_state());
    });
}

/// MAX-01 regression. `record_snapshot` validated only that the named version
/// was *activated* by the epoch, which is strictly weaker than the set the
/// epoch can be measured under. Since capacity counts records while eviction
/// is by epoch age, the epoch carries exactly one spare slot — so a signed
/// caller could spend it on a `(epoch, version)` pair no consumer reads, and
/// the deadline-advancing record then failed `TooManySnapshots`.
/// `SnapshotDeadline` stops advancing, the 05 §4.8 dead-man latches, and the
/// frozen clock freezes the prune cutoff that would have released the slot —
/// with no origin able to clear the flag (SQ-254). Fails at baseline: the
/// stale-version call returned `Ok`.
#[test]
fn max01_a_version_no_cohort_froze_cannot_take_a_snapshot_slot() {
    new_test_ext().execute_with(|| {
        // v2 activates at epoch 2, so it is epoch 7's active spec; v1 is the
        // genesis version, activated but superseded.
        CurrentEpochValue::set(0);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(specs_activating(2, 2)),
        ));
        CurrentEpochValue::set(FINALIZED_NOW);
        assert_eq!(Welfare::active_snapshot_spec(7), Some(2));

        // No live cohort froze v1, so a v1 record is work nothing consumes.
        assert_noop!(
            Welfare::record_snapshot(RuntimeOrigin::signed(keeper()), 7, 1),
            Error::<Test>::SpecVersionNotAdmissible
        );
        assert_eq!(Snapshots::<Test>::iter().count(), 0);

        // The deadline-advancing active-version record is unaffected.
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            2,
        ));

        // Once a cohort does freeze v1, the same call is legitimate work.
        FrozenSpecVersions::set(vec![1]);
        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            1,
        ));
        assert_ok!(Welfare::do_try_state());
    });
}

/// MAX-01, second leg: the record bound must hold the retained epoch window at
/// its full per-epoch multiplicity. At the former flat 20 this overflowed the
/// moment two versions were live, which is what made the wedge reachable with
/// one extrinsic. Fails at baseline with `TooManySnapshots`.
///
/// The multiplicity is `horizon_k + 1`, not `horizon_k`. The cohorts measuring
/// epoch `e` were created at `e−1` and `e−2`, so they carry the versions active
/// *then*; a version activating at `e` itself is a lawful third that neither
/// froze, reachable through two ordinary `register_spec` calls activating in
/// consecutive epochs. Sizing at `× horizon_k` would have re-created the same
/// wedge one activation cadence later, so this fills every retained epoch at
/// all three.
#[test]
fn max01_the_retained_window_holds_every_epoch_at_its_full_multiplicity() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        for (version, activation) in [(2, 2), (3, 3)] {
            assert_ok!(Welfare::register_spec(
                RuntimeOrigin::signed(governance_acc()),
                version,
                bounded(specs_activating(version, activation)),
            ));
        }
        CurrentEpochValue::set(FINALIZED_NOW);
        // v3 is every retained epoch's active spec; v1 and v2 are the two
        // cohorts' frozen versions, neither of which is v3.
        assert_eq!(Welfare::active_snapshot_spec(7), Some(3));
        FrozenSpecVersions::set(vec![1, 2]);
        // From epoch 3: v3 activates there, so every epoch in the window has
        // all three admissible.
        for epoch in 3..SNAPSHOT_RETENTION_EPOCHS as u32 + 3 {
            for version in [1, 2, 3] {
                assert_ok!(Welfare::record_snapshot(
                    RuntimeOrigin::signed(keeper()),
                    epoch,
                    version,
                ));
            }
        }
        assert_eq!(
            Snapshots::<Test>::iter().count(),
            SNAPSHOT_RETENTION_EPOCHS * (MAX_CONCURRENT_FROZEN_VERSIONS + 1)
        );
        assert_eq!(Snapshots::<Test>::iter().count(), MAX_SNAPSHOTS);
        assert_ok!(Welfare::do_try_state());
    });
}

/// The admissible set really is the union, not the frozen set: an epoch's own
/// active spec is recordable even when no live cohort froze it. Dropping it
/// from the union is the tempting way to hold the bound at `× horizon_k`, and
/// it is exactly the wedge — `note_snapshot_recorded` advances
/// `SnapshotDeadline` on the active version and on nothing else.
#[test]
fn max01_the_epochs_active_spec_is_admissible_even_if_no_cohort_froze_it() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(specs_activating(2, 2)),
        ));
        CurrentEpochValue::set(FINALIZED_NOW);
        assert_eq!(Welfare::active_snapshot_spec(7), Some(2));
        // Only v1 is frozen by a cohort; v2 is active and frozen by nobody.
        FrozenSpecVersions::set(vec![1]);

        assert_ok!(Welfare::record_snapshot(
            RuntimeOrigin::signed(keeper()),
            7,
            2,
        ));
        assert_ok!(Welfare::do_try_state());
    });
}

/// MAX-08 regression. `GateBreachFlags` is keyed by epoch alone, OR-merged,
/// never cleared, and 05 §4.7 makes it the sole settlement source for gate
/// markets — `gate_window_outcomes` takes no `spec_version`. Accepting any
/// merely *activated* version let a holder of gate-YES positions record one
/// favourable day under whichever of two lawfully registered versions
/// aggregated lower (different `S` component sets, different `C_onchain`
/// renormalization denominators, identical chain state), and the monotone
/// write then settled every cohort whose window contains that epoch —
/// including cohorts frozen at the other version, against I-16. Fails at
/// baseline: the non-active call returned `Ok` and set the breach flags.
#[test]
fn max08_a_daily_gate_is_recordable_only_under_the_epochs_active_spec() {
    new_test_ext().execute_with(|| {
        CurrentEpochValue::set(0);
        assert_ok!(Welfare::register_spec(
            RuntimeOrigin::signed(governance_acc()),
            2,
            bounded(specs_activating(2, 2)),
        ));
        CurrentEpochValue::set(FINALIZED_NOW);
        assert_eq!(Welfare::active_snapshot_spec(7), Some(2));
        // v1 reads breached, v2 reads healthy, from the same chain state.
        DailyInputsByVersion::set(vec![
            (1, components(500_000_000, 500_000_000, ONE, ONE)),
            (2, components(ONE, ONE, ONE, ONE)),
        ]);

        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 7, 0, 1),
            Error::<Test>::SpecVersionNotAdmissible
        );
        assert!(!GateBreachFlags::<Test>::contains_key(7));

        // A cohort having frozen v1 does not widen the gate rule: the flag is
        // version-independent, so it admits exactly one version.
        FrozenSpecVersions::set(vec![1]);
        assert_noop!(
            Welfare::record_daily_gate(RuntimeOrigin::signed(keeper()), 7, 0, 1),
            Error::<Test>::SpecVersionNotAdmissible
        );

        assert_ok!(Welfare::record_daily_gate(
            RuntimeOrigin::signed(keeper()),
            7,
            0,
            2,
        ));
        let flags = GateBreachFlags::<Test>::get(7).expect("recorded under the active spec");
        assert!(!flags.s_breached && !flags.c_breached);
        assert_ok!(Welfare::do_try_state());
    });
}
