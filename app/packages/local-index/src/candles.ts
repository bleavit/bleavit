/**
 * Candles and the retention ladder — 10 §9.2, §6.3, F8.
 *
 * §9.2's title is the specification: *"Retention auto-tunes to budget (degrades depth,
 * never correctness)"*. Everything here is written to the second half of that sentence,
 * because the first half is easy and the second is where a storage manager quietly lies.
 *
 * ## An evicted range is downsampled, never a hole, and never a silent splice
 *
 * §9.2 states it outright: *"holes stay truthful even after eviction — an evicted range
 * becomes a labelled 'downsampled' range, not a hole, and never a silent splice"*. Those are
 * three distinct things and conflating any two of them misinforms the user in a different
 * direction:
 *
 * - **A hole** means *nobody ingested these blocks*. Rendering an evicted range as a hole
 *   tells the user data is missing that was in fact collected, seen and summarised — and
 *   §6.3 makes holes provider-fillable, so it would invite re-fetching what is already
 *   known at lower resolution.
 * - **A silent splice** means the range is drawn as if nothing changed. That is the one
 *   §6.3 forbids by name: the chart would show an hourly candle beside a raw sample with no
 *   visible difference in what is being claimed.
 * - **Downsampled** is the truth: the blocks are covered, at a stated resolution, and the
 *   resolution is part of the datum rather than a property of the viewport.
 *
 * ## The ladder is ordered and total
 *
 * §9.2 fixes the order — raw → `candles1h` → `candles4h` → `candles1d` — and the reason it
 * is worth encoding as data rather than as four `if`s is that the ordering *is* the
 * degradation guarantee. A ladder applied out of order frees the same bytes and destroys
 * more resolution than it had to.
 *
 * `candles1d` is the floor and has no next rung, which §9.2 justifies arithmetically rather
 * than by fiat: a daily row costs `books × 120 B/day` ≈ 19.1 KB/day even at the 159-book
 * maximum (SQ-557's corrected count), so depth
 * there is effectively unbounded and there is nothing further to degrade *to*. A caller
 * asking what comes after it gets `undefined` rather than an exception, because "there is
 * nothing left to give up" is an answer the quota manager needs, not an error.
 */

import type { RangeOrigin } from './coverage.js';

export type Resolution = 'raw' | 'candles1h' | 'candles4h' | 'candles1d';

/** §9.2's ladder, oldest-first and in this order. The array *is* the guarantee. */
export const DEGRADATION_LADDER: readonly Resolution[] = Object.freeze([
  'raw',
  'candles1h',
  'candles4h',
  'candles1d',
]);

/**
 * The rungs the ladder can degrade **to** — everything but `raw`.
 *
 * A second array rather than a filter, so `nextResolution` can return the narrow type without a
 * cast and without an unreachable guard. The first version wrote that guard as
 * `if (next === 'raw') throw`, which cannot fire: `raw` is at index 0, so it is never the
 * successor of anything. A check that cannot fail is the defect class this client keeps
 * finding, and replacing it with a *second* copy of the ladder would only move the problem — so
 * the two arrays are bound by `laddersAgree`, which the suite asserts and which **can** fail.
 */
const COARSE_RUNGS: readonly Exclude<Resolution, 'raw'>[] = Object.freeze([
  'candles1h',
  'candles4h',
  'candles1d',
]);

/**
 * Whether the published ladder really is `raw` followed by the coarse rungs, in order.
 *
 * Exported and asserted rather than thrown at import: §9.2 makes the order the degradation
 * guarantee, so a ladder edited on one side only would silently free the same bytes while
 * destroying more resolution than it had to.
 */
export function laddersAgree(): boolean {
  return (
    DEGRADATION_LADDER.length === COARSE_RUNGS.length + 1 &&
    DEGRADATION_LADDER[0] === 'raw' &&
    COARSE_RUNGS.every((rung, index) => DEGRADATION_LADDER[index + 1] === rung)
  );
}

