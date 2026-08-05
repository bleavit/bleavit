/**
 * The `FE-HANDOFF-*` refusal family — 10 §13.3.
 *
 * *"`FE-HANDOFF-001..013`, joining the §9.4 taxonomy with the same discipline — fixed
 * user copy, expert detail, and a documented recovery per code, no free text."*
 *
 * ## Why this lives in the envelope and not in the parser
 *
 * It was written in `intents`, on the reasoning that a refusal is *"a property of the
 * parser rather than of the envelope"*. That is true of **which check fires** and false of
 * **what the code means**, and the difference produced exactly the defect this package
 * exists to prevent: `receipts` needed `FE-HANDOFF-013` and `FE-HANDOFF-002` for the
 * outbound direction, could not import the inbound parser across the §10.1 firewall, and
 * so declared its own bare string union with its own sentence for 013. Two homes, two
 * answers to *what does this code say to the user* — and, because no call site takes both,
 * a drift the compiler could never see.
 *
 * That is the same argument that moved `ChainBinding` here, and it applies with more force:
 * 10 §13.3 states the family **once, for the whole subsystem**, and the family spans both
 * directions by construction. 001–008 and 010–011 are inbound admission checks; 012 and 013
 * are outbound export refusals; 002 is emitted on both sides.
 *
 * ## 009 is a hole, deliberately
 *
 * 10 §13.3: *"`FE-HANDOFF-009` is retired and MUST NOT be reassigned."* It was the replay
 * refusal, deleted when the replay guard was removed. The reasoning belongs next to the
 * constant, because "there is a gap in the numbering, let us tidy it" is exactly the
 * well-meant change that breaks it: an error code is a user-facing identifier that outlives
 * its release in support threads, logs and documentation, so a **reused** code is worse
 * than an absent one — it makes two different failures indistinguishable in every record
 * written before and after the reuse.
 *
 * The absence is asserted by a test rather than left to this comment.
 *
 * ## Three fields, and the third is the one that gets dropped
 *
 * `message` is fixed in-bundle copy; `detail` is expert text the caller composes; and
 * `recovery` is **what the user can actually do**, which §13.3 requires per code and which
 * the first implementation of this family simply did not have. A refusal without a recovery
 * is a dead end dressed as an explanation — and unlike the other two it cannot be composed
 * at the call site, because the answer is a property of the code and must read the same
 * every time it is shown.
 *
 * None of the three is ever derived from the document (10 §13.4): an attacker-supplied
 * label rendered in the confirm flow is the phishing primitive that section names.
 */

export const RETIRED_CODES = Object.freeze(['FE-HANDOFF-009'] as const);

export type HandoffRefusalCode =
  | 'FE-HANDOFF-001' // unknown schema
  | 'FE-HANDOFF-002' // malformed document
  | 'FE-HANDOFF-003' // unknown action
  | 'FE-HANDOFF-004' // foreign field inside `binding` / `action` / `limits`
  | 'FE-HANDOFF-005' // wrong chain
  | 'FE-HANDOFF-006' // newer-than-live runtime
  | 'FE-HANDOFF-007' // limit missing / out of range / inconsistent
  | 'FE-HANDOFF-008' // expired
  // FE-HANDOFF-009 is RETIRED and MUST NOT be reassigned (10 §13.3).
  | 'FE-HANDOFF-010' // digest mismatch
  | 'FE-HANDOFF-011' // action infeasible at the refreshed block
  | 'FE-HANDOFF-012' // scope refused
  | 'FE-HANDOFF-013'; // export from unverified state

interface CodeCopy {
  /** Fixed in-bundle user copy. Never derived from the document (10 §13.4). */
  readonly message: string;
  /** What the user can do about it. A property of the code, not of the call site. */
  readonly recovery: string;
}

