/**
 * Candles and the retention ladder — 10 §9.2 (F8).
 *
 * §9.2's title is the specification: *"degrades depth, never correctness"*. The first half
 * is easy. The second is where a storage manager quietly lies, and §9.2 names the exact lie
 * it must not tell: *"holes stay truthful even after eviction — an evicted range becomes a
 * labelled 'downsampled' range, not a hole, and never a silent splice"*.
 *
 * Those are three different misinformations and the suite separates them, because a checker
 * that only asserts "the data is still there" cannot tell them apart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CandleError,
  DEGRADATION_LADDER,
  bucketSeconds,
  bucketStart,
  downsample,
  foldCandles,
  holesIn,
  nextResolution,
  rollUp,
  selfRange,
} from '@bleavit/local-index';

const HOUR = 3_600;
const sample = (at, price, blockNumber, bookId = 'book-1') => ({
  bookId,
  at,
  price1e9: BigInt(price),
  blockNumber,
});

test('the ladder is §9.2’s order, and the order is the guarantee', () => {
  // A ladder applied out of order frees the same bytes and destroys more resolution than it
  // had to, which is why the sequence is data rather than four branches.
  assert.deepEqual([...DEGRADATION_LADDER], ['raw', 'candles1h', 'candles4h', 'candles1d']);
  assert.equal(nextResolution('raw'), 'candles1h');
  assert.equal(nextResolution('candles1h'), 'candles4h');
  assert.equal(nextResolution('candles4h'), 'candles1d');
});

test('the floor returns undefined rather than throwing', () => {
  // "There is nothing left to give up" is the answer the quota manager needs in order to
  // stop; a throw would make the terminal case of a normal loop look like a failure. §9.2
  // justifies the floor arithmetically: a daily row costs books × 120 B/day even at max
  // load, so depth there is effectively unbounded.
  assert.equal(nextResolution('candles1d'), undefined);
  assert.throws(() => nextResolution('candles5m'), CandleError);
});

test('bucket widths are the ladder’s own', () => {
  assert.equal(bucketSeconds('candles1h'), 3_600);
  assert.equal(bucketSeconds('candles4h'), 14_400);
  assert.equal(bucketSeconds('candles1d'), 86_400);
  // Aligned to the epoch, so two clients that ingested different samples agree on where a
  // bucket starts — otherwise the same chain produces two incompatible chart series.
  assert.equal(bucketStart(HOUR * 5 + 59, 'candles1h'), HOUR * 5);
  assert.equal(bucketStart(0, 'candles1d'), 0);
});

test('open and close are decided by time, never by array order', () => {
  // The failure this prevents is not obviously wrong on a chart: an inverted candle is a
  // plausible bar pointing the other way. §6.4 requires backfill newest-first, so samples
  // arriving in reverse is the ordinary case rather than an exotic one.
  const forwards = foldCandles(
    [sample(10, 100, 1), sample(20, 300, 2), sample(30, 200, 3)],
    'candles1h',
  );
  const backwards = foldCandles(
    [sample(30, 200, 3), sample(20, 300, 2), sample(10, 100, 1)],
    'candles1h',
  );
  assert.deepEqual(forwards, backwards);
  assert.equal(forwards[0].open1e9, 100n);
  assert.equal(forwards[0].close1e9, 200n);
  assert.equal(forwards[0].high1e9, 300n);
  assert.equal(forwards[0].low1e9, 100n);
  assert.equal(forwards[0].samples, 3);
});

test('two books never share a bucket', () => {
  // A candle is a claim about one book's price; merging two produces a number describing no
  // market that exists — the same rule 11 §11.2a states for cross-domain totals.
  const candles = foldCandles(
    [sample(10, 100, 1, 'book-1'), sample(20, 900, 2, 'book-2')],
    'candles1h',
  );
  assert.equal(candles.length, 2);
  assert.deepEqual(candles.map((c) => c.bookId).sort(), ['book-1', 'book-2']);
});

test('a candle records the block span it summarises', () => {
  // So coverage stays checkable after the raw samples are gone: without it, an evicted range
  // could only be described by time, and coverage is expressed in blocks.
  const [candle] = foldCandles([sample(10, 100, 40), sample(20, 200, 12)], 'candles1h');
  assert.equal(candle.fromBlock, 12);
  assert.equal(candle.toBlock, 40);
});

test('rolling up composes exactly — the coarse candle is the one the samples would have made', () => {
  // Rolling rather than re-folding is not an optimisation: the raw samples are gone by the
  // time this runs, which is the whole point of the ladder.
  const samples = [];
  for (let i = 0; i < 4 * 12; i += 1) {
    samples.push(sample(i * 300, 100 + ((i * 37) % 500), i + 1));
  }
  const hourly = foldCandles(samples, 'candles1h');
  const fromHourly = rollUp(hourly, 'candles4h');
  const fromSamples = foldCandles(samples, 'candles4h');
  assert.deepEqual(
    fromHourly.map((c) => [c.openAt, c.open1e9, c.high1e9, c.low1e9, c.close1e9, c.samples]),
    fromSamples.map((c) => [c.openAt, c.open1e9, c.high1e9, c.low1e9, c.close1e9, c.samples]),
  );
});

test('rolling a coarser candle into a finer bucket is refused', () => {
  // It would fabricate resolution the data never had.
  const [daily] = rollUp(foldCandles([sample(10, 100, 1)], 'candles1h'), 'candles1d');
  assert.throws(() => rollUp([daily], 'candles1h'), CandleError);
  assert.throws(() => rollUp([daily], 'candles1d'), CandleError);
});

test('an evicted range is downsampled — not a hole, and not a silent splice', () => {
  // Three distinct misinformations, and this is the one §9.2 spells out. A hole says nobody
  // ingested these blocks, which is false and (per §6.3) invites a provider refetch that
  // could add no detail. A silent splice draws the coarse line as if nothing changed.
  const range = downsample(1_000, 2_000, 'candles1h');
  assert.equal(range.resolution, 'candles1h');
  assert.notEqual(range.resolution, 'raw');
  assert.match(range.reason, /not a gap/);
  // It is a distinct type, not a flag: a boolean defaults to the silent-splice reading in
  // every component that forgot to read it.
  assert.ok(!('origin' in range), 'a downsampled range is not a coverage range');
  // And the blocks stay covered — `holesIn` over the same span reports nothing missing.
  const coverage = [selfRange(1_000, 2_000, 1)];
  assert.deepEqual(holesIn(coverage, { fromBlock: 1_000, toBlock: 2_000 }), []);
});

test('a malformed range or timestamp is refused rather than summarised', () => {
  assert.throws(() => downsample(2_000, 1_000, 'candles1h'), CandleError);
  assert.throws(() => downsample(1.5, 2_000, 'candles1h'), CandleError);
  assert.throws(() => foldCandles([sample(1.5, 100, 1)], 'candles1h'), CandleError);
  assert.throws(() => foldCandles([sample(10, 100, -1)], 'candles1h'), CandleError);
  assert.throws(() => bucketStart(-1, 'candles1h'), CandleError);
});

test('folding nothing produces nothing, without inventing an empty candle', () => {
  // An empty candle would render as a flat bar at zero — a price claim about a book that
  // was never observed.
  assert.deepEqual(foldCandles([], 'candles1h'), []);
  assert.deepEqual(rollUp([], 'candles1d'), []);
});
