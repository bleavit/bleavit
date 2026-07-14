#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! FRAME pallet shell scaffold for the `oracle` protocol component.
//!
//! The production runtime-facing wrapper is intentionally thin: all protocol
//! state-transition semantics remain in `oracle-core`, which is the differential
//! oracle used by tests and auditors. This crate owns the FRAME-facing surface
//! files (`mock`, `tests`, `benchmarking`, `weights`) and re-exports the core
//! types until the runtime-level `construct_runtime!` assembly lands.

pub use oracle_core::*;

pub mod weights;

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking;

#[cfg(test)]
mod mock;

#[cfg(test)]
mod tests;
