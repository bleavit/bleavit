/**
 * The loop's `write` port, backed by the Dexie store — 10 §6.5 / §7 (F8).
 *
 * `loop.ts` states the invariant: coverage never claims a block whose rows were not stored.
 * As an in-memory property that holds because `ingestBlock` returns the advanced coverage
 * only after the write resolves. As a **durable** property it needs one more thing, and this
 * module is that thing.
 *
 * ## Why the rows and the coverage go in one transaction
 *
 * Two separate writes have two orderings and only one of them is safe:
 *
 * - **rows, then coverage** — a crash between them leaves coverage *behind* the data. The
 *   next run re-ingests a block it already has, which is wasted work and nothing worse,
 *   because ingestion is keyed deterministically (`${block}:${index}`) and replays idempotent.
 * - **coverage, then rows** — a crash between them leaves coverage claiming a block with no
 *   rows behind it. `isVerifiedAt` then answers `true` forever, and coverage is precisely
 *   the structure consulted to decide the client need not re-fetch. The gap is permanent and
 *   silent.
 *
 * Leaving that choice to whoever writes the adapter is leaving a coin-flip in the one place
 * this package cannot afford one. A Dexie `rw` transaction removes the choice: both tables
 * commit or neither does, so neither ordering exists.
 *
 * ## Events are stored for every block; rows only where the user is
 *
 * §6.5's cost claim lives in the *caller* — `needsBodyFetch` decides whether bodies were
 * fetched at all — so by the time a write arrives, `rows` is already empty for a block the
 * user never touched. This module does not re-decide that; it would be a second, weaker copy
 * of a rule that already has one home.
 */

import type { HeaderSource } from './coverage.js';
import { bodyProvenance } from './ingest.js';
import type { BlockWrite } from './loop.js';
import { LocalIndex, StoreError, type StoredEvent, type StoredTxRow } from './store.js';

/**
 * How an attributed row becomes a `StoredTxRow`.
 *
 * Injected because the *account* and the *call name* come from decoding the body, which is
 * 02-metadata work this package deliberately does not do — `local-index` never imports the
 * chain client (10 §10.2), and a decoder living here would be the second place that knows
 * how to read an extrinsic.
 */
export type RowDecoder = (row: BlockWrite['rows'][number]) => {
  readonly account: string;
  readonly call: string;
};

/**
 * How a scanned event becomes a stored one — **the decoded content only**.
 *
 * It used to return a whole `StoredEvent`, `origin` included, and nothing checked what it
 * returned. So the field that decides whether a row renders as light-client-verified or as
 * third-party data was supplied by an injected callback which is never handed the
 * `HeaderSource` and therefore cannot know the answer: every existing caller wrote a constant.
 * Narrowing the return type is the repair — the encoder supplies what it decoded, this module
 * supplies what it knows, and there is no longer an origin the encoder could name.
 */
export type EventPayload = {
  readonly pallet: string;
  readonly name: string;
} & (
  | { readonly decoded: true; readonly raw?: undefined }
  | { readonly decoded: false; readonly raw: Uint8Array }
);

export type EventEncoder = (
  write: BlockWrite,
  event: BlockWrite['scan']['events'][number],
  eventIndex: number,
) => EventPayload;

/**
 * The `pallet`/`name` a raw row carries — §6.5's "N events pending decoder", not a guess.
 *
 * A pending row has no decoded pallet or event name by definition, and inventing plausible
 * ones is precisely what §6.5 forbids (*"never guessed"*). Two fixed sentinels are used
 * instead, so the row sorts and renders as what it is.
 */
export const PENDING_DECODE_PALLET = '(pending decoder)';
export const PENDING_DECODE_NAME = '(era metadata unavailable)';

/**
 * Build a `write` port that commits a block's events, rows and coverage atomically.
 *
 * The returned function is the `LoopPorts['write']` shape exactly, so the loop cannot tell a
 * durable adapter from an in-memory fake — which is what lets the loop's own suite stay
 * headless while this one runs against a real IndexedDB.
 */
export function storeWriter(
  db: LocalIndex,
  decodeRow: RowDecoder,
  encodeEvent: EventEncoder,
): (write: BlockWrite) => Promise<void> {
  return async (write: BlockWrite) => {
    // The one place a stored row learns where it came from. Taken verbatim from the header the
    // loop was driven with — the same argument `rangeForSource` derives the coverage range's
    // origin from — so a row and the range that claims its block cannot disagree.
    const provenance = stamp(write.headerSource);

    // **Only the events 10 §9.1 permits retaining**, and the loop decided which. Storing every
    // event was measured wrong rather than merely wasteful: at the chain-permitted `Traded`
    // ceiling the 15 % events share holds ~6.7 h desktop / ~1.7 h mobile of chain-wide rows, so
    // the index would fill its share within a working day and then evict the user's own history
    // to keep storing strangers' trades. §9.2: *"a chain-wide trade tape is a bounded windowed
    // read, never a retained table."*
    const events: StoredEvent[] = write.retainedEvents.map(({ event, index }) => ({
      id: `${write.blockNumber}:${index}`,
      blockNumber: write.blockNumber,
      ...encodeEvent(write, event, index),
      ...provenance,
    }));

    // §6.5's raw row. A block whose era metadata was unavailable stores its `System.Events`
    // bytes under the same deterministic key shape, so a later pass that obtains the metadata
    // replaces the row rather than adding a second copy of it.
    if (write.scan.pendingDecode !== undefined) {
      events.push({
        id: `${write.blockNumber}:raw`,
        blockNumber: write.blockNumber,
        pallet: PENDING_DECODE_PALLET,
        name: PENDING_DECODE_NAME,
        decoded: false,
        raw: write.scan.pendingDecode.raw,
        ...provenance,
      });
    }

    const rows: StoredTxRow[] = write.rows.map((row) => {
      // The body's provenance and the header's are two records of one fact, and §6.5 derives
      // the first from the second. A row whose stated body provenance does not follow from the
      // header it was ingested behind means the loop and the writer were driven with different
      // arguments — the shape of the defect this repair replaces, in the other direction.
      const expected = bodyProvenance(write.headerSource.origin);
      if (row.provenance !== expected) {
        throw new StoreError(
          `block ${row.blockNumber} extrinsic ${row.extrinsicIndex} claims body provenance ` +
            `"${row.provenance}" behind a "${write.headerSource.origin}" header, which derives ` +
            `"${expected}". 10 §6.5 derives one from the other, so the two cannot disagree.`,
        );
      }
      const decoded = decodeRow(row);
      return {
        id: row.key,
        blockNumber: row.blockNumber,
        extrinsicIndex: row.extrinsicIndex,
        account: decoded.account,
        call: decoded.call,
        ...provenance,
      };
    });

    // One transaction over all three tables. Both commit or neither does, so the unsafe
    // ordering — coverage ahead of its rows — has no way to occur.
    await db.transaction('rw', db.events, db.txHistory, db.meta, async () => {
      if (events.length > 0) await db.events.bulkPut(events);
      if (rows.length > 0) await db.txHistory.bulkPut(rows);
      await db.meta.put({ key: 'coverage', coverage: write.coverageAfter });
    });
  };
}

/**
 * The header's provenance, as every stored row carries it.
 *
 * One function so `origin` and `providerId` travel together. Spelling them out at each write
 * site is how a `providerId` gets dropped for one table and not another, and a `snapshot` row
 * that lost its provider id renders as *unverified — undefined*.
 */
function stamp(source: HeaderSource): HeaderSource {
  return source.origin === 'self'
    ? { origin: 'self' }
    : { origin: source.origin, providerId: source.providerId };
}

