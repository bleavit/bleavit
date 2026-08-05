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
 * than by fiat: at max load a daily row costs `books × 120 B/day` ≈ 23.5 KB/day, so depth
 * there is effectively unbounded and there is nothing further to degrade *to*. A caller
 * asking what comes after it gets `undefined` rather than an exception, because "there is
 * nothing left to give up" is an answer the quota manager needs, not an error.
 */

export type Resolution = 'raw' | 'candles1h' | 'candles4h' | 'candles1d';

/** §9.2's ladder, oldest-first and in this order. The array *is* the guarantee. */
export const DEGRADATION_LADDER: readonly Resolution[] = Object.freeze([
  'raw',
  'candles1h',
  'candles4h',
  'candles1d',
]);

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
export function nextResolution(current: Resolution): Resolution | undefined {
  const index = DEGRADATION_LADDER.indexOf(current);
  if (index === -1) throw new CandleError(`${current} is not a rung of the retention ladder`);
  return DEGRADATION_LADDER[index + 1];
}

export function bucketSeconds(resolution: Exclude<Resolution, 'raw'>): number {
  const seconds = BUCKET_SECONDS[resolution];
  if (seconds === undefined) throw new CandleError(`${resolution} has no bucket width`);
  return seconds;
}

/** A price observation as the ingest loop records it. */
export interface PriceSample {
  readonly bookId: string;
  /** Unix seconds. */
  readonly at: number;
  /** 1e9-grid price, as 02 §9 publishes every price. */
  readonly price1e9: bigint;
  readonly blockNumber: number;
}

export interface Candle {
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
}

/** Bucket start for an instant, aligned to the epoch so two clients agree on boundaries. */
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
 */
export function foldCandles(
  samples: readonly PriceSample[],
  resolution: Exclude<Resolution, 'raw'>,
): readonly Candle[] {
  // Grouped by book **then** by bucket, rather than by a joined string key. A composite
  // string key needs a separator that cannot occur in a book id, and every choice of
  // separator is a guess about an identifier this module does not own — get it wrong and two
  // books silently share a candle, which is the one thing `foldCandles` must never do.
  const byBook = new Map<string, Map<number, PriceSample[]>>();
  for (const sample of samples) {
    if (!Number.isInteger(sample.at) || sample.at < 0) {
      throw new CandleError(`sample for ${sample.bookId} carries a non-integer timestamp`);
    }
    if (!Number.isInteger(sample.blockNumber) || sample.blockNumber < 0) {
      throw new CandleError(`sample for ${sample.bookId} carries a non-integer block number`);
    }
    const buckets = byBook.get(sample.bookId) ?? new Map<number, PriceSample[]>();
    byBook.set(sample.bookId, buckets);
    const openAt = bucketStart(sample.at, resolution);
    const bucket = buckets.get(openAt);
    if (bucket) bucket.push(sample);
    else buckets.set(openAt, [sample]);
  }

  const out: Candle[] = [];
  for (const [bookId, buckets] of byBook) {
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
      });
    }
  }
  return out.sort((a, b) => (a.bookId === b.bookId ? a.openAt - b.openAt : a.bookId < b.bookId ? -1 : 1));
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
  const byBook = new Map<string, Map<number, Candle[]>>();
  for (const candle of candles) {
    const buckets = byBook.get(candle.bookId) ?? new Map<number, Candle[]>();
    byBook.set(candle.bookId, buckets);
    const openAt = candle.openAt - (candle.openAt % width);
    const bucket = buckets.get(openAt);
    if (bucket) bucket.push(candle);
    else buckets.set(openAt, [candle]);
  }
  const out: Candle[] = [];
  for (const [bookId, buckets] of byBook) {
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
      });
    }
  }
  return out.sort((a, b) => (a.bookId === b.bookId ? a.openAt - b.openAt : a.bookId < b.bookId ? -1 : 1));
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
}

export function downsample(
  fromBlock: number,
  toBlock: number,
  to: Exclude<Resolution, 'raw'>,
): DownsampledRange {
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock > toBlock) {
    throw new CandleError(`${fromBlock}..${toBlock} is not a block range`);
  }
  return {
    fromBlock,
    toBlock,
    resolution: to,
    reason:
      `raw samples for these blocks were evicted to stay inside the storage budget; the ` +
      `range is still covered at ${to} resolution. This is not a gap — nothing is missing, ` +
      'and refetching would not add detail this client ever had.',
  };
}
