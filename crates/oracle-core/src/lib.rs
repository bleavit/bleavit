#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use futarchy_primitives::{
    AccountId, Balance, BlockNumber, EpochId, FixedU64, MetricId, MetricSpecVersion, H256,
};
use origins_core::Origin;
use parity_scale_codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use scale_info::TypeInfo;

pub const MAX_REPORTERS: usize = 64;
/// One retained 07 §3 offense record per account that can hold a seat. A clean
/// exit leaves no row, so ordinary rotation can never fill this; only accounts
/// carrying a non-zero record (or an ejection) occupy one.
pub const MAX_REPORTER_RECORDS: usize = MAX_REPORTERS;
pub const MAX_WATCHTOWERS: usize = futarchy_primitives::kernel::WT_MAX as usize;
/// Live reporting rounds: ≤ 16 components × ≤ 4 concurrently-settling epochs ×
/// ≤ 2 frozen versions overlapping a MetricSpec activation boundary (07 §2(4)).
/// Raised from 64 so a per-version game cannot be the round that overflows the
/// bound (Codex F16 / SQ-59). Within 02 §3's `open_oracle_rounds` cap of 192.
pub const MAX_ROUNDS: usize = 128;
/// Settled values awaiting reaping; sized like [`MAX_ROUNDS`] (per-version).
pub const MAX_COMPONENT_VALUES: usize = 128;
/// Measurement epochs of settled-component history retained before
/// [`Oracle::reap_settled_before`] removes them (07 §13 "reaped at cohort
/// settlement").
///
/// **Derived.** The newest consumer of `ComponentValues[·, m, ·]` is
/// `pallet-welfare::record_snapshot(m)`, which runs in epoch `m+1` — 07 §11's
/// resolution establishes that `settle_cohort` reads the *snapshot*, never the
/// component values — and 07 §10's neutral carry-last reads the immediately
/// preceding epoch. Retaining `{current-3, current-2, current-1}` therefore
/// leaves the oldest retained epoch a full epoch past its last consumer and the
/// newest reaped one three epochs past, while holding at most
/// `16 components × 3 epochs × ≤ 2 concurrent frozen versions = 96` entries,
/// inside [`MAX_COMPONENT_VALUES`]. Without this reaper the map grows by ~16
/// entries per epoch forever and wedges the oracle at its own bound (SQ-492).
pub const COMPONENT_VALUE_RETAINED_EPOCHS: EpochId = 3;
/// Settled component values reaped per oracle-boundary crank
/// (13 §2 · `ComponentReapBatch`).
///
/// **Derived**: retaining [`COMPONENT_VALUE_RETAINED_EPOCHS`] epochs inside
/// [`MAX_COMPONENT_VALUES`] means one measurement epoch's values are exactly
/// `MAX_COMPONENT_VALUES / (COMPONENT_VALUE_RETAINED_EPOCHS + 1)` entries — the
/// steady-state arrival rate — so a single crank clears one epoch's worth and
/// the batch neither falls behind production nor is picked. Excess resumes on
/// the next crank, the resumable shape of `ReapBatch`/`OracleDeadlineCatchup`
/// rather than a rejection.
pub const COMPONENT_VALUE_REAP_BATCH: usize =
    MAX_COMPONENT_VALUES / (COMPONENT_VALUE_RETAINED_EPOCHS as usize + 1);
/// Upper bound on live acknowledgment records: at most one live round per game
/// key, each acknowledged by at most every registered watchtower. Pruned on
/// settle/escalate (see [`Oracle::settle_at`]/`crank_round_close`) so this holds
/// by construction; the FRAME shell's `AckRecords` storage bound is this value.
pub const MAX_ACK_RECORDS: usize = MAX_WATCHTOWERS * MAX_ROUNDS;
/// The block a game money-settled at `now` stops being retained for bond
/// disposal (07 §11(1)). Single home for the arithmetic so the two
/// neutralization paths — quorum failure and the d20 deadline crank — cannot
/// stamp different windows on the same kind of retention.
fn retention_deadline_from(now: BlockNumber) -> BlockNumber {
    now.saturating_add(futarchy_primitives::kernel::ORC_RETENTION_BLOCKS)
}

pub const ORC_WINDOW_BLOCKS: BlockNumber = 43_200;
pub const ORC_EXT_WINDOW_BLOCKS: BlockNumber =
    futarchy_primitives::kernel::WATCHTOWER_EXTENSION_BLOCKS;
pub const REPORT_WINDOW_BLOCKS: BlockNumber = 28_800;
pub const RES_PROBE_INTERVAL: BlockNumber = 14_400;
pub const RES_PROBE_TIMEOUT: BlockNumber = 600;
/// Probe ids reserve the high bit for the XCM wire namespace. The oracle must
/// never create an id that aliases that flag when the dispatcher encodes it.
pub const MAX_RESERVE_PROBE_QUERY_ID: u64 = (1_u64 << 63) - 1;
pub const ORC_ROUNDS: u8 = 3;
/// 07 §3: the 50 % stake slash lands on exactly the *second* wrong-value
/// finding. Single-homes the literal that `record_reporter_offense` used to
/// carry inline.
pub const OFFENSE_SLASH_THRESHOLD: u8 = 2;
/// 07 §3: ejection on the *third*. Ejection is permanent since contract v19 —
/// see [`Oracle::register_reporter_with_params`].
pub const OFFENSE_EJECTION_THRESHOLD: u8 = 3;
pub const ORC_ROUND_CAP_MIN: u8 = futarchy_primitives::kernel::ORC_ROUNDS_MIN;
pub const ORC_ROUND_CAP_MAX: u8 = futarchy_primitives::kernel::ORC_ROUNDS_MAX;
pub const ORC_BOND_FLOOR: Balance = 10_000_000_000;
pub const ORC_BOND_BPS: u32 = 250;
pub const ORC_REPORTER_STAKE: Balance = 100_000_000_000;
pub const WT_STAKE: Balance = 25_000_000_000;
pub const WT_QUORUM: u8 = futarchy_primitives::kernel::WT_QUORUM;
pub const RES_FAIL_THRESHOLD: u8 = 2;
pub const RES_RECOVER_THRESHOLD: u8 = 3;
pub const RES_PROBE_AMOUNT: Balance = 100_000;
/// 13 §5 `orc.max_proof_bytes` (K): 256 KiB per `recompute_proof` submission.
pub const ORC_MAX_PROOF_BYTES: usize = futarchy_primitives::kernel::ORC_MAX_PROOF_BYTES as usize;
/// Component values are FixedU64 (1e9 scale) in [0, 1] before aggregation
/// (05 §4.4 determinism rule 1).
pub const COMPONENT_VALUE_MAX: u64 = 1_000_000_000;

/// Live oracle and reserve-probe tunables sourced from the constitution.
///
/// The frame-free core receives one plain snapshot from its FRAME shell for
/// each operation. [`Self::DEFAULT`] preserves the genesis behavior exactly;
/// production adapters replace individual fields from live
/// `pallet-constitution::Params` reads.
#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct OracleParams {
    pub window: BlockNumber,
    pub rounds: u8,
    pub bond_floor: Balance,
    /// Basis points, i.e. 250 = 2.5%.
    pub bond_bps: u32,
    pub reporter_stake: Balance,
    pub watchtower_stake: Balance,
    pub watchtower_quorum: u8,
    pub probe_interval: BlockNumber,
    pub probe_timeout: BlockNumber,
    pub fail_threshold: u8,
    pub recover_threshold: u8,
    pub probe_amount: Balance,
}

impl OracleParams {
    pub const DEFAULT: Self = Self {
        window: ORC_WINDOW_BLOCKS,
        rounds: ORC_ROUNDS,
        bond_floor: ORC_BOND_FLOOR,
        bond_bps: ORC_BOND_BPS,
        reporter_stake: ORC_REPORTER_STAKE,
        watchtower_stake: WT_STAKE,
        watchtower_quorum: WT_QUORUM,
        probe_interval: RES_PROBE_INTERVAL,
        probe_timeout: RES_PROBE_TIMEOUT,
        fail_threshold: RES_FAIL_THRESHOLD,
        recover_threshold: RES_RECOVER_THRESHOLD,
        probe_amount: RES_PROBE_AMOUNT,
    };

    /// The reserve probe cannot establish useful evidence unless every cadence,
    /// timeout, transfer and health-latch input is non-zero. Registry bounds may
    /// become stricter later; this is only the structural safety floor.
    pub const fn reserve_probe_config_valid(&self) -> bool {
        self.probe_interval > 0
            && self.probe_timeout > 0
            && self.probe_amount > 0
            && self.fail_threshold > 0
            && self.recover_threshold > 0
    }
}

impl Default for OracleParams {
    fn default() -> Self {
        Self::DEFAULT
    }
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct ReporterInfo {
    pub stake: Balance,
    pub registered_at: BlockNumber,
    pub offenses: u8,
}

/// 07 §3's offense ladder, retained independently of the active seat.
///
/// Without this the ladder is unreachable by construction: `deregister_reporter`
/// returns the stake in full and `register_reporter` re-seated `offenses: 0`, so
/// a reporter answered the first adjudicated-false finding by exiting and
/// re-entering for the price of two extrinsics — and neither the second-offense
/// 50 % slash nor the third-offense ejection could ever be reached. Identical in
/// shape to the `pallet-attestor` defect closed by SQ-262.
///
/// Deliberately carries **no balance**: 07 §3's "exit returns the stake" is
/// untouched, so the I-29 custody sum in the shell's `do_try_state` is unchanged
/// by construction.
#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct ReporterRecord {
    pub account: AccountId,
    pub offenses: u8,
    pub ejected: bool,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct WatchtowerInfo {
    pub stake: Balance,
    pub registered_at: BlockNumber,
    pub inactive_epochs: u8,
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
pub enum SettlePath {
    Unchallenged,
    Recomputed,
    Adjudicated,
    /// Retained for SCALE stability; **no longer produced since contract v19**.
    ///
    /// A 07 §5.3 reporter default now settles [`SettlePath::Neutral`] with
    /// `flagged: true` (07 §5.3/§10): a default establishes that the reporter
    /// abandoned their assertion and establishes nothing about the challenger's,
    /// which no quorum acknowledged, no recomputation confirmed and no
    /// adjudication reviewed. Settling it forward was the whole of the
    /// self-challenge attack. Removing the variant would shift `Neutral`'s
    /// discriminant 4 → 3 and break the frozen 02 §6 `ComponentSettled` layout,
    /// so it stays; `Pallet::do_try_state` asserts no `ComponentValues` entry
    /// ever carries it.
    ChallengerDefault,
    Neutral,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct SettledComponent {
    pub value: FixedU64,
    pub path: SettlePath,
    pub flagged: bool,
}

/// Addresses one reporting game: 07 §2(4) runs the game per
/// `(component, epoch, frozen spec version)`.
#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct RoundKey {
    pub component: MetricId,
    pub epoch: EpochId,
    pub spec_version: MetricSpecVersion,
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct RoundState {
    pub component: MetricId,
    pub epoch: EpochId,
    pub round: u8,
    pub spec_version: MetricSpecVersion,
    pub reporter: AccountId,
    pub value: FixedU64,
    pub evidence_hash: H256,
    pub bond: Balance,
    pub challenge_deadline: BlockNumber,
    pub extended: bool,
    pub challenger: Option<AccountId>,
    pub counter_value: Option<FixedU64>,
    pub acks: u8,
    pub report_hash: H256,
    pub stake_at_risk: Balance,
    pub cumulative_reporter_bond: Balance,
    pub cumulative_challenger_bond: Balance,
}

/// Internal per-game schedule frozen when round one opens. This deliberately
/// lives beside [`RoundState`], whose SCALE layout is frozen by contract v4.
#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct StoredRoundSchedule {
    /// Every later `B_r` doubles from this value, so live amendments cannot
    /// reprice an in-flight dispute (07 §6.1/§13).
    pub round_one_bond: Balance,
    /// Terminal adjudication is gated by this frozen `orc.rounds` value.
    pub round_cap: u8,
}

/// How a terminal transition disposes of the two escrowed bond stacks.
///
/// An explicit three-way enum rather than a `reporter_wins: bool`, because the
/// third case is not a win for anybody: a retained round whose verdict never
/// lands has no adjudicated loser, so taking custody of either stack would
/// create a claim with no finding behind it (R-7). Encoding that as a second
/// bool would admit a `wins && refund` state with no meaning.
#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum BondDisposition {
    /// The challenger's stack is forfeit 40/60 (07 §5.5); the reporter's is released.
    ReporterWins,
    /// The reporter's stack is forfeit 40/60; the challenger's is released.
    ChallengerWins,
    /// No verdict landed inside 07 §11(1)'s retention window: both stacks are
    /// released to their posters. §11(4) prices the griefing move as the
    /// *capital lock-up* it is, not as a slash, and the values track's failure
    /// to rule is not a finding against either party (SQ-492).
    RefundBoth,
    /// The reporter abandoned a funded **round 1** (07 §5.3/§5.5, contract v19).
    ///
    /// Their stack is forfeit — that is conduct — but it routes **100 % to
    /// INSURANCE and pays no bounty**. At round 1 the game holds exactly two
    /// unrebutted assertions and one was abandoned; nothing on chain
    /// distinguishes an honest catch from a griefing or self-dealt one, and
    /// paying there makes challenging an honest *offline* reporter profitable.
    /// From round 2 the reporter consented to escalate under a doubled bond and
    /// then abandoned — a concession by conduct and a contest the challenger
    /// funded — so §6.2's honest-challenger revenue applies unchanged and the
    /// disposition is [`BondDisposition::ChallengerWins`].
    ///
    /// Precedent for paying nobody: `settle_bond_custody`'s no-challenger
    /// recompute arm — taking custody with no finding behind it is the unbacked
    /// claim the ledger discipline exists to prevent.
    ReporterDefaulted,
}

/// Internal custody instruction emitted by a terminal transition. This is not
/// persisted or exposed through the frozen `RoundState`; the FRAME shell uses it
/// to move the already-escrowed round-bond stacks atomically with the state diff.
#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct BondSettlement {
    pub reporter: AccountId,
    pub challenger: Option<AccountId>,
    pub reporter_bond: Balance,
    pub challenger_bond: Balance,
    pub disposition: BondDisposition,
}

#[derive(Clone, Copy, Debug, Decode, Default, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub struct ReserveHealth {
    pub consecutive_fails: u8,
    pub consecutive_passes: u8,
    pub unhealthy: bool,
    pub last_query_id: u64,
    pub last_probe_at: BlockNumber,
    pub pending_since: Option<BlockNumber>,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub enum Event {
    ReporterRegistered {
        who: AccountId,
        stake: Balance,
    },
    Reported {
        component: MetricId,
        epoch: EpochId,
        round: u8,
        reporter: AccountId,
        value: FixedU64,
        evidence_hash: H256,
        bond: Balance,
    },
    Challenged {
        component: MetricId,
        epoch: EpochId,
        round: u8,
        challenger: AccountId,
        counter_value: FixedU64,
        evidence_hash: H256,
        bond: Balance,
    },
    RoundEscalated {
        component: MetricId,
        epoch: EpochId,
        round: u8,
        new_bond: Balance,
    },
    RecomputeProven {
        component: MetricId,
        epoch: EpochId,
        value: FixedU64,
        prover: AccountId,
    },
    AdjudicationRequested {
        component: MetricId,
        epoch: EpochId,
        referendum: u32,
    },
    Adjudicated {
        component: MetricId,
        epoch: EpochId,
        value: FixedU64,
    },
    ComponentSettled {
        component: MetricId,
        epoch: EpochId,
        value: FixedU64,
        path: SettlePath,
    },
    NeutralSettlement {
        component: MetricId,
        epoch: EpochId,
        carried_value: FixedU64,
        flagged_epochs: u8,
    },
    WindowAcknowledged {
        component: MetricId,
        epoch: EpochId,
        round: u8,
        watchtower: AccountId,
    },
    WindowExtended {
        component: MetricId,
        epoch: EpochId,
        round: u8,
        new_deadline: BlockNumber,
    },
    QuorumFailed {
        component: MetricId,
        epoch: EpochId,
        round: u8,
    },
    ReporterSlashed {
        who: AccountId,
        amount: Balance,
        offense: u8,
    },
    ReporterEjected {
        who: AccountId,
    },
    WatchtowerRegistered {
        who: AccountId,
        stake: Balance,
    },
    WatchtowerInactive {
        who: AccountId,
        epoch: EpochId,
    },
    WatchtowerSlashed {
        who: AccountId,
        amount: Balance,
    },
    ReserveProbeSent {
        query_id: u64,
    },
    ReserveProbeResult {
        query_id: u64,
        passed: bool,
    },
    ReserveUnhealthy,
    ReserveRecovered,
    /// 07 §11(1)'s retention window closed with no terminal verdict: both
    /// stacks were refunded and the retained round reaped (SQ-492). Appended
    /// last — inserting mid-enum would shift every later SCALE discriminant.
    RetentionExpired {
        component: MetricId,
        epoch: EpochId,
        round: u8,
        reporter_bond: Balance,
        challenger_bond: Balance,
    },
    /// The retained 07 §3 record store was full of ejections and a departing or
    /// ejected account's record could not be kept (contract v19). An operational
    /// diagnostic only — off the frozen 02 §6 ingest set by that section's
    /// (a)–(c) rule. Appended last; inserting mid-enum would shift discriminants.
    ///
    /// Fails **open** deliberately (G-1): a full table must never abort a
    /// values-track verdict.
    ReporterRecordsFull {
        who: AccountId,
    },
}

#[derive(Clone, Copy, Debug, Decode, Encode, Eq, MaxEncodedLen, PartialEq, TypeInfo)]
pub enum Error {
    BadOrigin,
    AlreadyRegistered,
    NotRegistered,
    TooManyReporters,
    TooManyWatchtowers,
    WindowClosed,
    WindowOpen,
    BondBelowMinimum,
    SpecVersionMismatch,
    AlreadyFinal,
    AlreadyChallenged,
    QuorumPending,
    RoundNotFound,
    RoundLimit,
    DuplicateAck,
    ReserveUnhealthy,
    ProbeTooEarly,
    UnknownQuery,
    Overflow,
    NotRecomputable,
    ProofTooLarge,
    EvidenceMismatch,
    BadProof,
    /// A reported/adjudicated value is off the 05 §4.4 `[0, 1]` 1e9 grid.
    ValueOutOfBounds,
    /// 07 §5.2 (contract v19): the round's own reporter may not challenge it.
    /// §5.5 disposes of a round in favour of "the honest counterparty" and §5.3
    /// calls escalation "opt-in on both sides"; both are undefined when one
    /// account holds both roles. Appended last — SCALE discriminants are
    /// positional.
    SelfChallenge,
    /// 07 §3 (contract v19): an account ejected on the third offense may never
    /// re-register.
    ReporterEjected,
    /// The retained-record store is full of ejections, so a fresh registration
    /// cannot be proved *not* to be a dropped ban re-entering (07 §3
    /// saturation clause). Permissionless entry closes until a CODE change
    /// enlarges [`MAX_REPORTER_RECORDS`]. Appended last — SCALE discriminants
    /// are positional.
    ReporterRecordsSaturated,
}

#[derive(Clone, Debug, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct ReportInput {
    pub who: AccountId,
    pub now: BlockNumber,
    pub component: MetricId,
    pub epoch: EpochId,
    pub spec_version: MetricSpecVersion,
    pub value: FixedU64,
    pub evidence_hash: H256,
    pub stake_at_risk: Balance,
    pub report_window_end: BlockNumber,
    pub expected_spec: MetricSpecVersion,
}

