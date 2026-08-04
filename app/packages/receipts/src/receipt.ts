/**
 * `bleavit.receipt.v1` — the finalized result, export-only (10 §13.1; D-21).
 *
 * A receipt says *this transaction was included and finalized, and here is what the chain
 * recorded*. It is handed to an external tool so a user can ask questions about what
 * happened. Everything below follows from that being its **only** job.
 *
 * ## The rule this package exists to enforce is about the outbound direction
 *
 * 10 §13's third load-bearing sentence: *"No format carries an encoded call, in either
 * direction. Not inbound, for the obvious reason; and not outbound either, because a
 * receipt containing call bytes teaches a naive tool to echo them back."*
 *
 * The inbound half of that rule is easy to keep — nobody adds a `callBytes` field to a
 * parser on purpose. The **outbound** half is the one that gets broken by writing the
 * obvious code, because the natural source for a receipt is the `TxPreparation` that
 * produced the transaction, and 11 §11.4 rule 3 requires that object to carry
 * `prep.scaleHex` for the three-level payload review. Spreading it into a receipt is one
 * line, produces a document that looks *more* complete, and creates the exact artifact the
 * sentence forbids: a file in a tool's context window containing ready-to-submit bytes,
 * which a helpful assistant will offer back the next time it is asked to do the same
 * thing. The user then signs bytes that were never rebuilt against current state.
 *
 * So `buildReceipt` takes an explicit, closed argument object and **refuses** any
 * bytes-shaped field rather than ignoring it (`ReceiptError`). Ignoring would be worse
 * than refusing in the specific way that matters here: the caller who passed `scaleHex`
 * believed it was exporting it, and a silent drop leaves that belief in place until
 * someone adds the field to the projection "so the export works".
 *
 * ## Export is structurally impossible from unverified state
 *
 * 10 §13.1: *"The exporter's input type is `Finalized<T>` (§2.1), so a `provider`-,
 * `derived-local`- or `stale-cache`-status value is untypeable in a capsule."* Every
 * chain-derived field below arrives as `Finalized<T>`, whose brand is constructible only
 * inside `packages/chain-client`. `FE-HANDOFF-013` is the refusal for the case the type
 * system cannot reach — a caller with nothing verified to export at all.
 *
 * ## The digest authenticates nothing
 *
 * Same as every other capsule (10 §13.1): an integrity check against truncation and
 * transcription damage. This module exports no `sign`, no `verify`, no `authenticate`.
 * What verifies a receipt is re-reading the chain at the block it names, which anyone can
 * do — and which is why the block height and hash are in the core rather than optional.
 */

import { type ChainBinding, canonicalJson, digestPreimage } from '@bleavit/handoff-envelope';
import type { Finalized } from '@bleavit/chain-client';

/** The `schema` string, validated by exact equality (10 §13.1). */
export const RECEIPT_SCHEMA = 'bleavit.receipt.v1';

/**
 * The domain-separation tag.
 *
 * It lives here rather than beside the context tag, per the rule `contexts` states and
 * did not follow: *"A tag is not a shared convention; it is the name of one document
 * type"* — so the receipt tag belongs to the receipt package, and a format cannot import
 * a tag it has no business emitting.
 */
export const RECEIPT_DOMAIN_TAG = 'bleavit.receipt.v1';

/**
 * What the chain recorded about one finalized extrinsic.
 *
 * Deliberately **not** a copy of the `TxPreparation`. A preparation describes what was
 * going to be sent; a receipt describes what happened. Fields that exist only in the
 * former — the encoded call, the mortality era, the tip strategy, the signer's chosen
 * nonce — are absent because none of them is an outcome, and one of them is the call bytes
 * §13 forbids.
 */
export interface ReceiptOutcome {
  /** `Pallet.Call`, as a name. Never an index and never bytes — a name cannot be resubmitted. */
  readonly call: string;
  /** Whether the dispatch succeeded. A failed transaction is still a finalized fact. */
  readonly success: boolean;
  /**
   * The pallet error, when it failed — `Pallet.ErrorName`, from the frozen 02 §6 set.
   *
   * A name rather than the raw `DispatchError` bytes, for the same reason as `call`.
   */
  readonly error?: string;
}

/** Where in the chain the outcome sits. This is what makes a receipt independently checkable. */
export interface ReceiptAnchor {
  readonly blockHash: string;
  readonly blockNumber: number;
  /** Index of the extrinsic within the block, so a reader can find the exact one. */
  readonly extrinsicIndex: number;
}

/**
 * A base-unit amount the transaction moved or charged.
 *
 * `bigint` because base units run past 2^53 — the envelope renders it as a decimal string,
 * and the alternative silently corrupts the document while leaving its digest stable (V-74).
 * `asset` is a label from the 02 §8 identity pins, not a free-text field.
 */
export interface ReceiptAmount {
  readonly asset: 'USDC' | 'VIT';
  readonly baseUnits: bigint;
}

export interface BuildReceiptInput {
  readonly binding: ChainBinding;
  readonly anchor: Finalized<ReceiptAnchor>;
  readonly outcome: Finalized<ReceiptOutcome>;
  /** The fee actually charged, as the chain reported it. */
  readonly feeCharged: Finalized<ReceiptAmount>;
  /**
   * Protocol amounts the call moved, keyed by a short label (`net`, `gross`, `fee`).
   *
   * Optional because not every call moves one. An empty map and an absent one mean the
   * same thing and both serialize the same way, so there is no third state to interpret.
   */
  readonly amounts?: Readonly<Record<string, Finalized<ReceiptAmount>>>;
}

