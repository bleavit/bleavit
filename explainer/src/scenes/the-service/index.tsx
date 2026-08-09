import type { JSX } from 'react';

import { SceneFrame } from '../SceneFrame';
import type { SceneModel, SceneNode, SceneRule } from '../model';
import type { SimState } from '../../sim/types';
import type { Citation } from '../../protocol/citations';
import { cite, formatCitation } from '../../protocol/citations';
import { PROPOSAL_CLASSES } from '../../protocol/types';
import { SECURITY_FACTOR } from '../../protocol/constants';
import { formatDurationHuman } from '../../protocol/epoch';
import { param, value } from '../../protocol/params';
import { USDC } from '../../protocol/units';
import { derived, simulated, spec } from '../../provenance/types';
import { Depth, Jargon, KeyFact, KeyFacts, Lede } from '../../ui/Explain';
import { Value } from '../../ui/Value';
import './the-service.css';

/**
 * The hosted question service — doc 16, the chain's third trust domain (D-20).
 *
 * Bleavit sells the machinery it was built out of. Another chain asks a
 * question, Bleavit runs the same two conditional books and the same maths on
 * it, and hands back the sealed prices as a report. The commercial story is
 * easy; the safety story is the one this scene exists to teach, and it has one
 * load-bearing idea:
 *
 *   **the customer's money is in a different pot, and the pot is checked on its
 *   own.**
 *
 * A domain-tagged vault family inside the one ledger would have looked
 * equivalent and is not. Doc 03's solvency invariant is stated against *the*
 * sovereign account, singular, so under shared custody a customer's shortfall
 * is masked by Bleavit's surplus **until the combined liability exceeds the
 * combined custody** — that is, until Bleavit's own traders are already
 * unbacked. Worse, the freeze latch keys on the same comparison, so a customer's
 * failure would halt Bleavit's own ledger. Hence a second ledger instance with
 * its own sovereign account and its own solvency test (16 §7.1).
 *
 * So the canvas is two machines side by side and a dashed line between them
 * that **nothing crosses**. Each half has a question, two books, a vault, and a
 * solvency ceiling over its own vault. The picture's whole job is the absence of
 * a line: a table can list two ledgers, and only a drawing can show that no
 * arrow leaves one half. The scene's test asserts exactly that — every node
 * sits wholly on one side of the firewall, and no edge joins a node on one side
 * to a node on the other.
 *
 * The second thing the canvas carries is that the sold thing is delivered at
 * `Sealed`, before settlement risk exists: the four-state chain runs left to
 * right and every one of its first three states also has an exit to `Voided`,
 * which pays everyone back at par. A void does not un-deliver the report.
 *
 * Canvas labels stay inside the twelve-character budget and stay plain; the
 * spec names, the parameter keys, the error codes and the citations are all one
 * click away in the rail's drawers.
 */

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const C_BOUNDARY: Citation = cite('16', '§1', 'the boundary rule: no external result moves a Bleavit input');
const C_ADMIT: Citation = cite('16', '§2', 'the client registry — bond, exact identity, delivery float');
const C_LIFECYCLE: Citation = cite('16', '§4', 'Registered, Open, Sealed, then Settled or Voided');
const C_REPORT: Citation = cite('16', '§5', 'the report, field by field');
const C_FLOOR: Citation = cite('16', '§5.1', 'the manipulation bound is a lower bound, in USDC, rounded down');
const C_CERT: Citation = cite('16', '§5.2', 'Certified(ε, S) holds when C_disp(ε) ≥ 3·S — client-funded depth only');
const C_SETTLE: Citation = cite('16', '§6.3', 'the client-named attestor set, the median, and the forfeiture split');
const C_VOID: Citation = cite('16', '§6.4', 'VOID is the universal failure edge; redemption at par');
const C_TRUST: Citation = cite('16', '§6.5', 'the residual trust, stated and priced');
const C_SEGREGATION: Citation = cite('16', '§7.1', 'a second ledger instance, not a third vault family');
const C_FEES: Citation = cite('16', '§7.4', 'trading and redemption fees on external books accrue to Bleavit');
const C_TARIFF: Citation = cite('16', '§8.1', 'fee(q) = max(floor, rate × declared stake), earned at Sealed');
const C_QUOTA: Citation = cite('16', '§8.5', 'the resource partition that svc.max_live is sized against');
const C_PRICE: Citation = cite('16', '§8.6', 'admission under contention — a descending price, not a queue');
const C_STARVE: Citation = cite('16', '§8.7', 'starvation raises the same price, automatically');
const C_EGRESS: Citation = cite('16', '§9', 'push is best-effort; the pull surface is the authoritative one');
const C_PAUSE: Citation = cite('16', '§10', 'the one guardian control is pause, and pause voids rather than freezes');
const C_ERRORS: Citation = cite('16', '§11', 'every refusal is a distinct documented code');
const C_KERNEL: Citation = cite('13', '§2', 'kernel constants, compile-time');
const C_BOUNDS: Citation = cite('13', '§4', 'the bounded-storage ceilings');
const C_RUNTIME: Citation = cite(
  'code',
  'runtime/bleavit-runtime/src/lib.rs',
  'ClientRegistry = 65, QuestionService = 66, ServiceLedger = pallet_conditional_ledger::<Instance1> = 67',
);

// ---------------------------------------------------------------------------
// Kernel values this scene needs
// ---------------------------------------------------------------------------

/**
 * Five compile-time values from `futarchy_primitives`, held here rather than in
 * `protocol/constants.ts` because that module is shared and this scene is the
 * only reader of them. They are the ones a client's guarantees actually rest
 * on, so each is asserted against its Rust home in this scene's test.
 */
/** `kernel::SVC_ATTESTORS_MIN` — the smallest client-named settlement set. */
const SVC_ATTESTORS_MIN = 3;
/** `bounds::MAX_SERVICE_ATTESTORS` — the per-question seat ceiling. */
const SVC_ATTESTORS_MAX = 16;
/** `bounds::MAX_CLIENTS` — the registry roster ceiling (13 §4). */
const MAX_CLIENTS = 64;
/** `kernel::SVC_FEE_FLOOR_USDC` — 393 USDC, in base units. */
const SVC_FEE_FLOOR = 393 * USDC;
/** `kernel::SVC_TOLERANCE_MAX_1E9` — the widest settlement tolerance, 0.25. */
const SVC_TOLERANCE_MAX = 0.25;

/** Frozen `construct_runtime!` slots for the three service-side pallets. */
const CLIENT_REGISTRY_INDEX = 65;
const QUESTION_SERVICE_INDEX = 66;
const SERVICE_LEDGER_INDEX = 67;

/** The whole point of the scene, as a number: two ledgers, checked separately. */
const LEDGER_INSTANCES = 2;

/**
 * The example conditional price on the client's book.
 *
 * Invented. The simulation carries a Bleavit proposal and no hosted question at
 * all, so the right-hand book has no real reading to show, and drawing an empty
 * scale next to a full one would say "the service is idle" — a claim about
 * demand this repository has no evidence for either way. It is rendered with
 * the `simulated` badge everywhere it is printed.
 */
