/**
 * The ingestion loop — 10 §6.5's orchestration over F8's decision layer.
 *
 * Every *judgement* already lives in `ingest.ts` and `coverage.ts`: which extrinsics a block
 * attributes, whether a body is worth fetching, what provenance a body inherits, how ranges
 * merge. This module has no judgement of its own. What it owns is **order and continuity**,
 * and both fail in ways no unit test of the pure functions can see.
 *
 * ## 1. Coverage advances only after the rows are durably written
 *
 * The tempting shape is to advance coverage as each block is scanned and write in the
 * background. A crash then leaves coverage claiming blocks whose rows were never stored —
 * and coverage is precisely the structure the client uses to decide it does **not** need to
 * re-fetch. The gap becomes permanent and invisible: `isVerifiedAt` answers `true` for a
 * block with no data behind it.
 *
 * So `ingestBlock` awaits the write and returns the new coverage only on success. There is no
 * path that produces advanced coverage from a failed write, and a throw leaves the caller's
 * coverage untouched rather than half-advanced.
 *
 * ## 2. A skipped block is a hole, never a span
 *
 * Subscriptions drop. When one resumes, the next finalized block it delivers may be far past
 * the last one ingested, and the naive `addRange(coverage, selfRange(first, latest))` claims
 * every block in between as self-ingested — the exact promotion 10 §6.3 forbids, arrived at
 * by a reconnect instead of a merge.
 *
 * `ingestBlock` therefore adds a **single-block range per block** and lets `addRange` do the
 * joining, which it only does for genuinely adjacent same-origin ranges. A gap survives as a
 * hole because no range was ever created over it. This is the one place where doing the
 * obvious cheap thing (one wide range) and the correct thing differ, and the correct thing
 * is also simpler to state: *we claim what we ingested, one block at a time.*
 *
 * ## 3. A body fetch that fails does not silently drop the block's rows
 *
 * §6.5's cost claim means most blocks need no body. But when one *is* needed and the fetch
 * fails, the block has attributed extrinsics whose rows cannot be built. Writing the events
 * and advancing coverage would record the block as ingested while the user's own transactions
 * from it are missing — and a filtered history is indistinguishable from an empty one.
 *
 * So a failed body fetch fails the block: nothing is written, coverage does not advance, and
 * the block stays outside coverage where a later pass will find it as a hole.
 */

import {
  addRange,
  rangeForSource,
  verifyRanges,
  type CoverageRange,
  type CoverageRef,
  type HeaderSource,
  type RangeCheck,
  type RangeEdge,
  type RangeEdgeFacts,
} from './coverage.js';
import {
  SCAN_AGGREGATE_RESOLUTION,
  tradeCandles,
  type Candle,
} from './candles.js';
import {
  attributedExtrinsics,
  bodyProvenance,
  needsBodyFetch,
  tradedFills,
  txRowKey,
  type BodyProvenance,
  type FinalizedBlockScan,
} from './ingest.js';

export class IngestLoopError extends Error {
  readonly blockNumber: number;

  constructor(blockNumber: number, message: string) {
    super(`block ${blockNumber}: ${message}`);
    this.name = 'IngestLoopError';
    this.blockNumber = blockNumber;
  }
}

/** One attributed extrinsic, ready to be stored. */
export interface AttributedRow {
  readonly key: string;
  readonly blockNumber: number;
  readonly extrinsicIndex: number;
  readonly provenance: BodyProvenance;
  /** The decoded body bytes for this extrinsic, as the fetcher returned them. */
  readonly body: Uint8Array;
}

/** One event the index retains, carrying **the index it had in the scan** (§6.5's stable key). */
export interface RetainedEvent {
  readonly event: FinalizedBlockScan['events'][number];
  /**
   * Position in `scan.events`, not in the retained list.
   *
   * The stored row's id is `${block}:${index}` and §6.5 requires ingest writes to be idempotent
   * under replay. Numbering the retained list instead would make the id a function of *which
   * accounts were watched at the time*, so adding an account would renumber every earlier row
   * and the replay would write a second copy of history beside the first.
   */
  readonly index: number;
}

