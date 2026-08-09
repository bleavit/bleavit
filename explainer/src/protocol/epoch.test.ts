/**
 * Tolerance policy for this suite (project-wide rule, restated as required):
 *
 *  - Integer base-unit results: EXACT equality, no tolerance.
 *  - Values the spec computes on the floored 1e9 grid: absolute tolerance 2e-9.
 *  - Pure real-valued transcendental results: relative tolerance 1e-12.
 *
 * The epoch clock produces **only** integer block counts, so every schedule
 * assertion below is exact — that is the whole point of requiring
 * `epoch.length % 21 == 0`. The single non-integer family is dial geometry
 * (degrees), which is not a spec quantity; those get an absolute 1e-9, and the
 * two angles that must be exact (0° and a full 360° turn) are asserted exactly.
 *
 * This module has no reference-model corpus family: doc 05 §3 / doc 13 §3.1 are
 * a schedule, not a numeric kernel, so the doc's own block table is the oracle.
 */

import { describe, expect, it } from 'vitest';

import {
  BLOCKS_PER_DAY,
  EPOCH_PHASE_DENOMINATOR,
  MAX_NON_TERMINAL_COHORTS,
  PHASE_OFFSETS_ORDERED,
  PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS,
  PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS,
} from './constants';
import {
  DECIDE_WINDOW_START_NUMERATOR,
  DEGREES_PER_TICK,
  DERIVED_MAX_HORIZON_K,
  SCHEDULED_PHASES,
  SCHEDULED_START_NUMERATOR,
  TICK_COUNT,
  UNSCHEDULED_PHASES,
  assertCohortCapacity,
  blocksToDuration,
  boundaryBlock,
  cohortCapacity,
  cohortSchedule,
  concurrentCohorts,
  decideBlock,
  decideWindowArc,
  decisionWindow,
  decisionWindowIsValid,
  epochLengthIsValid,
  formatBlocks,
  formatDuration,
  formatDurationHuman,
  isInDecisionWindow,
  isInTrailingWindow,
  isScheduledPhase,
  maxDecisionWindowBlocks,
  nonTerminalCohortsAt,
  phaseArcs,
  phaseAt,
  phaseBoundaries,
  phaseStartBlock,
  tickAngle,
  tradeWindow,
  trailingWindow,
  validateEpochLength,
} from './epoch';
import type { ScheduledPhase } from './epoch';
import { EPOCH_PHASES } from './types';

/**
 * The doc 13 §1 default for `epoch.length`. Its home is the parameter registry,
 * not this module — the clock takes the length as an argument precisely because
 * META can amend it — so the tests carry it locally.
 */
const L = 302_400;
/** `dec.window` and `dec.trailing` defaults, doc 13 §1. */
const DEC_WINDOW = 43_200;
const DEC_TRAILING = 14_400;

/** Legal lengths: every one a multiple of 21 inside [floor, ceiling]. */
const LEGAL_LENGTHS = [201_600, 210_000, 302_400, 302_421, 403_200, 604_800];

describe('phase schedule at the 302,400 default (doc 13 §3.1)', () => {
  const rows = phaseBoundaries(L);

  it('reproduces the doc 13 §3.1 block table exactly', () => {
    expect(rows.map((r) => [r.phase, r.startBlock, r.endBlock])).toEqual([
      ['Intake', 0, 43_200],
      ['Qualify', 43_200, 57_600],
      ['Seed', 57_600, 72_000],
      ['Trade', 72_000, 259_200],
      ['Decide', 259_200, 288_000],
      ['Housekeeping', 288_000, 302_400],
    ]);
  });

  it('reproduces the day labels d0–d3 / d3–d4 / d4–d5 / d5–d18 / d18–d20 / d20–d21', () => {
    const days = rows.map((r) => [r.startBlock / BLOCKS_PER_DAY, r.endBlock / BLOCKS_PER_DAY]);
    expect(days).toEqual([
      [0, 3],
      [3, 4],
      [4, 5],
      [5, 18],
      [18, 20],
      [20, 21],
    ]);
  });

  it('gives Trade the 13-day span the corrected label claims', () => {
    const trade = tradeWindow(L);
    expect(trade).toEqual({ startBlock: 72_000, endBlock: 259_200, blocks: 187_200 });
    expect(trade.blocks).toBe(13 * BLOCKS_PER_DAY);
    expect(trade.blocks).toBe((13 / 21) * L);
  });

  it('anchors Decide at 18/21 and Trade close on the same block', () => {
    expect(decideBlock(L)).toBe(259_200);
    expect(decideBlock(L)).toBe(tradeWindow(L).endBlock);
  });
});