/** Seconds per bucket. `raw` has none — a raw sample is an observation, not a bucket. */
const HOUR_SECONDS = 3_600;
/**
 * The coarser widths are **derived from the hour**, not written out.
 *
 * Partly because four hours is literally four hours and stating it twice invites the two to
 * disagree — and partly because the 10 §5.4 gate objected to the literal `14_400`, which is
 * also `Epoch::DecisionWindowFloor`. That collision is a unit coincidence (seconds here,
 * blocks there) and could have been waived; deriving is better than waiving, because the
 * waiver would sit in the classification file forever explaining a number that did not need
 * to be there.
 */
const BUCKET_SECONDS: Readonly<Record<Exclude<Resolution, 'raw'>, number>> = Object.freeze({
  candles1h: HOUR_SECONDS,
  candles4h: 4 * HOUR_SECONDS,
  candles1d: 24 * HOUR_SECONDS,
});

export class CandleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandleError';
  }
}

/**
 * The next rung down, or `undefined` at the floor.
 *
 * Not an exception at the floor: "there is nothing left to give up" is the answer the quota
 * manager needs in order to stop, and a throw would make the terminal case of a normal loop
 * look like a failure.
 */
export function nextResolution(current: Resolution): Exclude<Resolution, 'raw'> | undefined {
  // Derived from `COARSE_RUNGS`, so the narrow return type is a property of the array rather
  // than an assertion about the caller — and `raw` cannot be a successor because it is not in
  // that array at all. `laddersAgree` is what keeps the two arrays one ladder.
  if (current === 'raw') return COARSE_RUNGS[0];
  const index = COARSE_RUNGS.indexOf(current);
  if (index === -1) throw new CandleError(`${current} is not a rung of the retention ladder`);
  return COARSE_RUNGS[index + 1];
}

export function bucketSeconds(resolution: Exclude<Resolution, 'raw'>): number {
  const seconds = BUCKET_SECONDS[resolution];
  if (seconds === undefined) throw new CandleError(`${resolution} has no bucket width`);
  return seconds;
}

/**
 * Where a chart row came from, carried on the row itself — 10 §2.3, INV-FE-15.
 *
 * These are the tables §2.3 names as the accepted-residual surface: *"price charts, history
 * tables, provider-filled series"*, declared not transaction-critical and mitigated **only**
 * by *"mandatory, non-suppressible provenance labelling"*. A row with no origin cannot be
 * labelled, so on this surface the origin is not metadata about the row — it is the entire
 * mitigation. INV-FE-15 states the obligation at its sharpest: *"every provider-derived row
 * carries its origin to the pixel"*.
 *
 * It is the same shape as `HeaderSource` and `CoverageRange`'s provenance, deliberately: one
 * value, one spelling, and no place where a `providerId` can be dropped in transit.
 */
export type SampleProvenance =
  | { readonly origin: 'self'; readonly providerId?: undefined }
  | { readonly origin: Exclude<RangeOrigin, 'self'>; readonly providerId: string };

/** True when two rows may share a bucket. Different sources never summarise into one bar. */
export function sameSampleProvenance(a: SampleProvenance, b: SampleProvenance): boolean {
  return a.origin === b.origin && a.providerId === b.providerId;
}

/**
 * The provenance rendered as one indexable string — the part of every chart row's **primary
 * key** that keeps two sources apart in storage.
 *
 * This exists because the in-memory rule and the stored rule were about to disagree. Once a
 * candle carries an origin, `foldCandles` correctly refuses to merge a light-client
 * observation with an indexer's — and a table keyed `[bookId+openAt]` then takes the two
 * candles it produced and **overwrites one with the other**, silently, at the storage layer.
 * The label survives; the datum under it is whichever row was written last. So provenance is
 * part of the key, not a column beside it.
 *
 * `undefined` is not an IndexedDB key, so a two-part `[origin, providerId]` key could not
 * hold a `self` row at all — hence one derived string with `null` standing in, built through
 * `JSON.stringify` rather than a separator. `packages/providers` learned that the expensive
 * way: any separator can occur inside an identifier, and two sources colliding on one key
 * become one row in the table whose whole job is keeping them apart.
 */
