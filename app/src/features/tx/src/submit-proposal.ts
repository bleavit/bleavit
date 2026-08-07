/**
 * S5's precondition rows — 11 §11.5 P-10 (`epoch.submit`) and P-11 (`epoch.withdraw`).
 *
 * Both rows are short in the table and neither is simple, because each turns on an
 * **identity** question that a plain implementation answers with the wrong account.
 *
 * ## 1. The intake rate limit and the bond are the *funder's*, never the caller's
 *
 * > the **funder's** intake entries this epoch < `intake.max_per_account` … keyed to the
 * > **funder**, not the caller or the author, because that is the identity the runtime
 * > counts and the only one that bears the bond
 *
 * A proposal may be authored by one account and funded by another (02 §4's
 * `ProposalSummaryView.funder`, contract v18), so "count this account's entries" has three
 * plausible answers and only one of them is the runtime's. Getting it wrong fails in the
 * unsafe direction: a funder at their limit passes every client row against a fresh
 * author's count and the runtime then refuses after the user has signed.
 *
 * Nothing about a `Finalized<bigint>` says whose count it is, so the reads are **branded**
 * with the account they were taken for — `funderReads(who, …)` is the only producer — and
 * `checkSubmit` re-checks that account against the declared funder. That is the same
 * control `funding-reads.ts` applies to a chain: a value carries its subject, and the row
 * refuses when the subject is not the one the rule names.
 *
 * ## 1a. Every leaf is `Finalized<T>`, and the rows are read at one B′
 *
 * 11 §11.4 rule 4 is one sentence — *"provider/local-index data never satisfies any
 * precondition"* — and a `Verified<T>` parameter makes it a review obligation repeated at
 * every call site, because a `provider` read is a perfectly well-formed `Verified<T>`. A
 * submission assembled from an operator snapshot would return an empty block list, which
 * `maySubmit` reads as *every precondition passed*. `Finalized<T>` is constructible only
 * inside `@bleavit/chain-client` (10 §2.1), so here the wrong input does not typecheck —
 * the same control `transaction-builder`'s `evaluate` and the S3 ticket already use.
 *
 * The type carries the block but **cannot compare two of them**, so one pin across every
 * leaf is its own row. §11.4 pins a single B′ per gate: an epoch phase read at one block
 * beside an intake queue read at the next are each true, and their conjunction describes a
 * state that never existed — which nothing on screen distinguishes from one that did.
 *
 * **And the count itself is not readable through any frozen surface today** — see
 * {@link UNREADABLE_SUBMIT_CONDITIONS}, which is a finding about the contract rather than
 * about this module. The client neither passes it silently nor blocks on it; it says so.
 *
 * ## 2. Withdraw is admitted to **either** identity
 *
 * > caller is the proposer **or the funder** … A row written to the narrower reading
 * > refuses a lawful withdrawal, which is a client refusing what the runtime accepts.
 *
 * So this is the one row here whose failure direction is *over*-strictness, and it is
 * tested from both sides rather than only from the refusal.
 *
 * ## 3. The slash warning is required copy, not advice
 *
 * P-10 ends with a **warning surfaced** obligation and the note that *"the old 'full
 * refund' copy is removed"*. It is frozen copy in this module, always returned rather than
 * returned on the blocked path — a warning a user sees only when something else is already
 * wrong is a warning that never reaches the person it is for.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.5 rows P-10, P-11
 * @see docs/architecture/05-welfare-and-decision-engine.md §1.4, §1.5
 * @see docs/architecture/06-governance-and-guardians.md §4
 */

import type { Finalized } from '@bleavit/chain-client';

/** A reason S5 cannot be signed. Rendered with what it read (INV-FE-14). */
export interface SubmitBlock {
  /** The §11.5 clause this comes from, for the expected/actual display. */
  readonly check: string;
  readonly detail: string;
}

