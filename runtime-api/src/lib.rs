#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

//! Bleavit runtime-API declarations.
//!
//! The frozen 16-method [`FutarchyApi`] surface is specified by the integration
//! contract (02 §3). The separate [`telemetry`] module is monitoring-only and
//! explicitly outside that contract (12 §6.3). Both are read-only, bounded, and
//! shared with their respective clients.

pub mod telemetry;

#[cfg(not(feature = "std"))]
pub use runtime_decl_for_telemetry_api::TelemetryApi;
pub use telemetry::runtime_decl_for_telemetry_api;
#[cfg(feature = "std")]
pub use telemetry::TelemetryApi;
pub use telemetry::{
    CollateralTelemetry, MarketTelemetry, PolComponent, PolTelemetry, ServiceEgressTelemetry,
    ServicePartitionTelemetry, StorageUtilizationTelemetry, WindowCoverageTelemetry,
    MAX_POL_TELEMETRY_ROWS, MAX_STORAGE_NAME_BYTES, MAX_STORAGE_UTILIZATION_ROWS,
    MAX_WINDOW_COVERAGE_ROWS,
};

use futarchy_primitives::{
    bounds, AccountId, Balance, BondQuoteRequest, BondQuoteView, BoundedVec, CohortSummaryView,
    DecisionStatsView, EpochStatusView, MarketId, NavView, OracleRoundView, ParamKey, ParamView,
    PositionView, ProposalId, ProposalSummaryView, QuestionId, QueuedExecutionView, QuoteView,
    ReportView, StreamView, TradeSide, WelfareView,
};

/// Maximum number of queued executions returned by [`FutarchyApi::execution_queue`]
/// (02 §3, `futarchy_primitives::BoundedVec<QueuedExecutionView, 32>`). The queue
/// can never hold more than every live proposal, so the bound is single-homed to
/// `MaxLiveProposals` (rule 4) — exactly how `execution-guard-core` derives its
/// `MAX_QUEUE`.
pub const MAX_QUEUED_EXECUTIONS: u32 = bounds::MAX_LIVE_PROPOSALS;

