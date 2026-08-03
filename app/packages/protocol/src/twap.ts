/**
 * The slew-capped TWAP accumulator — 04 §7.
 *
 * ```
 * o_t = clamp(p_prev_block, o_{t−1}·(1−κ)^k, o_{t−1}·(1+κ)^k)
 * A  += o_t · Δblocks
 * TWAP(w) = (A(end) − A(start)) / blocks
 * ```
 *
 * ## Why this runs on the 1e9 grid and not on exact numbers
 *
 * The chain stores quotes and observations as `FixedU64` on a 1e9 grid and
 * clamps there, with the rounding **directed inward** — the lower bound rounds
 * up, the upper bound rounds down — so the admitted band never exceeds the
 * exact real-arithmetic envelope (I-13). That is a deliberate one-sided error,
 * not a rounding artefact, and a client computing the band exactly would draw
 * it fractionally *wider* than the chain will accept: it would show a quote as
 * admissible that the runtime is about to clamp.
 *
 * So this reproduces the grid. Against the reference corpus (04 §5), whose
 * TWAP values are exact reals, the agreement is therefore one-sided by
 * construction: the computed bound sits inside the exact one by less than a
 * grid step. `tests/protocol` asserts exactly that relation — direction and
 * magnitude — rather than an equality with a tolerance, because the direction
 * is the invariant and a tolerance would pass on a violation of it.
 *
 * Every tunable is an argument: `mkt.obs_interval` and `mkt.kappa` are live
 * `Params` published as `Market::ObsInterval` / `Market::Kappa1e9` (02 §9), and
 * the staleness gap is 04 §7's own. None is defaulted here (15 §5.4).
 *
 * @see docs/architecture/04-markets-and-pricing.md §7
 */

import { fixedFault } from './errors.js';
import { PRICE_ONE_1E9 } from './lmsr.js';

/**
 * Saturation ceiling for the widening factor, `1e18`.
 *
 * `1e9 · 1e9`, i.e. a factor of 10⁹. The runtime caps here rather than at 2×
 * so that even a one-unit observation widens to the whole `[0,1]` band under a
 * long enough gap — a 2× cap under-widens low observations and would clamp a
 * legitimate recovery.
 */
const WIDENING_CAP = PRICE_ONE_1E9 * PRICE_ONE_1E9;

const U64_MAX = (1n << 64n) - 1n;
const U256_MAX = (1n << 256n) - 1n;

/** The `MarketParams` slice the observation path reads (02 §9; 04 §7). */
export interface ObservationParams {
  /** `Market::ObsInterval` — blocks per observation slot (launch 10). */
  readonly obsIntervalBlocks: bigint;
  /** `Market::Kappa1e9` — per-interval slew cap on the 1e9 grid (launch 5,000,000). */
  readonly kappa1e9: bigint;
  /** 04 §7's staleness threshold: a gap strictly greater than this counts (50). */
  readonly staleGapBlocks: bigint;
}

/** A book's observation state, as the runtime carries it. */
export interface ObservationState {
  /** The previous block's stored quote — the value an observation reads (04 §7). */
  readonly lastQuote1e9: bigint;
  /** The last *recorded* observation, which the slew clamp is measured from. */
  readonly lastObservation1e9: bigint;
  /** Block of that last recorded observation. */
  readonly lastObservedBlock: bigint;
  /** `A`, the price×blocks accumulator. */
  readonly cumulativePriceBlocks: bigint;
  /** Running count of gaps longer than `staleGapBlocks`. */
  readonly staleEvents: number;
}

/** The outcome of one `crank_observe` attempt. */
export interface ObservationOutcome {
  /** `undefined` when the observation interval has not elapsed — a no-op, not a failure. */
  readonly recorded: bigint | undefined;
  readonly state: ObservationState;
}

/** `floor(a · b / 1e9)`, saturating at `u64::MAX` as the runtime does. */
export function mul1e9(a: bigint, b: bigint): bigint {
  const value = (a * b) / PRICE_ONE_1E9;
  return value > U64_MAX ? U64_MAX : value;
}

/** `ceil(a · b / 1e9)`, saturating at `u64::MAX`. Companion of the lower bound. */
export function mul1e9Up(a: bigint, b: bigint): bigint {
  const product = a * b;
  const value =
    product / PRICE_ONE_1E9 + (product % PRICE_ONE_1E9 === 0n ? 0n : 1n);
  return value > U64_MAX ? U64_MAX : value;
}

/** `base^exponent` on the 1e9 grid, every step flooring. */
export function pow1e9(base: bigint, exponent: bigint): bigint {
  let result = PRICE_ONE_1E9;
  let factor = base < WIDENING_CAP ? base : WIDENING_CAP;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) {
      const next = mul1e9(result, factor);
      result = next < WIDENING_CAP ? next : WIDENING_CAP;
    }
    remaining >>= 1n;
    if (remaining > 0n) {
      const squared = mul1e9(factor, factor);
      factor = squared < WIDENING_CAP ? squared : WIDENING_CAP;
    }
  }
  return result;
}

/** `base^exponent` on the 1e9 grid, every step ceiling — the lower bound's form. */
export function pow1e9Up(base: bigint, exponent: bigint): bigint {
  let result = PRICE_ONE_1E9;
  let factor = base < WIDENING_CAP ? base : WIDENING_CAP;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) {
      const next = mul1e9Up(result, factor);
      result = next < WIDENING_CAP ? next : WIDENING_CAP;
    }
    remaining >>= 1n;
    if (remaining > 0n) {
      const squared = mul1e9Up(factor, factor);
      factor = squared < WIDENING_CAP ? squared : WIDENING_CAP;
    }
  }
  return result;
}

