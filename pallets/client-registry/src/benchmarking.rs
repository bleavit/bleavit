//! `frame-benchmarking` v2 harness for the client-registry dispatchables.

use super::*;
use crate::pallet::Clients;
use frame_benchmarking::v2::*;
use parity_scale_codec::{Encode, MaxEncodedLen};
use staging_xcm::latest::{Junction, Location, NetworkId};

const BENCHMARK_BOND: futarchy_primitives::Balance = 1_000_000_000_000;

fn benchmark_location() -> Location {
    let junctions: [Junction; 8] = core::array::from_fn(|_| Junction::AccountId32 {
        network: Some(NetworkId::ByFork {
            block_number: u64::MAX,
            block_hash: [u8::MAX; 32],
        }),
        id: [u8::MAX; 32],
    });
    let location = Location::new(u8::MAX, junctions);
    assert_eq!(location.encode().len(), Location::max_encoded_len());
    location
}

#[benchmarks(where T: Config)]
mod benches {
    use super::*;

    #[benchmark]
    fn admit_client() {
        let owner = T::BenchmarkHelper::bond_owner();
        T::BenchmarkHelper::prime_client_bond(BENCHMARK_BOND);
        T::BenchmarkHelper::prime_funds(&owner, BENCHMARK_BOND.saturating_mul(2));

        #[extrinsic_call]
        _(
            T::BenchmarkHelper::values(),
            benchmark_location(),
            owner,
            SubIdPolicy::Required,
        );

        assert!(Clients::<T>::contains_key(0));
    }

    #[benchmark]
    fn admit_local_client() {
        let owner = T::BenchmarkHelper::bond_owner();
        T::BenchmarkHelper::prime_client_bond(BENCHMARK_BOND);
        T::BenchmarkHelper::prime_funds(&owner, BENCHMARK_BOND.saturating_mul(2));

        #[extrinsic_call]
        _(
            T::BenchmarkHelper::values(),
            owner.clone(),
            owner,
            SubIdPolicy::Required,
        );

        assert!(Clients::<T>::contains_key(0));
    }

    #[benchmark]
    fn remove_client() {
        let owner = T::BenchmarkHelper::bond_owner();
        T::BenchmarkHelper::prime_client_bond(BENCHMARK_BOND);
        T::BenchmarkHelper::prime_funds(&owner, BENCHMARK_BOND.saturating_mul(2));
        let admitted = Pallet::<T>::admit_local_client(
            T::BenchmarkHelper::values(),
            owner.clone(),
            owner.clone(),
            SubIdPolicy::Optional,
        );
        assert!(admitted.is_ok());
        let metered = Pallet::<T>::note_ingress(0);
        assert!(metered.is_ok());
        // Exact source drain exercises asset-account reap on top-up; removal
        // must then recreate the funder while deleting the escrow account.
        T::BenchmarkHelper::prime_delivery_funds(&owner, BENCHMARK_BOND);
        let topped_up =
            Pallet::<T>::top_up_delivery_float(T::BenchmarkHelper::client(0), BENCHMARK_BOND);
        assert!(topped_up.is_ok());

        #[extrinsic_call]
        _(T::BenchmarkHelper::values(), 0);

        assert!(!Clients::<T>::contains_key(0));
    }

    #[benchmark]
    fn top_up_delivery_float() {
        let owner = T::BenchmarkHelper::bond_owner();
        T::BenchmarkHelper::prime_client_bond(BENCHMARK_BOND);
        T::BenchmarkHelper::prime_funds(&owner, BENCHMARK_BOND.saturating_mul(2));
        // Worst reachable branch: source asset account is expended exactly
        // while the destination escrow account is created.
        T::BenchmarkHelper::prime_delivery_funds(&owner, BENCHMARK_BOND);
        let admitted = Pallet::<T>::admit_local_client(
            T::BenchmarkHelper::values(),
            owner.clone(),
            owner,
            SubIdPolicy::Optional,
        );
        assert!(admitted.is_ok());

        #[extrinsic_call]
        _(T::BenchmarkHelper::client(0), BENCHMARK_BOND);

        assert_eq!(
            Clients::<T>::get(0).map(|record| record.delivery_float),
            Some(BENCHMARK_BOND)
        );
    }

    #[benchmark]
    fn withdraw_delivery_float() {
        let owner = T::BenchmarkHelper::bond_owner();
        T::BenchmarkHelper::prime_client_bond(BENCHMARK_BOND);
        T::BenchmarkHelper::prime_funds(&owner, BENCHMARK_BOND.saturating_mul(2));
        T::BenchmarkHelper::prime_delivery_funds(&owner, BENCHMARK_BOND);
        let admitted = Pallet::<T>::admit_local_client(
            T::BenchmarkHelper::values(),
            owner.clone(),
            owner,
            SubIdPolicy::Optional,
        );
        assert!(admitted.is_ok());
        let topped_up =
            Pallet::<T>::top_up_delivery_float(T::BenchmarkHelper::client(0), BENCHMARK_BOND);
        assert!(topped_up.is_ok());

        #[extrinsic_call]
        // Worst reachable branch: delete the escrow asset account and recreate
        // the exact client funder account that top-up expended.
        _(T::BenchmarkHelper::client(0), BENCHMARK_BOND);

        assert_eq!(
            Clients::<T>::get(0).map(|record| record.delivery_float),
            Some(0)
        );
    }

    impl_benchmark_test_suite!(Pallet, crate::mock::new_test_ext(), crate::mock::Test);
}
