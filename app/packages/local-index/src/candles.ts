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
  return foldPoints(
    samples.map((sample) => {
      if (!Number.isInteger(sample.at) || sample.at < 0) {
        throw new CandleError(`sample for ${sample.bookId} carries a non-integer timestamp`);
      }
      if (!Number.isInteger(sample.blockNumber) || sample.blockNumber < 0) {
        throw new CandleError(`sample for ${sample.bookId} carries a non-integer block number`);
      }
      assertProvenance(sample, `sample for ${sample.bookId}`);
      // A stored sample carries no position inside its block: `priceSamples` is keyed
      // `[bookId+sourceKey+blockNumber]`, so one book has at most one raw row per block and
      // there is nothing to order within one. `0` is therefore the true value, not a filler.
      return { ...sample, order: 0 };
    }),
    resolution,
  );
}

/**
 * One point on a book's price series, with everything an OHLC fold needs to order it.
 *
 * `order` exists because two prices can share a block. A raw `priceSamples` row cannot (the
 * primary key forbids it), but a block's `Traded` fills can and routinely do — and open/close
 * are the two fields an ordering mistake corrupts *plausibly*: an inverted candle is a bar
 * pointing the other way, not an error.
 */
interface FoldPoint extends SourceKeyed {
  readonly bookId: string;
  readonly at: number;
  readonly blockNumber: number;
  readonly order: number;
  readonly price1e9: bigint;
}

/**
 * The fold both producers share — the raw-sample ladder and the scan-time trade aggregate.
 *
 * One implementation rather than two, because the part that is easy to get subtly wrong is the
 * **ordering**, and two copies would be two orderings that agree until one is edited. Open and
 * close are decided by `(at, blockNumber, order)` and never by array order: a caller handing
 * rows in the order IndexedDB returned them — or an ingest loop backfilling newest-first, which
 * §6.4 requires — would otherwise invert every candle it produced.
 */
