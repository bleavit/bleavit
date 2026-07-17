//! `frame-benchmarking` v2 coverage for every execution-guard dispatchable (15 §4.5).
//! B5 replaces the hand-seeded weights after assembled-runtime PoV calibration.

use super::*;
use crate::pallet::{Pallet, PendingUpgrade, Queue, Ratifications};
use frame_benchmarking::v2::*;
use frame_system::RawOrigin;

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn execute() {
        let pid = 1;
        T::BenchmarkHelper::prime_execute(pid);
        let caller: T::AccountId = whitelisted_caller();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), pid);

        assert!(!Queue::<T>::contains_key(pid));
    }

    #[benchmark]
    fn apply_authorized_upgrade() -> Result<(), BenchmarkError> {
        let bytes = b"benchmark-runtime-v2".to_vec();
        T::BenchmarkHelper::prime_pending_upgrade(&bytes);
        let code = RuntimeCode::<T>::try_from(bytes)
            .map_err(|_| BenchmarkError::Stop("benchmark runtime exceeded payload bound"))?;
        let caller: T::AccountId = whitelisted_caller();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), code);

        // The extrinsic schedules the candidate with parachain-system. The
        // guard record is cleared only at relay `GoAhead`, through the
        // assembled runtime's `OnSystemEvent` callback.
        assert!(PendingUpgrade::<T>::get().is_some());
        Ok(())
    }

    #[benchmark]
    fn expire_failed_execution() {
        let pid = 1;
        T::BenchmarkHelper::prime_failed(pid);
        let caller: T::AccountId = whitelisted_caller();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), pid);

        assert!(!Queue::<T>::contains_key(pid));
    }

    #[benchmark]
    fn ratify() {
        let pid = 1;
        let referendum_index = 9;
        T::BenchmarkHelper::prime_ratify(pid, referendum_index);
        let origin = T::BenchmarkHelper::ratify_origin();

        #[extrinsic_call]
        _(origin as T::RuntimeOrigin, pid, referendum_index);

        assert_eq!(
            Ratifications::<T>::get(pid).map(|record| record.referendum_index),
            Some(referendum_index)
        );
    }

    #[benchmark]
    fn reject_stale() {
        let pid = 1;
        T::BenchmarkHelper::prime_stale(pid);
        let caller: T::AccountId = whitelisted_caller();

        #[extrinsic_call]
        _(RawOrigin::Signed(caller), pid);

        assert!(!Queue::<T>::contains_key(pid));
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
