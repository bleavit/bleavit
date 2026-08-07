/**
 * The §9.2 quota manager — *"retention auto-tunes to budget (degrades depth, never
 * correctness)"* (10 §9.2, §9.3, §6.3; INV-FE-7). F8.
 *
 * §9.2 is the only section of doc 10 that describes a *process* rather than a shape, and until
 * this module existed the process had no implementation: the ladder was a frozen array, the
 * `DownsampledRange` type had one producer and no persistence, and nothing measured anything.
 * A retention policy nobody applies is not a conservative default — it is unbounded growth
 * with a paragraph about it.
 *
 * ## What the section actually mandates, clause by clause
 *
 * > Hard caps: **300 MB desktop / 75 MB mobile**. Fixed internal shares (user-adjustable
 * > locally): raw samples 60%, candles 20%, events+archive 15%, metadata 5%. The quota manager
 * > computes retention from the *measured* ingest rate — there is no fixed "90 days" promise.
 *
 * > Degradation ladder, applied oldest-first and in this order, deterministic and
 * > user-visible: raw samples → `candles1h` → `candles4h` → `candles1d`; `events` for
 * > settled+reaped proposals → compacted into `proposalsArchive` summaries; imported provider
 * > rows evicted before self-ingested rows at equal age. The ladder **degrades chart
 * > resolution and event granularity only**. It never touches: the tx path, layer-1 data,
 * > coverage metadata (holes stay truthful even after eviction — an evicted range becomes a
 * > labelled "downsampled" range, not a hole, and never a silent splice).
 *
 * Six obligations, and five of them are refusals. This module is organised around them.
 *
 * ## Where the caps come from, and the citation that does not resolve
 *
 * The two figures are published **in §9.2's own text**, which since SQ-557's ruling says so
 * explicitly: they are *"client-local values owned by this section"*, because a browser storage
 * quota is not a chain parameter and doc 13 is the chain registry. The `13-parameters.md`
 * citation this line used to carry pointed at a document with no such row and has been removed.
 * They are anchored here as named constants carrying the section reference — the shape
 * `tools/check-smoldot-budget.ts` uses for the §9.3 transfer budget — and they are **release**
 * constants rather than chain constants, the same classification 10 §8.3 states outright for the
 * provider health thresholds, so 10 §5.4's no-literal rule does not reach them.
 *
 * ## The metadata bound is §9.2's share, and `min` is what keeps it that way
 *
 * §9.2 gives metadata 5 % (15 MB desktop, 3.75 MB mobile) and §9.3 now bounds the same cache at
 * exactly those figures. It did not always: §9.3 published 16 MB / 6 MB, which **exceeded its
 * own share in both cases** — a bound that cannot bind — and SQ-557 cut it. The `min` below is
 * kept even though the two now agree, because they are two independently editable numbers in two
 * sections and the tighter one is the only safe composition: an error here is a cache slightly
 * smaller than one section permits rather than a budget the other forbids. At the measured blob
 * size (0.15 MB gz) the **count** limit is what actually binds and the byte limit is headroom.
 */

import type { Table } from 'dexie';

import {
  bucketSeconds,
  downsample,
  foldCandles,
  mergeCandle,
  mergeDownsampled,
  nextResolution,
  rollUp,
  sameSampleProvenance,
  type Candle,
  type DownsampledRange,
  type PriceSample,
  type Resolution,
  type SampleProvenance,
} from './candles.js';
import {
  candleTableFor,
  evictMetadataToBudget,
  evictPendingRawToBound,
  pendingRawBytes,
  readDownsampled,
  writeDownsampled,
  type CandleKey,
  type LocalIndex,
  type PendingRawEviction,
  type ProposalArchiveRow,
  type StoredEvent,
} from './store.js';

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

/** The two platforms §9.2 sizes separately. */
export type Platform = 'desktop' | 'mobile';

/**
 * §9.2's hard caps, in bytes. Decimal MB, which is what the section's own derived cells use:
 * 60% of 300 MB is published as *"180 MB desktop"* and 20% as *"60 MB"*, both exact only in
 * decimal. `quotaSharesAgree` re-derives those published cells so the reading is checked
 * rather than asserted.
 */
export const STORAGE_CAP_BYTES: Readonly<Record<Platform, number>> = Object.freeze({
  desktop: 300 * 1000 * 1000,
  mobile: 75 * 1000 * 1000,
});

/** §9.3's own metadata bounds, which the effective metadata budget is capped by. */
export const METADATA_BOUND: Readonly<Record<Platform, { blobs: number; bytes: number }>> =
  Object.freeze({
    desktop: Object.freeze({ blobs: 8, bytes: 15 * 1000 * 1000 }),
    mobile: Object.freeze({ blobs: 3, bytes: 3.75 * 1000 * 1000 }),
  });

/**
 * §9.2's fixed internal shares. Fractions rather than byte figures so the platform cap is the
 * single number that moves, and so the sum can be asserted: a share table that does not add to
 * one either wastes budget or over-commits it, and neither is visible from any one row.
 */
export const QUOTA_SHARES: QuotaShares = Object.freeze({
  rawSamples: 0.6,
  candles: 0.2,
  eventsAndArchive: 0.15,
  metadata: 0.05,
});

/** The four fractions §9.2 publishes, as a value a caller can supply a different one of. */
export interface QuotaShares {
  readonly rawSamples: number;
  readonly candles: number;
  readonly eventsAndArchive: number;
  readonly metadata: number;
}

export interface StorageBudget {
  readonly platform: Platform;
  readonly capBytes: number;
  readonly shares: QuotaShares;
  readonly rawSampleBytes: number;
  readonly candleBytes: number;
  readonly eventBytes: number;
  readonly metadataBytes: number;
  readonly metadataBlobs: number;
}

/**
 * The budget for a platform. **Required argument, no default** — a client that does not know
 * whether it is on a phone would otherwise silently take the desktop cap, which is the unsafe
 * direction (four times the storage on the device most likely to have none).
 *
 * §9.2's shares are *"fixed internal shares (**user-adjustable locally**)"*, so a second,
 * optional argument exists to adjust them — the parenthesis is the whole reason, and a frozen
 * table with no path to it published half the sentence. Adjusted shares are **validated, not
 * trusted**: each must be a fraction and the four must sum to the cap, because a table that does
 * not either wastes budget or over-commits it and neither is visible from any one row.
 *
 * What the adjustment cannot do is raise the metadata share past §9.3's own bound — the `min`
 * below still applies, so a local preference cannot grant a cache §9.3 forbids. It *can* lower
 * it below what the pinned runtimes need, at which point `evictMetadataToBudget` refuses rather
 * than dropping a pin; whether §9.2's adjustability was meant to reach a bound §9.3 states
 * absolutely is SQ-763.
 */
