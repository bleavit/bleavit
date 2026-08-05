/**
 * Snapshot import quotas — 10 §8.4 (F9).
 *
 * The spec sentence is one line and every clause in it is a separate control:
 * *"≤ 400 MB uncompressed, ≤ 4 M rows, **streamed**, **eviction preview before import**"*.
 *
 * What this suite pins is that each clause is load-bearing rather than descriptive — a quota
 * checked after the stream, a single bound instead of both, or a preview shown after the
 * write would each pass a happy-path test perfectly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_QUOTA,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_UNCOMPRESSED_BYTES,
  admitChunk,
  planImport,
  previewCopy,
} from '@bleavit/providers';

test('the quota refuses at the chunk that crosses the line, not after the stream', () => {
  // "Streamed" is where the quota is enforced, not a performance note. A check that runs
  // after the file is read is enforced by the browser running out of memory, which is a
  // crash with a moral rather than a refusal.
  const half = Math.floor(IMPORT_MAX_UNCOMPRESSED_BYTES / 2);
  const first = admitChunk(EMPTY_QUOTA, half, 10);
  assert.equal(first.kind, 'accepted');
  const second = admitChunk(first.state, half, 10);
  assert.equal(second.kind, 'accepted', 'exactly at the bound is still admissible');
  const third = admitChunk(second.state, 1, 0);
  assert.equal(third.kind, 'refused');
  assert.equal(third.breach, 'bytes');
  assert.match(third.message, /runs out of memory loses everything already imported/);
});

test('both bounds are enforced — either alone is trivially evaded', () => {
  // 400 MB in 100 rows and 4 M rows totalling 10 MB are each inside one bound and outside
  // the other, and both break something real.
  const manyRows = admitChunk({ bytes: 1_000, rows: IMPORT_MAX_ROWS }, 1, 1);
  assert.equal(manyRows.kind, 'refused');
  assert.equal(manyRows.breach, 'rows');
  assert.match(manyRows.message, /separate limit from/);

  const bigBytes = admitChunk({ bytes: IMPORT_MAX_UNCOMPRESSED_BYTES, rows: 5 }, 1, 0);
  assert.equal(bigBytes.kind, 'refused');
  assert.equal(bigBytes.breach, 'bytes');
});

test('a malformed chunk measurement throws rather than walking the meter backwards', () => {
  // Treating a negative as zero would let a producer under-report its way past the bound.
  const malformed: ReadonlyArray<readonly [bytes: number, rows: number]> = [
    [-1, 0],
    [0, -1],
    [1.5, 0],
    [0, 1.5],
  ];
  for (const [bytes, rows] of malformed) {
    assert.throws(() => admitChunk(EMPTY_QUOTA, bytes, rows), RangeError);
  }
});

test('the meter is pure, so one import cannot inherit another’s totals', () => {
  // A stateful meter reused across two imports carries the first one's totals into the
  // second's headroom, which reads as a smaller snapshot than it is.
  const a = admitChunk(EMPTY_QUOTA, 100, 1);
  const b = admitChunk(EMPTY_QUOTA, 100, 1);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(EMPTY_QUOTA, { bytes: 0, rows: 0 }, 'the empty state is not mutated');
});

test('the plan writes nothing and names what would be lost, oldest first', () => {
  // The user's decision is whether to trade what they have for what the snapshot offers, and
  // they can only make it while they still have both. Oldest first because §9.2's ladder
  // gives up depth before recency — evicting the newest data to store a snapshot of old data
  // is the exact inversion of what the user wants.
  const plan = planImport(
    { bytes: 60, rows: 10 },
    [
      { table: 'candles1h', rows: 5, bytes: 30, oldestBlock: 900 },
      { table: 'priceSamples', rows: 7, bytes: 30, oldestBlock: 100 },
      { table: 'events', rows: 3, bytes: 30, oldestBlock: 500 },
    ],
    // held 90 + incoming 60 − budget 100 = 50 over, so one 30-byte table is not enough and
    // the plan must reach for a second — which is what makes the ORDER observable at all.
    100,
  );
  assert.deepEqual(plan.wouldEvict.map((line) => line.table), ['priceSamples', 'events']);
  assert.equal(plan.evictedBytes, 60);
  // And it stops as soon as it has enough: `candles1h` is the newest and survives.
  assert.ok(!plan.wouldEvict.some((line) => line.table === 'candles1h'));
  assert.equal(plan.infeasible, false);
  const copy = previewCopy(plan);
  assert.match(copy, /priceSamples \(7 rows\)/);
  assert.match(copy, /only if you continue/);
  assert.match(copy, /cannot be undone/);
});

test('a snapshot that fits evicts nothing, so the preview is not vacuous', () => {
  const plan = planImport({ bytes: 10, rows: 1 }, [{ table: 'events', rows: 1, bytes: 10, oldestBlock: 1 }], 1_000);
  assert.deepEqual(plan.wouldEvict, []);
  assert.match(previewCopy(plan), /fits without evicting anything/);
});

test('an infeasible import is REPORTED, not thrown — the user is owed the reason', () => {
  // A plan that refuses to be constructed cannot show why it cannot fit, and "import failed"
  // with no explanation is what makes somebody delete their local data by hand and retry.
  // `rows` was missing here until the type-check pass caught it. `planImport` reads only
  // `incoming.bytes`, so the omission changed no behaviour and no assertion — a fixture that
  // was not a `QuotaState` at all, sitting in a green suite.
  const plan = planImport(
    { bytes: 1_000, rows: 1 },
    [{ table: 'events', rows: 1, bytes: 10, oldestBlock: 1 }],
    100,
  );
  assert.equal(plan.infeasible, true);
  assert.match(previewCopy(plan), /Nothing has been imported and nothing has been deleted/);
});

test('the published bounds are the spec’s, stated once', () => {
  // 10 §8.4's own numbers. Asserted so a "tuning" change has to be a deliberate edit here
  // and in the doc, rather than a constant somebody nudged.
  assert.equal(IMPORT_MAX_UNCOMPRESSED_BYTES, 400_000_000);
  assert.equal(IMPORT_MAX_ROWS, 4_000_000);
});