describe('boundary exactness across legal epoch lengths', () => {
  it.each(LEGAL_LENGTHS)('L = %i yields whole-block boundaries that tile the epoch', (len) => {
    const rows = phaseBoundaries(len);
    const perTick = len / EPOCH_PHASE_DENOMINATOR;
    expect(Number.isInteger(perTick)).toBe(true);

    for (const row of rows) {
      expect(Number.isInteger(row.startBlock)).toBe(true);
      expect(Number.isInteger(row.endBlock)).toBe(true);
      // Exact fraction, not the floored form: legality *is* divisibility by 21.
      expect(row.startBlock).toBe(perTick * row.numerator);
    }

    expect(rows[0]?.startBlock).toBe(0);
    expect(rows[rows.length - 1]?.endBlock).toBe(len);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]?.startBlock).toBe(rows[i - 1]?.endBlock);
    }
    expect(rows.reduce((sum, r) => sum + r.blocks, 0)).toBe(len);
  });

  it('floors identically to the runtime for the kernel floor and ceiling', () => {
    expect(phaseStartBlock('Trade', PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS)).toBe(48_000);
    expect(phaseStartBlock('Decide', PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS)).toBe(172_800);
    expect(phaseStartBlock('Trade', PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS)).toBe(144_000);
    expect(phaseStartBlock('Decide', PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS)).toBe(518_400);
  });

  it('takes its numerators from the kernel table, not from a private copy', () => {
    const fromKernel = Object.fromEntries(PHASE_OFFSETS_ORDERED);
    expect(SCHEDULED_START_NUMERATOR).toEqual({
      Intake: fromKernel['Intake'],
      Qualify: fromKernel['Qualify'],
      Seed: fromKernel['Seed'],
      Trade: fromKernel['Trade'],
      Decide: fromKernel['Decide'],
      Housekeeping: fromKernel['Housekeeping'],
    });
    expect(DECIDE_WINDOW_START_NUMERATOR).toBe(fromKernel['DecideWindow']);
    expect(boundaryBlock(DECIDE_WINDOW_START_NUMERATOR, L)).toBe(216_000);
  });
});

describe('Review and Execute are unscheduled (doc 05 §3.1)', () => {
  it('never appears on the ring', () => {
    for (const phase of UNSCHEDULED_PHASES) {
      expect(isScheduledPhase(phase)).toBe(false);
      expect(phaseBoundaries(L).some((r) => (r.phase as string) === phase)).toBe(false);
      expect(phaseArcs(L).some((a) => (a.phase as string) === phase)).toBe(false);
    }
  });

  it('classifies the six clock phases as scheduled', () => {
    // Both directions: a predicate checked only where it must be false is
    // satisfied by a constant `false`, which would erase the ring entirely.
    for (const phase of SCHEDULED_PHASES) expect(isScheduledPhase(phase)).toBe(true);
    expect(SCHEDULED_PHASES.filter(isScheduledPhase)).toHaveLength(6);
  });

  it('is never what phaseAt returns, at any offset in or out of the epoch', () => {
    // phaseAt is what the dial calls to label "now", so it is the function that
    // would actually put Review or Execute on the ring.
    const probes = [-L, -1, 0, 1, L - 1, L, L + 1, 3 * L];
    for (let b = 0; b < L; b += 613) probes.push(b);
    for (const boundary of phaseBoundaries(L)) {
      probes.push(boundary.startBlock - 1, boundary.startBlock, boundary.endBlock);
    }
    for (const b of probes) {
      const phase = phaseAt(b, L);
      expect(UNSCHEDULED_PHASES).not.toContain(phase);
      expect(SCHEDULED_PHASES).toContain(phase);
    }
  });

  it('accounts for all eight EpochPhase variants exactly once', () => {
    const all = [...SCHEDULED_PHASES, ...UNSCHEDULED_PHASES].sort();
    expect(all).toEqual([...EPOCH_PHASES].sort());
    expect(new Set(all).size).toBe(EPOCH_PHASES.length);
  });
});