export function platformBudget(platform: Platform, shares: QuotaShares = QUOTA_SHARES): StorageBudget {
  const capBytes = STORAGE_CAP_BYTES[platform];
  if (capBytes === undefined) throw new QuotaError(`${String(platform)} is not a platform 10 §9.2 sizes`);
  if (!quotaSharesAgree(shares)) {
    throw new QuotaError(
      `the shares ${JSON.stringify(shares)} do not describe 10 §9.2's cap. Each must be a ` +
        'fraction above zero and the four must sum to one: a table that sums to less silently ' +
        'strands budget, and one that sums to more over-commits the hard cap — neither is ' +
        'visible from any single row.',
    );
  }
  const bound = METADATA_BOUND[platform];
  return {
    platform,
    capBytes,
    shares,
    rawSampleBytes: capBytes * shares.rawSamples,
    candleBytes: capBytes * shares.candles,
    eventBytes: capBytes * shares.eventsAndArchive,
    // The tighter of §9.2's share and §9.3's own bound — see the module note.
    metadataBytes: Math.min(capBytes * shares.metadata, bound.bytes),
    metadataBlobs: bound.blobs,
  };
}

/** Whether a share table sums to the whole cap. Exported so a suite can assert it. */
export function quotaSharesAgree(shares: QuotaShares = QUOTA_SHARES): boolean {
  const values = [shares.rawSamples, shares.candles, shares.eventsAndArchive, shares.metadata];
  if (values.some((value) => !Number.isFinite(value) || value <= 0 || value >= 1)) return false;
  return Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-9;
}

/**
 * Bytes per stored row, per table.
 *
 * **A required argument with no default**, for the reason app-code rule 7 gives for every
 * chain tunable: a compiled-in figure is one that stops tracking what it describes. §9.1
 * publishes *"~120 B effective per row (Dexie overhead included)"* as a modelling assumption
 * and labels it as one, so a module that hardcoded 120 would be publishing an assumption as a
 * measurement. The one table that records its real byte count — `metadataCache`, whose rows
 * carry `bytes` — is measured rather than modelled, and this struct has no entry for it.
 */
export interface RowSizes {
  readonly priceSample: number;
  readonly candle: number;
  readonly event: number;
  readonly archiveRow: number;
}

export interface Usage {
  readonly rawSampleBytes: number;
  readonly candleBytes: number;
  /** `events` + `proposalsArchive`, which §9.2 budgets as one share. */
  readonly eventBytes: number;
  /** Summed from each blob's recorded `bytes` — measured, not modelled. */
  readonly metadataBytes: number;
  readonly totalBytes: number;
}

function assertSizes(sizes: RowSizes): void {
  for (const [name, value] of Object.entries(sizes)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new QuotaError(
        `${name} row size ${String(value)} is not a positive byte count. A zero or absent size ` +
          'makes the table it describes weightless, so the ladder never reaches it and the ' +
          'budget is enforced against a figure that omits the largest table.',
      );
    }
  }
}

/** Measure what is stored, per §9.2 share. */
export async function measureUsage(db: LocalIndex, sizes: RowSizes): Promise<Usage> {
  assertSizes(sizes);
  const [rawSampleBytes, candleBytes, events, archive, pendingBytes, blobs] = await Promise.all([
    shareBytes(db, 'rawSamples', sizes),
    shareBytes(db, 'candles', sizes),
    db.events.count(),
    db.proposalsArchive.count(),
    // `pendingRawBytes`, not `pendingRawRows`: the same quantity by a route with no index to
    // disagree with, because a *measurement* that refuses stops the whole pass — this is the
    // first call in `applyQuota` — while the refusal belongs to the eviction that needs the
    // index. See `pendingRawBytes` for the division and why it is the fail-closed one.
    pendingRawBytes(db),
    db.metadataCache.toArray(),
  ]);
  // §6.5's raw blobs are **measured**, like `metadataCache` and unlike everything else here.
  // Modelling them at `sizes.event` charges a whole block's `System.Events` value — the largest
  // single row this schema can hold — as though it were one decoded event, so the share that is
  // supposed to bound them cannot see them growing. The row overhead is still modelled; only
  // the blob is weighed.
  const eventBytes = events * sizes.event + pendingBytes + archive * sizes.archiveRow;
  const metadataBytes = blobs.reduce((sum, blob) => sum + blob.bytes, 0);
  return {
    rawSampleBytes,
    candleBytes,
    eventBytes,
    metadataBytes,
    totalBytes: rawSampleBytes + candleBytes + eventBytes + metadataBytes,
  };
}

/**
 * The bytes of **one** share, and the reason it is separate from `measureUsage`.
 *
 * The ladder's inner loop asks one question per pass — *is the share this rung relieves still
 * over budget?* — and answering it through `measureUsage` costs six queries and a full read of
 * `metadataCache` for a number that cannot have changed. At the desktop raw share that loop runs
 * thousands of times, so the wasted work is not a constant factor: the pass that folds a full
 * index would re-measure tables it is not touching once per bucket.
 *
 * It stays a **database read** rather than an arithmetic carry-forward, and that is deliberate.
 * The progress guard is the one termination condition in that loop which is a property of the
 * loop itself rather than of other code, and a share derived from the step's own row counts
 * would agree with the step by construction — it could not see a delete that silently matched
 * nothing, which is precisely the failure it exists to catch.
 */
async function shareBytes(
  db: LocalIndex,
  share: 'rawSamples' | 'candles',
  sizes: RowSizes,
): Promise<number> {
  if (share === 'rawSamples') return (await db.priceSamples.count()) * sizes.priceSample;
  const [c1h, c4h, c1d] = await Promise.all([
    db.candles1h.count(),
    db.candles4h.count(),
    db.candles1d.count(),
  ]);
  return (c1h + c4h + c1d) * sizes.candle;
}

/**
 * §9.2's *"imported provider rows evicted before self-ingested rows at equal age"*, as the
 * comparator the whole ladder sorts by.
 *
 * Age leads and provenance breaks the tie — in that order, because the reverse would evict a
 * fresh provider row ahead of an ancient verified one and call it a retention policy. The tie
 * break itself is the honest one: a provider row can be re-fetched from the provider that
 * supplied it, while a self-ingested row past smoldot's pinned window **cannot be recovered at
 * all** (10 §6.2 — the only path to verified history is a re-read inside the pinned window).
 * So at equal age they are not equally costly to lose, and the section says which one goes.
 */
