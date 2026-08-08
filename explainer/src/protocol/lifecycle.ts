/**
 * The proposal state machine, as data — doc 05 §2.1.
 *
 * §2.1 is normative and closed: "anything absent is impossible and MUST error".
 * That is only true of an implementation if the table is *one* table, so the 26
 * transitions live here as a single exhaustive array and every consumer (the 3D
 * lifecycle scene, the scenario narration, the tests) reads the same rows. Any
 * edge drawn anywhere in this app that is not in `TRANSITIONS` is a bug by
 * construction.
 *
 * Two things about this machine are routinely misread, so they are modelled
 * explicitly rather than left to prose:
 *
 *  - **`Rejected` and `Expired` are usually not terminal.** T21 fires in the same
 *    block whenever markets were deployed and the vault is still open: the REJECT
 *    branch resolves, trades through measurement and settles. §2.1 calls that
 *    "the most common lifecycle path". Only a rejection with no vault (pre-Seed,
 *    via T20) or a `Voided` vault actually stops. Hence
 *    `isTerminal`/`isTransient` both take the vault fact as an argument — there is
 *    no answer without it.
 *  - **Rejection is information, not punishment.** T10 refunds the bond in full and
 *    releases the resource locks in both arms (SQ-318). The only confiscating
 *    paths are T4's two enumerated slash arms and T18's 50 % executability slash.
 */

import type { Citation } from './citations';
import { cite } from './citations';
import {
  DEC_EXTENSION_BLOCKS,
  EXECUTION_RETRY_WINDOW_BLOCKS,
  INTAKE_QUEUE,
  MAX_INTAKE_PER_ACCOUNT,
  STALE_EPOCH_BOUND_BLOCKS,
} from './constants';
import type { ProposalState, RejectReason } from './types';

/** Digit grouping for the guard prose below. Display only, never protocol math. */
const n = (x: number): string => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const T = (id: string, note?: string): Citation =>
  cite('05', '§2.1', note === undefined ? id : `${id} — ${note}`);

export type TransitionId =
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'T5'
  | 'T6'
  | 'T7'
  | 'T8'
  | 'T9'
  | 'T10'
  | 'T11'
  | 'T12'
  | 'T13'
  | 'T14'
  | 'T15'
  | 'T16'
  | 'T17'
  | 'T18'
  | 'T19'
  | 'T20'
  | 'T21'
  | 'T22'
  | 'T23'
  | 'T24'
  | 'T25'
  | 'T26';

export interface Transition {
  readonly id: TransitionId;
  /**
   * `null` for the entry transition (T1). An array where §2.1 writes several
   * origins on one row; the order is the doc's own, which runs earliest-first in
   * lifecycle order, so `fromStates(t)[0]` is the canonical entry point.
   */
  readonly from: ProposalState | null | readonly ProposalState[];
  readonly to: ProposalState;
  /**
   * Present only where the row fixes the reason. T10 and T16 each admit a set of
   * reasons decided at runtime, so they carry none — their `guard` names the set.
   */
  readonly toReason?: RejectReason;
  /** The call that fires it, or "automatic" where §2.1's trigger column says so. */
  readonly trigger: string;
  /** Dispatch origin; `—` marks a transition with no call of its own (T17, T21). */
  readonly origin: string;
  readonly guard: string;
  readonly event?: string;
  readonly cite: Citation;
  /** T21 follows in the same block, but only if the vault is open (not `Voided`). */
  readonly sameBlockFollowUp?: 'T21';
  /** The T10 → T21 pair: reject, then measure the REJECT branch anyway. */
  readonly commonPath?: boolean;
}

/**
 * All 26 transitions of doc 05 §2.1, in table order.
 *
 * Guard text is compressed from the row's *Timing / guard* and *Deposit / slash*
 * columns; where a number appears it is interpolated from the kernel constants so
 * the prose cannot drift away from `constants.ts`.
 */