/**
 * The two slashes P-10 requires surfaced, and the copy that replaced "full refund".
 *
 * Frozen rather than inline so a screen cannot paraphrase one into something softer, and
 * so a test can assert the prohibited phrase is absent from the whole module.
 */
export const SUBMIT_SLASH_WARNING: Readonly<Record<'preimageMissing' | 'nonDecisionGrade', string>> =
  Object.freeze({
    preimageMissing:
      'If the preimage is not noted and pinned when this proposal is screened, it is ' +
      'cancelled and 10% of the bond is slashed. The rest is returned.',
    nonDecisionGrade:
      'If the markets do not reach a decision-grade outcome, 10% of the bond is slashed to ' +
      'the INSURANCE account. A submitted proposal is not a deposit that always comes back.',
  });

/** Which account a withdrawal may come from — P-11 admits both, and neither alone. */
export const WITHDRAW_IDENTITIES: readonly ['proposer', 'funder'] = Object.freeze([
  'proposer',
  'funder',
]);

/**
 * The reads P-10 keys to the funder, carrying the account they were taken for.
 *
 * A module-private `unique symbol` in the type, the `Finalized<T>` construction (10 §2.1)
 * and for its reason: a structural `{ account, entriesThisEpoch, freeBalance }` is
 * satisfiable by the object literal a call site would otherwise assemble from whatever
 * account it happened to have.
 */
declare const funderBrand: unique symbol;

export interface FunderReads {
  /** The account these were read for. Compared against the declared funder. */
  readonly account: string;
  /**
   * The funder's intake entries **this epoch** (06 §4 rule 4), or `undefined`.
   *
   * `undefined` is the ordinary case today and not a caller's oversight — see
   * {@link UNREADABLE_SUBMIT_CONDITIONS}. It is nullable rather than optional so a caller
   * has to state which of the two it means.
   */
  readonly entriesThisEpoch: Finalized<number> | undefined;
  /** The funder's spendable balance, against which the class bond is checked. */
  readonly freeBalance: Finalized<bigint>;
  readonly [funderBrand]: true;
}

export function funderReads(
  account: string,
  reads: {
    readonly entriesThisEpoch: Finalized<number> | undefined;
    readonly freeBalance: Finalized<bigint>;
  },
): FunderReads {
  return { account, ...reads } as FunderReads;
}

/**
 * A P-10 condition this client cannot read, with the dispatch error it surfaces as.
 *
 * The same shape `reporter.ts` uses for SQ-564's two unreadable registration conditions,
 * and for the same reason: a client that silently omits a precondition presents an
 * incomplete check as a complete one, and a client that *blocks* on it refuses a lawful
 * submission on its own authority. Neither is acceptable, so it is stated.
 */
export interface UnreadableCondition {
  readonly condition: string;
  readonly dispatchError: string;
  readonly why: string;
}

/**
 * The per-funder intake rate limit, which no frozen surface publishes.
 *
 * 11 §11.5 P-10 requires *"the **funder's** intake entries this epoch <
 * `intake.max_per_account`"*, and the identity is normative — 05 §1.5 E6 keys it to the
 * funder because that is who bears the bond. But the entries themselves are not readable:
 *
 * - `Epoch.IntakeQueue` is frozen (02 §7.1) and holds **`ProposalId`s only**. 05 §7(6)
 *   says so in as many words — *"it contains only Submitted IDs and is therefore
 *   insufficient for this proof by itself"*.
 * - `IntakeProposals`, the map that does carry the records, is internal and appears in no
 *   §7 table (00's decision record and 13 §4 both describe it as the internal map).
 * - `proposal_summaries()` carries `funder`, and it is not the same population: the
 *   runtime iterates `pallet_epoch::Proposals`, the **post-qualification** working set,
 *   so an intake-stage entry is not in its result at all.
 *
 * This is the shape SQ-580 and SQ-588 each repaired from a different direction — a
 * §11.5 clause with no chain surface to cite. Until one exists, the client says so.
 */