const EXAMPLE_ACCEPT_PRICE = 0.62;

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/**
 * The minimum liquidity parameter a client must fund per book, per unit of
 * declared stake: `b_min(S, ε) = 3·S / (2·ln(0.5 / (0.5 − ε)))`.
 *
 * Computed rather than copied. Doc 16 §5.2 prints 36.75 / 14.24 / 6.73 at
 * ε = 0.02 / 0.05 / 0.10, rounded **up** from 36.7449 / 14.2368 / 6.7221 —
 * because a `b` rounded down is a certificate that does not hold. The test
 * checks this function against those three published figures, so a change to
 * either side shows up rather than drifting.
 */
export function bMinPerStake(epsilon: number): number {
  return SECURITY_FACTOR / (2 * Math.log(0.5 / (0.5 - epsilon)));
}

/**
 * The cash that subsidy actually costs, per unit of declared stake.
 *
 * Not `b`. Doc 04 §2 mints per-book headroom of `b · ln 2`, and there are two
 * books, so the client posts `2 · b_min · ln 2`. Conflating the liquidity
 * parameter with the cash that funds it overstated this figure by 44 % in an
 * earlier revision of doc 16, and the corrected number is the one used here.
 */
export function subsidyPerStake(epsilon: number): number {
  return 2 * bMinPerStake(epsilon) * Math.LN2;
}

/** The three ε rows doc 16 §5.2 tabulates. `svc.epsilon_min` sits below them. */
const EPSILON_ROWS: readonly number[] = Object.freeze([0.02, 0.05, 0.1]);

/** The ε doc 16 uses whenever it needs one worked example. */
const EPSILON_EXAMPLE = 0.05;

/**
 * Every named attestor's per-question bond, as a fraction of the escrow.
 *
 * Doc 16 §6.3 reuses doc 07 §7's value-scaled filing bond verbatim rather than
 * adding a key: `(2^orc.rounds − 1) · orc.bond_bps / 10_000`. At the genesis
 * rows that is 7 × 250 bps = 17.5 % of the escrow, each.
 */
