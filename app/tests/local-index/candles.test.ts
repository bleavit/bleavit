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
  SCAN_AGGREGATE_RESOLUTION,
  bucketSeconds,
  bucketStart,
  candleCoversBlock,
  downsample,
  foldCandles,
  holesIn,
  mergeCandle,
  nextResolution,
  priceSample,
  rollUp,
  sourceKeyOf,
  tradeCandles,
} from '@bleavit/local-index';
// `selfRange` is test-only on purpose — see packages/local-index/src/testing.ts.
import type { Candle, PriceSample, Resolution } from '@bleavit/local-index';
import { selfRange } from '@bleavit/local-index/testing';
import { nth } from './nth.ts';

const HOUR = 3_600;
const EDGE = {
  genesisHash: `0x${'a1'.repeat(32)}`,
  hash: `0x${'b2'.repeat(32)}`,
  specVersion: 3,
};

/**
 * A light-client-ingested observation.
 *
 * Minted through `priceSample` rather than written as a literal, and that is the point of the
 * mint: `at` is derived from the **block's** timestamp, so a caller reaching for the device
 * clock has to write the word `blockTimestampMs`. `at: Date.now() / 1000` was invisible in
 * review and put two clients' identical trade into two different hours.
 */
const sample = (at: number, price: number, blockNumber: number, bookId = 'book-1'): PriceSample =>
  priceSample({ bookId, blockNumber, blockTimestampMs: at * 1000, price1e9: BigInt(price), origin: 'self' });

/** The same observation as an opt-in indexer supplied it. */
const fromIndexer = (
  at: number,
  price: number,
  blockNumber: number,
  providerId = 'acme',
  bookId = 'book-1',
): PriceSample =>
  priceSample({
    bookId,
    blockNumber,
    blockTimestampMs: at * 1000,
    price1e9: BigInt(price),
    origin: 'indexer',
    providerId,
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
  // Deliberately outside `Resolution`: a stored row rehydrated from IndexedDB carries
  // whatever string was written, and the refusal is what stops it being read as a rung.
  assert.throws(() => nextResolution('candles5m' as Resolution), CandleError);
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
  assert.equal(nth(forwards, 0, 'candle').open1e9, 100n);
  assert.equal(nth(forwards, 0, 'candle').close1e9, 200n);
  assert.equal(nth(forwards, 0, 'candle').high1e9, 300n);
  assert.equal(nth(forwards, 0, 'candle').low1e9, 100n);
  assert.equal(nth(forwards, 0, 'candle').samples, 3);
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
  const candle = nth(foldCandles([sample(10, 100, 40), sample(20, 200, 12)], 'candles1h'), 0, 'candle');
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
  const daily: Candle = nth(rollUp(foldCandles([sample(10, 100, 1)], 'candles1h'), 'candles1d'), 0, 'candle');
  assert.throws(() => rollUp([daily], 'candles1h'), CandleError);
  assert.throws(() => rollUp([daily], 'candles1d'), CandleError);
});

test('an evicted range is downsampled — not a hole, and not a silent splice', () => {
  // Three distinct misinformations, and this is the one §9.2 spells out. A hole says nobody
  // ingested these blocks, which is false and (per §6.3) invites a provider refetch that
  // could add no detail. A silent splice draws the coarse line as if nothing changed.
  const range = downsample(1_000, 2_000, 'candles1h', 42);
  assert.equal(range.resolution, 'candles1h');
  assert.notEqual(range.resolution, 'raw');
  assert.match(range.reason, /not a gap/);
  // It is a distinct type, not a flag: a boolean defaults to the silent-splice reading in
  // every component that forgot to read it.
  assert.ok(!('origin' in range), 'a downsampled range is not a coverage range');
  // And the blocks stay covered — `holesIn` over the same span reports nothing missing.
  const coverage = [selfRange(1_000, 2_000, 1, EDGE)];
  assert.deepEqual(holesIn(coverage, { fromBlock: 1_000, toBlock: 2_000 }), []);
});

