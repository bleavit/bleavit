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
  pendingDecoderCount,
  readCoverage,
  runIngest,
  storeWriter,
} from '@bleavit/local-index';
import type {
  AttributedRow,
  EventEncoder,
  FinalizedBlockScan,
  HeaderSource,
  LoopPorts,
} from '@bleavit/local-index';
import { selfRange } from '@bleavit/local-index/testing';
import { nth } from './nth.ts';

/**
 * A row as a *malformed* producer would supply it.
 *
 * The one use below hands `txHistory` a row whose primary key is not a string, which is
 * what makes the `bulkPut` fail **after** the coverage put was issued inside the same
 * transaction. The type forbids it — correctly — so the cast is what lets the suite ask
 * whether the rollback really covers both writes. Nothing else may use it.
 */
type MalformedRow = Omit<AttributedRow, 'key'> & { readonly key: unknown };
const asRow = (record: MalformedRow): AttributedRow => record as AttributedRow;

const GENESIS = `0x${'c3'.repeat(32)}`;
const WATCHED = new Set(['alice']);
// 10 §6.5's header sources. `OPERATOR` names *which* operator because the type requires it:
// two operators are two sources, and a range that cannot say which one it came from cannot
// be invalidated without taking honest ranges with it.
const SELF: HeaderSource = { origin: 'self' };
const OPERATOR: HeaderSource = { origin: 'operator', providerId: 'op-1' };
/** An **opt-in third-party** source — the origin `bodyProvenance` alone cannot distinguish. */
const INDEXER: HeaderSource = { origin: 'indexer', providerId: 'acme' };


/** §6.3's hash-at-edge, varying with the block so an edge comparison can actually fail. */
const blockHash = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

const scan = (
  number: number,
  { count = 2, watched = false }: { count?: number | undefined; watched?: boolean } = {},
): FinalizedBlockScan => ({
  number,
  hash: blockHash(number),
  specVersion: 3,
  extrinsicCount: count,
  events: watched
    ? [{ phase: { kind: 'apply-extrinsic', index: 1 }, pallet: 'Balances', name: 'Transfer', accounts: ['alice'] }]
    : [{ phase: { kind: 'finalization' }, pallet: 'System', name: 'CodeUpdated', accounts: [] }],
});

const decodeRow = () => ({ account: 'alice', call: 'Balances.transfer_keep_alive' });
// The encoder supplies only what it **decoded**. It used to return a whole `StoredEvent`,
// origin included, and every caller wrote a constant — so the field deciding whether a row
// renders as light-client-verified or as third-party data was chosen by a callback that is
// never handed the `HeaderSource` and therefore cannot know the answer.
const encodeEvent: EventEncoder = (_write, event) => ({
  pallet: event.pallet,
  name: event.name,
  decoded: true,
});

const ports = (db: LocalIndex, over: Partial<LoopPorts> = {}): LoopPorts => ({
  fetchBodies: async () => [new Uint8Array([0]), new Uint8Array([1])],
  write: storeWriter(db, decodeRow, encodeEvent),
  now: () => 1_000,
  genesisHash: GENESIS,
  observeEdge: () => undefined,
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
    SELF,
    ports(db),
  );
  assert.equal(run.ingested, 3);
  assert.equal(run.stoppedAt, undefined);

  assert.equal(await db.txHistory.count(), 1, 'only the watched block produced a row');
  // **One event, not three.** 10 §9.1 rules that the index retains only events attributing to a
  // watched account; blocks 10 and 12 carry a `System.CodeUpdated` naming nobody.
  assert.equal(await db.events.count(), 1);

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
      rows: [
        asRow({
          key: undefined,
          blockNumber: 20,
          extrinsicIndex: 1,
          provenance: 'verified-finalized',
          body: new Uint8Array(),
        }),
      ],
      // The block's own event, retained because the scan's watched fixture names `alice`.
      retainedEvents: scan(20, { watched: true }).events.map((event, index) => ({ event, index })),
      headerSource: SELF,
      coverageAfter: {
        ranges: [
          selfRange(20, 20, 1, { genesisHash: GENESIS, hash: blockHash(20), specVersion: 3 }),
        ],
        holes: [],
      },
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
  await runIngest(EMPTY_COVERAGE, [scan(30, { watched: true })], WATCHED, OPERATOR, ports(db));
  const row = nth(await db.txHistory.toArray(), 0, 'stored event');
  assert.equal(row.origin, 'operator');

  // ...and the same block behind a self header is `self`, so the mapping is not a constant.
  const db2 = await freshDb();
  await runIngest(EMPTY_COVERAGE, [scan(30, { watched: true })], WATCHED, SELF, ports(db2));
  const selfRow = nth(await db2.txHistory.toArray(), 0, 'stored event');
  assert.equal(selfRow.origin, 'self');
  db.close();
  db2.close();
});

