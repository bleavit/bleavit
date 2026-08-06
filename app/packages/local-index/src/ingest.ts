/**
 * The ingestion loop's decisions — 10 §6.5, F8.
 *
 * The loop consumes finalized **events**; `TxHistoryRow` needs extrinsic **bodies**; and
 * events do not contain bodies. §6.5's corrected design closes that gap with a rule whose
 * cost claim is the load-bearing part:
 *
 * > Blocks containing none of the user's extrinsics never trigger a body fetch. Worst-case
 * > overhead is proportional to the user's own activity, not chain activity.
 *
 * Everything here exists to make that sentence true and to make the two ways of breaking it
 * visible. Attribute too narrowly and the user's history is silently incomplete — the worst
 * shape, because an empty history and a *filtered* history look identical. Attribute too
 * broadly and the claim above becomes false: the client fetches a body for every block the
 * chain produces, on a light client, on a phone.
 *
 * ## Why phase handling is the sharp edge
 *
 * An event's phase is what ties it to an extrinsic. Three rules follow, and each of them
 * fails silently if inverted:
 *
 * 1. **Only `ApplyExtrinsic(i)` can attribute.** A `Finalization` or `Initialization` event
 *    belongs to no extrinsic — it is the runtime's own work. Attributing one would fetch a
 *    body for a block the user never touched *and* leave no index to decode.
 * 2. **`System.ExtrinsicSuccess`/`ExtrinsicFailed` never attribute on their own.** §6.5
 *    names them as *correlation*, not attribution: they carry no account and are emitted for
 *    every extrinsic in every block. Treating them as attribution makes every block a hit,
 *    which is exactly the "proportional to chain activity" failure — and it would pass any
 *    test that only checks the user's own transactions are found.
 * 3. **An index outside the block's extrinsic count is refused.** Decoding at a bad index
 *    does not throw; it decodes *a different extrinsic*, and the client would render someone
 *    else's transaction in the user's history.
 *
 * ## Provenance follows the header, not the fetch
 *
 * §6.5: bodies fetched inside smoldot's pinned window are `verified-finalized`; bodies
 * fetched during layer-2 backfill are `provider`, because "the body's extrinsics-root check
 * against a header is only as good as the header's provenance, which at depth is layer-2".
 * That check is genuinely reassuring and genuinely insufficient, so the derivation is a
 * function of the *header's* origin here and takes no argument that could override it.
 */

import type { RangeOrigin } from './coverage.js';

/** Where in a block's execution an event was emitted. */
export type EventPhase =
  | { readonly kind: 'apply-extrinsic'; readonly index: number }
  | { readonly kind: 'finalization' }
  | { readonly kind: 'initialization' };

/** One decoded event, reduced to what the ingest decision needs. */
export interface IndexedEvent {
  readonly phase: EventPhase;
  readonly pallet: string;
  readonly name: string;
  /**
   * Accounts this event attributes to, as the 02 §6 event schema carries them. Empty for an
   * event that names none — which is not the same as an event that names an account the
   * user does not watch, and the two must not collapse into one branch.
   */
  readonly accounts: readonly string[];
}

