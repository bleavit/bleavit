#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! # `pallet-welfare` — welfare snapshots and cohort settlement (A7)
//!
//! Production FRAME shell over the frame-free [`welfare_core`] functional
//! core. The pallet owns the bounded runtime storage and authority seams while
//! delegating all welfare arithmetic and validation to the core.
//!
//! Spec: `docs/architecture/05` (§4 welfare/gates, §6 the single
//! settlement-authority boundary with three epoch entry paths, §7 cohorts),
//! `02 §4/§7.4` (view and frozen storage names), `06 §3.2`
//! (metric authority), `13 §1/§4` (live parameters and bounds), and `15 §1/§4`
//! (try-state and differential verification).
//!
//! `Snapshots`, `MetricSpecs`, and `GateBreachFlags` are separate bounded maps
//! because 02 §7.4 freezes those frontend-readable names and key/value shapes.
//! Each transition is load → core operation → checked conversion → replace the
//! bounded pre-image keys with the post-image keys → drain core events.
//!
//! SQ-80: 06 §3.2 names `welfare.activate_spec`, but the functional core has no
//! separate activation state: registration enforces `activation_epoch >= now+2`
//! and activation is implicit. A separate call is deferred until the spec and
//! core define an activation-state transition.

extern crate alloc;

pub use pallet::*;
pub use weights::WeightInfo;

pub mod weights;

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking;
#[cfg(test)]
mod mock;
#[cfg(test)]
mod tests;

use alloc::vec::Vec;
use frame_support::pallet_prelude::DispatchResult;
use futarchy_primitives::{
    keeper::{CrankClass, KeeperRebateSink},
    BlockNumber, EpochId, FixedU64, MetricId, MetricSpecVersion, ProposalId,
};

pub use welfare_core::{
    AttestedAdmission, ComponentValue, Error as CoreError, Event as CoreEvent,
    GateBreachFlags as CoreGateBreachFlags, MetricSpec, Pillar, Registration,
    Snapshot as CoreSnapshot, SnapshotContext as CoreSnapshotContext, SourceClass,
    WelfareParams as CoreWelfareParams, WelfareState, EPSILON, EPSILON_PILLAR, HISTORY_PRIORS,
    MAX_COMPONENTS_PER_SPEC, MAX_DAILY_GATE_SAMPLES, MAX_GATE_FLAGS, MAX_METRIC_SPECS,
    MAX_SNAPSHOTS, ONE, THETA_C_HI, THETA_C_LO, THETA_S_HI, THETA_S_LO, W_A, W_P,
};

/// Core bounds in the `u32` form required by FRAME's `ConstU32`.
pub const MAX_METRIC_SPECS_BOUND: u32 = MAX_METRIC_SPECS as u32;
pub const MAX_SNAPSHOTS_BOUND: u32 = MAX_SNAPSHOTS as u32;
pub const MAX_GATE_FLAGS_BOUND: u32 = MAX_GATE_FLAGS as u32;
pub const MAX_COMPONENTS_PER_SPEC_BOUND: u32 = MAX_COMPONENTS_PER_SPEC as u32;
/// Current epoch plus the retained snapshot-history window.
pub const MAX_XCM_TRAFFIC_EPOCHS_BOUND: u32 = MAX_SNAPSHOTS_BOUND + 1;
/// Maximum retired XCM-traffic epoch prefixes removed by one maintenance call.
///
/// Steady state retires at most one epoch per clock roll, so this cap binds only
/// while a pathological historical backlog is spread across successive keeper
/// ticks. Keeping the catch-up cursor-bounded is required by I-20.
pub const XCM_TRAFFIC_PRUNE_MAX_EPOCHS: usize = 2;

/// Maximum retired welfare epochs removed by one epoch-roll prune (05 §3.3).
///
/// Steady state retires at most one epoch per clock roll, so this cap binds
/// only while a pathological historical backlog is spread across successive
/// keeper ticks — the same discipline (and the same value) as
/// [`XCM_TRAFFIC_PRUNE_MAX_EPOCHS`], and required by I-20.
pub const EPOCH_ROLL_PRUNE_MAX_EPOCHS: usize = 2;

/// Live 13 §1 welfare tunables. B1a implements this provider over
/// `pallet-constitution::Params`; tests use overridable parameter statics.
pub trait WelfareParamsProvider {
    fn theta_s_lo() -> FixedU64;
    fn theta_s_hi() -> FixedU64;
    fn theta_c_lo() -> FixedU64;
    fn theta_c_hi() -> FixedU64;
    fn w_p() -> FixedU64;
    fn w_a() -> FixedU64;

    fn welfare_params() -> CoreWelfareParams {
        CoreWelfareParams {
            theta_s_lo: Self::theta_s_lo(),
            theta_s_hi: Self::theta_s_hi(),
            theta_c_lo: Self::theta_c_lo(),
            theta_c_hi: Self::theta_c_hi(),
            w_p: Self::w_p(),
            w_a: Self::w_a(),
        }
    }
}

/// Runtime-injected view of the 07 §2(5) admission preconditions: the oracle's
/// registered reporter/watchtower seats and the live bond ladder that 07 §6.3's
/// coverage rule is evaluated against. Kept a seam rather than a direct read so
/// welfare stays independent of `pallet-oracle` and of `pallet-constitution`.
pub trait OracleAdmission {
    fn admission() -> AttestedAdmission;
}

/// Injected normalized metric source. Normalization, missing-data treatment,
/// raw counter mapping, and attestation plumbing are runtime-composition work;
/// this pallet aggregates only already-normalized `[0, 1]` components.
pub trait MetricInputs {
    fn onchain_components(epoch: EpochId, spec_version: MetricSpecVersion) -> Vec<ComponentValue>;
    /// The components whose settled value for `(epoch, spec_version)` is a
    /// **flagged carry-last** rather than a fresh measurement — 07 §10's flag
    /// bit, as settled by the oracle.
    ///
    /// Read alongside the values instead of folded into them because the flag is
    /// not a value: §10 lets a component's carried number stand for one flagged
    /// epoch and drops it only on the second consecutive one, which is a fact
    /// about *history*, resolved per cohort at settlement. Absence of a flag is
    /// the ordinary case and needs no special reading; absence of the whole
    /// component is already `record_snapshot`'s `MissingComponent`.
    fn flagged_components(epoch: EpochId, spec_version: MetricSpecVersion) -> Vec<MetricId>;
    /// The registry's closed incident aggregate for `(epoch, spec_version)`
    /// — the `C_attested` multiplier of 05 §4.4.
    ///
    /// `None` means the record is not available: the version's `close_epoch`
    /// has not run, a filing is still non-terminal, or no cohort froze that
    /// version. 07 §7 requires the reader to **fail closed** on all three —
    /// substituting the neutral 1.0 would settle a cohort at full-strength
    /// `C_attested` on absent evidence, which is the favourable direction, not
    /// the safe one (G-1). `record_snapshot` refuses and retries.
    fn incident_multiplier(epoch: EpochId, spec_version: MetricSpecVersion) -> Option<FixedU64>;
    fn daily_components(
        epoch: EpochId,
        day: u8,
        spec_version: MetricSpecVersion,
    ) -> Vec<ComponentValue>;
}

/// Epoch-owned schedule projection: snapshot deadlines and the day domain a
/// daily gate sample may name. Implementations accept and return plain protocol
/// numbers; welfare remains independent of FRAME epoch and Cumulus types (I-24).
pub trait SnapshotSchedule {
    fn snapshot_due(epoch: EpochId) -> Option<BlockNumber>;
    /// The size of `epoch`'s **measurable day set** (05 §4.7, normative): its
    /// whole days, floored at one. Day indices `0 .. n` are measurement windows
    /// and every other index is not one at all.
    ///
    /// `None` means the epoch's timing is unknown — a day cannot then be shown
    /// to be inside the set, so `record_daily_gate` refuses it rather than
    /// resolving it to any value (G-1). The projection is epoch-owned because
    /// only the epoch clock knows an epoch's length, and a legal `epoch.length`
    /// need not be a whole number of days.
    fn measurable_days(epoch: EpochId) -> Option<u32>;
}

/// Gate-market dimension settled through the conditional ledger seam.
#[derive(
    Clone, Copy, Debug, parity_scale_codec::Decode, parity_scale_codec::Encode, PartialEq, Eq,
)]
pub enum GateKind {
    Survival,
    Security,
}

/// Runtime-injected conditional-ledger settlement endpoint.
pub trait LedgerSettlement {
    fn settle_scalar(pid: ProposalId, score: FixedU64) -> DispatchResult;
    fn settle_gate(pid: ProposalId, gate: GateKind, breached: bool) -> DispatchResult;
    fn settle_baseline(epoch: EpochId, score: FixedU64) -> DispatchResult;
    /// True when `epoch` has a Baseline vault still in `BaselineState::Open`,
    /// i.e. a settlement would have something to do. It lets both neutral
    /// paths stay infallible (G-1) by pre-filtering the two benign
    /// not-applicable cases — no vault, or already settled — instead of
    /// swallowing a `settle_baseline` error and hiding a genuine failure.
    fn baseline_open(epoch: EpochId) -> bool;
}

/// The cohort whose computed score is being dispatched to the ledger.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettleTarget {
    Proposal {
        pid: ProposalId,
        has_gate_books: bool,
    },
    Baseline,
}

/// Maps the benchmark's governance call to an admitted runtime origin.
#[cfg(feature = "runtime-benchmarks")]
pub trait BenchmarkHelper<RuntimeOrigin> {
    fn metric_governance_origin() -> RuntimeOrigin;
    /// Advance the configured clock so `epoch` is finalized before a keeper
    /// crank. Runtime implementations inject the real epoch storage state.
    fn prime_finalized_epoch(epoch: EpochId);
    /// Populate every component the active benchmark MetricSpec reads.
    fn prime_metric_inputs(count: u16);
    /// Fill 07 §2(5)'s reporter and watchtower seats so `register_spec` reaches
    /// the work it is supposed to measure.
    ///
    /// Deliberately a **seeding** seam and not a stubbed `OracleAdmission`:
    /// every valid MetricSpec contains an attested component (05 §4.3/§4.4), so
    /// an unseated oracle refuses the dispatch outright and the benchmark
    /// measures nothing. Returning a fabricated admission instead would hide the
    /// real storage reads the gate performs — the exact fixture-instead-of-work
    /// shape SQ-489 was raised for.
    fn seat_oracle();
    fn prime_keeper_rebate() {}
    fn assert_keeper_rebate_paid(_: futarchy_primitives::keeper::CrankClass) {}
}

#[frame_support::pallet]
pub mod pallet {
    use super::*;
    use alloc::vec::Vec;
    use frame_support::pallet_prelude::*;
    use frame_support::traits::EnsureOrigin;
    use frame_system::pallet_prelude::*;
    use sp_runtime::TryRuntimeError;