export function evictionOrder<T extends { readonly at: number } & SampleProvenance>(
  a: T,
  b: T,
): number {
  if (a.at !== b.at) return a.at - b.at;
  const imported = (row: SampleProvenance): number => (row.origin === 'self' ? 1 : 0);
  return imported(a) - imported(b);
}

export type QuotaStep =
  | {
      readonly kind: 'downsample';
      readonly from: Resolution;
      readonly to: Exclude<Resolution, 'raw'>;
      readonly rowsRemoved: number;
      readonly rowsWritten: number;
      readonly fromBlock: number;
      readonly toBlock: number;
      /**
       * The **source** bucket that was folded, as a Unix second.
       *
       * Reported because it identifies the unit of work, which the block span does not: the
       * ladder's cursor advances past a bucket that freed nothing, and *"which bucket"* is the
       * question that has to have an answer for that to be possible.
       */
      readonly bucketOpenAt: number;
    }
  | {
      readonly kind: 'compact-events';
      readonly proposalId: string;
      readonly eventsCompacted: number;
    }
  | { readonly kind: 'evict-metadata'; readonly specVersions: readonly number[] }
  /**
   * §9.1's bound on §6.5's raw blobs — see `evictPendingRawToBound`.
   *
   * An **envelope and a count**, never the block list. §9.2 calls the ladder *"user-visible"*, and
   * the desktop events share admits on the order of 225,000 of these blobs — so a per-block list
   * is not a rendering, it is the growth the eviction was run to stop reproduced in the report
   * about stopping it. `PendingRawEvictionRecord` already made that choice for the stored label.
   */
  | ({ readonly kind: 'evict-pending-raw' } & PendingRawEviction)
  /**
   * A rung that refused, reported **in its place in the sequence** rather than thrown.
   *
   * §9.2 orders the ladder and the order *is* the guarantee, which cuts both ways: a refusal in
   * one rung is not a licence to skip the ones after it. Three ordinary-data conditions used to
   * throw out of `applyQuota` — a pinned metadata set larger than its own budget, a settled
   * proposal whose events span two provenances, a raw row the sparse index cannot reach — and
   * each abandoned every later rung, so the §6.5 raw-blob bound never ran and the index grew
   * without limit under a pass that reported nothing.
   *
   * The refusals themselves are right; ending the pass is not. Each is caught where it happens
   * and lands here, so the sequence a surface renders states what was degraded **and** what
   * could not be.
   */
  | {
      readonly kind: 'refused';
      readonly rung: QuotaRung;
      /** The unit of work that refused — a source resolution, a proposal id, or the rung. */
      readonly at: string;
      readonly reason: string;
    };

/**
 * The rungs of §9.2's pass, named so a refusal can say which one it belongs to.
 *
 * **Every name here has an emitter.** A `'measure'` variant sat in this list with no producer
 * anywhere: measurement runs before the first rung, outside every `try`, so the one step the enum
 * advertised as refusable was the one that still took the whole pass down. A declared-and-never-
 * emitted name is the same defect as a declared-and-never-emitted error code — it reads as
 * coverage nobody has. What makes measurement safe instead is `pendingRawBytes`, the route with
 * no index to disagree with, so it has no refusal to report.
 */
export type QuotaRung = 'evict-metadata' | 'downsample' | 'compact-events' | 'evict-pending-raw';

/**
 * A proposal §9.2 permits compacting: *"`events` for settled+reaped proposals → compacted into
 * `proposalsArchive` summaries"*.
 *
 * **Injected, never derived here.** Settlement and reaping are chain facts, and `local-index`
 * may not import the chain client (10 §10.2) — which is exactly the constraint that makes this
 * safe rather than inconvenient: a module that guessed which proposals were settled would
 * compact a live one's events away, and the events of a live proposal are the granularity the
 * ladder is permitted to degrade *last*.
 */
export interface SettledProposal {
  readonly proposalId: string;
  readonly settledAt: number;
  /** The block span the summary describes. Descriptive — it does **not** select what is deleted. */
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly summary: string;
  /**
   * The **exact** `StoredEvent.id`s this summary replaces.
   *
   * Ids, not a block range, and the difference is a data-loss defect rather than a refinement.
   * `StoredEvent` carries no proposal reference (10 §7 publishes no column list — SQ-607), so a
   * block-span delete removes *every* event in those blocks: other proposals' events, market
   * trades, ledger movements. §9.2 permits compacting the events "for settled+reaped proposals"
   * and nothing else, and the ladder is stated to degrade "event granularity only".
   *
   * Which events belong to a proposal is a chain fact, and `local-index` may not read the chain
   * (10 §10.2) — the same constraint that makes `settled` itself injected. So the caller, which
   * already had to establish that the proposal is settled and reaped, names the rows.
   */
  readonly eventIds: readonly string[];
  /** The provenance of the summary, which is the provenance of the events it replaces. */
  readonly provenance: SampleProvenance;
}

export interface QuotaOptions {
  readonly budget: StorageBudget;
  readonly sizes: RowSizes;
  /** Unix seconds. A bucket that has not closed is never evicted — see `foldClosedBuckets`. */
  readonly now: number;
  /** §9.3's non-evictable set: the current and next-authorized runtimes' metadata. */
  readonly pinnedSpecVersions: readonly number[];
  /** §9.2's compaction input. Empty is the ordinary case and is not an error. */
  readonly settled?: readonly SettledProposal[];
}

/** Seconds in a day, so a measured span can be stated in the unit §9.2 publishes depth in. */
const DAY_SECONDS = 86_400;

/**
 * What one tier currently holds — 10 §9.2's measured-and-current obligation.
 *
 * > Raw depth is the tier that moves with hosted occupancy, so a client **MUST** present it as
 * > measured-and-current rather than as a promise — §9.2's opening sentence, that retention is
 * > computed from the *measured* ingest rate, is what makes that honest rather than merely
 * > cautious.
 *
 * §9.2's depth tables are a planning model at four book counts; this is the same quantity read
 * off the database in front of the user. The distinction is the whole `MUST`: hosted occupancy
 * is a governance row (`svc.max_live`, provisional 16 against a registry maximum of 64), so the
 * published figure moves under the client without anything local changing, and a surface quoting
 * a table cell would be quoting a promise nobody made.
 *
 * **An unmeasurable rate is `undefined`, never zero and never a default.** A tier holding one
 * row, or many rows all at one instant, has no span to divide by — and a rate invented there
 * would produce a budgeted depth of infinity, which is the one number this field must never
 * report. Absent is the honest value, and it is the fail-closed lattice this client applies to
 * every unproven capability.
 */
