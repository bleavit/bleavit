import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { LegendEntry, SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import {
  DESCRIPTOR_LEAD_TIME_BLOCKS,
  KERNEL_CITATION,
  MIGRATION_STALL_BLOCKS,
} from '../../protocol/constants';
import { formatBlocks, formatDuration, formatDurationHuman } from '../../protocol/epoch';
import { param } from '../../protocol/params';
import { derived, spec } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede, Term } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './the-upgrade.css';

/**
 * The upgrade — doc 09 §2, §3.2 and §7.
 *
 * One idea carries this scene and it is an ordering, not a mechanism: the chain
 * decides **which** program it will accept, then waits three days, and only then
 * does anybody hand over the bytes. Two moves, and the gap between them is the
 * safety property. Collapse it and every wallet, every pinned frontend and every
 * integrator finds out about a rule change at the moment it takes effect.
 *
 * The single mistake a reader makes by default is to read the wait as one of the
 * conditions `execute` checks. It is not, and it cannot be: the wait *starts*
 * when `execute` succeeds, because executing is what authorizes the upgrade
 * (doc 09 §1.2 lists eleven dispatch-time checks and the lead time is none of
 * them; doc 11 §11.5 deleted the row that once claimed otherwise). So the canvas
 * puts the wait strictly between the two steps, never inside the first, and the
 * rail says so in the plainest words available.
 *
 * The second idea is one no reader will have met before, and it is the elegant
 * one: **recovery is chosen before the lock, not after.** Every primary runtime
 * ships with a paired repair runtime built from the same commit at the next
 * version. If the conversion jams, the chain stops accepting anything from the
 * outside — and the only bytes installable from that state are the ones everyone
 * already approved, months earlier, when nothing was wrong. Guardians cannot
 * dispatch around it and neither can the founding key.
 *
 * The drawing is a timeline and nothing else. There is no motion: an ordering
 * with a compulsory gap is exactly the relation a plane carries best, and a
 * camera would add a dimension that holds no fact.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const C_FLOW: Citation = cite('09', '§2.1', 'the two-phase authorize/apply flow, step by step');
const C_LEAD: Citation = cite('09', '§2.2', 'DescriptorLeadTime — the gap between authorizing and applying');
const C_CHECKS: Citation = cite('09', '§1.2', 'the eleven dispatch-time checks execute performs');
const C_CHANNEL: Citation = cite('09', '§2.3', 'ReleaseChannel — the fixed-layout, metadata-free storage key');
const C_ATTEST: Citation = cite('09', '§2.4', 'the bonded attestor registry and its 2-of-3 quorum');
const C_EVENT: Citation = cite('02', '§6', 'UpgradeAuthorized is frozen at two fields');
const C_MIGRATION: Citation = cite('09', '§3.2', 'PB-MIGRATION — triggers, the stall budget and the halt');
const C_RECOVERY: Citation = cite(
  '09',
  '§3.2',
  'the paired terminal-recovery image, frozen at authorization (SQ-309)',
);
const C_EXPEDITED: Citation = cite(
  '09',
  '§3.1',
  'the expedited CODE lane — DescriptorLeadTime applies in full',
);
const C_PHASES: Citation = cite('09', '§7.1', 'the rollout phase table and its gates');
const C_SUDO: Citation = cite('09', '§7.2', 'sudo removal at the Phase 3 to 4 transition');
const C_BOOTSTRAP: Citation = cite('09', '§5.3', 'bootstrap authority: a 4-of-6 founding multisig');
const C_FILTERED: Citation = cite('09', '§5.1', 'calls filtered from genesis for every origin, sudo included');
const C_CAPS: Citation = cite('09', '§5.2', 'the Phase-3 real-money exposure caps');

/** Implementation citations — read, not assumed. */
const C_CT_SUDO: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/lib.rs',
  '#[cfg(feature = "bootstrap")] Sudo: pallet_sudo = 28, inside construct_runtime!',
);
const C_PROFILES: Citation = cite(
  'code',
  'tools/release/runtime-profiles.json',
  'the release build profiles and their exact Cargo feature sets',
);
const C_MIGRATION_SRC: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/migrations.rs',
  'VersionedMigration — the storage-version bump ships with its own data step',
);
const C_RECOVERY_SRC: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/tests_b15_recovery.rs',
  'every cutpoint the primary can stop at, repaired by the paired image',
);

// ---------------------------------------------------------------------------
// Facts this scene is built from
// ---------------------------------------------------------------------------

/**
 * The two base build profiles, and the recovery variant of each.
 *
 * `bootstrap` and `phase-four` are mutually exclusive at compile time — the
 * runtime refuses to build with both or with neither — and `recovery` is an
 * overlay on whichever base is selected, so four named profiles come out of two
 * choices. `Sudo` is inside `construct_runtime!` under `#[cfg(feature =
 * "bootstrap")]`, which is why the phase-four pair has no sudo pallet to switch
 * off: there is nothing there to switch.
 */
const BUILD_PROFILES: readonly {
  readonly name: string;
  readonly base: string;
  readonly recovery: boolean;
  readonly sudo: boolean;
  readonly migrations: string;
}[] = Object.freeze([
  { name: 'bootstrap', base: 'bootstrap', recovery: false, sudo: true, migrations: 'normal' },
  { name: 'bootstrap-recovery', base: 'bootstrap', recovery: true, sudo: true, migrations: 'disabled' },
  { name: 'phase-four', base: 'phase-four', recovery: false, sudo: false, migrations: 'normal' },
  { name: 'phase-four-recovery', base: 'phase-four', recovery: true, sudo: false, migrations: 'disabled' },
]);