test('the COVERAGE a layer-2 header produces is `operator` too, not just its rows', async () => {
  // The regression. The test above passed while the loop minted `selfRange` unconditionally:
  // it read the *rows*, and the rows were always right. Coverage is the structure
  // `isVerifiedAt` answers from and the one the client uses to decide it need not re-fetch,
  // so labelling it `self` promoted provider backfill to light-client-verified — with the
  // row beside it still honestly saying `provider`. Two records of the same block
  // disagreeing, and the more authoritative one wrong.
  const db = await freshDb();
  const run = await runIngest(EMPTY_COVERAGE, [scan(30, { watched: true })], WATCHED, OPERATOR, ports(db));

  assert.equal(
    isVerifiedAt(run.coverage, 30),
    false,
    'a block ingested behind an operator header must never read as light-client verified',
  );
  const range = nth(run.coverage.ranges, 0, 'range');
  assert.equal(range.origin, 'operator');
  assert.equal(
    range.providerId,
    'op-1',
    'the range must name WHICH provider: invalidating one operator must not drop another’s ranges',
  );

  // The positive control — the same block behind a self header still does read as verified,
  // so this is not a test that passes because nothing is ever verified.
  const db2 = await freshDb();
  const verified = await runIngest(EMPTY_COVERAGE, [scan(30, { watched: true })], WATCHED, SELF, ports(db2));
  assert.equal(isVerifiedAt(verified.coverage, 30), true);
  db.close();
  db2.close();
});

test('operator and self ranges never merge, so a backfilled span stays visible', async () => {
  // `addRange` joins only same-origin, same-provider ranges. Adjacent blocks from different
  // sources must therefore stay two ranges: a merged one would have to claim a single origin,
  // and either choice is a lie 10 §6.3 forbids in a different direction.
  const db = await freshDb();
  let coverage = (await runIngest(EMPTY_COVERAGE, [scan(50)], WATCHED, SELF, ports(db))).coverage;
  coverage = (await runIngest(coverage, [scan(51)], WATCHED, OPERATOR, ports(db))).coverage;

  assert.equal(coverage.ranges.length, 2, 'adjacent blocks of different provenance must not splice');
  assert.equal(isVerifiedAt(coverage, 50), true);
  assert.equal(isVerifiedAt(coverage, 51), false);
  db.close();
});

test('replaying the same blocks is idempotent, so a re-ingest after a crash is free', async () => {
  // This is what makes "coverage behind the data" the harmless direction. If replay
  // duplicated rows, the safe ordering would not be safe.
  const db = await freshDb();
  const blocks = [scan(40), scan(41, { watched: true })];
  const first = await runIngest(EMPTY_COVERAGE, blocks, WATCHED, SELF, ports(db));
  const second = await runIngest(first.coverage, blocks, WATCHED, SELF, ports(db));
  assert.equal(await db.txHistory.count(), 1);
  assert.equal(await db.events.count(), 1, 'block 40 names nobody watched and is not retained');
  assert.equal(isVerifiedAt(second.coverage, 41), true);
  db.close();
});

