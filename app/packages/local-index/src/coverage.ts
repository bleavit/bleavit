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

declare const SELF_INGESTED: unique symbol;

/**
 * Proof that a range came from the local light client.
 *
 * A string union is not authority. With `origin` as a plain field, any caller could write
 * `{ origin: 'self' }` around an operator payload and `isVerifiedAt` would agree — the
 * relabelled range would then be indistinguishable from one smoldot actually served, which
 * is the silent promotion this module's whole no-splice rule exists to prevent, arriving
 * through the front door instead.
 *
 * So `self` carries a brand only `selfRange()` can mint. That stops the *object literal* —
 * `{ origin: 'self', … }` no longer typechecks anywhere.
 *
 * ## What the brand does not do, stated precisely because an earlier note overclaimed
 *
 * The brand is not a capability. `selfRange` takes three plain numbers, so any caller who
 * can *reach* it can mint a verified range out of provider-derived heights — the review
 * finding this paragraph replaces. A private symbol is not a boundary when its minting
 * function is public.
 *
 * Two things now carry the property instead, and neither is a comment:
 *
 * 1. **`selfRange` is not exported from the package barrel.** It is reachable only through
 *    `@bleavit/local-index/testing`, which the `no-range-minting-outside-ingest`
 *    dependency-cruiser rule forbids production code from importing — the same shape
 *    `@bleavit/signing/testing` already uses for the test-only signer. So `providers`, the
 *    package that actually does backfill, cannot construct a `self` range at all.
 * 2. **The one production caller is the ingest loop**, which holds light-client output by
 *    construction.
 *
 * And the residual is real: the brand is a **compile-time** control, so a record rehydrated
 * from IndexedDB can still carry `origin: 'self'` and be believed. Nothing local can prove a
 * range came from a light client. What makes that tolerable is INV-FE-7 plus the firewall —
 * the transaction path never reads this package — not anything in this file.
 */
export interface SelfIngested {
  readonly [SELF_INGESTED]: true;
}

export type CoverageRange = {
  /** Inclusive, contiguous. */
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly ingestedAt: number;
} & (
  | ({ readonly origin: 'self'; readonly providerId?: undefined } & SelfIngested)
  | { readonly origin: Exclude<RangeOrigin, 'self'>; readonly providerId: string }
);

/**
 * Mint a light-client-ingested range. The only way to obtain `origin: 'self'`.
 *
 * **Deliberately absent from `index.ts`.** Its one production caller is the ingest loop in
 * this package; everything else reaches it through `@bleavit/local-index/testing`, which
 * production code is forbidden to import. Exporting it from the barrel let any consumer —
 * `providers` above all, which is the package that backfills from unverified sources —
 * turn three numbers into a range `isVerifiedAt` reports as light-client verified.
 *
 * The brand has no runtime representation, so this costs nothing and is checked entirely by
 * the compiler — like the `Finalized<T>` brand, whose companion cast gate exists because a
 * brand stops object literals and not assertions.
 */
export function selfRange(fromBlock: number, toBlock: number, ingestedAt: number): CoverageRange {
  return { fromBlock, toBlock, ingestedAt, origin: 'self' } as CoverageRange;
}

/** Mint a range from a non-verifying source. `providerId` is required by the type. */
export function providerRange(
  origin: Exclude<RangeOrigin, 'self'>,
  providerId: string,
  fromBlock: number,
  toBlock: number,
  ingestedAt: number,
): CoverageRange {
  return { fromBlock, toBlock, ingestedAt, origin, providerId };
}

/**
 * Where a block's **header** came from — the ingest loop's argument, and the single fact
 * that decides both a row's provenance and its coverage range's origin.
 *
 * A discriminated union rather than a bare `RangeOrigin`, because *"operator"* on its own
 * is not a describable state: `sameProvenance` distinguishes two operators — one lying
 * does not implicate the other — so a range that knows it came from *an* operator but not
 * *which* cannot be merged correctly, and a provider that later proves dishonest cannot be
 * invalidated without taking honest ranges with it.
 *
 * It was a bare `RangeOrigin`, and the loop minted a `selfRange` regardless of its value:
 * layer-2 backfill was recorded as light-client-verified while the *rows* correctly said
 * `provider`, so `isVerifiedAt` answered `true` for data 10 §2.2 says has no promotion
 * path at all. Making the provider id part of the type is what stops a future caller
 * re-creating that state — there is no longer an origin it can name without naming a
 * source too.
 */
