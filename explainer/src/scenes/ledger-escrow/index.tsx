import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { MotionSpec } from '../motion';
import { STAGE_WIDTH } from '../model';
import type { SceneModel, SceneNode, SceneRule } from '../model';

import type { SimState } from '../../sim/types';
import { Value } from '../../ui/Value';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { combine, derived, simulated, spec } from '../../provenance/types';
import type { Tagged } from '../../provenance/types';
import { cite } from '../../protocol/citations';
import { USDC, formatPrice, formatUsdc } from '../../protocol/units';
import { VOID_BASELINE_SCORE } from '../../protocol/constants';
import { param } from '../../protocol/params';
import {
  LEDGER_CALLS,
  REDEMPTION_MATRIX,
  baselinePayout,
  baselinePositions,
  branchIdentity,
  checkConservation,
  legalCallsFor,
  maxClaimValue,
  positionKey,
  proposalPositions,
  redeemPayout,
  redeemVoidPayout,
  scalarPairPayout,
  scalarPayout,
} from '../../protocol/ledger';
import type { BranchSupply, LedgerCall, Vault } from '../../protocol/ledger';
import { BRANCHES, GATE_TYPES, POSITION_KINDS, positionKindLabel } from '../../protocol/types';
import type { Branch, GateType, PositionId, PositionKind, VaultState } from '../../protocol/types';

import './ledger-escrow.css';

/**
 * The conditional ledger — dual-minting escrow, the 14 + 2 instruments, and the
 * redemption matrix.
 *
 * The one thing this scene has to make unmistakable is that `split` does not
 * divide. Paying `a` USDC into a vault mints `a` ACCEPT-USDC *and* `a`
 * REJECT-USDC to the same account, so the two cubes leaving the split are the
 * same size as the cube that entered it. Value is not halved; the number of
 * worlds it can live in is doubled. Everything else here — the seven instruments
 * per branch, the frozen losing side, the VOID valuation schedule — is
 * bookkeeping on top of that one identity, and all of it now lives one click
 * down, behind a `Depth` drawer, so the founding trick is what a first reader
 * meets.
 */

// ---------------------------------------------------------------------------
// Stage geometry
// ---------------------------------------------------------------------------

/**
 * `x_left + x_right` for a mirrored pair. Setting it to the stage width puts the
 * axis of reflection on the stage's own centre line, so "the two sides are the
 * same object" is something the eye checks against the frame rather than against
 * an invisible rule at 11.6.
 */
const MIRROR_SUM = STAGE_WIDTH;
const mirrorX = (x: number, w: number): number => MIRROR_SUM - x - w;

const CUBE = 1.8;

/**
 * Four tiers, read top to bottom: the payment, the two worlds it mints, the
 * seven forms each world's claim can be held in, and the valuation scale at the
 * foot. Every tier has its own `y`, and a label's baseline depends only on `y`
 * (`Scene2D` draws it at `12 − y + 0.55` regardless of node height), so nodes
 * that share a tier share a text row and nodes that do not, cannot collide.
 */
const IN_X = 9.6; // (21 − 1.8) / 2 — centred over the axis
const IN_Y = 10.1;
const WORLD_X = 3.5;
const WORLD_Y = 6.8;
const CLAIM_Y = 4.6; // cash and the two welfare legs
const GATE_Y = 2.8; // the four gate legs

/** The valuation band: a linear scale from 0 to par along the stage's foot. */
const VY0 = 0.25;
const VSPAN = 1.6;
const vy = (v: number): number => VY0 + VSPAN * v;

/** Where a shelf's line starts, clear of the value scale's own rule and ticks. */
const SHELF_X0 = 1.9;