#[derive(Clone, Debug, Default, Decode, Encode, Eq, PartialEq, TypeInfo)]
pub struct Oracle {
    pub reporters: Vec<(AccountId, ReporterInfo)>,
    /// 07 §3 offense records retained across `deregister_reporter` and ejection
    /// (contract v19). Bounded by [`MAX_REPORTER_RECORDS`]; carries no balance.
    /// `Oracle` is never itself stored, so adding this moves no on-chain SCALE —
    /// the shell persists it as its own internal storage item.
    pub reporter_records: Vec<ReporterRecord>,
    pub watchtowers: Vec<(AccountId, WatchtowerInfo)>,
    pub rounds: Vec<RoundState>,
    /// Parallel internal schedule state, one entry per live round. The FRAME
    /// shell persists this outside the contract-frozen `Rounds` value.
    pub round_schedules: Vec<(RoundKey, StoredRoundSchedule)>,
    pub component_values: Vec<((MetricId, EpochId, MetricSpecVersion), SettledComponent)>,
    pub reserve_health: ReserveHealth,
    pub events: Vec<Event>,
    /// Per-round watchtower acknowledgments, keyed by `report_hash` (07 §13:
    /// "acks are per-round, keyed by `report_hash`"). `pub` so the FRAME shell
    /// (A5) can hydrate/dehydrate the whole aggregate around each call; not part
    /// of the 02 §7.2 FE-read surface.
    pub ack_records: Vec<(MetricId, EpochId, MetricSpecVersion, u8, AccountId, H256)>,
    /// `(component, frozen spec version)` pairs whose `MetricSpec` declares the
    /// value deterministically recomputable from committed evidence (07 §2(4),
    /// §9 - recomputability is a property of the frozen version, not the
    /// MetricId). Populated from spec registration; `recompute_proof` fails
    /// closed for anything else.
    pub recomputable_components: Vec<(MetricId, MetricSpecVersion)>,
    /// Watchtowers that acknowledged ≥ 1 round (or newly registered) in the
    /// current, not-yet-swept epoch — the liveness-discipline activity set
    /// (07 §4). [`Oracle::sweep_watchtower_liveness`] consumes and clears it at
    /// the epoch boundary; the FRAME shell's epoch pallet drives that call (B1a).
    pub watchtower_active: Vec<AccountId>,
    /// Ephemeral terminal custody instructions; the FRAME shell consumes these
    /// before persisting and never writes them as storage.
    pub bond_settlements: Vec<BondSettlement>,
    /// Games whose money outcome was neutralized at the d20 deadline but whose
    /// bond stack remains live until a later terminal verdict (07 §11/I-18),
    /// each paired with the block at which that retention expires.
    ///
    /// The deadline is stamped at neutralization rather than derived at read
    /// time, on the same per-game freeze reasoning as
    /// [`StoredRoundSchedule`] (07 §6.1): a retained stack's disposal date must
    /// not move under an in-flight game.
    pub money_settled: Vec<(RoundKey, BlockNumber)>,
    /// Whether any round has existed since the last watchtower sweep — 07 §4's
    /// "an epoch with ≥ 1 open round", latched rather than inferred.
    ///
    /// It has to be a latch. A cleanly closed game is *removed* from `rounds`
    /// ([`Oracle::settle_at`]), so by the time the sweep runs at the epoch
    /// boundary a healthy epoch's rounds are gone and any survival-based
    /// predicate reads `false` — which is precisely the arm that *resets*
    /// `inactive_epochs`, so §4's charge/slash/eject would stay unreachable in
    /// exactly the case where watchtowers had work to do (SQ-491).
    /// [`Oracle::sweep_watchtower_liveness`] consumes and clears it.
    pub round_activity: bool,
}

impl Oracle {
    pub fn register_reporter_with_params(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        params: &OracleParams,
    ) -> Result<(), Error> {
        ensure!(!self.is_reporter(&who), Error::AlreadyRegistered);
        // 07 §3 (contract v19): the ladder is a property of the **account**, not
        // of the seat. Nothing in §3 resets strikes, and resetting them made
        // `deregister_reporter` + `register_reporter` — which returns the stake
        // in full and costs two extrinsics — erase both the second-offense 50 %
        // slash and the third-offense ejection, so the discipline was
        // unreachable in practice. Identical in shape to the `pallet-attestor`
        // defect closed by SQ-262.
        let carried = self
            .reporter_records
            .iter()
            .find(|r| r.account == who)
            .copied();
        ensure!(!carried.is_some_and(|r| r.ejected), Error::ReporterEjected);
        // 07 §3 saturation clause. `record_reporter_offense` releases the seat
        // whether or not the ban could be retained — it must, because G-1
        // forbids a full table from aborting a values-track verdict. That left
        // exactly one hole: with the store full of ejections the 65th ejection
        // kept no row, `carried` read `None`, and the account re-entered at
        // full stake with a clean ladder — the unconditional "MAY NEVER
        // re-register" defeated by arithmetic. The fix is at *entry*, not at
        // ejection: once no ban can be recorded, an account with no retained
        // row is indistinguishable from a dropped ban, so permissionless entry
        // closes rather than admitting one. Fail-closed (G-1), loud
        // (`ReporterRecordsFull` already fires at the drop), and reversible
        // only by a CODE change that enlarges the store. Seated reporters are
        // untouched, so the live set keeps serving.
        ensure!(
            carried.is_some() || !self.ejection_records_saturated(),
            Error::ReporterRecordsSaturated
        );
        ensure!(
            self.reporters.len() < MAX_REPORTERS,
            Error::TooManyReporters
        );
        let offenses = carried.map_or(0, |r| r.offenses);
        // 07 §2(5): "a reporter slashed to half stake on a second
        // adjudicated-false report remains registered until the third", and the
        // `orc.n_min` count "MUST exclude any seat holding less than
        // `orc.reporter_stake`". Re-seating at full stake would restore
        // countability the ladder took away.
        let stake = if offenses >= OFFENSE_SLASH_THRESHOLD {
            params
                .reporter_stake
                .saturating_sub(ceil_div(params.reporter_stake, 2))
        } else {
            params.reporter_stake
        };
        // Exactly one home per account: while seated, the seat carries the
        // count; the retained row exists only for departed/ejected accounts.
        self.reporter_records.retain(|r| r.account != who);
        self.reporters.push((
            who,
            ReporterInfo {
                stake,
                registered_at: now,
                offenses,
            },
        ));
        self.events.push(Event::ReporterRegistered { who, stake });
        Ok(())
    }

    pub fn deregister_reporter(&mut self, who: AccountId) -> Result<(), Error> {
        // 07 §3: exit returns the stake "after all rounds the reporter
        // participated in are closed". A **challenger's** bond is held in the
        // round just as a reporter's is, so challenging is participating — and
        // because a money-settled round stays in `rounds` until
        // `expire_retention_at`, this is also what keeps a late verdict from
        // ever landing on a departed account, which is what lets
        // `record_reporter_offense`'s unseated no-op stand unchanged.
        ensure!(
            !self
                .rounds
                .iter()
                .any(|r| r.reporter == who || r.challenger == Some(who)),
            Error::WindowOpen
        );
        let pos = self
            .reporters
            .iter()
            .position(|(a, _)| *a == who)
            .ok_or(Error::NotRegistered)?;
        let offenses = self.reporters[pos].1.offenses;
        // Conditional retention (the attestor's `has_unsettled_liability`
        // discipline): a clean reporter leaves **no** row, so ordinary rotation
        // can never fill the bound.
        if offenses > 0 && !self.upsert_reporter_record(who, offenses, false) {
            self.events.push(Event::ReporterRecordsFull { who });
        }
        self.reporters.remove(pos);
        Ok(())
    }

    /// Upsert `who`'s retained 07 §3 record.
    ///
    /// Returns `false` only when the store is full of **ejections**, which are
    /// never evicted: dropping a ban would re-admit a disqualified reporter,
    /// while dropping a 1–2 strike row costs one ladder reset. Filling it needs
    /// 64 accounts × 3 adjudicated-false findings, so the bound is priced rather
    /// than proved. The caller emits [`Event::ReporterRecordsFull`]; nothing
    /// here may fail a dispatch (G-1) — a full table must not abort a
    /// values-track verdict.
    fn upsert_reporter_record(&mut self, who: AccountId, offenses: u8, ejected: bool) -> bool {
        if let Some(rec) = self.reporter_records.iter_mut().find(|r| r.account == who) {
            rec.offenses = rec.offenses.max(offenses);
            rec.ejected |= ejected;
            return true;
        }
        if self.reporter_records.len() >= MAX_REPORTER_RECORDS {
            // Least severe first, oldest to break ties — deterministic, and
            // never an ejection.
            let victim = self.evictable_record();
            match victim {
                Some(idx) => {
                    self.reporter_records.remove(idx);
                }
                None => return false,
            }
        }
        self.reporter_records.push(ReporterRecord {
            account: who,
            offenses,
            ejected,
        });
        true
    }

    /// Index of the row [`upsert_reporter_record`] would evict to make room:
    /// least severe first, oldest to break ties, **never an ejection**.
    fn evictable_record(&self) -> Option<usize> {
        self.reporter_records
            .iter()
            .enumerate()
            .filter(|(_, r)| !r.ejected)
            .min_by_key(|(idx, r)| (r.offenses, *idx))
            .map(|(idx, _)| idx)
    }

    /// The store is full and holds nothing evictable — i.e. the next ban would
    /// be **dropped**. Defined as the exact complement of the room
    /// [`upsert_reporter_record`] looks for, so the entry gate in
    /// [`Self::register_reporter_with_params`] and the drop it guards against
    /// cannot drift apart.
    fn ejection_records_saturated(&self) -> bool {
        self.reporter_records.len() >= MAX_REPORTER_RECORDS && self.evictable_record().is_none()
    }

    pub fn register_watchtower_with_params(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        params: &OracleParams,
    ) -> Result<(), Error> {
        ensure!(!self.is_watchtower(&who), Error::AlreadyRegistered);
        ensure!(
            self.watchtowers.len() < MAX_WATCHTOWERS,
            Error::TooManyWatchtowers
        );
        self.watchtowers.push((
            who,
            WatchtowerInfo {
                stake: params.watchtower_stake,
                registered_at: now,
                inactive_epochs: 0,
            },
        ));
        self.events.push(Event::WatchtowerRegistered {
            who,
            stake: params.watchtower_stake,
        });
        // A freshly-registered watchtower is active for the epoch it joined, so
        // it is never charged inactivity for that epoch (07 §4).
        self.mark_watchtower_active(who);
        Ok(())
    }

    pub fn report(
        &mut self,
        input: ReportInput,
        params: &OracleParams,
        hash: impl FnOnce(&[u8]) -> H256,
    ) -> Result<(), Error> {
        ensure!(self.is_reporter(&input.who), Error::NotRegistered);
        ensure!(input.now <= input.report_window_end, Error::WindowClosed);
        ensure!(
            input.spec_version == input.expected_spec,
            Error::SpecVersionMismatch
        );
        // Component values live on the 05 §4.4 `[0, 1]` 1e9 grid: an
        // out-of-range attestation can never be a valid settled value, so it is
        // rejected at the door rather than allowed to settle unchallenged (I-18;
        // Codex F15).
        ensure!(
            input.value.0 <= COMPONENT_VALUE_MAX,
            Error::ValueOutOfBounds
        );
        ensure!(
            self.find_round(RoundKey {
                component: input.component,
                epoch: input.epoch,
                spec_version: input.spec_version,
            })
            .is_none(),
            Error::AlreadyFinal
        );
        // A settled `(component, epoch, version)` is final (I-18): a fresh
        // report must not reopen its game or shadow the stored value. Across a
        // MetricSpec activation boundary a second live cohort MAY require its
        // own game under a different frozen version (07 §2(4)).
        ensure!(
            !self.component_values.iter().any(|((c, e, v), _)| {
                *c == input.component && *e == input.epoch && *v == input.spec_version
            }),
            Error::AlreadyFinal
        );
        ensure!(self.rounds.len() < MAX_ROUNDS, Error::RoundLimit);
        let bond = round_bond(input.stake_at_risk, 1, params)?;
        // Reject a game whose complete frozen schedule cannot be represented;
        // otherwise a legally-open round could become uncloseable on a later
        // checked doubling (G-1).
        stored_round_bond(bond, params.rounds, params.rounds)?;
        let report_hash = hash_report(
            input.component,
            input.epoch,
            1,
            input.value,
            input.evidence_hash,
            hash,
        );
        self.rounds.push(RoundState {
            component: input.component,
            epoch: input.epoch,
            round: 1,
            spec_version: input.spec_version,
            reporter: input.who,
            value: input.value,
            evidence_hash: input.evidence_hash,
            bond,
            challenge_deadline: input.now.saturating_add(params.window),
            extended: false,
            challenger: None,
            counter_value: None,
            acks: 0,
            report_hash,
            stake_at_risk: input.stake_at_risk,
            cumulative_reporter_bond: bond,
            cumulative_challenger_bond: 0,
        });
        // 07 §4: from here on this epoch has carried an open round, whatever
        // becomes of it before the sweep. Latched at the single point where a
        // game comes into existence — round one — because every later round of
        // the same game replaces this entry rather than adding one, so the game
        // is already counted.
        self.round_activity = true;
        self.round_schedules.push((
            RoundKey {
                component: input.component,
                epoch: input.epoch,
                spec_version: input.spec_version,
            },
            StoredRoundSchedule {
                round_one_bond: bond,
                round_cap: params.rounds,
            },
        ));
        self.events.push(Event::Reported {
            component: input.component,
            epoch: input.epoch,
            round: 1,
            reporter: input.who,
            value: input.value,
            evidence_hash: input.evidence_hash,
            bond,
        });
        Ok(())
    }

    pub fn challenge(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        key: RoundKey,
        counter_value: FixedU64,
        evidence_hash: H256,
    ) -> Result<(), Error> {
        let (component, epoch) = (key.component, key.epoch);
        let idx = self.find_round(key).ok_or(Error::RoundNotFound)?;
        // Challenges settle through the default path, so they must obey the
        // same component-value grid as reports and adjudications (05 §4.4).
        ensure!(
            counter_value.0 <= COMPONENT_VALUE_MAX,
            Error::ValueOutOfBounds
        );
        let r = &mut self.rounds[idx];
        // Half-open window `[open, deadline)` — a challenge at the deadline block
        // must not race the close crank that treats that block as mature
        // (Codex F24).
        ensure!(now < r.challenge_deadline, Error::WindowClosed);
        // 07 §5.2 (contract v19): the round's own reporter may not challenge it.
        // §5.5 disposes of a round in favour of "the honest counterparty" and
        // §5.3 calls escalation "opt-in on both sides"; both terms are undefined
        // when one account holds both roles — there is no counterparty, and
        // `settle_bond_custody` would pay the loser 40 % of their own forfeited
        // stack. Ordered *before* `AlreadyChallenged` so the reporter's own
        // attempt names the real reason rather than a stale-slot error.
        //
        // Necessary but **not sufficient**: a second funded account defeats it,
        // which is why the default path no longer settles forward at all — see
        // `default_neutral_at`.
        ensure!(who != r.reporter, Error::SelfChallenge);
        // `challenger` is durable for the whole game; only `counter_value`
        // indicates that the current round has an active challenge. A later
        // round must be challenged by the same party so the bonded owner cannot
        // be replaced between rounds (07 §5.3; A12 kernel).
        ensure!(r.counter_value.is_none(), Error::AlreadyChallenged);
        if let Some(existing) = r.challenger {
            ensure!(existing == who, Error::NotRegistered);
        }
        let bond = r.bond;
        r.challenger = Some(who);
        r.counter_value = Some(counter_value);
        r.cumulative_challenger_bond = r
            .cumulative_challenger_bond
            .checked_add(bond)
            .ok_or(Error::Overflow)?;
        self.events.push(Event::Challenged {
            component,
            epoch,
            round: r.round,
            challenger: who,
            counter_value,
            evidence_hash,
            bond,
        });
        Ok(())
    }

    /// The reporter's consenting escalation call (07 §5.3). A keeper may not
    /// manufacture the next reporter bond: the call itself advances the round,
    /// freezes the challenger identity, and opens the next 72-hour window.
    // The round key is already a struct; the remaining arguments are the call's
    // own operands plus the two host injections (`params`, `hash`), and grouping
    // them again would hide which of them the caller controls.
    #[allow(clippy::too_many_arguments)]
    pub fn counter_report(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        key: RoundKey,
        value: FixedU64,
        evidence_hash: H256,
        params: &OracleParams,
        hash: impl FnOnce(&[u8]) -> H256,
    ) -> Result<(), Error> {
        let idx = self.find_round(key).ok_or(Error::RoundNotFound)?;
        let schedule = self.round_schedule(key)?;
        let r = &mut self.rounds[idx];
        ensure!(r.reporter == who, Error::NotRegistered);
        ensure!(r.counter_value.is_some(), Error::QuorumPending);
        ensure!(now < r.challenge_deadline, Error::WindowClosed);
        ensure!(r.round < schedule.round_cap, Error::WindowOpen);
        ensure!(value.0 <= COMPONENT_VALUE_MAX, Error::ValueOutOfBounds);
        let next_round = r.round.checked_add(1).ok_or(Error::Overflow)?;
        let next_bond = stored_round_bond(schedule.round_one_bond, next_round, schedule.round_cap)?;
        r.round = next_round;
        r.value = value;
        r.evidence_hash = evidence_hash;
        r.bond = next_bond;
        r.challenge_deadline = now.saturating_add(params.window);
        r.counter_value = None;
        r.acks = 0;
        r.report_hash = hash_report(
            key.component,
            key.epoch,
            next_round,
            value,
            evidence_hash,
            hash,
        );
        r.cumulative_reporter_bond = r
            .cumulative_reporter_bond
            .checked_add(next_bond)
            .ok_or(Error::Overflow)?;
        // `r.challenger` intentionally remains populated: the challenger owns
        // the game across all consenting rounds and must post each next bond.
        self.ack_records.retain(|(c, e, v, _, _, _)| {
            !(*c == key.component && *e == key.epoch && *v == key.spec_version)
        });
        self.events.push(Event::RoundEscalated {
            component: key.component,
            epoch: key.epoch,
            round: next_round,
            new_bond: next_bond,
        });
        Ok(())
    }

    pub fn ack_observed(
        &mut self,
        who: AccountId,
        now: BlockNumber,
        key: RoundKey,
        round: u8,
        report_hash: H256,
    ) -> Result<(), Error> {
        ensure!(self.is_watchtower(&who), Error::NotRegistered);
        let (component, epoch) = (key.component, key.epoch);
        let idx = self.find_round(key).ok_or(Error::RoundNotFound)?;
        let r = &mut self.rounds[idx];
        ensure!(
            r.round == round && r.report_hash == report_hash,
            Error::RoundNotFound
        );
        // Quorum proves observability during the live challenge window (07 §4).
        // The window is half-open `[open, deadline)`: an acknowledgment at or
        // after the deadline block — the same block the close crank treats as
        // mature — must not retro-finalize (Codex F24 boundary consistency).
        ensure!(now < r.challenge_deadline, Error::WindowClosed);
        // Acks are keyed by the full game triple (07 §2(4)); omitting
        // `spec_version` let one per-version game's ack collide with, or be
        // pruned by, a sibling version (Codex F8).
        ensure!(
            !self.ack_records.contains(&(
                component,
                epoch,
                key.spec_version,
                round,
                who,
                report_hash
            )),
            Error::DuplicateAck
        );
        self.ack_records
            .push((component, epoch, key.spec_version, round, who, report_hash));
        r.acks = r.acks.saturating_add(1);
        self.events.push(Event::WindowAcknowledged {
            component,
            epoch,
            round,
            watchtower: who,
        });
        // The watchtower did its job this epoch — mark it active for liveness
        // discipline (07 §4).
        self.mark_watchtower_active(who);
        Ok(())
    }

    /// Epoch-boundary liveness sweep (07 §4): a watchtower that acknowledged no
    /// round in an epoch that had ≥ 1 open round is marked inactive; two
    /// consecutive inactive epochs slash 10% of `wt.stake` and eject. A
    /// watchtower that was active this epoch has its counter reset. Epochs with
    /// no open round charge nobody (absence of work is not a liveness failure).
    /// The FRAME shell calls this once per epoch rollover with the just-ended
    /// epoch and whether it carried an open round (both known to the epoch
    /// pallet — B1a); the activity set is cleared for the next epoch.
    pub fn sweep_watchtower_liveness(
        &mut self,
        ended_epoch: EpochId,
        attributable: bool,
    ) -> Result<(), Error> {
        if !attributable {
            // The clock skipped epochs since the last sweep, so the latch and the
            // activity set describe an interval, not `ended_epoch`. Charging from
            // them would attribute a round that lived two epochs ago to this one —
            // the over-charging direction §4 must refuse, since the second
            // consecutive miss slashes and ejects. Consume both without charging
            // and **without** resetting any streak: an unattributable epoch is
            // neither a miss nor an acquittal (07 §4, SQ-491 resolution).
            self.round_activity = false;
            self.watchtower_active.clear();
            return Ok(());
        }
        // 07 §4's "an epoch with ≥ 1 open round": either a game was created since
        // the last sweep (the latch), or one is **still open** now — a game that
        // spanned the whole epoch without a fresh report to latch. Money-settled
        // games are excluded from the second disjunct: §11(1) retains them past
        // their deadline for bond disposal only, and a round whose value is final
        // gives a watchtower nothing left to acknowledge, so counting it would
        // charge for up to eight days after the game actually ended.
        //
        // Derived here rather than supplied by the caller for the same reason the
        // neutral carry value is: a caller-supplied liveness fact is a
        // caller-supplied slash. `attributable` is the complement — a fact about
        // the *clock*, which the oracle cannot see and the caller owns.
        let live_round = self.rounds.iter().any(|round| {
            !self.is_money_settled(RoundKey {
                component: round.component,
                epoch: round.epoch,
                spec_version: round.spec_version,
            })
        });
        let had_open_round = self.round_activity || live_round;
        self.round_activity = false;
        let mut ejected: Vec<AccountId> = Vec::new();
        for (who, info) in self.watchtowers.iter_mut() {
            if self.watchtower_active.contains(who) {
                info.inactive_epochs = 0;
                continue;
            }
            if !had_open_round {
                // An epoch with no open round is nobody's liveness failure and
                // breaks the "two *consecutive* inactive epochs" streak, so a
                // later miss cannot combine with an earlier one across an exempt
                // epoch to force a slash (07 §4; Codex F5).
                info.inactive_epochs = 0;
                continue;
            }
            info.inactive_epochs = info.inactive_epochs.saturating_add(1);
            self.events.push(Event::WatchtowerInactive {
                who: *who,
                epoch: ended_epoch,
            });
            if info.inactive_epochs >= 2 {
                // 07 §4: two consecutive inactive epochs ⇒ slash 10% of the
                // watchtower stake and eject.
                let amount = ceil_div(info.stake, 10);
                info.stake = info.stake.saturating_sub(amount);
                self.events
                    .push(Event::WatchtowerSlashed { who: *who, amount });
                ejected.push(*who);
            }
        }
        for who in &ejected {
            self.watchtowers.retain(|(a, _)| a != who);
        }
        self.watchtower_active.clear();
        Ok(())
    }

