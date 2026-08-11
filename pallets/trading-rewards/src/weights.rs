//! Weights for `pallet-trading-rewards`.
//!
//! Pallet-local fallbacks are conservative storage-read/write counts taken from
//! the call bodies. **Production binds the generated runtime artifact**
//! (`runtime/bleavit-runtime/src/weights/pallet_trading_rewards.rs`, TR7); what
//! is left here is what a mock runtime charges, so the counts are kept true
//! rather than deleted.
//!
//! Two of them cannot be read off this crate's own source, because the cost is
//! on the other side of a `Config` seam: `settle_market_score` calls
//! `T::SettledMarkets::settlement`, and the production adapter reads the book,
//! its vault and the account's two scalar positions. The generated artifact
//! measures those; a fallback cannot (15 §4.5).

use core::marker::PhantomData;
use frame_support::traits::Get;
use frame_support::weights::{constants::RocksDbWeight, Weight};

pub trait WeightInfo {
    fn enroll() -> Weight;
    fn top_up_bond() -> Weight;
    fn withdraw_bond() -> Weight;
    fn claim_rewards() -> Weight;
    fn settle_market_score() -> Weight;
    fn settle_epoch() -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn enroll() -> Weight {
        Weight::from_parts(65_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(11))
            .saturating_add(T::DbWeight::get().writes(5))
    }

    fn top_up_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(8))
            .saturating_add(T::DbWeight::get().writes(4))
    }

    fn withdraw_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(7))
            .saturating_add(T::DbWeight::get().writes(6))
    }

    fn claim_rewards() -> Weight {
        Weight::from_parts(60_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(8))
            .saturating_add(T::DbWeight::get().writes(6))
    }

    fn settle_market_score() -> Weight {
        Weight::from_parts(30_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(3))
            .saturating_add(T::DbWeight::get().writes(3))
    }

    fn settle_epoch() -> Weight {
        Weight::from_parts(65_000_000, 3_640)
            .saturating_add(T::DbWeight::get().reads(8))
            .saturating_add(T::DbWeight::get().writes(4))
    }
}

impl WeightInfo for () {
    fn enroll() -> Weight {
        Weight::from_parts(65_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(11))
            .saturating_add(RocksDbWeight::get().writes(5))
    }

    fn top_up_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(8))
            .saturating_add(RocksDbWeight::get().writes(4))
    }

    fn withdraw_bond() -> Weight {
        Weight::from_parts(62_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(7))
            .saturating_add(RocksDbWeight::get().writes(6))
    }

    fn claim_rewards() -> Weight {
        Weight::from_parts(60_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(8))
            .saturating_add(RocksDbWeight::get().writes(6))
    }

    fn settle_market_score() -> Weight {
        Weight::from_parts(30_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(3))
            .saturating_add(RocksDbWeight::get().writes(3))
    }

    fn settle_epoch() -> Weight {
        Weight::from_parts(65_000_000, 3_640)
            .saturating_add(RocksDbWeight::get().reads(8))
            .saturating_add(RocksDbWeight::get().writes(4))
    }
}
