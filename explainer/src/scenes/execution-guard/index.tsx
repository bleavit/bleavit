import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { NodeState, SceneModel, SceneNode, SceneRule, Tone } from '../model';
import type { GuardCheck, SimFlags, SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import type { PlaybookId, PlaybookTrigger, RatificationStatus } from '../../protocol/types';
import {
  PLAYBOOK_IDS,
  PLAYBOOK_TRIGGERS,
  PROPOSAL_CLASSES,
  requiresGateMarkets,
} from '../../protocol/types';
import {
  DEAD_MAN_RELAY_BLOCKS,
  DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS,
  DESCRIPTOR_LEAD_TIME_BLOCKS,
  EXECUTION_GRACE_FLOOR_BLOCKS,
  EXECUTION_RETRY_WINDOW_BLOCKS,
  EXECUTION_TIMELOCK_FLOOR_BLOCKS,
  GUARDIAN_APPROVAL_THRESHOLD,
  GUARDIAN_MEMBERS,
  KERNEL_CITATION,
  MAX_PAYLOAD_DECODE_DEPTH,
  MIGRATION_STALL_BLOCKS,
  PB_LEDGER_FREEZE_RENEWALS,
  PLAYBOOK_FREEZE_WINDOW_BLOCKS,
  PROP_MAX_BYTES,
  PROP_MAX_CALLS,
  STALE_EPOCH_BOUND_BLOCKS,
} from '../../protocol/constants';
import { formatBlocks, formatDurationHuman } from '../../protocol/epoch';
import { param, perClass } from '../../protocol/params';
import { REJECT_REASON_META, transitionById } from '../../protocol/lifecycle';
import { spec, simulated } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './execution-guard.css';

/**
 * The execution guard — doc 09 §1.2's dispatch-time check list, read back to a
 * user as the doc 11 §11.5 `execute` precondition rows.
 *
 * One idea carries this scene, and it is not a hard one: winning the vote buys
 * permission to *try*. At the moment of execution the chain reads every
 * condition again, against the finalized head, and any single one of them can
 * still refuse. All-but-one yes is a no — nothing dispatches, and the conditions
 * that held bought exactly nothing. That conjunction is what a checklist showing
 * thirteen ticks and one cross gets wrong: it renders as "almost there", and
 * there is no "almost" here.
 *
 * **Two counts, and they are both right.** The runtime runs *eleven* checks
 * (doc 09 §1.2 items 1–11; items 12 and 13 of that list are what a pass then
 * *does*, not further checks). A client shows *fourteen* rows, because two of
 * the eleven bundle readings a person needs told apart: item 1 becomes "queued"
 * and "still in the window", and item 10 becomes three separate rows for the
 * gate flags, the dead-man latch and a triggering freeze. Same conditions,
 * broken out so each one can be shown as expected-versus-actual. This canvas
 * draws the fourteen rows, because they are what a reader would see.
 *
 * So the canvas draws one gate. The fourteen rows are fourteen boxes in two
 * numbered columns, in the order they are read; a box that holds is
 * filled, a box that refuses is dashed and struck by the "first NO" marker, and
 * the payload on the left is a single slab as tall as the whole field. It
 * crosses the dispatch line on the right only when every box is filled, and it
 * crosses whole — the batch is atomic, so a partial pass is not a state the
 * protocol can be in.
 *
 * One of the fourteen is shaped differently from the rest. Check 5
 * (Ratification) asks *when*, not *whether*: it is satisfied by a clock running
 * out rather than by a state bit flipping, and a failure before that clock
 * expires changes nothing at all. It is drawn as a level rather than a filled
 * box, because a level is a reading of a clock and a filled box is not.
 *
 * The rail is ordered by what a reader meeting this for the first time needs:
 * the plain answer, four numbers, then the checklist itself. Everything else —
 * every table, every citation, every parameter — is one click away inside a
 * closed drawer. Nothing was dropped to get there.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const LIST_CITE: Citation = cite('09', '§1.2', 'the complete dispatch-time check list');
const RATIFY_CITE: Citation = cite('00', 'D-5', 'the single ratification deadline is at execute');
const LEAD_CITE: Citation = cite('09', '§2.2', 'DescriptorLeadTime, D-14');
const DEADMAN_CITE: Citation = cite('05', '§4.8', 'dead-man switch: both triggers and their effects');
const PLAYBOOK_CITE: Citation = cite('06', '§6.2', 'the enumerated playbook capability table');
const KEEPER_CITE: Citation = cite('08', '§6.3', 'the metered keeper rebate');

/**
 * Four citations that are *not* the kernel table, and are wrong if pointed there.
 *
 *  - The post-revert retry window and the executability slash are stated by the
 *    T18/T23 rows of the lifecycle table; doc 13 §2 carries no row for either.
 *  - The 5-of-7 threshold and the seven seats belong to the guardian membership
 *    section, not to the parameter document.
 *  - The two execution floors are the `Min` column of doc 13 §1's `exec.timelock`
 *    and `exec.grace` rows, marked K there — §1 is where a reader finds them.
 *  - The daily gate-breach flags and their storage are §4.7; §5.1 is the gate-veto
 *    test that *reads* them, which is a different fact.
 */
const RETRY_CITE: Citation = cite('05', '§2.1', 'T18/T23 — the retry window and the executability slash');
const GUARDIAN_CITE: Citation = cite('06', '§5.1', 'guardian membership and the approval threshold');
const EXEC_FLOOR_CITE: Citation = cite('13', '§1', 'the exec.timelock and exec.grace kernel floors');
const GATE_FLAG_CITE: Citation = cite('05', '§4.7', 'the daily gate-breach flags and their storage');

/** T18's bond slash, as doc 05 §2.1 states it: half, because the proposer owns executability. */
const T18_SLASH_FRACTION = 0.5;

/**
 * The one check that is satisfied by a clock rather than by a state bit.
 *
 * There used to be two. Check 14 was a 72-hour wait on a runtime upgrade's
 * descriptor, and doc 11 §11.5 deleted that row on 2026-08-03: the wait gates
 * `apply_authorized_upgrade`, which runs *after* a successful `execute`, so it
 * was never something `execute` could have re-read. Row 14 is now batch bounds,
 * which is an ordinary state read.
 */
const DEADLINE_CHECKS: readonly number[] = [5];
const isDeadlineCheck = (n: number): boolean => DEADLINE_CHECKS.includes(n);

/**
 * The checks whose failure is a genuine *safety* state rather than an ordinary
 * refusal. `alarm` and `.chip--safety` are reserved to these, and to the flag
 * panel that drives them.
 *
 * Three since the dead-man latch was split from the triggering freeze, because
 * the two halves are waived differently: the expedited lane clears a triggering
 * freeze and never clears the dead-man latch.
 */
const SAFETY_CHECKS: readonly number[] = [11, 12, 13];
const isSafetyCheck = (n: number): boolean => SAFETY_CHECKS.includes(n);

/**
 * The plain-language name of each check, for the canvas only.
 *
 * Twelve characters is the budget. It is what the clearance arithmetic below
 * pays for, and it is also about as much as a reader takes in from a label
 * without stopping to parse it. The specification's own names — `Descriptor lead
 * time`, `Capability rules` — are longer than that and mean nothing on first
 * sight, so they stay in the rail's table, one row per check, next to the exact
 * expected and actual readings. Shortening a label loses nothing when the exact
 * name is a glance away; making the drawing unreadable loses everything.
 *
 * Each one leads with its number, which is two or three of the twelve characters
 * well spent. The chain reports a refusal as an ordinal — "refused at check 5" —
 * so the ordinal has to be readable *on the box*, not traceable to it. The
 * decision gauntlet numbers its stations the same way, and a reader who has met
 * one of the two scenes should not have to learn the other's conventions.
 */
const CHECK_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: '1 Queued',
  2: '2 In window',
  3: '3 Same bytes',
  4: '4 Same build',
  5: '5 Ratified',
  6: '6 Attested',
  7: '7 Allowed',
  8: '8 Under caps',
  9: '9 Locks held',
  10: '10 No hold',
  11: '11 No breach',
  12: '12 No stall',
  13: '13 No freeze',
  14: '14 Size ok',
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Fourteen checks, laid out as two columns of seven.
 *
 * The renderer centres a node's label *under* the node, and estimates an
 * N-character string at `N * 0.56` em — about `N * 0.26` stage units at the
 * label's type size. Two labels sharing a row therefore need their centres more
 * than `(len_a + len_b) * 0.13 + 0.3` units apart before they touch. Fourteen
 * boxes in one row across a 21-unit stage leaves 1.5 units each and fails that
 * for every pair; one column of fourteen fails on the other axis, because 12
 * units of height leaves 0.86 per row and a label needs the best part of a unit
 * underneath its box. The renderer would deal the losers into lower bands and
 * then start dropping them, which is a legible drawing of the wrong thing.
 *
 * Two columns of seven clears both axes at once, with every label on band 0.
 * Vertically the pitch is 1.5 units — 0.6 of box, 0.58 of label, 0.32 of air —
 * and horizontally the only same-row neighbour a label has is 9.6 units away,
 * against a worst case of `(12 + 11) * 0.13 + 0.3 = 3.29` units for the longest
 * pair on any row. The payload slab clears every one of them too:
 * `|1.85 - 4.9| = 3.05` against a required 2.51 while it is held, and 4.95
 * against 2.38 once it has passed.
 *
 * Nothing is parked against the stage edge, either. The 3D camera holds a fixed
 * zoom, so at a narrow stage it shows the middle of the stage rather than all of
 * it — the 2D renderer letterboxes and never crops, but the payload is the one
 * object that must survive both, so it sits a unit in from either end.
 *
 * Order is carried by the numbered spine beside each column, because the number
 * of the first check that refuses is the one fact this scene teaches, and a
 * reader must be able to read it off the drawing without counting boxes.
 */
const ROWS = 7;
const ROW_TOP = 10.7;
const ROW_PITCH = 1.5;

const BOX_W = 1.8;
const BOX_H = 0.6;

/** Left edge of each column of boxes, and the numbered spine beside it. */
const COL_A_X = 4.0;
const COL_B_X = 13.6;
const SPINE_A_X = 3.6;
const SPINE_B_X = 13.2;

/** The band the boxes occupy, top to bottom. The payload slab is exactly as tall. */
const BAND_LO = ROW_TOP - (ROWS - 1) * ROW_PITCH - BOX_H / 2;
const BAND_HI = ROW_TOP + BOX_H / 2;

/** The line the payload crosses when — and only when — every box is filled. */
const DISPATCH_X = 18.2;

const SLAB_W = 1.7;
const SLAB_X_HELD = 1.0;
const SLAB_X_PASSED = 18.6;

const columnX = (i: number): number => (i < ROWS ? COL_A_X : COL_B_X);
const rowCentre = (i: number): number => ROW_TOP - (i % ROWS) * ROW_PITCH;

/**
 * How much of a deadline check's own clock has run, in [0,1].
 *
 * Check 5's clock is the queue window itself: an unratified mandate stays
 * retryable right up to `grace_end`, and only the post-grace crank makes it
 * terminal. Check 14's clock is the fixed 72-hour descriptor lead time; this
 * simulation models no separate `authorize_upgrade` height, so the scene reads
 * that span from the maturity block and says so in the rail.
 */
function clockProgress(sim: SimState, n: number): number {
  const { maturity, graceEnd } = sim.proposal;
  if (maturity === null) return 0;
  const elapsed = sim.block - maturity;
  if (elapsed <= 0) return 0;
  const span =
    n === 5 ? (graceEnd === null ? 0 : graceEnd - maturity) : DESCRIPTOR_LEAD_TIME_BLOCKS;
  if (span <= 0) return 0;
  return Math.min(1, elapsed / span);
}

function checkTone(check: GuardCheck, queued: boolean): Tone {
  if (!queued) return 'dim';
  if (check.ok) return 'ink';
  return isSafetyCheck(check.n) ? 'alarm' : 'ink';
}

function checkState(check: GuardCheck, queued: boolean): NodeState {
  if (!queued) return 'inactive';
  return check.ok ? 'passed' : 'blocked';
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export function buildModel(sim: SimState): SceneModel {
  const { queued, checks, attempts } = sim.guard;
  const nodes: SceneNode[] = [];

  const firstOffset = checks.findIndex((c) => !c.ok);
  /**
   * The slab passes only once a dispatch has actually been attempted and cleared.
   * Fourteen boxes reading as expected is a *forecast* that `execute()` would
   * succeed, and drawing the payload through the gate on a forecast would be the
   * one thing this screen exists to deny: `execute()` is permissionless, so until
   * somebody cranks it nothing has been enacted, and the rail says so ("no attempt
   * yet"). The canvas must not say otherwise.
   */
  const allAligned = queued && attempts > 0 && firstOffset === -1;

  checks.forEach((c, i) => {
    const centre = rowCentre(i);
    const deadline = isDeadlineCheck(c.n);

    nodes.push({
      id: `check-${c.n}`,
      domRowId: `guard-check-${c.n}`,
      kind: deadline ? 'plate' : 'stop',
      x: columnX(i),
      y: centre - BOX_H / 2,
      w: BOX_W,
      h: BOX_H,
      d: 0.9,
      tone: checkTone(c, queued),
      state: checkState(c, queued),
      label: CHECK_LABELS[c.n] ?? c.name,
      ...(deadline ? { fill: clockProgress(sim, c.n) } : {}),
    });
  });

  // One slab, the full height of the field. It is never split, because the batch
  // is atomic: a partial pass is not a state the protocol can be in.
  nodes.push({
    id: 'payload',
    domRowId: 'guard-payload',
    kind: 'slab',
    x: allAligned ? SLAB_X_PASSED : SLAB_X_HELD,
    y: BAND_LO,
    w: SLAB_W,
    h: BAND_HI - BAND_LO,
    d: 1.4,
    tone: 'ink',
    state: allAligned ? 'passed' : queued ? 'active' : 'pending',
    notches: PROPOSAL_CLASSES.indexOf(sim.proposal.cls) + 1,
    label: `#${sim.proposal.id}`,
    // Each sublabel is the exact wording of the rail's "Halted at" cell, so the
    // canvas and the DOM cannot describe the same payload two different ways.
    sublabel: allAligned
      ? 'dispatched whole'
      : !queued
        ? 'not queued'
        : attempts === 0
          ? 'no attempt yet'
          : 'held',
  });

  const rules: SceneRule[] = [
    // A bracket down each column, and nothing more. The ordinals live on the
    // boxes; repeating them here as ticks would print every number twice, and a
    // drawing this dense pays for every mark it makes.
    {
      id: 'order-a',
      axis: 'y',
      at: SPINE_A_X,
      from: BAND_LO,
      to: BAND_HI,
      tone: 'dim',
      label: 'checks 1–7',
    },
    {
      id: 'order-b',
      axis: 'y',
      at: SPINE_B_X,
      from: BAND_LO,
      to: BAND_HI,
      tone: 'dim',
      label: 'checks 8–14',
    },
    {
      id: 'dispatch',
      axis: 'y',
      at: DISPATCH_X,
      from: BAND_LO - 0.4,
      to: BAND_HI + 0.4,
      tone: 'dim',
      dashed: true,
      label: 'dispatch',
    },
  ];

  const blocking = firstOffset >= 0 ? checks[firstOffset] : undefined;
  if (queued && blocking !== undefined) {
    // Drawn across the refusing row, from outside its ordinal to past its box:
    // the one marked row is the one that stopped the payload, and a reader has
    // to be able to find it without comparing fourteen fill levels.
    const start = columnX(firstOffset);
    rules.push({
      id: 'refusal',
      axis: 'x',
      at: rowCentre(firstOffset),
      from: start - 0.8,
      to: start + BOX_W + 0.6,
      tone: isSafetyCheck(blocking.n) ? 'alarm' : 'ink',
      dashed: true,
      label: 'first NO',
    });
  }

  return {
    nodes,
    rules,
    relation:
      'One gate, fourteen conditions. Every box in both columns has to be filled before the ' +
      'payload on the left crosses the dispatch line on the right, so a single dashed box holds ' +
      'it however many of the other thirteen are filled — which is exactly what a checklist ' +
      'showing thirteen ticks and one cross cannot say. The numbers beside each column are the ' +
      'order the chain reads them in, and the marked row is the first one that says no. And the ' +
      'gate opens once: the batch is atomic, so the payload crosses whole or does not cross at all.',
    unitLegend:
      'Checks 5 and 14 are drawn as levels rather than filled boxes: they are satisfied by a clock running out, and the level is how much of that clock has run. The other twelve read a state, not a time.',
  };
}

// ---------------------------------------------------------------------------
// Small rail helpers
// ---------------------------------------------------------------------------

const int = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const usd = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

function Verdict({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="guard-mark guard-mark--ok">
      <span aria-hidden="true">&#10003;</span> holds
    </span>
  ) : (
    <span className="guard-mark guard-mark--off">
      <span aria-hidden="true">&#10007;</span> refuses
    </span>
  );
}

function describeRatification(r: RatificationStatus): JSX.Element {
  switch (r.kind) {
    case 'NotRequired':
      return <>Not required for this class.</>;
    case 'NoPassedRecord':
      return (
        <>
          No passed record. The chain reports this one variant for never-submitted, in-flight
          and failed alike, so the absence of a record is not evidence that the referendum
          failed.
        </>
      );
    case 'Passed':
      return (
        <>
          Referendum <Value of={simulated(r.referendum)} /> approved and bound to this payload.
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// The plain answer, and the four numbers a reader should leave with
// ---------------------------------------------------------------------------

function GuardLede() {
  return (
    <Lede>
      Winning the vote enacts nothing by itself. It buys{' '}
      <strong>permission to try</strong>: when someone finally runs the payload, the chain reads
      every condition all over again, against the live chain, and any single one of them can still
      refuse. All but one holding is still a no — nothing happens, and the ones that held bought
      nothing. Between the decision and this moment there is a compulsory{' '}
      <Jargon word="timelock" />, so anybody who objects has time to act, and the exact bytes that
      run were fixed weeks earlier as a <Jargon word="preimage" />.
    </Lede>
  );
}

function GuardKeyFacts({ sim }: { sim: SimState }) {
  const { queued, checks, attempts } = sim.guard;
  const holding = checks.filter((c) => c.ok).length;
  const blocking = checks.find((c) => !c.ok);
  const { graceEnd } = sim.proposal;
  const left = graceEnd === null ? null : graceEnd - sim.block;

  /* "Nobody has tried yet" is not a footnote. `execute()` is permissionless, so
     fourteen conditions reading as expected is a forecast until a crank arrives,
     and a key fact that quietly implies otherwise would be the same lie the
     canvas refuses to draw. */
  const untried = attempts === 0 ? ' Nobody has cranked execute() at this step, so this is a reading, not a result.' : '';

  return (
    <KeyFacts>
      <KeyFact
        label="Conditions holding"
        note={
          queued
            ? `All fourteen must hold in the same block.${untried}`
            : 'Nothing is queued at this step, so nothing has been read.'
        }
      >
        {queued ? (
          <>
            <Value of={simulated(holding)} /> of <Value of={spec(checks.length, LIST_CITE)} />
          </>
        ) : (
          'not read yet'
        )}
      </KeyFact>

      <KeyFact
        label="First to refuse"
        note={
          !queued
            ? 'The queue is empty; there is nothing to refuse.'
            : blocking === undefined
              ? `Every condition reads as expected.${untried}`
              : `${blocking.name}. The chain reports the first refusal in list order and stops there.`
        }
      >
        {!queued ? (
          <span className="guard-absent">&mdash;</span>
        ) : blocking === undefined ? (
          'none'
        ) : (
          <>
            check <Value of={spec(blocking.n, blocking.cite)} />
          </>
        )}
      </KeyFact>

      <KeyFact
        label="Time left to try"
        note={
          left === null
            ? 'The window opens when the timelock matures and closes at the end of the grace period.'
            : left > 0
              ? 'Until the grace window closes. Every block until then is another chance to try.'
              : 'The grace window has run out: the mandate can no longer be enacted.'
        }
      >
        {left === null ? (
          <span className="guard-absent">not queued</span>
        ) : left > 0 ? (
          <Value of={simulated(left)} format={formatDurationHuman} />
        ) : (
          'closed'
        )}
      </KeyFact>

      <KeyFact
        label="Who may run it"
        note="execute() is permissionless: the proposer has no privilege and no obligation, and the chain pays a metered rebate for the crank."
      >
        anyone
      </KeyFact>
    </KeyFacts>
  );
}

// ---------------------------------------------------------------------------
// Rail panels
// ---------------------------------------------------------------------------

function ChecksPanel({ sim }: { sim: SimState }) {
  const { checks, queued } = sim.guard;

  return (
    <section className="panel">
      <h2 className="panel__title">Every condition, read again at execution</h2>
      <p>
        All of them are read in the same block, against the finalized head, and the payload runs
        only if every one holds. The list is fixed and numbered by the specification (
        <span className="cite">{formatCitation(LIST_CITE)}</span>), and what the chain reports is
        the first number in that list which refuses — which is why the order is worth reading.
      </p>
      <p className="panel__note">
        <strong>Two counts, both correct.</strong> The runtime performs <em>eleven</em> checks; the
        two items after them in the specification&rsquo;s list are what a pass then <em>does</em>,
        not further conditions. The fourteen rows below are how a client re-reads those eleven
        before it lets you sign, because two of them bundle readings you need told apart: check 1
        splits into &ldquo;queued&rdquo; and &ldquo;still in the window&rdquo;, and check 10 splits
        into the gate flags, the dead-man latch and a triggering freeze.
      </p>

      <table className="guard-table guard-checks">
        <caption className="sr-only">
          The fourteen dispatch-time checks with expected and actual readings
        </caption>
        <thead>
          <tr>
            <th scope="col" className="numeric">
              #
            </th>
            <th scope="col">Check</th>
            <th scope="col">Expected</th>
            <th scope="col">Actual</th>
            <th scope="col">Verdict</th>
            <th scope="col">Spec</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.n} id={`guard-check-${c.n}`}>
              <th scope="row" className="numeric">
                <Value of={spec(c.n, c.cite)} />
              </th>
              <td>
                {/* The drawing's word first, the specification's own name under it:
                    a reader who has only seen the boxes needs the short word to
                    land on, and an auditor needs the exact one. */}
                <span className="guard-plain">{CHECK_LABELS[c.n] ?? c.name}</span>
                <span className="guard-specname">
                  {c.name}
                  {isDeadlineCheck(c.n) ? (
                    <>
                      {' '}
                      <span className="chip">deadline</span>
                    </>
                  ) : null}
                </span>
              </td>
              <td className="guard-expect">{c.expected}</td>
              <td className="guard-expect">{queued ? c.actual : <span className="guard-absent">not read</span>}</td>
              <td>
                {queued ? (
                  <Verdict ok={c.ok} />
                ) : (
                  <span className="guard-absent">not read</span>
                )}
              </td>
              <td>
                <span className="cite">{formatCitation(c.cite)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="panel__note">
        The first line of each row is what the diagram calls the check; the second is the
        specification&rsquo;s own name for it. The verdict is a word, not a colour:{' '}
        <em>holds</em> and <em>refuses</em> read the same in monochrome, at any contrast setting,
        and to a screen reader.
      </p>
    </section>
  );
}

function ChecksNotes() {
  return (
    <section className="panel">
      <p>
        This list is normative and canonical (
        <span className="cite">{formatCitation(LIST_CITE)}</span>), and the frontend precondition
        row mirrors it item for item — the two are diffed by contract test, so a client that
        silently checks thirteen is a test failure rather than a UX difference. They are not
        ordered by severity: they are all read in the same block, and the batch dispatches only
        if every one of them holds.
      </p>
      <p className="panel__note">
        Checks 5 and 14 carry the <span className="chip">deadline</span> tag because they are
        satisfied by time passing rather than by a state changing, which is why failing them early
        is harmless and failing them late is not. On the diagram they are the two levels rather
        than filled boxes.
      </p>
      <p className="panel__note">
        Two checks are worth reading twice. Check 8 is a rate-meter check and nothing wider — it
        answers whether the treasury, issuance and upgrade-spacing meters have headroom, not
        whether the batch would succeed; a payload that would fail for any other reason belongs
        to the dispatch itself. And check 13 decodes the committed preimage under a hard SCALE
        depth limit and requires the bytes to be consumed exactly, so an over-deep payload
        resolves to a refusal and never to a stack trap.
      </p>
    </section>
  );
}

function MandatePanel({ sim }: { sim: SimState }) {
  const cls = sim.proposal.cls;
  const lockRow = requiresGateMarkets(cls) ? perClass('exec.lock', cls) : null;
  const graceRow = param('exec.grace');
  const rebateRow = param('keeper.rebate');

  return (
    <section className="panel">
      <h2 className="panel__title">What adoption actually bought</h2>
      <p>
        A passing decision enacts nothing. It writes a mandate into the execution queue, and a
        queued mandate is a <strong>permission to try</strong>: every one of the fourteen
        preconditions is read again at dispatch, against the finalized head, and any one of them
        can refuse. Adoption is the market&rsquo;s answer; execution is a separate act with its
        own evidence.
      </p>
      <p>
        <span className="mono">execution_guard.execute(pid)</span> is permissionless. Any
        account may call it — the proposer has no privilege here and no obligation — and the
        chain pays a metered rebate for the crank so that submitting the transaction is not a
        loss. The rebate is drawn from a bounded per-epoch keeper budget on a general tranche
        that is a partial subsidy by design, so a crank may go unrebated once that budget is
        spent; the call itself stays permissionless and idempotent either way.
      </p>

      <div className="statgrid">
        <div className="stat">
          <span className="stat__label">Timelock, this class</span>
          <span className="stat__value">
            {lockRow === null ? (
              <span className="guard-absent">no queue path</span>
            ) : (
              <Value of={spec(lockRow.value, lockRow.cite)} format={formatBlocks} />
            )}
          </span>
          <span className="cite">
            {lockRow === null ? 'referendum path' : formatCitation(lockRow.cite)}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Grace window</span>
          <span className="stat__value">
            <Value of={spec(graceRow.value, graceRow.cite)} format={formatBlocks} />
          </span>
          <span className="cite">{formatCitation(graceRow.cite)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Calls per batch</span>
          <span className="stat__value">
            <Value of={spec(PROP_MAX_CALLS, KERNEL_CITATION)} />
          </span>
          <span className="cite">kernel bound</span>
        </div>
        <div className="stat">
          <span className="stat__label">Payload bytes</span>
          <span className="stat__value">
            <Value of={spec(PROP_MAX_BYTES, KERNEL_CITATION)} format={int} unit="bytes" />
          </span>
          <span className="cite">kernel bound</span>
        </div>
        <div className="stat">
          <span className="stat__label">Keeper rebate</span>
          <span className="stat__value">
            <Value
              of={spec(rebateRow.value, rebateRow.cite)}
              format={usd}
              unit="USDC"
              unverified
            />
          </span>
          <span className="cite">{formatCitation(KEEPER_CITE)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Decode depth limit</span>
          <span className="stat__value">
            <Value of={spec(MAX_PAYLOAD_DECODE_DEPTH, KERNEL_CITATION)} format={int} />
          </span>
          <span className="cite">SCALE recursion bound</span>
        </div>
      </div>

      <p className="panel__note">
        The two floors underneath the governable numbers are kernel and cannot be amended
        downward: a timelock of at least{' '}
        <Value of={spec(EXECUTION_TIMELOCK_FLOOR_BLOCKS, EXEC_FLOOR_CITE)} format={formatBlocks} />{' '}
        (<Value of={spec(EXECUTION_TIMELOCK_FLOOR_BLOCKS, EXEC_FLOOR_CITE)} format={formatDurationHuman} />
        ) and a grace window of at least{' '}
        <Value of={spec(EXECUTION_GRACE_FLOOR_BLOCKS, EXEC_FLOOR_CITE)} format={formatBlocks} /> (
        <Value of={spec(EXECUTION_GRACE_FLOOR_BLOCKS, EXEC_FLOOR_CITE)} format={formatDurationHuman} />
        ). They floor two different things. Shortening the timelock would shrink the window in
        which the public can see a mandate before anyone may act on it; shortening the grace
        window would shrink the time a keeper has to enact one before it expires unexecuted.
      </p>
    </section>
  );
}

function QueuePanel({ sim }: { sim: SimState }) {
  const { maturity, graceEnd } = sim.proposal;
  const { queued, attempts, blockedAt, blockedReason, checks } = sim.guard;
  const blocking = blockedAt === null ? undefined : checks.find((c) => c.n === blockedAt);
  const window = maturity !== null && graceEnd !== null ? graceEnd - maturity : null;

  const relative = (target: number) => {
    const delta = target - sim.block;
    return (
      <>
        <Value of={simulated(Math.abs(delta))} format={formatDurationHuman} />{' '}
        {delta >= 0 ? 'from now' : 'ago'}
      </>
    );
  };

  return (
    <section className="panel">
      <h2 className="panel__title">The queue</h2>

      <table className="guard-table">
        <caption className="sr-only">The queued payload and its dispatch attempts</caption>
        <thead>
          <tr>
            <th scope="col">Payload</th>
            <th scope="col">Class</th>
            <th scope="col">Proposal state</th>
            <th scope="col" className="numeric">
              Attempts
            </th>
            <th scope="col">Halted at</th>
          </tr>
        </thead>
        <tbody>
          <tr id="guard-payload">
            <th scope="row">
              #<Value of={simulated(sim.proposal.id)} />
            </th>
            <td>{sim.proposal.cls}</td>
            <td>
              {/* A proposal-state chip is always ink: rejection is a healthy path. */}
              <span className="chip chip--state">{sim.proposal.state}</span>
            </td>
            <td className="numeric">
              <Value of={simulated(attempts)} />
            </td>
            <td>
              {!queued ? (
                <span className="guard-absent">nothing queued</span>
              ) : attempts === 0 ? (
                <span className="guard-absent">no attempt yet</span>
              ) : blocking === undefined ? (
                'all fourteen hold'
              ) : (
                <>
                  {/* The ordinal is the position in the frozen doc 11 §11.5 list —
                      a specification fact. Only *which* check refused is scenario. */}
                  check <Value of={spec(blocking.n, blocking.cite)} /> &mdash; {blocking.name}
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {blockedReason !== null ? (
        <p className="guard-chiprow">
          <span className="chip chip--state guard-chip-reason">{blockedReason}</span>
        </p>
      ) : null}

      <table className="guard-table">
        <caption className="sr-only">
          The dispatch window in block heights and in human time
        </caption>
        <thead>
          <tr>
            <th scope="col">Marker</th>
            <th scope="col" className="numeric">
              Block
            </th>
            <th scope="col">Relative to now</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Maturity &mdash; earliest dispatch</th>
            <td className="numeric">
              {maturity === null ? (
                <span className="guard-absent">not set</span>
              ) : (
                <Value of={simulated(maturity)} format={int} />
              )}
            </td>
            <td>{maturity === null ? <span className="guard-absent">&mdash;</span> : relative(maturity)}</td>
          </tr>
          <tr>
            <th scope="row">Now</th>
            <td className="numeric">
              <Value of={simulated(sim.block)} format={int} />
            </td>
            <td>
              epoch <Value of={simulated(sim.epoch)} />, block{' '}
              <Value of={simulated(sim.blockInEpoch)} format={int} /> of{' '}
              <Value of={simulated(sim.epochLength)} format={int} />
            </td>
          </tr>
          <tr>
            <th scope="row">Grace end &mdash; last dispatch</th>
            <td className="numeric">
              {graceEnd === null ? (
                <span className="guard-absent">not set</span>
              ) : (
                <Value of={simulated(graceEnd)} format={int} />
              )}
            </td>
            <td>{graceEnd === null ? <span className="guard-absent">&mdash;</span> : relative(graceEnd)}</td>
          </tr>
          <tr>
            <th scope="row">Window length</th>
            <td className="numeric">
              {window === null ? (
                <span className="guard-absent">&mdash;</span>
              ) : (
                <Value of={simulated(window)} format={formatBlocks} />
              )}
            </td>
            <td>
              {window === null ? (
                <span className="guard-absent">&mdash;</span>
              ) : (
                <Value of={simulated(window)} format={formatDurationHuman} />
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="panel__note">
        Check 2 is this window and nothing else: <span className="mono">maturity &le; now &le;
        grace_end</span>, read against the finalized height rather than the best head, so a
        reorg cannot make a dispatch look legal that was not. On the diagram the slab&rsquo;s
        notches count the proposal class, so class is never carried by colour alone: PARAM one,
        TREASURY two, CODE three, META four, CONSTITUTIONAL five.
      </p>

      <h3 className="guard-subhead">The two clocks</h3>
      <table className="guard-table">
        <caption className="sr-only">
          The deadline-shaped checks and how far their clocks have run
        </caption>
        <thead>
          <tr>
            <th scope="col">Deadline check</th>
            <th scope="col">Span</th>
            <th scope="col" className="numeric">
              Elapsed
            </th>
          </tr>
        </thead>
        <tbody>
          <tr id="guard-clock-5">
            <th scope="row">5 &mdash; Ratification</th>
            <td>
              {window === null ? (
                <span className="guard-absent">queue window, not yet set</span>
              ) : (
                <>
                  the queue window,{' '}
                  <Value of={simulated(window)} format={formatDurationHuman} />
                </>
              )}
            </td>
            <td className="numeric">
              <Value of={simulated(clockProgress(sim, 5))} format={pct} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        <strong>There is a second clock, and it deliberately is not on this list.</strong> A runtime
        upgrade may not be <em>applied</em> until{' '}
        <Value of={spec(DESCRIPTOR_LEAD_TIME_BLOCKS, LEAD_CITE)} format={formatDurationHuman} />{' '}
        after it was authorized (<span className="cite">{formatCitation(LEAD_CITE)}</span>), so a
        node operator who was asleep when the mandate dispatched still has that long to see the code
        coming. That wait starts <em>after</em> a successful execution — executing is what
        authorizes the upgrade in the first place — so it can never be one of the conditions
        execution itself re-reads. It used to appear here as check 14, and the specification removed
        that row for exactly this reason.
      </p>
      <p className="panel__note">
        Ratification for this proposal: {describeRatification(sim.proposal.ratification)}
      </p>
      <p className="panel__note">
        Read the provenance tags before comparing these block heights with the class defaults in
        the drawer above. The window length here is the real governed grace period; the run-up
        from adoption to maturity is compressed by this scenario so the whole path fits in one
        reading, and every height in the table is labelled simulated for exactly that reason.
      </p>
    </section>
  );
}

function RecoveryPanel({ sim }: { sim: SimState }) {
  const t16 = transitionById('T16');
  const t18 = transitionById('T18');
  const t23 = transitionById('T23');
  const t22 = transitionById('T22');
  const t15 = transitionById('T15');
  const notRatified = REJECT_REASON_META.NotRatified;
  const staleQueue = REJECT_REASON_META.StaleQueue;
  const reverted = REJECT_REASON_META.PayloadReverted;
  const attestation = REJECT_REASON_META.AttestationMissing;
  const blockedAt = sim.guard.blockedAt;
  const blockedCheck = sim.guard.checks.find((c) => c.n === blockedAt);

  return (
    <section className="panel guard-panel--major">
      <h2 className="panel__title">Recoverable, or terminal &mdash; the distinction that matters</h2>
      <p>
        A refused <span className="mono">execute()</span> is usually not the end of anything.
        Most of the fourteen checks refuse without writing a single byte of state: the call
        errors, the proposal stays <span className="mono">Queued</span>, and the next keeper can
        try again in the next block. Presenting that as a terminal failure is the single most
        misleading thing an execution screen can do, because it invites everyone to stop trying
        while the window is still open.
      </p>

      <table className="guard-table">
        <caption className="sr-only">
          Outcomes of a refused or failed dispatch, and which of them end the proposal
        </caption>
        <thead>
          <tr>
            <th scope="col">Outcome</th>
            <th scope="col">What changes</th>
            <th scope="col">Still live?</th>
          </tr>
        </thead>
        <tbody>
          <tr id="guard-outcome-notratified">
            <th scope="row">
              <span className="mono">NotRatified</span>, before grace end
            </th>
            <td>
              <strong>Nothing at all.</strong> The call errors and returns; no state is written,
              no bond is touched, no record is made. The proposal stays{' '}
              <span className="mono">Queued</span> and stays retryable through{' '}
              <span className="mono">grace_end</span>, and the referendum may still pass in the
              meantime (<span className="cite">{formatCitation(RATIFY_CITE)}</span>).
            </td>
            <td>
              <span className="chip chip--state">recoverable</span>
            </td>
          </tr>
          <tr id="guard-outcome-meters">
            <th scope="row">Meter contention, check 8</th>
            <td>
              Refused <em>before</em> any dispatch, so there is no execution record and no
              failure stamp. A transient meter cannot spend the proposal&rsquo;s retry budget:
              contention buys the full grace window, not the bounded post-failure one.
            </td>
            <td>
              <span className="chip chip--state">recoverable</span>
            </td>
          </tr>
          <tr id="guard-outcome-notratified-late">
            <th scope="row">
              <span className="mono">NotRatified</span>, at grace end
            </th>
            <td>
              {notRatified.blurb} The crank records it as{' '}
              <span className="mono">Rejected(NotRatified)</span> only here, at{' '}
              <span className="mono">{t16.id}</span>, and the bond is refunded.
            </td>
            <td>
              <span className="chip">terminal</span>
            </td>
          </tr>
          <tr id="guard-outcome-stale">
            <th scope="row">
              <span className="mono">StaleQueue</span>
            </th>
            <td>
              {staleQueue.blurb} <span className="mono">{t16.id}</span> moves it to{' '}
              <span className="mono">Rejected(StaleQueue)</span> and the bond is refunded;
              resubmission is the only route. Produced by {staleQueue.producedBy}.
            </td>
            <td>
              <span className="chip">terminal</span>
            </td>
          </tr>
          <tr id="guard-outcome-attestation">
            <th scope="row">
              <span className="mono">AttestationMissing</span>
            </th>
            <td>
              {attestation.blurb} The record check reads the committed attestation, not the
              current roster, so routine attestor rotation cannot strand a valid mandate — but a
              revocation or an adverse challenge fails closed, and{' '}
              <span className="mono">{t16.id}</span> moves it to{' '}
              <span className="mono">Rejected(AttestationMissing)</span> with the bond refunded.
            </td>
            <td>
              <span className="chip">terminal</span>
            </td>
          </tr>
          <tr id="guard-outcome-reverted">
            <th scope="row">
              <span className="mono">PayloadReverted</span>
            </th>
            <td>
              The batch dispatched and a call inside it failed, so the whole batch rolled back
              atomically. <span className="mono">{t18.id}</span> moves the proposal to{' '}
              <span className="mono">FailedExecuted</span> with a{' '}
              <Value of={spec(T18_SLASH_FRACTION, RETRY_CITE)} format={pct} /> bond slash — the
              proposer owns executability — and opens a{' '}
              <Value of={spec(EXECUTION_RETRY_WINDOW_BLOCKS, RETRY_CITE)} format={formatBlocks} />{' '}
              (
              <Value
                of={spec(EXECUTION_RETRY_WINDOW_BLOCKS, RETRY_CITE)}
                format={formatDurationHuman}
              />
              ) retry window. <span className="mono">{t23.id}</span> retries inside it with the
              full fourteen-check revalidation repeated; the slash is not reversed. The ACCEPT
              branch stays live throughout.
            </td>
            <td>
              <span className="chip chip--state">
                retryable,{' '}
                <Value
                  of={spec(EXECUTION_RETRY_WINDOW_BLOCKS, RETRY_CITE)}
                  format={formatDurationHuman}
                />
              </span>
            </td>
          </tr>
          <tr id="guard-outcome-expired">
            <th scope="row">Grace elapses with no cause</th>
            <td>
              <span className="mono">{t15.id}</span>: {t15.guard}.
            </td>
            <td>
              <span className="chip">terminal</span>
            </td>
          </tr>
        </tbody>
      </table>

      <p>
        {reverted.blurb} If the retry window runs out, <span className="mono">{t22.id}</span>
        {' '}measures the adopted world <em>including</em> the failure: the vault resolves to
        Accept and the decision record carries{' '}
        <span className="mono">PayloadReverted</span>. A mandate that could not be enacted still
        teaches the system what adopting it was worth, which is why a failed execution is
        measured rather than erased.
      </p>

      <p className="panel__note">
        A separate clock sits above all of this. <span className="mono">StaleEpochBound</span> —{' '}
        <Value of={spec(STALE_EPOCH_BOUND_BLOCKS, KERNEL_CITATION)} format={formatBlocks} /> (
        <Value of={spec(STALE_EPOCH_BOUND_BLOCKS, KERNEL_CITATION)} format={formatDurationHuman} />
        ) — measures <em>epoch</em> staleness, not per-proposal lifetime: a chain whose clock has
        stopped advancing trips it however new an individual proposal is. Its force-rejection
        latch is suppressed while the dead-man switch owns the stall, so one stopped clock is
        never punished twice.
      </p>

      {blockedAt !== null && blockedCheck !== undefined ? (
        <p className="panel__note">
          This run last refused at check{' '}
          <Value of={spec(blockedCheck.n, blockedCheck.cite)} />, after{' '}
          <Value of={simulated(sim.guard.attempts)} /> attempt
          {sim.guard.attempts === 1 ? '' : 's'}. Whether that is recoverable is read off the
          table above, not off the fact that it refused.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Safety states
// ---------------------------------------------------------------------------

interface FlagRow {
  readonly key: keyof SimFlags;
  readonly label: string;
  readonly effect: string;
  readonly cite: Citation;
}

const FLAG_ROWS: readonly FlagRow[] = [
  {
    key: 'deadManEngaged',
    label: 'Dead-man switch engaged',
    effect:
      'The execution queue freezes, the epoch clock pauses and every open decision window extends day for day. Recovery is one proposal-free epoch.',
    cite: DEADMAN_CITE,
  },
  {
    key: 'ledgerFrozen',
    label: 'Ledger frozen — PB-LEDGER-FREEZE',
    effect:
      'The ledger and the markets are frozen by guardian playbook on a machine-checked solvency anomaly. Check 12 refuses every dispatch while it holds.',
    cite: cite('06', '§6.3', 'PB-LEDGER-FREEZE and its renewal bound'),
  },
  {
    key: 'migrationHalt',
    label: 'Migration halt',
    effect:
      'A stalled or failed runtime migration cursor has raised the halt-at-fault flag. The execution queue freezes at the same check that carries the other freezes, and under a genuine cursor halt FRAME admits only inherents, so no execute() reaches the guard at all.',
    cite: cite('09', '§3.2', 'PB-MIGRATION halt-at-fault semantics'),
  },
  {
    key: 'gateBreachS',
    label: 'Survival gate breach flag',
    effect:
      'A daily hard-gate floor was breached for the Survival pillar. Check 11 refuses while the flag is set.',
    cite: GATE_FLAG_CITE,
  },
  {
    key: 'gateBreachC',
    label: 'Security gate breach flag',
    effect:
      'A daily hard-gate floor was breached for the Security pillar. Check 11 refuses while the flag is set.',
    cite: GATE_FLAG_CITE,
  },
  {
    key: 'reserveImpaired',
    label: 'Reserve impaired — PB-RESERVE',
    effect:
      'Split inflows are halted and NAV renders with a haircut. Merge, redeem and exit paths stay open, because the response to unreachable collateral is to stop selling claims on it, not to trap the holders.',
    cite: cite('08', '§1.2', 'the reserve-health flag and the NAV haircut'),
  },
  {
    key: 'intakePaused',
    label: 'Intake paused — PB-HALT-INTAKE',
    effect:
      'No new proposals are admitted. Proposals already in flight are untouched; this playbook stops the inflow, it does not cancel anything.',
    cite: PLAYBOOK_CITE,
  },
];

function SafetyPanel({ flags }: { flags: SimFlags }) {
  const engaged = FLAG_ROWS.filter((r) => flags[r.key]);

  return (
    <section className="panel">
      <h2 className="panel__title">Safety states</h2>
      <p>
        These flags are the only genuine alarms on this screen. A refused check is not an alarm;
        a rejected proposal is not an alarm; an expired mandate is not an alarm. The alarm colour
        is spent here and in exactly one other place — boxes 11 and 12 on the diagram, the two
        checks that do nothing but read this table — and nowhere else in the scene.
      </p>

      <table className="guard-table">
        <caption className="sr-only">Protocol safety flags and their current state</caption>
        <thead>
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">State</th>
            <th scope="col">What it does</th>
            <th scope="col">Spec</th>
          </tr>
        </thead>
        <tbody>
          {FLAG_ROWS.map((r) => (
            <tr key={r.key} id={`guard-flag-${r.key}`}>
              <th scope="row">{r.label}</th>
              <td>
                {flags[r.key] ? (
                  <span className="chip chip--safety">engaged</span>
                ) : (
                  <span className="chip">clear</span>
                )}
              </td>
              <td>{r.effect}</td>
              <td>
                <span className="cite">{formatCitation(r.cite)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="guard-subhead">The dead-man switch, stated honestly</h3>
      <p>
        Two triggers, and only two. Either the relay best advances{' '}
        <Value of={spec(DEAD_MAN_RELAY_BLOCKS, KERNEL_CITATION)} format={int} /> relay blocks (
        <Value of={spec(DEAD_MAN_RELAY_BLOCKS, KERNEL_CITATION)} format={formatDurationHuman} />)
        without the parachain anchoring a new block, or a welfare snapshot falls more than{' '}
        <Value of={spec(DEAD_MAN_SNAPSHOT_OVERDUE_BLOCKS, KERNEL_CITATION)} format={formatDurationHuman} />{' '}
        overdue. Both are observable from inside the parachain runtime, which is the whole reason
        they are the triggers: the relay&rsquo;s finalized head is not visible to a parachain on
        this SDK, so a pure relay-finality stall is watched off-chain instead and is deliberately
        not wired to this switch (<span className="cite">{formatCitation(DEADMAN_CITE)}</span>).
      </p>
      <p>
        What it then does is narrow and reversible: the execution queue freezes, the epoch clock
        pauses, and open decision windows extend day for day so that no market is judged on a
        window it could not trade in. Recovery is one proposal-free epoch. The single carve-out
        is the enumerated coretime-renewal call, which stays dispatchable throughout — renewing
        the parachain&rsquo;s own block space during an outage is maintenance, and freezing it
        would turn a stall into a permanent one.
      </p>
      {engaged.length === 0 ? (
        <p className="panel__note">
          Nothing is engaged at this step of the scenario. That is the ordinary case, and it is
          what the whole table should read like almost always.
        </p>
      ) : (
        <p className="panel__note">
          <Value of={simulated(engaged.length)} /> flag
          {engaged.length === 1 ? ' is' : 's are'} engaged at this step:{' '}
          {engaged.map((r) => r.label).join('; ')}.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------

interface PlaybookRow {
  readonly id: PlaybookId;
  readonly display: string;
  readonly triggers: readonly PlaybookTrigger[];
  readonly effect: string;
  /** `null` where the playbook is usable in v1. */
  readonly unavailable: string | null;
}

/**
 * The trigger partition of `guardian_core::trigger_matches`. Every one of the
 * eight triggers belongs to exactly one playbook; PB-HALT-INTAKE owns three,
 * which is why the counts do not line up six-to-six.
 */
const PLAYBOOK_TRIGGER_SET: Readonly<Record<PlaybookId, readonly PlaybookTrigger[]>> =
  Object.freeze({
    Depeg: ['DepegMedian'],
    Migration: ['MigrationHalt'],
    OracleVoid: ['OracleDeadlock'],
    HaltIntake: ['GateBreach', 'DeadMan', 'VoidInFlight'],
    Reserve: ['ReserveHealth'],
    LedgerFreeze: ['LedgerDrift'],
  });

const PLAYBOOK_DISPLAY: Readonly<Record<PlaybookId, string>> = Object.freeze({
  Depeg: 'PB-DEPEG',
  Migration: 'PB-MIGRATION',
  OracleVoid: 'PB-ORACLE-VOID',
  HaltIntake: 'PB-HALT-INTAKE',
  Reserve: 'PB-RESERVE',
  LedgerFreeze: 'PB-LEDGER-FREEZE',
});

const PLAYBOOK_EFFECT: Readonly<Record<PlaybookId, string>> = Object.freeze({
  Depeg: 'market.freeze_creation(expiry) — new-market creation only; open books keep trading.',
  Migration:
    'None. There is no guardian-dispatchable call on this SDK: the migration cursor controls are Root-only and filtered to nobody.',
  OracleVoid:
    'epoch.void_cohort(epoch_id) for the exact latched cohort, which voids that cohort’s vaults and consumes the latch atomically.',
  HaltIntake: 'epoch.set_intake_paused(true, expiry) — stops new proposals, touches nothing in flight.',
  Reserve:
    'ledger.set_split_paused(true, expiry) — halts split inflows only; merge, redeem and exit stay open.',
  LedgerFreeze: 'ledger.set_frozen(true) + market.set_frozen(true).',
});

const PLAYBOOK_UNAVAILABLE: Readonly<Record<PlaybookId, string | null>> = Object.freeze({
  Depeg:
    'Unavailable in v1. No authoritative attested price source, median formula or latch lifecycle is specified yet, so the trigger cannot legitimately be set; a Phase-6-or-later amendment must supply all three first.',
  Migration:
    'Registered but not dispatchable. Its admissible call set is empty on this SDK, so a fifth approval reaching it fails closed: nothing is dispatched, no allowance is consumed and no record is written.',
  OracleVoid: null,
  HaltIntake: null,
  Reserve: null,
  LedgerFreeze: null,
});

const PLAYBOOK_ROWS: readonly PlaybookRow[] = PLAYBOOK_IDS.map((id) => ({
  id,
  display: PLAYBOOK_DISPLAY[id],
  triggers: PLAYBOOK_TRIGGER_SET[id],
  effect: PLAYBOOK_EFFECT[id],
  unavailable: PLAYBOOK_UNAVAILABLE[id],
}));

const USABLE_PLAYBOOKS = PLAYBOOK_ROWS.filter((r) => r.unavailable === null).length;

function PlaybooksPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">The guardian playbooks</h2>
      <p>
        Guardians hold no discretionary power. What they have is{' '}
        <Value of={spec(PLAYBOOK_ROWS.length, PLAYBOOK_CITE)} /> pre-audited, preimage-committed,
        values-ratified playbooks, each admitting an exhaustively enumerated call set and each
        activatable only while its own on-chain trigger is verifiably set. A playbook whose
        preimage contains any call outside its row fails registration; the origin is re-checked
        at dispatch. It takes <Value of={spec(GUARDIAN_APPROVAL_THRESHOLD, GUARDIAN_CITE)} /> of{' '}
        <Value of={spec(GUARDIAN_MEMBERS, GUARDIAN_CITE)} /> approvals to activate one, every
        activation that dispatches an effect is retrospectively ratified, and every effect
        expires.
      </p>
      <p>
        <strong>
          <Value of={spec(PLAYBOOK_ROWS.length, PLAYBOOK_CITE)} /> are registered at genesis; only{' '}
          <Value of={spec(USABLE_PLAYBOOKS, PLAYBOOK_CITE)} /> are usable in v1.
        </strong>{' '}
        That gap is not an implementation lag to be papered over — it is what the specification
        says the system can currently do, and presenting{' '}
        <Value of={spec(PLAYBOOK_ROWS.length, PLAYBOOK_CITE)} /> live emergency capabilities
        where <Value of={spec(USABLE_PLAYBOOKS, PLAYBOOK_CITE)} /> exist would overstate the
        protocol&rsquo;s ability to respond.
      </p>

      <table className="guard-table">
        <caption className="sr-only">
          The six registered guardian playbooks, their triggers and their v1 availability
        </caption>
        <thead>
          <tr>
            <th scope="col">Playbook</th>
            <th scope="col">On-chain trigger</th>
            <th scope="col">Admissible calls</th>
            <th scope="col">v1</th>
          </tr>
        </thead>
        <tbody>
          {PLAYBOOK_ROWS.map((r) => (
            <tr key={r.id} id={`guard-playbook-${r.id}`}>
              <th scope="row">
                <span className="mono">{r.display}</span>
              </th>
              <td>
                {r.triggers.map((t) => (
                  <span key={t} className="guard-trigger mono">
                    {t}
                  </span>
                ))}
              </td>
              <td>{r.effect}</td>
              <td>
                {r.unavailable === null ? (
                  <span className="chip chip--state">available</span>
                ) : (
                  <span className="chip">not in v1</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="guard-caveats">
        {PLAYBOOK_ROWS.filter((r) => r.unavailable !== null).map((r) => (
          <div key={r.id} className="guard-caveat">
            <dt className="mono">{r.display}</dt>
            <dd>{r.unavailable}</dd>
          </div>
        ))}
      </dl>

      <p className="panel__note">
        Every activation carries a kernel window of{' '}
        <Value of={spec(PLAYBOOK_FREEZE_WINDOW_BLOCKS, KERNEL_CITATION)} format={formatBlocks} /> (
        <Value of={spec(PLAYBOOK_FREEZE_WINDOW_BLOCKS, KERNEL_CITATION)} format={formatDurationHuman} />
        ), applied playbook-neutrally, and PB-LEDGER-FREEZE admits exactly{' '}
        <Value of={spec(PB_LEDGER_FREEZE_RENEWALS, KERNEL_CITATION)} /> renewal beyond it. An
        active migration cursor stalled more than{' '}
        <Value of={spec(MIGRATION_STALL_BLOCKS, KERNEL_CITATION)} format={int} /> blocks raises
        the PB-MIGRATION halt automatically — and because that playbook has no dispatchable call,
        its accountability path is the halt bridge&rsquo;s own event stream rather than a
        guardian review (<span className="cite">{formatCitation(PLAYBOOK_CITE)}</span>).
      </p>
      <p className="panel__note">
        Every trigger of the enumeration is covered exactly once by the table above;
        PB-HALT-INTAKE owns{' '}
        <Value of={spec(PLAYBOOK_TRIGGER_SET.HaltIntake.length, PLAYBOOK_CITE)} /> of them, which
        is why <Value of={spec(PLAYBOOK_ROWS.length, PLAYBOOK_CITE)} /> playbooks answer{' '}
        <Value of={spec(PLAYBOOK_TRIGGERS.length, PLAYBOOK_CITE)} /> triggers.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/**
 * The rail, in the order a reader needs it.
 *
 * Lede, four key facts, the checklist — and then five drawers, closed. The
 * drawer titles are promises rather than headings ("If it refuses: try again
 * later, or never again"), because a closed drawer is only opened by a reader
 * who can tell from the outside what is inside it.
 */
export function ExecutionGuardScene({ sim }: { sim: SimState }): JSX.Element {
  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame
          model={buildModel(sim)}
          title="The execution guard"
        />
      </div>
      <div className="col-rail">
        <GuardLede />
        <GuardKeyFacts sim={sim} />
        <ChecksPanel sim={sim} />

        <Depth title="What each check actually reads" hint="notes on 5, 8, 13, 14">
          <ChecksNotes />
        </Depth>
        <Depth title="If it refuses: try again later, or never again" hint="7 outcomes">
          <RecoveryPanel sim={sim} />
        </Depth>
        <Depth title="Where this payload sits, and how long it has left" hint="queue · window · clocks">
          <QueuePanel sim={sim} />
        </Depth>
        <Depth title="What winning the vote actually bought" hint="timelock · grace · limits">
          <MandatePanel sim={sim} />
        </Depth>
        <Depth title="When the chain freezes: alarms and guardian playbooks" hint="7 flags · 6 playbooks">
          <SafetyPanel flags={sim.flags} />
          <PlaybooksPanel />
        </Depth>
      </div>
    </div>
  );
}