const COPY: Readonly<Record<HandoffRefusalCode, CodeCopy>> = Object.freeze({
  'FE-HANDOFF-001': {
    message: 'This file is not a Bleavit action request.',
    recovery: 'Ask the tool for a Bleavit action request, or open the file to check what it is.',
  },
  'FE-HANDOFF-002': {
    message: 'This file is damaged or not in the expected format.',
    recovery: 'Export a fresh capsule and ask the tool to produce the request again.',
  },
  'FE-HANDOFF-003': {
    message: 'This file asks for an action Bleavit does not accept from a tool.',
    recovery:
      'Only opening a PASS or FAIL position and closing part of one can arrive this way. ' +
      'Anything else is done on the trading screens.',
  },
  'FE-HANDOFF-004': {
    message: 'This file contains an instruction Bleavit does not recognise.',
    recovery:
      'Do not edit the file to remove it. Ask the tool for a request without the extra ' +
      'instruction, or make the trade on the trading screens instead.',
  },
  'FE-HANDOFF-005': {
    message: 'This file was prepared for a different chain.',
    recovery: 'Export a capsule from this app and ask the tool to work from that one.',
  },
  'FE-HANDOFF-006': {
    message: 'This file was prepared for a newer version of Bleavit than this one.',
    recovery: 'Update to the current release, then import the file again.',
  },
  'FE-HANDOFF-007': {
    message: 'This file states a limit Bleavit cannot use.',
    recovery:
      'Ask the tool to state a spending ceiling or a proceeds floor in whole base units, ' +
      'or set the limit yourself on the trading screens.',
  },
  'FE-HANDOFF-008': {
    message: 'This request has expired.',
    recovery: 'Export a fresh capsule and ask the tool for a new request.',
  },
  'FE-HANDOFF-010': {
    message: 'This file was altered or truncated in transit.',
    recovery:
      'Send it again as a file attachment rather than pasted text — a long request pasted ' +
      'into a chat box is often cut off at the end.',
  },
  'FE-HANDOFF-011': {
    message: 'This action is no longer possible against current chain state.',
    recovery:
      'The chain moved since the tool answered. Export a fresh capsule and ask again, or ' +
      'make the trade directly on the trading screens.',
  },
  'FE-HANDOFF-012': {
    message: 'This request asks for information you have not agreed to share.',
    recovery:
      'Choose what to include on the export screen. Nothing has left the app; each export ' +
      'asks separately, and no earlier choice is remembered.',
  },
  'FE-HANDOFF-013': {
    message: 'Bleavit cannot export while it has no verified view of the chain.',
    recovery:
      'Wait for the light client to finish syncing. Nothing that has not been verified ' +
      'against a finalized block can be exported, and nothing has been exported.',
  },
});

export interface HandoffRefusal {
  readonly code: HandoffRefusalCode;
  /** Fixed user copy for the code. */
  readonly message: string;
  /** Expert detail. Never contains document-supplied text (10 §13.4). */
  readonly detail: string;
  /** The documented recovery for the code (10 §13.3). Fixed, like the copy. */
  readonly recovery: string;
}

export function refuse(code: HandoffRefusalCode, detail: string): HandoffRefusal {
  const copy = COPY[code];
  return { code, message: copy.message, detail, recovery: copy.recovery };
}

export const REFUSAL_CODES = Object.freeze(Object.keys(COPY) as readonly HandoffRefusalCode[]);

/**
 * The base class for a refusal thrown rather than returned.
 *
 * Both shapes are needed and neither is a stylistic choice. The inbound parser *returns*
 * refusals, because it examines a whole document and the refusal is its result. The
 * outbound builders *throw*, because their result type is a capsule and there is no
 * partial capsule to return — 10 §13.2's *"a document that fails any check is refused
 * whole"* has an export-side twin, and returning `undefined` from a builder is how a
 * caller ends up exporting nothing while believing it exported something.
 */
export class HandoffRefusalError extends Error {
  readonly code: HandoffRefusalCode;
  readonly detail: string;
  readonly recovery: string;

  constructor(code: HandoffRefusalCode, detail: string) {
    const copy = COPY[code];
    super(copy.message);
    this.name = 'HandoffRefusalError';
    this.code = code;
    this.detail = detail;
    this.recovery = copy.recovery;
  }
}
