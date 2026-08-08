/**
 * The welfare metric `W` and the settlement score `s` — doc 05 §4.
 *
 * This is the module the whole protocol points at: markets price `s`, the
 * decision engine compares those prices, and `s` is the geometric mean of two
 * epochs of `W`. Everything else in doc 05 §5 is a comparison of numbers this
 * file produces.
 *
 * Two properties are worth stating before the code, because they are what makes
 * the pipeline surprising:
 *
 *  - **`W` has a cliff, not a slope.** `g(S)` and `g(C)` return exactly 0 below
 *    their lower knee, so an otherwise healthy epoch — good P, good A, only a
 *    slightly concentrated collator set — scores `W = 0`. The corpus row
 *    `full_pipeline` (S = 0.83125, below θS⁻ = 0.90) is exactly that case and it
 *    scores zero, while `full_pipeline_live_gates` differs only in liveness and
 *    scores 0.4167.
 *  - **The arithmetic is normative, not incidental.** Doc 05 §4.4 requires two
 *    conforming implementations to agree bit-for-bit: ascending MetricId order,
 *    `exp2(Σ w·log2 x)` rather than a product of powers, each weighted log
 *    truncated before summation, and every multiplication floored onto the 1e9
 *    grid immediately. Reproducing the *order* is what lets this TypeScript port
 *    agree with the reference corpus instead of merely coming close.
 *
 * Doc 05 §4.6's normalization kernel (winsorize → log1p → min–max), which turns
 * raw counters into the [0,1] component values this module consumes, is not part
 * of this file: it starts one step upstream.
 */

import { cite } from './citations';
import type { Citation } from './citations';
import { EPSILON_C, EPSILON_P, EPSILON_W, THETA_C_LO_FLOOR, THETA_S_LO_FLOOR } from './constants';
import type { Pillar } from './types';
import { FIXED_SCALE, floorFixed } from './units';

export const WELFARE_CITATION: Citation = cite('05', '§4', 'pillars, W and the settlement score s');

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Gate knees and composite weights — doc 13 §1 (`welfare.thetaS`, `welfare.thetaC`,
 * `welfare.wP`/`wA`), quoted at their launch values.
 *
 * The lower knees come from `constants.ts` because they are two things at once:
 * the launch default *and* the entrenched genesis floor that no track and no
 * supermajority may go below (05 §4.1, SQ-78). The upper knees are ordinary
 * governable values with no kernel floor, so they live here.
 */
export const THETA_S_LO = THETA_S_LO_FLOOR;
export const THETA_S_HI = 0.98;
export const THETA_C_LO = THETA_C_LO_FLOOR;
export const THETA_C_HI = 0.95;
export const WEIGHT_P = 0.6;
export const WEIGHT_A = 0.4;

// ---------------------------------------------------------------------------
// The v1 metric set (doc 05 §4.3)
// ---------------------------------------------------------------------------

/**
 * A component identifier. Production ids are the frozen numbers of 05 §4.3
 * (`futarchy_primitives::metric_ids`); strings are accepted so scenario fixtures
 * and UI examples can use readable labels without inventing ids that would then
 * look canonical.
 */
export type MetricId = number | string;

/** The two pillars that enter `W` through `GeoComposite` rather than through a gate. */
export type CompositePillar = Extract<Pillar, 'P' | 'A'>;

export interface MetricSpec {
  /** Frozen and append-only: a new component gets a new id, an id is never reused. */
  readonly id: number;
  readonly symbol: string;
  readonly label: string;
  readonly pillar: Pillar;
  /** Intra-pillar weight, or `null` where the pillar carries none — `S` is a `min`. */
  readonly weight: number | null;
  /** False for a component that is admissible but not registered in the v1 spec set. */
  readonly registered: boolean;
  readonly note?: string;
}

