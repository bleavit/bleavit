/**
 * The TWAP accumulator against the corpus, and the slew bound — 04 §7, 15 §4.8.
 *
 * ## Why some of these are inequalities and not equalities
 *
 * The reference model computes the observation band in exact decimals; the
 * chain computes it on a 1e9 grid with the rounding **directed inward** — the
 * lower bound up, the upper bound down — so the admitted band is always a
 * subset of the exact one (I-13). This port reproduces the chain, so where the
 * clamp binds, its recorded value differs from the corpus by less than one grid
 * step, on a known side.
 *
 * That is asserted as what it is: a *direction plus a magnitude*, computed in
 * exact integer arithmetic against the corpus's decimal string. The tempting
 * alternative — equality within some tolerance — would pass just as happily if
 * the rounding were pointed the wrong way, which is precisely the defect I-13
 * exists to prevent and which an S1 property run once found in this code's
 * Rust counterpart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICE_ONE_1E9,
  intervalsElapsed,
  isStaleGap,
  mul1e9,
  mul1e9Up,
  observe,
  pow1e9,
  pow1e9Up,
  slewBounds,
  twapBetween,
  windowStaleEvents,
} from '@bleavit/protocol';

import { decimalToRational, loadCorpus } from './corpus.js';

const corpus = loadCorpus();

/** The launch observation parameters, as 02 §9 publishes them. */
const LAUNCH_PARAMS = {
  obsIntervalBlocks: 10n,
  kappa1e9: 5_000_000n,
  staleGapBlocks: 50n,
};

/** A decimal price string on the 1e9 grid, exactly. */
function gridFromDecimal(text) {
  const { numerator, denominator } = decimalToRational(text);
  assert.equal(
    (numerator * PRICE_ONE_1E9) % denominator,
    0n,
    `${text} is not representable on the 1e9 grid; this helper may not round`,
  );
  return (numerator * PRICE_ONE_1E9) / denominator;
}

/**
 * Assert a grid value sits inside the exact real value by less than one step.
 *
 * `side` is which way the inward rounding must go: `'below'` for an upper bound
 * (rounds down), `'above'` for a lower bound (rounds up).
 */
function assertInsideExact(gridValue, exactText, side, what) {
  const { numerator, denominator } = decimalToRational(exactText);
  const scaledExact = numerator * PRICE_ONE_1E9; // exact × 1e9 × denominator
  const scaledGrid = gridValue * denominator;
  if (side === 'below') {
    assert.ok(scaledGrid <= scaledExact, `${what}: ${gridValue} is above the exact value`);
    assert.ok(
      scaledExact - scaledGrid < denominator,
      `${what}: ${gridValue} is more than one grid step below the exact value`,
    );
  } else {
    assert.ok(scaledGrid >= scaledExact, `${what}: ${gridValue} is below the exact value`);
    assert.ok(
      scaledGrid - scaledExact < denominator,
      `${what}: ${gridValue} is more than one grid step above the exact value`,
    );
  }
}

function initialState(initialPrice1e9, quote1e9) {
  return {
    lastQuote1e9: quote1e9,
    lastObservation1e9: initialPrice1e9,
    lastObservedBlock: 0n,
    cumulativePriceBlocks: 0n,
    staleEvents: 0,
  };
}

test('the TWAP corpus rows are present', () => {
  assert.equal(corpus.twap_scenarios.length, 2);
  assert.ok(corpus.window_stale_scenarios.length >= 5);
});

test('corpus `backward_weighted_mean` — two clamped observations and their window means', () => {
  const scenario = corpus.twap_scenarios.find((row) => row.name === 'backward_weighted_mean');
  assert.ok(scenario, 'the backward_weighted_mean scenario is missing');

  const initial = gridFromDecimal(scenario.inputs.initial);
  const quote = gridFromDecimal(scenario.inputs.observations[0].previous_quote);
  let state = initialState(initial, quote);

  const recorded = [];
  const checkpoints = new Map([[0n, 0n]]);
  for (const step of scenario.inputs.observations) {
    const outcome = observe(state, LAUNCH_PARAMS, BigInt(step.block));
    assert.notEqual(outcome.recorded, undefined, `no observation recorded at block ${step.block}`);
    recorded.push(outcome.recorded);
    state = outcome.state;
    checkpoints.set(BigInt(step.block), state.cumulativePriceBlocks);
  }

  // Both observations are clamped by the upper bound (the quote is far above
  // it), and both land exactly on the grid — so here the corpus and the grid
  // agree bit for bit and equality is the right assertion.
  assert.deepEqual(recorded, scenario.recorded.map(gridFromDecimal));
  assert.equal(state.staleEvents, scenario.stale_events);

  assert.equal(
    twapBetween(checkpoints.get(0n), checkpoints.get(20n), 20n),
    gridFromDecimal(scenario.mean_0_20),
  );
  assert.equal(
    twapBetween(checkpoints.get(10n), checkpoints.get(20n), 10n),
    gridFromDecimal(scenario.mean_10_20),
  );
});

