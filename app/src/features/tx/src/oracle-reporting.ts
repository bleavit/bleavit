/**
 * `oracle.report` and `oracle.challenge` — 11 §11.8.1's second row, preconditions P-13/P-14.
 *
 * ## Every bond here is **read**, and this module contains no bond arithmetic
 *
 * P-14 says the escalation bond *"doubles per round"*, and that sentence is an invitation to
 * write `B_1 << (round - 1)` in a client. It would be wrong for the same reason SQ-552's
 * lead-time recomputation was wrong. 07 §6.1 freezes `B_1` and `R_max` **per game**, at the
 * block round 1 is created:
 *
 * > Every subsequent escalation derives `B_r` from the stored `B_1` … no escalation re-reads
 * > `orc.bond_floor`, `orc.bond_bps` or `orc.rounds`. A META amendment to any of those three
 * > therefore prices only games opened after it takes effect.
 *
 * So a client that recomputed would price the round off *today's* parameters while the chain
 * prices it off the ones frozen when the game opened — and after any lawful amendment the two
 * disagree. The user is then shown a bond that is not the bond, and either signs a call the
 * chain refuses for insufficient balance or is refused one it would have accepted.
 *
 * 02 §4's `OracleRoundView` carries `bond` — *this* round's amount, as the chain holds it —
 * so the correct client behaviour is to read it. There is therefore **no doubling, no
 * `orc.bond_bps` multiplication and no window arithmetic anywhere in this module**, and a
 * test asserts their absence, exactly as `upgrade-crank.ts` does for `DescriptorLeadTime`.
 * `challenge_deadline` is likewise the stored deadline, already carrying any extension the
 * chain applied — recomputing it from `orc.window` would be the same defect one field over.
 *
 * ## The round-1 report bond is **not** computable from any frozen surface (SQ-598)
 *
 * P-13 asks for the bond to be *"recomputed and displayed"*, and for a fresh report there is
 * no round yet to read it from. The formula needs `StakeAtRisk(c, m)` — the sum of
 * `CohortEscrow(k)` over *every* cohort whose frozen MetricSpec consumes component `c` for
 * measurement epoch `m` (07 §6.1). 02 freezes no surface carrying it: `open_oracle_rounds()`
 * returns only rounds that already exist, `RoundState.stake_at_risk` is explicitly not what
 * the FE reads, and reassembling the sum from cohort membership and per-vault escrow would be
 * a client *computation* where 11 §11.4 rule 2 requires an exact chain read — the same
 * distinction 02 §4 draws when it explains why `is_reserved_protocol_destination` is a method
 * rather than published constants.
 *
 * The honest shape is the one this console already uses for SQ-564: state the bound that
 * *can* be read and refuse to present it as the amount. `reportBondFloor` returns a value
 * **labelled a lower bound**, and `REPORT_BOND_NOT_ESTABLISHED` says plainly that the
 * value-scaled part is unknown to this client. There is deliberately no `exact` arm: an arm
 * no code path can construct is `FE-HANDOFF-010`'s shape, and its presence would suggest a
 * capability that does not exist.
 *
 * **And the path is closed, not merely captioned (2026-08-06).** Blocking only on failing to
 * cover the floor is a true statement about a number that is not the bond: for any component
 * with stake at risk the chain holds strictly more, so an account passing that check is
 * either short at dispatch or has a larger sum taken than the screen showed — on a slashable
 * action, from a figure the user was shown and can reasonably read as the price. §11.5's
 * redemption-fee rule 5 governs the case directly (*"Unreadable ⇒ no figure, never a default …
 * the transaction blocked"*, and the FE MUST NOT mirror the runtime's fail-open read), so
 * P-13's obligation is `blocking` and `reportBlocks` emits it. SQ-598 must publish
 * `StakeAtRisk` before this opens; SQ-620 records that §11.5's own text still says
 * *"recomputed and displayed"* and needs amending to whatever that surface turns out to be.
 *
 * ## That conclusion is now the table's, not this module's
 *
 * Until this review the two disagreed **in one shipped client**. `rows.ts`'s P-13 declared
 * the bond recomputed from a cohort escrow and a headroom clause against the recomputed
 * amount; this module declared the same bond structurally uncomputable and blocked only on
 * `orc.bond_floor`. Nothing bound them, so a bonded and slashable action carried two
 * different answers to *"what will this hold?"*. Worse, the table's escrow clause cited
 * `storage.epoch.cohorts` — `CohortInfo { epoch, proposals, status }` holds no escrow, so
 * the clause read a map that cannot answer it.
 *
 * The repair is one direction of dependency rather than a corrected copy: P-13's clause list
 * is `reportBlocks`' **work list**. Every clause must have a predicate here and a clause with
 * none throws, so a clause added to the table cannot be silently unimplemented — the failure
 * mode where a check is absent and the screen still reports that everything passes.
 *
 * ## A reporter may not challenge their own round
 *
 * 07 §5.2 grants `challenge` to *"anyone **other than the round's own reporter**"* — §5.5
 * disposes of a round in favour of "the honest counterparty" and no party can lose to itself.
 * §11.5's P-14 row does not list it, but `OracleRoundView` carries `reporter`, so it is an
 * exact chain read and 11 §11.4's discipline is to refuse what the chain will refuse. Left
 * out, it costs a fee and returns an error the user cannot map to anything they did.
 */

