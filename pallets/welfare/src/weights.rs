//! Weights for `pallet-welfare`.
//!
//! Hand-seeded generated-shape placeholders; B5 replaces these values with
//! measured execution and PoV output. Every call reads and writes all three
//! bounded frontend mirrors in the worst case.

use core::marker::PhantomData;
use frame_support::traits::Get;
use frame_support::weights::{constants::RocksDbWeight, Weight};

pub trait WeightInfo {
    fn register_spec() -> Weight;
    fn record_snapshot() -> Weight;
    fn record_daily_gate() -> Weight;
    /// The 05 §4.3 authorship-series recorder. Not an extrinsic: the block
    /// authorship `EventHandler` reserves no weight, so the writer registers
    /// this itself as `Mandatory`.
    fn note_collator_authorship() -> Weight;
    /// The 05 §4.3.2 block-production recorder. Not an extrinsic: the parachain
    /// inherent and the post-transaction boundary that drive it reserve no
    /// weight, so the writer registers this itself as `Mandatory`.
    fn note_block_production() -> Weight;
}

const STATE_POV: u64 = 32_000;

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn register_spec() -> Weight {
        Weight::from_parts(40_000_000, STATE_POV)
            .saturating_add(T::DbWeight::get().reads(23))
            .saturating_add(T::DbWeight::get().writes(4))
    }

    fn record_snapshot() -> Weight {
        Weight::from_parts(80_000_000, STATE_POV)
            .saturating_add(T::DbWeight::get().reads(23))
            .saturating_add(T::DbWeight::get().writes(4))
    }

    fn record_daily_gate() -> Weight {
        Weight::from_parts(65_000_000, STATE_POV)
            .saturating_add(T::DbWeight::get().reads(3))
            .saturating_add(T::DbWeight::get().writes(3))
    }

    fn note_collator_authorship() -> Weight {
        Weight::from_parts(15_000_000, STATE_POV)
            .saturating_add(T::DbWeight::get().reads(3))
            .saturating_add(T::DbWeight::get().writes(3))
    }

    fn note_block_production() -> Weight {
        Weight::from_parts(15_000_000, STATE_POV)
            .saturating_add(T::DbWeight::get().reads(2))
            .saturating_add(T::DbWeight::get().writes(2))
    }
}

impl WeightInfo for () {
    fn register_spec() -> Weight {
        Weight::from_parts(40_000_000, STATE_POV)
            .saturating_add(RocksDbWeight::get().reads(23))
            .saturating_add(RocksDbWeight::get().writes(4))
    }

    fn record_snapshot() -> Weight {
        Weight::from_parts(80_000_000, STATE_POV)
            .saturating_add(RocksDbWeight::get().reads(23))
            .saturating_add(RocksDbWeight::get().writes(4))
    }

    fn record_daily_gate() -> Weight {
        Weight::from_parts(65_000_000, STATE_POV)
            .saturating_add(RocksDbWeight::get().reads(3))
            .saturating_add(RocksDbWeight::get().writes(3))
    }

    fn note_collator_authorship() -> Weight {
        Weight::from_parts(15_000_000, STATE_POV)
            .saturating_add(RocksDbWeight::get().reads(3))
            .saturating_add(RocksDbWeight::get().writes(3))
    }

    fn note_block_production() -> Weight {
        Weight::from_parts(15_000_000, STATE_POV)
            .saturating_add(RocksDbWeight::get().reads(2))
            .saturating_add(RocksDbWeight::get().writes(2))
    }
}
