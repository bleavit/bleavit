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
 * The two figures are published **in §9.2's own text**, and the section additionally cites
 * *"normative values: 13-parameters.md"* — a citation that **does not resolve**: doc 13 carries
 * no storage-quota row (SQ-557, open). So §9.2's own cells are the only published home, and
 * they are anchored here as named constants carrying the section reference, the shape
 * `tools/check-smoldot-budget.ts` uses for the §9.3 transfer budget. They are **release**
 * constants rather than chain constants — no governance track moves how much storage a browser
 * grants a page — which is the same classification 10 §8.3 states outright for the provider
 * health thresholds, so 10 §5.4's no-literal rule does not reach them.
 *
 * ## The metadata share and §9.3 disagree, and the tighter bound wins
 *
 * §9.2 gives metadata 5% (15 MB desktop, 3.75 MB mobile). §9.3 bounds the same cache at 16 MB
 * desktop / 6 MB mobile. **Both cannot hold**, and the contradiction is unruled (SQ-557 again).
 * R-2 forbids resolving a `[VERIFY]`-shaped question by assumption, so this module takes the
 * **minimum** of the two rather than picking a winner: a bound below both published bounds
 * violates neither, and the error direction is a cache slightly smaller than one section
 * permits rather than a budget one section forbids.
 */

import {
  bucketSeconds,
  downsample,
  foldCandles,
  mergeDownsampled,
  nextResolution,
  rollUp,
  type Candle,
  type DownsampledRange,
  type PriceSample,
  type Resolution,
  type SampleProvenance,
} from './candles.js';
import {
  evictMetadataToBudget,
  readDownsampled,
  writeDownsampled,
  type LocalIndex,
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
    desktop: Object.freeze({ blobs: 8, bytes: 16 * 1000 * 1000 }),
    mobile: Object.freeze({ blobs: 3, bytes: 6 * 1000 * 1000 }),
  });

/**
 * §9.2's fixed internal shares. Fractions rather than byte figures so the platform cap is the
 * single number that moves, and so the sum can be asserted: a share table that does not add to
 * one either wastes budget or over-commits it, and neither is visible from any one row.
 */
export const QUOTA_SHARES = Object.freeze({
  rawSamples: 0.6,
  candles: 0.2,
  eventsAndArchive: 0.15,
  metadata: 0.05,
});

export interface StorageBudget {
  readonly platform: Platform;
  readonly capBytes: number;
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
 */
export function platformBudget(platform: Platform): StorageBudget {
  const capBytes = STORAGE_CAP_BYTES[platform];
  if (capBytes === undefined) throw new QuotaError(`${String(platform)} is not a platform 10 §9.2 sizes`);
  const bound = METADATA_BOUND[platform];
  return {
    platform,
    capBytes,
    rawSampleBytes: capBytes * QUOTA_SHARES.rawSamples,
    candleBytes: capBytes * QUOTA_SHARES.candles,
    eventBytes: capBytes * QUOTA_SHARES.eventsAndArchive,
    // The tighter of §9.2's share and §9.3's own bound — see the module note.
    metadataBytes: Math.min(capBytes * QUOTA_SHARES.metadata, bound.bytes),
    metadataBlobs: bound.blobs,
  };
}

/** Whether the share table sums to the whole cap. Exported so a suite can assert it. */
export function quotaSharesAgree(): boolean {
  const sum = Object.values(QUOTA_SHARES).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) < 1e-9;
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
  const [samples, c1h, c4h, c1d, events, archive, blobs] = await Promise.all([
    db.priceSamples.count(),
    db.candles1h.count(),
    db.candles4h.count(),
    db.candles1d.count(),
    db.events.count(),
    db.proposalsArchive.count(),
    db.metadataCache.toArray(),
  ]);
  const rawSampleBytes = samples * sizes.priceSample;
  const candleBytes = (c1h + c4h + c1d) * sizes.candle;
  const eventBytes = events * sizes.event + archive * sizes.archiveRow;
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
    }
  | {
      readonly kind: 'compact-events';
      readonly proposalId: string;
      readonly eventsCompacted: number;
    }
  | { readonly kind: 'evict-metadata'; readonly specVersions: readonly number[] };

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
   * `StoredEvent` carries no proposal reference (10 §7 publishes no column list — SQ-605), so a
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