export const UNREADABLE_SUBMIT_CONDITIONS: readonly UnreadableCondition[] = Object.freeze([
  {
    condition:
      'the funder already has intake.max_per_account entries in this epoch’s intake queue',
    dispatchError: 'IntakeRateLimited',
    why:
      'The frozen Epoch.IntakeQueue holds proposal ids and no funder, the IntakeProposals ' +
      'map that carries the records is not integration-contract surface, and ' +
      'proposal_summaries() covers the post-qualification working set rather than the ' +
      'intake queue — so no frozen read answers "how many entries does this funder have".',
  },
]);

/**
 * Reads supplied for one account while the rule names another.
 *
 * Its own error rather than a block row: a block is something a user can act on, and this
 * is a composition defect in the client. Rendering it as an ordinary refusal would tell
 * the user their bond is short when what actually happened is that the client checked
 * somebody else's.
 */
export class WrongSubjectError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `the intake reads were taken for ${actual} while the funder is ${expected}. 11 §11.5 ` +
        'P-10 keys the rate limit and the bond to the funder, because that is the identity ' +
        'the runtime counts and the only one that bears the bond (05 §1.5 E6) — checking ' +
        'another account passes a submission the runtime refuses.',
    );
    this.name = 'WrongSubjectError';
  }
}

/** The preimage half of P-10: noted, pinned, and matching what the proposal commits to. */
export interface PreimageState {
  /** The hash the proposal commits to, as the form holds it. */
  readonly declaredHash: string;
  readonly declaredLen: number;
  /**
   * The hash of the bytes the client actually holds, and their length.
   *
   * Present so the row can compare rather than trust: §11.5's `execute` row 3 makes the
   * client re-hash and compare at dispatch time, and a proposal whose committed hash never
   * described its own payload is one that cannot execute however far it gets.
   */
  readonly bytesHash: string;
  readonly bytesLen: number;
  /** `Preimage.PreimageFor((hash, len))` holds the bytes (02 §7.6). */
  readonly noted: Finalized<boolean>;
  /** `Preimage.StatusFor(hash)` is requested — pinned by `preimage.request_preimage`. */
  readonly requested: Finalized<boolean>;
}

export interface SubmitInputs {
  /**
   * `Epoch.EpochOf.phase` — P-10 admits `Intake` and nothing else.
   *
   * Nullable, and required rather than optional: `undefined` is *this client did not read
   * it*, which blocks. An unread precondition is not a passed one, and a field a caller
   * could simply omit would make the unread case indistinguishable from a passed one.
   */
  readonly phase: Finalized<string> | undefined;
  /** `Epoch.IntakeQueue`'s current length. Nullable for {@link SubmitInputs.phase}'s reason. */
  readonly intakeQueueLen: Finalized<number> | undefined;
  /** `Epoch::MaxIntakeQueue`, from the constants API — never a literal (02 §9). */
  readonly maxIntakeQueue: Finalized<number>;
  /** `params(intake.max_per_account)`, live (02 §9). */
  readonly maxPerAccount: Finalized<number>;
  /** The account that bears the bond. Every keyed read below is checked against it. */
  readonly funder: string;
  readonly funderReads: FunderReads;
  /**
   * The class bond for this proposal's class, already including the TREASURY Ask surcharge
   * where it applies.
   *
   * One value rather than base + surcharge, because the surcharge is a function of the ask
   * (`Epoch::TreasuryBondAskBps`, 02 §9) and a screen recomputing it would be a second
   * implementation of an arithmetic the runtime owns.
   */
  readonly classBond: Finalized<bigint>;
  readonly preimage: PreimageState;
  /**
   * Whether the declared `resources` set equals `footprint(payload)` (05 §1.4).
   *
   * `undefined` when the client could not classify the payload at all — which is **not**
   * the same as a mismatch and is why this is not a boolean. 05 §1.4 makes an
   * unclassifiable batch a T4 cancellation carrying a 100% slash, so a client that
   * reported "not checked" as "fine" would walk a user into the worst outcome in the
   * section.
   */
  readonly resourcesMatchFootprint: Finalized<boolean> | undefined;
}