/** The two mutually exclusive base profiles, read out rather than restated. */
const BASE_PROFILES: readonly string[] = Object.freeze([
  ...new Set(BUILD_PROFILES.map((p) => p.base)),
]);

/**
 * The rollout, doc 09 §7.1. Eight phases, 0 through 7.
 *
 * `binds` is the column that matters to a reader and the one the phase table
 * states obliquely: a market can be trading real money for months while the
 * result it produces is written down and not acted on. That is Phase 3, and it
 * is deliberate.
 */
interface Phase {
  readonly n: number;
  readonly name: string;
  /** What this phase turns on that the one before it did not have. */
  readonly arms: string;
  /** Whether the money at stake is real. */
  readonly real: boolean;
  /** What a passing market actually causes. */
  readonly binds: string;
}

const PHASES: readonly Phase[] = Object.freeze([
  {
    n: 0,
    name: 'Reference and simulation',
    arms: 'Nothing is deployed. The independent model and the pallets must agree on shared vectors, and the economics are simulated.',
    real: false,
    binds: 'nothing — there is no chain yet',
  },
  {
    n: 1,
    name: 'Local nets',
    arms: 'A private network, run unattended for three epochs, including drills for losing collators, losing keepers and jamming a conversion.',
    real: false,
    binds: 'nothing outside the test network',
  },
  {
    n: 2,
    name: 'Public testnet and bounties',
    arms: 'Every proposal class, on play money, with a paid bounty programme trying to break it.',
    real: false,
    binds: 'testnet state only',
  },
  {
    n: 3,
    name: 'Mainnet shadow futarchy',
    arms: 'Real money on the real chain, under a global cap and a per-account cap. The founding key is still present.',
    real: true,
    binds: 'nothing — verdicts are recorded, and the guard is disconnected',
  },
  {
    n: 4,
    name: 'Binding parameter changes',
    arms: 'The founding key is removed, and the first class of decision starts taking effect.',
    real: true,
    binds: 'parameter changes only',
  },
  {
    n: 5,
    name: 'Treasury spending',
    arms: 'Money can be voted out of the treasury, in streams rather than lump sums above one percent of its worth.',
    real: true,
    binds: 'parameters and treasury spending',
  },
  {
    n: 6,
    name: 'Code and rule changes',
    arms: 'The markets may finally change the chain’s own program — the thing this whole scene is about.',
    real: true,
    binds: 'everything, with a mandatory confirming vote on code',
  },
  {
    n: 7,
    name: 'Mature',
    arms: 'The emergency committee is reduced to pre-approved playbooks, and its own retirement is scheduled.',
    real: true,
    binds: 'everything',
  },
]);

/** Phase 3's exit criterion is "≥ 6 epochs" (09 §7.1), and an epoch is 13 §1's `epoch.length`. */
const PHASE3_MIN_EPOCHS = 6;

/** The phase in which real markets run and their verdicts do not bind. */
const SHADOW_PHASE = 3;

/** The phase at which the markets first get to change the program itself. */
const CODE_PHASE = 6;

// ---------------------------------------------------------------------------
// Geometry — a timeline, left to right
// ---------------------------------------------------------------------------

/**
 * Four lanes stacked on one time axis.
 *
 * Every lane is read across, and the two vertical rules are read down: the same
 * instant in all four lanes at once. That is the whole reason this is a drawing
 * rather than a list — "the chain stops taking transactions at the same moment
 * the new program lands" is a statement about two lanes sharing an x.
 *
 * Labels are centred under their node's bottom edge, so `y` alone decides which
 * text row a label lands on. The four lanes are pitched far enough apart that no
 * two of them can share a row, and inside each lane every same-row pair is
 * checked against `(len_a + len_b) · 0.13 + 0.3` in the test — the width two
 * centred labels need between their centres.
 */
const X_START = 0.6;
const X_END = 20.4;

/** Step 1: a successful `execute` authorizes a code hash. */
const AUTHORIZE_X = 4.55;
/** Step 2: the earliest block at which anyone may hand over the bytes. */
const APPLY_X = 11.6;
/** Where the conversion finishes and ordinary traffic resumes. */
const MIGRATED_X = 16.4;

const GATE_W = 1.8;

const LANE_CODE_Y = 9.3;
const LANE_CODE_H = 1.5;
const LANE_STEP_Y = 6.3;
const LANE_STEP_H = 1.8;
const LANE_TX_Y = 3.5;
const LANE_TX_H = 1.6;
const LANE_SPARE_Y = 1.4;
const LANE_SPARE_H = 1.4;

/** The time axis, below everything it measures. */
const TRACK_Y = 0.75;
/** How far up the two gate rules run. Above the top lane, so they read as instants. */
const GATE_TOP = 11.0;

const WAIT_H = 0.3;

/** The spare runtime is committed before step 1 and frozen by it. */
const SPARE_X = 1.6;
const SPARE_W = 3.9;

const gateX = (centre: number): number => centre - GATE_W / 2;

/**
 * The model.
 *
 * The one thing that varies with the simulation is whether the conversion is
 * jammed: `flags.migrationHalt` is the chain's own halt-at-fault state, and it
 * is the only state in this scene that earns the alarm tone. Everything else is
 * an ordering, and an ordering does not have good and bad days.
 */