export const TRANSITIONS: readonly Transition[] = Object.freeze([
  {
    id: 'T1',
    from: null,
    to: 'Submitted',
    trigger: 'epoch.submit',
    // A proposal carries two identities: the author writes the payload, the
    // funder posts the bond. The funder is the submit signer and cannot be
    // named freely — that is the whole consent mechanism, since an extrinsic
    // must never be able to enlist a third party's balance.
    origin: 'funder (Signed)',
    guard: `Intake phase only; intake queue < ${n(INTAKE_QUEUE)}; at most ${n(MAX_INTAKE_PER_ACCOUNT)} entries per epoch per funding account; the class bond is held on the signer`,
    event: 'ProposalSubmitted',
    cite: T('T1'),
  },
  {
    id: 'T2',
    from: 'Submitted',
    to: 'Cancelled',
    trigger: 'epoch.withdraw',
    origin: 'proposer or funder (Signed)',
    guard: 'before Qualify; full refund to the funder',
    event: 'ProposalWithdrawn',
    cite: T('T2'),
  },
  {
    id: 'T3',
    from: 'Submitted',
    to: 'Screening',
    trigger: 'tick',
    origin: 'keeper (permissionless)',
    guard: 'Qualify phase start',
    event: 'ScreeningStarted',
    cite: T('T3'),
  },
  {
    id: 'T4',
    from: 'Screening',
    to: 'Cancelled',
    trigger: 'tick (static checks fail)',
    origin: 'keeper (permissionless)',
    guard:
      'preimage missing/unpinned/oversized, resource-domain mismatch, kernel violation, unclassifiable batch, or a bond below the derived class floor. Disposition taxonomy: 100 % slash only on a verified constitution violation or a verified false resource declaration; 10 % slash to INSURANCE on a missing, unpinned or oversized preimage; full refund for everything else, which is the default arm',
    event: 'ProposalCancelled(reason)',
    cite: T('T4', 'disposition taxonomy, SQ-191'),
  },
  {
    id: 'T5',
    from: 'Screening',
    to: 'Qualified',
    trigger: 'tick (checks pass)',
    origin: 'keeper (permissionless)',
    guard:
      'Qualify phase; the slot is won bond-descending then pid-ascending, so equal bonds fall back on submission order and never on iteration order; resource locks acquired; decide_at computed and stored',
    event: 'ProposalQualified',
    cite: T('T5', 'T5/T6 ordering, SQ-91'),
  },
  {
    id: 'T6',
    from: 'Screening',
    to: 'Submitted',
    trigger: 'tick (no slot won, or a resource-lock conflict)',
    origin: 'keeper (permissionless)',
    guard:
      'the first deferral only — the proposal returns to Submitted re-anchored to the next epoch; a second deferral takes T26 instead, because the rollover allowance is per proposal and not per cause',
    event: 'ProposalDeferred',
    cite: T('T6', 'rollover, SQ-91'),
  },
  {
    id: 'T7',
    from: 'Qualified',
    to: 'Trading',
    trigger: 'tick',
    origin: 'keeper (permissionless)',
    guard: 'Seed phase: markets deployed, POL seeded, vault opened',
    event: 'MarketsOpened',
    cite: T('T7'),
  },
  {
    id: 'T8',
    from: 'Trading',
    to: 'Extended',
    trigger: 'decide, or the first TWAP stale event',
    origin: 'keeper (permissionless)',
    guard: `Decide phase; fires on the first insufficiency, on full/trailing disagreement, or on the first stale event — at most once per proposal, since all three share one extension budget; decide_at += ${n(DEC_EXTENSION_BLOCKS)} blocks (3 d)`,
    event: 'DecisionExtended',
    cite: T('T8'),
  },
  {
    id: 'T9',
    from: ['Trading', 'Extended'],
    to: 'Queued',
    trigger: 'decide',
    origin: 'keeper (permissionless)',
    guard: 'now ≥ decide_at and all eleven §5.4 checks pass; the DecisionOutcome Adopt is recorded on entry',
    event: 'ProposalQueued { payload_hash, maturity }',
    cite: T('T9'),
  },
  {
    id: 'T10',
    from: ['Trading', 'Extended'],
    to: 'Rejected',
    trigger: 'decide',
    origin: 'keeper (permissionless)',
    guard:
      'any §5.4 check fails; r ∈ { NotDecisionGrade, GateVetoSurvival, GateVetoSecurity, HurdleNotMet, ConvergenceFailed, SecondExtensionFailed, ProcessHold, ConstitutionViolation, ResourceConflict, SecuritySizing, AttestationMissing, RateLimited }. The bond is refunded in full — rejection is information — and the resource locks are released in both arms, with markets and without (SQ-318)',
    event: 'ProposalRejected(r)',
    sameBlockFollowUp: 'T21',
    commonPath: true,
    cite: T('T10', 'lock release, SQ-318'),
  },
  {
    id: 'T11',
    from: 'Queued',
    to: 'Suspended',
    trigger: 'guardian.delay_once',
    origin: 'GuardianHold',
    guard: 'within the execution timelock; once ever per proposal, and the allowance is shared with T25',
    event: 'ProposalDelayed { justification_hash }',
    cite: T('T11'),
  },
  {
    id: 'T12',
    from: 'Suspended',
    to: 'Rerun',
    trigger: 'tick',
    origin: 'keeper (permissionless)',
    guard:
      'the guardian review window closes at the first Seed phase of action_epoch + 1 (or a later Seed if the crank is late) and no uphold_veto verdict has enacted; the separate grd.review_dl accountability deadline does not gate this transition',
    event: 'RerunScheduled',
    cite: T('T12', 'review horizons, SQ-310/SQ-311'),
  },
  {
    id: 'T13',
    from: 'Rerun',
    to: 'Extended',
    trigger: 'tick at the T12 Seed boundary',
    origin: 'keeper (permissionless)',
    guard: `books reopen at 2× POL with the hurdle raised by one percentage point, TWAP accumulators reset, positions intact; sets extended and rerun, decide_at := reopen_block + ${n(DEC_EXTENSION_BLOCKS)} blocks`,
    event: 'RerunOpened',
    cite: T('T13'),
  },
  {
    id: 'T14',
    from: 'Queued',
    to: 'Executed',
    trigger: 'execution_guard.execute',
    origin: 'Signed (keeper)',
    guard:
      'maturity ≤ now ≤ maturity + grace(class), and every doc 09 dispatch re-validation passes — including a Passed RatificationRecord for CODE and META (D-5)',
    event: 'Executed { record }',
    cite: T('T14'),
  },
  {
    id: 'T15',
    from: 'Queued',
    to: 'Expired',
    trigger: 'tick',
    origin: 'keeper (permissionless)',
    guard:
      'grace elapsed with no execute attempt succeeding AND no T16 cause applying — T16 is evaluated first, so a known terminal cause never collapses into generic expiry (SQ-164); bond refunded',
    event: 'MandateExpired',
    sameBlockFollowUp: 'T21',
    cite: T('T15', 'grace-end precedence, SQ-164'),
  },
  {
    id: 'T16',
    from: 'Queued',
    to: 'Rejected',
    trigger: 'tick, or an execute failure path',
    origin: 'keeper (permissionless)',
    guard:
      'r ∈ { StaleQueue (version-constraint mismatch after an intervening upgrade, or repeated meter contention past grace), NotRatified (grace end reached with no Passed RatificationRecord — an earlier execute against an absent ratification merely errors and leaves the proposal Queued, SQ-163), AttestationMissing (the queue-time AttestationRecord was revoked or a late challenge resolved against it) }; evaluated before T15; refund',
    event: 'ProposalRejected(r)',
    sameBlockFollowUp: 'T21',
    cite: T('T16'),
  },
  {
    id: 'T17',
    from: 'Executed',
    to: 'Measuring',
    trigger: 'automatic within T14',
    origin: '—',
    guard: 'the vault resolves to Accept; the proposer reward is paid',
    event: 'MeasurementStarted(cohort)',
    cite: T('T17'),
  },
  {
    id: 'T18',
    from: 'Queued',
    to: 'FailedExecuted',
    trigger: 'execution_guard.execute (payload dispatch error)',
    origin: 'Signed (keeper)',
    guard: `the payload reverts atomically while the proposal state advances; a ${n(EXECUTION_RETRY_WINDOW_BLOCKS)}-block (72 h) retry window opens and the ACCEPT branch stays live; 50 % bond slash, because the proposer owns executability`,
    event: 'ExecutionFailed { reason: PayloadReverted }',
    cite: T('T18'),
  },
  {
    id: 'T19',
    from: 'Measuring',
    to: 'Settled',
    trigger: 'settle_cohort',
    origin: 'keeper (permissionless)',
    guard:
      "the cohort's e+2 snapshot is finalized and its challenge window closed; settlement runs at e+3 Housekeeping",
    event: 'CohortSettled { s }',
    cite: T('T19'),
  },
  {
    id: 'T20',
    // Every non-terminal pre-Executed state. `FailedExecuted` belongs here: SQ-319
    // ruled that Queued/Suspended/Rerun/FailedExecuted are simultaneously
    // pre-Executed and already decided.
    from: [
      'Submitted',
      'Screening',
      'Qualified',
      'Trading',
      'Extended',
      'Queued',
      'Suspended',
      'Rerun',
      'FailedExecuted',
    ],
    to: 'Rejected',
    toReason: 'ProcessHold',
    trigger: 'tick or decide()',
    origin: 'keeper (permissionless)',
    guard: `force-reject under VOID conditions, under stale-epoch (the ${n(STALE_EPOCH_BOUND_BLOCKS)}-block bound measures epoch staleness, not per-proposal age, and latches a proposal-id cutoff), or under an active PB-LEDGER-FREEZE — the disposition is identical whichever observes the proposal first. An existing vault moves to Voided, so there is NO measurement and T21 cannot fire; queued executions cancel (I-15); refund. It MUST NOT overwrite a DecisionOutcome already recorded (SQ-319)`,
    event: 'ProposalForceRejected { pid, reason: ProcessHold }',
    cite: T('T20', 'stale-epoch anchor SQ-86; decided-but-pre-Executed SQ-319'),
  },
  {
    id: 'T21',
    from: ['Rejected', 'Expired'],
    to: 'Measuring',
    trigger: 'automatic, in the same block as entering Rejected or Expired',
    origin: '—',
    guard:
      'fires iff markets were deployed and the vault is still open (not Voided): the vault resolves to Reject, and the REJECT branch trades through measurement and settles. This is the most common lifecycle path — most proposals are rejected, and rejected proposals are still measured',
    event: 'MeasurementStarted(cohort)',
    commonPath: true,
    cite: T('T21'),
  },
  {
    id: 'T22',
    from: 'FailedExecuted',
    to: 'Measuring',
    trigger: 'tick',
    origin: 'keeper (permissionless)',
    guard:
      'the 72 h retry window is exhausted; the vault resolves to Accept and the cohort measures the adopted world including the failure — the DecisionRecord carries PayloadReverted',
    event: 'MeasurementStarted(cohort)',
    cite: T('T22'),
  },
  {
    id: 'T23',
    from: 'FailedExecuted',
    to: 'Executed',
    trigger: 'execution_guard.execute (retry)',
    origin: 'Signed (keeper)',
    guard:
      'within the 72 h retry window, with the full dispatch re-validation repeated; the T18 slash is not reversed. T17 then fires as usual',
    event: 'Executed { record }',
    cite: T('T23'),
  },
  {
    id: 'T24',
    from: 'Suspended',
    to: 'Rejected',
    toReason: 'VetoUpheldByReview',
    trigger: 'guardian.uphold_veto(action_id), enacted by the ratify-track retrospective review',
    origin: 'values enactment (via the guardian pallet)',
    guard:
      'only while Suspended and before T12 leaves the state; the upheld-veto referendum survives an ordinary review failure but is cancelled and refunded once T12 opens the rerun; bond refunded',
    event: 'ProposalRejected(VetoUpheldByReview)',
    sameBlockFollowUp: 'T21',
    cite: T('T24'),
  },
  {
    id: 'T25',
    from: ['Trading', 'Extended', 'Queued'],
    to: 'Extended',
    trigger: 'guardian.force_rerun(pid)',
    origin: 'GuardianHold',
    guard: `pre-execution only, and one guardian rerun of either kind per proposal ever — the allowance is shared with the T11→T12→T13 delay-then-rerun path. A queued mandate is cancelled in the same transaction (I-15); books reopen and every proposal-book TWAP accumulator resets while positions and POL stay intact; sets rerun and extended, decide_at := reopen_block + ${n(DEC_EXTENSION_BLOCKS)} blocks`,
    event: 'ForceRerun { pid, justification_hash, window_end }',
    cite: T('T25'),
  },
  {
    id: 'T26',
    from: 'Screening',
    to: 'Cancelled',
    toReason: 'RolloverExhausted',
    trigger: 'tick (no slot won, or a resource-lock conflict) against a proposal that already took T6',
    origin: 'keeper (permissionless)',
    guard:
      'evaluated in place of T6 and never after it, so no proposal takes T6 twice; full refund, because losing a slot is contention and not misconduct. The exhausting deferral must report itself as terminal — emitting ProposalDeferred here would enter a dead proposal into event-derived history as still live (SQ-166)',
    event: 'ProposalCancelled { pid, reason: RolloverExhausted }',
    cite: T('T26'),
  },
] as const satisfies readonly Transition[]);

