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

import Dexie, { type Table, type Transaction } from 'dexie';

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
import type { Candle, DownsampledRange, PriceSample, Resolution } from './candles.js';

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
    | { readonly decoded: true; readonly raw?: undefined; readonly pendingBlock?: undefined }
    /**
     * §6.5's raw row: kept for the era whose metadata was unavailable, surfaced as
     * "N events pending decoder", never guessed at. `raw` is required here — a raw row
     * without its bytes is a row that can never stop being pending.
     *
     * `pendingBlock` repeats the block number and is present on **this arm only**, which is
     * what makes it a sparse index. It exists because the pending set has to be *enumerable
     * and orderable* — 10 §9.1 forbids retaining chain-wide event data and this blob holds a
     * whole block's `System.Events` regardless of the watched set, so the set needs a bound
     * and the bound needs oldest-first order. A boolean cannot serve: it is not a valid
     * IndexedDB key, so an index on `decoded` holds nothing and answers zero.
     */
    | { readonly decoded: false; readonly raw: Uint8Array; readonly pendingBlock: number }
  );

/**
 * The id §6.5's raw row is stored under.
 *
 * One function, because the writer that creates it and the writer that **retires** it must
 * agree byte for byte: a re-ingest with the era's metadata deletes this id in the same
 * transaction that writes the decoded rows, and a second spelling would leave the block stored
 * twice with "N events pending decoder" permanently one too high.
 */
export function rawEventId(blockNumber: number): string {
  return `${blockNumber}:raw`;
}

/** The table a candle of a given resolution lives in. */
export function candleTableFor(
  resolution: Exclude<Resolution, 'raw'>,
): 'candles1h' | 'candles4h' | 'candles1d' {
  const table = CANDLE_TABLE[resolution];
  if (table === undefined) throw new StoreError(`${resolution} has no candle table`);
  return table;
}

const CANDLE_TABLE: Readonly<
  Record<Exclude<Resolution, 'raw'>, 'candles1h' | 'candles4h' | 'candles1d'>
> = Object.freeze({
  candles1h: 'candles1h',
  candles4h: 'candles4h',
  candles1d: 'candles1d',
});

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

/**
 * §7's `snapshotsImported` row.
 *
 * `providerId` is **not** declared here: it arrives with `SampleProvenance`, which §7 requires
 * of *"every row"*. Declaring it twice would be two spellings of one fact, and the shape that
 * lets one of them be dropped in transit is exactly the one INV-FE-15 forbids. Its `self` arm
 * is uninhabitable by construction, which is correct — a snapshot the client produced itself is
 * not a snapshot import.
 */
export type SnapshotImport = {
  readonly id: string;
  readonly importedAt: number;
  readonly fromBlock: number;
  readonly toBlock: number;
} & SampleProvenance;

/**
 * §9.3's bounded metadata cache. `lastUsedAt` and `bytes` are required rather than optional:
 * the bound is enforced by evicting least-recently-used blobs, and a row that carried neither
 * would be permanently un-evictable — which is how the cache was unbounded in the first place.
 */
export type MetadataBlob = {
  readonly specVersion: number;
  readonly bytes: number;
  readonly lastUsedAt: number;
  readonly blob: Uint8Array;
} & SampleProvenance;

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
  | { readonly key: 'downsampled'; readonly ranges: readonly DownsampledRange[] }
  | { readonly key: 'pendingRawEvicted'; readonly record: PendingRawEvictionRecord }
  | { readonly key: 'chartDiscard'; readonly record: ChartDiscardRecord };

/**
 * What the client discarded when §6.5's raw blobs were bounded — the label without which the
 * bound is a silent splice.
 *
 * §6.5 requires an undecodable block's `System.Events` value to be kept raw and counted; §9.1
 * forbids retaining chain-wide event data, and one raw blob is exactly that — a whole block's
 * events regardless of the watched set. The two cannot both hold without a bound, and a bound
 * that drops bytes without saying so leaves the block covered, decoded-looking and empty. The
 * tension itself is a spec question (SQ-760); what this row does is make the disposal visible.
 *
 * A **summary**, not a list, because the list is the thing being bounded: an append-only record
 * of every discarded block reproduces the growth the eviction was run to stop. The envelope
 * (`oldestBlock`..`newestBlock`) plus the count is what a surface needs to say *"the events of N
 * blocks in this span can no longer be decoded"*, which is the true sentence.
 */
export interface PendingRawEvictionRecord {
  readonly blocks: number;
  readonly bytes: number;
  readonly oldestBlock: number;
  readonly newestBlock: number;
  /** When the most recent eviction ran. */
  readonly at: number;
  /** Rendered, not logged. */
  readonly reason: string;
}

