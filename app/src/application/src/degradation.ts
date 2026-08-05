/**
 * The 11 §11.12 degradation matrix, client side — F12.
 *
 * ## The property this file exists to make true
 *
 * Every row of the matrix has a **scripted** response. Not "the app handles it somehow" —
 * a named state with copy the client says in its own voice, so a degradation is something
 * the user is *told*, never something they infer from a screen that looks broken.
 *
 * The reason that needs a file rather than good intentions is SQ-593: until the matrix was
 * completed and given a checker, fourteen of its twenty-five rows had no text anywhere and
 * **nothing counted them**. A client scripting the eleven readable ones passed every gate
 * and looked finished. So the registry is a table, `app/tests/screens` parses the row ids
 * out of doc 11 §11.12, and a row present in the spec with no entry here fails the suite.
 *
 * ## What is scripted here and what is not
 *
 * This carries the **client's response**: which surface the user lands on, what it says,
 * and whether the condition clears on its own. It deliberately does not restate the
 * matrix's V/L/A/U/F/R facets — those are the spec's, and a second copy in code is a second
 * thing to keep in step. The binding is on the **row set**, which is what was actually lost.
 *
 * ## `recovery: 'none'` is a real value, not a gap
 *
 * Three rows genuinely cannot be recovered from inside the client: a genesis mismatch is a
 * different chain (E1), a quote disagreement is a contract defect (E6), and an expired
 * checkpoint has lost a guarantee no retry restores (E14). Modelling those as "no recovery
 * text yet" would make them indistinguishable from a row somebody forgot to finish.
 */

/** Every id 11 §11.12 defines. The suite requires this to equal the spec's set exactly. */
export type DegradationRow =
  | 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7' | 'E8' | 'E9' | 'E10' | 'E11' | 'E12'
  | 'E13' | 'E14' | 'E15' | 'E16' | 'E17' | 'E18' | 'E19' | 'E20' | 'E21' | 'E22' | 'E23'
  | 'E24' | 'E25';

/**
 * How the client responds.
 *
 * `blocks` names what the user cannot do while the condition holds — and is `'nothing'`
 * for the many rows that are degradations rather than failures. Being explicit about that
 * is the point: a row with no `blocks` field would leave a reader unable to tell "this
 * blocks nothing" from "nobody wrote down what it blocks".
 */
export interface DegradationResponse {
  /** In-bundle copy, said in the client's own voice. */
  readonly says: string;
  /** What is unavailable while it holds. `'nothing'` where the surface is unaffected. */
  readonly blocks: string;
  /**
   * Whether the condition clears without the user doing anything (`'automatic'`), needs an
   * action (`'user-action'`), or cannot be recovered from in the client (`'none'`).
   */
  readonly recovery: 'automatic' | 'user-action' | 'none';
}

