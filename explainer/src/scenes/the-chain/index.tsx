import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { LegendEntry, SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import {
  BLOCKS_PER_HOUR,
  MAX_NESTED_CALLS,
  MAX_NESTED_LEVELS,
  MILLISECS_PER_BLOCK,
} from '../../protocol/constants';
import { derived, spec } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './the-chain.css';

/**
 * Scene 01 — what makes Bleavit a chain at all, before it is a futarchy.
 *
 * Every other scene in this app assumes a machine that produces blocks, keeps
 * money, and cannot be quietly rewritten. This one has to earn that assumption
 * for a reader who has never used a blockchain, and it has to do it without the
 * three words the rest of the app leans on — parachain, runtime, weight.
 *
 * The teaching order is deliberate and is *not* the order a Substrate engineer
 * would choose. It goes: who checks the work (the relay chain), who does the
 * work (the collators), what the work costs (two budgets), what nobody may do
 * (the filter), and only last what the machine is made of (the pallet list).
 * A reader who stops after the second drawer still knows the thing that
 * matters, and the parts list — which is the first thing a runtime engineer
 * reaches for — is last precisely because it explains nothing on its own.
 *
 * ## Why the canvas is a block and not a topology diagram
 *
 * The obvious picture for this scene is boxes and arrows: relay chain on top,
 * parachain below, collators feeding validators. That picture is in doc 01 §4.3
 * already, and it is a picture of *nouns*. It teaches the words and none of the
 * consequences, and a reader can nod along to it while still believing a block
 * is full when it has run out of time.
 *
 * So the canvas draws one block as a **two-dimensional container**. Sideways is
 * proof — the receipts a block must carry so a validator that holds none of
 * Bleavit's data can re-run it. Upwards is computing time. Every call spends
 * both, the block ends when *either* runs out, and the picture shows the two
 * walls arriving at very different moments: the same trade fills the proof wall
 * at 93 copies and the time wall only at 204. That relation — two independent
 * ceilings, either of which is final — is the one thing a table of two columns
 * genuinely cannot show, because a table invites you to read down one column.
 *
 * ## Where the numbers come from
 *
 * Nothing here is transcribed. The three fill ceilings the runtime pins in
 * `pov_budgets.rs` — 93 per block, 70 on the primary reservation, 23 on the
 * external one — are **recomputed** in this module from the generated `buy`
 * weight and the block limits, and the test asserts all three against the
 * runtime's own constants. That is the property worth having: a weight
 * regeneration that moves the ceiling breaks this scene's test rather than
 * leaving it quietly wrong.
 *
 * Recomputing rather than transcribing is also what found a defect in the
 * specification. Doc 13 §5 stated the normal-class proof budget as 3,932,160 B
 * and derived `decide` = 19.0 % from it. The runtime's own pinned ceilings are
 * not reachable from that number: `MAX_TRADED_EVENTS_PER_BLOCK` = 93 and its
 * primary share 70 need a 10 MiB `MAX_POV_SIZE`, and against 3,932,160 B the
 * same arithmetic yields 46 and 35. The divisor turned out to be the normal
 * class's **`BlockLength`** ceiling — a bound on how long an extrinsic may be,
 * not on how much proof running it generates. Doc 13 §5 was corrected on
 * 2026-08-09 to 7,864,320 B, so this scene and the specification now agree, and
 * the drawer keeps the story because the two budgets are worth telling apart.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const C_SECURITY: Citation = cite(
  '01',
  '§4.1',
  'full shared security — relay validators execute and finalize parachain blocks',
);
const C_BLOCKTIME: Citation = cite('01', '§4.1', '6-second parachain blocks (async backing)');
const C_ROLES: Citation = cite(
  '01',
  '§4.2',
  'collator counts; collator concentration feeds the Security pillar',
);
const C_PALLETMAP: Citation = cite('01', '§5.1', 'the pallet map');
const C_NOBODY: Citation = cite(
  '06',
  '§3.2',
  'the "nobody" row — filtered from genesis, all origins including sudo (D-13)',
);
const C_WRAPPERS: Citation = cite(
  '06',
  '§3.3',
  'BaseCallFilter, the closed wrapper set and G-5',
);
const C_NESTING: Citation = cite('13', '§2', 'MAX_NESTED_LEVELS and MAX_NESTED_CALLS');
const C_POV: Citation = cite(
  '13',
  '§5',
  'per-call PoV stays bounded regardless of the retained-map ceiling',
);

const C_NODE: Citation = cite(
  'code',
  'node/bleavit-node/src/main.rs',
  'a thin branding of the polkadot-omni-node stack; the node embeds no runtime',
);
const C_RUNTIME: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/lib.rs',
  'construct_runtime! — the frozen pallet indices',
);
const C_SESSION: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/configs.rs',
  'Period, MaxCandidates, MaxInvulnerables, KickThreshold',
);
const C_LIMITS: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/configs.rs',
  'MAXIMUM_BLOCK_WEIGHT and NORMAL_DISPATCH_RATIO',
);
const C_CEILING: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/pov_budgets.rs',
  'MAX_TRADED_EVENTS_PER_BLOCK — 93 = 70 primary + 23 external',
);
const C_WEIGHTS: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/weights/',
  'the generated per-call weights',
);
const C_CLASSIFIER: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/classifier.rs',
  'the calls this runtime projects to CallDomain::Nobody',
);

// ---------------------------------------------------------------------------
// The two budgets
// ---------------------------------------------------------------------------

/** Weight's `ref_time` is counted in picoseconds. */
const PS_PER_SECOND = 1_000_000_000_000;

/**
 * `MAXIMUM_BLOCK_WEIGHT` — two seconds of execution, and one whole PoV.
 *
 * The proof half is the relay's `MAX_POV_SIZE`, which the pinned
 * `polkadot-primitives` fixes at 10 MiB. It is written as `10 * 1024 * 1024`
 * rather than as a literal so the arithmetic below reads as the derivation it
 * is.
 */
const BLOCK_REF_TIME_PS = 2 * PS_PER_SECOND;
const BLOCK_PROOF_BYTES = 10 * 1024 * 1024;

/**
 * The 75 / 25 resource partition.
 *
 * `NORMAL_DISPATCH_RATIO` is 75 %, and the runtime reserves the remaining
 * quarter for the external (hosted-question) client domain. Both shares are
 * exact at this block size, so no rounding rule is needed.
 */
const NORMAL_RATIO = 0.75;
const PRIMARY_PROOF_BYTES = BLOCK_PROOF_BYTES * NORMAL_RATIO;
const EXTERNAL_PROOF_BYTES = BLOCK_PROOF_BYTES - PRIMARY_PROOF_BYTES;

/** `RocksDbWeight`, which this runtime binds: 25 µs a read, 100 µs a write. */
const DB_READ_PS = 25_000_000;
const DB_WRITE_PS = 100_000_000;

/**
 * One call's declared cost, in the two currencies, as the generated weight file
 * writes it: a fixed `ref_time` term, a count of storage reads and writes, and
 * an estimated proof size.
 *
 * Kept in components rather than as totals because that is the only form in
 * which the numbers can be *checked*: the runtime pins the dispatched proof of
 * `decide` and `settle_cohort(5)`, and those pins are sums of two of these
 * records. A scene that stored the totals could not notice if one addend moved.
 */
interface CallCost {
  /** The generated `Weight::from_parts` ref_time term, in picoseconds. */
  readonly refTime: number;
  readonly reads: number;
  readonly writes: number;
  /** The generated `Estimated:` proof size, in bytes. */
  readonly proof: number;
}

const add = (a: CallCost, b: CallCost): CallCost => ({
  refTime: a.refTime + b.refTime,
  reads: a.reads + b.reads,
  writes: a.writes + b.writes,
  proof: a.proof + b.proof,
});

/** What `CheckWeight` books: the fixed term plus the database access it declares. */
const totalRefTime = (c: CallCost): number =>
  c.refTime + c.reads * DB_READ_PS + c.writes * DB_WRITE_PS;

/** How many of this call fit in a budget before that budget is gone. */
const fitsByProof = (c: CallCost, budget: number): number => Math.floor(budget / c.proof);
const fitsByRefTime = (c: CallCost, budget: number): number =>
  Math.floor(budget / totalRefTime(c));

/**
 * `market.buy` — the only call in this scene an ordinary person makes, and the
 * one the runtime pins a per-block ceiling for.
 *
 * The dispatched weight is not the generated function: `#[pallet::weight]` adds
 * two reads and an explicit proof surcharge for the external routing path, and
 * a derivation that skipped them would read a number the chain does not charge.
 */
const BUY_EXTERNAL_ROUTE_SURCHARGE = 496 + 2_560;
export const BUY: CallCost = {
  refTime: 1_119_260_000,
  reads: 76 + 2,
  writes: 67,
  proof: 108_804 + BUY_EXTERNAL_ROUTE_SURCHARGE,
};

/** `epoch.decide`, as generated. */
const DECIDE: CallCost = { refTime: 4_051_826_000, reads: 656, writes: 136, proof: 356_514 };

/** `epoch.settle_cohort(n)` evaluated at the five-proposal batch doc 13 §5 names. */
const SETTLE_BATCH = 5;
const SETTLE_COHORT: CallCost = {
  refTime: 3_983_251_567 + SETTLE_BATCH * 368_803_527,
  reads: 923 + SETTLE_BATCH * 34,
  writes: 805 + SETTLE_BATCH * 52,
  proof: 185_135 + SETTLE_BATCH * 30_754,
};

/**
 * The collator-compensation payout both epoch cranks compose into their own
 * weight, and the reason each of them declares roughly 389 KB of proof it
 * almost never uses: the estimator charges each of 120 payees as an independent
 * maximum-depth trie path, where the recorded proof was 17,874 B.
 *
 * Over-declaring costs block capacity; under-declaring produces a block that
 * exceeds its proof budget at execution. Only one of those is recoverable.
 */
const COLLATOR_COMPENSATION: CallCost = {
  refTime: 4_347_547_000,
  reads: 258,
  writes: 249,
  proof: 389_037,
};

/** What the chain actually charges for the two epoch cranks. */
export const DECIDE_DISPATCHED = add(DECIDE, COLLATOR_COMPENSATION);
export const SETTLE_COHORT_DISPATCHED = add(SETTLE_COHORT, COLLATOR_COMPENSATION);

/** The three fill ceilings the runtime pins. Recomputed, never transcribed. */
export const TRADES_PER_BLOCK = fitsByProof(BUY, BLOCK_PROOF_BYTES);
export const TRADES_PRIMARY = fitsByProof(BUY, PRIMARY_PROOF_BYTES);
export const TRADES_EXTERNAL = fitsByProof(BUY, EXTERNAL_PROOF_BYTES);
/** What the computing-time budget alone would have allowed. */
export const TRADES_BY_TIME = fitsByRefTime(BUY, BLOCK_REF_TIME_PS);

// ---------------------------------------------------------------------------
// Who makes the blocks
// ---------------------------------------------------------------------------

/**
 * `Period` — one session, in blocks. Six hours, written as the runtime writes
 * it, so a change to the block time moves it here too.
 */
export const SESSION_BLOCKS = 6 * BLOCKS_PER_HOUR;
const SESSION_HOURS = 6;
const MAX_CANDIDATES = 100;
const MAX_INVULNERABLES = 20;

// ---------------------------------------------------------------------------
// What the chain is made of
// ---------------------------------------------------------------------------

interface PalletRow {
  readonly index: number;
  readonly name: string;
  readonly what: string;
  /** Present only while the founding key exists; gone at the Phase 3→4 upgrade. */
  readonly bootstrapOnly?: boolean | undefined;
}

interface PalletGroup {
  readonly id: string;
  readonly title: string;
  /** Why these belong together, in one clause. */
  readonly plain: string;
  readonly rows: readonly PalletRow[];
}

/**
 * The runtime's own `construct_runtime!`, grouped exactly as the macro groups
 * it — the blank lines in that file are the author's own taxonomy, and
 * regrouping them here would invent a second one.
 */
export const PALLET_GROUPS: readonly PalletGroup[] = [
  {
    id: 'system',
    title: 'The chain itself',
    plain: 'Blocks, the clock, and the wiring that makes this a Polkadot chain.',
    rows: [
      { index: 0, name: 'System', what: 'Blocks, accounts, the runtime code itself.' },
      { index: 1, name: 'Timestamp', what: 'The wall clock. Never used to decide anything.' },
      {
        index: 2,
        name: 'ParachainSystem',
        what: 'Talks to the relay chain: hands up each block and takes back its verdict.',
      },
      { index: 3, name: 'ParachainInfo', what: 'Remembers which parachain this is.' },
    ],
  },
  {
    id: 'money',
    title: 'Money',
    plain: 'The native token, the dollars from next door, and how fees are paid.',
    rows: [
      { index: 10, name: 'Balances', what: 'VIT — the token used for bonds and voting weight.' },
      { index: 11, name: 'ForeignAssets', what: 'USDC, which is issued elsewhere and held here as a claim.' },
      { index: 12, name: 'TransactionPayment', what: 'Charges for a call before it runs.' },
      { index: 13, name: 'AssetTxPayment', what: 'Lets that charge be paid in dollars instead of VIT.' },
      { index: 14, name: 'Vesting', what: 'Founding tokens that unlock on a schedule.' },
    ],
  },
  {
    id: 'governance',
    title: 'Voting plumbing',
    plain: 'Standard Polkadot governance parts. Bleavit uses them for the few things it votes on.',
    rows: [
      { index: 20, name: 'Referenda', what: 'Runs the votes.' },
      { index: 21, name: 'ConvictionVoting', what: 'Lets a voter lock tokens longer for more weight.' },
      { index: 22, name: 'Preimage', what: 'Stores the actual bytes a proposal commits to.' },
      { index: 23, name: 'Scheduler', what: 'Runs a passed vote later, at the block it was scheduled for.' },
      { index: 24, name: 'Utility', what: 'Batches several calls into one.' },
      { index: 25, name: 'Proxy', what: 'Lets one account act for another, within limits.' },
      { index: 26, name: 'Multisig', what: 'Needs several signatures before a call runs.' },
      { index: 27, name: 'Migrations', what: 'Reshapes stored data across an upgrade, a piece per block.' },
      {
        index: 28,
        name: 'Sudo',
        what: 'The founding key. It exists only until launch is finished, and it cannot reach the forbidden list either.',
        bootstrapOnly: true,
      },
    ],
  },
  {
    id: 'messaging',
    title: 'Talking to other chains',
    plain: 'Queues in and out. A message is a short program, and this chain decides how much of it to run.',
    rows: [
      { index: 30, name: 'XcmpQueue', what: 'Messages to and from sibling chains.' },
      { index: 31, name: 'MessageQueue', what: 'The shared queue those messages wait in.' },
      { index: 32, name: 'CumulusXcm', what: 'Messages coming down from the relay chain.' },
      { index: 33, name: 'PolkadotXcm', what: 'Sending messages out, on the short list of things allowed out.' },
    ],
  },
  {
    id: 'authoring',
    title: 'Making blocks',
    plain: 'Who is allowed to author, whose turn it is, and how the set is refreshed.',
    rows: [
      { index: 40, name: 'Authorship', what: 'Records who authored this block.' },
      { index: 41, name: 'CollatorSelection', what: 'Keeps the candidate list, takes their bonds, drops the idle ones.' },
      { index: 42, name: 'Session', what: 'Rotates the authoring set every six hours.' },
      { index: 43, name: 'Aura', what: 'Hands each author a turn, in a fixed rotation.' },
      { index: 44, name: 'AuraExt', what: 'The parachain half of that, so the relay can check the turn.' },
    ],
  },
  {
    id: 'bleavit',
    title: 'Bleavit’s own',
    plain: 'Everything above exists on other chains too. These do not.',
    rows: [
      { index: 50, name: 'Origins', what: 'The named kinds of authority, and nothing above them.' },
      { index: 51, name: 'Constitution', what: 'Every tunable number, with its bounds and its cooling-off period.' },
      { index: 52, name: 'ConditionalLedger', what: 'Holds the money while a question is open.' },
      { index: 53, name: 'Market', what: 'The betting books and their prices.' },
      { index: 54, name: 'Welfare', what: 'Measures how well things actually went.' },
      { index: 55, name: 'Oracle', what: 'Bonded reports about the world, and the challenges to them.' },
      { index: 56, name: 'IncidentRegistry', what: 'Filings that something went wrong.' },
      { index: 57, name: 'MilestoneRegistry', what: 'Filings that something was delivered.' },
      { index: 58, name: 'FutarchyTreasury', what: 'The money the chain owns and what it may pay out.' },
      { index: 59, name: 'Guardian', what: 'A seven-seat council with a short list of buttons.' },
      { index: 60, name: 'Attestor', what: 'A small bonded group that signs off on code before it runs.' },
      { index: 61, name: 'Epoch', what: 'The 21-day clock and the decision engine.' },
      { index: 62, name: 'ExecutionGuard', what: 'Re-checks every condition at the moment of execution.' },
      { index: 63, name: 'InflowCaps', what: 'Caps how much real money can come in during launch.' },
      { index: 64, name: 'TrackOrigins', what: 'The scoped authorities the voting tracks produce.' },
      { index: 65, name: 'ClientRegistry', what: 'Which outside chains may buy a question.' },
      { index: 66, name: 'QuestionService', what: 'Questions asked and paid for from outside.' },
      { index: 67, name: 'ServiceLedger', what: 'A second copy of the escrow, holding only outsiders’ money.' },
    ],
  },
];

export const PALLET_COUNT = PALLET_GROUPS.reduce((n, g) => n + g.rows.length, 0);
export const BLEAVIT_PALLET_COUNT =
  PALLET_GROUPS.find((g) => g.id === 'bleavit')?.rows.length ?? 0;

/** The frozen custom slots. Never renumbered, whatever else changes. */
const FROZEN_FIRST = 61;
const FROZEN_LAST = 67;

// ---------------------------------------------------------------------------
// The list nobody may reach
// ---------------------------------------------------------------------------

interface DeniedFamily {
  readonly id: string;
  /** What it would let somebody do, in plain words. */
  readonly effect: string;
  readonly calls: readonly string[];
  /** The failure this denial prevents. */
  readonly because: string;
}

/**
 * Calls this runtime projects to `CallDomain::Nobody`.
 *
 * The domain is checked *before* the origin is: the filter answers "nobody"
 * without ever asking who is calling, which is what makes the row identical for
 * a stranger, for a passed vote, and for the founding key.
 */
export const DENIED_FAMILIES: readonly DeniedFamily[] = [
  {
    id: 'storage',
    effect: 'Write straight into the chain’s memory',
    calls: ['system.set_storage', 'system.kill_storage', 'system.kill_prefix'],
    because:
      'Every balance and every escrow is a value in that memory. A hand that can set it directly can create money nobody paid in.',
  },
  {
    id: 'code',
    effect: 'Swap the chain’s program in one move',
    calls: [
      'system.set_code',
      'system.set_code_without_checks',
      'system.authorize_upgrade_without_checks',
    ],
    because:
      'New code can do anything, including undo the rules that were meant to stop it. The only way in is the two-step path, which announces itself first.',
  },
  {
    id: 'balances',
    effect: 'Move or conjure somebody else’s VIT',
    calls: [
      'balances.force_transfer',
      'balances.force_unreserve',
      'balances.force_set_balance',
      'balances.force_adjust_total_issuance',
    ],
    because:
      'VIT is voting weight and it is bond collateral. Minting it quietly buys both a majority and every role that needs a stake.',
  },
  {
    id: 'vesting',
    effect: 'Rewrite somebody else’s unlock schedule',
    calls: ['vesting.force_vested_transfer', 'vesting.force_remove_vesting_schedule'],
    because:
      'The founding allocation is locked for years on purpose. A call that shortens that lock cancels the promise it was made with.',
  },
  {
    id: 'assets',
    effect: 'Mint, burn or freeze the dollars',
    calls: [
      'foreignAssets.mint',
      'foreignAssets.burn',
      'foreignAssets.force_transfer',
      'foreignAssets.freeze',
      'foreignAssets.force_asset_status',
    ],
    because:
      'The dollars here are claims on dollars locked on another chain. Minting one that is not backed breaks the only thing backing them.',
  },
  {
    id: 'migrations',
    effect: 'Drive a half-finished data migration by hand',
    calls: [
      'migrations.force_set_cursor',
      'migrations.force_set_active_cursor',
      'migrations.force_onboard_mbms',
      'migrations.clear_historic',
    ],
    because:
      'A migration part-way through is the one moment stored data means two things at once. Nudging the cursor decides which — silently.',
  },
  {
    id: 'xcm',
    effect: 'Send an arbitrary instruction to another chain',
    calls: [
      'polkadotXcm.send',
      'polkadotXcm.execute',
      'polkadotXcm.teleport_assets',
      'parachainSystem.sudo_send_upward_message',
    ],
    because:
      'Bleavit holds accounts on other chains. A free-form message is a way to spend them without ever touching a rule enforced here.',
  },
  {
    id: 'impersonation',
    effect: 'Act as somebody else',
    calls: ['sudo.sudo_as'],
    because:
      'It runs a call signed as a chosen account — a victim, or the account the chain itself settles payouts from. Checking the inner call cannot fix an outer lie about who is asking.',
  },
];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The plotting box: sideways is proof, upwards is computing time. */
const PLOT_X = 2.4;
const PLOT_Y = 1.6;
const PLOT_W = 16.0;
const PLOT_H = 8.0;
/** Both walls are drawn with thickness so they read as barriers, not as axes. */
const WALL_THICKNESS = 0.45;
const CEILING_THICKNESS = 0.3;

const spentProofFraction = (TRADES_PER_BLOCK * BUY.proof) / BLOCK_PROOF_BYTES;
const spentTimeFraction = (TRADES_PER_BLOCK * totalRefTime(BUY)) / BLOCK_REF_TIME_PS;
const spentSeconds = (TRADES_PER_BLOCK * totalRefTime(BUY)) / PS_PER_SECOND;
const blockSeconds = BLOCK_REF_TIME_PS / PS_PER_SECOND;
const spareSeconds = blockSeconds - spentSeconds;

const SPENT_W = PLOT_W * spentProofFraction;
const SPENT_H = PLOT_H * spentTimeFraction;

const groups = (s: string): string => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const int = (v: number): string => groups(String(Math.round(v)));
const bytes = (v: number): string => `${groups(String(Math.round(v)))} B`;
const secs = (v: number): string => (Number.isInteger(v) ? `${v} s` : `${v.toFixed(2)} s`);
const ms = (v: number): string => `${(v / 1_000_000_000).toFixed(1)} ms`;
const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
const mib = (v: number): string => `${(v / (1024 * 1024)).toFixed(2)} MiB`;

/**
 * The scene model.
 *
 * The block is drawn as a box whose two sides are its two budgets, closed on
 * the right by the proof wall and on top by the time wall. Inside it, one
 * column: as wide as 93 trades' receipts and as tall as their computing time.
 * It touches the right-hand wall and stops less than halfway up the left one,
 * which is the whole argument of the scene in one shape.
 *
 * `sim.block` reaches the caption and nothing else. The capacity of a block is
 * a property of the runtime, not of a scenario, and pretending otherwise would
 * make a fixed fact look like a moving one.
 */
export function buildModel(sim: SimState): SceneModel {
  const nodes: SceneNode[] = [
    {
      id: 'spent',
      kind: 'stack',
      x: PLOT_X,
      y: PLOT_Y,
      w: SPENT_W,
      h: SPENT_H,
      tone: 'ink',
      state: 'active',
      label: `${TRADES_PER_BLOCK} trades`,
      sublabel: `${secs(spentSeconds)} of ${secs(blockSeconds)}`,
      domRowId: 'row-spent',
    },
    {
      id: 'unspent',
      kind: 'stack',
      x: PLOT_X,
      y: PLOT_Y + SPENT_H,
      w: SPENT_W,
      h: PLOT_H - SPENT_H,
      tone: 'dim',
      state: 'inactive',
      label: 'Never used',
      sublabel: `${secs(spareSeconds)} spare`,
      domRowId: 'row-unspent',
    },
    {
      id: 'wall-proof',
      kind: 'node',
      x: PLOT_X + PLOT_W,
      y: PLOT_Y,
      w: WALL_THICKNESS,
      h: PLOT_H,
      tone: 'ink',
      state: 'active',
      hatched: true,
      label: 'Proof wall',
      sublabel: `${TRADES_PER_BLOCK} trades`,
      domRowId: 'row-wall-proof',
    },
    {
      id: 'wall-time',
      kind: 'ceiling',
      x: PLOT_X,
      y: PLOT_Y + PLOT_H,
      w: PLOT_W,
      h: CEILING_THICKNESS,
      tone: 'ink',
      state: 'active',
      label: 'Time wall',
      sublabel: `${TRADES_BY_TIME} trades`,
      domRowId: 'row-wall-time',
    },
  ];

  const rules: SceneRule[] = [
    {
      id: 'proof-axis',
      axis: 'x',
      at: PLOT_Y,
      from: PLOT_X,
      to: PLOT_X + PLOT_W,
      tone: 'dim',
      ticks: [
        { at: PLOT_X, label: '0' },
        { at: PLOT_X + PLOT_W, label: mib(BLOCK_PROOF_BYTES) },
      ],
    },
    {
      id: 'time-axis',
      axis: 'y',
      at: PLOT_X,
      from: PLOT_Y,
      to: PLOT_Y + PLOT_H,
      tone: 'dim',
      ticks: [
        { at: PLOT_Y, label: '0' },
        { at: PLOT_Y + SPENT_H, label: secs(spentSeconds) },
        { at: PLOT_Y + PLOT_H, label: secs(blockSeconds) },
      ],
    },
  ];

  const legend: LegendEntry[] = [
    { mark: 'ink', shape: 'stack', label: 'What those trades actually cost' },
    { mark: 'dim', shape: 'stack', label: 'Computing time nothing spends' },
    { mark: 'hatch', label: 'A wall the block cannot cross' },
  ];

  return {
    nodes,
    rules,
    legend,
    caption: `One block of Bleavit — block ${int(sim.block)} — and the two limits it lives inside.`,
    relation:
      'Two budgets at right angles. Sideways is the evidence a block must carry so somebody who ' +
      'keeps none of this chain’s data can re-run it; upwards is the time it may spend computing. ' +
      'Every action costs some of both, and the block ends the moment either one runs out — not ' +
      'when the larger of the two does, and not when their sum does. The picture is what a ' +
      'two-column table cannot make you feel: the same trade, repeated, reaches the right-hand ' +
      'wall while the ceiling is still a long way off. Evidence is what fills a block up, and ' +
      'computing time is almost never what stops it.',
    unitLegend:
      `The solid column is ${TRADES_PER_BLOCK} trades — as many as fit. It is as wide as their ` +
      `receipts (${bytes(TRADES_PER_BLOCK * BUY.proof)}) and as tall as their computing time ` +
      `(${secs(spentSeconds)}). One trade on its own is ${bytes(BUY.proof)} of receipts and ` +
      `${ms(totalRefTime(BUY))} of work.`,
  };
}

// ---------------------------------------------------------------------------
// Rail panels
// ---------------------------------------------------------------------------

function BudgetPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">What actually fills a block up</h2>
      <p>
        A block has two limits, and they have nothing to do with each other. One is time: how long
        the chain may spend computing. The other is <strong>evidence</strong> — and it exists
        because the computers that check this chain do not keep a copy of it. They are handed the
        block plus a receipt for every single thing it looked up, and they redo the work from
        those receipts alone. Look up more, and the receipts get bigger.
      </p>
      <p>
        So the honest question is not &ldquo;how much can this chain compute&rdquo; but{' '}
        <strong>&ldquo;how much can it prove it looked at&rdquo;</strong>. Below is the same
        action — one trade — measured against both limits.
      </p>

      <table className="chain-table">
        <caption className="sr-only">
          The two per-block budgets, and how far the same call gets along each
        </caption>
        <thead>
          <tr>
            <th scope="col">Limit</th>
            <th scope="col" className="numeric">
              Size
            </th>
            <th scope="col">What it means here</th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-wall-proof">
            <th scope="row">Evidence a block may carry</th>
            <td className="numeric">
              <Value of={derived(BLOCK_PROOF_BYTES, C_LIMITS)} format={bytes} />
            </td>
            <td>
              Enough for <Value of={derived(TRADES_PER_BLOCK, C_CEILING)} /> trades. This is the
              one that runs out.
            </td>
          </tr>
          <tr id="row-wall-time">
            <th scope="row">Computing time a block may spend</th>
            <td className="numeric">
              <Value of={derived(blockSeconds, C_LIMITS)} format={secs} />
            </td>
            <td>
              Enough for <Value of={derived(TRADES_BY_TIME, C_LIMITS)} /> trades — more than twice
              as many. It never gets the chance.
            </td>
          </tr>
          <tr id="row-spent">
            <th scope="row">
              What <Value of={derived(TRADES_PER_BLOCK, C_CEILING)} /> trades cost
            </th>
            <td className="numeric">
              <Value of={derived(TRADES_PER_BLOCK * BUY.proof, C_WEIGHTS)} format={bytes} />
            </td>
            <td>
              <Value of={derived(spentProofFraction, C_WEIGHTS)} format={pct} /> of the evidence
              room, and <Value of={derived(spentSeconds, C_WEIGHTS)} format={secs} /> of the
              computing time.
            </td>
          </tr>
          <tr id="row-unspent">
            <th scope="row">Computing time left on the table</th>
            <td className="numeric">
              <Value of={derived(spareSeconds, C_WEIGHTS)} format={secs} />
            </td>
            <td>
              <Value of={derived(1 - spentTimeFraction, C_WEIGHTS)} format={pct} /> of the block&rsquo;s
              capacity to compute, which that block will never use.
            </td>
          </tr>
        </tbody>
      </table>

      <p className="panel__note">
        This is why the price tag on every action in this chain has two numbers on it rather than
        one, and why a table of &ldquo;how fast is it&rdquo; would be measuring the wrong thing (
        <span className="cite">{formatCitation(C_POV)}</span>).
      </p>
    </section>
  );
}