function foldPoints(
  points: readonly (FoldPoint & SampleProvenance)[],
  resolution: Exclude<Resolution, 'raw'>,
): readonly Candle[] {
  // Grouped by book, then by provenance, then by bucket — three nested maps rather than a
  // joined string key. A composite string key needs a separator that cannot occur in a book id
  // or a provider id, and every choice of separator is a guess about identifiers this module
  // does not own: get it wrong and two books, or two providers, silently share a candle, which
  // is the one thing this fold must never do.
  const byBook = new Map<string, Map<string, Map<number, (FoldPoint & SampleProvenance)[]>>>();
  for (const point of points) {
    const bySource =
      byBook.get(point.bookId) ?? new Map<string, Map<number, (FoldPoint & SampleProvenance)[]>>();
    byBook.set(point.bookId, bySource);
    const key = provenanceKey(point);
    const buckets = bySource.get(key) ?? new Map<number, (FoldPoint & SampleProvenance)[]>();
    bySource.set(key, buckets);
    const openAt = bucketStart(point.at, resolution);
    const bucket = buckets.get(openAt);
    if (bucket) bucket.push(point);
    else buckets.set(openAt, [point]);
  }

  const out: Candle[] = [];
  for (const [bookId, bySource] of byBook) {
    for (const [, buckets] of bySource) {
      for (const [openAt, bucket] of buckets) {
        const ordered = [...bucket].sort(
          (a, b) => a.at - b.at || a.blockNumber - b.blockNumber || a.order - b.order,
        );
        const first = ordered[0];
        const last = ordered[ordered.length - 1];
        if (first === undefined || last === undefined) continue;
        let high = first.price1e9;
        let low = first.price1e9;
        let fromBlock = first.blockNumber;
        let toBlock = first.blockNumber;
        for (const point of ordered) {
          if (point.price1e9 > high) high = point.price1e9;
          if (point.price1e9 < low) low = point.price1e9;
          if (point.blockNumber < fromBlock) fromBlock = point.blockNumber;
          if (point.blockNumber > toBlock) toBlock = point.blockNumber;
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

/**
 * The rung the scan-time trade aggregate is written at — 10 §9.1, §9.2.
 *
 * §9.1 rules that *"chain-wide `Traded` is consumed into the candle aggregates as it is scanned
 * and never stored row-by-row"* and names no table. `candles1h` is the only rung that follows
 * from what the section does say: §9.2's ladder is `raw → candles1h → candles4h → candles1d`,
 * so `candles1h` is the finest table the aggregate can occupy, and writing it any coarser would
 * destroy resolution the client held at the moment it held it — the one thing the ladder is
 * ordered to avoid. The remaining freedom is a **spec question** (SQ-762), and this is the
 * reading that cannot overstate: no finer bar than the data supports, and no series merged into
 * another's.
 */
export const SCAN_AGGREGATE_RESOLUTION: Exclude<Resolution, 'raw'> = 'candles1h';

/**
 * One `Traded` fill, reduced to what an aggregate needs — 02 §5's frozen event.
 *
 * The price is **`p_after`**, which 02 §5 defines as *"the post-trade instantaneous `p_L`"* on
 * the 1e9 grid. It is not `Observed.o_t`: §9.1's sentence names `Traded` and nothing else, and
 * §9.1's own row-rate model derives the `priceSamples` tier from the observation grid
 * (*"observations 1 per `mkt.obs_interval` = 10 blocks per trading book"*). Whether the two
 * belong in one series is SQ-762; folding only the one the section names is the reading that
 * cannot overstate, because merging them would publish a bar describing neither.
 */
export interface BlockTradeFill {
  readonly bookId: string;
  /** 02 §5's `p_after`, 1e9-grid. */
  readonly price1e9: bigint;
  /** The fill's position in the block's event list — chain order, which decides open and close. */
  readonly eventIndex: number;
}

/**
 * Fold one finalized block's `Traded` fills into candle contributions — 10 §9.1's scan-time
 * aggregation.
 *
 * Per **block**, because that is the unit the ingest loop commits: the contribution and the
 * block's coverage advance land in one transaction, so a crash cannot leave a bar summarising
 * a block the index does not claim.
 *
 * The provenance is the block's **header** source, exactly as every other stored row takes it
 * (§7: *"every row carries the full four-valued `origin`"*). A fill has no provenance of its
 * own: it was read behind whatever header the loop was driven with, and 10 §6.5 derives every
 * other row's label from that same argument.
 */
export function tradeCandles(
  input: {
    readonly blockNumber: number;
    readonly blockTimestampMs: number;
    readonly fills: readonly BlockTradeFill[];
    readonly resolution: Exclude<Resolution, 'raw'>;
  } & SampleProvenance,
): readonly Candle[] {
  const { blockNumber, blockTimestampMs, fills, resolution } = input;
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
  assertProvenance(input, `trade aggregate for block ${blockNumber}`);
  const provenance = provenanceOf(input);
  const sourceKey = sourceKeyOf(input);
  const at = Math.floor(blockTimestampMs / 1000);
  return foldPoints(
    fills.map((fill) => {
      if (!Number.isInteger(fill.eventIndex) || fill.eventIndex < 0) {
        throw new CandleError(
          `a fill for ${fill.bookId} in block ${blockNumber} carries no event index; the index ` +
            'is what orders two fills inside one block, and order is what decides open and close',
        );
      }
      return {
        bookId: fill.bookId,
        at,
        blockNumber,
        order: fill.eventIndex,
        price1e9: fill.price1e9,
        sourceKey,
        ...provenance,
      };
    }),
    resolution,
  );
}

/** Whether a candle's block span already covers `blockNumber`. */
export function candleCoversBlock(candle: Candle, blockNumber: number): boolean {
  return blockNumber >= candle.fromBlock && blockNumber <= candle.toBlock;
}

/**
 * Roll `incoming` into `existing` — the read-modify-write a stored bucket needs.
 *
 * **A `put` is not a merge, and the difference is §9.2 obligation 2's named failure.** The
 * ladder writes a coarse row keyed on its bucket; writing it without reading the stored one
 * makes whole-bucket folding hold *within* a pass and not *across* passes, so a backfill chunk
 * landing older samples for an already-folded hour writes a bar **over** the earlier one —
 * *"a bar describing part of an hour, rendered as the hour"*. The same applies to §9.1's
 * scan-time aggregate, which contributes one block at a time into a bucket that spans hundreds.
 *
 * Open and close are taken by **block span**, not by write order: the earlier bar's open is the
 * bucket's open and the later bar's close is its close, whichever arrived first. Where the two
 * spans interleave the exact ordering is no longer recoverable from what is stored — the raw
 * rows are gone, which is the whole point of the ladder — so the merge takes the outermost
 * blocks and says so here rather than implying a precision it does not have.
 *
 * The caller owes one thing this cannot check: the two bars must summarise **disjoint** sample
 * sets, or `samples` double-counts. The ladder guarantees it by deleting what it folds, and
 * `storeWriter` guarantees it by skipping a block a stored bar already spans.
 */
export function mergeCandle(existing: Candle, incoming: Candle): Candle {
  if (
    existing.bookId !== incoming.bookId ||
    existing.sourceKey !== incoming.sourceKey ||
    existing.resolution !== incoming.resolution ||
    existing.openAt !== incoming.openAt
  ) {
    throw new CandleError(
      `cannot merge ${incoming.bookId}/${incoming.resolution}@${incoming.openAt} into ` +
        `${existing.bookId}/${existing.resolution}@${existing.openAt}: a merge is a read-modify-` +
        'write of ONE stored row, so the two must share the primary key and the resolution',
    );
  }
  assertProvenance(existing, `candle for ${existing.bookId}`);
  assertProvenance(incoming, `candle for ${incoming.bookId}`);
  const opensFirst = incoming.fromBlock < existing.fromBlock ? incoming : existing;
  const closesLast = incoming.toBlock > existing.toBlock ? incoming : existing;
  return {
    ...existing,
    open1e9: opensFirst.open1e9,
    close1e9: closesLast.close1e9,
    high1e9: incoming.high1e9 > existing.high1e9 ? incoming.high1e9 : existing.high1e9,
    low1e9: incoming.low1e9 < existing.low1e9 ? incoming.low1e9 : existing.low1e9,
    samples: existing.samples + incoming.samples,
    fromBlock: Math.min(existing.fromBlock, incoming.fromBlock),
    toBlock: Math.max(existing.toBlock, incoming.toBlock),
  } as Candle;
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

/**
 * What each rung is called in a sentence a user reads.
 *
 * A record rather than a formatter, so a fifth rung cannot be added without deciding what to call
 * it: `Record<Resolution, string>` fails to compile until the new key is written down.
 */
const RUNG_COPY: Readonly<Record<Resolution, string>> = Object.freeze({
  raw: 'raw samples',
  candles1h: 'hourly candles',
  candles4h: 'four-hourly candles',
  candles1d: 'daily candles',
});

/**
 * The rung one step **finer** than `of` — what the ladder folded away to produce it.
 *
 * The inverse of `nextResolution`, and the reason it exists is that `downsample`'s rendered
 * `reason` said *"raw samples for these blocks were evicted"* on **every** rung. §9.2's ladder is
 * `raw → candles1h → candles4h → candles1d`, so a range degraded to `candles4h` lost its hourly
 * candles and its raw samples went at the previous rung, one eviction pass earlier — the sentence
 * was true of exactly one of three cases, and the reason is *"rendered, not logged"*.
 *
 * Derived from `DEGRADATION_LADDER` rather than written out, because the ladder **is** the
 * degradation guarantee (see `laddersAgree`) and a second copy of it is how the two disagree.
 */
export function previousResolution(of: Exclude<Resolution, 'raw'>): Resolution {
  const previous = DEGRADATION_LADDER[DEGRADATION_LADDER.indexOf(of) - 1];
  if (previous === undefined) {
    throw new CandleError(`${of} is not a rung of 10 §9.2's ladder, so nothing folds into it`);
  }
  return previous;
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
      `${RUNG_COPY[previousResolution(to)]} for these blocks were folded away to stay inside the ` +
      `storage budget; the range is still covered at ${to} resolution. This is not a gap — ` +
      'nothing is missing, and refetching would not add detail this client ever had.',
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
