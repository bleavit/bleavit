/**
 * Driving the §11.8 operator controls from the tx machine — 11 §11.4 rule 1. F17.
 *
 * > Every submit path passes through `refreshAndGate` — **structurally** (the tx machine
 * > has no bypass edge), not by convention.
 *
 * §11.8's opening sentence puts every workflow under it on that discipline. Until this
 * module every operator console took an `onX: () => void` and enabled it on its own
 * module-local `*Blocks()` result. Each of those checks is correct and none of them is the
 * gate: they are computed from values the screen was handed, at whatever block those were
 * read, with no refresh, no `spec_version` re-check and no proof that the set describes one
 * state. A guardian approval, a runtime upgrade and a treasury claim were all reachable
 * that way. That is the bypass rule 1 names, arrived at by omission rather than by an added
 * edge — and an omission is exactly what "structurally, not by convention" is meant to
 * catch.
 *
 * ## The control is a value, and it can only be built from a gate result
 *
 * `OperatorGate.window` is a `GatePassed`, whose brand only `gate()` mints and only when
 * every declared row was read at one finalized block. A console renders its submit control
 * from that field, and its `onSubmit` **takes the window as an argument** — so a screen
 * cannot call the submitter without holding one, and cannot obtain one except from a
 * session in `AwaitingSignature`. The old `() => void` shape is not merely discouraged; it
 * no longer typechecks.
 *
 * ## Three refusals this module adds that the machine cannot see
 *
 * 1. **The preparation must declare this call's row.** `gate()` checks that every row a
 *    preparation *declares* was read — it cannot check that the declaration is the right
 *    one. A preparation for `guardian.approve_action` declaring `P-1` would gate perfectly
 *    against the market row and authorise the wrong signature, so the binding from call to
 *    row is asserted here against `OPERATOR_SURFACE_ROWS` — which covers the two §11.8.1
 *    calls whose rows are §11.5's (`oracle.report`/`oracle.challenge` ⇒ P-13/P-14) as well
 *    as the nine `O-n` ones.
 * 2. **A blocking unreadable obligation closes the control.** `clauseGroupsFor` answers
 *    *"every declared read passed"*, which for a row whose central read 02 freezes no
 *    surface for is vacuously true. INV-FE-12's lattice says an unproven capability is
 *    absent, so those rows are closed with the reason and the spec-question id named.
 * 3. **The model's own blocks still apply.** They are not redundant with the gate: the gate
 *    re-reads, and these interpret. Both must hold, and merging them here means a console
 *    has one list to render rather than two it might render only one of.
 */

import type { GatePassed, TxSession } from '@bleavit/transaction-builder';
import {
  OPERATOR_SURFACE_ROWS,
  blockingObligationsFor,
  unreadableObligationsFor,
  type OperatorSurfaceCall,
  type RowId,
  type UnreadableObligation,
} from '@bleavit/transaction-builder';

/** One reason a control is unavailable, in the words the operator is shown. */
export interface OperatorBlock {
  readonly check: string;
  readonly detail: string;
}

/**
 * Why a submit control is not offered — a closed set, because each needs a different
 * sentence and a screen that collapsed them would tell an operator to do the wrong thing.
 */
export type OperatorGateState =
  /** The gate ran at B′ and every declared row passed. `window` is present. */
  | 'ready'
  /** A precondition, an unreadable obligation, or a mis-declared row stands. */
  | 'blocked'
  /**
   * No gate result exists yet for this preparation. Distinct from `blocked`: nothing is
   * wrong, the chain has simply not been re-read — and telling an operator a condition
   * failed when none did sends them looking for a problem that is not there.
   */
  | 'not-refreshed';

export interface OperatorGate {
  /** The row this call declares. Bound to the call, never chosen by the screen. */
  readonly row: RowId;
  readonly state: OperatorGateState;
  /**
   * Proof the gate ran and passed. Present **iff** `state === 'ready'`.
   *
   * It is the argument the submitter demands, so the property "no operator submit path
   * reaches a signer without `refreshAndGate`" is carried by the signature of every
   * console's `onSubmit` rather than by this module being called.
   */
  readonly window: GatePassed | undefined;
  /** Every reason, in one list — a screen rendering only the first teaches guesswork. */
  readonly blocks: readonly OperatorBlock[];
  /**
   * What §11.8 requires and no frozen surface answers, whether or not it blocks.
   *
   * Always present, `stated` obligations included, so a console cannot render a complete
   * verdict for a row whose check is known to be partial (the `RegistrationCheck.uncheckable`
   * device, generalised to every operator row).
   */
  readonly unreadable: readonly UnreadableObligation[];
}