/**
 * A deterministic PRNG — 15 §4.8 asks for *"ingest idempotency under random crash/replay"*, and
 * a randomized test with an unseeded generator is one whose failures cannot be reproduced. The
 * seed is printed with every failure so a red run names the case that produced it.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — small, dependency-free, and adequate for choosing block shapes.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** Everything a replay must reproduce exactly, in a comparable form. */
async function snapshotOf(db: LocalIndex) {
  const coverage = await readCoverage(db);
  return {
    events: (await db.events.orderBy('id').toArray()).map((e) => `${e.id}|${e.pallet}.${e.name}|${e.origin}`),
    rows: (await db.txHistory.orderBy('id').toArray()).map((r) => `${r.id}|${r.account}|${r.call}|${r.origin}`),
    ranges: coverage.ranges.map((r) => `${r.origin}:${r.fromBlock}..${r.toBlock}`),
    holes: coverage.holes.map((h) => `${h.fromBlock}..${h.toBlock}`),
  };
}

test('ingest is idempotent under RANDOM crash and replay (15 §4.8)', async () => {
  // The property §6.5 pairs the `fut-ingest` lock with: *"ingest writes remain idempotent
  // (deterministic PKs, cursor-range advance in the same IndexedDB transaction)"*. The hand
  // written replay test above proves it for one fixed pair of blocks, which is the case an
  // implementer has in mind while writing the keys. What it cannot see is a crash landing
  // between two writes at an arbitrary point, which is the only way this fails in production:
  // a tab closed mid-run, a leader handover, a quota error on one block of forty.
  //
  // Both directions are checked, and only one of them is obvious. Duplicate rows would make
  // "coverage behind the data" a lossy state rather than a free one. **Missing** rows are
  // worse and quieter: the replay resumes from persisted coverage, so a block the crashed run
  // recorded in coverage but never wrote rows for is one the replay will not revisit — and a
  // filtered history is indistinguishable from an empty one.
  for (let seed = 1; seed <= 24; seed += 1) {
    const next = rng(seed * 2_654_435_761);
    const blocks = [];
    for (let i = 0; i < 12; i += 1) {
      // Gaps as well as runs, so the replay has to reproduce holes and not only ranges.
      const number = 1_000 + i * (next() < 0.3 ? 5 : 1);
      blocks.push(scan(number, { watched: next() < 0.4 }));
    }

    // The reference: one clean run, no crash.
    const clean = await freshDb();
    await runIngest(EMPTY_COVERAGE, blocks, WATCHED, SELF, ports(clean));
    const expected = await snapshotOf(clean);
    clean.close();

    // The crashed run: the writer throws part-way, at a point chosen by the seed.
    const crashAfter = 1 + Math.floor(next() * (blocks.length - 1));
    const db = await freshDb();
    const durable = storeWriter(db, decodeRow, encodeEvent);
    let written = 0;
    const crashing = ports(db, {
      write: async (w) => {
        if (written >= crashAfter) throw new Error(`seed ${seed}: the tab closed after ${written} blocks`);
        written += 1;
        await durable(w);
      },
    });
    const partial = await runIngest(EMPTY_COVERAGE, blocks, WATCHED, SELF, crashing);
    assert.ok(partial.stoppedAt, `seed ${seed}: the crash never happened, so the replay proves nothing`);

    // The replay: resume from what is **persisted**, not from the in-memory result, because
    // that is all a restarted tab has.
    const resumed = await readCoverage(db);
    await runIngest(resumed, blocks, WATCHED, SELF, ports(db));
    assert.deepEqual(
      await snapshotOf(db),
      expected,
      `seed ${seed}: a crash after ${crashAfter} block(s) did not replay to the clean state`,
    );
    db.close();
  }
});


