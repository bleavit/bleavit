import { Fragment } from 'react';
import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import { STAGE_HEIGHT } from '../model';
import type { NodeState, SceneModel, SceneNode } from '../model';
import { Value } from '../../ui/Value';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { derived, simulated, spec } from '../../provenance/types';
import { cite } from '../../protocol/citations';
import {
  REJECT_REASON_META,
  STATE_META,
  TRANSITIONS,
  fromStates,
  isTerminal,
  isTransient,
  transitionById,
  transitionsFrom,
} from '../../protocol/lifecycle';
import type { StateTier, Transition, TransitionId } from '../../protocol/lifecycle';
import { PROPOSAL_STATES, REJECT_REASONS, REJECT_REASON_INDEX } from '../../protocol/types';
import type { ProposalState } from '../../protocol/types';
import type { SimState } from '../../sim/types';
import './lifecycle.css';

/**
 * The proposal state machine, drawn (doc 05 §2.1).
 *
 * A transition table is topologically complete and rhetorically flat: all 26 rows
 * look equally likely, and a reader infers — wrongly — that `Executed` is the
 * point and `Rejected` is the failure. The drawing carries the one thing the
 * table cannot say. **T10 → T21 is the trunk**: most proposals are rejected, and a
 * rejected proposal whose vault is still open resolves to the REJECT branch, is
 * measured, and settles like any other. `T14` — execute — is the narrow line
 * branching off above it.
 *
 * Everything drawn here is read from `protocol/lifecycle.ts`, the single home of
 * §2.1's 26 rows. There is no second edge list: an edge that is not in
 * `TRANSITIONS` cannot be drawn here, by construction.
 */

// ---------------------------------------------------------------------------
// Layout — hand-authored, checked in, and checked by test
// ---------------------------------------------------------------------------
//
// Determinism is the requirement: a force-directed graph that lands somewhere new
// on every load is a bug in an instrument, however pretty. So the geometry is
// written out — and the one thing hand-authored geometry reliably gets wrong,
// two labels landing on the same pixels, is asserted away in `model.test.tsx`
// against the same metrics the renderer uses (`labelBoxes` below).
//
// Four rows, each of which means something a reader can state:
//
//   ROW_MANDATE   what becomes of a proposal the market said yes to
//   ROW_ANSWER    the two answers that are not a plain no: more time, or a mandate
//   ROW_PATH      the trip through the market — the trunk, drawn straight
//   ROW_INTAKE    before any market exists, and the exit that never reaches one
//
// Six labelled boxes is the ceiling for a row: `Screening` and `Qualified` are
// nine glyphs each, and two nine-glyph names need 3.5 units of centre-to-centre
// air at the size `scene.css` uses on a phone. Seven boxes cannot buy that on a
// 21-unit stage, which is why the intake states sit on their own row rather than
// extending the trunk.

/** Row pitch, and the reason it is this large.
 *
 * An edge prints its id just above the midpoint between the two rows it joins,
 * and a state name hangs 0.55 below its box, so the two collide unless the rows
 * are far enough apart. At 3.4 the id clears the name above it by 0.23 units; at
 * the 2.4 this scene used to run, every cross-row id had to be dropped and the
 * drawing stopped being traceable against the table. */
const ROW_PITCH = 3.4;
const ROW_INTAKE = 0.85;
const ROW_PATH = ROW_INTAKE + ROW_PITCH;
const ROW_ANSWER = ROW_PATH + ROW_PITCH;
const ROW_MANDATE = ROW_ANSWER + ROW_PITCH;

/** Box size. Narrow, because the gap between two boxes is where an edge's id is
 * printed: at 1.2 wide on a 3.6 pitch the clear run between neighbours is 2.4
 * units, and a three-glyph id needs 0.57. */
const NODE_W = 1.2;
const NODE_H = 0.7;
const NODE_D = 0.3;

/** Left edge of a box on a given column centre. Centres are the authored
 * coordinate because every label is centred on one. */
const left = (cx: number): number => cx - NODE_W / 2;

/**
 * The lifecycle advances toward the reader. Kept inside ±0.36 — tighter than it
 * looks like it wants to be, because depth displaces a screen-space label under
 * the oblique viewpoint, and two labels that clear each other in elevation can
 * still meet in isometric. Depth separates stages here; it does not rank them.
 */
