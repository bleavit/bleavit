/**
 * Differential tests for the doc 04 §7 / §7a accumulators against the
 * reference-model corpus (`bleavit.reference-model.v4`).
 *
 * Tolerance policy:
 *  - integer base-unit results (contest capital, `noi_t`): EXACT equality;
 *  - grid values the corpus states exactly (every `backward_weighted_mean`
 *    figure): EXACT equality too. They land on the 1e9 grid with no residue,
 *    so a tolerance there would only be somewhere for a real disagreement to
 *    hide;
 *  - grid values whose corpus figure is off-grid: absolute tolerance 2e-9,
 *    plus an assertion on the *direction* of the deviation.
 *
 * Exactly one corpus row is in that last category, and it is explained rather
 * than absorbed: `stale_gap_accounting` is reproduced to 6.97e-10 low. See the
 * per-row comment — the gap is the spec's mandated inward rounding.
 *
 * NOT certified here, and named so it is not mistaken for covered: the corpus
 * carries a `contest_scenarios` family (3 rows) for 04 §7a, but
 * `scripts/build-fixtures.mjs` does not copy it into `vectors.slim.json`. Every
 * contest-capital expectation below is therefore hand-derived from §7a's own
 * arithmetic, not replayed from the corpus. Add `contest_scenarios` to that
 * script's FAMILIES list and this file can certify them.
 */

import { describe, expect, it } from 'vitest';

import vectors from './__fixtures__/vectors.slim.json';
import { MKT_STALE_GAP_BLOCKS } from './constants';
import { USDC } from './units';
import {
  ContestCapitalAccumulator,
  TWAP_COVERAGE_PCT_DEFAULT,
  TWAP_COVERAGE_PCT_GATE_NB,
  TWAP_KAPPA_DEFAULT,
  TwapAccumulator,
  coverageAtLeast,
  coverageFraction,
  intervalsElapsed,
  isStaleGap,
  markedOpenInterest,
  pairContestCapital,
  slewBand,
  staleEventsIn,
} from './twap';

/** Absolute tolerance for anything the chain floors onto the 1e9 grid. */
const GRID = 2e-9;

interface TwapSeriesRow {
  readonly inputs: {
    readonly initial: string;
    readonly observations: readonly { readonly block: number; readonly previous_quote: string }[];
  };
  readonly recorded: readonly string[];
  readonly mean_0_20: string;
  readonly mean_10_20: string;
  readonly stale_events: number;
}

interface TwapSingleRow {
  readonly inputs: { readonly block: number; readonly previous_quote: string };
  readonly recorded: string;
  readonly stale_events: number;
}

interface WindowStaleRow {
  readonly name: string;
  readonly inputs: {
    readonly start: number;
    readonly end: number;
    readonly observations: readonly number[];
    readonly stale_gap_blocks: number;
  };
  readonly stale_events: number;
}

function corpusRow<T>(rows: readonly unknown[], name: string): T {
  const found = (rows as readonly { readonly name: string }[]).find((r) => r.name === name);
  if (found === undefined) throw new Error(`corpus row "${name}" is missing`);
  return found as T;
}

const twapRows = vectors.twap_scenarios as readonly unknown[];
const windowRows = vectors.window_stale_scenarios as readonly unknown[];

const names = (rows: readonly unknown[]): string[] =>
  (rows as readonly { readonly name: string }[]).map((r) => r.name).sort();

/** Every row this file claims to certify, by family. */
const CERTIFIED = {
  twap_scenarios: ['backward_weighted_mean', 'stale_gap_accounting'],
  window_stale_scenarios: [
    'terminal_gap_at_close',
    'dense_window_is_fresh',
    'pre_window_quiet_not_charged',
    'mid_and_terminal_gaps_force_reject',
    'unobserved_window_is_one_gap',
  ],
} as const;

describe('corpus coverage', () => {
  // Without this, a row added upstream would be silently uncertified: the
  // lookups below are by name, so a sixth scenario would simply never be read.
  it('certifies every row of both families it claims', () => {
    expect(names(twapRows)).toEqual([...CERTIFIED.twap_scenarios].sort());
    expect(names(windowRows)).toEqual([...CERTIFIED.window_stale_scenarios].sort());
  });
});

