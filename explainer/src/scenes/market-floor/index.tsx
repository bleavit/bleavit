import type { JSX } from 'react';

import { cite } from '../../protocol/citations';
import {
  BOOKS_PER_PROPOSAL,
  DECISION_SANITY_MAX,
  DECISION_SANITY_MIN,
  GATE_P_MAX_CEILING,
  LMSR_DOMAIN_BOUND,
  MAX_TRADE_RATIO,
  MKT_STALE_GAP_BLOCKS,
} from '../../protocol/constants';
import type { CurveSample, QuoteResult } from '../../protocol/lmsr';
import {
  DOMAIN_CITATION,
  LMSR_CITATION,
  WRAPPER_CITATION,
  buy,
  clampQuoteForDisplay,
  cost,
  displacementForPriceMove,
  makerLossAtPrice,
  makerLossBound,
  maxTradeAmount,
  priceLong,
  sampleCurve,
  withinDomain,
} from '../../protocol/lmsr';
import { param, perClass } from '../../protocol/params';
import { CONTEST_CAPITAL_CITATION, TWAP_CITATION, slewBand } from '../../protocol/twap';
import type { GateType, MarketKind } from '../../protocol/types';
import { MARKET_KINDS, requiresGateMarkets } from '../../protocol/types';
import { USDC, formatPrice, formatUsdc } from '../../protocol/units';
import { THETA_C_LO, THETA_S_LO } from '../../protocol/welfare';
import type { Tagged } from '../../provenance/types';
import { combine, derived, simulated, spec } from '../../provenance/types';
import type { BookState, SimState } from '../../sim/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import type { NodeState, SceneModel, SceneNode, SceneRule, Tone } from '../model';
import { SceneFrame } from '../SceneFrame';
import type { MotionSpec } from '../motion';
import './market-floor.css';
import { Formula } from '../../ui/Formula';

/**
 * The market floor — doc 04.
 *
 * Seven books trade at once and they are not seven of the same thing. Two
 * decision books price the settlement score `s` of a world; four gate books
 * price the probability that a *daily* safety floor is breached in that world;
 * one Baseline book prices the epoch itself, conditional on nothing. The scene
 * exists to make three relations physical: they share one 0–1 scale, the gate
 * veto stands over the gate books as a ceiling that a rising column cannot pass,
 * and the Baseline sits outside both branches with a gap around it.
 *
 * Three drawing rules here are protocol facts, not styling:
 *
 *  - the level line on every plate is the **72-hour window TWAP**, because that
 *    is the number the decision rule actually reads. Spot is drawn beside it on
 *    the decision books and never substituted for it;
 *  - the Baseline is achromatic. Tinting it toward a branch would misstate the
 *    one book that belongs to neither;
 *  - the sanity band is drawn across the **welfare** books — the decision pair
 *    *and* the Baseline (doc 13 §3.2). Gate books are exempt from it, and
 *    drawing it over them would teach a rule that does not exist.
 *
 * The rail is ordered for a reader who has met none of this: lede, three or four
 * numbers, one panel that says how to read the drawing, and everything else in
 * drawers that open on request. The dense material is moved, never dropped —
 * every table, bound, key and citation is still here, one click down.
 */

// ---------------------------------------------------------------------------
// Stage geometry
// ---------------------------------------------------------------------------

const AXIS_X = 1.0;
const BASE_Y = 1.5;
const PLATE_H = 9.3;

/** Price is a level: the same map from [0,1] to stage y on every plate. */
const priceY = (p: number): number => BASE_Y + p * PLATE_H;

interface BookLayout {
  readonly x: number;
  readonly w: number;
  readonly tone: Tone;
  /**
   * What a stranger should read under the plate. Never the spec identifier —
   * `GateC_Adopt` names nothing to someone meeting the protocol here, and the
   * frozen `MarketKind` string is carried by the rail table instead.
   */
  readonly label: string;
  readonly family: 'decision' | 'gate' | 'baseline';
  /** What this book prices, in one clause. */
  readonly question: string;
  /** Second line on the plate for the gate books, which carry no number. */
  readonly branchWord?: string;
}

/**
 * Positions, keyed by the frozen `MarketKind` set (doc 02 §6). The canonical
 * order comes from `MARKET_KINDS` itself, so the diagram cannot drift out of the
 * contract's order by an editing accident.
 *
 * **Spacing is legibility, not taste.** `Scene2D` centres each label under its
 * node at 0.42 stage-unit type, so an N-character label occupies about
 * `N · 0.24` units and two labels on one row are legible only while
 *
 *     |centre_a − centre_b| > (len_a + len_b) · 0.12 + 0.3
 *
 * Seven plates share one row here because the shared 0–1 scale is the scene's
 * whole claim — splitting the gate books onto a second row would give the labels
 * room by giving up the thing they label. So the row is pitched at 2.7 units
 * between the gate centres and 2.4 between the decision pair, which clears the
 * worst adjacent case (`Survival` beside `Survival`, needing 2.22) by 0.48.
 * Centres: 2.4, 5.1, 7.8, 10.5 · 13.2, 15.6 · 19.8.
 */
const LAYOUT: Readonly<Record<MarketKind, BookLayout>> = {
  DecisionAccept: {
    x: 12.3,
    w: 1.8,
    tone: 'accept',
    label: 'ACCEPT',
    family: 'decision',
    question: 'the welfare this chain realises in the world where the proposal is adopted',
  },
  DecisionReject: {
    x: 14.7,
    w: 1.8,
    tone: 'reject',
    label: 'REJECT',
    family: 'decision',
    question: 'the welfare this chain realises in the world where it is rejected',
  },
  GateS_Adopt: {
    x: 1.6,
    w: 1.6,
    tone: 'accept',
    label: 'Survival',
    family: 'gate',
    question:
      'the chance the daily Survival (S) input breaches its floor on at least one day of the two measurement epochs, if adopted',
    branchWord: 'adopt',
  },
  GateS_Reject: {
    x: 4.3,
    w: 1.6,
    tone: 'reject',
    label: 'Survival',
    family: 'gate',
    question: 'the same Survival breach, in the world where the proposal is rejected',
    branchWord: 'reject',
  },
  GateC_Adopt: {
    x: 7.0,
    w: 1.6,
    tone: 'accept',
    label: 'Security',
    family: 'gate',
    question:
      'the chance the daily on-chain Security (C) input breaches its floor on at least one day, if adopted',
    branchWord: 'adopt',
  },
  GateC_Reject: {
    x: 9.7,
    w: 1.6,
    tone: 'reject',
    label: 'Security',
    family: 'gate',
    question: 'the same Security breach, in the world where it is rejected',
    branchWord: 'reject',
  },
  Baseline: {
    x: 18.7,
    w: 2.2,
    tone: 'ink',
    label: 'Baseline',
    family: 'baseline',
    question:
      'the epoch’s own realised welfare score s_e, conditional on nothing — the statistic that settles the epoch’s cohorts',
  },
};

