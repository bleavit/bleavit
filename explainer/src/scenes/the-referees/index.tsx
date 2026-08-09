import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { LegendEntry, SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import type { ProposalClass } from '../../protocol/types';
import { PLAYBOOK_IDS } from '../../protocol/types';
import {
  ATT_MIN_MEMBERS,
  ATT_QUORUM,
  GUARDIAN_APPROVAL_THRESHOLD,
  GUARDIAN_BOND_VIT,
  GUARDIAN_MEMBERS,
  MAX_NESTED_CALLS,
  MAX_NESTED_LEVELS,
  PLAYBOOK_FREEZE_WINDOW_BLOCKS,
} from '../../protocol/constants';
import { formatDurationHuman } from '../../protocol/epoch';
import { param } from '../../protocol/params';
import { formatVit } from '../../protocol/units';
import { derived, spec } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede, Term } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './the-referees.css';

/**
 * The referees — who is allowed to act, and what stops them (doc 06).
 *
 * The app already shows what the chain checks before it executes something
 * (the execution guard) and how it settles a contested fact (the oracle). It
 * never showed **authority itself**, which is the thing a newcomer actually
 * asks about first: who is in charge here, and what stops them.
 *
 * The answer is a closed set, and "closed" is the whole lesson. A list of
 * permissions cannot say it — every permission list a reader has ever seen was
 * one entry short of an administrator, so a reader supplies the missing entry
 * from experience. So the canvas is not a list. It is a **wall**: eight doors,
 * each admitting exactly one kind of authority, and above all eight a stretch
 * of wall with **no door at all**. The calls behind that stretch are reachable
 * by nobody — not by a vote, not by the safety council, not by the founding
 * key during bootstrap.
 *
 * The second thing the drawing carries is order. A request meets the call
 * filter first — one tall plate that does not care who is asking — and only
 * then looks for its door, which is the target module's own origin check. Both
 * have to admit it, and they are written by parts of the system that do not
 * trust each other. That is why wrapping a call in a batch, a proxy or a
 * multisig buys nothing: the filter walks inside the wrapper, and the door on
 * the far side still asks whose authority this is.
 *
 * Canvas words are plain and never the Rust variant names — a first-time
 * reader gets "New code", an auditor gets `FutarchyCode` in the rail's table,
 * and the table carries both so the two cannot drift.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const C_ORIGINS: Citation = cite('06', '§3.1', 'the eight custom origins, and no path to unrestricted Root');
const C_MATRIX: Citation = cite('06', '§3.2', 'the call-level authority matrix');
const C_FILTER: Citation = cite('06', '§3.3', 'BaseCallFilter, the closed wrapper set, and G-5');
const C_SCHEDULER: Citation = cite('06', '§3.4', 'why the scheduler cannot bypass revalidation');
const C_NOBODY: Citation = cite('00', 'D-13', 'the nobody row is filtered from genesis, sudo included');
const C_GUARD_SEATS: Citation = cite('06', '§5.1', 'membership, bonds and the approval threshold');
const C_POWERS: Citation = cite('06', '§5.2', 'the exhaustive, kernel-scoped power table');
const C_RERUN: Citation = cite('06', '§5.3', 'force_rerun targets a proposal, not one market');
const C_REVIEW: Citation = cite('06', '§5.4', 'retrospective review, the deadline slash, and recall');
const C_PLAYBOOKS: Citation = cite('06', '§6.2', 'the enumerated playbook capability table');
const C_ATTESTORS: Citation = cite('06', '§7', 'the bonded attestor registry and its challenge game');
const C_CLIENT: Citation = cite('00', 'D-20', 'the hosted client domain, reachable by no governance origin');

// ---------------------------------------------------------------------------
// The closed set
// ---------------------------------------------------------------------------

/**
 * The eight origins, exactly as `origins_core::Origin` enumerates them.
 *
 * Order is the enum's own order, because that order is also doc 06 §3.1's and
 * a reader who goes looking for the source should find the same list in the
 * same sequence. `door` is the plain word the canvas prints; `behind` is what
 * lies on the other side of that door, in the fewest words that are still true.
 * Both are inside the twelve-character canvas budget.
 */
interface OriginRow {
  readonly id: string;
  /** The frozen Rust variant name. Never printed on the canvas. */
  readonly name: string;
  /** Plain door word, ≤ 12 characters. */
  readonly door: string;
  /** What is behind it, ≤ 12 characters. */
  readonly behind: string;
  /** The one pallet that mints it, and the only path by which it is minted. */
  readonly mintedBy: string;
  /** What it may reach, in plain language. */
  readonly reaches: string;
}

