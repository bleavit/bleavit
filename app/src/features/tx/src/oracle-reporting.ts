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
 * ## The round-1 report bond is **read**, and this module still computes no bond (contract v29)
 *
 * P-13 used to ask for the bond *"recomputed and displayed"*, and for a fresh report there is
 * no round yet to read it from. SQ-598 established that no client could do the recomputation:
 * the formula needs `StakeAtRisk(c, m)` — the sum of `CohortEscrow(k)` over every cohort whose
 * frozen MetricSpec consumes component `c` for measurement epoch `m` (07 §6.1) — and 02 froze
 * no surface carrying it. This module shipped that refusal, rendering `orc.bond_floor` as a
 * labelled lower bound and blocking.
 *
 * **Contract v29 publishes the amount**, so the refusal is gone rather than kept beside a
 * read: `FutarchyApi.bond_quote(OracleReport { component, epoch })` answers `B_1(c, m)` at the
 * current block, and the client displays it exactly as P-14 already displays
 * `OracleRoundView.bond`. Three properties survive from the refusal and are load-bearing.
 *
 * The floor is **not** a fallback. It is the least the bond can be and not the amount, so
 * substituting it understates what the user commits — the under-custody direction. The
 * `bond-floor` clause is deleted from P-13 rather than kept beside the quote, because two
 * answers to *"what will this hold?"* on a bonded, slashable action is the defect SQ-620 was
 * filed about and the one this branch is closing.
 *
 * The figure is a **quote**. 07 §6.1 reads the cohort escrow when round 1 is created and
 * freezes it for the lifecycle, so what is shown is priced at `BondQuoteView.read_at` and
 * fixes at submission. `ReportCheck.bondDisclosure` is a **required** field for the reason
 * `bondUnknown` was: there is no shape of this result in which the caveat is absent.
 *
 * And an unanswered quote **blocks**. `bond_quote` can return nothing — 07 §7's not-
 * determinable exposure, or a read that did not land — and `bond-quote`'s predicate fails
 * on both, so the control closes with the reason stated (§11.5's redemption-fee rule 5:
 * unreadable means no figure and the transaction blocked, never a default).
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
import { clauseGroupsFor, type FeeAsset, type PreconditionClause } from '@bleavit/transaction-builder';
import {
  bondQuoteRefusal,
  coversBond,
  BOND_QUOTE_IS_A_QUOTE,
  type BondQuoteState,
} from './bond-quote.js';

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
  /**
   * The chain's own answer for this report's bond (contract v29).
   *
   * Not a floor and not a client computation — see the module note. Its non-`quoted` arms
   * block, so there is no shape of these inputs in which an unpriced report proceeds.
   */
  readonly bondQuote: BondQuoteState;
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
 * What this client establishes before `oracle.report`, and the caveat it always states.
 *
 * `bondDisclosure` is a **required** field for the reason `RegistrationCheck.uncheckable` is:
 * there is no shape of this result in which the caveat is absent, so no screen can present
 * a quoted bond as the settled amount.
 */
export interface ReportCheck {
  readonly blocks: readonly ReportBlock[];
  /**
   * 02 §3's required disclosure that the amount is a quote priced at a block.
   *
   * **Required** for the reason `bondUnknown` was before it: there is no shape of this result
   * in which the caveat is absent, so no screen can present the bond as a settled figure.
   */
  readonly bondDisclosure: string;
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
    check: 'Round state',
    holds: (inputs) => inputs.roundOpen.value,
    // **Deliberately conservative, and it names no state (SQ-XXX, proposed 2026-08-07).**
    // The copy read *"A counter-report needs a live round; this one has been closed or
    // settled"*, which inverts the runtime: `oracle_core::report` refuses when a round for
    // `(component, epoch, spec_version)` already **exists** (`AlreadyFinal`,
    // `crates/oracle-core/src/lib.rs:767-775`) — `report` opens round 1, and a
    // counter-report is `oracle.challenge` on row P-14. 11 §11.5 writes this precondition as
    // *"round open"*, so the specification and the runtime read opposite ways and the
    // question is open. Until it is settled this says what the chain will do and does not
    // name which state caused it, because naming the wrong one sends a reporter to the wrong
    // remedy on a bonded action.
    detail:
      'The chain will not accept this report for this component and epoch in their current ' +
      'round state. This client does not name which state, because the specification and ' +
      'the runtime describe this condition in opposite directions and the disagreement is ' +
      'unresolved. Note that a counter-report is a different call — `oracle.challenge` — ' +
      'and is checked on its own row.',
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
  'bond-quote': {
    // Contract v29's read. The two non-`quoted` arms are separate refusals with separate
    // remedies, so the detail comes from `bondQuoteRefusal` rather than being one sentence
    // for both. A floor is never substituted — see the module note.
    check: 'Bond amount',
    holds: (inputs) => inputs.bondQuote.kind === 'quoted',
    detail: 'placeholder — replaced per-arm by `reportBlocks`',
  },
  'bond-headroom': {
    // `coversBond` is false whenever the bond is not quoted, so this clause cannot pass on a
    // figure that was never established. It fails alongside `bond-quote` in that case, and
    // the two sentences say different things: we cannot price it, and you cannot cover it.
    check: 'Round bond',
    holds: (inputs) => coversBond(inputs.bondQuote, inputs.freeUsdc),
    detail: 'Your free USDC does not cover the bond this report will hold.',
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
 * `bondDisclosure` remains a **required** field for the reason `RegistrationCheck.uncheckable`
 * is: 02 §3 requires a client to say the amount is priced at a block and fixes at submission,
 * and a disclosure a screen may omit is one it will.
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
  for (const group of clauseGroupsFor('P-13', inputs.feeAsset)) {
    const checks = group.map(p13Predicate);
    if (checks.some((entry) => entry.holds(inputs))) continue;
    // One block per failing group, named for its first member — a disjunctive group has one
    // obligation and one reason, not one per alternative.
    const first = checks[0];
    if (first === undefined) continue;
    // The bond clause is the one whose reason is not fixed copy: `undeterminable` and
    // `unread` are different states with different remedies, and collapsing them would
    // tell a reporter to retry a read the chain answered correctly.
    // `'oracle-report'` is written here rather than threaded through the inputs: P-13 is the
    // report row, so the arm is a property of this function and not of what it was handed.
    const refusal =
      first.check === 'Bond amount' ? bondQuoteRefusal(inputs.bondQuote, 'oracle-report') : undefined;
    blocks.push({ check: first.check, detail: refusal ?? first.detail });
  }
  return { blocks, bondDisclosure: BOND_QUOTE_IS_A_QUOTE };
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