const TIER_Z: Readonly<Record<StateTier, number>> = {
  intake: -0.36,
  market: -0.18,
  mandate: 0,
  measurement: 0.18,
  terminal: 0.36,
};

interface Point {
  readonly x: number;
  readonly y: number;
}

const STATE_LAYOUT: Readonly<Record<ProposalState, Point>> = {
  // Before a market: submitted, or gone before it ever reached one.
  Submitted: { x: left(5.4), y: ROW_INTAKE },
  Cancelled: { x: left(9.0), y: ROW_INTAKE },
  // The trunk, straight along one row: screen -> qualify -> trade -> reject ->
  // measure -> settle. Pitch 3.6, which is what two nine-glyph names need.
  Screening: { x: left(1.8), y: ROW_PATH },
  Qualified: { x: left(5.4), y: ROW_PATH },
  Trading: { x: left(9.0), y: ROW_PATH },
  Rejected: { x: left(12.6), y: ROW_PATH },
  Measuring: { x: left(16.2), y: ROW_PATH },
  Settled: { x: left(19.8), y: ROW_PATH },
  // The two answers that are not a plain no. Both sit left of where they come
  // from, because both send the proposal back toward the market.
  Extended: { x: left(7.2), y: ROW_ANSWER },
  Queued: { x: left(13.2), y: ROW_ANSWER },
  // Everything downstream of a mandate, and only reachable through one.
  Rerun: { x: left(1.8), y: ROW_MANDATE },
  Suspended: { x: left(5.4), y: ROW_MANDATE },
  Expired: { x: left(9.6), y: ROW_MANDATE },
  Executed: { x: left(13.8), y: ROW_MANDATE },
  FailedExecuted: { x: left(18.0), y: ROW_MANDATE },
};

/** The synthetic origin of T1. A proposal does not exist before `epoch.submit`. */
const ENTRY_ID = 'lc-entry';
const ENTRY_X = 1.8;

/**
 * Which origin each multi-origin row is drawn from.
 *
 * §2.1 gives five rows more than one origin state — T9, T10, T20, T21 and T25 —
 * and one edge can only leave one node. The default is the row's first origin;
 * the doc lists them earliest-first in lifecycle order. Two rows are overridden,
 * for two different reasons. The DOM table lists every origin either way.
 */
const DRAWN_FROM: Partial<Readonly<Record<TransitionId, ProposalState>>> = {
  // Collision. T25's first origin is Trading, and T8 already occupies
  // Trading -> Extended. Queued is also T25's most distinctive case: force_rerun
  // cancels a queued mandate (I-15) — and Queued and Extended share a row, so the
  // edge is one clean segment rather than a line crossing the trunk.
  T25: 'Queued',
  // Legibility, not collision — Submitted -> Rejected collides with nothing.
  // T20's first origin is Submitted, two rows and four columns from Rejected, so
  // the default edge would run the length of the trunk behind every box between
  // them. Extended is the origin that sits next to the target.
  T20: 'Extended',
};

/** Line weight is expected traffic, not probability. */
const EMPHASIS: Partial<Readonly<Record<TransitionId, number>>> = {
  T10: 2.5,
  T21: 2.5,
  T19: 1.6,
  T14: 1.0,
};
const EMPHASIS_DEFAULT = 0.8;

// ---------------------------------------------------------------------------
// Where the text lands
// ---------------------------------------------------------------------------

/**
 * The renderer's own label arithmetic, restated once so two callers can share it:
 * the fitting pass below, which drops an id rather than print it over something,
 * and the test, which asserts that nothing overlaps at all.
 *
 * Metrics follow `scene.css`. A state name is 0.42px semibold — about 0.24 stage
 * units a glyph — centred under its box on a baseline 0.55 below it. A transition
 * id is 0.32px mono, about 0.19 a glyph, **left-anchored** at the midpoint of the
 * two boxes it joins and 0.15 above the elbow. Glyphs rise 0.32 above their
 * baseline and drop 0.10 below.
 */