const ORIGINS: readonly OriginRow[] = Object.freeze([
  {
    id: 'param',
    name: 'FutarchyParam',
    door: 'Settings',
    behind: 'one dial',
    mintedBy: 'the execution guard, running a passed PARAM proposal',
    reaches: 'Setting one governable dial that is already on the register, inside the bounds the register states.',
  },
  {
    id: 'treasury',
    name: 'FutarchyTreasury',
    door: 'Spending',
    behind: 'the money',
    mintedBy: 'the execution guard, running a passed TREASURY proposal',
    reaches: 'Paying money out of the treasury, opening or cancelling a payment stream, funding a budget line.',
  },
  {
    id: 'code',
    name: 'FutarchyCode',
    door: 'New code',
    behind: 'the code',
    mintedBy: 'the execution guard, running a passed CODE proposal',
    reaches: 'Authorising one exact new chain program, whose fingerprint was fixed before anyone traded on it.',
  },
  {
    id: 'meta',
    name: 'FutarchyMeta',
    door: 'Rule change',
    behind: 'the rules',
    mintedBy: 'the execution guard, running a passed META proposal',
    reaches: 'Changing the rules the other proposals are judged by: register metadata, market templates, oracle settings.',
  },
  {
    id: 'values',
    name: 'ConstitutionalValues',
    door: 'Token vote',
    behind: 'who serves',
    mintedBy: 'a passed referendum, enacted through the scheduler',
    reaches: 'Electing and recalling the two bonded councils, ratifying rule-altering decisions, tightening floors.',
  },
  {
    id: 'oracle',
    name: 'OracleResolution',
    door: 'Fact ruling',
    behind: 'one number',
    mintedBy: 'a passed referendum on the oracle track only',
    reaches: 'Settling one disputed measurement for one period, and ruling on a contested incident or milestone filing. Nothing else.',
  },
  {
    id: 'guardian',
    name: 'GuardianHold',
    door: 'Council',
    behind: 'the brakes',
    mintedBy: 'the safety council, on the fifth of seven approvals',
    reaches: 'Four of the five brakes: pause new submissions, delay one decision, re-run one proposal, freeze the queue.',
  },
  {
    id: 'playbook',
    name: 'EmergencyPlaybook',
    door: 'Fire drill',
    behind: 'one script',
    mintedBy: 'the same council, activating a pre-approved script',
    reaches: 'The calls written into that one script, and nothing the script does not already name.',
  },
]);

/**
 * Which door a proposal of each class comes out of.
 *
 * CONSTITUTIONAL is the odd one and deliberately so: `Origin::from_proposal_class`
 * returns nothing for it, because a constitutional subject is a referendum
 * rather than a market. It therefore leaves by the token-vote door, having
 * never been given a belief-side origin at all.
 */
const DOOR_FOR_CLASS: Readonly<Record<ProposalClass, string>> = Object.freeze({
  Param: 'param',
  Treasury: 'treasury',
  Code: 'code',
  Meta: 'meta',
  Constitutional: 'values',
});

/** The calls no origin may reach — doc 06 §3.2's last row, enforced from genesis. */
const NOBODY_ROW: readonly { readonly call: string; readonly plain: string }[] = Object.freeze([
  { call: 'system.set_code', plain: 'Swap the chain program with no checks and no waiting.' },
  { call: 'system.set_code_without_checks', plain: 'The same, with the version check skipped as well.' },
  { call: 'system.authorize_upgrade_without_checks', plain: 'Pre-approve a program without proving it is the one that was agreed.' },
  { call: 'system.set_storage', plain: 'Write any value into any part of the chain’s memory.' },
  { call: 'system.kill_storage / kill_prefix', plain: 'Erase any part of it.' },
  { call: 'balances.force_transfer / force_set_balance', plain: 'Move or mint someone else’s stake, which is also their voting power.' },
  { call: 'vesting.force_vested_transfer / force_remove_vesting_schedule', plain: 'Rewrite somebody else’s lock-up schedule.' },
  { call: 'pallet_xcm.send / force_*', plain: 'Send an arbitrary instruction to another chain in this chain’s name.' },
]);