/**
 * The canonical v1 `MetricId` assignments — doc 05 §4.3, mirrored in
 * `futarchy_primitives::metric_ids`.
 *
 * Fifteen ids are assigned; fourteen are registered. `F` is the exception and it
 * is a deliberate one, not an omission: its scale `Λ_max` has no anchor in the
 * repository and **both** error directions are unsafe (too large and a
 * persistently degraded chain never trips the S gate; too small and measurement
 * noise VOIDs cohorts on a healthy chain). Registering a component with no value
 * would make `record_snapshot` refuse forever, so v1 declines to register it —
 * and `S` can absorb that at no structural cost precisely because it is a `min`
 * with no weights to renormalize (05 §4.3.2).
 *
 * **Two namespaces, and only one of them is this list.** Ids at or above
 * {@link HOSTED_BOOK_MIN_METRIC_ID} are runtime-owned provenance for hosted
 * books and are **never** admitted as a welfare metric, which is what keeps a
 * paying outside client structurally unable to write into the number Bleavit's
 * own governance is scored on. Inside the production namespace, an id that is
 * not on this list is unassigned and fails closed rather than defaulting.
 */
/**
 * The floor of the runtime-owned namespace (doc 05 §4.3, D-20).
 *
 * Ids at or above it carry hosted-book provenance and are never welfare
 * metrics. The separation is a boundary in the id space rather than a check
 * somebody has to remember to write, which is why it holds.
 */
export const HOSTED_BOOK_MIN_METRIC_ID = 0x8000;

export const V1_METRICS: readonly MetricSpec[] = Object.freeze([
  { id: 1, symbol: 'X', label: 'XCM health', pillar: 'COnchain', weight: 0.25, registered: true },
  { id: 2, symbol: 'R', label: 'Reserve health', pillar: 'COnchain', weight: 0.25, registered: true },
  { id: 3, symbol: 'E', label: 'Economic security', pillar: 'COnchain', weight: 0.2, registered: true },
  { id: 4, symbol: 'H', label: 'Weight headroom', pillar: 'COnchain', weight: 0.15, registered: true },
  { id: 5, symbol: 'Π', label: 'Runtime integrity', pillar: 'COnchain', weight: 0.1, registered: true },
  { id: 6, symbol: 'K', label: 'Collator-set adequacy', pillar: 'COnchain', weight: 0.05, registered: true },
  { id: 10, symbol: 'U', label: 'Block production', pillar: 'S', weight: null, registered: true },
  {
    id: 11,
    symbol: 'F',
    label: 'Relay inclusion / finality',
    pillar: 'S',
    weight: null,
    registered: false,
    note: 'Reserved but inactive: Λ_max is [VERIFY], so v1 ships S = min(U, D_eff) (05 §4.3.2).',
  },
  { id: 12, symbol: 'D_eff', label: 'Collator concentration', pillar: 'S', weight: null, registered: true },
  { id: 20, symbol: 'P₁', label: 'Fees paid', pillar: 'P', weight: 0.45, registered: true },
  { id: 21, symbol: 'P₂', label: 'Economically qualified users', pillar: 'P', weight: 0.35, registered: true },
  { id: 22, symbol: 'P₃', label: 'Settled value', pillar: 'P', weight: 0.2, registered: true },
  { id: 30, symbol: 'A₁', label: 'Shipped audited upgrades', pillar: 'A', weight: 0.4, registered: true },
  { id: 31, symbol: 'A₂', label: 'Runtime performance', pillar: 'A', weight: 0.3, registered: true },
  { id: 32, symbol: 'A₃', label: 'Ecosystem integrations', pillar: 'A', weight: 0.3, registered: true },
]);

export const V1_METRICS_BY_ID: ReadonlyMap<number, MetricSpec> = new Map(
  V1_METRICS.map((m) => [m.id, m]),
);

/**
 * The incident score `I` — doc 05 §4.3/§4.4. Deliberately absent from the
 * `MetricId` list above: it is not a weighted term, so it has no place in an
 * ascending-id product. It multiplies `C` directly, with no weight and no ε
 * floor, which is what lets one S1 incident (severity 1.0) drive `C` to 0 and,
 * through `g(C)`, `W` to 0.
 */