    fn mark_watchtower_active(&mut self, who: AccountId) {
        if !self.watchtower_active.contains(&who) {
            self.watchtower_active.push(who);
        }
    }

    /// Close matured rounds up to `batch`. The neutral-settlement path
    /// (07 §10) carries the component's *last valid value* — derived here from
    /// the settled-value history rather than supplied by the caller, so a
    /// keeper can never inject a forged carry value and each neutralized round
    /// carries the value for its own component (07 §4/§10).
    pub fn crank_round_close_with_params(
        &mut self,
        now: BlockNumber,
        batch: usize,
        params: &OracleParams,
    ) -> Result<(), Error> {
        let mut processed = 0usize;
        let mut i = 0usize;
        while i < self.rounds.len() && processed < batch {
            let current_key = RoundKey {
                component: self.rounds[i].component,
                epoch: self.rounds[i].epoch,
                spec_version: self.rounds[i].spec_version,
            };
            if let Some(retain_until) = self.retention_deadline(current_key) {
                // The money leg is already neutral. Resolve only the retained
                // bond ledger once a party's current-round obligation is known;
                // never write a second ComponentValues entry.
                if self.rounds[i].counter_value.is_some()
                    && self.rounds[i].round < self.round_schedule(current_key)?.round_cap
                    // Defensive (R-7): a below-cap round whose window has not
                    // closed is not in default, and must not forfeit a stack
                    // while the party still has time to escalate. Unreachable in
                    // production — the last legal report is d2 and every
                    // below-cap deadline precedes the d20 neutralization — so a
                    // round that falls through resolves at the retention arm
                    // below with `RefundBoth`, which is the safer direction.
                    && now >= self.rounds[i].challenge_deadline
                {
                    // The money leg is already neutral (`already_settled`), so
                    // the value/path/flagged arguments are inert here and only
                    // the bond ledger closes. Passing `Neutral` keeps the
                    // contract-v18 invariant — `ChallengerDefault` is never
                    // written — true by construction rather than by accident.
                    let value = self.rounds[i].value;
                    let disposition = if self.rounds[i].round <= 1 {
                        BondDisposition::ReporterDefaulted
                    } else {
                        BondDisposition::ChallengerWins
                    };
                    self.settle_at(i, value, SettlePath::Neutral, true, disposition)?;
                    processed += 1;
                    continue;
                }
                if self.rounds[i].counter_value.is_none() {
                    self.settle_at(
                        i,
                        self.rounds[i].value,
                        SettlePath::Unchallenged,
                        true,
                        BondDisposition::ReporterWins,
                    )?;
                    processed += 1;
                    continue;
                }
                // A retained round-`R_max` challenge is waiting for the values
                // track. Neither party is in default — both funded the round —
                // so nothing here decides the stack, and the close crank must
                // not consume it while a verdict can still land.
                //
                // But 07 §11(1) bounds that wait by the `OracleResolution`
                // track's own schedule, and the bound has to be *implemented*:
                // without it this arm is a permanent skip, the stack stays in
                // custody against the I-29 identity forever and the game holds
                // one of the 128 `MAX_ROUNDS` slots against the reporting
                // surface — one abandoned dispute per slot is the whole attack
                // (SQ-492). Past the deadline the retention has bought all the
                // adjudication it can, so it ends: refund both stacks and reap.
                if now >= retain_until {
                    self.expire_retention_at(i)?;
                    processed += 1;
                    continue;
                }
                i += 1;
                continue;
            }
            if now < self.rounds[i].challenge_deadline {
                i += 1;
                continue;
            }
            let (component, epoch, round) = (
                self.rounds[i].component,
                self.rounds[i].epoch,
                self.rounds[i].round,
            );
            let schedule = self.round_schedule(RoundKey {
                component,
                epoch,
                spec_version: self.rounds[i].spec_version,
            })?;
            // `challenger` is durable across the game; only `counter_value`
            // says whether this *round* has an active challenge. After a
            // consenting escalation, a round with no fresh challenge follows
            // the ordinary quorum/extension path and closes to the reporter.
            if self.rounds[i].counter_value.is_none() {
                if self.rounds[i].acks >= params.watchtower_quorum {
                    let value = self.rounds[i].value;
                    self.settle_at(
                        i,
                        value,
                        SettlePath::Unchallenged,
                        false,
                        BondDisposition::ReporterWins,
                    )?;
                } else if !self.rounds[i].extended {
                    self.rounds[i].extended = true;
                    self.rounds[i].challenge_deadline = now.saturating_add(ORC_EXT_WINDOW_BLOCKS);
                    self.events.push(Event::WindowExtended {
                        component,
                        epoch,
                        round,
                        new_deadline: self.rounds[i].challenge_deadline,
                    });
                    i += 1;
                } else {
                    self.events.push(Event::QuorumFailed {
                        component,
                        epoch,
                        round,
                    });
                    let carried = self.last_valid_value(component, epoch);
                    self.neutral_at(i, carried, 1, retention_deadline_from(now))?;
                }
            } else if self.rounds[i].round < schedule.round_cap {
                // The reporter did not post a consenting `counter_report`
                // (07 §5.3). The default decides the *bonds*, never the value.
                self.default_neutral_at(i)?;
            } else {
                i += 1;
            }
            processed += 1;
        }
        Ok(())
    }

    /// Permissionless mechanical resolution (07 §9): the submitted proof is the
    /// committed content-addressed evidence payload; the settled value is
    /// derived from it, never taken from the caller. Only components whose
    /// frozen spec declares them deterministically recomputable are eligible;
    /// everything else fails closed and resolves by counter-report or
    /// adjudication. (Narrowing: the proof must match the round's reporter
    /// commitment — a reporter whose own committed data contradicts the claimed
    /// value is resolved against, per the 07 §5 worked example.)
    ///
    /// Two things are injected rather than assumed, and both are load-bearing.
    /// `hash` must be a cryptographic hash, because the evidence commitment is
    /// the only authentication a submitted proof gets. `evaluate` must derive
    /// the value from the payload under the frozen MetricSpec `formula_ref`; a
    /// runtime that has no such engine passes one that refuses, and mechanical
    /// resolution then fails closed. Reading the value out of the payload — what
    /// [`recompute_value`] does for the model — would let a reporter settle at
    /// its own number inside the challenge window, since the reporter is the
    /// party that chose the commitment.
    pub fn recompute_proof(
        &mut self,
        prover: AccountId,
        key: RoundKey,
        proof: &[u8],
        hash: impl FnOnce(&[u8]) -> H256,
        evaluate: impl FnOnce(&[u8]) -> Result<FixedU64, Error>,
    ) -> Result<(), Error> {
        let (component, epoch) = (key.component, key.epoch);
        ensure!(proof.len() <= ORC_MAX_PROOF_BYTES, Error::ProofTooLarge);
        ensure!(
            self.recomputable_components
                .contains(&(key.component, key.spec_version)),
            Error::NotRecomputable
        );
        let idx = self.find_round(key).ok_or(Error::RoundNotFound)?;
        ensure!(
            hash_evidence(proof, hash) == self.rounds[idx].evidence_hash,
            Error::EvidenceMismatch
        );
        let value = evaluate(proof)?;
        // The evaluator is a Config seam, so the grid bound is re-checked here
        // rather than trusted from it (G-1, 05 §4.4 determinism rule 1).
        ensure!(value.0 <= COMPONENT_VALUE_MAX, Error::BadProof);
        if value != self.rounds[idx].value {
            // The committed data disproves the reported value: record the 07 §3
            // offense (stake discipline); the §5.5 bond-stack forfeiture is
            // B-track custody.
            self.record_reporter_offense(self.rounds[idx].reporter)?;
        }
        self.events.push(Event::RecomputeProven {
            component,
            epoch,
            value,
            prover,
        });
        let disposition = if value == self.rounds[idx].value {
            BondDisposition::ReporterWins
        } else {
            BondDisposition::ChallengerWins
        };
        self.settle_at(idx, value, SettlePath::Recomputed, false, disposition)
    }

    pub fn request_adjudication(&mut self, key: RoundKey, referendum: u32) -> Result<(), Error> {
        let (component, epoch) = (key.component, key.epoch);
        let idx = self.find_round(key).ok_or(Error::RoundNotFound)?;
        let schedule = self.round_schedule(key)?;
        ensure!(
            self.rounds[idx].round >= schedule.round_cap,
            Error::WindowOpen
        );
        ensure!(
            self.rounds[idx].challenger.is_some() && self.rounds[idx].counter_value.is_some(),
            Error::QuorumPending
        );
        self.events.push(Event::AdjudicationRequested {
            component,
            epoch,
            referendum,
        });
        Ok(())
    }

    pub fn adjudicate(
        &mut self,
        origin: Origin,
        key: RoundKey,
        value: FixedU64,
        reporter_wrong: bool,
    ) -> Result<(), Error> {
        ensure!(origin == Origin::OracleResolution, Error::BadOrigin);
        // The adjudicated value must land on the 05 §4.4 grid like any other
        // settled value (Codex F15).
        ensure!(value.0 <= COMPONENT_VALUE_MAX, Error::ValueOutOfBounds);
        let (component, epoch) = (key.component, key.epoch);
        let idx = self.find_round(key).ok_or(Error::RoundNotFound)?;
        let schedule = self.round_schedule(key)?;
        // 07 §5.4: adjudication is the TERMINAL step of the game — the values
        // track resolves a round-`R_max` dispute that carries a live challenge.
        // A fresh or unchallenged round is not adjudicable, so the
        // `OracleResolution` origin cannot bypass the escalation ladder and
        // settle an arbitrary round (Codex F10).
        ensure!(
            self.rounds[idx].round >= schedule.round_cap,
            Error::WindowOpen
        );
        ensure!(
            self.rounds[idx].challenger.is_some() && self.rounds[idx].counter_value.is_some(),
            Error::QuorumPending
        );
        if reporter_wrong {
            self.record_reporter_offense(self.rounds[idx].reporter)?;
        }
        self.events.push(Event::Adjudicated {
            component,
            epoch,
            value,
        });
        let disposition = if reporter_wrong {
            BondDisposition::ChallengerWins
        } else {
            BondDisposition::ReporterWins
        };
        self.settle_at(idx, value, SettlePath::Adjudicated, false, disposition)
    }

    /// Force-neutralize a measurement `epoch` at its `OracleSettleDeadline`
    /// (07 §11 rule 1: any `(component, m)` not challenge-closed by the deadline
    /// settles **neutrally** for every consuming cohort). The epoch pallet drives
    /// this at the schedule-derived deadline (B1a), passing `expected` — the
    /// `(component, frozen version)` pairs live cohorts consume for `epoch`
    /// (§2(4); the epoch/welfare pallet owns that cohort→component map).
    ///
    /// Two obligations, both required for the §11(1) guarantee that welfare finds
    /// a value for **every** expected component at settlement:
    /// 1. **Live rounds** — neutral-settle every still-open round for `epoch`, so
    ///    no `Rounds` entry survives its deadline money-bearing (§13 try-state).
    ///    The entry itself is **retained**, now non-money-bearing, until a
    ///    terminal verdict disposes of its bond stack (§11(1) — removing it at
    ///    d20 would silently refund an attacker who rode a dispute to terminal
    ///    precisely to force neutral settlement). A later verdict therefore finds
    ///    the round already `money_settled` and can only resolve
    ///    bonds/reputation (I-18) — never overwrite the money. Retention is
    ///    **bounded**: `now` stamps each retained game with its
    ///    [`kernel::ORC_RETENTION_BLOCKS`](futarchy_primitives::kernel::ORC_RETENTION_BLOCKS)
    ///    expiry, after which `crank_round_close` refunds and reaps it (§11(1)).
    /// 2. **No-report components** — an admitted `(component, version)` that got
    ///    no report has no round, so step 1 never touches it; write its neutral
    ///    flagged carry-last `ComponentValues` entry directly (the §10 no-report
    ///    path). Without this, welfare reads an absent component and can stall or
    ///    settle a cohort with a missing neutral value (Codex P1).
    pub fn force_neutralize_expired(
        &mut self,
        now: BlockNumber,
        epoch: EpochId,
        expected: &[(MetricId, MetricSpecVersion)],
    ) -> Result<(), Error> {
        // (1) retain the live round and neutralize only its money leg. The
        // retained stack is resolved by a later counter default/adjudication,
        // or — if none lands inside the track's own schedule — refunded and
        // reaped at `retain_until` (§11(1)).
        let retain_until = retention_deadline_from(now);
        let keys = self
            .rounds
            .iter()
            .filter(|r| r.epoch == epoch)
            .map(|r| RoundKey {
                component: r.component,
                epoch: r.epoch,
                spec_version: r.spec_version,
            })
            .collect::<Vec<_>>();
        for key in keys {
            if let Some(idx) = self.find_round(key) {
                let carried = self.last_valid_value(key.component, epoch);
                self.neutral_at(idx, carried, 1, retain_until)?;
            }
        }
        // (2) After (1) no round for `epoch` remains, so any expected key still
        // without a `ComponentValues` entry produced no report — neutralize it.
        for &(component, spec_version) in expected {
            let has_value = self
                .component_values
                .iter()
                .any(|((c, e, v), _)| *c == component && *e == epoch && *v == spec_version);
            if !has_value {
                self.neutral_no_report(component, epoch, spec_version)?;
            }
        }
        Ok(())
    }

    pub fn crank_reserve_probe_with_params(
        &mut self,
        now: BlockNumber,
        params: &OracleParams,
    ) -> Result<u64, Error> {
        ensure!(
            self.reserve_health.last_query_id == 0
                || now
                    >= self
                        .reserve_health
                        .last_probe_at
                        .saturating_add(params.probe_interval),
            Error::ProbeTooEarly
        );
        ensure!(
            self.reserve_health.last_query_id < MAX_RESERVE_PROBE_QUERY_ID,
            Error::Overflow
        );
        self.reserve_health.last_query_id = self
            .reserve_health
            .last_query_id
            .checked_add(1)
            .ok_or(Error::Overflow)?;
        self.reserve_health.last_probe_at = now;
        self.reserve_health.pending_since = Some(now);
        let query_id = self.reserve_health.last_query_id;
        self.events.push(Event::ReserveProbeSent { query_id });
        Ok(query_id)
    }

    pub fn reserve_probe_result_with_params(
        &mut self,
        now: BlockNumber,
        query_id: u64,
        passed: bool,
        params: &OracleParams,
    ) -> Result<bool, Error> {
        ensure!(
            query_id == self.reserve_health.last_query_id,
            Error::UnknownQuery
        );
        // Each probe outcome counts exactly once toward the consecutive
        // thresholds: a replayed response for an already consumed query must not
        // move the fail-static state.
        let since = self
            .reserve_health
            .pending_since
            .ok_or(Error::UnknownQuery)?;
        // A response that lands at or after the `res.probe_timeout` deadline is
        // counted as a **fail** regardless of the reported outcome — a late or
        // absent answer is never healthy (07 §8; Codex F2).
        // A governance amendment that makes the live probe configuration
        // structurally invalid must never turn an outstanding response into
        // positive reserve evidence. Treat it as a fail-static result instead.
        let effective = passed
            && params.reserve_probe_config_valid()
            && now < since.saturating_add(params.probe_timeout);
        self.apply_probe_result(query_id, effective, params);
        // Return the **effective** outcome, not the reported one. A success that
        // lands at or after the timeout, or arrives while the live probe
        // configuration is structurally invalid, is scored as a failure here —
        // and any consumer that mirrors this result (the welfare `R` day input)
        // must record the same fact, or the two disagree about a day the health
        // state has already called a fail (07 §8).
        Ok(effective)
    }

    pub fn crank_probe_timeout_with_params(
        &mut self,
        now: BlockNumber,
        params: &OracleParams,
    ) -> Result<(), Error> {
        let since = self
            .reserve_health
            .pending_since
            .ok_or(Error::UnknownQuery)?;
        ensure!(
            now >= since.saturating_add(params.probe_timeout),
            Error::WindowOpen
        );
        let query_id = self.reserve_health.last_query_id;
        self.apply_probe_result(query_id, false, params);
        Ok(())
    }

    /// Score daily probe slots for which no keeper opened an attempt. This is
    /// deliberately O(1): only the consecutive threshold state is material,
    /// so a long outage is folded as one bounded counter update.
    /// Absence is never interpreted as healthy (07 §8; SQ-385 literal ruling).
    pub fn note_missed_reserve_probes_with_params(&mut self, missed: u32, params: &OracleParams) {
        if missed == 0 {
            return;
        }
        let scored = missed.min(u32::from(u8::MAX));
        self.reserve_health.consecutive_fails = self
            .reserve_health
            .consecutive_fails
            .saturating_add(scored as u8);
        self.reserve_health.consecutive_passes = 0;
        if !self.reserve_health.unhealthy
            && self.reserve_health.consecutive_fails >= params.fail_threshold
        {
            self.reserve_health.unhealthy = true;
            self.events.push(Event::ReserveUnhealthy);
        }
    }

    pub fn try_state(&self) -> Result<(), Error> {
        ensure!(
            self.reserve_health.last_query_id <= MAX_RESERVE_PROBE_QUERY_ID,
            Error::Overflow
        );
        ensure!(
            self.reporters.len() <= MAX_REPORTERS,
            Error::TooManyReporters
        );
        ensure!(
            self.watchtowers.len() <= MAX_WATCHTOWERS,
            Error::TooManyWatchtowers
        );
        ensure!(self.rounds.len() <= MAX_ROUNDS, Error::RoundLimit);
        ensure!(
            self.round_schedules.len() == self.rounds.len(),
            Error::RoundLimit
        );
        ensure!(
            self.component_values.len() <= MAX_COMPONENT_VALUES,
            Error::AlreadyFinal
        );
        ensure!(self.ack_records.len() <= MAX_ACK_RECORDS, Error::RoundLimit);
        ensure!(self.money_settled.len() <= MAX_ROUNDS, Error::RoundLimit);
        ensure!(
            self.watchtower_active.len() <= MAX_WATCHTOWERS,
            Error::TooManyWatchtowers
        );
        ensure!(
            self.reporter_records.len() <= MAX_REPORTER_RECORDS,
            Error::TooManyReporters
        );
        // The liveness activity set only names registered watchtowers (07 §4).
        for who in &self.watchtower_active {
            ensure!(self.is_watchtower(who), Error::NotRegistered);
        }
        // 07 §3 (contract v19): a retained record and a live seat are mutually
        // exclusive homes for the same account's offense count, records are
        // unique, and `ejected` implies the account actually reached the
        // threshold.
        for (i, rec) in self.reporter_records.iter().enumerate() {
            ensure!(!self.is_reporter(&rec.account), Error::AlreadyRegistered);
            ensure!(
                !self.reporter_records[..i]
                    .iter()
                    .any(|o| o.account == rec.account),
                Error::AlreadyRegistered
            );
            ensure!(
                !rec.ejected || rec.offenses >= OFFENSE_EJECTION_THRESHOLD,
                Error::ReporterEjected
            );
        }
        // Ejection is terminal, so a seated reporter standing at the threshold
        // is dispatch-unreachable and therefore a storage-corruption signal
        // (the attestor's `EjectedMemberActive` idiom).
        for (_, info) in self.reporters.iter() {
            ensure!(
                info.offenses < OFFENSE_EJECTION_THRESHOLD,
                Error::ReporterEjected
            );
        }
        for r in &self.rounds {
            // 07 §5.2 (contract v19): no game may have one account on both
            // sides. Anchors the `challenge` guard against a future edit.
            ensure!(r.challenger != Some(r.reporter), Error::SelfChallenge);
            let schedule = self.round_schedule(RoundKey {
                component: r.component,
                epoch: r.epoch,
                spec_version: r.spec_version,
            })?;
            ensure!(
                (ORC_ROUND_CAP_MIN..=ORC_ROUND_CAP_MAX).contains(&schedule.round_cap),
                Error::RoundNotFound
            );
            ensure!(
                (1..=schedule.round_cap).contains(&r.round),
                Error::RoundNotFound
            );
            ensure!(
                r.bond == stored_round_bond(schedule.round_one_bond, r.round, schedule.round_cap,)?,
                Error::BondBelowMinimum
            );
            // A retained round may have a neutral money entry, but no ordinary
            // live round may shadow a settled value (I-18).
            let key = RoundKey {
                component: r.component,
                epoch: r.epoch,
                spec_version: r.spec_version,
            };
            if self
                .component_values
                .iter()
                .any(|((c, e, v), _)| *c == r.component && *e == r.epoch && *v == r.spec_version)
            {
                ensure!(self.is_money_settled(key), Error::AlreadyFinal);
            }
            let recorded_acks = self
                .ack_records
                .iter()
                .filter(|(c, e, v, round, _, hash)| {
                    *c == r.component
                        && *e == r.epoch
                        && *v == r.spec_version
                        && *round == r.round
                        && *hash == r.report_hash
                })
                .count();
            ensure!(usize::from(r.acks) == recorded_acks, Error::QuorumPending);
        }
        for (key, _) in &self.round_schedules {
            ensure!(self.find_round(*key).is_some(), Error::RoundNotFound);
        }
        for (key, retain_until) in &self.money_settled {
            ensure!(self.find_round(*key).is_some(), Error::RoundNotFound);
            ensure!(
                self.component_values.iter().any(|((c, e, v), _)| {
                    *c == key.component && *e == key.epoch && *v == key.spec_version
                }),
                Error::RoundNotFound
            );
            // 07 §11(1)'s retention is *bounded*. A zero deadline is what an
            // unstamped entry decodes to, and it would make the round eligible
            // for expiry at genesis; a deadline is only ever written as
            // `now + ORC_RETENTION_BLOCKS`, so it exceeds the window by
            // construction and try-state says so rather than trusting it.
            ensure!(
                *retain_until >= futarchy_primitives::kernel::ORC_RETENTION_BLOCKS as BlockNumber,
                Error::RoundNotFound
            );
        }
        Ok(())
    }

