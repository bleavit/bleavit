/**
 * The local index schema — 10 §7, §6.3, §9.2, §9.3, INV-FE-7 (F8).
 *
 * ## One database per chain identity, and this is the sharp edge
 *
 * §7 names the database `futarchy@<paraGenesisHash-prefix8>`. That suffix is not a nicety.
 * A single shared database would let a client that connected to Paseo yesterday and Polkadot
 * today read yesterday's rows as today's chain — positions, prices and transaction history
 * belonging to a different network, rendered with no visible difference. Nothing downstream
 * could detect it: the rows are well-formed, the coverage is contiguous, and the ids collide
 * because both chains number their proposals from one.
 *
 * So the genesis hash is **required** to open a store, it is validated as a genesis hash, and
 * there is no default and no "current chain" the module could read. A caller that does not
 * know which chain it is indexing has nothing to index.
 *
 * ## Disposable, and that is the invariant rather than a caveat
 *
 * INV-FE-7: local storage is disposable, the transaction path never reads it, and rebuilds
 * are automatic. Two consequences are structural here rather than documented:
 *
 * - **No table on this schema is a transaction-precondition source.** That is enforced by
 *   the package firewall (`transaction-builder` and `signing` cannot import `local-index`,
 *   and `features/tx` cannot either), which is why this file can be pragmatic about
 *   corruption in a way the tx path never could be.
 * - **`FE-IDX-001`, the whole-database rebuild, is the *fallback*.** §7 says corruption
 *   invalidates *per range where detectable*, and only an undetectable or structural failure
 *   escalates. Reaching for the rebuild first would be simpler and would throw away weeks of
 *   verified layer-1 ingest to fix one bad range.
 *
 * ## The tables are declared once, here
 *
 * Dexie's schema strings are the migration record: a version's index declaration is what a
 * browser upgrades an existing database against. They are therefore **data**, exported and
 * asserted, rather than string literals threaded through a constructor call — a schema you
 * cannot read back is a migration you cannot review.
 */

import Dexie, { type Table } from 'dexie';

import { chainTag } from './chain-tag.js';
import {
  covered,
  sanitizeCoverage,
  type CoverageRef,
  type CoveredResult,
  type DroppedRange,
  type Hole,
} from './coverage.js';
import type { SampleProvenance } from './candles.js';
import type { Candle, DownsampledRange, PriceSample } from './candles.js';

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/**
 * §7's database name. Exported and tested, because the whole cross-chain-contamination
 * defence is this string being a function of the chain rather than a constant.
 *
 * The validation lives in `chainTag`, shared with the `fut-ingest` lock name: the two were
 * deriving the same suffix by different rules, and only one of them checked its argument.
 */
export function databaseName(paraGenesisHash: string): string {
  return `futarchy@${chainTag(paraGenesisHash)}`;
}

/**
 * One ingested event, per §6.5's decode discipline.
 *
 * A **discriminated union**, because the contract *"undecodable rows are stored raw"* was
 * previously a comment beside two independent optional fields: `decoded: false` with no
 * `raw` typechecked perfectly and stored an event that is neither readable nor recoverable —
 * the row exists, the count of pending-decoder events includes it, and there is nothing to
 * decode when its metadata arrives. Making the two fields one choice removes the state.
 */
export type StoredEvent = {
  /** `${block}:${eventIndex}`, deterministic so replay is idempotent. */
  readonly id: string;
  readonly blockNumber: number;
  readonly pallet: string;
  readonly name: string;
} & SampleProvenance &
  (
    | { readonly decoded: true; readonly raw?: undefined }
    /**
     * §6.5's raw row: kept for the era whose metadata was unavailable, surfaced as
     * "N events pending decoder", never guessed at. `raw` is required here — a raw row
     * without its bytes is a row that can never stop being pending.
     */
    | { readonly decoded: false; readonly raw: Uint8Array }
  );

export type StoredTxRow = {
  /** `txRowKey(block, index)` — block-ordered and replay-stable. */
  readonly id: string;
  readonly blockNumber: number;
  readonly extrinsicIndex: number;
  readonly account: string;
  readonly call: string;
} & SampleProvenance;

