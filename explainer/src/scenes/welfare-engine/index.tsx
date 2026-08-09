import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { MotionSpec } from '../motion';
import type { SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import type { Pillar } from '../../protocol/types';
import {
  INCIDENT_MULTIPLIER,
  THETA_C_HI,
  THETA_C_LO,
  THETA_S_HI,
  THETA_S_LO,
  V1_METRICS,
  WEIGHT_A,
  WEIGHT_P,
  collatorDEff,
  collatorNCap,
  gate,
  geoComposite,
  pillarValues,
  settlementScore,
  welfareValue,
} from '../../protocol/welfare';
import { EPSILON_C, EPSILON_W, MAX_NON_TERMINAL_COHORTS } from '../../protocol/constants';
import { COHORT_CITATION, DERIVED_MAX_HORIZON_K } from '../../protocol/epoch';
import type { Tagged } from '../../provenance/types';
import { derived, simulated, spec } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './welfare-engine.css';
import { Formula } from '../../ui/Formula';

/**
 * The welfare engine — doc 05 §4.
 *
 * The one thing this scene exists to teach is that `W` is a **product**. A bar
 * chart of S, C, P and A is the natural picture and it is actively wrong: it
 * invites the reading that a weak pillar is compensated by a strong one, when in
 * fact `g(S)` and `g(C)` return exactly zero below their lower knees and take the
 * whole epoch to zero with them.
 *
 * So the canvas is drawn as a **flow, left to right**: four measured readings,
 * two of which become multipliers, all meeting in one score. Each multiplier is
 * a **disc whose diameter is its own output**, and below the knee the disc has no
 * diameter at all — what remains is a knife edge that passes nothing. Nothing on
 * the canvas is a stacked bar, because a stack would say a good pillar can pay
 * for a failed one.
 *
 * Canvas labels are the plain words of `PLAIN` below and never the spec symbols:
 * a first-time reader gets "Uptime", an auditor gets `S` and `min(U, D_eff)` in
 * the rail, and the composition table carries both so the two cannot drift.
 *
 * The second relation the canvas carries is that the same multiplicativity holds
 * *in time*: `s` is a geometric mean of two epochs, so one zeroed epoch cannot be
 * averaged away by a good one.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const C_PIPELINE: Citation = cite('05', '§4.1', 'W = g(S) · g(C) · GeoComposite(P, A)');
const C_KNEE: Citation = cite('05', '§4.1', 'the smoothstep gate g(x; θ⁻, θ⁺)');
const C_FLOOR: Citation = cite('05', '§4.1', 'entrenched genesis floor: no track, no supermajority (SQ-78)');
const C_METRICS: Citation = cite('05', '§4.3', 'the frozen v1 MetricId assignments');
const C_SMIN: Citation = cite('05', '§4.3.2', 'v1 ships S = min(U, D_eff)');
const C_ARITH: Citation = cite('05', '§4.4', 'normative evaluation order, floored onto the 1e9 grid');
const C_SCORE: Citation = cite('05', '§4.4', 's = GeoMean(W_{e+1}, W_{e+2}) over the k = 2 horizon');
const C_DEFF: Citation = cite('05', '§4.5', 'D_eff = min(1, (1 − HHI) / (1 − 1/n_cap(phase)))');
const C_TUNABLE: Citation = cite('13', '§1', 'welfare.thetaS / welfare.thetaC / welfare.wP / welfare.wA, launch values');
// ε_C, ε_P and ε_W are kernel values stated where the aggregation is specified —
// doc 05 §4.4 — not in doc 13's registry, which carries neither.
const C_EPSW: Citation = cite('05', '§4.4', 'ε_W = 1e−9, one base unit; keeps the log finite for a zeroed epoch');
const C_EPSC: Citation = cite('05', '§4.4', 'ε_C = ε_P = 0.01 (K), the floors inside the weighted geometric means');
const C_PAYOUT: Citation = cite('03', '§5.3', 'LONG pays floor(a·s), SHORT floor(a·(1−s))');

/**
 * The §4.5 worked authorship split, 40/40/10/5/5.
 *
 * Held here as the *input* to `collatorDEff` rather than as its answer, so the
 * number the panel prints is computed by the protocol core and cannot drift from
 * it. Against a bootstrap `n_cap` of 5 it scores 0.83125 — below θS⁻ — which is
 * the corpus row that makes the cliff concrete.
 */
const HHI_EXAMPLE = 0.335;
const HHI_EXAMPLE_SPLIT = '40/40/10/5/5';
const EXAMPLE_PHASE = 0;

/**
 * The one v1 id that is assigned but deliberately not registered (05 §4.3.2).
 *
 * Read out of the frozen set rather than written down, so the panel that
 * explains the held-open slot names whichever id actually carries it.
 */
const RESERVED_METRIC = V1_METRICS.find((m) => !m.registered);

/** The lower endpoint of the normalized component domain (05 §4.6 produces [0,1]). */
const DOMAIN_MIN = 0;

/**
 * The plain word each quantity goes by on the canvas.
 *
 * One home for the five words, read by both the diagram and the rail's row
 * headers, so the picture and the table cannot come to call the same thing two
 * different things. Every one is ≤ 8 characters: canvas labels are drawn at 0.42
 * stage units and a long one is what collides with its neighbour.
 */
const PLAIN = {
  s: 'Uptime',
  c: 'Security',
  p: 'Economy',
  a: 'Progress',
  w: 'Score',
} as const;

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface Composition {
  /** The S pillar: `min(U, D_eff)` in v1. */
  readonly sPillar: number;
  /** The weighted geometric mean over the on-chain C components. */
  readonly cGeo: number;
  /** The incident multiplier `I`, applied to C with no ε floor beneath it. */
  readonly incident: number;
  readonly cPillar: number;
  readonly p: number;
  readonly a: number;
  readonly gS: number;
  readonly gC: number;
  readonly gateProduct: number;
  readonly composite: number;
  readonly w: number;
  readonly settlement: number | null;
}

/**
 * `C = I · Π_j max(c_j, ε_C)^{w_j}` — computed by the protocol core, 05 §4.4(3).
 *
 * The simulation carries C's two factors apart (the on-chain weighted geometric
 * mean and the attested incident multiplier), so they have to be combined
 * somewhere — and that multiplication is normative, not incidental. It is
 * specified on the 1e9 grid *integers*; a double multiply-then-floor is a
 * different function that can land a whole grid unit away, and doc 05 §4.4
 * requires two conforming implementations to agree bit-for-bit. So the
 * combination is handed to `pillarValues` rather than done here.
 *
 * The scenario carries pillar aggregates rather than raw components, so each
 * group is passed as a single term of weight exactly 1 — the degenerate case
 * §4.4 rule 3 makes *exact*, so the wrapping invents nothing. The ids are the
 * readable labels `MetricId` admits for illustrative callers, so no
 * canonical-looking component id is fabricated. Only `C` is read back out.
 */
function securityPillar(cOnchainGeo: number, incident: number): number {
  return pillarValues({
    u: 1,
    dEff: 1,
    incident,
    cOnchain: [{ id: 'C_onchain', value: cOnchainGeo, weight: 1 }],
    p: [{ id: 'P', value: 1, weight: 1 }],
    a: [{ id: 'A', value: 1, weight: 1 }],
  }).C;
}

/**
 * Read the simulated pillar inputs and hand every step of the arithmetic to the
 * protocol core.
 *
 * Nothing here re-implements a formula. `gate`, `geoComposite`, `pillarValues`
 * and `welfareValue` own the flooring order doc 05 §4.4 makes normative, and
 * this scene never displays a welfare number it computed itself.
 */
export function compose(sim: SimState): Composition {
  const { s, cOnchain, cAttested, p, a, settlement } = sim.welfare;
  const cPillar = securityPillar(cOnchain, cAttested);
  const gS = gate(s, THETA_S_LO, THETA_S_HI);
  const gC = gate(cPillar, THETA_C_LO, THETA_C_HI);
  return {
    sPillar: s,
    cGeo: cOnchain,
    incident: cAttested,
    cPillar,
    p,
    a,
    gS,
    gC,
    // The gates are multiplied and floored together before the composite
    // multiplies in, because doc 05 §4.4(3) fixes the association. Reading that
    // intermediate off `welfareValue` with a neutral composite — GeoComposite(1,1)
    // is exactly 1 — keeps the association and the flooring in the core rather
    // than re-deriving them here.
    gateProduct: welfareValue(s, cPillar, 1, 1),
    composite: geoComposite(p, a),
    w: welfareValue(s, cPillar, p, a),
    settlement,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const MIN_H = 0.06;

/**
 * The stage is a flow, not a scatter: four lanes on the left, each carrying one
 * measured reading rightward into the thing it becomes.
 *
 * A label is drawn centred under its node's *bottom edge*, so `node.y` alone
 * decides which text row a label lands on. The lanes are therefore pitched 2.9
 * units apart — comfortably more than the 1.3-unit node plus the 0.55/1.10
 * label and sublabel offsets beneath it — and every same-row pair below is
 * checked against `(len_a + len_b) · 0.12 + 0.3`, the width two centred labels
 * need between their centres. The check is a test, not a comment: see
 * `never draws two labels on top of each other`.
 */
const LANE_S = 10.0;
const LANE_C = 6.6;
const LANE_P = 3.5;
const LANE_A = 0.9;

// --- band 1: what was measured ---------------------------------------------
const IN_X = 0.55;
const IN_W = 1.9;
const IN_H = 1.3;

// --- band 2: the two multipliers, and the blend of the other two ------------
/**
 * Full-diameter gate disc, i.e. g = 1.
 *
 * Sized against the lane pitch rather than chosen. A disc's own sublabel sits
 * 1.17 units below its bottom edge, so two discs one lane apart need
 * `2 · radius + 1.17` between their centres before the upper one's text lands
 * inside the lower one's circle. At the 3.4-unit S↔C pitch above, that caps the
 * diameter at 2.2 — which is also the size at which a full disc stops dwarfing
 * the 1.3-unit reading plates feeding it.
 */
const DISC_MAX = 2.2;
const DISC_CX = 6.2;
/** Discs are centred on their lane's node centre, so the lane reads as one row. */
const DISC_S_Y = LANE_S + IN_H / 2;
const DISC_C_Y = LANE_C + IN_H / 2;
/** The blend sits between the two lanes it merges, at the same size as a reading. */
const BLEND_Y = (LANE_A + LANE_P) / 2;

// --- band 3: the running product, on one scale ------------------------------
const PROD_BASE = 3.2;
const PROD_H = 6.0;
const PROD_W = 1.2;
const PROD_GATE_X = 9.6;
const PROD_W_X = 12.0;
const PROD_SCALE_X = 9.45;

// --- band 4: the two measurement epochs, and the payout ---------------------
const EPOCH_BASE = 6.4;
const EPOCH_H = 3.0;
const EPOCH_W = 1.1;
const EPOCH_X0 = 14.9;
const EPOCH_X1 = 17.9;
const S_COL_X = 16.4;
const S_COL_BASE = 1.4;
const S_COL_H = 3.2;

/** The three dashed dividers that separate the four bands of the flow. */
const DIV_XS = [4.2, 8.7, 14.0] as const;
const DIV_Y0 = 0.5;
const DIV_Y1 = 11.5;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const fw = (v: number): string => (v > 0 && v < 1e-4 ? v.toExponential(2) : v.toFixed(4));
const f2 = (v: number): string => v.toFixed(2);
const f4 = (v: number): string => v.toFixed(4);
/** Full 1e9-grid precision. Used where one grid unit is the whole point. */
const f9 = (v: number): string => v.toFixed(9);
const fexp = (v: number): string => v.toExponential(0);

/**
 * A safety multiplier as a disc whose diameter *is* the multiplier.
 *
 * At or below the lower knee `gate()` returns exactly 0, so the disc has zero
 * diameter. Drawing nothing would be truthful and useless, so the collapse is
 * drawn as what it is: the full envelope width at zero height — a knife edge
 * that nothing gets through. That is the only place in this scene the alarm tone
 * appears, and a breached welfare gate is exactly what it is reserved for.
 *
 * The label reads `Multiplier` on both discs rather than `g(S)`/`g(C)`. Which
 * one it is comes from the lane it sits in — the reading feeding it is directly
 * to its left — and the symbol is one row away in the rail.
 */
function discNode(id: string, domRowId: string, cy: number, g: number): SceneNode {
  if (g <= 0) {
    return {
      id,
      kind: 'chip',
      x: DISC_CX - DISC_MAX / 2,
      y: cy - MIN_H / 2,
      w: DISC_MAX,
      h: MIN_H,
      tone: 'alarm',
      state: 'blocked',
      label: 'Multiplier',
      sublabel: '× 0 · nothing passes',
      domRowId,
    };
  }
  const d = DISC_MAX * clamp01(g);
  return {
    id,
    kind: 'chip',
    x: DISC_CX - d / 2,
    y: cy - d / 2,
    w: d,
    h: d,
    tone: 'ink',
    state: 'active',
    label: 'Multiplier',
    sublabel: `× ${fw(g)}`,
    domRowId,
  };
}

/**
 * One measured reading on [0,1], drawn as a plate whose fill level is the value.
 *
 * Every reading is the same box at the same size, so the four fills are directly
 * comparable by eye — which is the honest comparison to invite, because the
 * readings really are commensurate. What is *not* commensurate is what happens
 * to them next, and that difference is carried by shape: a reading feeding a
 * multiplier meets a disc, a reading feeding the trade-off meets another plate.
 */
function readingNode(
  id: string,
  domRowId: string,
  y: number,
  value: number,
  label: string,
  sublabel: string,
): SceneNode {
  return {
    id,
    kind: 'plate',
    x: IN_X,
    y,
    w: IN_W,
    h: IN_H,
    tone: 'ink',
    state: 'active',
    fill: clamp01(value),
    label,
    sublabel,
    domRowId,
  };
}

/**
 * A magnitude read against a common scale: full height above the baseline = 1.
 *
 * `alarmOnZero` is off by default and true only on the running-product columns,
 * where a zero *is* a breached gate — the one welfare state that earns the alarm
 * tone. The settlement column leaves it off: a low or zero score is an outcome,
 * not a safety state, and outcomes are always ink.
 */
function columnNode(
  id: string,
  domRowId: string,
  x: number,
  base: number,
  w: number,
  maxH: number,
  value: number | null,
  label: string,
  alarmOnZero = false,
  /** What an absent value is called. A horizon epoch is unmeasured; a payout is unsettled. */
  pending = 'not measured',
): SceneNode {
  const known = value !== null;
  const h = known ? Math.max(MIN_H, maxH * clamp01(value)) : MIN_H;
  const base_: SceneNode = {
    id,
    kind: 'stack',
    x,
    y: base,
    w,
    h,
    tone: alarmOnZero && known && value === 0 ? 'alarm' : 'ink',
    state: known ? 'active' : 'pending',
    label,
    domRowId,
  };
  return known ? { ...base_, sublabel: fw(value) } : { ...base_, sublabel: pending };
}

/**
 * The scene model.
 *
 * Exported for tests: the bijection between nodes carrying a `domRowId` and the
 * `<tr id=…>` rows in the rail is the property that keeps the canvas from being
 * the only place a fact lives.
 */
export function buildModel(sim: SimState): SceneModel {
  const c = compose(sim);

  const nodes: SceneNode[] = [
    // --- band 1: the four readings, one per lane -----------------------------
    // The two gated readings carry the floor they have to clear in their
    // sublabel, so "how close to the cliff" is legible without putting a θ on
    // the canvas.
    readingNode(
      'in-s',
      'row-pillar-s',
      LANE_S,
      c.sPillar,
      PLAIN.s,
      `${f4(c.sPillar)} · needs ${f2(THETA_S_LO)}`,
    ),
    readingNode(
      'in-c',
      'row-pillar-c',
      LANE_C,
      c.cPillar,
      PLAIN.c,
      `${f4(c.cPillar)} · needs ${f2(THETA_C_LO)}`,
    ),
    readingNode('in-p', 'row-pillar-p', LANE_P, c.p, PLAIN.p, `${f4(c.p)} · weight ${f2(WEIGHT_P)}`),
    readingNode('in-a', 'row-pillar-a', LANE_A, c.a, PLAIN.a, `${f4(c.a)} · weight ${f2(WEIGHT_A)}`),

    // --- band 2: two multipliers, and the one allowed trade-off --------------
    discNode('gate-s', 'row-gate-s', DISC_S_Y, c.gS),
    discNode('gate-c', 'row-gate-c', DISC_C_Y, c.gC),
    {
      id: 'blend',
      kind: 'plate',
      x: DISC_CX - IN_W / 2,
      y: BLEND_Y,
      w: IN_W,
      h: IN_H,
      tone: 'ink',
      state: 'active',
      fill: clamp01(c.composite),
      label: 'Blend',
      sublabel: f4(c.composite),
      domRowId: 'row-composite',
    },

    // --- band 3: the product, on one printed scale ---------------------------
    // Two columns rather than three: the pair of multipliers together, then the
    // score they scale. The drop from the first column to the second is the
    // picture, and it is the only direction the drop can ever go.
    columnNode(
      'prod-gate',
      'row-prod-gc',
      PROD_GATE_X,
      PROD_BASE,
      PROD_W,
      PROD_H,
      c.gateProduct,
      'Safety',
      true,
    ),
    columnNode('prod-w', 'row-w', PROD_W_X, PROD_BASE, PROD_W, PROD_H, c.w, PLAIN.w, true),

    // --- band 4: the two-epoch measurement horizon ---------------------------
    // The simulation carries one epoch's pillar snapshot, not a horizon series,
    // so both epoch slots stay unmeasured rather than borrowing the snapshot.
    columnNode('w-e1', 'row-w-e1', EPOCH_X0, EPOCH_BASE, EPOCH_W, EPOCH_H, null, 'Epoch 1'),
    columnNode('w-e2', 'row-w-e2', EPOCH_X1, EPOCH_BASE, EPOCH_W, EPOCH_H, null, 'Epoch 2'),
    columnNode(
      's-col',
      'row-s',
      S_COL_X,
      S_COL_BASE,
      EPOCH_W,
      S_COL_H,
      c.settlement,
      'Payout',
      false,
      'not settled yet',
    ),

    // --- flow ----------------------------------------------------------------
    // The two blend feeds are drawn at their own weights: P's pipe is half as
    // wide again as A's, because 0.60 against 0.40 is the asymmetry of the only
    // trade-off in the whole pipeline.
    { id: 'e-in-s', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'in-s', to: 'gate-s' },
    { id: 'e-in-c', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'in-c', to: 'gate-c' },
    {
      id: 'e-in-p',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'in-p',
      to: 'blend',
      emphasis: WEIGHT_P / WEIGHT_A,
    },
    { id: 'e-in-a', kind: 'edge', x: 0, y: 0, w: 0, h: 0, tone: 'dim', from: 'in-a', to: 'blend' },
    {
      id: 'e-gs',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'gate-s',
      to: 'prod-gate',
    },
    {
      id: 'e-gc',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'gate-c',
      to: 'prod-gate',
    },
    {
      id: 'e-prod',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'prod-gate',
      to: 'prod-w',
    },
    {
      id: 'e-blend',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'blend',
      to: 'prod-w',
    },
    {
      id: 'e-e1',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      state: c.settlement === null ? 'inactive' : 'active',
      from: 'w-e1',
      to: 's-col',
    },
    {
      id: 'e-e2',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      state: c.settlement === null ? 'inactive' : 'active',
      from: 'w-e2',
      to: 's-col',
    },
  ];

  const rules: SceneRule[] = [
    // One scale, printed once, for the two columns that share it — and printed
    // as plain 0 and 1 rather than as knees, because a knee is a symbol and the
    // symbols belong in the rail.
    {
      id: 'score-scale',
      axis: 'y',
      at: PROD_SCALE_X,
      from: PROD_BASE,
      to: PROD_BASE + PROD_H,
      tone: 'ink',
      ticks: [
        { at: PROD_BASE, label: String(DOMAIN_MIN) },
        { at: PROD_BASE + PROD_H, label: String(1) },
      ],
    },
    {
      id: 'prod-base',
      axis: 'x',
      at: PROD_BASE,
      from: PROD_SCALE_X,
      to: PROD_W_X + PROD_W + 0.3,
      tone: 'dim',
    },
    {
      id: 'epoch-base',
      axis: 'x',
      at: EPOCH_BASE,
      from: EPOCH_X0 - 0.3,
      to: EPOCH_X1 + EPOCH_W + 0.3,
      tone: 'dim',
    },
    {
      id: 's-base',
      axis: 'x',
      at: S_COL_BASE,
      from: S_COL_X - 0.3,
      to: S_COL_X + EPOCH_W + 0.3,
      tone: 'dim',
    },
    // Dividers, not axes: they mark the four steps of the flow so a reader has
    // somewhere to stop. Only the last one is named, because it is the only step
    // that is a jump in time rather than in arithmetic.
    ...DIV_XS.map((at, i) => ({
      id: `divider-${i}`,
      axis: 'y' as const,
      at,
      from: DIV_Y0,
      to: DIV_Y1,
      tone: 'dim' as const,
      dashed: true,
      ...(i === DIV_XS.length - 1 ? { label: 'later' } : {}),
    })),
  ];

  return {
    nodes,
    rules,
    relation:
      'Multiplicativity. Read it left to right: four things are measured, two of them become ' +
      'multipliers, and everything meets in one score. Because that last step multiplies rather ' +
      'than adds, each arrow can only make the number smaller — and when a multiplier collapses ' +
      'to a flat line the whole run drops to the floor, where no amount of economic growth or ' +
      'progress lifts it back. Drawn as stacked bars the same four readings would say the ' +
      'opposite, because a sum lets a healthy pillar pay for a failed one. The two epoch slots ' +
      'past the divider repeat the point in time: the payout is a geometric mean of two epochs, ' +
      'so a zeroed epoch cannot be averaged away by a good one either.',
    unitLegend:
      'Every box is one reading between 0 and 1 drawn as a fill level, and all four are the same ' +
      'size so the fills compare directly. A circle is a multiplier and its diameter is the ' +
      'multiplier itself: a wide circle passes nearly everything through, and one that has ' +
      'collapsed to a flat line passes nothing at all. The two columns share the marked scale, ' +
      'where full height above the baseline is 1.0.',
  };
}

// ---------------------------------------------------------------------------
// Rail data
// ---------------------------------------------------------------------------

const pillarLabel = (p: Pillar): string =>
  p === 'COnchain' ? 'C · on-chain' : p === 'CAttested' ? 'C · attested' : p;

/**
 * A plain-language gloss per component. The normative definitions live in doc 05
 * §4.3 and doc 07; these paraphrase the frozen `label` and nothing more.
 */
const METRIC_GLOSS: Readonly<Record<number, string>> = {
  1: 'Locally accepted XCM sends against sends that failed or timed out. Remote delivery is not runtime-readable, so v1 counts only what this chain can see.',
  2: 'A fail-static flag, not a ratio: zero while any Asset Hub reserve-probe anomaly is active, one otherwise.',
  3: 'Coverage ratios — collator, guardian and reporter bonds actually held against what the constitution requires. Same-asset, so no price enters.',
  4: 'Spare block execution weight — the busier of ref_time and proof_size, mapped so target utilization reads full headroom.',
  5: 'Defensive-path integrity events: a violated runtime assumption whose fallback discarded state that nothing later restores.',
  6: 'Distinct active block authors against the required minimum collator count.',
  10: 'Blocks authored — empty ones at a quarter — against the relay slots that actually elapsed.',
  11: 'Median relay-parent gap above the nominal one-block cadence, scaled by Λ_max. An inclusion measure, not a GRANDPA-finality one.',
  12: '(1 − HHI) of authorship shares, normalized by n_cap(phase).',
  20: 'Fees users actually paid over the epoch. It measures demand, not destruction — the USDC goes to the treasury rather than being burned.',
  21: 'Accounts paying a real fee on enough distinct days to qualify, cost-weighted.',
  22: 'Fee-weighted transfer value, with self-transfers down-weighted.',
  30: 'Audited upgrade milestones shipped against the version’s frozen target.',
  31: 'Runtime execution performance against its benchmark baseline.',
  32: 'Independent integrations that cleared an on-chain fee-paying usage bar.',
};

const pillarWeightSum = (pillar: Pillar): number =>
  V1_METRICS.filter((m) => m.registered && m.pillar === pillar).reduce(
    (total, m) => total + (m.weight ?? 0),
    0,
  );

/**
 * The severity ladder, read back out of `INCIDENT_MULTIPLIER.formula`.
 *
 * Parsing the frozen formula string is deliberate: it means the tiers printed
 * here cannot drift from the constant the protocol core carries, and a change to
 * the ladder shows up on this screen without anyone remembering to edit it.
 */
const SEVERITY_TIERS: readonly { readonly tier: string; readonly points: number }[] = [
  ...INCIDENT_MULTIPLIER.formula.matchAll(/S(\d)\s*=\s*([\d.]+)/g),
].flatMap((m) => {
  const tier = m[1];
  const points = m[2];
  return tier === undefined || points === undefined
    ? []
    : [{ tier: `S${tier}`, points: Number(points) }];
});

// ---------------------------------------------------------------------------
// Rail panels
// ---------------------------------------------------------------------------

function OverviewPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Components, pillars, W, s</h2>

      <Formula name="welfare.W" />
      <Formula name="welfare.composite" />
      <Formula name="welfare.s" />

      <p>
        <Value of={derived(V1_METRICS.length, C_METRICS)} /> component ids are assigned and{' '}
        <Value of={derived(V1_METRICS.filter((m) => m.registered).length, C_METRICS)} /> are
        registered. They roll up into four pillars: <strong>S</strong>, liveness — the diagram
        calls it {PLAIN.s} — taken as a minimum; <strong>C</strong>, security ({PLAIN.c}), a
        weighted geometric mean multiplied by the incident score; and <strong>P</strong> and{' '}
        <strong>A</strong>, prosperity and advancement ({PLAIN.p} and {PLAIN.a}), which are the
        only pair in the whole pipeline allowed to trade off against each other.
      </p>
      <p>
        S and C do not enter W as terms. They enter through gates, and a gate returns exactly
        zero below its lower knee. That is what makes W a product with a hard floor instead of a
        weighted average, and it is why a chain that is fast and profitable but concentrated in
        five collators can score zero for the epoch.
      </p>
      <p>
        Every pillar aggregate, gate, composite and W on this screen is recomputed by the
        protocol core rather than taken from the simulation, in the order doc 05 §4.4 makes
        normative: ascending MetricId, each multiplication floored onto the 1e9 grid
        immediately, gates multiplied together before the composite multiplies in ({' '}
        <span className="cite">{formatCitation(C_ARITH)}</span> ).
      </p>
    </section>
  );
}

function MetricsPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The v1 metric set</h2>
      <p>
        MetricIds are frozen and append-only: a new component gets a new id, and an id is never
        reused. That is why the ids jump rather than running consecutively, and why one row is
        held open without being active — the gaps and the reserved slot are the shape of an
        append-only registry, not an oversight.
      </p>

      <div className="we-scroll">
        <table className="we-table">
          <caption className="sr-only">
            The assigned v1 MetricIds with pillar and intra-pillar weight
          </caption>
          <thead>
            <tr>
              <th scope="col" className="numeric">
                Id
              </th>
              <th scope="col">Sym</th>
              <th scope="col">Name</th>
              <th scope="col">Pillar</th>
              <th scope="col" className="numeric">
                Weight
              </th>
              <th scope="col">What it measures</th>
            </tr>
          </thead>
          <tbody>
            {V1_METRICS.map((m) => (
              <tr
                key={m.id}
                id={`row-metric-${m.id}`}
                className={m.registered ? undefined : 'we-row--reserved'}
              >
                <th scope="row" className="mono numeric">
                  <Value of={spec(m.id, C_METRICS)} />
                </th>
                <td className="mono">{m.symbol}</td>
                <td>{m.label}</td>
                <td>{pillarLabel(m.pillar)}</td>
                <td className="numeric">
                  {m.weight === null ? (
                    <span className="we-absent">min</span>
                  ) : (
                    <Value of={spec(m.weight, C_METRICS)} format={f2} />
                  )}
                </td>
                <td>
                  {METRIC_GLOSS[m.id] ?? m.label}
                  {m.registered ? null : (
                    <>
                      {' '}
                      <span className="chip">reserved · not registered</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="panel__note">
        The S rows carry no weight because S is a <span className="mono">min</span>, not a mean (
        <span className="cite">{formatCitation(C_SMIN)}</span>). Each weighted group sums to one:
        C on-chain <Value of={derived(pillarWeightSum('COnchain'), C_METRICS)} format={f2} />, P{' '}
        <Value of={derived(pillarWeightSum('P'), C_METRICS)} format={f2} />, A{' '}
        <Value of={derived(pillarWeightSum('A'), C_METRICS)} format={f2} />.
      </p>

      <h3>One MetricId is held open, not shipped</h3>
      {RESERVED_METRIC === undefined ? null : (
        <>
          <p>
            <span className="mono">{RESERVED_METRIC.symbol}</span> — {RESERVED_METRIC.label}, id{' '}
            <Value of={spec(RESERVED_METRIC.id, C_METRICS)} /> — is assigned and deliberately{' '}
            <strong>not registered</strong> in v1. Its scale Λ_max has no anchor, and both
            directions of error are unsafe: set it too large and a persistently degraded chain
            never trips the S gate, set it too small and ordinary measurement noise VOIDs cohorts
            on a healthy one. Registering a component that has no value would make{' '}
            <span className="mono">record_snapshot</span> refuse forever.
          </p>
          <p>
            So v1 ships <Formula name="welfare.S" />, and S absorbs the absence
            at no structural cost precisely because it is a minimum with no weights to
            renormalize. The slot stays because ids are never reused — when Λ_max is settled, id{' '}
            <Value of={spec(RESERVED_METRIC.id, C_METRICS)} /> is where it lands (
            <span className="cite">{formatCitation(C_SMIN)}</span>).
          </p>
        </>
      )}
    </section>
  );
}

function CompositionPanel({ c }: { c: Composition }) {
  const breached = c.gS <= 0 || c.gC <= 0;

  return (
    <section className="panel">
      <h2 className="panel__title">What this epoch scored</h2>

      <p className="we-chiprow">
        <span className={breached ? 'chip chip--safety' : 'chip chip--state'}>
          {breached ? 'a multiplier is at zero' : 'both multipliers open'}
        </span>
        <span className="chip chip--state">
          W = <Value of={derived(c.w, C_ARITH)} format={fw} />
        </span>
      </p>

      <p className="panel__note">
        The diagram names these in plain words and this table names them in the
        specification&rsquo;s: {PLAIN.s} is <span className="mono">S</span>, {PLAIN.c} is{' '}
        <span className="mono">C</span>, {PLAIN.p} is <span className="mono">P</span>, {PLAIN.a}{' '}
        is <span className="mono">A</span>, and {PLAIN.w} is <span className="mono">W</span>. Both
        columns of the pair are here so neither can drift from the other.
      </p>

      <table className="we-table">
        <caption className="sr-only">Pillar values, gate outputs and the composite</caption>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">Spec</th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-pillar-s">
            <th scope="row">
              {PLAIN.s} — S, liveness, min(U, D_eff)
            </th>
            <td className="numeric">
              <Value of={simulated(c.sPillar)} format={f4} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_SMIN)}</span>
            </td>
          </tr>
          <tr id="row-gate-s">
            <th scope="row">
              {PLAIN.s} multiplier — g(S), the survival gate
            </th>
            <td className="numeric">
              <Value of={derived(c.gS, C_KNEE)} format={fw} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_KNEE)}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">C on-chain geometric mean</th>
            <td className="numeric">
              <Value of={simulated(c.cGeo)} format={f4} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_ARITH)}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">I — incident multiplier</th>
            <td className="numeric">
              <Value of={simulated(c.incident)} format={f4} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(INCIDENT_MULTIPLIER.cite)}</span>
            </td>
          </tr>
          <tr id="row-pillar-c">
            <th scope="row">
              {PLAIN.c} — C, I × the on-chain mean
            </th>
            <td className="numeric">
              <Value of={derived(c.cPillar, C_ARITH)} format={f4} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_ARITH)}</span>
            </td>
          </tr>
          <tr id="row-gate-c">
            <th scope="row">
              {PLAIN.c} multiplier — g(C), the security gate
            </th>
            <td className="numeric">
              <Value of={derived(c.gC, C_KNEE)} format={fw} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_KNEE)}</span>
            </td>
          </tr>
          <tr id="row-pillar-p">
            <th scope="row">
              {PLAIN.p} — P, prosperity
            </th>
            <td className="numeric">
              <Value of={simulated(c.p)} format={f4} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_METRICS)}</span>
            </td>
          </tr>
          <tr id="row-pillar-a">
            <th scope="row">
              {PLAIN.a} — A, advancement
            </th>
            <td className="numeric">
              <Value of={simulated(c.a)} format={f4} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_METRICS)}</span>
            </td>
          </tr>
          <tr id="row-composite">
            <th scope="row">
              Blend — GeoComposite(P, A) at{' '}
              <Value of={spec(WEIGHT_P, C_TUNABLE)} format={f2} /> /{' '}
              <Value of={spec(WEIGHT_A, C_TUNABLE)} format={f2} />
            </th>
            <td className="numeric">
              <Value of={derived(c.composite, C_PIPELINE)} format={f4} badge />
            </td>
            <td>
              <span className="cite">{formatCitation(C_TUNABLE)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>The product, one factor at a time</h3>
      <table className="we-table">
        <caption className="sr-only">The running product that produces W</caption>
        <thead>
          <tr>
            <th scope="col">Running product</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">What just multiplied in</th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-prod-gs">
            <th scope="row" className="mono">
              g(S)
            </th>
            <td className="numeric">
              <Value of={derived(c.gS, C_KNEE)} format={fw} badge />
            </td>
            <td>The survival gate, evaluated first.</td>
          </tr>
          <tr id="row-prod-gc">
            <th scope="row" className="mono">
              g(S) · g(C)
            </th>
            <td className="numeric">
              <Value of={derived(c.gateProduct, C_ARITH)} format={fw} badge />
            </td>
            <td>
              The security gate. The two gates are multiplied and floored together, before the
              composite, because the association is normative.
            </td>
          </tr>
          <tr id="row-w">
            <th scope="row" className="mono">
              g(S) · g(C) · GeoComposite = W
            </th>
            <td className="numeric">
              <Value of={derived(c.w, C_ARITH)} format={fw} badge />
            </td>
            <td>The only part of the pipeline that is a trade-off rather than a veto.</td>
          </tr>
        </tbody>
      </table>

      <p className="panel__note">
        The pillar inputs are scenario values; the gates, the composite and W are computed here
        by the protocol core from them. The badges say which is which on every number.
      </p>
    </section>
  );
}