    fn settle_at(
        &mut self,
        idx: usize,
        value: FixedU64,
        path: SettlePath,
        flagged: bool,
        disposition: BondDisposition,
    ) -> Result<(), Error> {
        let round = self.rounds.get(idx).ok_or(Error::RoundNotFound)?;
        let key = RoundKey {
            component: round.component,
            epoch: round.epoch,
            spec_version: round.spec_version,
        };
        let schedule_idx = self.round_schedule_index(key).ok_or(Error::RoundNotFound)?;
        let r = self.rounds.remove(idx);
        self.round_schedules.remove(schedule_idx);
        self.bond_settlements.push(BondSettlement {
            reporter: r.reporter,
            challenger: r.challenger,
            reporter_bond: r.cumulative_reporter_bond,
            challenger_bond: r.cumulative_challenger_bond,
            disposition,
        });
        // The game for this `(component, epoch, version)` is terminal: its
        // acknowledgment records are dead weight, so reap them — scoped to this
        // version so a sibling per-version game's acks survive (G-6/I-20;
        // Codex F8).
        self.ack_records.retain(|(c, e, v, _, _, _)| {
            !(*c == r.component && *e == r.epoch && *v == r.spec_version)
        });
        let already_settled = self
            .component_values
            .iter()
            .any(|((c, e, v), _)| *c == r.component && *e == r.epoch && *v == r.spec_version);
        if !already_settled {
            ensure!(
                self.component_values.len() < MAX_COMPONENT_VALUES,
                Error::AlreadyFinal
            );
            self.component_values.push((
                (r.component, r.epoch, r.spec_version),
                SettledComponent {
                    value,
                    path,
                    flagged,
                },
            ));
            self.events.push(Event::ComponentSettled {
                component: r.component,
                epoch: r.epoch,
                value,
                path,
            });
        }
        self.money_settled.retain(|(stored, _)| *stored != key);
        Ok(())
    }

    /// 07 §11(1)'s retention window has closed on a money-settled round at the
    /// round cap with a live challenge, and no terminal verdict arrived.
    ///
    /// Both stacks go back to their posters. §11(4) prices "ride a dispute to
    /// terminal purely to force neutral settlement" as paying the §6 stack's
    /// *capital lock-up* for a status-quo outcome — a cost of time, not a
    /// forfeiture — and here there is no adjudicated wrong side at all: the
    /// values track simply never ruled. Taking custody of either stack on that
    /// non-event would create a claim with no finding behind it, which is the
    /// one thing solvency-critical code must not do (R-7). The money leg is
    /// already final and untouched (I-18); only the bond ledger closes.
    fn expire_retention_at(&mut self, idx: usize) -> Result<(), Error> {
        let round = self.rounds.get(idx).ok_or(Error::RoundNotFound)?;
        let key = RoundKey {
            component: round.component,
            epoch: round.epoch,
            spec_version: round.spec_version,
        };
        let schedule_idx = self.round_schedule_index(key).ok_or(Error::RoundNotFound)?;
        let r = self.rounds.remove(idx);
        self.round_schedules.remove(schedule_idx);
        self.bond_settlements.push(BondSettlement {
            reporter: r.reporter,
            challenger: r.challenger,
            reporter_bond: r.cumulative_reporter_bond,
            challenger_bond: r.cumulative_challenger_bond,
            disposition: BondDisposition::RefundBoth,
        });
        self.ack_records.retain(|(c, e, v, _, _, _)| {
            !(*c == r.component && *e == r.epoch && *v == r.spec_version)
        });
        self.money_settled.retain(|(stored, _)| *stored != key);
        self.events.push(Event::RetentionExpired {
            component: r.component,
            epoch: r.epoch,
            round: r.round,
            reporter_bond: r.cumulative_reporter_bond,
            challenger_bond: r.cumulative_challenger_bond,
        });
        Ok(())
    }

    /// Whether `key`'s money leg has already been neutralized (07 §11(1)).
    fn is_money_settled(&self, key: RoundKey) -> bool {
        self.money_settled.iter().any(|(stored, _)| *stored == key)
    }

    /// Whether `(component, epoch, version)` is `component`'s newest settled
    /// value — the carry checkpoint 07 §10's "last valid value" reads.
    ///
    /// Selected by the same `(epoch, version)` ordering
    /// [`Self::last_valid_value`] uses, so the entry the carry would pick is
    /// exactly the entry reaping spares.
    fn is_carry_checkpoint(
        &self,
        component: MetricId,
        epoch: EpochId,
        version: MetricSpecVersion,
    ) -> bool {
        self.component_values
            .iter()
            .filter(|((c, _, _), _)| *c == component)
            .map(|((_, e, v), _)| (*e, *v))
            .max()
            == Some((epoch, version))
    }

    /// The block at which `key`'s retained bond stack expires, if it is retained.
    fn retention_deadline(&self, key: RoundKey) -> Option<BlockNumber> {
        self.money_settled
            .iter()
            .find_map(|(stored, until)| (*stored == key).then_some(*until))
    }

    /// Drop settled component values for measurement epochs strictly older than
    /// `cutoff` (07 §13 "reaped at cohort settlement"), removing at most `max`
    /// entries per call and returning how many went.
    ///
    /// The reaper the bound has always assumed and nobody drove: `ComponentValues`
    /// grows by one entry per admitted component per epoch and nothing ever
    /// removed one, so the map reaches [`MAX_COMPONENT_VALUES`] and every
    /// subsequent settlement fails `AlreadyFinal` — a total oracle wedge, not a
    /// leak (SQ-492). Oldest-epoch-first so a capped batch drains deterministically
    /// (I-20).
    ///
    /// **A still-retained game's value is never reaped, whatever the cutoff says.**
    /// 07 §11(1) keeps a neutralized round alive for bond disposal, and what makes
    /// that round non-money-bearing — the property I-18 and the §13 try-state
    /// invariant both rest on — is precisely that its `(component, epoch, version)`
    /// already carries a settled value. Retiring the value out from under it would
    /// leave a live `Rounds` entry with no settled counterpart: try-state fails,
    /// and the round reads as money-bearing past its own deadline. In production
    /// the two windows do not overlap (retention is ~8 days, the cutoff is three
    /// ~20-day epochs back), which is exactly why this must be a guard rather than
    /// an argument — the overlap needs only a stalled close crank to become real.
    ///
    /// **Each component's newest settled value is also exempt — its carry
    /// checkpoint.** 07 §10 settles a failed component at "its last valid
    /// value", which [`Self::last_valid_value`] reads out of exactly this
    /// history. An unqualified cutoff would delete that history for a component
    /// no cohort consumed for longer than the retention window — the cohortless
    /// epochs 05 §3.3 explicitly contemplates — so when reporting resumed and a
    /// report was missed the carry would silently become the neutral 0.5 instead
    /// of the component's real last value, moving `W` and every settlement that
    /// reads it. Before this reaper existed nothing was ever removed, so the
    /// degenerate branch was unreachable in production; introducing reaping is
    /// what makes the checkpoint necessary (Codex F13, raised again on #175).
    /// The exemption is per **component**, not per `(component, version)`,
    /// because `last_valid_value` selects across versions — so it holds at most
    /// one entry per live MetricId and cannot grow with MetricSpec activations.
    pub fn reap_settled_before(&mut self, cutoff: EpochId, max: usize) -> usize {
        let mut stale = self
            .component_values
            .iter()
            .filter(|((c, e, v), _)| {
                *e < cutoff
                    && !self.is_money_settled(RoundKey {
                        component: *c,
                        epoch: *e,
                        spec_version: *v,
                    })
                    && !self.is_carry_checkpoint(*c, *e, *v)
            })
            .map(|((c, e, v), _)| (*e, *c, *v))
            .collect::<Vec<_>>();
        stale.sort_unstable();
        stale.truncate(max);
        for (epoch, component, version) in &stale {
            self.component_values
                .retain(|((c, e, v), _)| !(c == component && e == epoch && v == version));
        }
        stale.len()
    }

    /// The value the neutral path carries for `component` when settling
    /// `epoch` (07 §10, "carries its last valid value"): the most recent
    /// settled value for the component in a strictly earlier epoch, or the
    /// neutral 0.5 default (05 §10) when no prior value survives (histories are
    /// reaped at cohort settlement).
    fn last_valid_value(&self, component: MetricId, epoch: EpochId) -> FixedU64 {
        self.component_values
            .iter()
            .filter(|((c, e, _), _)| *c == component && *e < epoch)
            // Deterministic selection independent of storage-hasher order: the
            // greatest earlier epoch, ties broken by the greater spec version
            // (Codex F14). NB: because settled values are reaped at cohort
            // settlement, a fully-reaped history still falls back to neutral
            // 0.5 — carrying the true last value across reaping is Codex F13,
            // tracked as a resume item.
            .max_by_key(|((_, e, v), _)| (*e, *v))
            .map(|(_, settled)| settled.value)
            .unwrap_or(FixedU64(COMPONENT_VALUE_MAX / 2))
    }

    /// The 07 §5.3 reporter default, settled on the §10 neutral path
    /// (contract v19).
    ///
    /// A default establishes that the reporter **abandoned their assertion**. It
    /// establishes nothing about the challenger's, which no watchtower quorum
    /// acknowledged, no recomputation confirmed and no adjudication reviewed.
    /// Settling that value forward was the whole of the self-challenge attack:
    /// one purse funding both roles moved a component by up to `Δs_max` while
    /// risking `B_r`, where 07 §6.3 prices `(2^R_max − 1)·B_1`. The repair is on
    /// the **value** side because it cannot be on the money side — §5.3's own
    /// closing sentences forbid debiting a stack a party has not funded, so no
    /// rule can make a defaulting party forfeit the full ladder.
    ///
    /// Bond disposition is round-conditional per §5.5; see
    /// [`BondDisposition::ReporterDefaulted`].
    ///
    /// **No §3 offense is recorded.** A default is producible by the challenger,
    /// by a collator set censoring `counter_report` (14 TH-24), or by a dead
    /// node, so it is not a finding that the reported value was *wrong* — and
    /// recording one would hand a griefer a lever on a permanent ladder that
    /// `orc.n_min` turns into a MetricSpec-admission veto.
    fn default_neutral_at(&mut self, idx: usize) -> Result<(), Error> {
        let (component, epoch, round) = (
            self.rounds[idx].component,
            self.rounds[idx].epoch,
            self.rounds[idx].round,
        );
        let carried = self.last_valid_value(component, epoch);
        let disposition = if round <= 1 {
            BondDisposition::ReporterDefaulted
        } else {
            BondDisposition::ChallengerWins
        };
        // 02 §7.2 freezes `NeutralSettlement`, and both the frontend and the
        // 12 §6.3 exporters read it as *the* neutral signal, so the §10 path
        // must emit it even though `settle_at` also emits `ComponentSettled`.
        // Deliberately not `neutral_at` + `settle_at`: `neutral_at` pushes a
        // `money_settled` row that `settle_at` would immediately remove.
        self.events.push(Event::NeutralSettlement {
            component,
            epoch,
            carried_value: carried,
            flagged_epochs: 1,
        });
        self.settle_at(idx, carried, SettlePath::Neutral, true, disposition)
    }

    fn neutral_at(
        &mut self,
        idx: usize,
        carried_value: FixedU64,
        flagged_epochs: u8,
        retain_until: BlockNumber,
    ) -> Result<(), Error> {
        let component = self.rounds[idx].component;
        let epoch = self.rounds[idx].epoch;
        let key = RoundKey {
            component,
            epoch,
            spec_version: self.rounds[idx].spec_version,
        };
        if self.is_money_settled(key) {
            return Ok(());
        }
        ensure!(
            self.component_values.len() < MAX_COMPONENT_VALUES,
            Error::AlreadyFinal
        );
        self.events.push(Event::NeutralSettlement {
            component,
            epoch,
            carried_value,
            flagged_epochs,
        });
        self.component_values.push((
            (component, epoch, key.spec_version),
            SettledComponent {
                value: carried_value,
                path: SettlePath::Neutral,
                flagged: true,
            },
        ));
        self.events.push(Event::ComponentSettled {
            component,
            epoch,
            value: carried_value,
            path: SettlePath::Neutral,
        });
        self.money_settled.push((key, retain_until));
        Ok(())
    }

    /// Neutral-settle an admitted `(component, epoch, spec_version)` that received
    /// **no report** — there is no round to remove, so unlike [`Self::neutral_at`]
    /// this pushes the carry-last flagged `ComponentValues` entry directly (07 §10
    /// no-report path). Only [`Self::force_neutralize_expired`] calls it, and only
    /// for keys with no existing value, so it never shadows a settled entry (I-18).
    fn neutral_no_report(
        &mut self,
        component: MetricId,
        epoch: EpochId,
        spec_version: MetricSpecVersion,
    ) -> Result<(), Error> {
        ensure!(
            self.component_values.len() < MAX_COMPONENT_VALUES,
            Error::AlreadyFinal
        );
        let carried = self.last_valid_value(component, epoch);
        // Defensive symmetry with `settle_at`: a no-report key should carry no
        // acks, but reap any that exist so none outlives its (never-opened) game.
        self.ack_records
            .retain(|(c, e, v, _, _, _)| !(*c == component && *e == epoch && *v == spec_version));
        self.component_values.push((
            (component, epoch, spec_version),
            SettledComponent {
                value: carried,
                path: SettlePath::Neutral,
                flagged: true,
            },
        ));
        self.events.push(Event::NeutralSettlement {
            component,
            epoch,
            carried_value: carried,
            flagged_epochs: 1,
        });
        self.events.push(Event::ComponentSettled {
            component,
            epoch,
            value: carried,
            path: SettlePath::Neutral,
        });
        Ok(())
    }

    fn record_reporter_offense(&mut self, who: AccountId) -> Result<(), Error> {
        // A reporter ejected on a prior game is already maximally punished;
        // recording a further offense against them is a **no-op**, not an error,
        // so a valid recompute/adjudication on their *other* still-live rounds
        // can still settle instead of failing `NotRegistered` (Codex F17).
        //
        // This no-op is safe against the retained ladder (contract v19) because
        // a verdict can only land while the account is still **seated**:
        // `deregister_reporter` refuses while the account is any live round's
        // reporter *or* challenger, a money-settled round stays in `rounds`
        // until `expire_retention_at`, and once that removes the round both
        // `adjudicate` and `recompute_proof` fail `RoundNotFound`. So there is
        // no path on which a departed account silently escapes an offense here.
        let Some((_, info)) = self.reporters.iter_mut().find(|(a, _)| *a == who) else {
            return Ok(());
        };
        info.offenses = info.offenses.saturating_add(1);
        let offense = info.offenses;
        let slash_amount = ceil_div(info.stake, 2);
        // 07 §3 stake discipline: 50% of `orc.reporter_stake` on **exactly** the
        // second adjudicated-false report; **ejection** on the third (not a
        // further slash) — Codex F19. The §5.5 round-bond-stack forfeiture and
        // its 40/60 routing are economic custody, wired at B-track (decision #3).
        if offense == OFFENSE_SLASH_THRESHOLD {
            info.stake = info.stake.saturating_sub(slash_amount);
            self.events.push(Event::ReporterSlashed {
                who,
                amount: slash_amount,
                offense,
            });
        }
        if offense >= OFFENSE_EJECTION_THRESHOLD {
            // Ejection is **permanent** (contract v19). `retain` alone returned
            // the account to a clean permissionless registration, so the
            // third-offense step was exactly as escapable as the second.
            if !self.upsert_reporter_record(who, offense, true) {
                self.events.push(Event::ReporterRecordsFull { who });
            }
            self.reporters.retain(|(a, _)| *a != who);
            self.events.push(Event::ReporterEjected { who });
        }
        Ok(())
    }

    fn apply_probe_result(&mut self, query_id: u64, passed: bool, params: &OracleParams) {
        self.reserve_health.pending_since = None;
        if passed {
            self.reserve_health.consecutive_passes =
                self.reserve_health.consecutive_passes.saturating_add(1);
            self.reserve_health.consecutive_fails = 0;
            if self.reserve_health.unhealthy
                && self.reserve_health.consecutive_passes >= params.recover_threshold
            {
                self.reserve_health.unhealthy = false;
                self.events.push(Event::ReserveRecovered);
            }
        } else {
            self.reserve_health.consecutive_fails =
                self.reserve_health.consecutive_fails.saturating_add(1);
            self.reserve_health.consecutive_passes = 0;
            if !self.reserve_health.unhealthy
                && self.reserve_health.consecutive_fails >= params.fail_threshold
            {
                self.reserve_health.unhealthy = true;
                self.events.push(Event::ReserveUnhealthy);
            }
        }
        self.events
            .push(Event::ReserveProbeResult { query_id, passed });
    }

    fn is_reporter(&self, who: &AccountId) -> bool {
        self.reporters.iter().any(|(a, _)| a == who)
    }
    fn is_watchtower(&self, who: &AccountId) -> bool {
        self.watchtowers.iter().any(|(a, _)| a == who)
    }
    fn find_round(&self, key: RoundKey) -> Option<usize> {
        self.rounds.iter().position(|r| {
            r.component == key.component
                && r.epoch == key.epoch
                && r.spec_version == key.spec_version
        })
    }
    fn round_schedule_index(&self, key: RoundKey) -> Option<usize> {
        self.round_schedules
            .iter()
            .position(|(stored, _)| *stored == key)
    }
    fn round_schedule(&self, key: RoundKey) -> Result<StoredRoundSchedule, Error> {
        self.round_schedules
            .iter()
            .find_map(|(stored, schedule)| (*stored == key).then_some(*schedule))
            .ok_or(Error::RoundNotFound)
    }
}

/// Divide a slash base with rounding against the claimant. All callers use a
/// non-zero protocol denominator; the explicit zero branch is fail-closed for
/// any future misuse rather than panicking.
fn ceil_div(value: Balance, divisor: Balance) -> Balance {
    if divisor == 0 {
        return value;
    }
    let quotient = value / divisor;
    if value % divisor == 0 {
        quotient
    } else {
        quotient.saturating_add(1)
    }
}

pub fn round_bond(
    stake_at_risk: Balance,
    round: u8,
    params: &OracleParams,
) -> Result<Balance, Error> {
    ensure!(
        (ORC_ROUND_CAP_MIN..=ORC_ROUND_CAP_MAX).contains(&params.rounds),
        Error::RoundNotFound
    );
    ensure!((1..=params.rounds).contains(&round), Error::RoundNotFound);
    // 07 §6.1 (*Units and rounding*): `orc.bond_bps` is in basis points, so the
    // product carries the `/ 10_000` divisor and that division rounds **up**.
    // Rounding is resolved in the direction of custody (I-4 / I-28): over-custody
    // is dust, under-custody is an unbacked claim, so a bond is never a base unit
    // short. The `max` against the floor is applied after rounding.
    let scaled = stake_at_risk
        .checked_mul(params.bond_bps as Balance)
        .ok_or(Error::Overflow)?
        .div_ceil(10_000);
    let b1 = core::cmp::max(params.bond_floor, scaled);
    let multiplier = 1u128
        .checked_shl(u32::from(round.saturating_sub(1)))
        .ok_or(Error::Overflow)?;
    b1.checked_mul(multiplier).ok_or(Error::Overflow)
}

/// Derive a game's current bond exclusively from its snapshotted round-one
/// bond and round cap (07 §6.1/§13). This is deliberately independent of
/// every live constitution parameter.
pub fn stored_round_bond(
    round_one_bond: Balance,
    round: u8,
    round_cap: u8,
) -> Result<Balance, Error> {
    ensure!(
        (ORC_ROUND_CAP_MIN..=ORC_ROUND_CAP_MAX).contains(&round_cap),
        Error::RoundNotFound
    );
    ensure!((1..=round_cap).contains(&round), Error::RoundNotFound);
    let multiplier = 1u128
        .checked_shl(u32::from(round.saturating_sub(1)))
        .ok_or(Error::Overflow)?;
    round_one_bond
        .checked_mul(multiplier)
        .ok_or(Error::Overflow)
}