export type HeaderSource =
  | { readonly origin: 'self' }
  | { readonly origin: Exclude<RangeOrigin, 'self'>; readonly providerId: string };

/**
 * The coverage range a block ingested behind `source` is claimed by.
 *
 * The loop calls this rather than choosing between `selfRange` and `providerRange`, so
 * "what origin does this range claim" has one answer derived from one argument. A caller
 * cannot reach `selfRange` with an operator header because it never names a constructor.
 */
export function rangeForSource(
  source: HeaderSource,
  fromBlock: number,
  toBlock: number,
  ingestedAt: number,
): CoverageRange {
  return source.origin === 'self'
    ? selfRange(fromBlock, toBlock, ingestedAt)
    : providerRange(source.origin, source.providerId, fromBlock, toBlock, ingestedAt);
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

/**
 * A block height, bounded by the chain's own type rather than by JavaScript's.
 *
 * `Number.isInteger(2 ** 53)` is `true` and `2 ** 53 + 1 === 2 ** 53`, so an unchecked
 * "integer" past that point makes arithmetic silently wrong: two ranges one apart at 2^53
 * compare as adjacent and join, and the joined range claims a block nobody ingested.
 * `BlockNumber` is a `u32` in this runtime, which is both the correct bound and well
 * inside the safe range, so the whole class disappears rather than being reasoned about.
 */
const MAX_BLOCK = 2 ** 32 - 1;

function assertBlock(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BLOCK) {
    throw new CoverageError(`${what} must be a u32 block height, got ${value}`);
  }
}

const ORIGINS: readonly RangeOrigin[] = ['self', 'operator', 'snapshot', 'indexer'];

function assertWellFormed(range: CoverageRange): void {
  if (range === null || typeof range !== 'object') {
    throw new CoverageError('a coverage range must be an object');
  }
  assertBlock(range.fromBlock, 'fromBlock');
  assertBlock(range.toBlock, 'toBlock');
  if (range.toBlock < range.fromBlock) {
    throw new CoverageError(`range ${range.fromBlock}..${range.toBlock} runs backwards`);
  }
  if (!Number.isFinite(range.ingestedAt) || range.ingestedAt < 0) {
    throw new CoverageError(`ingestedAt must be a non-negative number, got ${range.ingestedAt}`);
  }
  if (!(ORIGINS as readonly string[]).includes((range as { origin: string }).origin)) {
    // An unknown origin is not merely unrecognised: `isVerifiedAt` asks whether the origin
    // is `self`, so anything else reads as "provider data" and is quietly retained under a
    // label no part of 10 §6.2 defines.
    throw new CoverageError(`unknown range origin: ${String((range as { origin: string }).origin)}`);
  }
  // The discriminated union already makes both of these unconstructible in TypeScript —
  // narrowing proves the second branch `never`, which is the compiler confirming the type
  // does its job. The runtime check is kept anyway and reads through a widened view,
  // because the callers that matter here are **untyped**: the suites are JavaScript, and
  // so is anything that hands this package a decoded record from storage. A type that
  // cannot be violated in TS is still violated by JSON.
  const loose = range as { origin: string; providerId?: unknown };
  if (loose.origin !== 'self' && (typeof loose.providerId !== 'string' || loose.providerId === '')) {
    throw new CoverageError(`a ${loose.origin} range must name its providerId`);
  }
  if (loose.origin === 'self' && loose.providerId !== undefined) {
    throw new CoverageError('a self range is light-client-ingested and has no provider');
  }
}

/** Two ranges may join only if nothing about their provenance differs. */
function sameProvenance(a: CoverageRange, b: CoverageRange): boolean {
  return a.origin === b.origin && a.providerId === b.providerId;
}

/** Whether two ranges touch or overlap — the condition under which a join is possible. */
function adjacentOrOverlapping(a: CoverageRange, b: CoverageRange): boolean {
  return a.toBlock >= b.fromBlock - 1 && b.toBlock >= a.fromBlock - 1;
}