/**
 * What checking a submission produced.
 *
 * `uncheckable` is **required**, exactly as `RegistrationCheck`'s is: there is no shape of
 * this type in which the unreadable conditions are absent, so no screen can render a
 * complete-looking verdict over an incomplete check.
 */
export interface SubmitCheck {
  readonly blocks: readonly SubmitBlock[];
  readonly uncheckable: readonly UnreadableCondition[];
}

/**
 * How one finalized read names the block it was taken at, for the pin comparison.
 *
 * Chain first, for `meet`'s reason: after F18 there are two light clients, and *"these two
 * reads are comparable"* is a statement about the chain rather than one that should hold
 * because two hashes did not collide.
 */
function pinOf(read: Finalized<unknown>): string {
  return `${read.status.chain} block ${read.status.blockNumber} (${read.status.blockHash})`;
}

/**
 * A pin row over labelled leaves, or nothing when they all came from one block.
 *
 * Shared by both gates in this module because both read several items and §11.4 pins one
 * B′ for each of them; a second copy would be a second chance to compare the wrong field.
 */
function pinBlock(
  check: string,
  leaves: readonly (readonly [string, Finalized<unknown> | undefined])[],
): SubmitBlock | undefined {
  const byPin = new Map<string, string[]>();
  for (const [label, read] of leaves) {
    if (read === undefined) continue;
    const pin = pinOf(read);
    byPin.set(pin, [...(byPin.get(pin) ?? []), label]);
  }
  if (byPin.size <= 1) return undefined;
  const spread = [...byPin].map(([pin, labels]) => `${labels.join(', ')} at ${pin}`).join('; ');
  return {
    check,
    detail:
      `this gate mixes blocks — ${spread}. Every precondition is read at one B′ ` +
      '(11 §11.4), and rows from two blocks describe a state that never existed',
  };
}

/**
 * Every §11.5 P-10 row that refuses this submission, in the order a screen shows them.
 *
 * All failing rows are returned rather than the first — §11.4 rule 5 asks for the diff,
 * and stopping early shows a user one obstacle per signing attempt.
 */
