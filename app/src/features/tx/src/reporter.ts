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
 * The result of checking what *can* be checked.
 *
 * `uncheckable` is **required**. There is no shape of this type in which the unreadable
 * conditions are absent, so a screen cannot render a complete-looking verdict.
 */
export interface RegistrationCheck {
  readonly blocks: readonly RegistrationBlock[];
  readonly uncheckable: readonly UncheckableCondition[];
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
        'Your free USDC does not cover the reporter stake. The stake is held for as long as ' +
        'you are registered, so it must be free rather than committed elsewhere.',
    });
  }
  return { blocks, uncheckable: UNCHECKABLE_REGISTRATION_CONDITIONS };
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
