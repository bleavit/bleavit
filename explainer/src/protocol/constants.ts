/**
 * Kernel constants — doc 13 §2, mirroring `futarchy_primitives::kernel`.
 *
 * These are compile-time constants exposed through the runtime's constants API.
 * They are not governable: changing one requires a Wasm upgrade. That is what
 * separates them from the doc 13 §1 registry in `params.ts`, whose values a
 * passed proposal can amend within bounds.
 */

import { cite } from './citations';
import { USDC, VIT } from './units';

const K = (at: string, note?: string) => cite('13', at, note);

export const KERNEL_CITATION = K('§2', 'kernel constants, compile-time');

// --- Time ------------------------------------------------------------------

export const MILLISECS_PER_BLOCK = 6_000;
export const BLOCKS_PER_DAY = 14_400;
export const BLOCKS_PER_HOUR = 600;

/** Epoch length must be a multiple of 21 so every phase boundary is exact. */
export const EPOCH_PHASE_DENOMINATOR = 21;
export const PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS = 201_600; // 14 days
export const PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS = 604_800; // 42 days

/** One shared extension budget per proposal: +3 days, at most once. */
export const DEC_EXTENSION_BLOCKS = 43_200;
/** A rerun raises the hurdle by one percentage point. */
export const RERUN_HURDLE_BUMP = 0.01;

// --- Markets ---------------------------------------------------------------

/** `|q_L − q_S| / b ≤ 48`. A trade crossing it must fail `PriceBoundExceeded`. */
export const LMSR_DOMAIN_BOUND = 48;
/** Practical quoting clamp, doc 13 §2. */
export const QUOTE_CLAMP_MIN = 0.001;
export const QUOTE_CLAMP_MAX = 0.999;
/** Welfare (scalar) books only. Gate books are exempt — they legitimately trade near 0. */
export const DECISION_SANITY_MIN = 0.02;
export const DECISION_SANITY_MAX = 0.98;

export const MIN_TRADE_USDC = 1 * USDC;
/** Per-extrinsic cap: `b/4`, i.e. a single trade moves the logit by ≤ 0.25. */
export const MAX_TRADE_RATIO = 1 / 4;

/** An observation gap wider than this inside the decision window is a stale event. */
export const MKT_STALE_GAP_BLOCKS = 50;

// --- Ledger ----------------------------------------------------------------

export const MIN_SPLIT_USDC = 10_000; // 0.01 USDC
export const MIN_TRANSFER_USDC = 10_000;
export const POSITION_DEPOSIT_USDC = 100_000; // 0.1 USDC per position entry
export const MAX_POSITIONS_PER_ACCOUNT = 64;
export const MAX_ARCHIVE_DELAY_BLOCKS = 5_256_000; // one year, a hard ceiling

/** A voided vault settles the epoch Baseline neutrally at exactly one half. */
export const VOID_BASELINE_SCORE = 0.5;

// --- Decision --------------------------------------------------------------

/** `3 · InCapPrize ≤ AttackCost̂` — the security-sizing safety factor (D-4). */
export const SECURITY_FACTOR = 3;
export const DECISION_WINDOW_FLOOR_BLOCKS = 14_400;
export const DECISION_DELTA_FLOOR = 0.005;
export const GATE_P_MAX_CEILING = 0.10;
export const GATE_EPS_FLOOR = 0.005;

// --- Welfare ---------------------------------------------------------------

/** Entrenched genesis floors: no track and no supermajority may go below these. */
export const THETA_S_LO_FLOOR = 0.90;
export const THETA_C_LO_FLOOR = 0.85;
/**
 * Retained welfare snapshot **epochs** — doc 13 §4's "≤ 20 epochs". Doc 05 §4.6
 * prunes at `current − 19`, so the window is 19 historical epochs plus one free
 * slot for the settling epoch's own record.
 */
export const SNAPSHOT_RETENTION_EPOCHS = 20;
/**
 * MetricSpec versions that can consume one measurement epoch: the kernel
 * ceiling of `epoch.horizon_k` (doc 05 §3.3). Cohorts freeze their version at
 * qualification, so an activation boundary leaves adjacent cohorts on different
 * ones.
 */
