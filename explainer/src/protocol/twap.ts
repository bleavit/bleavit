/**
 * The time-weighted average price and the security depth that rides its grid.
 *
 * Owning spec: doc 04 §7 (TWAP accumulator) and §7a (contest capital).
 *
 * A decision is graded on a 72 h TWAP, not on a spot price, and the accumulator
 * is built so that moving that mean costs capital × time rather than one
 * well-timed block:
 *
 *  - an observation reads the **previous block's** stored quote, so a trade can
 *    never price the observation it triggers;
 *  - each observation is clamped to a slew band `(1±κ)^k` around the previous
 *    one, so the recorded series cannot jump even when the raw quote does;
 *  - the observation is weighted **backward** over the interval ending at its
 *    record block, so an observation never covers time after itself — a price
 *    posted at the close earns no weight at all.
 *
 * §7a adds `ContestCapital`: the marked value of net trader positions against
 * the maker, integrated on the same grid. It replaced gross traded notional as
 * the security-depth term because LMSR is path-independent — a round trip
 * restores `q` exactly, so wash flow nets out of `noi_t` by construction while
 * genuinely held exposure accrues.
 *
 * Arithmetic note: the chain works in `FixedU64` on the 1e9 grid and `u256` for
 * the accumulators. This module reproduces the grid exactly (bigint where a
 * product would exceed a double's exact range) and carries the cumulative sums
 * as doubles. A cumulative is exact while it stays under 2^53 ≈ 9.0e15; the
 * price accumulator reaches that only after ~9e6 blocks (≈ 625 days) and the
 * longest Bleavit window is one 42-day epoch.
 */

import { cite } from './citations';
import { FIXED_SCALE, toFixed1e9 } from './units';
import { MKT_STALE_GAP_BLOCKS } from './constants';

export const TWAP_CITATION = cite('04', '§7', 'slew-capped backward-weighted accumulator');
export const CONTEST_CAPITAL_CITATION = cite('04', '§7a', 'noi_t and PairContestCapital');

/** `mkt.kappa` — doc 13 §1. Per observation interval, kernel-bounded, META-amendable. */
export const TWAP_KAPPA_DEFAULT = 0.005;
/** `mkt.obs_interval` — doc 13 §1. One recorded observation per 10 blocks. */
export const TWAP_OBS_INTERVAL_DEFAULT = 10;
/** `dec.coverage` — doc 13 §1. A decision window owes 95% of its scheduled intervals. */
export const TWAP_COVERAGE_PCT_DEFAULT = 95;
/** `gate.nb_coverage` — doc 13 §1. A gate book trading near its boundary owes 98%. */
export const TWAP_COVERAGE_PCT_GATE_NB = 98;

// ---------------------------------------------------------------------------
// 1e9-grid arithmetic, mirroring `market_core::{mul_1e9, pow_1e9, *_up}`
// ---------------------------------------------------------------------------

const ONE_1E9 = BigInt(FIXED_SCALE);
/** `market_core::pow_1e9` saturates here so even a one-unit quote widens to the full band. */
const POW_CAP = ONE_1E9 * ONE_1E9;

const capped = (x: bigint): bigint => (x < POW_CAP ? x : POW_CAP);

const mulDown = (a: bigint, b: bigint): bigint => (a * b) / ONE_1E9;

const mulUp = (a: bigint, b: bigint): bigint => {
  const n = a * b;
  const q = n / ONE_1E9;
  return n % ONE_1E9 === 0n ? q : q + 1n;
};

/** Exponentiation by squaring on the 1e9 grid, rounding every step the same way. */
function powGrid(base: bigint, exponent: number, mul: (a: bigint, b: bigint) => bigint): bigint {
  let result = ONE_1E9;
  let factor = capped(base);
  let e = exponent;
  while (e > 0) {
    if (e % 2 === 1) result = capped(mul(result, factor));
    e = Math.floor(e / 2);
    if (e > 0) factor = capped(mul(factor, factor));
  }
  return result;
}