export const INCIDENT_MULTIPLIER = Object.freeze({
  symbol: 'I',
  label: 'Incident score',
  pillar: 'CAttested' as Pillar,
  formula: 'max(0, 1 − Σ severity), S1 = 1.0, S2 = 0.4, S3 = 0.1',
  cite: cite('05', '§4.3', 'I is a pure multiplier: no weight, no ε floor'),
});

/** The frozen S-pillar ids, used to resolve a 07 §10 drop against `min(U, F, D_eff)`. */
const METRIC_U = 10;
const METRIC_F = 11;
const METRIC_D_EFF = 12;

// ---------------------------------------------------------------------------
// Fixed-point helpers
// ---------------------------------------------------------------------------

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * The 1e9-grid integer behind a value the caller already treats as on-grid.
 *
 * Deliberately tolerant: `(n/1e9) · 1e9` can land a fraction below `n` in binary
 * and a bare `Math.floor` would then hand back `n − 1`. The slack is 1e-6 *grid
 * units* — fifteen decimal places, well below what a double carries on [0,1] —
 * so it absorbs representation noise and nothing else. `floorFixed` stays the
 * right tool for a genuinely off-grid value such as an `exp2` result.
 */
const gridUnits = (x: number): number => Math.floor(x * FIXED_SCALE + 1e-6);

/**
 * The on-grid double behind a value the caller already treats as on-grid.
 *
 * `floorFixed` is the wrong tool for this and the difference is not cosmetic.
 * It floors `x · 1e9` with no slack, and `n/1e9 · 1e9` lands a fraction *below*
 * `n` for roughly 2% of the grid — `0.500000005` becomes `500000004.99999994`
 * — so re-flooring an already-floored value silently decrements it by a whole
 * grid ulp. The reference model floors `Decimal`s, where the same step is an
 * exact no-op, so every such decrement is a divergence rather than a shared
 * rounding. `floorFixed` stays the right tool one line below, on the genuinely
 * off-grid `exp2` result.
 */
const onGrid = (x: number): number => gridUnits(x) / FIXED_SCALE;

const Q64_ONE = 1n << 64n;
const GRID = 1_000_000_000n;

/**
 * Exact `floor(sqrt(n))` by Newton's method on BigInt — no double anywhere.
 *
 * This reproduces the ≥256-bit reference square root of 15 §4.4 rather than
 * approaching it. `Math.sqrt(a·b)` carries the product's relative error into a
 * value that is then floored, and at small `W` the floor amplifies it: the pair
 * (0.001032115, 0.565509108) settles **12 grid units** low in doubles, six
 * times the 2e-9 conformance band, and `sqrt(W·W)` fails to return `W` for
 * about one on-grid `W` in seventy.
 */
function integerSqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/**
 * Floored product of two on-grid values, done on the grid integers.
 *
 * `floorFixed(a * b)` in doubles is not the same function: `0.3 · 0.3` lands at
 * 0.08999999999999998 and floors to 0.089999999, a whole grid ulp below the
 * value doc 05 §4.4 specifies. Every multiplication in `g()` and in the `W`
 * product is one of these, so they compound. `floor(n_a · n_b / 1e9)` in BigInt
 * is the exact same arithmetic the chain does, and both operands here are always
 * non-negative, so BigInt truncation *is* the floor.
 */
const mulFixed = (a: number, b: number): number =>
  Number((BigInt(gridUnits(a)) * BigInt(gridUnits(b))) / GRID) / FIXED_SCALE;

/**
 * The renormalized exponent `w̃ = floor_Q64(Q64(w) / Q64(T))` — doc 05 §4.4.
 *
 * The quotient grid is normative, not an implementation detail: 05 §4.4 fixes it
 * as an unsigned Q64.64 division computed *before* multiplying by `log2(·)`, so a
 * higher-precision quotient is explicitly non-conforming. Doing it in BigInt is
 * therefore cheaper than arguing about it — the only lossy step left is the final
 * widening to a double, which is far below the 1e9 grid the result is floored onto.
 *
 * Both arguments are grid integers, not reals, because the weight *sum* has to be
 * exact too: `0.7 + 0.1` is 0.7999999999999999 in doubles, which would floor the
 * denominator to 0.799999999 and skew every exponent in the group.
 */
