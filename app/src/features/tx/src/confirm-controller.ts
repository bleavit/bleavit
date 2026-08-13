/**
 * Driving the confirm surface from the tx machine — 11 §11.4 rule 1.
 *
 * > Every submit path passes through `refreshAndGate` — **structurally** (the tx machine
 * > has no bypass edge), not by convention.
 *
 * The machine already makes that true at the type level: `AwaitingSignature` has one
 * inbound edge and it requires a `GatePassed` production code cannot mint directly. The public
 * refresh boundary is the only production path and stays fail-closed until its owned evaluator
 * exists. This
 * module is the screen's half, and its job is to not undo that.
 *
 * ## What could undo it, and what stops each
 *
 * 1. **A screen that calls the signer itself.** So `confirmProps` returns `onSign` as a
 *    *closure the caller supplies*, and this module imports no signer and depends on none —
 *    `src/features/tx`'s reference set contains `signing`, so the restraint is not
 *    structural here and is instead asserted by a test over the module's exports.
 * 2. **A screen that renders the confirm surface from `Draft`.** A user reading a full
 *    confirm screen has been told the chain was re-read, and in `Draft` it has not been.
 *    `confirmProps` returns `undefined` outside the two states where a gate result exists,
 *    so there is nothing to render rather than a screen with stale rows.
 * 3. **A screen that shows the rows from the *previous* gate.** `Blocked` carries only the
 *    failed rows (rule 5's diff view), and this module renders exactly those — it does not
 *    reach for a remembered full set, because a passing row from a gate that has since been
 *    superseded is a claim about a block that is no longer B′.
 */

import type {
  GatePassed,
  PreconditionResult,
  TxSession,
} from '@bleavit/transaction-builder';
import type { ConfirmSurfaceProps, DecodedCall, RedemptionPayout } from './confirm.js';

/** What the screen supplies that the machine cannot: the decode, and the two actions. */
export interface ConfirmInputs {
  readonly decoded: DecodedCall;
  readonly sudoActive: boolean;
  readonly expert: boolean;
  readonly onSign: () => void;
  readonly onEdit: () => void;
  readonly payout?: RedemptionPayout | undefined;
}

/**
 * The rows a session may show, and the state they came from.
 *
 * `AwaitingSignature` carries the full passing set from `GatePassed`; `Blocked` carries the
 * failures only. They are different sets on purpose — 11 §11.4 rule 5 asks for a diff view
 * on failure, and padding it back out with remembered passing rows would present rows that
 * were true at a block the gate has already moved past.
 */
function rowsFor(session: TxSession): readonly PreconditionResult[] | undefined {
  if (session.state === 'AwaitingSignature') {
    const window: GatePassed | undefined = session.signingWindow;
    return window?.results;
  }
  if (session.state === 'Blocked') return session.failed;
  return undefined;
}

/**
 * Build the confirm surface's props from a session, or `undefined` when there is nothing
 * a confirm screen may honestly show.
 *
 * Returning `undefined` rather than a partly-filled object is the point: a confirm screen
 * is a statement that the chain was re-read at a named block, and in `Draft`, `Prepared` or
 * `Refreshing` that statement is not yet true.
 */
export function confirmProps(
  session: TxSession,
  inputs: ConfirmInputs,
): ConfirmSurfaceProps | undefined {
  const rows = rowsFor(session);
  if (rows === undefined || session.prep === undefined) return undefined;
  return {
    prep: session.prep,
    decoded: inputs.decoded,
    preconditions: rows,
    payout: inputs.payout,
    sudoActive: inputs.sudoActive,
    onSign: inputs.onSign,
    onEdit: inputs.onEdit,
    expert: inputs.expert,
  };
}

/**
 * Whether the surface may offer signing at all.
 *
 * Derived from the session's *state* rather than from whether the rows happen to be all
 * `ok`. Those two agree today and would drift the moment a new blocking reason arrives that
 * is not expressed as a failed row — `FE-TX-007`, the runtime-changed case, is already
 * exactly that: it blocks with an **empty** `failed` array, so "every row passes" is true of
 * it and offering the signer would be catastrophic.
 */
export function mayOfferSigning(session: TxSession): boolean {
  return session.state === 'AwaitingSignature';
}
