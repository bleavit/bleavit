import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { NodeState, SceneModel, SceneNode, SceneRule, Tone } from '../model';
import type { OracleSim, RegistrySim, SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import type { FilingState, SettlePath } from '../../protocol/types';
import { SETTLE_PATHS } from '../../protocol/types';
import {
  BLOCKS_PER_DAY,
  EPOCH_PHASE_DENOMINATOR,
  KERNEL_CITATION,
  ORC_MAX_PROOF_BYTES,
  ORC_REPORTERS_MIN,
  ORC_REPORT_WINDOW_BLOCKS,
  ORC_ROUNDS_MAX,
  ORC_ROUNDS_MIN,
  ORC_RETENTION_BLOCKS,
  ORC_WINDOW_BLOCKS,
  PHASE_OFFSET_NUMERATORS,
  WATCHTOWER_EXTENSION_BLOCKS,
  WT_MAX,
  WT_QUORUM,
} from '../../protocol/constants';
import { formatBlocks, formatDurationHuman } from '../../protocol/epoch';
import type { ParamRow } from '../../protocol/params';
import { param, value } from '../../protocol/params';
import type { Tagged } from '../../provenance/types';
import { derived, simulated, spec } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './oracle-disputes.css';
import { Formula } from '../../ui/Formula';

/**
 * Oracle rounds, watchtowers, and the registry sub-game.
 *
 * Facts the chain cannot see for itself — a welfare component, an incident, a
 * delivered milestone — do not arrive through a trusted feed. They arrive
 * *bonded*, and anyone but their own reporter may pay to contradict them. The
 * escalation ladder doubles
 * the bond each round, so being repeatedly wrong is ruinous and being repeatedly
 * right is profitable.
 *
 * The drawing has two things to teach and it says them in two dimensions.
 * **Across**: doc 07 §11's latency budget on one time scale, anchored at the
 * close of the measurement epoch, with the wall at `OracleSettleDeadline` — a
 * position the *epoch schedule* fixes, not the sum of the windows behind it — so
 * the one +48-hour watchtower extension does not push the wall out; it spends the
 * margin in front of it, and pushes the terminal verdict past it. A component not
 * challenge-closed by that wall settles neutral (§10: last valid value, epoch
 * flagged) and the late verdict resolves only the bond stacks (§5.5, I-18). That
 * is what stops a determined party from holding a fact hostage for ever, and it
 * is a schedule rather than a discretion. **Up**: the bond, doubling from round
 * to round, so the escalation ladder is a shape before it is a number.
 *
 * The rail is ordered by what a first-time reader needs: the plain sentence, four
 * numbers, the round now open — and then closed drawers for the ladder table, the
 * five endings, the roles, the registry contrast and the governed rows. Nothing
 * is dropped; the density is one click away.
 *
 * The third thing, and the one only the rail can carry, is a distinction: an
 * oracle dispute can hold a *decision*; a registry dispute holds only
 * *settlement*.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const REPORT_CITE: Citation = cite('07', '§5', 'the report window — two days after the measurement epoch closes');
const WINDOW_CITE: Citation = cite('07', '§5', 'the 72-hour challenge window, one per round');
const EXT_CITE: Citation = cite('07', '§4', 'the single +48 h extension per (component, epoch) when quorum is missing');
const ROUNDS_CITE: Citation = cite('07', '§6.1', 'the escalation ladder — each round doubles the bond');
const TERMINAL_CITE: Citation = cite('07', '§5', 'step 4 — terminal adjudication on the OracleResolution track');
const RETENTION_CITE: Citation = cite('07', '§11', 'the retention window: 7 d decision + 1 d confirm');
const DEADLINE_CITE: Citation = cite('07', '§11', 'OracleSettleDeadline — start of the next epoch’s Housekeeping');
const SETTLE_CITE: Citation = cite('07', '§5.5', 'settlement paths and the 40/60 bond disposition');
const COVERAGE_CITE: Citation = cite('07', '§6.3', 'the ladder coverage rate (2^R_max − 1) · orc.bond_bps');
const REPORTER_CITE: Citation = cite('07', '§3', 'reporter registration, stake and the slashing ladder');
const WT_CITE: Citation = cite('07', '§4', 'watchtower seats, stake and the acknowledgement quorum');
const REGISTRY_CITE: Citation = cite('07', '§7', 'incident and milestone filings');
const HOLD_CITE: Citation = cite('07', '§12', 'merit-bonded disputes and the process hold');
const STEP2_CITE: Citation = cite('05', '§5.4', 'step 2 of the ordered decision rule — open holds');
const EVIDENCE_CITE: Citation = cite('07', '§9', 'evidence, retrievability and recompute_proof');
const CPILLAR_CITE: Citation = cite('05', '§4.4', 'the incident multiplier: pure, carrying no ε floor');

/**
 * The reporter slashing ladder and the challenger's share of a successful
 * slash. These are specification constants that have no doc 13 §1 row — they
 * are not governable — so they are named and cited here rather than written as
 * literals at the point of use.
 */
const REPORTER_SLASH_PCT = 50;
const REPORTER_STRIKES_TO_EJECT = 3;
const CHALLENGER_SHARE_PCT = 40;
const INSURANCE_SHARE_PCT = 100 - CHALLENGER_SHARE_PCT;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Deterministic grouping. `toLocaleString` is locale-dependent; this is not. */
function group(n: number): string {
  const t = Math.trunc(n);
  const s = Math.abs(t)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return t < 0 ? `-${s}` : s;
}

const usd = (v: number): string => group(v);
const f3 = (v: number): string => v.toFixed(3);
const f2 = (v: number): string => v.toFixed(2);
const asBlocks = (v: number): string => formatBlocks(v);
const asHuman = (v: number): string => formatDurationHuman(v);
const asKib = (v: number): string => `${group(v / 1024)} KiB`;

/**
 * Canvas labels only: `10k`, `70k`, `d20`. The rail carries the exact figure.
 *
 * The day labels are doc 07 §11's own vocabulary — that table counts days from
 * the close of the measurement epoch, and so does this axis.
 */
function compact(v: number): string {
  return v >= 1000 ? `${group(Math.round(v / 1000))}k` : group(Math.round(v));
}

function dayLabel(blocks: number): string {
  return `d${Math.round(blocks / BLOCKS_PER_DAY)}`;
}

// ---------------------------------------------------------------------------
// The ladder, shared by the drawing and the table
// ---------------------------------------------------------------------------

export interface LadderRow {
  readonly round: number;
  /** This round's bond, per side. */
  readonly bond: number;
  /** Everything that side has posted by the end of this round. */
  readonly cumulative: number;
  /** The round has been opened. */
  readonly reached: boolean;
  /** The round is the one currently running. */
  readonly live: boolean;
}

/**
 * The round-one bond, and whether it came from the live game.
 *
 * When a dispute is open the sim carries the *current* round's bond, and the
 * ladder is a pure doubling, so round one is recoverable exactly. With nothing
 * open there is no game to read, and the ladder is drawn at the doc 13 floor
 * instead — the shape the game *would* take, which is a spec fact rather than an
 * observation, and is labelled as one.
 */
function roundOneBond(o: OracleSim): { readonly b1: number; readonly fromSim: boolean } {
  if (o.round >= 1 && o.bond > 0) {
    return { b1: o.bond / 2 ** (o.round - 1), fromSim: true };
  }
  return { b1: value('orc.bond_floor'), fromSim: false };
}

/** Rounds the ladder can run to: the governed value, never below what is live. */
function ladderRounds(o: OracleSim): number {
  return Math.max(value('orc.rounds'), o.round, ORC_ROUNDS_MIN);
}

/**
 * The challenge window the *oracle* game runs on.
 *
 * It is the live `orc.window` row, not the kernel constant: doc 07 §7 is
 * explicit that the reporting game tracks a META raise (to ≤ 120 h) while both
 * registry instances stay pinned at the frozen 72-hour floor. The two coincide
 * at genesis and the scene must not let that coincidence read as identity.
 */
function challengeWindowBlocks(): number {
  return value('orc.window');
}

/**
 * `OracleSettleDeadline(m)` — the money deadline of doc 07 §11(1).
 *
 * It is the start of epoch `m+1`'s Housekeeping, so it comes out of the **epoch
 * schedule** (doc 13 §3.1's phase fractions over `epoch.length`) and not out of
 * the dispute. That is precisely why nothing inside the game can move it: no
 * conduct by either party is an input to this arithmetic.
 */
function moneyDeadlineBlocks(): number {
  return (
    (value('epoch.length') * PHASE_OFFSET_NUMERATORS.Housekeeping) / EPOCH_PHASE_DENOMINATOR
  );
}

function ladderRows(o: OracleSim, rounds: number, b1: number): LadderRow[] {
  const rows: LadderRow[] = [];
  for (let r = 1; r <= rounds; r++) {
    rows.push({
      round: r,
      bond: b1 * 2 ** (r - 1),
      cumulative: b1 * (2 ** r - 1),
      reached: o.round >= r,
      live: o.round === r && o.settledPath === null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Stage geometry (x in [0,21], y in [0,12], origin bottom-left)
// ---------------------------------------------------------------------------

/** Where the time axis starts, and how much stage the whole schedule may fill. */
const X0 = 1.25;
const SPAN = 17.0;

/**
 * Two tiers, and the split is the drawing's grammar rather than decoration.
 *
 * The thin lower strip is every stretch where **nothing is bonded** — the two
 * days to report, the one watchtower extension, the terminal values track. Each
 * challenge round is a raised platform filling the gap in that strip, carrying
 * the two bond columns that stand on it.
 *
 * Two tiers is also what buys every bay a label row of its own. A label is drawn
 * centred under its node, so bays sharing a baseline share a line of type: at the
 * four-round ladder the report bay's centre is only 1.77 units from round one's,
 * and `Report` + `Round 1` need 1.86. Dropping the quiet bays a tier removes the
 * constraint entirely instead of shortening honest words to fit.
 */
const AXIS_Y = 1.0;
const QUIET_Y = 2.05;
const BAY_Y = 3.2;
const FLOOR_H = 0.24;

/** The bond columns stand on the platform itself; heights read against the rule. */
const BASE_Y = BAY_Y + FLOOR_H;

/** The tallest a bond column may grow: the acknowledgement chips sit above it. */
const STACK_CEIL_Y = 8.6;

const WT_Y = 9.3;
const WT_SIZE = 0.56;
const MARK_Y = 10.55;

const WALL_BOTTOM = 1.6;
const WALL_TOP = 11.2;

const BOND_RULE_X = 0.85;

/** The bond pair: two equal columns, because both sides post the same amount. */
const ROUND_W = 0.6;
const ROUND_GAP = 0.1;

type AckKind = 'live' | 'unknown' | 'future';

/**
 * What the chain can tell us about a round's watchtower acknowledgements.
 *
 * The chain records acknowledgements per round; this simulation carries one
 * count, for the live round only. Rounds already escalated past are therefore
 * drawn as **unknown** rather than as unacknowledged — an absent record and a
 * negative record are different facts, and collapsing them would be a lie in the
 * safer-looking direction. One chip per round rather than one per seat, because
 * one count is genuinely all there is: drawing sixteen seats would invent a
 * per-seat record the state does not hold.
 */
function ackKind(o: OracleSim, round: number): AckKind {
  if (o.round === 0 || round > o.round) return 'future';
  if (round < o.round) return 'unknown';
  return 'live';
}

const ACK_STATE: Readonly<Record<AckKind, NodeState>> = {
  live: 'active',
  unknown: 'inactive',
  future: 'inactive',
};

/**
 * Canvas labels for the settlement marker.
 *
 * They are the `SettlePath` names, because the marker's whole job is to point at
 * the row of the same name in the rail's endings drawer — a renamed marker would
 * point at nothing. The one exception is `ChallengerDefault`: at seventeen
 * characters it is wider than the bay it stands over, so it is abbreviated to the
 * half of the name that carries the meaning.
 */
const SETTLE_MARK: Readonly<Record<SettlePath, string>> = {
  Unchallenged: 'Unchallenged',
  Recomputed: 'Recomputed',
  Adjudicated: 'Adjudicated',
  ChallengerDefault: 'Default',
  Neutral: 'Neutral',
};

export function buildModel(sim: SimState): SceneModel {
  const o = sim.oracle;
  const rounds = ladderRounds(o);
  const { b1 } = roundOneBond(o);

  const windowBlocks = challengeWindowBlocks();
  const deadlineBlocks = moneyDeadlineBlocks();

  // One scale for the whole stage: blocks to stage units, on doc 07 §11's axis
  // (day 0 = the close of the measurement epoch). The extension and the terminal
  // track are budgeted for whether or not they were taken, so the wall keeps the
  // same position in every state — which is the claim the drawing makes.
  const scheduleBlocks =
    ORC_REPORT_WINDOW_BLOCKS +
    rounds * windowBlocks +
    WATCHTOWER_EXTENSION_BLOCKS +
    ORC_RETENTION_BLOCKS;
  const maxBlocks = Math.max(scheduleBlocks, deadlineBlocks);
  const scale = SPAN / maxBlocks;

  const nodes: SceneNode[] = [];
  const rules: SceneRule[] = [];
  const ticks: { at: number; label: string }[] = [{ at: X0, label: 'd0' }];

  // The bond columns are scaled to the ladder actually drawn, so the last round
  // — the tallest, at 2^(rounds−1) units — lands exactly on the ceiling instead
  // of walking into the acknowledgement chips above it.
  const unitH = (STACK_CEIL_Y - BASE_Y) / 2 ** (rounds - 1);

  let acc = 0;

  // Nothing is bonded yet, and no window is running: this is the two days a
  // registered reporter has to report at all. Drawn because it is what day 0 of
  // the §11 budget means, and because a game that never opens still settles —
  // neutrally, on the no-report path of §10.
  nodes.push({
    id: 'bay-report',
    kind: 'slab',
    x: X0 + 0.12,
    y: QUIET_Y,
    w: ORC_REPORT_WINDOW_BLOCKS * scale - 0.24,
    h: FLOOR_H,
    d: 0.9,
    tone: 'dim',
    state: o.round >= 1 ? 'passed' : 'active',
    hatched: true,
    label: 'Report',
    domRowId: 'oracle-report-window',
  });
  acc += ORC_REPORT_WINDOW_BLOCKS;
  ticks.push({ at: X0 + acc * scale, label: dayLabel(acc) });

  for (let r = 1; r <= rounds; r++) {
    const bx = X0 + acc * scale;
    const bw = windowBlocks * scale;
    const cx = bx + bw / 2;
    acc += windowBlocks;
    ticks.push({ at: X0 + acc * scale, label: dayLabel(acc) });

    const reached = o.round >= r;
    const live = o.round === r && o.settledPath === null;
    const tone: Tone = reached ? 'ink' : 'dim';
    const state: NodeState = live ? 'active' : reached ? 'passed' : 'inactive';
    const row = `oracle-round-${r}`;

    // The platform: one challenge window of time, drawn to length, raised a tier
    // above the quiet strip because this is where money is at stake.
    nodes.push({
      id: `bay-${r}`,
      kind: 'slab',
      x: bx + 0.12,
      y: BAY_Y,
      w: bw - 0.24,
      h: FLOOR_H,
      d: 0.9,
      tone,
      state,
      label: `Round ${r}`,
      domRowId: row,
    });

    // Two equal columns, one per side, and the height *is* the bond: it doubles
    // from round to round, which is the whole mechanism drawn in one dimension.
    // Neither carries a label — the pair reads as a pair, and the figure is on
    // the bond scale at the left.
    const roundH = 2 ** (r - 1) * unitH;
    nodes.push({
      id: `bond-reporter-${r}`,
      kind: 'stack',
      x: cx - ROUND_GAP - ROUND_W,
      y: BASE_Y,
      w: ROUND_W,
      h: roundH,
      d: 0.8,
      tone,
      state,
      domRowId: row,
    });
    nodes.push({
      id: `bond-challenger-${r}`,
      kind: 'stack',
      x: cx + ROUND_GAP,
      y: BASE_Y,
      w: ROUND_W,
      h: roundH,
      d: 0.8,
      tone,
      state,
      domRowId: row,
    });

    // One chip per round, carrying the acknowledgement count. Watchtowers attest
    // that the round was seen; they never adjudicate it, which is why they carry
    // no bond ladder of their own.
    const kind = ackKind(o, r);
    nodes.push({
      id: `ack-${r}`,
      kind: 'chip',
      x: cx - WT_SIZE / 2,
      y: WT_Y,
      w: WT_SIZE,
      h: WT_SIZE,
      tone: kind === 'live' && o.acks >= WT_QUORUM ? 'ink' : 'dim',
      state: ACK_STATE[kind],
      // Words, not a dash: an empty-looking chip is a chip the reader has to
      // guess at, and the two absences here mean different things.
      label: kind === 'live' ? `${o.acks}/${WT_QUORUM}` : kind === 'unknown' ? 'unknown' : 'later',
      ...(kind === 'unknown' ? { hatched: true } : {}),
      domRowId: row,
    });
  }

  // The one +48 h extension a missing watchtower quorum buys, per component and
  // per epoch. It is drawn *after* the ladder rather than inside the round that
  // bought it because the chain records one flag per game, not which round it
  // lengthened: the total is knowable from state, the attribution is not.
  if (o.extensionUsed) {
    const ex = X0 + acc * scale;
    const ew = WATCHTOWER_EXTENSION_BLOCKS * scale;
    acc += WATCHTOWER_EXTENSION_BLOCKS;
    ticks.push({ at: X0 + acc * scale, label: dayLabel(acc) });
    nodes.push({
      id: 'bay-extension',
      kind: 'slab',
      x: ex + 0.12,
      y: QUIET_Y,
      w: ew - 0.24,
      h: FLOOR_H,
      d: 0.9,
      tone: 'dim',
      state: 'active',
      hatched: true,
      label: 'Extra time',
      domRowId: 'oracle-extension',
    });
  }

  // Terminal adjudication. No new bond is posted here — the verdict disposes of
  // the stack the ladder already built — so it carries no columns, only length:
  // the OracleResolution track's own decision-plus-confirm schedule.
  const terminalX = X0 + acc * scale;
  const terminalW = ORC_RETENTION_BLOCKS * scale;
  const terminalReached = o.round >= rounds;
  acc += ORC_RETENTION_BLOCKS;
  ticks.push({ at: X0 + acc * scale, label: dayLabel(acc) });
  nodes.push({
    id: 'bay-terminal',
    kind: 'slab',
    x: terminalX + 0.12,
    y: QUIET_Y,
    w: terminalW - 0.24,
    h: FLOOR_H,
    d: 0.9,
    tone: terminalReached ? 'ink' : 'dim',
    state: terminalReached ? (o.settledPath === null ? 'active' : 'passed') : 'inactive',
    hatched: true,
    label: 'Final vote',
    domRowId: 'oracle-terminal',
  });

  // The wall: `OracleSettleDeadline`, a position the epoch schedule fixes. It is
  // deliberately *not* the end of the bays — the whole point is that it does not
  // move when they do, so the extension spends the margin in front of it and can
  // push the terminal bay's far edge past it.
  const wallX = X0 + deadlineBlocks * scale;
  nodes.push({
    id: 'deadline-wall',
    kind: 'slab',
    x: wallX - 0.09,
    y: WALL_BOTTOM,
    w: 0.18,
    h: WALL_TOP - WALL_BOTTOM,
    d: 1.4,
    tone: 'ink',
    state: 'active',
    hatched: true,
    domRowId: 'oracle-deadline',
  });

  // Past the wall, the achromatic plate. Neutral belongs to neither party, so it
  // is drawn in ink for the same reason the Baseline book is.
  nodes.push({
    id: 'settle-neutral',
    kind: 'plate',
    x: X0 + SPAN + 0.35,
    y: BASE_Y,
    w: 1.2,
    h: 2.4,
    d: 0.9,
    tone: 'ink',
    state: o.settledPath === 'Neutral' ? 'active' : 'inactive',
    label: 'Neutral',
    domRowId: 'settle-Neutral',
  });

  const liveBayCx =
    X0 +
    (ORC_REPORT_WINDOW_BLOCKS +
      (Math.min(Math.max(o.round, 1), rounds) - 0.5) * windowBlocks) *
      scale;

  // Where a settled game closed. `Adjudicated` closes on the terminal track, not
  // inside a round bay, and the marker says so by standing over the right bay.
  if (o.settledPath !== null && o.settledPath !== 'Neutral') {
    const markCx = o.settledPath === 'Adjudicated' ? terminalX + terminalW / 2 : liveBayCx;
    nodes.push({
      id: 'settled-marker',
      kind: 'chip',
      x: markCx - 1.3,
      y: MARK_Y,
      w: 2.6,
      h: 0.44,
      tone: 'ink',
      state: 'active',
      label: SETTLE_MARK[o.settledPath],
      domRowId: `settle-${o.settledPath}`,
    });
  }

  // A merit-bonded dispute hangs over the decision rule itself. A ceiling is the
  // right shape: it constrains everything under it and no later number lifts it.
  if (o.holdsDecision && o.settledPath === null) {
    nodes.push({
      id: 'decision-hold',
      kind: 'ceiling',
      x: liveBayCx - 1.9,
      y: MARK_Y,
      w: 3.8,
      h: 0.3,
      tone: 'ink',
      state: 'active',
      label: 'On hold',
      domRowId: 'oracle-hold',
    });
  }

  rules.push({
    id: 'time-axis',
    axis: 'x',
    at: AXIS_Y,
    from: X0,
    // As far as the schedule actually reaches, or the wall — whichever is later.
    // Without the extension the terminal bay closes before the deadline, and the
    // axis should stop at the deadline rather than at a budget nobody spent.
    to: Math.max(X0 + acc * scale, wallX),
    tone: 'dim',
    ticks,
  });

  // The deadline label rides the top of the wall rather than a tick on the time
  // axis: the axis row is day numbers, and it is the one row on the stage with no
  // spare width. Twelve characters, centred on the wall, clear of everything.
  rules.push({
    id: 'deadline-rule',
    axis: 'y',
    at: wallX,
    from: WALL_BOTTOM,
    to: WALL_TOP,
    tone: 'ink',
    label: `Deadline ${dayLabel(deadlineBlocks)}`,
  });

  // The scale reads the *round* bond, one tick per round, so the doubling is
  // legible as a ruler and not only as a silhouette. The running total each side
  // has committed is a table fact, and it lives in the rail's ladder drawer.
  rules.push({
    id: 'bond-scale',
    axis: 'y',
    at: BOND_RULE_X,
    from: BASE_Y,
    to: BASE_Y + 2 ** (rounds - 1) * unitH + 0.4,
    tone: 'dim',
    label: 'Bond',
    ticks: Array.from({ length: rounds }, (_, i) => ({
      at: BASE_Y + 2 ** i * unitH,
      label: compact(b1 * 2 ** i),
    })),
  });

  return {
    nodes,
    rules,
    relation:
      'Time runs left to right, in days from the moment the epoch being measured closed. The ' +
      'thin lower strip is every stretch where no money is at stake: the two days to report, ' +
      `the one ${asHuman(WATCHTOWER_EXTENSION_BLOCKS)} extension a missing watchtower quorum ` +
      'buys, and the final vote. Each challenge round is a platform raised above that strip, ' +
      'carrying two equal columns — the reporter’s bond and the challenger’s matching bond — ' +
      'and every round doubles them, so each pair of columns is twice the height of the one ' +
      'before it. The small square over each round is how many of the two watchtower ' +
      'acknowledgements are on record for it. The upright wall is the settlement deadline: the ' +
      'epoch schedule fixes where it stands, so nothing either side does can move it, and the ' +
      'extension therefore spends the margin in front of the wall and pushes the final vote ' +
      'past it. A value not settled by the wall carries its last valid figure with the epoch ' +
      'flagged — the plate past the wall — and a verdict landing afterwards moves only the bonds.',
    unitLegend: `The first bond is ${compact(b1)} USDC, and every round after it is twice the round before — read the heights against the bond scale at the left.`,
  };
}

// ---------------------------------------------------------------------------
// Rail: the four numbers, and the round now open
// ---------------------------------------------------------------------------

/**
 * The numbers a reader should leave with, whether or not they open a drawer.
 *
 * With nothing reported there is no game to read, so the bond falls back to the
 * doc 13 floor — the shape the game *would* take — and says so in its note
 * rather than printing a simulated figure that does not exist.
 */
function OracleKeyFacts({ sim }: { sim: SimState }) {
  const o = sim.oracle;
  const open = o.round >= 1;
  const rounds = param('orc.rounds');
  const floor = param('orc.bond_floor');
  const remaining = o.windowEnd - sim.block;

  return (
    <KeyFacts>
      <KeyFact label="Round" note="every round doubles the money">
        {open ? (
          <>
            <Value of={simulated(o.round)} /> of{' '}
            <Value of={spec(rounds.value, rounds.cite)} />
          </>
        ) : (
          'none open'
        )}
      </KeyFact>
      <KeyFact
        label="Bond"
        note={open ? 'each side has posted this much' : 'the floor, with nothing reported'}
      >
        {open ? (
          <Value of={simulated(o.bond)} format={usd} unit="USDC" />
        ) : (
          <Value of={spec(floor.value, floor.cite)} format={usd} unit="USDC" />
        )}
      </KeyFact>
      <KeyFact
        label="Left to challenge"
        note={
          !open
            ? 'a window opens only when a value is reported'
            : remaining > 0
              ? 'until this window closes'
              : 'the window is closed; only settlement remains'
        }
      >
        {!open ? (
          'not running'
        ) : remaining > 0 ? (
          <Value of={simulated(remaining)} format={asHuman} />
        ) : (
          'closed'
        )}
      </KeyFact>
      <KeyFact label="At risk" note="whoever is wrong forfeits the whole stack, not one round">
        {open ? (
          <Value of={simulated(o.cumulativeBond)} format={usd} unit="USDC" />
        ) : (
          'nothing'
        )}
      </KeyFact>
    </KeyFacts>
  );
}

function LiveRoundPanel({ sim }: { sim: SimState }) {
  const o = sim.oracle;
  const open = o.round >= 1;
  const quorum = param('wt.quorum');

  return (
    <section className="panel">
      <h2 className="panel__title">The round now open</h2>

      {!open ? (
        <>
          <p className="oracle-lede">No round is open</p>
          <p>
            Nothing has been reported for this component, so there is no bond at risk and no
            challenge window running. The deadline still applies: a component that is expected and
            never reported is neutral-settled at it, carrying its last valid value with the epoch
            flagged, exactly as a contested one is. The ladder drawn on the stage is the shape the
            game <em>would</em> take, sized from the doc 13 floor rather than from anything
            observed.
          </p>
        </>
      ) : (
        <>
          <p className="oracle-lede">
            Round <Value of={simulated(o.round)} /> of{' '}
            <Value of={spec(value('orc.rounds'), param('orc.rounds').cite)} /> —{' '}
            {o.componentName}
          </p>
          <p className="oracle-chiprow">
            <span className="chip chip--state">
              component <Value of={simulated(o.component)} />
            </span>
            <span className="chip chip--state">
              acks <Value of={simulated(o.acks)} /> /{' '}
              <Value of={spec(quorum.value, quorum.cite)} />
            </span>
            {o.extensionUsed ? (
              <span className="chip chip--state">
                extension spent ·{' '}
                <Value of={spec(WATCHTOWER_EXTENSION_BLOCKS, EXT_CITE)} format={asHuman} />
              </span>
            ) : null}
            {o.holdsDecision ? <span className="chip chip--state">holds the decision</span> : null}
            {o.settledPath !== null ? (
              <span className="chip chip--state">settled · {o.settledPath}</span>
            ) : null}
          </p>
          <p>
            A reported value is a claim backed by money, not an oracle reading that the chain
            trusts. The reporter has posted this round&rsquo;s bond on top of its seat stake.{' '}
            {o.challengerValue === null
              ? 'Nobody has yet paid to contradict it: until someone matches that bond, the only thing standing behind the number is the reporter’s own stake and the watchtowers’ word that the claim was visible.'
              : 'The challenger has matched it, and whichever of the two is wrong forfeits — which is what makes the disagreement informative rather than merely loud.'}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Every field the chain records about the open round. It is eight rows of
 * detail, so it lives in a drawer rather than under the lede — but it is the
 * same data, and the `oracle-live-*` row ids stay where they were.
 */
function LiveRoundTable({ sim }: { sim: SimState }) {
  const o = sim.oracle;
  const open = o.round >= 1;
  const quorum = param('wt.quorum');
  const remaining = o.windowEnd - sim.block;

  return (
    <section className="panel">
      <table className="oracle-table">
        <caption className="sr-only">The oracle round currently open, field by field</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr id="oracle-live-component">
            <th scope="row">Component</th>
            <td className="numeric">
              {open ? (
                <Value of={simulated(o.componentName)} />
              ) : (
                <span className="oracle-absent">none reported</span>
              )}
            </td>
            <td>
              The welfare metric under dispute, identified on-chain by its MetricId — here{' '}
              <Value of={simulated(o.component)} />. Its specification is frozen for the cohort,
              so a dispute is about the value, never about the method.
            </td>
          </tr>
          <tr id="oracle-live-round">
            <th scope="row">Round</th>
            <td className="numeric">
              {open ? (
                <Value of={simulated(o.round)} />
              ) : (
                <span className="oracle-absent">—</span>
              )}
            </td>
            <td>
              Escalation depth. The ceiling is governed by{' '}
              <span className="mono">orc.rounds</span> and kernel-bounded at{' '}
              <Value of={spec(ORC_ROUNDS_MAX, KERNEL_CITATION)} />. Both it and the round-one
              bond are frozen when round one opens, so a later amendment prices the next game
              and never this one.
            </td>
          </tr>
          <tr id="oracle-live-reporter">
            <th scope="row">Reporter&rsquo;s value</th>
            <td className="numeric">
              {o.reporterValue === null ? (
                <span className="oracle-absent">not reported</span>
              ) : (
                <Value of={simulated(o.reporterValue)} format={f3} />
              )}
            </td>
            <td>
              What the registered reporter says the component is worth, inside the sanity bounds
              its frozen MetricSpec declares.
            </td>
          </tr>
          <tr id="oracle-live-challenger">
            <th scope="row">Challenger&rsquo;s value</th>
            <td className="numeric">
              {o.challengerValue === null ? (
                <span className="oracle-absent">unchallenged</span>
              ) : (
                <Value of={simulated(o.challengerValue)} format={f3} />
              )}
            </td>
            <td>
              The counter-value. Posting one is not free: it costs the same bond the reporter put
              up, so a challenge is itself a priced claim.
            </td>
          </tr>
          <tr id="oracle-live-bond">
            <th scope="row">This round&rsquo;s bond</th>
            <td className="numeric">
              {open ? (
                <Value of={simulated(o.bond)} format={usd} unit="USDC" />
              ) : (
                <span className="oracle-absent">—</span>
              )}
            </td>
            <td>Per side. It doubles at every escalation and never shrinks.</td>
          </tr>
          <tr id="oracle-live-cumulative">
            <th scope="row">Cumulative bond</th>
            <td className="numeric">
              {open ? (
                <Value of={simulated(o.cumulativeBond)} format={usd} unit="USDC" />
              ) : (
                <span className="oracle-absent">—</span>
              )}
            </td>
            <td>
              Everything one side has posted across the ladder so far. This is the number that
              decides whether escalating again is rational, and it is the number the losing side
              forfeits: the whole stack, not the last round&rsquo;s bond.
            </td>
          </tr>
          <tr id="oracle-live-acks">
            <th scope="row">Watchtower acks</th>
            <td className="numeric">
              {open ? (
                <>
                  <Value of={simulated(o.acks)} /> /{' '}
                  <Value of={spec(quorum.value, quorum.cite)} />
                </>
              ) : (
                <span className="oracle-absent">—</span>
              )}
            </td>
            <td>
              An unchallenged round finalises only with the quorum on record. Below it the window
              takes its one{' '}
              <Value of={spec(WATCHTOWER_EXTENSION_BLOCKS, EXT_CITE)} format={asHuman} />{' '}
              extension — once per component and epoch, across every round, never per round — and
              if quorum is still missing when that expires the value is treated as unobservable
              and settles neutral. A posted challenge supersedes the requirement: paying to
              contradict a report is itself proof it was visible.
            </td>
          </tr>
          <tr id="oracle-live-window">
            <th scope="row">Window ends</th>
            <td className="numeric">
              {open ? (
                <>
                  block <Value of={simulated(o.windowEnd)} format={group} />
                </>
              ) : (
                <span className="oracle-absent">—</span>
              )}
            </td>
            <td>
              {open ? (
                remaining > 0 ? (
                  <>
                    <Value of={simulated(remaining)} format={asBlocks} /> from the current block —{' '}
                    <Value of={simulated(remaining)} format={asHuman} /> of wall time at six
                    seconds a block.
                  </>
                ) : (
                  <>
                    The window closed{' '}
                    <Value of={simulated(-remaining)} format={asHuman} /> ago in block terms; only
                    settlement remains.
                  </>
                )
              ) : (
                'A window opens the moment a value is reported, and not before.'
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail: the bond ladder
// ---------------------------------------------------------------------------

function LadderPanel({ sim }: { sim: SimState }) {
  const o = sim.oracle;
  const rounds = ladderRounds(o);
  const { b1, fromSim } = roundOneBond(o);
  const rows = ladderRows(o, rounds, b1);
  const floor = param('orc.bond_floor');
  const windowRow = param('orc.window');
  const deadlineBlocks = moneyDeadlineBlocks();
  const terminalStack = b1 * (2 ** rounds - 1);

  /** A ladder figure is exactly as trustworthy as the round-one bond it scales. */
  const tag = (v: number): Tagged<number> =>
    fromSim ? simulated(v) : spec(v, floor.cite);

  return (
    <section className="panel">
      <h2 className="panel__title">The bond ladder, and the clock it runs against</h2>
      <p>
        Each escalation doubles the round bond, so the total a side has committed after{' '}
        <em>n</em> rounds is <span className="mono">(2ⁿ − 1)</span> times the first bond: one,
        then three, then seven. That asymmetry is the mechanism. A party who is right once can
        afford to be right again; a party who is wrong twice has staked seven times its opening
        conviction on being wrong a third time.
      </p>
      <p className="panel__note">
        {fromSim ? (
          <>
            The ladder below is scaled from the live round-one bond of{' '}
            <Value of={simulated(b1)} format={usd} unit="USDC" />. In production the opening bond
            is the larger of the <span className="mono">orc.bond_floor</span> row and a
            value-scaled term at <Value of={spec(value('orc.bond_bps'), param('orc.bond_bps').cite)} />{' '}
            bps of the stake at risk, so a component that matters more is dearer to lie about.
          </>
        ) : (
          <>
            With no game open the ladder is drawn at the{' '}
            <span className="mono">orc.bond_floor</span> row —{' '}
            <Value of={spec(b1, floor.cite)} format={usd} unit="USDC" showCite /> — which is a
            floor, not the bond a real round would carry.
          </>
        )}
      </p>

      <table className="oracle-table">
        <caption className="sr-only">
          The dispute schedule: per-round bond, cumulative commitment, window length and the
          money deadline
        </caption>
        <thead>
          <tr>
            <th scope="col" className="numeric">
              Stage
            </th>
            <th scope="col" className="numeric">
              Bond, per side
            </th>
            <th scope="col" className="numeric">
              Cumulative
            </th>
            <th scope="col">Window</th>
            <th scope="col">Acks</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          <tr
            id="oracle-report-window"
            className={o.round >= 1 ? undefined : 'oracle-row--ahead'}
          >
            <th scope="row">Report</th>
            <td className="numeric">
              <span className="oracle-absent">round-1 bond, with the report</span>
            </td>
            <td className="numeric">
              <span className="oracle-absent">—</span>
            </td>
            <td>
              <Value of={spec(ORC_REPORT_WINDOW_BLOCKS, REPORT_CITE)} format={asBlocks} />
              <br />
              <span className="oracle-absent">
                <Value of={spec(ORC_REPORT_WINDOW_BLOCKS, REPORT_CITE)} format={asHuman} /> after
                the epoch closes
              </span>
            </td>
            <td>
              <span className="oracle-absent">—</span>
            </td>
            <td>
              <span className="chip chip--state">{o.round >= 1 ? 'reported' : 'open'}</span>
            </td>
          </tr>
          {rows.map((r) => (
            <tr
              key={r.round}
              id={`oracle-round-${r.round}`}
              className={r.reached ? undefined : 'oracle-row--ahead'}
            >
              <th scope="row" className="numeric">
                <Value of={spec(r.round, ROUNDS_CITE)} />
              </th>
              <td className="numeric">
                <Value of={tag(r.bond)} format={usd} unit="USDC" />
              </td>
              <td className="numeric">
                <Value of={tag(r.cumulative)} format={usd} unit="USDC" />
              </td>
              <td>
                <Value of={spec(windowRow.value, windowRow.cite)} format={asBlocks} />
                <br />
                <span className="oracle-absent">
                  <Value of={spec(windowRow.value, windowRow.cite)} format={asHuman} />
                </span>
              </td>
              <td>
                {r.live ? (
                  <>
                    <Value of={simulated(o.acks)} /> / <Value of={spec(WT_QUORUM, KERNEL_CITATION)} />
                  </>
                ) : r.reached ? (
                  <span className="oracle-absent">not carried</span>
                ) : (
                  <span className="oracle-absent">—</span>
                )}
              </td>
              <td>
                <span className="chip chip--state">
                  {r.live ? 'running' : r.reached ? 'closed' : 'not opened'}
                </span>
              </td>
            </tr>
          ))}
          <tr id="oracle-extension" className={o.extensionUsed ? undefined : 'oracle-row--ahead'}>
            <th scope="row">Extension</th>
            <td className="numeric">
              <span className="oracle-absent">no bond</span>
            </td>
            <td className="numeric">
              <span className="oracle-absent">—</span>
            </td>
            <td>
              <Value of={spec(WATCHTOWER_EXTENSION_BLOCKS, EXT_CITE)} format={asBlocks} />
              <br />
              <span className="oracle-absent">
                <Value of={spec(WATCHTOWER_EXTENSION_BLOCKS, EXT_CITE)} format={asHuman} />, once
                per game
              </span>
            </td>
            <td>
              <span className="oracle-absent">
                &lt; <Value of={spec(WT_QUORUM, KERNEL_CITATION)} />
              </span>
            </td>
            <td>
              <span className="chip chip--state">{o.extensionUsed ? 'spent' : 'available'}</span>
            </td>
          </tr>
          <tr
            id="oracle-terminal"
            className={o.round >= rounds ? undefined : 'oracle-row--ahead'}
          >
            <th scope="row">
              Terminal <span className="cite">{formatCitation(TERMINAL_CITE)}</span>
            </th>
            <td className="numeric">
              <span className="oracle-absent">no new bond</span>
            </td>
            <td className="numeric">
              <Value of={tag(terminalStack)} format={usd} unit="USDC" />
            </td>
            <td>
              <Value of={spec(ORC_RETENTION_BLOCKS, RETENTION_CITE)} format={asBlocks} />
              <br />
              <span className="oracle-absent">
                <Value of={spec(ORC_RETENTION_BLOCKS, RETENTION_CITE)} format={asHuman} /> of
                decision plus confirmation
              </span>
            </td>
            <td>
              <span className="oracle-absent">—</span>
            </td>
            <td>
              <span className="chip chip--state">
                {o.settledPath === 'Adjudicated'
                  ? 'adjudicated'
                  : o.round >= rounds
                    ? 'reachable'
                    : 'not reached'}
              </span>
            </td>
          </tr>
          <tr id="oracle-deadline">
            <th scope="row">Money deadline</th>
            <td className="numeric">
              <span className="oracle-absent">stacks stay in custody</span>
            </td>
            <td className="numeric">
              <span className="oracle-absent">—</span>
            </td>
            <td>
              <Value of={derived(deadlineBlocks, DEADLINE_CITE)} format={asBlocks} />
              <br />
              <span className="oracle-absent">
                <Value of={derived(deadlineBlocks, DEADLINE_CITE)} format={asHuman} /> after the
                epoch closes
              </span>
            </td>
            <td>
              <span className="oracle-absent">—</span>
            </td>
            <td>
              <span className="chip chip--state">settles Neutral</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        The money-deadline row is the wall drawn on the stage, and it is the one figure here that
        the dispute cannot move: <span className="mono">OracleSettleDeadline</span> is the start
        of the next epoch&rsquo;s Housekeeping, so it comes out of{' '}
        <span className="mono">epoch.length</span> and the frozen phase fractions rather than out
        of anything either party does. Running the full ladder and the terminal track takes
        longer than that margin allows once the extension is spent, which is the point: the
        component then settles <em>neutral</em> — it carries its last valid value with the epoch
        flagged, and two consecutive flagged epochs drop it from the cohort&rsquo;s recompute
        altogether — while the verdict, whenever it lands, still disposes of the bond stacks.
        Settled money is never re-opened.
      </p>
      <p className="panel__note">
        The chain records one extension flag per game rather than the round it lengthened, so the
        diagram appends the extension bay to the end of the ladder instead of claiming which round
        bought it: the total is right, and the attribution is not knowable from state. A round
        whose money has already gone neutral is retained rather than deleted for{' '}
        <Value of={spec(ORC_RETENTION_BLOCKS, RETENTION_CITE)} format={asBlocks} /> (
        <Value of={spec(ORC_RETENTION_BLOCKS, RETENTION_CITE)} format={asHuman} />), because the
        stack it holds is exactly what a late verdict has to dispose of. When that window expires
        with no verdict, both stacks go back to their posters — the values track&rsquo;s silence
        is not a finding against anybody.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail: the five settlement paths
// ---------------------------------------------------------------------------

interface PathNote {
  readonly gloss: string;
  /** JSX, not prose: the 40/60 split is a spec constant and must render as one. */
  readonly bonds: () => JSX.Element;
}

/** The §5.5 disposition of a forfeited stack, wherever it is quoted. */
function Split(): JSX.Element {
  return (
    <>
      <Value of={spec(CHALLENGER_SHARE_PCT, SETTLE_CITE)} unit="%" /> to the other side and{' '}
      <Value of={spec(INSURANCE_SHARE_PCT, SETTLE_CITE)} unit="%" /> to INSURANCE
    </>
  );
}

const SETTLE_NOTES: Readonly<Record<SettlePath, PathNote>> = {
  Unchallenged: {
    gloss:
      'The window closed with no counter-value posted and at least the watchtower quorum of acknowledgements on record. Silence alone is deliberately not enough: under the older “unchallenged ⇒ final” rule a colluding collator set could censor challenges for one window and finalise a false report, so finalisation now needs positive, bonded evidence that the report was observable at all.',
    bonds: () => (
      <>
        <span className="mono">ReporterWins</span> — the reporter&rsquo;s stack is released. A
        challenger who took the ladder up and then let a round close without a fresh counter-value
        forfeits its own stack, <Split />.
      </>
    ),
  },
  Recomputed: {
    gloss:
      'A keeper submitted a proof that re-runs the component’s frozen specification over its committed inputs, and the round resolved mechanically. The method is fixed for the cohort, so where the disagreement is arithmetic rather than judgement it is settled by arithmetic, permissionlessly, and nobody votes.',
    bonds: () => (
      <>
        The side the recomputation contradicts forfeits its whole stack — <Split />.
      </>
    ),
  },
  Adjudicated: {
    gloss:
      'The ladder was exhausted with the dispute still live, so it escalated to a token-holder ballot on the OracleResolution track, voted on a pre-cohort conviction snapshot: capital that arrived after the cohort was created carries no weight. This is the expensive path, which is why the ladder is built to make reaching it rare.',
    bonds: () => (
      <>
        The side the ballot finds wrong forfeits its whole stack — <Split />. The verdict disposes
        of bonds whenever it lands, including after the money deadline.
      </>
    ),
  },
  ChallengerDefault: {
    gloss:
      'The reporter did not consent to the next round before its window closed. Escalation is opt-in on both sides and nobody’s bond can be posted for them, so a party that declines to fund the round loses its money. A default decides the bonds and never the value: the challenger’s counter-value does not settle, because nothing acknowledged, recomputed or reviewed it. The component carries its last valid value forward with the epoch flagged.',
    bonds: () => (
      <>
        <span className="mono">ChallengerWins</span> — the reporter forfeits the stack it had
        already posted. At round 1 all of it goes to insurance and the challenger is paid nothing,
        because nothing on chain yet separates an honest catch from a griefing one. From round 2 the
        reporter had re-asserted under a doubled bond before abandoning, so the ordinary <Split />{' '}
        applies.
      </>
    ),
  },
  Neutral: {
    gloss:
      'The value was never challenge-closed in time — the money deadline passed, or nobody reported, or the acknowledgement quorum never arrived even after the extension. No new value is adopted: the component carries its last valid value with the epoch flagged, and if it is flagged in two consecutive epochs of a cohort’s window it is dropped from that cohort’s recompute entirely. This is the wall drawn on the stage, and it is the reason a determined party cannot hold a fact hostage indefinitely.',
    bonds: () => (
      <>
        Nothing is forfeit yet. The stacks stay in custody while the round is retained, and a
        verdict landing inside that window still takes the loser&rsquo;s whole stack — <Split />{' '}
        — settling bonds and reputations without re-opening the settled money. If no verdict
        arrives, <span className="mono">RefundBoth</span>: the track&rsquo;s failure to rule is
        not a finding against either party.
      </>
    ),
  },
};

function PathsPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The five ways a round ends</h2>
      <p>
        <span className="mono">SettlePath</span> is an enumeration, not a spectrum: every dispute
        ends in exactly one of these five, and the path is recorded alongside the value so that a
        later reader can tell a value nobody contested from a value a ballot imposed.
      </p>
      <ol className="oracle-paths">
        {SETTLE_PATHS.map((p) => {
          const note = SETTLE_NOTES[p];
          return (
            <li key={p} className="oracle-path" id={`settle-${p}`}>
              <h3 className="oracle-path__name">
                <span className="mono">{p}</span>
                <span className="cite">{formatCitation(SETTLE_CITE)}</span>
              </h3>
              <p className="oracle-path__gloss">{note.gloss}</p>
              <p className="oracle-path__bonds">
                <span className="label">Bonds</span> {note.bonds()}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail: who stakes what
// ---------------------------------------------------------------------------

function RolesPanel() {
  const repStake = param('orc.rep_stake');
  const wtStake = param('wt.stake');
  const quorum = param('wt.quorum');

  return (
    <section className="panel">
      <h2 className="panel__title">Three roles, three different things at risk</h2>
      <p>
        The roles are separated on purpose. A reporter asserts; a challenger contradicts; a
        watchtower only testifies that the round happened where everyone could see it. Nobody in
        this game is trusted, and no single seat can decide an outcome.
      </p>

      <table className="oracle-table">
        <caption className="sr-only">Oracle roles, their stakes and their exposure</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col" className="numeric">
              Stake
            </th>
            <th scope="col">What it can lose</th>
            <th scope="col">What it actually does</th>
          </tr>
        </thead>
        <tbody>
          <tr id="role-reporter">
            <th scope="row">Reporter</th>
            <td className="numeric">
              <Value of={spec(repStake.value, repStake.cite)} format={usd} unit="USDC" />
            </td>
            <td>
              <Value of={spec(REPORTER_SLASH_PCT, REPORTER_CITE)} unit="%" /> of the seat stake on
              a second <em>adjudicated-false</em> report, and ejection on the{' '}
              <Value of={spec(REPORTER_STRIKES_TO_EJECT, REPORTER_CITE)} />
              rd — plus the whole bond stack of any round it lost. A first adjudicated-false report
              is a recorded finding of fault and nothing more.
            </td>
            <td>
              Posts the component value with an evidence hash. A component is not admitted at all
              until at least <Value of={spec(ORC_REPORTERS_MIN, KERNEL_CITATION)} /> reporters hold
              seats <em>at full stake</em> — a seat slashed to half no longer counts toward the
              floor — so no single seat is ever the only source.
            </td>
          </tr>
          <tr id="role-watchtower">
            <th scope="row">Watchtower</th>
            <td className="numeric">
              <Value of={spec(wtStake.value, wtStake.cite)} format={usd} unit="USDC" />
            </td>
            <td>
              Its seat bond. It has no position in the dispute and can win nothing from it — but a
              seat that acknowledges nothing across two consecutive epochs carrying open rounds is
              slashed and ejected, because registering and then going quiet is how you starve the
              quorum.
            </td>
            <td>
              Attests that a round was <strong>seen</strong>. At most{' '}
              <Value of={spec(WT_MAX, KERNEL_CITATION)} /> seats exist and{' '}
              <Value of={spec(quorum.value, quorum.cite)} /> acknowledgements are required; below
              quorum the window is extended rather than resolved, because an unobserved round is
              not a settled one. Watchtowers do not adjudicate.{' '}
              <span className="cite">{formatCitation(WT_CITE)}</span>
            </td>
          </tr>
          <tr id="role-challenger">
            <th scope="row">Challenger</th>
            <td className="numeric">
              <span className="oracle-absent">the round bond</span>
            </td>
            <td>
              Every bond it matched across the ladder, if it is the side found wrong — the stack,
              not the last round. There is no seat to lose because there is no seat to hold: anyone
              except the round&rsquo;s own reporter may challenge, with no registration at all.
            </td>
            <td>
              Contradicts a reported value and pays to do so. A successful slash pays the
              challenger <Value of={spec(CHALLENGER_SHARE_PCT, SETTLE_CITE)} unit="%" /> of the
              forfeited stack; the remaining{' '}
              <Value of={spec(INSURANCE_SHARE_PCT, SETTLE_CITE)} unit="%" /> goes to INSURANCE, so
              catching a lie is profitable but not so profitable that manufacturing disputes pays.
              The one exception is a reporter who simply walks away at round 1: that pays the
              challenger nothing at all.
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail: the registry sub-game and the contrast
// ---------------------------------------------------------------------------

function FilingStateCell({ state }: { state: FilingState }) {
  switch (state.kind) {
    case 'Filed':
      return (
        <>
          <span className="chip chip--state">Filed</span>{' '}
          <span className="oracle-absent">
            window ends block <Value of={simulated(state.windowEnd)} format={group} />
            {state.extended ? ', extended' : ''}, acks <Value of={simulated(state.acks)} />
          </span>
        </>
      );
    case 'Challenged':
      return (
        <>
          <span className="chip chip--state">Challenged</span>{' '}
          <span className="oracle-absent">
            round <Value of={simulated(state.round)} />, window ends block{' '}
            <Value of={simulated(state.windowEnd)} format={group} />
          </span>
        </>
      );
    case 'Upheld':
      return <span className="chip chip--state">Upheld</span>;
    case 'Rejected':
      // Ink, always. A rejected filing is the system working, not a failure.
      return <span className="chip chip--state">Rejected</span>;
  }
}

function evidenceHashOf(state: FilingState): string | null {
  return state.kind === 'Challenged' ? state.evidenceHash : null;
}

function RegistryPanel({ registry }: { registry: RegistrySim }) {
  const bondFloor = registry.kind === 'Incident' ? param('reg.bond_inc') : param('reg.bond_mile');
  const bondBps = param('orc.bond_bps');
  const rounds = value('orc.rounds');
  const coverageBps = (2 ** rounds - 1) * bondBps.value;
  const hash = evidenceHashOf(registry.state);
  const filed = registry.filingId > 0;

  return (
    <section className="panel">
      <h2 className="panel__title">The registry sub-game</h2>
      <p>
        The incident and milestone registries borrow most of the oracle&rsquo;s shape — a bonded
        filing, a challenge window of{' '}
        <Value of={spec(ORC_WINDOW_BLOCKS, WINDOW_CITE)} format={asHuman} />, the same watchtower
        acknowledgement quorum, the same split of a forfeited bond — and that resemblance is
        exactly what makes the two real differences easy to miss. There is{' '}
        <strong>no escalation ladder</strong>: a filing gets one counter-round, and it ends on a
        values verdict rather than by doubling. And the window and quorum are the frozen kernel
        floors rather than the live rows, so raising{' '}
        <span className="mono">orc.window</span> lengthens the oracle&rsquo;s windows and leaves
        both registry instances exactly where they were.
      </p>

      <table className="oracle-table">
        <caption className="sr-only">The registry filing currently on file</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr id="registry-kind">
            <th scope="row">Registry</th>
            <td>
              <span className="mono">{registry.kind}</span> ·{' '}
              {filed ? (
                <>
                  filing <Value of={simulated(registry.filingId)} />
                </>
              ) : (
                <span className="oracle-absent">nothing filed yet</span>
              )}
            </td>
            <td>
              A dual-instance pallet: <span className="mono">Incident</span> records harm that
              happened, <span className="mono">Milestone</span> records work that was delivered.
            </td>
          </tr>
          <tr id="registry-severity">
            <th scope="row">Severity</th>
            <td>
              {filed ? (
                <span className="mono">{registry.severity}</span>
              ) : (
                <span className="oracle-absent">—</span>
              )}
            </td>
            <td>
              The filing class. Severity is the claim being made, and it is what a challenger
              disputes when the event itself is not in doubt.
            </td>
          </tr>
          <tr id="registry-bond">
            <th scope="row">Bond</th>
            <td>
              {registry.bond > 0 ? (
                <Value of={simulated(registry.bond)} format={usd} unit="USDC" />
              ) : (
                <span className="oracle-absent">nothing on file</span>
              )}
            </td>
            <td>
              Floored by <span className="mono">{bondFloor.key}</span> at{' '}
              <Value of={spec(bondFloor.value, bondFloor.cite)} format={usd} unit="USDC" />, then
              scaled by the exposure the filing can move. The rate is not{' '}
              <span className="mono">orc.bond_bps</span> alone —{' '}
              <Value of={spec(bondBps.value, bondBps.cite)} /> bps prices one oracle{' '}
              <em>round</em> — but the whole ladder&rsquo;s coverage rate,{' '}
              <Formula name="oracle.total-bond" />, here{' '}
              <Value of={derived(coverageBps, COVERAGE_CITE)} format={usd} /> bps. A one-round
              game has no escalation to build a stack with, so it posts the terminal stack up
              front; anything less would price a false filing proportionally without covering
              what it can move.
            </td>
          </tr>
          <tr id="registry-state">
            <th scope="row">State</th>
            <td>
              {filed ? (
                <FilingStateCell state={registry.state} />
              ) : (
                <span className="oracle-absent">no filing on record</span>
              )}
            </td>
            <td>
              <span className="mono">FilingState</span> is four-valued:{' '}
              <span className="mono">Filed</span>, <span className="mono">Challenged</span>,{' '}
              <span className="mono">Upheld</span>, <span className="mono">Rejected</span>. None of
              the four is a safety state.
            </td>
          </tr>
          <tr id="registry-points">
            <th scope="row">Scope points</th>
            <td>
              {filed ? (
                <Value of={simulated(registry.points)} />
              ) : (
                <span className="oracle-absent">—</span>
              )}
            </td>
            <td>
              Payload of the <span className="mono">Scope</span> filing class only. A severity
              filing carries none, so a zero here is an absence rather than a measurement.
            </td>
          </tr>
          <tr id="registry-multiplier">
            <th scope="row">Incident multiplier</th>
            <td>
              {filed ? (
                <Value of={simulated(registry.incidentMultiplier)} format={f2} />
              ) : (
                <span className="oracle-absent">no filing, no multiplier</span>
              )}
            </td>
            <td>
              What an upheld filing does to the Credible-neutrality pillar: a pure multiplier with
              no ε floor beneath it (<span className="cite">{formatCitation(CPILLAR_CITE)}</span>),
              so an upheld <span className="mono">S1</span> finding zeroes the pillar outright and
              takes realised welfare with it. It reaches settlement-time welfare and nothing else
              — no attested value may move
              a daily gate-breach flag or a gate-market settlement.
            </td>
          </tr>
          <tr id="registry-evidence">
            <th scope="row">Evidence</th>
            <td>
              {hash === null ? (
                <span className="oracle-absent">no challenge on file</span>
              ) : (
                <span className="oracle-hash">{hash}</span>
              )}
            </td>
            <td>
              A commitment, not a document. What the chain stores is the hash; the body lives
              off-chain.
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function ContrastPanel({ sim }: { sim: SimState }) {
  const o = sim.oracle;
  const merit = param('dis.merit_min');
  const trace = sim.decision;
  const held =
    trace !== null && trace.outcome.kind === 'Reject' && trace.outcome.reason === 'ProcessHold';

  return (
    <section className="panel">
      <h2 className="panel__title">The distinction worth memorising</h2>
      <p className="oracle-lede">
        An oracle dispute can hold a decision. A registry dispute cannot.
      </p>
      <p>
        Both are bonded, both are challengeable, both run a challenge window under the same
        watchtower quorum. They differ in what they are allowed to reach. A merit-bonded oracle
        dispute that touches a proposal&rsquo;s frozen metric specification reaches{' '}
        <strong>step 2</strong> of the ordered decision rule and stops it: the answer is{' '}
        <span className="mono">Reject(ProcessHold)</span>, a full refund and a resubmission,
        because deciding through a fact still in contest would be deciding on an input nobody
        agrees on. A registry filing reaches settlement and nothing earlier — it changes what the
        epoch turned out to be worth, never whether the decision may be taken.
      </p>

      <div className="oracle-contrast">
        <div className="oracle-contrast__col">
          <p className="oracle-contrast__head">Oracle round</p>
          <p className="oracle-contrast__claim">Holds the decision.</p>
          <p>
            Merit is priced: the hold binds when the dispute is bonded at or above the larger of{' '}
            <span className="mono">dis.merit_min</span> —{' '}
            <Value of={spec(merit.value, merit.cite)} format={usd} unit="USDC" /> — and the
            game&rsquo;s own round-one bond, so lowering the floor cannot make censorship cheap
            (<span className="cite">{formatCitation(HOLD_CITE)}</span>).
          </p>
          <p>
            The check sits at step 2, before the books are even read (
            <span className="cite">{formatCitation(STEP2_CITE)}</span>). Nothing later in the rule
            can outweigh it, because nothing later in the rule runs.
          </p>
          <p>
            It holds only while the contest is live. Once the round&rsquo;s money leg has settled
            — neutrally, at the deadline — the quantity the hold protects is already decided, so a
            round retained purely to dispose of its bonds holds nothing.
          </p>
        </div>
        <div className="oracle-contrast__col">
          <p className="oracle-contrast__head">Registry filing</p>
          <p className="oracle-contrast__claim">Holds settlement only.</p>
          <p>
            An open filing is invisible to <span className="mono">decide()</span>. The proposal is
            decided on schedule, adopted or rejected on what the markets priced, and executed if
            it passed. The exclusion is structural, not a matter of size: the step-2 predicate is
            defined over open <em>oracle rounds</em>, so a filing never enters the merit
            comparison at any bond — which matters now that filing bonds scale on the same rate
            and can exceed a round-one bond outright.
          </p>
          <p>
            The filing bites later, at settlement, through the incident multiplier on the C
            pillar. It changes the score that pays the cohort — the answer to &ldquo;what was this
            epoch worth?&rdquo; — and never the answer to &ldquo;may this proposal proceed?&rdquo;
            (<span className="cite">{formatCitation(REGISTRY_CITE)}</span>).
          </p>
        </div>
      </div>

      <table className="oracle-table">
        <caption className="sr-only">
          Whether the open disputes reach the decision rule
        </caption>
        <thead>
          <tr>
            <th scope="col">Dispute</th>
            <th scope="col">Reaches</th>
            <th scope="col">Status now</th>
          </tr>
        </thead>
        <tbody>
          <tr id="oracle-hold">
            <th scope="row">Oracle — {o.componentName}</th>
            <td>
              <span className="mono">decide()</span> step 2, then settlement
            </td>
            <td>
              {o.holdsDecision ? (
                <>
                  <span className="chip chip--state">holding</span>{' '}
                  <span className="oracle-absent">
                    merit-bonded and touching the frozen spec
                  </span>
                </>
              ) : (
                <>
                  <span className="chip chip--state">not holding</span>{' '}
                  <span className="oracle-absent">
                    {o.round === 0
                      ? 'no round open'
                      : o.settledPath !== null
                        ? 'settled'
                        : 'not merit-bonded against this proposal'}
                  </span>
                </>
              )}
            </td>
          </tr>
          <tr id="registry-hold">
            <th scope="row">Registry — {registryLabel(sim.registry)}</th>
            <td>settlement only</td>
            <td>
              <span className="chip chip--state">never holds a decision</span>
            </td>
          </tr>
          <tr id="decide-observed">
            <th scope="row">
              What <span className="mono">decide()</span> actually returned
            </th>
            <td>
              <span className="mono">decision_stats(pid)</span>
            </td>
            <td>
              {trace === null ? (
                <span className="oracle-absent">
                  not yet evaluable — the decision windows have not sealed
                </span>
              ) : held ? (
                <>
                  <span className="chip chip--state">Reject(ProcessHold)</span>{' '}
                  <span className="oracle-absent">
                    stopped at step <Value of={derived(trace.stoppedAt, STEP2_CITE)} />
                  </span>
                </>
              ) : (
                <>
                  <span className="chip chip--state">{trace.outcome.kind}</span>{' '}
                  <span className="oracle-absent">
                    stopped at step <Value of={derived(trace.stoppedAt, STEP2_CITE)} /> — no
                    process hold
                  </span>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        Until the windows seal there is no decision to report and none is projected here. The row
        above says what the rule returned, not what it is expected to return.
      </p>
    </section>
  );
}

function registryLabel(r: RegistrySim): string {
  return r.filingId > 0 ? `${r.kind} ${r.severity}` : `${r.kind}, nothing filed`;
}

// ---------------------------------------------------------------------------
// Rail: evidence
// ---------------------------------------------------------------------------

function EvidencePanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Only the hash is on-chain</h2>
      <p>
        A report and a challenge each commit to their evidence by hash. The body itself — the
        content-addressed raw data plus instructions sufficient for a third party to reproduce the
        value under the frozen formula — lives off-chain and carries no size limit here; large
        artifacts are expected to be published by content id with only the hash on chain. What{' '}
        <em>is</em> capped is the on-chain{' '}
        <span className="mono">recompute_proof</span> submission, at{' '}
        <Value of={spec(ORC_MAX_PROOF_BYTES, KERNEL_CITATION)} format={group} unit="bytes" /> (
        <Value of={spec(ORC_MAX_PROOF_BYTES, KERNEL_CITATION)} format={asKib} />), so that the one
        call which writes a proof into the chain&rsquo;s own state cannot be used to bloat it.
      </p>
      <p>
        The consequence is uncomfortable and the protocol states it plainly rather than papering
        over it: <strong>if the evidence body cannot be retrieved, it is treated as absent</strong>.
        Not as pending, not as presumed valid. A commitment nobody can open supports nothing, and
        the side relying on it argues as if it had filed none (
        <span className="cite">{formatCitation(EVIDENCE_CITE)}</span>). Retrievability is a
        validity condition while the game is live, and only then: once a decision has settled, the
        later expiry of evidence storage can never disturb it.
      </p>
      <p className="panel__note">
        This app shows the hash where the simulation carries one and says so where it does not. An
        interface that hid an unretrievable-evidence row would be teaching that the protocol
        resolves the ambiguity, and it does not — it resolves the incentive instead, by making
        unopenable evidence worthless to whoever posted it.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail: the governed and the frozen
// ---------------------------------------------------------------------------

const PARAM_KEYS: readonly string[] = [
  'orc.window',
  'orc.rounds',
  'orc.bond_floor',
  'orc.bond_bps',
  'orc.rep_stake',
  'orc.n_min',
  'wt.quorum',
  'wt.stake',
  'reg.bond_inc',
  'reg.bond_mile',
  'dis.merit_min',
];

function bound(p: ParamRow, which: 'min' | 'max'): JSX.Element {
  const v = which === 'min' ? p.min : p.max;
  if (v === undefined) return <span className="oracle-absent">—</span>;
  return <Value of={spec(v, p.cite)} format={usd} />;
}

function ParamsPanel() {
  const rows = PARAM_KEYS.map((k) => param(k));

  return (
    <section className="panel">
      <h2 className="panel__title">What governance may move, and what it may not</h2>
      <p>
        Every number in this scene has exactly one home. The kernel constants below are
        compile-time and cannot be amended without a runtime upgrade; the registry rows above them
        are governable inside published bounds, with a cooldown between amendments so a captured
        epoch cannot walk a parameter anywhere it likes.
      </p>

      <table className="oracle-table">
        <caption className="sr-only">Governable doc 13 §1 rows this scene depends on</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col" className="numeric">
              Genesis
            </th>
            <th scope="col" className="numeric">
              Min
            </th>
            <th scope="col" className="numeric">
              Max
            </th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.key} id={`param-${p.key}`}>
              <th scope="row">
                <span className="mono">{p.key}</span>
              </th>
              <td className="numeric">
                <Value
                  of={spec(p.value, p.cite)}
                  format={usd}
                  unit={p.unit}
                  unverified={p.verification.status !== 'settled'}
                />
              </td>
              <td className="numeric">{bound(p, 'min')}</td>
              <td className="numeric">{bound(p, 'max')}</td>
              <td>
                {p.blurb}
                {p.kernelBounded ? ' The bound itself is kernel, so no amendment reaches past it.' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="oracle-table">
        <caption className="sr-only">Kernel constants this scene depends on</caption>
        <thead>
          <tr>
            <th scope="col">Kernel constant</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">Why it is frozen</th>
          </tr>
        </thead>
        <tbody>
          <tr id="kernel-window">
            <th scope="row">
              <span className="mono">ORC_WINDOW_BLOCKS</span>
            </th>
            <td className="numeric">
              <Value of={spec(ORC_WINDOW_BLOCKS, KERNEL_CITATION)} format={asBlocks} />
              <br />
              <span className="oracle-absent">
                <Value of={spec(ORC_WINDOW_BLOCKS, KERNEL_CITATION)} format={asHuman} />
              </span>
            </td>
            <td>
              Time to notice a claim and pay to contradict it. The governed{' '}
              <span className="mono">orc.window</span> row seeds here and takes this number as its
              own floor, so the oracle&rsquo;s window can only ever be made longer — while both
              registry instances stay pinned at this constant whatever governance does to the row.
            </td>
          </tr>
          <tr id="kernel-extension">
            <th scope="row">
              <span className="mono">WATCHTOWER_EXTENSION_BLOCKS</span>
            </th>
            <td className="numeric">
              <Value of={spec(WATCHTOWER_EXTENSION_BLOCKS, KERNEL_CITATION)} format={asBlocks} />
              <br />
              <span className="oracle-absent">
                <Value of={spec(WATCHTOWER_EXTENSION_BLOCKS, KERNEL_CITATION)} format={asHuman} />
              </span>
            </td>
            <td>
              One extension for the whole <span className="mono">(component, epoch)</span> game —
              across every round, never per round — granted when the acknowledgement quorum is
              missing. Bounded so that a party who can suppress watchtowers buys this much delay
              and no more; per-round extensions would break the latency budget outright and are
              prohibited.
            </td>
          </tr>
          <tr id="kernel-rounds">
            <th scope="row">
              <span className="mono">ORC_ROUNDS_MIN</span> /{' '}
              <span className="mono">ORC_ROUNDS_MAX</span>
            </th>
            <td className="numeric">
              <Value of={spec(ORC_ROUNDS_MIN, KERNEL_CITATION)} /> –{' '}
              <Value of={spec(ORC_ROUNDS_MAX, KERNEL_CITATION)} />
            </td>
            <td>
              The ladder is finite by construction, and its length is not a matter of taste: an
              attested component is admitted only if{' '}
              <Formula name="oracle.total-bond-max" /> covers its documented
              maximum single-epoch settlement impact. Lengthening the ladder is what buys that
              coverage, and shortening it is refused at the amendment boundary whenever it would
              leave an already-admitted component under-collateralised.
            </td>
          </tr>
          <tr id="kernel-wt">
            <th scope="row">
              <span className="mono">WT_QUORUM</span> / <span className="mono">WT_MAX</span>
            </th>
            <td className="numeric">
              <Value of={spec(WT_QUORUM, KERNEL_CITATION)} /> of{' '}
              <Value of={spec(WT_MAX, KERNEL_CITATION)} />
            </td>
            <td>
              Sixteen seats, two acknowledgements. A small quorum on a bounded set: enough to
              prove a round was public, few enough that watchtowers cannot become a veto.
            </td>
          </tr>
          <tr id="kernel-reporters">
            <th scope="row">
              <span className="mono">ORC_REPORTERS_MIN</span>
            </th>
            <td className="numeric">
              <Value of={spec(ORC_REPORTERS_MIN, KERNEL_CITATION)} />
            </td>
            <td>
              An attested component is not admitted — and Phase 3 is not armed — until this many
              reporters hold seats at <em>full</em> stake, alongside the watchtower quorum above,
              so the metric never depends on a single seat staying honest or staying online.
            </td>
          </tr>
          <tr id="kernel-proof">
            <th scope="row">
              <span className="mono">ORC_MAX_PROOF_BYTES</span>
            </th>
            <td className="numeric">
              <Value of={spec(ORC_MAX_PROOF_BYTES, KERNEL_CITATION)} format={group} />
              <br />
              <span className="oracle-absent">
                <Value of={spec(ORC_MAX_PROOF_BYTES, KERNEL_CITATION)} format={asKib} />
              </span>
            </td>
            <td>
              The ceiling on one <span className="mono">recompute_proof</span> submission — the
              only evidence that enters the chain rather than being committed to by hash. State
              bounds are a safety property here, not an optimisation: an unbounded proof call is
              an unbounded storage attack.
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function OracleDisputesScene({ sim }: { sim: SimState }): JSX.Element {
  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame
          model={buildModel(sim)}
          title="Oracle rounds, watchtowers and the settlement deadline"
        />
      </div>
      <div className="col-rail">
        <Lede>
          Some of what this chain has to price happens in the world, where a blockchain cannot
          look — how far a metric actually moved, whether an outage really happened, whether a
          milestone was really delivered. So nobody is trusted to just say: a reporter posts the
          number with their own money behind it — a <Jargon word="bond" /> — and anyone who thinks it
          is wrong, anyone at all except that reporter, can challenge by putting up the same amount.{' '}
          <strong>Every round of challenge doubles the money at stake</strong>, so a party who keeps
          insisting on something false runs out of money long before the chain runs out of rounds.
          The side finally found wrong is <Jargon word="slash" label="slashed" />.
        </Lede>

        <OracleKeyFacts sim={sim} />

        <LiveRoundPanel sim={sim} />

        <Depth title="How a challenge escalates, round by round" hint="bonds & timing">
          <LadderPanel sim={sim} />
        </Depth>

        <Depth title="Everything the chain records about the open round" hint="8 fields">
          <LiveRoundTable sim={sim} />
        </Depth>

        <Depth title="Every way a dispute can end, and who pays" hint="5 endings">
          <PathsPanel />
        </Depth>

        <Depth
          title="What reporters, watchtowers and challengers each risk"
          hint="3 roles · evidence"
        >
          <RolesPanel />
          <EvidencePanel />
        </Depth>

        <Depth title="The other bonded game: incidents and milestones" hint="oracle vs registry">
          <ContrastPanel sim={sim} />
          <RegistryPanel registry={sim.registry} />
        </Depth>

        <Depth title="Which of these numbers governance may move" hint="11 rows · 6 constants">
          <ParamsPanel />
        </Depth>
      </div>
    </div>
  );
}