describe('phaseAt is total over the epoch', () => {
  const containing = (b: number, len: number): ScheduledPhase[] =>
    phaseBoundaries(len)
      .filter((r) => b >= r.startBlock && b < r.endBlock)
      .map((r) => r.phase);

  it('maps every block of a full epoch to exactly one phase (dense walk, L = 201,600)', () => {
    const len = 201_600;
    const rows = phaseBoundaries(len);
    let cursor = 0;
    for (const row of rows) {
      expect(row.startBlock).toBe(cursor);
      for (let b = row.startBlock; b < row.endBlock; b += 1) {
        // Inlined tiling check: the boundaries above already proved disjointness,
        // so this walk only has to prove phaseAt agrees with them, block by block.
        expect(phaseAt(b, len)).toBe(row.phase);
      }
      cursor = row.endBlock;
    }
    expect(cursor).toBe(len);
  });

  it('has no gap and no overlap on a coarse stride plus every boundary ±1', () => {
    const probes = new Set<number>([0, L - 1]);
    for (let b = 0; b < L; b += 97) probes.add(b);
    for (const row of phaseBoundaries(L)) {
      for (const b of [row.startBlock - 1, row.startBlock, row.startBlock + 1]) {
        if (b >= 0 && b < L) probes.add(b);
      }
      for (const b of [row.endBlock - 1, row.endBlock, row.endBlock + 1]) {
        if (b >= 0 && b < L) probes.add(b);
      }
    }

    for (const b of probes) {
      const hits = containing(b, L);
      expect(hits).toHaveLength(1);
      expect(phaseAt(b, L)).toBe(hits[0]);
    }
  });

  it('clamps outside the epoch rather than throwing inside a render', () => {
    expect(phaseAt(-1, L)).toBe('Intake');
    expect(phaseAt(L, L)).toBe('Housekeeping');
    expect(phaseAt(L * 3, L)).toBe('Housekeeping');
  });

  it('reports decision-window accrual blocks as Trade, not as a phase of their own', () => {
    expect(phaseAt(216_000, L)).toBe('Trade');
    expect(phaseAt(259_199, L)).toBe('Trade');
    expect(isInDecisionWindow(216_000, L, DEC_WINDOW)).toBe(true);
  });
});

describe('epochLengthIsValid (doc 05 §3.1, doc 13 §1)', () => {
  it('accepts the default, the floor and the ceiling', () => {
    for (const len of LEGAL_LENGTHS) expect(epochLengthIsValid(len)).toBe(true);
    expect(validateEpochLength(L).reason).toContain('302,400 blocks');
  });

  it('rejects a non-multiple of 21 with that reason', () => {
    expect(epochLengthIsValid(302_401)).toBe(false);
    expect(validateEpochLength(302_401).reason).toContain('multiple of 21');
    // 201,600 + 1 is inside the bounds, so only divisibility can be the fault.
    expect(validateEpochLength(201_601).reason).toContain('multiple of 21');
  });

  it('rejects out-of-range lengths even when they divide by 21', () => {
    expect(epochLengthIsValid(201_579)).toBe(false); // floor − 21
    expect(validateEpochLength(201_579).reason).toContain('floor');
    expect(epochLengthIsValid(604_821)).toBe(false); // ceiling + 21
    expect(validateEpochLength(604_821).reason).toContain('ceiling');
  });

  it('rejects non-integers', () => {
    expect(epochLengthIsValid(302_400.5)).toBe(false);
    expect(validateEpochLength(Number.NaN).valid).toBe(false);
  });
});