sp_api::decl_runtime_apis! {
    /// The frozen Bleavit read-only runtime API (02 §3).
    #[api_version(5)]
    pub trait FutarchyApi {
        /// Epoch clock: index, phase, boundaries, dead-man, freeze and phase flags.
        fn epoch_status() -> EpochStatusView;
        /// All live proposals with market ids, states, decide_at, maturity, ratification.
        fn proposal_summaries() -> BoundedVec<ProposalSummaryView, { bounds::MAX_PROPOSAL_SUMMARIES }>;
        /// Exact quote incl. fee for a hypothetical trade at current book state (USDC-denominated, D-3 wrapper semantics).
        fn quote(market: MarketId, side: TradeSide, amount: Balance) -> QuoteView;
        /// Finalized decision statistics from sealed registered windows (incl. D-4 sizing).
        fn decision_stats(pid: ProposalId) -> Option<DecisionStatsView>;
        /// All positions of an account across proposal, gate and Baseline instruments.
        fn account_positions(who: AccountId) -> BoundedVec<PositionView, { bounds::MAX_ACCOUNT_POSITIONS }>;
        /// Execution queue incl. maturity/grace/version/ratification state.
        fn execution_queue() -> BoundedVec<QueuedExecutionView, { MAX_QUEUED_EXECUTIONS }>;
        /// Current welfare pillars, gates, breach + reserve flags, active MetricSpec.
        fn welfare_current() -> WelfareView;
        /// Typed constitution params (value + bounds + governance metadata) for ≤ 64 keys.
        fn params(keys: BoundedVec<ParamKey, { bounds::MAX_PARAM_KEYS }>) -> BoundedVec<ParamView, { bounds::MAX_PARAM_KEYS }>;
        /// Treasury NAV components (matches the treasury definition in 08), incl. haircut flag.
        fn nav() -> NavView;
        /// Ring of the last 32 cohort settlements (mirrors RecentCohortSummaries, §7.1).
        fn recent_cohorts() -> BoundedVec<CohortSummaryView, { bounds::RECENT_COHORT_SUMMARIES }>;
        /// Oracle rounds currently open.
        fn open_oracle_rounds() -> BoundedVec<OracleRoundView, { bounds::MAX_OPEN_ORACLE_ROUNDS }>;
        /// Immutable hosted report, available from `Sealed` through archive.
        fn hosted_report(question_id: QuestionId) -> Option<ReportView>;
        /// All positions of an account in the service ledger domain
        /// (`ServiceLedger` = `pallet_conditional_ledger::<Instance1>`, 02 §7.1).
        ///
        /// Deliberately separate from [`FutarchyApi::account_positions`] rather than
        /// merged into it: `MAX_ACCOUNT_POSITIONS` is enforced per account *per
        /// instance*, so both domains can be simultaneously full and one shared
        /// return vector would truncate a user's real holdings (02 §3, v23).
        fn service_positions(who: AccountId) -> BoundedVec<PositionView, { bounds::MAX_ACCOUNT_POSITIONS }>;
        /// Whether an account is a **reserved protocol destination** — the exact
        /// predicate `ledger.transfer` refuses on (02 §3, v25).
        ///
        /// This is the chain read behind 11 §11.5's P-9 clause, and it is a method
        /// rather than a published derivation for one reason: §11.4 rule 2 requires
        /// every precondition row to be *an exact chain read*, and a client that
        /// recomputed the predicate from frozen constants would be evaluating a
        /// computation. The distinction is the same one that made
        /// `ConditionalLedger::ServiceIdBase` correctly a metadata constant — that
        /// classifies a datum the client already holds; this asks the chain a
        /// question about an address the user just typed.
        ///
        /// Deliberately **not** `MarketProtocolAccounts::contains_key`. That index is
        /// ownership/refcount state for deposit exemption and is strictly narrower:
        /// classification does not depend on it, because every canonical
        /// future/present/past book address is reserved by namespace whether or not a
        /// book currently references it (SQ-588). A client bound to the narrower
        /// predicate would pass a row the runtime then refuses.
        fn is_reserved_protocol_destination(who: AccountId) -> bool;
        /// What a **not-yet-created** bonded action would hold, priced at the
        /// current block (02 §3/§4, contract v29; 07 §6.1, §7).
        ///
        /// One method for both bonds, because 07 states **one** fold under two
        /// names: `StakeAtRisk(c, m)` and `Exposure(kind, m)` are the same sum of
        /// `CohortEscrow(k)` over live cohort schedules, differing only in which
        /// cohorts are in scope. Two methods would publish it twice and let the
        /// copies drift.
        ///
        /// It returns the **amount**, not the ingredients. 07 §6.1 states three
        /// separable normative details — the `/ 10,000` division rounds up,
        /// rounding resolves toward custody, and the `max` against the floor
        /// applies after rounding — and a client applying them itself would own
        /// them. Under-collateralizing a bond is the under-custody direction
        /// (I-4 / I-28), and this is money a user must post. The challenge side
        /// is already symmetric: it reads `OracleRoundView.bond`, the chain's own
        /// frozen figure.
        ///
        /// `None` is a **first-class answer**, not an error: 07 §7 makes the
        /// Milestone exposure not determinable until the aggregate is bound to a
        /// component, and `file` MUST then refuse with `ExposureUnavailable` —
        /// the status-quo default (G-1). A client receiving `None` blocks.
        fn bond_quote(request: BondQuoteRequest) -> Option<BondQuoteView>;
        /// Every outbound treasury stream whose recipient is `who`, each with the
        /// exact amount `futarchy_treasury.claim_stream` would pay now
        /// (02 §3/§4, contract v29; 11 §11.8.3).
        ///
        /// A per-caller projection rather than frozen `pallet-futarchy-treasury`
        /// storage, and that **preserves** §7.6's closing rule rather than
        /// carving into it: the rule forbids binding *raw storage*, and a
        /// published runtime-API projection is not raw storage — `nav()` is
        /// itself one. It also keeps 11 §11.4 rule 2's exact-chain-read
        /// property, which a stated exception would give up.
        fn treasury_streams(who: AccountId) -> BoundedVec<StreamView, { bounds::MAX_TREASURY_STREAMS }>;
    }
}

#[cfg(test)]
mod tests;
