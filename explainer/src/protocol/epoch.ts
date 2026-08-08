/**
 * The epoch clock and the cohort pipeline — doc 05 §3, doc 13 §3.1.
 *
 * Two facts shape this whole module:
 *
 *  1. **Every scheduled boundary is a kernel fraction `n/21` of `epoch.length`.**
 *     There are no absolute phase offsets anywhere in chain storage, which is why
 *     `epoch.length` MUST be a multiple of 21: only then does every boundary land
 *     on a whole block. That is also why this app's signature element is a 21-tick
 *     ring — the ring is not a stylistic choice, it is the denominator.
 *  2. **Review and Execute carry no fraction.** They are per-proposal and
 *     per-class (a timelock measured from `decide`, then a permissionless
 *     `execute` within its grace), so they cannot be drawn on the ring at all.
 *     They are modelled here as `UNSCHEDULED_PHASES` so the UI has no way to
 *     invent a wedge for them.
 *
 * Block arithmetic is done as `floor(L · n / 21)`, mirroring the runtime's
 * integer division (`epoch_core::phase_start_offset`). For a legal `epoch.length`
 * the floor never bites; for an illegal one this module degrades exactly the way
 * the chain would rather than pretending the schedule is still exact.
 */

import { cite } from './citations';
import {
  BLOCKS_PER_DAY,
  BLOCKS_PER_HOUR,
  EPOCH_PHASE_DENOMINATOR,
  MAX_NON_TERMINAL_COHORTS,
  MILLISECS_PER_BLOCK,
  PHASE_OFFSET_NUMERATORS,
  PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS,
  PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS,
} from './constants';
import type { EpochPhase } from './types';

export const SCHEDULE_CITATION = cite('05', '§3.1', 'phase offsets as fractions of epoch.length');
export const COHORT_CITATION = cite('05', '§3.3', 'measurement horizon k, cohort concurrency');

/** Blocks per minute at the frozen 6 s block time. Derived, never assumed. */
const BLOCKS_PER_MINUTE = 60_000 / MILLISECS_PER_BLOCK;

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * The six phases that own a fixed fraction of the epoch — doc 13 §3.1.
 *
 * `EpochPhase` has eight variants; `Review` and `Execute` are the two that are
 * not on the clock. Narrowing the type here is what makes it a compile error to
 * ask for the start block of a phase that has none.
 */
export const SCHEDULED_PHASES = [
  'Intake',
  'Qualify',
  'Seed',
  'Trade',
  'Decide',
  'Housekeeping',
] as const;
export type ScheduledPhase = (typeof SCHEDULED_PHASES)[number];

/** Per-proposal, per-class, and therefore never on the ring (doc 05 §3.1). */
export const UNSCHEDULED_PHASES: readonly EpochPhase[] = Object.freeze(['Review', 'Execute']);

export function isScheduledPhase(phase: EpochPhase): phase is ScheduledPhase {
  return (SCHEDULED_PHASES as readonly EpochPhase[]).includes(phase);
}

/**
 * Start-offset numerators over 21, taken from the kernel table rather than
 * restated, so a change in `constants.ts` cannot silently desync the dial.
 */
export const SCHEDULED_START_NUMERATOR: Readonly<Record<ScheduledPhase, number>> = Object.freeze({
  Intake: PHASE_OFFSET_NUMERATORS.Intake,
  Qualify: PHASE_OFFSET_NUMERATORS.Qualify,
  Seed: PHASE_OFFSET_NUMERATORS.Seed,
  Trade: PHASE_OFFSET_NUMERATORS.Trade,
  Decide: PHASE_OFFSET_NUMERATORS.Decide,
  Housekeeping: PHASE_OFFSET_NUMERATORS.Housekeeping,
});

/**
 * Nominal start of decision-window accrual, 15/21 — the final 72 h of Trade at
 * the default `dec.window`.
 *
 * It is a numerator like the others but **not** a phase: accrual happens inside
 * Trade, and the real boundary is `decide − dec.window` from the live registry,
 * not this fraction. Use {@link decisionWindow}; this constant exists so the
 * dial can shade the sub-range at default parameters and so tests can prove the
 * two agree there.
 */
