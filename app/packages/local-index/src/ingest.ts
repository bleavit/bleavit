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
  /** How many extrinsics the block contains, including the inherents. */
  readonly extrinsicCount: number;
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
  if (!Number.isInteger(scan.extrinsicCount) || scan.extrinsicCount < 0) {
    throw new IngestError(`block ${scan.number} declares a non-integer extrinsic count`);
  }
  const hits = new Set<number>();
  for (const event of scan.events) {
    if (event.phase.kind !== 'apply-extrinsic') continue;
    const index = event.phase.index;
    if (!Number.isInteger(index) || index < 0 || index >= scan.extrinsicCount) {
      // Refused rather than clamped or skipped: a decode at a bad index does not throw, it
      // returns a *different* extrinsic, and the client would render someone else's
      // transaction as the user's.
      throw new IngestError(
        `block ${scan.number} has an event in ApplyExtrinsic(${index}) but declares ` +
          `${scan.extrinsicCount} extrinsic(s); decoding at that index would read a different one`,
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
