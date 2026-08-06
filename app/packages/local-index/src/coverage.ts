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

import { coverageBoundarySet, type CoverageRange as CoverageShape } from '@bleavit/shared-types';

/**
 * Where a range's blocks came from. `self` is the only light-client-verified origin.
 *
 * Derived from `@bleavit/shared-types`' published shape rather than restated. That package is
 * the dependency-free root and is what `packages/ui` reads to render a `derived-local` badge, so
 * two spellings of this union would be two answers to *"is this line third-party data"* — with
 * the render layer holding the copy nobody re-derives.
 */
export type RangeOrigin = CoverageShape['origin'];

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

/**
 * The facts §6.3's per-range integrity checks are stated over.
 *
 * > Cursor integrity checks (hash-at-edge, genesis binding, spec-version-at-edge) apply per
 * > range; corruption of one range invalidates that range, not the index.
 *
 * That sentence had nothing to read. `CoverageRange` as §6.3 declared it two paragraphs
 * earlier carries a block span, an origin, a provider id and a timestamp — no hash, no
 * genesis, no spec version — so all three checks were unimplementable and `invalidateRange`
 * had no detector that could ever call it. The fields are added here and in §6.3 together
 * (PLAN.md · Decision log, SQ-603), because a check with no substrate is not a stricter
 * design than no check at all: it is the same design with a sentence in front of it.
 *
 * The edge is the range's **`toBlock`**, not its `fromBlock`. A range grows forward, so the
 * high end is the one a resumed ingest continues from and the one a reorg or a runtime
 * upgrade invalidates first.
 */
export interface RangeEdge {
  /**
   * §6.3's genesis binding. Redundant with the database name (§7) exactly until it is not:
   * a range that arrives by import, by structured clone from another tab, or by a migration
   * carries no database with it, and a range from another chain is well-formed in every
   * other respect.
   */
  readonly genesisHash: string;
  /** §6.3's hash-at-edge: the finalized block hash at `toBlock`. */
  readonly hash: string;
  /** §6.3's spec-version-at-edge: the runtime `spec_version` at `toBlock`. */
  readonly specVersion: number;
}