const BY_ID: Readonly<Record<TransitionId, Transition>> = Object.freeze(
  Object.fromEntries(TRANSITIONS.map((t) => [t.id, t])) as Record<TransitionId, Transition>,
);

/** The origin states of a transition, normalised. Empty only for T1 (doc 05 §2.1). */
export function fromStates(t: Transition): readonly ProposalState[] {
  const f = t.from;
  if (f === null) return [];
  return typeof f === 'string' ? [f] : f;
}

/** Every transition that can leave `state` (doc 05 §2.1). */
export function transitionsFrom(state: ProposalState): readonly Transition[] {
  return TRANSITIONS.filter((t) => fromStates(t).includes(state));
}

/** Total lookup — `TransitionId` is closed over the 26 rows of doc 05 §2.1. */
export function transitionById(id: TransitionId): Transition {
  return BY_ID[id];
}

/**
 * Whether the lifecycle actually stops here (doc 05 §2.1, *Terminal states*).
 *
 * The vault fact is an argument, not an assumption: `Rejected` and `Expired` are
 * terminal only where no vault exists (a pre-Seed T20 rejection) or the vault was
 * `Voided`. With a healthy vault they are one block away from `Measuring`.
 */
export function isTerminal(state: ProposalState, hasHealthyVault: boolean): boolean {
  switch (state) {
    case 'Settled':
    case 'Cancelled':
      return true;
    case 'Rejected':
    case 'Expired':
      return !hasHealthyVault;
    default:
      return false;
  }
}