export function sourceKeyOf(row: SampleProvenance): string {
  return JSON.stringify([row.origin, row.providerId ?? null]);
}

/** What every stored chart row carries so its primary key can separate two sources. */
export interface SourceKeyed {
  /** `sourceKeyOf(row)`. Derived, never chosen — `assertProvenance` refuses a disagreement. */
  readonly sourceKey: string;
}

/** A price observation as the ingest loop records it. */
export type PriceSample = {
  readonly bookId: string;
  /**
   * Unix seconds — **the block's own timestamp**, never the device clock.
   *
   * `bucketStart` aligns buckets to the epoch so two clients agree on boundaries, and that is
   * only true if `at` is a fact about the chain. Taken from `Date.now()` at observation time
   * it is a fact about the observer, two clients bucket the same trade differently, and the
   * candle a user compares against a friend's is a different candle with the same name.
   *
   * Mint through `priceSample`, which derives this from the block's timestamp and cannot be
   * handed a clock reading without the caller writing the word `blockTimestampMs`.
   */
  readonly at: number;
  /** 1e9-grid price, as 02 §9 publishes every price. */
  readonly price1e9: bigint;
  /** The block the observation was read at. Part of the row's primary key (§7). */
  readonly blockNumber: number;
} & SourceKeyed &
  SampleProvenance;

export type Candle = {
  readonly bookId: string;
  readonly resolution: Exclude<Resolution, 'raw'>;
  /** Bucket start, Unix seconds, aligned to the bucket width. */
  readonly openAt: number;
  readonly open1e9: bigint;
  readonly high1e9: bigint;
  readonly low1e9: bigint;
  readonly close1e9: bigint;
  readonly samples: number;
  /** Widest block span the bucket summarises, so coverage stays checkable after eviction. */
  readonly fromBlock: number;
  readonly toBlock: number;
} & SourceKeyed &
  SampleProvenance;

/**
 * Mint a price observation — the only constructor, because two of its fields are derived and
 * both are wrong in a way nothing downstream can see.
 *
 * `at` is derived from **the block's own timestamp**, supplied in milliseconds because that is
 * the unit `pallet_timestamp`'s `Moment` carries. The parameter is named for what it must be:
 * a caller reaching for `Date.now()` has to write `blockTimestampMs: Date.now()`, which is
 * visible in review, where `at: Date.now() / 1000` was not. The consequence of getting it
 * wrong is not an error — it is two clients bucketing one trade into different hours and each
 * showing the other a candle with the same name and a different body.
 *
 * `sourceKey` is derived from the provenance, so a row cannot be stored under a key that
 * disagrees with the origin it renders under.
 */
export function priceSample(
  input: {
    readonly bookId: string;
    readonly blockNumber: number;
    readonly blockTimestampMs: number;
    readonly price1e9: bigint;
  } & SampleProvenance,
): PriceSample {
  const { bookId, blockNumber, blockTimestampMs, price1e9 } = input;
  if (!Number.isInteger(blockNumber) || blockNumber < 0) {
    throw new CandleError(`${blockNumber} is not a block height`);
  }
  if (!Number.isInteger(blockTimestampMs) || blockTimestampMs < 0) {
    throw new CandleError(
      `${blockTimestampMs} is not a block timestamp in milliseconds. 10 §9.2's buckets are ` +
        'aligned to the epoch so two clients agree on boundaries, which is only true when the ' +
        'instant is a fact about the chain rather than about this device.',
    );
  }
  assertProvenance(input, `sample for ${bookId}`);
  const provenance = provenanceOf(input);
  return {
    bookId,
    at: Math.floor(blockTimestampMs / 1000),
    price1e9,
    blockNumber,
    sourceKey: sourceKeyOf(input),
    ...provenance,
  } as PriceSample;
}