export const DECIDE_WINDOW_START_NUMERATOR = PHASE_OFFSET_NUMERATORS.DecideWindow;

/** The doc 05 §3.1 "Work" column — one line of spec-sourced text per segment.
 * (13 §3.1 carries the fractions and the block arithmetic, not this column.) */
export const PHASE_WORK: Readonly<Record<ScheduledPhase, string>> = Object.freeze({
  Intake: 'Submissions accepted; the intake queue fills (≤ 64).',
  Qualify: 'Static checks, class derivation, bond-priority slotting, resource locks.',
  Seed: 'Vaults, decision pairs, gate markets and the Baseline book open; POL is seeded.',
  Trade: 'Trading, with an observation every 10 blocks feeding the TWAP.',
  Decide: 'decide(pid) runs per slot; a pair may take one +3 d extension.',
  Housekeeping: 'Cohort e−3 settles, markets are reaped, normalization freezes for e+1.',
});

// ---------------------------------------------------------------------------
// Block arithmetic
// ---------------------------------------------------------------------------

/**
 * Block offset of the `n/21` boundary — doc 05 §3.1.
 *
 * Mirrors the runtime's `L · n / 21` integer division. Exact for every legal
 * `epoch.length`, because legality *is* divisibility by 21.
 */
export function boundaryBlock(numerator: number, epochLength: number): number {
  return Math.floor((epochLength * numerator) / EPOCH_PHASE_DENOMINATOR);
}

export function phaseStartBlock(phase: ScheduledPhase, epochLength: number): number {
  return boundaryBlock(SCHEDULED_START_NUMERATOR[phase], epochLength);
}

export interface PhaseBoundary {
  readonly phase: ScheduledPhase;
  /** Start numerator over 21. */
  readonly numerator: number;
  /** Inclusive. */
  readonly startBlock: number;
  /** Exclusive — the next phase's start, or `epochLength` for Housekeeping. */
  readonly endBlock: number;
  readonly blocks: number;
}

/**
 * The six scheduled phases in order, with exact block arithmetic — doc 13 §3.1.
 *
 * Intervals are half-open `[startBlock, endBlock)` and tile `[0, epochLength)`
 * with no gap and no overlap; every other function here derives from this one so
 * there is a single place the tiling can be wrong.
 */
export function phaseBoundaries(epochLength: number): PhaseBoundary[] {
  return SCHEDULED_PHASES.map((phase, i) => {
    const numerator = SCHEDULED_START_NUMERATOR[phase];
    const startBlock = boundaryBlock(numerator, epochLength);
    const next = SCHEDULED_PHASES[i + 1];
    const endBlock = next === undefined ? epochLength : phaseStartBlock(next, epochLength);
    return { phase, numerator, startBlock, endBlock, blocks: endBlock - startBlock };
  });
}

/**
 * The phase owning a block offset — doc 05 §3.1, mirroring `epoch_core::phase_at`.
 *
 * Total by construction: the comparison chain runs from the last boundary
 * backwards, so every input lands in exactly one phase. Offsets below 0 read as
 * Intake and offsets at or beyond `epochLength` as Housekeeping — clamping,
 * because a block outside the epoch is a caller error and the clock must not
 * throw inside a render.
 *
 * The return type is {@link ScheduledPhase}, not `EpochPhase`, because that is
 * the actual codomain: Review and Execute carry no fraction, so no block offset
 * can ever select them. Declaring the wide enum here would advertise two
 * outcomes that cannot occur and would break the narrowing the rest of this
 * module relies on — `phaseStartBlock(phaseAt(b, L), L)` is always well defined
 * and must therefore typecheck.
 *
 * Note what is *not* here: decision-window accrual. It is a sub-range inside
 * Trade (13 §3.1), not a phase — a block at 16/21 is `Trade`, and
 * {@link isInDecisionWindow} answers the orthogonal question. `Decide` spans
 * [18/21, 20/21): the per-proposal Review and Execute work overlaps that span
 * but does not partition it.
 */
