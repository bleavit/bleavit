//! Monitoring-only runtime telemetry (12 §6.3, B13).
//!
//! This module is explicitly outside the frozen 02 integration contract. The
//! frontend never consumes it, it carries no integration-contract version, and
//! its shape may change without a 02 §13 bump. Every collection is bounded so
//! an operations scrape remains deterministic and bounded in runtime work.

use futarchy_primitives::{bounds, Balance, BlockNumber, BoundedVec, ClientId, FixedU64, MarketId};
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

/// Storage rows fit the generic bounded-meter registry capacity (13 §4).
pub const MAX_STORAGE_UTILIZATION_ROWS: u32 = bounds::MAX_METERS;
/// Stable snake-case map names are deliberately short and bounded.
pub const MAX_STORAGE_NAME_BYTES: u32 = 48;
/// Every live market may carry eight overlapping registered windows.
pub const MAX_WINDOW_COVERAGE_ROWS: u32 =
    bounds::MAX_LIVE_MARKETS * bounds::MAX_TWAP_WINDOWS_PER_MARKET;
/// The POL telemetry view has one row for each independently funded component.
pub const MAX_POL_TELEMETRY_ROWS: u32 = 2;

/// Audited maker-loss state for one live LMSR book.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct MarketTelemetry {
    pub market: MarketId,
    /// Realized seeded inventory consumed, in USDC base units.
    pub book_loss_usdc: Balance,
    /// `seed_headroom(b) = ceil(b·ln 2)`, in USDC base units.
    pub lmsr_loss_bound_usdc: Balance,
}

/// Live scheduled-observation coverage for one unsealed decision window.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct WindowCoverageTelemetry {
    pub market: MarketId,
    pub start: BlockNumber,
    pub end: BlockNumber,
    pub coverage_percent: u8,
}

/// Independently funded POL components (SQ-266).
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
pub enum PolComponent {
    Pol,
    Baseline,
}

/// Effective funding and matching floor for one POL component.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct PolTelemetry {
    pub component: PolComponent,
    pub effective_pol_usdc: Balance,
    pub pol_floor_usdc: Balance,
}

/// The exact custody/liability quantities used by ledger try-state L-2.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct CollateralTelemetry {
    pub custody_usdc: Balance,
    pub liability_usdc: Balance,
    /// Positive unexplained custody residue; zero on exact conservation.
    pub anomalous_rounding_dust_usdc: Balance,
}

/// Occupancy for a bounded storage shape portable metadata cannot pair with a bound.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct StorageUtilizationTelemetry {
    pub map: BoundedVec<u8, MAX_STORAGE_NAME_BYTES>,
    pub entries: u32,
    pub bound: u32,
}

/// Isolated per-client hosted-report delivery diagnostics (I-36). These
/// counters are not inputs to any protocol or welfare calculation.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct ServiceEgressTelemetry {
    pub client_id: ClientId,
    pub attempts: u64,
    pub failures: u64,
    pub consecutive_failures: u32,
}

/// 16 §8.4's cannibalization falsifier and §8.5's partition occupancy, as one
/// row (12 §6.3). Monitoring-only, like every other member of this trait: none
/// of these values is an input to a protocol or welfare calculation, and the
/// §8.4 falsifier in particular is *evidence for a values decision*, not a
/// controller input — nothing on chain reads it back.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct ServicePartitionTelemetry {
    /// Hosted questions in a non-terminal phase, right now.
    pub questions_live: u32,
    /// The live `svc.max_live` cap they are counted against. Published beside
    /// the count so the alert rule compares occupancy against the *current*
    /// governed bound rather than against a literal the exporter would have to
    /// carry (13 reading rules; 15 §5.4).
    pub max_live: u32,
    /// 16 §8.4's falsifier, external side: posted client subsidy across live
    /// hosted books, in the same units `LivePolCommitments` stores, so the two
    /// sides of `Σ b_ext ≤ Σ pol.b(live)` are directly comparable.
    pub contest_capital_external: Balance,
    /// 16 §8.4's falsifier, outcome side: cumulative Bleavit proposals rejected
    /// `NotDecisionGrade`. **Read together with the line above, never alone** —
    /// §8.4 states plainly that a rejection caused by the hosted service is
    /// indistinguishable from one caused by disinterest, which is why the
    /// external capital is the trigger and this is corroboration.
    pub not_decision_grade_rejections: u64,
    /// 16 §8.5: external weight consumed as a fraction of the external quota,
    /// on the `SCORE_SCALE` grid. Saturates at one rather than reporting past
    /// the quota, because the partition refuses rather than overruns.
    pub external_weight_used_ratio_1e9: FixedU64,
}

sp_api::decl_runtime_apis! {
    /// Monitoring-only telemetry API owned by 12 §6.3, outside contract 02.
    #[api_version(5)]
    pub trait TelemetryApi {
        /// Per-live-book realized loss and its identically labeled LMSR bound.
        fn market_books() -> Option<BoundedVec<MarketTelemetry, { bounds::MAX_LIVE_MARKETS }>>;
        /// Every currently active, unsealed decision window.
        fn mid_window_coverage() -> Option<BoundedVec<WindowCoverageTelemetry, MAX_WINDOW_COVERAGE_ROWS>>;
        /// POL and Baseline funding compared independently to their matching requirements.
        fn pol() -> Option<BoundedVec<PolTelemetry, MAX_POL_TELEMETRY_ROWS>>;
        /// Ledger L-2 custody and liability, plus the anomalous positive residue component.
        fn collateral() -> Option<CollateralTelemetry>;
        /// Service-ledger L-2 custody and liability, independently audited for I-37.
        fn service_collateral() -> Option<CollateralTelemetry>;
        /// Live USDC balance of the local `ops.reserve_probe` budget line.
        fn reserve_probe_line_balance() -> Balance;
        /// Canonical PB-MIGRATION cursor-stall detector state.
        fn migration_cursor_stalled() -> bool;
        /// Metadata-invisible bounded collection occupancy rows.
        fn storage_utilization() -> Option<BoundedVec<StorageUtilizationTelemetry, MAX_STORAGE_UTILIZATION_ROWS>>;
        /// Bounded, sorted client push counters; explicitly non-welfare.
        fn service_egress() -> Option<BoundedVec<ServiceEgressTelemetry, { bounds::MAX_CLIENTS }>>;
        /// 16 §8.4 cannibalization falsifier + §8.5 partition occupancy (N7).
        fn service_partition() -> Option<ServicePartitionTelemetry>;
    }
}
