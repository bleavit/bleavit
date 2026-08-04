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

import type { Coverage, RangeOrigin } from './coverage.js';
import type { Candle, PriceSample } from './candles.js';

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/** `0x` + 32 bytes, as every genesis hash is carried. */
const GENESIS_HASH = /^0x[0-9a-f]{64}$/;

/**
 * §7's database name. Exported and tested, because the whole cross-chain-contamination
 * defence is this string being a function of the chain rather than a constant.
 */
export function databaseName(paraGenesisHash: string): string {
  if (!GENESIS_HASH.test(paraGenesisHash)) {
    throw new StoreError(
      `${paraGenesisHash} is not a parachain genesis hash. The database name is what keeps two ` +
        "chains' rows apart, so it is not derived from a value this module could guess at.",
    );
  }
  // Prefix-8 of the hash proper, skipping `0x`: §7's own naming.
  return `futarchy@${paraGenesisHash.slice(2, 10)}`;
}

/** One ingested event, per §6.5's decode discipline. */
export interface StoredEvent {
  /** `${block}:${eventIndex}`, deterministic so replay is idempotent. */
  readonly id: string;
  readonly blockNumber: number;
  readonly pallet: string;
  readonly name: string;
  readonly origin: RangeOrigin;
  /**
   * Raw SCALE when the producing runtime's metadata was unavailable. §6.5: undecodable rows
   * are stored raw and surfaced as "N events pending decoder", never guessed at.
   */
  readonly decoded: boolean;
  readonly raw?: Uint8Array;
}

export interface StoredTxRow {
  /** `txRowKey(block, index)` — block-ordered and replay-stable. */
  readonly id: string;
  readonly blockNumber: number;
  readonly extrinsicIndex: number;
  readonly account: string;
  readonly origin: RangeOrigin;
  readonly call: string;
}

export interface ProposalArchiveRow {
  readonly proposalId: string;
  readonly settledAt: number;
  readonly origin: RangeOrigin;
  readonly summary: string;
}

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

/** The `meta` table's single row. §7 replaced `cursor` with `coverage` for §6.3's holes. */
export interface MetaRow {
  readonly key: 'coverage';
  readonly coverage: Coverage;
}

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
  events: 'id, blockNumber, [pallet+name], origin',
  priceSamples: '[bookId+at], bookId, blockNumber',
  candles1h: '[bookId+openAt], bookId',
  candles4h: '[bookId+openAt], bookId',
  candles1d: '[bookId+openAt], bookId',
  proposalsArchive: 'proposalId, settledAt',
  txHistory: 'id, blockNumber, account',
  metadataCache: 'specVersion, lastUsedAt',
  snapshotsImported: 'id, providerId',
});

export class LocalIndex extends Dexie {
  declare meta: Table<MetaRow, string>;
  declare events: Table<StoredEvent, string>;
  declare priceSamples: Table<PriceSample, [string, number]>;
  declare candles1h: Table<Candle, [string, number]>;
  declare candles4h: Table<Candle, [string, number]>;
  declare candles1d: Table<Candle, [string, number]>;
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
export async function readCoverage(db: LocalIndex): Promise<Coverage> {
  const row = await db.meta.get('coverage');
  return row?.coverage ?? { ranges: [], holes: [] };
}

export async function writeCoverage(db: LocalIndex, coverage: Coverage): Promise<void> {
  await db.meta.put({ key: 'coverage', coverage });
}

/**
 * §9.3's bound, enforced by evicting least-recently-used blobs until the cache fits.
 *
 * Returns what it evicted rather than a count: an evicted metadata blob means the rows
 * decoded with it can no longer be re-decoded from cache, and §6.5's "N events pending
 * decoder" surface needs to know which spec versions those were. A number would make the
 * eviction invisible to exactly the code that has to explain it.
 */
export async function evictMetadataToBudget(db: LocalIndex, budgetBytes: number): Promise<number[]> {
  if (!Number.isInteger(budgetBytes) || budgetBytes < 0) {
    throw new StoreError(`${budgetBytes} is not a byte budget`);
  }
  const blobs = await db.metadataCache.orderBy('lastUsedAt').toArray();
  let total = blobs.reduce((sum, blob) => sum + blob.bytes, 0);
  const evicted: number[] = [];
  for (const blob of blobs) {
    if (total <= budgetBytes) break;
    await db.metadataCache.delete(blob.specVersion);
    total -= blob.bytes;
    evicted.push(blob.specVersion);
  }
  return evicted;
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
