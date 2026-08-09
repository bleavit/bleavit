import { Fragment } from 'react';
import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { LegendEntry, SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import {
  INTEGRATION_CONTRACT_VERSION,
  MAX_LIVE_PROPOSALS,
  MAX_POSITIONS_PER_ACCOUNT,
  RECENT_COHORT_SUMMARIES,
} from '../../protocol/constants';
import type { REAL_SOURCE_METHODS } from '../../provenance/types';
import { derived, spec } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './the-window.css';

/**
 * The window — what the outside world can see, and how it knows the answer is
 * true (doc 02, doc 10 §4.2/§5.2, doc 12 §3.1/§6.3).
 *
 * The one idea this scene exists to plant is that a reader does not have to
 * trust the thing serving them. A light client fetches a proof alongside every
 * value and checks it against a block header it already accepted, so a hostile
 * peer can **withhold** an answer and cannot **forge** one. Everything else here
 * — the frozen list, the sixteen questions, the storage key, the completeness
 * rule — exists to keep that property working across a chain that replaces its
 * own code.
 *
 * The canvas is therefore a wall with a small number of labelled openings. It is
 * drawn that way because the fact worth seeing is a *shape*, not a value: the
 * openings are few, they are the whole of what may be depended on, and each one
 * carries evidence out alongside the answer. A sixteen-row method table says
 * what is there. It cannot say that the list is closed, and the closedness is
 * the promise.
 *
 * Nothing on this stage moves with the scenario. That is not an oversight: the
 * frozen surface is the one part of this system a simulation step cannot
 * change, and pretending otherwise would teach the opposite of the point.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const C_API: Citation = cite('02', '§3', 'the frozen FutarchyApi — 16 methods, normative');
const C_VIEWS: Citation = cite('02', '§4', 'view types, append-only after genesis');
const C_SCALE: Citation = cite('02', '§2', 'shared SCALE primitives, append-only discipline');
const C_EVENTS: Citation = cite('02', '§6', 'the frozen event schema');
const C_STORAGE: Citation = cite('02', '§7', 'storage items the frontend reads directly');
const C_IDENTITY: Citation = cite('02', '§8', 'chain identity constants; the contract version in force');
const C_BINDING: Citation = cite('02', '§9', 'constants and parameter binding — no frontend hardcodes');
const C_CHANNEL: Citation = cite('02', '§12', 'the ReleaseChannel fixed-layout raw storage key');
const C_CONTROL: Citation = cite('02', '§13', 'change control: append-only, version bump on every change');
const C_GUARDREADS: Citation = cite('02', '§7.8', 'the dispatch checks the client must mirror (SQ-589)');
const C_FOREIGN: Citation = cite('02', '§7.7', 'the Asset Hub surface, pinned per release (SQ-587)');
const C_SMOLDOT: Citation = cite('10', '§4.2', 'what smoldot can and cannot serve — stated plainly');
const C_CLASSIFIER: Citation = cite('10', '§5.2', 'compatibility gating: the CRITICAL_SURFACE classifier');
const C_NOHARDCODE: Citation = cite('10', '§5.4', 'no numeric chain constant may appear as a literal');
const C_STRANDED: Citation = cite('12', '§3.1', 'reader discipline for the stranded-app release channel');
const C_TELEMETRY: Citation = cite('12', '§6.3', 'the monitoring-only TelemetryApi, outside contract 02');
const C_TELCODE: Citation = cite('code', 'runtime-api/src/telemetry.rs:138', 'decl_runtime_apis! TelemetryApi');
const C_APICODE: Citation = cite('code', 'runtime-api/src/lib.rs:39', 'decl_runtime_apis! FutarchyApi');
const C_KEYCODE: Citation = cite(
  'code',
  'tools/release/release_common.py:143',
  'storage_prefix(pallet, item) = twox128(pallet) ++ twox128(item)',
);
const C_SURFACEGATE: Citation = cite(
  'code',
  'tools/ci/check-client-surface-obligations.py',
  'the inverse gate: every mandated client read must name a frozen surface',
);

// ---------------------------------------------------------------------------
// Facts held here rather than guessed
// ---------------------------------------------------------------------------

/**
 * Bytes in one `twox128` digest, and therefore in each half of a storage key.
 *
 * Held as a named constant so the 32-byte total on screen is arithmetic the
 * reader can follow rather than a number somebody typed.
 */
const TWOX128_BYTES = 16;

/** The frozen release record, read by offset and never by chain metadata (02 §12). */
const RELEASE_RECORD_BYTES = 168;

/**
 * Bounds doc 02 §3 states for three answers that `protocol/constants.ts` does
 * not carry. Kept local rather than added to the shared constants module,
 * because they are display facts for this one table.
 */
const MAX_PARAM_KEYS = 64;
const MAX_OPEN_ORACLE_ROUNDS = 192;
const MAX_TREASURY_STREAMS = 128;

/** How many of doc 02 §3's exceptions to the recomputability posture there are. */
const NOT_RECOMPUTABLE = 3;

/** Doc 02 §7.8: thirteen dispatch checks the client must mirror, seven unfrozen. */
const MIRRORED_CHECKS = 13;
const UNFROZEN_CHECKS = 7;

/** Doc 02 §7.8: the twelve surfaces contract v24 repaired for the same reason. */
const V24_SURFACES = 12;

// ---------------------------------------------------------------------------
// The sixteen questions
// ---------------------------------------------------------------------------

type MethodName = (typeof REAL_SOURCE_METHODS)[number];

interface MethodRow {
  readonly method: MethodName;
  /** One line, in ordinary words: what does asking this get you? */
  readonly answers: string;
  /** The ceiling on the answer, stated where doc 02 §3 states one. */
  readonly ceiling: string;
}

/**
 * Every method, in the order the contract declares them.
 *
 * The list is keyed on `REAL_SOURCE_METHODS` — the app's single home for the
 * frozen sixteen — and the test asserts the two agree name for name. A row
 * invented here that the contract does not declare, or a method the contract
 * declares that nobody described, both fail rather than quietly ship.
 */
export const METHODS: readonly MethodRow[] = Object.freeze([
  {
    method: 'epoch_status()',
    answers: 'Where the chain is in its repeating cycle, and whether anything is frozen.',
    ceiling: 'one small record',
  },
  {
    method: 'proposal_summaries()',
    answers: 'Every proposal currently alive, its stage, and its deadlines.',
    ceiling: `up to ${String(MAX_LIVE_PROPOSALS)} proposals`,
  },
  {
    method: 'quote(market, side, amount)',
    answers: 'What one trade would cost right now, fee included, before you commit to it.',
    ceiling: 'one price',
  },
  {
    method: 'decision_stats(pid)',
    answers:
      'The finished arithmetic behind one decision. Deliberately absent until the trading windows are sealed, so no screen can show a forecast dressed as a verdict.',
    ceiling: 'one record, or nothing',
  },
  {
    method: 'account_positions(who)',
    answers: 'What one account holds in the main ledger.',
    ceiling: `up to ${String(MAX_POSITIONS_PER_ACCOUNT)} holdings`,
  },
  {
    method: 'execution_queue()',
    answers: 'What has been approved and is waiting out its compulsory delay.',
    ceiling: `up to ${String(MAX_LIVE_PROPOSALS)} items`,
  },
  {
    method: 'welfare_current()',
    answers: 'This period’s measurements of how well things are going, and their cut-offs.',
    ceiling: 'one record',
  },
  {
    method: 'params(keys)',
    answers: 'The current value of a setting, together with the range it may legally be moved within.',
    ceiling: `up to ${String(MAX_PARAM_KEYS)} settings per call`,
  },
  {
    method: 'nav()',
    answers: 'What the treasury is worth once everything it already owes is subtracted.',
    ceiling: 'one record',
  },
  {
    method: 'recent_cohorts()',
    answers: 'How the last completed periods actually settled.',
    ceiling: `the last ${String(RECENT_COHORT_SUMMARIES)}`,
  },
  {
    method: 'open_oracle_rounds()',
    answers: 'Which measurements somebody is currently disputing, and by when.',
    ceiling: `up to ${String(MAX_OPEN_ORACLE_ROUNDS)} rounds`,
  },
  {
    method: 'hosted_report(question)',
    answers: 'The sealed answer to one question the chain was paid to run for an outside client.',
    ceiling: 'one report, or nothing',
  },
  {
    method: 'service_positions(who)',
    answers:
      'What one account holds in the separate ledger those hosted questions use. Separate on purpose: an account may lawfully fill both, and one shared list would silently drop half of somebody’s money.',
    ceiling: `up to ${String(MAX_POSITIONS_PER_ACCOUNT)} holdings`,
  },
  {
    method: 'is_reserved_protocol_destination(account)',
    answers:
      'Whether a transfer to this address would be refused. The chain answers, because the rule is a test the runtime runs and not a value anybody stores.',
    ceiling: 'yes or no',
  },
  {
    method: 'bond_quote(kind)',
    answers:
      'How much money an action would lock up, priced at this moment. Asked before the record that will freeze the figure exists, so it is a quote and fixes on submission.',
    ceiling: 'one amount, or nothing',
  },
  {
    method: 'treasury_streams()',
    answers: 'Which scheduled payments name you, and exactly what is claimable now.',
    ceiling: `up to ${String(MAX_TREASURY_STREAMS)} streams`,
  },
]);

/** Slug for a DOM row id: the method name up to its bracket. */
const methodSlug = (m: MethodName): string => m.replace(/\(.*$/, '');
const methodRowId = (m: MethodName): string => `window-method-${methodSlug(m)}`;

// ---------------------------------------------------------------------------
// The openings
// ---------------------------------------------------------------------------

interface SurfaceRow {
  readonly id: string;
  /** Canvas label for the opening. Twelve characters, hard budget. */
  readonly opening: string;
  /** Canvas label for what comes out of it. Same budget. */
  readonly value: string;
  /** The rail's name for it, in ordinary words. */
  readonly name: string;
  /** What comes through, and what it is for. */
  readonly what: string;
  /** Whether it is on the promised list at all. */
  readonly promised: boolean;
  readonly cite: Citation;
}

/**
 * The whole readable surface, one row per kind of opening.
 *
 * Five are frozen. The sixth is real, useful, and deliberately outside the
 * promise — drawn below the dashed line so the picture shows that the list has
 * an edge, which is the property the whole document is about.
 */
export const SURFACES: readonly SurfaceRow[] = Object.freeze([
  {
    id: 'api',
    opening: '16 questions',
    value: 'an answer',
    name: 'The sixteen questions',
    what: 'Read-only calls that answer what a screen needs. They cost nothing and change nothing, and every answer has a stated ceiling.',
    promised: true,
    cite: C_API,
  },
  {
    id: 'records',
    opening: 'the records',
    value: 'a record',
    name: 'The stored records',
    what: 'The raw entries behind those answers, readable one by one — so the answers above can be checked rather than believed.',
    promised: true,
    cite: C_STORAGE,
  },
  {
    id: 'log',
    opening: 'the log',
    value: 'a log line',
    name: 'The event log',
    what: 'The line the chain writes whenever something happens, with the fields it will always carry. This is how an app learns what changed without re-reading everything.',
    promised: true,
    cite: C_EVENTS,
  },
  {
    id: 'settings',
    opening: 'the settings',
    value: 'a number',
    name: 'Identity and settings',
    what: 'Which chain this is, and every number the chain governs. An app is forbidden to write any of these into itself: it asks, every time.',
    promised: true,
    cite: C_BINDING,
  },
  {
    id: 'notice',
    opening: 'the notice',
    value: '168 bytes',
    name: 'The release notice',
    what: 'One fixed record at one fixed address, saying which app release is current. Readable by an app too old to understand anything else the chain says.',
    promised: true,
    cite: C_CHANNEL,
  },
  {
    id: 'telemetry',
    opening: 'operators',
    value: 'a reading',
    name: 'The operators’ readings',
    what: 'Diagnostics for whoever runs the machines. Not on the promised list, never read by the app, and free to change shape — which is exactly what keeps the promised list short.',
    promised: false,
    cite: C_TELEMETRY,
  },
]);

const surfaceRowId = (id: string): string => `window-surface-${id}`;

const PROMISED = SURFACES.filter((s) => s.promised);

// ---------------------------------------------------------------------------
// The operators' second window
// ---------------------------------------------------------------------------

interface TelemetryRow {
  readonly name: string;
  readonly reports: string;
  /** Whether the method can answer "I could not take this reading". */
  readonly canSayMissing: boolean;
}

/**
 * Every method of the monitoring-only trait, as the runtime declares it.
 *
 * The column that matters is the last one: eight of the ten answer with a box
 * that may be empty, so a reading that could not be taken comes back as absent
 * rather than as a zero. A zero is a healthy-looking number, and a broken
 * collector must never look healthy.
 */
export const TELEMETRY: readonly TelemetryRow[] = Object.freeze([
  { name: 'market_books', reports: 'What each live market book has actually lost, beside the worst it could ever lose.', canSayMissing: true },
  { name: 'mid_window_coverage', reports: 'How completely each open pricing window has been sampled so far.', canSayMissing: true },
  { name: 'pol', reports: 'Money the protocol has put behind its own books, against the floor it must keep.', canSayMissing: true },
  { name: 'collateral', reports: 'What the main ledger is holding against what it owes, plus any unexplained excess.', canSayMissing: true },
  { name: 'service_collateral', reports: 'The same two figures for the separate hosted-question ledger, audited on their own.', canSayMissing: true },
  { name: 'reserve_probe_line_balance', reports: 'How much is left in the small budget that pays for cross-chain health checks.', canSayMissing: false },
  { name: 'migration_cursor_stalled', reports: 'Whether a long-running storage migration has stopped moving.', canSayMissing: false },
  { name: 'storage_utilization', reports: 'How full each bounded shelf is — a fact the chain’s self-description cannot express.', canSayMissing: true },
  { name: 'service_egress', reports: 'How often report deliveries to each outside client succeeded or failed.', canSayMissing: true },
  { name: 'service_partition', reports: 'How much of the hosted-question allowance is in use, and the falsifier that goes with it.', canSayMissing: true },
]);

const telemetryRowId = (name: string): string => `window-telemetry-${name}`;

const TELEMETRY_OPTIONAL = TELEMETRY.filter((t) => t.canSayMissing);

// ---------------------------------------------------------------------------
// The repeated defect: a list that was correct and not complete
// ---------------------------------------------------------------------------

interface GapRow {
  readonly id: string;
  readonly what: string;
  readonly cost: string;
  readonly cite: Citation;
}

export const GAPS: readonly GapRow[] = Object.freeze([
  {
    id: 'v24',
    what: `${String(V24_SURFACES)} reads the design required the app to make, frozen nowhere`,
    cost: 'Each one was a value the compatibility check could not fail on, so an upgrade that moved it would break a screen under a green banner.',
    cite: C_STORAGE,
  },
  {
    id: 'guard',
    what: `${String(UNFROZEN_CHECKS)} of the ${String(MIRRORED_CHECKS)} checks the app must repeat before it lets you sign`,
    cost: 'With nothing to cite, the app shipped seven broad guesses in place of thirteen exact ones — and walked users to a signature the chain then refused.',
    cite: C_GUARDREADS,
  },
  {
    id: 'foreign',
    what: 'A whole second chain: the balance and the call the deposit flow uses over there',
    cost: 'The gap crossed a chain boundary instead of a module boundary, so the checker that finds the others structurally cannot see it.',
    cite: C_FOREIGN,
  },
  {
    id: 'mirror',
    what: 'Two documents that cited each other, and no test between them',
    cost: 'The app refused an action the chain would have accepted, on a clock the action itself starts. Both documents named the difference. Neither side computed it.',
    cite: cite('11', '§11.5', 'the checks the client re-runs before a signature (SQ-552)'),
  },
]);

const gapRowId = (id: string): string => `window-gap-${id}`;

// ---------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------

/** Row centres. Five promised openings, then a gap, then the one that is not. */
const ROW_Y: readonly number[] = Object.freeze([10.6, 8.9, 7.2, 5.5, 3.8, 1.5]);

const NODE_H = 0.8;
/** Where the wall stands. Openings are centred on it. */
const WALL_X = 6.6;
const OPEN_W = 1.1;
const VALUE_X = 9.6;
const VALUE_W = 1.5;
const PROOF_X = 12.6;
const PROOF_W = 1.1;
/**
 * The dashed edge of the promise, between the fifth opening and the sixth.
 *
 * Its height is chosen by where its own printed label lands, not by splitting
 * the gap: the renderer prints an axis label just past the rule's right end, and
 * at the midpoint of the gap that label arrives a third of a line under the
 * fifth row's label. It is lifted so the two clear each other, and the rule stops
 * short of the answer column for the same reason.
 */
const PROMISE_EDGE_Y = 2.4;
const PROMISE_EDGE_TO = 8.0;

/**
 * Build the drawing.
 *
 * The simulation state is accepted because every scene builder takes it, and it
 * is genuinely unused here — nothing about a frozen surface depends on where a
 * scenario has got to. The parameter is named `_sim` so that stays visible
 * rather than looking like a wiring mistake. Making this picture twitch with the
 * transport would be decoration standing in for meaning.
 */
export function buildModel(_sim: SimState): SceneModel {
  const nodes: SceneNode[] = [];

  // The two sides. Drawn first so nothing is hidden behind them.
  nodes.push({
    id: 'chain',
    kind: 'node',
    x: 0.9,
    y: 0.7,
    w: 3.8,
    h: 10.6,
    tone: 'ink',
    label: 'the chain',
  });
  nodes.push({
    id: 'browser',
    kind: 'node',
    x: 14.1,
    y: 0.7,
    w: 6.2,
    h: 10.6,
    tone: 'ink',
    label: 'your browser',
  });

  SURFACES.forEach((s, i) => {
    const yc = ROW_Y[i] ?? 0;
    const y = yc - NODE_H / 2;
    const tone = s.promised ? 'ink' : 'dim';
    const row = surfaceRowId(s.id);

    nodes.push({
      id: `open-${s.id}`,
      kind: 'stop',
      x: WALL_X - OPEN_W / 2,
      y,
      w: OPEN_W,
      h: NODE_H,
      tone,
      label: s.opening,
      domRowId: row,
    });
    nodes.push({
      id: `value-${s.id}`,
      kind: 'cube',
      x: VALUE_X,
      y,
      w: VALUE_W,
      h: NODE_H,
      tone,
      label: s.value,
      domRowId: row,
    });
    nodes.push({
      id: `proof-${s.id}`,
      kind: 'chip',
      x: PROOF_X,
      y,
      w: PROOF_W,
      h: NODE_H,
      tone,
      label: 'proof',
      domRowId: row,
    });
    // One straight line out, terminating at the proof: the value and the
    // evidence for it leave together, or neither leaves.
    nodes.push({
      id: `wire-${s.id}`,
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone,
      from: `open-${s.id}`,
      to: `proof-${s.id}`,
      emphasis: s.promised ? 1.2 : 0.8,
      domRowId: row,
    });
  });

  const rules: SceneRule[] = [
    {
      id: 'wall',
      axis: 'y',
      at: WALL_X,
      from: 0.5,
      to: 11.5,
      tone: 'ink',
      label: 'the frozen list',
    },
    {
      id: 'promise-edge',
      axis: 'x',
      at: PROMISE_EDGE_Y,
      from: 5.2,
      to: PROMISE_EDGE_TO,
      tone: 'dim',
      dashed: true,
      label: 'not promised',
    },
  ];

  const legend: LegendEntry[] = [
    { mark: 'ink', shape: 'stop', label: 'An opening the chain promises to keep' },
    { mark: 'ink', shape: 'cube', label: 'The answer that comes out of it' },
    { mark: 'ink', shape: 'chip', label: 'The proof that travels with the answer' },
    { mark: 'dim', shape: 'stop', label: 'Below the dashed line: real, useful, promised to nobody' },
  ];

  return {
    nodes,
    rules,
    relation:
      'How few the openings are, and that nothing leaves through one without its own evidence. A list of methods can say what exists; only the wall shows that the list is closed, which is the part that is actually promised.',
    caption: `${String(PROMISED.length)} openings the chain promises to keep, and one it promises nothing about.`,
    legend,
  };
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function LightClientPanel(): JSX.Element {
  return (
    <>
      <p>
        A full copy of a blockchain is large and grows forever. A light client keeps only the
        headers — a chain of fingerprints, each one carried forward from the last. When it needs an actual value it asks a stranger
        for the value <em>and</em> a short bundle of hashes, and those hashes must combine
        back into the fingerprint it already holds. If the value is wrong, the arithmetic
        does not come out.
      </p>
      <p>
        That is why the guarantee is lopsided, and the lopsidedness is the whole point. A
        hostile server can <strong>withhold</strong> — send an incomplete bundle, so the read
        simply fails and says so. It cannot <strong>forge</strong>, because it would have to
        produce bytes that hash to a fingerprint the chain’s own validators signed off on.
      </p>
      <p className="panel__note tw-note">
        Two rules follow, and both are binding on the real client rather than advisory. Anything
        a person is about to act on is read at a{' '}
        <Jargon word="finalized" />{' '}
        block that the client has pinned, never at the newest block. And there is no honest
        “how far behind am I” number to read — the single sync signal a light client exposes is
        the API’s own admitted guess, so it may colour a warning and may never decide whether a
        value counts as checked. {cited(C_SMOLDOT)}
      </p>
      <p className="panel__note tw-note">
        The matching limit is worth knowing because it shapes the rest of the design: a light
        client cannot ask for “the block at height four million”. It has no way to verify a
        stranger’s claim that a height maps to a given block, so it can only walk backwards
        from a block it already trusts, one round trip per step. That is why the chain keeps
        its own settlement history on chain — the last{' '}
        <Value of={spec(RECENT_COHORT_SUMMARIES, C_STORAGE)} /> completed periods, close to two
        years of it — so a browser opened for the first time has history without depending on
        anybody’s server at all.
      </p>
    </>
  );
}

function MethodsPanel(): JSX.Element {
  return (
    <>
      <p>
        These are read-only. Nothing they do costs a fee or changes anything, and each one has
        a ceiling fixed in advance — so no answer can quietly grow into something an app cannot
        handle. {cited(C_API)} {cited(C_APICODE)}
      </p>
      <div className="tw-scroll">
        <table>
          <caption className="sr-only">
            The sixteen frozen runtime-API methods, what each one answers, and the most each can
            return.
          </caption>
          <thead>
            <tr>
              <th scope="col">Ask this</th>
              <th scope="col">Most it returns</th>
            </tr>
          </thead>
          <tbody>
            {METHODS.map((m) => (
              <Fragment key={m.method}>
                <tr id={methodRowId(m.method)}>
                  <td className="tw-id">{m.method}</td>
                  <td className="tw-ceiling">{m.ceiling}</td>
                </tr>
                <tr className="tw-cont">
                  <td colSpan={2} className="tw-blurb">
                    {m.answers}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel__note tw-note">
        <strong>A convenience, never a trust root.</strong> Almost everything above can be
        recomputed by the app itself from the raw stored records behind it, and the real client
        does exactly that for any value on a signing path — not because the proofs are doubted,
        but because an app can misread a summary, and a proof says nothing about whether you
        understood what you were given. {cited(C_API)}
      </p>
      <p className="panel__note tw-note">
        <Value of={spec(NOT_RECOMPUTABLE, C_API)} /> answers are stated exceptions. The address
        test evaluates a rule the runtime runs and does not store, so there is nothing to read
        instead. The bond quote’s two arms are amounts an app is <em>forbidden</em> to work out
        for itself: doing so means owning three separate rounding details, and getting one wrong
        under-funds money a user has to post. The chain computes both from the same function its
        own dispatch calls, so the quoted figure and the frozen figure cannot be two numbers.
      </p>
    </>
  );
}

function SurfacePanel(): JSX.Element {
  return (
    <>
      <div className="tw-scroll">
        <table>
          <caption className="sr-only">
            Every opening in the frozen surface, what comes through it, and where it is frozen.
          </caption>
          <thead>
            <tr>
              <th scope="col">Opening</th>
              <th scope="col">On the list?</th>
              <th scope="col">Frozen at</th>
            </tr>
          </thead>
          <tbody>
            {SURFACES.map((s) => (
              <Fragment key={s.id}>
                <tr id={surfaceRowId(s.id)}>
                  <td className="tw-id">{s.name}</td>
                  <td>
                    <span className={s.promised ? 'chip chip--state' : 'chip chip--state tw-out'}>
                      {s.promised ? 'promised' : 'not promised'}
                    </span>
                  </td>
                  <td className="tw-where">{cited(s.cite)}</td>
                </tr>
                <tr className="tw-cont">
                  <td colSpan={3} className="tw-blurb">
                    {s.what}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel__note tw-note">
        Underneath all five promised openings sits one shape rule: the types may only ever{' '}
        <em>grow at the end</em>.
        A new field goes on the back, and an old one can never be renamed or removed without a
        new type, a migration of the stored data, and a coordinated app release inside the
        chain’s own notice period. That is what lets an app built last year decode a record
        written today. {cited(C_SCALE)} {cited(C_VIEWS)} {cited(C_CONTROL)}
      </p>
      <p className="panel__note tw-note">
        The edition number is{' '}
        <Value of={spec(INTEGRATION_CONTRACT_VERSION, C_IDENTITY)} />, and it is worth saying
        where that came from. The chain publishes it as a value an app reads, and the
        specification keeps it in exactly one table — because the sentence in its own opening
        paragraph that used to name it went two editions stale while every other section was
        right. A copy that has to be maintained will be missed, so there is only ever one.{' '}
        {cited(C_IDENTITY)}
      </p>
      <p className="panel__note tw-note">
        The same rule points the other way at the app: no chain number may appear as a literal
        anywhere in its source. Trade limits, deposits, bounds, fee rates — all read from the
        chain, every time, and a control whose number cannot be read is disabled with an
        explanation rather than filled in with a guess. {cited(C_NOHARDCODE)}
      </p>
    </>
  );
}

function AddressPanel(): JSX.Element {
  return (
    <>
      <p>
        The chain’s storage is one enormous map of bytes to bytes. A value has no name in it —
        it has an address, and the address is built by hashing the module’s name and the item’s
        name and laying the two results end to end.{' '}
        <Value of={spec(TWOX128_BYTES, C_KEYCODE)} unit="bytes" /> each, so{' '}
        <Value of={derived(TWOX128_BYTES * 2, C_CHANNEL)} unit="bytes" /> in total:
      </p>
      <p className="tw-key">twox128(&quot;Constitution&quot;) ++ twox128(&quot;ReleaseChannel&quot;)</p>
      <p>
        Now the interesting part. Ask for an address that does not exist and the chain answers{' '}
        <em>nothing here</em>. Ask for the address of something real that has never been written,
        and the chain answers <em>nothing here</em>. The two are the same answer. A typo in a
        name, a module renamed by an upgrade, a hash taken over the wrong string — every one of
        them looks exactly like an empty shelf, and none of them looks like an error.
      </p>
      <p className="panel__note tw-note">
        Which is why the one record built to be read by out-of-date apps is defended so
        carefully. It is{' '}
        <Value of={spec(RELEASE_RECORD_BYTES, C_CHANNEL)} unit="bytes" /> of fixed-width
        fields at a fixed address, parsed by counting from the start and never by asking the
        chain to describe itself — because an app that could ask would not need this record.
        Three reader rules go with it, and each of them is the same instinct: a reader must
        accept a <em>longer</em> value and read the frozen front of it, because that is how the
        layout is allowed to grow. A <em>shorter</em> one is malformed and is rejected. And a
        record carrying a flag no lawful writer could have set must be <em>rejected</em> rather
        than have the strange flag ignored, because ignoring it quietly accepts an
        unauthorised writer’s record as genuine. {cited(C_STRANDED)}
      </p>
      <p className="panel__note tw-note">
        A rejected record is then shown as <em>unknown</em>. Never as “no newer release exists”,
        and never as “no security flag is set” — the two readings a blank would otherwise
        collapse into. It is the same discipline as the storage address itself: absence and
        failure must not be allowed to wear the same face. {cited(C_STRANDED)}
      </p>
    </>
  );
}

function CompletenessPanel(): JSX.Element {
  return (
    <>
      <p>
        Before an app talks to an upgraded chain it runs a compatibility check and gets one of
        three verdicts: everything works, these named parts are switched off, or this release can
        only read. The check compares what the app uses against what the chain froze —{' '}
        <strong>and it can only compare things somebody put on the list</strong>.{' '}
        {cited(C_CLASSIFIER)}
      </p>
      <p>
        So a surface the app genuinely depends on but nobody froze is not merely undocumented. It
        is a surface the compatibility check <em>cannot fail on</em>. Move it in an upgrade and
        the banner still says everything is fine while the screen behind it has stopped working.
        A missing entry does not report as an error. It reports as silence.
      </p>
      <div className="tw-scroll">
        <table>
          <caption className="sr-only">
            Four times this repository shipped a frozen list that was correct and not complete,
            and what each one cost.
          </caption>
          <thead>
            <tr>
              <th scope="col">What was missing</th>
              <th scope="col">Recorded at</th>
            </tr>
          </thead>
          <tbody>
            {GAPS.map((g) => (
              <Fragment key={g.id}>
                <tr id={gapRowId(g.id)}>
                  <td className="tw-gap">{g.what}</td>
                  <td className="tw-where">{cited(g.cite)}</td>
                </tr>
                <tr className="tw-cont">
                  <td colSpan={2} className="tw-blurb">
                    {g.cost}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel__note tw-note">
        Four findings, four different shapes, one defect. The answer was not more care: it was a
        checker that runs the comparison <em>backwards</em>. Every other check asks whether what
        was declared matches the chain. This one reads what the design says a client must be able
        to read, and fails when any of it names a surface nobody froze — the only question that
        can be answered by looking for something that is not there.{' '}
        {cited(C_SURFACEGATE)}
      </p>
    </>
  );
}

function TelemetryPanel(): JSX.Element {
  return (
    <>
      <p>
        Not everything worth watching belongs in a promise. The chain carries a second, entirely
        separate set of readings for the people who run the machines. It carries no edition
        number, the app never reads it, and it may change shape without anybody’s sign-off —
        and that freedom is precisely what keeps the promised list short enough to keep.{' '}
        {cited(C_TELEMETRY)}
      </p>
      <div className="tw-scroll">
        <table>
          <caption className="sr-only">
            The monitoring-only readings, what each reports, and whether it can answer that the
            reading could not be taken.
          </caption>
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col">Can answer “missing”</th>
            </tr>
          </thead>
          <tbody>
            {TELEMETRY.map((t) => (
              <Fragment key={t.name}>
                <tr id={telemetryRowId(t.name)}>
                  <td className="tw-id">{t.name}</td>
                  <td>
                    <span className="chip chip--state">{t.canSayMissing ? 'yes' : 'no'}</span>
                  </td>
                </tr>
                <tr className="tw-cont">
                  <td colSpan={2} className="tw-blurb">
                    {t.reports}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel__note tw-note">
        <Value of={derived(TELEMETRY_OPTIONAL.length, C_TELCODE)} /> of the{' '}
        <Value of={spec(TELEMETRY.length, C_TELCODE)} /> answer with a box that may come back
        empty, and the monitoring stack turns an empty box into an <em>absent</em> reading rather
        than a zero. The failure it is guarding against is specific: a zero is a healthy-looking
        number, so a broken collector reporting zero would look exactly like a chain in perfect
        health. {cited(C_TELEMETRY)}
      </p>
      <p className="panel__note tw-note">
        One boundary is drawn deliberately, because the rule above is easy to over-apply.
        Going quiet is correct when the reading could not be <em>taken</em>. It is wrong when the
        reading was taken and is alarming — a book that has lost more than its own worst case is
        an alarm that must fire, not a family of readings to switch off.
      </p>
    </>
  );
}

/**
 * A citation printed inline after a claim, in the shared quiet style.
 *
 * It exists to be checked rather than read on the way past, which is why it uses
 * the design system's own `cite` class instead of a scene-local one: a reader
 * who has learned what that mark means in one scene should not have to relearn
 * it here.
 */
function cited(c: Citation): JSX.Element {
  return <span className="cite">{formatCitation(c)}</span>;
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function TheWindowScene({ sim }: { sim: SimState }): JSX.Element {
  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame model={buildModel(sim)} title="What you can see" />
      </div>
      <div className="col-rail">
        <Lede>
          Anything that shows you this chain’s numbers has to get them from somewhere, and the
          usual answer is a company’s server that you simply believe. Bleavit’s app does not do
          that. It runs a <Jargon word="light client" /> — a program small enough to live in a
          browser tab, which fetches a mathematical proof alongside every answer and checks it,
          so <strong>a dishonest server can refuse to answer it but cannot lie to it</strong>. For
          that to keep working after the chain rewrites its own code, the chain publishes a short,
          closed list of what it promises not to move without warning, and the app is built to
          depend on that list and nothing else.
        </Lede>

        <KeyFacts>
          <KeyFact
            label="Questions it promises to answer"
            note="Everything a screen needs, and nothing beyond it."
          >
            <Value of={spec(METHODS.length, C_API)} />
          </KeyFact>
          <KeyFact
            label="Edition of the promise"
            note="It goes up whenever the promised list changes at all."
          >
            <Value of={spec(INTEGRATION_CONTRACT_VERSION, C_IDENTITY)} />
          </KeyFact>
          <KeyFact
            label="Bytes an out-of-date app can still read"
            note="One record at one fixed address, parsed by counting."
          >
            <Value of={spec(RELEASE_RECORD_BYTES, C_CHANNEL)} />
          </KeyFact>
        </KeyFacts>

        <Depth
          title="What a light client actually does — and the two things it still cannot do"
          hint="the core idea"
        >
          <LightClientPanel />
        </Depth>

        <Depth
          title="The sixteen questions, and why none of them is a trust root"
          hint={`${String(METHODS.length)} methods`}
        >
          <MethodsPanel />
        </Depth>

        <Depth
          title="The whole promised surface, opening by opening"
          hint={`${String(PROMISED.length)} promised`}
        >
          <SurfacePanel />
        </Depth>

        <Depth
          title="How a value is addressed, and why a wrong address looks like an empty shelf"
          hint={`${String(TWOX128_BYTES * 2)} bytes`}
        >
          <AddressPanel />
        </Depth>

        <Depth
          title="Why the list must be complete, not merely correct"
          hint={`${String(GAPS.length)} times over`}
        >
          <CompletenessPanel />
        </Depth>

        <Depth
          title="A second window, for operators only"
          hint={`${String(TELEMETRY.length)} readings`}
        >
          <TelemetryPanel />
        </Depth>
      </div>
    </div>
  );
}