/**
 * Bucket start for an instant, aligned to the epoch so two clients agree on boundaries.
 *
 * The agreement is a property of the **argument**, not of this function: it holds because
 * `PriceSample.at` is the block's timestamp. Hand it a device clock and the alignment is
 * exact and meaningless.
 */
export function bucketStart(at: number, resolution: Exclude<Resolution, 'raw'>): number {
  if (!Number.isInteger(at) || at < 0) throw new CandleError(`${at} is not a Unix second`);
  const width = bucketSeconds(resolution);
  return at - (at % width);
}

/**
 * Fold samples into candles.
 *
 * **Open and close are decided by time, not by array order.** A caller handing samples in
 * the order IndexedDB returned them — or an ingest loop backfilling newest-first, which
 * §6.4 requires — would otherwise invert every candle it produced, and an inverted candle is
 * not obviously wrong on a chart: it is a plausible bar pointing the other way.
 *
 * Samples from different books never share a bucket, for the same reason 11 §11.2a forbids a
 * cross-domain total: a candle is a claim about one book's price, and merging two books
 * produces a number describing no market that exists.
 *
 * **Samples of different provenance never share a bucket either, and for a stronger reason.**
 * A candle must carry one origin, so folding a light-client-verified observation together with
 * one an opt-in indexer supplied yields a bar whose label is wrong in one direction or the
 * other — `self` promotes the indexer's number to verified, which §2.2 gives no path for, and
 * a provider label demotes an observation the client made itself. That is exactly the choice
 * §6.3's no-splice rule refuses for ranges, arriving one layer down where the boundary is a
 * bar on a chart rather than a range in a list.
 */
export function foldCandles(
  samples: readonly PriceSample[],
  resolution: Exclude<Resolution, 'raw'>,
): readonly Candle[] {
  // Grouped by book, then by provenance, then by bucket — three nested maps rather than a
  // joined string key. A composite string key needs a separator that cannot occur in a book id
  // or a provider id, and every choice of separator is a guess about identifiers this module
  // does not own: get it wrong and two books, or two providers, silently share a candle, which
  // is the one thing `foldCandles` must never do.
  const byBook = new Map<string, Map<string, Map<number, PriceSample[]>>>();
  for (const sample of samples) {
    if (!Number.isInteger(sample.at) || sample.at < 0) {
      throw new CandleError(`sample for ${sample.bookId} carries a non-integer timestamp`);
    }
    if (!Number.isInteger(sample.blockNumber) || sample.blockNumber < 0) {
      throw new CandleError(`sample for ${sample.bookId} carries a non-integer block number`);
    }
    assertProvenance(sample, `sample for ${sample.bookId}`);
    const bySource = byBook.get(sample.bookId) ?? new Map<string, Map<number, PriceSample[]>>();
    byBook.set(sample.bookId, bySource);
    const key = provenanceKey(sample);
    const buckets = bySource.get(key) ?? new Map<number, PriceSample[]>();
    bySource.set(key, buckets);
    const openAt = bucketStart(sample.at, resolution);
    const bucket = buckets.get(openAt);
    if (bucket) bucket.push(sample);
    else buckets.set(openAt, [sample]);
  }

  const out: Candle[] = [];
  for (const [bookId, bySource] of byBook) {
    for (const [, buckets] of bySource) {
      for (const [openAt, bucket] of buckets) {
        const ordered = [...bucket].sort((a, b) => (a.at === b.at ? a.blockNumber - b.blockNumber : a.at - b.at));
        const first = ordered[0];
        const last = ordered[ordered.length - 1];
        if (first === undefined || last === undefined) continue;
        let high = first.price1e9;
        let low = first.price1e9;
        let fromBlock = first.blockNumber;
        let toBlock = first.blockNumber;
        for (const sample of ordered) {
          if (sample.price1e9 > high) high = sample.price1e9;
          if (sample.price1e9 < low) low = sample.price1e9;
          if (sample.blockNumber < fromBlock) fromBlock = sample.blockNumber;
          if (sample.blockNumber > toBlock) toBlock = sample.blockNumber;
        }
        out.push({
          bookId,
          resolution,
          openAt,
          open1e9: first.price1e9,
          high1e9: high,
          low1e9: low,
          close1e9: last.price1e9,
          samples: ordered.length,
          fromBlock,
          toBlock,
          sourceKey: sourceKeyOf(first),
          ...provenanceOf(first),
        } as Candle);
      }
    }
  }
  return out.sort(byBookThenBucket);
}