export type ProposalArchiveRow = {
  readonly proposalId: string;
  readonly settledAt: number;
  readonly summary: string;
  /** The events this summary replaced, so a compaction can be explained rather than counted. */
  readonly compactedEvents: number;
} & SampleProvenance;

export interface SnapshotImport {
  readonly id: string;
  readonly providerId: string;
  readonly importedAt: number;
  readonly fromBlock: number;
  readonly toBlock: number;
}

/**
 * §9.3's bounded metadata cache. `lastUsedAt` and `bytes` are required rather than optional:
 * the bound is enforced by evicting least-recently-used blobs, and a row that carried neither
 * would be permanently un-evictable — which is how the cache was unbounded in the first place.
 */
export interface MetadataBlob {
  readonly specVersion: number;
  readonly bytes: number;
  readonly lastUsedAt: number;
  readonly blob: Uint8Array;
}

/**
 * The `meta` table's rows. §7 replaced `cursor` with `coverage` for §6.3's holes.
 *
 * The second row is §9.2's obligation given somewhere to live: *"an evicted range becomes a
 * labelled 'downsampled' range, not a hole, and never a silent splice"*. `DownsampledRange`
 * was constructed and returned and no persisted structure held a resolution label, so the
 * sentence survived exactly as long as the value stayed in memory — one page reload and an
 * evicted range read as a fully-resolved one. It lives beside coverage because it is coverage
 * metadata, and because §9.2's own list of what the ladder never touches names coverage
 * metadata: the label has to be written by the same transaction that deletes the rows, or a
 * crash between them produces the silent splice the sentence forbids. This is the schema half
 * of SQ-606.
 */
export type MetaRow =
  | { readonly key: 'coverage'; readonly coverage: CoverageRef }
  | { readonly key: 'downsampled'; readonly ranges: readonly DownsampledRange[] };

/**
 * §7's schema, as data.
 *
 * `candles4h` and `candles1d` are present from version 1 rather than added later: §9.2's
 * ladder degrades *into* them, so a database that lacked them would have nowhere to put a
 * downsampled range and would fall back to eviction — silently trading depth the ladder was
 * designed to keep.
 */
export const SCHEMA_V1: Readonly<Record<string, string>> = Object.freeze({
  meta: 'key',
  // `decoded` is deliberately **not** indexed: a boolean is not a valid IndexedDB key, so the
  // index would hold nothing and every query against it would answer zero. See
  // `pendingDecoderCount`.
  events: 'id, blockNumber, [pallet+name], origin',
  // **Block-keyed, not wall-clock-keyed.** `[bookId+at]` made the primary key a function of
  // the device clock, so two observations of one book inside the same second overwrote each
  // other silently — and every other ingest key in this schema is deterministic and
  // block-derived precisely so a replay is idempotent. `at` remains a column (it is the
  // block's timestamp, and `bucketStart` needs it) but it does not identify the row.
  //
  // **`sourceKey` is in the key for a second, independent reason.** Once a chart row carries a
  // provenance (10 §2.3's mandatory labelling), two sources observing one book at one block are
  // two rows. Keyed without it they are one row, and which datum survives is decided by write
  // order — the label stays correct while the number under it becomes whichever source wrote
  // last. `foldCandles` refuses to merge across provenance in memory; this is the same refusal
  // at the storage layer, without which the in-memory rule is undone on the way to disk.
  priceSamples: '[bookId+sourceKey+blockNumber], bookId, blockNumber, at, origin',
  candles1h: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  candles4h: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  candles1d: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  proposalsArchive: 'proposalId, settledAt',
  txHistory: 'id, blockNumber, account',
  metadataCache: 'specVersion, lastUsedAt',
  snapshotsImported: 'id, providerId',
});

/** The compound primary keys `SCHEMA_V1` declares, as the table types name them. */
export type SampleKey = [string, string, number];
export type CandleKey = [string, string, number];

