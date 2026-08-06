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
  REKEYED_TABLES,
  SCHEMA_V1,
  SCHEMA_V3,
  StoreError,
  applyQuota,
  checkIndexAtBoot,
  databaseName,
  evictMetadataToBudget,
  evictPendingRawToBound,
  evictionEnvelope,
  pendingDecoderCount,
  pendingRawBytes,
  pendingRawRows,
  platformBudget,
  readChartDiscard,
  readCoverage,
  readCoverageRepair,
  readPendingRawEvicted,
  rawEventId,
  rebuild,
  sanitizeCoverage,
  writeCoverage,
} from '@bleavit/local-index';
import { isVerifiedAt } from '@bleavit/local-index';
import type { CoverageRange } from '@bleavit/local-index';
// `selfRange` is test-only on purpose — see packages/local-index/src/testing.ts.
import { legacyIndexV1, selfRange } from '@bleavit/local-index/testing';
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
    assert.ok(table in SCHEMA_V3, `${table} is missing from the schema`);
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
    assert.ok(table in SCHEMA_V3, `10 §7 names ${table} and the schema does not declare it`);
  }
  const db = new LocalIndex(PASEO);
  await db.open();
  assert.deepEqual(
    db.tables.map((t) => t.name).sort(),
    Object.keys(SCHEMA_V3).sort(),
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
    { specVersion: 1, bytes: 400, lastUsedAt: 10, blob: new Uint8Array(1), origin: 'self' as const },
    { specVersion: 2, bytes: 400, lastUsedAt: 30, blob: new Uint8Array(1), origin: 'self' as const },
    { specVersion: 3, bytes: 400, lastUsedAt: 20, blob: new Uint8Array(1), origin: 'self' as const },
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
  // actually grows in, since a compressed blob is a measured 0.14 MB gz against a 15 MB budget —
  // which is why §9.3's COUNT limit is the one that binds and the byte limit is headroom.
  const db = new LocalIndex(PASEO);
  await db.open();
  await db.metadataCache.clear();
  await db.metadataCache.bulkPut(
    [1, 2, 3, 4, 5].map((specVersion) => ({
      specVersion,
      bytes: 10,
      lastUsedAt: specVersion,
      blob: new Uint8Array(1),
      origin: 'self' as const,
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
  // decoder" rows to save a fraction of a 15 MB budget, at the measured 0.14 MB gz per blob.
  const db = new LocalIndex(PASEO);
  await db.open();
  await db.metadataCache.clear();
  await db.metadataCache.bulkPut([
    { specVersion: 1, bytes: 400, lastUsedAt: 1, blob: new Uint8Array(1), origin: 'self' as const },
    { specVersion: 2, bytes: 400, lastUsedAt: 2, blob: new Uint8Array(1), origin: 'self' as const },
    { specVersion: 3, bytes: 400, lastUsedAt: 3, blob: new Uint8Array(1), origin: 'self' as const },
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
  assert.equal(SCHEMA_V3['priceSamples']?.startsWith('[bookId+sourceKey+blockNumber]'), true);
  for (const table of ['candles1h', 'candles4h', 'candles1d']) {
    assert.equal(SCHEMA_V3[table]?.startsWith('[bookId+sourceKey+openAt]'), true, table);
  }
  // ...and the schema they replaced declared neither, which is why the upgrade has to drop the
  // tables rather than re-declare them: IndexedDB fixes a key path at creation.
  assert.equal(SCHEMA_V1['priceSamples']?.startsWith('[bookId+at]'), true);
  assert.equal(SCHEMA_V1['candles1h']?.startsWith('[bookId+openAt]'), true);

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

test('a database created under SCHEMA_V1 UPGRADES rather than failing to open', async () => {
  // The migration record, exercised rather than declared. Two of `SCHEMA_V1`'s primary keys were
  // wrong — `priceSamples` was keyed on the device clock and the chart tables carried no source —
  // and IndexedDB fixes a store's key path at creation, so Dexie refuses to change one in place
  // ("Not yet support for changing primary key"). Declaring the corrected keys under `version(1)`
  // therefore did not silently keep the old key path: it made an existing database **fail to
  // open**, on the one structure INV-FE-7 says the client must survive losing.
  //
  // The published recipe is drop-then-re-declare, which is what versions 2 and 3 are. This test
  // is what makes that a fact rather than an intention: it opens a real version-1 database,
  // writes to it, and then opens the production class over it.
  const genesis = `0x${'d4'.repeat(32)}`;
  const legacy = legacyIndexV1(genesis);
  await legacy.delete();
  await legacy.open();
  await legacy.table('txHistory').put({
    id: '0000000005:00000',
    blockNumber: 5,
    extrinsicIndex: 0,
    account: '0xalice',
    call: 'market.buy',
    origin: 'self',
  });
  await legacy.table('priceSamples').put({ bookId: 'book-1', at: 10, blockNumber: 5, price1e9: 1n, origin: 'self' });
  await legacy.table('candles1h').put({
    bookId: 'book-1',
    openAt: 0,
    fromBlock: 3,
    toBlock: 5,
    open1e9: 1n,
    high1e9: 1n,
    low1e9: 1n,
    close1e9: 1n,
    samples: 1,
    origin: 'self',
  });
  await legacy
    .table('meta')
    .put({ key: 'coverage', coverage: { ranges: [selfRange(1, 9, 1, edgeAt(9, genesis))], holes: [] } });
  legacy.close();

  const db = new LocalIndex(genesis);
  await db.open();
  assert.equal(db.verno, 3, 'the upgrade did not reach the current schema');

  // What survives is what the ladder does not own: history the user signed, and coverage.
  assert.equal(await db.txHistory.count(), 1, 'the upgrade dropped the user’s own transaction history');
  assert.equal(nth((await readCoverage(db)).ranges, 0, 'range').toBlock, 9);

  // What is dropped is exactly the re-keyed set, and it is bounded: chart depth re-accumulates,
  // which §9.2's ladder already treats as the degradable tier.
  for (const table of REKEYED_TABLES) {
    assert.equal(await db.table(table).count(), 0, `${table} kept rows under a key path it no longer uses`);
  }

  // **And the drop is RECORDED.** The loss itself is permitted — INV-FE-7 makes this storage a
  // non-authoritative cache whose loss is "a performance and convenience event only", and the
  // alternative is a database that fails to open, which is the one outcome INV-FE-7 says the
  // client must survive. Performing it silently is not: `meta.coverage` carries through
  // unchanged, so afterwards `coveredSamples` answers a covered span with an empty array and the
  // tables state "complete within [ranges]" over nothing. INV-FE-15 requires everything
  // unverified to be "either absent **with an explanation** or present and labeled — gaps are
  // first-class and visible, never silently spliced", and §9.2 states the identical rule for this
  // exact operation. The untrue claim is separable from the loss, and one `meta.put` inside the
  // upgrade transaction separates them.
  const discard = await readChartDiscard(db);
  assert.ok(discard, 'the migration emptied the chart tables and left nothing saying so');
  assert.equal(discard.rows, 2, 'the record does not count the rows that were actually dropped');
  assert.deepEqual([...discard.tables], [...REKEYED_TABLES]);
  assert.equal(discard.fromSchema, 1);
  assert.equal(discard.toSchema, 3);
  // The span named is the one `meta.coverage` still claims — exactly where the surviving coverage
  // and the surviving rows now disagree.
  assert.equal(discard.fromBlock, 1);
  assert.equal(discard.toBlock, 9);
  assert.ok(discard.at > 0);
  assert.match(discard.detail, /the blocks are still covered/);

  // ...and the boot path surfaces it, because a record with a producer and no reader is the same
  // shape as a checker with no call site — which is the defect this whole repair round began on.
  const report = await checkIndexAtBoot(db, () => undefined);
  assert.deepEqual(report.chartDiscard, discard);

  // The corrected key really is in force afterwards — the property the migration exists for.
  const common = { bookId: 'book-1', blockNumber: 7, blockTimestampMs: 7_000 };
  await db.priceSamples.bulkPut([
    priceSample({ ...common, price1e9: 100n, origin: 'self' }),
    priceSample({ ...common, price1e9: 900n, origin: 'indexer', providerId: 'acme' }),
  ]);
  assert.equal(await db.priceSamples.count(), 2, 'the upgraded table still collapses two sources into one row');
  await db.delete();
});

test('an upgrade that dropped NOTHING records nothing — the zero case, not just a fresh database', async () => {
  // The other half of the record's contract, and the case that has to be exercised deliberately:
  // a user who upgrades having never charted anything must not be told they lost chart data. A
  // boot report a user learns to ignore is one that cannot report the loss that does happen.
  //
  // A fresh database alone does not prove the guard — measured, and worth writing down: Dexie
  // does not run a version's `upgrade` when it creates the database from nothing, so removing the
  // `rows === 0` return leaves a fresh-database assertion perfectly green. The real version-1
  // database below, with its chart tables empty, is what runs the upgrader and reaches the guard.
  const fresh = new LocalIndex(`0x${'d5'.repeat(32)}`);
  await fresh.delete();
  await fresh.open();
  assert.equal(await readChartDiscard(fresh), undefined);
  assert.equal((await checkIndexAtBoot(fresh, () => undefined)).chartDiscard, undefined);
  await fresh.delete();

  const genesis = `0x${'d7'.repeat(32)}`;
  const legacy = legacyIndexV1(genesis);
  await legacy.delete();
  await legacy.open();
  // Everything the migration keeps, and nothing it drops.
  await legacy.table('txHistory').put({
    id: '0000000005:00000',
    blockNumber: 5,
    extrinsicIndex: 0,
    account: '0xalice',
    call: 'market.buy',
    origin: 'self',
  });
  await legacy
    .table('meta')
    .put({ key: 'coverage', coverage: { ranges: [selfRange(1, 9, 1, edgeAt(9, genesis))], holes: [] } });
  legacy.close();

  const upgraded = new LocalIndex(genesis);
  await upgraded.open();
  assert.equal(upgraded.verno, 3);
  assert.equal(await upgraded.txHistory.count(), 1, 'the fixture did not exercise the upgrade at all');
  assert.equal(
    await readChartDiscard(upgraded),
    undefined,
    'the upgrade announced a chart loss over four tables that held nothing',
  );
  await upgraded.delete();
});

test('the upgrade BACKFILLS pendingBlock, or the sparse index refuses every pass forever', async () => {
  // A version-1 `${block}:raw` row predates `pendingBlock`, so `orderBy('pendingBlock')` cannot
  // see it while `pendingDecoderCount`'s full scan can — and `pendingRawRows` refuses on that
  // disagreement, correctly, because a bound that silently does not cover everything is worse
  // than no bound. What made it a defect is that the disagreement is **permanent**: nothing else
  // ever writes the field onto an existing row, and §6.5 calls a raw row "the expected state of
  // any backfill across a runtime upgrade". So one upgraded database refused every retention pass
  // it would ever run, and `measureUsage` is the first call in `applyQuota` — the whole pass, on
  // line one.
  const genesis = `0x${'d6'.repeat(32)}`;
  const legacy = legacyIndexV1(genesis);
  await legacy.delete();
  await legacy.open();
  await legacy.table('events').put({
    id: rawEventId(12),
    blockNumber: 12,
    pallet: '(pending decoder)',
    name: '(era metadata unavailable)',
    decoded: false,
    raw: new Uint8Array(64),
    origin: 'self',
  });
  // A decoded row must NOT gain the field: `pendingBlock` is what makes the index sparse, and a
  // backfill that stamped every event would make `orderBy('pendingBlock')` enumerate the whole
  // events table — the bound would then evict decoded history to relieve the raw blobs.
  await legacy.table('events').put({
    id: '12:0',
    blockNumber: 12,
    pallet: 'Market',
    name: 'Traded',
    decoded: true,
    origin: 'self',
  });
  legacy.close();

  const db = new LocalIndex(genesis);
  await db.open();
  const measured = await pendingRawRows(db);
  assert.equal(measured.rows.length, 1, 'the sparse index still cannot see the upgraded raw row');
  assert.equal(nth(measured.rows, 0, 'raw row').blockNumber, 12);
  assert.equal(measured.bytes, 64);
  assert.equal(await pendingRawBytes(db), 64, 'the scan and the index disagree on the same bytes');

  // The whole retention pass runs, which is the property the refusal was taking down with it.
  const report = await applyQuota(db, {
    budget: platformBudget('desktop'),
    sizes: { priceSample: 120, candle: 120, event: 120, archiveRow: 120 },
    now: 100_000,
    pinnedSpecVersions: [3],
  });
  assert.deepEqual([...report.refusals], [], 'the pass refused a rung it should have completed');
  await db.delete();
});

test('repair keeps THIS database’s chain, never the majority of what was stored', async () => {
  // The defect: `sanitizeCoverage` grouped ranges by genesis and kept the largest group, which is
  // a majority vote over untrusted input. §6.3 admits ranges by import and by structured clone,
  // and the `self` brand is compile-time only — so a rehydrated record carrying more foreign
  // ranges than honest ones won the vote, and `readCoverage` returned another chain's blocks with
  // `isVerifiedAt` answering `true` for them. That is precisely the cross-chain contamination
  // §7's per-chain database name exists to prevent, arriving through the one door §7 leaves open.
  const db = new LocalIndex(PASEO);
  await db.delete();
  await db.open();
  const foreignEdge = (toBlock: number) => edgeAt(toBlock, POLKADOT);
  await db.meta.put({
    key: 'coverage',
    coverage: {
      ranges: [
        selfRange(10, 20, 1, edgeAt(20)),
        // Two foreign ranges against one honest one: the majority is Polkadot's.
        selfRange(100, 110, 1, foreignEdge(110)),
        selfRange(200, 210, 1, foreignEdge(210)),
      ],
      holes: [],
    },
  });
  const { coverage, dropped } = await readCoverageRepair(db);
  assert.equal(coverage.ranges.length, 1, 'the majority foreign chain won the repair');
  assert.equal(nth(coverage.ranges, 0, 'range').fromBlock, 10);
  assert.equal(dropped.length, 2);
  assert.match(nth(dropped, 0, 'drop').reason, /not this index’s chain/);
  // The dangerous reading, asserted directly: a foreign block must not read as verified.
  assert.equal(isVerifiedAt(coverage, 205), false, 'another chain’s block reads as light-client verified');
  assert.equal(isVerifiedAt(coverage, 15), true, 'this chain’s own range was dropped');

  // And the chain is required rather than inferred — a repair with nothing to compare against
  // would have to guess one out of the data it is repairing.
  assert.throws(() => sanitizeCoverage({ ranges: [] }, 'not-a-genesis'));
  await db.delete();
});

test('§6.5’s raw blobs are BOUNDED, oldest first, and the eviction is labelled', async () => {
  // 10 §9.1 forbids retaining chain-wide event data; one `${block}:raw` row is exactly that — a
  // whole block's `System.Events` value regardless of the watched set — and it is the *expected*
  // state of any backfill across a runtime upgrade. `compactSettledEvents` cannot reach these
  // rows (they belong to no settled proposal) and §9.2's ladder has no rung for them, so without
  // this bound the one path §6.5 mandates is the one path §9.1 forbids. The tension itself is
  // SQ-760; the bound is what stops it growing while the ruling is pending.
  const db = new LocalIndex(PASEO);
  await db.delete();
  await db.open();
  for (const block of [30, 10, 20]) {
    await db.events.put({
      id: rawEventId(block),
      blockNumber: block,
      pendingBlock: block,
      pallet: '(pending decoder)',
      name: '(era metadata unavailable)',
      decoded: false,
      raw: new Uint8Array(100),
      origin: 'self',
    });
  }
  const measured = await pendingRawRows(db);
  assert.equal(measured.bytes, 300, 'the blobs are measured, not modelled at a row size');
  assert.deepEqual(measured.rows.map((r) => r.blockNumber), [10, 20, 30], 'the index is not oldest-first');

  // A budget that fits everything frees nothing.
  assert.deepEqual(await evictPendingRawToBound(db, 300, 5), []);
  // 150 bytes admits one blob, so the two oldest go — oldest first, because the oldest era is
  // the one whose metadata is least likely ever to arrive (FE-P5).
  assert.deepEqual(await evictPendingRawToBound(db, 150, 5), [10, 20]);
  assert.equal(await pendingDecoderCount(db), 1, 'the pending count did not fall with the blobs');

  // Labelled, in the same transaction as the delete. An unlabelled drop is the silent splice
  // §9.2 forbids in the chart tier, arriving in the event tier.
  const record = await readPendingRawEvicted(db);
  assert.ok(record, 'the eviction left no label — nothing can explain what the user lost');
  assert.equal(record.blocks, 2);
  assert.equal(record.bytes, 200);
  assert.equal(record.oldestBlock, 10);
  assert.equal(record.newestBlock, 20);
  assert.match(record.reason, /can no longer be recovered locally/);
  await db.delete();
});

test('the eviction envelope FOLDS 130,000 blocks — a spread throws at exactly this size', () => {
  // `Math.min(...blocks)` reads well and is a crash. V8 refuses a spread above roughly 125,390
  // arguments — measured on this project's pinned node: 125,000 is fine, 130,000 throws
  // `RangeError: Maximum call stack size exceeded` — and the argument count here is the number of
  // blobs the bound is discarding. §9.2's 15 % events share is 45 MB on desktop, which admits on
  // the order of 225,000 of §6.5's small raw blobs, so the spread form failed **exactly when the
  // eviction mattered most** and a retention pass that throws frees nothing at all.
  //
  // Exercised directly rather than through `evictPendingRawToBound`, and the reason is stated
  // rather than implied: reaching the argument count through the store means inserting and then
  // deleting ~130,000 rows in `fake-indexeddb`, which is a minute of suite time to reach an
  // arithmetic property. The integration is covered at ordinary sizes by the test below; this is
  // the one size no fixture reaches, and a property that cannot be exercised is one the suite is
  // structurally blind to — which is how the spread survived the round that added the eviction.
  const blocks: number[] = [];
  for (let i = 0; i < 130_000; i += 1) blocks.push(200_000 - i);
  assert.throws(() => Math.min(...blocks), RangeError, 'V8 no longer refuses this spread, so the bound below proves nothing');

  assert.deepEqual(evictionEnvelope(undefined, blocks), { oldestBlock: 70_001, newestBlock: 200_000 });

  // A previous record widens the envelope in both directions rather than replacing it: the record
  // is cumulative, so it has to describe every block ever discarded and not the last batch.
  const previous = {
    blocks: 1,
    bytes: 1,
    oldestBlock: 5,
    newestBlock: 300_000,
    at: 1,
    reason: 'earlier',
  };
  assert.deepEqual(evictionEnvelope(previous, blocks), { oldestBlock: 5, newestBlock: 300_000 });

  // Nothing to fold and no previous record has no honest answer, so it refuses rather than
  // inventing one. Reachable, not decorative: it is a caller asking for an empty eviction's span.
  assert.throws(() => evictionEnvelope(undefined, []), StoreError);
});

test('a raw row the sparse index cannot see FAILS the bound rather than shrinking it', async () => {
  // The fail-closed half. The bound reads the pending set through the sparse `pendingBlock`
  // index; a raw row written without that field is invisible to it, so the eviction would report
  // success over a set it cannot reach and the growth §9.1 forbids would continue under a green
  // pass. `pendingDecoderCount` is a full scan and therefore cannot miss, so the two are
  // compared and a disagreement refuses.
  const db = new LocalIndex(PASEO);
  await db.delete();
  await db.open();
  await db.events.put({
    id: rawEventId(41),
    blockNumber: 41,
    pallet: '(pending decoder)',
    name: '(era metadata unavailable)',
    decoded: false,
    raw: new Uint8Array(10),
    origin: 'self',
  } as Parameters<typeof db.events.put>[0]);
  await assert.rejects(() => pendingRawRows(db), /cannot be reached by the 10 §9.1 bound/);
  await db.delete();
});
