#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use core::convert::TryFrom;

use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub const INTEGRATION_CONTRACT_VERSION: u32 = 15;

pub type Balance = u128;
pub type ProposalId = u64;
pub type EpochId = u32;
pub type CohortId = EpochId;
pub type MarketId = u64;
pub type MetricId = u16;
pub type MetricSpecVersion = u16;
pub type ResourceId = [u8; 8];
pub type ParamKey = [u8; 16];
pub type AccountId = [u8; 32];
pub type H256 = [u8; 32];
pub type BlockNumber = u32;

/// Canonical v1 component identifiers from architecture 05 §4.3.
///
/// These ids are frozen and append-only: future components receive new ids,
/// and an assigned id is never reused.
pub mod metric_ids {
    use super::MetricId;

    pub const X: MetricId = 1;
    pub const R: MetricId = 2;
    pub const E: MetricId = 3;
    pub const H: MetricId = 4;
    pub const PI: MetricId = 5;
    pub const K: MetricId = 6;

    pub const U: MetricId = 10;
    pub const F: MetricId = 11;
    pub const D_EFF: MetricId = 12;

    pub const P_FEES: MetricId = 20;
    pub const P_QUALIFIED_USERS: MetricId = 21;
    pub const P_SETTLED_VALUE: MetricId = 22;

    pub const A_SHIPPED_UPGRADES: MetricId = 30;
    pub const A_RUNTIME_PERF: MetricId = 31;
    pub const A_INTEGRATIONS: MetricId = 32;
}

/// Shared keeper-rebate vocabulary used by permissionless crank pallets.
pub mod keeper {
    use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
    use scale_info::TypeInfo;

    /// Economic class of a useful keeper crank (08 §6.3 / 07).
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
    pub enum CrankClass {
        /// Work explicitly reserved at least 80% of the keeper meter.
        DecisionCritical,
        /// Best-effort work sharing the at-most-20% general tranche.
        General,
        /// Dispute machinery paid from the separate ORACLE budget line — the
        /// oracle's own cranks plus the registry cranks 07 §7 (*Crank funding
        /// lines*) assigns there (`ack_observed`, `crank_close`). Archival
        /// registry work (`reap_epoch`) is [`CrankClass::General`], not this.
        OracleLine,
    }

    /// Infallible, fail-soft sink for a useful keeper crank.
    ///
    /// A rebate that cannot be paid because its meter or tranche is exhausted,
    /// its budget line is unfunded, parameters are unknown, or custody payout
    /// fails silently pays nothing. Implementations MUST NEVER change the
    /// outcome of the calling crank.
    pub trait KeeperRebateSink<AccountId> {
        fn rebate(who: &AccountId, class: CrankClass);
    }

    impl<AccountId> KeeperRebateSink<AccountId> for () {
        fn rebate(_: &AccountId, _: CrankClass) {}
    }
}

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
pub struct FixedU64(pub u64);

#[derive(Clone, Debug, Eq, PartialEq, TypeInfo)]
pub struct BoundedVec<T, const N: u32>(Vec<T>);

impl<T, const N: u32> BoundedVec<T, N> {
    pub const BOUND: u32 = N;

    pub const fn new() -> Self {
        Self(Vec::new())
    }

    pub fn into_inner(self) -> Vec<T> {
        self.0
    }

    pub fn as_slice(&self) -> &[T] {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> core::slice::Iter<'_, T> {
        self.0.iter()
    }

    pub fn try_push(&mut self, value: T) -> Result<(), BoundExceeded> {
        if self.0.len() >= N as usize {
            return Err(BoundExceeded);
        }
        self.0.push(value);
        Ok(())
    }
}