/**
 * What a schema migration discarded — the label without which the drop is a silent splice.
 *
 * The v1 → v3 upgrade **empties** `priceSamples` and the three candle tables, and that loss is
 * permitted: INV-FE-7 makes browser-local storage a non-authoritative cache whose loss is *"a
 * performance and convenience event only"*, §9.2 classifies chart resolution as the tier the
 * ladder degrades first, and the alternative is worse — IndexedDB fixes a key path at creation
 * and Dexie refuses to change one in place, so declaring the corrected keys under `version(1)`
 * makes an existing database **fail to open**, which is the one outcome INV-FE-7 says the client
 * must survive.
 *
 * **Performing it silently is not permitted, and that is a separable fault.** `meta.coverage`
 * carries through the upgrade unchanged, so afterwards `coveredSamples` answers a covered span
 * with an empty array and a table states *"complete within [ranges]"* over nothing. INV-FE-15
 * requires everything unverified to be *"either absent **with an explanation** or present and
 * labeled — gaps are first-class and visible, never silently spliced"*, and §9.2 states the
 * identical rule for this exact operation: *"an evicted range becomes a labelled 'downsampled'
 * range, not a hole, and never a silent splice"*. One `meta.put` inside the upgrade transaction
 * separates the loss from the false claim, which is why the drop stays and this record exists.
 *
 * Its precedent is `PendingRawEvictionRecord` above, and it is deliberately the same shape: a
 * summary written in the transaction that performs the disposal, read back by the boot path.
 */
/**
 * The block envelope a discard record names — **three states, not two numbers**.
 *
 * The first draft carried `fromBlock`/`toBlock` as `number | undefined`, and `undefined` had two
 * meanings that a surface has to tell apart: *the coverage row named no blocks* and *the coverage
 * row could not be read*. The second is a corruption event INV-FE-7 expects and the first is the
 * ordinary state of a client that has charted nothing, so one encoding for both makes every
 * rendering of it wrong in one direction — announcing corruption that did not happen, or hiding
 * one that did. `discardOver` treats the two identically (neither can rule out overlap, so both
 * report for every span), which is why the distinction had to live in the datum rather than in
 * the disposal.
 */
export type ChartDiscardSpan =
  /** The envelope `meta.coverage` claimed when the migration ran. */
  | { readonly kind: 'named'; readonly fromBlock: number; readonly toBlock: number }
  /** Coverage was readable and claimed nothing — the rows sat over blocks nothing covers. */
  | { readonly kind: 'none' }
  /** The coverage row could not be parsed, so the span cannot be named at all. */
  | { readonly kind: 'unreadable' };

export interface ChartDiscardRecord {
  /** The schema the database was at, and the one it reached. */
  readonly fromSchema: number;
  readonly toSchema: number;
  /** The tables emptied — `REKEYED_TABLES`, named rather than described. */
  readonly tables: readonly string[];
  /** How many rows went, counted before the drop. */
  readonly rows: number;
  /**
   * The block envelope `meta.coverage` still claims, and over which the chart tiers are now
   * empty. That is the span the record has to name: it is exactly where the surviving coverage
   * and the surviving rows disagree.
   */
  readonly span: ChartDiscardSpan;
  readonly at: number;
  /**
   * A **technical** statement, for the boot report and an expert panel.
   *
   * Deliberately not user-facing copy. `FE-IDX-002` has no definition yet (SQ-604 asks for one)
   * and a migration discard is a distinct failure class from the per-range invalidation that row
   * names — so the machine-readable record ships now and the fixed user copy binds when SQ-604
   * rules. 10 §9.4 requires fixed copy per error code, which is precisely what may not be
   * invented here.
   */
  readonly detail: string;
}

/**
 * The three Dexie versions this schema has had.
 *
 * Named because three places have to agree on them and only one of them is the constructor: the
 * declaration below, the migration record that states which schema a database left and which it
 * reached, and the suite that checks the pair. `ChartDiscardRecord` exists to be accurate about
 * what happened, so the one field it could get wrong by copying is the one that may not be a
 * literal.
 */
export const SCHEMA_V1_VERSION = 1;
/** The version that **drops** the re-keyed tables — see `LocalIndex`'s three-version recipe. */
export const REKEY_VERSION = 2;
/** The version that re-declares them under `SCHEMA_V3`, and the schema an upgrade reaches. */
export const SCHEMA_V3_VERSION = 3;

/**
 * §7's schema **as first shipped**, kept because a browser that opened it is what a migration
 * has to upgrade from.
 *
 * Two of its declarations were wrong and both were primary keys, which is the one thing a
 * Dexie version cannot quietly change: `priceSamples` was keyed on the *device clock*
 * (`[bookId+at]`), so two observations of one book inside the same second overwrote each other,
 * and the chart tables were keyed without the row's source, so two sources' bars for one bucket
 * collapsed into one row whose number is whichever wrote last. `SCHEMA_V3` fixes both — see
 * `LocalIndex`, where the upgrade has to drop the tables before it can re-declare them.
 *
 * `candles4h` and `candles1d` are present from version 1 rather than added later: §9.2's
 * ladder degrades *into* them, so a database that lacked them would have nowhere to put a
 * downsampled range and would fall back to eviction — silently trading depth the ladder was
 * designed to keep.
 */