describe('twap corpus — twap_scenarios', () => {
  it('backward_weighted_mean: records, clamps and weights backward', () => {
    const row = corpusRow<TwapSeriesRow>(twapRows, 'backward_weighted_mean');
    const acc = new TwapAccumulator({ initial: Number(row.inputs.initial) });

    const got = row.inputs.observations.map((o) => acc.observe(o.block, Number(o.previous_quote)));
    expect(got.every((p) => p !== null)).toBe(true);

    expect(acc.recorded).toHaveLength(row.recorded.length);
    row.recorded.forEach((expected, i) => {
      // 0.900 was quoted both times; the slew cap admits 0.5025 then 0.5050125.
      // Both sit exactly on the 1e9 grid, so this is equality, not closeness.
      expect(acc.recorded[i]?.value).toBe(Number(expected));
    });

    expect(acc.mean(0, 20)).toBe(Number(row.mean_0_20));
    expect(acc.mean(10, 20)).toBe(Number(row.mean_10_20));
    expect(acc.staleEvents).toBe(row.stale_events);
  });

  it('stale_gap_accounting: one 60-block gap widens the band to (1+k)^6 and counts stale', () => {
    const row = corpusRow<TwapSingleRow>(twapRows, 'stale_gap_accounting');

    // The row's `inputs` omit `o_0`; the generator seeds it from the same
    // 0.500 the sibling row carries explicitly. Pin that rather than assume it
    // — the corpus figure must be exactly `o_0·(1+κ)^6`, the widened bound of
    // 04 §7 at k = 6, or the replay below is answering a different question.
    const seed = Number(corpusRow<TwapSeriesRow>(twapRows, 'backward_weighted_mean').inputs.initial);
    expect(Number(row.recorded)).toBeCloseTo(seed * (1 + TWAP_KAPPA_DEFAULT) ** 6, 12);

    const acc = new TwapAccumulator({ initial: seed });
    const point = acc.observe(row.inputs.block, Number(row.inputs.previous_quote));

    expect(point).not.toBeNull();
    const expected = Number(row.recorded);
    const actual = point?.value ?? NaN;

    // Tolerance exception, documented rather than absorbed. The corpus computes
    // 0.5·1.005^6 in exact decimal (0.5151887546968828125), which is off-grid;
    // the chain floors every squaring step of `pow_1e9`, losing 1.39 raw units
    // in the sixth power, so the widened bound reads 0.515188754 — 0.70 raw
    // units below the exact envelope, against the 2-unit allowance below. That
    // is I-13's required direction (the admitted band must never exceed the
    // real envelope), so the sign is asserted as well as the size.
    expect(actual).toBeLessThanOrEqual(expected);
    expect(Math.abs(actual - expected)).toBeLessThan(GRID);

    expect(acc.staleEvents).toBe(row.stale_events);
  });
});

describe('twap corpus — window_stale_scenarios', () => {
  for (const name of CERTIFIED.window_stale_scenarios) {
    it(`${name}`, () => {
      const row = corpusRow<WindowStaleRow>(windowRows, name);
      const got = staleEventsIn(
        row.inputs.observations,
        row.inputs.start,
        row.inputs.end,
        row.inputs.stale_gap_blocks,
      );
      expect(got).toBe(row.stale_events);
    });
  }

  it('clips at the window start rather than reaching back for the last observation', () => {
    // The `pre_window_quiet_not_charged` rule stated directly: the 120-block
    // silence from block 20 to block 140 straddles the window open, and only the
    // 40 blocks inside [100, 200] are measured.
    expect(staleEventsIn([20, 140], 100, 200, 50)).toBe(1); // 140 -> 200 is the gap
    expect(staleEventsIn([20, 140, 190], 100, 200, 50)).toBe(0);
    // Same observation list, window opened earlier: now the silence is inside.
    expect(staleEventsIn([20, 140, 190], 0, 200, 50)).toBe(1);
  });

  it('an observation exactly at the window start is not itself a fresh point', () => {
    // `start` already inherits the value in effect, so an observation recorded
    // at `start` adds nothing; the first measured gap runs from `start`.
    expect(staleEventsIn([0, 60], 0, 60, 50)).toBe(1);
    expect(staleEventsIn([0, 40, 80], 0, 80, 50)).toBe(0);
  });
});