export interface TierDepth {
  readonly tier: Resolution;
  readonly rows: number;
  readonly bytes: number;
  /** The share §9.2 gives this tier, in bytes. Raw and the three candle tables share theirs. */
  readonly shareBytes: number;
  /** Oldest and newest instant held, Unix seconds — `undefined` for an empty tier. */
  readonly oldest: number | undefined;
  readonly newest: number | undefined;
  /** Days of history the tier holds **right now**, measured from its own rows. */
  readonly heldDays: number;
  /** Rows per day, measured over `heldDays`. `undefined` when the span is too short to divide. */
  readonly rowsPerDay: number | undefined;
  /**
   * Days the tier's share admits **at the measured rate** — §9.2's *"computed from the measured
   * ingest rate; there is no fixed '90 days' promise"*, as a number rather than as a sentence.
   */
  readonly budgetedDays: number | undefined;
}

export interface DepthReport {
  readonly measuredAt: number;
  readonly tiers: readonly TierDepth[];
}

/**
 * Measure current depth per tier — callable without running a retention pass, because the
 * surface that has to present it renders far more often than the quota manager runs.
 *
 * **Read from the indexes, never from the rows**, and that sentence is a crash fix rather than a
 * refinement. The first version materialised every row of every tier and took `Math.min(...)` /
 * `Math.max(...)` over the result: V8 refuses a spread above roughly 125,390 arguments, so the
 * function threw `RangeError: Maximum call stack size exceeded` once any tier passed that size —
 * and `applyQuota` calls it on every pass, so the whole retention pass threw with it. `candles1h`
 * grows 159 books × 24 h = 3,816 rows/day at the registry maximum, reaching it in about 33 days,
 * roughly a quarter of §9.2's own published 131-day desktop candle depth and long before the
 * 500,000-row candle share triggers any relief. On mobile the 125,000-row share and the crash
 * arrive together.
 *
 * The unbounded read was a defect on its own terms even without the throw — this function's own
 * note says the surface calling it *"renders far more often than the quota manager runs"*.
 * `at` and `openAt` are both declared indexes, so the extremes are the first and last entries of
 * an ordered index: measured here, 1 ms against 4.25 s for the whole-table form at 130,000 rows.
 *
 * **The row count comes off the same index**, which the first version of the repair got wrong in a
 * way nothing would have flagged: `Table.count()` counts rows and an index counts *entries*, and a
 * row missing the indexed field is not an entry. Measured on the pinned Dexie, a table holding one
 * row with no `at` answers 3 to `count()` and 2 to `orderBy('at').count()` — so the rate would
 * have been three rows over the span of two, an over-count that is conservative but that nothing
 * pinned. One population, one question: the rows the extremes were taken over are the rows
 * divided by the span between them.
 */
export async function measureDepth(
  db: LocalIndex,
  budget: StorageBudget,
  sizes: RowSizes,
  now: number,
): Promise<DepthReport> {
  assertSizes(sizes);
  if (!Number.isInteger(now) || now < 0) throw new QuotaError(`${now} is not a Unix second`);
  const tiers: TierDepth[] = [
    tierDepth(
      'raw',
      await tierExtent<PriceSample>(
        {
          count: () => db.priceSamples.orderBy('at').count(),
          first: () => db.priceSamples.orderBy('at').first(),
          last: () => db.priceSamples.orderBy('at').last(),
        },
        (row) => row.at,
      ),
      sizes.priceSample,
      budget.rawSampleBytes,
    ),
  ];
  // The three candle tables share one §9.2 budget line, so each is reported against the share it
  // actually competes for rather than against a quarter of it invented here.
  for (const resolution of ['candles1h', 'candles4h', 'candles1d'] as const) {
    const table = db.table<Candle>(candleTableFor(resolution));
    tiers.push(
      tierDepth(
        resolution,
        await tierExtent<Candle>(
          {
            count: () => table.orderBy('openAt').count(),
            first: () => table.orderBy('openAt').first(),
            last: () => table.orderBy('openAt').last(),
          },
          (row) => row.openAt,
        ),
        sizes.candle,
        budget.candleBytes,
      ),
    );
  }
  return { measuredAt: now, tiers };
}

/**
 * A tier's size and its two extreme instants — all three read through **one** ordered index, so
 * the count and the extremes describe the same population.
 *
 * Three index reads, whatever the tier holds.
 */
interface TierExtent {
  readonly rows: number;
  readonly oldest: number | undefined;
  readonly newest: number | undefined;
}

/**
 * The extent of one tier, read through the ordered index the extremes are the ends of.
 *
 * A structural `read` object rather than a `Table`, the same shape `oldestClosedBucket` takes:
 * the two tiers order by different fields (`at` and `openAt`) declared on differently-typed
 * tables, and threading the index name through a generic `Table` type buys nothing the call site
 * does not already state plainly.
 */
async function tierExtent<T>(
  read: {
    readonly count: () => Promise<number>;
    readonly first: () => Promise<T | undefined>;
    readonly last: () => Promise<T | undefined>;
  },
  instant: (row: T) => number,
): Promise<TierExtent> {
  const [rows, first, last] = await Promise.all([read.count(), read.first(), read.last()]);
  return {
    rows,
    oldest: first === undefined ? undefined : instant(first),
    newest: last === undefined ? undefined : instant(last),
  };
}

function tierDepth(
  tier: Resolution,
  extent: TierExtent,
  rowBytes: number,
  share: number,
): TierDepth {
  const { rows, oldest, newest } = extent;
  const spanSeconds = oldest === undefined || newest === undefined ? 0 : newest - oldest;
  const heldDays = spanSeconds / DAY_SECONDS;
  const rowsPerDay = heldDays > 0 ? rows / heldDays : undefined;
  return {
    tier,
    rows,
    bytes: rows * rowBytes,
    shareBytes: share,
    oldest,
    newest,
    heldDays,
    rowsPerDay,
    budgetedDays: rowsPerDay === undefined ? undefined : share / rowBytes / rowsPerDay,
  };
}

