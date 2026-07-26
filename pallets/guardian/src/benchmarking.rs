//! `frame-benchmarking` v2 benchmarks for every extrinsic and the maintenance
//! hook (Track-A DoD, 15 §4.5). B5 turns the generated output into the
//! PoV-calibrated `weights.rs`; the harness + worst-case setup are the milestone.

use super::*;
use crate::pallet::{
    ActivePlaybooks, Approvals, FailedAction, FailedActions, Members, NextActionId, PendingActions,
    RerunUsed, ReviewDeadlines, ReviewReferenda, VetoReviewReferenda,
};

use frame_benchmarking::v2::*;
use frame_support::traits::{
    fungible::{Mutate, MutateHold},
    OnInitialize,
};
use futarchy_primitives::H256;

/// A distinct member account by index (matches the genesis council).
fn member<T: Config>(i: u8) -> T::AccountId {
    T::AccountId::from([i + 1; 32])
}

/// Install the seven-seat council and return it.
fn seed_council<T: Config>() -> [T::AccountId; GUARDIAN_SEATS] {
    let members: [T::AccountId; GUARDIAN_SEATS] = core::array::from_fn(|i| member::<T>(i as u8));
    let raw = Pallet::<T>::members_to_core(&members);
    let reason: T::RuntimeHoldReason = HoldReason::SeatBond.into();
    for who in &members {
        T::Currency::mint_into(who, GUARDIAN_BOND.saturating_mul(2)).expect("benchmark mint");
        T::Currency::hold(&reason, who, GUARDIAN_BOND).expect("benchmark seat hold");
    }
    Members::<T>::put(raw.map(Some));
    crate::pallet::MemberBonds::<T>::put([GUARDIAN_BOND; GUARDIAN_SEATS]);
    members
}

/// Drive a `ForceRerun` action to four approvals (proposer + three), leaving the
/// fifth for the measured call.
fn action_at_four<T: Config>(power: GuardianPower) -> ActionId {
    T::BenchmarkHelper::prime_for_worst_case();
    Pallet::<T>::propose_action(T::BenchmarkHelper::signed([1; 32]), power, H256::default())
        .expect("propose");
    let id = 0;
    for i in 1..4u8 {
        Pallet::<T>::approve_action(T::BenchmarkHelper::signed([i + 1; 32]), id).expect("approve");
    }
    id
}

/// Drive one action all the way to dispatch and return its id, so a fixture can
/// build a *batch* of genuinely settleable reviews rather than one (SQ-500).
///
/// Unlike [`action_at_four`] this reads the id from [`NextActionId`] instead of
/// assuming 0, and spends the fifth approval itself. `SuspendOnGate` is the power
/// used because it carries no per-epoch allowance, so the same council can drive
/// it as many times as the fixture needs.
fn dispatch_suspend_on_gate<T: Config>() -> Result<ActionId, BenchmarkError> {
    let id = NextActionId::<T>::get();
    Pallet::<T>::propose_action(
        T::BenchmarkHelper::signed([1; 32]),
        GuardianPower::SuspendOnGate,
        H256::default(),
    )
    .map_err(|_| BenchmarkError::Stop("propose"))?;
    for i in 1..GUARDIAN_THRESHOLD {
        Pallet::<T>::approve_action(T::BenchmarkHelper::signed([i + 1; 32]), id)
            .map_err(|_| BenchmarkError::Stop("approve"))?;
    }
    Ok(id)
}

fn pending(id: ActionId, dispatched: bool) -> PendingAction {
    PendingAction {
        id,
        proposer: [1; 32],
        power: GuardianPower::SuspendOnGate,
        justification_hash: H256::default(),
        created_at: 0,
        expires_at: ACTION_EXPIRY_BLOCKS,
        dispatched,
    }
}

