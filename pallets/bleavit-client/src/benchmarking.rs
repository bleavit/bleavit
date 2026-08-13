//! `frame-benchmarking` v2 harness for the drop-in client pallet.

use super::*;
use frame_benchmarking::v2::*;
use futarchy_primitives::{FixedU64, SettlementTrust};

fn report<T: Config>(question_id: u64) -> ReportView {
    ReportView {
        question_id,
        client_id: T::ClientId::get(),
        sub_id: [u8::MAX; 32],
        twap_accept_1e9: FixedU64(u64::MAX),
        twap_reject_1e9: FixedU64(u64::MAX),
        observations: u32::MAX,
        window_start: u32::MAX,
        window_end: u32::MAX,
        b_accept: u128::MAX,
        b_reject: u128::MAX,
        manip_floor: u128::MAX,
        declared_stake: u128::MAX,
        epsilon_1e9: FixedU64(u64::MAX),
        tolerance_1e9: FixedU64(u64::MAX),
        certified: true,
        settlement_trust: SettlementTrust {
            attestors: u32::MAX,
            quorum: u32::MAX,
            bond_total: u128::MAX,
        },
        provenance_hash: [u8::MAX; 32],
    }
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    /// The pruning call scans the complete retained map even when only a
    /// prefix is eligible. Populate and remove every row so both the iterator
    /// proof slope and CountedStorageMap counter-write slope are measured.
    #[benchmark]
    fn prune_reports(r: Linear<1, { T::MaxReports::get() }>) {
        for question_id in 1..=u64::from(r) {
            Reports::<T>::insert(question_id, report::<T>(question_id));
        }
        let origin = T::ReportPruneOrigin::try_successful_origin()
            .expect("benchmark ReportPruneOrigin exists");

        #[extrinsic_call]
        _(origin, u64::MAX);

        assert_eq!(Reports::<T>::count(), 0);
        assert_eq!(ReportsPrunedThrough::<T>::get(), u64::MAX);
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