import type { Verified } from '@bleavit/shared-types';
import { accountKey } from '@bleavit/chain-client';
import {
  blockingObligationsFor,
  clauseGroupsFor,
  unreadableObligationsFor,
  type FeeAsset,
  type PreconditionClause,
} from '@bleavit/transaction-builder';

/**
 * 02 §4's `OracleRoundView`, as the client holds it.
 *
 * `bond` is this round's amount **as the chain holds it** — never derived here. `escalated`
 * is `round > 1` and, per 02 §4, MUST NOT be read as "currently challenged".
 */
export interface OracleRound {
  readonly component: Verified<number>;
  readonly epoch: Verified<number>;
  readonly specVersion: Verified<number>;
  readonly round: Verified<number>;
  readonly reporter: Verified<string>;
  readonly value1e9: Verified<bigint>;
  readonly evidenceHash: Verified<string>;
  /** The round's bond. Read — see the module note; no doubling happens in this client. */
  readonly bond: Verified<bigint>;
  /** Stored deadline, already carrying any extension. Read, never recomputed from `orc.window`. */
  readonly challengeDeadline: Verified<number>;
  readonly ackedByWatchtowers: Verified<number>;
  readonly escalated: Verified<boolean>;
}

/**
 * A lower bound on the round-1 report bond, and it says so.
 *
 * Not an estimate and not a default: `floor` is `orc.bond_floor`, read through `params()`,
 * and the value-scaled term above it is unreadable (see the module note). Carrying it as its
 * own type keeps a screen from rendering it in the place an exact amount would go.
 */
export interface ReportBondFloor {
  readonly floor: Verified<bigint>;
  /** Why this is a bound rather than the amount. Fixed copy — the reason is structural. */
  readonly why: string;
}

export const REPORT_BOND_NOT_ESTABLISHED =
  'This client cannot state the bond your report will hold, so it will not ask you to sign ' +
  'for it. The bond is value-scaled against the escrow of every cohort measuring this ' +
  'component (07 §6), and no surface the integration contract freezes publishes that figure. ' +
  'The amount shown is the floor — the least the bond can be — and for a cohort with escrow ' +
  'the chain holds more. Reporting from this release would mean committing an amount nobody ' +
  'could show you first.';

export function reportBondFloor(floor: Verified<bigint>): ReportBondFloor {
  return { floor, why: REPORT_BOND_NOT_ESTABLISHED };
}

export interface ReportInputs {
  /**
   * Whether the round itself is still open — **read**, never derived from the epoch clock.
   *
   * Distinct from `reportWindowOpen` because the two come apart on a live round: a round
   * can be open with its report window elapsed, which refuses the report, and a single
   * collapsed flag cannot say which half failed. §11.5 writes them as two clauses.
   */
  readonly roundOpen: Verified<boolean>;
  /**
   * Whether the 07 §5.1 report window is still open, **read** rather than derived from the
   * epoch clock. No deadline arithmetic lives in this module.
   */
  readonly reportWindowOpen: Verified<boolean>;
  /** From the frozen `Oracle.Reporters` map (02 §7.2). */
  readonly registered: Verified<boolean>;
  /** The stake currently held for this reporter, against `orc.reporter_stake`. Both read. */
  readonly stakeHeld: Verified<bigint>;
  readonly reporterStake: Verified<bigint>;
  readonly freeUsdc: Verified<bigint>;
  readonly bondFloor: ReportBondFloor;
  /**
   * The fee asset the user selected. **No default** — `rowsFor` refuses one, because a
   * default is a decision about somebody else's balance made silently.
   */
  readonly feeAsset: FeeAsset;
  /** The evidence hash the reporter supplies. Absent is a refusal, not a default. */
  readonly evidenceHash: string | undefined;
}