/**
 * Whether the proposal is in a state it leaves in the same block (doc 05 §2.1 T21).
 *
 * This is the single most misread part of the machine: a rejected proposal with an
 * open vault has not stopped, it has resolved to the REJECT branch and is about to
 * be measured like any other.
 */
export function isTransient(state: ProposalState, hasHealthyVault: boolean): boolean {
  return (state === 'Rejected' || state === 'Expired') && hasHealthyVault;
}

/** Layout tiers for the lifecycle graph, in left-to-right reading order. */
export const STATE_TIERS = ['intake', 'market', 'mandate', 'measurement', 'terminal'] as const;
export type StateTier = (typeof STATE_TIERS)[number];

/**
 * One plain sentence per state, plus the tier the graph lays it out in (doc 05 §2.1).
 *
 * Two tier assignments are deliberate rather than obvious. `Rerun` sits in
 * `market`, because that is what a rerun does — it sends a mandate back to the
 * books at 2× POL. `Rejected` and `Expired` sit in `measurement` rather than
 * `terminal`, because with a healthy vault they are not endpoints at all: placing
 * them next to `Measuring` is what makes T21, the most common path, legible.
 */
export const STATE_META: Readonly<
  Record<ProposalState, { readonly tier: StateTier; readonly blurb: string; readonly cite: Citation }>
