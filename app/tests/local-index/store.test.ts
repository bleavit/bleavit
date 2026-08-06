/**
 * The local index schema — 10 §7, §9.3, INV-FE-7 (F8).
 *
 * Run against a real IndexedDB implementation (`fake-indexeddb`) rather than a stub, because
 * the properties worth testing here are the ones a stub would grant for free: that Dexie
 * accepts the schema, that a compound primary key really is one, and that deleting a database
 * and reopening it produces an empty one.
 *
 * The sharpest rule is the database *name*. A single shared database would let a client that
 * connected to Paseo yesterday and Polkadot today read yesterday's rows as today's chain —
 * positions, prices and history belonging to a different network, with nothing downstream
 * able to notice, because the rows are well-formed and the ids collide (both chains number
 * their proposals from one).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import 'fake-indexeddb/auto';

import {
  ChainTagError,
  LocalIndex,
  priceSample,
  SCHEMA_V1,
  StoreError,
  databaseName,
  evictMetadataToBudget,
  readCoverage,
  readCoverageRepair,
  rebuild,
  writeCoverage,
} from '@bleavit/local-index';
import type { CoverageRange } from '@bleavit/local-index';
// `selfRange` is test-only on purpose — see packages/local-index/src/testing.ts.
import { selfRange } from '@bleavit/local-index/testing';
import { nth } from './nth.ts';

const PASEO = `0x${'a1'.repeat(32)}`;
const POLKADOT = `0x${'b2'.repeat(32)}`;

/** §6.3's per-range edge facts, on this database's chain. */
const edgeAt = (toBlock: number, genesisHash = PASEO) => ({
  genesisHash,
  hash: `0x${toBlock.toString(16).padStart(64, '0')}`,
  specVersion: 3,
});

/**
 * A range as an untyped caller supplies it — a record rehydrated from IndexedDB, which is the
 * path `assertCanonical`'s own comment calls *"exactly the untrusted path INV-FE-7 assumes gets
 * corrupted"*. `as unknown as` is banned across `app/`, so this is one assertion through one
 * documented helper.
 */
const asRange = (record: Record<string, unknown>): CoverageRange => record as CoverageRange;

test('the database name is a function of the chain, not a constant', () => {
  // The whole cross-chain-contamination defence is this string.
  assert.equal(databaseName(PASEO), 'futarchy@a1a1a1a1');
  assert.notEqual(databaseName(PASEO), databaseName(POLKADOT));
});

test('a genesis hash is required and validated — there is no default chain', () => {
  // A caller that does not know which chain it is indexing has nothing to index.
  // Through `chainTag`, which the `fut-ingest` lock name shares: the two were deriving the
  // same suffix by different rules and only one of them validated, so an empty string produced
  // the database refusal on one side and the lock name `fut-ingest@` on the other — one global
  // lock across every chain, from the function whose whole purpose is one writer *per chain*.
  assert.throws(() => databaseName(''), ChainTagError);
  assert.throws(() => databaseName('0xdeadbeef'), ChainTagError);
  assert.throws(() => databaseName(PASEO.toUpperCase()), ChainTagError);
  assert.equal(databaseName.length, 1);
});

test('two chains get two databases, and neither can see the other’s rows', async () => {
  const paseo = new LocalIndex(PASEO);
  const polkadot = new LocalIndex(POLKADOT);
  await paseo.open();
  await polkadot.open();
  await paseo.txHistory.put({
    id: '0000000100:00000',
    blockNumber: 100,
    extrinsicIndex: 0,
    account: '0xalice',
    origin: 'self',
    call: 'market.buy',
  });
  assert.equal(await paseo.txHistory.count(), 1);
  assert.equal(await polkadot.txHistory.count(), 0, "the other chain's store is untouched");
  await paseo.delete();
  await polkadot.delete();
});

test('the ladder’s coarser tables exist from version 1', async () => {
  // §9.2 degrades *into* them; a database lacking them would have nowhere to put a
  // downsampled range and would fall back to eviction — silently trading away the depth the
  // ladder exists to keep.
  for (const table of ['candles1h', 'candles4h', 'candles1d']) {
    assert.ok(table in SCHEMA_V1, `${table} is missing from the schema`);
  }
  // And every table 10 §7 names is declared.
  for (const table of [
    'meta',
    'events',
    'priceSamples',
    'candles1h',
    'candles4h',
    'candles1d',
    'proposalsArchive',
    'txHistory',
    'metadataCache',
    'snapshotsImported',
  ]) {
    assert.ok(table in SCHEMA_V1, `10 §7 names ${table} and the schema does not declare it`);
  }
  const db = new LocalIndex(PASEO);
  await db.open();
  assert.deepEqual(
    db.tables.map((t) => t.name).sort(),
    Object.keys(SCHEMA_V1).sort(),
    'Dexie opened exactly the declared tables',
  );
  await db.delete();
});