describe('slew cap', () => {
  it('floors the interval count and never goes below one', () => {
    expect(intervalsElapsed(60, 10)).toBe(6);
    expect(intervalsElapsed(65, 10)).toBe(6); // never 7
    expect(intervalsElapsed(59, 10)).toBe(5); // never 6
    expect(intervalsElapsed(10, 10)).toBe(1);
    expect(intervalsElapsed(5, 10)).toBe(1); // never 0
  });

  it('rounds both bounds inward on the 1e9 grid', () => {
    const band = slewBand(0.5, 60);
    expect(band.k).toBe(6);
    const exactHigh = 0.5 * 1.005 ** 6;
    const exactLow = 0.5 * 0.995 ** 6;
    expect(band.high).toBeLessThanOrEqual(exactHigh);
    expect(band.low).toBeGreaterThanOrEqual(exactLow);
    expect(exactHigh - band.high).toBeLessThan(GRID);
    expect(band.low - exactLow).toBeLessThan(GRID);
  });

  it('reads a decimal quote onto the grid point it denotes', () => {
    // Regression: `0.5025 * 1e9` is 502499999.99999994 in IEEE-754, so a plain
    // floor reads a raw unit low. 0.5025 is not a contrived value — it is the
    // accumulator's own first observation from o_0 = 0.5, so a band recomputed
    // from the displayed price has to match the band that produced it.
    const acc = new TwapAccumulator({ initial: 0.5 });
    const recorded = acc.observe(10, 0.9)?.value ?? NaN;
    expect(recorded).toBe(0.5025);

    const band = slewBand(recorded, 10);
    expect(band.high).toBe(0.5050125); // 0.5025 * 1.005, exact on the grid
    expect(band.low).toBe(0.4999875); // 0.5025 * 0.995, exact on the grid
    expect(acc.observe(20, 0.9)?.value).toBe(band.high);
  });

  it('caps a single observation move at kappa, whatever the quote says', () => {
    // I-13: one block cannot move a decision TWAP by more than kappa.
    const acc = new TwapAccumulator({ initial: 0.5 });
    expect(acc.observe(10, 1)?.value).toBeCloseTo(0.5025, 9);
    expect(acc.observe(20, 0)?.value).toBeCloseTo(0.5025 * 0.995, 9);
  });

  it('widens over a gap instead of taking a single step', () => {
    const stepwise = new TwapAccumulator({ initial: 0.5 });
    for (let b = 10; b <= 60; b += 10) stepwise.observe(b, 0.9);
    const gapped = new TwapAccumulator({ initial: 0.5 });
    gapped.observe(60, 0.9);
    // Six steps and one six-interval gap admit the same envelope: the cap prices
    // displacement in capital x time and a missing keeper buys no extra slack.
    expect(gapped.current.value).toBeCloseTo(stepwise.current.value, 8);
  });
});

describe('observation cadence', () => {
  it('records at most once per observation interval', () => {
    const acc = new TwapAccumulator({ initial: 0.5 });
    expect(acc.observe(5, 0.9)).toBeNull();
    expect(acc.observe(10, 0.9)).not.toBeNull();
    expect(acc.observe(15, 0.9)).toBeNull();
    expect(acc.observe(19, 0.9)).toBeNull();
    expect(acc.observe(20, 0.9)).not.toBeNull();
    expect(acc.recorded.map((p) => p.block)).toEqual([10, 20]);
  });

  it('an early crank is a no-op, not a failure', () => {
    const acc = new TwapAccumulator({ initial: 0.5 });
    acc.observe(10, 0.9);
    const before = acc.current;
    expect(acc.observe(11, 0.999)).toBeNull();
    expect(acc.current).toBe(before);
    expect(acc.staleEvents).toBe(0);
  });
});