export function checkSubmit(inputs: SubmitInputs): SubmitCheck {
  if (inputs.funderReads.account !== inputs.funder) {
    throw new WrongSubjectError(inputs.funder, inputs.funderReads.account);
  }

  const blocks: SubmitBlock[] = [];
  const uncheckable: UnreadableCondition[] = [];

  // §11.4: one B′ per gate. Every leaf is finalized by its type, so what remains checkable
  // is whether they are the *same* finalized block.
  const mixed = pinBlock('P-10 read pin', [
    ['the epoch phase', inputs.phase],
    ['Epoch.IntakeQueue', inputs.intakeQueueLen],
    ['Epoch::MaxIntakeQueue', inputs.maxIntakeQueue],
    ['params(intake.max_per_account)', inputs.maxPerAccount],
    ['the funder’s intake entries', inputs.funderReads.entriesThisEpoch],
    ['the funder’s balance', inputs.funderReads.freeBalance],
    ['the class bond', inputs.classBond],
    ['Preimage.PreimageFor', inputs.preimage.noted],
    ['Preimage.StatusFor', inputs.preimage.requested],
    ['the resource footprint', inputs.resourcesMatchFootprint],
  ]);
  if (mixed !== undefined) blocks.push(mixed);

  if (inputs.phase === undefined) {
    blocks.push({
      check: 'P-10 epoch phase',
      detail: 'the epoch phase was not read; an unread precondition is not a passed one',
    });
  } else if (inputs.phase.value !== 'Intake') {
    blocks.push({
      check: 'P-10 epoch phase',
      detail: `the epoch is in ${inputs.phase.value}; submissions are admitted only in Intake`,
    });
  }

  if (inputs.intakeQueueLen === undefined) {
    blocks.push({
      check: 'P-10 intake queue',
      detail:
        'the intake queue was not read. A failed read is not an empty queue, and treating it ' +
        'as one is the direction that walks a user into IntakeFull',
    });
  } else if (inputs.intakeQueueLen.value >= inputs.maxIntakeQueue.value) {
    blocks.push({
      check: 'P-10 intake queue',
      detail:
        `the intake queue holds ${inputs.intakeQueueLen.value} of ${inputs.maxIntakeQueue.value} ` +
        'entries and is full for this epoch',
    });
  }

  // Keyed to the funder — see the module note. The comparison is `>=` because the entry
  // being submitted is the next one: a funder already at the limit cannot add to it.
  //
  // Unreadable is neither a pass nor a block: blocking would refuse a lawful submission on
  // the client's own authority, and passing would present an unperformed check as a
  // performed one. It becomes a stated condition instead.
  if (inputs.funderReads.entriesThisEpoch === undefined) {
    uncheckable.push(...UNREADABLE_SUBMIT_CONDITIONS);
  } else if (inputs.funderReads.entriesThisEpoch.value >= inputs.maxPerAccount.value) {
    blocks.push({
      check: 'P-10 per-funder rate limit',
      detail:
        `the funder already has ${inputs.funderReads.entriesThisEpoch.value} intake entries this ` +
        `epoch and intake.max_per_account is ${inputs.maxPerAccount.value}`,
    });
  }

  if (inputs.funderReads.freeBalance.value < inputs.classBond.value) {
    blocks.push({
      check: 'P-10 class bond',
      detail:
        `the class bond is ${inputs.classBond.value} base units and the funder holds ` +
        `${inputs.funderReads.freeBalance.value}`,
    });
  }

  // The preimage rows. `noted` and `requested` are separate reads of separate storage
  // items and P-10 requires both: bytes that are noted but never pinned can be reaped
  // before the execution window, which is the `preimage-missing` cancellation the warning
  // above is about.
  if (inputs.preimage.bytesHash !== inputs.preimage.declaredHash) {
    blocks.push({
      check: 'P-10 preimage hash',
      detail:
        `the proposal commits to ${inputs.preimage.declaredHash} and the payload this client ` +
        `holds hashes to ${inputs.preimage.bytesHash}`,
    });
  }
  if (inputs.preimage.bytesLen !== inputs.preimage.declaredLen) {
    blocks.push({
      check: 'P-10 preimage length',
      detail:
        `the proposal commits to ${inputs.preimage.declaredLen} bytes and the payload this ` +
        `client holds is ${inputs.preimage.bytesLen}`,
    });
  }
  if (!inputs.preimage.noted.value) {
    blocks.push({
      check: 'P-10 preimage noted',
      detail: 'the committed preimage is not present on chain; note it before submitting',
    });
  }
  if (!inputs.preimage.requested.value) {
    blocks.push({
      check: 'P-10 preimage pinned',
      detail:
        'the preimage is not pinned by preimage.request_preimage, so it can be reaped before ' +
        'the execution window opens',
    });
  }

  // Unclassifiable and mismatched are different findings and get different copy, because
  // one is a client limitation and the other is a 100%-slash defect in the proposal.
  if (inputs.resourcesMatchFootprint === undefined) {
    blocks.push({
      check: 'P-10 resource domains',
      detail:
        'this client could not derive the payload’s resource footprint, so it cannot check ' +
        'the declaration. An unclassifiable batch is cancelled with the whole bond slashed ' +
        '(05 §1.4), and an unperformed check is not a passed one',
    });
  } else if (!inputs.resourcesMatchFootprint.value) {
    blocks.push({
      check: 'P-10 resource domains',
      detail:
        'the declared resource domains are not equal to the payload’s footprint. Both ' +
        'directions are a false declaration and carry the whole bond (05 §1.4)',
    });
  }

  return { blocks, uncheckable };
}