    // 1 since SQ-493: `SnapshotContexts` must exist for every retained snapshot
    // (07 §10), and an upgrading chain reaches that state through
    // `MigrateWelfareSnapshotContextsV1` rather than by genesis alone.
    const STORAGE_VERSION: StorageVersion = StorageVersion::new(1);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config<RuntimeEvent: From<Event<Self>>> {
        /// ConstitutionalValues / metric-track authority (06 §3.2).
        type MetricGovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;
        /// Live welfare values from constitution Params (rule 4).
        type Params: WelfareParamsProvider;
        /// Normalized epoch and daily component inputs.
        type MetricInputs: MetricInputs;
        /// Conditional-ledger settlement seam used by the measured
        /// `compute_settlement` path and the neutral `settle_baseline_void`
        /// passthrough (05 §6).
        type Ledger: LedgerSettlement;
        /// Current epoch clock used by metric registration.
        type CurrentEpoch: Get<EpochId>;
        /// Exact epoch-close schedule used by the 05 §4.8 detector.
        type SnapshotSchedule: SnapshotSchedule;
        /// Fail-soft keeper rebate endpoint (08 §6.3).
        type KeeperRebate: KeeperRebateSink<Self::AccountId>;
        /// 07 §2(5) attested-component admission inputs. Injected because this
        /// pallet owns neither oracle state nor constitution parameters, and
        /// must not import the oracle to reach them (I-24).
        type OracleAdmission: OracleAdmission;
        /// 13 §4 bound on distinct authors tracked in one `(epoch, day)` slot of
        /// [`CollatorAuthorship`].
        ///
        /// The runtime binds this to the same constant as the treasury's
        /// `MaxCollatorCompensationEntries`: both count *the same population* —
        /// the collators that can author in one active session — and letting
        /// them disagree would mean one of the two silently disagrees with the
        /// chain about how many collators exist.
        type MaxCollatorAuthorshipEntries: Get<u32>;
        /// Weight information for all extrinsics.
        type WeightInfo: WeightInfo;
        /// Admitted origin construction for benchmarks.
        #[cfg(feature = "runtime-benchmarks")]
        type BenchmarkHelper: BenchmarkHelper<Self::RuntimeOrigin>;
    }

    pub type BoundedComponents =
        BoundedVec<ComponentValue, ConstU32<MAX_COMPONENTS_PER_SPEC_BOUND>>;
    pub type BoundedSpecSet = BoundedVec<MetricSpec, ConstU32<MAX_COMPONENTS_PER_SPEC_BOUND>>;
    type CheckedStorage = (
        Vec<(MetricSpecVersion, BoundedSpecSet)>,
        Vec<((EpochId, MetricSpecVersion), StoredSnapshot)>,
        Vec<((EpochId, MetricSpecVersion), StoredSnapshotContext)>,
        Vec<(EpochId, CoreGateBreachFlags)>,
    );