export function phaseAt(blockInEpoch: number, epochLength: number): ScheduledPhase {
  const b = Math.floor(blockInEpoch);
  if (b >= phaseStartBlock('Housekeeping', epochLength)) return 'Housekeeping';
  if (b >= phaseStartBlock('Decide', epochLength)) return 'Decide';
  if (b >= phaseStartBlock('Trade', epochLength)) return 'Trade';
  if (b >= phaseStartBlock('Seed', epochLength)) return 'Seed';
  if (b >= phaseStartBlock('Qualify', epochLength)) return 'Qualify';
  return 'Intake';
}

export interface BlockWindow {
  /** Inclusive. */
  readonly startBlock: number;
  /** Exclusive. */
  readonly endBlock: number;
  readonly blocks: number;
}

/** The 18/21 anchor: `decide(pid)` runs here, and Trade closes here (13 §3.1). */
export function decideBlock(epochLength: number): number {
  return phaseStartBlock('Decide', epochLength);
}

/** Trade is [5/21, 18/21) — 13 days at the 302,400 default (doc 13 §3.1). */
export function tradeWindow(epochLength: number): BlockWindow {
  const startBlock = phaseStartBlock('Trade', epochLength);
  const endBlock = decideBlock(epochLength);
  return { startBlock, endBlock, blocks: endBlock - startBlock };
}

/**
 * The largest legal `dec.window`: `13/21 · epoch.length`, i.e. the whole Trade
 * phase. Doc 05 §3.1 states the constraint as checked at parameter change.
 */
export function maxDecisionWindowBlocks(epochLength: number): number {
  const { blocks } = tradeWindow(epochLength);
  return blocks;
}

export function decisionWindowIsValid(epochLength: number, decWindowBlocks: number): boolean {
  return decWindowBlocks >= 0 && decWindowBlocks <= maxDecisionWindowBlocks(epochLength);
}

/**
 * TWAP decision-window accrual: the final `dec.window` blocks before Decide
 * (doc 05 §3.1). Anchored to Trade close, not to a fraction — `dec.window` is an
 * absolute block count, and only at its 43,200 default does the window start
 * coincide with the 15/21 tick.
 *
 * The start clamps at 0 so a nonsensical `dec.window` cannot produce a negative
 * block; whether the value is legal at all is {@link decisionWindowIsValid}'s
 * question, kept separate so the UI can show an out-of-bounds value as wrong
 * rather than as silently repaired.
 */
export function decisionWindow(epochLength: number, decWindowBlocks: number): BlockWindow {
  const endBlock = decideBlock(epochLength);
  const startBlock = Math.max(0, endBlock - decWindowBlocks);
  return { startBlock, endBlock, blocks: endBlock - startBlock };
}

/**
 * The trailing sub-window: the final `dec.trailing` blocks before Decide
 * (24 h by default, doc 13 §1). Convergence is judged on this tail, so it is the
 * same anchor as {@link decisionWindow} with a shorter reach.
 */
export function trailingWindow(epochLength: number, decTrailingBlocks: number): BlockWindow {
  return decisionWindow(epochLength, decTrailingBlocks);
}

/** Half-open `[decide − dec.window, decide)`, per doc 05 §3.1's interval. */
export function isInDecisionWindow(
  blockInEpoch: number,
  epochLength: number,
  decWindowBlocks: number,
): boolean {
  const w = decisionWindow(epochLength, decWindowBlocks);
  return blockInEpoch >= w.startBlock && blockInEpoch < w.endBlock;
}

/** Half-open `[decide − dec.trailing, decide)`. */
export function isInTrailingWindow(
  blockInEpoch: number,
  epochLength: number,
  decTrailingBlocks: number,
): boolean {
  const w = trailingWindow(epochLength, decTrailingBlocks);
  return blockInEpoch >= w.startBlock && blockInEpoch < w.endBlock;
}

// ---------------------------------------------------------------------------
// epoch.length validity
// ---------------------------------------------------------------------------