fn fill_pending_with_five<T: Config>(start: ActionId) {
    // Five approvals dispatch an action; the core rejects every later approval.
    // Thus 64 dispatched-but-not-yet-reaped actions x five approvals is the
    // largest reachable live approval ledger (320 entries).
    let members = [[1; 32], [2; 32], [3; 32], [4; 32], [5; 32]];
    PendingActions::<T>::mutate(|actions| {
        for id in start..MAX_PENDING_ACTIONS {
            actions.try_push(pending(id, true)).expect("pending bound");
        }
    });
    Approvals::<T>::mutate(|approvals| {
        for id in start..MAX_PENDING_ACTIONS {
            for who in members {
                approvals.try_push((id, who)).expect("approval bound");
            }
        }
    });
    NextActionId::<T>::put(MAX_PENDING_ACTIONS);
}

fn review(action_id: ActionId, deadline_epoch: EpochId) -> ReviewRecord {
    ReviewRecord {
        action_id,
        deadline_epoch,
        ratified: false,
        recall_scheduled: false,
        approvers: [
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [0; 32], [0; 32],
        ],
        approver_count: GUARDIAN_THRESHOLD,
    }
}

fn fill_reviews<T: Config>(target_len: u32) {
    ReviewDeadlines::<T>::mutate(|reviews| {
        while reviews.len() < target_len as usize {
            let id = 1_000u32.saturating_add(reviews.len() as u32);
            reviews.try_push(review(id, 0)).expect("review bound");
        }
    });
}

fn fill_reruns<T: Config>(target_len: u32) {
    RerunUsed::<T>::mutate(|reruns| {
        while reruns.len() < target_len as usize {
            reruns
                .try_push(10_000u64.saturating_add(reruns.len() as u64))
                .expect("rerun bound");
        }
    });
}

fn fill_playbooks<T: Config>(expiry: u32) {
    let ids = [
        PlaybookId::Depeg,
        PlaybookId::Migration,
        PlaybookId::OracleVoid,
        PlaybookId::HaltIntake,
        PlaybookId::Reserve,
        PlaybookId::LedgerFreeze,
    ];
    ActivePlaybooks::<T>::mutate(|playbooks| {
        for id in ids {
            if !playbooks.iter().any(|playbook| playbook.id == id) {
                playbooks
                    .try_push(ActivePlaybook {
                        id,
                        expiry,
                        renewals_used: 0,
                    })
                    .expect("playbook bound");
            }
        }
    });
}