/// The 07 §6.3 bond-coverage rate `(2^R_max − 1) · orc.bond_bps`, in basis
/// points — what a reporter who must survive every round of the §5 ladder puts
/// at risk, expressed against the settlement impact a lie could move.
///
/// **This is the single home of that derivation.** It has three consumers that
/// need *opposite* failure directions when `rounds` is outside its 13 §1 kernel
/// band [2, 4], so the malformed case is returned as `None` rather than resolved
/// here: attested admission ([`can_admit_attested_component`], and welfare's
/// `register_metric_spec` gate) refuses, while the registry's value-scaled
/// filing bond falls back to the tightest lawful ladder (×3) because a zero
/// multiple would price every filing at the floor. Both are fail-closed for
/// their own consumer, and neither is safe for the other — which is exactly why
/// the choice belongs at the call site and the arithmetic does not.
pub fn coverage_bps(rounds: u8, bond_bps: u32) -> Option<u32> {
    if !(ORC_ROUND_CAP_MIN..=ORC_ROUND_CAP_MAX).contains(&rounds) {
        return None;
    }
    let round_multiplier = 1u32.checked_shl(u32::from(rounds))?;
    Some(round_multiplier.saturating_sub(1).saturating_mul(bond_bps))
}

/// 07 §6.3's admission rule at live parameters: a component may settle money
/// only if the whole bond ladder covers the maximum single-epoch settlement
/// impact it documents. The 10.5% figure §6.3 quotes is illustrative of
/// `R_max = 3` and MUST NOT be hardcoded (SQ-341).
pub fn can_admit_attested_component(delta_s_max_bps: u32, params: &OracleParams) -> bool {
    coverage_bps(params.rounds, params.bond_bps).is_some_and(|cov| cov >= delta_s_max_bps)
}

/// Domain separator for a committed evidence payload (07 §9).
///
/// One preimage layout must never be readable as another, so every commitment
/// this core builds opens with its own constant. The version suffix leaves room
/// for a later layout that cannot collide with this one.
pub const EVIDENCE_DOMAIN: &[u8] = b"bleavit/oracle/evidence/v1";

/// Domain separator for a round's report identity (07 §5.1, §13).
pub const REPORT_DOMAIN: &[u8] = b"bleavit/oracle/report/v1";

/// Domain-separated preimage of a committed evidence payload.
///
/// The payload is SCALE-encoded, so it carries its own length prefix and no two
/// distinct payloads share a preimage.
pub fn evidence_preimage(payload: &[u8]) -> Vec<u8> {
    let mut out = EVIDENCE_DOMAIN.to_vec();
    payload.encode_to(&mut out);
    out
}

/// Domain-separated preimage of a round's report identity. Every field is
/// fixed-width, so the concatenation is unambiguous.
pub fn report_preimage(
    component: MetricId,
    epoch: EpochId,
    round: u8,
    value: FixedU64,
    evidence_hash: H256,
) -> Vec<u8> {
    let mut out = REPORT_DOMAIN.to_vec();
    component.encode_to(&mut out);
    epoch.encode_to(&mut out);
    round.encode_to(&mut out);
    value.0.encode_to(&mut out);
    evidence_hash.encode_to(&mut out);
    out
}

/// Content hash of a committed evidence payload (07 §9).
///
/// The caller injects the runtime's canonical hash function, exactly as
/// `question_service_core::verify_report_view_provenance` does, so no host or
/// FRAME hashing dependency enters this core. **The injected function must be a
/// cryptographic hash.** This commitment is the only thing
/// [`Oracle::recompute_proof`] checks a submitted proof against, so a party who
/// can find a second payload under a committed hash settles a money-bearing
/// component at a number of its own choosing.
pub fn hash_evidence(payload: &[u8], hash: impl FnOnce(&[u8]) -> H256) -> H256 {
    hash(&evidence_preimage(payload))
}

/// Deterministic recomputation of a component value from its committed
/// evidence payload — the **model stand-in** for evaluating the frozen
/// MetricSpec `formula_ref` (the real engine arrives with the A7 spec
/// registry): the payload's first eight little-endian bytes are the FixedU64
/// value, which must lie on the [0, 1] 1e9 grid per 05 §4.4 determinism rule 1.
///
/// It reads the answer out of the payload rather than deriving it, so it is not
/// a proof of anything and no production runtime may supply it as one. That is
/// why [`Oracle::recompute_proof`] takes its evaluator from the caller: a
/// runtime without the A7 engine passes one that refuses, and the shipped
/// runtime does exactly that.
pub fn recompute_value(proof: &[u8]) -> Result<FixedU64, Error> {
    let bytes: [u8; 8] = proof
        .get(..8)
        .and_then(|slice| slice.try_into().ok())
        .ok_or(Error::BadProof)?;
    let raw = u64::from_le_bytes(bytes);
    ensure!(raw <= COMPONENT_VALUE_MAX, Error::BadProof);
    Ok(FixedU64(raw))
}

/// Content hash of a round's report identity, the key watchtower
/// acknowledgments are bound to (07 §13). The caller injects the hash, under
/// the same rule as [`hash_evidence`].
pub fn hash_report(
    component: MetricId,
    epoch: EpochId,
    round: u8,
    value: FixedU64,
    evidence_hash: H256,
    hash: impl FnOnce(&[u8]) -> H256,
) -> H256 {
    hash(&report_preimage(
        component,
        epoch,
        round,
        value,
        evidence_hash,
    ))
}