> = Object.freeze({
  Submitted: {
    tier: 'intake',
    blurb: 'Queued for intake with the class bond held, and still withdrawable by the proposer.',
    cite: T('T1/T2'),
  },
  Screening: {
    tier: 'intake',
    blurb:
      'Mechanical checks run: preimage availability, the declared resource footprint against the one derived from the payload, class origin and bond floor.',
    cite: cite('05', '§1.4', 'footprint and the screening rule'),
  },
  Qualified: {
    tier: 'intake',
    blurb: 'It won a slot, holds its resource locks and has a fixed decide_at; it waits for the Seed phase.',
    cite: T('T5'),
  },
  Trading: {
    tier: 'market',
    blurb:
      'Six conditional books are live — an ACCEPT and a REJECT welfare book plus four gate books — and every price is a conditional forecast of welfare.',
    cite: T('T7'),
  },
  Extended: {
    tier: 'market',
    blurb:
      'One extra three-day decision window, granted at most once for insufficient information, full/trailing disagreement, a stale market, or a guardian rerun.',
    cite: T('T8/T13/T25'),
  },
  Queued: {
    tier: 'mandate',
    blurb: 'The market cleared the hurdle; the payload now waits out its timelock before the guard may dispatch it.',
    cite: T('T9'),
  },
  Suspended: {
    tier: 'mandate',
    blurb: 'A guardian spent its one delay, freezing the mandate until the retrospective review concludes.',
    cite: T('T11'),
  },
  Rerun: {
    tier: 'market',
    blurb: 'The review upheld no veto, so the books are scheduled to reopen at the next Seed phase at double POL.',
    cite: T('T12/T13'),
  },
  Executed: {
    tier: 'mandate',
    blurb: 'The payload dispatched, so the ACCEPT branch is now the world the welfare function will measure.',
    cite: T('T14'),
  },
  FailedExecuted: {
    tier: 'mandate',
    blurb: 'The payload reverted atomically; 72 hours remain to retry it, and half the bond is already slashed.',
    cite: T('T18'),
  },
  Rejected: {
    tier: 'measurement',
    blurb:
      'The decision went against the payload, or the process refused it; the bond is refunded, and unless the vault was voided the REJECT branch is measured anyway.',
    cite: T('T10/T21'),
  },
  Expired: {
    tier: 'measurement',
    blurb: 'The grace window closed with no successful execution and no specific rejection cause; the bond is refunded.',
    cite: T('T15'),
  },
  Measuring: {
    tier: 'measurement',
    blurb: 'The vault is resolved and the winning branch is scored by the welfare function over the following epochs.',
    cite: T('T17/T21/T22'),
  },
  Settled: {
    tier: 'terminal',
    blurb: 'The cohort settlement score s is final, and every position pays out against it.',
    cite: T('T19'),
  },
  Cancelled: {
    tier: 'terminal',
    blurb: 'It never reached a market — withdrawn, failed static screening, or out of rollover allowance.',
    cite: T('T2/T4/T26'),
  },
});