/**
 * The number of **whole** observation intervals a gap spans, floor, minimum 1
 * (04 §7). A 60-block gap at a 10-block interval gives 6; a 65-block gap also
 * gives 6 — never 5, never 7.
 */
export function intervalsElapsed(elapsedBlocks: bigint, obsIntervalBlocks: bigint): bigint {
  if (obsIntervalBlocks <= 0n) {
    throw fixedFault('DivisionByZero', 'observation interval must be positive');
  }
  const whole = elapsedBlocks / obsIntervalBlocks;
  return whole > 1n ? whole : 1n;
}

/**
 * The admitted band `[o·(1−κ)^k, o·(1+κ)^k]`, rounded **inward** (I-13).
 *
 * The asymmetry is the invariant: the lower bound rounds up and the upper
 * rounds down, so the computed band is always a subset of the exact one.
 * Rounding both the same way — the natural thing to write — lets extra drift
 * through on one side, which is the S1 property finding that put this rule in
 * the spec.
 */
export function slewBounds(
  lastObservation1e9: bigint,
  kappa1e9: bigint,
  intervals: bigint,
): { readonly low: bigint; readonly high: bigint } {
  if (kappa1e9 > PRICE_ONE_1E9) {
    throw fixedFault('Domain', 'kappa exceeds 1.0 on the 1e9 grid');
  }
  return {
    low: mul1e9Up(lastObservation1e9, pow1e9Up(PRICE_ONE_1E9 - kappa1e9, intervals)),
    high: mul1e9(lastObservation1e9, pow1e9(PRICE_ONE_1E9 + kappa1e9, intervals)),
  };
}

/**
 * One observation attempt at `block` — `market-core::observe_book`.
 *
 * Returns `recorded: undefined` when the interval has not elapsed. That is the
 * runtime's own no-op, and a client must render it as "not yet due" rather than
 * as a failure: a crank that arrives early changes nothing and costs nothing.
 */
export function observe(
  state: ObservationState,
  params: ObservationParams,
  block: bigint,
): ObservationOutcome {
  if (params.obsIntervalBlocks <= 0n) {
    throw fixedFault('DivisionByZero', 'observation interval must be positive');
  }
  if (block < state.lastObservedBlock + params.obsIntervalBlocks) {
    return { recorded: undefined, state };
  }
  const elapsed = block - state.lastObservedBlock;
  const staleEvents =
    elapsed > params.staleGapBlocks ? state.staleEvents + 1 : state.staleEvents;

  const intervals = intervalsElapsed(elapsed, params.obsIntervalBlocks);
  const { low, high } = slewBounds(state.lastObservation1e9, params.kappa1e9, intervals);
  const capped = state.lastQuote1e9 < low ? low : state.lastQuote1e9 > high ? high : state.lastQuote1e9;

  const cumulative = state.cumulativePriceBlocks + capped * elapsed;
  if (cumulative > U256_MAX) {
    throw fixedFault('Overflow', 'TWAP accumulator exceeds u256');
  }

  return {
    recorded: capped,
    state: {
      lastQuote1e9: state.lastQuote1e9,
      lastObservation1e9: capped,
      lastObservedBlock: block,
      cumulativePriceBlocks: cumulative,
      staleEvents,
    },
  };
}

/**
 * `TWAP(w) = (A(end) − A(start)) / blocks` between two checkpoints (04 §7).
 *
 * Floors, and must fit `u64` — the runtime's `twap_between` refuses a quotient
 * that does not, rather than truncating one.
 */
export function twapBetween(
  cumulativeAtStart: bigint,
  cumulativeAtEnd: bigint,
  blocks: bigint,
): bigint {
  if (blocks <= 0n) {
    throw fixedFault('DivisionByZero', 'TWAP window must span at least one block');
  }
  if (cumulativeAtEnd < cumulativeAtStart) {
    throw fixedFault('Domain', 'TWAP accumulator moved backwards');
  }
  const mean = (cumulativeAtEnd - cumulativeAtStart) / blocks;
  if (mean > U64_MAX) {
    throw fixedFault('Overflow', 'TWAP mean does not fit u64');
  }
  return mean;
}

/**
 * Is `(from, to]` an observation gap longer than the threshold? (04 §7)
 *
 * Strictly greater: a gap of exactly `staleGapBlocks` is not stale.
 */
export function isStaleGap(from: bigint, to: bigint, staleGapBlocks: bigint): boolean {
  return (to > from ? to - from : 0n) > staleGapBlocks;
}

/**
 * Staleness for one decision window — 04 §7, `market-core::window_stale_events`.
 *
 * Two properties that are easy to get wrong and that the corpus pins:
 *
 * * The window **clips**. A gap before `start` is not a gap inside the window,
 *   so a book that was quiet before its window opened is not charged for it;
 *   `start` inherits the observation in effect and is itself a fresh point.
 * * The **terminal** interval from the last in-window observation to `end`
 *   counts like any other. A book that goes quiet at the close is exactly as
 *   stale as one that goes quiet in the middle — and more dangerous, because
 *   the closing spot is read from the same unmoved quote the TWAP carries, so
 *   the convergence check cannot see it either.
 */
export function windowStaleEvents(
  start: bigint,
  end: bigint,
  observations: readonly bigint[],
  staleGapBlocks: bigint,
): number {
  if (end <= start) return 0;
  let events = 0;
  let previous = start;
  for (const observed of observations) {
    if (observed <= start || observed > end) continue;
    if (observed <= previous) continue;
    if (isStaleGap(previous, observed, staleGapBlocks)) events += 1;
    previous = observed;
  }
  if (isStaleGap(previous, end, staleGapBlocks)) events += 1;
  return events;
}