#[macro_export]
macro_rules! ensure {
    ($cond:expr, $err:expr $(,)?) => {
        if !$cond {
            return Err($err);
        }
    };
}

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarking {
    pub fn benchmark_stub() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The hash the core tests inject, in the same idiom as
    /// `question_service_core::report::tests::test_hash`.
    ///
    /// It is a test double, not a security claim. This core is FRAME-free and
    /// carries no hashing dependency, so it cannot compute blake2-256 here. The
    /// property that matters is structural and is stated where it can be
    /// checked: [`evidence_and_report_preimages_cannot_be_confused`] shows the
    /// core adds no arithmetic of its own and separates the two domains, and
    /// `pallets/oracle`'s suite proves the production binding against the real
    /// blake2-256 the runtime injects.
    fn test_hash(bytes: &[u8]) -> H256 {
        let mut out = [0u8; 32];
        for (index, byte) in bytes.iter().enumerate() {
            let slot = index % out.len();
            out[slot] = out[slot]
                .wrapping_add(*byte)
                .rotate_left((index % 8) as u32);
        }
        out
    }

    /// The two commitments this core builds cannot be confused with each other,
    /// and neither adds arithmetic of its own on top of the injected hash.
    ///
    /// Regression for the 2026-08-10 security review. `hash_evidence` was a
    /// 24-lane XOR fold: bytes 24..32 of its output *were* the payload length in
    /// little-endian, so the commitment published its own preimage length, and
    /// every lane was invertible, so a second payload under any committed hash
    /// was computable in O(len) from the commitment alone. `hash_report` folded
    /// its fields into the evidence hash it was handed, so the two commitments
    /// shared one output space. The pair below collided under that fold.
    #[test]
    fn evidence_and_report_preimages_cannot_be_confused() {
        // 48 zero bytes against a payload whose second 24-byte row cancels its
        // first under the fold's one-bit rotation: two distinct payloads, one
        // old digest.
        let zeros = alloc::vec![0u8; 48];
        let mut collides = alloc::vec![0u8; 48];
        collides[..24].fill(1);
        collides[24..].fill(0x80);

        assert_ne!(evidence_preimage(&zeros), evidence_preimage(&collides));
        assert_ne!(
            hash_evidence(&zeros, test_hash),
            hash_evidence(&collides, test_hash)
        );

        // SCALE carries the length, so the preimage is self-delimiting: one
        // prefix byte below the compact 63/64 boundary and two at it. Both
        // figures fail outright if the prefix is ever dropped for a bare copy —
        // which comparing two different-length payloads would not have noticed,
        // since those differ as byte strings either way.
        assert_eq!(
            evidence_preimage(&alloc::vec![0u8; 63]).len(),
            EVIDENCE_DOMAIN.len() + 1 + 63
        );
        assert_eq!(
            evidence_preimage(&alloc::vec![0u8; 64]).len(),
            EVIDENCE_DOMAIN.len() + 2 + 64
        );

        // Disjoint domains: an evidence preimage is never a report preimage.
        let report = report_preimage(7, 41, 1, FixedU64(62), [9u8; 32]);
        assert!(report.starts_with(REPORT_DOMAIN));
        assert!(evidence_preimage(&zeros).starts_with(EVIDENCE_DOMAIN));
        assert_ne!(EVIDENCE_DOMAIN, REPORT_DOMAIN);

        // Neither helper folds anything into the digest: the whole security
        // property belongs to the hash the caller injects.
        assert_eq!(
            hash_evidence(&zeros, test_hash),
            test_hash(&evidence_preimage(&zeros))
        );
        assert_eq!(
            hash_report(7, 41, 1, FixedU64(62), [9u8; 32], test_hash),
            test_hash(&report)
        );

        // A report commitment is bound to every field it names.
        let base = hash_report(7, 41, 1, FixedU64(62), [9u8; 32], test_hash);
        for other in [
            hash_report(8, 41, 1, FixedU64(62), [9u8; 32], test_hash),
            hash_report(7, 42, 1, FixedU64(62), [9u8; 32], test_hash),
            hash_report(7, 41, 2, FixedU64(62), [9u8; 32], test_hash),
            hash_report(7, 41, 1, FixedU64(63), [9u8; 32], test_hash),
            hash_report(7, 41, 1, FixedU64(62), [10u8; 32], test_hash),
        ] {
            assert_ne!(base, other);
        }
    }

    /// 07 §6.1 (*Units and rounding*): the base-unit product rounds **up**, so a
    /// bond is never a base unit short of the specified value. Pins the direction
    /// against a silent regression to truncating division (SQ-260 / SQ-289).
    #[test]
    fn round_bond_base_unit_product_rounds_up() {
        let params = OracleParams {
            // Floor at 1 so the `max` never masks the rounding under test.
            bond_floor: 1,
            bond_bps: 1,
            ..OracleParams::DEFAULT
        };
        // 1 bps of 15,000 base units = 1.5 → MUST be 2, not 1.
        assert_eq!(round_bond(15_000, 1, &params), Ok(2));
        // An exact product is unaffected by the rounding direction.
        assert_eq!(round_bond(20_000, 1, &params), Ok(2));
        // The doubling ladder derives from the already-rounded `B_1`.
        assert_eq!(round_bond(15_000, 2, &params), Ok(4));
        // Rounding is applied before the floor `max`, never after it.
        let floored = OracleParams {
            bond_floor: 10,
            ..params
        };
        assert_eq!(round_bond(15_000, 1, &floored), Ok(10));
    }

    /// Keep the pre-existing core tests focused on their original transition
    /// assertions while production callers pass an explicit live snapshot.
    trait DefaultOracleParams {
        fn register_reporter(&mut self, who: AccountId, now: BlockNumber) -> Result<(), Error>;
        fn register_watchtower(&mut self, who: AccountId, now: BlockNumber) -> Result<(), Error>;
        fn crank_round_close(&mut self, now: BlockNumber, batch: usize) -> Result<(), Error>;
        fn crank_reserve_probe(&mut self, now: BlockNumber) -> Result<u64, Error>;
        fn reserve_probe_result(
            &mut self,
            now: BlockNumber,
            query_id: u64,
            passed: bool,
        ) -> Result<(), Error>;
        fn crank_probe_timeout(&mut self, now: BlockNumber) -> Result<(), Error>;
    }

    impl DefaultOracleParams for Oracle {
        fn register_reporter(&mut self, who: AccountId, now: BlockNumber) -> Result<(), Error> {
            Oracle::register_reporter_with_params(self, who, now, &OracleParams::DEFAULT)
        }

        fn register_watchtower(&mut self, who: AccountId, now: BlockNumber) -> Result<(), Error> {
            Oracle::register_watchtower_with_params(self, who, now, &OracleParams::DEFAULT)
        }

        fn crank_round_close(&mut self, now: BlockNumber, batch: usize) -> Result<(), Error> {
            Oracle::crank_round_close_with_params(self, now, batch, &OracleParams::DEFAULT)
        }

        fn crank_reserve_probe(&mut self, now: BlockNumber) -> Result<u64, Error> {
            Oracle::crank_reserve_probe_with_params(self, now, &OracleParams::DEFAULT)
        }

        fn reserve_probe_result(
            &mut self,
            now: BlockNumber,
            query_id: u64,
            passed: bool,
        ) -> Result<(), Error> {
            Oracle::reserve_probe_result_with_params(
                self,
                now,
                query_id,
                passed,
                &OracleParams::DEFAULT,
            )
            .map(|_effective| ())
        }

        fn crank_probe_timeout(&mut self, now: BlockNumber) -> Result<(), Error> {
            Oracle::crank_probe_timeout_with_params(self, now, &OracleParams::DEFAULT)
        }
    }

    fn acct(n: u8) -> AccountId {
        [n; 32]
    }
    fn h(n: u8) -> H256 {
        [n; 32]
    }
    fn key(component: MetricId, epoch: EpochId, spec_version: MetricSpecVersion) -> RoundKey {
        RoundKey {
            component,
            epoch,
            spec_version,
        }
    }

    macro_rules! report {
        ($oracle:expr, $who:expr, $now:expr, $component:expr, $epoch:expr, $spec_version:expr, $value:expr, $evidence_hash:expr, $stake_at_risk:expr, $report_window_end:expr, $expected_spec:expr $(,)?) => {
            $oracle.report(
                ReportInput {
                    who: $who,
                    now: $now,
                    component: $component,
                    epoch: $epoch,
                    spec_version: $spec_version,
                    value: $value,
                    evidence_hash: $evidence_hash,
                    stake_at_risk: $stake_at_risk,
                    report_window_end: $report_window_end,
                    expected_spec: $expected_spec,
                },
                &OracleParams::DEFAULT,
                test_hash,
            )
        };
    }

    fn round_deadline(o: &Oracle, k: RoundKey) -> BlockNumber {
        o.rounds
            .iter()
            .find(|r| {
                r.component == k.component && r.epoch == k.epoch && r.spec_version == k.spec_version
            })
            .expect("live round")
            .challenge_deadline
    }

    /// Report round 1, then drive the game to a terminal state (round `R_max`
    /// with a live challenge) so `adjudicate` is admissible (07 §5.4).
    fn to_terminal(o: &mut Oracle, reporter: u8, challenger: u8, k: RoundKey, value: FixedU64) {
        report!(
            o,
            acct(reporter),
            1,
            k.component,
            k.epoch,
            k.spec_version,
            value,
            h(9),
            400_000_000_000,
            100,
            k.spec_version,
        )
        .unwrap();
        // Rounds 1..R_max: challenge, then the reporter explicitly consents to
        // the next round before its deadline. The final round carries the live
        // challenge for adjudication.
        for _ in 1..ORC_ROUNDS {
            let d = round_deadline(o, k);
            o.challenge(acct(challenger), d - 1, k, FixedU64(440_000_000), h(10))
                .unwrap();
            o.counter_report(
                acct(reporter),
                d - 1,
                k,
                FixedU64(440_000_000),
                h(10),
                &OracleParams::DEFAULT,
                test_hash,
            )
            .unwrap();
        }
        // Round R_max carries the terminal challenge.
        let d = round_deadline(o, k);
        o.challenge(acct(challenger), d - 1, k, FixedU64(440_000_000), h(10))
            .unwrap();
    }

    /// The block at which the 07 §4 liveness fixtures open `epoch`'s game. One
    /// full `orc.window + orc.ext_window` lane per epoch (plus slack), so a
    /// game's whole quorum-failure closure lands before the next game opens —
    /// the core has no block↔epoch clock of its own, so the fixtures supply the
    /// separation the real epoch schedule would.
    fn epoch_block(epoch: EpochId) -> BlockNumber {
        1 + epoch * (ORC_WINDOW_BLOCKS + ORC_EXT_WINDOW_BLOCKS + 2)
    }

    /// Open a game for `(7, epoch, 3)` and let it close **inside the same
    /// epoch** on the 07 §4 quorum-failure path (fewer than `wt.quorum` acks ⇒
    /// one `orc.ext_window` extension, then the §10 neutral settlement).
    ///
    /// No watchtower is acknowledged, so none is marked active, and `rounds` is
    /// empty again when the sweep runs: exactly the state in which only the
    /// `round_activity` latch still records that the epoch carried work.
    fn open_and_close_game(o: &mut Oracle, reporter: u8, epoch: EpochId) {
        let at = open_live_game(o, reporter, epoch);
        o.crank_round_close(at + ORC_WINDOW_BLOCKS, 8).unwrap();
        o.crank_round_close(at + ORC_WINDOW_BLOCKS + ORC_EXT_WINDOW_BLOCKS, 8)
            .unwrap();
        assert!(
            o.find_round(key(7, epoch, 3)).is_none(),
            "the quorum-failure close reaps the round"
        );
    }

    /// Open a game for `(7, epoch, 3)` and leave it **live**, returning the
    /// block it opened at. The epoch carries an open round in the plainest
    /// sense: one that is still there.
    fn open_live_game(o: &mut Oracle, reporter: u8, epoch: EpochId) -> BlockNumber {
        let at = epoch_block(epoch);
        report!(
            o,
            acct(reporter),
            at,
            7,
            epoch,
            3,
            FixedU64(620_000_000),
            h(9),
            400_000_000_000,
            at,
            3,
        )
        .unwrap();
        at
    }

    /// The inactivity counter recorded for a seat, or `None` once it is ejected.
    fn inactive_epochs(o: &Oracle, who: AccountId) -> Option<u8> {
        o.watchtowers
            .iter()
            .find(|(a, _)| *a == who)
            .map(|(_, info)| info.inactive_epochs)
    }

    #[test]
    fn reporter_and_watchtower_registries_are_bounded() {
        let mut o = Oracle::default();
        assert_eq!(o.register_reporter(acct(1), 1), Ok(()));
        assert_eq!(
            o.register_reporter(acct(1), 1),
            Err(Error::AlreadyRegistered)
        );
        for i in 2..=64 {
            assert_eq!(o.register_reporter(acct(i as u8), 1), Ok(()));
        }
        assert_eq!(
            o.register_reporter(acct(65), 1),
            Err(Error::TooManyReporters)
        );
        for i in 1..=16 {
            assert_eq!(o.register_watchtower(acct(i as u8), 1), Ok(()));
        }
        assert_eq!(
            o.register_watchtower(acct(17), 1),
            Err(Error::TooManyWatchtowers)
        );
    }

    #[test]
    fn value_scaled_bonds_and_admission_rule_match_defaults() {
        assert_eq!(
            round_bond(400_000_000_000, 1, &OracleParams::DEFAULT),
            Ok(10_000_000_000)
        );
        assert_eq!(
            round_bond(1_200_000_000_000, 1, &OracleParams::DEFAULT),
            Ok(30_000_000_000)
        );
        assert_eq!(
            round_bond(1_200_000_000_000, 3, &OracleParams::DEFAULT),
            Ok(120_000_000_000)
        );
        assert!(can_admit_attested_component(1_750, &OracleParams::DEFAULT));
        assert!(!can_admit_attested_component(1_751, &OracleParams::DEFAULT));
        let amended = OracleParams {
            rounds: 2,
            bond_bps: 500,
            ..OracleParams::DEFAULT
        };
        assert!(can_admit_attested_component(1_500, &amended));
        assert!(!can_admit_attested_component(1_501, &amended));
    }

    #[test]
    fn unchallenged_round_needs_watchtower_quorum_else_extends_then_neutral() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        assert!(matches!(
            o.events.last(),
            Some(Event::WindowExtended { .. })
        ));
        o.crank_round_close(ORC_WINDOW_BLOCKS + ORC_EXT_WINDOW_BLOCKS + 3, 1)
            .unwrap();
        assert_eq!(o.component_values[0].1.path, SettlePath::Neutral);
        assert!(o.component_values[0].1.flagged);
        assert!(o
            .events
            .iter()
            .any(|e| matches!(e, Event::QuorumFailed { .. })));
    }

    #[test]
    fn quorum_finalizes_and_challenge_supersedes_ack_requirement() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.register_watchtower(acct(3), 0).unwrap();
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        let rh = o.rounds[0].report_hash;
        o.ack_observed(acct(2), 5, key(7, 41, 3), 1, rh).unwrap();
        o.ack_observed(acct(3), 6, key(7, 41, 3), 1, rh).unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        assert_eq!(o.component_values[0].1.path, SettlePath::Unchallenged);

        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        report!(
            o,
            acct(1),
            1,
            8,
            42,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        o.challenge(acct(4), 2, key(8, 42, 3), FixedU64(44), h(10))
            .unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        // Contract v19: a challenge still supersedes the ack requirement — the
        // round closes without a quorum — but the reporter's default no longer
        // settles the challenger's counter-value *forward*. It takes the 07 §10
        // neutral path, carrying the last valid value with the epoch flagged,
        // because a default establishes only that the reporter abandoned their
        // assertion and establishes nothing about the challenger's.
        assert_eq!(o.component_values[0].1.path, SettlePath::Neutral);
        assert!(o.component_values[0].1.flagged);
        assert_ne!(o.component_values[0].1.value, FixedU64(44));
        // Round 1 default: the whole forfeited stack routes to INSURANCE and no
        // bounty is paid (07 §5.5).
        assert_eq!(
            o.bond_settlements[0].disposition,
            BondDisposition::ReporterDefaulted
        );
        assert!(o.rounds.is_empty());

        // A consenting reporter opens the next round explicitly; the keeper
        // never creates it or inflates the reporter stack.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        report!(
            o,
            acct(1),
            1,
            9,
            42,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        let k = key(9, 42, 3);
        let d = round_deadline(&o, k);
        o.challenge(acct(4), d - 1, k, FixedU64(44), h(10)).unwrap();
        o.counter_report(
            acct(1),
            d - 1,
            k,
            FixedU64(44),
            h(11),
            &OracleParams::DEFAULT,
            test_hash,
        )
        .unwrap();
        assert_eq!(o.rounds[0].round, 2);
        assert_eq!(o.rounds[0].bond, 20_000_000_000);
        assert_eq!(o.rounds[0].challenger, Some(acct(4)));
        assert!(o.rounds[0].counter_value.is_none());
    }

    #[test]
    fn counter_report_is_signed_consent_and_challenger_identity_survives_rounds() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(12, 50, 3);
        report!(
            o,
            acct(1),
            1,
            12,
            50,
            3,
            FixedU64(620_000_000),
            h(9),
            400_000_000_000,
            100,
            3,
        )
        .unwrap();
        let d = round_deadline(&o, k);
        o.challenge(acct(4), d - 1, k, FixedU64(440_000_000), h(10))
            .unwrap();
        assert_eq!(
            o.counter_report(
                acct(5),
                d - 1,
                k,
                FixedU64(500_000_000),
                h(11),
                &OracleParams::DEFAULT,
                test_hash,
            ),
            Err(Error::NotRegistered)
        );
        o.counter_report(
            acct(1),
            d - 1,
            k,
            FixedU64(500_000_000),
            h(11),
            &OracleParams::DEFAULT,
            test_hash,
        )
        .unwrap();
        assert_eq!(o.rounds[0].challenger, Some(acct(4)));
        let next = round_deadline(&o, k);
        assert_eq!(
            o.challenge(acct(5), next - 1, k, FixedU64(490_000_000), h(12)),
            Err(Error::NotRegistered)
        );
        o.challenge(acct(4), next - 1, k, FixedU64(490_000_000), h(12))
            .unwrap();
        assert_eq!(o.rounds[0].counter_value, Some(FixedU64(490_000_000)));
        o.try_state().unwrap();
    }

    #[test]
    fn durable_challenger_does_not_turn_a_quorum_round_into_an_implicit_challenge() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.register_watchtower(acct(3), 0).unwrap();
        let k = key(13, 51, 3);
        report!(
            o,
            acct(1),
            1,
            13,
            51,
            3,
            FixedU64(620_000_000),
            h(9),
            400_000_000_000,
            100,
            3,
        )
        .unwrap();
        let d = round_deadline(&o, k);
        o.challenge(acct(4), d - 1, k, FixedU64(440_000_000), h(10))
            .unwrap();
        o.counter_report(
            acct(1),
            d - 1,
            k,
            FixedU64(500_000_000),
            h(11),
            &OracleParams::DEFAULT,
            test_hash,
        )
        .unwrap();
        let report_hash = o.rounds[0].report_hash;
        o.ack_observed(acct(2), d + 1, k, 2, report_hash).unwrap();
        o.ack_observed(acct(3), d + 2, k, 2, report_hash).unwrap();
        o.crank_round_close(d + ORC_WINDOW_BLOCKS + 1, 1).unwrap();
        assert_eq!(o.component_values[0].1.path, SettlePath::Unchallenged);
        assert_eq!(o.component_values[0].1.value, FixedU64(500_000_000));
    }

    #[test]
    fn terminal_round_requires_a_live_challenge_for_adjudication() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(14, 51, 3);
        report!(
            o,
            acct(1),
            1,
            k.component,
            k.epoch,
            k.spec_version,
            FixedU64(620_000_000),
            h(9),
            400_000_000_000,
            100,
            3,
        )
        .unwrap();
        for _ in 1..ORC_ROUNDS {
            let deadline = round_deadline(&o, k);
            o.challenge(acct(4), deadline - 1, k, FixedU64(440_000_000), h(10))
                .unwrap();
            o.counter_report(
                acct(1),
                deadline - 1,
                k,
                FixedU64(440_000_000),
                h(11),
                &OracleParams::DEFAULT,
                test_hash,
            )
            .unwrap();
        }
        assert_eq!(o.rounds[0].round, ORC_ROUNDS);
        assert_eq!(o.rounds[0].challenger, Some(acct(4)));
        assert!(o.rounds[0].counter_value.is_none());
        assert_eq!(o.request_adjudication(k, 1), Err(Error::QuorumPending));
        assert_eq!(
            o.adjudicate(Origin::OracleResolution, k, FixedU64(440_000_000), false,),
            Err(Error::QuorumPending)
        );
    }

    #[test]
    fn recompute_and_adjudication_close_rounds_with_origin_check_and_offense_discipline() {
        let mut o = Oracle::default();
        o.recomputable_components.push((7, 3));
        o.register_reporter(acct(1), 0).unwrap();
        // The committed evidence payload recomputes to 0.44-style FixedU64(44),
        // contradicting the reported 62: recompute must settle at 44 and record
        // a reporter offense.
        let mut proof = alloc::vec![0u8; 24];
        proof[..8].copy_from_slice(&44u64.to_le_bytes());
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            hash_evidence(&proof, test_hash),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        o.challenge(acct(4), 2, key(7, 41, 3), FixedU64(44), h(10))
            .unwrap();
        o.recompute_proof(acct(5), key(7, 41, 3), &proof, test_hash, recompute_value)
            .unwrap();
        assert_eq!(o.component_values[0].1.path, SettlePath::Recomputed);
        assert_eq!(o.component_values[0].1.value, FixedU64(44));
        assert_eq!(o.reporters[0].1.offenses, 1);

        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        for n in 0..3 {
            // 07 §5.4: adjudication only resolves a terminal (round-R_max,
            // challenged) dispute (Codex F10) — drive each game there first.
            to_terminal(&mut o, 1, 4, key(9 + n, 41, 3), FixedU64(62));
            assert_eq!(
                o.adjudicate(Origin::FutarchyParam, key(9 + n, 41, 3), FixedU64(44), true),
                Err(Error::BadOrigin)
            );
            o.adjudicate(
                Origin::OracleResolution,
                key(9 + n, 41, 3),
                FixedU64(44),
                true,
            )
            .unwrap();
        }
        assert!(!o.is_reporter(&acct(1)));
        assert!(o
            .events
            .iter()
            .any(|e| matches!(e, Event::ReporterEjected { .. })));
    }

    #[test]
    fn reserve_probe_is_fail_static_and_recovers_after_threshold() {
        let mut o = Oracle::default();
        assert_eq!(o.crank_reserve_probe(RES_PROBE_INTERVAL), Ok(1));
        assert_eq!(
            o.crank_probe_timeout(RES_PROBE_INTERVAL + RES_PROBE_TIMEOUT),
            Ok(())
        );
        assert!(!o.reserve_health.unhealthy);
        assert_eq!(o.crank_reserve_probe(RES_PROBE_INTERVAL * 2), Ok(2));
        o.reserve_probe_result(RES_PROBE_INTERVAL * 2, 2, false)
            .unwrap();
        assert!(o.reserve_health.unhealthy);
        for i in 3..=5 {
            o.crank_reserve_probe(RES_PROBE_INTERVAL * i as u32)
                .unwrap();
            o.reserve_probe_result(RES_PROBE_INTERVAL * i as u32, i, true)
                .unwrap();
        }
        assert!(!o.reserve_health.unhealthy);
        assert!(o
            .events
            .iter()
            .any(|e| matches!(e, Event::ReserveUnhealthy)));
        assert!(o
            .events
            .iter()
            .any(|e| matches!(e, Event::ReserveRecovered)));
    }

    #[test]
    fn first_reserve_probe_opens_immediately_then_anchors_interval() {
        let mut o = Oracle::default();
        assert_eq!(
            o.crank_reserve_probe_with_params(1, &OracleParams::DEFAULT),
            Ok(1)
        );
        assert_eq!(o.reserve_health.last_probe_at, 1);
        o.reserve_probe_result_with_params(1, 1, true, &OracleParams::DEFAULT)
            .unwrap();
        assert_eq!(
            o.crank_reserve_probe_with_params(RES_PROBE_INTERVAL, &OracleParams::DEFAULT),
            Err(Error::ProbeTooEarly)
        );
        assert_eq!(
            o.crank_reserve_probe_with_params(1 + RES_PROBE_INTERVAL, &OracleParams::DEFAULT,),
            Ok(2)
        );
    }

    #[test]
    fn recompute_proof_is_mechanical_and_fail_closed() {
        let mut o = Oracle::default();
        o.recomputable_components.push((7, 3));
        o.register_reporter(acct(1), 0).unwrap();
        let mut proof = alloc::vec![0u8; 24];
        proof[..8].copy_from_slice(&62u64.to_le_bytes());
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            hash_evidence(&proof, test_hash),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        // Component not declared recomputable in the frozen spec: fail closed.
        assert_eq!(
            o.recompute_proof(acct(5), key(9, 41, 3), &proof, test_hash, recompute_value),
            Err(Error::NotRecomputable)
        );
        // Oversized proof.
        assert_eq!(
            o.recompute_proof(
                acct(5),
                key(7, 41, 3),
                &alloc::vec![0u8; ORC_MAX_PROOF_BYTES + 1],
                test_hash,
                recompute_value
            ),
            Err(Error::ProofTooLarge)
        );
        // Payload that does not match the committed evidence.
        assert_eq!(
            o.recompute_proof(
                acct(5),
                key(7, 41, 3),
                &alloc::vec![1u8; 24],
                test_hash,
                recompute_value
            ),
            Err(Error::EvidenceMismatch)
        );
        // Committed payload agreeing with the report settles without offense.
        o.recompute_proof(acct(5), key(7, 41, 3), &proof, test_hash, recompute_value)
            .unwrap();
        assert_eq!(o.component_values[0].1.value, FixedU64(62));
        assert_eq!(o.reporters[0].1.offenses, 0);

        // A committed payload too short to decode, or off the [0,1] 1e9 grid,
        // is a bad proof even when the hash matches.
        let mut o = Oracle::default();
        o.recomputable_components.push((7, 3));
        o.register_reporter(acct(1), 0).unwrap();
        let short = alloc::vec![3u8; 4];
        let mut off_grid = alloc::vec![0u8; 24];
        off_grid[..8].copy_from_slice(&(COMPONENT_VALUE_MAX + 1).to_le_bytes());
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            hash_evidence(&short, test_hash),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        assert_eq!(
            o.recompute_proof(acct(5), key(7, 41, 3), &short, test_hash, recompute_value),
            Err(Error::BadProof)
        );
        assert_eq!(
            o.recompute_proof(
                acct(5),
                key(7, 41, 3),
                &off_grid,
                test_hash,
                recompute_value
            ),
            Err(Error::EvidenceMismatch)
        );
        assert_eq!(recompute_value(&off_grid), Err(Error::BadProof));
    }

    #[test]
    fn late_watchtower_acks_cannot_retro_finalize() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.register_watchtower(acct(3), 0).unwrap();
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        let rh = o.rounds[0].report_hash;
        let deadline = o.rounds[0].challenge_deadline;
        // The window is half-open: an acknowledgment *at* the deadline block (the
        // block the close crank treats as mature) is already rejected (F24).
        assert_eq!(
            o.ack_observed(acct(2), deadline, key(7, 41, 3), 1, rh),
            Err(Error::WindowClosed)
        );
        // The uncranked round then extends rather than finalizing.
        o.crank_round_close(deadline + 2, 1).unwrap();
        assert!(matches!(
            o.events.last(),
            Some(Event::WindowExtended { .. })
        ));
        // Acks strictly inside the live extension window still count toward quorum.
        let extended_deadline = o.rounds[0].challenge_deadline;
        o.ack_observed(acct(2), extended_deadline - 1, key(7, 41, 3), 1, rh)
            .unwrap();
        o.ack_observed(acct(3), extended_deadline - 1, key(7, 41, 3), 1, rh)
            .unwrap();
        o.crank_round_close(extended_deadline + 1, 1).unwrap();
        assert_eq!(o.component_values[0].1.path, SettlePath::Unchallenged);
    }

    #[test]
    fn settled_components_cannot_be_reopened_by_a_new_report() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        to_terminal(&mut o, 1, 4, key(7, 41, 3), FixedU64(62));
        o.adjudicate(Origin::OracleResolution, key(7, 41, 3), FixedU64(44), false)
            .unwrap();
        assert_eq!(o.component_values.len(), 1);
        assert_eq!(
            report!(
                o,
                acct(1),
                2,
                7,
                41,
                3,
                FixedU64(99),
                h(9),
                400_000_000_000,
                10,
                3,
            ),
            Err(Error::AlreadyFinal)
        );
        assert_eq!(o.component_values.len(), 1);
        o.try_state().unwrap();
    }

    /// SQ-195 (Codex connector P1, 2026-07-25): the returned outcome is the
    /// **effective** one, not the reported one.
    ///
    /// A success arriving at or after `res.probe_timeout` — or while the live
    /// probe configuration is structurally invalid — is scored as a failure by
    /// `apply_probe_result`. Any consumer mirroring this result (the welfare `R`
    /// day input) must record the same fact, or welfare says the day passed
    /// while the health state has already called it a fail (07 §8).
    #[test]
    fn reserve_probe_result_returns_the_effective_outcome() {
        let params = OracleParams::DEFAULT;

        // Timely success: reported and effective agree.
        let mut timely = Oracle::default();
        assert_eq!(timely.crank_reserve_probe(RES_PROBE_INTERVAL), Ok(1));
        assert_eq!(
            timely.reserve_probe_result_with_params(RES_PROBE_INTERVAL, 1, true, &params),
            Ok(true)
        );

        // The same success one block past the deadline is an effective failure,
        // and the return value says so.
        let mut late = Oracle::default();
        assert_eq!(late.crank_reserve_probe(RES_PROBE_INTERVAL), Ok(1));
        let deadline = RES_PROBE_INTERVAL.saturating_add(params.probe_timeout);
        assert_eq!(
            late.reserve_probe_result_with_params(deadline, 1, true, &params),
            Ok(false),
            "a late success must report as the failure it was scored as",
        );
        assert_eq!(late.reserve_health.consecutive_passes, 0);
        assert_eq!(late.reserve_health.consecutive_fails, 1);
    }

    #[test]
    fn reserve_probe_results_count_once() {
        let mut o = Oracle::default();
        assert_eq!(o.crank_reserve_probe(RES_PROBE_INTERVAL), Ok(1));
        o.reserve_probe_result(RES_PROBE_INTERVAL, 1, false)
            .unwrap();
        // Replaying the consumed query must not add a second consecutive fail.
        assert_eq!(
            o.reserve_probe_result(RES_PROBE_INTERVAL, 1, false),
            Err(Error::UnknownQuery)
        );
        assert!(!o.reserve_health.unhealthy);
        assert_eq!(o.reserve_health.consecutive_fails, 1);
        // A response landing after the timeout already consumed the query is
        // rejected too.
        assert_eq!(o.crank_reserve_probe(RES_PROBE_INTERVAL * 2), Ok(2));
        o.crank_probe_timeout(RES_PROBE_INTERVAL * 2 + RES_PROBE_TIMEOUT)
            .unwrap();
        assert!(o.reserve_health.unhealthy);
        assert_eq!(
            o.reserve_probe_result(RES_PROBE_INTERVAL * 2, 2, true),
            Err(Error::UnknownQuery)
        );
        assert_eq!(o.reserve_health.consecutive_passes, 0);
    }

    #[test]
    fn reserve_probe_query_ids_stop_before_the_xcm_namespace_bit() {
        let mut o = Oracle::default();
        o.reserve_health.last_query_id = MAX_RESERVE_PROBE_QUERY_ID - 1;
        assert_eq!(
            o.crank_reserve_probe(RES_PROBE_INTERVAL),
            Ok(MAX_RESERVE_PROBE_QUERY_ID)
        );
        o.reserve_probe_result(RES_PROBE_INTERVAL, MAX_RESERVE_PROBE_QUERY_ID, true)
            .unwrap();
        let before = o.clone();
        assert_eq!(
            o.crank_reserve_probe(RES_PROBE_INTERVAL * 2),
            Err(Error::Overflow)
        );
        assert_eq!(o, before);
        o.try_state().unwrap();

        o.reserve_health.last_query_id = MAX_RESERVE_PROBE_QUERY_ID + 1;
        assert_eq!(o.try_state(), Err(Error::Overflow));
    }

    #[test]
    fn per_version_games_survive_an_activation_boundary() {
        // Codex review, PR #30 / 07 §2(4): where two live cohorts consume the
        // same (component, epoch) under different frozen spec versions, one
        // game runs per version - settling one must not block or shadow the
        // other, and recomputability is a property of the frozen version.
        let mut o = Oracle::default();
        o.recomputable_components.push((7, 3));
        o.register_reporter(acct(1), 0).unwrap();
        let mut proof = alloc::vec![0u8; 24];
        proof[..8].copy_from_slice(&44u64.to_le_bytes());
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(44),
            hash_evidence(&proof, test_hash),
            400_000_000_000,
            10,
            3,
        )
        .unwrap();
        // The version-4 game opens independently while version 3 is live.
        report!(
            o,
            acct(1),
            2,
            7,
            41,
            4,
            FixedU64(50),
            h(9),
            400_000_000_000,
            10,
            4,
        )
        .unwrap();
        assert_eq!(o.rounds.len(), 2);
        // Version 3 is declared recomputable; version 4 is not.
        o.recompute_proof(acct(5), key(7, 41, 3), &proof, test_hash, recompute_value)
            .unwrap();
        assert_eq!(
            o.recompute_proof(acct(5), key(7, 41, 4), &proof, test_hash, recompute_value),
            Err(Error::NotRecomputable)
        );
        // The settled version-3 value does not finalize version 4's game...
        assert_eq!(o.component_values.len(), 1);
        assert_eq!(o.rounds.len(), 1);
        // ...which still settles on its own track — consent through the
        // remaining rounds, then adjudicate it.
        let k4 = key(7, 41, 4);
        for _ in 1..ORC_ROUNDS {
            let d = round_deadline(&o, k4);
            o.challenge(acct(4), d - 1, k4, FixedU64(50), h(10))
                .unwrap();
            o.counter_report(
                acct(1),
                d - 1,
                k4,
                FixedU64(50),
                h(10),
                &OracleParams::DEFAULT,
                test_hash,
            )
            .unwrap();
        }
        let d = round_deadline(&o, k4);
        o.challenge(acct(4), d - 1, k4, FixedU64(50), h(10))
            .unwrap();
        o.adjudicate(Origin::OracleResolution, k4, FixedU64(50), false)
            .unwrap();
        assert_eq!(o.component_values.len(), 2);
        // A repeat report for a settled version stays final.
        assert_eq!(
            report!(
                o,
                acct(1),
                3,
                7,
                41,
                3,
                FixedU64(60),
                h(9),
                400_000_000_000,
                10,
                3,
            ),
            Err(Error::AlreadyFinal)
        );
        o.try_state().unwrap();
    }

    #[test]
    fn report_enforces_registration_window_and_spec_version() {
        let mut o = Oracle::default();
        assert_eq!(
            report!(o, acct(1), 1, 1, 1, 1, FixedU64(1), h(1), 0, 10, 1),
            Err(Error::NotRegistered)
        );
        o.register_reporter(acct(1), 0).unwrap();
        assert_eq!(
            report!(o, acct(1), 11, 1, 1, 2, FixedU64(1), h(1), 0, 10, 1),
            Err(Error::WindowClosed)
        );
        assert_eq!(
            report!(o, acct(1), 1, 1, 1, 2, FixedU64(1), h(1), 0, 10, 1),
            Err(Error::SpecVersionMismatch)
        );
    }

    #[test]
    fn challenge_rejects_values_outside_component_grid() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        report!(
            o,
            acct(1),
            1,
            k.component,
            k.epoch,
            k.spec_version,
            FixedU64(620_000_000),
            h(9),
            400_000_000_000,
            100,
            3,
        )
        .unwrap();
        let deadline = round_deadline(&o, k);
        assert_eq!(
            o.challenge(
                acct(4),
                deadline - 1,
                k,
                FixedU64(COMPONENT_VALUE_MAX + 1),
                h(10),
            ),
            Err(Error::ValueOutOfBounds)
        );
        assert!(o.rounds[0].challenger.is_none());
        assert!(o.rounds[0].counter_value.is_none());
    }

    #[test]
    fn watchtower_liveness_grace_then_inactivity_slash_and_reset() {
        // 07 §4 liveness discipline: registration grace, then inactivity
        // accrual, the 2-consecutive slash+eject, the active-epoch reset, and
        // the no-open-round exemption.
        //
        // The sweep derives 07 §4's "an epoch with ≥ 1 open round" from oracle
        // state instead of taking it from its caller (SQ-491), so each epoch
        // below *arranges* the predicate its step needs: a game for a chargeable
        // epoch, no game at all for the exempt one.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.register_watchtower(acct(3), 0).unwrap();

        // Epoch 1 carried a game — so inactivity was chargeable — but both seats
        // registered in it (grace) ⇒ neither is charged.
        open_and_close_game(&mut o, 1, 1);
        o.sweep_watchtower_liveness(1, true).unwrap();
        assert!(o.watchtowers.iter().all(|(_, i)| i.inactive_epochs == 0));
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerInactive { .. })));
        assert!(o.watchtower_active.is_empty());

        // Epoch 2 had an open round but neither acked ⇒ both inactive once.
        open_and_close_game(&mut o, 1, 2);
        o.sweep_watchtower_liveness(2, true).unwrap();
        assert!(o.watchtowers.iter().all(|(_, i)| i.inactive_epochs == 1));
        assert_eq!(
            o.events
                .iter()
                .filter(|e| matches!(e, Event::WatchtowerInactive { .. }))
                .count(),
            2
        );

        // Watchtower 2 acks in epoch 3 (needs a live round); 3 stays idle.
        let at = open_live_game(&mut o, 1, 3);
        let rh = o.rounds[0].report_hash;
        o.ack_observed(acct(2), at + 1, key(7, 3, 3), 1, rh)
            .unwrap();
        o.sweep_watchtower_liveness(3, true).unwrap();
        // 2 reset to 0 (active); 3 reaches 2 ⇒ slashed and ejected.
        assert_eq!(o.watchtowers.len(), 1);
        assert_eq!(o.watchtowers[0].0, acct(2));
        assert_eq!(o.watchtowers[0].1.inactive_epochs, 0);
        assert!(o.events.iter().any(
            |e| matches!(e, Event::WatchtowerSlashed { amount, .. } if *amount == WT_STAKE / 10)
        ));

        // Epoch 4 carries no round at all — the epoch-3 game closes first and no
        // new one opens — so it charges nobody, even though the surviving seat
        // sat idle through it.
        o.crank_round_close(at + ORC_WINDOW_BLOCKS, 8).unwrap();
        o.crank_round_close(at + ORC_WINDOW_BLOCKS + ORC_EXT_WINDOW_BLOCKS, 8)
            .unwrap();
        assert!(o.rounds.is_empty());
        o.sweep_watchtower_liveness(4, true).unwrap();
        assert_eq!(o.watchtowers[0].1.inactive_epochs, 0);
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerInactive { epoch: 4, .. })));
        o.try_state().unwrap();
    }

    #[test]
    fn watchtower_liveness_charges_idle_seat_after_a_cleanly_closed_game() {
        // 07 §4 charges "a watchtower that acknowledges no round in an epoch with
        // ≥ 1 open round" — a property of the *epoch*, not of what survives to
        // the boundary. A healthy game that opens and closes inside the epoch is
        // *removed* from `rounds` by `settle_at`, so a survival-based predicate
        // reads "no open round" in exactly the healthy case and takes the arm
        // that RESETS `inactive_epochs` — making §4's charge/slash/eject
        // unreachable and free-riding costless (SQ-491). The idle seat MUST be
        // charged for an epoch whose game was worked and closed.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap(); // acknowledges
        o.register_watchtower(acct(3), 0).unwrap(); // acknowledges
        o.register_watchtower(acct(4), 0).unwrap(); // free rider

        // Epoch 1 consumes all three registration graces.
        o.sweep_watchtower_liveness(1, true).unwrap();
        assert!(o.watchtower_active.is_empty());

        // Epoch 2: the healthy path — reported, acknowledged to `wt.quorum`,
        // closed `Unchallenged` at window close, and therefore reaped.
        let at = open_live_game(&mut o, 1, 2);
        let rh = o.rounds[0].report_hash;
        o.ack_observed(acct(2), at + 1, key(7, 2, 3), 1, rh)
            .unwrap();
        o.ack_observed(acct(3), at + 2, key(7, 2, 3), 1, rh)
            .unwrap();
        o.crank_round_close(at + ORC_WINDOW_BLOCKS, 8).unwrap();
        assert_eq!(o.component_values[0].1.path, SettlePath::Unchallenged);
        assert!(
            o.rounds.is_empty(),
            "the healthy close leaves no round to infer liveness from"
        );

        o.sweep_watchtower_liveness(2, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(4)), Some(1));
        assert!(o.events.iter().any(|e| matches!(
            e,
            Event::WatchtowerInactive { who, epoch } if *who == acct(4) && *epoch == 2
        )));
        // The two that did the work are reset, not charged.
        assert_eq!(inactive_epochs(&o, acct(2)), Some(0));
        assert_eq!(inactive_epochs(&o, acct(3)), Some(0));
        o.try_state().unwrap();
    }

    #[test]
    fn watchtower_liveness_charges_a_game_still_open_across_the_whole_epoch() {
        // 07 §4, the other disjunct: a game that opened in an earlier epoch and
        // drew no fresh report is still an open round for the epoch it spans, so
        // the seat that never acknowledges it is charged at the *second* sweep —
        // where the latch, consumed by the first sweep, no longer speaks for it.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();

        open_live_game(&mut o, 1, 1);
        o.sweep_watchtower_liveness(1, true).unwrap(); // registration grace
        assert_eq!(inactive_epochs(&o, acct(2)), Some(0));

        // Epoch 2 opened no game of its own: liveness rests entirely on the
        // round still sitting in `rounds`.
        assert!(!o.round_activity);
        assert!(!o.rounds.is_empty());
        o.sweep_watchtower_liveness(2, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(1));
        assert!(o.events.iter().any(|e| matches!(
            e,
            Event::WatchtowerInactive { who, epoch } if *who == acct(2) && *epoch == 2
        )));
        o.try_state().unwrap();
    }

    #[test]
    fn watchtower_liveness_unattributable_sweep_charges_nobody_and_holds_the_streak() {
        // 07 §4 (SQ-491 resolution): when the clock advances over intervening
        // epochs the latch and the activity set describe an *interval*, not the
        // epoch being swept. Charging from them would attribute a round that
        // lived two epochs ago to this one — over-charging, which the second
        // consecutive miss turns into a slash and an ejection.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.sweep_watchtower_liveness(1, true).unwrap(); // registration grace

        // A real miss in epoch 2 puts the seat one step from a slash.
        open_and_close_game(&mut o, 1, 2);
        o.sweep_watchtower_liveness(2, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(1));

        // Epoch 3 carried a game, but the clock then jumped to 8 without a crank.
        // Sweeping 8 sees a latch set by epoch 3's game.
        open_and_close_game(&mut o, 1, 3);
        assert!(o.round_activity);
        o.sweep_watchtower_liveness(8, false).unwrap();

        // Nobody is charged, so the seat is not slashed or ejected...
        assert_eq!(o.watchtowers.len(), 1);
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerInactive { epoch: 8, .. })));
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerSlashed { .. })));
        // ...and the streak is neither advanced nor acquitted: an unattributable
        // epoch is not a miss, and it is not an alibi either.
        assert_eq!(inactive_epochs(&o, acct(2)), Some(1));
        // Both the latch and the activity set are consumed, so the interval's
        // activity cannot leak into the next attributable epoch.
        assert!(!o.round_activity);
        assert!(o.watchtower_active.is_empty());
    }

    #[test]
    fn watchtower_liveness_ignores_a_round_retained_past_its_money_deadline() {
        // 07 §11(1) retains a neutralized round for bond disposal only. Its value
        // is final (I-18), so a watchtower has nothing left to acknowledge and the
        // epoch must not be chargeable on its account — otherwise the retention
        // window keeps charging for up to eight days after the game ended.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.sweep_watchtower_liveness(1, true).unwrap(); // registration grace

        // The game opens during epoch 2 and is genuinely chargeable there.
        open_live_game(&mut o, 1, 2);
        o.sweep_watchtower_liveness(2, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(1));

        // It then hits its d20 deadline. The entry is retained, as §11(1)
        // requires, but its money leg is settled — so epoch 3 carried no open
        // round and the idle seat is acquitted rather than charged a second time
        // (which at 2 consecutive would have slashed and ejected it).
        o.force_neutralize_expired(0, 2, &[]).unwrap();
        assert!(!o.rounds.is_empty());
        o.sweep_watchtower_liveness(3, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(0));
        assert_eq!(o.watchtowers.len(), 1);
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerInactive { epoch: 3, .. })));
    }

    #[test]
    fn watchtower_liveness_empty_epoch_charges_nobody_and_breaks_the_streak() {
        // 07 §4: an epoch with no open round is nobody's liveness failure, and
        // it breaks the "two *consecutive* inactive epochs" streak — a miss on
        // either side of an empty epoch must not combine into a slash.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.sweep_watchtower_liveness(1, true).unwrap(); // registration grace

        // Epoch 2 carried a game that came and went ⇒ the idle seat pays once.
        open_and_close_game(&mut o, 1, 2);
        o.sweep_watchtower_liveness(2, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(1));

        // Epoch 3 is genuinely empty: no game opened in it (no `report` since the
        // last sweep) and none is open.
        assert!(o.rounds.is_empty());
        o.sweep_watchtower_liveness(3, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(0));
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerInactive { epoch: 3, .. })));

        // Epoch 4 is chargeable again, so the seat takes a *fresh* first miss —
        // not the second of a streak — and is neither slashed nor ejected.
        open_and_close_game(&mut o, 1, 4);
        o.sweep_watchtower_liveness(4, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(1));
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerSlashed { .. })));
        o.try_state().unwrap();
    }

    #[test]
    fn watchtower_liveness_sweep_consumes_the_latch_so_one_game_charges_one_epoch() {
        // 07 §4 charges *per epoch*: the activity record a game leaves behind is
        // consumed by the sweep that reads it, so a single game cannot charge two
        // successive epochs and stack a lone miss into the 2-consecutive
        // slash+eject.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.sweep_watchtower_liveness(1, true).unwrap(); // registration grace

        open_and_close_game(&mut o, 1, 2);
        o.sweep_watchtower_liveness(2, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(1));

        // Epoch 3 is an epoch of its own, and an empty one — so the seat's lone
        // miss must not become the second of a streak.
        o.sweep_watchtower_liveness(3, true).unwrap();
        assert_eq!(inactive_epochs(&o, acct(2)), Some(0));
        assert_eq!(o.watchtowers.len(), 1, "not ejected");
        assert!(!o
            .events
            .iter()
            .any(|e| matches!(e, Event::WatchtowerSlashed { .. })));
        assert!(
            !o.round_activity,
            "the epoch's activity record is consumed by the sweep that reads it"
        );
        o.try_state().unwrap();
    }

    #[test]
    fn force_neutralize_expired_settles_stale_rounds_and_blocks_late_verdicts() {
        // 07 §11: a round not challenge-closed by its OracleSettleDeadline
        // settles neutrally, but the round and its bond stack remain until a
        // later terminal verdict (I-18; Codex F11/F12).
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        to_terminal(&mut o, 1, 4, key(7, 41, 3), FixedU64(620_000_000));
        o.force_neutralize_expired(0, 41, &[]).unwrap();
        assert_eq!(o.component_values.len(), 1);
        assert_eq!(o.component_values[0].1.path, SettlePath::Neutral);
        assert!(o.component_values[0].1.flagged);
        assert_eq!(o.rounds.len(), 1);
        // A late verdict resolves the retained bond/reputation only and cannot
        // overwrite the already-neutral money value.
        o.adjudicate(
            Origin::OracleResolution,
            key(7, 41, 3),
            FixedU64(440_000_000),
            true,
        )
        .unwrap();
        assert!(o.rounds.is_empty());
        assert_eq!(
            o.component_values[0].1.value,
            FixedU64(COMPONENT_VALUE_MAX / 2)
        );
        o.try_state().unwrap();
    }

    /// 07 §11(1): "Retention is bounded by the track's own schedule (7 d
    /// decision + 1 d confirm), after which the stack resolves and the entry is
    /// reaped." Nothing implemented the *after*: a round-`R_max` challenge whose
    /// verdict never landed was skipped by every close crank forever, so its
    /// bonds stayed in custody and its slot stayed occupied against
    /// `MAX_ROUNDS` — one abandoned dispute per slot starves the reporting
    /// surface (SQ-492).
    #[test]
    fn sq492_retained_round_expires_and_refunds_both_stacks() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        to_terminal(&mut o, 1, 4, k, FixedU64(620_000_000));
        let neutralized_at = 1_000_000;
        o.force_neutralize_expired(neutralized_at, 41, &[]).unwrap();
        assert_eq!(o.rounds.len(), 1, "the stack is retained past the deadline");
        let expiry = neutralized_at + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS;
        assert_eq!(o.retention_deadline(k), Some(expiry));
        let (reporter_stack, challenger_stack) = (
            o.rounds[0].cumulative_reporter_bond,
            o.rounds[0].cumulative_challenger_bond,
        );
        assert!(reporter_stack > 0 && challenger_stack > 0);

        // One block early the verdict can still land, so the crank must not
        // consume the round. This is the half a `now >= deadline` typo breaks
        // silently, so it is asserted rather than implied.
        o.bond_settlements.clear();
        o.crank_round_close_with_params(expiry - 1, 20, &OracleParams::DEFAULT)
            .unwrap();
        assert_eq!(o.rounds.len(), 1);
        assert!(o.bond_settlements.is_empty());
        o.try_state().unwrap();

        // At the deadline the retention has bought all the adjudication it can.
        o.crank_round_close_with_params(expiry, 20, &OracleParams::DEFAULT)
            .unwrap();
        assert!(o.rounds.is_empty(), "the slot is returned");
        assert!(o.round_schedules.is_empty());
        assert!(o.money_settled.is_empty());
        assert_eq!(o.bond_settlements.len(), 1);
        let settlement = o.bond_settlements[0];
        assert_eq!(
            settlement.disposition,
            BondDisposition::RefundBoth,
            "no verdict means no adjudicated loser — taking either stack would \
             be a claim with no finding behind it (R-7)"
        );
        assert_eq!(settlement.reporter_bond, reporter_stack);
        assert_eq!(settlement.challenger_bond, challenger_stack);
        assert_eq!(settlement.challenger, Some(acct(4)));
        assert!(o.events.iter().any(|e| matches!(
            e,
            Event::RetentionExpired {
                component: 7,
                epoch: 41,
                ..
            }
        )));

        // The money leg is untouched: I-18 says the neutral value settled at the
        // deadline is final, and expiry disposes of bonds only.
        assert_eq!(o.component_values.len(), 1);
        assert_eq!(o.component_values[0].1.path, SettlePath::Neutral);
        o.try_state().unwrap();
    }

    /// The expiry must not pre-empt a verdict that arrives inside the window:
    /// §5.5's forfeiture is the whole griefing price, and refunding a loser
    /// who was about to be adjudicated wrong would erase it.
    #[test]
    fn sq492_verdict_inside_the_retention_window_still_forfeits() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        to_terminal(&mut o, 1, 4, k, FixedU64(620_000_000));
        o.force_neutralize_expired(1_000_000, 41, &[]).unwrap();
        o.bond_settlements.clear();
        o.adjudicate(Origin::OracleResolution, k, FixedU64(440_000_000), true)
            .unwrap();
        assert_eq!(o.bond_settlements.len(), 1);
        assert_eq!(
            o.bond_settlements[0].disposition,
            BondDisposition::ChallengerWins
        );
        assert!(
            o.money_settled.is_empty(),
            "the retention entry goes with it"
        );
        o.try_state().unwrap();
    }

    /// 07 §13 says settled values are "reaped at cohort settlement" — and no
    /// caller in either pallet ever reaped one, so `ComponentValues` grew by an
    /// entry per admitted component per epoch until `MAX_COMPONENT_VALUES`
    /// turned every further settlement into `AlreadyFinal` (SQ-492).
    #[test]
    fn sq492_reap_settled_before_is_bounded_and_oldest_first() {
        let mut o = Oracle::default();
        for epoch in 10u32..14 {
            for component in 0u16..3 {
                o.component_values.push((
                    (component, epoch, 1),
                    SettledComponent {
                        value: FixedU64(500_000_000),
                        path: SettlePath::Unchallenged,
                        flagged: false,
                    },
                ));
            }
        }

        // Bounded: a cap smaller than the stale set drains oldest-first and
        // leaves the rest for the next crank (the `ReapBatch` shape, not a
        // rejection).
        assert_eq!(o.reap_settled_before(13, 4), 4);
        assert!(
            !o.component_values.iter().any(|((_, e, _), _)| *e == 10),
            "epoch 10 goes before any of 11"
        );
        assert_eq!(
            o.component_values
                .iter()
                .filter(|((_, e, _), _)| *e == 11)
                .count(),
            2
        );

        // Draining is idempotent once nothing is left below the cutoff, and the
        // cutoff epoch itself is retained — welfare may still read it.
        assert_eq!(o.reap_settled_before(13, 64), 5);
        assert_eq!(o.reap_settled_before(13, 64), 0);
        assert_eq!(o.component_values.len(), 3);
        assert!(o.component_values.iter().all(|((_, e, _), _)| *e == 13));
    }

    /// The reaper must not retire the settled value a still-retained round is
    /// resting on. That value is what makes the round non-money-bearing past its
    /// own deadline (I-18; the 07 §13 try-state invariant), so removing it leaves
    /// a live `Rounds` entry with no counterpart and breaks try-state on a chain
    /// whose only fault was a stalled close crank.
    #[test]
    fn sq492_reaper_never_strands_a_retained_round() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        to_terminal(&mut o, 1, 4, k, FixedU64(620_000_000));
        o.force_neutralize_expired(1_000_000, 41, &[]).unwrap();
        assert_eq!(o.component_values.len(), 1);
        o.try_state().unwrap();

        // A cutoff far past the retained epoch — the state a stalled close crank
        // leaves, since the reaping cutoff advances on the clock and retention
        // only ends when someone cranks.
        assert_eq!(o.reap_settled_before(9_999, 64), 0);
        assert_eq!(o.component_values.len(), 1);
        o.try_state().unwrap();

        // Once the retention expires and the round is reaped, the value is
        // ordinary history again — reapable as soon as it is no longer the
        // component's own carry checkpoint, which a later settled value makes it.
        o.crank_round_close_with_params(
            1_000_000 + futarchy_primitives::kernel::ORC_RETENTION_BLOCKS,
            20,
            &OracleParams::DEFAULT,
        )
        .unwrap();
        assert!(o.rounds.is_empty());
        assert_eq!(
            o.reap_settled_before(9_999, 64),
            0,
            "the sole value for a component is its carry checkpoint"
        );
        o.component_values.push((
            (7, 42, 3),
            SettledComponent {
                value: FixedU64(600_000_000),
                path: SettlePath::Unchallenged,
                flagged: false,
            },
        ));
        assert_eq!(o.reap_settled_before(9_999, 64), 1);
        assert_eq!(o.component_values.len(), 1);
        assert_eq!(o.component_values[0].0, (7, 42, 3));
        o.try_state().unwrap();
    }

    /// 07 §10 settles a failed component at "its last valid value", which
    /// `last_valid_value` reads out of the settled history. An unqualified
    /// cutoff deletes that history for a component no cohort consumed for
    /// longer than the retention window — the cohortless epochs 05 §3.3
    /// contemplates — and the next missed report would then carry the neutral
    /// 0.5 instead of the component's real last value, moving `W` and every
    /// settlement reading it. Unreachable before this reaper existed, because
    /// nothing was ever removed (Codex F13; #175 review).
    #[test]
    fn sq492_reaping_preserves_each_component_carry_checkpoint() {
        let mut o = Oracle::default();
        for (component, epoch, value) in [(7u16, 10u32, 620_000_000u64), (7, 11, 640_000_000)] {
            o.component_values.push((
                (component, epoch, 1),
                SettledComponent {
                    value: FixedU64(value),
                    path: SettlePath::Unchallenged,
                    flagged: false,
                },
            ));
        }
        // A cutoff far past both: an unqualified sweep takes the whole history.
        assert_eq!(o.reap_settled_before(9_999, 64), 1);
        assert_eq!(o.component_values.len(), 1);
        assert_eq!(o.component_values[0].0, (7, 11, 1));

        // And the carry the survivor exists for still reads the real last
        // value rather than the neutral 0.5 default.
        assert_eq!(o.last_valid_value(7, 20), FixedU64(640_000_000));
        assert_ne!(o.last_valid_value(7, 20), FixedU64(COMPONENT_VALUE_MAX / 2));

        // Draining is idempotent: the checkpoint is not re-offered each crank.
        assert_eq!(o.reap_settled_before(9_999, 64), 0);
        o.try_state().unwrap();
    }

    /// The retained-entry bound is what keeps the whole map inside
    /// `MAX_COMPONENT_VALUES`, so it is arithmetic, not a preference.
    #[test]
    fn sq492_retention_bounds_are_derived_not_picked() {
        // 16 components x retained epochs x <= 2 concurrent frozen versions.
        let worst_case = 16 * (COMPONENT_VALUE_RETAINED_EPOCHS as usize) * 2;
        assert!(worst_case <= MAX_COMPONENT_VALUES);
        // One epoch's arrivals per crank: enough to keep pace with production.
        assert_eq!(
            COMPONENT_VALUE_REAP_BATCH * (COMPONENT_VALUE_RETAINED_EPOCHS as usize + 1),
            MAX_COMPONENT_VALUES
        );
        // The retention window is the OracleResolution track's own schedule
        // (06 §2.1: 0 prepare / 7 d decision / 1 d confirm). `bleavit-runtime`
        // asserts the other half of this binding against its track table.
        assert_eq!(
            futarchy_primitives::kernel::ORC_RETENTION_BLOCKS,
            8 * futarchy_primitives::kernel::BLOCKS_PER_DAY
        );
    }

    #[test]
    fn force_neutralize_expired_neutralizes_no_report_components() {
        // Codex P1 / 07 §11(1): an admitted component that got NO report has no
        // round, so the live-round sweep never touches it — yet welfare must find
        // a value for it at the money deadline. The deadline crank synthesizes the
        // neutral flagged carry-last entry directly (07 §10 no-report path).
        // `expected` = the (component, version) pairs live cohorts consume for the
        // epoch; the epoch/welfare pallet supplies them at B1a.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        // Component 7 opens a round (settled via the sweep); component 8 is also
        // expected but never reports (settled via the no-report path).
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(620_000_000),
            h(9),
            400_000_000_000,
            100,
            3,
        )
        .unwrap();
        let expected = [(7, 3), (8, 3)];
        o.force_neutralize_expired(0, 41, &expected).unwrap();
        // Both keys carry a neutral flagged value — 7 from its round, 8 no-report.
        assert_eq!(o.component_values.len(), 2);
        for &(c, v) in &expected {
            let entry = o
                .component_values
                .iter()
                .find(|((cc, ee, vv), _)| *cc == c && *ee == 41 && *vv == v)
                .expect("every expected component has a value by the deadline");
            assert_eq!(entry.1.path, SettlePath::Neutral);
            assert!(entry.1.flagged);
        }
        // The no-report component with no prior value carries neutral 0.5 (05 §10).
        let no_report = o
            .component_values
            .iter()
            .find(|((c, _, _), _)| *c == 8)
            .unwrap();
        assert_eq!(no_report.1.value, FixedU64(COMPONENT_VALUE_MAX / 2));
        assert_eq!(o.rounds.len(), 1);
        // Idempotent: a second crank finds both keys valued and adds nothing.
        o.force_neutralize_expired(0, 41, &expected).unwrap();
        assert_eq!(o.component_values.len(), 2);
        o.try_state().unwrap();
    }

    #[test]
    fn round_state_fields_match_contract_v4() {
        use scale_info::TypeDef;
        const ROUND_STATE_FIELDS: [&str; 17] = [
            "component",
            "epoch",
            "round",
            "spec_version",
            "reporter",
            "value",
            "evidence_hash",
            "bond",
            "challenge_deadline",
            "extended",
            "challenger",
            "counter_value",
            "acks",
            "report_hash",
            "stake_at_risk",
            "cumulative_reporter_bond",
            "cumulative_challenger_bond",
        ];
        let type_info = RoundState::type_info();
        let names: Vec<&str> = match &type_info.type_def {
            TypeDef::Composite(c) => c.fields.iter().filter_map(|f| f.name).collect(),
            _ => panic!("RoundState must encode as a SCALE composite type"),
        };
        assert_eq!(names, ROUND_STATE_FIELDS);
    }

    #[test]
    fn offense_against_an_ejected_reporter_is_a_noop_not_an_error() {
        // Codex F17: a reporter ejected on one game can still have another live
        // round settled — a further offense against them is a no-op, so the
        // valid recompute is not stranded by `NotRegistered`.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        // Committed evidence that disproves the report (recomputes to 0.44).
        let mut proof = alloc::vec![0u8; 24];
        proof[..8].copy_from_slice(&440_000_000u64.to_le_bytes());
        // Game 30 is reported now but recomputed only AFTER the ejection.
        o.recomputable_components.push((30, 3));
        report!(
            o,
            acct(1),
            1,
            30,
            41,
            3,
            FixedU64(620_000_000),
            hash_evidence(&proof, test_hash),
            400_000_000_000,
            100,
            3,
        )
        .unwrap();
        // Eject acct(1): three recompute-disproofs on other components accrue
        // three offenses (recompute settles each game directly — no crank).
        for n in 0..3 {
            o.recomputable_components.push((31 + n, 3));
            report!(
                o,
                acct(1),
                1,
                31 + n,
                41,
                3,
                FixedU64(620_000_000),
                hash_evidence(&proof, test_hash),
                400_000_000_000,
                100,
                3,
            )
            .unwrap();
            o.recompute_proof(
                acct(5),
                key(31 + n, 41, 3),
                &proof,
                test_hash,
                recompute_value,
            )
            .unwrap();
        }
        assert!(!o.is_reporter(&acct(1)));
        // The pre-existing game still settles by recompute despite the ejection.
        o.recompute_proof(acct(5), key(30, 41, 3), &proof, test_hash, recompute_value)
            .unwrap();
        assert!(o.component_values.iter().any(|((c, _, _), _)| *c == 30));
        o.try_state().unwrap();
    }

    // ---------------------------------------------------------------------
    // Contract v19 — the two confirmed oracle vulnerabilities.
    //
    // VULN 1: `challenge` never checked distinctness and the 07 §5.3 default
    // settled the challenger's counter-value forward unflagged, so one purse
    // holding both roles moved a component by up to `Δs_max` while risking
    // `0.6·B₁` against the `(2^R_max − 1)·B₁` ladder 07 §6.3 prices.
    // VULN 2: the §3 offense ladder reset on deregister + re-register.
    // ---------------------------------------------------------------------

    /// Seed a settled value for `(component, epoch - 1)` so `last_valid_value`
    /// carries something real rather than the neutral 0.5 fallback.
    fn seed_prior_value(o: &mut Oracle, component: MetricId, epoch: EpochId, value: FixedU64) {
        o.component_values.push((
            (component, epoch - 1, 3),
            SettledComponent {
                value,
                path: SettlePath::Unchallenged,
                flagged: false,
            },
        ));
    }

    #[test]
    fn challenge_by_the_round_reporter_is_refused_at_every_round() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        // Round 1.
        assert_eq!(
            o.challenge(acct(1), 2, k, FixedU64(44), h(10)),
            Err(Error::SelfChallenge)
        );
        assert!(o.rounds[0].challenger.is_none());
        assert_eq!(o.rounds[0].cumulative_challenger_bond, 0);
        // The guard is ordered before `AlreadyChallenged`, so the reporter's own
        // attempt names the real reason even after a legitimate challenge.
        let d = round_deadline(&o, k);
        o.challenge(acct(4), d - 1, k, FixedU64(440_000_000), h(10))
            .unwrap();
        assert_eq!(
            o.challenge(acct(1), d - 1, k, FixedU64(44), h(10)),
            Err(Error::SelfChallenge)
        );
        // And after a consenting escalation to round 2.
        o.counter_report(
            acct(1),
            d - 1,
            k,
            FixedU64(440_000_000),
            h(10),
            &OracleParams::DEFAULT,
            test_hash,
        )
        .unwrap();
        assert_eq!(o.rounds[0].round, 2);
        let d2 = round_deadline(&o, k);
        assert_eq!(
            o.challenge(acct(1), d2 - 1, k, FixedU64(44), h(10)),
            Err(Error::SelfChallenge)
        );
        o.try_state().unwrap();
    }

    #[test]
    fn round_one_default_carries_last_valid_value_flagged() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        seed_prior_value(&mut o, 7, 41, FixedU64(900_000_000));
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        // A *second funded account* — deliberately not the reporter — so this
        // proves the fix does not depend on the identity guard.
        o.challenge(acct(9), 2, k, FixedU64(440_000_000), h(10))
            .unwrap();
        let bond = o.rounds[0].cumulative_reporter_bond;
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        let settled = o
            .component_values
            .iter()
            .find(|((c, e, _), _)| *c == 7 && *e == 41)
            .expect("settled")
            .1;
        assert_eq!(settled.path, SettlePath::Neutral);
        assert!(settled.flagged);
        // The carried value, never the challenger's assertion.
        assert_eq!(settled.value, FixedU64(900_000_000));
        assert_ne!(settled.value, FixedU64(440_000_000));
        let s = o.bond_settlements.last().expect("settlement");
        assert_eq!(s.disposition, BondDisposition::ReporterDefaulted);
        assert_eq!(s.reporter_bond, bond);
        assert!(o
            .events
            .iter()
            .any(|e| matches!(e, Event::NeutralSettlement { .. })));
        o.try_state().unwrap();
    }

    #[test]
    fn round_two_default_carries_the_value_but_pays_the_bounty() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        seed_prior_value(&mut o, 7, 41, FixedU64(900_000_000));
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        let d = round_deadline(&o, k);
        o.challenge(acct(9), d - 1, k, FixedU64(440_000_000), h(10))
            .unwrap();
        // The reporter consents to escalate, then abandons — a concession by
        // conduct on a contest the challenger funded, so §6.2's bounty applies.
        o.counter_report(
            acct(1),
            d - 1,
            k,
            FixedU64(440_000_000),
            h(10),
            &OracleParams::DEFAULT,
            test_hash,
        )
        .unwrap();
        let d2 = round_deadline(&o, k);
        o.challenge(acct(9), d2 - 1, k, FixedU64(450_000_000), h(11))
            .unwrap();
        o.crank_round_close(d2 + 1, 1).unwrap();
        let settled = o
            .component_values
            .iter()
            .find(|((c, e, _), _)| *c == 7 && *e == 41)
            .expect("settled")
            .1;
        // The value side is neutral at *every* round — only the money differs.
        assert_eq!(settled.path, SettlePath::Neutral);
        assert!(settled.flagged);
        assert_eq!(settled.value, FixedU64(900_000_000));
        let s = o.bond_settlements.last().expect("settlement");
        assert_eq!(s.disposition, BondDisposition::ChallengerWins);
        o.try_state().unwrap();
    }

    #[test]
    fn default_records_no_reporter_offense() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        o.challenge(acct(9), 2, k, FixedU64(440_000_000), h(10))
            .unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        // A default is producible by the challenger, by a censoring collator set
        // (14 TH-24) or by a dead node, so it is not a finding that the value
        // was *wrong* (07 §5.5).
        let (_, info) = o.reporters.iter().find(|(a, _)| *a == acct(1)).unwrap();
        assert_eq!(info.offenses, 0);
        assert!(o.reporter_records.is_empty());
        o.try_state().unwrap();
    }

    #[test]
    fn no_terminal_path_ever_writes_challenger_default() {
        // Drives the reachable terminal paths and asserts the retired variant is
        // never produced. Its unreachability is otherwise enforced only by the
        // shell's try-state scan.
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_watchtower(acct(2), 0).unwrap();
        o.register_watchtower(acct(3), 0).unwrap();
        // Unchallenged + quorum.
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        let rh = o.rounds[0].report_hash;
        o.ack_observed(acct(2), 5, key(7, 41, 3), 1, rh).unwrap();
        o.ack_observed(acct(3), 6, key(7, 41, 3), 1, rh).unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        // Round-1 default.
        report!(
            o,
            acct(1),
            1,
            8,
            42,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        o.challenge(acct(9), 2, key(8, 42, 3), FixedU64(440_000_000), h(10))
            .unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        // Quorum failure ⇒ §10 neutral.
        report!(
            o,
            acct(1),
            1,
            9,
            43,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        o.crank_round_close(ORC_WINDOW_BLOCKS + ORC_EXT_WINDOW_BLOCKS + 4, 1)
            .unwrap();
        assert!(!o
            .component_values
            .iter()
            .any(|(_, s)| s.path == SettlePath::ChallengerDefault));
        o.try_state().unwrap();
    }

    #[test]
    fn offense_record_survives_deregistration_and_reregistration() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        let k = key(7, 41, 3);
        to_terminal(&mut o, 1, 9, k, FixedU64(62));
        o.adjudicate(Origin::OracleResolution, k, FixedU64(440_000_000), true)
            .unwrap();
        let (_, info) = o.reporters.iter().find(|(a, _)| *a == acct(1)).unwrap();
        assert_eq!(info.offenses, 1);
        // Exit returns the stake in full, but not a clean record.
        o.deregister_reporter(acct(1)).unwrap();
        assert_eq!(o.reporter_records.len(), 1);
        assert_eq!(o.reporter_records[0].offenses, 1);
        o.try_state().unwrap();
        o.register_reporter(acct(1), 10).unwrap();
        let (_, info) = o.reporters.iter().find(|(a, _)| *a == acct(1)).unwrap();
        assert_eq!(info.offenses, 1, "the ladder must survive exit");
        // Exactly one home per account.
        assert!(o.reporter_records.is_empty());
        assert_eq!(info.stake, OracleParams::DEFAULT.reporter_stake);
        o.try_state().unwrap();
    }

    #[test]
    fn clean_exit_retains_no_record() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.deregister_reporter(acct(1)).unwrap();
        // Ordinary rotation can never fill the bound.
        assert!(o.reporter_records.is_empty());
        o.try_state().unwrap();
    }

    #[test]
    fn reregistration_after_the_second_offense_seats_the_half_stake() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        for (n, component) in [(0u8, 7u16), (1, 8)] {
            let k = key(component, 41 + n as u32, 3);
            to_terminal(&mut o, 1, 9, k, FixedU64(62));
            o.adjudicate(Origin::OracleResolution, k, FixedU64(440_000_000), true)
                .unwrap();
        }
        let (_, info) = o.reporters.iter().find(|(a, _)| *a == acct(1)).unwrap();
        assert_eq!(info.offenses, OFFENSE_SLASH_THRESHOLD);
        o.deregister_reporter(acct(1)).unwrap();
        o.register_reporter(acct(1), 10).unwrap();
        let (_, info) = o.reporters.iter().find(|(a, _)| *a == acct(1)).unwrap();
        // 07 §2(5): re-entry is into the degraded half-stake state, so the
        // `orc.n_min` count still excludes the seat.
        let full = OracleParams::DEFAULT.reporter_stake;
        assert_eq!(info.stake, full - full.div_ceil(2));
        assert!(info.stake < full);
        o.try_state().unwrap();
    }

    #[test]
    fn ejected_reporter_can_never_reregister() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        for (n, component) in [(0u8, 7u16), (1, 8), (2, 9)] {
            let k = key(component, 41 + n as u32, 3);
            to_terminal(&mut o, 1, 9, k, FixedU64(62));
            o.adjudicate(Origin::OracleResolution, k, FixedU64(440_000_000), true)
                .unwrap();
        }
        assert!(!o.is_reporter(&acct(1)));
        let rec = o
            .reporter_records
            .iter()
            .find(|r| r.account == acct(1))
            .expect("ejection retained");
        assert!(rec.ejected);
        assert_eq!(
            o.register_reporter(acct(1), 99),
            Err(Error::ReporterEjected)
        );
        o.try_state().unwrap();
    }

    #[test]
    fn deregister_blocked_while_the_account_is_a_live_rounds_challenger() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.register_reporter(acct(9), 0).unwrap();
        let k = key(7, 41, 3);
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        o.challenge(acct(9), 2, k, FixedU64(440_000_000), h(10))
            .unwrap();
        // 07 §3: a challenger's bond is held in the round, so challenging is
        // "participating" and exit must wait for it to close.
        assert_eq!(o.deregister_reporter(acct(9)), Err(Error::WindowOpen));
        o.crank_round_close(ORC_WINDOW_BLOCKS + 2, 1).unwrap();
        o.deregister_reporter(acct(9)).unwrap();
        o.try_state().unwrap();
    }

    /// 07 §3 saturation clause. The exact bypass this closes: with the record
    /// store full of ejections, the next ejection retains **no row**, so the
    /// `carried` lookup reads `None` and the unconditional "MAY NEVER
    /// re-register" is defeated by arithmetic. Written against the real
    /// ejection path, not by poking `reporter_records`, so it fails if either
    /// half of the fix is reverted.
    #[test]
    fn a_saturated_ban_store_closes_entry_instead_of_re_admitting_the_ejected() {
        let mut o = Oracle::default();
        // Order matters, and it is the order the chain actually takes: the
        // gate is *preventive*, so once the store saturates nobody new is
        // seated. The only account that can hit the 65th ejection is one that
        // was already seated when saturation arrived.
        let victim = acct(200);
        o.register_reporter(victim, 0).unwrap();
        for n in 0..MAX_REPORTER_RECORDS {
            o.reporter_records.push(ReporterRecord {
                account: acct(n as u8),
                offenses: OFFENSE_EJECTION_THRESHOLD,
                ejected: true,
            });
        }
        assert!(o.ejection_records_saturated());

        // That seat takes its third adjudicated-false finding.
        for _ in 0..OFFENSE_EJECTION_THRESHOLD {
            o.record_reporter_offense(victim).unwrap();
        }
        assert!(!o.is_reporter(&victim), "the seat is still released (G-1)");
        assert!(
            o.events
                .iter()
                .any(|e| matches!(e, Event::ReporterRecordsFull { who } if *who == victim)),
            "the dropped ban is loud, not silent"
        );
        assert!(
            !o.reporter_records.iter().any(|r| r.account == victim),
            "precondition: the ban really was dropped, so `carried` reads None"
        );

        // Before the fix this returned `Ok(())` and re-seated `victim` at full
        // stake with `offenses == 0`.
        assert_eq!(
            o.register_reporter(victim, 99),
            Err(Error::ReporterRecordsSaturated)
        );
        // Entry is closed for everyone while no ban can be recorded — an
        // untainted newcomer is refused too, because it is indistinguishable
        // from `victim` returning under a fresh key.
        assert_eq!(
            o.register_reporter(acct(201), 99),
            Err(Error::ReporterRecordsSaturated)
        );
        // Enlarging the store is the only escape, and it reopens entry.
        o.reporter_records.remove(0);
        assert!(!o.ejection_records_saturated());
        o.register_reporter(acct(201), 99).unwrap();
        o.try_state().unwrap();
    }

    #[test]
    fn record_store_evicts_the_least_severe_row_but_never_an_ejection() {
        let mut o = Oracle::default();
        // Fill entirely with ejections, then try to add one more.
        for n in 0..MAX_REPORTER_RECORDS {
            o.reporter_records.push(ReporterRecord {
                account: acct(n as u8),
                offenses: OFFENSE_EJECTION_THRESHOLD,
                ejected: true,
            });
        }
        assert!(
            !o.upsert_reporter_record(acct(200), 1, false),
            "a ban must never be evicted to make room"
        );
        assert_eq!(o.reporter_records.len(), MAX_REPORTER_RECORDS);
        assert!(o.reporter_records.iter().all(|r| r.ejected));

        // With one non-ejected row present, that row is the victim.
        let mut o = Oracle::default();
        o.reporter_records.push(ReporterRecord {
            account: acct(1),
            offenses: 1,
            ejected: false,
        });
        for n in 2..MAX_REPORTER_RECORDS + 1 {
            o.reporter_records.push(ReporterRecord {
                account: acct(n as u8),
                offenses: OFFENSE_EJECTION_THRESHOLD,
                ejected: true,
            });
        }
        o.reporter_records.truncate(MAX_REPORTER_RECORDS);
        assert!(o.upsert_reporter_record(acct(200), 2, false));
        assert!(!o.reporter_records.iter().any(|r| r.account == acct(1)));
        assert!(o.reporter_records.iter().any(|r| r.account == acct(200)));
    }

    #[test]
    fn try_state_rejects_a_round_whose_challenger_is_its_reporter() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        report!(
            o,
            acct(1),
            1,
            7,
            41,
            3,
            FixedU64(62),
            h(9),
            400_000_000_000,
            100,
            3
        )
        .unwrap();
        o.try_state().unwrap();
        o.rounds[0].challenger = Some(acct(1));
        assert_eq!(o.try_state(), Err(Error::SelfChallenge));
    }

    #[test]
    fn try_state_rejects_a_record_that_shadows_a_live_seat() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.try_state().unwrap();
        o.reporter_records.push(ReporterRecord {
            account: acct(1),
            offenses: 1,
            ejected: false,
        });
        assert_eq!(o.try_state(), Err(Error::AlreadyRegistered));
    }

    #[test]
    fn try_state_rejects_a_duplicate_or_understrength_ejection_record() {
        let mut o = Oracle::default();
        o.reporter_records.push(ReporterRecord {
            account: acct(1),
            offenses: 1,
            ejected: false,
        });
        o.reporter_records.push(ReporterRecord {
            account: acct(1),
            offenses: 1,
            ejected: false,
        });
        assert_eq!(o.try_state(), Err(Error::AlreadyRegistered));

        let mut o = Oracle::default();
        o.reporter_records.push(ReporterRecord {
            account: acct(1),
            offenses: 1,
            ejected: true,
        });
        assert_eq!(o.try_state(), Err(Error::ReporterEjected));
    }

    #[test]
    fn try_state_rejects_a_seated_reporter_at_the_ejection_threshold() {
        let mut o = Oracle::default();
        o.register_reporter(acct(1), 0).unwrap();
        o.try_state().unwrap();
        if let Some((_, info)) = o.reporters.iter_mut().find(|(a, _)| *a == acct(1)) {
            info.offenses = OFFENSE_EJECTION_THRESHOLD;
        }
        assert_eq!(o.try_state(), Err(Error::ReporterEjected));
    }
}