/**
 * Expand a declared transition path into the states it visits (doc 05 §2.1).
 *
 * Scenarios narrate themselves from these paths, so a path that skips an edge the
 * table does not contain must fail loudly rather than render a plausible lie.
 * Throws when two consecutive transitions do not connect. A path beginning with a
 * multi-origin transition enters at the first origin §2.1 lists, which is the
 * earliest in lifecycle order.
 */
export function pathFor(ids: readonly TransitionId[]): ProposalState[] {
  const path: ProposalState[] = [];
  let current: ProposalState | null = null;

  for (const [i, id] of ids.entries()) {
    const t = transitionById(id);
    const origins = fromStates(t);
    const previous = ids[i - 1] ?? '<start>';

    if (i === 0) {
      const [entry] = origins;
      if (entry !== undefined) path.push(entry);
    } else if (origins.length === 0) {
      throw new Error(
        `pathFor: ${t.id} is the entry transition and has no origin state, so it cannot follow ${previous}.`,
      );
    } else if (current === null || !origins.includes(current)) {
      throw new Error(
        `pathFor: ${t.id} cannot follow ${previous} — that ends in ${current ?? 'no state'}, but ${t.id} starts from ${origins.join(' or ')}.`,
      );
    }

    current = t.to;
    path.push(t.to);
  }

  return path;
}