export class LocalIndex extends Dexie {
  declare meta: Table<MetaRow, string>;
  declare events: Table<StoredEvent, string>;
  declare priceSamples: Table<PriceSample, SampleKey>;
  declare candles1h: Table<Candle, CandleKey>;
  declare candles4h: Table<Candle, CandleKey>;
  declare candles1d: Table<Candle, CandleKey>;
  declare proposalsArchive: Table<ProposalArchiveRow, string>;
  declare txHistory: Table<StoredTxRow, string>;
  declare metadataCache: Table<MetadataBlob, number>;
  declare snapshotsImported: Table<SnapshotImport, string>;

  readonly paraGenesisHash: string;

  constructor(paraGenesisHash: string) {
    super(databaseName(paraGenesisHash));
    this.paraGenesisHash = paraGenesisHash;
    this.version(1).stores({ ...SCHEMA_V1 });
  }
}

/**
 * §6.3's coverage, read back with an explicit empty default.
 *
 * A fresh database has no `meta` row, and the distinction that matters is between *no
 * coverage recorded* and *coverage recorded as empty* — both render as "nothing verified
 * here", which is the truthful answer either way. What must never happen is a `undefined`
 * escaping into a renderer that treats it as full coverage, so the default is applied at the
 * boundary rather than left to each caller.
 */
export async function readCoverage(db: LocalIndex): Promise<CoverageRef> {
  return (await readCoverageRepair(db)).coverage;
}

/**
 * The same read, with what it had to drop.
 *
 * §6.3's validation ran only on the **mutation** path: `addRange` checked every range it was
 * handed, and the value came back out of IndexedDB unchecked into `isVerifiedAt`, which asks
 * only whether some range's origin is `self`. So a record corrupted in storage — the path
 * `assertCanonical`'s own comment calls *"exactly the untrusted path INV-FE-7 assumes gets
 * corrupted"* — was believed, and a `{ origin: 'self', fromBlock: 0, toBlock: 4294967295 }`
 * left by a partial write reported the entire chain as light-client verified.
 *
 * It **drops** rather than throws, because §6.3 says corruption of one range invalidates that
 * range and not the index. The dropped list is returned rather than logged so the boot path
 * can surface it — an index that silently shrank is one the user re-backfills without knowing
 * why the fan is running.
 */
export async function readCoverageRepair(
  db: LocalIndex,
): Promise<{ readonly coverage: CoverageRef; readonly dropped: readonly DroppedRange[] }> {
  const row = await db.meta.get('coverage');
  return sanitizeCoverage(row === undefined ? undefined : (row as { coverage?: unknown }).coverage);
}

/**
 * Persist coverage, validating on the way in.
 *
 * This function is **barrel-exported and bypasses `addRange`**, which is why it validates:
 * every guarantee `assertCanonical` maintains is a guarantee about values that went through
 * `addRange`, and one `writeCoverage(db, anything)` puts a value into the store that never
 * did. Dropping rather than refusing keeps it symmetric with the read: the same fault has the
 * same disposal whichever side of storage it is found on.
 */
export async function writeCoverage(
  db: LocalIndex,
  coverage: CoverageRef,
): Promise<readonly DroppedRange[]> {
  const repaired = sanitizeCoverage(coverage);
  await db.meta.put({ key: 'coverage', coverage: repaired.coverage });
  return repaired.dropped;
}

/** §9.2's downsampled labels, read back with an empty default. */
export async function readDownsampled(db: LocalIndex): Promise<readonly DownsampledRange[]> {
  const row = await db.meta.get('downsampled');
  if (row === undefined || row.key !== 'downsampled' || !Array.isArray(row.ranges)) return [];
  return row.ranges;
}

/**
 * §6.3's *"data **plus** the coverage it came from"* on the read path.
 *
 * Every history read goes through this rather than returning bare rows, because bare rows
 * render as a complete series: *"there were no observations in this window"* and *"we never
 * ingested this window"* arrive as the same empty array, and the second is the silent splice
 * §6.3 forbids. The coverage is read through `readCoverage`, so it is sanitized on the way out
 * of storage exactly as it is on the way in.
 *
 * `read` is a callback rather than a table argument so this cannot become "the covered query
 * for price samples" and then a second, uncovered one for everything else — the wrapping is
 * the boundary, and the boundary is one function.
 */