impl<T, const N: u32> IntoIterator for BoundedVec<T, N> {
    type Item = T;
    type IntoIter = alloc::vec::IntoIter<T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'a, T, const N: u32> IntoIterator for &'a BoundedVec<T, N> {
    type Item = &'a T;
    type IntoIter = core::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

impl<T: Encode, const N: u32> Encode for BoundedVec<T, N> {
    fn size_hint(&self) -> usize {
        self.0.size_hint()
    }

    fn encode_to<W: parity_scale_codec::Output + ?Sized>(&self, dest: &mut W) {
        self.0.encode_to(dest);
    }
}

impl<T: Decode, const N: u32> Decode for BoundedVec<T, N> {
    fn decode<I: parity_scale_codec::Input>(
        input: &mut I,
    ) -> Result<Self, parity_scale_codec::Error> {
        // Enforce the bound at the decode boundary: reject an oversized advertised
        // length before allocating or decoding any element, so untrusted input
        // cannot force work above the declared bound.
        let len = <parity_scale_codec::Compact<u32>>::decode(input)?.0;
        if len > N {
            return Err("BoundedVec length exceeds declared bound".into());
        }
        let items = parity_scale_codec::decode_vec_with_len(input, len as usize)?;
        Ok(Self(items))
    }
}

// Marker: the bounded `Decode` above rejects oversized lengths before allocating
// and delegates element decoding to `decode_vec_with_len`, so it honours the
// input's memory accounting (FRAME PoV requirement, codec ≥ 3.7).
impl<T: DecodeWithMemTracking, const N: u32> DecodeWithMemTracking for BoundedVec<T, N> {}

impl<T: MaxEncodedLen, const N: u32> MaxEncodedLen for BoundedVec<T, N> {
    fn max_encoded_len() -> usize {
        parity_scale_codec::Compact(N).encoded_size()
            + (N as usize).saturating_mul(T::max_encoded_len())
    }
}

impl<T, const N: u32> Default for BoundedVec<T, N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T, const N: u32> TryFrom<Vec<T>> for BoundedVec<T, N> {
    type Error = BoundExceeded;

    fn try_from(value: Vec<T>) -> Result<Self, Self::Error> {
        if value.len() > N as usize {
            return Err(BoundExceeded);
        }
        Ok(Self(value))
    }
}

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
pub struct BoundExceeded;

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
pub enum Branch {
    Accept,
    Reject,
}

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
pub enum ScalarSide {
    Long,
    Short,
}

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
pub enum GateType {
    Survival,
    Security,
}

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
pub enum PositionKind {
    BranchUsdc,
    Long,
    Short,
    GateYes(GateType),
    GateNo(GateType),
}

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
pub enum PositionId {
    Proposal {
        proposal: ProposalId,
        branch: Branch,
        kind: PositionKind,
    },
    Baseline {
        epoch: EpochId,
        side: ScalarSide,
    },
}

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
pub enum VaultState {
    Open,
    Resolved(Branch),
    ScalarSettled { winner: Branch, s: FixedU64 },
    Voided,
    BaselineSettled { s: FixedU64 },
}

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
pub enum ProposalClass {
    Param,
    Treasury,
    Code,
    Meta,
    Constitutional,
}

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
pub enum RejectReason {
    NotDecisionGrade,
    GateVetoSurvival,
    GateVetoSecurity,
    HurdleNotMet,
    ConvergenceFailed,
    SecondExtensionFailed,
    ProcessHold,
    ConstitutionViolation,
    ResourceConflict,
    RateLimited,
    VetoUpheldByReview,
    StaleQueue,
    PayloadReverted,
    NotRatified,
    SecuritySizing,
    AttestationMissing,
    /// 05 §2.1 T26: the second deferral exhausts the single permitted
    /// rollover and cancels the proposal with a full bond refund. Distinct
    /// from a deferral, which is not terminal (SQ-166, contract v6).
    RolloverExhausted,
}

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
pub enum ProposalState {
    Submitted,
    Screening,
    Qualified,
    Trading,
    Extended,
    Queued,
    Suspended,
    Rerun,
    Rejected(RejectReason),
    Executed,
    FailedExecuted,
    Measuring,
    Settled,
    Cancelled,
    Expired,
}

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
pub enum EpochPhase {
    Intake,
    Qualify,
    Seed,
    Trade,
    Decide,
    Review,
    Execute,
    Housekeeping,
}

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
pub enum DecisionOutcome {
    Adopt,
    Reject(RejectReason),
    Extend,
}

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
pub enum DispatchOutcomeCode {
    Ok,
    Failed { call_index: u8, error: [u8; 4] },
}

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
pub enum RatificationStatus {
    NotRequired,
    NoPassedRecord,
    Passed { referendum: u32 },
}

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
pub enum TradeSide {
    BuyLong,
    BuyShort,
    SellLong,
    SellShort,
}

/// Book kind carried by the `MarketCreated` event (02 §5). Declaration order is
/// the SCALE index order and is frozen by the contract surface. Variant spelling
/// is 02 §5's byte-for-byte: `02` is canonical for any name that appears on the
/// contract surface (02 line 5; runtime-code rule 5), and the frontend decodes
/// `MarketCreated.kind` by its TypeInfo variant name — so the underscored
/// `GateS_Adopt`/`GateS_Reject`/`GateC_Adopt`/`GateC_Reject` spelling is
/// load-bearing. `#[allow(non_camel_case_types)]` preserves that frozen spelling
/// (SQ-37 resolved: the code conformed to the contract; `02` is unchanged, so no
/// `INTEGRATION_CONTRACT_VERSION` bump and no joint sign-off are required).
#[allow(non_camel_case_types)]
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
pub enum MarketKind {
    DecisionAccept,
    DecisionReject,
    GateS_Adopt,
    GateS_Reject,
    GateC_Adopt,
    GateC_Reject,
    Baseline,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct RuntimeVersionConstraint {
    pub spec_name: BoundedVec<u8, 32>,
    pub spec_version: u32,
}

/// Book ids seeded for a proposal (04). Carried by [`Proposal::markets`].
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
pub struct MarketSet {
    pub accept: MarketId,
    pub reject: MarketId,
    pub gates: Option<[MarketId; 4]>,
    pub baseline: MarketId,
}

/// Canonical proposal record. Layout frozen by inclusion in `futarchy-primitives`
/// (02 §2); declaration order **is** the SCALE layout (05 §1.2, enumerated in full
/// there). Generic over the runtime `AccountId` (concrete: `AccountId32`, 02 §8).
/// `MaxEncodedLen` is derived so `pallet-epoch`'s `Proposals` map is bounded
/// (02 §114 ≤512 B; I-20/I-21, G-6).
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct Proposal<AccountId> {
    pub id: ProposalId,
    pub proposer: AccountId,
    pub class: ProposalClass,
    pub state: ProposalState,
    pub epoch: EpochId,
    pub submitted_at: BlockNumber,
    pub payload_hash: H256,
    /// Preimage byte length; `(payload_hash, payload_len)` is the pinned commitment
    /// read by decide()'s §5.6 preimage check (09 §1.2(2)).
    pub payload_len: u32,
    pub ask: Balance,
    pub bond: Balance,
    /// Declared resource-domain keys (bound: 13 §4 "Resource locks" = 8).
    pub resources: BoundedVec<[u8; 8], 8>,
    pub metric_spec: MetricSpecVersion,
    pub decide_at: BlockNumber,
    pub rerun: bool,
    pub extended: bool,
    pub delayed_once: bool,
    pub markets: Option<MarketSet>,
    pub maturity: Option<BlockNumber>,
    pub grace_end: Option<BlockNumber>,
    pub version_constraint: Option<RuntimeVersionConstraint>,
    pub decision: Option<DecisionOutcome>,
}

/// Terminal execution-queue record (09). Layout single-homed here per 02 §2.
#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct ExecutionRecord {
    pub pid: ProposalId,
    pub payload_hash: H256,
    pub class: ProposalClass,
    pub executed_at: BlockNumber,
    pub result: DispatchOutcomeCode,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct EpochStatusView {
    pub index: EpochId,
    pub phase: EpochPhase,
    pub phase_start_block: BlockNumber,
    pub next_boundary: BlockNumber,
    pub dead_man_armed: bool,
    pub ledger_frozen: bool,
    pub phase_flags: u32,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct ProposalSummaryView {
    pub id: ProposalId,
    pub class: ProposalClass,
    pub state: ProposalState,
    pub proposer: AccountId,
    pub epoch: EpochId,
    pub payload_hash: H256,
    pub ask: Balance,
    pub decision_market: Option<(MarketId, MarketId)>,
    pub gate_markets: Option<[MarketId; 4]>,
    pub decide_at: BlockNumber,
    pub maturity: Option<BlockNumber>,
    pub ratification: RatificationStatus,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct QuoteView {
    pub cost: Balance,
    pub fee: Balance,
    pub p_after_1e9: FixedU64,
    pub max_trade: Balance,
    pub within_domain: bool,
    pub evaluable: bool,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct DecisionStatsView {
    pub pid: ProposalId,
    pub twap_accept_1e9: FixedU64,
    pub twap_reject_1e9: FixedU64,
    pub twap_baseline_1e9: FixedU64,
    pub r_eff_1e9: FixedU64,
    pub trailing_accept_1e9: FixedU64,
    pub trailing_reject_1e9: FixedU64,
    pub coverage_pct: u8,
    pub traded_volume: Balance,
    pub v_min_required: Balance,
    pub converged: bool,
    pub gate_twaps_1e9: Option<[FixedU64; 4]>,
    pub attack_cost_hat: Balance,
    pub in_cap_prize: Balance,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct PositionView {
    pub position: PositionId,
    pub balance: Balance,
    pub vault_state: VaultState,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct QueuedExecutionView {
    pub pid: ProposalId,
    pub class: ProposalClass,
    pub payload_hash: H256,
    pub maturity: BlockNumber,
    pub grace_end: BlockNumber,
    pub version_constraint: RuntimeVersionConstraint,
    pub cancelled: bool,
    pub ratification: RatificationStatus,
    pub meters_clear: bool,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct WelfareView {
    pub epoch: EpochId,
    pub spec_version: MetricSpecVersion,
    pub s_pillar_1e9: FixedU64,
    pub c_onchain_1e9: FixedU64,
    pub c_attested_1e9: FixedU64,
    pub p_pillar_1e9: FixedU64,
    pub a_pillar_1e9: FixedU64,
    pub gate_s_1e9: FixedU64,
    pub gate_c_1e9: FixedU64,
    pub w_current_1e9: FixedU64,
    pub s_breached: bool,
    pub c_breached: bool,
    pub reserve_flag: bool,
    pub active_spec_available: bool,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct ParamView {
    pub key: ParamKey,
    pub value: u128,
    pub min: u128,
    pub max: u128,
    pub max_delta: u128,
    pub cooldown_blocks: u32,
    pub last_change: BlockNumber,
    pub class: ProposalClass,
    pub min_next: u128,
    pub max_next: u128,
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct NavView {
    pub total: Balance,
    pub main: Balance,
    pub pol: Balance,
    pub insurance: Balance,
    pub keeper: Balance,
    pub oracle: Balance,
    pub rewards: Balance,
    pub stream_remainders: Balance,
    pub obligations: Balance,
    pub haircut_flag: bool,
    pub spendable_nav: Balance,
    pub meter_utilization_bps: u32,
    pub class_floors: [Balance; 4],
}

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct CohortSummary {
    pub epoch: EpochId,
    pub s_1e9: FixedU64,
    pub baseline_twap_1e9: FixedU64,
    pub proposals:
        BoundedVec<(ProposalId, ProposalClass, DecisionOutcome), { bounds::MAX_COHORT_PROPOSALS }>,
    pub voided: bool,
    pub settled_at: BlockNumber,
}
pub type CohortSummaryView = CohortSummary;

#[derive(
    Clone, Debug, Decode, DecodeWithMemTracking, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo,
)]
pub struct OracleRoundView {
    pub component: MetricId,
    pub epoch: EpochId,
    // Per-version game key (contract v3, 07 §2(4)): an activation boundary keeps
    // two games live for one (component, epoch); the FE keys rounds by the triple.
    pub spec_version: MetricSpecVersion,
    pub round: u8,
    pub reporter: AccountId,
    pub value_1e9: FixedU64,
    pub evidence_hash: H256,
    pub bond: Balance,
    pub challenge_deadline: BlockNumber,
    pub acked_by_watchtowers: u8,
    pub escalated: bool,
}

pub mod bounds {
    pub const MAX_PROPOSAL_SUMMARIES: u32 = 32;
    pub const MAX_ACCOUNT_POSITIONS: u32 = 64;
    /// Canonical on-chain execution-history ring bound (09 §1.5 / 13 §4).
    pub const MAX_EXECUTION_RECORDS: u32 = 256;
    pub const MAX_PARAM_KEYS: u32 = 64;
    pub const RECENT_COHORT_SUMMARIES: u32 = 32;
    pub const MAX_OPEN_ORACLE_ROUNDS: u32 = 192;
    pub const MAX_COHORT_PROPOSALS: u32 = 12;
    pub const MAX_NON_TERMINAL_COHORTS: u32 = 4;
    pub const MAX_RESOURCES_PER_PROPOSAL: u32 = 8;
    /// Generic bounded-meter registry capacity (13 §4).
    pub const MAX_METERS: u32 = 16;
    pub const INTAKE_QUEUE: u32 = 64;
    pub const MAX_LIVE_PROPOSALS: u32 = 32;
    /// Books whose ledger terminal latch has not yet been observed. This is
    /// also the maximum live POL-commitment vector length.
    pub const MAX_LIVE_MARKETS: u32 = 196;
    pub const BOOKS_PER_PROPOSAL: u32 = 6;
    /// Maximum books opened by one epoch at the registry's maximum slot count.
    pub const MAX_MARKETS_PER_EPOCH: u32 = MAX_COHORT_PROPOSALS * BOOKS_PER_PROPOSAL + 1;
    /// Archive batches retained at the worst admissible timing: the ceiling of
    /// one year divided by the 14-day epoch floor, plus one whole batch so Seed
    /// can precede same-boundary keeper reaps without wedging healthy work.
    pub const MAX_ARCHIVE_MARKET_BATCHES: u32 = super::kernel::MAX_ARCHIVE_DELAY_BLOCKS
        .div_ceil(super::kernel::PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS)
        + 1;
    /// All present `Markets` rows, including terminal books awaiting reap.
    /// 196 + 28 * (12 * 6 + 1) = 2,240.
    pub const MAX_STORED_MARKETS: u32 =
        MAX_LIVE_MARKETS + MAX_ARCHIVE_MARKET_BATCHES * MAX_MARKETS_PER_EPOCH;
    /// Maximum TWAP checkpoints and registered decision windows per market
    /// (13 §4). Shared by market storage and the monitoring API row bound.
    pub const MAX_TWAP_WINDOWS_PER_MARKET: u32 = 8;
    /// 13 §4: maximum successful Phase-4 community vesting schedules.
    pub const MAX_COMMUNITY_SCHEDULES: u32 = 4_096;
    /// 13 §4: `pallet-migrations` may consume at most half the block service
    /// weight while a multi-block migration is active.
    pub const MIGRATION_SERVICE_WEIGHT_PERCENT: u32 = 50;
    /// 13 §4: maximum encoded multi-block-migration cursor length.
    pub const MIGRATION_CURSOR_MAX_LEN: u32 = 65_536;
    /// 13 §4: maximum encoded multi-block-migration identifier length.
    pub const MIGRATION_IDENTIFIER_MAX_LEN: u32 = 256;
}

pub mod currency {
    pub const USDC_DECIMALS: u8 = 6;
    pub const VIT_DECIMALS: u8 = 12;
    /// One whole USDC (6 decimals) and one whole VIT (12 decimals) in base units.
    pub const USDC: u128 = 1_000_000;
    pub const VIT: u128 = 1_000_000_000_000;
    pub const USDC_CENT: u128 = 10_000;
    pub const VIT_EXISTENTIAL_DEPOSIT: u128 = 10_000_000_000;
    /// Genesis VIT supply (02 §8 / 13 §3.5 identity, D-17): 1,000,000,000 VIT,
    /// fixed at genesis. The single home for this chain-identity constant.
    pub const VIT_TOTAL_SUPPLY: u128 = 1_000_000_000 * VIT;
}

pub mod chain_identity {
    pub const SS58_PREFIX: u16 = 7777;
    pub const FIXTURE_PARA_ID: u32 = 4242;

    // 02 §8 / 09 §6.1 (D-17) — the pinned XCM identity, single-homed here as
    // plain numbers (this crate stays frame/xcm-free, 01 §5.2); `bleavit-xcm`
    // constructs the typed `Location`s from these (B4).
    /// Asset Hub (the USDC reserve chain), sibling parachain id.
    pub const ASSET_HUB_PARA_ID: u32 = 1000;
    /// Coretime chain (broker), sibling parachain id — renewal funding target (09 §4).
    pub const CORETIME_PARA_ID: u32 = 1005;
    /// Relay-native DOT decimal places (02 §8 chain identity).
    pub const DOT_DECIMALS: u8 = 10;
    /// One whole DOT in planck, derived from [`DOT_DECIMALS`].
    pub const DOT_PLANCKS_PER_DOT: u128 = 10_u128.pow(DOT_DECIMALS as u32);
    /// `PalletInstance` of `pallet-assets` on Asset Hub holding USDC (D-17).
    pub const USDC_PALLET_INSTANCE: u8 = 50;
    /// USDC asset index on Asset Hub (D-17; verified Circle-native id, 2026-07-16).
    pub const USDC_ASSET_INDEX: u128 = 1337;
}

pub mod kernel {
    /// Fixed-point scale of a settlement score `s` (`FixedU64`, 1e9).
    pub const SCORE_SCALE: u64 = 1_000_000_000;
    /// The neutral Baseline score a cohort VOID or orphan-epoch finalization
    /// settles at (03 §2.3
    /// transition table; 03 §5). For a branch-free scalar vault `s = 0.5` is
    /// identical in payout to D-1's neutral ½ valuation, which is precisely
    /// why `BaselineState` carries no `Voided` variant (03 §6.4) — the VOID is
    /// expressed as a settlement, not as a distinct terminal state.
    pub const VOID_BASELINE_SCORE: super::FixedU64 = super::FixedU64(SCORE_SCALE / 2);
    pub const MILLISECS_PER_BLOCK: u64 = 6_000;
    /// Frozen six-second-block day used by security-sizing duration math (13 §3.1).
    pub const BLOCKS_PER_DAY: u32 = 14_400;
    /// Compressed "day" used **only** by the default-off `fast-timing` test build
    /// (SQ-128, G1 drill 09). It stands in for the 14,400-block day inside the
    /// epoch-timing floors so the 09 §7.1 "three unattended epochs" drill proves
    /// the epoch machinery over three real epochs (real Aura + relay consensus) in
    /// minutes instead of the release-cadence ~63 days. This is the single knob the
    /// whole compressed regime derives from; it does not exist in the production
    /// build (no `#[cfg(not(...))]` arm), so nothing can read a compressed day off
    /// the release binary. R-7/G-1: the feature only ever *shrinks* timing for a
    /// documented test wasm — it is never the release runtime. See PLAN.md ·
    /// Decision log (SQ-128) and `docs/architecture` 09 §7.1 / 13 §1.
    #[cfg(feature = "fast-timing")]
    pub const FAST_DAY_BLOCKS: u32 = 4;
    pub const MIN_SPLIT_USDC: u128 = super::currency::USDC_CENT;
    pub const MIN_TRANSFER_USDC: u128 = super::currency::USDC_CENT;
    pub const MIN_TRADE_USDC: u128 = 1_000_000;
    /// Maximum trade size as a fraction of the book liquidity parameter `b`
    /// (04 §6.2 / 13 §2). The tuple shape is frozen by 02 §9.
    pub const MAX_TRADE_RATIO: (u32, u32) = (1, 4);
    /// Max observation gap before a decision-window staleness event (04 §7; 13 §3.2).
    pub const MKT_STALE_GAP_BLOCKS: u64 = 50;
    pub const POSITION_DEPOSIT_USDC: u128 = 100_000;
    /// One-year hard ceiling for the shared ledger/market/registry archive
    /// delay. The ceiling makes every archive-derived storage bound finite.
    pub const MAX_ARCHIVE_DELAY_BLOCKS: u32 = 5_256_000;
    /// Release-runtime epoch floor used by archive-capacity derivations. Keep
    /// this production literal separate from the fast-timing test-only floor.
    pub const PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS: u32 = 201_600;
    /// Release-runtime epoch **ceiling** — 42 days, the other end of 13 §1's
    /// `epoch.length` range, and its single compile-time home.
    ///
    /// It is a kernel constant for the same reason the floor above is: 13 rule 7
    /// marks `epoch.length` kernel-bounded, so its entire governance-metadata
    /// tuple is genesis-fixed and `amend_registry` refuses it. `constitution-core`
    /// seeds the production registry maximum from this value, and 06 §2.1's
    /// `entrenched` enactment delay is sized against it (`4 ×`, SQ-234) — a
    /// block-denominated governance track has to be sized against the largest
    /// legal epoch, because it cannot count epoch boundaries.
    ///
    /// Deliberately has **no** `fast-timing` variant, unlike the floor. Every
    /// 06 §2.1 track period stays at its release value in that build so the
    /// governance, emergency and execution windows cannot fire inside a
    /// minute-scale drill; the compressed *registry* ceiling is a separate,
    /// registry-side seed.
    pub const PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS: u32 = 604_800;
    /// Minimum META-amendable epoch length (14 days; 05 §3.1 / 13 §1).
    ///
    /// The default-off `fast-timing` feature (SQ-128) lowers this floor to a
    /// proportionally compressed `14 × FAST_DAY_BLOCKS` so the drill-09 machinery
    /// proof can boot a genuine epoch clock in minutes. `EpochParams::validate`
    /// hard-asserts `epoch_length >= MIN_EPOCH_LENGTH_BLOCKS` at genesis, so the
    /// compressed `epoch.length` Param default only boots once this floor drops
    /// with it. The `cfg(not(fast-timing))` arm is byte-identical to the frozen
    /// 14-day value; the feature only shrinks a floor for a test wasm (R-7/G-1).
    #[cfg(not(feature = "fast-timing"))]
    pub const MIN_EPOCH_LENGTH_BLOCKS: u32 = PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS;
    #[cfg(feature = "fast-timing")]
    pub const MIN_EPOCH_LENGTH_BLOCKS: u32 = 14 * FAST_DAY_BLOCKS;
    /// Guardian/playbook effect backstop (14 days at six-second blocks).
    ///
    /// 06 §5.2/§6.2/§6.3 and 13 §2: intake pauses, reserve split
    /// pauses and ledger/market freezes can never remain effective beyond
    /// this window without the one values-governed LedgerFreeze renewal.
    pub const PLAYBOOK_FREEZE_WINDOW_BLOCKS: u32 = 201_600;
    /// Kernel floor for the decision window (`dec.window`, 13 §1).
    ///
    /// Default build: one frozen day. Under `fast-timing` (SQ-128) it drops to one
    /// `FAST_DAY_BLOCKS` so the compressed `dec.window` default still clears its
    /// floor while satisfying `dec.window <= epoch_length·13/21`. Test-only; the
    /// `cfg(not(fast-timing))` arm is byte-identical to the production value.
    #[cfg(not(feature = "fast-timing"))]
    pub const DECISION_WINDOW_FLOOR_BLOCKS: u32 = BLOCKS_PER_DAY;
    #[cfg(feature = "fast-timing")]
    pub const DECISION_WINDOW_FLOOR_BLOCKS: u32 = FAST_DAY_BLOCKS;
    pub const DEC_EXTENSION_BLOCKS: u32 = 43_200;
    /// Per-class `dec.delta` kernel floor on the contract's 1e9 grid.
    pub const DECISION_DELTA_FLOOR: super::FixedU64 = super::FixedU64(5_000_000);
    /// PARAM/TREASURY/CODE/META order frozen by 02 §9.
    pub const DECISION_DELTA_FLOORS: [super::FixedU64; 4] = [DECISION_DELTA_FLOOR; 4];
    /// Per-class `dec.sigma` kernel floor on the contract's 1e9 grid.
    pub const DECISION_SIGMA_FLOOR: super::FixedU64 = super::FixedU64(0);
    /// PARAM/TREASURY/CODE/META order frozen by 02 §9.
    pub const DECISION_SIGMA_FLOORS: [super::FixedU64; 4] = [DECISION_SIGMA_FLOOR; 4];
    /// Rerun hurdle increment (one percentage point; T13 / 05 §5.4).
    pub const RERUN_HURDLE_BUMP_1E9: u64 = 10_000_000;
    /// Capture-resistance multiplier `AttackCost >= 3 * InCapPrize` (D-4).
    pub const SECURITY_FACTOR: u128 = 3;
    /// Kernel hard minimum for `sec.flow_cap` — the `C_hold` wash ceiling on
    /// the measured non-POL contest-capital depth term, as a multiple of
    /// `(b_acc + b_rej)` on the contract's 1e9 grid (13 §1; 08 §5.3: below ×7
    /// the ceiling could reject honest exactly-grade proposals). The published
    /// value is Phase-0 sim-gated; until published, consumers MUST use exactly
    /// this floor — the smallest admissible ceiling, never a pass-widening
    /// default (SQ-231 amendment, 2026-07-18).
    pub const SEC_FLOW_CAP_FLOOR_1E9: u64 = 7_000_000_000;
    /// Kernel hard minima for the `sec.prize.{param,code,meta}` capability-envelope
    /// proxies, in µUSDC (13 §1/§2; 05 §5.6 names them *kernel floors*, 08 §5.2
    /// makes them the `InCapPrize` source for the three non-TREASURY binding
    /// classes). The values are the Phase-0 published calibration
    /// (`simulation/results/phase0-calibration.json` · `published.candidates`,
    /// `designation: published`, `violations: []`), adopted as the genesis
    /// defaults *and* as the governed rows' minima. The guarantee is the floor,
    /// not monotonicity: the ×2 Δ is symmetric, so a proxy raised above the
    /// calibrated value may later be lowered back toward it, but no amendment
    /// can carry it **below** the floor — which is the capture direction the
    /// sizing gate exists to refuse (R-7). The rows' governance metadata is
    /// therefore kernel-bounded (13 rule 2).
    pub const SEC_PRIZE_PARAM_FLOOR: u128 = 50_000_000_000;
    /// See [`SEC_PRIZE_PARAM_FLOOR`].
    pub const SEC_PRIZE_CODE_FLOOR: u128 = 300_000_000_000;
    /// See [`SEC_PRIZE_PARAM_FLOOR`].
    pub const SEC_PRIZE_META_FLOOR: u128 = 600_000_000_000;
    /// D-14 expedited CODE-upgrade authorize→apply lead (three six-second days;
    /// 09 §2.1/§3.1, 13 §2). Exposed to clients as the `descriptorLeadTime` pallet
    /// metadata constant.
    ///
    /// Under the default-off `fast-timing` build (SQ-128, extended to drill 08) it
    /// drops to a faithful `3 × FAST_DAY_BLOCKS` so the expedited-lane proof no longer
    /// waits the release-cadence ~3 days. The `cfg(not(fast-timing))` arm is byte-
    /// identical to the frozen 13 §2 value; the feature only shrinks the lead for a
    /// documented test wasm (R-7/G-1), never the release runtime.
    #[cfg(not(feature = "fast-timing"))]
    pub const DESCRIPTOR_LEAD_TIME_BLOCKS: u32 = 43_200;
    #[cfg(feature = "fast-timing")]
    pub const DESCRIPTOR_LEAD_TIME_BLOCKS: u32 = 3 * FAST_DAY_BLOCKS;
    /// 09 §3.2 PB-MIGRATION trigger arm: an unchanged active cursor for more
    /// than this many blocks raises the migration halt.
    pub const MIGRATION_STALL_BLOCKS: u32 = 900;
    /// T18→T23 retry interval before the T22 keeper transition (05 §2.1).
    pub const EXECUTION_RETRY_WINDOW_BLOCKS: u32 = 3 * BLOCKS_PER_DAY;
    pub const WATCHTOWER_EXTENSION_BLOCKS: u32 = 28_800;
    /// The 72 h optimistic challenge window (`orc.window`, 07 §5.2/§7), a frozen
    /// shared kernel floor (META ≤ 120 h, never lowered). Single home for the
    /// value the oracle reporting game and the `pallet-registry` filing windows
    /// both use; the registry uses the frozen floor (07 §7 "72 h ... frozen
    /// constant"), never a live-amended value.
    pub const ORC_WINDOW_BLOCKS: u32 = 43_200;
    /// Supported oracle dispute-ladder envelope (07 §6.1; 13 `orc.rounds`).
    /// Live governance selects a cap inside this range; each opened game
    /// snapshots that selection for its full lifecycle.
    pub const ORC_ROUNDS_MIN: u8 = 2;
    pub const ORC_ROUNDS_MAX: u8 = 4;
    /// Reporters that MUST be registered with full stakes before any attested
    /// component may be admitted to a MetricSpec, and before Phase-3 arming
    /// (07 §2(5)/§3). 13 §1 has always marked `orc.n_min`'s floor as a kernel
    /// value; this is that floor's first home in code, so the constitution's
    /// genesis seed and the admission gate cannot drift apart (SQ-341).
    pub const ORC_REPORTERS_MIN: u8 = 3;
    /// Class-4 oracle report window after the measurement epoch closes (07 §5(1)).
    pub const ORC_REPORT_WINDOW_BLOCKS: u32 = 2 * BLOCKS_PER_DAY;
    /// How long a money-settled round's bond stack is retained before the close
    /// crank resolves and reaps it (07 §11(1): "retention is bounded by the
    /// track's own schedule (7 d decision + 1 d confirm), after which the stack
    /// resolves and the entry is reaped").
    ///
    /// **Derived, not chosen.** It is the `OracleResolution` track's own
    /// schedule from 06 §2.1 — `prepare 0 / decision 7 d / confirm 1 d` — so the
    /// window is exactly long enough to outlive the latest verdict that track
    /// can still deliver, and no longer. `bleavit-runtime`'s track table is the
    /// other end of the binding and a runtime test asserts the equality, so a
    /// track retune cannot silently shorten retention.
    ///
    /// Not compressed under `fast-timing`: the governance tracks are not, and a
    /// retention window shorter than the track it tracks would reap a stack the
    /// verdict is still coming for.
    pub const ORC_RETENTION_BLOCKS: u32 = 8 * BLOCKS_PER_DAY;
    pub const MAX_NESTED_LEVELS: u32 = 4;
    pub const MAX_NESTED_CALLS: u32 = 16;
    pub const MAX_CALLS: u32 = 16;
    pub const MAX_BYTES: u32 = 64 * 1024;
    /// SCALE-decode recursion backstop for the execution guard's
    /// preimage-sourced batch decode (`decode_batch`, 09 §1.2). A spec-valid
    /// payload nests at most `MAX_NESTED_LEVELS` wrapper levels (06 §3.3), each
    /// costing a small constant number of `Decode` recursion frames (the enum
    /// variant plus its inner `Vec`/`Box`), so this limit sits far above any
    /// legitimate call yet well below the stack budget — matching substrate's
    /// conventional 256 extrinsic decode-depth limit. It bounds the *decode*
    /// (the `MAX_NESTED_LEVELS` filter bound is a post-decode check and cannot
    /// prevent the recursion); an over-deep adversarial preimage decodes to
    /// `BadPreimage` (G-1 status quo), never a stack-overflow trap/abort. This
    /// is the decode-bomb hardening surfaced by the 15 §4.5 decode-fuzz work
    /// (S2); see PLAN.md · Decision log (SQ-225).
    pub const MAX_PAYLOAD_DECODE_DEPTH: u32 = 256;
    /// Maximum aggregate payload dispatch weight as a fraction of the block
    /// limit (`prop.max_weight`, 13 §2). The ratio form avoids re-encoding the
    /// same kernel value as an execution-guard arithmetic literal.
    pub const PROP_MAX_WEIGHT_NUM: u64 = 1;
    pub const PROP_MAX_WEIGHT_DEN: u64 = 4;
    pub const LMSR_DOMAIN_BOUND: u32 = 48;
    /// Maximum approximation error for a primitive transcendental (`exp2`/`log2`/`ln`),
    /// in units of 1 ulp = 2⁻⁶⁴ (04 §4). Single home for the `futarchy-fixed` kernel bound
    /// (13 rule 1: fixed imports domain/error bounds).
    pub const PRIMITIVE_MAX_ULP: u32 = 2;
    /// Maximum composed LMSR cost-function and marginal-price error, in ulp of 2⁻⁶⁴ (04 §4).
    pub const COMPOSED_COST_MAX_ULP: u32 = 8;
    pub const QUOTE_CLAMP_MIN_1E9: u64 = 1_000_000;
    pub const QUOTE_CLAMP_MAX_1E9: u64 = 999_000_000;
    pub const GATE_P_MAX_CEILING_1E9: u64 = 100_000_000;
    /// `gate.eps` kernel floor on the contract's 1e9 grid (13 §1).
    pub const GATE_EPS_FLOOR: super::FixedU64 = super::FixedU64(5_000_000);
    /// `exec.timelock` kernel floor shared by every proposal class (13 §1).
    pub const EXECUTION_TIMELOCK_FLOOR_BLOCKS: u32 = BLOCKS_PER_DAY;
    /// PARAM/TREASURY/CODE/META order frozen by 02 §9.
    pub const EXECUTION_TIMELOCK_FLOORS_BLOCKS: [u32; 4] = [EXECUTION_TIMELOCK_FLOOR_BLOCKS; 4];
    /// `exec.grace` kernel floor (seven days; 13 §1).
    pub const EXECUTION_GRACE_FLOOR_BLOCKS: u32 = 7 * BLOCKS_PER_DAY;
    /// 05 §5 decision-grade scalar-book sanity band (kernel rule, not a
    /// governance-tunable parameter).
    pub const DECISION_SANITY_MIN_1E9: u64 = 20_000_000;
    pub const DECISION_SANITY_MAX_1E9: u64 = 980_000_000;
    /// 06 §4 Treasury proposal bond surcharge: 0.5% of Ask.
    pub const TREASURY_BOND_ASK_BPS: u128 = 50;
    pub const BASIS_POINTS_DENOMINATOR: u128 = 10_000;
    pub const ORC_MAX_PROOF_BYTES: u32 = 256 * 1024;
    pub const REG_MAX_FILINGS_EPOCH: u32 = 64;
    pub const WT_MAX: u32 = 16;
    /// Watchtower acknowledgement quorum (`wt.quorum` K floor, 07). Single home for
    /// the value the oracle and registry cores previously each re-declared.
    pub const WT_QUORUM: u8 = 2;
    pub const ATT_MIN_MEMBERS: u32 = 3;
    pub const ATT_QUORUM: u32 = 2;
    /// 13 §2 dead-man finality-stall threshold, measured in relay blocks.
    ///
    /// Under the default-off `fast-timing` build (SQ-128, extended to drill 04) it
    /// drops to a small fixed floor so the dead-man proof induces a real relay-finality
    /// stall in ~minutes instead of the release-cadence ~16 h. Unlike the epoch floors
    /// this does NOT scale off `FAST_DAY_BLOCKS`: faithful day-scaling (4,800 = ⅓ day)
    /// would underflow to ~1 relay block and false-latch on healthy best-over-finalized
    /// lag, so the compressed value is an independent floor chosen to clear healthy lag
    /// with margin. The `cfg(not(fast-timing))` arm is byte-identical to the frozen
    /// 13 §2 value; test-only, never the release runtime (R-7/G-1).
    #[cfg(not(feature = "fast-timing"))]
    pub const DEAD_MAN_RELAY_BLOCKS: u32 = 4_800;
    #[cfg(feature = "fast-timing")]
    pub const DEAD_MAN_RELAY_BLOCKS: u32 = 48;
    /// 13 §2 dead-man snapshot grace: strictly more than four six-second days.
    pub const DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS: u32 = 4 * BLOCKS_PER_DAY;
    pub const STALE_EPOCH_BOUND_BLOCKS: u32 = 100_800;
    pub const TICK_BATCH: u32 = 10;
    pub const REAP_BATCH: u32 = 100;
    pub const SETTLE_COHORT_MAX_ITEMS: u32 = 100;
    /// Measurement epochs whose 07 §11(1) `OracleSettleDeadline` one clock-syncing
    /// crank may drive from the epoch pallet's cursor. `sync_phase` advances the
    /// epoch index arithmetically, so a chain nobody cranked for several epochs
    /// presents several due deadlines at once, and force-neutralizing all of them
    /// in one dispatch would make the crank's weight a function of the idle gap
    /// (I-20).
    ///
    /// Derived from [`MAX_NON_TERMINAL_COHORTS`], not chosen: a round can exist for
    /// a measurement epoch only while some live cohort consumes it (the oracle's
    /// `report` requires `is_expected_spec_version`), so at most this many epochs
    /// can have deadline work that is not already a no-op, and a cursor step over
    /// an epoch with no live cohort costs one empty pass. The bound therefore
    /// covers every epoch that can carry a round, and `settle_cohort` additionally
    /// drives its own cohort's measurement epochs so a lagging cursor can never
    /// let a settlement outrun the deadline.
    pub const ORACLE_DEADLINE_CATCHUP: u32 = crate::bounds::MAX_NON_TERMINAL_COHORTS;

    /// 08 §4.1 per-class minimum-viable-NAV floors, in base USDC units, ordered
    /// PARAM / TREASURY / CODE / META. Frozen constants: 08 §4.1 is explicit
    /// that the treasury "MUST return exactly the values above" rather than
    /// re-derive them at read time, because they do not share one rounding
    /// convention.
    ///
    /// Single-homed here (SQ-303) rather than in `futarchy-treasury-core`,
    /// because two crates now need them: the treasury enforces them at the
    /// §4.2 arming gate, and the constitution screens parameter changes against
    /// them. Duplicating a 13-owned value in a second crate is the defect rule 4
    /// forbids.
    pub const CLASS_NAV_FLOOR_USDC: [crate::Balance; 4] = [
        4_620_989 * crate::currency::USDC,
        7_393_600 * crate::currency::USDC,
        13_862_944 * crate::currency::USDC,
        21_256_533 * crate::currency::USDC,
    ];

    /// `ln 2` scaled by 10^18, for the 08 §3 per-book worst-case maker loss.
    const LN2_SCALED_1E18: u128 = 693_147_180_559_945_309;
    const LN2_SCALE: u128 = 1_000_000_000_000_000_000;
    const PERBILL: u128 = 1_000_000_000;

    /// The 08 §3/§4.1 derivation of a class's true minimum-viable NAV floor from
    /// the live parameters, in base USDC units:
    ///
    /// ```text
    /// commitment(K) = (2 · pol.b.K + 4 · pol.b_gate) · ln 2
    /// floor(K)      = commitment(K) / pol.budget_epoch
    /// ```
    ///
    /// This is what [`CLASS_NAV_FLOOR_USDC`] was computed from, and the point of
    /// having it in code is SQ-303's screen: the floors are compile-time
    /// constants that do **not** track the keys they were derived from, so a
    /// decision lowering `pol.budget_epoch` or raising a `pol.b` can push the
    /// true floor above the frozen literal and leave the §4.2 arming gate
    /// passing a class below its real minimum.
    ///
    /// Rounds the true floor **up**. Every rounding step here is against the
    /// proposal (R-7): a floor rounded down could admit a parameter change that
    /// leaves the frozen literal wrong by less than one unit, which is the one
    /// direction this screen exists to prevent.
    pub fn derived_class_nav_floor(
        b_class: crate::Balance,
        b_gate: crate::Balance,
        budget_epoch_ppb: u32,
    ) -> Option<crate::Balance> {
        if budget_epoch_ppb == 0 {
            // A zero POL budget seeds no book at any NAV, so no finite floor
            // exists. `None` is the fail-closed answer; a saturating 0 would
            // read as "any NAV suffices".
            return None;
        }
        let books = b_class
            .checked_mul(2)?
            .checked_add(b_gate.checked_mul(4)?)?;
        // ceil(books · ln2)
        let commitment = books
            .checked_mul(LN2_SCALED_1E18)?
            .checked_add(LN2_SCALE - 1)?
            / LN2_SCALE;
        // ceil(commitment / budget_epoch)
        let scaled = commitment.checked_mul(PERBILL)?;
        let divisor = u128::from(budget_epoch_ppb);
        Some(scaled.checked_add(divisor - 1)? / divisor)
    }

    // --- 13 §5 items 1–4: the frozen occupancy envelopes (SQ-501) -------------
    //
    // The class-floor family above had one machine-checkable literal per class,
    // which is what let SQ-303 replace a direction test with a value test. The
    // occupancy family had none — 13 §5 items 1–4 stated their envelopes as
    // prose — so `epoch.slots`, `mkt.obs_interval`, `dec.window` and
    // `epoch.length` were refused **unconditionally in both directions**, which
    // made their 13 §1 registry rows declaratory. These constants are those
    // envelopes, single-homed here so the same screen can be a value test
    // (SQ-501). Every one is transcribed from 13 §5 and reproduced from its own
    // derivation by `occupancy_envelopes_reproduce_the_published_13_5_figures`.

    /// 13 §5 item 1: measured `MarketBook<AccountId>` `MaxEncodedLen`
    /// (B10 re-measurement, 2026-07-17, after the accumulator widened to the
    /// 04 §7 two-limb u256 shape). The runtime asserts the real
    /// `max_encoded_len()` against this figure, so struct growth reopens the
    /// derivation rather than silently invalidating it.
    pub const MARKET_BOOK_MAX_BYTES: u32 = 205;
    /// 13 §5 item 1: the retained `Markets` map byte budget (512 KiB).
    pub const RETAINED_MARKETS_BUDGET_BYTES: u32 = 512 * 1024;
    /// 13 §5 item 2: the **pinned** per-vault ceiling. Deliberately the pinned
    /// ~256 B and not the measured 160 B — the occupancy screen must not admit
    /// a parameter change that only fits because today's struct happens to be
    /// small (R-7: round against the proposal).
    pub const VAULT_MAX_BYTES: u32 = 256;
    /// 13 §5 item 2: the vault-occupancy byte budget (13 KiB). Exactly
    /// [`LIVE_VAULT_ENVELOPE`] × [`VAULT_MAX_BYTES`], which is where the figure
    /// came from.
    pub const VAULT_OCCUPANCY_BUDGET_BYTES: u32 = 13 * 1024;
    /// 13 §5 item 2: the frozen vault-occupancy envelope — 32 live + 4 cohorts
    /// × 5 settling.
    pub const LIVE_VAULT_ENVELOPE: u32 = 52;
    /// 03 §4: distinct `PositionKind` values one proposal vault carries — the
    /// three branch-scoped instruments plus a Yes/No pair per `GateType`.
    pub const PROPOSAL_POSITION_KINDS: u32 = 7;
    /// 13 §5 item 3 / 03 §4: one proposal vault's fixed position universe —
    /// two `Branch`es × [`PROPOSAL_POSITION_KINDS`] = 14 instruments.
    pub const PROPOSAL_POSITION_INSTRUMENTS: u32 = 2 * PROPOSAL_POSITION_KINDS;
    /// The protocol accounts one market book owns inventory through: the book
    /// account and its fee account.
    pub const MARKET_PROTOCOL_ACCOUNTS: u32 = 2;
    /// 13 §5 items 1/3: the protocol-position cells one `market.reap` reads and
    /// removes — 14 instruments × 2 protocol accounts.
    pub const MARKET_REAP_PROTOCOL_POSITION_CELLS: u32 = 28;
    /// 13 §5 item 4: decision-critical keeper observations per epoch, the load
    /// `keeper.budget_epoch` (and its 6,000 USDC kernel floor) is sized against
    /// — 08 §6.2.
    pub const KEEPER_DECISION_CRITICAL_OBSERVATIONS: u64 = 133_920;
    /// 13 §5 item 4: full-trading-window keeper observations per epoch, the load
    /// the `ops.keepers` continuity line is sized against — 08 §6.3.
    pub const KEEPER_FULL_WINDOW_OBSERVATIONS: u64 = 580_320;

    /// The 13 §1 parameter values every 13 §5 item 1–4 occupancy envelope is
    /// re-derived from, in their raw registry units (blocks / slots / blocks /
    /// blocks / blocks).
    ///
    /// A struct rather than five positional `u32`s on purpose: the core
    /// aggregate and the runtime guard both build one, and two call sites that
    /// disagreed about argument order would screen different things while
    /// looking identical.
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub struct OccupancyParams {
        /// `epoch.length`, in blocks.
        pub epoch_length: u32,
        /// `epoch.slots` (N_active).
        pub epoch_slots: u32,
        /// `mkt.obs_interval`, in blocks.
        pub obs_interval: u32,
        /// `dec.window`, in blocks.
        pub dec_window: u32,
        /// `ledger.archive`, in blocks.
        pub archive_delay: u32,
    }

    /// Books trading concurrently in one epoch (13 §4: "31 = 5·6 + 1"): one
    /// book set per active slot plus the epoch's single unconditional Baseline
    /// book.
    pub fn derived_trading_books(epoch_slots: u32) -> Option<u32> {
        epoch_slots
            .checked_mul(crate::bounds::BOOKS_PER_PROPOSAL)?
            .checked_add(1)
    }

    /// 13 §5 item 1: rows present in the retained `Markets` map at these
    /// parameter values —
    ///
    /// ```text
    /// MaxLiveMarkets + (ceil(ledger.archive / epoch.length) + 1) × (epoch.slots·6 + 1)
    /// ```
    ///
    /// The live/POL envelope, one creation batch per epoch boundary inside the
    /// archive delay, and one extra boundary batch so Seed can precede a
    /// same-boundary keeper reap. The division rounds **up**, against the
    /// proposal.
    ///
    /// `None` on a zero epoch length (no finite batch count exists) or on any
    /// overflow, so the caller refuses rather than reading a saturated figure as
    /// "the envelope holds" (G-1).
    ///
    /// Evaluated at the *proposed* values this is the true occupancy;
    /// [`crate::bounds::MAX_STORED_MARKETS`] is the same formula evaluated at
    /// each input's compiled bound (archive ceiling, 14-day epoch floor, 12-slot
    /// registry maximum), which is why the comparison is `≤` and why it does not
    /// bind anywhere inside the 13 §1 ranges. It is the safety net that starts
    /// binding the moment one of those bounds is widened — and, under the
    /// default-off `fast-timing` build, it correctly reports that a compressed
    /// epoch clock beside an uncompressed one-year archive delay would blow the
    /// map (that build's `MAX_STORED_MARKETS` deliberately keeps the production
    /// epoch floor).
    pub fn derived_retained_markets(params: &OccupancyParams) -> Option<u32> {
        if params.epoch_length == 0 {
            return None;
        }
        let batches = params
            .archive_delay
            .div_ceil(params.epoch_length)
            .checked_add(1)?;
        let per_batch = derived_trading_books(params.epoch_slots)?;
        crate::bounds::MAX_LIVE_MARKETS.checked_add(batches.checked_mul(per_batch)?)
    }

    /// 13 §5 item 2: vault occupancy at these parameter values —
    /// `MaxLiveProposals + MaxSettlingCohorts × epoch.slots`.
    pub fn derived_vault_occupancy(epoch_slots: u32) -> Option<u32> {
        crate::bounds::MAX_LIVE_PROPOSALS
            .checked_add(crate::bounds::MAX_NON_TERMINAL_COHORTS.checked_mul(epoch_slots)?)
    }

    /// 13 §3.1: blocks in the Trade phase, `[5/21, 18/21)` of `epoch.length`.
    /// Rounds **up** so a longer window (more observations) is never understated.
    pub fn derived_trade_window_blocks(epoch_length: u32) -> Option<u32> {
        let span = crate::phase_offsets::DECIDE_NUM.checked_sub(crate::phase_offsets::TRADE_NUM)?;
        let denominator = crate::phase_offsets::DENOMINATOR;
        if denominator == 0 {
            return None;
        }
        u32::try_from(
            u64::from(epoch_length)
                .checked_mul(u64::from(span))?
                .div_ceil(u64::from(denominator)),
        )
        .ok()
    }

    /// 13 §5 item 4: decision-critical keeper observations per epoch —
    /// `(epoch.slots·6 + 1) × ceil(dec.window / mkt.obs_interval)`.
    ///
    /// `None` on a zero observation interval (an infinite crank rate has no
    /// finite budget) or on overflow.
    pub fn derived_decision_critical_observations(params: &OccupancyParams) -> Option<u64> {
        if params.obs_interval == 0 {
            return None;
        }
        let per_book = u64::from(params.dec_window).div_ceil(u64::from(params.obs_interval));
        per_book.checked_mul(u64::from(derived_trading_books(params.epoch_slots)?))
    }

    /// 13 §5 item 4: full-trading-window keeper observations per epoch —
    /// `(epoch.slots·6 + 1) × ceil(trade window / mkt.obs_interval)`.
    pub fn derived_full_window_observations(params: &OccupancyParams) -> Option<u64> {
        if params.obs_interval == 0 {
            return None;
        }
        let window = derived_trade_window_blocks(params.epoch_length)?;
        let per_book = u64::from(window).div_ceil(u64::from(params.obs_interval));
        per_book.checked_mul(u64::from(derived_trading_books(params.epoch_slots)?))
    }

    /// 13 §5 items 1/3: protocol-position cells one `market.reap` touches —
    /// the proposal vault's fixed 14-instrument universe × the book's two
    /// protocol accounts.
    ///
    /// Deliberately takes no [`OccupancyParams`]: item 3 is the one envelope of
    /// the four that no 13 §1 key moves. It is still re-derived rather than
    /// asserted so that the screen is a complete items-1–4 recomputation, and so
    /// that a change to the position universe fails loudly here instead of
    /// quietly invalidating item 3.
    pub fn derived_market_reap_protocol_cells() -> Option<u32> {
        PROPOSAL_POSITION_INSTRUMENTS.checked_mul(MARKET_PROTOCOL_ACCOUNTS)
    }

    pub const KEEPER_BUDGET_EPOCH_FLOOR_USDC: u128 = 6_000_000_000;
    /// SQ-117 (ruled 2026-07-21): the benchmark **fee basis** the launch
    /// `keeper.rebate` seed is calibrated against — the sanctioned-crank fee
    /// cost from which 13 §1 expresses the row (default `3×`, hard min `1×`,
    /// hard max `10×`). This is the **[VERIFY]** placeholder of [08](../../docs/architecture/08-treasury-and-economics.md)
    /// §6.2 (`≈ 0.03 USDC`, 30,000 µUSDC): a conservative pre-launch default,
    /// **not** a calibrated number. It is replaced at benchmark time once the
    /// launch `fee.vit_usdc_rate` fixes the real per-crank fee; the seed is
    /// then rounded **down** to µUSDC against the claimant (R-7). Until then the
    /// row is genesis-seeded (so B9's rebate pipeline stops paying zero) but its
    /// value carries the 13 §1 `[VERIFY fee basis at benchmark time]` tag.
    pub const KEEPER_REBATE_FEE_BASIS_USDC: u128 = 30_000;
}

/// Epoch phase-start offsets as fractions of `epoch.length` (13 §3.1). The pairs
/// (numerator, [`DENOMINATOR`]) are kernel constants exposed to clients as pallet
/// metadata constants — never `Params` storage. Review/Execute are per-class /
/// per-proposal and carry no fixed fraction.
pub mod phase_offsets {
    /// Common denominator for every epoch phase-offset fraction (13 §3.1).
    pub const DENOMINATOR: u32 = 21;
    pub const INTAKE_NUM: u32 = 0;
    pub const QUALIFY_NUM: u32 = 3;
    pub const SEED_NUM: u32 = 4;
    pub const TRADE_NUM: u32 = 5;
    /// Decision-window accrual start (final 72 h; trailing = final 24 h).
    pub const DECIDE_WINDOW_NUM: u32 = 15;
    pub const DECIDE_NUM: u32 = 18;
    pub const HOUSEKEEPING_NUM: u32 = 20;
    /// Intake/Qualify/Seed/Trade/DecideWindow/Decide/Housekeeping order frozen
    /// by 02 §9.
    pub const ORDERED: [(u32, u32); 7] = [
        (INTAKE_NUM, DENOMINATOR),
        (QUALIFY_NUM, DENOMINATOR),
        (SEED_NUM, DENOMINATOR),
        (TRADE_NUM, DENOMINATOR),
        (DECIDE_WINDOW_NUM, DENOMINATOR),
        (DECIDE_NUM, DENOMINATOR),
        (HOUSEKEEPING_NUM, DENOMINATOR),
    ];
}

impl Branch {
    pub const fn codec_index(self) -> u8 {
        match self {
            Self::Accept => 0,
            Self::Reject => 1,
        }
    }
}
impl MarketKind {
    pub const fn codec_index(self) -> u8 {
        match self {
            Self::DecisionAccept => 0,
            Self::DecisionReject => 1,
            Self::GateS_Adopt => 2,
            Self::GateS_Reject => 3,
            Self::GateC_Adopt => 4,
            Self::GateC_Reject => 5,
            Self::Baseline => 6,
        }
    }
}
impl RejectReason {
    pub const fn codec_index(self) -> u8 {
        match self {
            Self::NotDecisionGrade => 0,
            Self::GateVetoSurvival => 1,
            Self::GateVetoSecurity => 2,
            Self::HurdleNotMet => 3,
            Self::ConvergenceFailed => 4,
            Self::SecondExtensionFailed => 5,
            Self::ProcessHold => 6,
            Self::ConstitutionViolation => 7,
            Self::ResourceConflict => 8,
            Self::RateLimited => 9,
            Self::VetoUpheldByReview => 10,
            Self::StaleQueue => 11,
            Self::PayloadReverted => 12,
            Self::NotRatified => 13,
            Self::SecuritySizing => 14,
            Self::AttestationMissing => 15,
            Self::RolloverExhausted => 16,
        }
    }
}
impl TradeSide {
    pub const fn codec_index(self) -> u8 {
        match self {
            Self::BuyLong => 0,
            Self::BuyShort => 1,
            Self::SellLong => 2,
            Self::SellShort => 3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_version_is_v13() {
        // SQ-186 adds `Epoch::TreasuryBondAskBps` — the kernel slope of 08 §7's
        // TREASURY intake bond — to 02 §9's frozen metadata-constant list. Purely
        // additive, so `transaction_version` is untouched (02 §13 rule 7).
        assert_eq!(INTEGRATION_CONTRACT_VERSION, 15);
    }

    #[test]
    fn canonical_v1_metric_ids_match_05_section_4_3() {
        assert_eq!(
            [
                metric_ids::X,
                metric_ids::R,
                metric_ids::E,
                metric_ids::H,
                metric_ids::PI,
                metric_ids::K,
                metric_ids::U,
                metric_ids::F,
                metric_ids::D_EFF,
                metric_ids::P_FEES,
                metric_ids::P_QUALIFIED_USERS,
                metric_ids::P_SETTLED_VALUE,
                metric_ids::A_SHIPPED_UPGRADES,
                metric_ids::A_RUNTIME_PERF,
                metric_ids::A_INTEGRATIONS,
            ],
            [1, 2, 3, 4, 5, 6, 10, 11, 12, 20, 21, 22, 30, 31, 32]
        );
    }

    #[test]
    fn bounded_vec_rejects_over_bound() {
        let values = alloc::vec![1_u8, 2, 3];
        assert!(BoundedVec::<_, 2>::try_from(values).is_err());
    }

    #[test]
    fn scale_decode_enforces_bounded_vec_limit() {
        let encoded = alloc::vec![1_u8, 2, 3].encode();
        assert!(BoundedVec::<u8, 2>::decode(&mut &encoded[..]).is_err());
    }

    struct CountingInput<'a> {
        data: &'a [u8],
        read: usize,
        alloc_mem: usize,
    }

    impl parity_scale_codec::Input for CountingInput<'_> {
        fn remaining_len(&mut self) -> Result<Option<usize>, parity_scale_codec::Error> {
            Ok(Some(self.data.len().saturating_sub(self.read)))
        }

        fn read(&mut self, into: &mut [u8]) -> Result<(), parity_scale_codec::Error> {
            let end = self
                .read
                .checked_add(into.len())
                .filter(|end| *end <= self.data.len())
                .ok_or_else(|| parity_scale_codec::Error::from("unexpected end of input"))?;
            into.copy_from_slice(&self.data[self.read..end]);
            self.read = end;
            Ok(())
        }

        fn on_before_alloc_mem(&mut self, size: usize) -> Result<(), parity_scale_codec::Error> {
            self.alloc_mem = self.alloc_mem.saturating_add(size);
            Ok(())
        }
    }

    #[test]
    fn scale_decode_rejects_oversized_length_before_reading_elements() {
        // 1000 advertised elements against a bound of 4: the decoder must fail
        // after the compact length prefix, without consuming element bytes.
        let encoded = alloc::vec![7_u8; 1000].encode();
        let prefix_len = parity_scale_codec::Compact(1000_u32).encoded_size();
        let mut input = CountingInput {
            data: &encoded,
            read: 0,
            alloc_mem: 0,
        };
        assert!(BoundedVec::<u8, 4>::decode(&mut input).is_err());
        assert_eq!(input.read, prefix_len);
        assert_eq!(input.alloc_mem, 0);
    }

    #[test]
    fn scale_decode_charges_allocation_for_in_bound_length() {
        let encoded = alloc::vec![7_u8; 4].encode();
        let mut input = CountingInput {
            data: &encoded,
            read: 0,
            alloc_mem: 0,
        };
        let decoded = BoundedVec::<u8, 4>::decode(&mut input).unwrap();
        assert_eq!(decoded.as_slice(), &[7, 7, 7, 7]);
        assert_eq!(input.alloc_mem, 4);
    }

    #[test]
    fn enum_indices_are_stable() {
        assert_eq!(Branch::Accept.codec_index(), 0);
        assert_eq!(RejectReason::AttestationMissing.codec_index(), 15);
        assert_eq!(TradeSide::SellShort.codec_index(), 3);
    }

    #[test]
    fn market_kind_indices_are_stable() {
        let variants = [
            MarketKind::DecisionAccept,
            MarketKind::DecisionReject,
            MarketKind::GateS_Adopt,
            MarketKind::GateS_Reject,
            MarketKind::GateC_Adopt,
            MarketKind::GateC_Reject,
            MarketKind::Baseline,
        ];
        for (index, kind) in variants.iter().enumerate() {
            let index = index as u8;
            assert_eq!(kind.codec_index(), index);
            // 02 §7 SCALE index = declaration order.
            assert_eq!(kind.encode(), alloc::vec![index]);
        }
    }

    #[test]
    fn market_kind_variant_names_match_contract_02_section_5() {
        use scale_info::TypeDef;
        // 02 §5 (`MarketCreated` row) freezes these exact names, and `02` is canonical
        // for any name that appears on the contract surface (02 line 5). The canonical
        // frontend decodes `MarketCreated.kind` by its TypeInfo variant name, so this
        // locks the spelling byte-for-byte against an accidental future rename (SQ-37).
        const CONTRACT_NAMES: [&str; 7] = [
            "DecisionAccept",
            "DecisionReject",
            "GateS_Adopt",
            "GateS_Reject",
            "GateC_Adopt",
            "GateC_Reject",
            "Baseline",
        ];
        let type_info = MarketKind::type_info();
        let names: alloc::vec::Vec<&str> = match &type_info.type_def {
            TypeDef::Variant(variant) => variant.variants.iter().map(|v| v.name).collect(),
            _ => panic!("MarketKind must encode as a SCALE variant type"),
        };
        assert_eq!(names, CONTRACT_NAMES);
    }

    #[test]
    fn oracle_round_view_fields_match_contract_02_section_4() {
        use scale_info::TypeDef;
        // 02 §4 (contract v3) freezes the FE-facing `OracleRoundView` projection.
        // The canonical frontend keys per-version games by these fields (incl.
        // `spec_version`, added in v3), so lock the name + SCALE order against
        // re-divergence (rule 5) — this is the §4 half of the SQ-58 reconciliation
        // that `RoundState`'s lock in `oracle-core` does not cover.
        const CONTRACT_FIELDS: [&str; 11] = [
            "component",
            "epoch",
            "spec_version",
            "round",
            "reporter",
            "value_1e9",
            "evidence_hash",
            "bond",
            "challenge_deadline",
            "acked_by_watchtowers",
            "escalated",
        ];
        let type_info = OracleRoundView::type_info();
        let names: alloc::vec::Vec<&str> = match &type_info.type_def {
            TypeDef::Composite(c) => c.fields.iter().filter_map(|f| f.name).collect(),
            _ => panic!("OracleRoundView must encode as a SCALE composite type"),
        };
        assert_eq!(names, CONTRACT_FIELDS);
    }

    #[test]
    fn nav_view_v4_fields_and_scale_layout_match_contract_02_section_4() {
        use scale_info::TypeDef;

        const CONTRACT_FIELDS: [&str; 13] = [
            "total",
            "main",
            "pol",
            "insurance",
            "keeper",
            "oracle",
            "rewards",
            "stream_remainders",
            "obligations",
            "haircut_flag",
            "spendable_nav",
            "meter_utilization_bps",
            "class_floors",
        ];
        let type_info = NavView::type_info();
        let names: alloc::vec::Vec<&str> = match &type_info.type_def {
            TypeDef::Composite(composite) => composite
                .fields
                .iter()
                .filter_map(|field| field.name)
                .collect(),
            _ => panic!("NavView must encode as a SCALE composite type"),
        };
        assert_eq!(names, CONTRACT_FIELDS);

        let view = NavView {
            total: 1,
            main: 2,
            pol: 3,
            insurance: 4,
            keeper: 5,
            oracle: 6,
            rewards: 7,
            stream_remainders: 8,
            obligations: 9,
            haircut_flag: true,
            spendable_nav: 0,
            meter_utilization_bps: 7_500,
            class_floors: [10, 20, 30, 40],
        };
        let encoded = view.encode();
        assert_eq!(NavView::decode(&mut &encoded[..]).unwrap(), view);
        assert_eq!(NavView::max_encoded_len(), 229);
    }

    #[test]
    fn v6_variant_shapes_and_scale_layout_are_frozen() {
        use scale_info::TypeDef;

        let vault_names: alloc::vec::Vec<&str> = match &VaultState::type_info().type_def {
            TypeDef::Variant(variant) => variant.variants.iter().map(|v| v.name).collect(),
            _ => panic!("VaultState must encode as a SCALE variant type"),
        };
        assert_eq!(
            vault_names,
            [
                "Open",
                "Resolved",
                "ScalarSettled",
                "Voided",
                "BaselineSettled",
            ]
        );
        let baseline = VaultState::BaselineSettled {
            s: FixedU64(700_000_000),
        };
        assert_eq!(baseline.encode()[0], 4);
        assert_eq!(
            VaultState::decode(&mut &baseline.encode()[..]).unwrap(),
            baseline
        );
        assert_eq!(VaultState::max_encoded_len(), 10);

        let ratification_names: alloc::vec::Vec<&str> =
            match &RatificationStatus::type_info().type_def {
                TypeDef::Variant(variant) => variant.variants.iter().map(|v| v.name).collect(),
                _ => panic!("RatificationStatus must encode as a SCALE variant type"),
            };
        assert_eq!(
            ratification_names,
            ["NotRequired", "NoPassedRecord", "Passed"]
        );
        assert_eq!(RatificationStatus::NotRequired.encode(), [0]);
        assert_eq!(RatificationStatus::NoPassedRecord.encode(), [1]);
        assert_eq!(
            RatificationStatus::Passed { referendum: 9 }.encode(),
            [2, 9, 0, 0, 0]
        );
        assert_eq!(RatificationStatus::max_encoded_len(), 5);
    }

    #[test]
    fn v6_view_appends_preserve_field_order_and_encoded_bounds() {
        use scale_info::TypeDef;

        fn fields(type_info: &scale_info::Type) -> alloc::vec::Vec<&str> {
            match &type_info.type_def {
                TypeDef::Composite(composite) => composite
                    .fields
                    .iter()
                    .filter_map(|field| field.name)
                    .collect(),
                _ => panic!("view must encode as a SCALE composite type"),
            }
        }

        assert_eq!(
            fields(&QuoteView::type_info()),
            [
                "cost",
                "fee",
                "p_after_1e9",
                "max_trade",
                "within_domain",
                "evaluable",
            ]
        );
        assert_eq!(QuoteView::max_encoded_len(), 58);

        assert_eq!(
            fields(&WelfareView::type_info()),
            [
                "epoch",
                "spec_version",
                "s_pillar_1e9",
                "c_onchain_1e9",
                "c_attested_1e9",
                "p_pillar_1e9",
                "a_pillar_1e9",
                "gate_s_1e9",
                "gate_c_1e9",
                "w_current_1e9",
                "s_breached",
                "c_breached",
                "reserve_flag",
                "active_spec_available",
            ]
        );
        assert_eq!(WelfareView::max_encoded_len(), 74);

        assert_eq!(
            fields(&ParamView::type_info()),
            [
                "key",
                "value",
                "min",
                "max",
                "max_delta",
                "cooldown_blocks",
                "last_change",
                "class",
                "min_next",
                "max_next",
            ]
        );
        assert_eq!(ParamView::max_encoded_len(), 121);
    }

    #[test]
    fn cohort_summary_v4_bound_and_scale_layout_match_contract_02_section_4() {
        assert_eq!(bounds::MAX_COHORT_PROPOSALS, 12);
        let proposals = (0..bounds::MAX_COHORT_PROPOSALS)
            .map(|pid| (u64::from(pid), ProposalClass::Param, DecisionOutcome::Adopt))
            .collect::<alloc::vec::Vec<_>>()
            .try_into()
            .unwrap();
        let summary = CohortSummary {
            epoch: 7,
            s_1e9: FixedU64(500_000_000),
            baseline_twap_1e9: FixedU64(490_000_000),
            proposals,
            voided: false,
            settled_at: 42,
        };
        let encoded = summary.encode();
        assert_eq!(CohortSummary::decode(&mut &encoded[..]).unwrap(), summary);
        assert_eq!(CohortSummary::max_encoded_len(), 158);
    }

    #[test]
    fn proposal_scale_round_trips_and_bounds_resources() {
        let proposal = Proposal::<AccountId> {
            id: 7,
            proposer: [1u8; 32],
            class: ProposalClass::Treasury,
            state: ProposalState::Trading,
            epoch: 3,
            submitted_at: 100,
            payload_hash: [2u8; 32],
            payload_len: 4096,
            ask: 1_000_000,
            bond: 50_000,
            resources: BoundedVec::try_from(alloc::vec![[9u8; 8], [8u8; 8]]).unwrap(),
            metric_spec: 1,
            decide_at: 200,
            rerun: false,
            extended: true,
            delayed_once: false,
            markets: Some(MarketSet {
                accept: 1,
                reject: 2,
                gates: Some([3, 4, 5, 6]),
                baseline: 7,
            }),
            maturity: Some(300),
            grace_end: None,
            version_constraint: Some(RuntimeVersionConstraint {
                spec_name: BoundedVec::try_from(alloc::vec![98, 108, 101, 97, 118]).unwrap(),
                spec_version: 42,
            }),
            decision: Some(DecisionOutcome::Adopt),
        };
        let bytes = proposal.encode();
        // Declaration order is the SCALE layout: id (u64 LE) leads.
        assert_eq!(&bytes[..8], &7u64.to_le_bytes());
        assert_eq!(
            Proposal::<AccountId>::decode(&mut &bytes[..]).unwrap(),
            proposal
        );
        // Golden order-lock: independently concatenate every field's encoding in
        // the 05 §1.2 declaration order and require byte-equality, so a reordering
        // of fields 1–21 (which a plain round-trip would not catch) fails here.
        let mut ordered = Vec::new();
        ordered.extend(proposal.id.encode());
        ordered.extend(proposal.proposer.encode());
        ordered.extend(proposal.class.encode());
        ordered.extend(proposal.state.encode());
        ordered.extend(proposal.epoch.encode());
        ordered.extend(proposal.submitted_at.encode());
        ordered.extend(proposal.payload_hash.encode());
        ordered.extend(proposal.payload_len.encode());
        ordered.extend(proposal.ask.encode());
        ordered.extend(proposal.bond.encode());
        ordered.extend(proposal.resources.encode());
        ordered.extend(proposal.metric_spec.encode());
        ordered.extend(proposal.decide_at.encode());
        ordered.extend(proposal.rerun.encode());
        ordered.extend(proposal.extended.encode());
        ordered.extend(proposal.delayed_once.encode());
        ordered.extend(proposal.markets.encode());
        ordered.extend(proposal.maturity.encode());
        ordered.extend(proposal.grace_end.encode());
        ordered.extend(proposal.version_constraint.encode());
        ordered.extend(proposal.decision.encode());
        assert_eq!(
            bytes, ordered,
            "SCALE layout must follow 05 §1.2 field order"
        );
        // 02 §114: the record is bounded ≤ 512 B so `pallet-epoch`'s map is bounded.
        assert!(Proposal::<AccountId>::max_encoded_len() <= 512);

        // resources is bounded at 8 (13 §4): a 9-element encoding is rejected at decode.
        let nine = alloc::vec![[0u8; 8]; 9];
        let mut over = 7u64.encode();
        over.extend_from_slice(&[1u8; 32]); // proposer
        over.extend_from_slice(&ProposalClass::Treasury.encode());
        over.extend_from_slice(&ProposalState::Trading.encode());
        over.extend_from_slice(&3u32.encode()); // epoch
        over.extend_from_slice(&100u32.encode()); // submitted_at
        over.extend_from_slice(&[2u8; 32]); // payload_hash
        over.extend_from_slice(&4096u32.encode()); // payload_len
        over.extend_from_slice(&1_000_000u128.encode()); // ask
        over.extend_from_slice(&50_000u128.encode()); // bond
        over.extend_from_slice(&nine.encode()); // resources: 9 > bound 8
        assert!(Proposal::<AccountId>::decode(&mut &over[..]).is_err());
    }

    #[test]
    fn execution_record_scale_round_trips() {
        let record = ExecutionRecord {
            pid: 7,
            payload_hash: [2u8; 32],
            class: ProposalClass::Code,
            executed_at: 900,
            result: DispatchOutcomeCode::Ok,
        };
        let bytes = record.encode();
        assert_eq!(&bytes[..8], &7u64.to_le_bytes());
        assert_eq!(ExecutionRecord::decode(&mut &bytes[..]).unwrap(), record);
    }

    #[test]
    fn view_types_have_pinned_encoded_bounds() {
        // 02 §3/§4: the FutarchyApi view types are fully defined here and bounded.
        // Pinning the MaxEncodedLen locks their SCALE layout as a regression.
        assert_eq!(
            (
                EpochStatusView::max_encoded_len(),
                ProposalSummaryView::max_encoded_len(),
                QuoteView::max_encoded_len(),
                DecisionStatsView::max_encoded_len(),
                QueuedExecutionView::max_encoded_len(),
                RatificationStatus::max_encoded_len(),
            ),
            (19, 159, 58, 155, 93, 5)
        );
    }

    #[test]
    fn phase_offsets_are_monotonic_fractions_over_21() {
        use phase_offsets::*;
        assert_eq!(DENOMINATOR, 21);
        let boundaries = [
            INTAKE_NUM,
            QUALIFY_NUM,
            SEED_NUM,
            TRADE_NUM,
            DECIDE_WINDOW_NUM,
            DECIDE_NUM,
            HOUSEKEEPING_NUM,
        ];
        assert!(boundaries.windows(2).all(|w| w[0] < w[1]));
        assert!(*boundaries.last().unwrap() < DENOMINATOR);
        // Pin the exact 13 §3.1 numerators, not just their ordering.
        assert_eq!(boundaries, [0, 3, 4, 5, 15, 18, 20]);
    }

    #[test]
    fn epoch_constant_values_match_contract_02_section_9() {
        // 02 §9 freezes these metadata-visible Epoch constant values and their
        // PARAM/TREASURY/CODE/META ordering. Any change here MUST be a deliberate
        // integration-contract revision that also re-freezes the release manifest.
        assert_eq!(
            phase_offsets::ORDERED,
            [
                (0, 21),
                (3, 21),
                (4, 21),
                (5, 21),
                (15, 21),
                (18, 21),
                (20, 21),
            ]
        );
        assert_eq!(kernel::DECISION_DELTA_FLOORS, [FixedU64(5_000_000); 4]);
        assert_eq!(kernel::DECISION_SIGMA_FLOORS, [FixedU64(0); 4]);
    }

    /// SQ-128: the default (production) build must carry the frozen 13 §1 epoch
    /// floors byte-for-byte — the `fast-timing` feature must never leak into a
    /// release binary. This runs in the default `cargo test --workspace` (feature
    /// off) and pins the release values so an accidental gate edit fails loudly.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn production_epoch_timing_floors_are_frozen() {
        assert_eq!(kernel::MIN_EPOCH_LENGTH_BLOCKS, 201_600);
        assert_eq!(kernel::PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS, 201_600);
        assert_eq!(kernel::MAX_ARCHIVE_DELAY_BLOCKS, 5_256_000);
        assert_eq!(bounds::MAX_MARKETS_PER_EPOCH, 73);
        assert_eq!(bounds::MAX_ARCHIVE_MARKET_BATCHES, 28);
        assert_eq!(bounds::MAX_STORED_MARKETS, 2_240);
        assert_eq!(kernel::DECISION_WINDOW_FLOOR_BLOCKS, 14_400);
        assert_eq!(kernel::DECISION_WINDOW_FLOOR_BLOCKS, kernel::BLOCKS_PER_DAY);
        // Drill-08 expedited-lane lead and drill-04 dead-man stall threshold: the
        // release binary must carry the frozen 13 §2 values (the `fast-timing`
        // compression must never leak into production).
        assert_eq!(kernel::DESCRIPTOR_LEAD_TIME_BLOCKS, 43_200);
        assert_eq!(kernel::DEAD_MAN_RELAY_BLOCKS, 4_800);
    }

    #[test]
    fn stored_market_capacity_is_derived_separately_from_live_pol_capacity() {
        assert_eq!(
            bounds::MAX_MARKETS_PER_EPOCH,
            bounds::MAX_COHORT_PROPOSALS
                .saturating_mul(bounds::BOOKS_PER_PROPOSAL)
                .saturating_add(1),
        );
        assert_eq!(
            bounds::MAX_ARCHIVE_MARKET_BATCHES,
            kernel::MAX_ARCHIVE_DELAY_BLOCKS
                .div_ceil(kernel::PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS)
                .saturating_add(1),
        );
        assert_eq!(
            bounds::MAX_STORED_MARKETS,
            bounds::MAX_LIVE_MARKETS.saturating_add(
                bounds::MAX_ARCHIVE_MARKET_BATCHES.saturating_mul(bounds::MAX_MARKETS_PER_EPOCH),
            ),
        );
        assert_eq!(bounds::MAX_LIVE_MARKETS, 196);
        assert_eq!(bounds::MAX_STORED_MARKETS, 2_240);
    }

    /// SQ-501: the occupancy derivations must reproduce 13 §5 items 1–4's
    /// published figures exactly, or the screen built on them is comparing
    /// against numbers the document does not state.
    ///
    /// Production-magnitude assertions, so they run in the default build only —
    /// the `fast-timing` feature compresses the epoch clock these figures are
    /// derived at (SQ-128), exactly like the neighbouring floor pins.
    #[cfg(not(feature = "fast-timing"))]
    #[test]
    fn occupancy_envelopes_reproduce_the_published_13_5_figures() {
        use kernel::OccupancyParams;

        // --- item 1 -------------------------------------------------------
        // 196 = 32·6 + 4: one book set per live proposal plus one Baseline book
        // per non-terminal cohort.
        assert_eq!(
            bounds::MAX_LIVE_MARKETS,
            bounds::MAX_LIVE_PROPOSALS * bounds::BOOKS_PER_PROPOSAL
                + bounds::MAX_NON_TERMINAL_COHORTS,
        );
        // "2,240 = 196 + (ceil(1 yr / 14 d) + 1)·(12·6 + 1)" — the same
        // derivation the screen runs, evaluated at each input's compiled bound
        // (the archive ceiling, the 14-day epoch floor, the 12-slot registry
        // maximum). That it lands exactly on `MAX_STORED_MARKETS` is what makes
        // `derived <= MAX_STORED_MARKETS` the right comparison.
        let worst_case = OccupancyParams {
            epoch_length: kernel::PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS,
            epoch_slots: bounds::MAX_COHORT_PROPOSALS,
            obs_interval: 10,
            dec_window: 43_200,
            archive_delay: kernel::MAX_ARCHIVE_DELAY_BLOCKS,
        };
        let retained = kernel::derived_retained_markets(&worst_case).expect("derivable");
        assert_eq!(retained, 2_240);
        assert_eq!(retained, bounds::MAX_STORED_MARKETS);
        // "2,240 books × 205 B = 459,200 B ≈ 448.4 KiB, within a 512 KiB budget".
        let retained_bytes = retained * kernel::MARKET_BOOK_MAX_BYTES;
        assert_eq!(retained_bytes, 459_200);
        assert_eq!(retained_bytes * 10 / 1024, 4_484); // 448.4 KiB
        assert!(retained_bytes <= kernel::RETAINED_MARKETS_BUDGET_BYTES);

        // --- item 2 -------------------------------------------------------
        // "≤ 32 live + 4 cohorts × 5 settling = ≤ 52 × 160 B ≈ 8.1 KiB, within
        // the ≤ 13 KiB budget"; ~256 B stays the pinned per-vault ceiling, and
        // 52 × 256 is exactly where the 13 KiB budget comes from.
        let defaults = OccupancyParams {
            epoch_length: 302_400,
            epoch_slots: 5,
            obs_interval: 10,
            dec_window: 43_200,
            archive_delay: kernel::MAX_ARCHIVE_DELAY_BLOCKS,
        };
        let vaults = kernel::derived_vault_occupancy(defaults.epoch_slots).expect("derivable");
        assert_eq!(vaults, 52);
        assert_eq!(vaults, kernel::LIVE_VAULT_ENVELOPE);
        assert_eq!(vaults * 160, 8_320); // ≈ 8.1 KiB at the measured VaultInfo
        assert_eq!(
            kernel::LIVE_VAULT_ENVELOPE * kernel::VAULT_MAX_BYTES,
            kernel::VAULT_OCCUPANCY_BUDGET_BYTES,
        );

        // --- item 3 -------------------------------------------------------
        // "`market.reap` reads/removes at most 28 protocol-position cells";
        // "per-vault reap drains the `(PositionId, *)` prefix in ReapBatch = 100
        // chunks"; "dusting an account to its 64-cap now costs 6.4 USDC".
        assert_eq!(
            kernel::derived_market_reap_protocol_cells().expect("derivable"),
            kernel::MARKET_REAP_PROTOCOL_POSITION_CELLS,
        );
        assert_eq!(kernel::MARKET_REAP_PROTOCOL_POSITION_CELLS, 28);
        assert_eq!(kernel::REAP_BATCH, 100);
        // The 14 is 2 `Branch`es × the `PositionKind` cardinality, and that
        // cardinality is asserted exhaustively below — a new variant fails to
        // compile there rather than silently invalidating item 3.
        assert_eq!(
            kernel::PROPOSAL_POSITION_INSTRUMENTS,
            position_kind_cardinality() * 2,
        );
        assert_eq!(
            u128::from(bounds::MAX_ACCOUNT_POSITIONS) * kernel::POSITION_DEPOSIT_USDC,
            6_400_000, // 6.4 USDC per victim account
        );

        // --- item 4 -------------------------------------------------------
        // "31 trading books × (43,200/10) = 133,920 decision-critical
        // observations/epoch; × (187,200/10) = 580,320 full-window".
        assert_eq!(
            kernel::derived_trading_books(defaults.epoch_slots).expect("derivable"),
            31
        );
        assert_eq!(
            kernel::derived_trade_window_blocks(defaults.epoch_length).expect("derivable"),
            187_200,
        );
        assert_eq!(
            kernel::derived_decision_critical_observations(&defaults).expect("derivable"),
            kernel::KEEPER_DECISION_CRITICAL_OBSERVATIONS,
        );
        assert_eq!(kernel::KEEPER_DECISION_CRITICAL_OBSERVATIONS, 133_920);
        assert_eq!(
            kernel::derived_full_window_observations(&defaults).expect("derivable"),
            kernel::KEEPER_FULL_WINDOW_OBSERVATIONS,
        );
        assert_eq!(kernel::KEEPER_FULL_WINDOW_OBSERVATIONS, 580_320);
    }

    /// The `PositionKind` cardinality 13 §5 item 3's 14-instrument proposal
    /// vault is built from, counted **exhaustively**: adding a variant (or a
    /// `GateType`) stops this compiling instead of leaving
    /// `PROPOSAL_POSITION_KINDS` quietly stale.
    #[cfg(not(feature = "fast-timing"))]
    fn position_kind_cardinality() -> u32 {
        let gates = [GateType::Survival, GateType::Security];
        // Exhaustive by construction: the match below has no wildcard arm.
        let mut counted = 0_u32;
        for kind in [
            PositionKind::BranchUsdc,
            PositionKind::Long,
            PositionKind::Short,
        ]
        .into_iter()
        .chain(gates.into_iter().map(PositionKind::GateYes))
        .chain(gates.into_iter().map(PositionKind::GateNo))
        {
            match kind {
                PositionKind::BranchUsdc
                | PositionKind::Long
                | PositionKind::Short
                | PositionKind::GateYes(GateType::Survival)
                | PositionKind::GateYes(GateType::Security)
                | PositionKind::GateNo(GateType::Survival)
                | PositionKind::GateNo(GateType::Security) => counted += 1,
            }
        }
        assert_eq!(counted, kernel::PROPOSAL_POSITION_KINDS);
        counted
    }

    /// Every occupancy derivation answers `None` — never a saturated or wrapped
    /// figure — on a degenerate or overflowing input, so the caller refuses
    /// instead of reading "no envelope was breached" (G-1).
    #[test]
    fn occupancy_derivations_fail_closed_on_degenerate_input() {
        use kernel::OccupancyParams;

        let zero_epoch = OccupancyParams {
            epoch_length: 0,
            epoch_slots: 5,
            obs_interval: 10,
            dec_window: 43_200,
            archive_delay: kernel::MAX_ARCHIVE_DELAY_BLOCKS,
        };
        assert_eq!(kernel::derived_retained_markets(&zero_epoch), None);

        let zero_interval = OccupancyParams {
            epoch_length: 302_400,
            epoch_slots: 5,
            obs_interval: 0,
            dec_window: 43_200,
            archive_delay: kernel::MAX_ARCHIVE_DELAY_BLOCKS,
        };
        assert_eq!(
            kernel::derived_decision_critical_observations(&zero_interval),
            None
        );
        assert_eq!(
            kernel::derived_full_window_observations(&zero_interval),
            None
        );

        // Overflow, not wrap-around, on absurd slot counts.
        assert_eq!(kernel::derived_trading_books(u32::MAX), None);
        assert_eq!(kernel::derived_vault_occupancy(u32::MAX), None);
        let huge_slots = OccupancyParams {
            epoch_slots: u32::MAX,
            ..zero_interval
        };
        assert_eq!(kernel::derived_retained_markets(&huge_slots), None);
        // A one-block epoch retains one batch per block of the archive delay.
        let one_block_epoch = OccupancyParams {
            epoch_length: 1,
            epoch_slots: 5,
            obs_interval: 10,
            dec_window: 43_200,
            archive_delay: u32::MAX,
        };
        assert_eq!(kernel::derived_retained_markets(&one_block_epoch), None);

        // The Trade-phase fraction rounds **up**: a partial block of trading
        // window is a whole block of observation the keeper must be paid for.
        assert_eq!(kernel::derived_trade_window_blocks(21), Some(13));
        assert_eq!(kernel::derived_trade_window_blocks(22), Some(14));
        assert_eq!(kernel::derived_trade_window_blocks(1), Some(1));
    }

    /// Under the compressed test build the same floors derive from the single
    /// `FAST_DAY_BLOCKS` knob and must keep the relationships `EpochParams::validate`
    /// enforces (05 §5 / 13 §1): a 21·FAST_DAY epoch clears the 14·FAST_DAY floor
    /// and the decision-window floor stays one compressed day. Guards against a
    /// future knob change that would break genesis validation.
    #[cfg(feature = "fast-timing")]
    #[test]
    fn fast_timing_floors_stay_internally_consistent() {
        assert_eq!(
            kernel::MIN_EPOCH_LENGTH_BLOCKS,
            14 * kernel::FAST_DAY_BLOCKS
        );
        assert_eq!(
            kernel::DECISION_WINDOW_FLOOR_BLOCKS,
            kernel::FAST_DAY_BLOCKS
        );
        // The compressed epoch.length default (21·FAST_DAY) must clear the floor
        // and stay a multiple of the phase denominator (D1/D2 in EpochParams).
        let epoch_len = 21 * kernel::FAST_DAY_BLOCKS;
        assert!(epoch_len >= kernel::MIN_EPOCH_LENGTH_BLOCKS);
        assert_eq!(epoch_len % phase_offsets::DENOMINATOR, 0);
        // Drill-08 expedited-lane lead: faithful three-day compression, strictly under
        // the compressed epoch so an authorized upgrade still applies within one epoch
        // (this relational check also rejects a degenerate FAST_DAY_BLOCKS = 0).
        assert_eq!(
            kernel::DESCRIPTOR_LEAD_TIME_BLOCKS,
            3 * kernel::FAST_DAY_BLOCKS
        );
        assert!(kernel::DESCRIPTOR_LEAD_TIME_BLOCKS < epoch_len);
        // Drill-04 dead-man stall threshold: an independent small floor (deliberately
        // not day-scaled), large enough to clear healthy relay best-over-finalized lag.
        assert_eq!(kernel::DEAD_MAN_RELAY_BLOCKS, 48);
    }
}