/** The DOM row this object is the drawing of. Asserted by eye and by tests. */
const rowId = (kind: MarketKind): string => `row-book-${kind}`;
const CEILING_ROW = 'row-gate-ceiling';

// ---------------------------------------------------------------------------
// Registry reads (doc 13 is the only home for these values)
// ---------------------------------------------------------------------------

const P_MAX = param('gate.p_max');
const GATE_EPS = param('gate.eps');
const MKT_FEE = param('mkt.fee');
const MKT_KAPPA = param('mkt.kappa');
const OBS_INTERVAL = param('mkt.obs_interval');
const DEC_COVERAGE = param('dec.coverage');
const GATE_NB_COVERAGE = param('gate.nb_coverage');
const GATE_NB_CONV = param('gate.nb_conv');
const DEC_DELTA_MAX = param('dec.delta_max');
const DEC_WINDOW = param('dec.window');
const DEC_TRAILING = param('dec.trailing');
const POL_B_BASELINE = param('pol.b_baseline');

const specOf = (row: { value: number; cite: ReturnType<typeof cite> }): Tagged<number> =>
  spec(row.value, row.cite);

// ---------------------------------------------------------------------------
// Gate readings
// ---------------------------------------------------------------------------

interface GatePair {
  readonly gate: GateType;
  readonly adoptKind: MarketKind;
  readonly rejectKind: MarketKind;
  /** The daily welfare input whose floor this gate prices a breach of. */
  readonly floor: number;
  readonly floorLabel: string;
}

const GATE_PAIRS: readonly GatePair[] = [
  {
    gate: 'Survival',
    adoptKind: 'GateS_Adopt',
    rejectKind: 'GateS_Reject',
    floor: THETA_S_LO,
    floorLabel: 'θS⁻',
  },
  {
    gate: 'Security',
    adoptKind: 'GateC_Adopt',
    rejectKind: 'GateC_Reject',
    floor: THETA_C_LO,
    floorLabel: 'θC⁻',
  },
];

interface GateReading extends GatePair {
  readonly adopt: BookState | undefined;
  readonly reject: BookState | undefined;
  readonly capBreached: boolean;
  readonly relBreached: boolean;
  readonly vetoed: boolean;
}

const bookOf = (sim: SimState, kind: MarketKind): BookState | undefined =>
  sim.books.find((b) => b.kind === kind);

/**
 * The spot-versus-TWAP bound that actually grades a book (doc 05 §5.2).
 *
 * `dec.delta_max` is the welfare-book convergence bound. A gate book whose window
 * TWAP sits outside the sanity band is graded by the near-boundary rule instead,
 * whose bound is the tighter `gate.nb_conv`; inside the band a gate book uses the
 * welfare-book checks like everything else. Printing `dec.delta_max` against every
 * row would state the wrong threshold for exactly the books that live near zero.
 */
function convergenceBound(
  kind: MarketKind,
  twap: number,
): { readonly row: typeof DEC_DELTA_MAX; readonly key: string } {
  const nearBoundary = twap < DECISION_SANITY_MIN || twap > DECISION_SANITY_MAX;
  return LAYOUT[kind].family === 'gate' && nearBoundary
    ? { row: GATE_NB_CONV, key: 'gate.nb_conv' }
    : { row: DEC_DELTA_MAX, key: 'dec.delta_max' };
}

/**
 * The step-4 test, on the same inputs `decide()` uses: the **window TWAP** of
 * each gate book, never its spot. Both limbs are strict (`>`), so a price sitting
 * exactly on the cap is inside it.
 */