test('an INDEXER row is stored as `indexer`, not collapsed into `operator` (10 §7)', async () => {
  // The blocker this closes, and the reason the rows above could not see it. `BodyProvenance`
  // has two values (`verified-finalized` / `provider`) and `RangeOrigin` has four, so a writer
  // handed only the former had to guess which of `operator`, `snapshot` and `indexer` a
  // `provider` row came from — and it guessed `operator`.
  //
  // §7's own reason column forbids exactly that: *"layer-2 backfill is distinguishable from
  // opt-in third-party providers"*. The collapse fails in the dangerous direction, because
  // `operator` is 10 §6.2's **protocol-funded** window: a row an opt-in indexer supplied is
  // persisted, and would be badged, as funded layer-2 data the user never chose to trust.
  const db = await freshDb();
  await runIngest(EMPTY_COVERAGE, [scan(60, { watched: true })], WATCHED, INDEXER, ports(db));

  const row = nth(await db.txHistory.toArray(), 0, 'tx row');
  assert.equal(row.origin, 'indexer', 'an opt-in third-party row was badged as protocol-funded');
  assert.equal(row.providerId, 'acme', 'INV-FE-15 requires the origin to reach the pixel');

  // The events row too. Nothing set `origin` on an event from the header — the injected encoder
  // did, and an encoder is never handed the `HeaderSource`, so every existing caller wrote a
  // constant. The encoder now supplies only what it decoded.
  const event = nth(await db.events.toArray(), 0, 'stored event');
  assert.equal(event.origin, 'indexer');
  assert.equal(event.providerId, 'acme');

  // And the coverage range agrees with both, because all three derive from one argument.
  const coverage = await readCoverage(db);
  assert.equal(nth(coverage.ranges, 0, 'range').origin, 'indexer');
  assert.equal(nth(coverage.ranges, 0, 'range').providerId, 'acme');
  db.close();
});

test('two providers of the same kind stay two sources on the stored row', async () => {
  // One lying does not implicate the other, which is undiagnosable once the rows say only
  // "indexer".
  const db = await freshDb();
  await runIngest(EMPTY_COVERAGE, [scan(70, { watched: true })], WATCHED, INDEXER, ports(db));
  await runIngest(EMPTY_COVERAGE, [scan(80, { watched: true })], WATCHED, { origin: 'indexer', providerId: 'other' }, ports(db));
  const providers = (await db.txHistory.orderBy('id').toArray()).map((r) => r.providerId);
  assert.deepEqual(providers, ['acme', 'other']);
  db.close();
});

test('a row whose stated body provenance does not follow from its header is refused', async () => {
  // The two are one fact and §6.5 derives the first from the second, so a disagreement means
  // the loop and the writer were driven with different arguments — the same defect in the other
  // direction, and one that would otherwise be written to disk without comment.
  const db = await freshDb();
  const write = storeWriter(db, decodeRow, encodeEvent);
  await assert.rejects(
    write({
      blockNumber: 90,
      scan: scan(90, { watched: true }),
      rows: [
        {
          key: '0000000090:00001',
          blockNumber: 90,
          extrinsicIndex: 1,
          // `operator` derives `provider`, never `verified-finalized`.
          provenance: 'verified-finalized',
          body: new Uint8Array([1]),
        },
      ],
      retainedEvents: [],
      headerSource: OPERATOR,
      coverageAfter: EMPTY_COVERAGE,
    }),
    /10 §6.5 derives one from the other/,
  );
  assert.equal(await db.txHistory.count(), 0, 'the refused row was written anyway');
  db.close();
});

test('§6.5 stores an undecodable ERA raw, counts it, and keeps going', async () => {
  // The split. *This block's `System.Events` value is structurally unreadable* is a refusal and
  // must stay one — an empty `events` array reads as "no event here names anyone", so degrading
  // to it hides the user's own transaction. *The metadata for this block's era is unavailable*
  // is a different state: the bytes are intact and simply not decodable yet, and refusing there
  // stops the whole run at the first block from an older runtime — which is every backfill
  // across an upgrade.
  const db = await freshDb();
  const pending = {
    ...scan(100),
    events: [],
    pendingDecode: { raw: new Uint8Array([1, 2, 3]), reason: 'no metadata for spec_version 2' },
  };
  const run = await runIngest(EMPTY_COVERAGE, [pending, scan(101)], WATCHED, SELF, ports(db));
  assert.equal(run.stoppedAt, undefined, 'an unavailable era stopped the run');
  assert.equal(run.ingested, 2, 'the block after the undecodable one was skipped');
  assert.equal(run.pendingDecode, 1, '§6.5’s "N events pending decoder" counted nothing');

  const raw = nth(await db.events.where('blockNumber').equals(100).toArray(), 0, 'raw row');
  assert.equal(raw.decoded, false);
  assert.deepEqual(raw.raw, new Uint8Array([1, 2, 3]), 'the bytes were dropped, so it can never be decoded');
  assert.equal(await pendingDecoderCount(db), 1);
  // The block is still covered — it was seen, it is simply not readable yet.
  assert.equal(isVerifiedAt(await readCoverage(db), 100), true);
  db.close();
});

