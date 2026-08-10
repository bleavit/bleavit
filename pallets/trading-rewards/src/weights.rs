//! Weights for `pallet-trading-rewards`.
//!
//! Pallet-local fallbacks are conservative storage-read/write counts taken from
//! the call bodies. Production binds the generated runtime artifact when TR7
//! wires the pallet into `construct_runtime!` (15 §4.5).

use core::marker::PhantomData;
use frame_support::traits::Get;
use frame_support::weights::{constants::RocksDbWeight, Weight};

pub trait WeightInfo {
    fn enroll() -> Weight;
    fn top_up_bond() -> Weight;
    fn withdraw_bond() -> Weight;
    fn claim_rewards() -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn enroll() -> Weight {
        Weight::from_parts(65_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(6))
            .saturating_add(T::DbWeight::get().writes(5))
    }

    fn top_up_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(5))
            .saturating_add(T::DbWeight::get().writes(4))
    }

    fn withdraw_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(5))
            .saturating_add(T::DbWeight::get().writes(5))
    }

    fn claim_rewards() -> Weight {
        Weight::from_parts(60_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(4))
            .saturating_add(T::DbWeight::get().writes(4))
    }
}

impl WeightInfo for () {
    fn enroll() -> Weight {
        Weight::from_parts(65_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(6))
            .saturating_add(RocksDbWeight::get().writes(5))
    }

    fn top_up_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(5))
            .saturating_add(RocksDbWeight::get().writes(4))
    }

    fn withdraw_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(5))
            .saturating_add(RocksDbWeight::get().writes(5))
    }

    fn claim_rewards() -> Weight {
        Weight::from_parts(60_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(4))
            .saturating_add(RocksDbWeight::get().writes(4))
    }
}