/**
 * How many non-refusal steps a report lists before it stops listing them.
 *
 * §9.2 calls the ladder *"deterministic and user-visible"*, and a `downsample` step is one folded
 * bucket: a full pass at the desktop raw share (180 MB ÷ ~120 B ≈ 1.5 M rows) is thousands of
 * them, which is a log rather than a rendering. The listed prefix plus `stepsPerformed` is the
 * same envelope-and-count treatment `PendingRawEvictionRecord` already applies one layer down, and
 * the aggregate outcome is fully described elsewhere in the report — `before`/`after` state what
 * was freed, `downsampled` the labels the passes wrote, `depth` where the user ends up.
 *
 * **Refusals are never elided**, whatever the cap: they are what a pass could not do, they are
 * bounded by the rungs (plus the caller's own settled list), and `refusals` is derived from
 * `steps` precisely so a refusal cannot go unreported.
 */
export const MAX_REPORTED_STEPS = 100;

export interface QuotaReport {
  readonly before: Usage;
  readonly after: Usage;
  /**
   * The pass's steps in order, **bounded** — at most `MAX_REPORTED_STEPS` of them plus every
   * refusal. `stepsPerformed - steps.length` is what was elided.
   */
  readonly steps: readonly QuotaStep[];
  /** How many steps the pass actually performed, listed or not. */
  readonly stepsPerformed: number;
  readonly downsampled: readonly DownsampledRange[];
  /**
   * §9.2's measured-and-current depth, taken **after** the pass — which is the state the user is
   * in, not the one they were in before it ran.
   */
  readonly depth: DepthReport;
  /**
   * The rungs that refused, in order — the `refused` steps, kept as their own list so a caller
   * can ask *"did anything refuse?"* without filtering a heterogeneous sequence.
   *
   * Derived from `steps` rather than accumulated beside it: two lists maintained in parallel are
   * two chances to report a refusal in one and not the other, and this one exists precisely so a
   * refusal cannot go unreported.
   */
  readonly refusals: readonly Extract<QuotaStep, { kind: 'refused' }>[];
  /**
   * True when every rung has been applied and the budget is still exceeded.
   *
   * §9.2 is explicit that this state exists, and since SQ-557's ruling it is explicit about
   * *when*: against the primary slate the caps are generous (~54 days of raw desktop samples),
   * while *"against a fully-subscribed hosted partition the raw tier is genuinely thin: ~7 days
   * desktop, ~2 days mobile"*. The earlier blanket *"not achievable within the caps"* is
   * **withdrawn as false** — it followed from a book count the chain cannot reach. Either way
   * this is a reported outcome rather than a throw: a quota manager that threw would turn a
   * budgeted, expected state into a crash on the busiest chain.
   */
  readonly exhausted: boolean;
}

/** The tables the ladder may never touch, named so the rule can be asserted rather than read. */
export const TX_PATH_TABLES: readonly string[] = Object.freeze(['txHistory', 'snapshotsImported']);

/**
 * Apply §9.2's ladder until the budget holds, or until there is nothing left to give up.
 *
 * The order below is the section's order, and the order **is** the guarantee: applied out of
 * sequence the ladder frees the same bytes and destroys more resolution than it had to.
 *
 * 1. **Metadata** (§9.3) — bounded independently and evicted LRU with the pinned set honoured.
 * 2. **Events** — settled+reaped proposals compacted into `proposalsArchive` summaries.
 * 3. **Raw samples** → `candles1h`, oldest closed bucket first.
 * 4. **`candles1h` → `candles4h` → `candles1d`**, the same way, until the floor.
 *
 * Every deletion happens in an `rw` transaction that also writes the coarser rows **and** the
 * `downsampled` label. That is not tidiness: §9.2 requires the evicted range to become a
 * labelled downsampled range *"and never a silent splice"*, and a label written in a second
 * transaction is absent for exactly as long as it takes a tab to close.
 *
 * **Each rung is caught separately, and that is the section's order taken seriously.** A rung
 * that refuses is reported as a `refused` step and the pass continues down the ladder: the order
 * is a guarantee about what is degraded *first*, not a licence to skip everything after the first
 * thing that says no. Left uncaught, a pinned metadata set larger than its budget skipped the
 * whole chart ladder, and one mixed-provenance proposal skipped the §6.5 raw-blob bound — so the
 * one tier §9.1 forbids retaining grew without limit under a pass that reported nothing at all.
 */