test('a malformed range or timestamp is refused rather than summarised', () => {
  assert.throws(() => downsample(2_000, 1_000, 'candles1h', 42), CandleError);
  assert.throws(() => downsample(1.5, 2_000, 'candles1h', 42), CandleError);
  assert.throws(() => priceSample({ bookId: 'b', blockNumber: 1, blockTimestampMs: 1.5, price1e9: 1n, origin: 'self' }), CandleError);
  assert.throws(() => priceSample({ bookId: 'b', blockNumber: -1, blockTimestampMs: 1_000, price1e9: 1n, origin: 'self' }), CandleError);
  assert.throws(() => foldCandles([{ ...sample(10, 100, 1), at: 1.5 }], 'candles1h'), CandleError);
  assert.throws(() => foldCandles([{ ...sample(10, 100, 1), blockNumber: -1 }], 'candles1h'), CandleError);
  assert.throws(() => bucketStart(-1, 'candles1h'), CandleError);
});

test('folding nothing produces nothing, without inventing an empty candle', () => {
  // An empty candle would render as a flat bar at zero — a price claim about a book that
  // was never observed.
  assert.deepEqual(foldCandles([], 'candles1h'), []);
  assert.deepEqual(rollUp([], 'candles1d'), []);
});


test('a sample’s instant comes from the block, and the mint says so in its own signature', () => {
  // `bucketStart` aligns buckets to the epoch so two clients agree on boundaries, and that is
  // only true when the instant is a fact about the chain. `blockTimestampMs` is the whole
  // control: it is not stronger than a comment by type, it is stronger by being unmissable at
  // every call site — and it takes milliseconds, which is the unit `pallet_timestamp` carries.
  const s = priceSample({
    bookId: 'book-1',
    blockNumber: 7,
    blockTimestampMs: 3_600_500,
    price1e9: 100n,
    origin: 'self',
  });
  assert.equal(s.at, 3_600, 'milliseconds were not converted to the Unix seconds `at` declares');
  assert.equal(bucketStart(s.at, 'candles1h'), 3_600);
  assert.throws(
    () => priceSample({ bookId: 'b', blockNumber: 1, blockTimestampMs: -1, price1e9: 1n, origin: 'self' }),
    CandleError,
  );
});

test('samples of different provenance NEVER fold into one candle (10 §2.3, INV-FE-15)', () => {
  // The blocker this closes. A candle carries one origin, so folding a light-client
  // observation together with an indexer's yields a bar whose label is wrong in one direction
  // or the other: `self` promotes the indexer's number to verified — which §2.2 gives no path
  // for — and a provider label demotes an observation this client made itself. That is exactly
  // the choice §6.3's no-splice rule refuses for ranges, arriving one layer down where the
  // boundary is a bar on a chart rather than a range in a list.
  const candles = foldCandles(
    [sample(10, 100, 1), fromIndexer(20, 900, 2), sample(30, 300, 3)],
    'candles1h',
  );
  assert.equal(candles.length, 2, 'two sources were summarised into one bar');
  const mine = candles.find((c) => c.origin === 'self');
  const theirs = candles.find((c) => c.origin === 'indexer');
  assert.ok(mine && theirs, 'a provenance disappeared from the fold');
  assert.equal(mine.samples, 2);
  assert.equal(mine.high1e9, 300n, 'the indexer’s 900 leaked into the verified bar');
  assert.equal(theirs.samples, 1);
  assert.equal(theirs.providerId, 'acme', 'INV-FE-15 requires the origin to reach the pixel');
});

test('two providers are two sources, and one candle each', () => {
  // Same origin is not the same provenance: two indexers are two parties, and one lying does
  // not implicate the other. Merging them makes that undiagnosable in the chart layer.
  const candles = foldCandles([fromIndexer(10, 100, 1, 'a'), fromIndexer(20, 900, 2, 'b')], 'candles1h');
  assert.equal(candles.length, 2);
  assert.deepEqual(candles.map((c) => c.providerId).sort(), ['a', 'b']);
});

test('roll-up never merges provenance either — the ladder degrades resolution, not origin', () => {
  const hours = foldCandles(
    [sample(10, 100, 1), sample(HOUR + 10, 200, 2), fromIndexer(2 * HOUR + 10, 900, 3)],
    'candles1h',
  );
  const days = rollUp(hours, 'candles1d');
  assert.equal(days.length, 2, 'a verified hour and a provider hour were rolled into one day');
  assert.deepEqual(days.map((c) => c.origin).sort(), ['indexer', 'self']);
  const verified = days.find((c) => c.origin === 'self');
  assert.ok(verified);
  assert.equal(verified.high1e9, 200n, 'the provider’s 900 leaked into the verified day');
});