describe('decision and trailing windows (doc 05 §3.1)', () => {
  it('anchors the accrual window on Trade close and lands on the 15/21 tick at defaults', () => {
    expect(decisionWindow(L, DEC_WINDOW)).toEqual({
      startBlock: 216_000,
      endBlock: 259_200,
      blocks: 43_200,
    });
    expect(decisionWindow(L, DEC_WINDOW).startBlock).toBe(
      boundaryBlock(DECIDE_WINDOW_START_NUMERATOR, L),
    );
  });

  it('treats both windows as half-open [start, decide)', () => {
    expect(isInDecisionWindow(215_999, L, DEC_WINDOW)).toBe(false);
    expect(isInDecisionWindow(216_000, L, DEC_WINDOW)).toBe(true);
    expect(isInDecisionWindow(259_199, L, DEC_WINDOW)).toBe(true);
    expect(isInDecisionWindow(259_200, L, DEC_WINDOW)).toBe(false);

    expect(trailingWindow(L, DEC_TRAILING).startBlock).toBe(244_800);
    expect(isInTrailingWindow(244_799, L, DEC_TRAILING)).toBe(false);
    expect(isInTrailingWindow(244_800, L, DEC_TRAILING)).toBe(true);
    expect(isInTrailingWindow(259_199, L, DEC_TRAILING)).toBe(true);
    expect(isInTrailingWindow(259_200, L, DEC_TRAILING)).toBe(false);
  });

  it('nests the trailing window inside the decision window', () => {
    const outer = decisionWindow(L, DEC_WINDOW);
    const inner = trailingWindow(L, DEC_TRAILING);
    expect(inner.startBlock).toBeGreaterThanOrEqual(outer.startBlock);
    expect(inner.endBlock).toBe(outer.endBlock);
  });

  it('enforces dec.window ≤ 13/21 · epoch.length', () => {
    expect(maxDecisionWindowBlocks(L)).toBe(187_200);
    expect(decisionWindowIsValid(L, 187_200)).toBe(true);
    expect(decisionWindowIsValid(L, 187_201)).toBe(false);
    expect(decisionWindowIsValid(L, 86_400)).toBe(true); // the doc 13 §1 registry max
    expect(decisionWindowIsValid(201_600, 124_800)).toBe(true); // 13/21 of the floor
    expect(decisionWindowIsValid(201_600, 124_801)).toBe(false);
  });

  it('scales the whole window arithmetic with epoch.length', () => {
    expect(decisionWindow(604_800, DEC_WINDOW)).toEqual({
      startBlock: 475_200,
      endBlock: 518_400,
      blocks: 43_200,
    });
  });
});