test('coverage round-trips, and a fresh database reads as empty rather than undefined', async () => {
  // The distinction that matters is between "no coverage recorded" and "coverage recorded as
  // empty" — both are truthfully "nothing verified here". What must never escape is an
  // `undefined` a renderer could read as full coverage, so the default is applied at the
  // boundary rather than left to each caller.
  const db = new LocalIndex(PASEO);
  await db.open();
  assert.deepEqual(await readCoverage(db), { ranges: [], holes: [] });
  const coverage = { ranges: [selfRange(10, 20, 1, edgeAt(20))], holes: [] };
  await writeCoverage(db, coverage);
  const read = await readCoverage(db);
  assert.equal(read.ranges.length, 1);
  assert.equal(nth(read.ranges, 0, 'range').origin, 'self');
  await db.delete();
});

test('the metadata cache evicts least-recently-used until it fits, and says what it dropped', async () => {
  // §9.3's bound. Returning the evicted spec versions rather than a count is what lets
  // §6.5's "N events pending decoder" surface name them: a number makes the eviction
  // invisible to exactly the code that has to explain it.
  const db = new LocalIndex(PASEO);
  await db.open();
  await db.metadataCache.bulkPut([
    { specVersion: 1, bytes: 400, lastUsedAt: 10, blob: new Uint8Array(1) },
    { specVersion: 2, bytes: 400, lastUsedAt: 30, blob: new Uint8Array(1) },
    { specVersion: 3, bytes: 400, lastUsedAt: 20, blob: new Uint8Array(1) },
  ]);
  const evicted = await evictMetadataToBudget(db, { maxBlobs: 8, maxBytes: 900, pinned: [] });
  assert.deepEqual(evicted, [1], 'the least recently used went first');
  assert.equal(await db.metadataCache.count(), 2);
  // A budget that fits everything evicts nothing.
  assert.deepEqual(await evictMetadataToBudget(db, { maxBlobs: 8, maxBytes: 10_000, pinned: [] }), []);
  await assert.rejects(() => evictMetadataToBudget(db, { maxBlobs: 8, maxBytes: -1, pinned: [] }), StoreError);
  await db.delete();
});

test('§9.3’s blob COUNT is a bound too, not only its byte budget', async () => {
  // The section states three obligations and an earlier draft enforced one. A byte budget alone
  // lets an unbounded number of small blobs accumulate — which is the shape a metadata cache
  // actually grows in, since a compressed blob is ~0.1 MB against a 16 MB budget.
  const db = new LocalIndex(PASEO);
  await db.open();
  await db.metadataCache.clear();
  await db.metadataCache.bulkPut(
    [1, 2, 3, 4, 5].map((specVersion) => ({
      specVersion,
      bytes: 10,
      lastUsedAt: specVersion,
      blob: new Uint8Array(1),
    })),
  );
  const evicted = await evictMetadataToBudget(db, { maxBlobs: 3, maxBytes: 10_000, pinned: [] });
  assert.deepEqual(evicted, [1, 2], 'the count cap freed nothing — bytes alone were under budget');
  assert.equal(await db.metadataCache.count(), 3);
  await db.delete();
});

test('the pinned runtimes are never evicted, and a budget they do not fit is REFUSED', async () => {
  // §9.3: "the current and next-authorized runtime's metadata are pinned non-evictable". LRU
  // with no pin set evicts exactly them, because they are the blobs whose era is *current* and
  // therefore the ones an old-era decode has not touched — turning the live era into "pending
  // decoder" rows in order to save six megabytes.
  const db = new LocalIndex(PASEO);
  await db.open();
  await db.metadataCache.clear();
  await db.metadataCache.bulkPut([
    { specVersion: 1, bytes: 400, lastUsedAt: 1, blob: new Uint8Array(1) },
    { specVersion: 2, bytes: 400, lastUsedAt: 2, blob: new Uint8Array(1) },
    { specVersion: 3, bytes: 400, lastUsedAt: 3, blob: new Uint8Array(1) },
  ]);
  // Blob 1 is the least recently used AND pinned: the next-oldest goes instead.
  const evicted = await evictMetadataToBudget(db, { maxBlobs: 8, maxBytes: 900, pinned: [1] });
  assert.deepEqual(evicted, [2], 'a pinned runtime’s metadata was evicted');
  assert.ok(await db.metadataCache.get(1), 'the pin did not hold');

  // A budget the pinned set alone exceeds is a release-configuration error — more pinned
  // runtimes than the platform admits. Silently dropping a pin would report success while doing
  // the one thing §9.3 forbids.
  await assert.rejects(
    () => evictMetadataToBudget(db, { maxBlobs: 8, maxBytes: 100, pinned: [1, 3] }),
    StoreError,
  );
  await assert.rejects(
    () => evictMetadataToBudget(db, { maxBlobs: 1, maxBytes: 10_000, pinned: [1, 3] }),
    StoreError,
  );
  await db.delete();
});