function gateReadings(sim: SimState): readonly GateReading[] {
  return GATE_PAIRS.map((pair) => {
    const adopt = bookOf(sim, pair.adoptKind);
    const reject = bookOf(sim, pair.rejectKind);
    const capBreached = adopt !== undefined && adopt.twap > P_MAX.value;
    const relBreached =
      adopt !== undefined && reject !== undefined && adopt.twap > reject.twap + GATE_EPS.value;
    return { ...pair, adopt, reject, capBreached, relBreached, vetoed: capBreached || relBreached };
  });
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

function plateState(book: BookState | undefined, vetoed: boolean): NodeState {
  if (book === undefined) return 'pending';
  if (vetoed) return 'blocked';
  if (book.reaped || book.phase === 'Closed' || book.phase === 'Settled') return 'inactive';
  return 'active';
}

export function buildModel(sim: SimState): SceneModel {
  const vetoedKinds = new Set<MarketKind>(
    gateReadings(sim)
      .filter((r) => r.vetoed)
      .map((r) => r.adoptKind),
  );

  const plates: SceneNode[] = MARKET_KINDS.map((kind) => {
    const layout = LAYOUT[kind];
    const book = bookOf(sim, kind);
    const vetoed = vetoedKinds.has(kind);
    const state = plateState(book, vetoed);
    const sublabel =
      layout.branchWord !== undefined
        ? layout.branchWord
        : book === undefined
          ? 'not open'
          : formatPrice(clampQuoteForDisplay(book.twap));
    return {
      id: `book-${kind}`,
      kind: 'plate',
      x: layout.x,
      y: BASE_Y,
      w: layout.w,
      h: PLATE_H,
      // A priced-in breach is a genuine safety state, so it — and only it —
      // takes `alarm`. Every other plate keeps its branch tone.
      tone: vetoed ? 'alarm' : layout.tone,
      ...(book === undefined ? {} : { fill: clampQuoteForDisplay(book.twap) }),
      label: layout.label,
      sublabel,
      state,
      domRowId: rowId(kind),
    } satisfies SceneNode;
  });

  // Spans the four gate plates and nothing else, so the label lands in the gap
  // between the two pairs rather than over a column. `gate.p_max` is the key;
  // what a reader needs on the drawing is what the line *does*.
  const ceiling: SceneNode = {
    id: 'gate-ceiling',
    kind: 'ceiling',
    x: 1.4,
    y: priceY(P_MAX.value),
    w: 10.1,
    h: 0,
    tone: 'ink',
    label: 'veto line',
    domRowId: CEILING_ROW,
  };

  const rules: SceneRule[] = [
    {
      id: 'price-axis',
      axis: 'y',
      at: AXIS_X,
      from: BASE_Y,
      to: priceY(1),
      label: 'price',
      tone: 'dim',
      ticks: [
        { at: priceY(0), label: '0.00' },
        { at: priceY(DECISION_SANITY_MIN), label: formatPrice(DECISION_SANITY_MIN, 2) },
        { at: priceY(0.5), label: '0.50' },
        { at: priceY(DECISION_SANITY_MAX), label: formatPrice(DECISION_SANITY_MAX, 2) },
        { at: priceY(1), label: '1.00' },
      ],
    },
    // The sanity band, drawn across the welfare books — the decision pair *and*
    // the Baseline (doc 13 §3.2, doc 05 §5.2). Gate books are exempt from it, so
    // it must not be drawn over them, and the Baseline must not be left out of it.
    //
    // `Scene2D` prints an x-rule's label off its right end, so the band is named
    // once per edge and the number is left to the axis ticks, which already mark
    // exactly these two heights. `sanity` is 6 characters ≈ 1.44 units from 16.9,
    // which stops 0.36 short of the Baseline plate at 18.7.
    {
      id: 'sanity-lo',
      axis: 'x',
      at: priceY(DECISION_SANITY_MIN),
      from: LAYOUT.DecisionAccept.x - 0.2,
      to: LAYOUT.DecisionReject.x + LAYOUT.DecisionReject.w + 0.2,
      label: 'sanity',
      tone: 'dim',
      dashed: true,
    },
    {
      id: 'sanity-hi',
      axis: 'x',
      at: priceY(DECISION_SANITY_MAX),
      from: LAYOUT.DecisionAccept.x - 0.2,
      to: LAYOUT.DecisionReject.x + LAYOUT.DecisionReject.w + 0.2,
      label: 'sanity',
      tone: 'dim',
      dashed: true,
    },
    // Same band, over the third welfare book. Unlabelled, because it is the same
    // rule as the segment above and not a second one.
    {
      id: 'sanity-lo-baseline',
      axis: 'x',
      at: priceY(DECISION_SANITY_MIN),
      from: LAYOUT.Baseline.x - 0.2,
      to: LAYOUT.Baseline.x + LAYOUT.Baseline.w + 0.2,
      tone: 'dim',
      dashed: true,
    },
    {
      id: 'sanity-hi-baseline',
      axis: 'x',
      at: priceY(DECISION_SANITY_MAX),
      from: LAYOUT.Baseline.x - 0.2,
      to: LAYOUT.Baseline.x + LAYOUT.Baseline.w + 0.2,
      tone: 'dim',
      dashed: true,
    },
  ];

  // Spot beside the average it is judged against, on the two books whose
  // convergence step 8 actually tests.
  for (const kind of ['DecisionAccept', 'DecisionReject'] as const) {
    const book = bookOf(sim, kind);
    if (book === undefined) continue;
    const layout = LAYOUT[kind];
    rules.push({
      id: `spot-${kind}`,
      axis: 'x',
      at: priceY(clampQuoteForDisplay(book.spot)),
      from: layout.x,
      to: layout.x + layout.w,
      tone: 'dim',
      dashed: true,
    });
  }

  return {
    nodes: [...plates, ceiling],
    rules,
    relation:
      'two orderings at once. The veto line stands over the four safety markets as a hard stop a rising risk price cannot pass, so danger is settled before any gain is ever weighed; and the Baseline market stands apart from both branches behind a visible gap, because it belongs to neither.',
    unitLegend:
      'Every column is the same 0–1 price scale. The solid line across a column is its 72-hour average price (its TWAP), which is the number the rule reads; the dashed line on ACCEPT and REJECT is the latest price on its own.',
  };
}

// ---------------------------------------------------------------------------
// LMSR working
// ---------------------------------------------------------------------------

interface LmsrView {
  readonly b: number;
  readonly price: number;
  /** `q_L − q_S` implied by the quote, in whole USDC. */
  readonly net: number;
  readonly cOpen: number;
  readonly cNow: number;
  readonly paid: number;
  readonly bound: number;
  readonly realised: number;
  readonly maxTrade: number;
  readonly domainRatio: number;
  readonly inDomain: boolean;
  readonly quote: QuoteResult;
  readonly logitImpact: number;
  readonly recomputed: number;
  readonly samples: readonly CurveSample[];
}

/**
 * The book's own arithmetic, from its quote.
 *
 * The scenarios post each book's quote directly rather than by trading into it,
 * so the inventory used here is the net LONG inventory that quote implies —
 * `q_L − q_S = b·(logit p − logit ½)`, which is exactly the inventory a trade to
 * that price would have produced. `priceLong` is run back over it below, so the
 * round trip is shown rather than asserted.
 */
function lmsrView(book: BookState, feeBps: number): LmsrView {
  const b = book.b;
  const price = clampQuoteForDisplay(book.spot);
  const net = displacementForPriceMove(b, 0.5, price);

  // The doc 04 §6.1 wrapper is denominated in USDC base units and rounds to that
  // grid, so the quote below is computed there and only formatted back.
  const bBase = b * USDC;
  const netBase = net * USDC;
  const qLongBase = Math.max(netBase, 0);
  const qShortBase = Math.max(-netBase, 0);
  const amount = maxTradeAmount(bBase);
  const quote = buy(bBase, qLongBase, qShortBase, 'Long', amount, feeBps);

  return {
    b,
    price,
    net,
    cOpen: cost(b, 0, 0),
    cNow: cost(b, Math.max(net, 0), Math.max(-net, 0)),
    paid: cost(b, Math.max(net, 0), Math.max(-net, 0)) - cost(b, 0, 0),
    bound: makerLossBound(b),
    realised: makerLossAtPrice(b, price),
    maxTrade: amount,
    domainRatio: Math.abs(qLongBase - qShortBase) / bBase,
    inDomain: withinDomain(bBase, qLongBase, qShortBase),
    quote,
    // `displacementForPriceMove(b, ·, ·)/b` is the logit distance itself.
    logitImpact:
      displacementForPriceMove(bBase, quote.priceBefore, quote.priceAfter) / bBase,
    recomputed: priceLong(bBase, qLongBase, qShortBase),
    samples: sampleCurve(b, Math.max(net, 0), Math.max(-net, 0), 9).filter(
      (_, i) => i % 2 === 0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtInt = (v: number): string => Math.round(v).toLocaleString('en-US');
const fmtBase = (v: number): string => formatUsdc(v, { decimals: 2 });
const fmt2 = (v: number): string => v.toFixed(2);
const fmt3 = (v: number): string => v.toFixed(3);
const fmt4 = (v: number): string => v.toFixed(4);

/** Branch tint is for branch instruments; here, the two decision books only. */
const branchProps = (kind: MarketKind): { branch?: 'accept' | 'reject' } =>
  kind === 'DecisionAccept'
    ? { branch: 'accept' }
    : kind === 'DecisionReject'
      ? { branch: 'reject' }
      : {};

const SIM_NOTE = 'Posted by the scenario to make the mechanism concrete; no chain was read.';

/**
 * Each family draws its depth from its own doc 13 key — `pol.b` is per class and
 * seeds the decision pair only, `pol.b_gate` is one figure for all four gate
 * books, and the Baseline has `pol.b_baseline`. One shared note would misattribute
 * five of the seven rows.
 */
const DEPTH_NOTES: Readonly<Record<BookLayout['family'], string>> = {
  decision: 'Seeded at this class’s doc 13 pol.b default in the scenario, then held fixed.',
  gate: 'Seeded at the doc 13 pol.b_gate default — one figure for all four gate books — then held fixed.',
  baseline: 'Seeded at the doc 13 pol.b_baseline default in the scenario, then held fixed.',
};
const depthNote = (kind: MarketKind): string => DEPTH_NOTES[LAYOUT[kind].family];

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function MarketFloorScene({ sim }: { sim: SimState }): JSX.Element {
  const model = buildModel(sim);
  const gates = gateReadings(sim);
  const accept = bookOf(sim, 'DecisionAccept');
  const rejectBook = bookOf(sim, 'DecisionReject');
  const baseline = bookOf(sim, 'Baseline');
  // A book with no subsidy is not an LMSR at all (the kernel refuses b ≤ 0), so
  // the working below is offered only where there is a real book to work on.
  const view =
    accept === undefined || accept.b <= 0 ? undefined : lmsrView(accept, MKT_FEE.value);
  const cls = sim.proposal.cls;
  const sigma = requiresGateMarkets(cls) ? perClass('dec.sigma', cls) : undefined;
  const open = sim.books.length > 0;
  // One observation interval on from the current quote: the band `observe` would
  // clamp the next recorded point into (k = 1).
  const band =
    accept === undefined
      ? undefined
      : slewBand(
          clampQuoteForDisplay(accept.spot),
          OBS_INTERVAL.value,
          MKT_KAPPA.value,
          OBS_INTERVAL.value,
        );

  /**
   * The cost landscape is drawn around the ACCEPT decision book because that is
   * the one the rail works through in full. A book with no subsidy has no
   * surface — the kernel refuses `b ≤ 0` — so there is simply no tab in that
   * state rather than an empty stage.
   */
  const motion: MotionSpec | undefined =
    accept === undefined || accept.b <= 0
      ? undefined
      : {
          kind: 'cost-surface',
          props: {
            label: 'Decision book · if the proposal passes',
            b: accept.b,
            spot: accept.spot,
          },
        };

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame
          model={model}
          motion={motion}
          title="The market floor: seven markets on one price scale"
        />
      </div>

      <div className="col-rail mf-rail">
        <Lede>
          Seven small markets are trading side by side here, and each one is a bet on a
          different question about this one proposal. Nobody votes on the answers:{' '}
          <strong>the price of a market is the forecast</strong>, because anyone who thinks a
          price is wrong can make money by pushing it to where they think it belongs. There is no
          trader on the far side — an <Jargon word="lmsr" label="automatic rule" /> always quotes
          both ways, and pushing it further costs more. When the time is up the chain reads a{' '}
          <Jargon word="twap" label="72-hour average" /> of those prices — not anybody’s opinion —
          and decides.
        </Lede>

        <KeyFacts>
          <KeyFact
            label="ACCEPT price"
            note="72-hour average, for the world where this proposal passes"
          >
            {accept === undefined ? (
              'not open yet'
            ) : (
              <Value
                of={simulated(clampQuoteForDisplay(accept.twap), SIM_NOTE)}
                format={fmt3}
                branch="accept"
              />
            )}
          </KeyFact>
          <KeyFact label="REJECT price" note="the same average, for the world where it does not">
            {rejectBook === undefined ? (
              'not open yet'
            ) : (
              <Value
                of={simulated(clampQuoteForDisplay(rejectBook.twap), SIM_NOTE)}
                format={fmt3}
                branch="reject"
              />
            )}
          </KeyFact>
          <KeyFact
            label="Trading fee"
            note="taken on every trade; one basis point is a hundredth of a percent"
          >
            <Value of={specOf(MKT_FEE)} unit="bps" />
          </KeyFact>
          <KeyFact
            label="Markets per proposal"
            note="plus the epoch’s own Baseline market, which belongs to no proposal"
          >
            <Value of={spec(BOOKS_PER_PROPOSAL, cite('13', '§4'))} />
          </KeyFact>
        </KeyFacts>

        <section className="panel">
          <h2 className="panel__title">What each of these prices actually means</h2>
          {/* The columns are named here exactly as the drawing labels them, so a
              reader never has to translate between the rail and the canvas. */}
          <p>
            All seven columns use the same 0–1 scale, and on none of them is the number the
            chance that the proposal passes. On the three <em>welfare</em> markets — ACCEPT,
            REJECT and the Baseline — the price is the market’s estimate of the settlement
            score <span className="mono">s</span> that world would actually earn: the geometric
            mean of the next two epochs of realised welfare. A decision market is a forecast of
            consequences, not a poll on a vote.
          </p>
          <p>
            That is why ACCEPT and REJECT can both sit near one half and still decide
            something: the rule reads the <em>gap</em> between them, not their level. The four
            safety markets — Survival and Security, one of each per world — are different in
            kind. Each prices the chance that a daily safety floor is breached at least once in
            that world, so there a low number is the healthy one, and the whole argument
            happens in the sliver of the scale beneath the veto line.
          </p>
        </section>

        {/* Everything below is a drawer. The material is unchanged — a reader who
            wants the frozen kind names, the bounds and the citations opens one. */}
        <Depth title="All seven markets, and what each one is asking" hint="7 rows">
          <section className="panel">
            <div className="mf-scroll">
              <table>
                <caption className="sr-only">
                  Every book open for this proposal, in the frozen MarketKind order, with its
                  liquidity parameter, its spot and both TWAPs, its coverage, its stale events and
                  its contest capital.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Book — what it prices</th>
                    <th scope="col" className="numeric">
                      b
                    </th>
                    <th scope="col" className="numeric">
                      Spot
                    </th>
                    <th scope="col" className="numeric">
                      TWAP 72 h
                    </th>
                    <th scope="col" className="numeric">
                      TWAP 24 h
                    </th>
                    <th scope="col" className="numeric">
                      Cov.
                    </th>
                    <th scope="col" className="numeric">
                      Stale
                    </th>
                    <th scope="col" className="numeric">
                      Contest capital
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MARKET_KINDS.map((kind) => {
                    const layout = LAYOUT[kind];
                    const book = bookOf(sim, kind);
                    return (
                      <tr key={kind} id={rowId(kind)}>
                        <th scope="row">
                          <span className="mf-book">
                            <span className="mf-book__name">{kind}</span>
                            <span className="mf-book__q">{layout.question}</span>
                          </span>
                        </th>
                        {book === undefined ? (
                          <td className="numeric" colSpan={7}>
                            not open — markets are seeded in the Seed phase
                          </td>
                        ) : (
                          <>
                            <td className="numeric">
                              <Value of={simulated(book.b, depthNote(kind))} format={fmtInt} />
                            </td>
                            <td className="numeric">
                              <Value
                                of={simulated(clampQuoteForDisplay(book.spot), SIM_NOTE)}
                                format={fmt3}
                                {...branchProps(kind)}
                              />
                            </td>
                            <td className="numeric">
                              <Value
                                of={simulated(clampQuoteForDisplay(book.twap), SIM_NOTE)}
                                format={fmt3}
                                {...branchProps(kind)}
                              />
                            </td>
                            <td className="numeric">
                              <Value
                                of={simulated(clampQuoteForDisplay(book.trailingTwap), SIM_NOTE)}
                                format={fmt3}
                                {...branchProps(kind)}
                              />
                            </td>
                            <td className="numeric">
                              <Value of={simulated(book.coveragePct, SIM_NOTE)} unit="%" />
                            </td>
                            <td className="numeric">
                              <Value of={simulated(book.staleEvents, SIM_NOTE)} />
                            </td>
                            <td className="numeric">
                              <Value
                                of={simulated(book.contestCapital, SIM_NOTE)}
                                format={fmtInt}
                                unit="USDC"
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="panel__note">
              <Value of={spec(BOOKS_PER_PROPOSAL, cite('13', '§4'))} /> books open per proposal —
              two decision, four gate — beside the epoch’s single unconditional Baseline, which
              belongs to no proposal at all. The level line drawn on each plate is the 72-hour
              window TWAP, because that is the number the decision rule reads. Contest capital is
              the marked value of net trader positions against the maker, integrated on the
              observation grid (<span className="cite">04 §7a</span>); it replaced traded notional
              because LMSR is path-independent, so wash flow nets out of it by construction.
            </p>
          </section>
        </Depth>

        <Depth
          title="The safety veto that runs before any gain is weighed"
          hint="2 safety gates"
        >
          <section className="panel">
            <p>
              Steps 3 and 4 of the decision rule run <em>before</em> any welfare number is
              compared, so a large uplift can never buy its way past a priced risk of ruin. For
              either gate, the adopt-side window TWAP is tested twice, and failing either test on
              either gate is a veto:
            </p>
            <ol className="mf-ol">
              <li>
                the absolute cap — veto if <span className="mono">p_adopt</span> &gt;{' '}
                <span className="mono">gate.p_max</span> ={' '}
                <Value of={specOf(P_MAX)} format={fmt3} showCite />;
              </li>
              <li>
                the relative test — veto if <span className="mono">p_adopt</span> &gt;{' '}
                <span className="mono">p_reject</span> + <span className="mono">gate.eps</span>,
                with ε = <Value of={specOf(GATE_EPS)} format={fmt3} showCite />, so a risk that is
                simply in the air rather than caused by adopting does not veto.
              </li>
            </ol>
            <div className="mf-scroll">
              <table>
                <caption className="sr-only">
                  The veto ceiling and the two gates tested against it.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Gate</th>
                    <th scope="col" className="numeric">
                      p_adopt
                    </th>
                    <th scope="col" className="numeric">
                      p_reject
                    </th>
                    <th scope="col" className="numeric">
                      p_reject + ε
                    </th>
                    <th scope="col">Reading</th>
                  </tr>
                </thead>
                <tbody>
                  <tr id={CEILING_ROW}>
                    <th scope="row">Veto ceiling (gate.p_max)</th>
                    <td className="numeric">
                      <Value of={specOf(P_MAX)} format={fmt3} />
                    </td>
                    <td className="numeric">—</td>
                    <td className="numeric">
                      ε <Value of={specOf(GATE_EPS)} format={fmt3} />
                    </td>
                    <td>
                      Drawn across all four gate plates. Both limbs are strict, so a column
                      resting exactly on the line is still inside it and only a column that rises
                      past it vetoes. The kernel ceiling on this key is{' '}
                      <Value of={spec(GATE_P_MAX_CEILING, cite('13', '§1'))} format={fmt2} /> — no
                      amendment can raise it further.
                    </td>
                  </tr>
                  {gates.map((r) => (
                    <tr key={r.gate} id={`row-gate-${r.gate}`}>
                      <th scope="row">
                        {r.gate} — breach of {r.floorLabel} ={' '}
                        <Value of={spec(r.floor, cite('05', '§4.1'))} format={fmt2} />
                      </th>
                      <td className="numeric">
                        {r.adopt === undefined ? (
                          '—'
                        ) : (
                          <Value
                            of={simulated(clampQuoteForDisplay(r.adopt.twap), SIM_NOTE)}
                            format={fmt3}
                          />
                        )}
                      </td>
                      <td className="numeric">
                        {r.reject === undefined ? (
                          '—'
                        ) : (
                          <Value
                            of={simulated(clampQuoteForDisplay(r.reject.twap), SIM_NOTE)}
                            format={fmt3}
                          />
                        )}
                      </td>
                      <td className="numeric">
                        {r.reject === undefined ? (
                          '—'
                        ) : (
                          <Value
                            of={combine(
                              [simulated(r.reject.twap)],
                              r.reject.twap + GATE_EPS.value,
                              cite('05', '§5.1'),
                            )}
                            format={fmt3}
                          />
                        )}
                      </td>
                      <td>
                        {r.adopt === undefined || r.reject === undefined ? (
                          'Books not open yet.'
                        ) : r.vetoed ? (
                          <>
                            <span className="chip chip--safety">Veto</span>{' '}
                            {r.capBreached && r.relBreached
                              ? 'both limbs fire: the cap and the reject-leg margin.'
                              : r.capBreached
                                ? 'over the absolute cap.'
                                : 'over the reject leg by more than ε.'}{' '}
                            {sim.decision === null
                              ? 'That is the reading of the window as it stands, not a verdict: the window has not sealed, so no run of decide() has happened yet.'
                              : 'decide() ran and stopped at step 4.'}{' '}
                            The refusal this limb carries is{' '}
                            <span className="mono">
                              {r.gate === 'Survival' ? 'GateVetoSurvival' : 'GateVetoSecurity'}
                            </span>
                            .
                          </>
                        ) : (
                          <>
                            <span className="chip chip--state">Clear</span> under both limbs on the
                            window as it stands, so nothing here stops the rule going on to weigh
                            welfare.
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="panel__note">
              Gate books are <strong>exempt</strong> from the welfare-book sanity band of{' '}
              <Value of={spec(DECISION_SANITY_MIN, cite('13', '§3.2'))} format={fmt2} />–
              <Value of={spec(DECISION_SANITY_MAX, cite('13', '§3.2'))} format={fmt2} />, which is
              why the band is not drawn across them: a healthy gate book legitimately trades near
              zero. In exchange, a gate book pinned near a boundary owes the tighter coverage
              above and a spot-versus-TWAP bound of{' '}
              <Value of={specOf(GATE_NB_CONV)} format={fmt3} /> (
              <span className="mono">gate.nb_conv</span>), which is how the rule tells a live book
              from an abandoned one.
            </p>
          </section>
        </Depth>

        <Depth
          title="How the 72-hour average is measured, and why the latest price alone will not do"
          hint="spot vs average"
        >
          <section className="panel">
            <p>
              An observation records the <em>previous</em> block’s stored quote, so a trade can
              never price the observation it triggers, and every observation is clamped into a slew
              band of <Formula name="market.slew" /> around the one before it. The recorded
              series is a step function weighted backward over the interval each observation
              closes — it is never interpolated and never smoothed, so an average is only ever
              made of prices that were really posted.
            </p>
            <p>
              Spot and TWAP are therefore two different measurements, and the protocol keeps both.
              Step 8 refuses a decision whose closing spot has drifted further than{' '}
              <span className="mono">dec.delta_max</span> from the average it is being judged by:
              a book whose last print disagrees with its own window is not a book anyone should
              decide on. A gate book trading outside the sanity band is not held to that bound but
              to the tighter near-boundary one, <span className="mono">gate.nb_conv</span>, so the
              column below prints whichever rule actually grades each book.
            </p>
            <div className="mf-scroll">
              <table>
                <caption className="sr-only">
                  Closing spot beside the window TWAP for each open book, with the gap between
                  them tested against the convergence bound that grades that book — dec.delta_max
                  for a welfare book, gate.nb_conv for a gate book outside the sanity band.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Book</th>
                    <th scope="col" className="numeric">
                      Spot / TWAP 72 h
                    </th>
                    <th scope="col" className="numeric">
                      |spot − TWAP|
                    </th>
                    <th scope="col" className="numeric">
                      Bound that grades it
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MARKET_KINDS.map((kind) => {
                    const book = bookOf(sim, kind);
                    if (book === undefined) return null;
                    const gap = Math.abs(book.spot - book.twap);
                    const bound = convergenceBound(kind, book.twap);
                    return (
                      <tr key={kind}>
                        <th scope="row" className="mono">
                          {kind}
                        </th>
                        <td className="numeric mf-pair">
                          <Value
                            of={simulated(clampQuoteForDisplay(book.spot), SIM_NOTE)}
                            format={fmt3}
                            {...branchProps(kind)}
                          />
                          <span className="mf-pair__sep">/</span>
                          <Value
                            of={simulated(clampQuoteForDisplay(book.twap), SIM_NOTE)}
                            format={fmt3}
                            {...branchProps(kind)}
                          />
                        </td>
                        <td className="numeric">
                          <Value
                            of={combine([simulated(book.spot)], gap, cite('05', '§5.2'))}
                            format={fmt4}
                          />
                        </td>
                        <td className="numeric">
                          <Value of={specOf(bound.row)} format={fmt3} />
                          <span className="mf-boundkey">{bound.key}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <dl className="mf-dl">
              <dt>Decision window, whose TWAP grades the proposal (dec.window)</dt>
              <dd>
                <Value of={specOf(DEC_WINDOW)} format={fmtInt} unit="blocks" />
              </dd>
              <dt>Trailing sub-window that must agree with it (dec.trailing)</dt>
              <dd>
                <Value of={specOf(DEC_TRAILING)} format={fmtInt} unit="blocks" />
              </dd>
              <dt>Observation cadence (mkt.obs_interval)</dt>
              <dd>
                <Value of={specOf(OBS_INTERVAL)} format={fmtInt} unit="blocks" />
              </dd>
              <dt>Slew cap per interval (mkt.kappa)</dt>
              <dd>
                <Value of={specOf(MKT_KAPPA)} format={fmt3} />
              </dd>
              <dt>Observation gap a stale event is counted strictly beyond</dt>
              <dd>
                <Value
                  of={spec(MKT_STALE_GAP_BLOCKS, cite('13', '§3.2'))}
                  format={fmtInt}
                  unit="blocks"
                />
              </dd>
              <dt>Coverage a welfare book owes (dec.coverage)</dt>
              <dd>
                <Value of={specOf(DEC_COVERAGE)} unit="%" />
              </dd>
              <dt>Coverage a near-boundary gate book owes (gate.nb_coverage)</dt>
              <dd>
                <Value of={specOf(GATE_NB_COVERAGE)} unit="%" />
              </dd>
              {accept === undefined || band === undefined ? null : (
                <>
                  <dt className="mf-dl__rule">
                    Band the ACCEPT book’s next observation may land in, one interval on from its
                    current quote
                  </dt>
                  <dd className="mf-dl__rule">
                    <Value
                      of={combine([simulated(accept.spot)], band.low, TWAP_CITATION)}
                      format={fmt4}
                    />
                    <span className="mf-pair__sep">–</span>
                    <Value
                      of={combine([simulated(accept.spot)], band.high, TWAP_CITATION)}
                      format={fmt4}
                    />
                  </dd>
                </>
              )}
            </dl>
            <p className="panel__note">
              Both band edges round <em>inward</em> on the fixed-point grid, so the admitted band
              never exceeds the exact envelope (<span className="cite">04 §7</span>). The
              contest-capital column above is integrated on the same grid (
              <span className="cite">
                {CONTEST_CAPITAL_CITATION.doc} {CONTEST_CAPITAL_CITATION.at}
              </span>
              ).
            </p>
          </section>
        </Depth>


        <Depth
          title="How a price is actually computed, and what it costs to move one"
          hint="LMSR"
        >
          <section className="panel">
            <Formula name="market.cost" />
            {/* The equation stands on its own line rather than mid-sentence.
                A display-mode formula renders a block element, and a block
                element inside a paragraph makes the browser close the paragraph
                early — so the prose after it silently left the paragraph it was
                written in, and took the paragraph's spacing with it. */}
            <p>
              Each book is a two-outcome LMSR with a subsidy parameter{' '}
              <span className="mono">b</span>, and every quote is a point on that cost function.
            </p>
            <Formula name="market.price" />
            <p>
              What makes <span className="mono">b</span> interpretable is that it is the number
              of units one logit of price movement costs, so doubling it doubles the capital
              anyone needs for the same displacement.
            </p>
            <p>
              Two hard bounds follow. The market maker can never lose more than{' '}
              <Formula name="market.maker-loss" /> on a book — which is also the value of{' '}
              <span className="mono">C</span> at the symmetric opening state, and exactly the
              headroom the treasury seeds — and a single trade is capped at{' '}
              <span className="mono">b/4</span>, so one extrinsic can move the logit by at most{' '}
              <Value of={spec(MAX_TRADE_RATIO, cite('13', '§2'))} format={fmt2} />. Any post-state
              outside <span className="mono">|q_L − q_S|/b ≤ </span>
              <Value of={spec(LMSR_DOMAIN_BOUND, DOMAIN_CITATION)} /> is refused with{' '}
              <span className="mono">PriceBoundExceeded</span>; that is the domain the fixed-point
              kernel’s error analysis holds on.
            </p>

            {view === undefined || accept === undefined ? (
              <p className="panel__note">
                The books are not open yet, so there is no live <span className="mono">b</span> to
                work the bounds out on. They are seeded in the Seed phase, at{' '}
                <span className="cite">
                  {LMSR_CITATION.doc} {LMSR_CITATION.at}
                </span>
                .
              </p>
            ) : (
              <>
                <dl className="mf-dl">
                  <dt>Subsidy parameter b, ACCEPT book</dt>
                  <dd>
                    <Value
                      of={simulated(view.b, depthNote('DecisionAccept'))}
                      format={fmtInt}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Worst-case maker loss, b·ln 2 — and the seeded headroom</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.bound, cite('04', '§6.3'))}
                      format={fmtInt}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Maker loss actually realised at this price, b·[ln 2 − H(p)]</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.realised, cite('04', '§12'))}
                      format={fmtInt}
                      unit="USDC"
                    />
                  </dd>
                  <dt className="mf-dl__rule">Net inventory q_L − q_S implied by the quote</dt>
                  <dd className="mf-dl__rule">
                    <Value
                      of={combine([simulated(view.price)], view.net, LMSR_CITATION)}
                      format={fmtInt}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Price recomputed from that inventory — the round trip</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.price)], view.recomputed, LMSR_CITATION)}
                      format={fmt3}
                      branch="accept"
                    />
                  </dd>
                  <dt>C at the opening state, C(0,0)</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.cOpen, LMSR_CITATION)}
                      format={fmtInt}
                      unit="USDC"
                    />
                  </dd>
                  <dt>C now</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.cNow, LMSR_CITATION)}
                      format={fmtInt}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Paid in by traders to walk the book here, C(now) − C(0,0)</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.paid, LMSR_CITATION)}
                      format={fmtInt}
                      unit="USDC"
                    />
                  </dd>
                  <dt className="mf-dl__rule">
                    |q_L − q_S| / b, against a bound of{' '}
                    <Value of={spec(LMSR_DOMAIN_BOUND, DOMAIN_CITATION)} />
                  </dt>
                  <dd className="mf-dl__rule">
                    <Value
                      of={combine([simulated(view.price)], view.domainRatio, DOMAIN_CITATION)}
                      format={fmt3}
                    />{' '}
                    {/* Leaving the domain is a quote refusal, not a safety state, so it
                        never spends `alarm`; the words carry the reading. */}
                    <span className={view.inDomain ? 'chip chip--state' : 'chip'}>
                      {view.inDomain ? 'in domain' : 'outside the domain'}
                    </span>
                  </dd>
                </dl>

                <h3>The largest single trade this book will take</h3>
                <p className="panel__note">
                  Quoted through the doc 04 §6.1 wrapper in USDC base units, at{' '}
                  <span className="mono">mkt.fee</span> ={' '}
                  <Value of={specOf(MKT_FEE)} unit="bps" showCite />. The charge rounds up and the
                  fee is taken on the rounded charge, so the residual always lands on the escrow’s
                  side.
                </p>
                <dl className="mf-dl">
                  <dt>Max trade, b/4</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.maxTrade, WRAPPER_CITATION)}
                      format={fmtBase}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Cost of buying that much LONG</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.quote.cost, WRAPPER_CITATION)}
                      format={fmtBase}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Fee</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.quote.fee, WRAPPER_CITATION)}
                      format={fmtBase}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Total debit</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.b)], view.quote.total, WRAPPER_CITATION)}
                      format={fmtBase}
                      unit="USDC"
                    />
                  </dd>
                  <dt>Price before → after</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.price)], view.quote.priceBefore, LMSR_CITATION)}
                      format={fmt3}
                      branch="accept"
                    />
                    <span className="mf-pair__sep">→</span>
                    <Value
                      of={combine([simulated(view.price)], view.quote.priceAfter, LMSR_CITATION)}
                      format={fmt3}
                      branch="accept"
                    />
                  </dd>
                  <dt>Logit moved by this one trade</dt>
                  <dd>
                    <Value
                      of={combine([simulated(view.price)], view.logitImpact, cite('04', '§6.4'))}
                      format={fmt3}
                    />
                  </dd>
                </dl>

                <h3>Walking the ACCEPT book along its own curve</h3>
                <p className="panel__note">
                  Sampled from the cost function itself. The price a trade executes at is the
                  integral of a rising curve, not the quote it opened on — which is why the cost
                  of a move is <Formula name="market.cash-change" /> and not{' '}
                  <Formula name="market.payout" />. A negative figure is the mirror of the same
                  walk: proceeds from selling the book back down.
                </p>
                <div className="mf-scroll">
                  <table>
                    <caption className="sr-only">
                      Sampled points of the ACCEPT book’s cost curve: the price at each net
                      inventory and what a trader would pay to walk the book there from its
                      current state.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="numeric">
                          Price
                        </th>
                        <th scope="col" className="numeric">
                          q_L − q_S
                        </th>
                        <th scope="col" className="numeric">
                          Cost to walk here
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.samples.map((s) => (
                        <tr key={s.netQ}>
                          <td className="numeric">
                            <Value
                              of={combine([simulated(view.price)], s.priceLong, LMSR_CITATION)}
                              format={fmt3}
                              branch="accept"
                            />
                          </td>
                          <td className="numeric">
                            <Value
                              of={combine([simulated(view.b)], s.netQ, LMSR_CITATION)}
                              format={fmtInt}
                              unit="USDC"
                            />
                          </td>
                          <td className="numeric">
                            <Value
                              of={combine([simulated(view.b)], s.costFromCurrent, LMSR_CITATION)}
                              format={fmtInt}
                              unit="USDC"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </Depth>

        {/* Two panels in one drawer: the Baseline exists to set the floor, and the
            verdict is what clearing that floor produces. Separating them would ask
            the reader to hold half an arithmetic across a click. */}
        <Depth
          title="The floor a proposal has to beat, and the verdict once the markets close"
          hint="Baseline + result"
        >
          <section className="panel">
            <h2 className="panel__title">Why the Baseline stands outside</h2>
            <p>
              The Baseline is the epoch’s unconditional book: it prices the epoch’s own realised
              welfare score <span className="mono">s_e</span> — the same statistic that settles
              the epoch’s cohorts — conditional on nothing, and there is exactly one of them per
              epoch rather than one per proposal. It is not a “no proposal” world; it is the
              epoch measured whatever happens in it, which is precisely what makes it a floor
              neither branch can talk down. It exists so that suppressing the reject leg
              cannot cheapen the bar. The floor a decision must clear is:
            </p>
            <Formula name="market.hurdle" />
            <p>
              A reject book that has been talked down is therefore simply ignored in favour of
              the unconditional forecast.
            </p>
            {baseline === undefined || rejectBook === undefined || sigma === undefined ? (
              <p className="panel__note">
                The Baseline opens with the rest of the books in the Seed phase.
              </p>
            ) : (
              <dl className="mf-dl">
                <dt>REJECT window TWAP</dt>
                <dd>
                  <Value
                    of={simulated(clampQuoteForDisplay(rejectBook.twap), SIM_NOTE)}
                    format={fmt4}
                    branch="reject"
                  />
                </dd>
                <dt>Baseline window TWAP</dt>
                <dd>
                  <Value
                    of={simulated(clampQuoteForDisplay(baseline.twap), SIM_NOTE)}
                    format={fmt4}
                  />
                </dd>
                <dt>σ for this class ({sigma.key})</dt>
                <dd>
                  <Value of={specOf(sigma)} format={fmt3} />
                </dd>
                <dt>r_eff — the floor actually used</dt>
                <dd>
                  <Value
                    of={combine(
                      [simulated(rejectBook.twap), simulated(baseline.twap)],
                      Math.max(rejectBook.twap, baseline.twap - sigma.value),
                      cite('05', '§5.3'),
                    )}
                    format={fmt4}
                  />
                </dd>
                <dt>Baseline depth (pol.b_baseline)</dt>
                <dd>
                  <Value
                    of={specOf(POL_B_BASELINE)}
                    format={fmtInt}
                    unit="USDC"
                    unverified={POL_B_BASELINE.verification.status !== 'settled'}
                  />
                </dd>
              </dl>
            )}
            <p className="panel__note">
              It is drawn in ink and separated by a gap for the same reason it is not tinted in
              the table: it belongs to neither branch, and colouring it toward one would misstate
              what it measures.
            </p>
          </section>

          <section className="panel">
            <h2 className="panel__title">Decision statistics</h2>
            {sim.decision === null ? (
              <>
                <p>
                  None exist yet. The chain’s <span className="mono">decision_stats(pid)</span>{' '}
                  returns nothing until the decision windows seal at the Decide boundary, so there
                  is no uplift, no hurdle comparison and no outcome to show — and this app will
                  not invent one.
                </p>
                <p className="panel__note">
                  {open
                    ? 'The prices above are the current state of the books, not a forecast of the verdict. A book that is quoting is not yet a book that has decided.'
                    : 'The books are not even open yet; they are created in the Seed phase, before the Trade phase opens.'}
                </p>
              </>
            ) : (
              <>
                <p>
                  The windows have sealed and <span className="mono">decide()</span> has run. Every
                  number below came out of the decision engine, which stopped at the step named
                  here — later steps were never evaluated, and are not being reported as passed.
                </p>
                <dl className="mf-dl">
                  <dt>Outcome</dt>
                  <dd>
                    <span className="chip chip--state">
                      {sim.decision.outcome.kind === 'Reject'
                        ? `Rejected(${sim.decision.outcome.reason})`
                        : sim.decision.outcome.kind}
                    </span>
                  </dd>
                  <dt>Stopped at step</dt>
                  <dd>
                    <Value of={derived(sim.decision.stoppedAt, cite('05', '§5.4'))} />
                  </dd>
                  {sim.decision.diagnostics.rEff === null ? null : (
                    <>
                      <dt>r_eff</dt>
                      <dd>
                        <Value
                          of={derived(sim.decision.diagnostics.rEff, cite('05', '§5.3'))}
                          format={fmt4}
                        />
                      </dd>
                    </>
                  )}
                  {sim.decision.diagnostics.uplift === null ? null : (
                    <>
                      <dt>Uplift, ACCEPT TWAP − r_eff</dt>
                      <dd>
                        <Value
                          of={derived(sim.decision.diagnostics.uplift, cite('05', '§5.4'))}
                          format={fmt4}
                        />
                      </dd>
                    </>
                  )}
                  {sim.decision.diagnostics.hurdle === null ? null : (
                    <>
                      <dt>Hurdle δ actually applied</dt>
                      <dd>
                        <Value
                          of={derived(sim.decision.diagnostics.hurdle, cite('05', '§5.4'))}
                          format={fmt4}
                        />
                      </dd>
                    </>
                  )}
                </dl>
                <p className="panel__note">
                  A rejection here is ink, not red. It is the most common healthy path through this
                  protocol: the market was asked a question, it answered, and the answer was no.
                </p>
              </>
            )}
          </section>
        </Depth>
      </div>
    </div>
  );
}