export const SCHEMA_V1: Readonly<Record<string, string>> = Object.freeze({
  meta: 'key',
  events: 'id, blockNumber, [pallet+name], origin',
  priceSamples: '[bookId+at], bookId, blockNumber, at, origin',
  candles1h: '[bookId+openAt], bookId, openAt, toBlock',
  candles4h: '[bookId+openAt], bookId, openAt, toBlock',
  candles1d: '[bookId+openAt], bookId, openAt, toBlock',
  proposalsArchive: 'proposalId, settledAt',
  txHistory: 'id, blockNumber, account',
  metadataCache: 'specVersion, lastUsedAt',
  snapshotsImported: 'id, providerId',
});

/**
 * The chart tables `SCHEMA_V3` re-keys. Named as data because the upgrade has to mention them
 * **twice** — once to drop, once to re-declare — and two hand-written lists is how one of them
 * ends up short by a table nobody notices until a query returns the wrong row.
 */
export const REKEYED_TABLES: readonly string[] = Object.freeze([
  'priceSamples',
  'candles1h',
  'candles4h',
  'candles1d',
]);

/**
 * §7's schema as it now stands.
 *
 * Three declarations differ from `SCHEMA_V1` and each is load-bearing:
 *
 * - **`priceSamples` is block-keyed, not wall-clock-keyed.** `[bookId+at]` made the primary key
 *   a function of the device clock; every other ingest key here is deterministic and
 *   block-derived precisely so a replay is idempotent. `at` remains a column (it is the block's
 *   timestamp, and `bucketStart` needs it) but it does not identify the row.
 * - **`sourceKey` is in every chart row's key.** Once a chart row carries a provenance (10 §2.3's
 *   mandatory labelling), two sources observing one book at one block are two rows. Keyed
 *   without it they are one row, and which datum survives is decided by write order — the label
 *   stays correct while the number under it becomes whichever source wrote last. `foldCandles`
 *   refuses to merge across provenance in memory; this is the same refusal at the storage layer,
 *   without which the in-memory rule is undone on the way to disk.
 * - **`events` indexes `pendingBlock`.** `decoded` is deliberately *not* indexed: a boolean is
 *   not a valid IndexedDB key, so the index would hold nothing and every query against it would
 *   answer zero (see `pendingDecoderCount`). `pendingBlock` is present only on a raw row, so the
 *   index is sparse and enumerates exactly the pending set, oldest first — which is what bounds
 *   it (`evictPendingRawToBound`).
 */
export const SCHEMA_V3: Readonly<Record<string, string>> = Object.freeze({
  meta: 'key',
  events: 'id, blockNumber, [pallet+name], origin, pendingBlock',
  priceSamples: '[bookId+sourceKey+blockNumber], bookId, blockNumber, at, origin',
  candles1h: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  candles4h: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  candles1d: '[bookId+sourceKey+openAt], bookId, openAt, toBlock',
  proposalsArchive: 'proposalId, settledAt',
  txHistory: 'id, blockNumber, account',
  metadataCache: 'specVersion, lastUsedAt',
  snapshotsImported: 'id, providerId',
});

/** The compound primary keys `SCHEMA_V3` declares, as the table types name them. */
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
    // **The migration is three versions and it has to be**, which is the part a single
    // `version(1)` declaring the new keys hid. IndexedDB fixes a store's key path at creation
    // and Dexie refuses to change one in place (*"Not yet support for changing primary key"*),
    // so a browser holding version 1 would not silently keep the old key path — it would fail
    // to open at all, on the one structure INV-FE-7 says the client must survive losing. The
    // published recipe is to drop the table in one version and re-declare it in the next.
    //
    // Dropping chart rows on upgrade is the honest cost and it is bounded: local storage is
    // disposable (INV-FE-7), the ladder's own tables are the ones re-keyed, and coverage,
    // `txHistory`, `events` and the metadata cache all carry through untouched — so what a user
    // loses is chart depth that re-accumulates, not history that cannot be recovered.
    //
    // **Each version records what it does**, which is the half the first draft left out. The
    // drop is permitted; performing it silently is not (see `ChartDiscardRecord`), and the
    // `pendingBlock` index version 3 declares is sparse — so a version-1 raw row carries no such
    // field, is invisible to the index, and makes `pendingRawRows` refuse **permanently**. The
    // upgraders are where both are repaired, because both are properties of the data that
    // crossed the boundary rather than of anything a later caller can supply.
    this.version(SCHEMA_V1_VERSION).stores({ ...SCHEMA_V1 });
    this.version(REKEY_VERSION)
      .stores(Object.fromEntries(REKEYED_TABLES.map((table) => [table, null])))
      .upgrade(recordChartDiscard);
    this.version(SCHEMA_V3_VERSION).stores({ ...SCHEMA_V3 }).upgrade(backfillPendingBlock);
  }
}