/**
 * Read a price onto the 1e9 grid the chain stores it on.
 *
 * `units.toFixed1e9` floors `x·1e9` directly, which is the right reading of a
 * *computed* real but the wrong reading of a decimal quote: `0.5025 · 1e9` is
 * `502499999.99999994` in IEEE-754, so a plain floor lands one raw unit below
 * the grid point the number was written to denote. That is a representation
 * artifact, not the spec's flooring, and it bites in exactly the place an
 * explainer shows its work — the accumulator records `o_t = 0.5025`, and the
 * band recomputed from that displayed price would come back one unit narrower
 * than the band the accumulator actually applied.
 *
 * A scaled value within 1e-6 raw units of an integer therefore snaps to it.
 * The worst representation error over `[0,1]` is ~3e-7 raw units (one ulp of a
 * double near 1, scaled, plus the multiply's own rounding), so the guard can
 * only ever absorb representation error; a quote genuinely below a grid point
 * still floors.
 */
const quoteToGrid = (quote: number): bigint => {
  if (!Number.isFinite(quote)) throw new RangeError('quote must be finite');
  const scaled = quote * FIXED_SCALE;
  const nearest = Math.round(scaled);
  const raw = Math.abs(scaled - nearest) < 1e-6 ? nearest : toFixed1e9(quote);
  return BigInt(Math.min(Math.max(raw, 0), FIXED_SCALE));
};

// ---------------------------------------------------------------------------
// Slew band
// ---------------------------------------------------------------------------

/**
 * How many whole observation intervals a gap spans (doc 04 §7).
 *
 * The count **floors** and is at least one: a 60-block gap gives `k = 6` and a
 * 65-block gap also gives 6, never 5 and never 7. Flooring is the conservative
 * reading — a partially elapsed interval buys no extra slew.
 */
export function intervalsElapsed(elapsedBlocks: number, obsInterval: number): number {
  if (!Number.isInteger(obsInterval) || obsInterval <= 0) {
    throw new RangeError('obs_interval must be a positive integer');
  }
  return Math.max(1, Math.floor(elapsedBlocks / obsInterval));
}

export interface SlewBand {
  /** Whole observation intervals the gap spans. */
  readonly k: number;
  /** `o_{t−1}·(1−κ)^k`, rounded **up** onto the 1e9 grid. */
  readonly low: number;
  /** `o_{t−1}·(1+κ)^k`, rounded **down** onto the 1e9 grid. */
  readonly high: number;
}

/**
 * The admitted band for the next observation (doc 04 §7, invariant I-13).
 *
 * Both bounds round **inward** on the fixed-point grid — lower up, upper down —
 * so the admitted band never exceeds the exact real-arithmetic envelope. Doing
 * it the other way round would let per-step flooring accumulate into extra
 * downward drift, which is how the S1 property suite found the bug.
 */
export function slewBand(
  previous: number,
  elapsedBlocks: number,
  kappa: number = TWAP_KAPPA_DEFAULT,
  obsInterval: number = TWAP_OBS_INTERVAL_DEFAULT,
): SlewBand {
  const k = intervalsElapsed(elapsedBlocks, obsInterval);
  const band = slewBandRaw(quoteToGrid(previous), quoteToGrid(kappa), k);
  return { k, low: Number(band.low) / FIXED_SCALE, high: Number(band.high) / FIXED_SCALE };
}

function slewBandRaw(
  previousRaw: bigint,
  kappaRaw: bigint,
  k: number,
): { readonly low: bigint; readonly high: bigint } {
  return {
    low: mulUp(previousRaw, powGrid(ONE_1E9 - kappaRaw, k, mulUp)),
    high: mulDown(previousRaw, powGrid(ONE_1E9 + kappaRaw, k, mulDown)),
  };
}

// ---------------------------------------------------------------------------
// Staleness and coverage
// ---------------------------------------------------------------------------

/**
 * Is a gap between two known-fresh blocks a stale event? (doc 04 §7)
 *
 * Strictly greater: a gap of exactly `mkt.obs_interval`-multiples up to the
 * threshold is the cadence working, not failing. The first stale event inside a
 * decision window extends the pair once by 3 days; the second forces reject.
 */
export function isStaleGap(gap: number, threshold: number = MKT_STALE_GAP_BLOCKS): boolean {
  return gap > threshold;
}

/**
 * Stale observation gaps inside one decision window (doc 04 §7; `market_core::window_stale_events`).
 *
 * Two boundary rules that the corpus pins and that neither a running counter nor
 * a naive gap scan gets right:
 *
 *  - the window **clips** the measurement. Observations at or before `start` are
 *    ignored and `start` is itself a fresh point, because it inherits the
 *    observation value in effect. A book that was quiet before its window opened
 *    is not charged for that quiet.
 *  - the **terminal** interval from the last in-window observation to `end` is a
 *    gap like any other, and the more dangerous one: the closing spot is read
 *    from the same unmoved quote the TWAP already carries, so the convergence
 *    check cannot see the staleness either.
 */