export interface ReportBlock {
  readonly check: string;
  readonly detail: string;
}

/**
 * What this client can establish before `oracle.report`, and what it cannot.
 *
 * `bondUnknown` is a **required** field for the reason `RegistrationCheck.uncheckable` is:
 * there is no shape of this result in which the unreadable part is absent, so no screen can
 * present the check as complete.
 */
export interface ReportCheck {
  readonly blocks: readonly ReportBlock[];
  readonly bondUnknown: string;
}

/** A clause of P-13 with no predicate here — a table entry nobody implemented. */
export class UnimplementedClauseError extends Error {
  constructor(clause: PreconditionClause) {
    super(
      `P-13 declares "${clause.requirement}" (key ${String(clause.key)}) and this module has ` +
        'no predicate for it. Refusing to evaluate the row: a clause silently skipped is a ' +
        'check that reports "everything passes" while never having run.',
    );
    this.name = 'UnimplementedClauseError';
  }
}

/**
 * One predicate per P-13 clause key, and the copy shown when it fails.
 *
 * Keyed on the table's own `key` field rather than on requirement prose: the prose is the
 * user's sentence and is meant to be editable, while the key is the binding.
 */
interface P13Check {
  readonly check: string;
  readonly holds: (inputs: ReportInputs) => boolean;
  readonly detail: string;
}

const P13_CHECKS: Readonly<Record<string, P13Check>> = Object.freeze({
  'round-open': {
    check: 'Round open',
    holds: (inputs) => inputs.roundOpen.value,
    detail:
      'This round is no longer open, so nothing can be reported into it. A counter-report ' +
      'needs a live round; this one has been closed or settled.',
  },
  'report-window': {
    check: 'Report window',
    holds: (inputs) => inputs.reportWindowOpen.value,
    detail:
      'The reporting window for this measurement epoch has closed. A report now is refused ' +
      'on chain, and the component settles neutral for this epoch. The round itself may ' +
      'still be open — that is a different condition, checked separately.',
  },
  registered: {
    check: 'Reporter registry',
    holds: (inputs) => inputs.registered.value,
    detail: 'This account is not a registered reporter, so it cannot report.',
  },
  'stake-held': {
    // Registered but under-staked — a distinct state from unregistered, and a distinct
    // remedy. A prior slash leaves the registration standing and the hold short.
    check: 'Reporter stake',
    holds: (inputs) => !inputs.registered.value || inputs.stakeHeld.value >= inputs.reporterStake.value,
    detail:
      'Your reporter stake is no longer held in full — a previous slash left it short. ' +
      'Reporting requires the whole stake held, so it must be topped up first.',
  },
  'bond-floor': {
    // The floor is a `params()` read. Unreadable means no figure at all, never a default:
    // a zero floor would let the headroom clause below pass for an empty account.
    check: 'Round-bond floor',
    holds: (inputs) => inputs.bondFloor.floor.value >= 0n,
    detail:
      'The round-bond floor could not be read from chain parameters, so this client cannot ' +
      'state even the least the bond can be.',
  },
  'bond-headroom': {
    check: 'Round bond',
    holds: (inputs) => inputs.freeUsdc.value >= inputs.bondFloor.floor.value,
    detail: 'Your free USDC does not cover even the floor of the round bond.',
  },
  evidence: {
    check: 'Evidence',
    holds: (inputs) => inputs.evidenceHash !== undefined && inputs.evidenceHash.length > 0,
    detail:
      'A report needs an evidence hash — content-addressed raw data and the recomputation ' +
      'instructions the frozen MetricSpec requires. Evidence nobody can fetch is treated as ' +
      'absent, which loses the round on its own.',
  },
});

/**
 * Evaluate P-13 **from its own clause list**.
 *
 * The list is the work list. A group is satisfied when any member holds (`anyOf`), which is
 * `clauseGroupsFor`'s contract; a clause with no predicate throws rather than being skipped.
 *
 * `bondUnknown` remains a **required** field for the reason `RegistrationCheck.uncheckable`
 * is: there is no shape of this result in which the unreadable part is absent, so no screen
 * can present the check as complete. Its text is now taken from the table's own SQ-598
 * obligation, so the module and the row cannot drift again.
 */
/**
 * The predicate for one P-13 clause, or the refusal.
 *
 * Exported so the binding is testable in **both** directions with a synthetic clause: a
 * clause with no predicate must throw, and a predicate with no clause is dead code. A guard
 * proven only by the table currently agreeing with the map is a guard nothing exercises,
 * which is the shape of every check this client has found to be silently absent.
 */