export async function coveredQuery<T>(
  db: LocalIndex,
  span: Hole,
  read: (db: LocalIndex) => Promise<T>,
): Promise<CoveredResult<T>> {
  const coverage = await readCoverage(db);
  return covered(coverage, span, await read(db));
}

/**
 * The raw observations for one book inside a block span, with the coverage they came from.
 *
 * Deliberately **not** filtered to one provenance. A chart that silently showed only the
 * verified rows would draw a line with invisible gaps where an indexer supplied the data; the
 * rows carry their origin and the answer carries its ranges, so the renderer can hatch the
 * provider segments rather than the client deciding for it what the user may see.
 */
export async function coveredSamples(
  db: LocalIndex,
  bookId: string,
  span: Hole,
): Promise<CoveredResult<readonly PriceSample[]>> {
  return coveredQuery(db, span, async () =>
    db.priceSamples
      .where('bookId')
      .equals(bookId)
      .filter((s) => s.blockNumber >= span.fromBlock && s.blockNumber <= span.toBlock)
      .sortBy('blockNumber'),
  );
}

/**
 * Persist §9.2's downsampled labels **in the caller's transaction**.
 *
 * §9.2 makes the label part of the eviction rather than a note about it: *"an evicted range
 * becomes a labelled 'downsampled' range, not a hole, and never a silent splice"*. Written
 * after the delete in a second transaction, a crash between them leaves the raw rows gone and
 * no label — which is exactly the silent splice, produced by the one failure the ladder is
 * most likely to meet (a tab closed mid-eviction). So this takes no transaction of its own and
 * **must** be called inside the `rw` that deletes the rows; `applyQuota` is the only caller and
 * does so.
 */
export async function writeDownsampled(
  db: LocalIndex,
  ranges: readonly DownsampledRange[],
): Promise<void> {
  await db.meta.put({ key: 'downsampled', ranges });
}

/**
 * §9.3's bounds — **all three of them**.
 *
 * The section states three obligations and an earlier draft enforced one:
 *
 * > bounded at **≤ 8 blobs / ≤ 15 MB desktop, ≤ 3 blobs / ≤ 3.75 MB mobile**, LRU-evicted; the
 * > current and next-authorized runtime's metadata are pinned non-evictable.
 *
 * A byte budget alone lets an unbounded number of small blobs accumulate, and — the sharper
 * failure — LRU with no pin set evicts **the current runtime's metadata**, which §9.3 declares
 * non-evictable. That blob is the one every live decode uses, so evicting it turns the whole
 * current era into "pending decoder" rows in order to save a few megabytes — and at the measured
 * 0.14 MB per blob it is the **count** limit that binds, not the bytes.
 *
 * A budget whose pinned set alone does not fit is **refused**, not satisfied by evicting a
 * pin. That state is a release-configuration error — more pinned runtimes than the platform
 * budget admits — and silently dropping a pin would report success while doing the one thing
 * the section forbids.
 *
 * Returns what it evicted rather than a count: an evicted blob means the rows decoded with it
 * can no longer be re-decoded from cache, and §6.5's "N events pending decoder" surface needs
 * to know which spec versions those were.
 */
export interface MetadataBudget {
  /** §9.3's blob-count cap: 8 desktop, 3 mobile. */
  readonly maxBlobs: number;
  /** §9.3's byte cap: 15 MB desktop, 3.75 MB mobile — §9.2's metadata share exactly (SQ-557). */
  readonly maxBytes: number;
  /** Spec versions that may never be evicted: the current and next-authorized runtimes. */
  readonly pinned: readonly number[];
}