export interface EpochLengthVerdict {
  readonly valid: boolean;
  /** Always populated — the UI shows the reason whether it passed or failed. */
  readonly reason: string;
}

/**
 * Screen a candidate `epoch.length` — doc 05 §3.1 (multiple of 21) and doc 13 §1
 * (floor 201,600 = 14 d, ceiling 604,800 = 42 d, both kernel-bounded).
 *
 * Divisibility is checked last so a value that fails both tests reports the
 * range problem, which is the one an operator can act on.
 */
export function validateEpochLength(n: number): EpochLengthVerdict {
  if (!Number.isInteger(n)) {
    return { valid: false, reason: 'epoch.length is a block count and must be a whole number.' };
  }
  if (n < PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS) {
    return {
      valid: false,
      reason: `Below the kernel floor of ${formatBlocks(PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS)} (14 days).`,
    };
  }
  if (n > PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS) {
    return {
      valid: false,
      reason: `Above the kernel ceiling of ${formatBlocks(PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS)} (42 days).`,
    };
  }
  if (n % EPOCH_PHASE_DENOMINATOR !== 0) {
    return {
      valid: false,
      reason: `Not a multiple of ${EPOCH_PHASE_DENOMINATOR}: phase boundaries would fall between blocks.`,
    };
  }
  return {
    valid: true,
    reason: `${formatBlocks(n)} = ${formatDurationHuman(n)}, ${formatBlocks(n / EPOCH_PHASE_DENOMINATOR)} per tick.`,
  };
}

export function epochLengthIsValid(n: number): boolean {
  return validateEpochLength(n).valid;
}

// ---------------------------------------------------------------------------
// Duration rendering
// ---------------------------------------------------------------------------

const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Decompose a block count at the frozen 6 s block time (doc 13 §2).
 *
 * A duration is a span, so the magnitude is used: the sign of a delta belongs to
 * whoever computed the delta, not to the clock.
 */
export function blocksToDuration(blocks: number): {
  days: number;
  hours: number;
  minutes: number;
} {
  const total = Math.abs(Math.trunc(blocks));
  const days = Math.floor(total / BLOCKS_PER_DAY);
  const afterDays = total - days * BLOCKS_PER_DAY;
  const hours = Math.floor(afterDays / BLOCKS_PER_HOUR);
  const afterHours = afterDays - hours * BLOCKS_PER_HOUR;
  return { days, hours, minutes: Math.floor(afterHours / BLOCKS_PER_MINUTE) };
}

/** `302,400 blocks` — grouped without `toLocaleString`, which is locale-dependent. */
export function formatBlocks(blocks: number): string {
  const n = Math.trunc(blocks);
  return `${n < 0 ? '-' : ''}${group(Math.abs(n))} blocks`;
}

/** Human time only, to the two most significant units: `21 d`, `3 d 12 h`, `40 m`. */
export function formatDurationHuman(blocks: number): string {
  const { days, hours, minutes } = blocksToDuration(blocks);
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
  if (minutes > 0) return `${minutes} m`;
  return Math.trunc(blocks) === 0 ? '0 m' : '< 1 m';
}

/**
 * `302,400 blocks (21 d)` — the pairing every duration in this app must show.
 *
 * A bare "21 days" hides that the chain measures in blocks and that a governance
 * amendment moves the block count, not the calendar; a bare block count is
 * unreadable. Both halves come from here so they cannot drift apart.
 */
export function formatDuration(blocks: number): string {
  return `${formatBlocks(blocks)} (${formatDurationHuman(blocks)})`;
}

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