export function p13Predicate(clause: PreconditionClause): P13Check {
  const key = clause.key;
  const found = key === undefined ? undefined : P13_CHECKS[key];
  if (found === undefined) throw new UnimplementedClauseError(clause);
  return found;
}

/** Every clause key this module implements — the other half of the binding. */
export const P13_CHECK_KEYS: readonly string[] = Object.freeze(Object.keys(P13_CHECKS));

export function reportBlocks(inputs: ReportInputs): ReportCheck {
  const blocks: ReportBlock[] = [];
  // **The unreadable bond is a block, not a caveat (2026-08-06).** It shipped as `stated`,
  // which left the control open on a floor-only check — and the floor is not the amount for
  // any component with stake at risk, so an account that passed here either goes short at
  // dispatch or has more taken than the screen showed. §11.5's redemption-fee rule 5 already
  // rules this case for a monetary figure: unreadable means no figure and the transaction
  // blocked, and the frontend MUST NOT mirror the runtime's own fail-open read. The blocks
  // are taken from the table's own declarations so the module cannot disagree with it again.
  for (const entry of blockingObligationsFor('P-13')) {
    // A distinct check name from the `bond-headroom` clause's, which is also about the bond
    // and is a different statement: *we cannot tell you the amount* against *your balance
    // does not cover the least it can be*. Two remedies, so two sentences.
    blocks.push({
      check: 'Bond amount',
      detail: `${inputs.bondFloor.why} (${entry.specQuestion})`,
    });
  }
  for (const group of clauseGroupsFor('P-13', inputs.feeAsset)) {
    const checks = group.map(p13Predicate);
    if (checks.some((entry) => entry.holds(inputs))) continue;
    // One block per failing group, named for its first member — a disjunctive group has one
    // obligation and one reason, not one per alternative.
    const first = checks[0];
    if (first !== undefined) blocks.push({ check: first.check, detail: first.detail });
  }
  // The caveat is the module's own user-facing sentence, **bound** to the table rather than
  // duplicating it: P-13 must declare the gap, and if it stops declaring one this throws
  // rather than quietly presenting a floor as a complete answer. Concatenating the table's
  // developer-facing reason onto the user's sentence said the same thing twice; citing the
  // id keeps the binding and gives the caveat its own expiry pointer.
  const obligations = unreadableObligationsFor('P-13');
  if (obligations.length === 0) {
    throw new Error(
      'P-13 declares no unreadable obligation, so this module’s bond caveat has nothing ' +
        'behind it. Either the bond became computable — in which case this caveat must go — ' +
        'or the declaration was dropped and the screen would present a floor as the amount.',
    );
  }
  const cited = obligations.map((entry) => entry.specQuestion).join(', ');
  return { blocks, bondUnknown: `${inputs.bondFloor.why} (${cited})` };
}

/**
 * Are these two addresses the same account? Decided on the **public key**, never the string.
 *
 * SS58 is a *rendering*, not an identity: the same 32-byte key encodes differently under every
 * network prefix, and this chain's is 7777 (02 §8) while a wallet that exported the key elsewhere will
 * very often hand back the generic 42. A `===` between two renderings therefore answers *false*
 * for one account addressed two ways — which here would clear 07 §5.2's self-challenge refusal
 * and invite a transaction the runtime rejects with `SelfChallenge`. It is V-164's defect in the
 * other direction (there a watched set never matched and history looked empty; here two accounts
 * that *are* the same look different), and the repository already answers it: `accountKey` in
 * `@bleavit/chain-client` is *"the one place the conversion happens"*, exported precisely so a
 * second comparison is not written separately.
 *
 * `undecidable` is a real arm rather than a thrown error, because this comparison gates a
 * **refusal**. An address neither side can parse must not read as *"not the reporter"* — the
 * fail-open answer — so the caller blocks on it and says so.
 */
function sameAccount(a: string, b: string): 'same' | 'different' | 'undecidable' {
  try {
    return accountKey(a) === accountKey(b) ? 'same' : 'different';
  } catch {
    return 'undecidable';
  }
}

export interface ChallengeInputs {
  readonly round: OracleRound;
  /**
   * The account that would sign, as an SS58 address. Compared against the round's reporter by
   * **public key** (07 §5.2) — see `sameAccount`; the prefix the two are rendered under is not
   * part of the identity and must not decide the refusal.
   */
  readonly caller: string;
  readonly freeUsdc: Verified<bigint>;
  /** Chain head at B′. Compared against the **stored** deadline, never a recomputed one. */
  readonly now: Verified<number>;
  readonly evidenceHash: string | undefined;
}

