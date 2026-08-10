//! `frame-benchmarking` v2 harness for the trading-reward dispatchables
//! (15 §4.5). Every call is benchmarked; TR4's per-fill observer enters the
//! *trade's* weight and is benchmarked there, per 08 §2.6's accepted costs.

use super::*;
use crate::pallet::{ParticipantCount, Participants, TotalAccrued};
use frame_benchmarking::v2::*;
use frame_system::RawOrigin;

/// One whole USDC — comfortably above the frozen 0.1 USDC `ledger.pos_dep`.
const BENCHMARK_BOND: Balance = futarchy_primitives::currency::USDC;
/// The 13 §1 placeholder reference, 0.05 USDC/VIT, as its `FixedU64` integer.
const BENCHMARK_VIT_RATE: u64 = 50_000_000;

fn participant<T: Config>() -> T::AccountId {
    let who: T::AccountId = whitelisted_caller();
    T::BenchmarkHelper::prime_usdc(&who, BENCHMARK_BOND.saturating_mul(4));
    who
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn enroll() {
        let who = participant::<T>();

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()), BENCHMARK_BOND);

        assert!(Participants::<T>::contains_key(&who));
    }

    #[benchmark]
    fn top_up_bond() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()), BENCHMARK_BOND);

        assert_eq!(
            Participants::<T>::get(&who).map(|record| record.bond),
            Some(BENCHMARK_BOND.saturating_mul(2))
        );
    }

    #[benchmark]
    fn withdraw_bond() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()));

        assert!(!Participants::<T>::contains_key(&who));
        assert_eq!(ParticipantCount::<T>::get(), 0);
    }

    #[benchmark]
    fn claim_rewards() {
        let who = participant::<T>();
        assert!(Pallet::<T>::enroll(RawOrigin::Signed(who.clone()).into(), BENCHMARK_BOND).is_ok());
        T::BenchmarkHelper::prime_vit_rate(BENCHMARK_VIT_RATE);
        T::BenchmarkHelper::prime_reward_budget(
            futarchy_primitives::currency::VIT.saturating_mul(1_000),
        );
        Participants::<T>::mutate(&who, |slot| {
            if let Some(record) = slot.as_mut() {
                record.accrued = BENCHMARK_BOND;
            }
        });
        TotalAccrued::<T>::put(BENCHMARK_BOND);

        #[extrinsic_call]
        _(RawOrigin::Signed(who.clone()));

        assert_eq!(
            Participants::<T>::get(&who).map(|record| record.accrued),
            Some(0)
        );
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
