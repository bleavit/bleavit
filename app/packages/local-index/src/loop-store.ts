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
 * ## What is stored per block, after 10 §9.1's ruling
 *
 * The heading here used to read *"events are stored for every block"*, and §9.1 withdrew that:
 * *"the local index retains **only events attributing to the user's watched accounts**"*, because
 * at the chain-permitted `Traded` ceiling the 15 % events share holds about 6.7 h desktop of
 * chain-wide rows. Three things now land per block and each has a different rule:
 *
 * - **Events** — only those naming a watched account, chosen by the loop (which holds the
 *   watched set) and passed here as `retainedEvents`.
 * - **Rows** — only where the user has an extrinsic. §6.5's cost claim lives in the *caller*
 *   (`needsBodyFetch` decides whether a body was fetched at all), so by the time a write arrives
 *   `rows` is already empty for a block the user never touched. This module does not re-decide
 *   it; that would be a second, weaker copy of a rule with one home.
 * - **Candle aggregates** — **chain-wide**, because §9.1's sentence has two halves and this is
 *   the one that makes discarding the rows honest: *"chain-wide `Traded` is consumed into the
 *   candle aggregates as it is scanned and never stored row-by-row"*. Merged into the stored
 *   bucket rather than written over it, and skipped for a block the stored bar already spans, so
 *   a replay neither double-counts nor rewrites.
 */

import { candleCoversBlock, mergeCandle, type Candle } from './candles.js';
import type { HeaderSource } from './coverage.js';
import { bodyProvenance } from './ingest.js';
import type { BlockWrite } from './loop.js';
import {
  LocalIndex,
  StoreError,
  candleTableFor,
  rawEventId,
  type StoredEvent,
  type StoredTxRow,
} from './store.js';

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
    const events: StoredEvent[] = write.retainedEvents.map(({ event, index }) => {
      // The same symmetric check the rows below get, and it was missing here. `index` is the
      // event's position **in the scan** and it becomes the stored row's primary key, so a
      // caller that numbered the retained list instead — the exact mistake `RetainedEvent`'s own
      // comment warns about — writes rows under ids that shift when the watched set changes, and
      // a replay then stores a second copy of history beside the first. The scan is right here;
      // trusting the number without asking it is trusting one of two records that must agree.
      if (write.scan.events[index] !== event) {
        throw new StoreError(
          `block ${write.blockNumber} retained an event claiming scan index ${index}, where the ` +
            'scan carries a different event (or none). The id `${block}:${index}` is derived from ' +
            'this number, so a wrong one makes the row id a function of what the caller filtered ' +
            'rather than of the block — and 10 §6.5 requires ingest writes to be replay-idempotent.',
        );
      }
      const payload = encodeEvent(write, event, index);
      const identity = { id: `${write.blockNumber}:${index}`, blockNumber: write.blockNumber };
      // An encoder may report a single event as undecodable, and such a row is a pending-decoder
      // row exactly like a whole-block raw one — so it carries `pendingBlock` too, or 10 §9.1's
      // bound cannot reach it and `pendingRawRows` refuses the whole pass rather than quietly
      // bounding a subset.
      return payload.decoded
        ? { ...identity, ...payload, ...provenance }
        : { ...identity, ...payload, pendingBlock: write.blockNumber, ...provenance };
    });

    // §6.5's raw row. A block whose era metadata was unavailable stores its `System.Events`
    // bytes under a deterministic key, so a later pass that obtains the metadata is idempotent.
    //
    // `pendingBlock` is the row's own block number and is present **only** on a raw row, which
    // makes it a sparse index: `orderBy('pendingBlock')` enumerates exactly the pending set,
    // oldest first, without a table scan. A boolean cannot do that job — it is not a valid
    // IndexedDB key, so a `decoded` index would hold nothing and answer zero (see
    // `pendingDecoderCount`).
    if (write.scan.pendingDecode !== undefined) {
      events.push({
        id: rawEventId(write.blockNumber),
        blockNumber: write.blockNumber,
        pendingBlock: write.blockNumber,
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

    // One transaction over every table this block touches. All commit or none does, so the
    // unsafe ordering — coverage ahead of its rows — has no way to occur, and §9.1's aggregate
    // can never summarise a block the coverage does not claim.
    const aggregateTables = new Set(
      write.tradeAggregates.map((candle) => candleTableFor(candle.resolution)),
    );
    await db.transaction(
      'rw',
      [db.events, db.txHistory, db.meta, ...[...aggregateTables].map((name) => db.table(name))],
      async () => {
        if (events.length > 0) await db.events.bulkPut(events);
        if (rows.length > 0) await db.txHistory.bulkPut(rows);

        // **The raw row is retired the moment the block decodes.** It used to be left behind:
        // a re-ingest with the era's metadata wrote the decoded rows under `${block}:${index}`
        // and never touched `${block}:raw`, so §6.5's "N events pending decoder" count could
        // only ever rise, the block's events were stored twice, and the comment above the write
        // claimed the opposite. Deleted in the same transaction as the decoded rows, because
        // the two are one fact: a crash between them leaves the block counted as pending while
        // its events are already readable.
        if (write.scan.pendingDecode === undefined) {
          await db.events.delete(rawEventId(write.blockNumber));
        }

        // §9.1's scan-time aggregate — read-modify-write, never a bare `put`.
        //
        // A `put` here would make each block's bar replace the bucket's, so a bucket would only
        // ever describe its last block. And a block the stored bar already spans is **skipped**
        // rather than merged: §6.5 requires ingest writes to be idempotent under replay, and an
        // accumulator has no deterministic primary key to lean on — re-folding block N would add
        // its fills a second time. The skip is conservative in the one direction that matters
        // (it can only undercount a hole later backfilled inside an existing span, never
        // double-count), which is the disposal SQ-762 records.
        for (const candle of write.tradeAggregates) {
          const table = db.table<Candle, [string, string, number]>(
            candleTableFor(candle.resolution),
          );
          const existing = await table.get([candle.bookId, candle.sourceKey, candle.openAt]);
          if (existing === undefined) {
            await table.put(candle);
            continue;
          }
          if (candleCoversBlock(existing, write.blockNumber)) continue;
          await table.put(mergeCandle(existing, candle));
        }

        await db.meta.put({ key: 'coverage', coverage: write.coverageAfter });
      },
    );
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