/** The emitted document. `schema` first by convention; canonical JSON sorts it anyway. */
export interface Receipt {
  readonly schema: typeof RECEIPT_SCHEMA;
  readonly binding: ChainBinding;
  readonly anchor: ReceiptAnchor;
  readonly outcome: ReceiptOutcome;
  readonly feeCharged: ReceiptAmount;
  readonly amounts: Readonly<Record<string, ReceiptAmount>>;
}

export class ReceiptError extends Error {
  readonly code: 'FE-HANDOFF-013' | 'FE-HANDOFF-002';

  constructor(code: 'FE-HANDOFF-013' | 'FE-HANDOFF-002', message: string) {
    super(message);
    this.name = 'ReceiptError';
    this.code = code;
  }
}

/**
 * Field names that must never appear in a receipt, checked by name on the input object.
 *
 * A type-level ban is not enough on its own. `BuildReceiptInput` is an interface, so an
 * object literal with an extra property is rejected by excess-property checking — but a
 * *variable* of a wider type is assignable to it, and the wider type is exactly what a
 * caller holds: a `TxPreparation`. `buildReceipt(prep)` with a structurally compatible
 * prep would typecheck and carry `scaleHex` straight into the projection if the projection
 * ever spread its input. So the ban is enforced at runtime, on the names an encoded call
 * actually travels under.
 */
const FORBIDDEN_FIELDS = Object.freeze([
  'scaleHex',
  'callData',
  'callBytes',
  'encodedCall',
  'payload',
  'payloadHex',
  'signature',
  'signedTx',
  'extrinsicHex',
  'preimage',
  'bytes',
  'hex',
  'blob',
]);

/**
 * Walk the whole input and refuse any bytes-shaped key, at any depth.
 *
 * **A one-level scan is useless here, and the first version of this function was one.**
 * Every chain-derived field arrives as `Finalized<T>`, which is a wrapper — so the actual
 * payload sits at `input.outcome.value`, one level below where a shallow check looks. A
 * `scaleHex` inside a finalized outcome is *exactly* where an encoded call would travel,
 * and the shallow version waved it through while its test still passed on the top-level
 * case. The suite now asserts the nested case, which is the one that would have shipped.
 *
 * Depth is bounded rather than unbounded: the deepest legitimate structure here is
 * `input.amounts.<label>.value.baseUnits` at depth 4, and an unbounded walk over
 * caller-supplied data is a stack hazard for no benefit. A cycle would also hang it, so
 * the bound doubles as the cycle guard.
 */
function assertCarriesNoCall(value: unknown, path = 'input', depth = 0): void {
  if (depth > 6) return;
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertCarriesNoCall(item, `${path}[${i}]`, depth + 1));
    return;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return;

  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.includes(key)) {
      throw new ReceiptError(
        'FE-HANDOFF-002',
        `${path}.${key} is a bytes-shaped field, and 10 §13 forbids a receipt from carrying ` +
          'an encoded call in either direction — a tool handed ready-to-submit bytes will ' +
          'offer them back, and they would not be rebuilt against current state. Export the ' +
          'outcome, not the payload.',
      );
    }
    assertCarriesNoCall(member, `${path}.${key}`, depth + 1);
  }
}

/**
 * Build a receipt from finalized state.
 *
 * The `Finalized<T>` inputs are unwrapped here and the document carries plain values,
 * which is correct and worth stating: provenance is a property of *this client's* reading,
 * and a JSON file has no way to be verified-finalized. What replaces it is the anchor —
 * the reader re-reads the chain at that block, which is the only check that means anything
 * outside the app.
 */
export function buildReceipt(input: BuildReceiptInput): Receipt {
  assertCarriesNoCall(input);

  const amounts: Record<string, ReceiptAmount> = {};
  for (const [label, amount] of Object.entries(input.amounts ?? {})) {
    amounts[label] = amount.value;
  }

  return {
    schema: RECEIPT_SCHEMA,
    binding: input.binding,
    anchor: input.anchor.value,
    outcome: input.outcome.value,
    feeCharged: input.feeCharged.value,
    amounts,
  };
}

/**
 * Refuse an export because nothing verified is available — `FE-HANDOFF-013`.
 *
 * 10 §13.1: in RPC-only, degraded or `read-only-incompatible` modes *"there is nothing to
 * construct a capsule from, and export is disabled with a stated reason rather than
 * silently degraded"*. This exists as a named call so the disabled surface has one place
 * to get its copy from, rather than each caller inventing a sentence.
 */
export function refuseUnverifiedExport(mode: string): ReceiptError {
  return new ReceiptError(
    'FE-HANDOFF-013',
    `Export is unavailable in ${mode}: a receipt may only be built from finalized, ` +
      'light-client-verified state, and none is available. Nothing has been exported.',
  );
}

/** The canonical JSON bytes of a receipt, for a file, the clipboard or a share sheet. */
export function serializeReceipt(receipt: Receipt): string {
  return canonicalJson(receipt);
}

/** The digest pre-image. Hashing is the caller's, as everywhere else — platforms differ. */
export function receiptDigestPreimage(receipt: Receipt): Uint8Array {
  return digestPreimage(RECEIPT_DOMAIN_TAG, receipt);
}
