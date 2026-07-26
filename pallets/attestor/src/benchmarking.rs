//! `frame-benchmarking` v2 benchmarks for every attestor extrinsic (Track-A
//! DoD, 15 §4.5). B5 recalibrates the placeholder weights from this harness.

use super::*;
// `Vec` is not in the no_std prelude — the runtime's wasm `runtime-benchmarks`
// build compiles this file `no_std`, unlike the std-only pallet gate (B1a).
use crate::pallet::{Attestations, Liabilities, Members, NextAttestationId, Revocations};
use alloc::vec::Vec;
use frame_benchmarking::v2::*;
use frame_support::BoundedVec;

fn member<T: Config>(i: u8) -> T::AccountId {
    T::AccountId::from([i + 1; 32])
}

fn seed_members<T: Config>() {
    let members = (0..MAX_ATTESTORS)
        .map(|i| AttestorInfo {
            account: [i as u8 + 1; 32],
            bond: ATTESTOR_BOND,
            false_count: 0,
            active: true,
        })
        .collect::<Vec<_>>();
    Members::<T>::put(BoundedVec::truncate_from(members));
}

/// Fill the flat ledger, returning the final id. The measured call therefore
/// scans a worst-case bounded vector.
fn seed_attestations<T: Config>(count: u32, open_last: bool) -> AttestationId {
    seed_members::<T>();
    let mut attestations = Vec::new();
    for id in 0..count {
        let challenge = if open_last && id + 1 == count {
            Some(ChallengeStatus::Open {
                challenger: [250; 32],
                evidence_hash: [9; 32],
                bond: CHALLENGE_BOND,
            })
        } else {
            None
        };
        attestations.push(Attestation {
            id,
            pid: id as futarchy_primitives::ProposalId,
            artifact_hash: [id as u8; 32],
            statement_hash: [7; 32],
            attestor: [1; 32],
            submitted_at: 0,
            challenge_deadline: CHALLENGE_WINDOW_BLOCKS,
            challenge,
        });
    }
    Attestations::<T>::put(BoundedVec::truncate_from(attestations));
    NextAttestationId::<T>::put(count);
    count.saturating_sub(1)
}