/** Every call in the runtime that can carry another call, and what happens to it. */
const WRAPPERS: readonly { readonly call: string; readonly treatment: string }[] = Object.freeze([
  { call: 'utility.batch / utility.batch_all / utility.force_batch', treatment: 'Opened, and every call inside is checked, to any depth the budget allows.' },
  { call: 'utility.dispatch_as / utility.as_derivative', treatment: 'Refused outright. They change whose authority the inner call runs under.' },
  { call: 'utility.if_else / utility.dispatch_as_fallible', treatment: 'Refused outright, for the same reason.' },
  { call: 'proxy.proxy / proxy.proxy_announced', treatment: 'Refused if the inner call needs any of the eight authorities; otherwise opened and checked.' },
  { call: 'multisig.as_multi / multisig.as_multi_threshold_1', treatment: 'Same rule. A group of signers is still a signer.' },
  { call: 'multisig.approve_as_multi', treatment: 'Carries only a fingerprint and dispatches nothing; the call that does dispatch is checked.' },
  { call: 'scheduler.*', treatment: 'Refused as something submitted from outside. Referenda drive the scheduler from within.' },
  { call: 'sudo.sudo / sudo.sudo_unchecked_weight', treatment: 'Opened and checked, so the bootstrap key cannot reach a sealed call either.' },
  { call: 'sudo.sudo_as', treatment: 'Refused outright: it would let the bootstrap key act as any account it names.' },
  { call: 'pallet_xcm.execute', treatment: 'Refused outright. Its payload hides the inner call behind an opaque encoding.' },
]);

/** The five powers, in the order doc 06 §5.2 tabulates them. */
const POWERS: readonly {
  readonly id: string;
  readonly call: string;
  readonly plain: string;
  readonly bound: string;
  readonly allowance: string;
}[] = Object.freeze([
  {
    id: 'pause',
    call: 'pause_intake',
    plain: 'Stop new proposals being submitted.',
    bound: 'At most 14 days at a time, and it never touches a market already trading — those run to the end.',
    allowance: 'once per 4 epochs',
  },
  {
    id: 'delay',
    call: 'delay_once',
    plain: 'Hold one decision that has already passed, and send it back to be traded again.',
    bound: 'One proposal, once ever. The re-run gets twice the seeded depth and a hurdle raised by one point, and its answer is final.',
    allowance: 'twice per epoch',
  },
  {
    id: 'rerun',
    call: 'force_rerun',
    plain: 'Re-open all of one proposal’s markets and decide it again.',
    bound: 'Before it executes only, and only once per proposal ever. Nobody’s holdings move: no money is minted, burnt or transferred.',
    allowance: 'once per epoch',
  },
  {
    id: 'playbook',
    call: 'activate_playbook',
    plain: 'Run one pre-approved emergency script.',
    bound: 'Only while that script’s own on-chain trigger is actually set, and only the calls written into it in advance.',
    allowance: 'per script',
  },
  {
    id: 'suspend',
    call: 'suspend_on_gate',
    plain: 'Freeze the queue of things waiting to execute.',
    bound: 'Only while a daily safety-floor breach is flagged, and it releases itself when the flag clears.',
    allowance: 'condition only',
  },
]);

/** Doc 06 §5.2's entrenched prohibitions, verbatim in substance. */
const PROHIBITIONS: readonly string[] = Object.freeze([
  'Enact a proposal. Winning is what enacts things; the council has no way to make something happen.',
  'Move money. Not one unit, not to itself, not to anyone.',
  'Change a market outcome or a settled price. The result is whatever was traded.',
  'Install code. There is no council route to a chain upgrade at all.',
  'Change the constitution.',
  'Widen its own powers. That takes the slowest track there is, plus a passing market on top.',
]);

// ---------------------------------------------------------------------------
// Locally held numbers
// ---------------------------------------------------------------------------

/**
 * Four numbers doc 06 states in prose and no parameter row carries.
 *
 * Each is held here with the section it comes from rather than added to the
 * shared constants module, because each belongs to one mechanism described in
 * one place: doc 13 is the home of *governable* values, and none of these is
 * governable — the review slash and the challenge basis are stated as fractions
 * in §5.4 and §7, the ejection count is a kernel threshold, and the council's
 * proposal expiry is a fixed block count.
 */
const REVIEW_SLASH_FRACTION = 0.5;
const CHALLENGE_BOND_FRACTION = 0.5;
const EJECT_AFTER_FALSE_ATTESTATIONS = 2;
const ACTION_EXPIRY_BLOCKS = 43_200;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/*
 * A wall seen face on, read left to right.
 *
 *   a request → the filter → its own door in the wall → what is behind it
 *
 * The sealed stretch sits at the *top* of the wall, above all eight doors,
 * which is the one arrangement that says what it has to say: whatever a master
 * key would open lies above every authority the chain has, and there is no
 * opening in that stretch for any of them to reach through.
 *
 * Rows are 1.18 apart, which keeps consecutive label baselines well clear of
 * the 0.48-unit line height the placement pass enforces, and the two labelled
 * columns are 6.8 apart against a worst case of 3.03 for the longest pair.
 */
const ROW_TOP = 11.15;
const ROW_PITCH = 1.18;