export async function applyQuota(db: LocalIndex, options: QuotaOptions): Promise<QuotaReport> {
  const { budget, sizes, now, pinnedSpecVersions } = options;
  assertSizes(sizes);
  if (!Number.isInteger(now) || now < 0) throw new QuotaError(`${now} is not a Unix second`);
  const steps: QuotaStep[] = [];
  let stepsPerformed = 0;
  // Every step is counted; the list keeps a bounded prefix — see `MAX_REPORTED_STEPS`.
  const record = (step: QuotaStep): void => {
    stepsPerformed += 1;
    if (steps.length < MAX_REPORTED_STEPS) steps.push(step);
  };
  // A refusal is never elided, so it does not go through the cap.
  const refuse = (rung: QuotaRung, at: string, error: unknown): void => {
    stepsPerformed += 1;
    steps.push({ kind: 'refused', rung, at, reason: reasonOf(error) });
  };
  const before = await measureUsage(db, sizes);

  // 1. Metadata — §9.3's own bound, tightened to §9.2's share (module note). Independent of the
  // chart ladder and of the event share, so its position here changes nothing it destroys.
  try {
    const evicted = await evictMetadataToBudget(db, {
      maxBlobs: budget.metadataBlobs,
      maxBytes: Math.floor(budget.metadataBytes),
      pinned: pinnedSpecVersions,
    });
    if (evicted.length > 0) record({ kind: 'evict-metadata', specVersions: evicted });
  } catch (error) {
    // §9.3's pinned set does not fit its own platform budget — a release-configuration fault the
    // chart ladder can do nothing about and must not be stopped by.
    refuse('evict-metadata', 'metadata', error);
  }

  // 2. The chart ladder. `labels` accumulates across rungs so a range degraded twice keeps the
  // coarser label rather than two rows claiming two resolutions for one span.
  //
  // **It is only ever advanced by a fold whose transaction committed**, and that is not tidiness
  // either. `degradeOldestBucket` used to merge the incoming range into this accumulator *before*
  // opening its transaction, so a fold that aborted left the phantom label here — and the next
  // rung, which does commit, persisted the whole accumulator including a "downsampled" range whose
  // rows were never deleted. §9.2 obligation 1 binds the label to the delete (*"written in the
  // same storage transaction that deletes the rows"*), and before the per-rung `catch` below the
  // throw happened to prevent it. The error direction is safe — fidelity under-claimed, never
  // over-claimed — but it is still a persisted claim about a deletion that did not happen.
  let labels = await readDownsampled(db);
  let rung: Resolution | undefined = 'raw';
  while (rung !== undefined) {
    const target = nextResolution(rung);
    // `candles1d` is the floor: §9.2 justifies it arithmetically (a daily row costs
    // `books × 120 B/day` even at the 159-book maximum), so there is nothing to degrade *to*.
    if (target === undefined) break;
    const share = shareOf(rung);
    const budgetForShare = share === 'rawSamples' ? budget.rawSampleBytes : budget.candleBytes;
    // The cursor. `after` is the last bucket this rung folded **without freeing anything**;
    // every pass starts strictly after it, so the loop cannot retry a bucket it has already
    // failed on and cannot skip one it has not tried.
    let after: number | undefined;
    try {
      for (;;) {
        // Only the share this rung can relieve, read from the database each pass. Degrading
        // candles because the *sample* share is over would destroy resolution without freeing a
        // byte of the share that is full.
        const held = await shareBytes(db, share, sizes);
        if (held <= budgetForShare) break;
        const folded = await degradeOldestBucket(db, rung, target, now, after, labels);
        if (folded === undefined) break;
        // Assigned only here, after the transaction that wrote the same value resolved.
        labels = folded.labels;
        const step = folded.step;
        record(step);
        // **The progress guard, and what it must not do is abandon the rung.** Every other
        // termination condition here is a property of *other* code — the delete really removing
        // rows, the measurement really shrinking — and when one of those is wrong the loop folds
        // one bucket forever, which takes the tab with it. But a bucket can also legitimately free
        // nothing: rolling up a bucket holding a single candle writes one row for one row, and a
        // guard that stopped there would report `exhausted` while later buckets holding four
        // rows apiece were still foldable and still over budget. So a bucket that freed nothing
        // advances the cursor past **itself** rather than ending the rung, and the rung ends only
        // when nothing is eligible or the share is under budget.
        if ((await shareBytes(db, share, sizes)) >= held) after = step.bucketOpenAt;
      }
    } catch (error) {
      // One rung, one refusal. The coarser rungs below still run: a `candles1h` fold that cannot
      // proceed says nothing about whether `candles4h` can be rolled into `candles1d`.
      refuse('downsample', rung, error);
    }
    rung = target;
  }

  // 3. Events: compaction of settled+reaped proposals only. **After** the chart ladder, because
  // §9.2 publishes the order and calls it "deterministic and user-visible" — `QuotaReport.steps`
  // is what renders it. The two consume separate shares, so nothing extra is destroyed either
  // way; what changes is whether the reported sequence is the section's.
  for (const proposal of options.settled ?? []) {
    if ((await eventShareBytes(db, sizes)) <= budget.eventBytes) break;
    try {
      const compacted = await compactSettledEvents(db, proposal);
      if (compacted === 0) continue;
      record({ kind: 'compact-events', proposalId: proposal.proposalId, eventsCompacted: compacted });
    } catch (error) {
      // Per proposal, not per loop: a mixed-provenance proposal is refused and the next settled
      // proposal is still compacted. The refusal costs that proposal's depth, which §9.2 permits;
      // costing every later proposal's depth as well is not something it permits anywhere.
      refuse('compact-events', proposal.proposalId, error);
    }
  }

  // 4. §6.5's raw blobs, bounded last because they are the only event rows the ladder can free
  // that a user might still want — an era's metadata can arrive (FE-P5) and make them readable.
  // Compaction goes first for that reason: a settled proposal's decoded events are replaced by a
  // summary that says what they were, while a discarded blob is gone. The budget is what the
  // events share has **left** after everything else in it, so the bound is §9.2's own 15 % and
  // not a number invented here.
  try {
    const eventOverhead = (await eventShareBytes(db, sizes)) - (await pendingRawBytes(db));
    const evictedRaw = await evictPendingRawToBound(
      db,
      Math.max(0, budget.eventBytes - eventOverhead),
      now,
    );
    if (evictedRaw !== undefined) record({ kind: 'evict-pending-raw', ...evictedRaw });
  } catch (error) {
    // `pendingRawRows` refuses when the sparse index cannot reach the whole pending set. That
    // refusal is right — an under-covering bound is worse than none — and it is the last rung, so
    // the only thing left to protect is the report itself.
    refuse('evict-pending-raw', 'pending-raw', error);
  }

  return {
    before,
    after: await measureUsage(db, sizes),
    steps,
    stepsPerformed,
    downsampled: labels,
    depth: await measureDepth(db, budget, sizes, now),
    refusals: steps.filter((step): step is Extract<QuotaStep, { kind: 'refused' }> => step.kind === 'refused'),
    exhausted: !(await budgetHolds(db, budget, sizes)),
  };
}

/** A caught refusal as the report states it — the message, never a stringified `[object Object]`. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A provenance as an error message names it — one spelling, so two messages cannot disagree. */
function describe(provenance: SampleProvenance): string {
  return provenance.origin === 'self' ? 'self' : `${provenance.origin}:${provenance.providerId}`;
}

/** Which §9.2 share a rung's rows are charged to. */
function shareOf(rung: Resolution): 'rawSamples' | 'candles' {
  return rung === 'raw' ? 'rawSamples' : 'candles';
}

/** The events share as `measureUsage` computes it — decoded rows, raw blobs and the archive. */
async function eventShareBytes(db: LocalIndex, sizes: RowSizes): Promise<number> {
  const [events, archive, pendingBytes] = await Promise.all([
    db.events.count(),
    db.proposalsArchive.count(),
    pendingRawBytes(db),
  ]);
  return events * sizes.event + pendingBytes + archive * sizes.archiveRow;
}

/**
 * Whether **every** §9.2 bound holds — all four shares and the hard total cap.
 *
 * `exhausted` is computed from this rather than from `overShare`, and the difference is the
 * whole meaning of the field: §9.2's caps are on the **total** ("300 MB desktop / 75 MB
 * mobile") and the shares are internal. A report computed from the two chart shares alone
 * answered `exhausted: false` for a database 500 MB over its own event share and 200 MB over
 * the platform cap — which is the one thing that number exists to say.
 */
async function budgetHolds(
  db: LocalIndex,
  budget: StorageBudget,
  sizes: RowSizes,
): Promise<boolean> {
  const usage = await measureUsage(db, sizes);
  return (
    usage.rawSampleBytes <= budget.rawSampleBytes &&
    usage.candleBytes <= budget.candleBytes &&
    usage.eventBytes <= budget.eventBytes &&
    usage.metadataBytes <= budget.metadataBytes &&
    usage.totalBytes <= budget.capBytes
  );
}

