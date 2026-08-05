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

import type { Coverage } from './coverage.js';
import type { BlockWrite } from './loop.js';
import { LocalIndex, readCoverage, type StoredEvent, type StoredTxRow } from './store.js';

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

/** How a scanned event becomes a `StoredEvent`. Same reasoning as `RowDecoder`. */
export type EventEncoder = (
  write: BlockWrite,
  event: BlockWrite['scan']['events'][number],
  eventIndex: number,
) => StoredEvent;

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
    const events: StoredEvent[] = write.scan.events.map((event, index) =>
      encodeEvent(write, event, index),
    );
    const rows: StoredTxRow[] = write.rows.map((row) => {
      const decoded = decodeRow(row);
      return {
        id: row.key,
        blockNumber: row.blockNumber,
        extrinsicIndex: row.extrinsicIndex,
        account: decoded.account,
        // The row's provenance is the *header's*, decided in the loop. Recording anything
        // else here would let a body fetched at depth be stored as light-client verified.
        origin: row.provenance === 'verified-finalized' ? 'self' : 'operator',
        call: decoded.call,
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
 * Read back the coverage a `storeWriter` committed.
 *
 * Thin on purpose — `readCoverage` already applies the empty default at the boundary so a
 * fresh database cannot hand `undefined` to a renderer that would treat it as full coverage.
 * This exists so a caller resuming after a restart has one obvious place to start from.
 */
export async function resumeCoverage(db: LocalIndex): Promise<Coverage> {
  return readCoverage(db);
}