export function staleEventsIn(
  observationBlocks: readonly number[],
  start: number,
  end: number,
  staleGapBlocks: number = MKT_STALE_GAP_BLOCKS,
): number {
  if (end <= start) return 0;
  let events = 0;
  let previous = start;
  for (const block of observationBlocks) {
    if (block <= start || block > end) continue;
    if (block <= previous) continue;
    if (isStaleGap(block - previous, staleGapBlocks)) events += 1;
    previous = block;
  }
  if (isStaleGap(end - previous, staleGapBlocks)) events += 1;
  return events;
}

/** Scheduled observation intervals in a window — the coverage denominator. */
function scheduledIntervals(start: number, end: number, obsInterval: number): number {
  if (!Number.isInteger(obsInterval) || obsInterval <= 0) return 0;
  if (end <= start) return 0;
  return Math.floor((end - start) / obsInterval);
}

/**
 * The fraction of scheduled intervals that actually recorded (doc 05 §5.2).
 *
 * Not clamped to 1: a book observed more often than its schedule requires reads
 * above 100%, and hiding that would hide a misconfigured keeper.
 */
export function coverageFraction(
  observationCount: number,
  start: number,
  end: number,
  obsInterval: number = TWAP_OBS_INTERVAL_DEFAULT,
): number {
  const expected = scheduledIntervals(start, end, obsInterval);
  return expected > 0 ? observationCount / expected : 0;
}

/**
 * Coverage check for decision grading (doc 05 §5.2; `market_core::coverage_at_least`).
 *
 * Compared as `count·100 ≥ expected·pct` rather than as a ratio, so no rounding
 * decision sits between a book and its grade. A window with no scheduled
 * interval fails closed — an unmeasurable window never grades (G-1).
 */
export function coverageAtLeast(
  observationCount: number,
  start: number,
  end: number,
  obsInterval: number = TWAP_OBS_INTERVAL_DEFAULT,
  requiredPct: number = TWAP_COVERAGE_PCT_DEFAULT,
): boolean {
  if (requiredPct < 0 || requiredPct > 100) return false;
  const expected = scheduledIntervals(start, end, obsInterval);
  return expected > 0 && observationCount * 100 >= expected * requiredPct;
}

// ---------------------------------------------------------------------------
// The price accumulator
// ---------------------------------------------------------------------------

export interface TwapObservation {
  readonly block: number;
  /** `o_t` as a real on [0,1]. */
  readonly value: number;
  /** `o_t` exactly as the chain stores it: an integer on the 1e9 grid. */
  readonly raw1e9: number;
  /** `A(block) = Σ o·Δblocks`, in 1e9-grid units × blocks. */
  readonly cumulativeRaw: number;
}

export interface TwapAccumulatorOptions {
  /** `o_0`, the quote in effect when the book opened. */
  readonly initial: number;
  /** `mkt.kappa`. */
  readonly kappa?: number;
  /** `mkt.obs_interval`. */
  readonly obsInterval?: number;
  /** Doc 13 §3 / doc 04 §7 `MKT_STALE_GAP_BLOCKS` = 50; a kernel constant, not a registry row. */
  readonly staleGapBlocks?: number;
}

/**
 * The per-book TWAP accumulator of doc 04 §7.
 *
 * Mirrors `market_core::observe_book`, including its refusal to record twice
 * inside one observation interval, and reproduces the reference model's
 * `TwapAccumulator` that the Rust differential suites replay.
 */
export class TwapAccumulator {
  readonly kappa: number;
  readonly obsInterval: number;
  readonly staleGapBlocks: number;

  readonly #kappaRaw: bigint;
  readonly #points: TwapObservation[];
  #staleEvents = 0;