/**
 * The admissible measurement horizon is **derived, not chosen** — doc 05 §3.3.
 *
 * A cohort created at epoch `e` trades in `e`, measures over `e+1 … e+k`,
 * settles at `e+k+1` and only then leaves the working set, so it is non-terminal
 * for `k + 2` epochs. One cohort forms per epoch, so steady state holds exactly
 * `k + 2` of them against I-21's cap of 4 — hence `k ≤ 4 − 2 = 2`. This is a
 * kernel ceiling rather than a tunable: at `k = 3` the fifth concurrent cohort
 * cannot be admitted, so `qualify` fails `TooManyCohorts` in one epoch out of
 * every `k + 2`, forever. It is not a halt — one cohort retires each epoch, so
 * four epochs in five still admit — and doc 05 §3.3 names the "every qualify
 * fails, permanently" reading as false, corrected on 2026-07-31. The loss is
 * still unrecoverable, which is what makes the ceiling normative: a proposal a
 * failed epoch turns away cannot join a later cohort, so the chain forfeits a
 * fixed fraction of its measurement capacity with nothing able to clear it.
 * That was reachable through a lawful amendment inside the key's
 * own published bounds, which is why SQ-496 wrote the derivation into the row:
 * doc 13 §1 now publishes a hard max of 2 for `epoch.horizon_k` and places the
 * row in the kernel-bounded set, so `amend_registry` refuses to move that bound.
 * `k = 3` is no longer reachable by amendment — only by a runtime upgrade.
 *
 * At `k = 2` and the 21-day default that pipeline is why a participant's capital
 * duration is ~63–66 days (doc 13 §3.1): a position held to the close of trading
 * at d18 of `e` is released in `e+3`'s Housekeeping, which at the default runs
 * from absolute day 83 to day 84 — 65 to 66 days later, bracketing the three
 * full epochs the doc quotes.
 */
export const DERIVED_MAX_HORIZON_K = MAX_NON_TERMINAL_COHORTS - 2;

export interface CohortSchedule {
  /** The epoch the cohort's proposals trade in. */
  readonly trades: number;
  /** Measurement epochs `e+1 … e+k`, ascending. */
  readonly measures: number[];
  /** Settlement epoch `e+k+1` — e+3 at the default horizon. */
  readonly settlesAt: number;
  /** Settlement runs in Housekeeping of `settlesAt`, not at its open (05 §7(1)). */
  readonly settlesInPhase: ScheduledPhase;
}

/**
 * The cohort pipeline for one epoch — doc 05 §3.3 and §7(1).
 *
 * Deliberately does not reject an inadmissible `k`: the app needs to *show* what
 * `k = 3` would schedule in order to explain why it over-subscribes the chain
 * permanently. Callers enforcing the ceiling use {@link cohortCapacity}.
 */
export function cohortSchedule(epoch: number, k: number): CohortSchedule {
  const horizon = Math.max(0, Math.trunc(k));
  return {
    trades: epoch,
    measures: Array.from({ length: horizon }, (_, i) => epoch + 1 + i),
    settlesAt: epoch + horizon + 1,
    settlesInPhase: 'Housekeeping',
  };
}

/**
 * Cohorts that are non-terminal during `epoch`, ascending — doc 05 §3.3.
 *
 * A cohort `c` is live from its trading epoch through its settling epoch
 * inclusive, so the set is `[epoch − k − 1, epoch]`, clamped at cohort 0 because
 * the chain has no epochs before genesis and the pipeline fills over the first
 * `k + 1` epochs.
 */
export function nonTerminalCohortsAt(epoch: number, k: number): number[] {
  const horizon = Math.max(0, Math.trunc(k));
  const first = Math.max(0, epoch - horizon - 1);
  const out: number[] = [];
  for (let c = first; c <= epoch; c += 1) out.push(c);
  return out;
}

/** Steady-state concurrent cohorts at horizon `k`: `k + 2` (doc 05 §3.3). */
export function concurrentCohorts(k: number): number {
  return Math.max(0, Math.trunc(k)) + 2;
}

export interface CohortCapacity {
  readonly k: number;
  readonly concurrent: number;
  readonly cap: number;
  readonly admissible: boolean;
  readonly reason: string;
}