/**
 * The oldest closed target bucket's rows, and **only** that bucket's.
 *
 * The whole-table read this replaces was the reason the quota manager could not run at the scale
 * it enforces: `degradeOldestBucket` re-materialised `priceSamples` once per bucket folded, and
 * at the desktop raw share (180 MB ÷ ~120 B ≈ 1.5 M rows) a full pass is thousands of buckets —
 * so the pass costs rows × buckets. The suite could not see it, because the row sizes it uses are
 * set so that a handful of rows exceeds a 300 MB share.
 *
 * Two facts make one indexed read sufficient. **The index is ordered by the instant**, so the
 * first row past the cursor is the oldest one there is; and **bucket closure is monotone in that
 * instant**, so if the oldest row's bucket has not closed then no bucket has and there is nothing
 * to do. The bucket is then read by key range over the same index — bounded by one bucket's rows
 * rather than by the table.
 */
async function oldestClosedBucket<T>(
  read: {
    readonly first: (after: number | undefined) => Promise<T | undefined>;
    readonly between: (from: number, to: number) => Promise<readonly T[]>;
    readonly instant: (row: T) => number;
  },
  width: number,
  now: number,
  after: number | undefined,
): Promise<{ readonly openAt: number; readonly rows: readonly T[] } | undefined> {
  // A row is eligible when **its target bucket** has closed, which is not the same as the row
  // itself lying in the past. The candle arm once read `c.openAt + width <= lastClosedEnd` — the
  // *target* width added to a *source* row — so of the four hours belonging to one 4 h bucket
  // only the first qualified. The bucket was written from that hour alone, and the next pass
  // wrote it again from the remaining three under the same key, replacing the first: an hour of
  // history gone, with coverage still claiming those blocks and the "downsampled" label still
  // saying nothing is missing.
  const lastClosedEnd = now - (now % width);
  const first = await read.first(after);
  if (first === undefined) return undefined;
  const openAt = align(read.instant(first), width);
  if (openAt >= lastClosedEnd) return undefined;
  return { openAt, rows: await read.between(openAt, openAt + width - 1) };
}

function align(at: number, width: number): number {
  return at - (at % width);
}

/**
 * Degrade the oldest **closed** bucket one rung, in a single transaction.
 *
 * Whole buckets, and closed ones only. Both restrictions are load-bearing:
 *
 * - **Whole buckets**, because the coarser row is keyed on its bucket. Folding half a bucket
 *   now and the other half later writes two candles under one key, and — before `mergeCandle` —
 *   the second silently replaced the first: a bar describing part of an hour, rendered as the
 *   hour.
 * - **Closed buckets**, because samples still arriving in the current bucket would produce
 *   exactly that second write. `now` decides, and a bucket is closed when its end is strictly
 *   in the past.
 *
 * `after` skips buckets an earlier pass folded without freeing anything — see `applyQuota`.
 *
 * **The label is merged and written inside the transaction, and the merged set is a return
 * value.** It used to be built by a callback that mutated the caller's accumulator before the
 * transaction opened, which is §9.2 obligation 1 read backwards: the label is bound to the delete
 * (*"written in the same storage transaction that deletes the rows"*), so a fold that aborts must
 * leave no trace of it anywhere — not in storage, which the transaction already guaranteed, and
 * not in the accumulator a later rung will persist. Returning it means the caller can only learn
 * the new set from a transaction that resolved.
 */
async function degradeOldestBucket(
  db: LocalIndex,
  from: Resolution,
  to: Exclude<Resolution, 'raw'>,
  now: number,
  after: number | undefined,
  labels: readonly DownsampledRange[],
): Promise<
  | {
      readonly step: Extract<QuotaStep, { kind: 'downsample' }>;
      readonly labels: readonly DownsampledRange[];
    }
  | undefined
> {
  const width = bucketSeconds(to);
  const target = db.table<Candle, CandleKey>(candleTableFor(to));

  if (from === 'raw') {
    const bucket = await oldestClosedBucket<PriceSample>(
      {
        first: async (cursor) =>
          cursor === undefined
            ? db.priceSamples.orderBy('at').first()
            : db.priceSamples.where('at').aboveOrEqual(cursor + width).first(),
        between: (low, high) => db.priceSamples.where('at').between(low, high, true, true).toArray(),
        instant: (row) => row.at,
      },
      width,
      now,
      after,
    );
    if (bucket === undefined || bucket.rows.length === 0) return undefined;
    // §9.2's eviction order decides which (book, source) group inside the bucket goes first:
    // oldest, then imported before self-ingested at equal age.
    const oldest = [...bucket.rows].sort(evictionOrder)[0] as PriceSample;
    const group = bucket.rows.filter(
      (s) => s.sourceKey === oldest.sourceKey && s.bookId === oldest.bookId,
    );
    const candles = foldCandles(group, to);
    const fromBlock = group.reduce((m, s) => Math.min(m, s.blockNumber), group[0]!.blockNumber);
    const toBlock = group.reduce((m, s) => Math.max(m, s.blockNumber), group[0]!.blockNumber);
    const written = await db.transaction('rw', db.priceSamples, target, db.meta, async () => {
      await rollIntoBuckets(target, candles);
      await db.priceSamples.bulkDelete(group.map((s) => [s.bookId, s.sourceKey, s.blockNumber] as [string, string, number]));
      const ranges = mergeDownsampled(labels, downsample(fromBlock, toBlock, to, now));
      await writeDownsampled(db, ranges);
      return ranges;
    });
    return {
      step: {
        kind: 'downsample',
        from,
        to,
        rowsRemoved: group.length,
        rowsWritten: candles.length,
        fromBlock,
        toBlock,
        bucketOpenAt: bucket.openAt,
      },
      labels: written,
    };
  }

  const sourceTable = db.table<Candle, CandleKey>(candleTableFor(from));
  const bucket = await oldestClosedBucket<Candle>(
    {
      first: async (cursor) =>
        cursor === undefined
          ? sourceTable.orderBy('openAt').first()
          : sourceTable.where('openAt').aboveOrEqual(cursor + width).first(),
      between: (low, high) => sourceTable.where('openAt').between(low, high, true, true).toArray(),
      instant: (row) => row.openAt,
    },
    width,
    now,
    after,
  );
  if (bucket === undefined || bucket.rows.length === 0) return undefined;
  const oldest = [...bucket.rows].sort((a, b) =>
    evictionOrder({ ...a, at: a.openAt }, { ...b, at: b.openAt }),
  )[0] as Candle;
  const group = bucket.rows.filter(
    (c) => c.sourceKey === oldest.sourceKey && c.bookId === oldest.bookId,
  );
  const rolled = rollUp(group, to);
  const fromBlock = group.reduce((m, c) => Math.min(m, c.fromBlock), group[0]!.fromBlock);
  const toBlock = group.reduce((m, c) => Math.max(m, c.toBlock), group[0]!.toBlock);
  const written = await db.transaction('rw', sourceTable, target, db.meta, async () => {
    await rollIntoBuckets(target, rolled);
    await sourceTable.bulkDelete(group.map((c) => [c.bookId, c.sourceKey, c.openAt] as [string, string, number]));
    const ranges = mergeDownsampled(labels, downsample(fromBlock, toBlock, to, now));
    await writeDownsampled(db, ranges);
    return ranges;
  });
  return {
    step: {
      kind: 'downsample',
      from,
      to,
      rowsRemoved: group.length,
      rowsWritten: rolled.length,
      fromBlock,
      toBlock,
      bucketOpenAt: bucket.openAt,
    },
    labels: written,
  };
}