export interface QuotaReport {
  readonly before: Usage;
  readonly after: Usage;
  readonly steps: readonly QuotaStep[];
  readonly downsampled: readonly DownsampledRange[];
  /**
   * True when every rung has been applied and the budget is still exceeded.
   *
   * §9.2 is explicit that this state exists — *"at maximum chain load, deep raw-resolution
   * history in the browser is **not achievable** within the caps — stated plainly"* — so it is
   * a reported outcome rather than a throw. A quota manager that threw here would turn the
   * section's honest admission into a crash on the busiest chain.
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
 */
export async function applyQuota(db: LocalIndex, options: QuotaOptions): Promise<QuotaReport> {
  const { budget, sizes, now, pinnedSpecVersions } = options;
  assertSizes(sizes);
  if (!Number.isInteger(now) || now < 0) throw new QuotaError(`${now} is not a Unix second`);
  const before = await measureUsage(db, sizes);
  const steps: QuotaStep[] = [];

  // 1. Metadata — §9.3's own bound, tightened to §9.2's share (module note). Independent of the
  // chart ladder and of the event share, so its position here changes nothing it destroys.
  const evicted = await evictMetadataToBudget(db, {
    maxBlobs: budget.metadataBlobs,
    maxBytes: Math.floor(budget.metadataBytes),
    pinned: pinnedSpecVersions,
  });
  if (evicted.length > 0) steps.push({ kind: 'evict-metadata', specVersions: evicted });

  // 2. The chart ladder. `labels` accumulates across rungs so a range degraded twice keeps the
  // coarser label rather than two rows claiming two resolutions for one span.
  let labels = await readDownsampled(db);
  let rung: Resolution | undefined = 'raw';
  while (rung !== undefined) {
    const target = nextResolution(rung);
    // `candles1d` is the floor: §9.2 justifies it arithmetically (a daily row costs
    // `books × 120 B/day` even at max load), so there is nothing to degrade *to*.
    if (target === undefined) break;
    for (;;) {
      const over = await overShare(db, budget, sizes);
      // Only the share this rung can relieve. Degrading candles because the *sample* share is
      // over would destroy resolution without freeing a byte of the share that is full.
      if (over !== shareOf(rung)) break;
      const usageBefore = await measureUsage(db, sizes);
      const step = await degradeOldestBucket(db, rung, target, now, (range) => {
        labels = mergeDownsampled(labels, range);
        return labels;
      });
      if (step === undefined) break;
      steps.push(step);
      // **A progress guard, and it is not defensive padding.** Every other termination
      // condition here is "the share fell" or "nothing is eligible", and both are properties of
      // *other* code — the delete really removing rows, the measurement really shrinking. When
      // one of those is wrong the loop above folds the same bucket forever: the coarse row is
      // rewritten, the delete removes nothing, the share is unchanged, and the rung is retried.
      // §9.2 states plainly that running out of room is *"a reported outcome"* (deep raw history
      // "is not achievable within the caps"), so an unbounded loop is not an admissible failure
      // mode for it — and a retention pass that never returns takes the tab with it.
      const usageAfter = await measureUsage(db, sizes);
      const removed = step.kind === 'downsample' ? step.rowsRemoved : 0;
      if (removed === 0 || usageAfter[USAGE_FIELD[over]] >= usageBefore[USAGE_FIELD[over]]) {
        break;
      }
    }
    rung = target;
  }

  // 3. Events: compaction of settled+reaped proposals only. **After** the chart ladder, because
  // §9.2 publishes the order and calls it "deterministic and user-visible" — `QuotaReport.steps`
  // is what renders it. The two consume separate shares, so nothing extra is destroyed either
  // way; what changes is whether the reported sequence is the section's.
  let eventBytes = (await db.events.count()) * sizes.event + (await db.proposalsArchive.count()) * sizes.archiveRow;
  for (const proposal of options.settled ?? []) {
    if (eventBytes <= budget.eventBytes) break;
    const compacted = await compactSettledEvents(db, proposal);
    if (compacted === 0) continue;
    steps.push({ kind: 'compact-events', proposalId: proposal.proposalId, eventsCompacted: compacted });
    eventBytes -= compacted * sizes.event;
    eventBytes += sizes.archiveRow;
  }

  return {
    before,
    after: await measureUsage(db, sizes),
    steps,
    downsampled: labels,
    exhausted: !(await budgetHolds(db, budget, sizes)),
  };
}

/** Which §9.2 share a rung's rows are charged to. */
function shareOf(rung: Resolution): 'rawSamples' | 'candles' {
  return rung === 'raw' ? 'rawSamples' : 'candles';
}

/** Which `Usage` field carries a share's bytes, so progress can be measured on the right one. */
const USAGE_FIELD = Object.freeze({
  rawSamples: 'rawSampleBytes',
  candles: 'candleBytes',
} as const);

/**
 * The first **ladder-relievable** share over its budget, in ladder order.
 *
 * Deliberately narrower than "is the budget exceeded": these are the two shares a rung can act
 * on. The events share has no rung once the settled list is empty, and the metadata share is
 * handled by its own bounded eviction, so reporting either here would spin the chart ladder
 * against a share it cannot touch. `budgetHolds` is the wider question.
 */
async function overShare(
  db: LocalIndex,
  budget: StorageBudget,
  sizes: RowSizes,
): Promise<'rawSamples' | 'candles' | undefined> {
  const usage = await measureUsage(db, sizes);
  if (usage.rawSampleBytes > budget.rawSampleBytes) return 'rawSamples';
  if (usage.candleBytes > budget.candleBytes) return 'candles';
  return undefined;
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

const CANDLE_TABLE: Readonly<Record<Exclude<Resolution, 'raw'>, 'candles1h' | 'candles4h' | 'candles1d'>> =
  Object.freeze({ candles1h: 'candles1h', candles4h: 'candles4h', candles1d: 'candles1d' });

/**
 * Degrade the oldest **closed** bucket one rung, in a single transaction.
 *
 * Whole buckets, and closed ones only. Both restrictions are load-bearing:
 *
 * - **Whole buckets**, because the coarser row is keyed on its bucket. Folding half a bucket
 *   now and the other half later writes two candles under one key, and the second silently
 *   replaces the first — a bar describing part of an hour, rendered as the hour.
 * - **Closed buckets**, because samples still arriving in the current bucket would produce
 *   exactly that second write. `now` decides, and a bucket is closed when its end is strictly
 *   in the past.
 */
async function degradeOldestBucket(
  db: LocalIndex,
  from: Resolution,
  to: Exclude<Resolution, 'raw'>,
  now: number,
  label: (range: DownsampledRange) => readonly DownsampledRange[],
): Promise<Extract<QuotaStep, { kind: 'downsample' }> | undefined> {
  const width = bucketSeconds(to);
  const lastClosedEnd = now - (now % width);
  // A row is eligible when **its target bucket** has closed, which is not the same as the row
  // itself lying in the past. The candle arm first read `c.openAt + width <= lastClosedEnd` —
  // the *target* width added to a *source* row — so of the four hours belonging to one 4 h
  // bucket only the first qualified. The bucket was written from that hour alone, and the next
  // pass wrote it again from the remaining three **under the same key**, replacing the first:
  // an hour of history gone, with coverage still claiming those blocks and the "downsampled"
  // label still saying nothing is missing. Both arms now ask the one question that is correct
  // for both.
  const bucketClosed = (at: number): boolean => at - (at % width) < lastClosedEnd;

  if (from === 'raw') {
    const samples = await db.priceSamples.orderBy('at').toArray();
    const eligible = samples.filter((s) => bucketClosed(s.at));
    if (eligible.length === 0) return undefined;
    const oldest = [...eligible].sort(evictionOrder)[0] as PriceSample;
    const bucketOpen = oldest.at - (oldest.at % width);
    const group = eligible.filter(
      (s) => s.sourceKey === oldest.sourceKey && s.bookId === oldest.bookId && s.at - (s.at % width) === bucketOpen,
    );
    const candles = foldCandles(group, to);
    const fromBlock = group.reduce((m, s) => Math.min(m, s.blockNumber), group[0]!.blockNumber);
    const toBlock = group.reduce((m, s) => Math.max(m, s.blockNumber), group[0]!.blockNumber);
    const ranges = label(downsample(fromBlock, toBlock, to, now));
    await db.transaction('rw', db.priceSamples, db[CANDLE_TABLE[to]], db.meta, async () => {
      await db[CANDLE_TABLE[to]].bulkPut(candles as Candle[]);
      await db.priceSamples.bulkDelete(group.map((s) => [s.bookId, s.sourceKey, s.blockNumber] as [string, string, number]));
      await writeDownsampled(db, ranges);
    });
    return {
      kind: 'downsample',
      from,
      to,
      rowsRemoved: group.length,
      rowsWritten: candles.length,
      fromBlock,
      toBlock,
    };
  }

  const sourceTable = db[CANDLE_TABLE[from]];
  const rows = await sourceTable.orderBy('openAt').toArray();
  const eligible = rows.filter((c) => bucketClosed(c.openAt));
  if (eligible.length === 0) return undefined;
  const oldest = [...eligible].sort((a, b) => evictionOrder({ ...a, at: a.openAt }, { ...b, at: b.openAt }))[0] as Candle;
  const bucketOpen = oldest.openAt - (oldest.openAt % width);
  const group = eligible.filter(
    (c) => c.sourceKey === oldest.sourceKey && c.bookId === oldest.bookId && c.openAt - (c.openAt % width) === bucketOpen,
  );
  const rolled = rollUp(group, to);
  const fromBlock = group.reduce((m, c) => Math.min(m, c.fromBlock), group[0]!.fromBlock);
  const toBlock = group.reduce((m, c) => Math.max(m, c.toBlock), group[0]!.toBlock);
  const ranges = label(downsample(fromBlock, toBlock, to, now));
  await db.transaction('rw', sourceTable, db[CANDLE_TABLE[to]], db.meta, async () => {
    await db[CANDLE_TABLE[to]].bulkPut(rolled as Candle[]);
    await sourceTable.bulkDelete(group.map((c) => [c.bookId, c.sourceKey, c.openAt] as [string, string, number]));
    await writeDownsampled(db, ranges);
  });
  return {
    kind: 'downsample',
    from,
    to,
    rowsRemoved: group.length,
    rowsWritten: rolled.length,
    fromBlock,
    toBlock,
  };
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

