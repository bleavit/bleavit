//! Weight interface for this pallet shell.

/// Runtime-provided weights for pallet calls and hooks.
pub trait WeightInfo {
    /// Weight for a read-only try-state check in tests/try-runtime.
    fn try_state() -> u64;
    /// Weight for a bounded state-transition extrinsic until generated weights land.
    fn dispatch() -> u64;
}

impl WeightInfo for () {
    fn try_state() -> u64 {
        0
    }
    fn dispatch() -> u64 {
        0
    }
}