function CollatorPanel({ sim }: { sim: SimState }) {
  const session = Math.floor(sim.block / SESSION_BLOCKS);
  const intoSession = sim.block % SESSION_BLOCKS;

  return (
    <section className="panel">
      <h2 className="panel__title">Who makes the blocks, and who checks them</h2>
      <p>
        The machines that gather transactions and package them into blocks are called{' '}
        <Jargon word="collator" label="collators" />. They take turns: the rule is called{' '}
        <Jargon word="aura" />{' '}
        and it hands each of them one <Value of={spec(MILLISECS_PER_BLOCK / 1000, C_BLOCKTIME)} />
        -second slot in rotation.
      </p>
      <p>
        A collator cannot cheat, and that is the point of the arrangement rather than a claim about
        their character. Their block goes up to the{' '}
        <Jargon word="relay chain" />, where{' '}
        <Jargon word="validator" label="validators" /> run it again and compare answers. A block
        whose answer does not match is not accepted, so the worst a collator can do is stop
        working. That is also why Bleavit cannot rewrite its own history on its own — the record
        of what happened is held somewhere Bleavit does not control (
        <span className="cite">{formatCitation(C_SECURITY)}</span>).
      </p>

      <table className="chain-table">
        <caption className="sr-only">The collator set, as the runtime configures it</caption>
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-session">
            <th scope="row">
              A <Jargon word="session" /> lasts
            </th>
            <td className="numeric">
              <Value of={spec(SESSION_BLOCKS, C_SESSION)} format={int} /> blocks
            </td>
            <td>
              <Value of={spec(SESSION_HOURS, C_SESSION)} /> hours. The authoring list is fixed for
              that long, then recalculated.
            </td>
          </tr>
          <tr id="row-candidates">
            <th scope="row">Candidates at most</th>
            <td className="numeric">
              <Value of={spec(MAX_CANDIDATES, C_SESSION)} />
            </td>
            <td>
              How many bonded machines may be in the running at once. The list is bounded because
              an unbounded one is something an attacker can grow.
            </td>
          </tr>
          <tr id="row-invulnerables">
            <th scope="row">Guaranteed seats at most</th>
            <td className="numeric">
              <Value of={spec(MAX_INVULNERABLES, C_SESSION)} />
            </td>
            <td>
              Seats that keep authoring without competing for a place. Launch runs on a small
              number of them and opens candidacy later.
            </td>
          </tr>
          <tr id="row-kick">
            <th scope="row">Dropped after</th>
            <td className="numeric">
              <Value of={spec(SESSION_BLOCKS, C_SESSION)} format={int} /> blocks
            </td>
            <td>
              A collator that authored nothing for a whole session loses its place. Being present
              is not the same as working.
            </td>
          </tr>
        </tbody>
      </table>

      <p className="panel__note">
        This scenario sits at block <Value of={derived(sim.block, C_SESSION)} format={int} />, which
        is session <Value of={derived(session, C_SESSION)} format={int} />,{' '}
        <Value of={derived(intoSession, C_SESSION)} format={int} /> blocks in.
      </p>

      <h3>The same people the score is measuring</h3>
      <p>
        Two of the four things Bleavit scores itself on are about exactly these machines: how much
        of the time blocks were actually produced, and how evenly the work was spread between
        them. A chain that never missed a block but where two collators authored eighty per cent of
        it scores <strong>zero</strong> for the period — the concentration measure alone can do it
        (<span className="cite">{formatCitation(C_ROLES)}</span>). So the collator list is not
        background infrastructure here. It is one of the things the markets are betting on.
      </p>
    </section>
  );
}

function NodePanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The program, and the program that runs it</h2>
      <p>
        Two different things get confused constantly, so they are worth separating. The{' '}
        <Jargon word="runtime" /> is the rules: what a transaction does, what is forbidden, how
        money moves. The <em>node</em> is the plumbing: it talks to other machines, keeps the
        database, and asks the runtime what each block means.
      </p>
      <p>
        Bleavit&rsquo;s node is deliberately unremarkable. It is the standard Polkadot collator
        program with this project&rsquo;s name on it, and it{' '}
        <strong>contains no copy of the rules at all</strong> (
        <span className="cite">{formatCitation(C_NODE)}</span>). The rules travel separately, as{' '}
        <Jargon word="wasm" label="Wasm" /> inside the chain description an operator is given —
        which is what makes the rules something the chain can replace without asking anyone to
        install anything.
      </p>
      <p className="panel__note">
        The consequence worth keeping: upgrading Bleavit is not a software release that operators
        have to adopt. It is a value being replaced inside the chain&rsquo;s own storage, and the
        next scene is about how carefully that has to be done.
      </p>
    </section>
  );
}

function WeightPanel() {
  const rows: readonly {
    readonly id: string;
    readonly call: string;
    readonly plain: string;
    readonly cost: CallCost;
  }[] = [
    {
      id: 'buy',
      call: 'market.buy',
      plain: 'One trade on one book.',
      cost: BUY,
    },
    {
      id: 'decide',
      call: 'epoch.decide',
      plain: 'Settle one proposal’s fate: read its books, run every check, pay the collators.',
      cost: DECIDE_DISPATCHED,
    },
    {
      id: 'settle',
      call: `epoch.settle_cohort(${SETTLE_BATCH})`,
      plain: 'Pay out five decided proposals at once, once the period they were measured over is over.',
      cost: SETTLE_COHORT_DISPATCHED,
    },
  ];

  return (
    <section className="panel">
      <h2 className="panel__title">What a call costs, in two currencies</h2>
      <p>
        Every action declares its price before it runs, and the price has two parts:{' '}
        <Jargon word="weight" />&rsquo;s computing time, and its{' '}
        <Jargon word="proof size" />. The chain adds both up as it fills a block and stops at
        whichever runs out first.
      </p>

      <div className="chain-scroll">
        <table className="chain-table">
          <caption className="sr-only">
            Declared cost of three calls against the block&rsquo;s two budgets
          </caption>
          <thead>
            <tr>
              <th scope="col">Call</th>
              <th scope="col" className="numeric">
                Evidence
              </th>
              <th scope="col" className="numeric">
                Share
              </th>
              <th scope="col" className="numeric">
                Time
              </th>
              <th scope="col" className="numeric">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} id={`row-cost-${r.id}`}>
                <th scope="row">
                  <span className="chain-callname mono">{r.call}</span>
                  <span className="chain-plain">{r.plain}</span>
                </th>
                <td className="numeric">
                  <Value of={derived(r.cost.proof, C_WEIGHTS)} format={bytes} />
                </td>
                <td className="numeric">
                  <Value of={derived(r.cost.proof / BLOCK_PROOF_BYTES, C_WEIGHTS)} format={pct} />
                </td>
                <td className="numeric">
                  <Value of={derived(totalRefTime(r.cost), C_WEIGHTS)} format={ms} />
                </td>
                <td className="numeric">
                  <Value
                    of={derived(totalRefTime(r.cost) / BLOCK_REF_TIME_PS, C_WEIGHTS)}
                    format={pct}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="panel__note">
        Time here is the whole declared charge — the measured execution plus the database access
        each call declares, at{' '}
        <Value of={derived(DB_READ_PS / 1_000_000, C_WEIGHTS)} unit=" µs" /> a read and{' '}
        <Value of={derived(DB_WRITE_PS / 1_000_000, C_WEIGHTS)} unit=" µs" /> a write, which is
        what the chain actually books against the block.
      </p>

      <p>
        Read the two &ldquo;share&rdquo; columns against each other and you can see which limit
        would stop each call first, and it is <strong>not the same limit every time</strong>. A
        trade is caught by evidence long before time. The once-an-epoch payout crank is the other
        way round: it writes to hundreds of accounts, and writing is the expensive thing to do with
        time. That is exactly what having two independent budgets means — neither one is{' '}
        <em>the</em> limit, and a chain tuned against only one of them would be surprised by the
        other.
      </p>

      <h3>Where the block&rsquo;s evidence room goes</h3>
      <p>
        A quarter of the block is held back for questions bought from outside this chain, so a busy
        outside customer can never crowd out Bleavit&rsquo;s own business — and vice versa. The two
        shares are consumable in the same block, which is why they add up rather than capping each
        other.
      </p>
      <table className="chain-table">
        <caption className="sr-only">The block&rsquo;s evidence room, split in two</caption>
        <thead>
          <tr>
            <th scope="col">Reservation</th>
            <th scope="col" className="numeric">
              Evidence
            </th>
            <th scope="col" className="numeric">
              Trades
            </th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-partition-primary">
            <th scope="row">Bleavit&rsquo;s own business</th>
            <td className="numeric">
              <Value of={derived(PRIMARY_PROOF_BYTES, C_LIMITS)} format={bytes} />
            </td>
            <td className="numeric">
              <Value of={derived(TRADES_PRIMARY, C_CEILING)} />
            </td>
          </tr>
          <tr id="row-partition-external">
            <th scope="row">Questions bought from outside</th>
            <td className="numeric">
              <Value of={derived(EXTERNAL_PROOF_BYTES, C_LIMITS)} format={bytes} />
            </td>
            <td className="numeric">
              <Value of={derived(TRADES_EXTERNAL, C_CEILING)} />
            </td>
          </tr>
          <tr id="row-partition-total">
            <th scope="row">Both together</th>
            <td className="numeric">
              <Value of={derived(BLOCK_PROOF_BYTES, C_LIMITS)} format={bytes} />
            </td>
            <td className="numeric">
              <Value of={derived(TRADES_PER_BLOCK, C_CEILING)} />
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Two budgets that are easy to confuse, and once were</h3>
      <p className="panel__note">
        A block has a second ceiling that is <em>not</em> on this page: how many bytes the
        instructions themselves may occupy. That one is{' '}
        <span className="mono">3,932,160 B</span>. It is a limit on how <em>long</em> a request is,
        while everything above is a limit on how much <em>evidence</em> carrying it out produces.
        The two are enforced by different code and are not even shared out in the same proportions.
      </p>
      <p className="panel__note">
        They were confused. Doc 13 §5 divided a proof figure by the length ceiling and published{' '}
        <span className="mono">decide</span> = 19.0 %, twice the true share. Recomputing this page
        from the runtime is what caught it: <Value of={derived(TRADES_PER_BLOCK, C_CEILING)} />{' '}
        trades per block, and <Value of={derived(TRADES_PRIMARY, C_CEILING)} /> on the
        ordinary-business share, are unreachable from the smaller number — it yields half of each.
        The specification was corrected on 2026-08-09 and now states{' '}
        <Value of={derived(PRIMARY_PROOF_BYTES, C_LIMITS)} format={bytes} /> (
        <span className="cite">{formatCitation(C_CEILING)}</span>).
      </p>
    </section>
  );
}

function DeniedPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The list of things nobody may do</h2>
      <p>
        Most rules in this chain answer the question &ldquo;who is asking?&rdquo;. This list does
        not. It is checked <strong>before</strong> anyone&rsquo;s authority is looked at, so it
        gives the same answer to a stranger, to a proposal that won its market, to a passed vote,
        and to the founding key that runs the launch. There is no arrangement of permissions that
        reaches any of these (
        <span className="cite">{formatCitation(C_NOBODY)}</span>).
      </p>

      <div className="chain-scroll">
        <table className="chain-table">
          <caption className="sr-only">
            Call families denied to every origin, and the failure each denial prevents
          </caption>
          <thead>
            <tr>
              <th scope="col">What it would do</th>
              <th scope="col">The calls</th>
              <th scope="col">Why nobody gets it</th>
            </tr>
          </thead>
          <tbody>
            {DENIED_FAMILIES.map((f) => (
              <tr key={f.id} id={`row-denied-${f.id}`}>
                <th scope="row">{f.effect}</th>
                <td>
                  <ul className="chain-calls">
                    {f.calls.map((c) => (
                      <li key={c} className="mono">
                        {c}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{f.because}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="panel__note">
        Read against <span className="mono">classifier.rs</span>, which is where this runtime
        decides what each call is (<span className="cite">{formatCitation(C_CLASSIFIER)}</span>).
      </p>

      <h3>Hiding one inside something else does not work</h3>
      <p>
        The obvious attack is to wrap a forbidden call in a permitted one — put it in a batch, send
        it through a stand-in account, bury it two batches deep. So the check does not look at the
        outer call. It walks the whole parcel, opening every wrapper, and refuses if a forbidden
        call is anywhere inside it. Two bounds keep that walk from becoming its own denial of
        service:
      </p>
      <table className="chain-table">
        <caption className="sr-only">The bounds on how deeply a payload may nest</caption>
        <thead>
          <tr>
            <th scope="col">Bound</th>
            <th scope="col" className="numeric">
              Limit
            </th>
            <th scope="col">Why it exists</th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-nesting-levels">
            <th scope="row">Wrappers deep</th>
            <td className="numeric">
              <Value of={spec(MAX_NESTED_LEVELS, C_NESTING)} />
            </td>
            <td>
              A batch inside a batch inside a batch. Past this the parcel is refused rather than
              inspected, because the inspection itself has to fit in a block.
            </td>
          </tr>
          <tr id="row-nesting-calls">
            <th scope="row">Calls in total</th>
            <td className="numeric">
              <Value of={spec(MAX_NESTED_CALLS, C_NESTING)} />
            </td>
            <td>
              Counted across the whole parcel, not per wrapper — otherwise sixteen batches of
              sixteen would each be within its own limit.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        The wrapper set is closed: every call in this chain that can carry another call has a
        written treatment, and adding a new carrier without one fails the build (
        <span className="cite">{formatCitation(C_WRAPPERS)}</span>). Some carriers are not
        inspected but refused outright — acting as a chosen account, or handing a call a different
        authority than the one it arrived with, cannot be made safe by checking what is inside.
      </p>
    </section>
  );
}

function PalletPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Every part, and the number it is filed under</h2>
      <p>
        The chain&rsquo;s program is assembled from{' '}
        <Value of={derived(PALLET_COUNT, C_RUNTIME)} /> modules — each one owns a slice of the
        storage and a set of the actions people can take. Only{' '}
        <Value of={derived(BLEAVIT_PALLET_COUNT, C_RUNTIME)} /> of them are Bleavit&rsquo;s own
        work. The rest are ordinary Polkadot parts that thousands of chains share (
        <span className="cite">{formatCitation(C_PALLETMAP)}</span>).
      </p>
      <p>
        Each carries a number, and the numbers are part of the chain&rsquo;s public surface: a
        program reading Bleavit addresses storage and calls by them. The custom slots{' '}
        <Value of={spec(FROZEN_FIRST, C_RUNTIME)} />&ndash;
        <Value of={spec(FROZEN_LAST, C_RUNTIME)} /> are frozen and are never renumbered, whatever
        else the runtime does — a renumbering would silently redirect every reader to the wrong
        module (<span className="cite">{formatCitation(C_RUNTIME)}</span>).
      </p>

      <div className="chain-scroll">
        <table className="chain-table">
          <caption className="sr-only">
            The runtime&rsquo;s modules with their frozen indices, grouped as the runtime groups
            them
          </caption>
          <thead>
            <tr>
              <th scope="col" className="numeric">
                No.
              </th>
              <th scope="col">Module</th>
              <th scope="col">What it owns</th>
            </tr>
          </thead>
          {PALLET_GROUPS.map((g) => (
            <tbody key={g.id} id={`row-group-${g.id}`}>
              <tr className="chain-grouprow">
                <th scope="colgroup" colSpan={3}>
                  <span className="chain-groupname">{g.title}</span>
                  <span className="chain-plain">{g.plain}</span>
                </th>
              </tr>
              {g.rows.map((r) => (
                <tr key={r.name} id={`row-pallet-${r.index}`}>
                  <th scope="row" className="mono numeric">
                    <Value of={spec(r.index, C_RUNTIME)} />
                  </th>
                  <td className="mono">
                    {r.name}
                    {r.bootstrapOnly === true ? (
                      <>
                        {' '}
                        <span className="chip">launch only</span>
                      </>
                    ) : null}
                  </td>
                  <td>{r.what}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <p className="panel__note">
        The gaps in the numbering are deliberate. Numbers are handed out in blocks so a new module
        can join its own group later without disturbing anyone above it, and a number that was once
        used is never reused for something else.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * The rail, ordered by how much the reader has asked for.
 *
 * One panel stays open, and it is the one the canvas points at. Everything
 * else — the collator set, the node/runtime split, the weight tables, the
 * forbidden list, the forty-five modules — is closed, because a first reader
 * who meets all of it at once reads none of it, and because the reader of scene
 * 01 is by definition the least equipped reader this app will ever have.
 */
export function TheChainScene({ sim }: { sim: SimState }): JSX.Element {
  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame model={buildModel(sim)} title="One block, and the two limits it lives inside" />
      </div>
      <div className="col-rail">
        <Lede>
          Bleavit is a blockchain that does not guard itself. It hands every block it makes to
          Polkadot, whose machines run that block again and only then agree it happened — so
          Bleavit cannot quietly rewrite its own past, and does not have to recruit anybody to stop
          it. What it pays for that is <strong>evidence</strong>: those machines keep none of
          Bleavit&rsquo;s records, so every block has to carry a receipt for each thing it looked
          up. Those receipts, and not the computing, are what fills a block up.
        </Lede>

        <KeyFacts>
          <KeyFact
            label="A new block every"
            note="Polkadot re-runs each one before it counts as having happened."
          >
            <Value of={spec(MILLISECS_PER_BLOCK / 1000, C_BLOCKTIME)} unit=" s" />
          </KeyFact>
          <KeyFact
            label="Trades that fit in one block"
            note={`Receipts run out first. Computing time alone would have allowed ${TRADES_BY_TIME}.`}
          >
            <Value of={derived(TRADES_PER_BLOCK, C_CEILING)} />
          </KeyFact>
          <KeyFact
            label="Parts it is assembled from"
            note={`${BLEAVIT_PALLET_COUNT} are Bleavit’s own. The rest are ordinary Polkadot parts.`}
          >
            <Value of={derived(PALLET_COUNT, C_RUNTIME)} />
          </KeyFact>
        </KeyFacts>

        <BudgetPanel />

        <Depth title="Who makes the blocks, and why they cannot cheat" hint="collators · 6 h shifts">
          <CollatorPanel sim={sim} />
        </Depth>

        <Depth title="The rules travel separately from the program that runs them" hint="node vs runtime">
          <NodePanel />
        </Depth>

        <Depth title="What each action costs, and how the block is shared out" hint="3 calls · 75 / 25">
          <WeightPanel />
        </Depth>

        <Depth
          title="The short list of things nobody may do — not even the founders"
          hint={`${DENIED_FAMILIES.length} families`}
        >
          <DeniedPanel />
        </Depth>

        <Depth
          title="Every module the chain is built from, and its frozen number"
          hint={`${PALLET_COUNT} modules`}
        >
          <PalletPanel />
        </Depth>
      </div>
    </div>
  );
}