export const MAX_CONCURRENT_FROZEN_VERSIONS = 2;
/**
 * Retained snapshot **records** (`welfare_core::MAX_SNAPSHOTS`). Snapshots are
 * keyed `(epoch, spec_version)` and capacity counts records, so the epoch bound
 * has to carry that version multiplicity to mean the same thing: each retained
 * epoch can need one record per cohort measuring it, plus one for its own
 * active spec — which need not be either of theirs. Contract v16 moved it
 * 20 → 60; at a flat 20 the eviction rule and the capacity rule disagreed at
 * every activation boundary.
 */
export const MAX_SNAPSHOTS =
  SNAPSHOT_RETENTION_EPOCHS * (MAX_CONCURRENT_FROZEN_VERSIONS + 1);
export const MAX_METRIC_SPECS = 16;
export const HISTORY_PRIORS = 12;
/** ε floors inside the weighted geometric means. */
export const EPSILON_C = 0.01;
export const EPSILON_P = 0.01;
export const EPSILON_W = 1e-9;

// --- Execution guard -------------------------------------------------------

export const EXECUTION_TIMELOCK_FLOOR_BLOCKS = 14_400; // 24 h
export const EXECUTION_GRACE_FLOOR_BLOCKS = 100_800; // 7 days
export const EXECUTION_RETRY_WINDOW_BLOCKS = 43_200; // 72 h after a payload revert
/** A runtime upgrade cannot be applied until 72 h after authorization (D-14). */
export const DESCRIPTOR_LEAD_TIME_BLOCKS = 43_200;
export const MIGRATION_STALL_BLOCKS = 900;
export const PROP_MAX_CALLS = 16;
export const PROP_MAX_BYTES = 65_536;
export const MAX_NESTED_LEVELS = 4;
export const MAX_NESTED_CALLS = 16;
export const MAX_PAYLOAD_DECODE_DEPTH = 256;
/** A queued item older than this is force-rejected on the next tick. */
export const STALE_EPOCH_BOUND_BLOCKS = 100_800; // 7 days

// --- Dead-man switch -------------------------------------------------------

/**
 * Two independent triggers. The relay-parent gap is the observable one: doc 05
 * §4.8 was re-scoped to it because the relay's finalized head is not visible to
 * a parachain runtime on stable2606 (SQ-282).
 */
export const DEAD_MAN_RELAY_BLOCKS = 4_800; // ~8 h of relay advance with no anchored block
export const DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS = 57_600; // 4 days

// --- Oracle and registry ---------------------------------------------------

export const ORC_WINDOW_BLOCKS = 43_200; // 72 h challenge window, frozen by D-18
export const ORC_REPORT_WINDOW_BLOCKS = 28_800;
export const ORC_RETENTION_BLOCKS = 115_200;
export const ORC_ROUNDS_MIN = 2;
export const ORC_ROUNDS_MAX = 4;
export const ORC_REPORTERS_MIN = 3;
export const ORC_MAX_PROOF_BYTES = 262_144;
/** One +48 h extension per (component, epoch) when watchtower quorum is missing. */
export const WATCHTOWER_EXTENSION_BLOCKS = 28_800;
export const WT_MAX = 16;
export const WT_QUORUM = 2;
export const ATT_MIN_MEMBERS = 3;
export const ATT_QUORUM = 2;
export const REG_MAX_FILINGS_EPOCH = 64;

// --- Guardian --------------------------------------------------------------

export const GUARDIAN_MEMBERS = 7;
export const GUARDIAN_APPROVAL_THRESHOLD = 5;
export const GUARDIAN_BOND_VIT = 50_000 * VIT;
export const PLAYBOOK_FREEZE_WINDOW_BLOCKS = 201_600; // 14 days
export const PB_LEDGER_FREEZE_RENEWALS = 1;

// --- Crank batches ---------------------------------------------------------

export const TICK_BATCH = 10;
export const REAP_BATCH = 100;
export const SETTLE_COHORT_MAX_ITEMS = 100;
export const ORACLE_DEADLINE_CATCHUP = 4;

// --- Storage bounds --------------------------------------------------------

export const INTAKE_QUEUE = 64;
export const MAX_LIVE_PROPOSALS = 32;
export const BOOKS_PER_PROPOSAL = 6;
export const MAX_LIVE_MARKETS = 196;
export const MAX_NON_TERMINAL_COHORTS = 4;
export const RECENT_COHORT_SUMMARIES = 32;
export const MAX_TWAP_WINDOWS_PER_MARKET = 8;
export const MAX_INTAKE_PER_ACCOUNT = 4;

