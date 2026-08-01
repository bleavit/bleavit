//! Weights for `pallet-client-registry`.
//!
//! Pallet-local fallbacks mirror the N4 50x20 benchmark's constant-weight
//! storage totals. Production binds the generated runtime artifact directly.

use core::marker::PhantomData;
use frame_support::traits::Get;
use frame_support::weights::{constants::RocksDbWeight, Weight};

pub trait WeightInfo {
    fn admit_client() -> Weight;
    fn admit_local_client() -> Weight;
    fn remove_client() -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn admit_client() -> Weight {
        Weight::from_parts(65_740_000, 4_087)
            .saturating_add(T::DbWeight::get().reads(6))
            .saturating_add(T::DbWeight::get().writes(7))
    }

    fn admit_local_client() -> Weight {
        Weight::from_parts(65_740_000, 4_087)
            .saturating_add(T::DbWeight::get().reads(6))
            .saturating_add(T::DbWeight::get().writes(7))
    }

    fn remove_client() -> Weight {
        Weight::from_parts(60_750_000, 4_120)
            .saturating_add(T::DbWeight::get().reads(6))
            .saturating_add(T::DbWeight::get().writes(8))
    }
}

impl WeightInfo for () {
    fn admit_client() -> Weight {
        Weight::from_parts(65_740_000, 4_087)
            .saturating_add(RocksDbWeight::get().reads(6))
            .saturating_add(RocksDbWeight::get().writes(7))
    }

    fn admit_local_client() -> Weight {
        Weight::from_parts(65_740_000, 4_087)
            .saturating_add(RocksDbWeight::get().reads(6))
            .saturating_add(RocksDbWeight::get().writes(7))
    }

    fn remove_client() -> Weight {
        Weight::from_parts(60_750_000, 4_120)
            .saturating_add(RocksDbWeight::get().reads(6))
            .saturating_add(RocksDbWeight::get().writes(8))
    }
}
