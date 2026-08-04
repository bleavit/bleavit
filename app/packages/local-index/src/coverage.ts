/**
 * Gap-tolerant coverage — 10 §6.3, INV-FE-7.
 *
 * The local index does not model history as a contiguous cursor. It models **coverage**,
 * and 10 §6.3 makes holes a first-class state rather than an error: "A hole is never
 * interpolated over, never elided."
 *
 * ## Why merging is the dangerous operation
 *
 * The obvious implementation of an index is "extend the cursor". Applied to ranges it
 * becomes "merge whatever is adjacent", and that is precisely what 10 §6.3 forbids:
 *
 * > **Never silently spliced**: adjacent ranges with different origins are never merged;
 * > an `origin ≠ self` range keeps its origin forever (there is no promotion, §2.2).
 * > A range boundary is a rendered fact.
 *
 * The reason is the same one that keeps `Finalized<T>` out of `shared-types`. A `self`
 * range was ingested through the light client; an `operator` range came from a
 * protocol-aligned but unverified endpoint (10 §6.2). Merging them produces one range
 * whose origin must be *some* single value — and whichever is chosen, half the blocks now
 * claim a provenance they do not have. Choosing `self` silently promotes provider data to
 * verified, which §2.2 says has no promotion path at all. Choosing `operator` demotes
 * verified data, which is merely wrong rather than dangerous. Neither is available, so
 * the merge does not happen and the boundary survives to be rendered.
 *
 * `mergeRange` therefore joins only ranges of the **same origin and same provider**, and
 * `holesIn` computes gaps rather than assuming their absence. A caller cannot obtain a
 * contiguous history it did not actually ingest.
 *
 * ## The withdrawn promise
 *
 * 10 §6.3 also records what this replaces: the old "local-index catch-up; history
 * continuous" line was impossible. A 2-hour gap is 1,200 blocks, far past smoldot's
 * pinned window, so it cannot be closed with verified data at all — it becomes a visible
 * hole, provider-fillable and labelled. Code that quietly closed such a gap would be
 * re-implementing the promise the specification withdrew.
 */

/** Where a range's blocks came from. `self` is the only light-client-verified origin. */
export type RangeOrigin = 'self' | 'operator' | 'snapshot' | 'indexer';

export interface CoverageRange {
  /** Inclusive, contiguous. */
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly origin: RangeOrigin;
  /** Required when `origin !== 'self'`; absent for `self`. */
  readonly providerId?: string;
  readonly ingestedAt: number;
}

export interface Hole {
  readonly fromBlock: number;
  readonly toBlock: number;
}

export interface Coverage {
  readonly ranges: readonly CoverageRange[];
  readonly holes: readonly Hole[];
}

/** A history answer is never data alone — 10 §6.3's "data *plus* the coverage it came from". */
export interface CoveredResult<T> {
  readonly data: T;
  readonly coverage: Coverage;
}

export class CoverageError extends Error {}

function assertWellFormed(range: CoverageRange): void {
  if (!Number.isInteger(range.fromBlock) || !Number.isInteger(range.toBlock)) {
    throw new CoverageError(`range bounds must be integers: ${range.fromBlock}..${range.toBlock}`);
  }
  if (range.toBlock < range.fromBlock) {
    throw new CoverageError(`range ${range.fromBlock}..${range.toBlock} runs backwards`);
  }
  // A non-`self` range without a provider is unattributable, and an unattributable
  // range is exactly the one a later reader would be tempted to treat as `self`.
  if (range.origin !== 'self' && range.providerId === undefined) {
    throw new CoverageError(`a ${range.origin} range must name its providerId`);
  }
  if (range.origin === 'self' && range.providerId !== undefined) {
    throw new CoverageError('a self range is light-client-ingested and has no provider');
  }
}

/** Two ranges may join only if nothing about their provenance differs. */
function sameProvenance(a: CoverageRange, b: CoverageRange): boolean {
  return a.origin === b.origin && a.providerId === b.providerId;
}