test('corpus `stale_gap_accounting` — a 60-block gap widens the band by six intervals', () => {
  const scenario = corpus.twap_scenarios.find((row) => row.name === 'stale_gap_accounting');
  assert.ok(scenario, 'the stale_gap_accounting scenario is missing');

  const initial = gridFromDecimal('0.500'); // the generator's accumulator start
  const quote = gridFromDecimal(scenario.inputs.previous_quote);
  const outcome = observe(initialState(initial, quote), LAUNCH_PARAMS, BigInt(scenario.inputs.block));

  assert.notEqual(outcome.recorded, undefined);
  assert.equal(outcome.state.staleEvents, scenario.stale_events);

  // The quote is above the band, so the recorded value IS the upper bound —
  // which rounds down. It must therefore sit just below the corpus's exact
  // value, and by less than one grid step. This is the I-13 direction, and it
  // is the assertion an equality-with-tolerance would have thrown away.
  assertInsideExact(outcome.recorded, scenario.recorded, 'below', 'stale-gap upper clamp');

  // Six whole intervals, floored — 04 §7's `k = max(1, ⌊Δ/interval⌋)`.
  assert.equal(intervalsElapsed(60n, LAUNCH_PARAMS.obsIntervalBlocks), 6n);
});

test('corpus window-staleness scenarios reproduce exactly', () => {
  let checked = 0;
  for (const scenario of corpus.window_stale_scenarios) {
    const { start, end, observations, stale_gap_blocks } = scenario.inputs;
    const events = windowStaleEvents(
      BigInt(start),
      BigInt(end),
      observations.map(BigInt),
      BigInt(stale_gap_blocks),
    );
    assert.equal(events, scenario.stale_events, `window staleness differs for ${scenario.name}`);
    checked += 1;
  }
  assert.equal(checked, corpus.window_stale_scenarios.length);
  assert.ok(checked >= 5);
});

// ---------------------------------------------------------------------------
// The slew bound (15 §4.8)
// ---------------------------------------------------------------------------

test('the computed band always sits inside the exact (1±κ)^k envelope', () => {
  // Exact statement, no decimals involved: with κ on the 1e9 grid,
  //   low  · 1e9^k  ≥  o · (1e9 − κ)^k        (lower bound rounds up)
  //   high · 1e9^k  ≤  o · (1e9 + κ)^k        (upper bound rounds down)
  // Both sides are integers, so this is the invariant itself rather than a
  // sampled approximation of it.
  const kappa = LAUNCH_PARAMS.kappa1e9;
  let checked = 0;
  for (const observation of [1n, 1_000n, 250_000_000n, 500_000_000n, 999_999_999n]) {
    for (const k of [1n, 2n, 3n, 6n, 17n, 64n, 200n]) {
      const { low, high } = slewBounds(observation, kappa, k);
      const unit = PRICE_ONE_1E9 ** k;
      assert.ok(
        low * unit >= observation * (PRICE_ONE_1E9 - kappa) ** k,
        `lower bound fell below the exact envelope at o=${observation}, k=${k}`,
      );
      assert.ok(
        high * unit <= observation * (PRICE_ONE_1E9 + kappa) ** k,
        `upper bound rose above the exact envelope at o=${observation}, k=${k}`,
      );
      assert.ok(low <= high, `the band inverted at o=${observation}, k=${k}`);
      checked += 1;
    }
  }
  assert.equal(checked, 35);
});

test('a recorded observation never moves further than the band allows', () => {
  // The manipulation property: whatever the quote does, the recorded series
  // moves by at most the band. A quote pinned at either extreme is the
  // adversarial case, so both are walked.
  for (const quote of [0n, PRICE_ONE_1E9]) {
    let state = initialState(500_000_000n, quote);
    for (let step = 1n; step <= 12n; step += 1n) {
      const previous = state.lastObservation1e9;
      const { low, high } = slewBounds(previous, LAUNCH_PARAMS.kappa1e9, 1n);
      const outcome = observe(state, LAUNCH_PARAMS, step * LAUNCH_PARAMS.obsIntervalBlocks);
      assert.notEqual(outcome.recorded, undefined);
      assert.ok(
        outcome.recorded >= low && outcome.recorded <= high,
        `observation ${outcome.recorded} escaped [${low}, ${high}]`,
      );
      state = outcome.state;
    }
    // Twelve intervals at κ = 0.5 % cannot cross the book: from 0.5 the reachable
    // extremes are 0.5·(1±0.005)^12 ≈ [0.4708, 0.5309].
    assert.ok(state.lastObservation1e9 > 470_000_000n && state.lastObservation1e9 < 531_000_000n);
  }
});