test('the loop runs §6.3’s edge checks before its first block, not after', async () => {
  // The failure they catch happens **while the client is not running**: a reorg past the
  // coverage edge, or a runtime upgrade under rows already decoded. Ingesting first extends the
  // wrong history by one block before the check that would have caught it — and the extension
  // joins the bad range, which makes the disposal coarser than it needed to be.
  const db = await freshDb();
  const stale = (await runIngest(EMPTY_COVERAGE, [scan(200)], WATCHED, SELF, ports(db))).coverage;

  const run = await runIngest(stale, [scan(201)], WATCHED, SELF, ports(db, {
    // The chain now reports a different hash at block 200 — a reorg past the coverage edge.
    observeEdge: () => ({ genesisHash: GENESIS, hash: `0x${'ff'.repeat(32)}`, specVersion: 3 }),
  }));
  assert.equal(run.invalidated.length, 1, 'the stale range survived the resume');
  assert.equal(isVerifiedAt(run.coverage, 200), false, 'a disowned block is still reported verified');
  assert.equal(isVerifiedAt(run.coverage, 201), true, 'the new block was not ingested');
  db.close();
});


test('the index retains WATCHED-ACCOUNT events only (10 §9.1)', async () => {
  // Ruled by SQ-557 and measured rather than asserted: at the chain-permitted `Traded` ceiling
  // the 15 % events share holds ~6.7 h desktop / ~1.7 h mobile of chain-wide rows, so an index
  // that stored every event would spend its whole share inside a working day and then evict the
  // user's own history to keep storing strangers' trades. §9.2: *"a chain-wide trade tape is a
  // bounded windowed read, never a retained table."*
  const db = await freshDb();
  const mixed: FinalizedBlockScan = {
    ...scan(300),
    events: [
      { phase: { kind: 'apply-extrinsic', index: 0 }, pallet: 'Market', name: 'Traded', accounts: ['mallory'] },
      { phase: { kind: 'apply-extrinsic', index: 1 }, pallet: 'Market', name: 'Traded', accounts: ['alice'] },
      { phase: { kind: 'apply-extrinsic', index: 1 }, pallet: 'System', name: 'ExtrinsicSuccess', accounts: [] },
    ],
  };
  await runIngest(EMPTY_COVERAGE, [mixed], WATCHED, SELF, ports(db));

  const stored = await db.events.toArray();
  assert.equal(stored.length, 1, 'a stranger’s trade or a correlation event was retained');
  assert.equal(nth(stored, 0, 'event').pallet, 'Market');

  // **The id keeps the index the event had in the SCAN**, not its position in the retained list.
  // Numbering the retained list would make the row id a function of which accounts were watched
  // at the time, so adding an account renumbers every earlier row and a replay writes a second
  // copy of history beside the first.
  assert.equal(nth(stored, 0, 'event').id, '300:1');

  // And the rule really is about the *account*, not about the block: re-ingesting the same block
  // with `mallory` watched too retains both, under stable ids.
  await runIngest(EMPTY_COVERAGE, [mixed], new Set(['alice', 'mallory']), SELF, ports(db));
  assert.deepEqual((await db.events.orderBy('id').toArray()).map((e) => e.id), ['300:0', '300:1']);
  db.close();
});