/**
 * Add a range to a coverage set.
 *
 * Same-provenance ranges that touch or overlap are joined. Ranges of differing provenance
 * are kept apart **even when adjacent** — that boundary is the rendered fact 10 §6.3
 * requires, and erasing it is the silent splice the section forbids.
 *
 * Overlap between *different* provenances is resolved in favour of neither: both ranges
 * are retained. The overlap is real — those blocks genuinely were ingested twice, once
 * verified and once not — and a reader asking "is block N verified?" must be able to
 * find the `self` range that says so without the `operator` range having consumed it.
 */
export function addRange(coverage: Coverage, incoming: CoverageRange): Coverage {
  assertWellFormed(incoming);
  const joined: CoverageRange[] = [];
  let current = incoming;
  for (const existing of coverage.ranges) {
    if (
      sameProvenance(existing, current) &&
      existing.toBlock >= current.fromBlock - 1 &&
      current.toBlock >= existing.fromBlock - 1
    ) {
      current = {
        ...current,
        fromBlock: Math.min(existing.fromBlock, current.fromBlock),
        toBlock: Math.max(existing.toBlock, current.toBlock),
        // The older ingest time is kept: the joined range has been held since then.
        ingestedAt: Math.min(existing.ingestedAt, current.ingestedAt),
      };
    } else {
      joined.push(existing);
    }
  }
  joined.push(current);
  joined.sort((a, b) => a.fromBlock - b.fromBlock || a.toBlock - b.toBlock);
  return { ranges: joined, holes: holesIn(joined) };
}

/**
 * The blocks no range covers, across the whole span.
 *
 * Computed over the union of *all* origins, because a hole is about whether data exists
 * at all — a block covered only by an `operator` range is not a hole, it is provider
 * data, and the provenance question is answered by the range, not by this function.
 */
export function holesIn(ranges: readonly CoverageRange[], span?: Hole): readonly Hole[] {
  if (ranges.length === 0) return span ? [{ ...span }] : [];
  const sorted = [...ranges].sort((a, b) => a.fromBlock - b.fromBlock);
  const holes: Hole[] = [];
  const start = span?.fromBlock ?? sorted[0]!.fromBlock;
  const end = span?.toBlock ?? sorted.reduce((m, r) => Math.max(m, r.toBlock), sorted[0]!.toBlock);

  let cursor = start;
  for (const range of sorted) {
    if (range.toBlock < cursor) continue;
    if (range.fromBlock > cursor) {
      holes.push({ fromBlock: cursor, toBlock: Math.min(range.fromBlock - 1, end) });
    }
    cursor = Math.max(cursor, range.toBlock + 1);
    if (cursor > end) break;
  }
  if (cursor <= end) holes.push({ fromBlock: cursor, toBlock: end });
  return holes.filter((h) => h.fromBlock <= h.toBlock);
}

export const EMPTY_COVERAGE: Coverage = Object.freeze({ ranges: [], holes: [] });

/**
 * Whether a block is covered by a light-client-verified range.
 *
 * Deliberately not `isCovered` with an origin argument: the question a caller almost
 * always means is "may I treat this as verified", and a general predicate makes the
 * `self` check one option among four rather than the one that matters.
 */
export function isVerifiedAt(coverage: Coverage, block: number): boolean {
  return coverage.ranges.some(
    (r) => r.origin === 'self' && block >= r.fromBlock && block <= r.toBlock,
  );
}

/**
 * Drop a range whose integrity check failed — 10 §6.3's per-range invalidation.
 *
 * "Corruption of one range invalidates that range, not the index." Rebuilding the whole
 * index on one bad edge would turn a recoverable local fault into a full resync, and
 * under INV-FE-7 (local storage is disposable) that is a performance event the user pays
 * for unnecessarily. The hole the drop creates is the honest result and is recomputed.
 */
export function invalidateRange(coverage: Coverage, target: CoverageRange): Coverage {
  const ranges = coverage.ranges.filter(
    (r) =>
      !(
        r.fromBlock === target.fromBlock &&
        r.toBlock === target.toBlock &&
        sameProvenance(r, target)
      ),
  );
  return { ranges, holes: holesIn(ranges) };
}