interface ChipGeom {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Accept-side chip geometry, in `POSITION_KINDS` order. Shape carries the
 * instrument family before colour carries anything:
 *
 *  - equal `w` and `h` — a **disc**: a scalar leg (LONG / SHORT);
 *  - taller than wide — a **tablet**: one of the four gate legs;
 *  - wider than tall — a **bar**: branch-USDC, money inside one world.
 *
 * The reject side is the exact mirror of these through the centre line, which is
 * what makes the clone readable as a clone. The gate legs sit on their own row
 * and are drawn tight-in-pairs / loose-between-pairs, so "two gates, two legs
 * each" is countable without four labels fighting for 3.6 units of width.
 */
const CHIP_GEOM: readonly ChipGeom[] = [
  { x: 2.15, y: CLAIM_Y, w: 1.3, h: 0.6 }, // BranchUsdc — bar
  { x: 4.15, y: CLAIM_Y, w: 0.9, h: 0.9 }, // Long — disc
  { x: 5.75, y: CLAIM_Y, w: 0.9, h: 0.9 }, // Short — disc
  { x: 2.6, y: GATE_Y, w: 0.6, h: 1.0 }, // GateYes Survival — tablet
  { x: 3.45, y: GATE_Y, w: 0.6, h: 1.0 }, // GateNo Survival
  { x: 4.8, y: GATE_Y, w: 0.6, h: 1.0 }, // GateYes Security
  { x: 5.65, y: GATE_Y, w: 0.6, h: 1.0 }, // GateNo Security
];

// ---------------------------------------------------------------------------
// Position vocabulary
// ---------------------------------------------------------------------------

type ProposalPosition = Extract<PositionId, { readonly scope: 'Proposal' }>;

/** The `PositionKind` half of a storage key, matching `positionKey`. */
function kindTag(k: PositionKind): string {
  return k.kind === 'GateYes' || k.kind === 'GateNo' ? `${k.kind}:${k.gate}` : k.kind;
}

/**
 * What a chip is called *on the stage* — or `undefined` for the four gate legs,
 * which are drawn and counted but not named.
 *
 * A label is set in stage units and centred under its chip, so an N-character
 * label occupies about `N · 0.24` units and two labels on one row need their
 * centres more than `(len_a + len_b)·0.12 + 0.3` apart. Seven names under a
 * 4.5-unit cluster cannot satisfy that at any spacing, and the honest fix is
 * fewer names rather than smaller type: `S-YES` / `C-NO` collided *and* meant
 * nothing to a first reader. The full vocabulary is one drawer away in the rail.
 */
function chipLabel(k: PositionKind): string | undefined {
  switch (k.kind) {
    case 'BranchUsdc':
      return 'cash';
    case 'Long':
      return 'LONG';
    case 'Short':
      return 'SHORT';
    default:
      return undefined;
  }
}

type Family = 'branch-USDC' | 'scalar leg' | 'gate leg';

function familyOf(k: PositionKind): Family {
  if (k.kind === 'BranchUsdc') return 'branch-USDC';
  if (k.kind === 'Long' || k.kind === 'Short') return 'scalar leg';
  return 'gate leg';
}

/** A DOM-safe id derived from the real storage key, so the two cannot drift. */
function rowId(id: PositionId): string {
  return `lx-${positionKey(id).replace(/[/:]/g, '-')}`;
}

/** How the sim's `holdings` record keys one position. */
function holdingKey(branch: Branch, kind: PositionKind): string {
  return `${branch}/${kindTag(kind)}`;
}

/**
 * The single line printed against a holding: what that instrument can do *right
 * now*. It is state-dependent because legality is, and it never promises a
 * payout the vault's state does not already permit.
 */
function chipNote(state: VaultState, branch: Branch, kind: PositionKind): string {
  switch (state.kind) {
    case 'Open':
      return 'no unpaired path';
    case 'Resolved':
      return branch === state.winner ? 'barred until settle' : 'frozen';
    case 'ScalarSettled': {
      if (branch !== state.winner) return 'frozen';
      switch (kind.kind) {
        case 'BranchUsdc':
          return '1:1';
        case 'Long':
          return 'floor(a·s)';
        case 'Short':
          return 'floor(a·(1−s))';
        default:
          return 'gate not settled';
      }
    }
    case 'Voided':
      return kind.kind === 'BranchUsdc' ? '½ unpaired' : '¼ unpaired';
    case 'BaselineSettled':
      return 'not a proposal vault';
  }
}

/** The call that realises this holding in this state, or `null` if none does. */
function realisingCall(
  state: VaultState,
  branch: Branch,
  kind: PositionKind,
): LedgerCall | null {
  if (state.kind === 'Voided') return 'redeem_void';
  if (state.kind !== 'ScalarSettled') return null;
  if (branch !== state.winner) return null;
  switch (kind.kind) {
    case 'BranchUsdc':
      return 'redeem';
    case 'Long':
    case 'Short':
      return 'redeem_scalar';
    default:
      return 'redeem_gate';
  }
}

function stateLabel(state: VaultState): string {
  switch (state.kind) {
    case 'Open':
      return 'Open';
    case 'Resolved':
      return `Resolved(${state.winner})`;
    case 'ScalarSettled':
      return `ScalarSettled(${state.winner}, s = ${formatPrice(state.s)})`;
    case 'Voided':
      return 'Voided';
    case 'BaselineSettled':
      return `BaselineSettled(s = ${formatPrice(state.s)})`;
  }
}

/**
 * The same state in words a first reader can act on. `ScalarSettled(Accept, s =
 * 0.436)` is the precise name and it is kept — in the drawer, next to the call
 * surface it governs. Up top, what a holder needs is whether anything can be
 * claimed yet.
 */
function plainState(state: VaultState): string {
  switch (state.kind) {
    case 'Open':
      return 'open — nothing has been decided';
    case 'Resolved':
      return `${state.winner} won — no payouts yet`;
    case 'ScalarSettled':
      return `${state.winner} won — payouts are open`;
    case 'Voided':
      return 'voided — the question died unanswered';
    case 'BaselineSettled':
      return 'the epoch’s own vault, not this one';
  }
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Build the stage. The relation it carries that a table cannot is conservation:
 * one cube in, two full-size cubes out, and a countable row of forms below each
 * world that the world's cube is always the sum of — so `E` is readable on both
 * sides at once.
 */
export function buildModel(sim: SimState): SceneModel {
  const state = sim.vault.state;
  const winner =
    state.kind === 'Resolved' || state.kind === 'ScalarSettled' ? state.winner : null;
  const mergeLegal = legalCallsFor(state).includes('merge');
  const escrowBase = sim.vault.escrowed * USDC;

  const nodes: SceneNode[] = [];

  // The payment. One cube, entering at the top, centred on the axis both worlds
  // are reflected through.
  nodes.push({
    id: 'escrow-in',
    kind: 'cube',
    x: IN_X,
    y: IN_Y,
    w: CUBE,
    h: CUBE,
    d: CUBE,
    tone: 'ink',
    label: 'Your deposit',
    state: escrowBase > 0 ? 'active' : 'pending',
    domRowId: 'lx-flow-in',
  });

  // The clones. Both full size — this is the whole scene in one geometric fact.
  for (const branch of BRANCHES) {
    const isAccept = branch === 'Accept';
    nodes.push({
      id: `world-${branch}`,
      kind: 'cube',
      x: isAccept ? WORLD_X : mirrorX(WORLD_X, CUBE),
      y: WORLD_Y,
      w: CUBE,
      h: CUBE,
      d: CUBE,
      tone: isAccept ? 'accept' : 'reject',
      label: `${branch.toUpperCase()}-USDC`,
      sublabel: isAccept ? 'if adopted' : 'if rejected',
      state: winner !== null && winner !== branch ? 'frozen' : 'active',
      domRowId: `lx-flow-world-${branch}`,
    });
    nodes.push({
      id: `mint-${branch}`,
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: isAccept ? 'accept' : 'reject',
      from: 'escrow-in',
      to: `world-${branch}`,
      label: '1 full unit',
      emphasis: 1.4,
      domRowId: `lx-flow-mint-${branch}`,
    });
  }

  // The tie bar is a fact, not decoration: present exactly when `merge` is a
  // legal call, i.e. when a cross-branch pair still recovers par.
  if (mergeLegal) {
    nodes.push({
      id: 'pair-tie',
      kind: 'tie',
      x: WORLD_X + CUBE,
      y: WORLD_Y + CUBE / 2 - 0.15,
      w: mirrorX(WORLD_X, CUBE) - (WORLD_X + CUBE),
      h: 0.3,
      tone: 'ink',
      label: 'pair = 1 USDC',
      domRowId: 'lx-flow-tie',
    });
  }

  // The seven forms each world's claim can be held in. The losing side is
  // flattened in place and never removed: "frozen, not burned" is geometry, not
  // colour. Only the first three carry a name — see `chipLabel`.
  for (const branch of BRANCHES) {
    const frozen = winner !== null && winner !== branch;
    POSITION_KINDS.forEach((kind, i) => {
      const g = CHIP_GEOM[i];
      if (g === undefined) return;
      const id: ProposalPosition = {
        scope: 'Proposal',
        proposal: sim.proposal.id,
        branch,
        kind,
      };
      nodes.push({
        id: `chip-${branch}-${kindTag(kind)}`,
        kind: 'chip',
        x: branch === 'Accept' ? g.x : mirrorX(g.x, g.w),
        y: g.y,
        w: g.w,
        h: g.h,
        tone: branch === 'Accept' ? 'accept' : 'reject',
        label: chipLabel(kind),
        state: frozen ? 'frozen' : 'active',
        domRowId: rowId(id),
      });
    });
  }

  const rules: SceneRule[] = [
    {
      id: 'value-scale',
      axis: 'y',
      at: 1.6,
      from: vy(0),
      to: vy(1),
      tone: 'ink',
      label: 'what 1 unit pays',
      ticks: [
        { at: vy(0), label: '0' },
        { at: vy(0.25), label: '¼' },
        { at: vy(0.5), label: '½' },
        { at: vy(1), label: 'par' },
      ],
    },
  ];

  // The shelves: what one unit of each thing can reach, in this state. They are
  // ink in every state, including the settled one: a shelf is a valuation level,
  // not a branch instrument, and tinting it by the winner would put the outcome
  // in a colour. Each shelf ends at its own x so that its label — drawn from the
  // line's right end — never lands on the shelf above or below it.
  if (state.kind === 'Voided') {
    rules.push(
      {
        id: 'shelf-par',
        axis: 'x',
        at: vy(1),
        from: SHELF_X0,
        to: 7.0,
        tone: 'ink',
        label: 'one of each side pays 1',
      },
      {
        id: 'shelf-half',
        axis: 'x',
        at: vy(0.5),
        from: SHELF_X0,
        to: 9.0,
        tone: 'ink',
        label: 'one side alone pays ½',
      },
      {
        id: 'shelf-quarter',
        axis: 'x',
        at: vy(0.25),
        from: SHELF_X0,
        to: 11.0,
        tone: 'ink',
        label: 'any smaller claim pays ¼',
      },
      {
        id: 'shelf-zero',
        axis: 'x',
        at: vy(0),
        from: SHELF_X0,
        to: 13.0,
        tone: 'dim',
        dashed: true,
        label: 'merging legs pays no cash',
      },
    );
  } else if (state.kind === 'ScalarSettled') {
    rules.push(
      {
        id: 'shelf-par',
        axis: 'x',
        at: vy(1),
        from: SHELF_X0,
        to: 13.0,
        tone: 'ink',
        label: 'cash pays 1 for 1',
      },
      {
        id: 'shelf-long',
        axis: 'x',
        at: vy(state.s),
        from: SHELF_X0,
        to: 8.0,
        tone: 'ink',
        label: 'LONG pays the score',
      },
      {
        id: 'shelf-short',
        axis: 'x',
        at: vy(1 - state.s),
        from: SHELF_X0,
        to: 4.0,
        tone: 'ink',
        label: 'SHORT pays the rest',
      },
      {
        id: 'shelf-zero',
        axis: 'x',
        at: vy(0),
        from: SHELF_X0,
        to: 15.0,
        tone: 'dim',
        dashed: true,
        label: 'the losing side pays 0',
      },
    );
  } else if (state.kind === 'BaselineSettled') {
    rules.push({
      id: 'shelf-zero',
      axis: 'x',
      at: vy(0),
      from: SHELF_X0,
      to: 5.0,
      tone: 'dim',
      dashed: true,
      label: 'a proposal vault is never in this state',
    });
  } else {
    rules.push(
      {
        id: 'shelf-par',
        axis: 'x',
        at: vy(1),
        from: SHELF_X0,
        to: 11.0,
        tone: 'ink',
        label: 'a pair still merges for 1',
      },
      {
        id: 'shelf-zero',
        axis: 'x',
        at: vy(0),
        from: SHELF_X0,
        to: 5.0,
        tone: 'dim',
        dashed: true,
        label: 'nothing pays out until it ends',
      },
    );
  }

  return {
    nodes,
    rules,
    relation:
      'One payment in, two whole claims out. The cube at the top is what you paid; the two cubes below it are each the same size as it, because split(a) mints a full claim in the ACCEPT world and a full claim in the REJECT world instead of cutting one claim in two. At most one of those worlds is ever paid in full — and if the question dies unanswered, VOID values both at half rather than paying either — so the escrow behind them is never over-committed. The seven small shapes under each world are the forms that world’s claim can be held in: cash (the wide bar), the two welfare legs (the discs), and the two safety gates’ YES and NO legs (the four tablets). They always add back up to the cube above them — E = usdc_b + Q_b + G_{b,S} + G_{b,C}, on both sides at once. The scale at the foot is the highest a single unit of each thing can reach in this vault state; nothing climbs above par.',
    unitLegend:
      escrowBase > 0
        ? `Each of the three cubes is the whole escrowed amount — ${formatUsdc(escrowBase, { decimals: 2 })} USDC — not a share of it.`
        : 'Each of the three cubes is the whole split amount, not a share of it. Nothing has been split into this vault yet.',
  };
}

// ---------------------------------------------------------------------------
// Rail helpers
// ---------------------------------------------------------------------------

const L = (at: string, note?: string) => cite('03', at, note);

const usd = (v: number): string => formatUsdc(v, { decimals: 2 });
const usd0 = (v: number): string => formatUsdc(v, { decimals: 0 });
const usd6 = (v: number): string => formatUsdc(v, { decimals: 6 });
const units = (v: number): string => v.toLocaleString('en-US');
const price = (v: number): string => formatPrice(v, 5);
const price2 = (v: number): string => formatPrice(v, 2);

/** A 1,000 USDC probe, so the matrix's payout rules read as amounts. */
const PROBE_BASE = 1_000 * USDC;

/**
 * `MinSplit` is **not** a kernel constant: doc 13 §1 carries it as the
 * governable row `ledger.min_split`, whose genesis default happens to sit on its
 * own kernel floor. Reading the registry row keeps the citation honest — §2
 * would claim the value is frozen, and it is only floored.
 */
const MIN_SPLIT = param('ledger.min_split');

interface InstrumentRow {
  readonly position: ProposalPosition;
  readonly rowId: string;
  readonly key: string;
  readonly branch: Branch;
  readonly kind: PositionKind;
  readonly family: Family;
  readonly name: string;
  readonly heldBase: number;
  readonly payoutBase: number;
  readonly call: LedgerCall | null;
  readonly note: string;
  readonly frozen: boolean;
}

function instrumentRows(sim: SimState): InstrumentRow[] {
  const state = sim.vault.state;
  const winner =
    state.kind === 'Resolved' || state.kind === 'ScalarSettled' ? state.winner : null;

  return proposalPositions(sim.proposal.id)
    .filter((p): p is ProposalPosition => p.scope === 'Proposal')
    .map((position) => {
      const { branch, kind } = position;
      const heldBase = (sim.vault.holdings[holdingKey(branch, kind)] ?? 0) * USDC;
      const frozen = winner !== null && winner !== branch;
      // `redeemPayout` prices the *redeemable* branch. Under `Voided` no branch
      // is losing, so both sides are redeemable; otherwise only the winner is.
      const payoutBase =
        state.kind === 'Voided'
          ? redeemVoidPayout(kind, heldBase)
          : frozen || winner === null
            ? 0
            : // The vault has recorded no `settle_gate` outcome, so a gate leg
              // is `GateNotSettled` and pays nothing — which is the point.
              redeemPayout(state, kind, heldBase, undefined);
      return {
        position,
        rowId: rowId(position),
        key: positionKey(position),
        branch,
        kind,
        family: familyOf(kind),
        name: positionKindLabel(kind),
        heldBase,
        payoutBase,
        call: realisingCall(state, branch, kind),
        note: chipNote(state, branch, kind),
        frozen,
      };
    });
}

/**
 * The sim carries one illustrative participant, so their holdings *are* the
 * vault's supplies. Reconstructing a `Vault` from them lets the conservation
 * panel call the real `checkConservation`, rather than restating its algebra.
 */
function vaultFromSim(sim: SimState): Vault {
  const held = (branch: Branch, kind: PositionKind): number =>
    (sim.vault.holdings[holdingKey(branch, kind)] ?? 0) * USDC;

  const supplyFor = (branch: Branch): BranchSupply => {
    const long = held(branch, { kind: 'Long' });
    const short = held(branch, { kind: 'Short' });
    const gateYes: Record<GateType, number> = { Survival: 0, Security: 0 };
    const gateNo: Record<GateType, number> = { Survival: 0, Security: 0 };
    const gateSets: Record<GateType, number> = { Survival: 0, Security: 0 };
    for (const gate of GATE_TYPES) {
      gateYes[gate] = held(branch, { kind: 'GateYes', gate });
      gateNo[gate] = held(branch, { kind: 'GateNo', gate });
      gateSets[gate] = Math.min(gateYes[gate], gateNo[gate]);
    }
    return {
      usdc: held(branch, { kind: 'BranchUsdc' }),
      scalarSets: Math.min(long, short),
      gateSets,
      long,
      short,
      gateYes,
      gateNo,
    };
  };

  const escrowed = sim.vault.escrowed * USDC;
  return {
    proposal: sim.proposal.id,
    escrowed,
    state: sim.vault.state,
    branches: { Accept: supplyFor('Accept'), Reject: supplyFor('Reject') },
    gateOutcomes: { Survival: null, Security: null },
    collateralIn: escrowed,
    paidOut: 0,
    terminalRedemptions: 0,
  };
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function LedgerEscrowScene({ sim }: { sim: SimState }): JSX.Element {
  const state = sim.vault.state;
  const calls = legalCallsFor(state);
  const rows = instrumentRows(sim);
  const vault = vaultFromSim(sim);
  const escrowBase = sim.vault.escrowed * USDC;

  // The settlement score this scene is entitled to use, and where it came from.
  const vaultS = state.kind === 'ScalarSettled' ? state.s : null;
  const scoreTag: Tagged<number> =
    vaultS !== null
      ? simulated(vaultS, 'the settlement score this scenario’s cohort realised')
      : state.kind === 'Voided'
        ? spec(
            VOID_BASELINE_SCORE,
            cite(
              '03',
              '§5.2',
              'the spec-fixed neutral score the Baseline-settling VOID transitions carry',
            ),
            'a voided vault has no settlement score of its own; the neutral score reads the settled rows this vault can never reach',
          )
        : sim.welfare.settlement !== null
          ? simulated(sim.welfare.settlement, 'the cohort’s realised settlement score')
          : simulated(
              0.5,
              'no settlement score exists yet — 0.5 is a probe for reading the table, not a forecast',
            );
  const probeTag = simulated(PROBE_BASE, 'a 1,000 USDC probe, so each rule reads as an amount');
  const ctx = { s: scoreTag.value, gateWins: true };

  // The B-5 fragmentation case, computed by the real payout functions rather
  // than quoted: leg-by-leg loses a base unit that the pair call does not. The
  // score is the specification's own counterexample; the amount is this scene's,
  // so it is labelled as invented and the payouts inherit that label.
  const B5_S = 0.70005;
  const B5_A = 12_345;
  const b5ScoreTag = spec(B5_S, L('§6.3', 'the finding B-5 counterexample score'));
  const b5AmountTag = simulated(
    B5_A,
    'an amount chosen so neither product lands on a base-unit boundary',
  );
  const b5Inputs = [b5AmountTag, b5ScoreTag];
  const b5Long = scalarPayout(B5_S, 'Long', B5_A);
  const b5Short = scalarPayout(B5_S, 'Short', B5_A);
  const b5Pair = scalarPairPayout(B5_A);

  // The VOID valuation schedule, read out of the payout functions themselves.
  // A cross-branch pair is *two* purchases, so its break-even price per leg is
  // half its recovery; the unpaired rows are one purchase each.
  const voidUnitUsdc = redeemVoidPayout({ kind: 'BranchUsdc' }, USDC) / USDC;
  const voidUnitLeg = redeemVoidPayout({ kind: 'Long' }, USDC) / USDC;
  const voidPairRow = REDEMPTION_MATRIX.find((r) => r.state === 'Voided' && r.call === 'merge');
  const voidPairUnit = voidPairRow === undefined ? 0 : voidPairRow.payout(USDC, ctx) / USDC;
  /** The execution price the net column is read at. Chosen here, not specified. */
  const PBAR = 0.5;
  const pbarTag = simulated(
    PBAR,
    'a realised average execution price this scene picks to read the net column at',
  );

  const conservationApplies = state.kind !== 'BaselineSettled';
  const claimCeiling = conservationApplies ? maxClaimValue(vault) : null;
  const conserved = conservationApplies && checkConservation(vault);

  /**
   * The animated view carries one claim and no table: that `split` mints into
   * both branches in the same instant, and that resolution freezes the losing
   * branch rather than burning it. Everything countable stays in the rail.
   */
  const motion: MotionSpec = {
    kind: 'both-futures',
    props: {
      escrowed: sim.vault.escrowed,
      acceptUnits: sim.vault.holdings['Accept/BranchUsdc'] ?? 0,
      rejectUnits: sim.vault.holdings['Reject/BranchUsdc'] ?? 0,
      resolved:
        state.kind === 'Resolved' || state.kind === 'ScalarSettled' ? state.winner : null,
      voided: state.kind === 'Voided',
      frozen: sim.flags.ledgerFrozen,
    },
  };

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame
          model={buildModel(sim)}
          motion={motion}
          title="The conditional ledger — dual-minting escrow and the redemption matrix"
        />
      </div>

      <div className="col-rail">
        <Lede>
          Pay one dollar of <Jargon word="usdc" label="USDC" /> into a proposal’s vault and you get
          two claims back — not two halves. One of them pays out in full if the proposal is adopted;
          the other pays out in full if it is rejected.{' '}
          <strong>
            Splitting does not halve your money, it doubles the number of futures your money
            can live in
          </strong>{' '}
          — and exactly one of those futures ever becomes real. The vault holding it is an{' '}
          <Jargon word="escrow" />: nothing can be paid out of it that was not paid into it. Those
          dollars are not issued here, which is what <em>The border</em> is about.
        </Lede>

        <KeyFacts>
          <KeyFact label="You pay in" note="one payment, into one vault">
            <Value of={simulated(escrowBase)} format={usd} unit="USDC" />
          </KeyFact>
          <KeyFact label="ACCEPT-USDC" note="pays in full if the proposal is adopted">
            <Value of={simulated(escrowBase)} format={usd} unit="USDC" branch="accept" />
          </KeyFact>
          <KeyFact label="REJECT-USDC" note="pays in full if the proposal is rejected">
            <Value of={simulated(escrowBase)} format={usd} unit="USDC" branch="reject" />
          </KeyFact>
          <KeyFact label="Right now" note="the vault’s state decides what may be claimed">
            <Value of={derived(plainState(state), L('§2.3', 'the vault state machine'))} />
          </KeyFact>
        </KeyFacts>

        {/* ---------------------------------------------------------------- */}
        {/* The one panel left open: it is the diagram's key, and reading the  */}
        {/* diagram is the point of the scene.                                */}
        <section className="panel" aria-labelledby="lx-flow-h">
          <h2 className="panel__title" id="lx-flow-h">
            What each object on the diagram is
          </h2>

          <p>
            One payment enters escrow and two full-size claims leave it. That is the
            protocol’s founding trick: because every mint is dual, both branches gain the
            same amount at the same instant, so neither can be drained ahead of the other
            and no cross-branch counter can underflow. At most one of the two worlds is ever
            paid in full — and if the question dies unanswered, VOID values both at exactly
            half rather than paying either — which is why the escrow is never
            over-committed even though it minted twice.
          </p>

          <table>
            <caption className="sr-only">
              What each object on the stage is, and how much of it exists
            </caption>
            <thead>
              <tr>
                <th scope="col">Object</th>
                <th scope="col">What it is</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <tr id="lx-flow-in">
                <td>Your deposit</td>
                <td>
                  <span className="mono">split(pid, a)</span> — escrow receives{' '}
                  <span className="mono">a</span>
                </td>
                <td className="numeric">
                  <Value of={simulated(escrowBase)} format={usd} unit="USDC" />
                </td>
              </tr>
              <tr id="lx-flow-mint-Accept">
                <td>Arrow → ACCEPT</td>
                <td>a full unit of ACCEPT-USDC, not a half share</td>
                <td className="numeric">
                  <Value of={simulated(escrowBase)} format={usd} unit="USDC" branch="accept" />
                </td>
              </tr>
              <tr id="lx-flow-mint-Reject">
                <td>Arrow → REJECT</td>
                <td>a full unit of REJECT-USDC, minted in the same call</td>
                <td className="numeric">
                  <Value of={simulated(escrowBase)} format={usd} unit="USDC" branch="reject" />
                </td>
              </tr>
              <tr id="lx-flow-world-Accept">
                <td>ACCEPT-USDC cube</td>
                <td>
                  outstanding <span className="mono">usdc_Accept</span> — the cube, full size
                </td>
                <td className="numeric">
                  <Value
                    of={simulated(vault.branches.Accept.usdc)}
                    format={usd}
                    unit="USDC"
                    branch="accept"
                  />
                </td>
              </tr>
              <tr id="lx-flow-world-Reject">
                <td>REJECT-USDC cube</td>
                <td>
                  outstanding <span className="mono">usdc_Reject</span> — the cube, full size
                </td>
                <td className="numeric">
                  <Value
                    of={simulated(vault.branches.Reject.usdc)}
                    format={usd}
                    unit="USDC"
                    branch="reject"
                  />
                </td>
              </tr>
              <tr id="lx-flow-tie">
                <td>The tie bar</td>
                <td>
                  {calls.includes('merge')
                    ? 'merge is legal here: a cross-branch pair burns back to par'
                    : 'merge is not offered in this state, so the stage carries no tie'}
                </td>
                <td className="numeric">
                  {calls.includes('merge') ? (
                    <Value of={simulated(escrowBase)} format={usd} unit="USDC" />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <p className="panel__note">
            The seven small shapes under each cube are the forms that side’s claim can be
            held in — cash, the two welfare legs, and the two safety gates’ YES and NO legs.
            Only the first three are named on the diagram: seven names under each world
            collide at every width, and the fourteen full names are one drawer down.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        <Depth title="What every instrument is called" hint="14 + 2">
          <section className="panel" aria-labelledby="lx-inst-h">
            <h2 className="panel__title" id="lx-inst-h">
              The fourteen instruments
            </h2>

            <p>
              A proposal vault carries{' '}
              <Value
                of={derived(proposalPositions(sim.proposal.id).length, L('§2.1'))}
                format={units}
              />{' '}
              instruments: two branches times seven kinds. Seven, not one, because each
              branch carries a decision-scalar pair and two gate pairs on top of its
              branch-USDC — and the gate instruments exist for every vault even when the
              proposal’s class never trades them. Shape separates the three families on the
              stage before colour does anything.
            </p>

            <ul className="lx-legend">
              <li>
                <span className="lx-glyph lx-glyph--bar" aria-hidden="true" />
                <span>
                  <strong>Bar</strong> — branch-USDC: money inside one world.
                </span>
              </li>
              <li>
                <span className="lx-glyph lx-glyph--round" aria-hidden="true" />
                <span>
                  <strong>Disc</strong> — a scalar leg, LONG or SHORT on realised welfare.
                </span>
              </li>
              <li>
                <span className="lx-glyph lx-glyph--tablet" aria-hidden="true" />
                <span>
                  <strong>Tablet</strong> — one of the four gate legs, YES or NO on a breach.
                </span>
              </li>
            </ul>

            <div className="lx-scroll">
              <table>
                <caption className="sr-only">
                  Every instrument in this vault, what is held of it, and what it would pay
                  right now
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Instrument</th>
                    <th scope="col">Family</th>
                    <th scope="col" className="numeric">
                      Held
                    </th>
                    <th scope="col">Call, unpaired</th>
                    <th scope="col" className="numeric">
                      Pays now
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowId} id={r.rowId} className={r.frozen ? 'lx-frozen' : undefined}>
                      <td>
                        {r.branch} {r.name}
                        <span className="mono lx-key">{r.key}</span>
                      </td>
                      <td>{r.family}</td>
                      <td className="numeric">
                        <Value
                          of={simulated(r.heldBase)}
                          format={usd}
                          branch={r.branch === 'Accept' ? 'accept' : 'reject'}
                        />
                      </td>
                      <td>
                        {r.call === null ? (
                          <span className="mono">—</span>
                        ) : (
                          <span className="mono">{r.call}</span>
                        )}
                        <span className="lx-key">{r.note}</span>
                      </td>
                      <td className="numeric">
                        <Value
                          of={combine([simulated(r.heldBase)], r.payoutBase, L('§5.3'))}
                          format={usd}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="panel__note">
              This table prices each instrument <em>on its own</em>. Complete sets are a
              different question and always a better one — a cross-branch branch-USDC pair, a
              same-branch LONG + SHORT set, a same-branch gate set — and the redemption
              matrix carries them. The gate legs pay nothing here for a reason worth naming:
              this vault has no recorded <span className="mono">settle_gate</span> outcome, so{' '}
              <span className="mono">redeem_gate</span> does not pay zero — it fails{' '}
              <span className="mono">GateNotSettled</span>, on either side, and there is
              nothing to pay until the outcome is recorded. The daily breach flag the
              execution guard reads is a different object from the vault’s settled gate
              outcome, and conflating them would pay the wrong side.
            </p>
          </section>

          <section className="panel" aria-labelledby="lx-base-h">
            <h2 className="panel__title" id="lx-base-h">
              And the other two: the Baseline vault
            </h2>

            <p>
              The epoch’s Baseline vault carries{' '}
              <Value
                of={derived(baselinePositions(sim.epoch).length, L('§2.1', 'B-3'))}
                format={units}
              />{' '}
              instruments, which is where the &ldquo;fourteen plus two&rdquo; comes from. It
              is unconditional — collateralized in USDC directly, with no branch layer and
              therefore no branch-USDC and no gates — and it is a <em>separate</em> escrow
              with its own state machine. That is why it is not drawn on the stage: putting
              it inside a conservation diagram for E would imply it shares a pool it does not
              share.
            </p>

            <table>
              <caption className="sr-only">
                The two Baseline instruments and their settlement rules
              </caption>
              <thead>
                <tr>
                  <th scope="col">Position</th>
                  <th scope="col">Rule</th>
                  <th scope="col" className="numeric">
                    On <Value of={probeTag} format={usd0} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {baselinePositions(sim.epoch)
                  .filter((p): p is Extract<PositionId, { scope: 'Baseline' }> => p.scope === 'Baseline')
                  .map((p) => (
                    <tr key={positionKey(p)} id={`lx-${positionKey(p).replace(/[/:]/g, '-')}`}>
                      <td>
                        B-{p.side.toUpperCase()}
                        <span className="mono lx-key">{positionKey(p)}</span>
                      </td>
                      <td>{p.side === 'Long' ? 'floor(a·s_e)' : 'floor(a·(1−s_e))'}</td>
                      <td className="numeric">
                        <Value
                          of={combine(
                            [probeTag, scoreTag],
                            baselinePayout(scoreTag.value, p.side, PROBE_BASE),
                            L('§5.3'),
                          )}
                          format={usd}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            <p className="panel__note">
              The arithmetic is identical to the proposal scalar legs, but the collateral is
              not, and neither is the score: the column above is read at this scene’s working
              s so the two rules can be compared, while a Baseline settles at its own epoch
              score s_e. Reading a proposal’s settlement score against the epoch’s escrow is
              exactly the confusion the separate export exists to prevent. Where no measured
              s_e exists the vault settles neutrally at{' '}
              <Value
                of={spec(
                  VOID_BASELINE_SCORE,
                  cite('03', '§5.2', 'the spec-fixed neutral Baseline score'),
                )}
                format={price}
              />{' '}
              — by exactly two transitions, the cohort VOID and the orphan-epoch finalizer.
              Voiding a single proposal is not one of them and settles no Baseline at all:
              the Baseline vault is keyed per epoch, and one voided proposal can leave its
              siblings live.
            </p>
          </section>
        </Depth>

        {/* ---------------------------------------------------------------- */}
        <Depth
          title="What the vault will let you do right now"
          hint={`${calls.length} of ${LEDGER_CALLS.length}`}
        >
          <section className="panel" aria-labelledby="lx-state-h">
            <h2 className="panel__title" id="lx-state-h">
              Vault state, and the calls it admits
            </h2>

            <div className="statgrid">
              <div className="stat">
                <span className="stat__label">Vault</span>
                <span className="stat__value">
                  <span className="chip chip--state">{stateLabel(state)}</span>
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Escrowed E</span>
                <span className="stat__value">
                  <Value of={simulated(escrowBase)} format={usd} unit="USDC" />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Signed calls offered</span>
                <span className="stat__value">
                  <Value
                    of={derived(calls.length, L('§5.1', 'the per-state legal call surface'))}
                    format={units}
                  />
                  {' of '}
                  <Value
                    of={spec(
                      LEDGER_CALLS.length,
                      L('§5.1', 'the §5.1 minting/transfer plus §5.3 redemption call surface'),
                    )}
                    format={units}
                  />
                </span>
              </div>
            </div>

            <p>
              A vault state is not a mood; it is a permission set. The list below is every
              value-moving call a Signed origin may make against this vault right now, and a
              client that offers anything else is offering a call the chain will reject. The
              authority transitions — <span className="mono">resolve</span>,{' '}
              <span className="mono">void</span>, <span className="mono">settle_scalar</span>,{' '}
              <span className="mono">settle_gate</span> — are deliberately absent from every
              row: no user can invoke them, so no interface may present them. The §5.4 keeper
              housekeeping (<span className="mono">sweep_dust</span>,{' '}
              <span className="mono">reconcile</span>) is Signed as well, but it claims
              nothing and moves no holder’s position, so it is not a row here either.
            </p>

            <ol className="lx-calls">
              {calls.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ol>

            <p className="panel__note">
              Under <span className="mono">Voided</span> this list is exactly five calls —{' '}
              <Value
                of={derived(
                  legalCallsFor({ kind: 'Voided' }).length,
                  cite('15', 'I-27', 'the voided-vault call surface'),
                )}
                format={units}
              />{' '}
              of them. Beyond those five, I-27 admits only the §5.4 housekeeping sweep, and
              only once <span className="mono">RedemptionArchiveDelay</span> has elapsed;
              anything else in a voided vault is a defect, not a feature. Note also that{' '}
              <span className="mono">transfer</span> survives VOID
              (counterparties must be able to assemble the cross-branch pairs that recover
              par) but not <span className="mono">ScalarSettled</span>, where the redemption
              calls subsume it.
            </p>

            <p className="panel__note">
              The minimum split is{' '}
              <Value
                of={spec(MIN_SPLIT.raw, MIN_SPLIT.cite, 'ledger.min_split, in USDC base units')}
                format={usd6}
                unit="USDC"
              />{' '}
              — below it the call fails <span className="mono">BelowMinimum</span> rather
              than creating a dust position, because every <span className="mono">Positions</span>{' '}
              row costs a deposit and one of a finite number of per-account slots. It is the
              genesis default of the governable key{' '}
              <span className="mono">{MIN_SPLIT.key}</span>, not a frozen constant: the floor
              it sits on is a kernel floor, so governance may raise this minimum but never
              lower it.
            </p>

            {sim.decision === null ? (
              <p className="panel__note">
                The chain returns nothing from <span className="mono">decision_stats()</span>{' '}
                until the decision windows seal, so this scene shows no projected winner and
                no projected uplift. What it shows is what the vault’s current state already
                permits.
              </p>
            ) : null}
          </section>
        </Depth>

        {/* ---------------------------------------------------------------- */}
        <Depth title="What happens if a proposal is voided" hint="½ and ¼">
          <section className="panel" aria-labelledby="lx-void-h">
            <h2 className="panel__title" id="lx-void-h">
              What VOID actually pays
            </h2>

            <p>
              A voided vault does not refund anybody. It values a question that will never be
              answered, and it values it neutrally. A cross-branch pair of branch-USDC merges
              at par, and that is the <em>only</em> hundred-percent path out: an unpaired
              branch-USDC recovers a half, and any unpaired leg — LONG, SHORT, gate YES, gate
              NO — recovers a quarter, both floored against the claimant.
            </p>

            <p>
              Two calls that look like recoveries pay no USDC at all.{' '}
              <span className="mono">merge_scalar</span> and{' '}
              <span className="mono">merge_gate</span> consolidate a same-branch set back into
              one same-branch branch-USDC: two legs worth a quarter each become one unit worth
              a half. That is value-neutral, not a withdrawal — under the VOID schedule no
              call can raise what a holding is worth, and the unit stays at a half until it is
              paired with its opposite-branch counterpart. Assembling that cross-branch pair
              is the only route to par, and it is why <span className="mono">transfer</span>{' '}
              remains legal under VOID: without it a counterparty could not acquire the side
              it is missing.
            </p>

            <table>
              <caption className="sr-only">
                The VOID valuation schedule, per unit of face value, with the average
                execution price at which a buyer breaks even
              </caption>
              <thead>
                <tr>
                  <th scope="col">Position</th>
                  <th scope="col" className="numeric">
                    Legs bought
                  </th>
                  <th scope="col" className="numeric">
                    Recovers
                  </th>
                  <th scope="col" className="numeric">
                    Break-even p̄
                  </th>
                  <th scope="col" className="numeric">
                    Net at p̄ = <Value of={pbarTag} format={price2} />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr id="lx-void-pair">
                  <td>Accept + Reject branch-USDC pair</td>
                  <td className="numeric">
                    <Value of={spec(2, L('§5.1', 'a pair is one unit from each branch'))} format={units} />
                  </td>
                  <td className="numeric">
                    <Value of={derived(voidPairUnit, L('§6.4', 'B-1'))} format={price} />
                  </td>
                  <td className="numeric">
                    <Value of={derived(voidPairUnit / 2, L('§6.4'))} format={price} />
                  </td>
                  <td className="numeric">
                    <Value
                      of={combine([pbarTag], voidPairUnit - 2 * PBAR, L('§6.4'))}
                      format={price}
                    />
                  </td>
                </tr>
                <tr id="lx-void-usdc">
                  <td>Unpaired branch-USDC</td>
                  <td className="numeric">
                    <Value of={spec(1, L('§5.3'))} format={units} />
                  </td>
                  <td className="numeric">
                    <Value of={derived(voidUnitUsdc, L('§5.3', 'D-1'))} format={price} />
                  </td>
                  <td className="numeric">
                    <Value of={derived(voidUnitUsdc, L('§5.3'))} format={price} />
                  </td>
                  <td className="numeric">
                    <Value
                      of={combine([pbarTag], voidUnitUsdc - PBAR, L('§5.3'))}
                      format={price}
                    />
                  </td>
                </tr>
                <tr id="lx-void-leg">
                  <td>Unpaired LONG / SHORT / gate leg</td>
                  <td className="numeric">
                    <Value of={spec(1, L('§5.3'))} format={units} />
                  </td>
                  <td className="numeric">
                    <Value of={derived(voidUnitLeg, L('§5.3', 'D-1'))} format={price} />
                  </td>
                  <td className="numeric">
                    <Value of={derived(voidUnitLeg, L('§5.3'))} format={price} />
                  </td>
                  <td className="numeric">
                    <Value
                      of={combine([pbarTag], voidUnitLeg - PBAR, L('§5.3'))}
                      format={price}
                    />
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="panel__note">
              VOID never refunds a premium. A buyer’s net is (neutral recovery − cost −
              fees), so for branch-USDC bought at a realised average execution price p̄ the
              net is a·(½ − p̄) − fees: it reaches exactly −fees only when p̄ was exactly{' '}
              <Value of={pbarTag} format={price2} />, and it is worse for every price above
              that. The pair breaks even at the same price, because it recovers twice as much
              and costs twice as much. The same algebra runs against a quarter for an
              unpaired leg, which is why a leg bought at that price nets{' '}
              <Value of={combine([pbarTag], voidUnitLeg - PBAR, L('§5.3'))} format={price} />{' '}
              per unit of face before a single fee is counted.
            </p>
          </section>
        </Depth>

        {/* ---------------------------------------------------------------- */}
        <Depth title="Every payout, state by state" hint={`${REDEMPTION_MATRIX.length} rows`}>
          <section className="panel" aria-labelledby="lx-matrix-h">
            <h2 className="panel__title" id="lx-matrix-h">
              The redemption matrix
            </h2>

            <p>
              Vault state times holding times call, as data rather than prose — the same table
              the payout functions are tested against. The rows with no call are the
              load-bearing ones: they record where the protocol deliberately pays nothing,
              which is precisely where a reader assumes it must pay something. Rows for{' '}
              <span className="chip chip--state">{stateLabel(state)}</span> are marked.
            </p>

            <div className="lx-scroll">
              <table>
                <caption className="sr-only">
                  Redemption by vault state, holding and call, with the payout on a 1,000 USDC
                  probe
                </caption>
                <thead>
                  <tr>
                    <th scope="col">State</th>
                    <th scope="col">Holding</th>
                    <th scope="col">Call</th>
                    <th scope="col">Payout rule</th>
                    <th scope="col" className="numeric">
                      On <Value of={probeTag} format={usd0} />
                    </th>
                    <th scope="col">Spec</th>
                  </tr>
                </thead>
                <tbody>
                  {REDEMPTION_MATRIX.map((row, i) => (
                    <tr
                      key={`${row.state}-${i}`}
                      id={`lx-matrix-${row.state}-${i}`}
                      className={row.state === state.kind ? 'lx-row--current' : undefined}
                    >
                      <td>{row.state}</td>
                      <td>{row.holding}</td>
                      <td>
                        {row.call === null ? (
                          <span className="mono">— none</span>
                        ) : (
                          <span className="mono">{row.call}</span>
                        )}
                      </td>
                      <td>{row.rule}</td>
                      <td className="numeric">
                        <Value
                          of={combine([probeTag, scoreTag], row.payout(PROBE_BASE, ctx), row.cite)}
                          format={usd}
                        />
                      </td>
                      <td>
                        <span className="cite">
                          {row.cite.doc} {row.cite.at}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="panel__note">
              The probe is{' '}
              <Value of={probeTag} format={usd} unit="USDC" /> of a single holding, priced at
              s = <Value of={scoreTag} format={price} />, and the one gate row is shown for a
              holder whose side matched the recorded breach outcome — the other side of that
              same row pays zero. Note the two{' '}
              <span className="mono">Resolved</span> rows that carry no call at all: unpaired
              redemption is barred there on purpose, because VOID is still reachable from{' '}
              <span className="mono">Resolved</span>, and paying par before that fork would
              leave the losing branch’s undiminished claim mass pointed at a reduced escrow.
            </p>
          </section>
        </Depth>

        {/* ---------------------------------------------------------------- */}
        <Depth title="The conservation rule that keeps it solvent" hint="L-1 · L-3 · B-5">
          <section className="panel" aria-labelledby="lx-cons-h">
            <h2 className="panel__title" id="lx-cons-h">
              Conservation, per branch and at once
            </h2>

            <p className="lx-eq">E = usdc_b + Q_b + G_&#123;b,S&#125; + G_&#123;b,C&#125;   for EACH branch b</p>

            <p>
              Every intra-branch operation moves value sideways inside one branch and leaves
              that branch’s total untouched: <span className="mono">split_scalar</span> takes
              a unit out of <span className="mono">usdc_b</span> and puts it into{' '}
              <span className="mono">Q_b</span>, and the gate split does the same into{' '}
              <span className="mono">G</span>. Before a terminal state the only calls that
              move escrow at all are <span className="mono">split</span> and{' '}
              <span className="mono">merge</span>, and each moves both branches by the same
              amount in the same call; after one, the redemption calls are the only other way
              USDC leaves. This scenario has a single participant, so their
              holdings are the vault’s supplies and the identity can simply be added up.
            </p>

            <table>
              <caption className="sr-only">
                The per-branch conservation identity against escrow
              </caption>
              <thead>
                <tr>
                  <th scope="col">Branch</th>
                  <th scope="col" className="numeric">
                    usdc_b
                  </th>
                  <th scope="col" className="numeric">
                    Q_b
                  </th>
                  <th scope="col" className="numeric">
                    G_b,S
                  </th>
                  <th scope="col" className="numeric">
                    G_b,C
                  </th>
                  <th scope="col" className="numeric">
                    Sum
                  </th>
                </tr>
              </thead>
              <tbody>
                {BRANCHES.map((branch) => {
                  const b = vault.branches[branch];
                  return (
                    <tr key={branch} id={`lx-cons-${branch}`}>
                      <td>{branch}</td>
                      <td className="numeric">
                        <Value of={simulated(b.usdc)} format={usd} />
                      </td>
                      <td className="numeric">
                        <Value of={simulated(b.scalarSets)} format={usd} />
                      </td>
                      <td className="numeric">
                        <Value of={simulated(b.gateSets.Survival)} format={usd} />
                      </td>
                      <td className="numeric">
                        <Value of={simulated(b.gateSets.Security)} format={usd} />
                      </td>
                      <td className="numeric">
                        <Value
                          of={combine([simulated(b.usdc)], branchIdentity(b), L('§6.1', 'L-1'))}
                          format={usd}
                        />
                      </td>
                    </tr>
                  );
                })}
                <tr id="lx-cons-escrow">
                  <td>Escrow E</td>
                  <td className="numeric" colSpan={4}>
                    the one pool both sides are claims against
                  </td>
                  <td className="numeric">
                    <Value of={simulated(escrowBase)} format={usd} />
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="statgrid">
              <div className="stat">
                <span className="stat__label">Largest total still claimable</span>
                <span className="stat__value">
                  {claimCeiling !== null ? (
                    <Value
                      of={combine([simulated(escrowBase)], claimCeiling, L('§6.5', 'L-3'))}
                      format={usd}
                      unit="USDC"
                    />
                  ) : (
                    <Value
                      of={derived(
                        'no bound — a proposal vault never holds this state',
                        L('§2.3'),
                      )}
                    />
                  )}
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">try-state (L-1, L-3, L-4)</span>
                <span className="stat__value">
                  <Value
                    of={combine(
                      [simulated(escrowBase)],
                      conserved ? 'holds' : 'not asserted',
                      L('§9'),
                    )}
                  />
                </span>
              </div>
            </div>

            <p className="panel__note">
              The half-and-quarter schedule is not a haircut chosen for comfort; it is the
              only schedule that makes VOID provably solvent. The total claim is
              Σ_b [½·usdc_b + ¼·2Q_b + ¼·2G_&#123;b,S&#125; + ¼·2G_&#123;b,C&#125;],
              which factors to ½ · Σ_b (usdc_b + Q_b + G_&#123;b,S&#125; + G_&#123;b,C&#125;)
              = ½ · (E + E) = E. The superseded rule — both branches redeem one-for-one —
              valued the same claims at 2E, and the first redeemers simply drained the vault.
            </p>
          </section>

          <section className="panel" aria-labelledby="lx-b5-h">
            <h2 className="panel__title" id="lx-b5-h">
              Why the pair call exists
            </h2>

            <p>
              Rounding is always against the claimant, and that is a solvency property rather
              than a detail — it is what keeps the total payout from ever exceeding escrow,
              however finely holdings are fragmented across accounts. But flooring twice would
              then cost a complete-set holder a base unit for no reason, so the ledger offers
              an atomic pair call that pays exactly the principal.
            </p>

            <table>
              <caption className="sr-only">
                Leg-by-leg redemption against the atomic pair call, at the specification’s own
                counterexample score
              </caption>
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">Rule</th>
                  <th scope="col" className="numeric">
                    Base units
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr id="lx-b5-long">
                  <td>
                    <span className="mono">redeem_scalar</span> (LONG)
                  </td>
                  <td>floor(a·s)</td>
                  <td className="numeric">
                    <Value of={combine(b5Inputs, b5Long, L('§6.3', 'B-5'))} format={units} />
                  </td>
                </tr>
                <tr id="lx-b5-short">
                  <td>
                    <span className="mono">redeem_scalar</span> (SHORT)
                  </td>
                  <td>floor(a·(1−s)) — not a − floor(a·s)</td>
                  <td className="numeric">
                    <Value of={combine(b5Inputs, b5Short, L('§6.3', 'B-5'))} format={units} />
                  </td>
                </tr>
                <tr id="lx-b5-legs">
                  <td>Leg by leg, together</td>
                  <td>two floors</td>
                  <td className="numeric">
                    <Value of={combine(b5Inputs, b5Long + b5Short, L('§6.3'))} format={units} />
                  </td>
                </tr>
                <tr id="lx-b5-pair">
                  <td>
                    <span className="mono">redeem_scalar_pair</span>
                  </td>
                  <td>exactly a — one atomic burn, no double flooring</td>
                  <td className="numeric">
                    <Value of={combine(b5Inputs, b5Pair, L('§5.3'))} format={units} />
                  </td>
                </tr>
              </tbody>
            </table>

            <p className="panel__note">
              Computed on a = <Value of={b5AmountTag} format={units} /> base units at s ={' '}
              <Value of={b5ScoreTag} format={price} />. The amount is this scene’s; the score
              is the specification’s own counterexample. The gap is{' '}
              <Value
                of={combine(b5Inputs, b5Pair - (b5Long + b5Short), L('§6.3'))}
                format={units}
              />{' '}
              base unit — small, and exactly the size of the hole that the superseded SHORT
              rule opened in the other direction, where fragmented holdings drew more from
              escrow than escrow held.
            </p>
          </section>
        </Depth>
      </div>
    </div>
  );
}