/** The grouping key for one source — the same string the stored row is keyed on. */
const provenanceKey = sourceKeyOf;

function provenanceOf(row: SampleProvenance): SampleProvenance {
  return row.origin === 'self'
    ? { origin: 'self' }
    : { origin: row.origin, providerId: row.providerId };
}

/**
 * The provenance check, run at the same boundary as every other field check.
 *
 * The union already makes both cases unconstructible in TypeScript. The runtime check stays
 * because the callers that matter are untyped — a row rehydrated from IndexedDB, or one an
 * imported snapshot supplied — and a `provider` row that lost its `providerId` in transit
 * renders as *unverified — undefined*, which reads to a user as a bug rather than as a source.
 */
function assertProvenance(row: SampleProvenance, what: string): void {
  const loose = row as { origin?: unknown; providerId?: unknown; sourceKey?: unknown };
  if (loose.origin !== 'self' && loose.origin !== 'operator' && loose.origin !== 'snapshot' && loose.origin !== 'indexer') {
    throw new CandleError(`${what} carries an unknown origin ${String(loose.origin)}`);
  }
  if (loose.origin !== 'self' && (typeof loose.providerId !== 'string' || loose.providerId === '')) {
    throw new CandleError(`${what} is ${String(loose.origin)}-sourced and must name its providerId`);
  }
  if (loose.origin === 'self' && loose.providerId !== undefined) {
    throw new CandleError(`${what} is self-ingested and has no provider`);
  }
  // `sourceKey` is the stored row's primary key part. A row whose key disagrees with the origin
  // it renders under is stored beside the source it claims to be — the collision this key
  // exists to prevent, arriving from a rehydrated or imported record rather than from a fold.
  // Checked only when present, because the in-memory `SampleProvenance` shape has no key.
  if (loose.sourceKey !== undefined && loose.sourceKey !== sourceKeyOf(row)) {
    throw new CandleError(
      `${what} is keyed ${String(loose.sourceKey)} but its provenance derives ` +
        `${sourceKeyOf(row)}; the key is what keeps two sources in separate rows`,
    );
  }
}

function byBookThenBucket(a: Candle, b: Candle): number {
  if (a.bookId !== b.bookId) return a.bookId < b.bookId ? -1 : 1;
  if (a.openAt !== b.openAt) return a.openAt - b.openAt;
  return provenanceKey(a) < provenanceKey(b) ? -1 : provenanceKey(a) > provenanceKey(b) ? 1 : 0;
}

/**
 * Roll finished candles up a rung — `candles1h` → `candles4h` → `candles1d`.
 *
 * Rolling up rather than re-folding raw samples is not an optimisation: the raw samples are
 * gone by the time this runs, which is the whole point of the ladder. Open/high/low/close
 * compose exactly under this operation, so the coarser candle is the one that would have
 * been produced from the samples that no longer exist.
 */