export type CoverageRange = {
  /** Inclusive, contiguous. */
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly ingestedAt: number;
  readonly edge: RangeEdge;
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
export function selfRange(
  fromBlock: number,
  toBlock: number,
  ingestedAt: number,
  edge: RangeEdge,
): CoverageRange {
  return { fromBlock, toBlock, ingestedAt, edge, origin: 'self' } as CoverageRange;
}

/** Mint a range from a non-verifying source. `providerId` is required by the type. */
export function providerRange(
  origin: Exclude<RangeOrigin, 'self'>,
  providerId: string,
  fromBlock: number,
  toBlock: number,
  ingestedAt: number,
  edge: RangeEdge,
): CoverageRange {
  return { fromBlock, toBlock, ingestedAt, edge, origin, providerId };
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
  edge: RangeEdge,
): CoverageRange {
  return source.origin === 'self'
    ? selfRange(fromBlock, toBlock, ingestedAt, edge)
    : providerRange(source.origin, source.providerId, fromBlock, toBlock, ingestedAt, edge);
}

export interface Hole {
  readonly fromBlock: number;
  readonly toBlock: number;
}

/**
 * §6.3's coverage value, under §6.3's own name.
 *
 * The section declares `CoverageRef { ranges: CoverageRange[]; holes: Array<[number, number]> }`
 * and `@bleavit/shared-types` names the same thing in `VerificationStatus`. This module shipped
 * it as `Coverage` with named-field holes, so one value had two names and two shapes across
 * three documents that all have to agree for a badge to render. The named-field form is kept —
 * a positional pair invites `[to, from]`, which is silent and which `holesIn` refuses precisely
 * because inverted spans read as complete coverage — and §6.3 is amended to publish it
 * (PLAN.md · Decision log). One name, one shape.
 */
export interface CoverageRef {
  readonly ranges: readonly CoverageRange[];
  readonly holes: readonly Hole[];
}

/**
 * A history answer is never data alone — 10 §6.3's "data *plus* the coverage it came from".
 *
 * Deliberately **not** `{ data, coverage: CoverageRef }`. `assertCanonical` refuses a
 * `CoverageRef` whose `holes` were computed over an explicit span, because those holes are not
 * derivable from the ranges and every later mutation would silently recompute them without the
 * span — dropping the edge holes and turning a bounded question into an unbounded claim. A
 * query's answer is exactly that bounded question, so it carries its span and its span-bounded
 * holes as separate fields rather than as a value that must never be stored.
 */
export interface CoveredResult<T> {
  readonly data: T;
  /** The span asked about, so a caller cannot lose which question these holes answer. */
  readonly span: Hole;
  /** The ranges overlapping `span`, each keeping its own origin — §6.3's rendered boundary. */
  readonly ranges: readonly CoverageRange[];
  /** `holesIn(ranges, span)`: the blocks inside `span` no range covers. */
  readonly holes: readonly Hole[];
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
  assertEdge(range);
}

/** `0x` + 32 bytes — the rendering every hash in this repository is carried in. */
const HASH_32 = /^0x[0-9a-f]{64}$/;

/**
 * The edge fields §6.3's three integrity checks read.
 *
 * Validated at the same boundary as everything else, and for the same reason: the callers
 * that matter are untyped. A range rehydrated from IndexedDB with `edge: undefined` would
 * otherwise reach `verifyRange`, where every comparison against `undefined` is `false` — so
 * a range with no edge at all would report as *corrupt* rather than as *unverifiable*, and
 * the client would drop honest ranges on a schema slip.
 */
function assertEdge(range: CoverageRange): void {
  const edge = (range as { edge?: unknown }).edge;
  if (edge === null || typeof edge !== 'object') {
    throw new CoverageError(
      `range ${range.fromBlock}..${range.toBlock} carries no edge; 10 §6.3's hash-at-edge, ` +
        'genesis-binding and spec-version-at-edge checks would have nothing to read',
    );
  }
  const { genesisHash, hash, specVersion } = edge as {
    genesisHash?: unknown;
    hash?: unknown;
    specVersion?: unknown;
  };
  if (typeof genesisHash !== 'string' || !HASH_32.test(genesisHash)) {
    throw new CoverageError(`range ${range.fromBlock}..${range.toBlock} names no genesis hash`);
  }
  if (typeof hash !== 'string' || !HASH_32.test(hash)) {
    throw new CoverageError(
      `range ${range.fromBlock}..${range.toBlock} names no block hash at its edge`,
    );
  }
  if (!Number.isInteger(specVersion) || (specVersion as number) < 0) {
    throw new CoverageError(
      `range ${range.fromBlock}..${range.toBlock} names no spec version at its edge`,
    );
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
function assertCanonical(coverage: CoverageRef): void {
  if (coverage === null || typeof coverage !== 'object' || !Array.isArray(coverage.ranges)) {
    throw new CoverageError('coverage must carry a ranges array');
  }
  coverage.ranges.forEach(assertWellFormed);

  // One coverage set describes one chain. §7 already makes that true of the *database*, and
  // this makes it true of the value — a set holding two genesis hashes is the cross-chain
  // contamination §7's naming exists to prevent, arriving through an import or a structured
  // clone rather than through a shared database.
  const genesis = coverage.ranges[0]?.edge.genesisHash;
  const foreign = coverage.ranges.find((r) => r.edge.genesisHash !== genesis);
  if (foreign !== undefined) {
    throw new CoverageError(
      `coverage spans two chains: ${String(genesis)} and ${foreign.edge.genesisHash}. One index ` +
        'describes one chain, and rows from two chains are indistinguishable once merged.',
    );
  }

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
export function addRange(coverage: CoverageRef, incoming: CoverageRange): CoverageRef {
  assertWellFormed(incoming);
  assertCanonical(coverage);
  // §6.3's genesis binding, checked **here** rather than only on the way back in. Every other
  // entry point refuses a two-chain set (`assertCanonical`), and `addRange` was the one that
  // could create one: a foreign incoming range joined nothing, was appended, and the *next*
  // mutation threw `coverage spans two chains` — so the index became unusable at a call site
  // that had done nothing wrong, and the caller that could still have acted was long gone.
  const chain = coverage.ranges[0]?.edge.genesisHash;
  if (chain !== undefined && incoming.edge.genesisHash !== chain) {
    throw new CoverageError(
      `range ${incoming.fromBlock}..${incoming.toBlock} is bound to genesis ` +
        `${incoming.edge.genesisHash}, but this coverage describes ${chain}. One index describes ` +
        'one chain, and rows from two chains are indistinguishable once merged.',
    );
  }
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
        // The edge belongs to the **higher** `toBlock`, because that is the block the joined
        // range now ends at. Keeping the incoming range's edge unconditionally would leave a
        // hash and a spec version describing a block inside the range rather than its edge,
        // and `verifyRange` would then compare the chain's answer at `toBlock` against facts
        // about a different block — reporting every joined range as corrupt.
        edge: existing.toBlock > current.toBlock ? existing.edge : current.edge,
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

export const EMPTY_COVERAGE: CoverageRef = Object.freeze({ ranges: [], holes: [] });

/**
 * Whether a block is covered by a light-client-verified range.
 *
 * Deliberately not `isCovered` with an origin argument: the question a caller almost
 * always means is "may I treat this as verified", and a general predicate makes the
 * `self` check one option among four rather than the one that matters.
 */
export function isVerifiedAt(coverage: CoverageRef, block: number): boolean {
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
export function invalidateRange(coverage: CoverageRef, target: CoverageRange): CoverageRef {
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

/** What a range was dropped for, kept so the drop can be explained rather than only counted. */
export interface DroppedRange {
  readonly value: unknown;
  readonly reason: string;
}

export interface CoverageRepair {
  readonly coverage: CoverageRef;
  readonly dropped: readonly DroppedRange[];
}

/**
 * Rebuild a coverage value from untrusted input, **dropping** what fails rather than throwing.
 *
 * This is the other half of `assertCanonical`, and the half that was missing. The mutation
 * path validated; the *read* path did not, and §6.3 says corruption of one range invalidates
 * **that range, not the index**. Throwing on rehydration is the whole-index answer to a
 * one-range fault — a full resync the user pays for, from the one function whose comment
 * already called IndexedDB *"exactly the untrusted path INV-FE-7 assumes gets corrupted"*.
 *
 * Three properties, in the order they matter:
 *
 * 1. **A malformed range is dropped, and its blocks become a hole.** That is the honest
 *    result: nothing local can vouch for a record that does not describe a range.
 * 2. **A well-formed but non-canonical set is repaired, not dropped.** Two same-provenance
 *    ranges that overlap are a canonicity fault rather than a corrupt record, and re-folding
 *    them through `addRange` yields the joined range they should already have been. Dropping
 *    both would delete data that is present and correct.
 * 3. **Anything that is not a coverage value at all yields empty coverage**, never
 *    `undefined`. A renderer that receives `undefined` treats it as full coverage, which is
 *    the one reading this module exists to make impossible.
 */
export function sanitizeCoverage(value: unknown): CoverageRepair {
  const dropped: DroppedRange[] = [];
  if (value === null || typeof value !== 'object' || !Array.isArray((value as CoverageRef).ranges)) {
    if (value !== undefined) {
      dropped.push({ value, reason: 'the stored value does not carry a ranges array' });
    }
    return { coverage: EMPTY_COVERAGE, dropped };
  }

  const wellFormed: CoverageRange[] = [];
  for (const candidate of (value as CoverageRef).ranges as readonly unknown[]) {
    try {
      assertWellFormed(candidate as CoverageRange);
      wellFormed.push(candidate as CoverageRange);
    } catch (error) {
      dropped.push({
        value: candidate,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // A set spanning two chains is not repairable by merging: neither chain's ranges are the
  // corrupt ones, and picking a winner would keep rows from a chain the user is not on. The
  // majority genesis is kept and the rest dropped, which is the same per-range disposal the
  // section mandates rather than a whole-index rebuild.
  const byGenesis = new Map<string, CoverageRange[]>();
  for (const range of wellFormed) {
    const bucket = byGenesis.get(range.edge.genesisHash) ?? [];
    byGenesis.set(range.edge.genesisHash, bucket);
    bucket.push(range);
  }
  let kept: readonly CoverageRange[] = [];
  for (const [, bucket] of byGenesis) if (bucket.length > kept.length) kept = bucket;
  for (const range of wellFormed) {
    if (!kept.includes(range)) {
      dropped.push({
        value: range,
        reason: `range ${range.fromBlock}..${range.toBlock} names genesis ${range.edge.genesisHash}, ` +
          'which is not this index’s chain',
      });
    }
  }

  let coverage = EMPTY_COVERAGE;
  for (const range of kept) coverage = addRange(coverage, range);
  return { coverage, dropped };
}

/** What the chain says about a range's edge block, right now. */
export interface RangeEdgeFacts {
  readonly genesisHash: string;
  readonly hash: string;
  readonly specVersion: number;
}

export type RangeVerdict =
  | { readonly kind: 'ok' }
  /** The range disagrees with the chain and must be dropped (§6.3, per range). */
  | { readonly kind: 'invalid'; readonly reason: string }
  /** Not checkable right now. Deliberately distinct from `invalid` — see `verifyRanges`. */
  | { readonly kind: 'unchecked' };

/**
 * §6.3's three per-range integrity checks, in one place because they share a failure mode.
 *
 * > Cursor integrity checks (hash-at-edge, genesis binding, spec-version-at-edge) apply per
 * > range.
 *
 * Each answers a different corruption. **Genesis** catches a range from another chain, which
 * is well-formed in every other respect and whose ids collide with this chain's. **Hash at
 * edge** catches a reorg past the range's end and a partially-written record — the stored
 * edge names a block this chain does not have at that height. **Spec version at edge** catches
 * rows decoded with metadata the runtime has since replaced, which decode to plausible values
 * of the wrong shape rather than failing.
 */
export function verifyRange(range: CoverageRange, observed: RangeEdgeFacts): RangeVerdict {
  assertWellFormed(range);
  if (range.edge.genesisHash !== observed.genesisHash) {
    return {
      kind: 'invalid',
      reason:
        `range ${range.fromBlock}..${range.toBlock} is bound to genesis ${range.edge.genesisHash} ` +
        `but this client is on ${observed.genesisHash}`,
    };
  }
  if (range.edge.hash !== observed.hash) {
    return {
      kind: 'invalid',
      reason:
        `range ${range.fromBlock}..${range.toBlock} recorded block hash ${range.edge.hash} at its ` +
        `edge; the chain reports ${observed.hash} at block ${range.toBlock}`,
    };
  }
  if (range.edge.specVersion !== observed.specVersion) {
    return {
      kind: 'invalid',
      reason:
        `range ${range.fromBlock}..${range.toBlock} was ingested under spec_version ` +
        `${range.edge.specVersion}; block ${range.toBlock} ran ${observed.specVersion}, so its rows ` +
        'were decoded with the wrong metadata',
    };
  }
  return { kind: 'ok' };
}

export interface RangeCheck {
  readonly range: CoverageRange;
  readonly verdict: RangeVerdict;
}

export interface CoverageVerification {
  readonly coverage: CoverageRef;
  readonly invalidated: readonly RangeCheck[];
  readonly unchecked: readonly CoverageRange[];
}

/**
 * Apply `verifyRange` across a coverage set and drop what fails — §6.3's *"corruption of one
 * range invalidates that range, not the index"*, as a function the ingest loop and the boot
 * path can actually call.
 *
 * `observe` returning `undefined` means **not checkable now**, and such a range is **kept**.
 * That asymmetry is the whole safety argument: an unreachable chain, a block outside smoldot's
 * pinned window, or a light client still syncing all produce "cannot say", and dropping on
 * "cannot say" would empty the entire index every time the network is poor — a corruption
 * response triggered by ordinary offline use. Only a *disagreement* invalidates.
 */
export function verifyRanges(
  coverage: CoverageRef,
  observe: (range: CoverageRange) => RangeEdgeFacts | undefined,
): CoverageVerification {
  assertCanonical(coverage);
  const invalidated: RangeCheck[] = [];
  const unchecked: CoverageRange[] = [];
  // Drops go through `invalidateRange` rather than through a second `filter` written here.
  // Until this existed `invalidateRange` had **no caller at all** — §6.3's per-range
  // invalidation was an exported function nothing reached, which is the same defect class as
  // a declared-and-unemitted error code. Routing through it also means there is exactly one
  // definition of *what dropping a range does* (recompute the holes), rather than two that
  // agree today.
  let kept = coverage;
  for (const range of coverage.ranges) {
    const facts = observe(range);
    if (facts === undefined) {
      unchecked.push(range);
      continue;
    }
    const verdict = verifyRange(range, facts);
    if (verdict.kind === 'invalid') {
      invalidated.push({ range, verdict });
      kept = invalidateRange(kept, range);
    }
  }
  return { coverage: kept, invalidated, unchecked };
}

/**
 * §6.3's *"data **plus** the coverage it came from"*, as the type a history query returns.
 *
 * > Every history query returns data *plus* the coverage it came from; charts render holes as
 * > visible gaps with an explainer, tables state "complete within [ranges]".
 *
 * `CoveredResult<T>` was declared and **nothing produced one**, so every history read in this
 * package returned bare rows and the sentence above had no implementation. That is worse than
 * it sounds: rows with no coverage beside them render as a complete series, which is precisely
 * the silent splice §6.3 forbids — the caller has no way to know the answer is partial, and
 * "there were no trades in this hour" and "we never ingested this hour" arrive as the same
 * empty array.
 *
 * Two decisions worth stating because the obvious alternatives are wrong:
 *
 * 1. **The ranges are returned unclipped.** Clipping them to `span` would produce ranges whose
 *    `toBlock` is not the block their `edge` describes, so `verifyRange` would compare the
 *    chain's answer at one height against facts recorded about another and report every
 *    queried range as corrupt. The renderer intersects for display; the datum keeps its edge.
 * 2. **The holes are span-bounded.** `holesIn(ranges, span)` includes the edge holes — the
 *    blocks at either end of the question that no range reaches — which the unbounded form
 *    drops. Those are exactly the holes a caller asking about a window needs, and dropping
 *    them turns *"we hold the middle of what you asked for"* into *"we hold all of it"*.
 */
export function covered<T>(coverage: CoverageRef, span: Hole, data: T): CoveredResult<T> {
  assertCanonical(coverage);
  assertBlock(span.fromBlock, 'span.fromBlock');
  assertBlock(span.toBlock, 'span.toBlock');
  if (span.toBlock < span.fromBlock) {
    throw new CoverageError(`span ${span.fromBlock}..${span.toBlock} runs backwards`);
  }
  const ranges = coverage.ranges.filter(
    (range) => range.toBlock >= span.fromBlock && range.fromBlock <= span.toBlock,
  );
  return {
    data,
    span: { fromBlock: span.fromBlock, toBlock: span.toBlock },
    ranges,
    holes: holesIn(ranges, span),
  };
}

/**
 * The provenance boundaries inside a covered answer — §6.3's *"a range boundary is a rendered
 * fact"*, reduced to what a badge can say without laying out a table.
 *
 * Returned as a set of origins rather than a count, because a count is the one summary that
 * cannot carry the fact. *"3 sources"* reads as an abundance; `self + indexer` reads as *part
 * of this line is third-party data*, which is what 10 §2.3's mandatory labelling is for.
 */
export function boundarySet(ranges: readonly CoverageRange[]): readonly string[] {
  // Delegated to `shared-types` rather than reimplemented. `packages/ui` cannot import this
  // package (10 §10.1), so the badge must be able to compute the set from a `VerificationStatus`
  // alone — and a second implementation here would be one rule with two spellings, differing
  // first on the case nobody tested.
  return coverageBoundarySet({ ranges, holes: [] });
}
