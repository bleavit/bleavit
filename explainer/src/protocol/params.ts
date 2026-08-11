/**
 * The doc 13 §1 constitution registry — the governable parameters, as data.
 *
 * Doc 13 is the only home for parameter values (doc 13, reading rule 1). This
 * module is the local echo of that rule: nothing else in this app may restate a
 * number that has a row here, exactly as the chain forbids hardcoding a value
 * the runtime exposes through metadata or storage (doc 02 §13(4)).
 *
 * Every row reproduces the genesis record from
 * `constitution_core::genesis_params()`, which is itself the materialization of
 * the doc 13 §1 table. Two projections of the same number are carried, because
 * doc 13 reading rule 8 keeps them distinct and the UI needs both:
 *
 *  - `raw` — the inner scalar the chain stores (`Fixed` on the 1e9 grid,
 *    `Perbill` in parts per billion, `Percent` as integer percent, `Balance` in
 *    base units, integers natively). This is what a `ParamView` carries.
 *  - `value`, `min`, `max` — the same quantity in the human unit printed in the
 *    doc 13 `Unit` column. A market fee is 30 bps to a reader and 3,000,000 ppb
 *    to the chain; both are true, and only one of them belongs on screen.
 *
 * `min`/`max` are the genesis record's own bounds. Where the record's ceiling is
 * the maximum of its type — the "—" of the doc 13 table, and the arming
 * sentinel of the phase-3 caps (13 §1, unbounded-sentinel note) — `max` is
 * omitted rather than rendered as a number, because that sentinel means
 * "unbounded", not `u128::MAX`.
 *
 * Cross-key couplings that a static record cannot express (`dec.sigma ≤ δ/2`,
 * `gate.eps ≤ p_max/2`, `welfare.wP + wA = 1`, the `gate.v_min` band against
 * the live `dec.v_min`) bind at the consuming engine or at the amendment
 * boundary; the bounds below are the deliberately conservative
 * over-approximations doc 13 reading rule 7 seeds.
 */

import { cite } from './citations';
import type { Citation } from './citations';
import type { GateBearingClass } from './types';

/**
 * The six record classes of doc 13 reading rule 7. `Const` and `Entrenched`
 * project onto `Constitutional` in a `ParamView`, `MetaAndValues` onto `Meta` —
 * the projection is lossy, so the registry keeps the six.
 */
export type ParamClass = 'Param' | 'Treasury' | 'Meta' | 'Const' | 'Entrenched' | 'MetaAndValues';

/** The `ParamValue` variant the record holds (doc 02 §4). */
export type ParamKind = 'u8' | 'u32' | 'balance' | 'fixed' | 'percent' | 'perbill';

/**
 * Whether the *spec* has settled this number.
 *
 * Doc 13 reading rule 4: every default is a simulation hypothesis unless marked
 * frozen. A `verify` row still carries a `[VERIFY]` tag in doc 13; a `sim-gated`
 * row is bound to a calibration artifact and cannot move away from it without
 * re-running the doc 09 §7.1 Phase-0 gate. Both are legitimate states, not
 * defects — and both must be visible, because a reader who cannot tell a
 * calibrated number from a placeholder has learned the wrong thing.
 */
export type Verification =
  | { readonly status: 'settled' }
  | { readonly status: 'verify'; readonly note: string }
  | { readonly status: 'sim-gated'; readonly note: string };

