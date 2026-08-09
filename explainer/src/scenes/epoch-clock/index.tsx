import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { MotionSpec } from '../motion';
import { STAGE_WIDTH } from '../model';
import type { NodeState, SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import { KernelDial } from '../../ui/KernelDial';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import { derived, simulated, spec } from '../../provenance/types';
import { cite } from '../../protocol/citations';
import { param, value } from '../../protocol/params';
import {
  PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS,
  PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS,
} from '../../protocol/constants';
import {
  COHORT_CITATION,
  DECIDE_WINDOW_START_NUMERATOR,
  DERIVED_MAX_HORIZON_K,
  PHASE_WORK,
  SCHEDULED_PHASES,
  SCHEDULED_START_NUMERATOR,
  SCHEDULE_CITATION,
  TICK_COUNT,
  UNSCHEDULED_PHASES,
  blocksToDuration,
  boundaryBlock,
  cohortCapacity,
  cohortSchedule,
  decideWindowArc,
  decisionWindow,
  formatBlocks,
  formatDuration,
  formatDurationHuman,
  nonTerminalCohortsAt,
  phaseArcs,
  phaseAt,
  phaseBoundaries,
  phaseStartBlock,
  tradeWindow,
  trailingWindow,
  validateEpochLength,
} from '../../protocol/epoch';
import type { ScheduledPhase } from '../../protocol/epoch';
import './epoch-clock.css';

/**
 * The epoch clock and the cohort pipeline.
 *
 * Everything on this screen — every block number, every tick, every rail — is
 * computed by `protocol/epoch.ts`, which mirrors `epoch_core`'s integer
 * arithmetic. Nothing here restates a boundary; the module derives all of them
 * from the seven kernel numerators and the live `epoch.length`.
 *
 * The rail is ordered for a reader who has met none of this: one paragraph of
 * plain language, four numbers, one panel that says where the chain is, and
 * every table, bound and citation one click down in a drawer. Nothing is
 * dropped — the depth is moved, and the click is the reader asking for it.
 */

const KERNEL_FRACTION_CITE = cite(
  '13',
  '§3.1',
  'phase-start offsets as fixed fractions of epoch.length',
);
const HORIZON_CITE = cite('13', '§1', 'epoch.horizon_k, the measurement horizon');
const CAP_CITE = cite('13', '§4', 'MaxSettlingCohorts — 4 non-terminal, the I-21 storage bound');
const LENGTH_CITE = cite('13', '§1', 'epoch.length, the only clock parameter');
const WINDOW_CITE = cite('13', '§1', 'dec.window and dec.trailing');
/** Doc 05's phase table is the home of the Work column; doc 13 §3.1 carries no such column. */
const WORK_CITE = cite('05', '§3.1', 'the phase schedule’s Work column');
/** The second, independent cap on dec.window — checked at parameter change. */
const TRADE_BOUND_CITE = cite('05', '§3.1', 'dec.window ≤ 13/21 · epoch.length');

/**
 * The seven ticks a boundary lands on: the six scheduled phase starts plus the
 * nominal decision-window opening. Read from the kernel table rather than
 * written down, so a change in `constants.ts` moves the drawing too.
 */
const BOUNDARY_NUMERATORS: readonly number[] = [
  ...SCHEDULED_PHASES.map((p) => SCHEDULED_START_NUMERATOR[p]),
  DECIDE_WINDOW_START_NUMERATOR,
].sort((a, b) => a - b);

/**
 * How each phase names itself on the stage, and on which of the two text rows.
 *
 * The split is geometry, not taste. `Scene2D` centres a label under its node, so
 * two names on the same row need their centres about two stage units apart to
 * clear each other — and Qualify and Seed are one tick wide, as are Decide and
 * Housekeeping at the epoch's end. Sending the narrow ones to the second row
 * separates them on the only free axis left, because the bars themselves cannot
 * move: they have to tile the epoch exactly.
 *
 * `Settle` is not a rename of Housekeeping. Twelve characters centred half a
 * unit from the right edge runs off the stage, so the bar carries the phase's
 * headline work and the phase table below carries the spec name.
 */
const PHASE_NAME: Readonly<Record<ScheduledPhase, { text: string; row: 'label' | 'sub' }>> = {
  Intake: { text: 'Intake', row: 'label' },
  Qualify: { text: 'Qualify', row: 'sub' },
  Seed: { text: 'Seed', row: 'label' },
  Trade: { text: 'Trade', row: 'label' },
  Decide: { text: 'Decide', row: 'label' },
  Housekeeping: { text: 'Settle', row: 'sub' },
};

/**
 * A phase only prints its duration under its name if it is this wide: the second
 * text row is already carrying the narrow phases' names, and a bar this size has
 * clear air on both sides of its centre. Only Trade qualifies, which is the
 * right answer anyway — Trade is 13 of the 21 ticks.
 */
const TICKS_FOR_A_DURATION = 6;

/** What each rail is doing this epoch, in words rather than a verb code. */
const RAIL_ROLE: Readonly<Record<CohortRail['doing'], string>> = {
  Trades: 'trading now',
  Measured: 'being measured',
  Settles: 'settling',
  Live: 'still open',
};

/** Stage units one character of `scene__label` type occupies, near enough. */
const LABEL_CHAR_W = 0.23;
/** `Scene2D` draws the stage with this much padding on each side, so a centred
 * label may reach into it — but not past it, where the viewBox ends. */
const STAGE_BLEED = 0.6;

/** A grouped block count without the unit word — `formatBlocks` owns grouping. */
const blockNumber = (blocks: number): string => formatBlocks(blocks).replace(/ blocks$/, '');

/** `d5`, or `d5+6h` if a boundary does not land on a whole day. */
const dayTickLabel = (blocks: number): string => {
  const { days, hours, minutes } = blocksToDuration(blocks);
  if (hours === 0 && minutes === 0) return `d${days}`;
  return `d${days}+${hours > 0 ? `${hours}h` : `${minutes}m`}`;
};

// ---------------------------------------------------------------------------
// Stage geometry (stage units: x in [0,21], y in [0,12], origin bottom-left)
// ---------------------------------------------------------------------------

/**
 * Four bands, top to bottom: the tick ruler, the six phase bars, the accrual
 * band hanging under Trade, and the cohort rails. Each band's spacing is set by
 * where `Scene2D` puts text — a label sits 0.55 units under its node and a
 * sublabel 1.1 — so these numbers are the only thing keeping the rows of type
 * off each other.
 */
const TOOTH_BASE = 9.9;
const TOOTH_H = 0.55;
const BOUNDARY_TOOTH_H = 1.1;
/** The ruler line runs along the base of the teeth, so they stand on it. */
const DAY_RULE_Y = TOOTH_BASE;
const PHASE_Y = 8.2;
const PHASE_H = 0.8;
/**
 * Offset by 0.55 so the band's label lands exactly on the phase bars' sublabel
 * row: one row of secondary type across the whole drawing rather than two rows
 * a fifth of a unit apart, which reads as a mistake.
 */
const WINDOW_Y = PHASE_Y - 0.55;
const WINDOW_H = 0.5;
const RAIL_TOP = 6.3;
const RAIL_PITCH = 1.75;
const RAIL_H = 0.5;
/** The clock hand cuts the ruler, the phase bars and the accrual band, and stops
 * above the teeth. It deliberately does not reach the rails: a rail is a fact
 * about the whole epoch, not about this instant. */
const NOW_FROM = WINDOW_Y + WINDOW_H;
const NOW_TO = TOOTH_BASE + BOUNDARY_TOOTH_H + 0.3;

interface CohortRail {
  readonly cohort: number;
  /** Its role across the whole epoch, not at this instant — a cohort that
   * settles in Housekeeping still counts as settling while Trade is running. */
  readonly doing: 'Trades' | 'Measured' | 'Settles' | 'Live';
  /** 1-based measurement epoch, when the cohort is being measured now. */
  readonly leg: number | null;
  readonly fromTick: number;
  readonly toTick: number;
  readonly state: NodeState;
  readonly trades: number;
  readonly measures: readonly number[];
  readonly settlesAt: number;
}

/**
 * The cohorts that are non-terminal during this epoch, newest first, each with
 * the span of *this* epoch it occupies. That span is the whole point: a table
 * can list four cohorts, but only the drawing shows that they are four stages of
 * one pipeline running through the same 21 ticks.
 */
function cohortRails(sim: SimState): CohortRail[] {
  const k = value('epoch.horizon_k');
  const arcs = phaseArcs(sim.epochLength);
  const arcFor = (p: ScheduledPhase): { fromTick: number; toTick: number } => {
    const a = arcs.find((x) => x.phase === p);
    return a === undefined ? { fromTick: 0, toTick: TICK_COUNT } : a;
  };
  const trade = arcFor('Trade');
  const house = arcFor('Housekeeping');
  const phase = phaseAt(sim.blockInEpoch, sim.epochLength);

  return nonTerminalCohortsAt(sim.epoch, k)
    .map((cohort): CohortRail => {
      const sched = cohortSchedule(cohort, k);
      const legIndex = sched.measures.indexOf(sim.epoch);
      const common = {
        cohort,
        trades: sched.trades,
        measures: sched.measures,
        settlesAt: sched.settlesAt,
      };
      if (cohort === sim.epoch) {
        return {
          ...common,
          doing: 'Trades',
          leg: null,
          fromTick: trade.fromTick,
          toTick: trade.toTick,
          state: phase === 'Trade' ? 'active' : 'pending',
        };
      }
      if (sched.settlesAt === sim.epoch) {
        return {
          ...common,
          doing: 'Settles',
          leg: null,
          fromTick: house.fromTick,
          toTick: TICK_COUNT,
          state: phase === 'Housekeeping' ? 'active' : 'pending',
        };
      }
      if (legIndex >= 0) {
        return {
          ...common,
          doing: 'Measured',
          leg: legIndex + 1,
          fromTick: 0,
          toTick: TICK_COUNT,
          state: 'active',
        };
      }
      return {
        ...common,
        doing: 'Live',
        leg: null,
        fromTick: 0,
        toTick: TICK_COUNT,
        state: 'pending',
      };
    })
    .reverse();
}

/** How long a position opened in this cohort stays illiquid, in blocks. */
function capitalDuration(sim: SimState): { earliest: number; latest: number } {
  const L = sim.epochLength;
  const k = value('epoch.horizon_k');
  const sched = cohortSchedule(sim.epoch, k);
  const epochsAhead = sched.settlesAt - sim.epoch;
  const tradeClose = tradeWindow(L).endBlock;
  const settleOpens = phaseStartBlock('Housekeeping', L);
  return {
    earliest: epochsAhead * L + settleOpens - tradeClose,
    latest: epochsAhead * L + L - tradeClose,
  };
}

export function buildModel(sim: SimState): SceneModel {
  const L = sim.epochLength;
  const arcs = phaseArcs(L);
  const boundaries = phaseBoundaries(L);
  const currentPhase = phaseAt(sim.blockInEpoch, L);
  const nowTick = L === 0 ? 0 : (sim.blockInEpoch * TICK_COUNT) / L;
  const windowArc = decideWindowArc(L, value('dec.window'));
  const rails = cohortRails(sim);
  const hold = capitalDuration(sim);

  // The ruler carries one fact — the epoch is cut into 21 equal parts — and
  // carries it without a word on it. Numbering the teeth as well as the day rule
  // beneath them put three labels a single stage unit apart, and a reader reads
  // that as a smudge rather than as data. The day rule keeps the numbers.
  const teeth: SceneNode[] = Array.from({ length: TICK_COUNT }, (_, i): SceneNode => {
    const isBoundary = BOUNDARY_NUMERATORS.includes(i);
    const state: NodeState = nowTick >= i + 1 ? 'passed' : nowTick > i ? 'active' : 'inactive';
    return {
      id: `tick-${i}`,
      kind: 'tooth',
      x: i,
      y: TOOTH_BASE,
      w: 0.92,
      h: isBoundary ? BOUNDARY_TOOTH_H : TOOTH_H,
      d: isBoundary ? 0.7 : 0.34,
      tone: 'ink',
      state,
    };
  });

  // Six bars that tile the epoch with no gap and no overlap — the same tiling the
  // table below prints in blocks. A bar is wide in proportion to the time it
  // owns, which is the one thing a table cannot show.
  const phaseBars: SceneNode[] = arcs.map((a): SceneNode => {
    const name = PHASE_NAME[a.phase];
    const w = a.toTick - a.fromTick;
    const span = boundaries.find((b) => b.phase === a.phase);
    const state: NodeState =
      nowTick >= a.toTick ? 'passed' : a.phase === currentPhase ? 'active' : 'inactive';
    return {
      id: `phase-${a.phase}`,
      kind: 'node',
      x: a.fromTick,
      y: PHASE_Y,
      w,
      h: PHASE_H,
      d: 0.5,
      tone: 'ink',
      state,
      ...(name.row === 'label' ? { label: name.text } : { sublabel: name.text }),
      ...(name.row === 'label' && w >= TICKS_FOR_A_DURATION && span !== undefined
        ? { sublabel: formatDurationHuman(span.blocks) }
        : {}),
      domRowId: `phase-${a.phase}`,
    };
  });

  // Hatched, not toned: the accrual band is a sub-range of Trade rather than a
  // seventh phase, and the difference has to survive being printed in one colour.
  const windowBand: SceneNode = {
    id: 'dec-window',
    kind: 'node',
    x: windowArc.fromTick,
    y: WINDOW_Y,
    w: Math.max(0.4, windowArc.toTick - windowArc.fromTick),
    h: WINDOW_H,
    d: 0.2,
    tone: 'ink',
    hatched: true,
    state:
      nowTick >= windowArc.toTick
        ? 'passed'
        : nowTick >= windowArc.fromTick
          ? 'active'
          : 'inactive',
    label: 'Avg price',
    domRowId: 'window-accrual',
  };

  const railNodes: SceneNode[] = rails.map((r, i): SceneNode => {
    const w = Math.max(0.4, r.toTick - r.fromTick);
    const centre = r.fromTick + w / 2;
    const full = `Cohort ${r.cohort}`;
    // Labels are centred on the rail, and the settling rail is one tick wide
    // against the right edge — so its text has only what is left of the stage
    // plus the bleed. Two digits fit; the short form exists for the day they do
    // not, because a name that runs past the viewBox is simply cut in half.
    const fits = centre + (full.length * LABEL_CHAR_W) / 2 <= STAGE_WIDTH + STAGE_BLEED;
    return {
      id: `cohort-${r.cohort}`,
      kind: 'slab',
      x: r.fromTick,
      y: Math.round((RAIL_TOP - i * RAIL_PITCH) * 100) / 100,
      w,
      h: RAIL_H,
      d: 0.24,
      tone: 'ink',
      state: r.state,
      label: fits ? full : `#${r.cohort}`,
      sublabel: RAIL_ROLE[r.doing],
      domRowId: `cohort-${r.cohort}`,
    };
  });

  const rules: SceneRule[] = [
    {
      id: 'days',
      axis: 'x',
      at: DAY_RULE_Y,
      from: 0,
      to: TICK_COUNT,
      tone: 'dim',
      ticks: [...BOUNDARY_NUMERATORS, TICK_COUNT].map((n) => ({
        at: n,
        label: dayTickLabel(boundaryBlock(n, L)),
      })),
    },
    {
      id: 'now',
      axis: 'y',
      at: nowTick,
      from: NOW_FROM,
      to: NOW_TO,
      tone: sim.flags.deadManEngaged ? 'alarm' : 'ink',
      label: sim.flags.deadManEngaged ? 'halted' : 'now',
    },
  ];

  // Participial clauses, so the sentence stays grammatical however many cohorts
  // are in each stage — the pipeline is short one rail for the first k+1 epochs.
  const clause = (doing: CohortRail['doing'], text: string): string | null => {
    const names = rails.filter((r) => r.doing === doing).map((r) => `cohort ${r.cohort}`);
    return names.length === 0 ? null : `${names.join(' and ')} — ${text}`;
  };
  const clauses = [
    clause('Trades', 'trading, and only while Trade is open'),
    clause('Measured', 'under measurement across every tick'),
    clause('Settles', 'settling inside the final tick'),
    clause('Live', 'still open'),
  ].filter((c): c is string => c !== null);

  return {
    nodes: [...teeth, ...phaseBars, windowBand, ...railNodes],
    rules,
    relation:
      `Simultaneity. The ruler along the top and the ${rails.length} bars below it are the same ` +
      `${formatDurationHuman(L)}, not ${rails.length} epochs one after another: ` +
      `${clauses.join('; ')}. A cohort stays non-terminal for k + 2 epochs, so capital committed ` +
      `at the close of trading is not released for ${formatDurationHuman(hold.earliest)} to ` +
      `${formatDurationHuman(hold.latest)} — which is why these bars overlap instead of queueing.`,
    unitLegend:
      `Each tooth is one of the ${TICK_COUNT} equal ticks of one epoch: ` +
      `${formatDuration(L / TICK_COUNT)}.`,
  };
}

export function EpochClockScene({ sim }: { sim: SimState }): JSX.Element {
  const L = sim.epochLength;
  const boundaries = phaseBoundaries(L);
  const currentPhase = phaseAt(sim.blockInEpoch, L);
  const currentBoundary = boundaries.find(
    (b) => sim.blockInEpoch >= b.startBlock && sim.blockInEpoch < b.endBlock,
  );
  const remaining = Math.max(
    0,
    (currentBoundary === undefined ? L : currentBoundary.endBlock) - sim.blockInEpoch,
  );

  const decWindowBlocks = value('dec.window');
  const decTrailingBlocks = value('dec.trailing');
  const accrual = decisionWindow(L, decWindowBlocks);
  const trailing = trailingWindow(L, decTrailingBlocks);
  const trade = tradeWindow(L);

  // `dec.window` is capped twice over: doc 13 §1's registry ceiling and doc 05
  // §3.1's `≤ 13/21 · epoch.length`. The tighter one binds, and at the genesis
  // length that is the registry — so "the whole Trade phase" alone would be wrong.
  const decWindowCeiling = param('dec.window').max;
  const decWindowLegalMax =
    decWindowCeiling === undefined ? trade.blocks : Math.min(decWindowCeiling, trade.blocks);

  const k = value('epoch.horizon_k');
  const rails = cohortRails(sim);
  const capacity = cohortCapacity(k);
  const overCapacity = cohortCapacity(DERIVED_MAX_HORIZON_K + 1);
  const hold = capitalDuration(sim);

  // The registry default and the simulated clock are the same number here, and
  // the tag says so only while that stays true.
  const epochLengthTag =
    L === value('epoch.length')
      ? spec(L, LENGTH_CITE, 'The scenario runs at the doc 13 genesis default.')
      : simulated(L, 'This scenario runs a non-default epoch length.');

  // Stated as a count of ticks rather than as "13", so the note cannot outlive a
  // change to the kernel fractions it is describing.
  const tradeTicks = L === 0 ? 0 : Math.round(trade.blocks / (L / TICK_COUNT));

  // The turning view reads the same `phaseArcs` geometry the flat dial does, so
  // an illegal epoch length shows up as fractional ticks in both rather than as
  // a silently pretty ring in one of them.
  const windowArc = decideWindowArc(L, decWindowBlocks);
  const motion: MotionSpec = {
    kind: 'turning-clock',
    props: {
      epoch: sim.epoch,
      epochLength: L,
      blockInEpoch: sim.blockInEpoch,
      arcs: phaseArcs(L).map((a) => ({
        name: a.phase,
        fromTick: a.fromTick,
        toTick: a.toTick,
      })),
      activePhase: currentPhase,
      decideWindow: {
        name: 'Decision window',
        fromTick: windowArc.fromTick,
        toTick: windowArc.toTick,
      },
      stopped: sim.flags.deadManEngaged,
    },
  };

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame model={buildModel(sim)} motion={motion} title="The epoch clock" />
      </div>

      <div className="col-rail epoch-rail">
        <Lede>
          The chain runs to a repeating timetable, and one round of it is called an{' '}
          <Jargon word="epoch" />. <strong>Every epoch does the same six things in the same
          order</strong>: take in proposals, check them, open markets on them, let people trade,
          read the prices, and settle up. Nothing jumps the queue, so you can say today when a
          proposal filed next week will get its answer. Each step is started by whichever{' '}
          <Jargon word="keeper" /> submits the call first — there is no scheduler and no operator.
        </Lede>

        <KeyFacts>
          <KeyFact label="One epoch" note="the whole cycle, then it starts again">
            <Value of={epochLengthTag} format={formatDurationHuman} />
          </KeyFact>
          <KeyFact label="One tick" note={`the epoch is cut into ${TICK_COUNT} equal ticks`}>
            <Value
              of={derived(L / TICK_COUNT, KERNEL_FRACTION_CITE)}
              format={formatDurationHuman}
            />
          </KeyFact>
          <KeyFact label="Trading is open for" note={`${tradeTicks} of the ${TICK_COUNT} ticks`}>
            <Value of={derived(trade.blocks, SCHEDULE_CITATION)} format={formatDurationHuman} />
          </KeyFact>
          <KeyFact
            label="Groups running at once"
            note={
              `each group of proposals stays open for ${capacity.concurrent} epochs, ` +
              `so that many overlap`
            }
          >
            <Value of={derived(capacity.concurrent, COHORT_CITATION)} />
          </KeyFact>
        </KeyFacts>

        <section className="panel">
          <h2 className="panel__title">Where the chain is right now</h2>
          <div className="epoch-now">
            <KernelDial
              epochLength={L}
              blockInEpoch={sim.blockInEpoch}
              epochIndex={sim.epoch}
              decWindowBlocks={decWindowBlocks}
              size={140}
              variant="section"
              paused={sim.flags.deadManEngaged}
              frozen={sim.flags.ledgerFrozen}
            />
            <div className="statgrid epoch-now__grid">
              <div className="stat">
                <span className="stat__label">Epoch</span>
                <span className="stat__value">
                  <Value of={simulated(sim.epoch)} />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Phase</span>
                <span className="stat__value">
                  <span className="chip chip--state">{currentPhase}</span>
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Block in epoch</span>
                <span className="stat__value">
                  <Value of={simulated(sim.blockInEpoch)} format={blockNumber} unit="blocks" />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">To the next boundary</span>
                <span className="stat__value epoch-pair">
                  <Value
                    of={derived(remaining, SCHEDULE_CITATION)}
                    format={blockNumber}
                    unit="blocks"
                  />
                  <span className="epoch-sep">·</span>
                  <Value of={derived(remaining, SCHEDULE_CITATION)} format={formatDurationHuman} />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">epoch.length</span>
                <span className="stat__value epoch-pair">
                  <Value of={epochLengthTag} format={blockNumber} unit="blocks" />
                  <span className="epoch-sep">·</span>
                  <Value of={epochLengthTag} format={formatDurationHuman} />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">One tick</span>
                <span className="stat__value epoch-pair">
                  <Value
                    of={derived(L / TICK_COUNT, KERNEL_FRACTION_CITE)}
                    format={blockNumber}
                    unit="blocks"
                  />
                  <span className="epoch-sep">·</span>
                  <Value
                    of={derived(L / TICK_COUNT, KERNEL_FRACTION_CITE)}
                    format={formatDurationHuman}
                  />
                </span>
              </div>
            </div>
          </div>
          {sim.flags.deadManEngaged ? (
            <p className="panel__note">
              <span className="chip chip--safety">dead-man engaged</span> The epoch clock is
              paused: the execution queue freezes and every open decision window extends day for
              day, so the readings above are the last ones the chain took. Resuming costs one
              proposal-free recovery epoch, and the coretime-renewal call is the one exemption.
            </p>
          ) : null}
          {sim.flags.ledgerFrozen ? (
            <p className="panel__note">
              <span className="chip chip--safety">ledger freeze</span> PB-LEDGER-FREEZE is active,
              so every ledger and market call is refused while the I-4 drift flag stands. It does
              not stop the clock — a freeze answers a solvency anomaly, not a stalled chain — so
              the phase above keeps advancing underneath it.
            </p>
          ) : null}
        </section>

        <Depth
          title="The exact block ranges of all six steps"
          hint={`${boundaries.length} phases`}
        >
          <section className="panel">
            <h2 className="panel__title">The six scheduled phases</h2>
            <table className="epoch-phases">
              <caption className="sr-only">
                The six phases that own a fixed fraction of the epoch, with their start and end
                blocks at the current epoch length.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Phase</th>
                  <th scope="col">Opens at</th>
                  <th scope="col" className="numeric">
                    Start
                  </th>
                  <th scope="col" className="numeric">
                    End
                  </th>
                  <th scope="col" className="numeric">
                    Span
                  </th>
                  <th scope="col">Work</th>
                </tr>
              </thead>
              <tbody>
                {boundaries.map((b) => (
                  <tr
                    key={b.phase}
                    id={`phase-${b.phase}`}
                    data-current={b.phase === currentPhase ? 'true' : 'false'}
                  >
                    <th scope="row">
                      {b.phase}
                      {b.phase === currentPhase ? (
                        <>
                          {' '}
                          <span className="chip chip--state">now</span>
                        </>
                      ) : null}
                    </th>
                    <td>
                      <span className="kernel-fraction">
                        <Value
                          of={spec(`${b.numerator}/${TICK_COUNT}`, KERNEL_FRACTION_CITE)}
                        />
                      </span>
                    </td>
                    <td className="numeric">
                      <Value of={derived(b.startBlock, SCHEDULE_CITATION)} format={blockNumber} />
                    </td>
                    <td className="numeric">
                      <Value of={derived(b.endBlock, SCHEDULE_CITATION)} format={blockNumber} />
                    </td>
                    <td className="numeric">
                      <Value
                        of={derived(b.blocks, SCHEDULE_CITATION)}
                        format={formatDurationHuman}
                      />
                    </td>
                    <td className="epoch-work">
                      <Value of={spec(PHASE_WORK[b.phase], WORK_CITE)} className="is-prose" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="panel__note">
              Intervals are half-open: a phase owns <span className="mono">[start, end)</span>, and
              the six of them tile the epoch with no gap and no overlap. Every start block is{' '}
              <span className="mono">
                floor(L · n / <Value of={spec(TICK_COUNT, KERNEL_FRACTION_CITE)} />)
              </span>
              , the same integer division the runtime performs. The drawing labels Housekeeping{' '}
              <span className="mono">Settle</span>, which is its headline work — the name in this
              table is the one the chain uses.
            </p>
            <p className="panel__note">
              Every duration in this scene is printed twice — as blocks and as human time — because
              the chain measures in blocks and an amendment moves the block count, not the calendar.
              Both halves come from the same arithmetic, so they cannot drift apart.
            </p>
          </section>
        </Depth>

        <Depth title="How the price that decides is measured" hint="2 windows">
          <section className="panel">
            <h2 className="panel__title">Two sub-ranges inside Trade</h2>
            <table>
              <caption className="sr-only">
                The decision-window and trailing sub-ranges, which are anchored to the close of
                trading rather than to a kernel fraction.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Sub-range</th>
                  <th scope="col">Key</th>
                  <th scope="col" className="numeric">
                    Opens
                  </th>
                  <th scope="col" className="numeric">
                    Length
                  </th>
                  <th scope="col" className="numeric">
                    Nominal tick
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr id="window-accrual">
                  <th scope="row">Decision-window TWAP accrual</th>
                  <td className="mono">dec.window</td>
                  <td className="numeric">
                    <Value of={derived(accrual.startBlock, SCHEDULE_CITATION)} format={blockNumber} />
                  </td>
                  <td className="numeric">
                    <Value of={spec(decWindowBlocks, WINDOW_CITE)} format={formatDurationHuman} />
                  </td>
                  <td className="numeric">
                    <span className="kernel-fraction">
                      <Value
                        of={spec(
                          `${DECIDE_WINDOW_START_NUMERATOR}/${TICK_COUNT}`,
                          KERNEL_FRACTION_CITE,
                        )}
                      />
                    </span>
                  </td>
                </tr>
                <tr id="window-trailing">
                  <th scope="row">Trailing convergence window</th>
                  <td className="mono">dec.trailing</td>
                  <td className="numeric">
                    <Value of={derived(trailing.startBlock, SCHEDULE_CITATION)} format={blockNumber} />
                  </td>
                  <td className="numeric">
                    <Value of={spec(decTrailingBlocks, WINDOW_CITE)} format={formatDurationHuman} />
                  </td>
                  <td className="numeric">—</td>
                </tr>
              </tbody>
            </table>
            <p className="panel__note">
              The hatched band on the drawing is the first of these: the price that decides is the
              average over that band, not the last price anyone paid. Neither sub-range is a phase.
              Both are absolute block counts measured backwards from the close of trading, so the
              nominal tick in the last column holds only at the genesis default — amend{' '}
              <span className="mono">dec.window</span> and the accrual boundary slides off its
              tooth, which is exactly why the clock anchors it to Trade&rsquo;s close rather than to
              a fraction. Two independent bounds cap it and the tighter one binds: doc 05 §3.1
              forbids a window longer than the whole Trade phase —{' '}
              <Value
                of={derived(trade.blocks, TRADE_BOUND_CITE)}
                format={blockNumber}
                unit="blocks"
              />{' '}
              at this length
              {decWindowCeiling === undefined ? (
                ' — and doc 13 §1 gives the key its own hard ceiling.'
              ) : (
                <>
                  {' '}
                  — and doc 13 §1 gives the key its own hard ceiling of{' '}
                  <Value
                    of={spec(decWindowCeiling, WINDOW_CITE)}
                    format={blockNumber}
                    unit="blocks"
                  />
                  .
                </>
              )}{' '}
              The largest legal value here is therefore{' '}
              <Value
                of={derived(decWindowLegalMax, WINDOW_CITE)}
                format={blockNumber}
                unit="blocks"
              />
              .
            </p>
          </section>
        </Depth>

        <Depth
          title="Which groups of proposals are alive right now"
          hint={`${rails.length} cohorts`}
        >
          <section className="panel">
            <h2 className="panel__title">Cohorts alive in this epoch</h2>
            <table>
              <caption className="sr-only">
                The non-terminal cohorts during the current epoch, and the epochs each one trades,
                measures and settles in.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Cohort</th>
                  <th scope="col">Role this epoch</th>
                  <th scope="col" className="numeric">
                    Trades in
                  </th>
                  <th scope="col" className="numeric">
                    Measures
                  </th>
                  <th scope="col" className="numeric">
                    Settles at
                  </th>
                </tr>
              </thead>
              <tbody>
                {rails.map((r) => (
                  <tr key={r.cohort} id={`cohort-${r.cohort}`}>
                    <th scope="row">
                      <Value of={simulated(r.cohort)} />
                    </th>
                    <td>
                      <span className="chip chip--state">{r.doing}</span>
                      {r.leg !== null ? (
                        <>
                          {' '}
                          <span className="label">
                            leg <Value of={simulated(r.leg)} /> of{' '}
                            <Value of={spec(k, HORIZON_CITE)} />
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="numeric">
                      <Value of={simulated(r.trades)} />
                    </td>
                    <td className="numeric">
                      {r.measures.map((m, i) => (
                        <span key={m}>
                          {i > 0 ? <span className="epoch-sep"> · </span> : null}
                          <Value of={simulated(m)} />
                        </span>
                      ))}
                    </td>
                    <td className="numeric">
                      <Value of={simulated(r.settlesAt)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="panel__note">
              A cohort trades in epoch <span className="mono">e</span>, is measured over{' '}
              <span className="mono">e+1 … e+k</span>, and settles in the Housekeeping of{' '}
              <span className="mono">e+k+1</span> — not at that epoch&rsquo;s open. Settlement is
              the last thing the epoch does, which is why the rail for the oldest cohort occupies
              only the final tick.
            </p>
          </section>
        </Depth>

        <Depth title="Why the epoch is divided into 21" hint="and which lengths are legal">
          <section className="panel">
            <h2 className="panel__title">
              Why the denominator is <Value of={spec(TICK_COUNT, KERNEL_FRACTION_CITE)} />
            </h2>
            <p>
              The chain stores no absolute phase offsets. Every boundary is the fraction{' '}
              <span className="mono">
                n/
                <Value of={spec(TICK_COUNT, KERNEL_FRACTION_CITE)} />
              </span>{' '}
              of <span className="mono">epoch.length</span>, evaluated as integer division, so the
              whole calendar moves with one number. That is also the constraint on that number:{' '}
              <span className="mono">epoch.length</span> must be a multiple of{' '}
              <Value of={spec(TICK_COUNT, KERNEL_FRACTION_CITE)} />, or a boundary would fall
              between two blocks and the floor would silently move it.
            </p>
            <dl className="epoch-defs">
              <dt>Verdict on the current length</dt>
              <dd>
                <Value
                  of={derived(validateEpochLength(L).reason, LENGTH_CITE)}
                  className="is-prose"
                />
              </dd>
              <dt>Legal range</dt>
              <dd className="epoch-pair">
                <Value
                  of={spec(PRODUCTION_MIN_EPOCH_LENGTH_BLOCKS, LENGTH_CITE)}
                  format={blockNumber}
                  unit="blocks"
                />
                <span className="epoch-sep">to</span>
                <Value
                  of={spec(PRODUCTION_MAX_EPOCH_LENGTH_BLOCKS, LENGTH_CITE)}
                  format={blockNumber}
                  unit="blocks"
                />
              </dd>
              {UNSCHEDULED_PHASES.map((p) => (
                <div key={p}>
                  <dt>{p} — no fraction, deliberately</dt>
                  <dd>
                    {p === 'Review'
                      ? 'A timelock measured from the moment decide() ran, and its length depends on the proposal’s class. It has no fixed place in the epoch, so it cannot be drawn as a wedge.'
                      : 'A permissionless dispatch inside a per-class grace window. It may land in any phase, or in a later epoch entirely, so the dial deliberately offers it no slot.'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="panel__note">
              The fractions themselves are kernel constants compiled into the runtime, not registry
              rows: no parameter amendment can reach them, and moving one takes a runtime upgrade —
              a CODE proposal, with the attestation and lead time that carries. Only the length they
              scale is governable, and only within the bounds above.
            </p>
          </section>
        </Depth>

        <Depth title="Why the measurement horizon cannot go past 2" hint="derived, not chosen">
          <section className="panel">
            <h2 className="panel__title">The horizon ceiling is derived, not chosen</h2>
            <p>
              One cohort forms per epoch and stays non-terminal for{' '}
              <span className="mono">k + 2</span> of them — it trades, is measured for{' '}
              <span className="mono">k</span> epochs, and settles in the next. The runtime can hold
              no more non-terminal cohorts than the kernel cap below, so the horizon has a ceiling
              nobody picked — it falls out of the arithmetic.
            </p>
            <div className="statgrid">
              <div className="stat">
                <span className="stat__label">epoch.horizon_k in force</span>
                <span className="stat__value">
                  <Value of={spec(k, HORIZON_CITE)} unit="epochs" />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Concurrent cohorts</span>
                <span className="stat__value">
                  <Value of={derived(capacity.concurrent, COHORT_CITATION)} />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Kernel cap</span>
                <span className="stat__value">
                  <Value of={spec(capacity.cap, CAP_CITE)} />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Derived max horizon</span>
                <span className="stat__value">
                  <Value of={derived(DERIVED_MAX_HORIZON_K, COHORT_CITATION)} unit="epochs" />
                </span>
              </div>
              <div className="stat">
                <span className="stat__label">Capital duration</span>
                <span className="stat__value epoch-pair">
                  <Value
                    of={derived(hold.earliest, COHORT_CITATION)}
                    format={formatDurationHuman}
                  />
                  <span className="epoch-sep">to</span>
                  <Value of={derived(hold.latest, COHORT_CITATION)} format={formatDurationHuman} />
                </span>
              </div>
            </div>
            <p className="panel__note">
              <Value of={derived(capacity.reason, COHORT_CITATION)} className="is-prose" />
            </p>
            <p className="panel__note">
              <Value of={derived(overCapacity.reason, COHORT_CITATION)} className="is-prose" /> That
              wedge was reachable through a lawful amendment inside the key&rsquo;s own published
              bounds until the derivation was written into them: doc 13 §1 now publishes the derived
              ceiling above as <span className="mono">epoch.horizon_k</span>&rsquo;s own hard max,
              and the row is kernel-bounded, so <span className="mono">amend_registry</span> refuses
              to move that bound at all. The ceiling is normative rather than advisory because the
              state it excludes is permanent.
            </p>
          </section>
        </Depth>
      </div>
    </div>
  );
}
