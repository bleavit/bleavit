/**
 * The ingestion loop — 10 §6.5's orchestration (F8).
 *
 * Every judgement the loop makes was already tested in `coverage`/`ingest`. What this suite
 * tests is the three things only *order and continuity* can break, each of which is invisible
 * to a unit test of the pure functions and each of which fails silently in production:
 *
 * 1. coverage advancing before the write lands — `isVerifiedAt` then answers `true` for a
 *    block with no data behind it, and coverage is the very structure used to decide the
 *    client does *not* need to re-fetch;
 * 2. a subscription resuming past a gap and claiming the skipped blocks — 10 §6.3's
 *    forbidden promotion, arrived at by a reconnect rather than by a merge;
 * 3. a failed body fetch leaving the block recorded as ingested — a *filtered* history is
 *    indistinguishable from an empty one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_COVERAGE,
  IngestLoopError,
  ingestBlock,
  isVerifiedAt,
  runIngest,
} from '@bleavit/local-index';

const WATCHED = new Set(['alice']);

const scan = (number, { count = 2, watched = false } = {}) => ({
  number,
  extrinsicCount: count,
  events: watched
    ? [
        {
          phase: { kind: 'apply-extrinsic', index: 1 },
          pallet: 'Balances',
          name: 'Transfer',
          accounts: ['alice'],
        },
      ]
    : [{ phase: { kind: 'finalization' }, pallet: 'System', name: 'CodeUpdated', accounts: [] }],
});

const ports = (over = {}) => ({
  fetchBodies: async () => [new Uint8Array([0]), new Uint8Array([1])],
  write: async () => {},
  now: () => 1_000,
  ...over,
});

test('a block with no watched extrinsic never triggers a body fetch (§6.5 cost claim)', async () => {
  // The claim is "overhead proportional to the user's own activity, not chain activity", and
  // it is a property of this call site rather than of the fetcher.
  let fetches = 0;
  const result = await ingestBlock(
    EMPTY_COVERAGE,
    scan(100),
    WATCHED,
    'self',
    ports({ fetchBodies: async () => { fetches += 1; return []; } }),
  );
  assert.equal(fetches, 0);
  assert.equal(result.fetchedBody, false);
  assert.equal(result.rowCount, 0);
  assert.equal(isVerifiedAt(result.coverage, 100), true);
});

test('an attributed block fetches once and rows carry the HEADER’s provenance', async () => {
  const verified = await ingestBlock(
    EMPTY_COVERAGE, scan(100, { watched: true }), WATCHED, 'self', ports(),
  );
  assert.equal(verified.fetchedBody, true);
  assert.equal(verified.rowCount, 1);

  // The same block ingested behind a layer-2 header is `provider`, because the body's
  // extrinsics-root check is only as good as the header's provenance.
  let captured;
  await ingestBlock(
    EMPTY_COVERAGE, scan(100, { watched: true }), WATCHED, 'operator',
    ports({ write: async (w) => { captured = w; } }),
  );
  assert.equal(captured.rows[0].provenance, 'provider');
});

test('coverage does NOT advance when the write fails', async () => {
  // The failure this module is shaped around: coverage claiming blocks whose rows were never
  // stored. Coverage is what the client consults to decide it need not re-fetch, so the gap
  // becomes permanent and invisible.
  await assert.rejects(
    ingestBlock(EMPTY_COVERAGE, scan(100), WATCHED, 'self', ports({
      write: async () => { throw new Error('quota exceeded'); },
    })),
    /quota exceeded/,
  );
  // The caller's coverage object is untouched — there is no half-advanced state to inherit.
  assert.equal(isVerifiedAt(EMPTY_COVERAGE, 100), false);
});

test('a failed body fetch fails the block rather than recording it as ingested', async () => {
  // A filtered history is indistinguishable from an empty one, so a block whose attributed
  // rows cannot be built must stay outside coverage where a later pass finds it as a hole.
  let wrote = false;
  await assert.rejects(
    ingestBlock(EMPTY_COVERAGE, scan(100, { watched: true }), WATCHED, 'self', ports({
      fetchBodies: async () => { throw new Error('peer disconnected'); },
      write: async () => { wrote = true; },
    })),
    (error) => {
      assert.ok(error instanceof IngestLoopError);
      assert.equal(error.blockNumber, 100);
      assert.match(error.message, /filtered history looks exactly like an empty one/);
      return true;
    },
  );
  assert.equal(wrote, false, 'nothing may be written when the block cannot be completed');
});

test('a body whose extrinsic count disagrees with the scan is refused', async () => {
  // Indexing into it would attribute a different block's extrinsic to this user — the same
  // failure `attributedExtrinsics` refuses a bad index for, arriving from the other side.
  await assert.rejects(
    ingestBlock(EMPTY_COVERAGE, scan(100, { watched: true, count: 2 }), WATCHED, 'self', ports({
      fetchBodies: async () => [new Uint8Array([0])],
    })),
    /would read a different block/,
  );
});

test('a subscription resuming past a gap leaves a HOLE, never a claimed span', async () => {
  // The reconnect route to 10 §6.3's forbidden promotion. One wide range would be cheaper and
  // would claim every skipped block as self-ingested.
  const run = await runIngest(
    EMPTY_COVERAGE,
    [scan(100), scan(101), scan(500), scan(501)],
    WATCHED,
    'self',
    ports(),
  );
  assert.equal(run.ingested, 4);
  assert.equal(run.stoppedAt, undefined);
  for (const block of [100, 101, 500, 501]) {
    assert.equal(isVerifiedAt(run.coverage, block), true, `${block} was ingested`);
  }
  for (const block of [102, 300, 499]) {
    assert.equal(isVerifiedAt(run.coverage, block), false, `${block} was never ingested`);
  }
  // And the gap is a first-class hole rather than an absence somebody has to notice.
  assert.ok(
    run.coverage.holes.some((hole) => hole.fromBlock === 102 && hole.toBlock === 499),
    JSON.stringify(run.coverage.holes),
  );
});

test('adjacent blocks DO join, so the hole test is not passing for the wrong reason', async () => {
  const run = await runIngest(EMPTY_COVERAGE, [scan(10), scan(11), scan(12)], WATCHED, 'self', ports());
  assert.equal(run.coverage.ranges.length, 1, JSON.stringify(run.coverage.ranges));
  assert.equal(run.coverage.holes.length, 0);
});

test('the run stops at the first failure and reports the coverage it actually reached', async () => {
  // Continuing past a failed block would leave a hole the caller never learns about, and this
  // is the only place the loop can still report it.
  const run = await runIngest(
    EMPTY_COVERAGE,
    [scan(10), scan(11, { watched: true }), scan(12)],
    WATCHED,
    'self',
    ports({ fetchBodies: async () => { throw new Error('gone'); } }),
  );
  // Only block 10. Block 11 is the one with a watched extrinsic, so it is the one whose body
  // fetch fails, and the run stops there rather than skipping past it.
  assert.equal(run.ingested, 1);
  assert.equal(isVerifiedAt(run.coverage, 10), true);
  assert.equal(isVerifiedAt(run.coverage, 11), false, 'the failed block is not claimed');
  assert.ok(run.stoppedAt instanceof IngestLoopError);
  assert.equal(run.stoppedAt.blockNumber, 11);
  assert.equal(isVerifiedAt(run.coverage, 12), false, 'nothing past the failure is claimed');
});

test('blocks are ingested sequentially — N+1 cannot land before N’s write', async () => {
  // Rule 1 broken by parallelism rather than by ordering, with an identical symptom.
  const order = [];
  await runIngest(EMPTY_COVERAGE, [scan(1), scan(2), scan(3)], WATCHED, 'self', ports({
    write: async (w) => {
      order.push(`start-${w.blockNumber}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end-${w.blockNumber}`);
    },
  }));
  assert.deepEqual(order, [
    'start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3',
  ]);
});