export interface BlockWrite {
  readonly blockNumber: number;
  readonly scan: FinalizedBlockScan;
  readonly rows: readonly AttributedRow[];
  /**
   * The events this block contributes to the index — **only those naming a watched account**.
   *
   * 10 §9.1 rules it and §9.2 measures why: *"the local index retains **only events attributing
   * to the user's watched accounts**, which is §6.5's existing rule — 'worst-case overhead is
   * proportional to the user's own activity, not chain activity' — applied to storage as well as
   * to body fetches. Chain-wide `Traded` is consumed into the candle aggregates as it is scanned
   * and never stored row-by-row; a chain-wide trade tape is a bounded windowed read, never a
   * retained table."*
   *
   * The number behind the rule: at the chain-permitted `Traded` ceiling the 15 % events share
   * holds about **6.7 h desktop / 1.7 h mobile** of chain-wide rows, so an index that stored
   * every event would spend its entire share inside a working day and then start evicting the
   * user's own history in order to keep storing strangers' trades. Measured against the user's
   * own activity the same share is decades.
   *
   * Computed by the loop rather than by the writer because the watched set is the loop's
   * argument; a writer that re-derived it would be a second copy of the rule with nothing
   * forcing the two to agree.
   */
  readonly retainedEvents: readonly RetainedEvent[];
  /**
   * This block's contribution to the candle aggregates — 10 §9.1's **other** half.
   *
   * The retention filter above implements *"never stored row-by-row"*. This implements the
   * clause in front of it: *"Chain-wide `Traded` **is consumed into the candle aggregates as it
   * is scanned**"*. Without it §9.2's candle-depth tables describe a tier with no producer, and
   * the whole chain-wide trade stream — 1,339,200 rows/day at the chain-permitted ceiling, about
   * 6.3× the entire observation stream — is scanned, filtered out, and forgotten.
   *
   * It is chain-wide, unlike `retainedEvents`: the aggregate is what makes discarding the rows
   * honest rather than lossy. One `Candle` per book per source in this block's bucket, at
   * `SCAN_AGGREGATE_RESOLUTION`, folded from 02 §5's `p_after` in chain order.
   *
   * Carried on the write rather than applied by the loop so it lands in **one transaction** with
   * the rows and the coverage advance — the same reason `coverageAfter` is here. A bar written
   * in a second transaction can summarise a block the index does not claim.
   */
  readonly tradeAggregates: readonly Candle[];
  /**
   * The header this block was ingested behind — **the origin, verbatim, not a re-derivation**.
   *
   * `BodyProvenance` has two values and `RangeOrigin` has four, so a writer handed only the
   * former had to guess which of `operator`, `snapshot` and `indexer` a `provider` row came
   * from, and it guessed `operator`. That collapse is exactly what §7's own reason column
   * forbids — *"layer-2 backfill is distinguishable from opt-in third-party providers"* — and
   * it fails in the dangerous direction: a row an opt-in third-party indexer supplied is
   * persisted, and would be badged, as protocol-funded layer-2 data. INV-FE-15 requires the
   * origin to reach the pixel, so it has to reach the row first.
   */
  readonly headerSource: HeaderSource;
  /**
   * The coverage that becomes current **if and only if** this write succeeds.
   *
   * Passed in rather than persisted by a second call so an implementation can commit the
   * rows and the coverage in **one transaction**. Rule 1 without this is only an in-memory
   * property: rows written, then a crash before the coverage write, is the harmless
   * direction — but rows written *after* coverage is not, and two separate calls leave that
   * ordering to whoever writes the adapter. One transaction removes the choice.
   */
  readonly coverageAfter: CoverageRef;
}

export interface LoopPorts {
  /**
   * Fetch the block's extrinsic bodies. Called **only** when a watched account is
   * attributed — §6.5's cost claim is a property of this call site, not of the fetcher.
   */
  readonly fetchBodies: (blockNumber: number) => Promise<readonly Uint8Array[]>;
  /** Durably persist a block's events and attributed rows. Must resolve only on success. */
  readonly write: (write: BlockWrite) => Promise<void>;
  /** Wall-clock for the coverage range's `ingestedAt`. Injected so tests are deterministic. */
  readonly now: () => number;
  /**
   * The chain this run indexes — §6.3's genesis binding, stamped onto every range.
   *
   * On the ports rather than on the scan because it is a property of the run and not of a
   * block: a per-block genesis would be a value the loop could disagree with itself about.
   */
  readonly genesisHash: string;
  /**
   * What the chain says about a stored range's edge block, or `undefined` for *cannot say*.
   *
   * §6.3's per-range integrity checks (hash-at-edge, genesis binding, spec-version-at-edge) run
   * once per run, before the first block, because the failure they catch happens **while the
   * client is not running**: a reorg past the coverage edge, or a runtime upgrade under rows
   * already decoded. Resuming ingestion on top of a range the chain has since disowned extends
   * a claim about a fork nobody is on.
   *
   * **Required, not optional.** An optional integrity check is one that defaults off, which is
   * the shape `admitIntent` and `admitSnapshot` both refuse for their hash functions and which
   * this repository keeps finding. A caller with no chain access supplies a function returning
   * `undefined`, and everything is kept — that is the fail-safe state, stated in a signature
   * rather than reached by omission.
   */
  readonly observeEdge: (range: CoverageRange) => RangeEdgeFacts | undefined;
}

