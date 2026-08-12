//! Weight interface for the drop-in client pallet.
//!
//! The pallet is installed in a client's runtime, not in Bleavit's runtime,
//! so its production runtime owns the generated `SubstrateWeight` binding.
//! The fallback is deliberately conservative and keeps the library usable in
//! a mock runtime before that client has run its own benchmark suite.

use core::marker::PhantomData;
use frame_support::{traits::Get, weights::Weight};

pub trait WeightInfo {
    /// `handler_weight` is the client runtime's declared upper bound for its
    /// `OnReport` callback. The pallet charges this component before invoking
    /// arbitrary client-runtime logic.
    fn receive_report(handler_weight: Weight) -> Weight;
    fn ask() -> Weight;
    fn open() -> Weight;
    fn seal() -> Weight;
    fn prune_reports(reports: u32) -> Weight;
    fn try_state() -> Weight;
}

const REF_COMPUTE: u64 = 50_000_000;
const REF_READS: u64 = 8;
const REF_WRITES: u64 = 8;
// `prune_reports` is always charged at the configured maximum. Its FRAME
// benchmark fits the runtime-specific slope; this reusable fallback remains
// deliberately above the complete worst-case storage shape of one translated
// row (iterator/map read, counter read, defensive extra read, map+counter
// writes). The proof allowance covers a distinct report-map trie leaf plus
// shared counter/path overhead for every row.
const PRUNE_REF_TIME_PER_REPORT: u64 = 10_000_000;
const PRUNE_PROOF_BASE: u64 = 16_384;
const PRUNE_PROOF_PER_REPORT: u64 = 8_192;

fn reference<T: frame_system::Config>() -> Weight {
    Weight::from_parts(REF_COMPUTE, 0)
        .saturating_add(T::DbWeight::get().reads(REF_READS))
        .saturating_add(T::DbWeight::get().writes(REF_WRITES))
}

pub struct SubstrateWeight<T>(PhantomData<T>);

impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn receive_report(handler_weight: Weight) -> Weight {
        reference::<T>().saturating_add(handler_weight)
    }

    fn ask() -> Weight {
        reference::<T>()
    }

    fn open() -> Weight {
        reference::<T>()
    }

    fn seal() -> Weight {
        reference::<T>()
    }

    fn prune_reports(reports: u32) -> Weight {
        reference::<T>()
            .saturating_add(Weight::from_parts(0, PRUNE_PROOF_BASE))
            .saturating_add(
                Weight::from_parts(PRUNE_REF_TIME_PER_REPORT, PRUNE_PROOF_PER_REPORT)
                    .saturating_mul(reports.into()),
            )
            .saturating_add(T::DbWeight::get().reads_writes(
                u64::from(reports).saturating_mul(3),
                u64::from(reports).saturating_mul(2),
            ))
    }

    fn try_state() -> Weight {
        reference::<T>()
    }
}

impl WeightInfo for () {
    fn receive_report(handler_weight: Weight) -> Weight {
        Weight::from_parts(REF_COMPUTE, 0).saturating_add(handler_weight)
    }

    fn ask() -> Weight {
        Weight::from_parts(REF_COMPUTE, 0)
    }

    fn open() -> Weight {
        Weight::from_parts(REF_COMPUTE, 0)
    }

    fn seal() -> Weight {
        Weight::from_parts(REF_COMPUTE, 0)
    }

    fn prune_reports(reports: u32) -> Weight {
        Weight::from_parts(REF_COMPUTE, PRUNE_PROOF_BASE).saturating_add(
            Weight::from_parts(PRUNE_REF_TIME_PER_REPORT, PRUNE_PROOF_PER_REPORT)
                .saturating_mul(reports.into()),
        )
    }

    fn try_state() -> Weight {
        Weight::from_parts(REF_COMPUTE, 0)
    }
}
