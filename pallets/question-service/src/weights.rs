//! Weight interface for `pallet-question-service`.

use core::marker::PhantomData;
use frame_support::{traits::Get, weights::Weight};

pub trait WeightInfo {
    fn register(a: u32) -> Weight;
    fn bond_attestor() -> Weight;
    fn open() -> Weight;
    fn seal() -> Weight;
    fn submit_attestation() -> Weight;
    fn settle(a: u32) -> Weight;
    fn void(a: u32) -> Weight;
    fn set_paused(q: u32) -> Weight;
    fn archive(a: u32) -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn register(a: u32) -> Weight {
        Weight::from_parts(310_000_000, 48_000)
            .saturating_add(Weight::from_parts(4_000_000, 96).saturating_mul(a.into()))
            .saturating_add(T::DbWeight::get().reads_writes(34, 35))
    }
    fn bond_attestor() -> Weight {
        Weight::from_parts(70_000_000, 8_000).saturating_add(T::DbWeight::get().reads_writes(6, 3))
    }
    fn open() -> Weight {
        Weight::from_parts(55_000_000, 8_000).saturating_add(T::DbWeight::get().reads_writes(6, 1))
    }
    fn seal() -> Weight {
        Weight::from_parts(250_000_000, 40_000)
            .saturating_add(T::DbWeight::get().reads_writes(28, 16))
    }
    fn submit_attestation() -> Weight {
        Weight::from_parts(45_000_000, 6_000).saturating_add(T::DbWeight::get().reads_writes(4, 1))
    }
    fn settle(a: u32) -> Weight {
        Weight::from_parts(190_000_000, 28_000)
            .saturating_add(Weight::from_parts(12_000_000, 1_200).saturating_mul(a.into()))
            .saturating_add(T::DbWeight::get().reads_writes(20 + u64::from(a), 16 + u64::from(a)))
    }
    fn void(a: u32) -> Weight {
        Self::settle(a)
    }
    fn set_paused(q: u32) -> Weight {
        Weight::from_parts(35_000_000, 4_000)
            .saturating_add(Weight::from_parts(3_000_000, 128).saturating_mul(q.into()))
            .saturating_add(T::DbWeight::get().reads_writes(1 + u64::from(q), 1 + u64::from(q)))
    }
    fn archive(a: u32) -> Weight {
        Weight::from_parts(55_000_000, 8_000)
            .saturating_add(Weight::from_parts(3_000_000, 128).saturating_mul(a.into()))
            .saturating_add(
                T::DbWeight::get().reads_writes(5 + 2 * u64::from(a), 4 + 2 * u64::from(a)),
            )
    }
}

impl WeightInfo for () {
    fn register(_: u32) -> Weight {
        Weight::zero()
    }
    fn bond_attestor() -> Weight {
        Weight::zero()
    }
    fn open() -> Weight {
        Weight::zero()
    }
    fn seal() -> Weight {
        Weight::zero()
    }
    fn submit_attestation() -> Weight {
        Weight::zero()
    }
    fn settle(_: u32) -> Weight {
        Weight::zero()
    }
    fn void(_: u32) -> Weight {
        Weight::zero()
    }
    fn set_paused(_: u32) -> Weight {
        Weight::zero()
    }
    fn archive(_: u32) -> Weight {
        Weight::zero()
    }
}