export interface ParamRow {
  /** The canonical dotted `ParamKey` of doc 13 reading rule 6, e.g. `dec.delta.trs`. */
  readonly key: string;
  readonly kind: ParamKind;
  /** Human/display unit — doc 13's `Unit` column, never the encoding. */
  readonly unit: string;
  /** Genesis default, in the row's display unit. */
  readonly value: number;
  /** The stored scalar, as the chain holds it. */
  readonly raw: number;
  /** Hard bounds, in the display unit. Absent where the record has no ceiling. */
  readonly min?: number;
  readonly max?: number;
  /** Largest single amendment step, as doc 13 writes it (`×2`, `25%`, `0.005`). */
  readonly maxDelta?: string;
  /** Epochs that must pass before the same key may be amended again. */
  readonly cooldownEpochs?: number;
  readonly paramClass: ParamClass;
  /** Kernel-bounded rows refuse `amend_registry` outright (doc 13 reading rule 7). */
  readonly kernelBounded: boolean;
  readonly verification: Verification;
  /** One plain sentence: what this parameter does. */
  readonly blurb: string;
  readonly cite: Citation;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

const SETTLED: Verification = { status: 'settled' };
const verify = (note: string): Verification => ({ status: 'verify', note });
const simGated = (note: string): Verification => ({ status: 'sim-gated', note });

/** Bound to `simulation/results/phase0-calibration.json`; moving it re-opens the 09 §7.1 gate. */
const PHASE0 = 'Adopted from the published Phase-0 calibration artifact; a change away from it must re-run the doc 09 §7.1 exit gate.';

interface RowSpec {
  key: string;
  kind: ParamKind;
  unit: string;
  value: number;
  raw: number;
  min?: number;
  max?: number;
  maxDelta?: string;
  cooldown: number;
  cls: ParamClass;
  kb?: boolean;
  v?: Verification;
  /** Component document that owns the *behavior* the value drives. */
  owner: string;
  blurb: string;
}

function row(s: RowSpec): ParamRow {
  return {
    key: s.key,
    kind: s.kind,
    unit: s.unit,
    value: s.value,
    raw: s.raw,
    ...(s.min === undefined ? {} : { min: s.min }),
    ...(s.max === undefined ? {} : { max: s.max }),
    ...(s.maxDelta === undefined ? {} : { maxDelta: s.maxDelta }),
    cooldownEpochs: s.cooldown,
    paramClass: s.cls,
    kernelBounded: s.kb ?? false,
    verification: s.v ?? SETTLED,
    blurb: s.blurb,
    cite: cite('13', '§1', s.owner),
  };
}

/** Doc 13's per-class ordering: PARAM / TREASURY / CODE / META, everywhere. */
const CLASS_ORDER = ['Param', 'Treasury', 'Code', 'Meta'] as const;

/** The class suffixes of doc 13 reading rule 6. */
export const CLASS_SUFFIX: Readonly<Record<GateBearingClass, string>> = Object.freeze({
  Param: 'param',
  Treasury: 'trs',
  Code: 'code',
  Meta: 'meta',
});

type Quad = readonly [number, number, number, number];
type QuadIndex = 0 | 1 | 2 | 3;

const QUAD_INDEX: readonly QuadIndex[] = [0, 1, 2, 3];

const pick = (q: Quad | number | undefined, i: QuadIndex): number | undefined =>
  q === undefined ? undefined : typeof q === 'number' ? q : q[i];

interface FamilySpec {
  /** Base key without the class suffix, e.g. `dec.delta`. */
  base: string;
  kind: ParamKind;
  unit: string;
  values: Quad;
  raws: Quad;
  min?: Quad | number;
  max?: Quad | number;
  maxDelta?: string;
  cooldown: number;
  cls: ParamClass;
  kb?: boolean;
  v?: Verification;
  owner: string;
  blurb: string;
}

/** Materialize a per-class doc 13 row as its four suffixed keys. */
function family(s: FamilySpec): ParamRow[] {
  return QUAD_INDEX.map((i) => {
    const min = pick(s.min, i);
    const max = pick(s.max, i);
    return row({
      key: `${s.base}.${CLASS_SUFFIX[CLASS_ORDER[i]]}`,
      kind: s.kind,
      unit: s.unit,
      value: s.values[i],
      raw: s.raws[i],
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      ...(s.maxDelta === undefined ? {} : { maxDelta: s.maxDelta }),
      cooldown: s.cooldown,
      cls: s.cls,
      ...(s.kb === undefined ? {} : { kb: s.kb }),
      ...(s.v === undefined ? {} : { v: s.v }),
      owner: s.owner,
      blurb: s.blurb,
    });
  });
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * Every row of the doc 13 §1 table that `constitution_core::genesis_params()`
 * seeds — all 113 keys, in doc 13's own table order.
 */
export const PARAMS: readonly ParamRow[] = Object.freeze([
  // --- Clock ---------------------------------------------------------------
  row({
    key: 'epoch.length',
    kind: 'u32',
    unit: 'blocks',
    value: 302_400,
    raw: 302_400,
    min: 201_600,
    max: 604_800,
    maxDelta: '10%',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 05',
    blurb: 'Length of one epoch; every phase boundary is a fixed 21st of it, so the whole schedule moves with this one number.',
  }),
  row({
    key: 'epoch.slots',
    kind: 'u8',
    unit: 'slots',
    value: 5,
    raw: 5,
    min: 1,
    max: 12,
    maxDelta: '2',
    cooldown: 1,
    cls: 'Meta',
    owner: 'owner 05 §3',
    blurb: 'How many proposals may hold an active decision slot in one epoch.',
  }),
  row({
    key: 'epoch.horizon_k',
    kind: 'u8',
    unit: 'epochs',
    value: 2,
    raw: 2,
    min: 1,
    max: 2,
    maxDelta: '1',
    cooldown: 4,
    cls: 'MetaAndValues',
    kb: true,
    owner: 'owner 05 §3.3',
    blurb: 'How many epochs a cohort is measured for before it settles; the ceiling is kernel because the other cohort slots are spoken for.',
  }),

  // --- Markets -------------------------------------------------------------
  row({
    key: 'mkt.obs_interval',
    kind: 'u32',
    unit: 'blocks',
    value: 10,
    raw: 10,
    min: 5,
    max: 50,
    maxDelta: '5',
    cooldown: 1,
    cls: 'Param',
    owner: 'owner 04 §3',
    blurb: 'Block spacing of the scheduled price observations the TWAP accumulates.',
  }),
  row({
    key: 'mkt.kappa',
    kind: 'fixed',
    unit: 'per interval',
    value: 0.005,
    raw: 5_000_000,
    min: 0.001,
    max: 0.02,
    maxDelta: '0.002',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 04',
    blurb: 'Cap on how far the TWAP anchor may slew per observation interval, which is what makes a flash price move unprofitable.',
  }),
  row({
    key: 'mkt.fee',
    kind: 'perbill',
    unit: 'bps',
    value: 30,
    raw: 3_000_000,
    min: 5,
    max: 100,
    maxDelta: '10 bps',
    cooldown: 1,
    cls: 'Param',
    owner: 'owner 04',
    blurb: 'LMSR trade fee, charged on the cost of every trade and always rounded up.',
  }),
  row({
    // The ceiling is the largest clean value strictly inside the wash
    // break-even `2 × mkt.fee / 0.99`, which is 60.6 bps at the `mkt.fee`
    // default. The max Δ is absolute rather than a factor because the floor is
    // 0, and a factor rule can never raise a rate that reached its floor.
    key: 'rwd.rate',
    kind: 'perbill',
    unit: 'bps',
    value: 25,
    raw: 2_500_000,
    min: 0,
    max: 60,
    maxDelta: '25 bps',
    cooldown: 1,
    cls: 'Param',
    owner: 'owner 08',
    blurb:
      'Share of a trader’s realized net profit paid as an accuracy reward, computed in USDC and converted to VIT once at claim.',
  }),

  // --- Decision window and hurdle -----------------------------------------
  row({
    key: 'dec.window',
    kind: 'u32',
    unit: 'blocks',
    value: 43_200,
    raw: 43_200,
    min: 14_400,
    max: 86_400,
    maxDelta: '20%',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 05',
    blurb: 'The window whose TWAP the hurdle is read from — the last 72 hours of trading.',
  }),
  row({
    key: 'dec.trailing',
    kind: 'u32',
    unit: 'blocks',
    value: 14_400,
    raw: 14_400,
    min: 3_600,
    max: 28_800,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05',
    blurb: 'Trailing sub-window that must agree with the full window before a decision is allowed to resolve.',
  }),
  ...family({
    base: 'dec.delta',
    kind: 'fixed',
    unit: 's-units',
    values: [0.0375, 0.0375, 0.06, 0.09],
    raws: [37_500_000, 37_500_000, 60_000_000, 90_000_000],
    min: 0.005,
    max: 0.1,
    maxDelta: '0.005',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 05; scaling 08 §5.3',
    blurb: 'The margin by which the ACCEPT branch must beat the effective REJECT floor before a proposal may pass.',
  }),
  ...family({
    base: 'dec.sigma',
    kind: 'fixed',
    unit: 's-units',
    values: [0.003, 0.005, 0.008, 0.01],
    raws: [3_000_000, 5_000_000, 8_000_000, 10_000_000],
    min: 0,
    max: 0.05,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 05 §5.3',
    blurb: 'How far below the epoch Baseline TWAP the effective REJECT floor may sit, so suppressing the reject leg cannot lower the bar.',
  }),
  row({
    key: 'dec.delta_max',
    kind: 'fixed',
    unit: 's-units',
    value: 0.05,
    raw: 50_000_000,
    min: 0.02,
    max: 0.1,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05 §5.2',
    blurb: 'Largest admissible gap between a book’s closing spot and its window TWAP; beyond it the book is not decision-grade.',
  }),
  row({
    key: 'dec.coverage',
    kind: 'percent',
    unit: '%',
    value: 95,
    raw: 95,
    min: 90,
    max: 99,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05 §5.2',
    blurb: 'Share of the scheduled observation intervals a welfare book must actually carry to count.',
  }),
  ...family({
    base: 'dec.v_min',
    kind: 'balance',
    unit: 'USDC',
    values: [100_000, 250_000, 600_000, 1_200_000],
    raws: [100_000_000_000, 250_000_000_000, 600_000_000_000, 1_200_000_000_000],
    min: [10_000, 25_000, 60_000, 120_000],
    max: [1_000_000, 2_500_000, 6_000_000, 12_000_000],
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05; the 2·InCapPrize term is kernel, 08 §5.3',
    blurb: 'Contest capital each decision book must individually attract; this is the floor, and the effective value is max(floor, 2·InCapPrize).',
  }),

  // --- Gate books ----------------------------------------------------------
  row({
    key: 'gate.p_max',
    kind: 'fixed',
    unit: 'probability',
    value: 0.05,
    raw: 50_000_000,
    min: 0,
    max: 0.1,
    maxDelta: '0.01',
    cooldown: 4,
    cls: 'MetaAndValues',
    kb: true,
    owner: 'owner 05 §5',
    blurb: 'A gate book vetoes once the adopt-side probability of the bad outcome exceeds this; the 0.10 ceiling is kernel.',
  }),
  ...family({
    base: 'gate.v_min',
    kind: 'balance',
    unit: 'USDC',
    values: [10_000, 25_000, 60_000, 120_000],
    raws: [10_000_000_000, 25_000_000_000, 60_000_000_000, 120_000_000_000],
    min: [5_000, 12_500, 30_000, 60_000],
    max: [50_000, 125_000, 300_000, 600_000],
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05 §5.2',
    blurb: 'Contest capital each gate book must attract; seeded at a tenth of dec.v_min and held inside a ×0.05–×0.5 band against the live value.',
  }),
  row({
    key: 'gate.nb_coverage',
    kind: 'percent',
    unit: '%',
    value: 98,
    raw: 98,
    min: 95,
    max: 100,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05 §5.2',
    blurb: 'Coverage a gate book pinned near 0 or 1 must show to count, since it is exempt from the sanity band.',
  }),
  row({
    key: 'gate.nb_conv',
    kind: 'fixed',
    unit: 'probability',
    value: 0.01,
    raw: 10_000_000,
    min: 0.005,
    max: 0.02,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05 §5.2',
    blurb: 'Spot-versus-TWAP bound a near-boundary gate book must satisfy, proving it is alive rather than abandoned.',
  }),
  row({
    key: 'gate.eps',
    kind: 'fixed',
    unit: 'probability',
    value: 0.02,
    raw: 20_000_000,
    min: 0.005,
    max: 0.05,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 05 §5',
    blurb: 'Margin by which the adopt side of a gate must beat its reject side before the veto lifts.',
  }),

  // --- Welfare knees and weights ------------------------------------------
  row({
    key: 'welfare.thS_lo',
    kind: 'fixed',
    unit: 'score',
    value: 0.9,
    raw: 900_000_000,
    min: 0.9,
    max: 1,
    maxDelta: '0.01',
    cooldown: 4,
    cls: 'Const',
    kb: true,
    owner: 'owner 05',
    blurb: 'Lower knee of the Survival pillar; kernel-entrenched at its launch value, so the gate is tighten-only forever.',
  }),
  row({
    key: 'welfare.thS_hi',
    kind: 'fixed',
    unit: 'score',
    value: 0.98,
    raw: 980_000_000,
    min: 0.9,
    max: 1,
    maxDelta: '0.01',
    cooldown: 4,
    cls: 'Const',
    owner: 'owner 05',
    blurb: 'Upper knee of the Survival pillar, above which the pillar scores a clean one.',
  }),
  row({
    key: 'welfare.thC_lo',
    kind: 'fixed',
    unit: 'score',
    value: 0.85,
    raw: 850_000_000,
    min: 0.85,
    max: 1,
    maxDelta: '0.01',
    cooldown: 4,
    cls: 'Const',
    kb: true,
    owner: 'owner 05',
    blurb: 'Lower knee of the Credible-neutrality pillar; kernel-entrenched at its launch value.',
  }),
  row({
    key: 'welfare.thC_hi',
    kind: 'fixed',
    unit: 'score',
    value: 0.95,
    raw: 950_000_000,
    min: 0.85,
    max: 1,
    maxDelta: '0.01',
    cooldown: 4,
    cls: 'Const',
    owner: 'owner 05',
    blurb: 'Upper knee of the Credible-neutrality pillar.',
  }),
  row({
    key: 'welfare.wP',
    kind: 'fixed',
    unit: 'weight',
    value: 0.6,
    raw: 600_000_000,
    min: 0.3,
    max: 0.7,
    maxDelta: '0.05',
    cooldown: 4,
    cls: 'Const',
    owner: 'owner 05',
    blurb: 'Weight of the Prosperity pillar inside the weighted geometric mean; wP + wA = 1 binds at the engine.',
  }),
  row({
    key: 'welfare.wA',
    kind: 'fixed',
    unit: 'weight',
    value: 0.4,
    raw: 400_000_000,
    min: 0.3,
    max: 0.7,
    maxDelta: '0.05',
    cooldown: 4,
    cls: 'Const',
    owner: 'owner 05',
    blurb: 'Weight of the Adoption pillar inside the weighted geometric mean.',
  }),

  // --- Intake and proposal bonds ------------------------------------------
  ...family({
    base: 'prop.bond',
    kind: 'balance',
    unit: 'USDC',
    values: [1_000, 5_000, 25_000, 50_000],
    raws: [1_000_000_000, 5_000_000_000, 25_000_000_000, 50_000_000_000],
    min: [100, 500, 2_500, 5_000],
    max: [10_000, 50_000, 250_000, 500_000],
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 06 §4',
    blurb: 'Bond a proposer holds through the lifecycle; the TREASURY class adds a kernel 50 bps of ask on top of this base.',
  }),
  row({
    key: 'intake.max_acct',
    kind: 'u8',
    unit: 'entries/epoch',
    value: 4,
    raw: 4,
    min: 2,
    max: 8,
    maxDelta: '2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 06; 08 §7',
    blurb: 'How many intake entries one account may file in an epoch, which is the anti-spam bound on the queue.',
  }),
  row({
    key: 'intake.slash_pct',
    kind: 'percent',
    unit: '% of bond',
    value: 10,
    raw: 10,
    min: 5,
    max: 25,
    maxDelta: '5 pp',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 06; 08 §7',
    blurb: 'Share of the bond slashed to INSURANCE for a missing, unpinned or oversized preimage; never burned, and never zero.',
  }),

  // --- Protocol-owned liquidity -------------------------------------------
  ...family({
    base: 'pol.b',
    kind: 'balance',
    unit: 'USDC',
    values: [10_000, 25_000, 60_000, 100_000],
    raws: [10_000_000_000, 25_000_000_000, 60_000_000_000, 100_000_000_000],
    min: 0,
    maxDelta: '25%',
    cooldown: 1,
    cls: 'Treasury',
    owner: 'owner 04; scaling 08 §5.3',
    blurb: 'LMSR depth the protocol seeds into each decision branch; a floor, scaled up with the prize at stake, and capped by the epoch budget.',
  }),
  row({
    key: 'pol.b_gate',
    kind: 'balance',
    unit: 'USDC',
    value: 7_500,
    raw: 7_500_000_000,
    min: 0,
    maxDelta: '25%',
    cooldown: 1,
    cls: 'Treasury',
    owner: 'owner 04',
    blurb: 'LMSR depth seeded into each of the four gate books, the same for every class.',
  }),
  row({
    key: 'pol.b_baseline',
    kind: 'balance',
    unit: 'USDC',
    value: 25_000,
    raw: 25_000_000_000,
    min: 10_000,
    max: 100_000,
    maxDelta: '25%',
    cooldown: 1,
    cls: 'Treasury',
    v: simGated('Phase-0/3 calibration still owes this number; funded from POL_BASELINE, outside the epoch POL budget.'),
    owner: 'owner 04; 08 §4.3',
    blurb: 'LMSR depth seeded into the epoch Baseline book, whose TWAP is the reject-leg floor every decision is measured against.',
  }),
  row({
    key: 'pol.budget_epoch',
    kind: 'perbill',
    unit: '% of NAV',
    value: 0.75,
    raw: 7_500_000,
    min: 0,
    max: 1.5,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 08',
    blurb: 'Share of NAV the treasury may commit to market-making in one epoch; the 1.5% ceiling is kernel.',
  }),

  // --- Execution -----------------------------------------------------------
  ...family({
    base: 'exec.lock',
    kind: 'u32',
    unit: 'blocks',
    values: [28_800, 43_200, 100_800, 201_600],
    raws: [28_800, 43_200, 100_800, 201_600],
    min: 14_400,
    max: 432_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 09',
    blurb: 'Timelock between a passing decision and the earliest dispatch of its payload; the 24-hour floor is kernel.',
  }),
  row({
    key: 'exec.grace',
    kind: 'u32',
    unit: 'blocks',
    value: 201_600,
    raw: 201_600,
    min: 100_800,
    max: 432_000,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 09',
    blurb: 'How long an adopted payload stays executable before it expires unexecuted.',
  }),
  row({
    key: 'code.spacing',
    kind: 'u32',
    unit: 'blocks',
    value: 432_000,
    raw: 432_000,
    min: 201_600,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 09',
    blurb: 'Minimum spacing between two runtime upgrades, so a captured sequence cannot chain them; no ceiling, since spacing them further is always safe.',
  }),

  // --- Treasury ------------------------------------------------------------
  row({
    key: 'trs.cap_proposal',
    kind: 'percent',
    unit: '% of NAV',
    value: 5,
    raw: 5,
    min: 0,
    max: 10,
    maxDelta: '1 pp',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 08',
    blurb: 'Largest aggregate outflow one proposal may commit, checked at decide time and again per call at execution.',
  }),
  row({
    key: 'trs.cap_30d',
    kind: 'percent',
    unit: '% of NAV',
    value: 10,
    raw: 10,
    min: 0,
    max: 15,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 08',
    blurb: 'Rolling 30-day ceiling on total treasury outflow.',
  }),
  row({
    key: 'trs.cap_180d',
    kind: 'percent',
    unit: '% of NAV',
    value: 30,
    raw: 30,
    min: 0,
    max: 40,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 08',
    blurb: 'Rolling 180-day ceiling on total treasury outflow.',
  }),
  row({
    key: 'trs.stream_thr',
    kind: 'perbill',
    unit: '% of NAV',
    value: 1,
    raw: 10_000_000,
    min: 0.5,
    max: 5,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 08 §1.3',
    blurb: 'Ask above which a treasury payout is streamed rather than paid at once; it governs payout shape only, never gate eligibility.',
  }),
  ...family({
    base: 'trs.reward',
    kind: 'balance',
    unit: 'USDC',
    values: [500, 25_000, 25_000, 25_000],
    raws: [500_000_000, 25_000_000_000, 25_000_000_000, 25_000_000_000],
    min: [50, 2_500, 2_500, 2_500],
    max: [5_000, 250_000, 250_000, 250_000],
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 08',
    blurb: 'Reward paid to the proposer of an adopted proposal; for TREASURY and CODE the row is the cap on min(0.05%·ask, cap).',
  }),
  row({
    key: 'iss.inflation',
    kind: 'percent',
    unit: '%/yr',
    value: 2,
    raw: 2,
    min: 0,
    max: 2,
    cooldown: 0,
    cls: 'Const',
    kb: true,
    owner: 'owner 08 §2.3',
    blurb: 'Annual cap on VIT issuance; amendable downward only, so the supply promise can tighten but never loosen.',
  }),

  // --- Oracle, watchtowers, registry --------------------------------------
  row({
    key: 'orc.bond_floor',
    kind: 'balance',
    unit: 'USDC',
    value: 10_000,
    raw: 10_000_000_000,
    min: 2_500,
    max: 100_000,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 07 §6',
    blurb: 'Floor of the round-1 dispute bond, before the value-scaled term takes over.',
  }),
  row({
    key: 'orc.bond_bps',
    kind: 'perbill',
    unit: 'bps',
    value: 250,
    raw: 25_000_000,
    min: 150,
    max: 1_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 07 §6, §7',
    blurb: 'Rate that scales dispute bonds to the stake at risk; the same rate prices registry filing bonds, so a raise makes false claims dearer on both surfaces.',
  }),
  row({
    key: 'orc.rounds',
    kind: 'u8',
    unit: 'rounds',
    value: 3,
    raw: 3,
    min: 2,
    max: 4,
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 07 §6.1, §6.3',
    blurb: 'Maximum dispute rounds, each doubling the bond; with orc.bond_bps it fixes how much collateral a component is covered by.',
  }),
  row({
    key: 'orc.window',
    kind: 'u32',
    unit: 'blocks',
    value: 43_200,
    raw: 43_200,
    min: 43_200,
    max: 72_000,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 07 §5',
    blurb: 'Challenge window on a reported metric; frozen at 72 hours and never lowerable.',
  }),
  row({
    key: 'orc.rep_stake',
    kind: 'balance',
    unit: 'USDC',
    value: 100_000,
    raw: 100_000_000_000,
    min: 25_000,
    max: 500_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 07',
    blurb: 'Stake a reporter posts before it may report a metric.',
  }),
  row({
    key: 'orc.n_min',
    kind: 'u8',
    unit: 'reporters',
    value: 3,
    raw: 3,
    min: 3,
    max: 16,
    maxDelta: '1',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 07 §3; 05 §4.3.1',
    blurb: 'Reporters that must be registered before an attested component is admitted or Phase 3 is armed.',
  }),
  row({
    key: 'wt.quorum',
    kind: 'u8',
    unit: 'acks',
    value: 2,
    raw: 2,
    min: 2,
    max: 5,
    maxDelta: '1',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 07 §4',
    blurb: 'Watchtower acknowledgements a report needs; below quorum the window takes its one 48-hour extension.',
  }),
  row({
    key: 'wt.stake',
    kind: 'balance',
    unit: 'USDC',
    value: 25_000,
    raw: 25_000_000_000,
    min: 10_000,
    max: 100_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 07 §4',
    blurb: 'Bond a watchtower posts for one of the sixteen seats.',
  }),
  row({
    key: 'reg.bond_inc',
    kind: 'balance',
    unit: 'USDC',
    value: 5_000,
    raw: 5_000_000_000,
    min: 2_500,
    max: 50_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 07 §7',
    blurb: 'Floor of the filing bond for an incident report, before the exposure-scaled term binds.',
  }),
  row({
    key: 'reg.bond_mile',
    kind: 'balance',
    unit: 'USDC',
    value: 2_500,
    raw: 2_500_000_000,
    min: 1_250,
    max: 25_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 07 §7',
    blurb: 'Floor of the filing bond for a milestone claim.',
  }),
  row({
    key: 'dis.merit_min',
    kind: 'balance',
    unit: 'USDC',
    value: 10_000,
    raw: 10_000_000_000,
    min: 10_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 07 §12',
    blurb: 'Bond that makes a ProcessHold dispute meritorious; the consumer takes the larger of this and the game’s own round-1 bond, so lowering it cannot make censorship cheap.',
  }),

  // --- Reserve probe -------------------------------------------------------
  row({
    key: 'res.probe_int',
    kind: 'u32',
    unit: 'blocks',
    value: 14_400,
    raw: 14_400,
    min: 1,
    cooldown: 1,
    cls: 'Param',
    kb: true,
    owner: 'owner 07 §8',
    blurb: 'Spacing between reserve-health probes sent to Asset Hub.',
  }),
  row({
    key: 'res.probe_to',
    kind: 'u32',
    unit: 'blocks',
    value: 600,
    raw: 600,
    min: 1,
    cooldown: 1,
    cls: 'Param',
    kb: true,
    owner: 'owner 07 §8',
    blurb: 'How long a probe waits for its authenticated response before it counts as failed.',
  }),
  row({
    key: 'res.probe_amount',
    kind: 'balance',
    unit: 'USDC',
    value: 0.1,
    raw: 100_000,
    min: 0.000001,
    cooldown: 1,
    cls: 'Param',
    kb: true,
    owner: 'owner 07 §8',
    blurb: 'Notional the probe moves to prove the reserve is live; deliberately dust, because the point is the round trip.',
  }),
  row({
    key: 'res.fail_thr',
    kind: 'u8',
    unit: 'probes',
    value: 2,
    raw: 2,
    min: 1,
    // Genesis seeds `u8::MAX` and doc 13 §1 prints "—": no hard ceiling, so
    // `max` is omitted here as it is for every other type-max row.
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 07 §8',
    blurb: 'Consecutive failed probes that raise the reserve-health flag, which zeroes spendable NAV.',
  }),
  row({
    key: 'res.recover_thr',
    kind: 'u8',
    unit: 'probes',
    value: 3,
    raw: 3,
    min: 1,
    // As above: `u8::MAX` is the unbounded sentinel, not a governed ceiling.
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 07 §8',
    blurb: 'Consecutive successful probes needed to clear the flag; more than it takes to raise it, on purpose.',
  }),

  // --- Guardians and attestors --------------------------------------------
  row({
    key: 'grd.review_dl',
    kind: 'u32',
    unit: 'epochs',
    value: 2,
    raw: 2,
    min: 1,
    max: 4,
    maxDelta: '1',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 06 §5.4',
    blurb: 'Deadline for retro-ratifying a guardian action; missing it is itself an accountability event.',
  }),
  row({
    key: 'att.bond',
    kind: 'balance',
    unit: 'VIT',
    value: 25_000,
    raw: 25_000_000_000_000_000,
    min: 12_500,
    max: 250_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Entrenched',
    owner: 'owner 06 §7',
    blurb: 'Bond an attestor holds; it binds at seating, so an amendment reaches a member only at the next set_members.',
  }),
  row({
    key: 'att.window',
    kind: 'u32',
    unit: 'blocks',
    value: 43_200,
    raw: 43_200,
    min: 43_200,
    max: 72_000,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 06 §7; 09 §2.4',
    blurb: 'Window in which a kernel attestation may be challenged before an upgrade is applicable.',
  }),

  // --- Ledger --------------------------------------------------------------
  row({
    key: 'ledger.min_split',
    kind: 'balance',
    unit: 'USDC',
    value: 0.01,
    raw: 10_000,
    min: 0.01,
    max: 1,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 03',
    blurb: 'Smallest amount that may be split into, merged out of, or transferred between conditional positions.',
  }),
  row({
    // Live coupling: `ledger.rdm_fee <= mkt.fee`. The pair is screened jointly,
    // in both directions, at the amendment boundary — the second key to work
    // this way after `gate.v_min`. The static ceiling below is ordinary
    // metadata; the coupling is what actually binds whenever `mkt.fee < 100`.
    key: 'ledger.rdm_fee',
    kind: 'perbill',
    unit: 'bps',
    value: 30,
    raw: 3_000_000,
    min: 0,
    max: 100,
    maxDelta: '10 bps',
    cooldown: 1,
    cls: 'Param',
    owner: 'owner 03 §5.3a',
    blurb:
      'Charged when a winning position is cashed out at settlement. Merging a matched pair, redeeming a voided vault and any payout that would net below the dust floor are all exempt.',
  }),
  row({
    key: 'ledger.pos_dep',
    kind: 'balance',
    unit: 'USDC/entry',
    value: 0.1,
    raw: 100_000,
    min: 0.1,
    max: 0.1,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 03 §4/§9/§10',
    blurb: 'Deposit held per position entry; frozen at a single point because deposits already held cannot be rebased.',
  }),
  row({
    key: 'ledger.archive',
    kind: 'u32',
    unit: 'blocks',
    value: 5_256_000,
    raw: 5_256_000,
    min: 1_296_000,
    max: 5_256_000,
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    owner: 'owner 03',
    blurb: 'How long a settled vault stays claimable before it is archived; the one-year ceiling is kernel.',
  }),

  // --- Keepers and collators ----------------------------------------------
  row({
    key: 'keeper.budget',
    kind: 'balance',
    unit: 'USDC',
    value: 12_000,
    raw: 12_000_000_000,
    min: 6_000,
    max: 60_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    kb: true,
    owner: 'owner 08 §6.2',
    blurb: 'Metered budget for keeper rebates in one epoch; below the kernel 6,000 floor the decision-critical cranks stop being paid for.',
  }),
  row({
    key: 'keeper.rebate',
    kind: 'balance',
    unit: 'USDC',
    value: 0.000255,
    raw: 255,
    min: 0.000085,
    max: 0.00085,
    cooldown: 1,
    cls: 'Param',
    v: verify('Three times the measured 85 µUSDC crank-fee basis, which the committed generated weights fix at doc 08 §9’s placeholder VIT price. The fee is charged in VIT and this row stores USDC, so it must be re-derived at the launch fee.vit_usdc_rate.'),
    owner: 'owner 08 §6',
    blurb: 'Rebate paid per sanctioned permissionless crank, sized so cranking is never a loss.',
  }),
  row({
    key: 'collator.comp',
    kind: 'balance',
    unit: 'USDC/collator',
    value: 500,
    raw: 500_000_000,
    min: 500,
    max: 10_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    owner: 'owner 08 §2.4',
    blurb:
      'Per-epoch compensation for one collator. Seeded at the registry floor: Polkadot pays 38 system-parachain collators about 212 USDC per epoch, so 500 is roughly 2.4× a rate real operators already accept.',
  }),
  row({
    key: 'collator.n_min',
    kind: 'u8',
    unit: 'collators',
    value: 4,
    raw: 4,
    min: 3,
    max: 12,
    maxDelta: '1',
    cooldown: 2,
    cls: 'Meta',
    owner: 'owner 05 §4.3',
    blurb: 'Collators the chain must keep for the on-chain Credible-neutrality component to score.',
  }),
  row({
    key: 'collator.n_tgt',
    kind: 'u8',
    unit: 'collators',
    value: 5,
    raw: 5,
    min: 4,
    max: 12,
    maxDelta: '1',
    cooldown: 2,
    cls: 'Meta',
    v: verify('Launch value only; doc 13 schedules it upward at the phase gates and the schedule is still [VERIFY].'),
    owner: 'owner 05 §4.3.1',
    blurb: 'Denominator of the collator E-coverage term — the collator count the set is being measured against.',
  }),

  // --- Security sizing -----------------------------------------------------
  row({
    key: 'sec.prize.param',
    kind: 'balance',
    unit: 'USDC',
    value: 50_000,
    raw: 50_000_000_000,
    min: 50_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    v: simGated(PHASE0),
    owner: 'owner 05 §5.6; 08 §5',
    blurb: 'Capability-envelope proxy for what a wrongly flipped PARAM decision is worth; the genesis value is also the kernel floor, so no amendment can shrink it toward zero.',
  }),
  row({
    key: 'sec.prize.code',
    kind: 'balance',
    unit: 'USDC',
    value: 300_000,
    raw: 300_000_000_000,
    min: 300_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    v: simGated(PHASE0),
    owner: 'owner 05 §5.6; 08 §5',
    blurb: 'Capability-envelope proxy for a wrongly flipped CODE decision; upgrade payloads are additionally floored at trs.cap_proposal of NAV.',
  }),
  row({
    key: 'sec.prize.meta',
    kind: 'balance',
    unit: 'USDC',
    value: 600_000,
    raw: 600_000_000_000,
    min: 600_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    v: simGated(PHASE0),
    owner: 'owner 05 §5.6; 08 §5',
    blurb: 'Capability-envelope proxy for a wrongly flipped META decision, the largest of the three because META rewrites the rules.',
  }),
  row({
    key: 'sec.flow_cap',
    kind: 'fixed',
    unit: '× of (b_acc + b_rej)',
    value: 16,
    raw: 16_000_000_000,
    min: 7,
    max: 32,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Meta',
    kb: true,
    v: simGated(`${PHASE0} Set at the 0.995 quantile of observed contest capital over decision-pair depth.`),
    owner: 'owner 05 §5.6; 08 §5.2–§5.3',
    blurb: 'Ceiling on how much measured contest capital may count toward the security-sizing estimate; raising it eases the gate, which is why the unsafe direction is up.',
  }),

  // --- Phase-3 exposure caps ----------------------------------------------
  row({
    key: 'phase3.tvl_cap',
    kind: 'balance',
    unit: 'USDC',
    value: 2_000_000,
    raw: 2_000_000_000_000,
    min: 0,
    cooldown: 0,
    cls: 'MetaAndValues',
    v: simGated('[VERIFY] before Phase-3 arming; raised only by a phase-gate META plus values ratification.'),
    owner: 'owner 09',
    blurb: 'Global ceiling on real-USDC exposure during Phase 3; arming the chain fully means amending it to its own unbounded sentinel.',
  }),
  row({
    key: 'phase3.dep_cap',
    kind: 'balance',
    unit: 'USDC',
    value: 20_000,
    raw: 20_000_000_000,
    min: 0,
    cooldown: 0,
    cls: 'MetaAndValues',
    v: simGated('[VERIFY] before Phase-3 arming; raised only by a phase-gate META plus values ratification.'),
    owner: 'owner 09',
    blurb: 'Per-account ceiling on cumulative real-USDC deposits during Phase 3; independent of the global cap, and each disables only its own check.',
  }),

  // --- Operating budgets and remote-execution rates ------------------------
  row({
    key: 'ops.ct_dot_rate',
    kind: 'balance',
    unit: 'µUSDC/DOT',
    value: 5_000_000,
    raw: 5_000_000,
    min: 500_000,
    max: 500_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Treasury',
    v: verify('[VERIFY] against live DOT/USDC before Phase-3 arming; budget-envelope accounting only, no NAV term depends on it.'),
    owner: 'owner 09 §4; 08 §1.1',
    blurb: 'DOT-to-USDC rate used to debit the coretime budget line.',
  }),
  row({
    key: 'ops.ct_fee_dot',
    kind: 'balance',
    unit: 'planck DOT',
    value: 5_000_000_000,
    raw: 5_000_000_000,
    min: 100_000_000,
    max: 100_000_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Treasury',
    v: verify('[VERIFY] against live relay and Coretime fees at Phase-2/3 onboarding.'),
    owner: 'owner 09 §4',
    blurb: 'DOT withdrawn beside each coretime renewal quote to pay for the two remote XCM legs.',
  }),
  row({
    key: 'ops.ct_quote_ttl',
    kind: 'u32',
    unit: 'blocks',
    value: 100_800,
    raw: 100_800,
    min: 7_200,
    max: 403_200,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Treasury',
    owner: 'owner 09 §4',
    blurb: 'How long an open coretime renewal quote stays executable; its expiry is the only permissionless prune trigger.',
  }),
  row({
    key: 'ops.probe_fee',
    kind: 'balance',
    unit: 'planck DOT',
    value: 5_000_000_000,
    raw: 5_000_000_000,
    min: 100_000_000,
    max: 100_000_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Treasury',
    v: verify('[VERIFY] against the live bounded program and response-delivery fee before Phase-3 arming.'),
    owner: 'owner 07 §8',
    blurb: 'Maximum DOT admitted to one reserve-probe holding for Asset Hub execution plus response delivery.',
  }),
  row({
    key: 'ops.probe_rate',
    kind: 'balance',
    unit: 'µUSDC/DOT',
    value: 5_000_000,
    raw: 5_000_000,
    min: 500_000,
    max: 500_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Treasury',
    v: verify('[VERIFY] against live DOT/USDC before Phase-3 arming; governed separately from the coretime rate on purpose.'),
    owner: 'owner 07 §8; 08 §1.1',
    blurb: 'DOT-to-USDC rate used to debit the reserve-probe budget line.',
  }),
  row({
    key: 'xcm.dot_per_sec',
    kind: 'balance',
    unit: 'planck DOT/s of ref-time',
    value: 100_000_000_000,
    raw: 100_000_000_000,
    min: 1_000_000_000,
    max: 10_000_000_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    v: simGated('Fee sizing is [VERIFY] against live Asset Hub and relay fees before Phase-3 HRMP arming.'),
    owner: 'owner 09 §6.1',
    blurb: 'What an inbound XCM program pays in DOT for the ref-time it consumes.',
  }),
  row({
    key: 'xcm.dot_per_mb',
    kind: 'balance',
    unit: 'planck DOT/MiB of proof',
    value: 10_000_000_000,
    raw: 10_000_000_000,
    min: 100_000_000,
    max: 1_000_000_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    v: simGated('Fee sizing is [VERIFY] against live Asset Hub and relay fees before Phase-3 HRMP arming.'),
    owner: 'owner 09 §6.1',
    blurb: 'What an inbound XCM program pays in DOT for the proof size it consumes.',
  }),
  row({
    key: 'xcm.usdc_per_sec',
    kind: 'balance',
    unit: 'µUSDC/s of ref-time',
    value: 50_000_000,
    raw: 50_000_000,
    min: 500_000,
    max: 5_000_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    v: simGated('Fee sizing is [VERIFY] against live Asset Hub and relay fees before Phase-3 HRMP arming.'),
    owner: 'owner 09 §6.1',
    blurb: 'The same ref-time charge, payable in USDC instead of DOT.',
  }),
  row({
    key: 'xcm.usdc_per_mb',
    kind: 'balance',
    unit: 'µUSDC/MiB of proof',
    value: 5_000_000,
    raw: 5_000_000,
    min: 50_000,
    max: 500_000_000,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    v: simGated('Fee sizing is [VERIFY] against live Asset Hub and relay fees before Phase-3 HRMP arming.'),
    owner: 'owner 09 §6.1',
    blurb: 'The same proof-size charge, payable in USDC instead of DOT.',
  }),

  // -- The hosted question service (doc 16, D-20) ---------------------------
  //
  // Bleavit sells its own decision machinery to other chains: a client pays for
  // a question, the same markets and the same welfare engine answer it, and the
  // answer is delivered back as a bonded report. These six rows price that
  // service and bound how much of the chain it may occupy.
  //
  // Two of them are arming switches rather than tunables. While `svc.fee_bps`
  // was absent the chain refused to register a question at all, and while
  // `svc.client_bond` was absent it refused to admit a client — in both cases
  // the missing row, not a feature flag, was what kept the service closed.
  row({
    key: 'svc.fee_bps',
    kind: 'perbill',
    unit: 'bps',
    value: 1_000,
    raw: 100_000_000,
    min: 0,
    max: 1_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Param',
    owner: 'owner 16 §8',
    blurb:
      'The service’s cut of what a client pays. It sits exactly at its own ceiling, so the next amendment can only lower it — raising it later needs the ceiling itself amended first.',
  }),
  row({
    key: 'svc.max_live',
    kind: 'u32',
    unit: 'questions',
    value: 16,
    raw: 16,
    min: 1,
    max: 64,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Param',
    kb: true,
    v: verify(
      'Provisional. The value must keep worst-case outside load inside the block-weight share reserved for it, and no measurement in the repository sizes that yet. An absent or invalid value reads as zero, so admission fails closed.',
    ),
    owner: 'owner 16 §8.5',
    blurb: 'How many outside questions may be live at once. Set by how much of the chain they may occupy, not by demand.',
  }),
  row({
    key: 'svc.max_window',
    kind: 'u32',
    unit: 'blocks',
    value: 302_400,
    raw: 302_400,
    min: 43_200,
    max: 302_400,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    owner: 'owner 16 §4',
    blurb: 'The longest a client may keep a question open — one full epoch, the timescale on which the whole slate turns over.',
  }),
  row({
    // Doc 13's Unit column for this row is "—", so it displays as a plain
    // fraction. It is the same Perbill encoding as `mkt.fee` and `svc.fee_bps`,
    // which display as bps — the encoding does not decide the unit.
    key: 'svc.epsilon_min',
    kind: 'perbill',
    unit: '—',
    value: 0.01,
    raw: 10_000_000,
    min: 0.005,
    max: 0.25,
    maxDelta: '×2',
    cooldown: 1,
    cls: 'Param',
    owner: 'owner 16 §5.2',
    blurb: 'The narrowest margin a hosted report is allowed to call decisive. Below it, the report says the question did not separate.',
  }),
  row({
    key: 'svc.client_bond',
    kind: 'balance',
    unit: 'VIT',
    value: 100_000,
    raw: 100_000_000_000_000_000,
    min: 1_000,
    max: 1_000_000,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Param',
    owner: 'owner 16 §2',
    blurb:
      'Held from a client when it registers, and returned when it leaves cleanly. It prices registration abuse only — it is never the money that pays for delivery. At 4× an attestor’s bond, the first clients will be institutions.',
  }),
  row({
    key: 'svc.price_cap',
    kind: 'fixed',
    unit: '× the base tariff',
    value: 4,
    raw: 4_000_000_000,
    min: 1,
    max: 64,
    maxDelta: '×2',
    cooldown: 2,
    cls: 'Param',
    owner: 'owner 16 §8.6, §8.7',
    blurb:
      'How far contention may raise the price of a slot. Each admission adds a step, and the surcharge decays back to nothing over one question window, so a price cannot outlive the demand that set it.',
  }),
]);

/** Key-indexed view of {@link PARAMS} (doc 13 §1). */
export const PARAM_BY_KEY: ReadonlyMap<string, ParamRow> = new Map(
  PARAMS.map((p) => [p.key, p]),
);

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Look up a doc 13 §1 row, throwing on an unknown key.
 *
 * The chain fails closed when a registry read misses (doc 13 reading rule 2 —
 * a consumer never invents a default), and so does this. A silent fallback here
 * would let the app render a number the spec does not contain.
 */
export function param(key: string): ParamRow {
  const found = PARAM_BY_KEY.get(key);
  if (found === undefined) {
    throw new Error(`Unknown parameter key "${key}" — doc 13 §1 has no such row.`);
  }
  return found;
}

/** The genesis default of a key, in its display unit (doc 13 §1, reading rule 8). */
export function value(key: string): number {
  return param(key).value;
}

/** The stored scalar of a key, as a `ParamView` carries it (doc 02 §4). */
export function rawValue(key: string): number {
  return param(key).raw;
}

/**
 * Resolve a per-class doc 13 row, e.g. `perClass('dec.delta', 'Treasury')`.
 *
 * `Constitutional` is deliberately not accepted: it bears no gate markets and
 * no per-class row, because it runs the referendum path instead (doc 06, D-5).
 */
export function perClass(base: string, cls: GateBearingClass): ParamRow {
  return param(`${base}.${CLASS_SUFFIX[cls]}`);
}

/**
 * Rows the spec has not settled — `[VERIFY]`-tagged or bound to a calibration
 * artifact (doc 13 reading rule 4).
 */
export function unverifiedParams(): ParamRow[] {
  return PARAMS.filter((p) => p.verification.status !== 'settled');
}

// ---------------------------------------------------------------------------
// Per-class view
// ---------------------------------------------------------------------------

/**
 * The eight class-dependent numbers a decision needs, gathered once.
 *
 * All balances are in USDC and all scores in s-units, matching the rows they
 * come from. `secPrize` is `null` for TREASURY on purpose: doc 08 §5.2 values
 * that class's `InCapPrize` at the proposal's own ask, so there is no proxy key
 * to read and a zero would silently weaken the sizing gate.
 */
export interface ClassDefaults {
  /** Hurdle above the effective REJECT floor (`dec.delta`). */
  readonly delta: number;
  /** Baseline slack on the REJECT floor (`dec.sigma`). */
  readonly sigma: number;
  /** Contest-capital floor per decision book (`dec.v_min`). */
  readonly vMin: number;
  /** Contest-capital floor per gate book (`gate.v_min`). */
  readonly gateVMin: number;
  /** Proposer bond, class base only (`prop.bond`). */
  readonly bond: number;
  /** Seeded LMSR depth per decision branch (`pol.b`). */
  readonly polB: number;
  /** Blocks between a pass and the earliest dispatch (`exec.lock`). */
  readonly timelock: number;
  /** Capability-envelope prize proxy (`sec.prize`), or `null` where the ask is the prize. */
  readonly secPrize: number | null;
}

const classDefaults = (c: GateBearingClass): ClassDefaults => ({
  delta: perClass('dec.delta', c).value,
  sigma: perClass('dec.sigma', c).value,
  vMin: perClass('dec.v_min', c).value,
  gateVMin: perClass('gate.v_min', c).value,
  bond: perClass('prop.bond', c).value,
  polB: perClass('pol.b', c).value,
  timelock: perClass('exec.lock', c).value,
  secPrize: c === 'Treasury' ? null : perClass('sec.prize', c).value,
});

/**
 * Per-class genesis defaults, derived from {@link PARAMS} so the registry stays
 * the only home for the numbers (doc 13 §1).
 */
export const CLASS_DEFAULTS: Readonly<Record<GateBearingClass, ClassDefaults>> = Object.freeze({
  Param: classDefaults('Param'),
  Treasury: classDefaults('Treasury'),
  Code: classDefaults('Code'),
  Meta: classDefaults('Meta'),
});