    /// Locally observable XCM traffic for one epoch/day window (09 §6.4).
    #[derive(
        Clone,
        Copy,
        Debug,
        Decode,
        DecodeWithMemTracking,
        Default,
        Encode,
        Eq,
        MaxEncodedLen,
        PartialEq,
        TypeInfo,
    )]
    pub struct XcmTrafficCounters {
        pub accepted: u64,
        pub failed: u64,
        pub probe_timeouts: u64,
    }

    /// One locally observable XCM traffic signal (09 §6.4).
    #[derive(
        Clone,
        Copy,
        Debug,
        Decode,
        DecodeWithMemTracking,
        Encode,
        Eq,
        MaxEncodedLen,
        PartialEq,
        TypeInfo,
    )]
    pub enum XcmTrafficKind {
        Accepted,
        SendFailed,
        ProbeTimeout,
    }

    /// Locally observed block production for one epoch/day window (05 §4.3.2).
    ///
    /// The three fields are exactly the three terms of `U`:
    /// `U = clamp((non_empty_blocks + 0.25·empty_blocks) / relay_slots, 0, 1)`.
    ///
    /// `relay_slots` is a **sum of per-block deltas**, never an endpoint
    /// difference: §4.3.2 makes the previous block's relay parent the baseline
    /// for this one *across the window boundary*, so every relay slot is charged
    /// to exactly one window, no boundary loses an outage, and a one-block
    /// window is well-defined rather than a division by zero. The runtime
    /// composition layer owns the delta because the relay parent crosses the
    /// Cumulus boundary there (I-24); this pallet only accumulates it.
    #[derive(
        Clone,
        Copy,
        Debug,
        Decode,
        DecodeWithMemTracking,
        Default,
        Encode,
        Eq,
        MaxEncodedLen,
        PartialEq,
        TypeInfo,
    )]
    pub struct BlockProductionCounters {
        /// Authored parachain blocks carrying at least one non-inherent
        /// extrinsic (weight 1 in `U`'s numerator).
        pub non_empty_blocks: u64,
        /// Authored parachain blocks whose extrinsics are all inherents
        /// (weight 0.25 in `U`'s numerator — 05 §4.3.2 prices collator padding).
        pub empty_blocks: u64,
        /// Relay slots elapsed over the window: the summed per-block relay-parent
        /// delta, which is `U`'s denominator.
        pub relay_slots: u64,
    }

    /// One block-production observation (05 §4.3.2).
    ///
    /// The two arms arrive at different points of the same block — the relay
    /// delta with the parachain inherent, the emptiness classification once the
    /// extrinsic count is final — so they are two calls into one writer rather
    /// than one call carrying both, exactly as [`XcmTrafficKind`] splits the
    /// three transport signals.
    #[derive(
        Clone,
        Copy,
        Debug,
        Decode,
        DecodeWithMemTracking,
        Encode,
        Eq,
        MaxEncodedLen,
        PartialEq,
        TypeInfo,
    )]
    pub enum BlockProductionSignal {
        /// Relay slots elapsed since the previous parachain block. One at
        /// genesis or wherever no usable predecessor exists (§4.3.2's nominal
        /// cadence rule); zero is legitimate where two parachain blocks share a
        /// relay parent, and `U`'s clamp absorbs the resulting ratio above 1.
        RelaySlots(u32),
        /// One authored parachain block, classified by §4.3.2's emptiness rule.
        Authored { empty: bool },
    }

    /// Bounded mirror of the core snapshot, whose transient component `Vec`
    /// cannot itself implement `MaxEncodedLen`.
    #[derive(
        Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
    )]
    pub struct StoredSnapshot {
        pub epoch: EpochId,
        pub spec_version: MetricSpecVersion,
        pub s_pillar: FixedU64,
        pub c_onchain: FixedU64,
        pub c_attested: FixedU64,
        pub p_pillar: FixedU64,
        pub a_pillar: FixedU64,
        pub gate_s: FixedU64,
        pub gate_c: FixedU64,
        pub welfare: FixedU64,
        pub components: BoundedComponents,
    }

    /// The 07 §10 renormalization inputs for one snapshot: which of its
    /// components are flagged carry-lasts, and the incident multiplier and
    /// tunables its `W` was evaluated under.
    ///
    /// Deliberately **not** part of `StoredSnapshot`: 02 §7.4 publishes
    /// `Snapshots` to the frontend, and nothing here is frontend data — the
    /// outcome of the recompute reaches it as the `SettlementRenormalized`
    /// event instead. The same separation `SampledGateDays` makes for the same
    /// reason. Bounded and pruned in lockstep with `Snapshots`.
    #[derive(
        Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
    )]
    pub struct StoredSnapshotContext {
        pub epoch: EpochId,
        pub spec_version: MetricSpecVersion,
        pub flagged: BoundedVec<MetricId, ConstU32<MAX_COMPONENTS_PER_SPEC_BOUND>>,
        pub incident_multiplier: FixedU64,
        pub params: CoreWelfareParams,
    }

    impl TryFrom<CoreSnapshotContext> for StoredSnapshotContext {
        type Error = CoreError;

        fn try_from(context: CoreSnapshotContext) -> Result<Self, Self::Error> {
            Ok(Self {
                epoch: context.epoch,
                spec_version: context.spec_version,
                flagged: BoundedVec::try_from(context.flagged)
                    .map_err(|_| CoreError::TooManyComponents)?,
                incident_multiplier: context.incident_multiplier,
                params: context.params,
            })
        }
    }

    impl From<StoredSnapshotContext> for CoreSnapshotContext {
        fn from(context: StoredSnapshotContext) -> Self {
            Self {
                epoch: context.epoch,
                spec_version: context.spec_version,
                flagged: context.flagged.into_inner(),
                incident_multiplier: context.incident_multiplier,
                params: context.params,
            }
        }
    }

    /// The oldest outstanding scheduled snapshot and the last obligation that
    /// advanced it. This is pallet-internal and does not alter 02 §7.4.
    #[derive(
        Clone,
        Copy,
        Debug,
        Decode,
        DecodeWithMemTracking,
        Encode,
        Eq,
        MaxEncodedLen,
        PartialEq,
        TypeInfo,
    )]
    pub struct SnapshotProgress {
        pub last_snapshot_epoch: Option<EpochId>,
        pub due_epoch: EpochId,
    }

    impl TryFrom<CoreSnapshot> for StoredSnapshot {
        type Error = CoreError;

        fn try_from(s: CoreSnapshot) -> Result<Self, Self::Error> {
            Ok(Self {
                epoch: s.epoch,
                spec_version: s.spec_version,
                s_pillar: s.s_pillar,
                c_onchain: s.c_onchain,
                c_attested: s.c_attested,
                p_pillar: s.p_pillar,
                a_pillar: s.a_pillar,
                gate_s: s.gate_s,
                gate_c: s.gate_c,
                welfare: s.welfare,
                components: BoundedVec::try_from(s.components)
                    .map_err(|_| CoreError::TooManyComponents)?,
            })
        }
    }

    impl From<StoredSnapshot> for CoreSnapshot {
        fn from(s: StoredSnapshot) -> Self {
            Self {
                epoch: s.epoch,
                spec_version: s.spec_version,
                s_pillar: s.s_pillar,
                c_onchain: s.c_onchain,
                c_attested: s.c_attested,
                p_pillar: s.p_pillar,
                a_pillar: s.a_pillar,
                gate_s: s.gate_s,
                gate_c: s.gate_c,
                welfare: s.welfare,
                components: s.components.into_inner(),
            }
        }
    }

    /// Frozen 02 §7.4 frontend surface: versioned metric definitions.
    #[pallet::storage]
    pub type MetricSpecs<T: Config> =
        StorageMap<_, Blake2_128Concat, MetricSpecVersion, BoundedSpecSet, OptionQuery>;

    /// Frozen 02 §7.4 frontend surface: bounded settlement snapshots.
    #[pallet::storage]
    pub type Snapshots<T: Config> =
        StorageMap<_, Blake2_128Concat, (EpochId, MetricSpecVersion), StoredSnapshot, OptionQuery>;

    /// Pallet-internal 07 §10 settlement context, one entry per `Snapshots` key.
    #[pallet::storage]
    pub type SnapshotContexts<T: Config> = StorageMap<
        _,
        Blake2_128Concat,
        (EpochId, MetricSpecVersion),
        StoredSnapshotContext,
        OptionQuery,
    >;

    #[pallet::storage]
    pub type SnapshotDeadline<T: Config> = StorageValue<_, SnapshotProgress, OptionQuery>;

    /// Frozen 02 §7.4 frontend surface: daily breach outcomes by epoch.
    #[pallet::storage]
    pub type GateBreachFlags<T: Config> =
        StorageMap<_, Blake2_128Concat, EpochId, CoreGateBreachFlags, OptionQuery>;

    /// Pallet-internal marker for successfully sampled daily gates.
    ///
    /// This is deliberately separate from the frozen `GateBreachFlags` surface:
    /// 02 §7.4 names only `Snapshots`, `MetricSpecs`, and `GateBreachFlags`, and
    /// 05 §4.7 requires the latter's bitmap to identify breached days only.
    /// The auxiliary map is bounded and pruned in lockstep with gate history.
    #[pallet::storage]
    pub type SampledGateDays<T: Config> =
        StorageMap<_, Blake2_128Concat, EpochId, [u32; 2], OptionQuery>;

    /// Local XCM transport/probe counters by `(epoch, day)` (09 §6.4).
    ///
    /// The future runtime `MetricInputs` binding computes v1 X as
    /// `accepted / (accepted + failed + probe_timeouts)` over the requested
    /// day/epoch window; no traffic means X = 1. This pallet records only the
    /// three local signals and deliberately does not compute X. Entries are
    /// reaped with the welfare rolling window by [`Pallet::prune`] and the
    /// epoch-clock maintenance seam.
    #[pallet::storage]
    pub type XcmTraffic<T: Config> = StorageDoubleMap<
        _,
        Twox64Concat,
        EpochId,
        Twox64Concat,
        u8,
        XcmTrafficCounters,
        ValueQuery,
    >;

    /// Bounded epoch prefixes which currently own XCM traffic entries.
    ///
    /// This lets tick-path maintenance reap traffic-only epochs without a
    /// historical full-map scan. Bounded pruning can temporarily leave older
    /// prefixes queued behind the retained window; the index remains capped.
    #[pallet::storage]
    pub type XcmTrafficEpochs<T: Config> =
        StorageValue<_, BoundedVec<EpochId, ConstU32<MAX_XCM_TRAFFIC_EPOCHS_BOUND>>, ValueQuery>;

    /// Day-resolved reserve-probe outcomes (07 §8 `R_daily`; SQ-195).
    ///
    /// `Some(true)` = that day's probe passed; `Some(false)` = it failed
    /// (error response, timeout, or a folded no-attempt slot). **Absence is not
    /// health**: 07 §8 has no benefit-of-the-doubt branch, so a completed day
    /// with no entry scores 0 once the probe is armed. Before arming, `R` is
    /// *unavailable* rather than 0 — the probe's own `ReserveProbeArmed` latch
    /// says pre-arm slots are not outages, and scoring them as failures would
    /// set the C breach flag out of a mechanism that never ran.
    ///
    /// Keyed exactly like [`XcmTraffic`] and retired by the same bounded walk,
    /// so it inherits that map's `MAX_XCM_TRAFFIC_EPOCHS_BOUND` prefix index and
    /// its `u8`-bounded 256-day second key (I-20/I-21).
    #[pallet::storage]
    pub type ReserveProbeDaily<T: Config> =
        StorageDoubleMap<_, Twox64Concat, EpochId, Twox64Concat, u8, bool, OptionQuery>;

    /// One measurement window of the 05 §4.3 authorship series: the per-author
    /// authored-block counts, plus the sentinel that says whether the window's
    /// *distribution* may be read at all.
    #[derive(
        Encode,
        Decode,
        DecodeWithMemTracking,
        TypeInfo,
        MaxEncodedLen,
        frame_support::CloneNoBound,
        frame_support::PartialEqNoBound,
        frame_support::EqNoBound,
        frame_support::DebugNoBound,
        frame_support::DefaultNoBound,
    )]
    #[scale_info(skip_type_params(T))]
    pub struct AuthorshipWindow<T: Config> {
        /// Distinct authors and their authored-block counts over the window,
        /// bounded by [`Config::MaxCollatorAuthorshipEntries`] (13 §4). Counts
        /// saturate rather than wrap.
        pub authors: BoundedVec<(T::AccountId, u32), T::MaxCollatorAuthorshipEntries>,
        /// Set once this window had to **drop** an author for want of room.
        ///
        /// The drop is not equally safe for every consumer, and conflating the
        /// two readings is the defect this flag exists to prevent:
        ///
        ///  - **Count consumers are safe.** `K`
        ///    (`min(1, distinct_active_authors / collator.n_min)`) and `U` read
        ///    a *cardinality* or a *total*, and a dropped author can only lower
        ///    both. They may read a truncated window; it is pessimistic, which
        ///    is the direction G-1 wants.
        ///  - **Distribution consumers are not.** `D_eff` (§4.5) reads
        ///    *concentration*. A window already full of early low-count authors
        ///    that then drops a newly rotated author producing most of the
        ///    remaining blocks retains a near-uniform retained distribution
        ///    while the real one is highly concentrated — so `D_eff` would read
        ///    **better** than the truth, not worse. A truncated window is
        ///    therefore *unavailable* to a distribution consumer, never merely
        ///    conservative.
        pub truncated: bool,
    }

    /// Per-author authored-block counts by `(epoch, day)` (05 §4.3).
    ///
    /// The shared series behind three welfare components, all of which read
    /// *distinct authors* or *authored blocks* over a window and none of which
    /// can be reconstructed from an aggregate count: collator-set adequacy `K`
    /// (`min(1, distinct_active_authors / collator.n_min)`, live since A14),
    /// block production `U`, and collator concentration `D_eff` (§4.5), which
    /// needs the per-author distribution and not merely its cardinality. One
    /// series serves all three so the three can never disagree about who
    /// authored what.
    ///
    /// This pallet records only the counts and deliberately computes no
    /// component from them — the same division of labour [`XcmTraffic`] makes.
    ///
    /// Keyed exactly like [`XcmTraffic`] and retired by the same bounded walk,
    /// so it inherits that map's `MAX_XCM_TRAFFIC_EPOCHS_BOUND` prefix index and
    /// its `u8`-bounded 256-day second key (I-20/I-21). The per-day vector is
    /// bounded by [`Config::MaxCollatorAuthorshipEntries`] (13 §4).
    #[pallet::storage]
    pub type CollatorAuthorship<T: Config> = StorageDoubleMap<
        _,
        Twox64Concat,
        EpochId,
        Twox64Concat,
        u8,
        AuthorshipWindow<T>,
        ValueQuery,
    >;

    /// The same series aggregated over an epoch's days, maintained **on write**
    /// (05 §4.3).
    ///
    /// Deliberately stored rather than folded on read. The day dimension is
    /// keyed by a `u8`, and the day index of the *live* epoch keeps advancing
    /// while the clock is paused (05 §4.8 — the live epoch has no end bound), so
    /// the fold's honest worst case is 256 day slots × the per-day bound: about
    /// 1 MB of proof and a quadratic per-author merge, charged to
    /// `record_snapshot` on every epoch. Restricting the fold to the epoch's
    /// measurable days instead would make that charge a function of a
    /// governance-tunable `epoch.length`, so the weight would silently
    /// understate the moment the key moved. Maintaining the aggregate costs one
    /// extra bounded read/write on the authorship path and makes the read O(1)
    /// and constant.
    ///
    /// Its `truncated` flag is **its own**, not the disjunction of its days': the
    /// aggregate is maintained independently, so a day that dropped an author
    /// for want of room in *that day's* vector does not make the epoch-wide
    /// distribution wrong. try-state ties the two together where both are
    /// untruncated.
    ///
    /// Keyed by epoch only, and retired by the same bounded walk from the same
    /// shared [`XcmTrafficEpochs`] index (I-20/I-21).
    #[pallet::storage]
    pub type CollatorAuthorshipEpoch<T: Config> =
        StorageMap<_, Twox64Concat, EpochId, AuthorshipWindow<T>, ValueQuery>;

    /// Block-production counters by `(epoch, day)` (05 §4.3.2; A14).
    ///
    /// `U` and `U^{day}` are sums of the same per-block observation over
    /// different windows, so one accumulator serves both: the epoch projection
    /// is the prefix fold [`Pallet::block_production_epoch`], exactly as
    /// [`Pallet::xcm_traffic_epoch`] projects the transport counters.
    ///
    /// This pallet records only the three terms and deliberately computes no
    /// component from them — the same division of labour [`XcmTraffic`] makes,
    /// and the reason `U`'s clamp and its zero-denominator rule live in the
    /// runtime binding beside the other 05 §4.3 projections.
    ///
    /// Keyed exactly like [`XcmTraffic`] and retired by the same bounded walk,
    /// so it inherits that map's `MAX_XCM_TRAFFIC_EPOCHS_BOUND` prefix index and
    /// its `u8`-bounded 256-day second key (I-20/I-21). The value is a
    /// fixed-width counter triple, so the map adds no variable-length collection
    /// of its own (13 §4).
    #[pallet::storage]
    pub type BlockProduction<T: Config> = StorageDoubleMap<
        _,
        Twox64Concat,
        EpochId,
        Twox64Concat,
        u8,
        BlockProductionCounters,
        ValueQuery,
    >;

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        MetricSpecRegistered {
            version: MetricSpecVersion,
        },
        SnapshotRecorded {
            epoch: EpochId,
            spec_version: MetricSpecVersion,
            welfare: FixedU64,
        },
        GateBreachRecorded {
            epoch: EpochId,
            day: u8,
            s_breached: bool,
            c_breached: bool,
        },
        SettlementComputed {
            epoch: EpochId,
            spec_version: MetricSpecVersion,
            score: FixedU64,
        },
        /// 07 §10: this cohort's `W` was recomputed without `dropped` — flagged
        /// in two consecutive epochs of its measurement window — with the
        /// surviving weights renormalized. Emitted immediately before
        /// `SettlementComputed`, so a score that is not the geometric mean of
        /// the two published `Snapshots.welfare` values always says why.
        SettlementRenormalized {
            epoch: EpochId,
            spec_version: MetricSpecVersion,
            dropped: BoundedVec<MetricId, ConstU32<MAX_COMPONENTS_PER_SPEC_BOUND>>,
        },
    }

    /// Core errors map 1:1; `BadParams` identifies an invalid live registry
    /// value before the core operation begins.
    #[pallet::error]
    pub enum Error<T> {
        TooManyMetricSpecs,
        TooManySnapshots,
        TooManyComponents,
        TooManyGateFlags,
        DuplicateSpecVersion,
        SpecNotFound,
        BadActivationEpoch,
        SpecNotActive,
        MissingMetricDiscipline,
        BadEpsilonFloor,
        BadSourceClass,
        BadWeightSum,
        ValueOutOfRange,
        MissingComponent,
        DuplicateComponent,
        DuplicateSnapshot,
        ArithmeticOverflow,
        TryStateViolation,
        BadParams,
        /// A snapshot/daily-gate crank named an epoch that has not finalized yet
        /// (`epoch >= CurrentEpoch`). 05 §4.6 winsorizes over *finalized* epoch
        /// values, so a keeper may only record an epoch the clock has passed.
        EpochNotFinalized,
        /// Gate-market settlement was asked to resolve a cohort whose e+1…e+2
        /// window contains an epoch with no recorded daily observation at all
        /// (05 §4.7; SQ-79). The gate input is unavailable, so settlement holds
        /// at the status quo and the cohort takes 07 §10's VOID.
        GateWindowUnsampled,
        /// The A-pillar milestone component declares no positive `target`, so
        /// 05 §4.3's `min(1, points ÷ target)` has no defined value (07 §7).
        MilestoneTargetUnset,
        /// An attested component's `delta_s_max_bps` is outside `(0, 10_000]`
        /// (05 §4.4).
        BadDeltaSMax,
        /// 07 §2(5): fewer than `orc.n_min` reporters or fewer than `wt.quorum`
        /// watchtowers are registered, so an attested component's game could not
        /// be adjudicated.
        InsufficientOracleSeats,
        /// 07 §6.3: the live bond ladder does not cover the component's declared
        /// `Δs_max`, so a lie about it would cost less than it can move. Also
        /// returned when the ladder is unreadable — the fail-closed direction.
        BondCoverageUnmet,
        /// The registry has no closed incident aggregate for this
        /// `(epoch, spec_version)`, so `C_attested`'s multiplier is unknown
        /// (07 §7, SQ-141). The snapshot is refused rather than resolved to the
        /// favourable neutral 1.0; 07 §11(1)'s d20 money deadline guarantees the
        /// record exists in time, so this is a retry, not a wedge.
        IncidentAggregateUnavailable,
        /// A flagged component offered for a snapshot is not an **attested**
        /// component of that spec version (07 §10; §11(1)(i)). Only class-4
        /// components are reportable, so only they can carry a flagged epoch.
        BadFlaggedComponent,
        /// A snapshot exists with no 07 §10 settlement context beside it. The two
        /// are written and retired atomically, so this is a corrupted-state
        /// signal rather than a reachable outcome.
        MissingSnapshotContext,
        /// A 05 §4.6 percentile was asked of an empty winsorization sample. The
        /// `prior_bounds ++ finalized` assembly is always 12 elements, so this
        /// is a corrupted-state signal rather than a reachable outcome.
        EmptyNormalizationSample,
        /// The 05 §4.6 min–max range is zero-width, so the component's raw
        /// series has no map onto [0,1]. Refused rather than resolved to the
        /// adopt-favourable 1.0 (G-1).
        DegenerateNormalizationRange,
        /// The named day is not in the epoch's measurable day set (05 §4.7): the
        /// epoch had fewer whole days than that, or its timing is no longer
        /// retained so membership cannot be decided. Appended, not inserted —
        /// error indices are part of the decoded surface (02 §13).
        DayOutsideEpoch,
    }

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        #[cfg(feature = "try-runtime")]
        fn try_state(_n: BlockNumberFor<T>) -> Result<(), TryRuntimeError> {
            Self::do_try_state()
        }
    }

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Register a metric-track-approved version. Activation is implicit and
        /// the core enforces the two-epoch lead time.
        #[pallet::call_index(0)]
        #[pallet::weight(T::WeightInfo::register_spec())]
        pub fn register_spec(
            origin: OriginFor<T>,
            version: MetricSpecVersion,
            specs: BoundedSpecSet,
        ) -> DispatchResult {
            T::MetricGovernanceOrigin::ensure_origin(origin)?;
            Self::mutate(|state| {
                // SQ-82: a live dispatch is always `Live`, even when the clock
                // reads 0. The genesis relaxation belongs to the genesis build
                // alone and must not be reachable from an unset/booting clock.
                state.register_metric_spec(
                    Registration::Live {
                        current_epoch: T::CurrentEpoch::get(),
                    },
                    version,
                    specs.into_inner(),
                    &T::OracleAdmission::admission(),
                )
            })?;
            let _ = Self::snapshot_progress();
            Ok(())
        }

        /// Permissionless signed keeper crank for one **finalized** epoch's
        /// snapshot. The epoch must have closed (`epoch < CurrentEpoch`; 05 §4.6
        /// winsorizes over finalized epoch values), else the crank is rejected —
        /// this stops an early/future call from locking a wrong `W` or consuming
        /// the bounded snapshot window before the real counters exist.
        #[pallet::call_index(1)]
        // B5: recalibrate for the keeper-rebate sink's additional storage path.
        #[pallet::weight(T::WeightInfo::record_snapshot())]
        pub fn record_snapshot(
            origin: OriginFor<T>,
            epoch: EpochId,
            spec_version: MetricSpecVersion,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::ensure!(
                epoch < T::CurrentEpoch::get(),
                Error::<T>::EpochNotFinalized
            );
            let components = T::MetricInputs::onchain_components(epoch, spec_version);
            let incident = T::MetricInputs::incident_multiplier(epoch, spec_version)
                .ok_or(Error::<T>::IncidentAggregateUnavailable)?;
            let flagged = T::MetricInputs::flagged_components(epoch, spec_version);
            let params = Self::live_params()?;
            Self::mutate(|state| {
                state
                    .record_snapshot(epoch, spec_version, components, incident, flagged, &params)
                    .map(|_| ())
            })?;
            Self::note_snapshot_recorded(epoch, spec_version);
            T::KeeperRebate::rebate(&who, CrankClass::DecisionCritical);
            Ok(())
        }

        /// Permissionless signed keeper crank for a **finalized** epoch's daily
        /// S/C gate sample. Like `record_snapshot`, the epoch must have closed
        /// (`epoch < CurrentEpoch`) so the day's counters are final (05 §4.7).
        ///
        /// `day` must lie in the epoch's **measurable day set** (05 §4.7): its
        /// whole days, floored at one. `MAX_DAILY_GATE_SAMPLES` is the *storage*
        /// bound on the breach bitmap and is not the semantic bound — for every
        /// permitted `epoch.length` there are day indices below it that the epoch
        /// never contained, and resolving one of those would let a keeper drive
        /// `C_daily` down out of components that were never measured (`X` reads
        /// its no-traffic 1, `K` reads 0 because nobody authored in a day that
        /// never elapsed, `R` refuses). The day is therefore refused, not
        /// resolved to any value.
        #[pallet::call_index(2)]
        // B5: recalibrate for the keeper-rebate sink's additional storage path.
        #[pallet::weight(T::WeightInfo::record_daily_gate())]
        pub fn record_daily_gate(
            origin: OriginFor<T>,
            epoch: EpochId,
            day: u8,
            spec_version: MetricSpecVersion,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            frame_support::ensure!(
                epoch < T::CurrentEpoch::get(),
                Error::<T>::EpochNotFinalized
            );
            // Both day guards run before any component is projected: an
            // inadmissible day must not reach the input seam at all, let alone
            // have a value resolved for it.
            frame_support::ensure!(day < MAX_DAILY_GATE_SAMPLES, Error::<T>::ValueOutOfRange);
            // An unknown timing takes the same refusal as an out-of-range day:
            // membership in the measurable set cannot be *shown*, and a day that
            // cannot be shown to be a measurement window is not treated as one.
            let measurable =
                T::SnapshotSchedule::measurable_days(epoch).ok_or(Error::<T>::DayOutsideEpoch)?;
            frame_support::ensure!(u32::from(day) < measurable, Error::<T>::DayOutsideEpoch);
            let components = T::MetricInputs::daily_components(epoch, day, spec_version);
            let params = Self::live_params()?;
            let word_index = usize::from(day / 32);
            let bit = 1u32 << (day % 32);
            let mut sampled_days = SampledGateDays::<T>::get(epoch).unwrap_or([0; 2]);
            let sampled_word = sampled_days
                .get_mut(word_index)
                .ok_or(Error::<T>::ValueOutOfRange)?;
            let newly_sampled = *sampled_word & bit == 0;
            *sampled_word |= bit;
            let mut new_breach_flags = false;
            Self::mutate(|state| {
                state
                    .record_daily_gate(epoch, day, spec_version, components, &params)
                    .map(|(_, did_change)| new_breach_flags = did_change)
            })?;
            SampledGateDays::<T>::insert(epoch, sampled_days);
            if newly_sampled || new_breach_flags {
                T::KeeperRebate::rebate(&who, CrankClass::General);
            }
            Ok(())
        }
    }

    #[pallet::extra_constants]
    impl<T: Config> Pallet<T> {
        #[pallet::constant_name(INTEGRATION_CONTRACT_VERSION)]
        fn integration_contract_version() -> u32 {
            futarchy_primitives::INTEGRATION_CONTRACT_VERSION
        }

        #[pallet::constant_name(MaxMetricSpecs)]
        fn max_metric_specs() -> u32 {
            MAX_METRIC_SPECS_BOUND
        }

        #[pallet::constant_name(MaxSnapshots)]
        fn max_snapshots() -> u32 {
            MAX_SNAPSHOTS_BOUND
        }

        #[pallet::constant_name(MaxGateFlags)]
        fn max_gate_flags() -> u32 {
            MAX_GATE_FLAGS_BOUND
        }

        #[pallet::constant_name(MaxDailyGateSamples)]
        fn max_daily_gate_samples() -> u8 {
            MAX_DAILY_GATE_SAMPLES
        }
    }

    #[pallet::genesis_config]
    pub struct GenesisConfig<T: Config> {
        pub specs: Vec<(MetricSpecVersion, Vec<MetricSpec>)>,
        #[serde(skip)]
        pub _config: core::marker::PhantomData<T>,
    }

    impl<T: Config> Default for GenesisConfig<T> {
        fn default() -> Self {
            Self {
                specs: Vec::new(),
                _config: core::marker::PhantomData,
            }
        }
    }

    #[pallet::genesis_build]
    impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
        fn build(&self) {
            let mut state = WelfareState::new();
            for (version, specs) in &self.specs {
                assert!(
                    state
                        .register_metric_spec(
                            Registration::Genesis,
                            *version,
                            specs.clone(),
                            // 07 §2(5) binds the genesis build too. A genesis
                            // spec carrying an attested component is refused
                            // unless the oracle's seats are already filled at
                            // this point in the genesis sequence — which depends
                            // on `construct_runtime!` ordering, so an attested
                            // genesis spec is a deliberate choice a preset must
                            // sequence for, not something that quietly works.
                            &T::OracleAdmission::admission(),
                        )
                        .is_ok(),
                    "welfare genesis metric specs violate core validation"
                );
            }
            assert!(
                state.try_state().is_ok(),
                "welfare genesis violates bounded core invariants"
            );
            for (version, specs) in state.specs {
                MetricSpecs::<T>::insert(version, BoundedVec::truncate_from(specs));
            }
        }
    }

    impl<T: Config> Pallet<T> {
        /// True only after the oldest outstanding snapshot has been overdue
        /// for strictly more than the 13 §2 four-day grace.
        pub fn snapshot_overdue(now: BlockNumber) -> bool {
            let Some(progress) = Self::snapshot_progress() else {
                return false;
            };
            T::SnapshotSchedule::snapshot_due(progress.due_epoch)
                .and_then(|due_at| {
                    due_at
                        .checked_add(futarchy_primitives::kernel::DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS)
                })
                .is_some_and(|deadline| now > deadline)
        }

        fn snapshot_progress() -> Option<SnapshotProgress> {
            if let Some(progress) = SnapshotDeadline::<T>::get() {
                return Some(progress);
            }
            let due_epoch = MetricSpecs::<T>::iter_values()
                .filter_map(|specs| specs.iter().map(|spec| spec.activation_epoch).max())
                .min()?;
            T::SnapshotSchedule::snapshot_due(due_epoch)?;
            let progress = SnapshotProgress {
                last_snapshot_epoch: None,
                due_epoch,
            };
            SnapshotDeadline::<T>::put(progress);
            Some(progress)
        }

        fn note_snapshot_recorded(epoch: EpochId, spec_version: MetricSpecVersion) {
            let Some(progress) = Self::snapshot_progress() else {
                return;
            };
            if progress.due_epoch != epoch
                || Self::active_snapshot_spec(epoch) != Some(spec_version)
            {
                return;
            }
            let Some(next_epoch) = epoch.checked_add(1) else {
                return;
            };
            if T::SnapshotSchedule::snapshot_due(next_epoch).is_none() {
                return;
            }
            SnapshotDeadline::<T>::put(SnapshotProgress {
                last_snapshot_epoch: Some(epoch),
                due_epoch: next_epoch,
            });
        }

        /// Canonical active spec: the unique version at the latest fully-live
        /// activation epoch. An activation tie is fail-closed as ambiguous.
        pub fn active_snapshot_spec(epoch: EpochId) -> Option<MetricSpecVersion> {
            let mut selected = None;
            let mut ambiguous = false;
            for (version, specs) in MetricSpecs::<T>::iter() {
                if specs.is_empty() || specs.iter().any(|spec| spec.activation_epoch > epoch) {
                    continue;
                }
                let Some(activation) = specs.iter().map(|spec| spec.activation_epoch).max() else {
                    continue;
                };
                match selected {
                    None => {
                        selected = Some((activation, version));
                        ambiguous = false;
                    }
                    Some((latest, _)) if activation > latest => {
                        selected = Some((activation, version));
                        ambiguous = false;
                    }
                    Some((latest, _)) if activation == latest => ambiguous = true,
                    Some(_) => {}
                }
            }
            (!ambiguous).then_some(selected?.1)
        }

        /// The measured/scored 05 §6 settlement endpoint. It is
        /// runtime-internal (not a call); B1a exposes it only through
        /// `pallet-epoch::settle_cohort`.
        // B1a: the SettleAuthority-trusted epoch caller supplies the proposal's
        // creation-time `spec_version` (Proposal.metric_spec, I-16) and whether
        // its class/ask created gate books.
        pub fn compute_settlement(
            cohort_epoch: EpochId,
            spec_version: MetricSpecVersion,
            targets: &[SettleTarget],
        ) -> Result<FixedU64, DispatchError> {
            // SQ-497 — one computation per *batch*, not per target.
            //
            // `(cohort_epoch, spec_version)` fixes the score, and `epoch-core`
            // enforces a single frozen `metric_spec` for a whole cohort, so every
            // target in a batch settles at the same number. Calling this per
            // target reloaded the entire welfare mirror and recomputed the
            // identical 07 §10 renormalized pair once per proposal. Nothing is
            // lost by hoisting: settlement mutates no welfare state — the core
            // call is a read over the snapshot window — so the repetition was
            // provably redundant rather than semantically load-bearing.
            let mut state = Self::load();
            let score = state
                .compute_settlement(cohort_epoch, spec_version)
                .map_err(Self::map_core_error)?;
            // The core reports what it did — including 07 §10's renormalization,
            // which the caller cannot reconstruct from the score alone — so the
            // events are drained from it rather than rebuilt here. They are
            // deposited **once per batch** now, matching the one computation they
            // describe, instead of once per settled item.
            let core_events = core::mem::take(&mut state.events);
            // Per-epoch, not per-target: the same window decides every target's
            // gate outcome, so this too was recomputed per proposal.
            let gate_outcomes = if targets.iter().any(|target| {
                matches!(
                    target,
                    SettleTarget::Proposal {
                        has_gate_books: true,
                        ..
                    }
                )
            }) {
                Some(Self::gate_outcomes(cohort_epoch)?)
            } else {
                None
            };

            frame_support::storage::with_storage_layer(|| {
                for target in targets {
                    match *target {
                        SettleTarget::Proposal {
                            pid,
                            has_gate_books,
                        } => {
                            T::Ledger::settle_scalar(pid, score)?;
                            if has_gate_books {
                                let (s_breached, c_breached) = gate_outcomes
                                    .ok_or(DispatchError::Other("missing gate outcomes"))?;
                                T::Ledger::settle_gate(pid, GateKind::Survival, s_breached)?;
                                T::Ledger::settle_gate(pid, GateKind::Security, c_breached)?;
                            }
                        }
                        SettleTarget::Baseline => {
                            T::Ledger::settle_baseline(cohort_epoch, score)?;
                        }
                    }
                }
                for event in core_events {
                    Self::deposit_core_event(event);
                }
                Ok::<(), DispatchError>(())
            })?;
            Ok(score)
        }

        /// Narrow, O(1) observation-presence read for epoch's target-specific
        /// PB-ORACLE-VOID producer. `GateBreachFlags` is written on the first
        /// successful daily sample whether or not that sample breached, so
        /// key presence is exactly the 05 §4.7 predicate (SQ-233).
        pub fn gate_window_sampled(epoch: EpochId) -> bool {
            GateBreachFlags::<T>::contains_key(epoch)
        }

        /// The 03 §2.3/§5 neutral Baseline-settlement passthrough shared by
        /// cohort VOID and 05 §7(6)'s orphan-epoch finalizer.
        ///
        /// Neither path has a usable measurement, so unlike
        /// `compute_settlement` this reads **no** welfare state and computes
        /// nothing — it applies the spec-fixed neutral score under the same
        /// SettleAuthority. It exists because the Baseline vault has no
        /// `Voided` state (03 §6.4): without this call the vault can stay `Open`
        /// forever and single-sided holders, whose redemptions require
        /// `Settled`, are stranded (SQ-92/SQ-320).
        ///
        /// Infallible by construction on the two benign paths (G-1): an epoch
        /// with no Baseline vault, or one already settled, is a silent no-op.
        /// Anything else still propagates — a neutral closeout must not mask a
        /// real ledger failure.
        pub fn settle_baseline_void(cohort_epoch: EpochId) -> DispatchResult {
            if !T::Ledger::baseline_open(cohort_epoch) {
                return Ok(());
            }
            T::Ledger::settle_baseline(
                cohort_epoch,
                futarchy_primitives::kernel::VOID_BASELINE_SCORE,
            )
        }

        /// Runtime-internal rolling-window maintenance. B1a wires this from
        /// epoch Housekeeping only after the cohort reap precondition in 05 §3.3.
        pub fn prune(cutoff_epoch: EpochId) -> DispatchResult {
            let pre = Self::load();
            let mut retired_epochs = pre
                .snapshots
                .iter()
                .filter_map(|snapshot| (snapshot.epoch < cutoff_epoch).then_some(snapshot.epoch))
                .chain(
                    pre.gate_flags
                        .iter()
                        .filter_map(|(epoch, _)| (*epoch < cutoff_epoch).then_some(*epoch)),
                )
                .chain(SampledGateDays::<T>::iter_keys().filter(|epoch| *epoch < cutoff_epoch))
                .collect::<Vec<_>>();
            retired_epochs.sort_unstable();
            retired_epochs.dedup();

            let mut post = pre.clone();
            post.prune_before(cutoff_epoch);
            Self::persist(&pre, post)?;
            for epoch in retired_epochs {
                SampledGateDays::<T>::remove(epoch);
            }
            Self::prune_xcm_traffic(cutoff_epoch)?;
            Ok(())
        }

        /// Bounded epoch-roll retirement of welfare state left unreferenced by
        /// every live cohort (05 §3.3; SQ-201).
        ///
        /// `prune` above is reachable only from cohort reap, so an epoch that
        /// never forms a cohort is unreachable by cohort-keyed cleanup: after
        /// `MAX_SNAPSHOTS` consecutive cohortless epochs `record_snapshot`
        /// jams at its hard bound, snapshot recording stops and the 05 §4.8
        /// snapshot-overdue trigger fires — a deterministic chain wedge rather
        /// than idle storage. This path runs on every clock roll instead.
        ///
        /// It applies the **same** 05 §3.3 cutoff as the reap-triggered prune,
        /// so it can never retire state that prune would have retained; only
        /// *when* the retirement happens changes, never *what* is retired. At
        /// most [`EPOCH_ROLL_PRUNE_MAX_EPOCHS`] epochs are removed per call,
        /// oldest first (I-20), and the epoch named by the snapshot-deadline
        /// progress is protected so the try-state binding between the two
        /// cannot be broken by maintenance.
        pub fn prune_epoch_roll(cutoff_epoch: EpochId) -> DispatchResult {
            let protected = SnapshotDeadline::<T>::get().and_then(|p| p.last_snapshot_epoch);
            // Key-only scans: the three maps are each bounded at MAX_SNAPSHOTS /
            // MAX_GATE_FLAGS by `checked_storage` and `do_try_state`, so this is
            // a bounded read even before the retirement batch is capped.
            let snapshot_keys = Snapshots::<T>::iter_keys().collect::<Vec<_>>();
            let mut retired = snapshot_keys
                .iter()
                .map(|(epoch, _)| *epoch)
                .chain(GateBreachFlags::<T>::iter_keys())
                .chain(SampledGateDays::<T>::iter_keys())
                .filter(|epoch| *epoch < cutoff_epoch && Some(*epoch) != protected)
                .collect::<Vec<_>>();
            retired.sort_unstable();
            retired.dedup();
            retired.truncate(EPOCH_ROLL_PRUNE_MAX_EPOCHS);

            for epoch in retired {
                for key in snapshot_keys.iter().filter(|(e, _)| *e == epoch) {
                    Snapshots::<T>::remove(key);
                    // The 07 §10 context retires with its snapshot; the pairing
                    // is a try-state invariant, so leaving one behind is a
                    // violation and not merely idle storage.
                    SnapshotContexts::<T>::remove(key);
                }
                GateBreachFlags::<T>::remove(epoch);
                SampledGateDays::<T>::remove(epoch);
            }
            Ok(())
        }

        /// Reap only retired XCM traffic prefixes.
        ///
        /// Epoch calls this after every successful tick, including when no
        /// settlement cohort exists. At steady state an epoch roll retires at
        /// most one prefix, so the cap never binds. A pathological multi-epoch
        /// backlog is deliberately spread across successive ticks (I-20).
        /// Each selected prefix is itself bounded by the `u8` day key's 256
        /// entries. Selection is oldest-first and only epochs strictly below
        /// `cutoff_epoch` are eligible.
        pub fn prune_xcm_traffic(cutoff_epoch: EpochId) -> DispatchResult {
            XcmTrafficEpochs::<T>::mutate(|epochs| {
                for _ in 0..XCM_TRAFFIC_PRUNE_MAX_EPOCHS {
                    let oldest = epochs
                        .iter()
                        .filter(|epoch| **epoch < cutoff_epoch)
                        .min()
                        .copied();
                    let Some(epoch) = oldest else {
                        break;
                    };
                    let _ = XcmTraffic::<T>::clear_prefix(epoch, u8::MAX as u32 + 1, None);
                    // SQ-195: the day-resolved probe outcomes share this
                    // prefix index and retention window, so they retire in the
                    // same bounded step rather than accruing behind it.
                    let _ = ReserveProbeDaily::<T>::clear_prefix(epoch, u8::MAX as u32 + 1, None);
                    // A14: so does the collator-authorship series. A second
                    // index or a second reaper would be two retention policies
                    // over one epoch window, and the one that fell behind would
                    // be the one holding unbounded state.
                    let _ = CollatorAuthorship::<T>::clear_prefix(epoch, u8::MAX as u32 + 1, None);
                    // Its epoch aggregate retires in the same step: it is keyed
                    // by the same epoch and reachable only through this index.
                    CollatorAuthorshipEpoch::<T>::remove(epoch);
                    // A14: and so does the 05 §4.3.2 block-production series,
                    // for the same reason.
                    let _ = BlockProduction::<T>::clear_prefix(epoch, u8::MAX as u32 + 1, None);
                    if let Some(position) = epochs.iter().position(|stored| *stored == epoch) {
                        epochs.remove(position);
                    }
                }
            });
            Ok(())
        }

        /// Record one locally observable XCM signal without affecting its caller.
        ///
        /// Saturation is deliberate: router delivery and oracle timeout handling
        /// are fail-soft observation paths, so recording can never error or panic.
        pub fn note_xcm_traffic(epoch: EpochId, day: u8, kind: XcmTrafficKind) {
            let tracked = XcmTrafficEpochs::<T>::mutate(|epochs| {
                if epochs.contains(&epoch) {
                    true
                } else {
                    epochs.try_push(epoch).is_ok()
                }
            });
            // A full index can occur while bounded maintenance catches up. The
            // conservative bounded-state choice is to drop the whole new-epoch
            // observation rather than create an unindexed counter; the caller's
            // transport/probe path remains fail-soft and existing indexed epochs
            // continue recording normally.
            if !tracked {
                return;
            }
            XcmTraffic::<T>::mutate(epoch, day, |counters| match kind {
                XcmTrafficKind::Accepted => {
                    counters.accepted = counters.accepted.saturating_add(1);
                }
                XcmTrafficKind::SendFailed => {
                    counters.failed = counters.failed.saturating_add(1);
                }
                XcmTrafficKind::ProbeTimeout => {
                    counters.probe_timeouts = counters.probe_timeouts.saturating_add(1);
                }
            });
        }

        /// Record one day-resolved reserve-probe outcome (07 §8; SQ-195).
        ///
        /// Fail-soft and **fail-static on conflict**: a day that already
        /// recorded a failure stays failed even if a later response for that
        /// same day reports success, because 07 §8 scores the day, not the
        /// last message to arrive. Only an unrecorded day, or one already
        /// marked passed, can be written to `true`.
        pub fn note_reserve_probe(epoch: EpochId, day: u8, passed: bool) {
            // Bound the new prefix to the shared traffic index so the retention
            // walk can always find and retire it.
            let tracked = XcmTrafficEpochs::<T>::mutate(|epochs| {
                if epochs.contains(&epoch) {
                    true
                } else {
                    epochs.try_push(epoch).is_ok()
                }
            });
            if !tracked {
                return;
            }
            ReserveProbeDaily::<T>::mutate(epoch, day, |slot| match slot {
                Some(false) => {}
                _ => *slot = Some(passed),
            });
        }

        /// Read one day's reserve-probe outcome; `None` means unrecorded.
        pub fn reserve_probe_daily(epoch: EpochId, day: u8) -> Option<bool> {
            ReserveProbeDaily::<T>::get(epoch, day)
        }

        /// Record one authored parachain block against its `(epoch, day)` slot
        /// (05 §4.3).
        ///
        /// Fail-soft in the strongest sense: `pallet_authorship` drives its
        /// `EventHandler` from `on_initialize` and reserves no weight for it, so
        /// this registers its own benchmarked worst-case weight as `Mandatory`
        /// before touching storage (the `note_collator_block` pattern) and can
        /// then neither error nor panic. Counts saturate.
        ///
        /// **Overflow drops the observation, and the drop is conservative for
        /// the count components only.** Three bounds can bind: the shared
        /// [`XcmTrafficEpochs`] index (a new epoch arriving while bounded
        /// maintenance catches up), the day's own author vector, and the epoch
        /// aggregate's. A dropped author lowers a *count* — `K` is
        /// `min(1, distinct_active_authors / collator.n_min)` and `U` is monotone
        /// in recorded authorship — so for those two the drop costs a healthy
        /// chain welfare and cannot hand a degraded one a gate it did not earn
        /// (G-1). It is **not** conservative for `D_eff`, whose input is a
        /// distribution rather than a count: dropping a newly rotated author who
        /// then produces most of the window's blocks leaves the retained
        /// distribution looking more uniform than the real one, i.e. a *better*
        /// score than the truth. Each affected window therefore latches
        /// [`AuthorshipWindow::truncated`], which makes it unavailable to a
        /// concentration consumer while remaining readable by `K` and `U`.
        /// Recording into an unindexed prefix is different again: it would
        /// create state the bounded retention walk can never reach (I-20), so it
        /// is dropped whole and no window exists to flag.
        pub fn note_collator_authorship(epoch: EpochId, day: u8, who: T::AccountId) {
            frame_system::Pallet::<T>::register_extra_weight_unchecked(
                T::WeightInfo::note_collator_authorship(),
                DispatchClass::Mandatory,
            );
            // Bound the new prefix to the shared traffic index so the retention
            // walk can always find and retire it.
            let tracked = XcmTrafficEpochs::<T>::mutate(|epochs| {
                if epochs.contains(&epoch) {
                    true
                } else {
                    epochs.try_push(epoch).is_ok()
                }
            });
            if !tracked {
                return;
            }
            CollatorAuthorship::<T>::mutate(epoch, day, |window| {
                Self::observe_authorship(window, who.clone())
            });
            // The epoch aggregate is maintained here rather than folded on read,
            // so `record_snapshot` pays one bounded read instead of up to 256
            // (see [`CollatorAuthorshipEpoch`]).
            CollatorAuthorshipEpoch::<T>::mutate(epoch, |window| {
                Self::observe_authorship(window, who)
            });
        }

        /// Add one authored block for `who` to one window, latching the
        /// truncation sentinel if the window has no room for a new author.
        fn observe_authorship(window: &mut AuthorshipWindow<T>, who: T::AccountId) {
            if let Some(entry) = window.authors.iter_mut().find(|(stored, _)| *stored == who) {
                entry.1 = entry.1.saturating_add(1);
                return;
            }
            // A full window drops the *new* author only; the authors already
            // recorded keep accumulating. The sentinel records that the retained
            // distribution is no longer the real one.
            if window.authors.try_push((who, 1)).is_err() {
                window.truncated = true;
            }
        }

        /// Return one day's authorship window.
        pub fn collator_authorship(epoch: EpochId, day: u8) -> AuthorshipWindow<T> {
            CollatorAuthorship::<T>::get(epoch, day)
        }

        /// Return an epoch's authorship window — the aggregate maintained on
        /// write, so this is one bounded read and not a fold over 256 days.
        pub fn collator_authorship_epoch(epoch: EpochId) -> AuthorshipWindow<T> {
            CollatorAuthorshipEpoch::<T>::get(epoch)
        }

        /// Record one 05 §4.3.2 block-production observation against its
        /// `(epoch, day)` window.
        ///
        /// Fail-soft in the strongest sense: both call sites are per-block
        /// runtime hooks — the parachain inherent for the relay delta, the
        /// post-transaction boundary for the emptiness classification — and
        /// neither reserves any weight for this work. So the writer registers
        /// its own benchmarked worst case as `Mandatory` before touching storage
        /// (the `note_collator_block` pattern) and can then neither error nor
        /// panic. Counts saturate.
        ///
        /// **A full index drops the whole window's observations, and that is the
        /// fail-closed direction.** The shared [`XcmTrafficEpochs`] index can be
        /// full while bounded maintenance catches up; recording into an
        /// unindexed prefix would create state the bounded retention walk can
        /// never reach (I-20). Because *both* arms are refused together for such
        /// an epoch, a window that is dropped from its very first block keeps a
        /// zero denominator, and a zero denominator resolves `U` **absent** —
        /// the crank then fails status-quo-safe instead of scoring a window that
        /// was never measured (G-1). A prefix that starts recording only partway
        /// through its window loses the dropped blocks from the numerator and
        /// their relay slots from the denominator together, so neither term is
        /// silently favoured.
        pub fn note_block_production(epoch: EpochId, day: u8, signal: BlockProductionSignal) {
            frame_system::Pallet::<T>::register_extra_weight_unchecked(
                T::WeightInfo::note_block_production(),
                DispatchClass::Mandatory,
            );
            // A zero relay delta contributes nothing to either term, so it is a
            // genuine no-op and is dropped *before* any storage is touched.
            // Writing it would index the epoch and store an all-zero triple for
            // a window whose authored block has not landed yet — a stored
            // zero-denominator row, which is exactly the shape try-state treats
            // as corruption because it is indistinguishable from a window that
            // was never observed. Reachable in production: two parachain blocks
            // may share a relay parent, and the second one's authored count can
            // be attributed to the next window if the epoch clock rolls between
            // the inherent and the post-transaction boundary.
            if matches!(signal, BlockProductionSignal::RelaySlots(0)) {
                return;
            }
            // Bound the new prefix to the shared traffic index so the retention
            // walk can always find and retire it.
            let tracked = XcmTrafficEpochs::<T>::mutate(|epochs| {
                if epochs.contains(&epoch) {
                    true
                } else {
                    epochs.try_push(epoch).is_ok()
                }
            });
            if !tracked {
                return;
            }
            BlockProduction::<T>::mutate(epoch, day, |counters| match signal {
                BlockProductionSignal::RelaySlots(slots) => {
                    counters.relay_slots = counters.relay_slots.saturating_add(u64::from(slots));
                }
                BlockProductionSignal::Authored { empty: false } => {
                    counters.non_empty_blocks = counters.non_empty_blocks.saturating_add(1);
                }
                BlockProductionSignal::Authored { empty: true } => {
                    counters.empty_blocks = counters.empty_blocks.saturating_add(1);
                }
            });
        }

        /// Return one day's block-production counters (05 §4.3.2 `U^{day}`).
        pub fn block_production(epoch: EpochId, day: u8) -> BlockProductionCounters {
            BlockProduction::<T>::get(epoch, day)
        }

        /// Return the field-wise saturating sum of an epoch's block-production
        /// counters (05 §4.3.2 `U`).
        ///
        /// Summing the day slots is the whole-window observation, not an
        /// approximation of one: §4.3.2 defines both granularities as sums of
        /// the same per-block terms, and the relay deltas partition the window
        /// because each block's baseline is its predecessor — including across
        /// a day boundary, where the previous day's last block is the baseline
        /// for the next day's first.
        ///
        /// The double-map epoch prefix makes the reads proportional to days that
        /// actually recorded production; the `u8` second key hard-bounds that at
        /// 256.
        pub fn block_production_epoch(epoch: EpochId) -> BlockProductionCounters {
            BlockProduction::<T>::iter_prefix(epoch).fold(
                BlockProductionCounters::default(),
                |mut total, (_, counters)| {
                    total.non_empty_blocks = total
                        .non_empty_blocks
                        .saturating_add(counters.non_empty_blocks);
                    total.empty_blocks = total.empty_blocks.saturating_add(counters.empty_blocks);
                    total.relay_slots = total.relay_slots.saturating_add(counters.relay_slots);
                    total
                },
            )
        }

        /// Return the local XCM counters for one epoch/day window.
        pub fn xcm_traffic(epoch: EpochId, day: u8) -> XcmTrafficCounters {
            XcmTraffic::<T>::get(epoch, day)
        }

        /// Return the field-wise saturating sum of an epoch's local XCM counters.
        ///
        /// The double-map epoch prefix makes the reads proportional to days that
        /// actually recorded traffic; the `u8` second key hard-bounds that at 256.
        pub fn xcm_traffic_epoch(epoch: EpochId) -> XcmTrafficCounters {
            XcmTraffic::<T>::iter_prefix(epoch).fold(
                XcmTrafficCounters::default(),
                |mut total, (_, counters)| {
                    total.accepted = total.accepted.saturating_add(counters.accepted);
                    total.failed = total.failed.saturating_add(counters.failed);
                    total.probe_timeouts =
                        total.probe_timeouts.saturating_add(counters.probe_timeouts);
                    total
                },
            )
        }

        /// Full core state rebuilt from the three frozen storage mirrors.
        pub fn welfare_state() -> WelfareState {
            Self::load()
        }

        /// Seed a checked core state for tests and worst-case benchmarks.
        #[cfg(any(test, feature = "runtime-benchmarks"))]
        pub fn seed(state: &WelfareState) -> DispatchResult {
            let mut state = state.clone();
            state.events.clear();
            let pre = Self::load();
            Self::persist(&pre, state)
        }

        fn live_params() -> Result<CoreWelfareParams, DispatchError> {
            let params = T::Params::welfare_params();
            params
                .validate()
                .map_err(|_| DispatchError::from(Error::<T>::BadParams))?;
            Ok(params)
        }

        /// SQ-79: the core refuses a zero-sample e+1…e+2 window rather than
        /// settling gate books at "no breach" on absent observations.
        fn gate_outcomes(cohort_epoch: EpochId) -> Result<(bool, bool), DispatchError> {
            Self::load()
                .gate_window_outcomes(cohort_epoch)
                .map_err(Self::map_core_error)
        }

        fn load() -> WelfareState {
            let mut specs = MetricSpecs::<T>::iter()
                .map(|(version, specs)| (version, specs.into_inner()))
                .collect::<Vec<_>>();
            specs.sort_by_key(|(version, _)| *version);
            let mut snapshots = Snapshots::<T>::iter()
                .map(|(_, snapshot)| CoreSnapshot::from(snapshot))
                .collect::<Vec<_>>();
            snapshots.sort_by_key(|snapshot| (snapshot.epoch, snapshot.spec_version));
            let mut snapshot_contexts = SnapshotContexts::<T>::iter()
                .map(|(_, context)| CoreSnapshotContext::from(context))
                .collect::<Vec<_>>();
            snapshot_contexts.sort_by_key(|context| (context.epoch, context.spec_version));
            let mut gate_flags = GateBreachFlags::<T>::iter().collect::<Vec<_>>();
            gate_flags.sort_by_key(|(epoch, _)| *epoch);
            WelfareState {
                specs,
                snapshots,
                snapshot_contexts,
                gate_flags,
                events: Vec::new(),
            }
        }

        fn mutate(op: impl FnOnce(&mut WelfareState) -> Result<(), CoreError>) -> DispatchResult {
            let pre = Self::load();
            let mut post = pre.clone();
            op(&mut post).map_err(Self::map_core_error)?;
            Self::persist(&pre, post)
        }

        fn persist(pre: &WelfareState, post: WelfareState) -> DispatchResult {
            let (specs, snapshots, snapshot_contexts, gate_flags) = Self::checked_storage(&post)?;

            // SQ-497 — write the *difference*, not the whole mirror.
            //
            // This used to remove every key named by `pre` and re-insert every
            // key named by `post`, so adding one snapshot wrote ~80 keys. On a
            // parachain each of those writes is proof the block has to carry,
            // and none of them changed a value.
            //
            // Equality is decided against **stored** state rather than against
            // `pre`. That is deliberate: `pre` is a core-shaped clone and the
            // core → stored conversions are lossy in representation (bounded
            // containers, packed contexts), so comparing core values would be
            // comparing something other than what is written.
            //
            // The comparison reads are nearly free. `load()` already iterated all
            // four maps in this same call, so every *existing* key's proof node
            // is in the PoV already; only a key being created costs a genuinely
            // new read. Measured, the trade is +1 to +2 reads against ~75 fewer
            // writes: `record_snapshot` 102 r / 80 w → 104 r / 6 w,
            // `record_daily_gate` 98 / 81 → 99 / 6, `register_spec` 77 w → 2 w.
            let live_specs = specs
                .iter()
                .map(|(version, _)| *version)
                .collect::<Vec<_>>();
            for (version, _) in &pre.specs {
                if !live_specs.contains(version) {
                    MetricSpecs::<T>::remove(version);
                }
            }
            for (version, spec_set) in specs {
                if MetricSpecs::<T>::get(version).as_ref() != Some(&spec_set) {
                    MetricSpecs::<T>::insert(version, spec_set);
                }
            }

            let live_snapshots = snapshots.iter().map(|(key, _)| *key).collect::<Vec<_>>();
            for snapshot in &pre.snapshots {
                let key = (snapshot.epoch, snapshot.spec_version);
                if !live_snapshots.contains(&key) {
                    Snapshots::<T>::remove(key);
                }
            }
            for (key, snapshot) in snapshots {
                if Snapshots::<T>::get(key).as_ref() != Some(&snapshot) {
                    Snapshots::<T>::insert(key, snapshot);
                }
            }

            let live_contexts = snapshot_contexts
                .iter()
                .map(|(key, _)| *key)
                .collect::<Vec<_>>();
            for context in &pre.snapshot_contexts {
                let key = (context.epoch, context.spec_version);
                if !live_contexts.contains(&key) {
                    SnapshotContexts::<T>::remove(key);
                }
            }
            for (key, context) in snapshot_contexts {
                if SnapshotContexts::<T>::get(key).as_ref() != Some(&context) {
                    SnapshotContexts::<T>::insert(key, context);
                }
            }

            let live_gate_flags = gate_flags
                .iter()
                .map(|(epoch, _)| *epoch)
                .collect::<Vec<_>>();
            for (epoch, _) in &pre.gate_flags {
                if !live_gate_flags.contains(epoch) {
                    GateBreachFlags::<T>::remove(epoch);
                }
            }
            for (epoch, flags) in gate_flags {
                if GateBreachFlags::<T>::get(epoch).as_ref() != Some(&flags) {
                    GateBreachFlags::<T>::insert(epoch, flags);
                }
            }
            for event in post.events {
                Self::deposit_core_event(event);
            }
            Ok(())
        }

        fn checked_storage(state: &WelfareState) -> Result<CheckedStorage, DispatchError> {
            if state.specs.len() > MAX_METRIC_SPECS {
                return Err(Error::<T>::TooManyMetricSpecs.into());
            }
            if state.snapshots.len() > MAX_SNAPSHOTS {
                return Err(Error::<T>::TooManySnapshots.into());
            }
            if state.gate_flags.len() > MAX_GATE_FLAGS {
                return Err(Error::<T>::TooManyGateFlags.into());
            }
            let specs = state
                .specs
                .iter()
                .map(|(version, specs)| {
                    BoundedVec::try_from(specs.clone())
                        .map(|specs| (*version, specs))
                        .map_err(|_| Error::<T>::TooManyComponents.into())
                })
                .collect::<Result<Vec<_>, DispatchError>>()?;
            let snapshots = state
                .snapshots
                .iter()
                .cloned()
                .map(StoredSnapshot::try_from)
                .collect::<Result<Vec<_>, CoreError>>()
                .map_err(Self::map_core_error)?;
            let snapshots = snapshots
                .into_iter()
                .map(|snapshot| ((snapshot.epoch, snapshot.spec_version), snapshot))
                .collect();
            if state.snapshot_contexts.len() > MAX_SNAPSHOTS {
                return Err(Error::<T>::TooManySnapshots.into());
            }
            let snapshot_contexts = state
                .snapshot_contexts
                .iter()
                .cloned()
                .map(StoredSnapshotContext::try_from)
                .collect::<Result<Vec<_>, CoreError>>()
                .map_err(Self::map_core_error)?
                .into_iter()
                .map(|context| ((context.epoch, context.spec_version), context))
                .collect();
            let gate_flags = state.gate_flags.clone();
            Ok((specs, snapshots, snapshot_contexts, gate_flags))
        }

        fn deposit_core_event(event: CoreEvent) {
            let event = match event {
                CoreEvent::MetricSpecRegistered { version } => {
                    Event::MetricSpecRegistered { version }
                }
                CoreEvent::SnapshotRecorded {
                    epoch,
                    spec_version,
                    welfare,
                } => Event::SnapshotRecorded {
                    epoch,
                    spec_version,
                    welfare,
                },
                CoreEvent::GateBreachRecorded {
                    epoch,
                    day,
                    s_breached,
                    c_breached,
                } => Event::GateBreachRecorded {
                    epoch,
                    day,
                    s_breached,
                    c_breached,
                },
                CoreEvent::SettlementComputed {
                    epoch,
                    spec_version,
                    score,
                } => Event::SettlementComputed {
                    epoch,
                    spec_version,
                    score,
                },
                CoreEvent::SettlementRenormalized {
                    epoch,
                    spec_version,
                    dropped,
                } => Event::SettlementRenormalized {
                    epoch,
                    spec_version,
                    // The core normalizes the set against the version's own
                    // component list, which is itself bounded by
                    // `MAX_COMPONENTS_PER_SPEC`, so this cannot truncate.
                    dropped: BoundedVec::truncate_from(dropped),
                },
            };
            Self::deposit_event(event);
        }

        /// Rebuild and validate the core plus every map key/value invariant.
        pub fn do_try_state() -> Result<(), TryRuntimeError> {
            let state = Self::load();
            state.try_state().map_err(|_| {
                TryRuntimeError::Other("welfare core try_state failed (I-16/bounds)")
            })?;
            T::Params::welfare_params().validate().map_err(|_| {
                TryRuntimeError::Other("welfare live Params violate kernel floors or weight sum")
            })?;
            if let Some(progress) = SnapshotDeadline::<T>::get() {
                let first_due = MetricSpecs::<T>::iter_values()
                    .filter_map(|specs| specs.iter().map(|spec| spec.activation_epoch).max())
                    .min();
                let expected_epoch = match progress.last_snapshot_epoch {
                    Some(last) => last.checked_add(1),
                    None => first_due,
                };
                if expected_epoch != Some(progress.due_epoch)
                    || T::SnapshotSchedule::snapshot_due(progress.due_epoch).is_none()
                {
                    return Err(TryRuntimeError::Other(
                        "welfare snapshot deadline is not schedule-derived",
                    ));
                }
                if let Some(last) = progress.last_snapshot_epoch {
                    let Some(spec_version) = Self::active_snapshot_spec(last) else {
                        return Err(TryRuntimeError::Other(
                            "welfare snapshot deadline has no canonical prior spec",
                        ));
                    };
                    if !Snapshots::<T>::contains_key((last, spec_version)) {
                        return Err(TryRuntimeError::Other(
                            "welfare snapshot deadline lacks its prior snapshot",
                        ));
                    }
                }
            }
            if MetricSpecs::<T>::iter().count() > MAX_METRIC_SPECS
                || Snapshots::<T>::iter().count() > MAX_SNAPSHOTS
                || SnapshotContexts::<T>::iter().count() > MAX_SNAPSHOTS
                || GateBreachFlags::<T>::iter().count() > MAX_GATE_FLAGS
                || SampledGateDays::<T>::iter().count() > MAX_GATE_FLAGS
            {
                return Err(TryRuntimeError::Other(
                    "welfare map entry count exceeds its core bound",
                ));
            }
            for (version, specs) in MetricSpecs::<T>::iter() {
                if specs.iter().any(|spec| spec.version != version) {
                    return Err(TryRuntimeError::Other(
                        "welfare metric-spec map key does not match its value",
                    ));
                }
            }
            for (key, snapshot) in Snapshots::<T>::iter() {
                if key != (snapshot.epoch, snapshot.spec_version) {
                    return Err(TryRuntimeError::Other(
                        "welfare snapshot map key does not match its value",
                    ));
                }
                StoredSnapshot::try_from(CoreSnapshot::from(snapshot)).map_err(|_| {
                    TryRuntimeError::Other("welfare snapshot violates its component bound")
                })?;
                // 07 §10: the context is written and retired with its snapshot,
                // and settlement treats an absent one as corruption rather than
                // as an unflagged epoch — so the pairing is checked here in both
                // directions (the core checks the counts and the flag contents).
                if !SnapshotContexts::<T>::contains_key(key) {
                    return Err(TryRuntimeError::Other(
                        "welfare snapshot has no 07 §10 settlement context",
                    ));
                }
            }
            for (key, context) in SnapshotContexts::<T>::iter() {
                if key != (context.epoch, context.spec_version) {
                    return Err(TryRuntimeError::Other(
                        "welfare snapshot-context map key does not match its value",
                    ));
                }
                if !Snapshots::<T>::contains_key(key) {
                    return Err(TryRuntimeError::Other(
                        "welfare settlement context outlived its snapshot",
                    ));
                }
            }
            for epoch in SampledGateDays::<T>::iter_keys() {
                if !GateBreachFlags::<T>::contains_key(epoch) {
                    return Err(TryRuntimeError::Other(
                        "welfare sampled-gate marker has no corresponding gate record",
                    ));
                }
            }
            let current_epoch = T::CurrentEpoch::get();
            let traffic_epochs = XcmTrafficEpochs::<T>::get();
            if traffic_epochs.len() > MAX_XCM_TRAFFIC_EPOCHS_BOUND as usize {
                return Err(TryRuntimeError::Other(
                    "welfare XCM traffic index exceeds its epoch bound",
                ));
            }
            for (position, epoch) in traffic_epochs.iter().enumerate() {
                if *epoch > current_epoch {
                    return Err(TryRuntimeError::Other(
                        "welfare XCM traffic index lies in the future",
                    ));
                }
                if traffic_epochs[..position].contains(epoch) {
                    return Err(TryRuntimeError::Other(
                        "welfare XCM traffic index contains a duplicate epoch",
                    ));
                }
                // SQ-195: the index is shared with `ReserveProbeDaily`, so an
                // epoch carrying only reserve-probe outcomes is legitimately
                // indexed with no traffic counter. A reserve-probe outcome can
                // be recorded on a day that saw no local XCM at all — notably
                // a budget refusal, which happens before the router is ever
                // observed — so requiring traffic here would fail try-state on
                // correct state.
                // A14 adds two more co-indexed series for the same reason: a
                // block is produced — and authored — in every epoch, including
                // one that sent no XCM and ran no probe, so an authorship-only
                // or block-production-only prefix is correct state.
                if XcmTraffic::<T>::iter_prefix(*epoch).next().is_none()
                    && ReserveProbeDaily::<T>::iter_prefix(*epoch).next().is_none()
                    && CollatorAuthorship::<T>::iter_prefix(*epoch)
                        .next()
                        .is_none()
                    && !CollatorAuthorshipEpoch::<T>::contains_key(*epoch)
                    && BlockProduction::<T>::iter_prefix(*epoch).next().is_none()
                {
                    return Err(TryRuntimeError::Other(
                        "welfare traffic index has no corresponding counter, probe outcome, authorship record, or block-production record",
                    ));
                }
            }
            for (epoch, _, counters) in XcmTraffic::<T>::iter() {
                if epoch > current_epoch {
                    return Err(TryRuntimeError::Other(
                        "welfare XCM traffic lies in the future",
                    ));
                }
                if !traffic_epochs.contains(&epoch) {
                    return Err(TryRuntimeError::Other(
                        "welfare XCM traffic counter has no indexed epoch",
                    ));
                }
                if counters.accepted == 0 && counters.failed == 0 && counters.probe_timeouts == 0 {
                    return Err(TryRuntimeError::Other(
                        "welfare XCM traffic stores an all-zero counter triple",
                    ));
                }
            }
            // SQ-195: every recorded probe day must be indexed and in the past,
            // so the bounded retention walk can always reach and retire it
            // (I-20/I-21) and no outcome can be attributed to a future epoch.
            for (epoch, _, _) in ReserveProbeDaily::<T>::iter() {
                if epoch > current_epoch {
                    return Err(TryRuntimeError::Other(
                        "welfare reserve-probe outcome lies in the future",
                    ));
                }
                if !traffic_epochs.contains(&epoch) {
                    return Err(TryRuntimeError::Other(
                        "welfare reserve-probe outcome has no indexed epoch",
                    ));
                }
            }
            // A14: the same two properties for the collator-authorship series —
            // every recorded window is indexed, so the bounded retention walk
            // can reach and retire it (I-20/I-21), and no authorship is
            // attributed to an epoch the clock has not reached.
            for (epoch, _, window) in CollatorAuthorship::<T>::iter() {
                Self::check_authorship_window(&window, epoch, current_epoch, &traffic_epochs)?;
                // The pairing is checked in **both** directions, like the
                // snapshot ↔ settlement-context one above: the writer maintains
                // the day window and the aggregate in the same call, so an
                // aggregate missing beneath a recorded day is a writer that
                // stopped maintaining it — and the totals check below cannot see
                // that, because it iterates aggregates and would simply skip the
                // epoch.
                if !CollatorAuthorshipEpoch::<T>::contains_key(epoch) {
                    return Err(TryRuntimeError::Other(
                        "welfare collator authorship day window has no epoch aggregate",
                    ));
                }
            }
            // The epoch aggregate is derived state maintained on write,
            // so its agreement with the day series is an invariant and not an
            // assumption. Where neither side dropped an observation the two must
            // account for the same blocks; a divergence means the writer missed
            // one of its two windows, which would silently move every component
            // reading the aggregate.
            for (epoch, window) in CollatorAuthorshipEpoch::<T>::iter() {
                Self::check_authorship_window(&window, epoch, current_epoch, &traffic_epochs)?;
                if window.truncated {
                    continue;
                }
                let mut day_total: u64 = 0;
                let mut day_truncated = false;
                for (_, day_window) in CollatorAuthorship::<T>::iter_prefix(epoch) {
                    day_truncated |= day_window.truncated;
                    for (_, blocks) in day_window.authors.iter() {
                        day_total = day_total.saturating_add(u64::from(*blocks));
                    }
                }
                let epoch_total = window.authors.iter().fold(0u64, |sum, (_, blocks)| {
                    sum.saturating_add(u64::from(*blocks))
                });
                // A count that saturated at `u32::MAX` would diverge honestly,
                // but a retained epoch spans at most `epoch.length` blocks
                // (13 §2, days not billions), so the case is unreachable and is
                // skipped rather than encoded as a legal divergence.
                if !day_truncated && day_total <= u64::from(u32::MAX) && day_total != epoch_total {
                    return Err(TryRuntimeError::Other(
                        "welfare collator authorship aggregate disagrees with its day series",
                    ));
                }
            }
            // A14: the same two properties for the 05 §4.3.2 block-production
            // series — every recorded day is indexed, so the bounded retention
            // walk can reach and retire it (I-20/I-21), and no production is
            // attributed to an epoch the clock has not reached. An all-zero
            // triple is rejected for the same reason the traffic counters are:
            // the writer never stores one, so its presence means either an
            // orphaned key or a lost accumulator, and `U` divides by
            // `relay_slots` — a stored zero-denominator row is indistinguishable
            // from a window that was never observed.
            for (epoch, _, counters) in BlockProduction::<T>::iter() {
                if epoch > current_epoch {
                    return Err(TryRuntimeError::Other(
                        "welfare block production lies in the future",
                    ));
                }
                if !traffic_epochs.contains(&epoch) {
                    return Err(TryRuntimeError::Other(
                        "welfare block production has no indexed epoch",
                    ));
                }
                if counters.non_empty_blocks == 0
                    && counters.empty_blocks == 0
                    && counters.relay_slots == 0
                {
                    return Err(TryRuntimeError::Other(
                        "welfare block production stores an all-zero counter triple",
                    ));
                }
            }
            Ok(())
        }

        /// The properties every 05 §4.3 authorship window shares, whichever map
        /// holds it.
        ///
        /// The per-window bound is checked explicitly rather than trusted to the
        /// decoder: a `BoundedVec` decoded from corrupt state is exactly what
        /// try-state exists to catch, and `K` divides a distinct-author count by
        /// a live parameter, so an over-long vector would read as extra authors.
        fn check_authorship_window(
            window: &AuthorshipWindow<T>,
            epoch: EpochId,
            current_epoch: EpochId,
            traffic_epochs: &[EpochId],
        ) -> Result<(), TryRuntimeError> {
            if epoch > current_epoch {
                return Err(TryRuntimeError::Other(
                    "welfare collator authorship lies in the future",
                ));
            }
            if !traffic_epochs.contains(&epoch) {
                return Err(TryRuntimeError::Other(
                    "welfare collator authorship has no indexed epoch",
                ));
            }
            if window.authors.len() > T::MaxCollatorAuthorshipEntries::get() as usize {
                return Err(TryRuntimeError::Other(
                    "welfare collator authorship exceeds its per-window bound",
                ));
            }
            if window.authors.is_empty() {
                return Err(TryRuntimeError::Other(
                    "welfare collator authorship stores an empty author set",
                ));
            }
            Ok(())
        }

        pub(crate) fn map_core_error(error: CoreError) -> DispatchError {
            match error {
                CoreError::BadOrigin => DispatchError::BadOrigin,
                CoreError::TooManyMetricSpecs => Error::<T>::TooManyMetricSpecs.into(),
                CoreError::TooManySnapshots => Error::<T>::TooManySnapshots.into(),
                CoreError::TooManyComponents => Error::<T>::TooManyComponents.into(),
                CoreError::TooManyGateFlags => Error::<T>::TooManyGateFlags.into(),
                CoreError::DuplicateSpecVersion => Error::<T>::DuplicateSpecVersion.into(),
                CoreError::SpecNotFound => Error::<T>::SpecNotFound.into(),
                CoreError::BadActivationEpoch => Error::<T>::BadActivationEpoch.into(),
                CoreError::SpecNotActive => Error::<T>::SpecNotActive.into(),
                CoreError::MissingMetricDiscipline => Error::<T>::MissingMetricDiscipline.into(),
                CoreError::BadEpsilonFloor => Error::<T>::BadEpsilonFloor.into(),
                CoreError::BadSourceClass => Error::<T>::BadSourceClass.into(),
                CoreError::BadWeightSum => Error::<T>::BadWeightSum.into(),
                CoreError::ValueOutOfRange => Error::<T>::ValueOutOfRange.into(),
                CoreError::MissingComponent => Error::<T>::MissingComponent.into(),
                CoreError::DuplicateComponent => Error::<T>::DuplicateComponent.into(),
                CoreError::DuplicateSnapshot => Error::<T>::DuplicateSnapshot.into(),
                CoreError::ArithmeticOverflow => Error::<T>::ArithmeticOverflow.into(),
                CoreError::TryStateViolation => Error::<T>::TryStateViolation.into(),
                CoreError::GateWindowUnsampled => Error::<T>::GateWindowUnsampled.into(),
                CoreError::MilestoneTargetUnset => Error::<T>::MilestoneTargetUnset.into(),
                CoreError::BadDeltaSMax => Error::<T>::BadDeltaSMax.into(),
                CoreError::InsufficientOracleSeats => Error::<T>::InsufficientOracleSeats.into(),
                CoreError::BondCoverageUnmet => Error::<T>::BondCoverageUnmet.into(),
                CoreError::BadFlaggedComponent => Error::<T>::BadFlaggedComponent.into(),
                CoreError::MissingSnapshotContext => Error::<T>::MissingSnapshotContext.into(),
                CoreError::EmptyNormalizationSample => Error::<T>::EmptyNormalizationSample.into(),
                CoreError::DegenerateNormalizationRange => {
                    Error::<T>::DegenerateNormalizationRange.into()
                }
            }
        }
    }
}