test('the band widens with the gap, and the interval count floors', () => {
  const previous = 500_000_000n;
  let lastWidth = -1n;
  for (const k of [1n, 2n, 4n, 8n]) {
    const { low, high } = slewBounds(previous, LAUNCH_PARAMS.kappa1e9, k);
    const width = high - low;
    assert.ok(width > lastWidth, `the band did not widen at k=${k}`);
    lastWidth = width;
  }

  // 04 §7 is explicit that the count floors and never rounds: a 60-block gap
  // gives 6 and a 65-block gap also gives 6 — never 5, never 7.
  assert.equal(intervalsElapsed(60n, 10n), 6n);
  assert.equal(intervalsElapsed(65n, 10n), 6n);
  assert.equal(intervalsElapsed(69n, 10n), 6n);
  assert.equal(intervalsElapsed(70n, 10n), 7n);
  // And it is at least one, so a same-interval observation is still clamped.
  assert.equal(intervalsElapsed(0n, 10n), 1n);
  assert.equal(intervalsElapsed(9n, 10n), 1n);
});

test('the widening saturates so even a one-unit observation can reach the whole band', () => {
  // The runtime caps the widening factor at 1e18 rather than 2×: under a long
  // enough gap a book quoted at one raw unit must be able to recover to any
  // price, and a 2× cap would hold it down.
  const { high } = slewBounds(1n, LAUNCH_PARAMS.kappa1e9, 100_000n);
  assert.ok(high >= PRICE_ONE_1E9, `a one-unit observation could not widen to 1.0 (got ${high})`);
});

test('an observation before the interval has elapsed is a no-op, not a failure', () => {
  const state = initialState(500_000_000n, 900_000_000n);
  const early = observe(state, LAUNCH_PARAMS, LAUNCH_PARAMS.obsIntervalBlocks - 1n);
  assert.equal(early.recorded, undefined);
  assert.equal(early.state, state, 'an early crank must not mutate the accumulator');

  const due = observe(state, LAUNCH_PARAMS, LAUNCH_PARAMS.obsIntervalBlocks);
  assert.notEqual(due.recorded, undefined);
});

test('staleness is strict: a gap of exactly the threshold is not stale', () => {
  assert.equal(isStaleGap(0n, 50n, 50n), false);
  assert.equal(isStaleGap(0n, 51n, 50n), true);

  // The window form agrees, and charges the terminal gap.
  assert.equal(windowStaleEvents(0n, 50n, [], 50n), 0);
  assert.equal(windowStaleEvents(0n, 51n, [], 50n), 1);
});

test('the 1e9 helpers round in the directions their bounds require', () => {
  // `mul1e9` floors, `mul1e9Up` ceils, and they differ by at most one unit.
  const a = 333_333_333n;
  const b = 777_777_777n;
  assert.equal(mul1e9Up(a, b) - mul1e9(a, b), 1n);
  assert.equal(mul1e9(PRICE_ONE_1E9, b), b, 'multiplying by 1.0 must be exact');
  assert.equal(mul1e9Up(PRICE_ONE_1E9, b), b);

  // And the powers inherit it.
  const base = PRICE_ONE_1E9 - LAUNCH_PARAMS.kappa1e9;
  assert.ok(pow1e9Up(base, 8n) >= pow1e9(base, 8n));
  assert.equal(pow1e9(base, 0n), PRICE_ONE_1E9, 'the empty product must be 1.0');
  assert.equal(pow1e9Up(base, 0n), PRICE_ONE_1E9);
});

test('the accumulator weights each observation backward over the interval it ends', () => {
  // 04 §7: an observation never covers time after itself. Recording o at block
  // 20 after a previous point at block 10 adds o × 10, not o × 20.
  let state = initialState(500_000_000n, 500_000_000n);
  const first = observe(state, LAUNCH_PARAMS, 10n);
  assert.equal(first.state.cumulativePriceBlocks, 500_000_000n * 10n);
  state = first.state;
  const second = observe(state, LAUNCH_PARAMS, 20n);
  assert.equal(
    second.state.cumulativePriceBlocks - first.state.cumulativePriceBlocks,
    second.recorded * 10n,
  );

  // And the mean over a window of one constant value is that value.
  assert.equal(twapBetween(0n, 500_000_000n * 10n, 10n), 500_000_000n);
});