function attestorBondFraction(): number {
  return ((2 ** value('orc.rounds') - 1) * value('orc.bond_bps')) / 10_000;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * The firewall, and the two mirrored halves either side of it.
 *
 * Everything left of `FIREWALL_X` belongs to Bleavit's own domain and
 * everything right of it to the service domain. That is not a drawing
 * convention: the test asserts that every node's full extent lies on one side,
 * so a node that strayed across would fail rather than merely look wrong.
 */
const FIREWALL_X = 10.5;

/** Custody band: a vault and a book pair on each side, at the same height. */
const VAULT_Y = 2.6;
const VAULT_H = 2.4;
const BOX_W = 3.6;
const OWN_VAULT_X = 1.0;
const OWN_BOOK_X = 5.8;
const SVC_VAULT_X = 11.6;
const SVC_BOOK_X = 16.4;

/** The solvency ceiling over each vault — the same test, run twice. */
const CHECK_Y = 6.1;
const CHECK_H = 0.3;
const CHECK_W = 8.4;
const OWN_CHECK_X = 1.0;
const SVC_CHECK_X = 11.6;

/** The question band. Four states left to right, and the exit below them. */
const Q_Y = 9.5;
const Q_H = 1.2;
const Q_W = 1.8;
const Q_PITCH = 2.5333;
const Q_X0 = 11.2;
const VOID_X = 15.0;
const VOID_Y = 7.2;
const VOID_W = 1.8;
const VOID_H = 1.1;

/** Bleavit's own question, in the same band on the other side of the line. */
const OWN_Q_X = 4.0;
const OWN_Q_W = 2.6;

const qx = (i: number): number => Q_X0 + i * Q_PITCH;

const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const int = (v: number): string => group(Math.round(v));
const f2 = (v: number): string => v.toFixed(2);
const f3 = (v: number): string => v.toFixed(3);
const f4 = (v: number): string => v.toFixed(4);
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const usdcWhole = (baseUnits: number): string => group(Math.round(baseUnits / USDC));

/** The four ordinary states, in the order a question passes through them. */
const PHASES = ['Registered', 'Open', 'Sealed', 'Settled'] as const;

/**
 * The scene model.
 *
 * Exported for the test, which is where the separation property is actually
 * checked: labels inside budget, ids unique, every node wholly on one side of
 * the firewall, and no edge joining the two sides.
 */
export function buildModel(sim: SimState): SceneModel {
  const ownPrice = sim.books.find((b) => b.kind === 'DecisionAccept')?.spot ?? 0.5;

  const phaseNode = (id: string, i: number, label: string, sublabel: string): SceneNode => ({
    id,
    domRowId: `svc-phase-${label.toLowerCase()}`,
    kind: 'node',
    x: qx(i),
    y: Q_Y,
    w: Q_W,
    h: Q_H,
    tone: 'ink',
    state: 'active',
    label,
    sublabel,
  });

  const nodes: SceneNode[] = [
    // --- Bleavit's own domain, left of the line ------------------------------
    {
      id: 'own-question',
      domRowId: 'svc-dom-primary-question',
      kind: 'slab',
      x: OWN_Q_X,
      y: Q_Y,
      w: OWN_Q_W,
      h: Q_H,
      tone: 'ink',
      state: 'active',
      // Notches count the proposal class, so class is never carried by colour.
      notches: PROPOSAL_CLASSES.indexOf(sim.proposal.cls) + 1,
      label: 'A proposal',
      sublabel: 'Bleavit asks',
    },
    {
      id: 'own-books',
      domRowId: 'svc-dom-primary-books',
      kind: 'plate',
      x: OWN_BOOK_X,
      y: VAULT_Y,
      w: BOX_W,
      h: VAULT_H,
      tone: 'ink',
      state: 'active',
      fill: Math.min(1, Math.max(0, ownPrice)),
      label: 'Own books',
      sublabel: 'its markets',
    },
    {
      id: 'own-vault',
      domRowId: 'svc-dom-primary-vault',
      kind: 'cube',
      x: OWN_VAULT_X,
      y: VAULT_Y,
      w: BOX_W,
      h: VAULT_H,
      tone: 'ink',
      state: 'active',
      label: 'Own vault',
      sublabel: 'Bleavit only',
    },
    {
      id: 'own-check',
      domRowId: 'svc-dom-primary-check',
      kind: 'ceiling',
      x: OWN_CHECK_X,
      y: CHECK_Y,
      w: CHECK_W,
      h: CHECK_H,
      tone: 'ink',
      state: 'active',
      label: 'Own check',
    },

    // --- The service domain, right of the line -------------------------------
    phaseNode('q-registered', 0, 'Registered', 'money posted'),
    phaseNode('q-open', 1, 'Open', 'both trade'),
    phaseNode('q-sealed', 2, 'Sealed', 'report out'),
    phaseNode('q-settled', 3, 'Settled', 'paid out'),
    {
      id: 'q-voided',
      domRowId: 'svc-phase-voided',
      kind: 'node',
      x: VOID_X,
      y: VOID_Y,
      w: VOID_W,
      h: VOID_H,
      tone: 'dim',
      state: 'inactive',
      label: 'Voided',
    },
    {
      id: 'svc-books',
      domRowId: 'svc-dom-service-books',
      kind: 'plate',
      x: SVC_BOOK_X,
      y: VAULT_Y,
      w: BOX_W,
      h: VAULT_H,
      tone: 'ink',
      state: 'active',
      fill: EXAMPLE_ACCEPT_PRICE,
      label: 'Its books',
      sublabel: 'the question',
    },
    {
      id: 'svc-vault',
      domRowId: 'svc-dom-service-vault',
      kind: 'cube',
      x: SVC_VAULT_X,
      y: VAULT_Y,
      w: BOX_W,
      h: VAULT_H,
      tone: 'ink',
      state: 'active',
      label: 'Client vault',
      sublabel: 'clients only',
    },
    {
      id: 'svc-check',
      domRowId: 'svc-dom-service-check',
      kind: 'ceiling',
      x: SVC_CHECK_X,
      y: CHECK_Y,
      w: CHECK_W,
      h: CHECK_H,
      tone: 'ink',
      state: 'active',
      label: 'Own check',
    },

    // --- Flow, always within one half ----------------------------------------
    {
      id: 'e-own-trade',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'own-question',
      to: 'own-books',
    },
    {
      id: 'e-own-custody',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'own-books',
      to: 'own-vault',
    },
    {
      id: 'e-svc-trade',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'q-open',
      to: 'svc-books',
    },
    {
      id: 'e-svc-custody',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      from: 'svc-books',
      to: 'svc-vault',
    },
    // The success chain. It is the widest pipe because it is the common path.
    {
      id: 'e-reg-open',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'ink',
      emphasis: 1.6,
      from: 'q-registered',
      to: 'q-open',
    },
    {
      id: 'e-open-sealed',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'ink',
      emphasis: 1.6,
      from: 'q-open',
      to: 'q-sealed',
    },
    {
      id: 'e-sealed-settled',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'ink',
      emphasis: 1.6,
      from: 'q-sealed',
      to: 'q-settled',
    },
    // Three exits to the same door: every failure edge is the same edge.
    {
      id: 'e-reg-void',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      state: 'inactive',
      from: 'q-registered',
      to: 'q-voided',
    },
    {
      id: 'e-open-void',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      state: 'inactive',
      from: 'q-open',
      to: 'q-voided',
    },
    {
      id: 'e-sealed-void',
      kind: 'edge',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      tone: 'dim',
      state: 'inactive',
      from: 'q-sealed',
      to: 'q-voided',
    },
  ];

  const rules: SceneRule[] = [
    {
      id: 'firewall',
      axis: 'y',
      at: FIREWALL_X,
      from: 0.6,
      to: 11.4,
      tone: 'ink',
      dashed: true,
      label: 'no crossing',
    },
    {
      id: 'question-time',
      axis: 'x',
      at: 10.9,
      from: Q_X0,
      to: qx(PHASES.length - 1) + Q_W,
      tone: 'dim',
      label: 'time',
    },
  ];

  return {
    nodes,
    rules,
    relation:
      'Separation. Two questions are being priced by the same machinery — Bleavit’s own on the ' +
      'left, a paying customer’s on the right — and the dashed line between them is never ' +
      'crossed by anything on the stage. Each half has its own vault and its own solvency ' +
      'ceiling above it, because the test that asks "is there enough money here" is run once per ' +
      'side and never over the total. Run over the total it would stay quiet while a customer ' +
      'was short and only speak once Bleavit’s own traders were short too, and the freeze it ' +
      'triggers would then stop Bleavit’s own market rather than the customer’s. The customer’s ' +
      'question also shows the other half of the design: three of its four states have an exit ' +
      'to the same door marked Voided, where everybody is paid back what they put in.',
    unitLegend:
      'A box on its side is a vault — the account that actually holds the cash. A tall panel is a ' +
      'market book, and the level inside it is the price. The hatched bar over each vault is that ' +
      'side’s solvency test.',
    caption:
      'Left: Bleavit’s own money. Right: a paying customer’s. Nothing on this stage crosses the dashed line.',
    legend: [
      { mark: 'ink', shape: 'cube', label: 'A vault — where one side’s cash actually sits' },
      { mark: 'ink', shape: 'plate', label: 'A market book, filled to its price' },
      { mark: 'ink', shape: 'ceiling', label: 'That side’s own solvency test' },
      { mark: 'dim', label: 'The way out when something fails: everyone paid back at par' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Rail data
// ---------------------------------------------------------------------------

interface PhaseRow {
  readonly phase: string;
  readonly plain: string;
  readonly detail: string;
}

/** Doc 16 §4's phase table, in plain words first. */
const PHASE_ROWS: readonly PhaseRow[] = Object.freeze([
  {
    phase: 'Registered',
    plain: 'The customer has paid in and named its judges.',
    detail:
      'The escrow is posted, the attestor set is named, the settlement rule is committed and the stake and resolution are declared. Both books exist and neither is open.',
  },
  {
    phase: 'Open',
    plain: 'Both markets trade, and the average price accumulates.',
    detail:
      'Anyone may trade either book. The time-weighted average accrues over the window rather than being read at a moment, so no single trade at the close can decide the answer.',
  },
  {
    phase: 'Sealed',
    plain: 'The window shut and the report was published. This is delivery.',
    detail:
      'The averages freeze, the report is written to storage, the realized branch is derived from the sealed averages by the rule committed before trading opened, and the service fee is earned.',
  },
  {
    phase: 'Settled',
    plain: 'The judges agreed, and positions pay out against the real value.',
    detail:
      'The median of the in-window submissions landed inside the frozen tolerance. Every attestor outside it forfeits its whole per-question bond.',
  },
  {
    phase: 'Voided',
    plain: 'Something failed, so everybody is paid back what they put in.',
    detail:
      'No quorum, a median out of range, a missed deadline, a paused service, insufficient escrow, a collapsed attestor set — every failure edge is this one edge, and it redeems at par.',
  },
]);

interface FieldRow {
  readonly field: string;
  readonly meaning: string;
}

/** The report doc 16 §5 sells, field by field. */
const REPORT_FIELDS: readonly FieldRow[] = Object.freeze([
  { field: 'twap_accept_1e9 · twap_reject_1e9', meaning: 'The two conditional prices, averaged over the whole window rather than read at its end.' },
  { field: 'observations', meaning: 'How many readings the weaker of the two books got. It is the minimum of the pair, never the sum, because the report is only as good as its weakest price input.' },
  { field: 'window_start · window_end', meaning: 'Exactly which blocks the averages cover.' },
  { field: 'b_accept · b_reject', meaning: 'The liquidity actually posted in each book.' },
  { field: 'manip_floor', meaning: 'A lower bound on what moving the prices by the declared resolution would have cost, in USDC, rounded down.' },
  { field: 'declared_stake · epsilon_1e9', meaning: 'The customer’s own declared stake and resolution, republished word for word so a reader can check what was claimed.' },
  { field: 'tolerance_1e9', meaning: 'How far a judge may stray before losing its bond, frozen when the question was registered. It is in the report so a widened value cannot pass unnoticed.' },
  { field: 'certified', meaning: 'Whether the customer-funded depth reached three times its declared stake. A relation, not a badge.' },
  { field: 'settlement_trust', meaning: 'How many judges were named, how many must agree, and how much they collectively have at risk. This is the field to read on somebody else’s report.' },
  { field: 'provenance_hash', meaning: 'One hash over every field above, so a report cannot be quoted with a field changed.' },
]);

/** The six doc 13 §1 rows that price and bound the service. */
const SVC_KEYS: readonly string[] = Object.freeze([
  'svc.client_bond',
  'svc.max_live',
  'svc.max_window',
  'svc.fee_bps',
  'svc.epsilon_min',
  'svc.price_cap',
]);

// ---------------------------------------------------------------------------
// Rail panels
// ---------------------------------------------------------------------------

function SoldPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">What a customer actually buys</h2>
      <p>
        Two prices and a warning label. Bleavit opens two markets on the customer&rsquo;s
        question — one priced on the world where the thing happens, one on the world where it does
        not — lets anyone trade both, and at the end hands back the average price of each,
        together with a number saying what it would have cost somebody to move them.
      </p>
      <p>
        <strong>That number is a floor, never a ceiling.</strong> Read it as &ldquo;faking this
        cost at least so much&rdquo;. A big one does not mean nobody tried; it means trying was
        expensive, and anyone richer than the number may have tried anyway. A small one is a real
        warning: the price was cheap to move, so treat it as weak evidence however confident it
        looks (<span className="cite">{formatCitation(C_FLOOR)}</span>).
      </p>
      <p>
        Bleavit decides nothing for the customer. It never runs their code, never learns what they
        did with the answer, and no outcome of theirs is allowed to reach any Bleavit vote, score
        or payout (<span className="cite">{formatCitation(C_BOUNDARY)}</span>). The one lever the
        customer pre-commits is a two-field comparison of the two sealed averages, used only to
        pick which side of their own market settles — decided before trading opened, so nothing can
        be chosen after seeing prices.
      </p>
      <p className="panel__note">
        The lower bound is deliberately the sellable direction. Overstating it would make the
        security look better than it is, and that failure has already happened once here: a unit
        error made the published figure read <Value of={spec(1.928, C_FLOOR)} format={f3} />&times;
        too high before it was caught. The number a customer receives is the corrected,
        cash-denominated one.
      </p>
    </section>
  );
}

function ReportPanel() {
  const cert = derived(SECURITY_FACTOR, C_CERT);
  return (
    <section className="panel">
      <h2 className="panel__title">The report, field by field</h2>
      <p className="panel__note">
        The exact shapes are frozen so a customer can decode them without asking anybody (
        <span className="cite">{formatCitation(C_REPORT)}</span>).
      </p>
      <table className="svc-table">
        <caption className="sr-only">Every field of the sold report and what it means</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">What it means</th>
          </tr>
        </thead>
        <tbody>
          {REPORT_FIELDS.map((r) => (
            <tr key={r.field} id={`svc-field-${r.field.split(' ')[0] ?? r.field}`}>
              <th scope="row" className="mono">
                {r.field}
              </th>
              <td>{r.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>&ldquo;Certified&rdquo; is a relation, not a badge</h3>
      <p>
        A question is certified when the depth the customer <em>itself</em> funded is at least{' '}
        <Value of={cert} />&times; the stake it declared (
        <span className="cite">{formatCitation(C_CERT)}</span>). It deliberately does not count
        liquidity that merely showed up: if it did, a well-timed question could buy its certificate
        out of other people&rsquo;s trading, which is the one design this document refuses
        outright.
      </p>
      <p>
        So certification is expensive, and the exact price falls out of the market maths. At a
        resolution of <Value of={spec(EPSILON_EXAMPLE, C_CERT)} format={f2} /> the customer must
        post about{' '}
        <Value of={derived(subsidyPerStake(EPSILON_EXAMPLE), C_CERT)} format={f2} />&times; its
        declared stake in cash, held in escrow and largely returned. Under-declaring the stake
        saves fee and forfeits both the certificate and the depth, so a large declared stake on a
        certified report is a claim somebody paid for.
      </p>

      <table className="svc-table">
        <caption className="sr-only">
          Required liquidity and posted cash per unit of declared stake, by resolution
        </caption>
        <thead>
          <tr>
            <th scope="col" className="numeric">
              Resolution
            </th>
            <th scope="col" className="numeric">
              Liquidity per book
            </th>
            <th scope="col" className="numeric">
              Cash posted
            </th>
          </tr>
        </thead>
        <tbody>
          {EPSILON_ROWS.map((e) => (
            <tr key={e} id={`svc-eps-${String(e).replace('.', '-')}`}>
              <th scope="row" className="mono numeric">
                <Value of={spec(e, C_CERT)} format={f2} />
              </th>
              <td className="numeric">
                <Value of={derived(bMinPerStake(e), C_CERT)} format={f2} unit="× stake" />
              </td>
              <td className="numeric">
                <Value of={derived(subsidyPerStake(e), C_CERT)} format={f2} unit="× stake" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="panel__note">
        The cash column is not the liquidity column. Each book mints headroom of{' '}
        <span className="mono">b · ln 2</span> and there are two books, so the posted cash is{' '}
        <span className="mono">2 · b · ln 2</span>. Treating the liquidity parameter as the cash
        overstated this by <Value of={derived(1 / Math.LN2 - 1, C_CERT)} format={pct} /> in an
        earlier revision; both columns here are computed from the same formula the specification
        states, not copied from its table.
      </p>
      <p className="panel__note">
        A customer paying for a certificate buys a <em>stronger</em> guarantee than Bleavit gives
        its own decisions, which additionally rest on capital floors and a three-day dispute window
        no customer buys. That is stated plainly in the specification rather than smoothed over,
        and it is why the subsidy is so large.
      </p>
    </section>
  );
}

function AdmissionPanel() {
  const bond = param('svc.client_bond');
  const attBond = param('att.bond');
  const multiple = bond.value / attBond.value;

  return (
    <section className="panel">
      <h2 className="panel__title">Getting in</h2>
      <p>
        Nobody can just start using the service. A customer is admitted one at a time by a
        governance vote, and posts a <Jargon word="bond" /> of{' '}
        <Value of={spec(bond.value, bond.cite)} format={int} unit="VIT" /> in{' '}
        <Jargon word="vit" /> when it registers. The deposit is held for as long as the
        registration lasts and returned when the customer leaves cleanly. It buys nothing and pays
        for nothing — it exists so that abusing the registration itself has a price (
        <span className="cite">{formatCitation(C_ADMIT)}</span>).
      </p>
      <p>
        <strong>Seeding that one row is literally what opened the service.</strong> While the
        deposit had no value in the constitution there was no default and no fallback, so every
        admission was refused with <span className="mono">ClientBondUnset</span> before any money
        moved. The value is <Value of={derived(multiple, bond.cite)} format={f2} />&times; what a
        Bleavit{' '}
        <Jargon word="attestor" />{' '}
        posts — a deliberate choice to treat a paying outsider as the higher risk, with the stated
        cost that the first customers will be institutions rather than experiments.
      </p>

      <table className="svc-table">
        <caption className="sr-only">The two deposits a customer holds, and what each pays for</caption>
        <thead>
          <tr>
            <th scope="col">Balance</th>
            <th scope="col">Denominated in</th>
            <th scope="col">What it is for</th>
          </tr>
        </thead>
        <tbody>
          <tr id="svc-balance-bond">
            <th scope="row">The registration deposit</th>
            <td>
              <span className="mono">VIT</span>, held
            </td>
            <td>Prices registration abuse. Never spent on delivery, never on a market.</td>
          </tr>
          <tr id="svc-balance-float">
            <th scope="row">The delivery float</th>
            <td>
              <span className="mono">USDC</span>, topped up
            </td>
            <td>
              Pays the postage when Bleavit pushes a copy of a report back. Runs dry and the pushes
              stop; nothing else changes.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        Two balances rather than one, and the reason is that one balance would have needed a price
        that does not exist. The deposit is in <Jargon word="vit" label="Bleavit’s own token" />;
        sending a message between chains is paid for in <Jargon word="usdc" />. Paying postage out
        of the deposit would have required converting between them at a rate nothing publishes, so
        the design takes the extra balance instead — the only resolution that introduces no price
        at all.
      </p>

      <h3>Who a customer is, exactly</h3>
      <p>
        Identity is matched by exact equality and nothing looser. A{' '}
        <Jargon word="parachain" /> authenticates as <em>that chain</em>, not as any particular
        contract on it, because the message shapes that would let a chain assert a sub-identity are
        kept out of the door entirely. A customer that needs per-contract attribution supplies
        thirty-two opaque bytes which Bleavit stores, echoes back in the report, binds into the
        report&rsquo;s hash, and never interprets. Bleavit makes no claim about who inside a
        customer chain asked; the customer chain makes that claim to its own users, using a field
        Bleavit merely carries.
      </p>
      <p>
        The roster holds at most <Value of={spec(MAX_CLIENTS, C_BOUNDS)} /> customers, derived from
        the hard maximum number of simultaneous questions so that even the extreme case — every
        live question owned by a different customer — fits. An idle registration beyond that adds
        no capacity and is refused before its deposit is touched.
      </p>
      <p className="panel__note">
        Removing a customer is <strong>not</strong> a kill switch. It refuses new questions at once
        and lets live ones run to their own end, because voiding them would change the payouts of
        traders who had no part in the vote and could destroy a report the customer had already
        paid for. The immediate lever is the guardian pause of{' '}
        <span className="cite">{formatCitation(C_PAUSE)}</span>, which voids by design and is
        time-bounded.
      </p>
    </section>
  );
}

function SegregationPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Why the two pots must never share</h2>
      <p>
        Outside questions run on a second, entirely separate copy of the same ledger, with its own
        account holding the money and its own solvency test. The obvious cheaper design — one pot
        with the outside money tagged — is not equivalent, and the reason is worth stating exactly
        because it is the whole scene.
      </p>
      <p>
        The solvency rule says: what is owed must never exceed what is held, <em>in the account
        that holds it</em>. One account, and a customer&rsquo;s shortfall is quietly covered by
        Bleavit&rsquo;s surplus — invisible until the combined debt passes the combined cash, which
        is to say <strong>invisible until Bleavit&rsquo;s own traders are already unbacked</strong>.
        Worse, the emergency freeze keys on that same comparison, so a customer&rsquo;s failure
        would halt <em>Bleavit&rsquo;s</em> market rather than the customer&rsquo;s (
        <span className="cite">{formatCitation(C_SEGREGATION)}</span>).
      </p>

      <table className="svc-table">
        <caption className="sr-only">The same four parts, once per domain</caption>
        <thead>
          <tr>
            <th scope="col">The part</th>
            <th scope="col">Bleavit&rsquo;s own side</th>
            <th scope="col">A customer&rsquo;s side</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">The question being priced</th>
            <td id="svc-dom-primary-question">
              A Bleavit proposal, decided by Bleavit&rsquo;s own rules.
            </td>
            <td>A customer&rsquo;s question, whose five states are in the next drawer.</td>
          </tr>
          <tr>
            <th scope="row">Its two markets</th>
            <td id="svc-dom-primary-books">
              Up to six books per proposal, including the ones that price Bleavit&rsquo;s own
              uptime and security.
            </td>
            <td id="svc-dom-service-books">
              Exactly two, never six. Bleavit&rsquo;s uptime books settle on facts about Bleavit,
              which mean nothing for a customer.
            </td>
          </tr>
          <tr>
            <th scope="row">Where the money sits</th>
            <td id="svc-dom-primary-vault">
              One account, holding every Bleavit trader&rsquo;s escrow.
            </td>
            <td id="svc-dom-service-vault">
              A different account, holding every customer&rsquo;s escrow. No path joins them.
            </td>
          </tr>
          <tr>
            <th scope="row">The solvency test</th>
            <td id="svc-dom-primary-check">
              Run over this account alone, every block, in test builds.
            </td>
            <td id="svc-dom-service-check">
              The identical test, run over the other account alone. Two answers, never one.
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Three cheap defences behind it</h3>
      <ul className="svc-list">
        <li>
          <strong>Disjoint numbering.</strong> Every outside question, vault and book gets an
          identifier at or above <span className="mono">2^63</span>, and the Bleavit-side allocator
          asserts it stays strictly below. A mis-routed lookup therefore fails with &ldquo;unknown
          vault&rdquo; by construction, at no runtime cost.
        </li>
        <li>
          <strong>One routing point.</strong> A single small exhaustive function decides which
          ledger a book belongs to, so the entire firewall has one auditable, fuzzable place to
          read.
        </li>
        <li>
          <strong>Three separate lists, not one.</strong> The set of accounts that may not receive a
          transfer is the union across both sides; the set exempt from fees and deposits is
          per-side. Getting either one backwards is a defect in a different direction, and a
          customer&rsquo;s own account is asserted to be in none of them.
        </li>
      </ul>

      <table className="svc-table">
        <caption className="sr-only">The runtime slots the service occupies</caption>
        <thead>
          <tr>
            <th scope="col">Module</th>
            <th scope="col" className="numeric">
              Slot
            </th>
            <th scope="col">What it holds</th>
          </tr>
        </thead>
        <tbody>
          <tr id="svc-pallet-registry">
            <th scope="row" className="mono">
              ClientRegistry
            </th>
            <td className="numeric">
              <Value of={spec(CLIENT_REGISTRY_INDEX, C_RUNTIME)} />
            </td>
            <td>Who is admitted, their deposit, and their delivery float.</td>
          </tr>
          <tr id="svc-pallet-service">
            <th scope="row" className="mono">
              QuestionService
            </th>
            <td className="numeric">
              <Value of={spec(QUESTION_SERVICE_INDEX, C_RUNTIME)} />
            </td>
            <td>The questions, the reports, and the settlement game.</td>
          </tr>
          <tr id="svc-pallet-ledger">
            <th scope="row" className="mono">
              ServiceLedger
            </th>
            <td className="numeric">
              <Value of={spec(SERVICE_LEDGER_INDEX, C_RUNTIME)} />
            </td>
            <td>
              The second copy of the conditional ledger — the same code as Bleavit&rsquo;s own, a
              different instance, a different account.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        The gain from instancing is that no new rule had to be invented: the solvency invariants
        are simply evaluated twice, the formal model of one ledger stays valid word for word for
        each copy, and the frame-free core needed no semantic change at all. What it cost was the
        conversion of the module shell to a parameterised one, which is why that landed as a
        milestone of its own.
      </p>
    </section>
  );
}

function LifecyclePanel() {
  const win = param('svc.max_window');
  const sealGrace = value('orc.window');

  return (
    <section className="panel">
      <h2 className="panel__title">The five states</h2>
      <table className="svc-table">
        <caption className="sr-only">The question lifecycle, doc 16 §4</caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">In plain words</th>
            <th scope="col">Exactly</th>
          </tr>
        </thead>
        <tbody>
          {PHASE_ROWS.map((p) => (
            <tr key={p.phase} id={`svc-phase-${p.phase.toLowerCase()}`}>
              <th scope="row">
                <span className="svc-phase">{p.phase}</span>
              </th>
              <td>{p.plain}</td>
              <td className="svc-detail">{p.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>The product is delivered at Sealed, before settlement can fail</h3>
      <p>
        This is the sequencing decision the whole design rests on. A void drops every trader back
        to what they put in, but it does not <em>un-deliver</em> the report: the price discovery
        already happened and was already published. That is why the fee is earned at{' '}
        <span className="svc-phase">Sealed</span> and not at{' '}
        <span className="svc-phase">Settled</span>, and it is why a customer cannot get a free
        report by sabotaging its own settlement (
        <span className="cite">{formatCitation(C_LIFECYCLE)}</span>).
      </p>
      <p>
        Sealing has its own deadline, and it is deliberately not the same instant as the failure
        deadline. The customer may seal from the moment the window closes until{' '}
        <Value of={derived(sealGrace, C_LIFECYCLE)} format={int} unit="blocks" /> (
        {formatDurationHuman(sealGrace)}) later, and only then may anybody void it. If both became
        possible in the same block, any passing account — or merely the order transactions happened
        to land in — could destroy a report before its customer had a single block in which to
        publish it.
      </p>
      <p className="panel__note">
        The longest a question may stay open is{' '}
        <Value of={spec(win.value, win.cite)} format={int} unit="blocks" /> (
        {formatDurationHuman(win.value)}), one full Bleavit <Jargon word="epoch" /> — the timescale
        on which the whole slate of questions turns over.
      </p>
      <p className="panel__note">
        Every failure lands on the same edge, and it always pays everybody back what they put in:
        no agreement among the judges, an answer out of range, a missed deadline, a paused service,
        an escrow that came up short, a judging set that fell apart. One edge means one path to
        test and one path to get right (<span className="cite">{formatCitation(C_VOID)}</span>).
      </p>
      <p className="panel__note">
        Every refusal along the way has its own name — <span className="mono">SlotsExhausted</span>,{' '}
        <span className="mono">EpsilonOutOfRange</span>,{' '}
        <span className="mono">WindowCollidesWithDecision</span>,{' '}
        <span className="mono">AttestorBondInsufficient</span>, and around forty more. That is a
        deliberate integration surface rather than a diagnostic: a customer who cannot tell{' '}
        <em>which</em> condition it missed cannot integrate without asking somebody, and this
        service is meant to be integrated without asking anybody (
        <span className="cite">{formatCitation(C_ERRORS)}</span>).
      </p>
    </section>
  );
}

function SettlementPanel() {
  const bondFraction = attestorBondFraction();
  return (
    <section className="panel">
      <h2 className="panel__title">Who decides the answer</h2>
      <p>
        Bleavit does not. It has no way to know whether a customer&rsquo;s active-user count went
        up, and sending a foreign fact to Bleavit&rsquo;s own voters is exactly the contamination
        the whole design refuses. So the customer names its own judges — at least{' '}
        <Value of={spec(SVC_ATTESTORS_MIN, C_KERNEL)} /> of them, at most{' '}
        <Value of={spec(SVC_ATTESTORS_MAX, C_BOUNDS)} /> — and each one must put up money before
        trading is allowed to open.
      </p>
      <p>
        After the window shuts, each judge reports a number. The middle number of everything
        submitted in time settles the question, and any judge whose number strays further than the
        tolerance frozen at registration <Jargon word="slash" label="forfeits" /> its whole deposit
        for that question. Forty percent of what is forfeited is shared equally among the judges
        who were inside the tolerance; the rest, and any remainder, goes to the insurance fund (
        <span className="cite">{formatCitation(C_SETTLE)}</span>).
      </p>

      <table className="svc-table">
        <caption className="sr-only">How the median is taken, and why each rule is that way</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Why it is that way</th>
          </tr>
        </thead>
        <tbody>
          <tr id="svc-median-all">
            <th scope="row">
              The middle is taken over <em>every</em> submission in time, not the first few to
              arrive.
            </th>
            <td>
              A first-past-the-post rule is decided by transaction ordering, which neither the
              customer nor Bleavit controls — a block producer could choose which judges counted.
              A <Jargon word="quorum" /> of half the set, rounded up, is the threshold to settle at
              all, not a way of selecting whose answer counts.
            </td>
          </tr>
          <tr id="svc-median-even">
            <th scope="row">An even number of judges settles on the mean of the middle two, rounded down.</th>
            <td>
              Every settled value has to land on the chain&rsquo;s billionth-part grid, so an
              unrounded mean is not a representable answer at all. Rounding down is rounding against
              whoever gains from a higher settlement.
            </td>
          </tr>
          <tr id="svc-median-dupes">
            <th scope="row">A judge who submits twice keeps only its latest value.</th>
            <td>Otherwise one judge votes as many times as it can afford transactions.</td>
          </tr>
          <tr id="svc-median-tolerance">
            <th scope="row">
              The tolerance is frozen when the question is registered and can never exceed{' '}
              <Value of={spec(SVC_TOLERANCE_MAX, C_KERNEL)} format={f2} />.
            </th>
            <td>
              It is part of what the customer bought. A vote that could widen it after trading
              opened could retroactively excuse a judge the customer had already priced — so it is
              frozen, and it is printed in the report so the customer can check it did not move.
            </td>
          </tr>
          <tr id="svc-median-bond">
            <th scope="row">
              Each judge&rsquo;s deposit is{' '}
              <Value of={derived(bondFraction, C_SETTLE)} format={pct} /> of the escrow at risk.
            </th>
            <td>
              Reusing the existing dispute-bond formula verbatim rather than adding a new knob:
              <span className="mono"> (2^orc.rounds − 1) × orc.bond_bps</span>, at{' '}
              <Value of={spec(value('orc.rounds'), param('orc.rounds').cite)} /> rounds and{' '}
              <Value of={spec(value('orc.bond_bps'), param('orc.bond_bps').cite)} format={int} unit="bps" />.
            </td>
          </tr>
        </tbody>
      </table>

      <h3>What this does not fix, said out loud</h3>
      <p>
        A customer who controls most of its own judges can move its own settlement and pay itself
        out of the winning side. That is a trust model, not a bug, and it cannot be repaired inside
        this design — the alternative is Bleavit adjudicating foreign facts, which is refused for
        stronger reasons. What bounds it is the blast radius:{' '}
        <strong>that question&rsquo;s escrow and nothing else</strong>, with the second ledger and
        every Bleavit market untouched (<span className="cite">{formatCitation(C_TRUST)}</span>).
      </p>
      <p>
        What is owed instead of a fix is legibility. The report carries how many judges were named,
        how many must agree and how much they hold at risk, as a first-class field — so a report
        settled by one cheap judge <em>says so</em>, and whoever is about to rely on it can see
        what they are trusting.
      </p>
      <p className="panel__note">
        Why a middle value rather than a self-report anybody may challenge: a challenge needs
        somebody to decide who was right, and this game has nobody by construction. Without a
        judge, &ldquo;challenge means void and everyone is refunded&rdquo; makes lying strictly
        worthwhile, while &ldquo;challenge means the reporter loses&rdquo; destroys an honest
        customer with a single spiteful challenge. A middle value over three independently bonded
        parties is the only shape that prices one liar and survives one absence.
      </p>
    </section>
  );
}

function PricePanel() {
  const maxLive = param('svc.max_live');
  const cap = param('svc.price_cap');
  const windowRow = param('svc.max_window');
  const step = (cap.value - 1) / maxLive.value;

  return (
    <section className="panel">
      <h2 className="panel__title">What a slot costs</h2>
      <p>
        Only <Value of={spec(maxLive.value, maxLive.cite)} unverified /> outside questions may run
        at once. That ceiling is not a guess at demand — it is a bound on how much of the
        chain&rsquo;s block capacity outside traffic may occupy, and{' '}
        <strong>no measurement in this repository sizes it yet</strong>, so it ships deliberately
        low and flagged. An absent or invalid value reads as zero, so admission fails shut rather
        than open (<span className="cite">{formatCitation(C_QUOTA)}</span>).
      </p>
      <p>
        The fee is a floor or a rate, whichever is larger, multiplied by a scarcity factor:
      </p>
      <p className="svc-formula">
        fee = max( <Value of={spec(SVC_FEE_FLOOR, C_KERNEL)} format={usdcWhole} unit="USDC" />,{' '}
        <Value of={spec(value('svc.fee_bps'), param('svc.fee_bps').cite)} format={int} unit="bps" />{' '}
        &times; declared stake ) &times; M
      </p>
      <p>
        The floor is anchored to the fully allocated yearly cost of running the service divided
        across a full year of slots, not to the marginal cost of one more question — because a slot
        is scarce by construction, and pricing scarce capacity at marginal cost prices it at
        roughly zero (<span className="cite">{formatCitation(C_TARIFF)}</span>).
      </p>

      <h3>The scarcity factor rises fast and falls slowly, on purpose</h3>
      <p>
        Each admission adds <Value of={derived(step, C_PRICE)} format={f4} /> to{' '}
        <span className="mono">M</span> immediately, so taking all{' '}
        <Value of={spec(maxLive.value, maxLive.cite)} unverified /> slots at once walks the price
        from 1&times; to exactly <Value of={spec(cap.value, cap.cite)} format={f2} />&times; — the
        ceiling, hit precisely rather than short of it, because the step divides the chain&rsquo;s
        integer grid exactly. From there it decays back toward 1 over one question window —{' '}
        <Value of={spec(windowRow.value, windowRow.cite)} format={int} unit="blocks" /> (
        {formatDurationHuman(windowRow.value)}), and over the window that was in force when the
        price was set rather than the live one, because a governance amendment is not a decay.
      </p>
      <p>
        Both halves of that asymmetry are load-bearing. Because the fall is gradual, a freed slot
        walks its price down rather than dropping to the floor, so whoever must have it{' '}
        <em>now</em> pays the top of the descent and whoever can wait pays less — sniping is priced
        rather than forbidden. Because the rise is instant, a burst of registrations compounds
        faster than decay removes it, so the price reflects how <em>fast</em> capacity is going and
        not merely how much is gone. Simple occupancy has no memory: sixteen slots taken over three
        weeks and sixteen taken in one block would otherwise cost the same.
      </p>
      <p>
        The same multiplier also rises when <strong>Bleavit&rsquo;s own</strong> decision markets
        are thin, whether or not slots are contended (
        <span className="cite">{formatCitation(C_STARVE)}</span>). That is the automatic half of a
        promise that would otherwise be a vote: the standing instruction says a values vote{' '}
        <em>must</em> cut the cap if outside occupancy starves Bleavit&rsquo;s own markets, and
        asking for a vote exactly when revenue argues against one is a weak first response. So the
        price responds first, continuously — no threshold to race — and the cap remains the only
        thing a vote can move. Price clears; quantity never does.
      </p>
      <p className="panel__note">
        The honest limit: the fee is charged once, at registration, so anyone already holding a slot
        has already paid, and raising the price of future registrations advantages incumbents. What
        the price response does guarantee against the alternative — a hard stop on new
        registrations — is weaker and true: a customer who values the slot above the raised price
        still gets it, where a stop would refuse it at any price.
      </p>

      <h3>The six governable rows</h3>
      <table className="svc-table">
        <caption className="sr-only">The doc 13 §1 rows that price and bound the service</caption>
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
          {SVC_KEYS.map((k) => {
            const p = param(k);
            const unsettled = p.verification.status !== 'settled';
            return (
              <tr key={k} id={`svc-param-${k}`}>
                <th scope="row">
                  <span className="mono">{p.key}</span>
                </th>
                <td className="numeric">
                  <Value
                    of={spec(p.value, p.cite)}
                    format={int}
                    unit={p.unit}
                    unverified={unsettled}
                  />
                </td>
                <td className="numeric">{p.min === undefined ? '—' : int(p.min)}</td>
                <td className="numeric">{p.max === undefined ? '—' : int(p.max)}</td>
                <td>
                  {p.blurb}
                  {p.kernelBounded
                    ? ' Its bounds are compile-time, so no amendment reaches past them.'
                    : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="panel__note">
        Trading and redemption fees on outside books accrue to Bleavit as service revenue, and the
        customer&rsquo;s own subsidy does not — it returns to the customer. That had to be written
        down rather than inherited: the fee sweep runs over <em>every</em> book, so adding a new
        kind of book and saying nothing would have made Bleavit collect a customer&rsquo;s fees by
        accident (<span className="cite">{formatCitation(C_FEES)}</span>).
      </p>
    </section>
  );
}

function DeliveryPanel() {
  return (
    <section className="panel">
      <h2 className="panel__title">Getting the answer back</h2>
      <p>
        There are two deliveries, and only one of them counts. The report is written into
        Bleavit&rsquo;s own storage, and that copy is authoritative: a customer reads it and can
        prove mathematically, against a finalised block header, that it is what the chain really
        recorded. Bleavit <em>also</em> pushes a copy to the customer over{' '}
        <Jargon word="xcm" label="the message channel between chains" />, and that copy is
        best-effort. If the push fails, the report is already published and nothing about it
        changes (<span className="cite">{formatCitation(C_EGRESS)}</span>).
      </p>
      <p>
        <strong>A failed push is deliberately invisible to Bleavit&rsquo;s own health measure, and
        that asymmetry is not laziness.</strong> One of the numbers feeding Bleavit&rsquo;s welfare
        score is the fraction of its outbound messages that were accepted. Route the customer
        pushes through the same counter, and a customer that simply never opens its return channel
        — or quietly closes it later — makes every push fail and drags a{' '}
        <em>Bleavit governance input</em> down, at no cost to itself. That is an outsider moving a
        Bleavit decision input for free, which is the one thing the whole document exists to
        forbid.
      </p>

      <table className="svc-table">
        <caption className="sr-only">The four conditions the push ships with</caption>
        <thead>
          <tr>
            <th scope="col">Condition</th>
            <th scope="col">What it prevents</th>
          </tr>
        </thead>
        <tbody>
          <tr id="svc-push-router">
            <th scope="row">A separate sending path that does not touch the health counter.</th>
            <td>A customer&rsquo;s closed channel scoring against Bleavit&rsquo;s uptime.</td>
          </tr>
          <tr id="svc-push-fee">
            <th scope="row">
              Postage prepaid from the customer&rsquo;s own <Jargon word="usdc" /> float.
            </th>
            <td>A customer&rsquo;s delivery costs becoming a treasury outflow.</td>
          </tr>
          <tr id="svc-push-outcome">
            <th scope="row">
              The send result never read back into the report, the lifecycle, settlement, the
              treasury or the score.
            </th>
            <td>
              Any of those becoming a function of whether an outsider was reachable at that moment.
            </td>
          </tr>
          <tr id="svc-push-alert">
            <th scope="row">Failures counted on an isolated meter with an operator alert.</th>
            <td>
              The failure being invisible to the people running the chain as well — the counter is
              excluded from the score, not from the operators.
            </td>
          </tr>
        </tbody>
      </table>
      <p className="panel__note">
        The pushed message is one fixed shape built entirely from the stored report and the
        registered address. No caller chooses a destination, a target or a payload, and there is no
        reply path back: a response message in this language carries no arbitrary data, so it could
        not be one. It is a delivery, never a channel. A customer running off-chain has no address
        at all and simply reads the authoritative copy, which records neither an attempt nor a
        false failure.
      </p>
    </section>
  );
}

function ProvenancePanel({ price }: { price: number }) {
  return (
    <section className="panel">
      <h2 className="panel__title">What on this screen is invented</h2>
      <p>
        The simulation this app runs carries a Bleavit proposal and <em>no</em> hosted question at
        all, so the right-hand book on the drawing has no real reading to show. Its level is an
        invented example price of <Value of={simulated(EXAMPLE_ACCEPT_PRICE)} format={f2} />, and
        the left-hand book is the simulated Bleavit market at{' '}
        <Value of={simulated(price)} format={f3} />. Every other number on this screen is either
        fixed by the specification or computed from values that are.
      </p>
      <p className="panel__note">
        Nothing here was read from a chain. The service has no live deployment, and the ceiling on
        simultaneous questions is flagged unsettled precisely because settling it needs occupancy
        that has never existed.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function TheServiceScene({ sim }: { sim: SimState }): JSX.Element {
  const bond = param('svc.client_bond');
  const maxLive = param('svc.max_live');
  const ownPrice = sim.books.find((b) => b.kind === 'DecisionAccept')?.spot ?? 0.5;

  return (
    <div className="grid21">
      <div className="col-stage">
        <SceneFrame model={buildModel(sim)} title="Questions for sale" />
      </div>
      <div className="col-rail">
        <Lede>
          Bleavit sells the thing it was built to do. Another blockchain can pay it to run a market
          on their own question — will this change help us or not — and gets back the two prices
          the traders settled on. The money behind those markets sits in a completely separate pot
          from Bleavit&rsquo;s own, so a customer who runs short leaves Bleavit&rsquo;s own traders
          untouched. The answer also carries a number saying what faking the price would have cost,
          and that number is a floor: a small one is a warning, and a large one still does not mean
          nobody tried.
        </Lede>

        <KeyFacts>
          <KeyFact
            label="Deposit to sign up"
            note="Held while you are a customer, returned when you leave cleanly."
          >
            <Value of={spec(bond.value, bond.cite)} format={int} unit="VIT" />
          </KeyFact>
          <KeyFact
            label="Questions at once"
            note="A cap on how much of the chain outsiders may occupy — not a guess at demand."
          >
            <Value of={spec(maxLive.value, maxLive.cite)} unverified />
          </KeyFact>
          <KeyFact
            label="Pots of money, kept apart"
            note="Bleavit’s own and its customers’. Each is checked for solvency on its own."
          >
            <Value of={spec(LEDGER_INSTANCES, C_SEGREGATION)} />
          </KeyFact>
        </KeyFacts>

        <SoldPanel />

        <Depth title="Every field of the report, and what “certified” really claims" hint="16 §5">
          <ReportPanel />
        </Depth>
        <Depth title="How a customer gets in, and the deposit that opened the service" hint="16 §2">
          <AdmissionPanel />
        </Depth>
        <Depth
          title="Why a customer’s money is in a second ledger, not a labelled corner of the first"
          hint="the load-bearing idea"
        >
          <SegregationPanel />
        </Depth>
        <Depth
          title="The five states a question passes through"
          hint={`${PHASE_ROWS.length} states`}
        >
          <LifecyclePanel />
        </Depth>
        <Depth
          title="Who decides the answer — and what a customer can still rig"
          hint={`${SVC_ATTESTORS_MIN}–${SVC_ATTESTORS_MAX} judges`}
        >
          <SettlementPanel />
        </Depth>
        <Depth
          title="What a slot costs, and why the price moves on its own"
          hint={`${SVC_KEYS.length} rows`}
        >
          <PricePanel />
        </Depth>
        <Depth title="Delivering the answer, and the failure Bleavit refuses to notice" hint="16 §9">
          <DeliveryPanel />
          <ProvenancePanel price={ownPrice} />
        </Depth>
      </div>
    </div>
  );
}