/** A preparation declaring the wrong row gates perfectly and authorises the wrong call. */
function declarationBlock(
  call: OperatorSurfaceCall,
  row: RowId,
  session: TxSession,
): OperatorBlock | undefined {
  const prep = session.prep;
  if (prep === undefined) return undefined;
  if (prep.requires.includes(row)) return undefined;
  return {
    check: 'Declared precondition row',
    detail:
      `This transaction was prepared declaring ${prep.requires.join(', ') || 'no rows'}, and ` +
      `${call} is row ${row}. The gate verifies the rows a preparation declares, so a ` +
      'preparation declaring somebody else’s row passes its gate and authorises this ' +
      'signature against preconditions that are not this call’s. It is refused here.',
  };
}

function obligationBlock(entry: UnreadableObligation): OperatorBlock {
  return {
    check: 'Not readable at B′',
    detail:
      `${entry.requirement} — ${entry.reason} This condition has no frozen surface behind ` +
      `it (${entry.specQuestion}), so it cannot be read at the block this transaction ` +
      'would be signed against, and the control is closed rather than offered on a check ' +
      'that never ran.',
  };
}

/**
 * Build the control for one operator call.
 *
 * `local` is the console's own model result — `approvalBlocks`, `claimBlocks`,
 * `filingBlocks` and the rest. Required rather than optional: an omitted argument would
 * default to *nothing is wrong*, which is the shape of every fail-open defect this client
 * has found so far. An empty array is a claim the caller makes explicitly.
 */
export function operatorGate(
  call: OperatorSurfaceCall,
  session: TxSession,
  local: readonly OperatorBlock[],
): OperatorGate {
  const row = OPERATOR_SURFACE_ROWS[call];
  const unreadable = unreadableObligationsFor(row);
  const blocks: OperatorBlock[] = [
    ...blockingObligationsFor(row).map(obligationBlock),
    ...local,
  ];
  const mismatch = declarationBlock(call, row, session);
  if (mismatch !== undefined) blocks.push(mismatch);

  if (blocks.length > 0) return { row, state: 'blocked', window: undefined, blocks, unreadable };
  // `AwaitingSignature` is the only state carrying a `GatePassed`, and the machine gives it
  // exactly one inbound edge. Reading the state rather than testing whether the results
  // happen to be all-`ok` is deliberate and is `mayOfferSigning`'s reason: `FE-TX-007`
  // blocks with an **empty** failed set, so "every row passed" is true of it.
  if (session.state !== 'AwaitingSignature' || session.signingWindow === undefined) {
    return { row, state: 'not-refreshed', window: undefined, blocks: [], unreadable };
  }
  return { row, state: 'ready', window: session.signingWindow, blocks: [], unreadable };
}

/**
 * The sentence a disabled operator control carries.
 *
 * Never empty, because `Button` throws on a disabled control with no reason (app-code rule
 * 10) and because "unavailable" with no cause is indistinguishable from a defect.
 */
export function operatorDisabledReason(gate: OperatorGate): string | undefined {
  switch (gate.state) {
    case 'ready':
      return undefined;
    case 'blocked':
      return gate.blocks.map((block) => block.check).join('; ');
    case 'not-refreshed':
      return (
        'The chain has not been re-read for this transaction yet. Every operator action ' +
        'is checked again at the finalized block it will be signed against, and this one ' +
        'has not reached that step.'
      );
  }
}

/**
 * What a console passes to `Button.onClick`, or `undefined` when there is nothing to offer.
 *
 * Returning `undefined` rather than a no-op closure is the point: a no-op is a control that
 * looks live and does nothing, and the button component's own `disabled`/`disabledReason`
 * pairing then has to be remembered separately. Here the two derive from one value.
 */
export function operatorSubmit(
  gate: OperatorGate,
  onSubmit: (window: GatePassed) => void,
): (() => void) | undefined {
  const window = gate.window;
  return window === undefined ? undefined : () => onSubmit(window);
}
