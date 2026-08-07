/**
 * The two sample statistics 10 §9.4's render row is gated on, and the reason they are two.
 *
 * §9.4 heads its budget column *"Target (p50 / p95)"*. Those are different statistics of the
 * same sample, and only one of them is a median. Comparing a median against the p95 cell
 * tests nothing about the tail: with three runs, samples of 2 s, 2 s and 20 s have a 2 s
 * median and pass a 6 s p95 threshold while a third of the sample sits more than three times
 * over it. That is a gate reading green while measuring the wrong statistic, which is the
 * defect class this whole milestone is about (P1 on PR #254, 2026-08-06).
 *
 * So the p95 cell is gated on the sample's **tail** and the p50 cell on its median.
 *
 * ## Why the tail is the maximum here, and why that is honest rather than convenient
 *
 * `tailP95` is the nearest-rank sample percentile: the smallest observation at or above the
 * 95th percentile of the sample, `sorted[⌈0.95·n⌉ − 1]`. That index is the last one for every
 * sample of **nineteen runs or fewer** (⌈0.95·n⌉ = n exactly while 0.05·n < 1, and at twenty
 * it selects the nineteenth instead), so at the three runs this gate takes the tail is the
 * slowest run. Two things follow, and both are stated rather than assumed:
 *
 * * **It is the only defensible tail estimate at n = 3.** Estimating a population p95 from
 *   three observations is not possible at any useful confidence, and no interpolation
 *   between the second and third run would make it possible. The alternative is to declare
 *   the row unenforced, which §9.4's enforcement column does not.
 * * **It errs toward failing, never toward passing.** If the slowest of three runs is inside
 *   the threshold then every order statistic of that sample is, so a green run is a claim
 *   the sample fully supports. The error it can make is the opposite one — refusing a client
 *   whose true p95 is inside budget because one run was slow — and that direction costs a
 *   rerun rather than a shipped regression.
 *
 * The nearest-rank form is written out rather than hardcoding "the maximum" so that raising
 * `RUNS_PER_PROFILE` to twenty or beyond starts estimating a real percentile instead of
 * silently keeping a maximum under a p95 label.
 *
 * Kept in its own module, with no Lighthouse and no Chrome in it, so the comparison can be
 * tested on samples a real run cannot be made to produce — `app/tests/budgets`.
 */

/** Thresholds for one form factor, both published by 10 §9.4. */
export interface Thresholds {
  /** The p50 cell. A warning, because the document permits exceeding it. */
  readonly targetMs: number;
  /** The p95 cell. The hard failure. */
  readonly hardFailMs: number;
}

export interface Assessment {
  /** The p50 estimate, compared against `targetMs`. */
  readonly median: number;
  /** The p95 estimate, compared against `hardFailMs`. */
  readonly tail: number;
  readonly overHardFail: boolean;
  readonly overTarget: boolean;
}

/**
 * An empty sample is refused rather than defaulted.
 *
 * A statistic over no observations has no value, and every default available here reads as a
 * fast render: zero passes both thresholds, and `undefined` compares false against both.
 */
function sorted(values: readonly number[], what: string): readonly number[] {
  if (values.length === 0) {
    throw new RangeError(
      `the ${what} was computed over an empty sample. No run was recorded, and an absent ` +
        'measurement is not a fast one — every default here would pass both thresholds.',
    );
  }
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(
        `the ${what} was handed ${JSON.stringify(value)}, which is not a duration. A metric ` +
          'that produced no number is an unmeasured render, never a fast one.',
      );
    }
  }
  return [...values].sort((a, b) => a - b);
}

/** The p50 estimate. Odd sample sizes only — see `RUNS_PER_PROFILE`. */
export function median(values: readonly number[]): number {
  const order = sorted(values, 'median');
  const middle = order[Math.floor((order.length - 1) / 2)];
  if (middle === undefined) throw new RangeError('median: unreachable empty sample');
  return middle;
}

/**
 * The p95 estimate, by nearest rank. At nineteen samples or fewer this is the slowest run.
 */
export function tailP95(values: readonly number[]): number {
  const order = sorted(values, 'p95 tail');
  const observation = order[Math.ceil(0.95 * order.length) - 1];
  if (observation === undefined) throw new RangeError('tailP95: unreachable empty sample');
  return observation;
}

/** Both statistics and both comparisons, so no caller can pair them up the wrong way. */
export function assess(samples: readonly number[], thresholds: Thresholds): Assessment {
  const tail = tailP95(samples);
  const middle = median(samples);
  return {
    median: middle,
    tail,
    overHardFail: tail > thresholds.hardFailMs,
    overTarget: middle > thresholds.targetMs,
  };
}