fn fill_read_collections<T: Config>() {
    fill_reviews::<T>(MAX_REVIEWS);
    fill_playbooks::<T>(ACTION_EXPIRY_BLOCKS);
    fill_reruns::<T>(MAX_RERUN_USED);
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn set_members() {
        seed_council::<T>();
        fill_pending_with_five::<T>(0);
        fill_read_collections::<T>();
        let members: [T::AccountId; GUARDIAN_SEATS] =
            core::array::from_fn(|i| member::<T>((i as u8) + 10));
        for who in &members {
            T::Currency::mint_into(who, GUARDIAN_BOND.saturating_mul(2)).expect("benchmark mint");
        }

        #[extrinsic_call]
        _(T::BenchmarkHelper::values() as T::RuntimeOrigin, members);

        assert!(Members::<T>::get().is_some());
    }

    #[benchmark]
    fn propose_action() {
        seed_council::<T>();
        T::BenchmarkHelper::prime_for_worst_case();
        fill_pending_with_five::<T>(0);
        // Leave one pending slot for the measured proposal.
        PendingActions::<T>::mutate(|actions| {
            let _ = actions.pop();
        });
        Approvals::<T>::mutate(|approvals| {
            approvals.retain(|(id, _)| *id < MAX_PENDING_ACTIONS - 1);
        });
        NextActionId::<T>::put(MAX_PENDING_ACTIONS - 1);
        fill_read_collections::<T>();

        #[extrinsic_call]
        _(
            T::BenchmarkHelper::signed([1; 32]),
            GuardianPower::SuspendOnGate,
            H256::default(),
        );

        assert_eq!(
            PendingActions::<T>::get().len(),
            MAX_PENDING_ACTIONS as usize
        );
    }

    #[benchmark]
    fn approve_action() {
        seed_council::<T>();
        let id = action_at_four::<T>(GuardianPower::DelayOnce { pid: 1 });
        fill_pending_with_five::<T>(1);
        fill_reviews::<T>(MAX_REVIEWS - 1);
        fill_playbooks::<T>(ACTION_EXPIRY_BLOCKS);
        fill_reruns::<T>(MAX_RERUN_USED - 1);

        #[extrinsic_call]
        _(T::BenchmarkHelper::signed([5; 32]), id);

        // The fifth approval dispatched the action and scheduled its review.
        assert_eq!(ReviewDeadlines::<T>::get().len(), MAX_REVIEWS as usize);
    }

    #[benchmark]
    fn ratify_action() {
        seed_council::<T>();
        let id = action_at_four::<T>(GuardianPower::DelayOnce { pid: 1 });
        Pallet::<T>::approve_action(T::BenchmarkHelper::signed([5; 32]), id).expect("dispatch");
        let referendum = ReviewReferenda::<T>::get(id).expect("review referendum");
        T::BenchmarkHelper::close_review(referendum).expect("close review");
        fill_pending_with_five::<T>(1);
        fill_reviews::<T>(MAX_REVIEWS);
        fill_playbooks::<T>(ACTION_EXPIRY_BLOCKS);
        fill_reruns::<T>(MAX_RERUN_USED);

        #[extrinsic_call]
        _(T::BenchmarkHelper::values() as T::RuntimeOrigin, id);

        assert!(ReviewDeadlines::<T>::get().iter().any(|r| r.ratified));
    }

    #[benchmark]
    fn renew_playbook() {
        seed_council::<T>();
        T::BenchmarkHelper::prime_for_worst_case();
        let power = GuardianPower::ActivatePlaybook {
            id: PlaybookId::LedgerFreeze,
            trigger: PlaybookTrigger::LedgerDrift,
            expiry: 100,
            target: None,
        };
        Pallet::<T>::propose_action(T::BenchmarkHelper::signed([1; 32]), power, H256::default())
            .expect("propose");
        for i in 1..5u8 {
            Pallet::<T>::approve_action(T::BenchmarkHelper::signed([i + 1; 32]), 0)
                .expect("approve");
        }
        fill_pending_with_five::<T>(1);
        fill_reviews::<T>(MAX_REVIEWS);
        fill_playbooks::<T>(100);
        fill_reruns::<T>(MAX_RERUN_USED);

        #[extrinsic_call]
        _(
            T::BenchmarkHelper::values() as T::RuntimeOrigin,
            PlaybookId::LedgerFreeze,
        );

        assert!(ActivePlaybooks::<T>::get()
            .iter()
            .any(|p| p.id == PlaybookId::LedgerFreeze && p.renewals_used == 1));
    }

    #[benchmark]
    fn uphold_veto() -> Result<(), BenchmarkError> {
        seed_council::<T>();
        let id = action_at_four::<T>(GuardianPower::DelayOnce { pid: 1 });
        Pallet::<T>::approve_action(T::BenchmarkHelper::signed([5; 32]), id)
            .map_err(|_| BenchmarkError::Stop("dispatch"))?;
        let referendum = VetoReviewReferenda::<T>::get(id)
            .ok_or(BenchmarkError::Stop("veto review referendum"))?;
        T::BenchmarkHelper::close_review(referendum)
            .map_err(|_| BenchmarkError::Stop("close review"))?;

        #[extrinsic_call]
        _(T::BenchmarkHelper::values() as T::RuntimeOrigin, id);

        assert!(ReviewDeadlines::<T>::get().iter().any(|r| r.ratified));
        Ok(())
    }

    #[benchmark]
    fn recall() {
        seed_council::<T>();
        let approvers = [
            [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [0; 32], [0; 32],
        ];
        FailedActions::<T>::insert(
            0,
            FailedAction {
                approvers,
                approver_count: GUARDIAN_THRESHOLD,
                failed_epoch: 0,
                recall_referendum: None,
            },
        );

        #[extrinsic_call]
        _(T::BenchmarkHelper::values() as T::RuntimeOrigin, 0);

        assert_eq!(
            Members::<T>::get()
                .expect("seeded council")
                .iter()
                .filter(|member| member.is_some())
                .count(),
            GUARDIAN_SEATS - usize::from(GUARDIAN_THRESHOLD)
        );
    }

    #[benchmark]
    fn set_playbook_registered() {
        #[extrinsic_call]
        _(
            T::BenchmarkHelper::admin() as T::RuntimeOrigin,
            PlaybookId::Depeg,
            false,
        );

        assert!(!crate::pallet::PlaybookRegistered::<T>::get(
            PlaybookId::Depeg
        ));
    }

    /// The mandatory maintenance hook at its **bounded** worst case (SQ-500):
    /// a saturated settle batch, a saturated reap batch, and every other bounded
    /// collection full.
    ///
    /// The batch is what makes this hook's weight finite, so the fixture must
    /// actually saturate it. The pre-SQ-500 fixture did not: it filled
    /// `ReviewDeadlines` to `MAX_REVIEWS` but set `ratified = true` on every
    /// filler, which the overdue filter excludes, so it measured **one** settle
    /// and its comment justified that by calling 128 simultaneous failures
    /// unreachable. They are reachable — reviews created in one epoch share one
    /// deadline — which is the defect SQ-500 records. What the bound changes is
    /// that the hook now settles at most `GUARDIAN_MAINTENANCE_BATCH` of them per
    /// block and carries the rest, so *that* is the worst case to measure.
    #[benchmark]
    fn on_initialize() -> Result<(), BenchmarkError> {
        seed_council::<T>();
        T::BenchmarkHelper::prime_for_worst_case();
        // A full settle batch. `SuspendOnGate` is used (rather than a delayed
        // action) so the benchmark exercises the full terminal reap path: a
        // delayed action intentionally retains its veto referendum until T12
        // (SQ-311) and is covered by pallet tests.
        let mut overdue = alloc::vec::Vec::new();
        for _ in 0..GUARDIAN_MAINTENANCE_BATCH {
            overdue.push(dispatch_suspend_on_gate::<T>()?);
        }
        let first = *overdue.first().ok_or(BenchmarkError::Stop("empty batch"))?;
        let deadline = ReviewDeadlines::<T>::get()
            .iter()
            .find(|review| review.action_id == first)
            .map(|review| review.deadline_epoch)
            .ok_or(BenchmarkError::Stop("overdue review deadline"))?;
        // Past both horizons at once: the review deadline, and the four-epoch
        // retention that makes the seeded `FailedActions` rows reapable — the
        // reap sweep is the hook's other bounded batch and must also saturate.
        T::BenchmarkHelper::prime_maintenance_epoch(deadline.saturating_add(1).max(4));
        let approvers = [[1; 32], [2; 32], [3; 32], [4; 32], [5; 32]];
        let dispatched = NextActionId::<T>::get();
        PendingActions::<T>::mutate(|actions| {
            for id in dispatched..MAX_PENDING_ACTIONS {
                actions.try_push(pending(id, true)).expect("pending bound");
            }
        });
        Approvals::<T>::mutate(|approvals| {
            while approvals.len() < MAX_APPROVALS as usize {
                let id = (approvals.len() as u32 / GUARDIAN_SEATS as u32)
                    .saturating_add(MAX_PENDING_ACTIONS);
                let who = approvers[approvals.len() % approvers.len()];
                approvals.try_push((id, who)).expect("approval bound");
            }
        });
        // The reviews behind the batch: real records the hook must *skip* this
        // block because the bound is already spent. They are what proves the
        // measured weight does not grow with the backlog.
        ReviewDeadlines::<T>::mutate(|reviews| {
            while reviews.len() < MAX_REVIEWS as usize {
                let id = 1_000u32.saturating_add(reviews.len() as u32);
                reviews.try_push(review(id, 0)).expect("review bound");
            }
        });
        // A saturated reap batch too, leaving exactly enough headroom under
        // `MAX_FAILED_ACTIONS` for this block's settles to insert their records
        // (`settle_failed_review` fails closed at the ceiling).
        for id in 0..MAX_FAILED_ACTIONS.saturating_sub(GUARDIAN_MAINTENANCE_BATCH) {
            FailedActions::<T>::insert(
                20_000u32.saturating_add(id),
                FailedAction {
                    approvers: [
                        [1; 32], [2; 32], [3; 32], [4; 32], [5; 32], [0; 32], [0; 32],
                    ],
                    approver_count: GUARDIAN_THRESHOLD,
                    failed_epoch: 0,
                    recall_referendum: None,
                },
            );
        }
        fill_playbooks::<T>(0);
        ActivePlaybooks::<T>::mutate(|playbooks| {
            let ledger = playbooks
                .iter_mut()
                .find(|playbook| playbook.id == PlaybookId::LedgerFreeze)
                .expect("ledger freeze fixture exists");
            ledger.expiry = u32::MAX;
        });
        fill_reruns::<T>(MAX_RERUN_USED);
        NextActionId::<T>::put(MAX_PENDING_ACTIONS);

        #[block]
        {
            Pallet::<T>::on_initialize(frame_system::Pallet::<T>::block_number());
        }

        assert_eq!(ActivePlaybooks::<T>::get().len(), 1);
        assert_eq!(ActivePlaybooks::<T>::get()[0].id, PlaybookId::LedgerFreeze);
        // Every review in the batch settled — the failure mode this fixture
        // exists to exclude is measuring fewer (SQ-490's lesson: a fixture that
        // never reaches the work reports a plausible small number).
        let mut recalls = 0u32;
        for action in &overdue {
            let failed = FailedActions::<T>::get(action).expect("batch review settled");
            recalls = recalls.saturating_add(u32::from(failed.recall_referendum.is_some()));
            assert!(!ReviewReferenda::<T>::contains_key(action));
            assert!(!VetoReviewReferenda::<T>::contains_key(action));
        }
        // At least one settle took the *expensive* branch — scheduling a recall
        // referendum (preimage + submit + decision deposit + transfer). Not every
        // one can, and that is a property of the system rather than of the
        // fixture: a recall is funded from the slash pool, a seat's 50,000 VIT
        // bond absorbs exactly two 50 % slashes, and a settle draws from five
        // approvers at once — so a fresh council's 350,000 VIT of bonded capital
        // funds the first two settles of a batch and no more. Asserting all ten
        // would only be satisfiable by seeding bond capital the chain cannot
        // hold, which inflates a *mandatory* per-block charge with unreachable
        // state.
        assert!(recalls > 0);
        // ... and the backlog behind it did not, so the bound really bounds.
        assert!(!ReviewDeadlines::<T>::get().is_empty());
        // The reap sweep ran a full batch as well.
        assert_eq!(
            FailedActions::<T>::count(),
            MAX_FAILED_ACTIONS.saturating_sub(GUARDIAN_MAINTENANCE_BATCH),
        );
        assert!(
            crate::pallet::MemberBonds::<T>::get()[..usize::from(GUARDIAN_THRESHOLD)]
                .iter()
                .all(|bond| *bond < GUARDIAN_BOND)
        );
        Ok(())
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext_empty(), crate::mock::Test);
}