function GatePanel({ c }: { c: Composition }) {
  // Each probe carries its own provenance: the knees are specification values,
  // the offsets between them are arithmetic on those values, and the live row is
  // the scenario's own invented S — the same number, and the same label, the
  // composition table above gives it.
  const probes: readonly {
    readonly key: string;
    readonly note: string;
    readonly s: Tagged<number>;
  }[] = [
    {
      key: 'below',
      note: 'one grid unit below the knee',
      s: derived(THETA_S_LO - EPSILON_W, C_KNEE),
    },
    { key: 'at', note: 'exactly at the knee', s: spec(THETA_S_LO, C_FLOOR) },
    {
      key: 'mid',
      note: 'midway between the knees',
      s: derived((THETA_S_LO + THETA_S_HI) / 2, C_KNEE),
    },
    { key: 'upper', note: 'at the upper knee', s: spec(THETA_S_HI, C_TUNABLE) },
    { key: 'live', note: 'the live S', s: simulated(c.sPillar) },
  ];

  return (
    <section className="panel">
      <h2 className="panel__title">The smoothstep gate</h2>
      <Formula name="welfare.gate" />
      <Formula name="welfare.t" />
      <p>
        Below θ⁻ the gate is exactly 0. Between the knees it is the C¹ smoothstep 3t² − 2t³,
        evaluated as t·t·(3 − 2t) with a floor after every multiplication so two conforming
        implementations land on the same grid point. At and above θ⁺ it is exactly 1. There is no
        slope below the lower knee: the function does not fade out, it stops.
      </p>

      <table className="we-table">
        <caption className="sr-only">The four knees and the live distance to each of them</caption>
        <thead>
          <tr>
            <th scope="col">Knee</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col" className="numeric">
              Live margin
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="mono">
              θS⁻
            </th>
            <td className="numeric">
              <Value of={spec(THETA_S_LO, C_FLOOR)} format={f2} />
            </td>
            <td className="numeric">
              <Value of={derived(c.sPillar - THETA_S_LO, C_KNEE)} format={f4} />
            </td>
            <td>Entrenched genesis floor</td>
          </tr>
          <tr>
            <th scope="row" className="mono">
              θS⁺
            </th>
            <td className="numeric">
              <Value of={spec(THETA_S_HI, C_TUNABLE)} format={f2} />
            </td>
            <td className="numeric">
              <Value of={derived(c.sPillar - THETA_S_HI, C_KNEE)} format={f4} />
            </td>
            <td>Governable, no kernel floor</td>
          </tr>
          <tr>
            <th scope="row" className="mono">
              θC⁻
            </th>
            <td className="numeric">
              <Value of={spec(THETA_C_LO, C_FLOOR)} format={f2} />
            </td>
            <td className="numeric">
              <Value of={derived(c.cPillar - THETA_C_LO, C_KNEE)} format={f4} />
            </td>
            <td>Entrenched genesis floor</td>
          </tr>
          <tr>
            <th scope="row" className="mono">
              θC⁺
            </th>
            <td className="numeric">
              <Value of={spec(THETA_C_HI, C_TUNABLE)} format={f2} />
            </td>
            <td className="numeric">
              <Value of={derived(c.cPillar - THETA_C_HI, C_KNEE)} format={f4} />
            </td>
            <td>Governable, no kernel floor</td>
          </tr>
        </tbody>
      </table>

      <p>
        θS⁻ = <Value of={spec(THETA_S_LO, C_FLOOR)} format={f2} /> and θC⁻ ={' '}
        <Value of={spec(THETA_C_LO, C_FLOOR)} format={f2} /> are <strong>entrenched genesis
        floors</strong>. They are the launch defaults and simultaneously a bound no track and no
        supermajority may go below: a passed proposal can raise them, and nothing in the
        governance system can lower them past the floor (
        <span className="cite">{formatCitation(C_FLOOR)}</span>). The upper knees are ordinary
        governable values with no kernel floor beneath them.
      </p>

      <h3>The cliff, probed</h3>
      <p className="panel__note">
        The same pipeline re-evaluated at{' '}
        <Value of={derived(probes.length, C_KNEE)} /> values of S, holding C, P and A at their
        live values. This is arithmetic on the gate, not a forecast of anything. The S column is
        printed at full 1e9-grid precision because the first two rows differ by exactly one grid
        unit — and one grid unit is the difference between a live epoch and a zeroed one.
      </p>
      {c.gC <= 0 ? (
        <p className="panel__note">
          The security gate is already at zero in this state, so every row of the W column reads
          zero whatever S does. That is not a broken probe; it is the product refusing to let one
          healthy gate stand in for a breached one.
        </p>
      ) : null}
      <table className="we-table">
        <caption className="sr-only">W re-evaluated across the survival knee</caption>
        <thead>
          <tr>
            <th scope="col" className="numeric">
              S
            </th>
            <th scope="col" className="numeric">
              g(S)
            </th>
            <th scope="col" className="numeric">
              W
            </th>
            <th scope="col">Reading</th>
          </tr>
        </thead>
        <tbody>
          {probes.map((probe) => (
            <tr key={probe.key} id={`row-probe-${probe.key}`}>
              <th scope="row" className="mono numeric">
                <Value of={probe.s} format={f9} />
              </th>
              <td className="numeric">
                <Value
                  of={derived(gate(probe.s.value, THETA_S_LO, THETA_S_HI), C_KNEE)}
                  format={fw}
                />
              </td>
              <td className="numeric">
                <Value
                  of={derived(welfareValue(probe.s.value, c.cPillar, c.p, c.a), C_ARITH)}
                  format={fw}
                />
              </td>
              <td>{probe.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProductPanel({ c }: { c: Composition }) {
  const nCap = collatorNCap(EXAMPLE_PHASE);
  const dEff = collatorDEff(HHI_EXAMPLE, EXAMPLE_PHASE);
  const dEffGate = gate(dEff, THETA_S_LO, THETA_S_HI);
  const zeroed = c.gS <= 0 || c.gC <= 0;

  return (
    <section className="panel">
      <h2 className="panel__title">Why it is a product, not a sum</h2>
      <p>
        A breached gate does not reduce welfare. It zeroes it. Under a weighted sum a pillar at
        zero costs the epoch its share and no more, so a chain could buy its way out of a
        liveness failure with fee growth. Under a product there is nothing to buy with: one
        factor at zero and the whole epoch is zero, whatever the other three say.
      </p>

      <p className="we-chiprow">
        <span className={c.gS <= 0 ? 'chip chip--safety' : 'chip chip--state'}>
          g(S) = <Value of={derived(c.gS, C_KNEE)} format={fw} />
        </span>
        <span className={c.gC <= 0 ? 'chip chip--safety' : 'chip chip--state'}>
          g(C) = <Value of={derived(c.gC, C_KNEE)} format={fw} />
        </span>
      </p>

      {zeroed ? (
        <p>
          One of the two gates is at zero right now, and W is{' '}
          <Value of={derived(c.w, C_ARITH)} format={fw} /> as a consequence — with P at{' '}
          <Value of={simulated(c.p)} format={f4} /> and A at{' '}
          <Value of={simulated(c.a)} format={f4} />, which under an average would have carried
          the epoch comfortably. That difference is the entire design.
        </p>
      ) : (
        <p>
          Both gates are open, so W is currently the composite scaled by them:{' '}
          <Value of={derived(c.w, C_ARITH)} format={fw} />. Set either gate to zero and this
          number becomes zero, no matter how far P and A rise.
        </p>
      )}

      <h3>A concrete way to reach zero</h3>
      <p>
        The specification&rsquo;s own worked collator split —{' '}
        <Value of={spec(HHI_EXAMPLE_SPLIT, C_DEFF)} /> authorship, an HHI of{' '}
        <Value of={spec(HHI_EXAMPLE, C_DEFF)} format={f4} /> — normalized against a bootstrap
        n_cap of <Value of={spec(nCap, C_DEFF)} /> gives D_eff ={' '}
        <Value of={derived(dEff, C_DEFF)} format={fw} />. Since S is{' '}
        <span className="mono">min(U, D_eff)</span>, S can be no higher than that, so g(S) ={' '}
        <Value of={derived(dEffGate, C_KNEE)} format={fw} /> and the epoch scores zero — on a
        chain that never missed a block, with a full treasury and a healthy reserve. It failed
        for being concentrated, and nothing else was allowed to compensate (
        <span className="cite">{formatCitation(C_DEFF)}</span>).
      </p>
    </section>
  );
}

function IncidentPanel({ c }: { c: Composition }) {
  // The mildest tier is read out of the ladder rather than named, and what it
  // does to the live C is computed — so the sentence below cannot assert a
  // breach the arithmetic does not produce.
  const mildest = SEVERITY_TIERS.reduce((lowest, t) => (t.points < lowest.points ? t : lowest));
  const mildestBreaches =
    gate(securityPillar(c.cGeo, Math.max(0, 1 - mildest.points)), THETA_C_LO, THETA_C_HI) <= 0;

  return (
    <section className="panel">
      <h2 className="panel__title">The incident multiplier</h2>
      <Formula name="welfare.incident" />
      <p>
        <span className="mono">{INCIDENT_MULTIPLIER.symbol}</span> —{' '}
        {INCIDENT_MULTIPLIER.label} — is not a component. It carries no weight and appears in no
        ascending-id product. It belongs to the{' '}
        {pillarLabel(INCIDENT_MULTIPLIER.pillar)} class, but what it multiplies is the whole{' '}
        <strong>C</strong> pillar — the on-chain geometric mean included. Crucially it has{' '}
        <strong>no ε floor beneath it</strong>, unlike every weighted
        term in the geometric means. A weighted component that goes to zero is bounded at ε ={' '}
        <Value of={spec(EPSILON_C, C_EPSC)} format={f2} /> raised to its own weight, so a dead
        component cannot annihilate its pillar through the logarithm. I at zero is simply zero.
      </p>
      <p>
        So a single upheld severity-1 filing drives C to zero, C at zero is far below θC⁻, and W
        for that epoch is zero (<span className="cite">{formatCitation(INCIDENT_MULTIPLIER.cite)}</span>
        ).
      </p>

      <table className="we-table">
        <caption className="sr-only">
          Each severity tier applied to the live on-chain C mean
        </caption>
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col" className="numeric">
              Severity
            </th>
            <th scope="col" className="numeric">
              I
            </th>
            <th scope="col" className="numeric">
              C
            </th>
            <th scope="col" className="numeric">
              g(C)
            </th>
            <th scope="col" className="numeric">
              W
            </th>
          </tr>
        </thead>
        <tbody>
          {SEVERITY_TIERS.map((t) => {
            const i = Math.max(0, 1 - t.points);
            const cHat = securityPillar(c.cGeo, i);
            return (
              <tr key={t.tier} id={`row-severity-${t.tier}`}>
                <th scope="row" className="mono">
                  {t.tier}
                </th>
                <td className="numeric">
                  <Value of={spec(t.points, INCIDENT_MULTIPLIER.cite)} format={f2} />
                </td>
                <td className="numeric">
                  <Value of={derived(i, INCIDENT_MULTIPLIER.cite)} format={f2} />
                </td>
                <td className="numeric">
                  <Value of={derived(cHat, C_ARITH)} format={f4} />
                </td>
                <td className="numeric">
                  <Value of={derived(gate(cHat, THETA_C_LO, THETA_C_HI), C_KNEE)} format={fw} />
                </td>
                <td className="numeric">
                  <Value
                    of={derived(welfareValue(c.sPillar, cHat, c.p, c.a), C_ARITH)}
                    format={fw}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="panel__note">
        Each row applies that tier to the live on-chain C mean of{' '}
        <Value of={simulated(c.cGeo)} format={f4} /> and re-runs the pipeline. Read the g(C)
        column against the knee:{' '}
        {mildestBreaches
          ? `at this on-chain mean even ${mildest.tier}, the mildest tier there is, pushes C under θC⁻ and closes the gate outright.`
          : `at this on-chain mean ${mildest.tier}, the mildest tier there is, still leaves the gate open — but the margin above θC⁻ is what the rows below spend.`}{' '}
        The C gate leaves very little room for incidents, which is what a gate is for.
      </p>
    </section>
  );
}

function SettlementPanel({ c, decided }: { c: Composition; decided: boolean }) {
  const settled = c.settlement;

  return (
    <section className="panel">
      <h2 className="panel__title">The settlement score</h2>
      <Formula name="welfare.s-named" />
      <p>
        s is measured over the two epochs <strong>after</strong> the decision, not during
        trading. A cohort&rsquo;s measurement horizon runs to k ={' '}
        <Value of={derived(DERIVED_MAX_HORIZON_K, COHORT_CITATION)} />, and that ceiling is
        derived rather than chosen: a cohort stays non-terminal for k + 2 epochs, one forms every
        epoch, and the invariant caps concurrent cohorts at{' '}
        <Value of={spec(MAX_NON_TERMINAL_COHORTS, COHORT_CITATION)} /> — so a larger k would
        wedge qualification permanently. The world therefore gets two full epochs to show what
        the decision was worth, and the score is their geometric mean rather than their average —
        the same multiplicativity as W, now in time.
      </p>
      <p>
        At settlement, LONG holders receive s per unit and SHORT holders 1 − s, with both sides
        floored so a complete LONG+SHORT pair always redeems for exactly its principal and never
        a base unit more (<span className="cite">{formatCitation(C_PAYOUT)}</span>).
      </p>

      <table className="we-table">
        <caption className="sr-only">The measurement horizon and the realised score</caption>
        <thead>
          <tr>
            <th scope="col">Slot</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-w-e1">
            <th scope="row" className="mono">
              W(e+1)
            </th>
            <td className="numeric">
              <span className="we-absent">not measured</span>
            </td>
            <td>The first epoch after the decision.</td>
          </tr>
          <tr id="row-w-e2">
            <th scope="row" className="mono">
              W(e+2)
            </th>
            <td className="numeric">
              <span className="we-absent">not measured</span>
            </td>
            <td>The second. Both are epochs, and this screen holds one snapshot.</td>
          </tr>
          <tr id="row-s">
            <th scope="row" className="mono">
              s
            </th>
            <td className="numeric">
              {settled === null ? (
                <span className="we-absent">not yet settled</span>
              ) : (
                <Value of={simulated(settled)} format={fw} badge />
              )}
            </td>
            <td>
              {settled === null
                ? 'The cohort has not settled, so there is no score.'
                : 'Realised for this cohort by the scenario.'}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="panel__note">
        The two epoch slots stay empty on purpose. The W above is one epoch&rsquo;s snapshot, not
        a horizon series, and filling the slots in with it would present a settlement score the
        simulation never measured.
      </p>

      {settled === null ? null : (
        <p>
          LONG pays <Value of={simulated(settled)} format={f4} /> per unit and SHORT pays{' '}
          <Value of={derived(1 - settled, C_PAYOUT)} format={f4} />. Nobody was paid for being
          right about the decision; they were paid for what the world scored afterwards.
        </p>
      )}

      <h3>What one zeroed epoch does to a geometric mean</h3>
      <p className="panel__note">
        Arithmetic on the formula, not this cohort&rsquo;s score. Both rows below are worked
        pairs: the first leg is this epoch&rsquo;s W used as a stand-in magnitude, and the second
        is a hypothesis. Neither measurement epoch has happened, so the column is labelled as the
        geometric mean of the pair and never as s.
      </p>
      <table className="we-table">
        <caption className="sr-only">
          The geometric mean of a worked pair of epochs, at two second-epoch hypotheses
        </caption>
        <thead>
          <tr>
            <th scope="col">Worked pair</th>
            <th scope="col" className="numeric">
              GeoMean of the pair
            </th>
          </tr>
        </thead>
        <tbody>
          <tr id="row-sens-same">
            <th scope="row">second epoch matches the first</th>
            <td className="numeric">
              <Value of={derived(settlementScore(c.w, c.w), C_SCORE)} format={fw} />
            </td>
          </tr>
          <tr id="row-sens-zero">
            <th scope="row">second epoch scores zero</th>
            <td className="numeric">
              <Value of={derived(settlementScore(c.w, DOMAIN_MIN), C_SCORE)} format={fw} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        A zeroed epoch does not halve the mean. Every leg is floored at ε_W ={' '}
        <Value of={spec(EPSILON_W, C_EPSW)} format={fexp} /> — one base unit on the 1e9 grid, and
        the only thing standing between a zeroed epoch and a logarithm of zero — so a zeroed
        second epoch pulls the pair down to the geometric mean of that floor with whatever
        survived, not to half of it. ε_W is not a cushion: it is small enough that it can never
        round a real score up (<span className="cite">{formatCitation(C_SCORE)}</span>).
      </p>

      <p>
        {decided
          ? 'The decision for this proposal has already been evaluated; it lives in the decision scene. Nothing on this screen revisits it — what changes here is only what the adopted world went on to earn.'
          : 'No decision has been evaluated in this scenario yet. The Decision books price s before it exists, and until the decision windows seal the chain publishes no decision statistics at all, so nothing on this screen is a projection of a PASS or a REJECT.'}
      </p>
    </section>
  );
}

function ProvenancePanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">What is simulated here, and what is not</h2>
      <dl className="we-dl">
        <dt>Simulated</dt>
        <dd>
          The pillar inputs: S, the on-chain C mean, the incident multiplier, P, A, and any
          realised settlement score. These are scenario values invented to make the mechanism
          concrete. No number on this page was read from a chain.
        </dd>
        <dt>Specification</dt>
        <dd>
          The MetricIds and their intra-pillar weights, the four knees, the composite weights{' '}
          <Value of={spec(WEIGHT_P, C_TUNABLE)} format={f2} /> /{' '}
          <Value of={spec(WEIGHT_A, C_TUNABLE)} format={f2} />, the severity ladder and ε_W.
        </dd>
        <dt>Derived</dt>
        <dd>
          Everything the protocol core computed from the two above: both gate outputs, the C
          pillar, the geometric composite, W, the g(S) and W of every probe row, the C, g(C) and
          W of every severity row, and both geometric means.
        </dd>
      </dl>
      <p className="panel__note">
        A derivation over simulated inputs stays simulated in the real client&rsquo;s never-promote
        rule. This scene labels the core&rsquo;s output as derived so you can see which arithmetic
        is the specification&rsquo;s and which quantity was invented — the badge on each number
        says which.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * The rail is ordered by how much the reader has asked for.
 *
 * A lede and four numbers answer "what is this screen about" without a single
 * formula. One panel stays open, and it is the one the canvas points at: every
 * object drawn on the stage has its row there. Everything else — the normative
 * arithmetic, the knees, the incident ladder, the fifteen component ids, the
 * settlement horizon, the provenance ledger — is one click away and closed,
 * because a first reader who meets all of it at once reads none of it.
 *
 * Nothing was dropped in the reordering. A closed `<details>` keeps its contents
 * in the DOM, so find-in-page still reaches them and the canvas-to-rail row
 * bijection the tests assert still holds with every drawer shut.
 */
export function WelfareEngineScene({ sim }: { sim: SimState }): JSX.Element {
  const c = compose(sim);
  const registered = V1_METRICS.filter((m) => m.registered).length;

  /**
   * The surface is `gate(S)·gate(C)·composite`, and the plateau it is drawn at
   * is the composite the other two pillars actually produced. That makes the
   * marker land on the surface by construction rather than by coincidence: if
   * the engine's W and the surface's height ever disagreed, the pin would float
   * and you would see it.
   */
  const motion: MotionSpec = {
    kind: 'cliff',
    props: {
      s: c.sPillar,
      c: c.cPillar,
      plateau: c.composite,
      w: c.w,
      thetaS: [THETA_S_LO, THETA_S_HI],
      thetaC: [THETA_C_LO, THETA_C_HI],
    },
  };

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame
          model={buildModel(sim)}
          motion={motion}
          title="The welfare engine"
        />
      </div>
      <div className="col-rail">
        <Lede>
          The chain has to answer one question with a single number: how well did things
          actually go? Every market here is a bet on that number, so it has to be hard to fake.
          Two of the four things it measures — uptime and security — do not add to the score,{' '}
          <strong>they multiply it, and a multiplier can be zero</strong>, so a proposal that
          grows the treasury while breaking the chain scores nothing at all. The uptime half is
          measuring the people who actually produce the blocks: the chain&rsquo;s{' '}
          <Jargon word="collator" label="collators" />.
        </Lede>

        <KeyFacts>
          <KeyFact label={`${PLAIN.w} this epoch`} note="1.0 is a perfect epoch; 0 is a failed one.">
            <Value of={derived(c.w, C_ARITH)} format={fw} />
          </KeyFact>
          <KeyFact
            label={`${PLAIN.s} multiplier`}
            note={`Exactly zero below ${f2(THETA_S_LO)}. No partial credit.`}
          >
            <Value of={derived(c.gS, C_KNEE)} format={fw} />
          </KeyFact>
          <KeyFact
            label={`${PLAIN.c} multiplier`}
            note={`Exactly zero below ${f2(THETA_C_LO)}. One incident can do it.`}
          >
            <Value of={derived(c.gC, C_KNEE)} format={fw} />
          </KeyFact>
          <KeyFact
            label="Pays out"
            note={
              c.settlement === null
                ? 'Measured over the two epochs after the decision, not during trading.'
                : 'LONG is paid this per unit; SHORT is paid the rest.'
            }
          >
            {c.settlement === null ? (
              <span className="we-absent">not yet settled</span>
            ) : (
              <Value of={simulated(c.settlement)} format={fw} />
            )}
          </KeyFact>
        </KeyFacts>

        <CompositionPanel c={c} />

        <Depth title="The exact formula, in the order it is computed" hint="05 §4.4">
          <OverviewPanel />
        </Depth>
        <Depth title="How the safety multiplier curve works — and where the cliff is" hint="4 knees">
          <GatePanel c={c} />
          <ProductPanel c={c} />
        </Depth>
        <Depth
          title="One incident report can zero the whole epoch"
          hint={`${SEVERITY_TIERS.length} tiers`}
        >
          <IncidentPanel c={c} />
        </Depth>
        <Depth
          title="Every component that feeds the score"
          hint={`${registered} of ${V1_METRICS.length} live`}
        >
          <MetricsPanel />
        </Depth>
        <Depth
          title="How it pays out — and what is simulated here"
          hint={`k = ${DERIVED_MAX_HORIZON_K}`}
        >
          <SettlementPanel c={c} decided={sim.decision !== null} />
          <ProvenancePanel />
        </Depth>
      </div>
    </div>
  );
}