export interface FinalizedBlockScan {
  readonly number: number;
  /**
   * The block's own hash — §6.3's hash-at-edge, carried from the scan into the coverage range.
   *
   * Read from the header the loop already holds, never derived: the range's edge check exists
   * to notice a reorg past the coverage edge, and a hash the client computed from what it
   * ingested would agree with itself by construction.
   */
  readonly hash: string;
  /** The runtime `spec_version` this block ran under — §6.3's spec-version-at-edge. */
  readonly specVersion: number;
  /**
   * §6.5's raw-row path, and it is deliberately **not** the same thing as a bad blob.
   *
   * > undecodable rows stored raw, "N events pending decoder", never guessed
   *
   * Two failures were being answered with one refusal. *This block's `System.Events` value is
   * structurally unreadable* is a refusal and must stay one — an empty `events` array reads as
   * *no event here names anyone*, so degrading to it hides the user's own transaction. But
   * *the metadata for this block's era is not available* is a different state entirely: the
   * bytes are intact, they are simply not decodable **yet**, and §6.5's answer is to store
   * them raw, keep going, and count them. Refusing there stops the whole ingest run at the
   * first block from an older runtime, which is every backfill past an upgrade.
   *
   * When present, `events` is empty by construction and the loop writes one raw row rather
   * than attributing anything. Obtaining the missing metadata is FE-P5 and is not built here;
   * *noticing that it is missing and not guessing* is, and that is the half §6.5 already owns.
   */
  readonly pendingDecode?:
    | { readonly raw: Uint8Array; readonly reason: string }
    | undefined;
  /**
   * How many extrinsics the block contains, including the inherents — **when known**.
   *
   * `undefined` is the ordinary case, and SQ-595 is why (ruled 2026-08-05). §6.5 has the loop
   * consume *headers + `System.Events`*, fetching a body **only** for blocks with a watched
   * extrinsic — that is the entire cost claim. So at scan time there is usually no body and
   * no count, and §6.5 names no other source for one.
   *
   * Three options were on the table and two are worse than they look. Deriving the count from
   * the events (max index + 1) makes the index check below **vacuous by construction** — a
   * check that cannot fail, which is the defect class this client keeps finding. Always
   * fetching a body to learn the count breaks the cost claim outright. So the count is
   * optional, the index check applies where it is known, and the **authoritative** check is
   * the one in `loop.ts` comparing the fetched body's length against the scan — which is
   * where the failure it describes ("decoding at that index reads a different extrinsic")
   * can actually occur, because that is where decoding happens.
   */
  readonly extrinsicCount?: number | undefined;
  readonly events: readonly IndexedEvent[];
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

/**
 * Events that mark an extrinsic's outcome rather than its owner.
 *
 * Enumerated rather than pattern-matched on the pallet, because `System` also emits events
 * that *do* attribute (`NewAccount`, `KilledAccount`), and a rule of "ignore System" would
 * drop them.
 */
const CORRELATION_ONLY: ReadonlySet<string> = new Set([
  'System.ExtrinsicSuccess',
  'System.ExtrinsicFailed',
]);

function isAttributing(event: IndexedEvent): boolean {
  return !CORRELATION_ONLY.has(`${event.pallet}.${event.name}`);
}

/**
 * Which extrinsic indices in this block belong to a watched account.
 *
 * Returns them sorted and deduplicated, so a block in which the user appears in six events
 * of one extrinsic produces one decode rather than six.
 *
 * `watched` being empty returns nothing — deliberately, and it is worth saying why it is not
 * an error: a client with no accounts loaded has no transaction history to build, and the
 * ingest loop still runs for prices and events. Fetching every body "just in case" would be
 * the same defect as attributing on a correlation event.
 */
export function attributedExtrinsics(
  scan: FinalizedBlockScan,
  watched: ReadonlySet<string>,
): readonly number[] {
  // A block whose era metadata is unavailable attributes nothing, and the honest reason is
  // that it is *unknown*, not *empty*. The row it produces is raw and counted as pending, so
  // the user is told their history is incomplete for these blocks rather than shown a filtered
  // one that looks complete.
  if (scan.pendingDecode !== undefined) {
    if (scan.events.length > 0) {
      throw new IngestError(
        `block ${scan.number} is marked pending-decode and also carries ${scan.events.length} ` +
          'decoded event(s); a block is either decodable or it is not, and a half-decoded scan ' +
          'would attribute from the half that decoded and silently drop the rest',
      );
    }
    return [];
  }
  const count = scan.extrinsicCount;
  if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
    throw new IngestError(`block ${scan.number} declares a non-integer extrinsic count`);
  }
  const hits = new Set<number>();
  for (const event of scan.events) {
    if (event.phase.kind !== 'apply-extrinsic') continue;
    const index = event.phase.index;
    // A negative or fractional index is always refused; the upper bound only where a count
    // is known. An event index is still a *number the node reported*, so the shape check
    // does not depend on knowing how many extrinsics there are.
    if (!Number.isInteger(index) || index < 0 || (count !== undefined && index >= count)) {
      // Refused rather than clamped or skipped: a decode at a bad index does not throw, it
      // returns a *different* extrinsic, and the client would render someone else's
      // transaction as the user's.
      throw new IngestError(
        `block ${scan.number} has an event in ApplyExtrinsic(${index}) but declares ` +
          `${count ?? 'an unknown number of'} extrinsic(s); decoding at that index would read ` +
          'a different one',
      );
    }
    if (!isAttributing(event)) continue;
    if (event.accounts.some((account) => watched.has(account))) hits.add(index);
  }
  return [...hits].sort((a, b) => a - b);
}

/** §6.5's cost claim, as a predicate: a block with no watched extrinsic is never fetched. */
export function needsBodyFetch(scan: FinalizedBlockScan, watched: ReadonlySet<string>): boolean {
  return attributedExtrinsics(scan, watched).length > 0;
}

/** The provenance a decoded body carries, derived from the header it was checked against. */
export type BodyProvenance = 'verified-finalized' | 'provider';

/**
 * §6.5's provenance rule. Takes the *header's* origin and nothing else — there is no
 * argument by which a caller could promote a backfilled body, because §2.2 gives promotion
 * no path at all and the extrinsics-root check is not one: it proves the body matches the
 * header, and at depth the header itself is layer-2.
 */
export function bodyProvenance(headerOrigin: RangeOrigin): BodyProvenance {
  return headerOrigin === 'self' ? 'verified-finalized' : 'provider';
}

/**
 * The idempotency key for an ingested transaction row.
 *
 * §6.5 requires ingest writes to be idempotent with deterministic primary keys, because the
 * loop replays: a tab reloads mid-range, a leader hands over, a crash rolls back a cursor.
 * `(block, index)` is the natural key and it is stable under every one of those — a hash of
 * the decoded row would not be, since the same extrinsic decodes differently once a
 * metadata blob for its era arrives.
 */
export function txRowKey(blockNumber: number, extrinsicIndex: number): string {
  if (!Number.isInteger(blockNumber) || blockNumber < 0) {
    throw new IngestError(`block number ${blockNumber} is not a block height`);
  }
  if (!Number.isInteger(extrinsicIndex) || extrinsicIndex < 0) {
    throw new IngestError(`extrinsic index ${extrinsicIndex} is not an index`);
  }
  // Zero-padded so lexical order is block order: an IndexedDB key range over a block span
  // is the query the ingest cursor and every history screen make.
  return `${blockNumber.toString().padStart(10, '0')}:${extrinsicIndex.toString().padStart(5, '0')}`;
}