test('the stored key carries the provenance, or two sources overwrite each other', () => {
  // `foldCandles` refuses to merge across provenance in memory. A table keyed `[bookId+openAt]`
  // then takes the two candles it produced and stores one on top of the other — the label
  // survives and the number under it becomes whichever row was written last. So the key is part
  // of the row.
  const candles = foldCandles([sample(10, 100, 1), fromIndexer(20, 900, 2)], 'candles1h');
  const keys = candles.map((c) => `${c.bookId}|${c.sourceKey}|${c.openAt}`);
  assert.equal(new Set(keys).size, 2, 'two sources collide on one primary key');
  assert.equal(sourceKeyOf({ origin: 'self' }), JSON.stringify(['self', null]));
  assert.equal(
    sourceKeyOf({ origin: 'indexer', providerId: 'acme' }),
    JSON.stringify(['indexer', 'acme']),
  );
});

test('a row whose key disagrees with its origin is refused', () => {
  // The rehydration case: a record out of IndexedDB carrying an indexer's key and a `self`
  // origin would be stored beside the source it claims not to be.
  const forged = { ...sample(10, 100, 1), sourceKey: sourceKeyOf({ origin: 'indexer', providerId: 'acme' }) };
  assert.throws(() => foldCandles([forged], 'candles1h'), CandleError);
});

/**
 * A row as an *untyped* caller supplies it — rehydrated from IndexedDB, or handed over by an
 * imported snapshot. Every use is a refusal test: the union cannot express these values, which
 * is the compile-time control working, and the single assertion is what lets the suite ask
 * whether the runtime half is there too. `as unknown as` is banned across `app/`, so this is
 * one assertion through one documented helper rather than a double one per call site.
 */
interface LooseSample {
  readonly bookId: string;
  readonly at: number;
  readonly price1e9: bigint;
  readonly blockNumber: number;
  readonly sourceKey: string;
  /** Widened from the union, which is what lets an unknown origin be constructed at all. */
  readonly origin: string;
  readonly providerId?: string | undefined;
}
const asSample = (record: LooseSample): PriceSample => record as PriceSample;

test('an unknown or unattributed origin is refused on a chart row too', () => {
  assert.throws(
    () => foldCandles([asSample({ ...sample(10, 100, 1), origin: 'indexer' })], 'candles1h'),
    CandleError,
  );
  assert.throws(
    () => foldCandles([asSample({ ...sample(10, 100, 1), origin: 'rpc' })], 'candles1h'),
    CandleError,
  );
});

test('10 §9.1 folds a block’s Traded fills into ONE bar per book, in chain order', () => {
  // §9.1's ruling has two halves and this is the one nothing implemented: *"Chain-wide `Traded`
  // **is consumed into the candle aggregates as it is scanned** and never stored row-by-row"*.
  // Only the second half was built (the retention filter), so §9.2's candle-depth tables
  // described a tier with no producer and the whole trade stream — 1,339,200 rows/day at the
  // chain-permitted ceiling — was scanned, filtered out and forgotten.
  const bars = tradeCandles({
    blockNumber: 500,
    blockTimestampMs: 7_200_000,
    resolution: SCAN_AGGREGATE_RESOLUTION,
    origin: 'self',
    fills: [
      // Deliberately not in price order, and deliberately not sorted by event index either: the
      // fold must take open and close from **chain order**, which is the event index inside one
      // block. An inverted bar is not obviously wrong on a chart — it is a plausible bar
      // pointing the other way.
      { bookId: '7', price1e9: 500_000_000n, eventIndex: 2 },
      { bookId: '7', price1e9: 900_000_000n, eventIndex: 0 },
      { bookId: '7', price1e9: 100_000_000n, eventIndex: 1 },
      { bookId: '9', price1e9: 300_000_000n, eventIndex: 3 },
    ],
  });
  assert.equal(bars.length, 2, 'two books shared one bar, which describes no market that exists');
  const seven = bars.find((bar) => bar.bookId === '7');
  assert.ok(seven);
  assert.equal(seven.open1e9, 900_000_000n, 'the bar opened on a fill that was not the block’s first');
  assert.equal(seven.close1e9, 500_000_000n, 'the bar closed on a fill that was not the block’s last');
  assert.equal(seven.high1e9, 900_000_000n);
  assert.equal(seven.low1e9, 100_000_000n);
  assert.equal(seven.samples, 3);
  assert.equal(seven.fromBlock, 500);
  assert.equal(seven.toBlock, 500);
  // The bucket is the block's own hour, epoch-aligned — two clients must agree on the boundary.
  assert.equal(seven.openAt, 7_200);
  assert.equal(seven.resolution, 'candles1h');
  assert.equal(seven.origin, 'self');
  assert.equal(seven.sourceKey, sourceKeyOf({ origin: 'self' }));
});