// --- The hosted question service (doc 13 §2, §4; D-20) ---------------------

/**
 * Question ids at or above this belong to the service domain; below it, to
 * Bleavit's own. The split is the id itself rather than a flag, so a
 * mis-addressed call cannot silently land in the wrong ledger — it fails
 * against a vault map that has never heard of that id.
 *
 * `2 ** 63` is exactly representable as a double (it is a power of two), so a
 * `>=` test against it is exact. It is **not** a safe integer, so nothing may
 * do arithmetic on it or on an id near it in `number` — compare, never compute.
 */
export const SERVICE_ID_BASE = 2 ** 63;

/**
 * The floor under what a hosted question may be sold for, in whole USDC.
 *
 * Anchored to fully-allocated cost rather than to marginal cost, and the
 * distinction is the whole argument: cranking one question costs about 15 USDC
 * in keeper fees, but the slot is scarce by construction — `svc.max_live` is
 * set by how much of the chain external traffic may occupy, not by demand — and
 * pricing a scarce slot at marginal cost prices it at roughly zero.
 */
export const SVC_FEE_FLOOR_USDC = 393;

/** The fewest attestors a client may name to settle its question. */
export const SVC_ATTESTORS_MIN = 3;

/** The widest tolerance a client may set before an attestor's report is out. */
export const SVC_TOLERANCE_MAX = 0.25;

/** Compile-time ceilings on the service's storage (doc 13 §4). */
export const MAX_CLIENTS = 64;
export const MAX_SERVICE_ATTESTORS = 16;
/** One immutable record per external question; reuses the client ceiling. */
export const MAX_EXTERNAL_BOOK_PAIRS = MAX_CLIENTS;
/** Two books per question, so twice the pair ceiling. */
export const MAX_LIVE_EXTERNAL_MARKETS = MAX_EXTERNAL_BOOK_PAIRS * 2;

// --- Chain identity --------------------------------------------------------

export const SS58_PREFIX = 7777;
export const USDC_DECIMALS = 6;
export const VIT_DECIMALS = 12;
export const INTEGRATION_CONTRACT_VERSION = 30;

/**
 * Phase-start offsets as fractions of `epoch.length` — the single most
 * structural fact about Bleavit's clock, and the reason this app's signature
 * element is a 21-tick ring. `futarchy_primitives::phase_offsets`, doc 13 §3.1.
 *
 * Review and Execute are per-proposal and per-class: they carry no fixed
 * fraction, so they are deliberately absent here.
 */
export const PHASE_OFFSET_NUMERATORS = Object.freeze({
  Intake: 0,
  Qualify: 3,
  Seed: 4,
  Trade: 5,
  /** Decision-window accrual start: the final 72 h; trailing is the final 24 h. */
  DecideWindow: 15,
  Decide: 18,
  Housekeeping: 20,
} as const);

export type PhaseOffsetName = keyof typeof PHASE_OFFSET_NUMERATORS;

export const PHASE_OFFSETS_ORDERED: readonly (readonly [PhaseOffsetName, number])[] =
  Object.freeze(
    (Object.keys(PHASE_OFFSET_NUMERATORS) as PhaseOffsetName[]).map(
      (k) => [k, PHASE_OFFSET_NUMERATORS[k]] as const,
    ),
  );

/** Kernel constants worth surfacing in the UI, with their citations. */
export const KERNEL_FACTS = Object.freeze([
  { name: 'Block time', value: '6 s', cite: K('§0') },
  { name: 'Blocks per day', value: '14,400', cite: K('§0') },
  { name: 'Epoch phase denominator', value: '21', cite: K('§3.1') },
  { name: 'LMSR domain bound', value: '|q_L − q_S| / b ≤ 48', cite: K('§2') },
  { name: 'Max single trade', value: 'b / 4', cite: K('§2', 'logit impact ≤ 0.25') },
  { name: 'Worst-case maker loss', value: 'b · ln 2', cite: cite('04', '§6') },
  { name: 'Security factor', value: '3 · InCapPrize ≤ AttackCost̂', cite: cite('05', '§5.6') },
  { name: 'Dead-man relay gap', value: '4,800 relay blocks (~8 h)', cite: K('§2') },
  { name: 'Descriptor lead time', value: '43,200 blocks (72 h)', cite: cite('09', '§2.2') },
  { name: 'Oracle challenge window', value: '43,200 blocks (72 h)', cite: cite('07', '§5') },
] as const);