/**
 * Whether S5 may hand off to `refreshAndGate` (11 §11.4 rule 1).
 *
 * True with `uncheckable` non-empty, deliberately: an unreadable condition is not a
 * failed one, and refusing on it would be the client refusing what the runtime accepts.
 * What the screen owes instead is the caveat — see {@link submitCaveat}.
 */
export function maySubmit(inputs: SubmitInputs): boolean {
  return checkSubmit(inputs).blocks.length === 0;
}

/**
 * What the user is told before signing when nothing checkable blocks.
 *
 * Deliberately not "ready to sign", for `registrationCaveat`'s reason: the client has
 * checked what it can, and saying so precisely is the difference between an honest surface
 * and one that will look like it lied when the dispatch error arrives.
 */
export function submitCaveat(check: SubmitCheck): string | undefined {
  if (check.uncheckable.length === 0) return undefined;
  const conditions = check.uncheckable
    .map((entry) => `${entry.condition} (${entry.dispatchError})`)
    .join('; ');
  return (
    'Everything this client can read passes. One condition it cannot read may still refuse ' +
    `this submission on chain: ${conditions}. If it applies, the transaction fails and the ` +
    'bond is not taken — but the fee is spent.'
  );
}

export interface WithdrawProposalInputs {
  /** The proposal's state — P-11 admits `Submitted` only. */
  readonly state: Finalized<string>;
  /** True while the proposal has not reached Qualify. */
  readonly beforeQualify: Finalized<boolean>;
  readonly proposer: Finalized<string>;
  readonly funder: Finalized<string>;
  /** The account that would sign. */
  readonly caller: string;
}

/**
 * Every §11.5 P-11 row that refuses a withdrawal.
 *
 * Named `withdrawProposalBlocks` rather than `withdrawBlocks` because S13's USDC
 * withdrawal already owns that name in this package, and two functions called
 * `withdrawBlocks` differing only in which withdrawal they mean is a call site waiting to
 * pick the wrong one.
 */
export function withdrawProposalBlocks(inputs: WithdrawProposalInputs): readonly SubmitBlock[] {
  const blocks: SubmitBlock[] = [];

  const mixed = pinBlock('P-11 read pin', [
    ['the proposal state', inputs.state],
    ['the Qualify boundary', inputs.beforeQualify],
    ['the proposer', inputs.proposer],
    ['the funder', inputs.funder],
  ]);
  if (mixed !== undefined) blocks.push(mixed);

  if (inputs.state.value !== 'Submitted') {
    blocks.push({
      check: 'P-11 proposal state',
      detail: `the proposal is ${inputs.state.value}; withdrawal is admitted only from Submitted`,
    });
  }

  if (!inputs.beforeQualify.value) {
    blocks.push({
      check: 'P-11 before Qualify',
      detail: 'the proposal has reached Qualify; withdrawal closes at that boundary',
    });
  }

  // Either identity. Restricting this to the author strands the funder's bond behind an
  // abandoned proposal; restricting it to the funder lets a funder hold a disowned
  // proposal hostage. The runtime admits both, so the client must too.
  if (inputs.caller !== inputs.proposer.value && inputs.caller !== inputs.funder.value) {
    blocks.push({
      check: 'P-11 caller identity',
      detail:
        'the signing account is neither the proposer nor the funder; T2 is admitted to ' +
        'either identity and to no other',
    });
  }

  return blocks;
}

/** Whether the caller is one of the two identities P-11 admits. */
export function mayWithdrawProposal(inputs: WithdrawProposalInputs): boolean {
  return withdrawProposalBlocks(inputs).length === 0;
}