export function rollUp(
  candles: readonly Candle[],
  target: Exclude<Resolution, 'raw'>,
): readonly Candle[] {
  const width = bucketSeconds(target);
  for (const candle of candles) {
    if (bucketSeconds(candle.resolution) >= width) {
      // Refused rather than passed through: rolling a coarser candle into a finer bucket
      // would fabricate resolution the data never had.
      throw new CandleError(
        `cannot roll ${candle.resolution} up to ${target}: the target bucket is not coarser`,
      );
    }
  }
  // Grouped by provenance for the same reason `foldCandles` is: a coarser candle carries one
  // origin, so rolling a verified hour and a provider-supplied hour into one day would relabel
  // half of it. The ladder degrades **resolution**, and it may not degrade provenance on the
  // way — an evicted range becomes a labelled downsampled range, never a differently-sourced one.
  const byBook = new Map<string, Map<string, Map<number, Candle[]>>>();
  for (const candle of candles) {
    assertProvenance(candle, `candle for ${candle.bookId}`);
    const bySource = byBook.get(candle.bookId) ?? new Map<string, Map<number, Candle[]>>();
    byBook.set(candle.bookId, bySource);
    const key = provenanceKey(candle);
    const buckets = bySource.get(key) ?? new Map<number, Candle[]>();
    bySource.set(key, buckets);
    const openAt = candle.openAt - (candle.openAt % width);
    const bucket = buckets.get(openAt);
    if (bucket) bucket.push(candle);
    else buckets.set(openAt, [candle]);
  }
  const out: Candle[] = [];
  for (const [bookId, bySource] of byBook) {
    for (const [, buckets] of bySource) {
      for (const [openAt, bucket] of buckets) {
        const ordered = [...bucket].sort((a, b) => a.openAt - b.openAt);
        const first = ordered[0];
        const last = ordered[ordered.length - 1];
        if (first === undefined || last === undefined) continue;
        out.push({
          bookId,
          resolution: target,
          openAt,
          open1e9: first.open1e9,
          high1e9: ordered.reduce((max, c) => (c.high1e9 > max ? c.high1e9 : max), first.high1e9),
          low1e9: ordered.reduce((min, c) => (c.low1e9 < min ? c.low1e9 : min), first.low1e9),
          close1e9: last.close1e9,
          samples: ordered.reduce((sum, c) => sum + c.samples, 0),
          fromBlock: ordered.reduce((min, c) => Math.min(min, c.fromBlock), first.fromBlock),
          toBlock: ordered.reduce((max, c) => Math.max(max, c.toBlock), first.toBlock),
          sourceKey: sourceKeyOf(first),
          ...provenanceOf(first),
        } as Candle);
      }
    }
  }
  return out.sort(byBookThenBucket);
}

/**
 * What a range's coverage becomes when its raw samples are evicted.
 *
 * §9.2: *"an evicted range becomes a labelled 'downsampled' range, not a hole, and never a
 * silent splice"*. This function is that sentence, and it is a **separate, named type**
 * rather than a flag on a coverage range so that a renderer must handle it: a boolean would
 * default to the silent-splice reading in every component that forgot to read it.
 */
export interface DownsampledRange {
  readonly fromBlock: number;
  readonly toBlock: number;
  /** What is still stored for these blocks. Never `'raw'` — that is what was evicted. */
  readonly resolution: Exclude<Resolution, 'raw'>;
  /** Why the user is seeing a coarser line here. Rendered, not logged. */
  readonly reason: string;
  /** When the eviction happened, so the label can be ordered and explained. */
  readonly at: number;
}

export function downsample(
  fromBlock: number,
  toBlock: number,
  to: Exclude<Resolution, 'raw'>,
  at: number,
): DownsampledRange {
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock > toBlock) {
    throw new CandleError(`${fromBlock}..${toBlock} is not a block range`);
  }
  if (!Number.isFinite(at) || at < 0) throw new CandleError(`${at} is not an eviction time`);
  return {
    fromBlock,
    toBlock,
    resolution: to,
    at,
    reason:
      `raw samples for these blocks were evicted to stay inside the storage budget; the ` +
      `range is still covered at ${to} resolution. This is not a gap — nothing is missing, ` +
      'and refetching would not add detail this client ever had.',
  };
}