export const DEGRADATION_RESPONSES: Readonly<Record<DegradationRow, DegradationResponse>> =
  Object.freeze({
    E1: {
      says: 'This device is verifying the chain from scratch. Nothing is shown as verified until it can be.',
      blocks: 'every verified read, and signing, until the first proof-checked read lands',
      recovery: 'automatic',
    },
    E2: {
      says: 'Verifying on a phone takes longer and uses more memory. If it fails, this device is short of memory rather than offline.',
      blocks: 'as E1; on failure, everything except the verification panel, docs and settings',
      recovery: 'user-action',
    },
    E3: {
      says: 'There is a gap in this device’s history. It is shown as a gap and is not filled in by guessing.',
      blocks: 'nothing',
      recovery: 'user-action',
    },
    E4: {
      says: 'The chain upgraded. These surfaces are unavailable in this release, by name.',
      blocks: 'the named surfaces; everything if the runtime is read-only-incompatible',
      recovery: 'user-action',
    },
    E5: {
      says: 'This proposal is older than the history this release retains. What is shown is bounded, and labelled as such.',
      blocks: 'detail beyond the retained window',
      recovery: 'user-action',
    },
    E6: {
      says: 'This client’s own price and the chain’s do not agree. Trading is blocked rather than guessed at.',
      blocks: 'all trading on the affected book',
      recovery: 'none',
    },
    E7: {
      says: 'The chart shows what this device has. Segments from elsewhere are marked.',
      blocks: 'nothing',
      recovery: 'user-action',
    },
    E8: {
      says: 'History for this address is shown as far as coverage goes, with its origin marked.',
      blocks: 'nothing',
      recovery: 'user-action',
    },
    E9: {
      says: 'This device’s local history could not be read and is being rebuilt. Here is why.',
      blocks: 'local history until the rebuild catches up; nothing on the transaction path',
      recovery: 'automatic',
    },
    E10: {
      says: 'Optional data sources are unavailable. Nothing verified is affected.',
      blocks: 'accelerated history only',
      recovery: 'automatic',
    },
    E11: {
      says: 'That gateway did not serve this release. The bytes are checked whichever gateway serves them.',
      blocks: 'release-artifact fetch from that gateway',
      recovery: 'user-action',
    },
    E12: {
      says: 'This device cannot reach peers yet. Here is what each bootnode did.',
      blocks: 'every verified read, and signing, until peers are found',
      recovery: 'user-action',
    },
    E13: {
      says: 'The chain moved while this was being prepared. Here is what changed and what it was expected to be.',
      blocks: 'signing this preparation; it returns to draft with the form kept',
      recovery: 'user-action',
    },
    E14: {
      says: 'A newer release exists. Past the relay’s bonding duration this one can no longer verify the chain at all.',
      blocks: 'nothing while fresh; every verified claim once the checkpoint has expired',
      recovery: 'none',
    },
    E15: {
      says: 'Voting locks tokens. The lock is shown before the signature, not after.',
      blocks: 'nothing; a closed referendum fails at dispatch and is decoded truthfully',
      recovery: 'automatic',
    },
    E16: {
      says: 'This vault is void. Merging a complete pair recovers the most, and no branch won.',
      blocks: 'redeem_void on a vault that is not voided',
      recovery: 'none',
    },
    E17: {
      says: 'A deposit has two legs and both are shown with their own provenance.',
      blocks: 'the deposit entirely while the Asset Hub connection is down — never a blind send',
      recovery: 'user-action',
    },
    E18: {
      says: 'The destination check needs the Asset Hub connection; without it this is a warning, not a check.',
      blocks: 'withdrawal under a ledger freeze or reserve scope, with the playbook named',
      recovery: 'automatic',
    },
    E19: {
      says: 'The artifact is verified by hash before anything is signed.',
      blocks: 'submission on any hash mismatch',
      recovery: 'user-action',
    },
    E20: {
      says: 'A playbook is admissible only while its trigger condition is verified now.',
      blocks: 'approval when the trigger is not active at the refreshed block',
      recovery: 'none',
    },
    E21: {
      says: 'Bootstrap governance is active: a founding multisig holds sudo.',
      blocks: 'nothing — it is a statement about trust, not a restriction',
      recovery: 'automatic',
    },
    E22: {
      says: 'The evidence behind this could not be retrieved. The protocol treats it as absent, and so does this screen.',
      blocks: 'nothing on chain; the evidence body only',
      recovery: 'user-action',
    },
    E23: {
      says: 'This cannot be ratified in time. It is not yet terminal, and the ratification panel stays actionable.',
      blocks: 'execute, until ratification passes',
      recovery: 'user-action',
    },
    E24: {
      says: 'A tool outside Bleavit proposed this. Nothing in it was trusted; the chain was re-read and the transaction rebuilt.',
      blocks: 'nothing — the whole surface is convenience',
      recovery: 'user-action',
    },
    E25: {
      says: 'An export cannot be made from unverified state, so the control is off and this is why.',
      blocks: 'context export',
      recovery: 'automatic',
    },
  });

/** Every row this client scripts. Compared against doc 11 §11.12 by the suite. */
export const DEGRADATION_ROWS: readonly DegradationRow[] = Object.freeze(
  Object.keys(DEGRADATION_RESPONSES) as DegradationRow[],
);

/**
 * The response for a row.
 *
 * Total over `DegradationRow` by construction — the record is exhaustive and the type is
 * closed, so there is no "unknown row" branch to get wrong and no default to fall through
 * to. A row added to the spec fails the *suite*, which is the right place: a runtime
 * fallback would let an unscripted degradation ship silently, which is the whole defect.
 */
export function respondTo(row: DegradationRow): DegradationResponse {
  return DEGRADATION_RESPONSES[row];
}