  constructor(options: TwapAccumulatorOptions) {
    const kappa = options.kappa ?? TWAP_KAPPA_DEFAULT;
    const obsInterval = options.obsInterval ?? TWAP_OBS_INTERVAL_DEFAULT;
    if (!Number.isInteger(obsInterval) || obsInterval <= 0) {
      throw new RangeError('obs_interval must be a positive integer');
    }
    if (!(kappa >= 0 && kappa <= 1)) throw new RangeError('kappa must lie in [0,1]');
    this.kappa = kappa;
    this.obsInterval = obsInterval;
    this.staleGapBlocks = options.staleGapBlocks ?? MKT_STALE_GAP_BLOCKS;
    this.#kappaRaw = quoteToGrid(kappa);
    const raw = quoteToGrid(options.initial);
    this.#points = [
      {
        block: 0,
        value: Number(raw) / FIXED_SCALE,
        raw1e9: Number(raw),
        cumulativeRaw: 0,
      },
    ];
  }

  /** The observations recorded since the book opened. The `o_0` seed is not one. */
  get recorded(): readonly TwapObservation[] {
    return this.#points.slice(1);
  }

  /** The value in effect: the last recorded observation, or `o_0`. */
  get current(): TwapObservation {
    return this.#points[this.#points.length - 1] as TwapObservation;
  }

  /** The book-level running counter — `MarketBook.stale_events`, a diagnostic. */
  get staleEvents(): number {
    return this.#staleEvents;
  }

  /**
   * Record one observation from the **previous** block's stored quote (doc 04 §7).
   *
   * Returns `null` when the block falls inside the current observation interval:
   * the chain returns `Ok(None)` there rather than erroring, so a keeper cranking
   * too eagerly is a no-op and never a failed extrinsic.
   */
  observe(block: number, previousQuote: number): TwapObservation | null {
    const previous = this.current;
    if (block < previous.block + this.obsInterval) return null;

    const elapsed = block - previous.block;
    if (isStaleGap(elapsed, this.staleGapBlocks)) this.#staleEvents += 1;

    const k = intervalsElapsed(elapsed, this.obsInterval);
    const { low, high } = slewBandRaw(BigInt(previous.raw1e9), this.#kappaRaw, k);
    const quote = quoteToGrid(previousQuote);
    // Exactly `market_core`'s `prev.clamp(low, high)`: test the lower bound
    // first, so if inward rounding ever crossed the two the *lower* one wins.
    // `min(max(q, low), high)` would resolve that case the other way.
    const raw = quote < low ? low : quote > high ? high : quote;

    const point: TwapObservation = {
      block,
      value: Number(raw) / FIXED_SCALE,
      raw1e9: Number(raw),
      cumulativeRaw: previous.cumulativeRaw + Number(raw) * elapsed,
    };
    this.#points.push(point);
    return point;
  }

  /**
   * `A(block)` — the accumulator, weighted backward (doc 04 §7).
   *
   * Inside an interval the value being accrued is the observation that **ends**
   * it, because that observation covers the interval it closes and nothing after.
   */
  cumulativeAt(block: number): number {
    return this.#cumulativeRawAt(block) / FIXED_SCALE;
  }

  /** `TWAP(w) = (A(end) − A(start)) / blocks` (doc 04 §7). O(1) on the chain via checkpoints. */
  mean(from: number, to: number): number {
    if (to <= from) throw new RangeError('window must have positive length');
    const span = this.#cumulativeRawAt(to) - this.#cumulativeRawAt(from);
    return span / ((to - from) * FIXED_SCALE);
  }

  /** Stale gaps inside `[start, end]`, using this book's recorded blocks. */
  windowStaleEvents(start: number, end: number): number {
    return staleEventsIn(
      this.recorded.map((p) => p.block),
      start,
      end,
      this.staleGapBlocks,
    );
  }

  #cumulativeRawAt(block: number): number {
    const first = this.#points[0] as TwapObservation;
    const last = this.current;
    if (block < first.block || block > last.block) {
      throw new RangeError('block is outside the recorded accumulator');
    }
    if (block === first.block) return first.cumulativeRaw;
    for (let i = 1; i < this.#points.length; i += 1) {
      const left = this.#points[i - 1] as TwapObservation;
      const right = this.#points[i] as TwapObservation;
      if (block <= right.block) {
        return left.cumulativeRaw + right.raw1e9 * (block - left.block);
      }
    }
    return last.cumulativeRaw;
  }
}

// ---------------------------------------------------------------------------
// Contest capital (doc 04 §7a)
// ---------------------------------------------------------------------------