/**
 * Merge a new downsampled range into the persisted set, coarsest label winning.
 *
 * Two properties this needs and a plain `push` does not. **Adjacent ranges at one resolution
 * join**, or the persisted list grows once per eviction pass forever and the renderer draws a
 * boundary at every pass rather than at every change of resolution. And **a range degraded
 * twice keeps the coarser label**: blocks that went raw → hourly → daily are stored at daily,
 * and a list still claiming hourly for them would promise detail that is gone.
 */
export function mergeDownsampled(
  existing: readonly DownsampledRange[],
  incoming: DownsampledRange,
): readonly DownsampledRange[] {
  const rank = (r: Exclude<Resolution, 'raw'>): number => DEGRADATION_LADDER.indexOf(r);

  // **Clipped, never dropped whole.** The first version tested *adjacency* and then discarded
  // the whole finer range, which deleted the label from blocks the incoming range never
  // covered: `[100..199 @1h]` beside `[200..299 @1d]` left blocks 100–199 with no label at all,
  // and a partial overlap lost both ends. Those blocks' raw samples were already evicted, so
  // what remained was exactly the silent splice §9.2 forbids — produced by the function whose
  // job is to prevent it. Symmetrically, a coarser stored range no longer leaves the incoming
  // finer label lying across it: two labels claiming two resolutions for one span promise
  // detail that was evicted earlier.
  const kept: DownsampledRange[] = [];
  for (const range of existing) {
    if (rank(range.resolution) > rank(incoming.resolution)) {
      // Strictly coarser: it keeps every block it covers, and the incoming label loses them.
      kept.push(range);
    } else {
      // Equal or finer: the incoming label wins the blocks they share, and the rest survives.
      kept.push(...subtractRange(range, incoming));
    }
  }
  let pieces: DownsampledRange[] = [incoming];
  for (const range of existing) {
    if (rank(range.resolution) > rank(incoming.resolution)) {
      pieces = pieces.flatMap((piece) => subtractRange(piece, range));
    }
  }
  kept.push(...pieces);

  // Same-resolution neighbours join, or the list grows once per eviction pass forever and the
  // renderer draws a boundary at every pass rather than at every change of resolution.
  const ordered = kept
    .filter((range) => range.fromBlock <= range.toBlock)
    .sort((a, b) => rank(a.resolution) - rank(b.resolution) || a.fromBlock - b.fromBlock || a.toBlock - b.toBlock);
  const out: DownsampledRange[] = [];
  for (const range of ordered) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      previous.resolution === range.resolution &&
      range.fromBlock <= previous.toBlock + 1
    ) {
      out[out.length - 1] = downsample(
        previous.fromBlock,
        Math.max(previous.toBlock, range.toBlock),
        range.resolution,
        Math.max(previous.at, range.at),
      );
      continue;
    }
    out.push(range);
  }
  return out.sort((a, b) => a.fromBlock - b.fromBlock || a.toBlock - b.toBlock);
}

/**
 * The parts of `range` that `cover` does not claim — 0, 1 or 2 pieces.
 *
 * Adjacency is deliberately **not** overlap here. Two ranges that merely touch share no block,
 * so neither may take a label from the other; adjacency matters only when joining two ranges of
 * the same resolution, which is a different question and is asked separately.
 */
function subtractRange(range: DownsampledRange, cover: DownsampledRange): DownsampledRange[] {
  if (cover.toBlock < range.fromBlock || cover.fromBlock > range.toBlock) return [range];
  const pieces: DownsampledRange[] = [];
  if (cover.fromBlock > range.fromBlock) {
    pieces.push(downsample(range.fromBlock, cover.fromBlock - 1, range.resolution, range.at));
  }
  if (cover.toBlock < range.toBlock) {
    pieces.push(downsample(cover.toBlock + 1, range.toBlock, range.resolution, range.at));
  }
  return pieces;
}
