/**
 * The loop's durable write port — 10 §6.5 / §7 (F8).
 *
 * `loop.test.js` proves the invariant *in memory*: `ingestBlock` returns advanced coverage
 * only after the write resolves. This suite proves the other half — that a crash cannot
 * leave persisted coverage ahead of the rows behind it — and it needs a real IndexedDB,
 * because the property under test is **transactional atomicity** and a stub grants that for
 * free while proving nothing.
 *
 * The asymmetry is the point. Coverage *behind* the data costs a re-ingest, which is free:
 * ids are deterministic and replay is idempotent. Coverage *ahead* of the data makes
 * `isVerifiedAt` answer `true` forever for a block with nothing behind it — permanently, and
 * with no symptom, in the one structure the client consults to decide it need not re-fetch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import 'fake-indexeddb/auto';

import {
  EMPTY_COVERAGE,
  LocalIndex,
  isVerifiedAt,
  readCoverage,
  runIngest,
  storeWriter,
} from '@bleavit/local-index';

const GENESIS = `0x${'c3'.repeat(32)}`;
const WATCHED = new Set(['alice']);

const scan = (number, { count = 2, watched = false } = {}) => ({
  number,
  extrinsicCount: count,
  events: watched
    ? [{ phase: { kind: 'apply-extrinsic', index: 1 }, pallet: 'Balances', name: 'Transfer', accounts: ['alice'] }]
    : [{ phase: { kind: 'finalization' }, pallet: 'System', name: 'CodeUpdated', accounts: [] }],
});

const decodeRow = () => ({ account: 'alice', call: 'Balances.transfer_keep_alive' });
const encodeEvent = (write, event, index) => ({
  id: `${write.blockNumber}:${index}`,
  blockNumber: write.blockNumber,
  pallet: event.pallet,
  name: event.name,
  origin: 'self',
  decoded: true,
});

const ports = (db, over = {}) => ({
  fetchBodies: async () => [new Uint8Array([0]), new Uint8Array([1])],
  write: storeWriter(db, decodeRow, encodeEvent),
  now: () => 1_000,
  ...over,
});

async function freshDb() {
  const db = new LocalIndex(GENESIS);
  await db.delete();
  await db.open();
  return db;
}

test('a run persists rows, events and coverage, and coverage survives a reopen', async () => {
  const db = await freshDb();
  const run = await runIngest(
    EMPTY_COVERAGE,
    [scan(10), scan(11, { watched: true }), scan(12)],
    WATCHED,
    'self',
    ports(db),
  );
  assert.equal(run.ingested, 3);
  assert.equal(run.stoppedAt, undefined);

  assert.equal(await db.txHistory.count(), 1, 'only the watched block produced a row');
  assert.equal(await db.events.count(), 3);

  // The durable half: what a restart would read back.
  const resumed = await readCoverage(db);
  assert.equal(isVerifiedAt(resumed, 12), true);
  assert.equal(isVerifiedAt(resumed, 13), false);
  db.close();
});

test('a failed row write leaves NO coverage behind — the transaction rolls both back', async () => {
  // The unsafe ordering, made impossible. `txHistory` rejects a row whose primary key is not
  // a string, so the bulkPut inside the transaction fails after the coverage put was issued;
  // if they were two writes, the coverage would already be committed.
  const db = await freshDb();
  const poison = storeWriter(
    db,
    () => ({ account: 'alice', call: 'x' }),
    encodeEvent,
  );
  await assert.rejects(
    poison({
      blockNumber: 20,
      scan: scan(20, { watched: true }),
      rows: [{ key: undefined, blockNumber: 20, extrinsicIndex: 1, provenance: 'verified-finalized', body: new Uint8Array() }],
      coverageAfter: { ranges: [{ origin: 'self', fromBlock: 20, toBlock: 20, ingestedAt: 1 }], holes: [] },
    }),
  );
  const after = await readCoverage(db);
  assert.equal(
    isVerifiedAt(after, 20),
    false,
    'coverage must not survive a write whose rows did not — this is the permanent, silent failure',
  );
  assert.equal(await db.txHistory.count(), 0);
  db.close();
});

test('a row fetched behind a layer-2 header is stored as `operator`, never `self`', async () => {
  // The loop derives provenance from the header; this asserts the store does not quietly
  // upgrade it on the way in, which would make a depth-fetched body indistinguishable from a
  // light-client-verified one for every later reader.
  const db = await freshDb();
  await runIngest(EMPTY_COVERAGE, [scan(30, { watched: true })], WATCHED, 'operator', ports(db));
  const [row] = await db.txHistory.toArray();
  assert.equal(row.origin, 'operator');

  // ...and the same block behind a self header is `self`, so the mapping is not a constant.
  const db2 = await freshDb();
  await runIngest(EMPTY_COVERAGE, [scan(30, { watched: true })], WATCHED, 'self', ports(db2));
  const [selfRow] = await db2.txHistory.toArray();
  assert.equal(selfRow.origin, 'self');
  db.close();
  db2.close();
});

test('replaying the same blocks is idempotent, so a re-ingest after a crash is free', async () => {
  // This is what makes "coverage behind the data" the harmless direction. If replay
  // duplicated rows, the safe ordering would not be safe.
  const db = await freshDb();
  const blocks = [scan(40), scan(41, { watched: true })];
  const first = await runIngest(EMPTY_COVERAGE, blocks, WATCHED, 'self', ports(db));
  const second = await runIngest(first.coverage, blocks, WATCHED, 'self', ports(db));
  assert.equal(await db.txHistory.count(), 1);
  assert.equal(await db.events.count(), 2);
  assert.equal(isVerifiedAt(second.coverage, 41), true);
  db.close();
});
