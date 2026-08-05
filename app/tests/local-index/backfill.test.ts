/**
 * Backfill arithmetic — 10 §6.4 (F8).
 *
 * §6.4 exists because the reviewed text was inconsistent **three ways**: it claimed 50
 * blk/s, said "~9 days of chain per hour" where that rate gives 12.5, and budgeted 20 blk/s
 * elsewhere. So the useful test is not that the module returns the published numbers — it is
 * that the published numbers are **re-derived** and agree, which is the check the three-way
 * inconsistency needed and did not have.
 *
 * Same discipline as `reference-model/sustainability.py` against 08 §10: the document's own
 * arithmetic, executed, so a spec table and an implementation cannot drift silently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKFILL_CHUNK_BLOCKS,
  BUDGETED_INGEST_BLOCKS_PER_SECOND,
  BackfillError,
  blocksPerTabHour,
  chainDaysPerTabHour,
  operatorWindowBlocks,
  planBackfill,
  tabHoursFor,
} from '@bleavit/local-index';

const RATE = BUDGETED_INGEST_BLOCKS_PER_SECOND;
/** 02 §8's 6-second blocks. The number lives in the suite rather than in the package: the
 * package reads the chain's cadence from metadata (10 §5.4), and a test asserting a
 * published figure is exactly where a literal for it belongs. */
const BLOCKS_PER_DAY = 14_400;
const OPERATOR_WINDOW_BLOCKS = operatorWindowBlocks(BLOCKS_PER_DAY);

test("§6.4's published table is re-derived, not restated", () => {
  // | Chain time backfilled per hour of tab time | 72,000 blocks = 5.0 days |
  assert.equal(blocksPerTabHour(RATE), 72_000);
  assert.equal(chainDaysPerTabHour(RATE, BLOCKS_PER_DAY), 5);
  // | Full 30-day operator window (432,000 blocks) | 6.0 hours of tab time |
  assert.equal(OPERATOR_WINDOW_BLOCKS, 432_000);
  assert.equal(tabHoursFor(OPERATOR_WINDOW_BLOCKS, RATE), 6);
  // And the inputs the table is derived from, so a change to either is visible here.
  assert.equal(BLOCKS_PER_DAY, 14_400, '6-second blocks');
  // And blocks-per-day is a required argument, so a chain that changed cadence reaches here.
  assert.equal(chainDaysPerTabHour.length, 2);
  assert.equal(RATE, 20, 'the budgeted desktop ingest rate');
});

test('the superseded figures do not reproduce, which is what made them wrong', () => {
  // The reviewed text's own numbers, kept as a regression: at 50 blk/s an hour of tab time
  // is 12.5 days of chain, not the ~9 it claimed — and 20 blk/s is what §21 budgeted.
  assert.equal(chainDaysPerTabHour(50, BLOCKS_PER_DAY), 12.5);
  assert.notEqual(chainDaysPerTabHour(50, BLOCKS_PER_DAY), 9);
});

test('the rate is a required argument everywhere, because it is [VERIFY]', () => {
  // §12 records "backfill arithmetic at 20 blk/s until FE-P4 measures reality" as a
  // conservative assumption in force. A default would let a measured rate arrive and never
  // reach the callers that needed it, so a caller says which number it means.
  assert.equal(blocksPerTabHour.length, 1);
  assert.equal(tabHoursFor.length, 2);
  assert.throws(() => blocksPerTabHour(0), BackfillError);
  assert.throws(() => blocksPerTabHour(-1), BackfillError);
  assert.throws(() => blocksPerTabHour(Number.NaN), BackfillError);
});

test('a plan runs newest to oldest in 1,000-block chunks', () => {
  const head = 1_000_000;
  const plan = planBackfill(head - 2_500, head, head, RATE, BLOCKS_PER_DAY);
  assert.equal(plan.totalBlocks, 2_501);
  assert.equal(BACKFILL_CHUNK_BLOCKS, 1_000);
  // Newest first: an interrupted plan leaves the user with the part they were looking at.
  assert.equal(plan.chunks[0].toBlock, head);
  assert.ok(plan.chunks[0].fromBlock > plan.chunks[1].fromBlock);
  assert.equal(plan.chunks.at(-1).fromBlock, head - 2_500);
  // Contiguous and non-overlapping, so a block is neither missed nor ingested twice.
  const covered = plan.chunks.reduce((sum, chunk) => sum + (chunk.toBlock - chunk.fromBlock + 1), 0);
  assert.equal(covered, plan.totalBlocks);
  for (let i = 1; i < plan.chunks.length; i += 1) {
    assert.equal(plan.chunks[i].toBlock + 1, plan.chunks[i - 1].fromBlock);
  }
});

test('a plan reaching past the operator window is refused, never truncated', () => {
  // §6.4: "backfill beyond the operator window *does not exist*". Truncating would produce a
  // shorter plan that runs to completion and reports success having never fetched the range
  // the caller asked for.
  const head = 1_000_000;
  assert.throws(() => planBackfill(head - OPERATOR_WINDOW_BLOCKS - 1, head, head, RATE, BLOCKS_PER_DAY), BackfillError);
  assert.doesNotThrow(() => planBackfill(head - OPERATOR_WINDOW_BLOCKS, head, head, RATE, BLOCKS_PER_DAY));
});

test('the window is measured from the live head, not from the range', () => {
  // A plan validated against a stale head would creep past the window one session at a time,
  // each step looking lawful.
  const head = 1_000_000;
  const from = head - OPERATOR_WINDOW_BLOCKS;
  assert.doesNotThrow(() => planBackfill(from, from + 10, head, RATE, BLOCKS_PER_DAY));
  assert.throws(() => planBackfill(from, from + 10, head + 1, RATE, BLOCKS_PER_DAY), BackfillError);
});

test('an inverted range, a future range and a zero chunk are refused', () => {
  const head = 1_000_000;
  assert.throws(() => planBackfill(head - 10, head - 20, head, RATE, BLOCKS_PER_DAY), BackfillError);
  assert.throws(() => planBackfill(head - 10, head + 1, head, RATE, BLOCKS_PER_DAY), BackfillError);
  assert.throws(() => planBackfill(head - 10, head, head, RATE, BLOCKS_PER_DAY, 0), BackfillError);
  assert.throws(() => planBackfill(1.5, head, head, RATE, BLOCKS_PER_DAY), BackfillError);
});

test('a single-block plan is one chunk', () => {
  const head = 500;
  const plan = planBackfill(head, head, head, RATE, BLOCKS_PER_DAY);
  assert.deepEqual(plan.chunks, [{ fromBlock: head, toBlock: head }]);
  assert.equal(plan.totalBlocks, 1);
});

test('the estimate is the arithmetic, not a separate constant', () => {
  const head = 1_000_000;
  const plan = planBackfill(head - 71_999, head, head, RATE, BLOCKS_PER_DAY);
  assert.equal(plan.totalBlocks, 72_000);
  assert.equal(plan.estimatedTabHours, 1);
});