/** The reasons `decide()` can produce at T10 (doc 05 §1.3 producer map, §5.5). */
export const T10_REJECT_REASONS: readonly RejectReason[] = Object.freeze([
  'NotDecisionGrade',
  'GateVetoSurvival',
  'GateVetoSecurity',
  'HurdleNotMet',
  'ConvergenceFailed',
  'SecondExtensionFailed',
  'ProcessHold',
  'ConstitutionViolation',
  'ResourceConflict',
  'SecuritySizing',
  'AttestationMissing',
  'RateLimited',
] as const);

/** The reasons the execution guard can produce at T16 (doc 05 §1.3, §2.1 T16). */
export const T16_REJECT_REASONS: readonly RejectReason[] = Object.freeze([
  'StaleQueue',
  'NotRatified',
  'AttestationMissing',
] as const);

/**
 * What each rejection reason means and where it comes from (doc 05 §1.3).
 *
 * `severity` encodes the design mandate that rejection is the system working, not
 * failing. Only three variants describe a live hazard the protocol is braking
 * against: the two gate vetoes (the market says the change endangers survival or
 * security) and `ProcessHold` (a VOID, a stale epoch, or an active ledger freeze).
 * Everything else — including a hurdle the market simply did not clear, and
 * including the screening-time faults — is a routine outcome of the procedure and
 * refunds the bond. Marking those 'safety' would teach exactly the wrong lesson.
 *
 * `PayloadReverted` is the odd one: it never labels a `Rejected` state at all. It
 * is carried in the T18 `ExecutionFailed` event and copied into the DecisionRecord
 * when T22 fires.
 */
export const REJECT_REASON_META: Readonly<
  Record<
    RejectReason,
    {
      readonly blurb: string;
      readonly producedBy: string;
      readonly cite: Citation;
      readonly severity: 'routine' | 'safety';
    }
  >