function renormalizedWeight(weightUnits: number, totalUnits: number): number {
  const denominator = (BigInt(totalUnits) << 64n) / GRID;
  if (denominator <= 0n) throw new RangeError('welfare: weight sum must be positive');
  const numerator = (BigInt(weightUnits) << 64n) / GRID;
  return Number((numerator << 64n) / denominator) / Number(Q64_ONE);
}

/** Ascending MetricId order (05 §4.4(2)): numeric where both ids are numbers. */
function compareMetricIds(a: MetricId, b: MetricId): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const [x, y] = [String(a), String(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Weighted geometric aggregation
// ---------------------------------------------------------------------------

export interface WeightedComponent {
  readonly id: MetricId;
  /** Normalized component value on [0,1] (05 §4.6 produces it). */
  readonly value: number;
  readonly weight: number;
}

/**
 * The intra-pillar weighted geometric mean — doc 05 §4.4(2).
 *
 * `y = exp2(Σ w_i · log2(max(x_i, ε)))`, terms visited in ascending MetricId
 * order. The ε floor is what stops one zeroed component from annihilating a
 * pillar through the logarithm; it bounds a dead component's contribution at
 * `0.01^w` instead of at 0.
 *
 * The single-term exception is not an optimization. Where exactly one term
 * participates at weight exactly 1, the group's value *is* that term: the
 * `exp2(1 · log2 x)` round trip must truncate an irrational `log2 x` to the
 * exponent grid, and that truncation alone lands one 1e-9 ulp below an on-grid
 * `x` in **both** conforming implementations — wrong rather than imprecise
 * (05 §4.4 rule 3). Renormalization is what makes weight 1 reachable, so the
 * case is production-real, not hypothetical.
 *
 * @param renormalize divide each weight by the group's weight sum on the
 *   normative Q64.64 grid — the `C_daily` on-chain subset and the 07 §10 drop
 *   recompute, which are the same quotient applied to different subsets.
 */
export function weightedGeometric(
  entries: readonly WeightedComponent[],
  epsilon: number = EPSILON_P,
  renormalize = false,
): number {
  if (entries.length === 0) throw new RangeError('welfare: a weighted group needs at least one term');
  const totalUnits = entries.reduce((sum, e) => sum + gridUnits(e.weight), 0);
  if (totalUnits <= 0) throw new RangeError('welfare: weight sum must be positive');

  const terms = [...entries]
    .sort((a, b) => compareMetricIds(a.id, b.id))
    .map((e) => {
      const units = gridUnits(e.weight);
      return {
        value: onGrid(clamp01(e.value)),
        weight: renormalize ? renormalizedWeight(units, totalUnits) : units / FIXED_SCALE,
      };
    });

  const participating = terms.filter((t) => t.weight > 0);
  const only = participating.length === 1 ? participating[0] : undefined;
  if (only !== undefined && only.weight === 1) {
    return onGrid(clamp01(Math.max(only.value, epsilon)));
  }

  // Each `w·log2(·)` is truncated toward −∞ at 64.64 before summation. That
  // truncation (5.4e-20) is finer than the double representation of the product
  // itself, so it is not modelled separately here. The residue is one grid ulp
  // and only where the true product lands exactly on the grid: measured against
  // the reference model over 816 sweep values, four differed, all by 1e-9. Every
  // step that *can* be exact in a double — the gates, D_eff, the W product, the
  // Q64 quotient — is done on grid integers above, so this is the only place
  // this port and the chain can disagree at all.
  let exponent = 0;
  for (const t of terms) exponent += t.weight * Math.log2(Math.max(t.value, epsilon));
  return floorFixed(clamp01(2 ** exponent));
}

/**
 * One group's 07 §10 settlement-time recompute — doc 05 §4.4 owns the arithmetic.
 *
 * A drop that would empty the group is **declined**: an empty weighted product is
 * 1, the most favourable value there is, so honouring it would convert total
 * unavailability of a pillar into a perfect pillar. Where an emptied group *can*
 * be renormalized one level up (P or A inside `GeoComposite`) the caller handles
 * it; where it cannot (C, S), declining is the whole answer and VOID is the
 * protocol's real response to a failed gate input.
 */
export function dropAndRenormalize(
  entries: readonly WeightedComponent[],
  dropped: readonly MetricId[],
  epsilon: number = EPSILON_P,
): number {
  const kept = entries.filter((e) => !dropped.includes(e.id));
  if (kept.length === entries.length || kept.length === 0) return weightedGeometric(entries, epsilon);
  return weightedGeometric(kept, epsilon, true);
}

// ---------------------------------------------------------------------------
// The gate and the geometric mean
// ---------------------------------------------------------------------------

/**
 * The smoothstep gate `g(x; lo, hi)` — doc 05 §4.1, rounding per §4.4(3).
 *
 * Below `lo` it is exactly 0, and that is the single most consequential fact in
 * the welfare pipeline: it makes `W` a product with a hard floor rather than a
 * weighted average, so a liveness or security failure cannot be traded off
 * against fee growth. Between the knees it is the C¹ smoothstep `3t² − 2t³`,
 * evaluated as `t·t·(3 − 2t)` with a floor after every multiplication so two
 * implementations land on the same 1e9 grid point.
 */
export function gate(x: number, lo: number, hi: number): number {
  const value = gridUnits(x);
  const low = gridUnits(lo);
  const high = gridUnits(hi);
  if (high <= low) throw new RangeError('welfare: gate needs hi > lo');
  if (value < low) return 0;
  if (value >= high) return 1;
  // Grid integers throughout: `x − lo` in doubles is already wrong at
  // 0.94 − 0.90, and `t` then feeds two more multiplications that carry it.
  const t = (BigInt(value - low) * GRID) / BigInt(high - low);
  const tSquared = (t * t) / GRID;
  return Number((tSquared * (3n * GRID - 2n * t)) / GRID) / FIXED_SCALE;
}

/**
 * The two-epoch geometric mean behind `s` — doc 05 §4.4(4).
 *
 * Written in the spec as `exp2((log2 W₁ + log2 W₂)/2)` but evaluated as the
 * square root `sqrt(W₁·W₂)`, which is the same number and lands exactly where
 * the round trip does not: the log/exp round trip floors one grid ulp short
 * whenever the true mean lies on the 1e9 grid, including the ε_W corner where a
 * doubly zeroed pair scores exactly one base unit (1e-9) rather than 0. The
 * reference model's ≥256-bit exact square root is the arbiter (15 §4.4), so the
 * root is taken on the grid integers — `floor(sqrt(n₁·n₂))` is that arbiter's
 * answer by construction, whereas `Math.sqrt` in doubles is only near it.
 *
 * The ε_W floor keeps the logarithm finite for a zeroed epoch. It is one base
 * unit, so it never rounds a real score up.
 */
export function geometricMean(a: number, b: number): number {
  const epsilonUnits = gridUnits(EPSILON_W);
  const left = BigInt(Math.max(gridUnits(a), epsilonUnits));
  const right = BigInt(Math.max(gridUnits(b), epsilonUnits));
  return clamp01(Number(integerSqrt(left * right)) / FIXED_SCALE);
}

/**
 * `s = GeoMean(W_{e+1}, W_{e+2})` over a cohort's k = 2 measurement horizon
 * (doc 05 §4.4(4)). This is what the Decision books price and what the scalar
 * vault pays out against — the only number that crosses from doc 05 into doc 03.
 */
export function settlementScore(wNext: number, wNext2: number): number {
  return geometricMean(clamp01(wNext), clamp01(wNext2));
}

// ---------------------------------------------------------------------------
// Collator concentration
// ---------------------------------------------------------------------------

/**
 * The phase-scheduled normalization target for `D_eff` — doc 05 §4.5 (D-15).
 *
 * `n_ref = 8` is the steady-state target, but a healthy 5-collator launch set
 * would score 0.914 against it and drag `g(S)` to ≈ 0.08 — i.e. the bootstrap
 * network would fail its own liveness gate for being small rather than for being
 * concentrated. The cap neutralizes the set-size penalty only; genuine
 * concentration is still punished at every phase.
 */
export function collatorNCap(phase: number): number {
  if (!Number.isInteger(phase) || phase < 0) throw new RangeError('welfare: phase must be a non-negative integer');
  if (phase <= 3) return 5;
  if (phase === 4) return 6;
  if (phase === 5) return 7;
  return 8;
}

/**
 * `D_eff = min(1, (1 − HHI) / (1 − 1/n_cap(phase)))` — doc 05 §4.5.
 *
 * HHI is the Herfindahl index of authorship shares, so equal authorship over
 * `n_cap` collators scores exactly 1 and the 40/40/10/5/5 example of §4.5
 * (HHI = 0.335) scores 0.831 — below θS⁻ = 0.90, which is the cliff the
 * `full_pipeline` corpus row lands on.
 */
export function collatorDEff(hhi: number, phase: number): number {
  if (!(hhi >= 0 && hhi <= 1)) throw new RangeError('welfare: HHI must be in [0, 1]');
  const nCap = BigInt(collatorNCap(phase));
  // (1 − HHI)·n / (n − 1) on the grid integers. A quotient that lands exactly on
  // the grid — which every clean authorship split does — is precisely where a
  // double floor can drop an ulp, and this value is compared against θS⁻.
  const raw = ((GRID - BigInt(gridUnits(hhi))) * nCap) / (nCap - 1n);
  return Math.min(1, Number(raw) / FIXED_SCALE);
}

// ---------------------------------------------------------------------------
// Pillars
// ---------------------------------------------------------------------------

interface WelfareComponents {
  /** Block production `U` (MetricId 10). */
  readonly u: number;
  /** Relay inclusion `F` (MetricId 11) — omit it for a conforming v1 spec set. */
  readonly f?: number;
  /** Incident score `I`; defaults to 1 (no filings). */
  readonly incident?: number;
  readonly cOnchain: readonly WeightedComponent[];
  /** External-price attested components; empty in v1. `I` is passed separately. */
  readonly cAttested?: readonly WeightedComponent[];
  readonly p: readonly WeightedComponent[];
  readonly a: readonly WeightedComponent[];
  /** That day's on-chain values; ids not listed here keep their epoch value. */
  readonly cDaily?: readonly { readonly id: MetricId; readonly value: number }[];
  readonly uDaily?: number;
  readonly fDaily?: number;
  /** Components a cohort must settle without (07 §10, two consecutive flagged epochs). */
  readonly dropped?: readonly MetricId[];
}

export interface PillarInputs extends WelfareComponents {
  readonly dEff: number;
  readonly dEffDaily?: number;
}

export interface PipelineInputs extends WelfareComponents {
  /** Herfindahl index of authorship shares over the epoch window. */
  readonly hhi: number;
  /** Rollout phase (doc 09) — it selects `n_cap`, not a parameter value. */
  readonly phase: number;
  readonly hhiDaily?: number;
}

export interface PillarValues {
  readonly S: number;
  readonly C: number;
  readonly P: number;
  readonly A: number;
  readonly S_daily: number;
  readonly C_daily: number;
}

export interface WelfareResult extends PillarValues {
  readonly D_eff: number;
  readonly W: number;
}

/**
 * Which of `P`/`A` lost every component to a 07 §10 drop — doc 05 §4.4 rule 2.
 *
 * An emptied pillar renormalizes one level up, onto `GeoComposite`'s own
 * `{wP, wA}`: the survivor's weight becomes 1 and the composite is that pillar
 * alone, so `W` is measured on what could be measured rather than on stale
 * carried values or a fabricated `A = 1`. Emptying both leaves nothing to
 * renormalize onto, so that drop is declined (rule 1).
 */
export function emptiedPillarGroups(
  dropped: readonly MetricId[],
  p: readonly WeightedComponent[],
  a: readonly WeightedComponent[],
): readonly CompositePillar[] {
  const empty = (group: readonly WeightedComponent[]): boolean =>
    group.length > 0 && group.every((e) => dropped.includes(e.id));
  const emptied: CompositePillar[] = [];
  if (empty(p)) emptied.push('P');
  if (empty(a)) emptied.push('A');
  return emptied.length === 2 ? [] : emptied;
}

/**
 * The four pillar values plus the two daily gate inputs — doc 05 §4.4.
 *
 * `S` is a `min` and carries no weights, which is why v1 can drop `F` from it
 * without renormalizing anything (05 §4.3.2) and why a drop that would empty it
 * is simply declined. `C` multiplies its weighted geometric mean by the incident
 * score `I` afterwards, on the same floor-immediately discipline.
 *
 * `S_daily` and `C_daily` are deliberately *not* recomputed against `dropped`:
 * they settle the gate markets, and no attested value may ever move a gate flag
 * (05 §4.2/§4.7). `C_daily` additionally renormalizes over the **on-chain subset
 * only** and never carries an attested term — that split is the whole point of
 * §4.2, and it is what stops a bonded attestation from flipping a gate outcome.
 */
export function pillarValues(inputs: PillarInputs): PillarValues {
  const dropped = inputs.dropped ?? [];
  const cAttested = inputs.cAttested ?? [];
  const joint = [...inputs.cOnchain, ...cAttested];

  const known = new Set<MetricId>([
    METRIC_U,
    METRIC_F,
    METRIC_D_EFF,
    ...joint.map((e) => e.id),
    ...inputs.p.map((e) => e.id),
    ...inputs.a.map((e) => e.id),
  ]);
  const unknown = dropped.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new RangeError(`welfare: dropped ids absent from the spec set: ${unknown.join(', ')}`);
  }

  const sTerms = [
    { id: METRIC_U, value: inputs.u },
    ...(inputs.f === undefined ? [] : [{ id: METRIC_F, value: inputs.f }]),
    { id: METRIC_D_EFF, value: inputs.dEff },
  ];
  const keptS = sTerms.filter((t) => !dropped.includes(t.id));
  const s = Math.min(...(keptS.length === 0 ? sTerms : keptS).map((t) => onGrid(t.value)));

  const cGeo = dropAndRenormalize(joint, dropped, EPSILON_C);
  const c = mulFixed(clamp01(inputs.incident ?? 1), cGeo);

  const emptied = emptiedPillarGroups(dropped, inputs.p, inputs.a);
  // An emptied P/A is inert rather than perfect: the composite renormalizes its
  // weight away entirely, so the 1 here never reaches W as a pillar value.
  const p = emptied.includes('P') ? 1 : dropAndRenormalize(inputs.p, dropped, EPSILON_P);
  const a = emptied.includes('A') ? 1 : dropAndRenormalize(inputs.a, dropped, EPSILON_P);

  const sDailyTerms = [inputs.uDaily ?? inputs.u, inputs.dEffDaily ?? inputs.dEff];
  if (inputs.f !== undefined) sDailyTerms.push(inputs.fDaily ?? inputs.f);
  const dailyTerms = inputs.cOnchain.map((e) => {
    const day = inputs.cDaily?.find((d) => d.id === e.id);
    return { id: e.id, value: day === undefined ? e.value : day.value, weight: e.weight };
  });

  return {
    S: s,
    C: c,
    P: p,
    A: a,
    S_daily: Math.min(...sDailyTerms.map(onGrid)),
    C_daily: weightedGeometric(dailyTerms, EPSILON_C, true),
  };
}

/**
 * `GeoComposite(P, A) = max(P, ε)^wP · max(A, ε)^wA` — doc 05 §4.1.
 *
 * The composite is the only part of `W` that is a trade-off: prosperity can
 * offset advancement and vice versa, because neither is a safety property. The
 * gates above it are where trade-offs stop.
 *
 * @param emptied pillars that lost every component to a 07 §10 drop; the
 *   survivor then carries weight exactly 1 and the composite is its value.
 */
export function geoComposite(
  p: number,
  a: number,
  weightP: number = WEIGHT_P,
  weightA: number = WEIGHT_A,
  emptied: readonly CompositePillar[] = [],
): number {
  const entries: readonly (WeightedComponent & { readonly id: CompositePillar })[] = [
    { id: 'P', value: onGrid(p), weight: weightP },
    { id: 'A', value: onGrid(a), weight: weightA },
  ];
  const kept = entries.filter((e) => !emptied.includes(e.id));
  if (kept.length === entries.length || kept.length === 0) return weightedGeometric(entries, EPSILON_P);
  return weightedGeometric(kept, EPSILON_P, true);
}

export interface WelfareKnobs {
  readonly thetaSLo?: number;
  readonly thetaSHi?: number;
  readonly thetaCLo?: number;
  readonly thetaCHi?: number;
  readonly weightP?: number;
  readonly weightA?: number;
  readonly emptied?: readonly CompositePillar[];
}

/**
 * `W_e = g(S) · g(C) · GeoComposite(P, A)` — doc 05 §4.1, floored per §4.4(3).
 *
 * The two multiplications are floored separately and in this order because the
 * order is normative: `floor(floor(g(S)·g(C)) · composite)`. A different
 * association can differ by an ulp, and 05 §4.4 requires bit-identical results
 * across implementations, so "close enough" is not a conformance argument.
 */
export function welfareValue(
  s: number,
  c: number,
  p: number,
  a: number,
  knobs: WelfareKnobs = {},
): number {
  const gs = gate(s, knobs.thetaSLo ?? THETA_S_LO, knobs.thetaSHi ?? THETA_S_HI);
  const gc = gate(c, knobs.thetaCLo ?? THETA_C_LO, knobs.thetaCHi ?? THETA_C_HI);
  const composite = geoComposite(
    p,
    a,
    knobs.weightP ?? WEIGHT_P,
    knobs.weightA ?? WEIGHT_A,
    knobs.emptied ?? [],
  );
  return clamp01(mulFixed(mulFixed(gs, gc), composite));
}

/**
 * Raw component values → `D_eff` → pillars → `W`, in one call (doc 05 §4.3–§4.5).
 *
 * This is the shape the conformance corpus is written against and the shape the
 * welfare scene animates: one epoch's inputs in, one epoch's `W` out. Two
 * epochs of it feed `settlementScore`.
 */
export function fullPipeline(inputs: PipelineInputs): WelfareResult {
  const dEff = collatorDEff(inputs.hhi, inputs.phase);
  const dEffDaily = inputs.hhiDaily === undefined ? dEff : collatorDEff(inputs.hhiDaily, inputs.phase);
  const pillars = pillarValues({ ...inputs, dEff, dEffDaily });
  return {
    ...pillars,
    D_eff: dEff,
    W: welfareValue(pillars.S, pillars.C, pillars.P, pillars.A, {
      emptied: emptiedPillarGroups(inputs.dropped ?? [], inputs.p, inputs.a),
    }),
  };
}

/**
 * The 07 §10 settlement-time recompute — doc 05 §4.4 owns the arithmetic.
 *
 * A component flagged in two consecutive epochs that meet inside a cohort's
 * `W_{e+1}`/`W_{e+2}` window is dropped from **both** recomputes, so this runs
 * once per horizon epoch with the same drop set. Everything else is unchanged:
 * same ε floors, same ascending-MetricId order, same immediate flooring, `I`
 * still a pure multiplier.
 */
export function fullPipelineRenormalized(
  inputs: PipelineInputs,
  dropped: readonly MetricId[],
): WelfareResult {
  if (dropped.length === 0) throw new RangeError('welfare: a recompute needs at least one dropped id');
  return fullPipeline({ ...inputs, dropped });
}