describe('backward weighting', () => {
  const acc = new TwapAccumulator({ initial: 0.5 });
  acc.observe(10, 0.9);
  acc.observe(20, 0.9);

  it('weights an observation over the interval that ends at it', () => {
    expect(acc.cumulativeAt(0)).toBe(0);
    expect(acc.cumulativeAt(10)).toBeCloseTo(0.5025 * 10, 8);
    // Blocks 10..15 accrue at the observation that closes their interval.
    expect(acc.cumulativeAt(15)).toBeCloseTo(0.5025 * 10 + 0.5050125 * 5, 8);
    expect(acc.cumulativeAt(20)).toBeCloseTo(0.5025 * 10 + 0.5050125 * 10, 8);
  });

  it('never lets an observation cover time after itself', () => {
    // The block-20 observation contributes nothing to [0,10] even though it is
    // the larger value: that is what stops a closing print from moving the mean.
    expect(acc.mean(0, 10)).toBeCloseTo(0.5025, 9);
    expect(acc.mean(10, 20)).toBeCloseTo(0.5050125, 9);
  });

  it('refuses windows it cannot measure', () => {
    expect(() => acc.mean(10, 10)).toThrow(RangeError);
    expect(() => acc.mean(0, 21)).toThrow(RangeError);
    expect(() => acc.cumulativeAt(-1)).toThrow(RangeError);
  });

  it('counts its own window staleness', () => {
    const sparse = new TwapAccumulator({ initial: 0.5 });
    sparse.observe(10, 0.5);
    sparse.observe(100, 0.5);
    expect(sparse.windowStaleEvents(0, 100)).toBe(1); // 10 -> 100
    expect(sparse.windowStaleEvents(0, 200)).toBe(2); // plus 100 -> 200
    expect(sparse.staleEvents).toBe(1); // the running counter saw only 10 -> 100
  });
});

describe('staleness threshold', () => {
  it('is strictly greater than the gap', () => {
    expect(isStaleGap(MKT_STALE_GAP_BLOCKS)).toBe(false);
    expect(isStaleGap(MKT_STALE_GAP_BLOCKS + 1)).toBe(true);
    expect(isStaleGap(51, 60)).toBe(false);
  });
});

describe('coverage', () => {
  // A 72 h decision window on the 10-block grid schedules 4,320 observations.
  const start = 0;
  const end = 43_200;

  it('grades at 95% of scheduled intervals by default', () => {
    expect(coverageAtLeast(4104, start, end)).toBe(true); // exactly 95%
    expect(coverageAtLeast(4103, start, end)).toBe(false);
    expect(TWAP_COVERAGE_PCT_DEFAULT).toBe(95);
  });

  it('holds near-boundary gate books to 98%', () => {
    expect(coverageAtLeast(4234, start, end, 10, TWAP_COVERAGE_PCT_GATE_NB)).toBe(true);
    expect(coverageAtLeast(4233, start, end, 10, TWAP_COVERAGE_PCT_GATE_NB)).toBe(false);
  });

  it('reports the raw fraction, uncapped', () => {
    expect(coverageFraction(4104, start, end)).toBeCloseTo(0.95, 12);
    expect(coverageFraction(4320, start, end)).toBe(1);
    expect(coverageFraction(8640, start, end)).toBe(2);
  });

  it('fails closed on a window it cannot measure', () => {
    expect(coverageAtLeast(100, 0, 0)).toBe(false);
    expect(coverageAtLeast(100, 0, 5, 10)).toBe(false); // no whole interval
    expect(coverageAtLeast(100, start, end, 10, 101)).toBe(false);
    expect(coverageFraction(100, 0, 5, 10)).toBe(0);
  });
});