describe('durations (6 s blocks, doc 13 §2)', () => {
  it('decomposes block counts', () => {
    expect(blocksToDuration(L)).toEqual({ days: 21, hours: 0, minutes: 0 });
    expect(blocksToDuration(303_010)).toEqual({ days: 21, hours: 1, minutes: 1 });
    expect(blocksToDuration(600)).toEqual({ days: 0, hours: 1, minutes: 0 });
    expect(blocksToDuration(10)).toEqual({ days: 0, hours: 0, minutes: 1 });
    expect(blocksToDuration(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
    // A span has no sign; the sign of a delta belongs to the caller.
    expect(blocksToDuration(-14_400)).toEqual({ days: 1, hours: 0, minutes: 0 });
  });

  it('always renders blocks together with human time', () => {
    expect(formatDuration(L)).toBe('302,400 blocks (21 d)');
    expect(formatDuration(43_200)).toBe('43,200 blocks (3 d)');
    expect(formatDuration(14_400)).toBe('14,400 blocks (1 d)');
    expect(formatDuration(15_000)).toBe('15,000 blocks (1 d 1 h)');
    expect(formatDuration(600)).toBe('600 blocks (1 h)');
    expect(formatDuration(630)).toBe('630 blocks (1 h 3 m)');
    expect(formatDuration(10)).toBe('10 blocks (1 m)');
    expect(formatDuration(0)).toBe('0 blocks (0 m)');
  });

  it('does not round a sub-minute span up to zero silently', () => {
    expect(formatDurationHuman(5)).toBe('< 1 m');
    expect(formatBlocks(5)).toBe('5 blocks');
  });

  it('labels every scheduled phase of the default epoch in days', () => {
    const labels = phaseBoundaries(L).map((r) => formatDurationHuman(r.blocks));
    expect(labels).toEqual(['3 d', '1 d', '1 d', '13 d', '2 d', '1 d']);
  });
});

describe('cohort pipeline (doc 05 §3.3, §7(1))', () => {
  it('settles cohort e at e+3 in Housekeeping at the default horizon', () => {
    expect(cohortSchedule(10, 2)).toEqual({
      trades: 10,
      measures: [11, 12],
      settlesAt: 13,
      settlesInPhase: 'Housekeeping',
    });
    for (let e = 0; e < 8; e += 1) expect(cohortSchedule(e, 2).settlesAt).toBe(e + 3);
  });

  it('holds exactly 4 non-terminal cohorts in steady state at k = 2', () => {
    for (let e = 3; e < 30; e += 1) {
      const live = nonTerminalCohortsAt(e, 2);
      expect(live).toHaveLength(MAX_NON_TERMINAL_COHORTS);
      expect(live).toEqual([e - 3, e - 2, e - 1, e]);
      // Each live cohort has started and has not yet finished settling.
      for (const c of live) {
        expect(c).toBeLessThanOrEqual(e);
        expect(cohortSchedule(c, 2).settlesAt).toBeGreaterThanOrEqual(e);
      }
      // The cohort just off the list settled in the previous epoch.
      expect(cohortSchedule(e - 4, 2).settlesAt).toBe(e - 1);
    }
  });

  it('fills the pipeline from genesis without inventing negative cohorts', () => {
    expect(nonTerminalCohortsAt(0, 2)).toEqual([0]);
    expect(nonTerminalCohortsAt(1, 2)).toEqual([0, 1]);
    expect(nonTerminalCohortsAt(2, 2)).toEqual([0, 1, 2]);
    expect(nonTerminalCohortsAt(3, 2)).toEqual([0, 1, 2, 3]);
  });

  it('derives the horizon ceiling from the cohort cap rather than choosing it', () => {
    expect(DERIVED_MAX_HORIZON_K).toBe(MAX_NON_TERMINAL_COHORTS - 2);
    expect(DERIVED_MAX_HORIZON_K).toBe(2);

    expect(concurrentCohorts(1)).toBe(3);
    expect(concurrentCohorts(2)).toBe(4);
    expect(concurrentCohorts(3)).toBe(5);

    expect(cohortCapacity(2).admissible).toBe(true);
    expect(cohortCapacity(3).admissible).toBe(false);
    // Doc 05 §3.3 corrected the failure mode on 2026-07-31: k = 3 is not a halt.
    // One cohort retires each epoch, so admission fails with period k + 2 and
    // succeeds in the other four epochs out of five, indefinitely. The string
    // must state the period, and must not promise a total stop that never comes.
    expect(cohortCapacity(3).reason).toContain('one epoch out of every 5');
    expect(cohortCapacity(3).reason).toContain('forever');
    expect(() => assertCohortCapacity(2)).not.toThrow();
    expect(() => assertCohortCapacity(3)).toThrow(/cap is 4/);

    // The wedge, stated as arithmetic: k = 3 needs a fifth concurrent cohort.
    expect(nonTerminalCohortsAt(20, 3)).toHaveLength(5);
    expect(nonTerminalCohortsAt(20, 3).length).toBeGreaterThan(MAX_NON_TERMINAL_COHORTS);
  });

  it('still schedules an inadmissible horizon so the wedge can be shown, not hidden', () => {
    expect(cohortSchedule(10, 3)).toEqual({
      trades: 10,
      measures: [11, 12, 13],
      settlesAt: 14,
      settlesInPhase: 'Housekeeping',
    });
  });
});

describe('dial geometry', () => {
  it('has 21 ticks of 360/21 degrees that close the circle', () => {
    expect(TICK_COUNT).toBe(EPOCH_PHASE_DENOMINATOR);
    expect(DEGREES_PER_TICK).toBe(360 / 21);

    let sum = 0;
    for (let i = 0; i < TICK_COUNT; i += 1) {
      expect(tickAngle(i + 1) - tickAngle(i)).toBeCloseTo(DEGREES_PER_TICK, 9);
      sum += DEGREES_PER_TICK;
    }
    expect(sum).toBeCloseTo(360, 9);

    // The two angles that must be exact: the origin and a full turn.
    expect(tickAngle(0)).toBe(0);
    expect(tickAngle(TICK_COUNT)).toBe(360);
  });

  it('places arcs on integer ticks for every legal epoch length', () => {
    const expected: [ScheduledPhase, number, number][] = [
      ['Intake', 0, 3],
      ['Qualify', 3, 4],
      ['Seed', 4, 5],
      ['Trade', 5, 18],
      ['Decide', 18, 20],
      ['Housekeeping', 20, 21],
    ];
    for (const len of LEGAL_LENGTHS) {
      expect(phaseArcs(len).map((a) => [a.phase, a.fromTick, a.toTick])).toEqual(expected);
    }
  });

  it('derives arc angles from the same boundaries the clock uses', () => {
    const arcs = phaseArcs(L);
    const rows = phaseBoundaries(L);
    const perTick = L / TICK_COUNT;
    arcs.forEach((arc, i) => {
      const row = rows[i];
      expect(row).toBeDefined();
      expect(arc.fromTick * perTick).toBe(row?.startBlock);
      expect(arc.toTick * perTick).toBe(row?.endBlock);
      expect(arc.fromAngleDeg).toBeCloseTo(tickAngle(arc.fromTick), 9);
    });
    // The ring closes on 360°, not on 0°, so a full-turn arc stays drawable.
    expect(arcs[arcs.length - 1]?.toAngleDeg).toBe(360);
    expect(arcs[0]?.fromAngleDeg).toBe(0);
  });

  it('overlays the decision window inside Trade and lets it fall between ticks', () => {
    const atDefault = decideWindowArc(L, DEC_WINDOW);
    expect(atDefault.fromTick).toBe(15);
    expect(atDefault.toTick).toBe(18);

    // A dec.window that is not a whole number of ticks must read as fractional,
    // not be rounded onto a tick the schedule does not have.
    const odd = decideWindowArc(L, 21_600);
    expect(odd.fromTick).toBe(16.5);
    expect(odd.toTick).toBe(18);
    expect(odd.fromAngleDeg).toBeCloseTo((16.5 * 360) / 21, 9);

    const trade = phaseArcs(L).find((a) => a.phase === 'Trade');
    expect(atDefault.fromTick).toBeGreaterThanOrEqual(trade?.fromTick ?? 0);
    expect(atDefault.toTick).toBeLessThanOrEqual(trade?.toTick ?? 0);
  });
});