> = Object.freeze({
  NotDecisionGrade: {
    blurb: 'The books never became informative enough to decide on — too thin, too stale, or invalid at the boundary.',
    producedBy: 'decide() step 3 (gate books invalid) or step 5 (welfare books invalid, second insufficiency) → T10',
    cite: cite('05', '§1.3', 'producer map'),
    severity: 'routine',
  },
  GateVetoSurvival: {
    blurb: 'The Survival gate books priced the change as raising the risk of the chain not surviving past the threshold.',
    producedBy: 'decide() step 4 → T10',
    cite: cite('05', '§5.1', 'gate-veto tests'),
    severity: 'safety',
  },
  GateVetoSecurity: {
    blurb: 'The Security gate books priced the change as raising security risk past the threshold.',
    producedBy: 'decide() step 4 → T10',
    cite: cite('05', '§5.1', 'gate-veto tests'),
    severity: 'safety',
  },
  HurdleNotMet: {
    blurb: 'The ACCEPT book converged, but not far enough above REJECT to clear the class hurdle δ.',
    producedBy: 'decide() steps 6–7 (converged, hurdle failed) → T10',
    cite: cite('05', '§5.4', 'ordered checks'),
    severity: 'routine',
  },
  ConvergenceFailed: {
    blurb: 'The price never settled: the decision window closed with the book still moving too much to read.',
    producedBy: 'decide() step 8 → T10',
    cite: cite('05', '§5.4', 'ordered checks'),
    severity: 'routine',
  },
  SecondExtensionFailed: {
    blurb: 'The full-window and trailing-window readings disagreed again after the one extension had already been spent.',
    producedBy: 'decide() steps 6–8 with p.extended already set → T10',
    cite: cite('05', '§5.4', 'ordered checks'),
    severity: 'routine',
  },
  ProcessHold: {
    blurb: 'Something outside the market halted the process — a VOID condition, a stale epoch, or an active ledger freeze.',
    producedBy:
      'decide() step 2, and the tick/decide force-reject under VOID, stale-epoch or an active PB-LEDGER-FREEZE → T10 and T20 (one producing rule; the disposition is identical whichever path observes it first, SQ-98)',
    cite: cite('05', '§1.3', 'producer map; T20'),
    severity: 'safety',
  },
  ConstitutionViolation: {
    blurb: 'The committed preimage no longer matches what the constitution admits for this class.',
    producedBy: 'decide() step 1 (preimage mismatch at decide time) → T10',
    cite: cite('05', '§1.3', 'producer map'),
    severity: 'routine',
  },
  ResourceConflict: {
    blurb: 'The resource locks the proposal qualified with were lost before it could decide.',
    producedBy: 'decide() step 1 (locks lost) → T10',
    cite: cite('05', '§1.4', 'resource domains'),
    severity: 'routine',
  },
  RateLimited: {
    blurb: 'A constitutional meter or minimum spacing between changes of this kind was already exhausted.',
    producedBy: 'decide() step 10 (constitutional meters and spacing) → T10',
    cite: cite('05', '§1.3', 'producer map'),
    severity: 'routine',
  },
  VetoUpheldByReview: {
    blurb: 'The retrospective review of a guardian delay concluded that the veto was right, so the mandate dies there.',
    producedBy: 'the guardian review flow enacting guardian.uphold_veto(action_id) → T24',
    cite: cite('06', '§5.4', 'the single producing site'),
    severity: 'routine',
  },
  StaleQueue: {
    blurb: 'The queued mandate outlived the runtime it was validated against, or lost meter contention past grace.',
    producedBy: 'the execution guard: version-constraint mismatch, or meter contention past grace → T16',
    cite: cite('05', '§1.3', 'producer map'),
    severity: 'routine',
  },
  PayloadReverted: {
    blurb: 'The payload itself failed when dispatched and was reverted atomically; it never names a Rejected state.',
    producedBy:
      'execution-failure recording: carried in ExecutionFailed { reason } at T18 and copied into the DecisionRecord when T22 fires',
    cite: cite('05', '§1.3', 'producer map; T18/T22'),
    severity: 'routine',
  },
  NotRatified: {
    blurb:
      'A CODE or META mandate reached the end of its grace window with no passed referendum; an earlier attempt would merely have errored and left it Queued.',
    producedBy: 'the execution guard / epoch tick at grace end → T16',
    cite: cite('05', '§1.3', 'producer map; SQ-163'),
    severity: 'routine',
  },
  SecuritySizing: {
    blurb: 'The prize at stake outgrew the measured depth defending it: InCapPrize > AttackCost̂ / 3.',
    producedBy: 'decide() step 9 → T10',
    cite: cite('05', '§5.6', 'security sizing, D-4'),
    severity: 'routine',
  },
  AttestationMissing: {
    blurb:
      'The attestor record backing a CODE or META payload is absent, below quorum, or was revoked after the mandate was queued.',
    producedBy:
      'TWO sites by design — the only variant with more than one: decide() step 10 at decide time (T10), and the execution guard re-checking at dispatch when the queue-time AttestationRecord was revoked or a late challenge resolved against it (T16)',
    cite: cite('05', '§1.3', 'the deliberate two-site exception, SQ-3'),
    severity: 'routine',
  },
  RolloverExhausted: {
    blurb: 'It lost a qualification slot twice; the single rollover allowance is per proposal, so the second loss cancels it.',
    producedBy: 'the epoch tick, on the second T6 deferral of the same proposal → T26 (a cancellation, with a full refund)',
    cite: cite('05', '§1.3', 'producer map; SQ-166'),
    severity: 'routine',
  },
});