export interface IngestResult {
  readonly coverage: CoverageRef;
  readonly fetchedBody: boolean;
  readonly rowCount: number;
  /** §6.5: this block's events were stored raw because their era metadata was unavailable. */
  readonly pendingDecode: boolean;
  /**
   * §9.1: how many chain-wide `Traded` fills this block folded into the aggregates.
   *
   * Reported rather than inferred from the row count, because the two numbers answer opposite
   * questions: `rowCount` is the user's own activity and this is the chain's. A run that stored
   * nothing and folded thousands is the ordinary case, and it is the case in which "did the
   * aggregation run at all" would otherwise be unanswerable.
   */
  readonly tradesFolded: number;
}

/**
 * Ingest one finalized block.
 *
 * Returns the **new** coverage rather than mutating: a caller that forgets to keep the result
 * simply does not advance, which is the safe direction. The reverse — mutating in place and
 * advancing before the write lands — is the failure this whole module is shaped around.
 */
export async function ingestBlock(
  coverage: CoverageRef,
  scan: FinalizedBlockScan,
  watched: ReadonlySet<string>,
  headerSource: HeaderSource,
  ports: LoopPorts,
): Promise<IngestResult> {
  // Throws on a bad extrinsic index, which is correct here too: a block we cannot attribute
  // safely must not be recorded as ingested.
  const indices = attributedExtrinsics(scan, watched);
  const wantsBody = needsBodyFetch(scan, watched);

  let rows: readonly AttributedRow[] = [];
  if (wantsBody) {
    let bodies: readonly Uint8Array[];
    try {
      bodies = await ports.fetchBodies(scan.number);
    } catch (cause) {
      // Nothing written, coverage untouched: a block whose rows we cannot build must stay
      // outside coverage, because a *filtered* history is indistinguishable from an empty one.
      throw new IngestLoopError(
        scan.number,
        `the body fetch failed (${cause instanceof Error ? cause.message : String(cause)}), so ` +
          'this block is not recorded as ingested — its attributed extrinsics would be missing ' +
          'and a filtered history looks exactly like an empty one',
      );
    }
    // The scan's count is optional (SQ-595) — §6.5 gives no source for one at scan time. Two
    // distinct checks live here, and conflating them is how the optional count became a bug:
    //
    // 1. A *declared* count that disagrees with the body means the body we fetched is not the
    //    block we scanned. Only checkable when one was declared.
    // 2. An attributed index beyond the body's length is checkable **always**, because the
    //    fetched body IS the authoritative count. This is where SQ-595 moved the guard
    //    `attributedExtrinsics` can no longer make, and it is the check that matters: it is
    //    the one covering the decode that would read a different extrinsic.
    if (scan.extrinsicCount !== undefined && bodies.length !== scan.extrinsicCount) {
      throw new IngestLoopError(
        scan.number,
        `the fetched body has ${bodies.length} extrinsic(s) but the scan declared ` +
          `${scan.extrinsicCount}; indexing into it would read a different block`,
      );
    }
    const beyond = indices.find((index) => index >= bodies.length);
    if (beyond !== undefined) {
      throw new IngestLoopError(
        scan.number,
        `an event attributed extrinsic ${beyond} but the fetched body has only ` +
          `${bodies.length}; decoding at that index would read a different extrinsic`,
      );
    }
    // Provenance follows the **header**, never the fetch — §6.5. Derived from the same
    // argument that decides the coverage range's origin, so the two cannot disagree.
    const provenance = bodyProvenance(headerSource.origin);
    rows = indices.map((index) => ({
      key: txRowKey(scan.number, index),
      blockNumber: scan.number,
      extrinsicIndex: index,
      provenance,
      body: bodies[index] as Uint8Array,
    }));
  }

  // One block at a time. `addRange` joins genuinely adjacent same-origin ranges and nothing
  // else, so a subscription that resumed past a gap leaves that gap as a hole rather than
  // claiming it — the reconnect route to the promotion 10 §6.3 forbids.
  //
  // **From `headerSource`, not from `selfRange`.** This line read `selfRange(...)`
  // unconditionally while the comment above the rows claimed both were derived from one
  // argument. They were not: a block ingested behind an `operator` header stored rows
  // labelled `provider` and a coverage range labelled `self`, so `isVerifiedAt` answered
  // `true` for it. That is the promotion 10 §2.2 says has no path — reached through
  // backfill rather than through a merge, and invisible to every test that only checked
  // the rows.
  const edge: RangeEdge = {
    genesisHash: ports.genesisHash,
    hash: scan.hash,
    specVersion: scan.specVersion,
  };
  const next = addRange(
    coverage,
    rangeForSource(headerSource, scan.number, scan.number, ports.now(), edge),
  );

  // Computed before the write so the adapter can commit both atomically, **returned** only
  // after it resolves. The distinction is the whole of rule 1: computing early is fine,
  // handing back advanced coverage from a failed write is not — a throw here leaves the
  // caller's coverage exactly as it was.
  // §9.1's retention rule, applied where the watched set lives. Correlation events
  // (`ExtrinsicSuccess`/`Failed`) carry no account and are excluded by the same test that
  // excludes strangers' trades — which is right: §6.5 calls them correlation, not attribution.
  const retainedEvents = scan.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.accounts.some((account) => watched.has(account)));

  // §9.1's other half, and the one the retention filter alone leaves unimplemented: the trades
  // this block carried are folded **now**, while they are in hand, because nothing downstream
  // will ever see them again. Chain-wide, deliberately — an aggregate over the user's own fills
  // would be a different and much smaller claim under the same label.
  const fills = tradedFills(scan);
  const tradeAggregates =
    fills.length === 0
      ? []
      : tradeCandles({
          blockNumber: scan.number,
          blockTimestampMs: scan.blockTimestampMs,
          fills,
          resolution: SCAN_AGGREGATE_RESOLUTION,
          ...(headerSource.origin === 'self'
            ? { origin: 'self' as const }
            : { origin: headerSource.origin, providerId: headerSource.providerId }),
        });

  await ports.write({
    blockNumber: scan.number,
    scan,
    rows,
    retainedEvents,
    tradeAggregates,
    headerSource,
    coverageAfter: next,
  });

  return {
    coverage: next,
    fetchedBody: wantsBody,
    rowCount: rows.length,
    pendingDecode: scan.pendingDecode !== undefined,
    tradesFolded: fills.length,
  };
}

