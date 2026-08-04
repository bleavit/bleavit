/**
 * The `FE-HANDOFF-*` refusal family — 10 §13.3.
 *
 * Codes are assigned in the order 10 §13.3 lists the classes, and two of them are pinned
 * independently by other documents: `FE-HANDOFF-004` is named by app-code rule 11 as the
 * foreign-field refusal, and `FE-HANDOFF-013` by 10 §13.1 as export-from-unverified-state.
 * Those two anchors sit at positions 4 and 13 of that list, which is what makes the
 * positional reading of the rest sound rather than assumed.
 *
 * ## 009 is a hole, deliberately
 *
 * 10 §13.3: *"`FE-HANDOFF-009` is retired and MUST NOT be reassigned."* It was the replay
 * refusal, deleted when the replay guard was removed. The reasoning is worth keeping next
 * to the constant, because "there is a gap in the numbering, let us tidy it" is exactly
 * the well-meant change that breaks it: an error code is a user-facing identifier that
 * outlives its release in support threads, logs and documentation, so a **reused** code is
 * worse than an absent one — it makes two different failures indistinguishable in every
 * record written before and after the reuse.
 *
 * The absence is asserted by a test rather than left to this comment.
 */

export const RETIRED_CODES = Object.freeze(['FE-HANDOFF-009'] as const);

export type HandoffRefusalCode =
  | 'FE-HANDOFF-001' // unknown schema
  | 'FE-HANDOFF-002' // malformed document
  | 'FE-HANDOFF-003' // unknown action
  | 'FE-HANDOFF-004' // foreign field inside `action` / `limits`
  | 'FE-HANDOFF-005' // wrong chain
  | 'FE-HANDOFF-006' // newer-than-live runtime
  | 'FE-HANDOFF-007' // limit missing / out of range / inconsistent
  | 'FE-HANDOFF-008' // expired
  // FE-HANDOFF-009 is RETIRED and MUST NOT be reassigned (10 §13.3).
  | 'FE-HANDOFF-010' // digest mismatch
  | 'FE-HANDOFF-011' // action infeasible at the refreshed block
  | 'FE-HANDOFF-012' // scope refused
  | 'FE-HANDOFF-013'; // export from unverified state

/** Fixed in-bundle copy. Never derived from the document (10 §13.4's phishing note). */
const COPY: Readonly<Record<HandoffRefusalCode, string>> = {
  'FE-HANDOFF-001': 'This file is not a Bleavit action request.',
  'FE-HANDOFF-002': 'This file is damaged or not in the expected format.',
  'FE-HANDOFF-003': 'This file asks for an action Bleavit does not accept from a tool.',
  'FE-HANDOFF-004': 'This file contains an instruction Bleavit does not recognise.',
  'FE-HANDOFF-005': 'This file was prepared for a different chain.',
  'FE-HANDOFF-006': 'This file was prepared for a newer version of Bleavit than this one.',
  'FE-HANDOFF-007': 'This file states a limit Bleavit cannot use.',
  'FE-HANDOFF-008': 'This request has expired.',
  'FE-HANDOFF-010': 'This file was altered or truncated in transit.',
  'FE-HANDOFF-011': 'This action is no longer possible against current chain state.',
  'FE-HANDOFF-012': 'This request asks for information you have not agreed to share.',
  'FE-HANDOFF-013': 'Bleavit cannot export while it has no verified view of the chain.',
};

export interface HandoffRefusal {
  readonly code: HandoffRefusalCode;
  /** Fixed user copy for the code. */
  readonly message: string;
  /** Expert detail. Never contains document-supplied text (10 §13.4). */
  readonly detail: string;
}

export function refuse(code: HandoffRefusalCode, detail: string): HandoffRefusal {
  return { code, message: COPY[code], detail };
}

export const REFUSAL_CODES = Object.freeze(Object.keys(COPY) as readonly HandoffRefusalCode[]);