const WALL_X = 9.4;
const WALL_LO = 1.3;
const WALL_HI = 11.63;

const DOOR_W = 1.5;
const DOOR_H = 0.62;

const BEHIND_X = 13.9;
const BEHIND_W = 4.6;

const FILTER_X = 3.7;
const FILTER_W = 1.2;

const CALLER_X = 0.5;
const CALLER_W = 1.6;
const CALLER_H = 0.9;
const CALLER_Y = 5.98;

const SEAL_W = 2.6;
const SEAL_H = 0.32;

const doorRowY = (i: number): number => ROW_TOP - (i + 1) * ROW_PITCH;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export function buildModel(sim: SimState): SceneModel {
  const live = DOOR_FOR_CLASS[sim.proposal.cls];
  const nodes: SceneNode[] = [];

  nodes.push({
    id: 'request',
    domRowId: 'ref-request',
    kind: 'chip',
    x: CALLER_X,
    y: CALLER_Y,
    w: CALLER_W,
    h: CALLER_H,
    tone: 'dim',
    state: 'active',
    label: 'a request',
    sublabel: `#${sim.proposal.id} ${sim.proposal.cls}`,
  });

  // One plate, the full height of the wall: the filter stands in front of every
  // door at once and asks nothing about who is knocking.
  nodes.push({
    id: 'filter',
    domRowId: 'ref-filter',
    kind: 'stop',
    x: FILTER_X,
    y: WALL_LO,
    w: FILTER_W,
    h: WALL_HI - WALL_LO,
    tone: 'ink',
    state: 'active',
    label: 'the filter',
    sublabel: 'asks no name',
  });

  // The sealed stretch. A ceiling is the one mark that reads as a hard top edge
  // with nothing above it, which is exactly the claim.
  nodes.push({
    id: 'seal',
    domRowId: 'ref-nobody',
    kind: 'ceiling',
    x: WALL_X - SEAL_W / 2,
    y: ROW_TOP + 0.16,
    w: SEAL_W,
    h: SEAL_H,
    tone: 'ink',
    state: 'active',
    label: 'no door',
  });

  nodes.push({
    id: 'forbidden',
    domRowId: 'ref-nobody',
    kind: 'node',
    x: BEHIND_X,
    y: ROW_TOP - DOOR_H / 2,
    w: BEHIND_W,
    h: DOOR_H,
    tone: 'dim',
    state: 'blocked',
    label: 'wipe storage',
  });

  ORIGINS.forEach((o, i) => {
    const centre = doorRowY(i);
    const chosen = o.id === live;
    nodes.push({
      id: `door-${o.id}`,
      domRowId: `ref-origin-${o.id}`,
      kind: 'stop',
      x: WALL_X - DOOR_W / 2,
      y: centre - DOOR_H / 2,
      w: DOOR_W,
      h: DOOR_H,
      tone: 'ink',
      state: chosen ? 'passed' : 'active',
      label: o.door,
    });
    nodes.push({
      id: `behind-${o.id}`,
      domRowId: `ref-origin-${o.id}`,
      kind: 'node',
      x: BEHIND_X,
      y: centre - DOOR_H / 2,
      w: BEHIND_W,
      h: DOOR_H,
      tone: 'dim',
      state: chosen ? 'passed' : 'active',
      label: o.behind,
    });
  });

  const rules: SceneRule[] = [
    {
      id: 'wall',
      axis: 'y',
      at: WALL_X,
      from: WALL_LO,
      to: WALL_HI,
      tone: 'ink',
      label: 'the wall',
    },
    {
      // The reading order, named on the drawing rather than left to be inferred:
      // the two checks are the two ticks in the middle, and they are separate
      // marks because they are separate checks.
      id: 'order',
      axis: 'x',
      at: 0.62,
      from: CALLER_X + CALLER_W / 2,
      to: BEHIND_X + BEHIND_W / 2,
      tone: 'dim',
      dashed: true,
      ticks: [
        { at: CALLER_X + CALLER_W / 2, label: 'who asks' },
        { at: FILTER_X + FILTER_W / 2, label: 'check 1' },
        { at: WALL_X, label: 'check 2' },
        { at: BEHIND_X + BEHIND_W / 2, label: 'what happens' },
      ],
    },
  ];

  const legend: readonly LegendEntry[] = [
    { mark: 'ink', shape: 'stop', label: 'A door: one kind of authority, and only that one' },
    { mark: 'ink', shape: 'ceiling', label: 'Sealed wall — no door exists here for anybody' },
    { mark: 'dim', shape: 'node', label: 'What is on the other side' },
  ];

  return {
    nodes,
    rules,
    legend,
    relation:
      'A closed set, drawn as a wall. Eight doors, each admitting exactly one kind of authority — ' +
      'and above all eight, a stretch of wall with no door in it at all. That is the thing a list of ' +
      'permissions cannot say: a list is always one row short of an administrator, and a reader ' +
      'supplies the missing row from every other system they have used. Here the missing row is ' +
      'drawn, and it is masonry. The order across the drawing is the order a request is checked in: ' +
      'the filter first, which never asks who is knocking, then the door itself, which asks nothing else.',
    caption: 'Eight doors, a council with five buttons, and no master key.',
    unitLegend: 'The lit door is the one this scenario’s proposal would come out of.',
  };
}

