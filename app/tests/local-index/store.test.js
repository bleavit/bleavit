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
  LocalIndex,
  SCHEMA_V1,
  StoreError,
  databaseName,
  evictMetadataToBudget,
  readCoverage,
  rebuild,
  selfRange,
  writeCoverage,
} from '@bleavit/local-index';

const PASEO = `0x${'a1'.repeat(32)}`;
const POLKADOT = `0x${'b2'.repeat(32)}`;

test('the database name is a function of the chain, not a constant', () => {
  // The whole cross-chain-contamination defence is this string.
  assert.equal(databaseName(PASEO), 'futarchy@a1a1a1a1');
  assert.notEqual(databaseName(PASEO), databaseName(POLKADOT));
});

test('a genesis hash is required and validated — there is no default chain', () => {
  // A caller that does not know which chain it is indexing has nothing to index.
  assert.throws(() => databaseName(''), StoreError);
  assert.throws(() => databaseName('0xdeadbeef'), StoreError);
  assert.throws(() => databaseName(PASEO.toUpperCase()), StoreError);
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
  const coverage = { ranges: [selfRange(10, 20, 1)], holes: [] };
  await writeCoverage(db, coverage);
  const read = await readCoverage(db);
  assert.equal(read.ranges.length, 1);
  assert.equal(read.ranges[0].origin, 'self');
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
  const evicted = await evictMetadataToBudget(db, 900);
  assert.deepEqual(evicted, [1], 'the least recently used went first');
  assert.equal(await db.metadataCache.count(), 2);
  // A budget that fits everything evicts nothing.
  assert.deepEqual(await evictMetadataToBudget(db, 10_000), []);
  assert.rejects(() => evictMetadataToBudget(db, -1), StoreError);
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