/**
 * Write coarse rows into the target table by **reading what is already there** — §9.2's second
 * obligation, which a `bulkPut` cannot satisfy.
 *
 * > Degradation is applied in whole, closed buckets. Folding part of a bucket now and the rest
 * > later writes two coarse rows under one bucket key, the second replacing the first, so the
 * > chart shows a bar describing part of an hour labelled as the hour.
 *
 * Folding whole buckets makes that true *within* a pass and not *across* passes: a backfill
 * chunk landing older samples for an already-folded hour arrives later and writes over the
 * earlier bar. Reading first and rolling in is the difference between "the ladder is
 * whole-bucket" as a property of one call and as a property of the stored row.
 */
async function rollIntoBuckets(
  table: Table<Candle, CandleKey>,
  candles: readonly Candle[],
): Promise<void> {
  for (const candle of candles) {
    const existing = await table.get([candle.bookId, candle.sourceKey, candle.openAt]);
    await table.put(existing === undefined ? candle : mergeCandle(existing, candle));
  }
}

/**
 * §9.2's event compaction: a settled+reaped proposal's events become one archive summary.
 *
 * One transaction, for the same reason every other step here is: the summary and the deletion
 * are one fact, and a crash between them either loses the events with no summary (granularity
 * gone, nothing saying so) or writes a summary claiming to replace events that are still there
 * and will be counted twice by the next measurement.
 */
export async function compactSettledEvents(
  db: LocalIndex,
  proposal: SettledProposal,
): Promise<number> {
  if (proposal.toBlock < proposal.fromBlock) {
    throw new QuotaError(
      `proposal ${proposal.proposalId} declares span ${proposal.fromBlock}..${proposal.toBlock}, ` +
        'which runs backwards; compacting it would delete no events and publish a summary of none',
    );
  }
  // Exactly the rows the caller named, and only those that exist. `bulkGet` returns `undefined`
  // for an id that is not there, which is the ordinary case on a replay: a second pass over an
  // already-compacted proposal must be a no-op rather than an error.
  const found = await db.events.bulkGet([...proposal.eventIds]);
  const doomed: StoredEvent[] = found.filter((event): event is StoredEvent => event !== undefined);
  if (doomed.length === 0) return 0;
  // The declared span is what the summary tells the user it replaces, so a named row outside it
  // means the two halves of one claim disagree — and the direction that matters is the summary
  // silently standing in for events it never mentions.
  const stray = doomed.find(
    (event) => event.blockNumber < proposal.fromBlock || event.blockNumber > proposal.toBlock,
  );
  if (stray !== undefined) {
    throw new QuotaError(
      `proposal ${proposal.proposalId} names event ${stray.id} at block ${stray.blockNumber}, ` +
        `outside the span ${proposal.fromBlock}..${proposal.toBlock} its summary declares. The ` +
        'summary is what the user is shown in place of the rows, so it cannot describe a ' +
        'narrower range than it replaces.',
    );
  }
  // **Provenance is never degraded on the way** — §9.2 obligation 3, which the archive row was
  // outside. `proposalsArchive` is keyed on the proposal id alone by **`SCHEMA_V1`/`SCHEMA_V3`**,
  // this package's own declaration — 10 §7 publishes a table name list and three named key
  // changes and no column list at all (SQ-607), so it cannot be cited for this key and an earlier
  // draft of this comment did exactly that. One settled proposal therefore gets one summary; the
  // summary's origin was whatever the caller put in `provenance`, and nothing compared it with
  // the rows being deleted. A proposal whose blocks span a self-ingested range and an
  // operator-backfilled one collapsed into a single row that would render under one badge — the
  // merge §6.3 refuses for ranges and `foldCandles` refuses for bars, arriving where there is no
  // second row to keep the boundary in.
  //
  // Refused rather than split, because splitting needs a second summary and the declared key
  // admits exactly one row per proposal. Re-keying on `[proposalId+sourceKey]` would change the
  // archive's identity, which is a schema decision this refusal does not force; refusing leaves
  // the events in place, costing depth, which §9.2 permits and mislabelling does not.
  const foreign = doomed.find((event) => !sameSampleProvenance(event, proposal.provenance));
  if (foreign !== undefined) {
    throw new QuotaError(
      `proposal ${proposal.proposalId} declares its summary as ${describe(proposal.provenance)} ` +
        `and names event ${foreign.id}, which is ${describe(foreign)}. 10 §9.2 lets the ladder ` +
        'degrade resolution and forbids it relabelling a source on the way; SCHEMA_V3 keys ' +
        'proposalsArchive by proposal alone, so one summary cannot carry two origins and there ' +
        'is no second row to keep the boundary in. The events stay, which costs depth rather ' +
        'than truth.',
    );
  }
  const row: ProposalArchiveRow = {
    proposalId: proposal.proposalId,
    settledAt: proposal.settledAt,
    summary: proposal.summary,
    compactedEvents: doomed.length,
    ...proposal.provenance,
  } as ProposalArchiveRow;
  await db.transaction('rw', db.events, db.proposalsArchive, async () => {
    await db.proposalsArchive.put(row);
    await db.events.bulkDelete(doomed.map((event) => event.id));
  });
  return doomed.length;
}