/** Check a horizon against I-21's cap of 4 non-terminal cohorts (doc 05 §3.3). */
export function cohortCapacity(k: number): CohortCapacity {
  const horizon = Math.max(0, Math.trunc(k));
  const concurrent = concurrentCohorts(horizon);
  const admissible = concurrent <= MAX_NON_TERMINAL_COHORTS;
  return {
    k: horizon,
    concurrent,
    cap: MAX_NON_TERMINAL_COHORTS,
    admissible,
    reason: admissible
      ? `k = ${horizon} holds ${concurrent} concurrent cohorts, within the cap of ${MAX_NON_TERMINAL_COHORTS}.`
      : `k = ${horizon} needs ${concurrent} concurrent cohorts but the cap is ${MAX_NON_TERMINAL_COHORTS}: the ${concurrent}th cannot be admitted, so qualify fails in one epoch out of every ${concurrent}, forever.`,
  };
}

/** Programmer-error guard for code that must not schedule past the I-21 cap. */
export function assertCohortCapacity(k: number): void {
  const verdict = cohortCapacity(k);
  if (!verdict.admissible) throw new Error(verdict.reason);
}

// ---------------------------------------------------------------------------
// Dial geometry
// ---------------------------------------------------------------------------

/** 21 ticks, one per unit of the phase-offset denominator. */
export const TICK_COUNT = EPOCH_PHASE_DENOMINATOR;

/** 360/21 = 17.142857…° — never rounded, so 21 ticks close the circle. */
export const DEGREES_PER_TICK = 360 / TICK_COUNT;

/**
 * Degrees for a tick position, 0° at the top of the dial and increasing
 * clockwise — doc 13 §3.1's fractions rendered as geometry.
 *
 * Multiplies before dividing so whole turns are exact: `tickAngle(21)` is
 * exactly 360, not 359.999…. It deliberately does not wrap, because an arc
 * ending at the epoch boundary must read as 360° rather than collapsing onto
 * its own start.
 */
export function tickAngle(numerator: number): number {
  return (numerator * 360) / TICK_COUNT;
}

export interface PhaseArc {
  readonly phase: ScheduledPhase;
  readonly fromTick: number;
  readonly toTick: number;
  readonly fromAngleDeg: number;
  readonly toAngleDeg: number;
}

/**
 * Dial geometry for the six scheduled phases — computed here, once, from
 * {@link phaseBoundaries}.
 *
 * Ticks are derived from the block boundaries rather than from the numerators
 * directly, even though the two coincide for every legal `epoch.length`. That is
 * the point: the 3D ring and the 2D fallback both consume this, so the geometry
 * is provably the same arithmetic as the clock and an illegal length shows up as
 * fractional ticks instead of as a silently pretty dial.
 */
export function phaseArcs(epochLength: number): PhaseArc[] {
  const blocksPerTick = epochLength / TICK_COUNT;
  return phaseBoundaries(epochLength).map((b) => {
    const fromTick = blocksPerTick === 0 ? 0 : b.startBlock / blocksPerTick;
    const toTick = blocksPerTick === 0 ? 0 : b.endBlock / blocksPerTick;
    return {
      phase: b.phase,
      fromTick,
      toTick,
      fromAngleDeg: tickAngle(fromTick),
      toAngleDeg: tickAngle(toTick),
    };
  });
}

/**
 * Geometry for the decision-window accrual band inside Trade (doc 05 §3.1).
 *
 * Returned separately from {@link phaseArcs} because it is an overlay, not a
 * wedge: it lies inside the Trade arc and moves with `dec.window`, so at a
 * non-default `dec.window` its ticks are fractional and that is correct.
 */
export function decideWindowArc(
  epochLength: number,
  decWindowBlocks: number,
): Omit<PhaseArc, 'phase'> {
  const blocksPerTick = epochLength / TICK_COUNT;
  const w = decisionWindow(epochLength, decWindowBlocks);
  const fromTick = blocksPerTick === 0 ? 0 : w.startBlock / blocksPerTick;
  const toTick = blocksPerTick === 0 ? 0 : w.endBlock / blocksPerTick;
  return {
    fromTick,
    toTick,
    fromAngleDeg: tickAngle(fromTick),
    toAngleDeg: tickAngle(toTick),
  };
}