/**
 * The invariant `addRange` maintains, checked on the way *in* as well as out.
 *
 * `addRange` joins the incoming range against what is already there, and its output is
 * canonical: no two same-provenance ranges touch. It never verified that its **input** was,
 * and a `Coverage` is an ordinary object a caller can build by hand — from a JSON blob out
 * of IndexedDB, most obviously, which is exactly the untrusted path INV-FE-7 assumes gets
 * corrupted. Two same-provenance ranges that already overlap survive every subsequent add,
 * because the loop only ever compares each existing range against the incoming one and
 * never against each other. `holesIn` still computes the right union over them, so nothing
 * *looks* wrong — the set simply stops being the one this module's rules are stated over,
 * and `invalidateRange` on either half then leaves the other still covering the blocks the
 * drop was supposed to remove.
 *
 * Different provenances may of course overlap: keeping those apart is the whole point of
 * §6.3's no-splice rule, so the check is deliberately not "no two ranges overlap".
 */
function assertCanonical(coverage: Coverage): void {
  if (coverage === null || typeof coverage !== 'object' || !Array.isArray(coverage.ranges)) {
    throw new CoverageError('coverage must carry a ranges array');
  }
  coverage.ranges.forEach(assertWellFormed);

  // Sorted by provenance then position, so only neighbours can conflict. The pairwise form
  // this replaces was O(n^2) on every add, and the range list has no bound — a rehydrated
  // index of ten thousand alternating one-block ranges is perfectly canonical and cost
  // fifty million comparisons to say so.
  const ordered = [...coverage.ranges].sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      (a.providerId ?? '').localeCompare(b.providerId ?? '') ||
      a.fromBlock - b.fromBlock ||
      a.toBlock - b.toBlock,
  );
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
    if (sameProvenance(previous, current) && adjacentOrOverlapping(previous, current)) {
      throw new CoverageError(
        `coverage is not canonical: ${previous.origin} ranges ` +
          `${previous.fromBlock}..${previous.toBlock} and ${current.fromBlock}..${current.toBlock} ` +
          'should already have been joined',
      );
    }
  }

  // `holes` is part of the value, so it is part of the invariant. Without this a caller
  // could hand in a coverage whose holes were computed over an explicit *span* — the
  // `holesIn(ranges, span)` form — and every mutation below would silently recompute them
  // without one, dropping the edge holes and turning a bounded query into an unbounded
  // claim. Refusing the mixed object is the honest resolution: `Coverage.holes` means
  // interior holes and nothing else, and a span query calls `holesIn` directly.
  if (!Array.isArray(coverage.holes)) {
    throw new CoverageError('coverage must carry a holes array');
  }
  const expected = holesIn(coverage.ranges);
  const same =
    expected.length === coverage.holes.length &&
    expected.every(
      (hole, index) =>
        hole.fromBlock === coverage.holes[index]?.fromBlock &&
        hole.toBlock === coverage.holes[index]?.toBlock,
    );
  if (!same) {
    throw new CoverageError(
      'coverage.holes does not describe coverage.ranges; holes are derived, never supplied ' +
        '(for a bounded question use holesIn(ranges, span), which is not storable here)',
    );
  }
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
  assertCanonical(coverage);
  const joined: CoverageRange[] = [];
  let current = incoming;
  for (const existing of coverage.ranges) {
    if (sameProvenance(existing, current) && adjacentOrOverlapping(existing, current)) {
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
  // An inverted or non-integer span is refused rather than answered. The arithmetic below
  // returns `[]` for `toBlock < fromBlock` — every cursor comparison fails immediately —
  // and `[]` from this function means *no holes*, which a caller reads as complete
  // coverage. A transposed pair of arguments would therefore report a fully-covered index
  // over a range nothing has ingested, in the one module whose purpose is to make missing
  // data visible.
  if (span !== undefined) {
    assertBlock(span.fromBlock, 'span.fromBlock');
    assertBlock(span.toBlock, 'span.toBlock');
    if (span.toBlock < span.fromBlock) {
      throw new CoverageError(`span ${span.fromBlock}..${span.toBlock} runs backwards`);
    }
  }
  // The ranges too, and for the same reason as the span: an inverted range covers nothing,
  // and the cursor arithmetic below simply steps over it — so the answer is `[]`, which
  // means *complete coverage*. Validating only the span left the failure one argument away.
  ranges.forEach(assertWellFormed);
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
  assertCanonical(coverage);
  assertWellFormed(target);
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