export function buildModel(sim: SimState): SceneModel {
  const halted = sim.flags.migrationHalt;

  const nodes: SceneNode[] = [
    // --- lane 1: which program is installed ---------------------------------
    {
      id: 'code-old',
      kind: 'slab',
      x: X_START,
      y: LANE_CODE_Y,
      w: APPLY_X - X_START,
      h: LANE_CODE_H,
      tone: 'ink',
      state: 'active',
      label: 'Old program',
      sublabel: 'a value in storage',
      domRowId: 'up-row-old',
    },
    {
      id: 'code-new',
      kind: 'slab',
      x: APPLY_X,
      y: LANE_CODE_Y,
      w: X_END - APPLY_X,
      h: LANE_CODE_H,
      tone: 'ink',
      state: 'active',
      label: 'New program',
      sublabel: 'same slot, new bytes',
      domRowId: 'up-row-new',
    },

    // --- lane 2: the two steps, and the gap that is the point ---------------
    {
      id: 'authorize',
      kind: 'stop',
      x: gateX(AUTHORIZE_X),
      y: LANE_STEP_Y,
      w: GATE_W,
      h: LANE_STEP_H,
      tone: 'ink',
      state: 'passed',
      label: 'Authorize',
      sublabel: 'the decision executes',
      domRowId: 'up-row-authorize',
    },
    {
      id: 'wait',
      kind: 'tie',
      x: gateX(AUTHORIZE_X) + GATE_W,
      y: LANE_STEP_Y + LANE_STEP_H / 2 - WAIT_H / 2,
      w: gateX(APPLY_X) - (gateX(AUTHORIZE_X) + GATE_W),
      h: WAIT_H,
      tone: 'dim',
      state: 'blocked',
      label: `${formatDurationHuman(DESCRIPTOR_LEAD_TIME_BLOCKS)} wait`,
      sublabel: formatBlocks(DESCRIPTOR_LEAD_TIME_BLOCKS),
      domRowId: 'up-row-wait',
    },
    {
      id: 'apply',
      kind: 'stop',
      x: gateX(APPLY_X),
      y: LANE_STEP_Y,
      w: GATE_W,
      h: LANE_STEP_H,
      tone: 'ink',
      state: 'passed',
      label: 'Apply',
      sublabel: 'anyone may submit',
      domRowId: 'up-row-apply',
    },

    // --- lane 3: what everybody else can do ---------------------------------
    // The conversion is drawn as a band because that is what it is: a stretch of
    // time in which the chain refuses everything submitted from outside, rather
    // than a step somebody takes.
    {
      id: 'chain-open',
      kind: 'slab',
      x: X_START,
      y: LANE_TX_Y,
      w: APPLY_X - X_START,
      h: LANE_TX_H,
      tone: 'ink',
      state: 'active',
      label: 'Chain open',
      sublabel: 'transactions accepted',
      domRowId: 'up-row-open',
    },
    {
      id: 'migration',
      kind: 'stop',
      x: APPLY_X,
      y: LANE_TX_Y,
      w: MIGRATED_X - APPLY_X,
      h: LANE_TX_H,
      tone: halted ? 'alarm' : 'ink',
      state: 'blocked',
      label: 'Migration',
      sublabel: halted ? 'jammed, nothing moves' : 'nothing else runs',
      domRowId: 'up-row-migration',
    },
    {
      id: 'reopen',
      kind: 'slab',
      x: MIGRATED_X,
      y: LANE_TX_Y,
      w: X_END - MIGRATED_X,
      h: LANE_TX_H,
      tone: 'ink',
      state: halted ? 'pending' : 'active',
      label: 'Open again',
      sublabel: halted ? 'not reached' : 'traffic resumes',
      domRowId: 'up-row-reopen',
    },

    // --- lane 4: the repair, committed before anything can go wrong ---------
    {
      id: 'spare',
      kind: 'slab',
      x: SPARE_X,
      y: LANE_SPARE_Y,
      w: SPARE_W,
      h: LANE_SPARE_H,
      tone: 'ink',
      state: halted ? 'active' : 'inactive',
      label: 'Spare code',
      sublabel: 'frozen at step 1',
      domRowId: 'up-row-spare',
    },
    // The long arrow is the argument. It leaves at the earliest moment in the
    // picture and arrives at the latest failure, which is exactly the claim:
    // the repair was chosen before there was anything to repair.
    {
      id: 'e-spare',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: halted ? 'alarm' : 'dim',
      state: halted ? 'active' : 'inactive',
      from: 'spare',
      to: 'migration',
    },
  ];

  const rules: SceneRule[] = [
    {
      id: 'timeline',
      axis: 'x',
      at: TRACK_Y,
      from: X_START,
      to: X_END,
      tone: 'dim',
      ticks: [
        { at: AUTHORIZE_X, label: 'block 0' },
        { at: APPLY_X, label: `+ ${formatBlocks(DESCRIPTOR_LEAD_TIME_BLOCKS)}` },
        { at: MIGRATED_X, label: 'converted' },
      ],
    },
    {
      id: 'gate-authorize',
      axis: 'y',
      at: AUTHORIZE_X,
      from: TRACK_Y,
      to: GATE_TOP,
      tone: 'ink',
      label: 'step 1',
    },
    {
      id: 'gate-apply',
      axis: 'y',
      at: APPLY_X,
      from: TRACK_Y,
      to: GATE_TOP,
      tone: 'ink',
      label: 'step 2',
    },
    {
      id: 'gate-migrated',
      axis: 'y',
      at: MIGRATED_X,
      from: TRACK_Y,
      to: LANE_TX_Y + LANE_TX_H + 0.4,
      tone: 'dim',
      dashed: true,
    },
  ];

  const legend: LegendEntry[] = [
    { mark: 'ink', shape: 'stop', label: 'A step somebody takes' },
    { mark: 'ink', shape: 'slab', label: 'A stretch of time, and what is true during it' },
    { mark: 'dim', shape: 'tie', label: 'The compulsory wait — nobody may apply yet' },
    { mark: 'dim', label: 'Not in force at this moment' },
  ];
  if (halted) {
    legend.push({ mark: 'alarm', label: 'The conversion jammed, and the chain is holding' });
  }

  return {
    nodes,
    rules,
    legend,
    caption: 'Time runs left to right. Read down a vertical line to see the same instant in every lane.',
    relation:
      'An ordering with a compulsory gap, and the gap is the safety property. Step 1 writes down ' +
      'which program the chain will accept and hands over none of it; step 2 hands over the bytes ' +
      'and decides nothing. Nothing shortens the space between them — not a vote, not the founding ' +
      'key, not an emergency — because the whole point of the space is that everyone who depends ' +
      'on this chain learns what is coming before it arrives. Read the lanes together and the ' +
      'second claim falls out: the moment the new program lands is the moment ordinary ' +
      'transactions stop, and they stay stopped for as long as records are being converted. The ' +
      'arrow along the bottom is the one no reader expects — the repair leaves from before step 1 ' +
      'and arrives at the failure, because it was chosen and frozen while nothing was wrong.',
    unitLegend:
      'The axis is time, in order but not to scale. The wait is 43,200 blocks and the entire ' +
      'conversion has to finish inside 900, so a true scale would leave the conversion too small ' +
      'to see and the point of the picture is the ordering rather than the proportions.',
  };
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

function UpgradeLede() {
  return (
    <Lede>
      A blockchain&rsquo;s rules are a program, and this chain keeps its program{' '}
      <strong>inside itself</strong> — as one piece of data it is allowed to overwrite. Changing
      the rules therefore means replacing that data, and it takes two separate moves with a gap in
      between: first the chain writes down which new program it will accept, and three days later
      anybody at all may hand over the matching file. Nothing about that second move is a second
      decision. The three days exist so that every wallet, every website and every other program
      reading this chain finds out what is coming <em>before</em> it arrives, rather than at the
      moment it does. What is being replaced is called the <Jargon word="runtime" />.
    </Lede>
  );
}

function UpgradeKeyFacts() {
  return (
    <KeyFacts>
      <KeyFact
        label="The wait"
        note={`${formatBlocks(DESCRIPTOR_LEAD_TIME_BLOCKS)}, written as 72 hours in the specification. It starts when the decision executes, because executing is what authorizes the upgrade.`}
      >
        <Value of={spec(DESCRIPTOR_LEAD_TIME_BLOCKS, C_LEAD)} format={formatDurationHuman} />
      </KeyFact>
      <KeyFact
        label="Rollout phases"
        note={`Phase 0 to Phase ${PHASES.length - 1}. Real money from Phase ${SHADOW_PHASE}; the first binding verdicts at Phase ${SHADOW_PHASE + 1}; the program itself not until Phase ${CODE_PHASE}.`}
      >
        <Value of={derived(PHASES.length, C_PHASES)} />
      </KeyFact>
      <KeyFact
        label="Conversion budget"
        note={`${formatBlocks(MIGRATION_STALL_BLOCKS)}. A conversion still running after that counts as jammed, and the chain stops waiting and starts repairing.`}
      >
        <Value of={spec(MIGRATION_STALL_BLOCKS, KERNEL_CITATION)} format={formatDurationHuman} />
      </KeyFact>
    </KeyFacts>
  );
}

/**
 * The always-visible panel: one row per object on the canvas.
 *
 * It carries the bijection the test asserts, and it is out in the open rather
 * than behind a drawer because a picture whose parts are only named inside a
 * closed section is a picture a reader has to decode.
 */
function PicturePanel({ halted }: { halted: boolean }) {
  return (
    <section className="panel">
      <h2 className="panel__title">What the picture shows, in order</h2>

      <table className="up-table">
        <caption className="sr-only">Every object on the canvas, in time order</caption>
        <thead>
          <tr>
            <th scope="col">On the canvas</th>
            <th scope="col">What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr id="up-row-old">
            <th scope="row">Old program</th>
            <td>
              The rules the chain is running right now, held as a value in the chain&rsquo;s own
              storage. Upgrading is overwriting it — there is no separate installer and no
              administrator with a copy (<span className="cite">{formatCitation(C_FLOW)}</span>).
            </td>
          </tr>
          <tr id="up-row-authorize">
            <th scope="row">Authorize</th>
            <td>
              A decision that survived the markets, the confirming vote and the delay finally runs,
              and what it does is one thing: it names the fingerprint of the file the chain will
              accept. The chain now knows exactly which program is coming and holds none of it.
            </td>
          </tr>
          <tr id="up-row-wait">
            <th scope="row">The wait</th>
            <td>
              <Value of={spec(DESCRIPTOR_LEAD_TIME_BLOCKS, C_LEAD)} format={formatDuration} />.
              Submitting the file before this is over fails without the chain even looking at it.
              There is no origin, key or emergency that shortens it.
            </td>
          </tr>
          <tr id="up-row-apply">
            <th scope="row">Apply</th>
            <td>
              <strong>Anyone</strong> hands over the file whose fingerprint matches. It is not a
              privileged act and it is not a second decision — the decision was step 1, and this is
              delivery.
            </td>
          </tr>
          <tr id="up-row-new">
            <th scope="row">New program</th>
            <td>
              The same storage slot, different bytes. From the next block the chain is running new
              rules, and the old ones are simply gone.
            </td>
          </tr>
          <tr id="up-row-open">
            <th scope="row">Chain open</th>
            <td>
              Everything before the swap is an ordinary day: people trade, deposit and propose, and
              the pending upgrade changes none of that.
            </td>
          </tr>
          <tr id="up-row-migration">
            <th scope="row">Migration</th>
            <td>
              When new rules need old records in a new shape, the conversion runs a piece at a time
              across many blocks. While it runs the chain refuses everything submitted from
              outside{halted ? ' — and in this state it is jammed and refusing indefinitely' : ''}.
              Refusing is the safe answer: the alternative is letting somebody write against
              half-converted records (<span className="cite">{formatCitation(C_MIGRATION)}</span>).
            </td>
          </tr>
          <tr id="up-row-reopen">
            <th scope="row">Open again</th>
            <td>
              The conversion finishes, the chain starts accepting transactions again, and the
              upgrade is over.
            </td>
          </tr>
          <tr id="up-row-spare">
            <th scope="row">Spare code</th>
            <td>
              A second, separately built program that ships with the first one and is frozen the
              moment step 1 happens. If the conversion jams, it is the only thing installable next
              (<span className="cite">{formatCitation(C_RECOVERY)}</span>).
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/**
 * The ordering correction.
 *
 * Given its own panel, out in the open, because it is the mistake a reader makes
 * by default and a correction behind a drawer corrects nobody.
 */
function OrderingPanel() {
  return (
    <section className="panel up-panel--major">
      <h2 className="panel__title">The wait is not a check — it is what happens next</h2>
      <p id="up-row-ordering">
        It is natural to read the three days as one of the conditions the chain tests before it
        lets a decision run. It is not one of them, and it could not be. Running the decision is{' '}
        <strong>what starts the clock</strong>: the chain has nothing to wait for until something
        has told it which program to expect, and the thing that tells it is the decision executing.
        So the order is <em>execute, then wait</em>, never <em>wait, then execute</em>.
      </p>
      <p className="panel__note">
        Precisely: the chain runs eleven conditions at the moment of execution and the lead time is
        none of them (<span className="cite">{formatCitation(C_CHECKS)}</span>). It is enforced
        afterwards, on the other call, by refusing to accept the file at all while the clock is
        still running (<span className="cite">{formatCitation(C_LEAD)}</span>). The two live in
        different places because they are answering different questions.
      </p>

      <h3>What the gap is for</h3>
      <p id="up-row-gap-reason">
        Without it, new rules could land one block after the decision. Every wallet and every app
        that had not already shipped a matching description of those rules would be unable to sign
        anything at all until it did — and that blackout can easily run past three days, which
        happens to be exactly how long somebody has to answer a challenge on this chain. A rule
        change would quietly run out other people&rsquo;s clocks. The gap exists so the new
        description is published and live <em>before</em> the rules it describes are (
        <span className="cite">{formatCitation(C_LEAD)}</span>).
      </p>
      <p className="panel__note">
        It is not negotiable, and the emergency lane is the proof. That lane compresses every other
        window — the trading period, the confirming vote, even the meter that keeps code changes
        spaced apart — and leaves this one at full length, on the grounds that whatever emergency
        opened the lane is already contained (
        <span className="cite">{formatCitation(C_EXPEDITED)}</span>).
      </p>
    </section>
  );
}

function MechanicsPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The same two steps, in the chain&rsquo;s own words</h2>
      <table className="up-table">
        <caption className="sr-only">
          The runtime-upgrade path as doc 09 §2.1 enumerates it
        </caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">What the chain does</th>
            <th scope="col">Spec</th>
          </tr>
        </thead>
        <tbody>
          <tr id="up-step-commit">
            <th scope="row">Commit</th>
            <td>
              At submission the proposer commits the candidate program&rsquo;s hash, its target{' '}
              <span className="mono">spec_version</span> (exactly one above the current one), a
              metadata hash, a benchmarked migration plan, an audit-report hash and a reproducible-
              build attestation reference. Everything the markets then trade is bound to those
              commitments.
            </td>
            <td>
              <span className="cite">{formatCitation(C_FLOW)}</span>
            </td>
          </tr>
          <tr id="up-step-authorize">
            <th scope="row">Authorize</th>
            <td>
              A passing <span className="mono">execute(pid)</span> dispatches exactly{' '}
              <span className="mono">system.authorize_upgrade(code_hash)</span> under an internally
              constructed authority restricted to that one call and that one hash. It records{' '}
              <span className="mono">PendingUpgrade &#123; hash, authorized_at, applicable_at
              &#125;</span> and emits <span className="mono">UpgradeAuthorized</span>, whose shape
              is frozen at two fields — <span className="mono">applicable_at</span> is derivable
              and deliberately not carried.
            </td>
            <td>
              <span className="cite">{formatCitation(C_EVENT)}</span>
            </td>
          </tr>
          <tr id="up-step-wait">
            <th scope="row">Wait</th>
            <td>
              <span className="mono">
                now ≥ authorized_at + DescriptorLeadTime
              </span>
              . The runtime&rsquo;s own call filter consults{' '}
              <span className="mono">PendingUpgrade</span> and denies{' '}
              <span className="mono">apply_authorized_upgrade</span> while the clock runs; an early
              submission fails without touching state, whatever origin sent it.
            </td>
            <td>
              <span className="cite">{formatCitation(C_LEAD)}</span>
            </td>
          </tr>
          <tr id="up-step-apply">
            <th scope="row">Apply</th>
            <td>
              From <span className="mono">applicable_at</span>, anyone submits{' '}
              <span className="mono">system.apply_authorized_upgrade(code)</span>. The parachain
              plumbing signals the code swap to Polkadot, which has to agree before the swap
              happens.
            </td>
            <td>
              <span className="cite">{formatCitation(C_FLOW)}</span>
            </td>
          </tr>
          <tr id="up-step-record">
            <th scope="row">Record</th>
            <td>
              After the swap the chain records the version it actually observes, publishes it, and
              clears the pending state unconditionally. The published record lives at a{' '}
              <em>fixed byte layout under a fixed raw key</em>, so an app pinned to an old release
              — one that can no longer even read this chain&rsquo;s metadata — can still read that
              it is out of date.
            </td>
            <td>
              <span className="cite">{formatCitation(C_CHANNEL)}</span>
            </td>
          </tr>
          <tr id="up-step-abort">
            <th scope="row">Or: Polkadot says no</th>
            <td>
              If the relay chain aborts the swap, the chain detects it, clears the authorization,
              emits <span className="mono">UpgradeAborted</span> and raises a visible incident — and{' '}
              <strong>does not retry</strong>. The artifact has to go back through the whole
              process. A chain that re-offered a rejected upgrade on its own initiative would be
              making a decision nobody asked it to make.
            </td>
            <td>
              <span className="cite">{formatCitation(C_FLOW)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Who signs off on the bytes</h3>
      <p>
        A hash commits to a file but says nothing about whether the file was built from the source
        anybody read. That gap is closed socially and with money: at least three elected reviewers
        each post a <Jargon word="bond" />, and a program is attestable only when at least two of
        them independently rebuild it from the named source commit and get the same hash. Anyone
        may challenge an attestation for 72 hours by putting up a stake, and a challenge that
        succeeds takes the signers&rsquo; bonds and voids the record — which then fails the
        proposal at execution (<span className="cite">{formatCitation(C_ATTEST)}</span>).
      </p>
      <p className="panel__note">
        This buys reproducibility, not correctness. Deciding whether a program does what it claims
        stays a human job, and the specification says so rather than pretending otherwise.
      </p>

      <h3>There is no undo</h3>
      <p>
        A healthy runtime cannot be rolled back on chain. Replacing one is always a forward upgrade
        through this same path, with the same wait. The single exception is a genuinely jammed
        conversion, and that has its own path — described below — which installs a repair rather
        than restoring a backup (<span className="cite">{formatCitation(C_FLOW)}</span>).
      </p>
    </section>
  );
}

function MigrationPanel({ halted }: { halted: boolean }) {
  return (
    <section className="panel">
      <h2 className="panel__title">When stored records have to change shape</h2>
      <p>
        New rules sometimes need old records written differently. The conversion is called a{' '}
        <Term word="migration">
          A one-off pass that rewrites records already in storage into the shape the new rules
          expect. It runs once, at the upgrade, and never again.
        </Term>
        , and there can be far more records than fit in one block — so it runs a bounded piece at a
        time, remembering where it stopped, across as many blocks as it needs.
      </p>
      <p>
        While it is running, the chain accepts nothing from outside: no trades, no deposits, no
        proposals. Only its own internal housekeeping instructions go into a block. That is not
        caution for its own sake — it is the one rule that makes a half-finished conversion safe.
        If people could keep writing while records were half-converted, some of those writes would
        land in the old shape and some in the new, and no later pass could tell which was which
        (<span className="cite">{formatCitation(C_MIGRATION)}</span>).
      </p>

      <p className="up-chiprow">
        <span className={halted ? 'chip chip--safety' : 'chip chip--state'}>
          {halted ? 'a conversion is jammed' : 'no conversion is running'}
        </span>
        <span className="chip chip--state">
          budget{' '}
          <Value of={spec(MIGRATION_STALL_BLOCKS, KERNEL_CITATION)} format={formatDurationHuman} />
        </span>
      </p>

      <table className="up-table">
        <caption className="sr-only">The stall budget and what raises the halt</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">What it says</th>
          </tr>
        </thead>
        <tbody>
          <tr id="up-row-stall">
            <th scope="row">The budget</th>
            <td>
              A conversion whose own start block is more than{' '}
              <Value of={spec(MIGRATION_STALL_BLOCKS, KERNEL_CITATION)} format={formatDuration} />{' '}
              in the past counts as stalled. It is a time budget and deliberately{' '}
              <strong>not</strong> a test of whether the bookmark moved — a perfectly healthy
              conversion is allowed to grind through a large map while its bookmark stays
              byte-identical, and a test on the bookmark would page the emergency committee against
              a chain that was working.
            </td>
          </tr>
          <tr id="up-row-declare">
            <th scope="row">Declared in advance</th>
            <td>
              Every registered conversion must declare a maximum number of steps strictly below
              that budget, and the sum across all of them must be below it too. A build-time test
              enforces both, so an upgrade that <em>could</em> exceed the budget cannot be built,
              let alone shipped.
            </td>
          </tr>
          <tr id="up-row-triggers">
            <th scope="row">What raises the alarm</th>
            <td>
              A failed step, a stall by the rule above, a program whose observed version does not
              match the one that was authorized, or a failed cleanup after Polkadot aborted a swap.
              Four machine-checked conditions, and the list is deliberately closed.
            </td>
          </tr>
          <tr id="up-row-page">
            <th scope="row">Who is woken up</th>
            <td>
              Operators are paged at the machine trigger, not at the moment a committee votes to
              act. By the time the trigger fires the chain is already refusing transactions, so
              waiting for a quorum before telling anybody would spend the outage on procedure.
            </td>
          </tr>
        </tbody>
      </table>

      <p className="panel__note">
        The version stamp and the conversion ship together, always. A version bump without its
        conversion is the classic way to brick upgraded state, and this repository ships the two in
        one wrapper so they cannot be separated (
        <span className="cite">{formatCitation(C_MIGRATION_SRC)}</span>).
      </p>
    </section>
  );
}

function RecoveryPanel({ halted }: { halted: boolean }) {
  return (
    <section className="panel up-panel--major">
      <h2 className="panel__title">The repair is chosen before the lock, not after</h2>
      <p>
        Here is the part that is genuinely unusual. A jammed conversion is the worst state this
        chain can be in: nothing can be submitted, which means nothing can be submitted to fix it
        either. Most systems answer that with a privileged key held by somebody trusted. This one
        answers it by deciding the fix in advance.
      </p>
      <p>
        Every candidate program is built <strong>twice</strong>: the program itself, and a paired
        repair program from the <em>same source commit</em>, at exactly the next version, with all
        multi-block conversions switched off. Both are attested; both are committed with the
        proposal; both are frozen the moment step 1 happens. Later changes to who the reviewers are
        cannot strand a program that is already installed.
      </p>
      <p>
        So when the conversion jams, the chain enters a lockdown in which its own housekeeping is
        the only thing that goes into a block — and that housekeeping schedules exactly one thing:
        the repair bytes everybody approved months earlier, while nothing was wrong. There is no
        choice to be made under pressure, because the choice was made before there was any
        pressure. <strong>The emergency committee cannot dispatch around it, and neither can the
        founding key.</strong>
      </p>

      {halted ? (
        <p className="panel__note">
          In this state the conversion is jammed. The spare program on the canvas is live, and it
          is the only program that can be installed from here.
        </p>
      ) : null}

      <table className="up-table">
        <caption className="sr-only">The conditions the paired repair program must satisfy</caption>
        <thead>
          <tr>
            <th scope="col">Condition</th>
            <th scope="col">Why it is that way</th>
          </tr>
        </thead>
        <tbody>
          <tr id="up-row-pair-commit">
            <th scope="row">Same source commit</th>
            <td>
              The repair is not a different project. It is the same code, built with the conversions
              disabled, so reviewing the program is reviewing the repair.
            </td>
          </tr>
          <tr id="up-row-pair-version">
            <th scope="row">Exactly the next version</th>
            <td>
              A program at version N+1 is paired with a repair at N+2. Versions only ever rise, so
              the repair can always be installed after the program and never before it.
            </td>
          </tr>
          <tr id="up-row-pair-nomig">
            <th scope="row">No conversions of its own</th>
            <td>
              The repair registers none. A repair that could itself get stuck would be a second
              chance to reach the state it exists to escape.
            </td>
          </tr>
          <tr id="up-row-pair-cutpoint">
            <th scope="row">A repair for every stopping point</th>
            <td>
              A program is allowed to ship a multi-block conversion only if its repair can pick up
              from <em>every</em> point that conversion could have stopped at — and the release gate
              tests every one of them exhaustively rather than sampling (
              <span className="cite">{formatCitation(C_RECOVERY_SRC)}</span>).
            </td>
          </tr>
          <tr id="up-row-pair-fail">
            <th scope="row">Missing means locked</th>
            <td>
              If the repair image is absent, mismatched or cannot repair the state, everything stays
              locked. Nothing is guessed and nothing generic is attempted — a wrong repair on a
              financial ledger is worse than a stopped one.
            </td>
          </tr>
        </tbody>
      </table>

      <p className="panel__note">
        Reference: <span className="cite">{formatCitation(C_RECOVERY)}</span>. The release pipeline
        builds and binds the pair automatically — selecting a program selects its repair, at the
        same commit, at the next version (<span className="cite">{formatCitation(C_PROFILES)}</span>
        ).
      </p>
    </section>
  );
}

function PhasePanel() {
  const epochLength = param('epoch.length');
  const shadowMin = PHASE3_MIN_EPOCHS * epochLength.value;

  return (
    <section className="panel">
      <h2 className="panel__title">
        Eight phases, and a long stretch where the markets do not decide anything
      </h2>
      <p>
        A chain that lets betting markets rewrite its own program does not switch that on at launch.
        It is armed in <Value of={derived(PHASES.length, C_PHASES)} /> phases, and moving between
        any two of them takes published evidence, a passing market and a confirming vote. Delays
        are always allowed. Skipping ahead never is.
      </p>
      <p>
        The interesting phase is number {SHADOW_PHASE}. The chain is live, the money is real, and
        the markets run exactly as they will run forever — but the machinery that would execute
        their verdicts is disconnected, so the results are written down and nothing happens. That
        lasts at least {PHASE3_MIN_EPOCHS} epochs, which is{' '}
        <Value of={derived(shadowMin, C_PHASES)} format={formatDurationHuman} /> at the current
        cycle length, and it is how a mechanism this unusual earns the right to be believed:
        it is graded against reality before it is given anything to decide.
      </p>

      <div className="up-scroll">
        <table className="up-table">
          <caption className="sr-only">The eight rollout phases and what each one arms</caption>
          <thead>
            <tr>
              <th scope="col" className="numeric">
                Phase
              </th>
              <th scope="col">What it turns on</th>
              <th scope="col">Real money</th>
              <th scope="col">What a passing market causes</th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map((p) => (
              <tr key={p.n} id={`up-phase-${p.n}`}>
                <th scope="row" className="numeric">
                  <Value of={spec(p.n, C_PHASES)} />
                  <span className="up-phase-name">{p.name}</span>
                </th>
                <td>{p.arms}</td>
                <td>{p.real ? 'yes' : 'no'}</td>
                <td>{p.binds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="panel__note">
        While the money is real and the verdicts are not, exposure is capped twice over: a ceiling
        on how many dollars can exist on this chain at all, and a ceiling on how much any one
        account may bring in. Neither can be raised by an ordinary decision — each raise rides on a
        phase-advancement upgrade and its confirming vote (
        <span className="cite">{formatCitation(C_CAPS)}</span>).
      </p>
    </section>
  );
}

function BootstrapPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The founding key is compiled out, not switched off</h2>
      <p>
        Every new chain starts with somebody holding a key that can do anything, and every new
        chain promises to give it up. The promise is usually a setting. Here it is a build.
      </p>
      <p>
        The program is compiled in one of{' '}
        <Value of={derived(BASE_PROFILES.length, C_CT_SUDO)} /> mutually exclusive base shapes, and
        the founding key&rsquo;s module exists in only one of them — it sits behind a compile-time
        condition in the list of modules the chain is assembled from, so in the other shape there
        is no key, no module and no call to filter. It is not disabled. It is{' '}
        <strong>not there</strong> (<span className="cite">{formatCitation(C_CT_SUDO)}</span>).
      </p>
      <p>
        Which means removing it is exactly the two-step ritual on the canvas. The markets pass a
        proposal whose payload is the second shape; it authorizes; three days pass; anyone applies
        it. At the swap the new program removes the module, purges the key, checks that no
        unrestricted authority route survives anywhere else, and turns the first class of verdicts
        binding — all in one indivisible step. If that fails, the paired repair takes over (
        <span className="cite">{formatCitation(C_SUDO)}</span>).
      </p>

      <table className="up-table">
        <caption className="sr-only">The build profiles and what each contains</caption>
        <thead>
          <tr>
            <th scope="col">Build</th>
            <th scope="col">Founding key</th>
            <th scope="col">Multi-block conversions</th>
            <th scope="col">Role</th>
          </tr>
        </thead>
        <tbody>
          {BUILD_PROFILES.map((p) => (
            <tr key={p.name} id={`up-profile-${p.name}`}>
              <th scope="row" className="mono">
                {p.name}
              </th>
              <td>{p.sudo ? 'present' : 'absent — not compiled'}</td>
              <td>{p.migrations}</td>
              <td>{p.recovery ? 'the paired repair' : 'the program itself'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="panel__note">
        Two base shapes, each with a repair variant, which is why there are{' '}
        <Value of={derived(BUILD_PROFILES.length, C_PROFILES)} /> named builds and not{' '}
        <Value of={derived(BASE_PROFILES.length, C_PROFILES)} /> (
        <span className="cite">{formatCitation(C_PROFILES)}</span>).
      </p>

      <h3>And while it does exist, it cannot install code</h3>
      <p>
        The founding key is a{' '}
        <Term word="four-of-six group">
          Six named holders, of whom four must sign before anything happens. No single one of them
          can act, and losing two of them does not lock the rest out.
        </Term>{' '}
        (<span className="cite">{formatCitation(C_BOOTSTRAP)}</span>), and the most dangerous calls
        on the chain are refused to <em>every</em> origin from the very first block — writing
        storage directly, deleting storage, and both of the shortcuts that would install code
        without the checks above. The refusal follows the key through its own wrapper calls, so it
        cannot reach them indirectly either. Its worst case is bounded from genesis rather than
        from the day somebody remembers to lock it down (
        <span className="cite">{formatCitation(C_FILTERED)}</span>).
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * No motion. The relation here is an ordering with a fixed gap, and an ordering
 * is at its clearest on a plane — a third dimension would carry no fact and
 * would cost the reader the one thing this drawing is for.
 */
export function TheUpgradeScene({ sim }: { sim: SimState }): JSX.Element {
  const halted = sim.flags.migrationHalt;

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame model={buildModel(sim)} title="Rewriting the chain" />
      </div>
      <div className="col-rail">
        <UpgradeLede />
        <UpgradeKeyFacts />
        <PicturePanel halted={halted} />
        <OrderingPanel />

        <Depth title="The two steps in the chain’s own words, and what happens if Polkadot refuses" hint="6 steps">
          <MechanicsPanel />
        </Depth>
        <Depth title="Why the chain stops taking transactions during an upgrade" hint="4 rules">
          <MigrationPanel halted={halted} />
        </Depth>
        <Depth title="The repair that was chosen before anything went wrong" hint="5 conditions">
          <RecoveryPanel halted={halted} />
        </Depth>
        <Depth title="The eight phases, and the years before a market decides anything" hint={`${PHASES.length} phases`}>
          <PhasePanel />
        </Depth>
        <Depth title="How the founding key is removed — by rebuilding the chain without it" hint={`${BUILD_PROFILES.length} builds`}>
          <BootstrapPanel />
        </Depth>
      </div>
    </div>
  );
}