export async function evictMetadataToBudget(
  db: LocalIndex,
  budget: MetadataBudget,
): Promise<number[]> {
  const { maxBlobs, maxBytes, pinned } = budget;
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new StoreError(`${maxBytes} is not a byte budget`);
  }
  if (!Number.isInteger(maxBlobs) || maxBlobs < 0) {
    throw new StoreError(`${maxBlobs} is not a blob count`);
  }
  const pins = new Set(pinned);
  const blobs = await db.metadataCache.orderBy('lastUsedAt').toArray();

  const pinnedBlobs = blobs.filter((blob) => pins.has(blob.specVersion));
  const pinnedBytes = pinnedBlobs.reduce((sum, blob) => sum + blob.bytes, 0);
  if (pinnedBlobs.length > maxBlobs || pinnedBytes > maxBytes) {
    throw new StoreError(
      `the pinned metadata alone is ${pinnedBlobs.length} blob(s) / ${pinnedBytes} B, past the ` +
        `budget of ${maxBlobs} / ${maxBytes} B. 10 §9.3 pins the current and next-authorized ` +
        'runtimes non-evictable, so this cannot be resolved by evicting one — it is a release ' +
        'configuration that does not fit its own platform budget.',
    );
  }

  let count = blobs.length;
  let total = blobs.reduce((sum, blob) => sum + blob.bytes, 0);
  const evicted: number[] = [];
  for (const blob of blobs) {
    if (count <= maxBlobs && total <= maxBytes) break;
    if (pins.has(blob.specVersion)) continue;
    await db.metadataCache.delete(blob.specVersion);
    count -= 1;
    total -= blob.bytes;
    evicted.push(blob.specVersion);
  }
  return evicted;
}

/**
 * Read a cached metadata blob and record the use — §9.3's LRU, and §6.5's decode discipline.
 *
 * `metadataCache` was declared, bounded and **never consulted**: nothing read a blob and
 * nothing updated `lastUsedAt`, so the eviction order was the insertion order wearing an LRU
 * label. A cache nobody reads evicts by age of arrival, which for metadata means the *oldest
 * era* is discarded first — precisely the blob the deepest rows need, and precisely the rows
 * that cannot be re-decoded any other way.
 *
 * Returns `undefined` for an absent era rather than throwing. That is §6.5's raw-row path:
 * the caller stores the event raw and counts it as pending, and does **not** guess with the
 * metadata it happens to have.
 */
export async function readMetadataBlob(
  db: LocalIndex,
  specVersion: number,
  now: number,
): Promise<MetadataBlob | undefined> {
  const blob = await db.metadataCache.get(specVersion);
  if (blob === undefined) return undefined;
  if (!Number.isFinite(now) || now < 0) throw new StoreError(`${now} is not a use time`);
  await db.metadataCache.put({ ...blob, lastUsedAt: now });
  return blob;
}

/**
 * §6.5's *"N events pending decoder"*, as the number that surface renders.
 *
 * A filter rather than an index lookup, and that is not laziness. **A boolean is not a valid
 * IndexedDB key**: a store declaring `decoded` as an index would silently index nothing, and
 * `where('decoded').equals(false)` would answer **zero pending rows** — which reads as
 * *everything decoded*, the one wrong answer this surface must never give, delivered by a
 * query that looks more careful than the scan. The table is bounded by §9.2's quota manager,
 * so the scan is bounded too.
 */
export async function pendingDecoderCount(db: LocalIndex): Promise<number> {
  return db.events.filter((event) => event.decoded === false).count();
}

/**
 * `FE-IDX-001` — the whole-database rebuild, and it is the **fallback**.
 *
 * §7: "corruption invalidates per-range, not whole-index (where detectable); whole-DB rebuild
 * (`FE-IDX-001`) remains the fallback". So this function is deliberately awkward to reach for:
 * it takes the reason it is being used, and the reason is recorded, because a rebuild that
 * happens silently is indistinguishable from a first run — and a client that rebuilds on
 * every load has an infinite backfill loop nobody notices, only a fan that never stops.
 */
export interface RebuildRecord {
  readonly reason: string;
  readonly at: number;
}

export async function rebuild(db: LocalIndex, record: RebuildRecord): Promise<RebuildRecord> {
  if (!record.reason || record.reason.trim().length === 0) {
    throw new StoreError(
      'FE-IDX-001 needs a reason. A rebuild that happens silently is indistinguishable from a ' +
        'first run, and a client that rebuilds on every load backfills forever without anyone noticing.',
    );
  }
  await db.delete();
  await db.open();
  return record;
}