/// The liability record `remove_for_cause`/`reap_attestation` dispose of, held
/// against the bond `prime_funds` already placed for the first members.
fn seed_liability<T: Config>(who: CoreAccountId) {
    Liabilities::<T>::put(BoundedVec::truncate_from(alloc::vec![AttestorLiability {
        account: who,
        bond: ATTESTOR_BOND,
        false_count: 0,
        ejected: true,
    }]));
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn set_members() {
        T::BenchmarkHelper::prime_funds();
        // Worst case for the SQ-262 unsettled-liability scan. Since `load`
        // (`pallets/attestor/src/lib.rs`) rebuilds the core registry from
        // `Members` *and* `Attestations`, and the core `set_members` runs one
        // `has_unsettled_liability` scan per **departing** member over the whole
        // flat ledger, the measured worst case is O(MAX_ATTESTORS ×
        // MAX_ATTESTATIONS) = 16 × 256. The empty-registry fixture this replaced
        // never read `Attestations` at all (load short-circuits on empty
        // `Members`), so the generated weight undercharged the scan and the full
        // ledger read/write (Finding 1; R-7).
        //
        // Construction, all three properties needed simultaneously:
        //  * a FULL previous roster (16), so every departing member is scanned;
        //  * a FULL ledger (256), so each scan is as long as possible;
        //  * a NEW roster DISJOINT from the previous one, so no member is
        //    re-seated and skipped — all 16 are rescanned.
        // The sole unsettled record is placed LAST and owned by a departing
        // member: `has_unsettled_liability` therefore traverses the entire 256
        // for that member before returning (no early `any()` exit), and the
        // member is moved to an independent liability row. The other 255 records
        // are owned by a non-member sentinel, so every member's scan runs to the
        // end. Attributing the unsettled record early, or spreading it across
        // members, would let `any()` short-circuit and measure a *smaller* scan
        // — see the `worst_case_liability_scan_stays_within_bound` core test.
        seed_members::<T>(); // previous roster: [1; 32]..=[16; 32]

        const SENTINEL: futarchy_primitives::AccountId = [180; 32];
        let mut attestations = Vec::new();
        for id in 0..MAX_ATTESTATIONS - 1 {
            attestations.push(Attestation {
                id,
                pid: id as futarchy_primitives::ProposalId,
                artifact_hash: [id as u8; 32],
                statement_hash: [7; 32],
                attestor: SENTINEL,
                submitted_at: 0,
                challenge_deadline: CHALLENGE_WINDOW_BLOCKS,
                challenge: None,
            });
        }
        // The one unsettled-liability record: owned by departing member [1; 32],
        // challenge `Open` (unsettled regardless of the benchmark block), last.
        attestations.push(Attestation {
            id: MAX_ATTESTATIONS - 1,
            pid: (MAX_ATTESTATIONS - 1) as futarchy_primitives::ProposalId,
            artifact_hash: [255; 32],
            statement_hash: [7; 32],
            attestor: [1; 32],
            submitted_at: 0,
            challenge_deadline: CHALLENGE_WINDOW_BLOCKS,
            challenge: Some(ChallengeStatus::Open {
                challenger: [250; 32],
                evidence_hash: [9; 32],
                bond: CHALLENGE_BOND,
            }),
        });
        Attestations::<T>::put(BoundedVec::truncate_from(attestations));
        NextAttestationId::<T>::put(MAX_ATTESTATIONS);

        // 16 fresh members disjoint from the previous roster and the sentinel;
        // the independent liability remains outside the replacement roster.
        let members = (0..MAX_ATTESTORS)
            .map(|i| member::<T>((i + 17) as u8))
            .collect::<Vec<_>>();

        #[extrinsic_call]
        _(T::BenchmarkHelper::values() as T::RuntimeOrigin, members);

        // 15 new + 1 liable departing member = full bound.
        assert_eq!(Members::<T>::get().len(), MAX_ATTESTORS as usize);
    }

    #[benchmark]
    fn attest() {
        seed_attestations::<T>(MAX_ATTESTATIONS - 1, false);

        #[extrinsic_call]
        _(
            T::BenchmarkHelper::signed([1; 32]),
            MAX_ATTESTATIONS as futarchy_primitives::ProposalId,
            [250; 32],
            [251; 32],
        );

        assert_eq!(Attestations::<T>::get().len(), MAX_ATTESTATIONS as usize);
    }

    #[benchmark]
    fn challenge_attestation() {
        T::BenchmarkHelper::prime_funds();
        let id = seed_attestations::<T>(MAX_ATTESTATIONS, false);

        #[extrinsic_call]
        _(
            T::BenchmarkHelper::signed([250; 32]),
            id,
            [9; 32],
            CHALLENGE_BOND,
        );

        assert!(matches!(
            Attestations::<T>::get()[id as usize].challenge,
            Some(ChallengeStatus::Open { .. })
        ));
    }

    #[benchmark]
    fn resolve_challenge() {
        T::BenchmarkHelper::prime_funds();
        let id = seed_attestations::<T>(MAX_ATTESTATIONS, true);

        #[extrinsic_call]
        _(T::BenchmarkHelper::ratify() as T::RuntimeOrigin, id, false);

        assert!(matches!(
            Attestations::<T>::get()[id as usize].challenge,
            Some(ChallengeStatus::Rejected)
        ));
    }

    /// 06 §7 cause-based removal. Worst case is a member holding the **whole**
    /// ledger: every one of its `MAX_ATTESTATIONS` records is revocable (no
    /// proposal reads executed, none already rejected or revoked), so the call
    /// pays a full revocation push per record — and then, finding no retained
    /// record, disposes of the liability and releases the bond, which is the
    /// dearer of the two exits.
    #[benchmark]
    fn remove_for_cause() {
        T::BenchmarkHelper::prime_funds();
        seed_attestations::<T>(MAX_ATTESTATIONS, false);

        #[extrinsic_call]
        _(
            T::BenchmarkHelper::values() as T::RuntimeOrigin,
            T::AccountId::from([1; 32]),
            [3; 32],
        );

        // The whole ledger belonged to `[1; 32]`, so every record is revoked —
        // proving the scan ran rather than short-circuiting on the first entry.
        assert_eq!(Revocations::<T>::get().len(), MAX_ATTESTATIONS as usize);
        assert!(Members::<T>::get()
            .iter()
            .all(|member| member.account != [1; 32]));
        // The call itself records the ejected member's liability, and the
        // revocations it just wrote are retained records — so the bond stays held
        // rather than taking the release arm. Pre-seeding a liability here would
        // duplicate the one the call creates.
        assert_eq!(Liabilities::<T>::get().len(), 1);
    }

    /// Permissionless reaping (`ensure_signed`), so its weight is a
    /// block-capacity surface (R-7). Worst case: the reaped attestation is the
    /// **last** entry of a full ledger — the `position` scan and the two
    /// "still present?" scans all run to the end — it carries a resolved
    /// challenge so the deadline test is skipped, and its attestor holds nothing
    /// else, so the call also removes the liability and releases the bond.
    #[benchmark]
    fn reap_attestation() {
        T::BenchmarkHelper::prime_funds();
        seed_members::<T>();
        let last = MAX_ATTESTATIONS - 1;
        let mut attestations = Vec::new();
        for id in 0..MAX_ATTESTATIONS {
            attestations.push(Attestation {
                id,
                pid: id as futarchy_primitives::ProposalId,
                artifact_hash: [id as u8; 32],
                statement_hash: [7; 32],
                // Every other record belongs to a different attestor, so the
                // two `any` scans traverse the full vector before answering no.
                attestor: if id == last { [1; 32] } else { [2; 32] },
                submitted_at: 0,
                challenge_deadline: CHALLENGE_WINDOW_BLOCKS,
                challenge: Some(ChallengeStatus::Rejected),
            });
        }
        Attestations::<T>::put(BoundedVec::truncate_from(attestations));
        NextAttestationId::<T>::put(MAX_ATTESTATIONS);

        // Saturate `Revocations` too. `reap_attestation` runs `retain` across the
        // whole vector and then scans it a second time for the reaped attestor, and
        // the registry is one aggregate, so a full vector also costs a decode and a
        // re-encode. Leaving it empty made all of that free and understated a
        // permissionless extrinsic — the fixture-instead-of-work shape this whole
        // row exists to remove (Codex review of #180, P1).
        //
        // `try_state` requires every revocation to match a live attestation on
        // (id, pid, attestor), so the valid maximum is exactly one per attestation,
        // which is also the storage bound. The target's own revocation goes FIRST so
        // `retain` shifts the remaining 255 entries, and it is the only one owned by
        // the reaped attestor — `retain` drops it before the `still_present` scan
        // runs, so the liability-release arm is still the arm being measured.
        let mut revocations = Vec::with_capacity(MAX_ATTESTATIONS as usize);
        revocations.push(AttestationRevocation {
            attestation_id: last,
            pid: last as futarchy_primitives::ProposalId,
            attestor: [1; 32],
            cause_hash: [9; 32],
        });
        revocations.extend((0..last).map(|id| AttestationRevocation {
            attestation_id: id,
            pid: id as futarchy_primitives::ProposalId,
            attestor: [2; 32],
            cause_hash: [9; 32],
        }));
        assert_eq!(revocations.len(), MAX_ATTESTATIONS as usize);
        Revocations::<T>::put(BoundedVec::truncate_from(revocations));

        seed_liability::<T>([1; 32]);
        T::BenchmarkHelper::prime_terminal_proposal(last as futarchy_primitives::ProposalId);

        #[extrinsic_call]
        _(T::BenchmarkHelper::signed([250; 32]), last);

        assert_eq!(
            Attestations::<T>::get().len(),
            MAX_ATTESTATIONS as usize - 1
        );
        // The reaped attestation's revocation went with it, which proves `retain`
        // actually traversed and rewrote the saturated vector rather than
        // short-circuiting on an empty one.
        assert_eq!(Revocations::<T>::get().len(), MAX_ATTESTATIONS as usize - 1);
        // Its attestor held nothing else, so the liability was disposed of —
        // the arm that also releases the bond.
        assert!(Liabilities::<T>::get().is_empty());
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext_empty(), crate::mock::Test);
}