/**
 * Record the chart rows this version is about to drop — **in the transaction that drops them**.
 *
 * It runs on `version(2)`, the version that deletes the four tables, and it can still read them:
 * Dexie restores a version's deleted tables into the upgrade transaction's schema
 * (`upgradeSchema[table] = oldSchema[table]` for every `diff.del`) and queues
 * `deleteRemovedTables` as a **separate step after** the content upgrade. So this is the last
 * moment the rows can be counted, and it is inside the same `versionchange` transaction as the
 * delete — which is §9.2 obligation 1 applied to a migration: a label written afterwards is
 * absent for exactly as long as it takes a tab to close mid-upgrade.
 *
 * A count of zero writes nothing. A fresh database has empty tables, and a record announcing
 * that nothing was lost is noise a boot report would have to learn to ignore.
 */
async function recordChartDiscard(tx: Transaction): Promise<void> {
  let rows = 0;
  for (const table of REKEYED_TABLES) rows += await tx.table(table).count();
  if (rows === 0) return;
  const record: ChartDiscardRecord = {
    // **Neither number is copied.** `toSchema` is the version this open is upgrading to, read off
    // the database itself, so adding a `version(4)` cannot leave the record claiming the schema
    // stopped at 3. `fromSchema` is `SCHEMA_V1_VERSION` by construction rather than by assumption:
    // this upgrader belongs to `REKEY_VERSION`, so it runs only for a database below that version,
    // the sole released schema below it is version 1, and a database created from nothing never
    // runs a version's upgrader at all (measured — which is also why the zero-row guard above
    // needs a real version-1 fixture to be exercised).
    fromSchema: SCHEMA_V1_VERSION,
    toSchema: tx.db.verno,
    tables: [...REKEYED_TABLES],
    rows,
    span: coverageEnvelope(await tx.table('meta').get('coverage')),
    at: Date.now(),
    detail:
      'the chart tables were re-keyed (priceSamples gained sourceKey and lost the device clock; ' +
      'the candle tables gained sourceKey) and IndexedDB cannot change a key path in place, so ' +
      'their rows were dropped on upgrade. Coverage, txHistory, events and the metadata cache ' +
      'carried through: the blocks are still covered, and the chart tiers over them are empty ' +
      'until they re-accumulate.',
  };
  await tx.table('meta').put({ key: 'chartDiscard', record });
}

/**
 * Give every raw row the `pendingBlock` the sparse index needs — the version that declares the
 * index is the version that has to populate it.
 *
 * A version-1 `${block}:raw` row predates the field, so `orderBy('pendingBlock')` cannot see it
 * while `pendingDecoderCount`'s full scan can. `pendingRawRows` compares the two and refuses on a
 * disagreement — correctly, because a bound that silently does not cover everything is worse than
 * no bound — and the disagreement is **permanent** without this: nothing else ever writes the
 * field onto an existing row, `measureUsage` is the first call in `applyQuota`, and a raw row is
 * *"the expected state of any backfill across a runtime upgrade"* (§6.5). So one upgraded
 * database refused every retention pass it would ever run.
 *
 * `filter` before `modify` so only the rows that need it are written; the scan is unavoidable
 * because `decoded` is a boolean and therefore not an IndexedDB key (see `pendingDecoderCount`),
 * which is the whole reason `pendingBlock` exists.
 */
async function backfillPendingBlock(tx: Transaction): Promise<void> {
  type RawRow = { readonly decoded: boolean; readonly blockNumber: number; pendingBlock?: number };
  await tx
    .table<RawRow>('events')
    .filter((event) => event.decoded === false && event.pendingBlock === undefined)
    .modify((event) => {
      event.pendingBlock = event.blockNumber;
    });
}

/**
 * The block envelope of a stored coverage value, read defensively.
 *
 * The argument comes straight out of IndexedDB during an upgrade, which is *"exactly the
 * untrusted path INV-FE-7 assumes gets corrupted"* — and `sanitizeCoverage` is not available
 * here, because it needs the genesis hash and would drop rather than summarise. A malformed
 * range contributes nothing rather than making the whole record unwritable: the point of the
 * record is that the drop is announced, and an unparseable span is a reason to say *"we cannot
 * name the span"*, never a reason to say nothing at all.
 *
 * **The two ways of naming no span stay apart.** An empty coverage list is an ordinary client
 * that charted nothing; a coverage row that will not parse is the corruption INV-FE-7 expects.
 * Both leave the envelope unnamed and they are not the same sentence to a reader, so they are
 * two arms rather than one `undefined` (see `ChartDiscardSpan`).
 */