test('coverage is validated on the READ path too, and a bad range is dropped not thrown', async () => {
  // The major this closes. `addRange` checked everything it was handed and the value came back
  // out of IndexedDB **unchecked** into `isVerifiedAt`, which asks only whether some range's
  // origin is `self`. A `{ origin: 'self', fromBlock: 0, toBlock: 4294967295 }` left by a
  // partial write therefore reported the entire chain as light-client verified.
  //
  // It drops rather than throws because §6.3 says corruption of one range invalidates **that
  // range, not the index** — throwing on rehydration is the whole-index answer to a one-range
  // fault, a full resync the user pays for.
  const db = new LocalIndex(PASEO);
  await db.open();
  await db.meta.put({
    key: 'coverage',
    coverage: {
      ranges: [
        selfRange(10, 20, 1, edgeAt(20)),
        asRange({ fromBlock: 30, toBlock: 40, origin: 'operator', ingestedAt: 1, edge: edgeAt(40) }),
      ],
      holes: [],
    },
  });
  const { coverage, dropped } = await readCoverageRepair(db);
  assert.equal(coverage.ranges.length, 1, 'the unattributed operator range survived the read');
  assert.equal(dropped.length, 1, 'the drop was silent — nothing could explain the shrink');
  assert.match(dropped[0]?.reason ?? '', /providerId/);
  await db.delete();
});

test('writeCoverage validates too, because it bypasses addRange entirely', async () => {
  // It is barrel-exported, so every guarantee `assertCanonical` maintains is a guarantee about
  // values that went through `addRange` — and one `writeCoverage(db, anything)` puts a value in
  // the store that never did.
  const db = new LocalIndex(PASEO);
  await db.open();
  const dropped = await writeCoverage(db, {
    ranges: [asRange({ fromBlock: 10, toBlock: 1, origin: 'self', ingestedAt: 1, edge: edgeAt(1) })],
    holes: [],
  });
  assert.equal(dropped.length, 1);
  assert.deepEqual(await readCoverage(db), { ranges: [], holes: [] });
  await db.delete();
});

test('FE-IDX-001 needs a reason, because a silent rebuild looks like a first run', async () => {
  // A client that rebuilds on every load backfills forever and nobody notices — only a fan
  // that never stops. §7 makes the whole-database rebuild the *fallback*, so it is
  // deliberately awkward to reach for.
  const db = new LocalIndex(PASEO);
  await db.open();
  await db.txHistory.put({
    id: '0000000100:00000',
    blockNumber: 100,
    extrinsicIndex: 0,
    account: '0xalice',
    origin: 'self',
    call: 'market.buy',
  });
  await assert.rejects(() => rebuild(db, { reason: '   ', at: 1 }), StoreError);
  const record = await rebuild(db, { reason: 'FE-IDX-001: coverage failed its own invariant', at: 1 });
  assert.match(record.reason, /FE-IDX-001/);
  assert.equal(await db.txHistory.count(), 0, 'the rebuilt database is empty');
  await db.delete();
});

test('the DECLARED keys are what §7 needs, and two sources really are two rows', async () => {
  // Asserted on `SCHEMA_V1` itself and then against a live IndexedDB, because the property is a
  // **primary-key** property: an in-memory check that two `sourceKey` strings differ passes
  // perfectly while the table is keyed `[bookId+blockNumber]` and silently stores one row.
  assert.equal(SCHEMA_V1['priceSamples']?.startsWith('[bookId+sourceKey+blockNumber]'), true);
  for (const table of ['candles1h', 'candles4h', 'candles1d']) {
    assert.equal(SCHEMA_V1[table]?.startsWith('[bookId+sourceKey+openAt]'), true, table);
  }

  const db = new LocalIndex(PASEO);
  await db.delete();
  await db.open();
  const common = { bookId: 'book-1', blockNumber: 7, blockTimestampMs: 7_000 };
  await db.priceSamples.bulkPut([
    priceSample({ ...common, price1e9: 100n, origin: 'self' }),
    priceSample({ ...common, price1e9: 900n, origin: 'indexer', providerId: 'acme' }),
  ]);
  const rows = await db.priceSamples.toArray();
  assert.equal(rows.length, 2, 'two sources at one block collapsed into one row');
  assert.deepEqual(rows.map((r) => r.price1e9).sort(), [100n, 900n]);
  // ...and each is reachable by its own declared key, so a delete cannot silently miss.
  const mine = rows.find((r) => r.origin === 'self');
  assert.ok(mine);
  await db.priceSamples.delete([mine.bookId, mine.sourceKey, mine.blockNumber]);
  assert.equal(await db.priceSamples.count(), 1, 'a delete by the declared key matched nothing');
  await db.delete();
});
