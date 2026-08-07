/**
 * The reporter console — 11 §11.8.1. F17's last piece, and SQ-564's shape.
 *
 * ## This console cannot claim a complete precondition check, and the type says so
 *
 * §11.8.1 opens with the gap: *"Two of this console's preconditions are not currently
 * client-readable, and that is a stated gap rather than an oversight (SQ-564)."* The 07 §3
 * retained-offense record lives in a pallet-internal store 02 §7 deliberately does not
 * freeze, so a client cannot re-read *"carries a retained ejection"* (`ReporterEjected`) or
 * *"entry closed by saturation"* (`ReporterRecordsSaturated`) at B′.
 *
 * The dangerous response is a console that checks what it can and renders a green
 * "ready to sign". A registration that the chain will refuse would then look identical to
 * one it will accept, and the user learns the difference by losing a transaction fee and
 * being told nothing about why.
 *
 * So `RegistrationCheck` carries **`uncheckable` as a required field**, never optional.
 * A screen holding one cannot present the check as complete, because there is no shape in
 * which the unreadable conditions are absent. That is the same device the rest of this
 * client uses for *unknown* — `destinationWarning`'s `undefined`, `EffectivePower`'s
 * `unestablished`, `TriggerState`'s `unread` — applied to a gap the **contract** creates
 * rather than a read that happened to fail.
 *
 * ## Why the gap is named, with its error codes
 *
 * A user told only "this might fail" learns nothing actionable. Told that it fails when
 * their account carries a retained ejection or when the record store is saturated — with
 * the exact dispatch errors — they can recognise the outcome when it arrives, and a support
 * conversation starts from the right place. The codes come from SQ-564's own text.
 */

import type { Verified } from '@bleavit/shared-types';

export interface RegistrationInputs {
  /** Free USDC at B′, against `ReporterStake` (13's value, read — never a literal here). */
  readonly freeUsdc: Verified<bigint>;
  readonly reporterStake: Verified<bigint>;
  /** From the frozen `Oracle.Reporters` map (02 §7.2). */
  readonly alreadyRegistered: Verified<boolean>;
}

export interface RegistrationBlock {
  readonly check: string;
  readonly detail: string;
}

/**
 * A condition the contract does not let this client read.
 *
 * Not an error and not a warning about *this* attempt — a permanent statement about what
 * the client can and cannot establish, carrying the dispatch error it would surface as.
 */
export interface UncheckableCondition {
  readonly condition: string;
  readonly dispatchError: string;
  readonly why: string;
}

/**
 * The two conditions SQ-564 names. Fixed, because they are a property of the contract.
 *
 * They leave this list only when 02 §7 freezes the retained-offense store — at which point
 * they become ordinary precondition clauses and this constant becomes empty.
 */
export const UNCHECKABLE_REGISTRATION_CONDITIONS: readonly UncheckableCondition[] =
  Object.freeze([
    {
      condition: 'your account carries a retained ejection from a previous offence',
      dispatchError: 'ReporterEjected',
      why:
        'The 07 §3 offence record lives in a pallet-internal store the integration contract ' +
        'does not freeze, so no client can read it before signing.',
    },
    {
      condition: 'the offence-record store is full',
      dispatchError: 'ReporterRecordsSaturated',
      why:
        'The same store, and the same reason: its occupancy is not readable through any ' +
        'frozen surface.',
    },
  ]);

/**
 * §11.8.1 row 1's last clause, as fixed copy.
 *
 * > free USDC ≥ `ReporterStake` …; **stake-hold consequence displayed**
 *
 * It shipped inside a `RegistrationBlock` detail, which fires **only when free USDC is
 * short** — so the one path where the consequence matters, an account that *can* afford
 * the stake and is about to commit it, was the path that never saw it. A consequence is not
 * a failure message: the reader who needs it is the one nothing is blocking.
 */
export const STAKE_HOLD_CONSEQUENCE =
  'Registering places a hold on the reporter stake for as long as you are registered. The ' +
  'funds are not spent and not transferred, and they are not available to you either: they ' +
  'cannot pay a bond, a fee, or anything else while the hold stands. A false report ' +
  'adjudicated against you is slashed from it, and the registration survives the slash — ' +
  'so the hold can be short of the full stake, which then blocks reporting until it is ' +
  'topped up.';

/**
 * The result of checking what *can* be checked.
 *
 * `uncheckable` is **required**. There is no shape of this type in which the unreadable
 * conditions are absent, so a screen cannot render a complete-looking verdict.
 *
 * `stakeHold` is required for the same structural reason, applied to a *consequence* rather
 * than to a gap: a screen holding this result cannot render the check without also holding
 * the sentence §11.8.1 requires displayed. An optional field, or copy living inside a
 * conditional block, is how it went missing on the only path that needed it.
 */
export interface RegistrationCheck {
  readonly blocks: readonly RegistrationBlock[];
  readonly uncheckable: readonly UncheckableCondition[];
  /** §11.8.1's *"stake-hold consequence displayed"*. Fixed, unconditional, required. */
  readonly stakeHold: string;
}

export function checkRegistration(inputs: RegistrationInputs): RegistrationCheck {
  const blocks: RegistrationBlock[] = [];
  if (inputs.alreadyRegistered.value) {
    blocks.push({
      check: 'Already registered',
      detail: 'This account is already in the reporter registry.',
    });
  }
  if (inputs.freeUsdc.value < inputs.reporterStake.value) {
    blocks.push({
      check: 'Reporter stake',
      detail:
        'Your free USDC does not cover the reporter stake. It must be free rather than ' +
        'committed elsewhere.',
    });
  }
  return {
    blocks,
    uncheckable: UNCHECKABLE_REGISTRATION_CONDITIONS,
    stakeHold: STAKE_HOLD_CONSEQUENCE,
  };
}