const NODE_GLYPH = 0.24;
const EDGE_GLYPH = 0.19;
const GLYPH_RISE = 0.32;
const GLYPH_DROP = 0.1;

/** Air two labels sharing a line must leave between them. */
const CLEARANCE = 0.3;

export interface LabelBox {
  readonly id: string;
  readonly kind: 'state' | 'transition';
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** Stage y grows upward; the drawing's y grows downward. Same flip as `Scene2D`. */
const flip = (y: number): number => STAGE_HEIGHT - y;

const boxAt = (
  id: string,
  kind: LabelBox['kind'],
  x0: number,
  x1: number,
  baseline: number,
): LabelBox => ({ id, kind, x0, x1, y0: baseline - GLYPH_RISE, y1: baseline + GLYPH_DROP });

function stateLabelBox(n: SceneNode): LabelBox | null {
  if (n.label === undefined) return null;
  const cx = n.x + n.w / 2;
  const half = (n.label.length * NODE_GLYPH) / 2;
  return boxAt(n.id, 'state', cx - half, cx + half, flip(n.y) + 0.55);
}

function edgeLabelBox(id: string, label: string, a: SceneNode, b: SceneNode): LabelBox {
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  const midY = (flip(a.y + a.h / 2) + flip(b.y + b.h / 2)) / 2;
  const x = (ax + bx) / 2;
  return boxAt(id, 'transition', x, x + label.length * EDGE_GLYPH, midY - 0.15);
}

/** A box's own silhouette, which an id must also stay out of — an id printed
 * behind a solid is not a collision, but it is not readable either. */
function bodyBox(n: SceneNode): LabelBox {
  return {
    id: n.id,
    kind: 'state',
    x0: n.x,
    x1: n.x + n.w,
    y0: flip(n.y + n.h),
    y1: flip(n.y),
  };
}

export function collide(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 + CLEARANCE && b.x0 < a.x1 + CLEARANCE && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Every label the drawing prints, as a rectangle. The test's subject. */
export function labelBoxes(model: SceneModel): LabelBox[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const out: LabelBox[] = [];
  for (const n of model.nodes) {
    if (n.label === undefined) continue;
    if (n.kind !== 'edge') {
      const box = stateLabelBox(n);
      if (box !== null) out.push(box);
      continue;
    }
    const a = n.from === undefined ? undefined : byId.get(n.from);
    const b = n.to === undefined ? undefined : byId.get(n.to);
    if (a !== undefined && b !== undefined) out.push(edgeLabelBox(n.id, n.label, a, b));
  }
  return out;
}

/**
 * Which id survives when two would land on each other: the story first, then the
 * table's own order.
 *
 * The layout is authored so that nothing is actually dropped — the test would say
 * so if one were. This is the guard rail, not the mechanism: it means a future
 * nudge to a column degrades to one missing three-glyph id instead of to two ids
 * printed on the same pixels, and the row itself is still drawn, still walkable
 * and still in the table with its origin and its guard.
 */
const LABEL_FIRST: readonly TransitionId[] = ['T1', 'T10', 'T21', 'T19', 'T14', 'T9'];

function labelRank(id: TransitionId): number {
  const first = LABEL_FIRST.indexOf(id);
  if (first !== -1) return first;
  return LABEL_FIRST.length + TRANSITIONS.findIndex((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Walking the scenario
// ---------------------------------------------------------------------------

interface WalkStep {
  readonly t: Transition;
  /**
   * The state the proposal was actually in. `null` for T1, which has no origin,
   * and `null` again if the replay cannot connect the row to the state before it
   * — an unrecoverable origin is printed as unknown rather than guessed.
   */
  readonly from: ProposalState | null;
  readonly block: number;
}

/**
 * Replay `sim.proposal.history` against §2.1 to recover the origin of each step.
 *
 * The engine records only which row fired, so a multi-origin row's actual origin
 * has to be recovered from the state the previous row left the proposal in. Where
 * that recovery fails the origin is genuinely unknown, and falling back to the
 * doc's first-listed origin would print a protocol fact this history does not
 * support — so it stays `null`.
 */
function walk(sim: SimState): WalkStep[] {
  const out: WalkStep[] = [];
  let current: ProposalState | null = null;
  for (const entry of sim.proposal.history) {
    const t = transitionById(entry.id);
    const origins = fromStates(t);
    const from = current !== null && origins.includes(current) ? current : null;
    out.push({ t, from, block: entry.block });
    current = t.to;
  }
  return out;
}

function visitedStates(steps: readonly WalkStep[]): Set<ProposalState> {
  const seen = new Set<ProposalState>();
  for (const s of steps) {
    if (s.from !== null) seen.add(s.from);
    seen.add(s.t.to);
  }
  return seen;
}

/** Markets deployed and the vault not `Voided` — the fact `isTerminal` needs. */
function hasHealthyVault(sim: SimState): boolean {
  return sim.books.length > 0 && sim.vault.state.kind !== 'Voided';
}

function drawnFromState(t: Transition): ProposalState | null {
  return DRAWN_FROM[t.id] ?? fromStates(t)[0] ?? null;
}

const nodeIdFor = (s: ProposalState): string => `lc-node-${s}`;
const rowIdForState = (s: ProposalState): string => `lc-s-${s}`;
const rowIdForTransition = (id: TransitionId): string => `lc-t-${id}`;
const rowIdForReason = (r: string): string => `lc-r-${r}`;

/** The unordered segment a drawn edge occupies, for label merging. */
const segmentKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export function buildModel(sim: SimState): SceneModel {
  const steps = walk(sim);
  const walked = new Set<TransitionId>(steps.map((s) => s.t.id));
  const visited = visitedStates(steps);
  const current = sim.proposal.state;

  const nodes: SceneNode[] = [];

  nodes.push({
    id: ENTRY_ID,
    kind: 'node',
    x: left(ENTRY_X),
    y: ROW_INTAKE,
    z: -0.5,
    w: NODE_W,
    h: NODE_H,
    d: NODE_D,
    tone: 'dim',
    label: 'start',
    state: walked.has('T1') ? 'passed' : 'inactive',
    domRowId: ENTRY_ID,
  });

  for (const s of PROPOSAL_STATES) {
    const p = STATE_LAYOUT[s];
    const state: NodeState =
      s === current ? 'active' : visited.has(s) ? 'passed' : 'inactive';
    nodes.push({
      id: nodeIdFor(s),
      kind: 'node',
      x: p.x,
      y: p.y,
      z: TIER_Z[STATE_META[s].tier],
      w: NODE_W,
      h: NODE_H,
      d: NODE_D,
      tone: state === 'inactive' ? 'dim' : 'ink',
      label: s,
      state,
      domRowId: rowIdForState(s),
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Two rows can share one segment: T3 and T6 run between the same pair in
  // opposite directions, and T4 and T26 are literally the same arrow. Two labels
  // printed at one midpoint are unreadable, so the segment carries a single merged
  // label while the transition id stays on each edge's own id and DOM row. The
  // separator is a slash rather than a middot because the merged label has to fit
  // the clear run between two boxes, and two glyphs of it are the separator.
  const segments = new Map<string, TransitionId[]>();
  const endpoints = new Map<TransitionId, readonly [string, string]>();
  for (const t of TRANSITIONS) {
    const from = drawnFromState(t);
    const pair = [from === null ? ENTRY_ID : nodeIdFor(from), nodeIdFor(t.to)] as const;
    endpoints.set(t.id, pair);
    const key = segmentKey(pair[0], pair[1]);
    const bucket = segments.get(key);
    if (bucket === undefined) segments.set(key, [t.id]);
    else bucket.push(t.id);
  }

  // Place the ids. State names and box silhouettes are fixed obstacles; each id
  // is kept only if it clears everything already on the stage.
  const placed: LabelBox[] = [];
  for (const n of nodes) {
    placed.push(bodyBox(n));
    const box = stateLabelBox(n);
    if (box !== null) placed.push(box);
  }
  const printed = new Map<TransitionId, string>();
  const byRank = [...TRANSITIONS].sort((a, b) => labelRank(a.id) - labelRank(b.id));
  for (const t of byRank) {
    const pair = endpoints.get(t.id);
    if (pair === undefined) continue;
    const bucket = segments.get(segmentKey(pair[0], pair[1])) ?? [t.id];
    if (bucket[0] !== t.id) continue;
    const a = byId.get(pair[0]);
    const b = byId.get(pair[1]);
    if (a === undefined || b === undefined) continue;
    const label = bucket.join('/');
    const box = edgeLabelBox(`lc-edge-${t.id}`, label, a, b);
    if (placed.some((p) => collide(p, box))) continue;
    placed.push(box);
    printed.set(t.id, label);
  }

  for (const t of TRANSITIONS) {
    const pair = endpoints.get(t.id) ?? [ENTRY_ID, nodeIdFor(t.to)];
    const state: NodeState = walked.has(t.id) ? 'passed' : 'inactive';
    nodes.push({
      id: `lc-edge-${t.id}`,
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: state === 'passed' ? 'ink' : 'dim',
      state,
      from: pair[0],
      to: pair[1],
      label: printed.get(t.id),
      emphasis: EMPHASIS[t.id] ?? EMPHASIS_DEFAULT,
      domRowId: rowIdForTransition(t.id),
    });
  }

  return {
    nodes,
    // No annotation rules. The rows carry the reading, and every tick this scene
    // used to draw repeated a state name the boxes already print — duplicated ink
    // that cost the labels the room they needed.
    rules: [],
    relation:
      'Which way this machine usually goes. The heavy line along the middle row is the ordinary ending: the market says no, the proposal is scored anyway, and the cohort settles. The thin line climbing to the top row is the rare one, where the change is actually carried out. Rows are stages, not ranks — the bottom row is before any market exists, the middle row is the trip through the market, and the two above it are things that can only happen once a market has answered.',
    unitLegend:
      'Line weight is expected traffic, not measured frequency: nothing in this app counts how often a step fires. Ids are printed where they fit; the table in the rail carries all 26 rows either way.',
  };
}

// ---------------------------------------------------------------------------
// The rail — the authoritative surface
// ---------------------------------------------------------------------------

const group = (v: number): string => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const originsLabel = (t: Transition): string => {
  const origins = fromStates(t);
  return origins.length === 0 ? '—' : origins.join(', ');
};

const CITE_21 = cite('05', '§2.1', 'the closed transition table');
// The two enums are declared in doc 02 §2, *Shared SCALE primitives* — the section
// that also fixes the append-only `#[codec(index)]` discipline. §4 is View types and
// declares neither, so a value carrying a §4 citation would be citing the wrong page.
const CITE_STATE_ENUM = cite('02', '§2', 'ProposalState, the frozen enum');
const CITE_SCALE = cite('02', '§2', 'RejectReason, frozen append-only SCALE variants');

/**
 * How a state behaves at the end of the machine, asked of §2.1's own predicates.
 *
 * Asked with a healthy vault, because that is the interesting question: the pair
 * `isTerminal(s, true)` / `isTransient(s, true)` is exactly what separates a real
 * endpoint from `Rejected` and `Expired`, which look like endpoints and are not.
 */
function stateStatus(s: ProposalState): string {
  if (isTerminal(s, true)) return 'terminal';
  if (isTransient(s, true)) return 'transient with a vault';
  return 'in flight';
}

export function LifecycleScene({ sim }: { sim: SimState }): JSX.Element {
  const steps = walk(sim);
  const walkedIds = new Set<TransitionId>(steps.map((s) => s.t.id));
  const visited = visitedStates(steps);
  const current = sim.proposal.state;
  const healthy = hasHealthyVault(sim);
  const terminal = isTerminal(current, healthy);
  const transient = isTransient(current, healthy);
  const reason = sim.proposal.rejectReason;
  // `ProposalState` carries a payload in exactly one variant — `Rejected(RejectReason)`
  // (doc 02 §2). A rejection reason outlives the `Rejected` state: T21 moves the
  // proposal to `Measuring` in the same block, and the recorded reason is still there.
  // Printing `Measuring(GateVetoSurvival)` would invent an enum shape the runtime does
  // not have, so the parentheses belong to `Rejected` alone and the surviving reason is
  // reported for what it is.
  const chipText =
    current === 'Rejected' && reason !== null ? `${current}(${reason})` : current;
  const carriedReason = current === 'Rejected' ? null : reason;
  const exits = transitionsFrom(current);
  const safetyReasons = REJECT_REASONS.filter(
    (r) => REJECT_REASON_META[r].severity === 'safety',
  );

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame
          model={buildModel(sim)}
          title="The proposal lifecycle: every state and every transition"
        />
      </div>

      <div className="col-rail">
        <Lede>
          A proposal is a request to change the chain. Every one of them walks the
          same fixed path — handed in, checked, put in front of a market, then
          either carried out or turned down — and{' '}
          <strong>being turned down is the normal ending, not a failure</strong>:
          the market’s verdict is scored and paid out either way. The map on the
          left is that path in full; nothing can happen to a proposal that is not
          drawn on it. Nobody is in charge of moving it along: each step is pushed
          by whichever <Jargon word="keeper" /> submits the routine call first.
        </Lede>

        <KeyFacts>
          <KeyFact label="Places to be" note="every state a proposal can hold">
            <Value of={spec(PROPOSAL_STATES.length, CITE_STATE_ENUM)} />
          </KeyFact>
          <KeyFact label="Legal moves" note="the only steps between them">
            <Value of={spec(TRANSITIONS.length, CITE_21)} />
          </KeyFact>
          <KeyFact label="Exits from here" note="moves that can still fire">
            <Value of={derived(exits.length, CITE_21)} />
          </KeyFact>
        </KeyFacts>

        <section className="panel" aria-labelledby="lc-now">
          <h2 className="panel__title" id="lc-now">
            Where the proposal stands
          </h2>
          <p className="lc-chipline">
            <span className="chip chip--state">{chipText}</span>
            <span className="cite">05 §2.1</span>
          </p>
          <p className="panel__note">{STATE_META[current].blurb}</p>
          {carriedReason !== null ? (
            <p className="panel__note lc-note">
              <code>ProposalState</code> carries a reason in exactly one variant,{' '}
              <code>Rejected(RejectReason)</code>, so the chip above reads{' '}
              <code>{current}</code> on its own. The reason this proposal was
              refused, <code>{carriedReason}</code>, lives in the{' '}
              <code>DecisionOutcome</code> the runtime recorded — §2.1 is explicit
              that the archive, not the state, is where a reason survives.
            </p>
          ) : null}
          <p className="panel__note">
            {terminal
              ? 'The lifecycle stops here: there is no open vault left to measure, so no further transition can fire.'
              : transient
                ? 'This is not an endpoint. Markets were deployed and the vault is still open, so T21 fires in the same block and the proposal goes on to be measured.'
                : 'Still in flight — the transition table below names every row that can leave this state.'}
          </p>
          <dl className="statgrid">
            <div className="stat">
              <dt className="stat__label">Proposal</dt>
              <dd className="stat__value">
                <Value of={simulated(sim.proposal.id)} />
              </dd>
            </div>
            <div className="stat">
              <dt className="stat__label">Block</dt>
              <dd className="stat__value">
                <Value of={simulated(sim.block)} format={group} />
              </dd>
            </div>
            <div className="stat">
              <dt className="stat__label">Transitions walked</dt>
              <dd className="stat__value">
                <Value of={simulated(steps.length)} />
              </dd>
            </div>
          </dl>
          <p className="panel__note lc-note">
            The chip is the runtime’s <code>ProposalState</code>, and it is set in ink
            whatever it says. Rejection is the ordinary output of this machine, so
            painting a <code>Rejected</code> chip as a failure would teach the wrong
            lesson about the mechanism.
          </p>
        </section>

        <Depth
          title="What this proposal has done so far"
          hint={`${String(steps.length)} steps`}
        >
          {steps.length === 0 ? (
            <p className="panel__note lc-note">
              Nothing yet. A proposal enters the machine only through T1,{' '}
              <code>epoch.submit</code>, and only during the Intake phase.
            </p>
          ) : (
            <div className="lc-scroll">
              <table>
                <caption className="sr-only">
                  The transitions this proposal has taken, in order.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">T</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Trigger</th>
                    <th scope="col" className="numeric">
                      Block
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((s, i) => (
                    <tr key={`${s.t.id}-${String(i)}`}>
                      <td className="lc-id">{s.t.id}</td>
                      <td className="lc-state">{s.from ?? '—'}</td>
                      <td className="lc-state">{s.t.to}</td>
                      <td>{s.t.trigger}</td>
                      <td className="numeric">
                        <Value of={simulated(s.block)} format={group} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="panel__note">
            Where §2.1 gives a row several origin states, the origin printed here is
            the one this proposal was actually in, recovered by replaying its history
            against the table — and left as an em dash rather than guessed where the
            replay cannot reach it, as it cannot for T1, which has no origin at all.
          </p>
        </Depth>

        <Depth title="The two things everyone gets wrong" hint="2 myths">
          <ol className="lc-ol">
            <li>
              <strong>
                <code>Rejected</code> and <code>Expired</code> are usually not the end.
              </strong>{' '}
              T21 fires automatically, in the same block, whenever markets were
              deployed and the vault is still open: the vault resolves to the REJECT
              branch, that branch trades through measurement, and the cohort settles
              like any other. They are genuinely terminal only where no vault exists —
              a pre-Seed rejection through T20 — or where the vault was voided. That is
              why <code>isTerminal</code> and <code>isTransient</code> both take the
              vault as an argument: there is no answer without it. T10 also refunds the
              bond in full and releases the resource locks in both arms. Rejection is
              information, not punishment.
            </li>
            <li>
              <strong>T25 is the force-rerun transition.</strong> There is no separate
              “FR” edge anywhere in the machine: <code>guardian.force_rerun(pid)</code>{' '}
              is T25, it is pre-execution only, and it cancels a queued mandate in the
              same transaction (I-15). A guardian gets{' '}
              <em>one rerun of either kind per proposal, ever</em> — the T25 allowance
              is shared with the T11 → T12 → T13 delay-then-rerun path, so spending{' '}
              <code>delay_once</code> spends the force-rerun too.
            </li>
          </ol>
        </Depth>

        <Depth
          title="Every place a proposal can be, and what it means there"
          hint={`${String(PROPOSAL_STATES.length)} states`}
        >
          <div className="lc-scroll">
            <table>
              <caption className="sr-only">
                Every ProposalState, the tier the diagram lays it out in, and how it
                behaves at the end of the machine. States this proposal has visited are
                marked.
              </caption>
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr id={ENTRY_ID}>
                  <td className="lc-state">— (no state)</td>
                  <td>—</td>
                  <td>outside the machine</td>
                </tr>
                <tr className="lc-cont">
                  <td colSpan={3} className="lc-blurb">
                    A proposal does not exist until T1. <code>epoch.submit</code> is the
                    only entry, and it is admitted only during the Intake phase. The
                    diagram draws it as the box marked <em>start</em>.
                  </td>
                </tr>
                {PROPOSAL_STATES.map((s) => (
                  <Fragment key={s}>
                    <tr
                      id={rowIdForState(s)}
                      className={visited.has(s) ? 'lc-walked' : undefined}
                    >
                      <td className="lc-state lc-id">
                        {s}
                        {visited.has(s) ? (
                          <span className="sr-only"> — visited</span>
                        ) : null}
                      </td>
                      <td>{STATE_META[s].tier}</td>
                      <td>{stateStatus(s)}</td>
                    </tr>
                    <tr className="lc-cont">
                      <td colSpan={3} className="lc-blurb">
                        {STATE_META[s].blurb}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel__note lc-note">
            <code>ProposalState</code> is closed: §2.1 is normative and says anything
            absent from it is impossible and must error. <em>Tier</em> is the layout
            stage the diagram lays a state out in — the canvas depth axis, not a field
            the runtime stores. Two assignments are deliberate: <code>Rerun</code> sits
            in <em>market</em>, because a rerun sends a mandate back to the books at
            double POL, and <code>Rejected</code> and <code>Expired</code> sit in{' '}
            <em>measurement</em> rather than <em>terminal</em>, which is what makes T21
            legible.
          </p>
        </Depth>

        <Depth
          title="Every move it is allowed to make, and what must be true first"
          hint={`${String(TRANSITIONS.length)} moves`}
        >
          <div className="lc-scroll">
            <table>
              <caption className="sr-only">
                Doc 05 §2.1 in full: every transition, its origin states, its target,
                the call that fires it, its dispatch origin and the guard it must
                satisfy. Rows this scenario has walked are marked.
              </caption>
              <thead>
                <tr>
                  <th scope="col">T</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {TRANSITIONS.map((t) => (
                  <Fragment key={t.id}>
                    <tr
                      id={rowIdForTransition(t.id)}
                      className={walkedIds.has(t.id) ? 'lc-walked' : undefined}
                    >
                      <td className="lc-id">
                        {t.id}
                        {walkedIds.has(t.id) ? (
                          <span className="sr-only"> — walked</span>
                        ) : null}
                      </td>
                      <td className="lc-state">{originsLabel(t)}</td>
                      <td className="lc-state">{t.to}</td>
                      <td>{t.trigger}</td>
                    </tr>
                    <tr className="lc-cont">
                      <td colSpan={4} className="lc-blurb">
                        <strong>Origin:</strong> {t.origin}. <strong>Guard:</strong>{' '}
                        {t.guard}.
                        {t.sameBlockFollowUp !== undefined
                          ? ` ${t.sameBlockFollowUp} then follows in the same block whenever the vault is still open.`
                          : ''}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel__note lc-note">
            The diagram draws one edge per row. Where §2.1 gives a row several origin
            states the edge leaves a single representative origin — T20 from{' '}
            <code>Extended</code>, T25 from <code>Queued</code>, every other from the
            first origin the doc lists — while the <em>From</em> column here always
            lists them all. Where two rows share one segment (T3 with T6, T4 with T26)
            that segment carries a merged label. An id is printed on the drawing only
            where it fits clear of every other label; this table is the complete set
            either way.
          </p>
        </Depth>

        <Depth
          title="Why a proposal gets turned down"
          hint={`${String(REJECT_REASONS.length)} reasons`}
        >
          <p className="panel__note lc-note">
            <code>RejectReason</code> has{' '}
            <Value of={spec(REJECT_REASONS.length, CITE_SCALE)} /> variants, and doc 02
            §2 holds the enum append-only after genesis: an index, once assigned, never
            moves, and removing a variant takes a new type, a storage migration and a
            contract-version bump. Only{' '}
            <Value
              of={derived(safetyReasons.length, cite('05', '§1.3', 'producer map'))}
            />{' '}
            describe a live hazard the protocol is braking against — the two gate vetoes
            and <code>ProcessHold</code>. The rest are ordinary outcomes of the
            procedure, and the only confiscating paths in the whole machine are T4’s two
            enumerated slash arms and T18’s executability slash.
          </p>
          <div className="lc-scroll">
            <table>
              <caption className="sr-only">
                Every RejectReason, its frozen SCALE index, its severity and what it
                means.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Reason</th>
                  <th scope="col" className="numeric">
                    SCALE
                  </th>
                  <th scope="col">Severity</th>
                </tr>
              </thead>
              <tbody>
                {REJECT_REASONS.map((r) => {
                  const meta = REJECT_REASON_META[r];
                  const safety = meta.severity === 'safety';
                  return (
                    <Fragment key={r}>
                      <tr id={rowIdForReason(r)}>
                        <td className="lc-id">{r}</td>
                        <td className="numeric">
                          <Value
                            of={spec(
                              REJECT_REASON_INDEX[r],
                              cite(
                                '02',
                                '§2',
                                'declaration order is the SCALE variant index',
                              ),
                            )}
                          />
                        </td>
                        <td>
                          <span
                            className={
                              safety ? 'chip chip--safety' : 'chip chip--state'
                            }
                          >
                            {meta.severity}
                          </span>
                        </td>
                      </tr>
                      <tr className="lc-cont">
                        <td colSpan={3} className="lc-blurb">
                          {meta.blurb} <strong>Produced by:</strong> {meta.producedBy}.
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="panel__note">
            Severity is a design mandate expressed in code, not a mood. A routine reason
            renders in ink because it is the procedure working; the alarm tone is spent
            only where the market has actually priced a survival or security hazard, or
            where a VOID condition, a stale epoch or an active ledger freeze has halted
            the process from outside.
          </p>
        </Depth>
      </div>
    </div>
  );
}
