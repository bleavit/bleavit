/**
 * The index boot check — 10 §6.3's per-range integrity checks, as something that runs.
 *
 * §6.3 states three checks and one disposal rule:
 *
 * > Cursor integrity checks (hash-at-edge, genesis binding, spec-version-at-edge) apply per
 * > range; corruption of one range invalidates that range, not the index.
 *
 * `verifyRange` answers the checks and `invalidateRange` performs the disposal, but a checker
 * with **no call site** is a paragraph: before this module the only production caller of either
 * was nobody, so a range corrupted in IndexedDB was read back, believed, and consulted by
 * `isVerifiedAt` — the one question this package exists to answer honestly.
 *
 * ## Why the boot path and not the read path
 *
 * The checks need the chain: a hash at a height, the runtime's `spec_version` there, the
 * genesis hash. That is a light-client read, and 10 §10.2 forbids this package from making one,
 * so the observation arrives as an injected callback. Running it per read would issue a chain
 * round trip for every history query; running it once at boot — and again as the ingest loop
 * advances into new territory — is what §6.3's *per range* granularity is for.
 *
 * ## `undefined` means "cannot say", and a range that cannot be checked is **kept**
 *
 * This asymmetry is the whole safety argument and it is easy to get backwards. An unreachable
 * chain, a block outside smoldot's pinned window, and a light client still syncing all produce
 * *cannot say* — and dropping on *cannot say* would empty the entire index every time the
 * network is poor, converting ordinary offline use into a corruption response. Only a
 * **disagreement** invalidates.
 */

import {
  verifyRanges,
  type CoverageRange,
  type CoverageRef,
  type CoverageVerification,
  type DroppedRange,
  type RangeEdgeFacts,
} from './coverage.js';
import {
  pendingDecoderCount,
  readChartDiscard,
  readCoverageRepair,
  readPendingRawEvicted,
  writeCoverage,
  type ChartDiscardRecord,
  type LocalIndex,
  type PendingRawEvictionRecord,
} from './store.js';

/**
 * What the boot check found, in the shape a surface can render.
 *
 * Every field is a *count of things the user lost*, and all three are returned rather than
 * logged. An index that silently shrank is one the user re-backfills without knowing why the
 * fan is running, and §6.5's *"N events pending decoder"* is a surface obligation rather than a
 * diagnostic.
 */
export interface IndexBootReport {
  readonly coverage: CoverageRef;
  /** Rows that did not survive `sanitizeCoverage` — malformed, or from another chain. */
  readonly dropped: readonly DroppedRange[];
  /** Ranges the chain disagreed with, each carrying the reason it was dropped. */
  readonly invalidated: CoverageVerification['invalidated'];
  /** Ranges nothing could check right now. Kept — see the module note. */
  readonly unchecked: readonly CoverageRange[];
  /** §6.5's raw rows awaiting an era's metadata (FE-P5). */
  readonly pendingDecoder: number;
  /**
   * What §9.1's bound on §6.5's raw blobs has discarded, or `undefined`.
   *
   * The record was written precisely so the disposal is visible and this report omitted it, which
   * left the label with a producer and no reader — the same shape as a checker with no call site.
   */
  readonly pendingRawEvicted: PendingRawEvictionRecord | undefined;
  /**
   * Chart rows a schema migration dropped, or `undefined`.
   *
   * The loss is permitted (INV-FE-7, §9.2's degradable tier) and performing it silently is not:
   * `meta.coverage` carries through the upgrade, so without this the tables state *"complete
   * within [ranges]"* over an empty tier — the silent splice INV-FE-15 and §9.2 both forbid, and
   * the boot path is where the client gets to say so. The fixed user-facing copy belongs to
   * `FE-IDX-002` and is not invented here (SQ-604).
   */
  readonly chartDiscard: ChartDiscardRecord | undefined;
}

/**
 * Verify the stored coverage against the chain and persist whatever survived.
 *
 * `observe` returns what the chain says about a range's edge block, or `undefined` for *cannot
 * say*. It is a callback rather than a reader because this package may not open a chain
 * connection (10 §10.2, rule 13) — and because making it injected is what lets the suite
 * exercise the three disagreements a healthy chain never produces.
 *
 * The write-back is the point: without it the check reports a problem and the corrupt range is
 * still there on the next load, so the same warning appears forever and nothing improves.
 */
export async function checkIndexAtBoot(
  db: LocalIndex,
  observe: (range: CoverageRange) => RangeEdgeFacts | undefined,
): Promise<IndexBootReport> {
  const { coverage, dropped } = await readCoverageRepair(db);
  const verified = verifyRanges(coverage, observe);
  // Only written when something changed. A boot that found nothing wrong must not rewrite the
  // `meta` row: the write is harmless in isolation and is a needless chance for a partial write
  // on the one structure whose corruption this function exists to survive.
  if (verified.invalidated.length > 0 || dropped.length > 0) {
    await writeCoverage(db, verified.coverage);
  }
  return {
    coverage: verified.coverage,
    dropped,
    invalidated: verified.invalidated,
    unchecked: verified.unchecked,
    pendingDecoder: await pendingDecoderCount(db),
    pendingRawEvicted: await readPendingRawEvicted(db),
    chartDiscard: await readChartDiscard(db),
  };
}