/**
 * What the user is told before signing, when nothing checkable blocks.
 *
 * Deliberately **not** "ready to sign". The client has checked what it can, and saying so
 * precisely is the difference between an honest surface and one that will look like it
 * lied when `ReporterEjected` comes back.
 */
export function registrationCaveat(check: RegistrationCheck): string {
  const conditions = check.uncheckable
    .map((entry) => `${entry.condition} (${entry.dispatchError})`)
    .join('; ');
  return (
    'Everything this client can check passes. Two conditions it cannot read may still ' +
    `refuse this registration on chain: ${conditions}. If either applies, the transaction ` +
    'fails and the stake is not taken — but the fee is spent.'
  );
}

// ------------------------------------------ §11.8.1 `oracle.recompute_proof`

/**
 * > the FE recomputes the proof result locally from the committed raw data before submission
 * > and **blocks on mismatch** — never submit a proof the client's own recomputation
 * > contradicts
 *
 * The load-bearing word is *never*, and a comparison a caller is asked to remember is not
 * never. So `RecomputedProof` is branded and `recomputeProof` is its only producer, and
 * `RecomputeSubmission` requires one — a proof whose value this client did not reproduce
 * cannot be assembled into a submission at all. Same device as `VerifiedArtifact` on the
 * upgrade crank, for the same reason: both are signatures whose whole justification is a
 * check that happened first.
 *
 * ## The evaluator is injected, and required
 *
 * Evaluating a MetricSpec is 07's own language and belongs with the executable spec, not
 * here. `evaluate` therefore arrives as a **required** argument — an optional evaluator
 * would default the recomputation off, which is `FE-HANDOFF-010`'s defect and
 * `admitEvidence`'s reason for the same shape.
 *
 * ## A component that does not permit deterministic recomputation is refused, not attempted
 *
 * §11.8.1's precondition has two halves — *"round open"* **and** *"the consumed MetricSpec
 * component permits deterministic recomputation"*. The second is the one a client would skip:
 * running an evaluator over a non-deterministic component produces a number, and a number
 * that disagrees with the reporter's is indistinguishable from fraud when it is really just
 * a component nobody promised would reproduce.
 */

declare const PROOF_RECOMPUTED: unique symbol;

export interface RecomputedProof {
  readonly [PROOF_RECOMPUTED]: true;
  readonly component: number;
  readonly epoch: number;
  readonly specVersion: number;
  readonly value1e9: bigint;
}

export class ProofMismatchError extends Error {
  readonly claimed: bigint;
  readonly recomputed: bigint;

  constructor(claimed: bigint, recomputed: bigint) {
    super(
      `The reporter's value (${claimed}) does not match this client's own recomputation ` +
        `(${recomputed}). This proof is not submitted: a submission that contradicts your ` +
        'own recomputation stakes your bond on a number you have already disproved.',
    );
    this.name = 'ProofMismatchError';
    this.claimed = claimed;
    this.recomputed = recomputed;
  }
}

export class NonDeterministicComponentError extends Error {
  readonly component: number;

  constructor(component: number) {
    super(
      `Component ${component}'s MetricSpec does not permit deterministic recomputation, so ` +
        'this client cannot reproduce the value. It is not submitted — a disagreement here ' +
        'would look like a false report when it is really a component nobody promised would ' +
        'reproduce.',
    );
    this.name = 'NonDeterministicComponentError';
    this.component = component;
  }
}

export interface RecomputeInputs {
  readonly component: number;
  readonly epoch: number;
  readonly specVersion: number;
  /** The value the round's reporter committed, read from chain state. */
  readonly claimedValue1e9: Verified<bigint>;
  /** Whether 07's MetricSpec for this component is deterministically recomputable. Read. */
  readonly deterministic: Verified<boolean>;
  /** The committed raw data the recomputation runs over. */
  readonly rawData: Uint8Array;
}

/**
 * Recompute locally and mint the proof **only** on agreement.
 *
 * Throws rather than returning a union on purpose: every other refusal in this client is a
 * disabled control with a reason, because the user might still want to look. Here there is
 * nothing to look at — the submission must not exist, and a `RecomputeSubmission` that cannot
 * be constructed is a stronger statement than a button that is greyed out.
 */
export function recomputeProof(
  inputs: RecomputeInputs,
  evaluate: (component: number, rawData: Uint8Array) => bigint,
): RecomputedProof {
  if (!inputs.deterministic.value) {
    throw new NonDeterministicComponentError(inputs.component);
  }
  const recomputed = evaluate(inputs.component, inputs.rawData);
  if (recomputed !== inputs.claimedValue1e9.value) {
    throw new ProofMismatchError(inputs.claimedValue1e9.value, recomputed);
  }
  // Phantom brand, never materialised — one mint site, as with `Finalized<T>`.
  return {
    component: inputs.component,
    epoch: inputs.epoch,
    specVersion: inputs.specVersion,
    value1e9: recomputed,
  } as RecomputedProof;
}

/** A submission that can only be built from a proof this client reproduced. */
export interface RecomputeSubmission {
  readonly proof: RecomputedProof;
  /** §11.8.1's other half: the round must be open at B′. */
  readonly roundOpen: Verified<boolean>;
}

export function maySubmitRecompute(submission: RecomputeSubmission): boolean {
  return submission.roundOpen.value;
}