// ---------------------------------------------------------------------------
// Rail helpers
// ---------------------------------------------------------------------------

const int = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (v: number): string => `${Math.round(v * 100)}%`;

function Cite({ of }: { of: Citation }): JSX.Element {
  return <span className="cite">{formatCitation(of)}</span>;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function OriginsPanel(): JSX.Element {
  return (
    <div className="panel">
      <table className="ref-table">
        <caption className="ref-caption">
          Every one is minted by exactly one module through exactly one path. None can be
          obtained by signing a transaction, by a message from another chain, or by wrapping
          a call inside another call. <Cite of={C_ORIGINS} />
        </caption>
        <thead>
          <tr>
            <th scope="col">Door</th>
            <th scope="col">Its name in the code</th>
            <th scope="col">Who mints it</th>
            <th scope="col">What it may reach</th>
          </tr>
        </thead>
        <tbody>
          {ORIGINS.map((o) => (
            <tr key={o.id} id={`ref-origin-${o.id}`}>
              <th scope="row">
                <span className="ref-door">{o.door}</span>
                <span className="ref-behind">{o.behind}</span>
              </th>
              <td>
                <code className="ref-code">{o.name}</code>
              </td>
              <td>{o.mintedBy}</td>
              <td>{o.reaches}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ref-notes">
        <div className="ref-note">
          <dt>There is no ninth, and no way to Root.</dt>
          <dd>
            Most chains keep one authority that can do anything, and every permission list
            you have read had one. This one does not. The single place the chain still uses
            the all-powerful origin is an internal call it builds itself, to authorise the
            exact upgrade whose fingerprint was already agreed — and nothing outside the
            chain can reach it. <Cite of={C_ORIGINS} />
          </dd>
        </div>
        <div className="ref-note">
          <dt>Why you may see twelve entries and not eight.</dt>
          <dd>
            The table the code checks calls against has more rows than there are authorities,
            because it also has to name the things that are <em>not</em> an authority: calls
            anyone may make, calls nobody may make, calls the chain only makes to itself, and
            the separate lane the hosted question service uses. None of those four is a say-so
            anybody holds. <Cite of={C_CLIENT} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ChecksPanel(): JSX.Element {
  return (
    <div className="panel">
      <p className="ref-para" id="ref-filter">
        Two checks stand between a request and its effect, and they are not variations of
        each other. The first is a <strong>filter that never asks who is knocking</strong>:
        it looks only at the call and refuses whole families outright. The second is the
        target module’s own question — <em>is this the authority I require?</em> — asked by
        the module itself, which was written to distrust whatever routed the call to it.
        Both must admit the call. <Cite of={C_FILTER} />
      </p>
      <p className="ref-para">
        The two are wired differently on the two routes into the system, and that is
        deliberate. A mandate that won a market is re-checked <em>with its authority in
        hand</em> and only then dispatched. A decision that won a token vote is enacted by
        the scheduler through the ordinary path, so it must clear the origin-blind filter
        first, exactly as a call typed in by hand would. Nothing skips a check by arriving
        from inside. <Cite of={C_SCHEDULER} />
      </p>

      <h4 className="ref-subhead">Hiding a call inside another call</h4>
      <p className="ref-para">
        A <Term word="batch">One call that carries several others and runs them together, so a
        wallet can submit a whole plan in one go.</Term>, a{' '}
        <Term word="proxy">A standing arrangement letting one account act for another, so an
        everyday key can be used without exposing the key that owns the funds.</Term> or a{' '}
        <Term word="multisig">An account several people share, where an action only happens
        once enough of them have signed for it.</Term> is the classic way to smuggle a
        forbidden call past a check that only looks at the outside. The filter opens all of
        them and checks what is inside, and it spends one shared budget doing it, so a deeply
        nested payload cannot exhaust the check by being enormous.
      </p>
      <table className="ref-table">
        <thead>
          <tr>
            <th scope="col">Carrier</th>
            <th scope="col">What happens to it</th>
          </tr>
        </thead>
        <tbody>
          {WRAPPERS.map((w) => (
            <tr key={w.call}>
              <th scope="row">
                <code className="ref-code">{w.call}</code>
              </th>
              <td>{w.treatment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ref-para ref-para--tight">
        The budget: at most{' '}
        <Value of={spec(MAX_NESTED_LEVELS, cite('13', '§2', 'MAX_NESTED — filter recursion bound'))} />{' '}
        levels of nesting and{' '}
        <Value of={spec(MAX_NESTED_CALLS, cite('13', '§2', 'MAX_NESTED — total call nodes per evaluation'))} />{' '}
        calls in total, counting each wrapper as well as each leaf, shared across the whole
        payload and never reset. <Cite of={C_FILTER} />
      </p>
    </div>
  );
}

function NobodyPanel(): JSX.Element {
  return (
    <div className="panel">
      <p className="ref-para" id="ref-nobody">
        These are the calls the wall has no door for. They are refused to every one of the
        eight authorities <strong>and to the founding key during start-up</strong>, from the
        chain’s very first block — not switched off later once things settled down. Each one
        is here because it would let its holder skip the whole machine: rewrite memory
        directly, mint somebody else’s voting stake, or install a program nobody agreed to.{' '}
        <Cite of={C_NOBODY} />
      </p>
      <table className="ref-table">
        <thead>
          <tr>
            <th scope="col">Call</th>
            <th scope="col">What it would let someone do</th>
          </tr>
        </thead>
        <tbody>
          {NOBODY_ROW.map((r) => (
            <tr key={r.call}>
              <th scope="row">
                <code className="ref-code">{r.call}</code>
              </th>
              <td>{r.plain}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ref-para ref-para--tight">
        The last three rows are the same rule carried over to this chain’s own token and its
        lock schedules: stake here is voting power, so forcing it about would be rewriting the
        electorate. Sealing all of them is what makes the other eight doors mean anything. An
        authority that can be widened by writing to storage is not narrow, however narrowly it
        is described. <Cite of={C_MATRIX} />
      </p>
    </div>
  );
}

function AttestorsPanel(): JSX.Element {
  const bond = param('att.bond');
  const contestWindow = param('att.window');
  return (
    <div className="panel">
      <p className="ref-para">
        Winning a market buys permission to install new chain code. It does not buy agreement
        that the code is what it claims to be. So a code proposal cannot even enter the
        running unless at least three independent reviewers are seated, and it cannot be
        adopted without two of them having signed for that exact program — with money on the
        line when they do.
      </p>
      <dl className="ref-facts">
        <div className="ref-fact">
          <dt>Reviewers seated, at least</dt>
          <dd>
            <Value of={spec(ATT_MIN_MEMBERS, C_ATTESTORS)} /> — below that, no code proposal can
            qualify at all
          </dd>
        </div>
        <div className="ref-fact">
          <dt>Signatures needed</dt>
          <dd>
            <Value of={spec(ATT_QUORUM, C_ATTESTORS)} /> from different reviewers, each of whose
            challenge window has already closed
          </dd>
        </div>
        <div className="ref-fact">
          <dt>What each puts at risk</dt>
          <dd>
            <Value of={spec(bond.value, bond.cite)} unit="VIT" format={int} /> — held from the
            moment they are seated, not paid when they sign (<code className="ref-code">{bond.key}</code>)
          </dd>
        </div>
        <div className="ref-fact">
          <dt>Time to contest a signature</dt>
          <dd>
            <Value of={spec(contestWindow.value, contestWindow.cite)} unit="blocks" format={int} />{' '}
            ({formatDurationHuman(contestWindow.value)}), from the moment it is posted (
            <code className="ref-code">{contestWindow.key}</code>)
          </dd>
        </div>
      </dl>
      <p className="ref-para">
        What a reviewer signs is not an opinion. It is a claim that they rebuilt the program
        from its source and got <em>the same bytes</em>, and that the rebuilt program still
        keeps the rules the chain is not allowed to break — with a published report behind
        the claim. Anyone at all may contest one by posting a bond of at least{' '}
        <Value of={derived(CHALLENGE_BOND_FRACTION, C_ATTESTORS)} format={pct} /> of what that
        reviewer is actually holding, so raising the reviewers’ stake can never price
        contesting out of reach. A contested signature stops counting while the contest is
        open. <Cite of={C_ATTESTORS} />
      </p>
      <p className="ref-para ref-warn">
        <strong>Read the verdict carefully.</strong> The call that settles a contest is{' '}
        <code className="ref-code">resolve_challenge(id, attestation_upheld)</code>, and{' '}
        <em>upheld</em> means <strong>the signature stood</strong> — the challenger was wrong
        and loses their bond. It does not mean the challenge succeeded. Read the other way
        round, every one of these outcomes inverts.
      </p>
      <p className="ref-para ref-para--tight">
        The losing side forfeits{' '}
        <Value of={derived(CHALLENGE_BOND_FRACTION, C_ATTESTORS)} format={pct} /> of its bond,
        rounded up against whoever lost, and the proceeds go to the insurance account.{' '}
        <Value of={spec(EJECT_AFTER_FALSE_ATTESTATIONS, C_ATTESTORS)} /> signatures ruled false
        cost a reviewer the seat outright. Checking what an attestation actually{' '}
        <em>says</em> stays a human job in the end — but
        a false one now costs a bond, a seat and a public ruling instead of nothing.{' '}
        <Cite of={C_ATTESTORS} />
      </p>
    </div>
  );
}

function PowersPanel(): JSX.Element {
  return (
    <div className="panel">
      <p className="ref-para">
        <Term word="Guardians">A council of seven, elected by token holders, each holding a
        large deposit that can be taken from them. They exist to stop things going wrong
        quickly, and they are given no way to make anything happen.</Term> hold five powers
        and no others. Every one of them <strong>subtracts</strong>: it stops, delays, or
        undoes. None of them adds. Any member may propose an action; the{' '}
        <Value of={spec(GUARDIAN_APPROVAL_THRESHOLD, C_GUARD_SEATS)} />th approval out of{' '}
        <Value of={spec(GUARDIAN_MEMBERS, C_GUARD_SEATS)} /> seats dispatches it in the same
        instant. An unapproved proposal simply expires after{' '}
        <Value of={spec(ACTION_EXPIRY_BLOCKS, C_GUARD_SEATS)} unit="blocks" format={int} /> (
        {formatDurationHuman(ACTION_EXPIRY_BLOCKS)}). <Cite of={C_GUARD_SEATS} />
      </p>
      <table className="ref-table">
        <thead>
          <tr>
            <th scope="col">Power</th>
            <th scope="col">What it does</th>
            <th scope="col">How often</th>
          </tr>
        </thead>
        <tbody>
          {POWERS.map((p) => (
            <tr key={p.id} id={`ref-power-${p.id}`}>
              <th scope="row">
                <code className="ref-code">{p.call}</code>
              </th>
              <td>
                <span className="ref-plain">{p.plain}</span>
                <span className="ref-bound">{p.bound}</span>
              </td>
              <td className="ref-allowance">{p.allowance}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ref-para ref-para--tight">
        Two details worth having exactly right. A re-run resets <em>all</em> of one proposal’s
        markets rather than a single one, and it moves nobody’s holdings — no minting, no
        burning, no transfer, just a fresh window and one final decision.{' '}
        <Cite of={C_RERUN} /> And the scripts are not written in the emergency: there are{' '}
        <Value of={spec(PLAYBOOK_IDS.length, C_PLAYBOOKS)} /> of them, each approved in
        advance and each naming the exact calls it may make — one of them names none at all,
        so activating it does nothing and records nothing. None may run longer than{' '}
        <Value of={spec(PLAYBOOK_FREEZE_WINDOW_BLOCKS, C_PLAYBOOKS)} unit="blocks" format={int} />{' '}
        ({formatDurationHuman(PLAYBOOK_FREEZE_WINDOW_BLOCKS)}) for any of them.{' '}
        <Cite of={C_PLAYBOOKS} />
      </p>

      <h4 className="ref-subhead">And the six things they cannot do</h4>
      <ul className="ref-list">
        {PROHIBITIONS.map((p) => (
          <li key={p} className="ref-prohibition">
            {p}
          </li>
        ))}
      </ul>
      <p className="ref-para ref-para--tight">
        This list is not a policy the council agreed to follow. The scope is fixed in the
        chain’s program, and moving it needs the slowest track the chain has — the one with
        the highest bar and a delay measured in months — <em>plus</em> a passing market
        besides. Both layers must agree, independently. <Cite of={C_POWERS} />
      </p>
    </div>
  );
}

function ReviewPanel(): JSX.Element {
  const deadline = param('grd.review_dl');
  const slashed = GUARDIAN_BOND_VIT * REVIEW_SLASH_FRACTION;
  return (
    <div className="panel">
      <p className="ref-para">
        A brake nobody has to answer for is a brake that gets pulled. So every guardian action
        books its own hearing at the moment it happens: the council itself files the review
        referendum, and the deposits for it come <strong>out of the bonds of the members who
        approved the action</strong>, released back to them if the review agrees. Nobody has
        to remember to hold them to account, and nobody has to fund it. <Cite of={C_REVIEW} />
      </p>
      <dl className="ref-facts">
        <div className="ref-fact">
          <dt>Each member’s deposit</dt>
          <dd>
            <Value of={spec(GUARDIAN_BOND_VIT, C_GUARD_SEATS)} unit="VIT" format={formatVit} /> —
            held for the whole term and one epoch after it
          </dd>
        </div>
        <div className="ref-fact">
          <dt>Time to hold the review</dt>
          <dd>
            <Value of={spec(deadline.value, deadline.cite)} unit="epochs" format={int} /> (
            <code className="ref-code">{deadline.key}</code>)
          </dd>
        </div>
        <div className="ref-fact">
          <dt>If it is not held in time</dt>
          <dd>
            every approver loses{' '}
            <Value of={derived(REVIEW_SLASH_FRACTION, C_REVIEW)} format={pct} /> of their
            deposit — <Value of={derived(slashed, C_REVIEW)} unit="VIT" format={formatVit} />{' '}
            each, to the treasury
          </dd>
        </div>
      </dl>
      <p className="ref-para">
        Missing the deadline is itself the offence. It does not matter whether the action was
        right: five members who acted and then let the hearing lapse are slashed, and a recall
        vote is filed against them automatically, out of the same money. A recall clears every
        approver out of the council and leaves their seats empty until token holders fill
        them. <Cite of={C_REVIEW} />
      </p>
      <p className="ref-para ref-para--tight">
        Empty seats <em>weaken</em> the council rather than concentrating it: the{' '}
        <Value of={spec(GUARDIAN_APPROVAL_THRESHOLD, C_GUARD_SEATS)} />-approval bar is anchored
        to the full{' '}
        <Value of={spec(GUARDIAN_MEMBERS, C_GUARD_SEATS)} /> seats, so with fewer than five
        members seated no guardian action can dispatch at all. Losing the referees stops the
        brakes working; it never hands the brakes to whoever is left. <Cite of={C_REVIEW} />
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function TheRefereesScene({ sim }: { sim: SimState }): JSX.Element {
  const bond = param('att.bond');

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame model={buildModel(sim)} title="The referees" />
      </div>
      <div className="col-rail">
        <Lede>
          A chain like this usually has an owner — one key that can change anything, held by
          whoever built it. This one has none. Every action carries a stamp saying{' '}
          <strong>on whose say-so</strong> it is being taken, there are exactly eight stamps,
          and not one of them means “everything”. Even the safety council, the most powerful
          group here, can only ever <strong>stop</strong> things: never spend, never install
          code, never change a result.
        </Lede>

        <KeyFacts>
          <KeyFact
            label="Kinds of authority"
            note="There is no ninth, and none of them means everything."
          >
            <Value of={spec(ORIGINS.length, C_ORIGINS)} />
          </KeyFact>
          <KeyFact
            label="For the council to act"
            note="Five of seven must approve — and all five powers only subtract."
          >
            <Value
              of={spec(
                `${GUARDIAN_APPROVAL_THRESHOLD} of ${GUARDIAN_MEMBERS}`,
                C_GUARD_SEATS,
              )}
            />
          </KeyFact>
          <KeyFact
            label="Rebuilds before new code"
            note={`Two reviewers must each get the same bytes, with ${int(bond.value)} VIT at risk.`}
          >
            <Value of={spec(ATT_QUORUM, C_ATTESTORS)} />
          </KeyFact>
        </KeyFacts>

        <p className="ref-lede2" id="ref-request">
          What a stamp is not: it is not who signed. Signing says which account paid for the
          transaction. The stamp says on whose authority it is taken — and an{' '}
          <Jargon word="origin" /> can only be created by the one part of the system entitled
          to create it.
        </p>

        <Depth title="The eight kinds of authority, and what each one may do" hint="8 doors">
          <OriginsPanel />
        </Depth>
        <Depth
          title="Two checks, by two parts that do not trust each other"
          hint={`${MAX_NESTED_LEVELS} levels · ${MAX_NESTED_CALLS} calls`}
        >
          <ChecksPanel />
        </Depth>
        <Depth title="The calls nobody may make — the stretch with no door" hint={`${NOBODY_ROW.length} families`}>
          <NobodyPanel />
        </Depth>
        <Depth
          title="Before new chain code goes in: bonded rebuilders"
          hint={`${ATT_QUORUM} of ${ATT_MIN_MEMBERS}`}
        >
          <AttestorsPanel />
        </Depth>
        <Depth title="The council’s five powers, and the six it does not have" hint="5 powers">
          <PowersPanel />
        </Depth>
        <Depth title="Every action puts the council’s own money on the line" hint="2 epochs">
          <ReviewPanel />
        </Depth>
      </div>
    </div>
  );
}