/**
 * `noi_t = q_long·p + q_short·(1−p)` in USDC base units (doc 04 §7a).
 *
 * `q_long`/`q_short` are the maker's **net trader** sold quantities — the LMSR
 * cost-function state. POL exclusion is structural rather than subtractive:
 * seeding mints complete sets into the book account and never touches `q`, so
 * the protocol-seeded position is identically zero here and no POL storage is
 * read. A caller holding gross coordinates must net them first; that is a
 * fixture convenience, not a production read.
 *
 * Marked at the **raw** previous-block stored quote, not at the κ-clamped `o_t`:
 * the slew cap is a price-series property and takes no part in valuing capital.
 * Rounds down — the measure feeds validity floors, so under-counting is the safe
 * direction.
 */
export function markedOpenInterest(qLong: number, qShort: number, priceLong: number): number {
  if (qLong < 0 || qShort < 0) throw new RangeError('quantities are unsigned');
  if (!Number.isFinite(qLong) || !Number.isFinite(qShort)) {
    throw new RangeError('quantities must be finite');
  }
  const pLong = quoteToGrid(priceLong);
  const pShort = ONE_1E9 - pLong;
  const marked = BigInt(Math.floor(qLong)) * pLong + BigInt(Math.floor(qShort)) * pShort;
  return Number(marked / ONE_1E9);
}

export interface ContestCapitalPoint {
  readonly block: number;
  /** `noi_t` in USDC base units, floored. */
  readonly noi: number;
  /** `N(block) = Σ noi·Δblocks`, in base units × blocks. */
  readonly cumulative: number;
}

/**
 * The doc 04 §7a contest-capital accumulator: `N += noi_t·Δblocks`.
 *
 * Same discipline as the price accumulator — previous-block state, backward
 * weighting, `(N(end) − N(start))/blocks` over the same checkpoints — with one
 * deliberate difference: there is no observation-interval gate. §7a names the
 * 10-block grid the *coarsest* admissible recording and lets an implementation
 * integrate per-event, which only ever under-counts; the runtime does exactly
 * that. Record blocks are therefore caller-supplied here.
 *
 * There is no slew clamp either. κ prices price movement; wash flow already nets
 * out of `noi_t` because LMSR is path-independent, so a round trip restores `q`
 * and buys no contest capital at all.
 */
export class ContestCapitalAccumulator {
  readonly #points: ContestCapitalPoint[] = [{ block: 0, noi: 0, cumulative: 0 }];

  /** The recorded samples. The zero seed at block 0 is not one. */
  get recorded(): readonly ContestCapitalPoint[] {
    return this.#points.slice(1);
  }

  get current(): ContestCapitalPoint {
    return this.#points[this.#points.length - 1] as ContestCapitalPoint;
  }

  /** Record `noi_t` from the previous block's stored quantities and quote. */
  observe(block: number, qLong: number, qShort: number, priceLong: number): number {
    const previous = this.current;
    if (block <= previous.block) throw new RangeError('block must increase');
    const noi = markedOpenInterest(qLong, qShort, priceLong);
    this.#points.push({
      block,
      noi,
      cumulative: previous.cumulative + noi * (block - previous.block),
    });
    return noi;
  }

  /** `N(block)`, with `noi_i` weighting the backward interval it closes. */
  cumulativeAt(block: number): number {
    const first = this.#points[0] as ContestCapitalPoint;
    const last = this.current;
    if (block < first.block || block > last.block) {
      throw new RangeError('block is outside the recorded accumulator');
    }
    if (block === first.block) return first.cumulative;
    for (let i = 1; i < this.#points.length; i += 1) {
      const left = this.#points[i - 1] as ContestCapitalPoint;
      const right = this.#points[i] as ContestCapitalPoint;
      if (block <= right.block) return left.cumulative + right.noi * (block - left.block);
    }
    return last.cumulative;
  }

  /** `ContestCapital(w) = (N(end) − N(start)) / blocks`, in USDC base units. */
  mean(from: number, to: number): number {
    if (to <= from) throw new RangeError('window must have positive length');
    return (this.cumulativeAt(to) - this.cumulativeAt(from)) / (to - from);
  }
}

/**
 * `PairContestCapital(w) = min(CC_accept, CC_reject)` (doc 04 §7a).
 *
 * The shallower book binds, because an attacker picks the cheaper side to move.
 * The two are never summed for this term — only the separate flow ceiling
 * retains `b_acc + b_rej`.
 */
export function pairContestCapital(accept: number, reject: number): number {
  return Math.min(accept, reject);
}