function coverageEnvelope(row: unknown): ChartDiscardSpan {
  const coverage = (row as { coverage?: unknown } | undefined)?.coverage;
  const ranges = (coverage as { ranges?: unknown } | undefined)?.ranges;
  if (!Array.isArray(ranges)) return { kind: 'unreadable' };
  if (ranges.length === 0) return { kind: 'none' };
  let fromBlock: number | undefined;
  let toBlock: number | undefined;
  for (const range of ranges) {
    const from = (range as { fromBlock?: unknown }).fromBlock;
    const to = (range as { toBlock?: unknown }).toBlock;
    if (typeof from !== 'number' || typeof to !== 'number') continue;
    if (fromBlock === undefined || from < fromBlock) fromBlock = from;
    if (toBlock === undefined || to > toBlock) toBlock = to;
  }
  // Ranges were present and none of them named two block numbers: the row exists and cannot be
  // read, which is the corruption arm rather than the empty one.
  if (fromBlock === undefined || toBlock === undefined) return { kind: 'unreadable' };
  return { kind: 'named', fromBlock, toBlock };
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
  // Against **this database's own chain**, never a majority of what was stored: the store knows
  // its genesis (it is in the database name), so there is nothing to infer from untrusted rows.
  return sanitizeCoverage(
    row === undefined ? undefined : (row as { coverage?: unknown }).coverage,
    db.paraGenesisHash,
  );
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
  const repaired = sanitizeCoverage(coverage, db.paraGenesisHash);
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
 * A history answer **and every reason its rows can be absent over blocks that are still covered**.
 *
 * §6.3's `CoveredResult<T>` has three fields — `ranges`, `holes` and `span` — and each is about
 * *coverage*: what was ingested. Nothing in it can say that a block was ingested, is still
 * covered, and is **no longer held at any resolution**. That third state is produced by §9.2's
 * ladder (where a coarser rung survives, `downsampled`) and by a schema migration or repair
 * (where nothing survives, `chartDiscard`), and until this type existed both were written to
 * `meta` rows the query path never read — so `coveredSamples` answered a covered span with an
 * empty array, no hole and no explanation, which is exactly the reading §6.3's opening rule
 * forbids: *"bare rows render as a complete series and 'there were no observations in this
 * window' and 'we never ingested this window' then arrive as the same empty answer"*.
 *
 * **The explanation is attached to the absence, on the path that renders it.** A record written
 * to a channel no consumer consults explains nothing; INV-FE-15 requires everything unverified to
 * be *"either absent **with an explanation** or present and labeled"*, and an explanation the
 * caller has to know to go and fetch is one that will be missing wherever it matters most.
 *
 * The shape is a **container** rather than three more fields on `CoveredResult`, and that is
 * deliberate on two counts. It leaves §6.3's published interface exactly as the section declares
 * it, because *which* of these three repairs is right — a field on `CoveredResult`, trimming
 * `CoverageRange` on discard, or an obligation on every consumer to consult `meta` — is a spec
 * question (SQ-821) and answering it here would be inventing the vocabulary §6.3 does not have
 * (SQ-820). And it makes the sibling fields unavoidable at the point a caller reaches the rows:
 * `answer.data` no longer typechecks, so nobody can carry the old bare-rows reading forward
 * without seeing what else the answer carries.
 */
export interface CoveredHistory<T> {
  /** §6.3's own answer, unchanged. */
  readonly covered: CoveredResult<T>;
  /**
   * §9.2's labels overlapping the span — blocks whose finer rows were folded away and which are
   * still held, one rung coarser. Unclipped, for the same reason `CoveredResult.ranges` are: the
   * renderer intersects for display, and clipping would publish a range nothing recorded.
   */
  readonly downsampled: readonly DownsampledRange[];
  /**
   * A migration discard whose block envelope overlaps the span, and therefore explains rows that
   * are missing here. `undefined` when none does.
   *
   * A record whose envelope was not `named` — the coverage row claimed nothing, or could not be
   * read at all when the migration ran — is reported for **every** span: overlap cannot be ruled
   * out, and dropping the explanation on *cannot say* is the one disposal that turns an announced
   * loss back into a silent one.
   */
  readonly chartDiscard: ChartDiscardRecord | undefined;
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
 * It also reads the two channels that record rows *removed* from a covered span — see
 * `CoveredHistory`. Three `meta` gets rather than one is the whole cost, on a table that holds
 * one row per key.
 *
 * `read` is a callback rather than a table argument so this cannot become "the covered query
 * for price samples" and then a second, uncovered one for everything else — the wrapping is
 * the boundary, and the boundary is one function.
 *
 * ## All four reads are one transaction, and the order inside it is not arbitrary
 *
 * The first version resolved the three labels through `Promise.all` and *then* awaited `read`:
 * four separate IndexedDB transactions, with the retention ladder free to commit between them.
 * A fold that lands in that window deletes rows the answer has already missed and writes the
 * label after it was already read, so the answer carries rows that are gone beside labels that
 * predate the deletion — the silent splice §9.2 obligation 1 binds the label to the delete to
 * prevent, reassembled on the read side.
 *
 * One `db.transaction('r', …)` removes the window. The **order** is kept anyway, because it is
 * the property that survives a future refactor dropping the transaction: labels only ever grow
 * (§9.2's ladder adds them and nothing retracts one), so reading rows **first** and labels after
 * can only over-explain — an answer claiming a label for rows it still holds. The reverse can
 * under-explain, which is the direction that renders as a complete series.
 *
 * Two constraints follow and both fail loudly rather than quietly, which is why they are stated
 * here instead of being designed around. `read` must issue Dexie operations only: awaiting
 * anything else inside a transaction scope lets it commit early. And a covered read may not be
 * called from **inside** a narrower transaction — Dexie refuses a sub-transaction whose scope is
 * wider than its parent's. Neither can produce a wrong answer, only a refused one.
 */
export async function coveredQuery<T>(
  db: LocalIndex,
  span: Hole,
  read: (db: LocalIndex) => Promise<T>,
): Promise<CoveredHistory<T>> {
  // Every table, because `read` is a caller's callback and this function cannot know which ones
  // it touches; a narrower scope would refuse the second covered read somebody writes.
  const [data, coverage, labels, discard] = await db.transaction('r', db.tables, async () => {
    const rows = await read(db);
    return [rows, await readCoverage(db), await readDownsampled(db), await readChartDiscard(db)] as const;
  });
  const result = covered(coverage, span, data);
  return {
    covered: result,
    downsampled: labels.filter(
      (range) => range.toBlock >= result.span.fromBlock && range.fromBlock <= result.span.toBlock,
    ),
    chartDiscard: discardOver(discard, result.span),
  };
}

/** A discard record is reported when it can overlap the span — and when it cannot say. */
function discardOver(
  discard: ChartDiscardRecord | undefined,
  span: Hole,
): ChartDiscardRecord | undefined {
  if (discard === undefined) return undefined;
  // `none` and `unreadable` are different sentences to a reader and the same disposal here:
  // neither names blocks, so neither can rule the overlap out, and dropping the explanation on
  // *cannot say* is what turns an announced loss back into a silent one.
  if (discard.span.kind !== 'named') return discard;
  return discard.span.toBlock >= span.fromBlock && discard.span.fromBlock <= span.toBlock
    ? discard
    : undefined;
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
): Promise<CoveredHistory<readonly PriceSample[]>> {
  return coveredQuery(db, span, async () =>
    db.priceSamples
      .where('bookId')
      .equals(bookId)
      .filter((s) => s.blockNumber >= span.fromBlock && s.blockNumber <= span.toBlock)
      .sortBy('blockNumber'),
  );
}

/**
 * One book's candles at one rung, with the coverage they came from — the **candle tier's** covered
 * read, and the reason `coveredQuery` was written generic.
 *
 * `coveredSamples` was this package's only covered read, and it serves `priceSamples`: the tier
 * SQ-782 records as having **no producer in production** — `priceSample()` has no caller outside
 * the suites, so the raw table is permanently empty and every disclosure attached to it fires over
 * nothing. The tier that a production writer does fill is `candles1h`, folded per block by
 * `storeWriter` from §9.1's scan-time aggregate, and it had no covered path at all. So the whole
 * §6.3 apparatus pointed at the empty tier while the full one could be reached only as bare rows —
 * which is the reading *"never bare rows"* exists to forbid, arriving by the one route left open.
 *
 * **Overlapping, not contained.** A bucket that straddles the edge of the question is returned,
 * because a candle is a summary of a block span and dropping the straddling bar would silently
 * narrow the answer at both ends — the renderer clips for display exactly as it does for
 * `CoveredResult.ranges`.
 *
 * **Not filtered to one provenance**, for the same reason `coveredSamples` is not: two sources'
 * bars for one bucket are two rows by primary key (§7), they each carry their origin, and hiding
 * the provider ones would draw a line with invisible gaps.
 */
export async function coveredCandles(
  db: LocalIndex,
  bookId: string,
  resolution: Exclude<Resolution, 'raw'>,
  span: Hole,
): Promise<CoveredHistory<readonly Candle[]>> {
  // Resolved before the transaction opens, so an unknown rung is a `StoreError` naming the rung
  // rather than a Dexie failure naming a table that does not exist.
  const table = candleTableFor(resolution);
  return coveredQuery(db, span, async (inner) =>
    inner
      .table<Candle, CandleKey>(table)
      .where('bookId')
      .equals(bookId)
      .filter((candle) => candle.toBlock >= span.fromBlock && candle.fromBlock <= span.toBlock)
      .sortBy('openAt'),
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
 * 0.15 MB per blob it is the **count** limit that binds, not the bytes.
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
 * The `meta` rows are read back from *"exactly the untrusted path INV-FE-7 assumes gets
 * corrupted"*, and a record is not made trustworthy by the key it was stored under.
 *
 * `readCoverage` sanitizes and `readDownsampled` checks `Array.isArray`; these two returned
 * `row.record` unchecked, which was survivable while the boot report was their only reader — a
 * corrupt record spoiled one panel. Once `coveredQuery` reads `chartDiscard` on **every** history
 * query, `discardOver` dereferences `record.span` and a `record` corrupted to `null` throws a
 * `TypeError` out of the render path. INV-FE-7 is explicit that corruption here is *"a performance
 * and convenience event only"*; a chart that will not draw is not that.
 *
 * So both validate and both return `undefined` on a malformed row, matching `readDownsampled`'s
 * disposal. `undefined` reads as *no such record*, which is the truthful answer about a record
 * nothing can read — and it is not a loss of disclosure, because a record that cannot be parsed
 * cannot be rendered either.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isChartDiscardSpan(value: unknown): value is ChartDiscardSpan {
  if (typeof value !== 'object' || value === null) return false;
  const span = value as { kind?: unknown; fromBlock?: unknown; toBlock?: unknown };
  if (span.kind === 'none' || span.kind === 'unreadable') return true;
  return span.kind === 'named' && isFiniteNumber(span.fromBlock) && isFiniteNumber(span.toBlock);
}

function isChartDiscardRecord(value: unknown): value is ChartDiscardRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isFiniteNumber(record.fromSchema) &&
    isFiniteNumber(record.toSchema) &&
    isFiniteNumber(record.rows) &&
    isFiniteNumber(record.at) &&
    Array.isArray(record.tables) &&
    record.tables.every((table) => typeof table === 'string') &&
    typeof record.detail === 'string' &&
    isChartDiscardSpan(record.span)
  );
}

function isPendingRawEvictionRecord(value: unknown): value is PendingRawEvictionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isFiniteNumber(record.blocks) &&
    isFiniteNumber(record.bytes) &&
    isFiniteNumber(record.oldestBlock) &&
    isFiniteNumber(record.newestBlock) &&
    isFiniteNumber(record.at) &&
    typeof record.reason === 'string'
  );
}

/** §9.2's downsampled-label sibling: what the pending-raw bound has discarded, or `undefined`. */
export async function readPendingRawEvicted(
  db: LocalIndex,
): Promise<PendingRawEvictionRecord | undefined> {
  const row = await db.meta.get('pendingRawEvicted');
  if (row === undefined || row.key !== 'pendingRawEvicted') return undefined;
  return isPendingRawEvictionRecord(row.record) ? row.record : undefined;
}

/** What a schema migration discarded, or `undefined` when no migration has dropped anything. */
export async function readChartDiscard(db: LocalIndex): Promise<ChartDiscardRecord | undefined> {
  const row = await db.meta.get('chartDiscard');
  if (row === undefined || row.key !== 'chartDiscard') return undefined;
  return isChartDiscardRecord(row.record) ? row.record : undefined;
}

/**
 * The raw pending-decode blobs, oldest first, and their measured bytes.
 *
 * Read through the sparse `pendingBlock` index rather than by scanning `events`, because this
 * runs inside the quota pass and the whole point of the bound is that the set can be large.
 *
 * **Cross-checked against `pendingDecoderCount`, which is a full scan and therefore cannot
 * miss.** A raw row written without `pendingBlock` is invisible to the index — so the bound
 * would report a set it cannot reach and the growth §9.1 forbids would continue under a green
 * eviction. Refusing is the fail-closed disposal: a bound that silently does not cover
 * everything is worse than no bound, because it is believed.
 */
export async function pendingRawRows(
  db: LocalIndex,
): Promise<{ readonly rows: readonly StoredEvent[]; readonly bytes: number }> {
  const rows = await db.events.orderBy('pendingBlock').toArray();
  const counted = await pendingDecoderCount(db);
  if (rows.length !== counted) {
    throw new StoreError(
      `the sparse pendingBlock index enumerates ${rows.length} raw row(s) while a full scan ` +
        `finds ${counted}. A raw row without pendingBlock cannot be reached by the 10 §9.1 ` +
        'bound, so the set would grow unbounded under an eviction reporting success.',
    );
  }
  return { rows, bytes: rows.reduce((sum, row) => sum + (row.raw?.byteLength ?? 0), 0) };
}

/**
 * The measured bytes of §6.5's raw blobs, by a route that **cannot refuse**.
 *
 * The same quantity `pendingRawRows` reports, read by the full scan `pendingDecoderCount` already
 * uses rather than through the sparse `pendingBlock` index — so it needs no cross-check and has
 * no disagreement to fail on.
 *
 * The split is deliberate and it is where the fail-closed refusal belongs. **Eviction** needs the
 * set enumerable *and oldest-first*, which only the index gives, so `pendingRawRows` must refuse
 * when the index is short: a bound that silently does not cover everything is worse than no
 * bound. **Measurement** needs neither property, and a measurement that refuses takes the whole
 * retention pass with it — `measureUsage` is the first call in `applyQuota` — so the ladder never
 * runs, nothing is freed, and nothing is reported. Refusing where the refusal changes an outcome
 * and scanning where it would only silence the pass is the honest division.
 *
 * Streams through `each` rather than materialising: the set this bounds is measured in tens of
 * megabytes by construction.
 */
export async function pendingRawBytes(db: LocalIndex): Promise<number> {
  let bytes = 0;
  await db.events
    .filter((event) => event.decoded === false)
    .each((event) => {
      bytes += event.raw?.byteLength ?? 0;
    });
  return bytes;
}

/**
 * Bound §6.5's raw blob set — oldest first, labelled, in one transaction.
 *
 * §9.1 rules that the index retains only events attributing to watched accounts, and *"a
 * chain-wide trade tape is a bounded windowed read, never a retained table"*. One `${block}:raw`
 * row is a whole block's `System.Events` value regardless of the watched set, and it is the
 * **expected** state of any backfill across a runtime upgrade — so without a bound the one path
 * §6.5 mandates is the one path §9.1 forbids, at whatever rate the upgrade history dictates.
 * `compactSettledEvents` cannot reach these rows (they belong to no settled proposal) and
 * §9.2's ladder has no rung for them, so the bound is here.
 *
 * The budget is the caller's remaining **events share** — §9.2's own 15 %, not a new number.
 * Oldest first, because the oldest era is the one whose metadata is least likely ever to arrive
 * (FE-P5), and because it is the only order under which the disposal is deterministic.
 *
 * Returns what it discarded as an envelope and a count (`PendingRawEviction`), never a block
 * list. The label is written in the same transaction as the deletes: written afterwards it is
 * absent for as long as it takes a tab to close mid-eviction, which is the silent splice §9.2
 * forbids in the chart tier for exactly the same reason.
 */
/**
 * The block envelope an eviction record carries, **folded rather than spread**.
 *
 * `Math.min(...blocks)` reads well and is a crash: V8 refuses a spread above roughly 125,390
 * arguments (measured on this project's pinned `node` — 125,000 is fine, 130,000 throws
 * `RangeError: Maximum call stack size exceeded`), and the argument count here is the number of
 * blobs the bound is discarding. §9.2's 15 % events share is 45 MB on desktop, which admits on
 * the order of 225,000 of §6.5's small raw blobs — so the spread form fails **exactly when the
 * eviction matters most**, and a retention pass that throws frees nothing at all.
 *
 * Exported because the failure only appears above a size no ordinary fixture reaches, and a
 * property that cannot be exercised is one the suite is structurally blind to — which is how the
 * spread survived the round that added the eviction. The suite folds 130,000 blocks through this
 * function directly.
 *
 * Throws on nothing to fold **and** no previous record, which is reachable: it is a caller asking
 * for the envelope of an empty eviction, and there is no honest answer to return.
 */
export function evictionEnvelope(
  previous: PendingRawEvictionRecord | undefined,
  blocks: readonly number[],
): { readonly oldestBlock: number; readonly newestBlock: number } {
  let oldestBlock = previous?.oldestBlock;
  let newestBlock = previous?.newestBlock;
  for (const block of blocks) {
    if (oldestBlock === undefined || block < oldestBlock) oldestBlock = block;
    if (newestBlock === undefined || block > newestBlock) newestBlock = block;
  }
  if (oldestBlock === undefined || newestBlock === undefined) {
    throw new StoreError(
      'an eviction envelope needs at least one discarded block or a previous record; an empty ' +
        'one has no span to name, and naming a wrong span is what the record exists to prevent.',
    );
  }
  return { oldestBlock, newestBlock };
}

/**
 * What one pass of the bound discarded — an envelope and a count, never the list.
 *
 * The same summary shape as `PendingRawEvictionRecord`, and for the same reason one rung up:
 * §9.2 calls the ladder *"deterministic and user-visible"*, and the quantity being reported is
 * the number of blocks the pass dropped. The desktop events share admits on the order of 225,000
 * of §6.5's small raw blobs, so a per-block list is not a rendering — it is the growth the
 * eviction was run to stop, reproduced in the report that describes stopping it.
 *
 * Unlike the stored record, this describes **this pass alone**: the record accumulates across
 * passes so a surface can say what the client has lost in total, while a step says what this run
 * did.
 */
export interface PendingRawEviction {
  readonly blocks: number;
  readonly oldestBlock: number;
  readonly newestBlock: number;
}

export async function evictPendingRawToBound(
  db: LocalIndex,
  maxBytes: number,
  at: number,
): Promise<PendingRawEviction | undefined> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new StoreError(`${maxBytes} is not a byte budget for the pending-decode set`);
  }
  const { rows, bytes } = await pendingRawRows(db);
  if (bytes <= maxBytes) return undefined;
  let remaining = bytes;
  const doomed: StoredEvent[] = [];
  for (const row of rows) {
    if (remaining <= maxBytes) break;
    doomed.push(row);
    remaining -= row.raw?.byteLength ?? 0;
  }
  if (doomed.length === 0) return undefined;
  const freed = doomed.reduce((sum, row) => sum + (row.raw?.byteLength ?? 0), 0);
  const previous = await readPendingRawEvicted(db);
  const blocks = doomed.map((row) => row.blockNumber);
  const envelope = evictionEnvelope(previous, blocks);
  const record: PendingRawEvictionRecord = {
    blocks: (previous?.blocks ?? 0) + doomed.length,
    bytes: (previous?.bytes ?? 0) + freed,
    oldestBlock: envelope.oldestBlock,
    newestBlock: envelope.newestBlock,
    at,
    reason:
      'the raw events of these blocks could not be decoded (their era metadata was unavailable) ' +
      'and were discarded to stay inside the storage budget. This is not a gap in coverage — the ' +
      'blocks were seen — but their events can no longer be recovered locally.',
  };
  await db.transaction('rw', db.events, db.meta, async () => {
    await db.events.bulkDelete(doomed.map((row) => row.id));
    await db.meta.put({ key: 'pendingRawEvicted', record });
  });
  // This pass's own envelope, folded from the same list without the previous record's span —
  // `record` is cumulative and a step is not.
  return { blocks: doomed.length, ...evictionEnvelope(undefined, blocks) };
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