/**
 * Drive the loop over a sequence of finalized blocks.
 *
 * Sequential on purpose. Ingesting concurrently would let block N+1's coverage land before
 * N's write, which is rule 1 broken by parallelism rather than by ordering — and the symptom
 * is identical.
 *
 * A block that throws **stops the run** and returns the coverage as of the last successful
 * block, along with the failure. Continuing past it would leave a hole the caller never
 * learns about, and this is the one place the loop can still report it.
 */
export interface RunResult {
  readonly coverage: CoverageRef;
  readonly ingested: number;
  readonly bodiesFetched: number;
  /**
   * §6.5's *"N events pending decoder"*, counted for this run.
   *
   * A run that ingested blocks from an era whose metadata is unavailable did **not** fail, and
   * it did not succeed silently either. This is the number the surface names, and the reason
   * it is a return value rather than a log line is that nothing else in this package can tell
   * the difference between a block with no interesting events and a block nobody could read.
   */
  readonly pendingDecode: number;
  /** §9.1: the chain-wide `Traded` fills this run folded into the candle aggregates. */
  readonly tradesFolded: number;
  /**
   * §6.3's per-range checks, run once before the first block of this run.
   *
   * Reported rather than logged for the same reason the run's block count is: an index that
   * silently shrank between two sessions is one the user re-backfills without knowing why.
   */
  readonly invalidated: readonly RangeCheck[];
  readonly stoppedAt: IngestLoopError | undefined;
}

export async function runIngest(
  coverage: CoverageRef,
  scans: AsyncIterable<FinalizedBlockScan> | Iterable<FinalizedBlockScan>,
  watched: ReadonlySet<string>,
  headerSource: HeaderSource,
  ports: LoopPorts,
): Promise<RunResult> {
  // §6.3's integrity checks first, and **before** the first block rather than after it. Ingesting
  // onto a range the chain has since disowned extends the wrong history by one block before the
  // check that would have caught it — and the extension joins the bad range, which makes the
  // disposal coarser than it needed to be.
  const checked = verifyRanges(coverage, ports.observeEdge);
  let current = checked.coverage;
  let ingested = 0;
  let bodiesFetched = 0;
  let pendingDecode = 0;
  let tradesFolded = 0;
  for await (const scan of scans as AsyncIterable<FinalizedBlockScan>) {
    let result: IngestResult;
    try {
      result = await ingestBlock(current, scan, watched, headerSource, ports);
    } catch (error) {
      const stoppedAt =
        error instanceof IngestLoopError
          ? error
          : new IngestLoopError(scan.number, error instanceof Error ? error.message : String(error));
      return {
        coverage: current,
        ingested,
        bodiesFetched,
        pendingDecode,
        tradesFolded,
        invalidated: checked.invalidated,
        stoppedAt,
      };
    }
    current = result.coverage;
    ingested += 1;
    if (result.fetchedBody) bodiesFetched += 1;
    if (result.pendingDecode) pendingDecode += 1;
    tradesFolded += result.tradesFolded;
  }
  return {
    coverage: current,
    ingested,
    bodiesFetched,
    pendingDecode,
    tradesFolded,
    invalidated: checked.invalidated,
    stoppedAt: undefined,
  };
}
