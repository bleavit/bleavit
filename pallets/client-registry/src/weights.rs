//! Weights for `pallet-client-registry`.
//!
//! Pallet-local fallbacks mirror the N9 50x20 benchmark's constant-weight
//! storage totals. Production binds the generated runtime artifact directly.

use core::marker::PhantomData;
use frame_support::traits::Get;
use frame_support::weights::{constants::RocksDbWeight, Weight};

pub trait WeightInfo {
    fn admit_client() -> Weight;
    fn admit_local_client() -> Weight;
    fn remove_client() -> Weight;
    fn top_up_delivery_float() -> Weight;
    fn withdraw_delivery_float() -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn admit_client() -> Weight {
        Weight::from_parts(65_500_000, 4_087)
            .saturating_add(T::DbWeight::get().reads(6))
            .saturating_add(T::DbWeight::get().writes(8))
    }

    fn admit_local_client() -> Weight {
        Weight::from_parts(62_730_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(6))
            .saturating_add(T::DbWeight::get().writes(8))
    }

    fn remove_client() -> Weight {
        Weight::from_parts(106_040_000, 7_404)
            .saturating_add(T::DbWeight::get().reads(10))
            .saturating_add(T::DbWeight::get().writes(13))
    }

    fn top_up_delivery_float() -> Weight {
        Weight::from_parts(67_500_000, 7_404)
            .saturating_add(T::DbWeight::get().reads(7))
            .saturating_add(T::DbWeight::get().writes(6))
    }

    fn withdraw_delivery_float() -> Weight {
        Weight::from_parts(63_850_000, 7_404)
            .saturating_add(T::DbWeight::get().reads(7))
            .saturating_add(T::DbWeight::get().writes(6))
    }
}

impl WeightInfo for () {
    fn admit_client() -> Weight {
        Weight::from_parts(65_500_000, 4_087)
            .saturating_add(RocksDbWeight::get().reads(6))
            .saturating_add(RocksDbWeight::get().writes(8))
    }

    fn admit_local_client() -> Weight {
        Weight::from_parts(62_730_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(6))
            .saturating_add(RocksDbWeight::get().writes(8))
    }

    fn remove_client() -> Weight {
        Weight::from_parts(106_040_000, 7_404)
            .saturating_add(RocksDbWeight::get().reads(10))
            .saturating_add(RocksDbWeight::get().writes(13))
    }

    fn top_up_delivery_float() -> Weight {
        Weight::from_parts(67_500_000, 7_404)
            .saturating_add(RocksDbWeight::get().reads(7))
            .saturating_add(RocksDbWeight::get().writes(6))
    }

    fn withdraw_delivery_float() -> Weight {
        Weight::from_parts(63_850_000, 7_404)
            .saturating_add(RocksDbWeight::get().reads(7))
            .saturating_add(RocksDbWeight::get().writes(6))
    }
}