test('the aggregate is written at the ladder’s FINEST rung, never coarser', () => {
  // §9.1 names no table and §9.2's ladder is `raw → candles1h → candles4h → candles1d`, so the
  // aggregate can only occupy the finest candle rung: writing it coarser would destroy resolution
  // the client held at the moment it held it, which is the one thing the ladder's order exists to
  // avoid. Pinned as a value because the remaining freedom is SQ-762 and a ruling will move it.
  assert.equal(SCAN_AGGREGATE_RESOLUTION, 'candles1h');
  assert.equal(nth(DEGRADATION_LADDER, 1, 'rung'), SCAN_AGGREGATE_RESOLUTION);
});

test('a fill carrying no event index is refused — order is what decides open and close', () => {
  assert.throws(
    () =>
      tradeCandles({
        blockNumber: 1,
        blockTimestampMs: 6_000,
        resolution: 'candles1h',
        origin: 'self',
        fills: [{ bookId: '7', price1e9: 1n, eventIndex: -1 }],
      }),
    CandleError,
  );
  // A device clock cannot reach the bucket key: the argument is named for what it must be.
  assert.throws(
    () =>
      tradeCandles({
        blockNumber: 1,
        blockTimestampMs: -1,
        resolution: 'candles1h',
        origin: 'self',
        fills: [],
      }),
    CandleError,
  );
});

test('mergeCandle ROLLS INTO the stored bar rather than replacing it (§9.2 obligation 2)', () => {
  // §9.2: *"Degradation is applied in whole, closed buckets. Folding part of a bucket now and the
  // rest later writes two coarse rows under one bucket key, the second replacing the first, so
  // the chart shows a bar describing part of an hour labelled as the hour."* Folding whole
  // buckets makes that true within one pass; a backfill chunk landing older samples for an
  // already-folded hour arrives in a later pass, and a bare `put` writes over the earlier bar.
  // Four observations in one hour, delivered as two folds: blocks 200..210 first (the forward
  // run) and blocks 100..110 afterwards (§6.4's newest-first backfill catching up).
  const later = nth(foldCandles([sample(100, 500, 200), sample(200, 700, 210)], 'candles1h'), 0, 'candle');
  const earlier = nth(foldCandles([sample(10, 300, 100), sample(20, 900, 110)], 'candles1h'), 0, 'candle');
  const merged = mergeCandle(later, earlier);

  // Open comes from the bar spanning the lower blocks and close from the higher, whichever was
  // written first — the stored bar has no other record of order, because the raw rows are gone.
  assert.equal(merged.open1e9, 300n, 'the merged bar opens on the later chunk');
  assert.equal(merged.close1e9, 700n, 'the merged bar closes on the earlier chunk');
  assert.equal(merged.high1e9, 900n);
  assert.equal(merged.low1e9, 300n);
  assert.equal(merged.samples, 4, 'the merged bar lost samples, so it understates the hour');
  assert.equal(merged.fromBlock, 100);
  assert.equal(merged.toBlock, 210);
  assert.equal(merged.openAt, later.openAt);

  // A merge is a read-modify-write of ONE stored row, so the two must share its primary key.
  const otherBook = nth(foldCandles([sample(10, 1, 5, 'book-2')], 'candles1h'), 0, 'candle');
  assert.throws(() => mergeCandle(later, otherBook), CandleError);
  const coarser = nth(rollUp([later], 'candles4h'), 0, 'candle');
  assert.throws(() => mergeCandle(later, coarser), CandleError);
});

test('candleCoversBlock is what keeps a replayed block from being counted twice', () => {
  // A candle is an accumulator, so it has no deterministic primary key to lean on the way an
  // event row does: re-folding block N would add its fills a second time. §6.5 requires ingest
  // writes to be idempotent under replay, and the stored bar's own span is the only record of
  // which blocks it already summarises.
  const bar = nth(
    tradeCandles({
      blockNumber: 500,
      blockTimestampMs: 7_200_000,
      resolution: 'candles1h',
      origin: 'self',
      fills: [{ bookId: '7', price1e9: 1n, eventIndex: 0 }],
    }),
    0,
    'bar',
  );
  assert.equal(candleCoversBlock(bar, 500), true);
  assert.equal(candleCoversBlock(bar, 499), false);
  assert.equal(candleCoversBlock(bar, 501), false);
});