describe('contest capital (04 §7a)', () => {
  it('marks LONG at p and SHORT at 1-p, on the USDC base-unit grid', () => {
    // 1,200 USDC long and 400 USDC short at p = 0.75 mark at exactly 1,000 USDC.
    expect(markedOpenInterest(1_200 * USDC, 400 * USDC, 0.75)).toBe(1_000 * USDC);
    expect(markedOpenInterest(0, 0, 0.5)).toBe(0);
  });

  it('rounds noi_t down', () => {
    // Half a base unit of exposure is worth zero, never one.
    expect(markedOpenInterest(1, 0, 0.5)).toBe(0);
    expect(markedOpenInterest(3, 0, 0.5)).toBe(1);
  });

  it('marks at the grid point the quote denotes, not one unit below it', () => {
    // Same IEEE-754 hazard as the slew band: flooring `0.5025 * 1e9` would
    // under-mark every position by ~1e-9 of its size, and this measure gates
    // validity floors. Under-marking is the safe direction, but it is still a
    // wrong answer, and it compounds with book size.
    expect(markedOpenInterest(1_000_000, 0, 0.5025)).toBe(502_500);
    expect(markedOpenInterest(0, 1_000_000, 0.5025)).toBe(497_500);
  });

  it('nets wash flow out by construction', () => {
    // LMSR is path-independent, so a round trip restores (q_long, q_short)
    // exactly. Between two samples a trader opens 200 USDC of extra LONG and
    // closes it again: the block-20 sample sees the restored state and the
    // window mean is the base exposure alone. Nothing about the churn survives.
    const churned = new ContestCapitalAccumulator();
    churned.observe(10, 500 * USDC, 100 * USDC, 0.5);
    expect(churned.observe(20, 500 * USDC, 100 * USDC, 0.5)).toBe(300 * USDC);
    expect(churned.mean(0, 20)).toBe(300 * USDC);

    // The contrast that gives that assertion its teeth: had the 200 USDC been
    // *held* across the sample instead of round-tripped, it would have been
    // paid for. Contest capital prices exposure in capital x time, not volume.
    const held = new ContestCapitalAccumulator();
    held.observe(10, 500 * USDC, 100 * USDC, 0.5);
    expect(held.observe(20, 900 * USDC, 100 * USDC, 0.5)).toBe(500 * USDC);
    expect(held.mean(0, 20)).toBe(400 * USDC);
    expect(held.mean(0, 20)).toBeGreaterThan(churned.mean(0, 20));
  });

  it('integrates backward on the same grid as the price accumulator', () => {
    const cc = new ContestCapitalAccumulator();
    expect(cc.observe(10, 1_000 * USDC, 0, 0.5)).toBe(500 * USDC);
    expect(cc.observe(20, 0, 0, 0.5)).toBe(0);

    expect(cc.cumulativeAt(0)).toBe(0);
    expect(cc.cumulativeAt(10)).toBe(500 * USDC * 10);
    expect(cc.cumulativeAt(20)).toBe(500 * USDC * 10);
    // The window that held exposure is paid for it; the window that did not, is not.
    expect(cc.mean(0, 10)).toBe(500 * USDC);
    expect(cc.mean(10, 20)).toBe(0);
    expect(cc.mean(0, 20)).toBe(250 * USDC);
  });

  it('takes record blocks from the caller — the 10-block grid is a floor, not a rule', () => {
    // 04 §7a: the runtime integrates per event, which only ever under-counts
    // relative to the backward interval sample.
    const cc = new ContestCapitalAccumulator();
    expect(cc.observe(3, 100 * USDC, 0, 0.5)).toBe(50 * USDC);
    expect(cc.observe(4, 100 * USDC, 0, 0.5)).toBe(50 * USDC);
    expect(() => cc.observe(4, 0, 0, 0.5)).toThrow(RangeError);
    expect(cc.recorded.map((p) => p.block)).toEqual([3, 4]);
  });

  it('binds a decision pair at its shallower book', () => {
    expect(pairContestCapital(900_000 * USDC, 400_000 * USDC)).toBe(400_000 * USDC);
    // Never summed: 08 §5.4(b) adds one 400,000 dec.v_min term to pair POL depth,
    // not the two books' capital.
    expect(pairContestCapital(400_000 * USDC, 900_000 * USDC)).toBe(400_000 * USDC);
  });

  it('refuses signed quantities', () => {
    expect(() => markedOpenInterest(-1, 0, 0.5)).toThrow(RangeError);
  });
});