/**
 * Everything blocking `oracle.challenge`, all of it — P-14 plus 07 §5.2's self-challenge rule.
 *
 * The bond compared against is `round.bond`: the chain's own figure for this round. Nothing
 * here doubles anything.
 */
export function challengeBlocks(inputs: ChallengeInputs): readonly ReportBlock[] {
  const blocks: ReportBlock[] = [];
  // `>=`, because 07 §5.2's window is **half-open**: `oracle_core::Oracle::challenge` enforces
  // `now < r.challenge_deadline`, and `pallets/oracle/src/tests.rs`'s
  // `challenge_window_is_half_open_at_the_deadline` pins the deadline block itself as
  // `WindowClosed` — the close crank treats that block as mature, so a challenge can never
  // race the close. A `>` here left the last block of the window enabled on screen and
  // invited a transaction guaranteed to revert, which is 11 §11.4's discipline inverted: the
  // client must refuse what the chain will refuse, and a boundary is where that is decided.
  if (inputs.now.value >= inputs.round.challengeDeadline.value) {
    blocks.push({
      check: 'Challenge window',
      detail:
        'The challenge window for this round has closed. This is the deadline the chain ' +
        'stores, so it already includes any extension that was granted — and the deadline ' +
        'block itself is closed, not the last open one.',
    });
  }
  switch (sameAccount(inputs.caller, inputs.round.reporter.value)) {
    case 'same':
      blocks.push({
        check: 'Own round',
        detail:
          'You are this round’s reporter, and a reporter may not challenge their own round. ' +
          'The game resolves in favour of an honest counterparty, and there is no counterparty ' +
          'when one account holds both roles — nothing about the reported value would be ' +
          'settled by it.',
      });
      break;
    case 'undecidable':
      blocks.push({
        check: 'Own round',
        detail:
          'This client cannot tell whether you are this round’s reporter: one of the two ' +
          'addresses is not a 32-byte account this chain can name. A reporter may not ' +
          'challenge their own round, so the control stays closed rather than inviting a ' +
          'transaction whose outcome depends on a comparison that could not be made.',
      });
      break;
    case 'different':
      break;
  }
  if (inputs.freeUsdc.value < inputs.round.bond.value) {
    blocks.push({
      check: 'Matching bond',
      detail:
        'Your free USDC does not cover this round’s bond. A challenge posts the same bond ' +
        'the round carries — the amount shown is the one the chain holds for it, not a ' +
        'figure this client worked out.',
    });
  }
  if (inputs.evidenceHash === undefined || inputs.evidenceHash.length === 0) {
    blocks.push({
      check: 'Evidence',
      detail:
        'A challenge needs an evidence hash for the counter-value. Unretrievable evidence is ' +
        'adjudicated as absent, so a challenge filed without it argues nothing.',
    });
  }
  return blocks;
}

/**
 * What a challenger stands to lose, stated before they post.
 *
 * §6.2's ladder is a fact about the *game*, not a computation this client performs: the copy
 * names the round's own bond (read) and says the stack can grow, without predicting by how
 * much. Predicting it would mean deriving `B_r` — the thing this module refuses to do.
 *
 * ## It takes no argument, and that is the control rather than a simplification
 *
 * The first version interpolated `round.round.value` into this sentence and `ChallengeRound`
 * rendered the result inside a `<Notice>`. That is 10 §2.1's render-edge defect in its exact
 * documented shape — the payload of a `Verified<number>` is a `number`, so the template
 * literal typechecks perfectly and puts a chain read on screen with no provenance badge, past
 * a control whose whole purpose is that no such path exists. Every other chain value on that
 * screen goes through `Count`/`Amount`/`Identifier`; this one had been unwrapped by hand.
 *
 * The repair is structural rather than a corrected call site: **fixed copy cannot leak a
 * chain value, so this function is given none to leak.** The round number is already on the
 * screen, badged, as the panel's own `subject` — restating it inside the prose was duplication
 * before it was a provenance hole. A future sentence that genuinely needs a chain value must
 * render it as a `Verified<T>` beside this copy, never inside it.
 */
export function escalationConsequence(): string {
  return (
    'A challenge posts this round’s bond and opens an escalation the reporter may answer at ' +
    'a higher one. If the round is adjudicated against you, the whole stack you have posted ' +
    'is forfeited — 40% to the counterparty and 60% to INSURANCE. The ladder is fixed when ' +
    'the game opens and this client does not predict it: what is shown above is the amount ' +
    'the chain holds for this round.'
  );
}
