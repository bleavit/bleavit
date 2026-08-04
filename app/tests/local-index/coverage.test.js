/**
 * Gap-tolerant coverage — 10 §6.3 (F8, INV-FE-7).
 *
 * The property under test is a *refusal*: adjacent ranges of different provenance must
 * NOT merge. That is counter-intuitive for an index — the natural implementation extends
 * a cursor and joins whatever touches — and getting it wrong is invisible in every happy
 * path, because the merged range looks like a better-covered history.
 *
 * What it actually produces is a silent promotion. A `self` range came through the light
 * client; an `operator` range came from an unverified endpoint (10 §6.2). Merged, the
 * result must claim one origin, and claiming `self` tells the user that provider blocks
 * were verified — which §2.2 says has no promotion path at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CoverageError,
  EMPTY_COVERAGE,
  addRange,
  holesIn,
  invalidateRange,
  isVerifiedAt,
} from '@bleavit/local-index';

const self = (fromBlock, toBlock, ingestedAt = 1) => ({ fromBlock, toBlock, origin: 'self', ingestedAt });
const op = (fromBlock, toBlock, providerId = 'op-1', ingestedAt = 1) => ({
  fromBlock, toBlock, origin: 'operator', providerId, ingestedAt,
});

test('same-provenance adjacent ranges join', () => {
  const c = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), self(11, 20));
  assert.equal(c.ranges.length, 1);
  assert.deepEqual([c.ranges[0].fromBlock, c.ranges[0].toBlock], [1, 20]);
  assert.deepEqual(c.holes, []);
});

test('same-provenance overlapping ranges join', () => {
  const c = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), self(5, 20));
  assert.equal(c.ranges.length, 1);
  assert.deepEqual([c.ranges[0].fromBlock, c.ranges[0].toBlock], [1, 20]);
});

test('ADJACENT ranges of different origin are NOT merged (10 §6.3)', () => {
  // The refusal. A merge here would have to claim one origin for blocks that came from
  // two places, and claiming `self` is a silent promotion of provider data.
  const c = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), op(11, 20));
  assert.equal(c.ranges.length, 2, 'a provenance boundary was spliced away');
  assert.deepEqual(c.ranges.map((r) => r.origin), ['self', 'operator']);
  // ...and the boundary is exactly where it should be — a rendered fact, not an artefact.
  assert.deepEqual([c.ranges[0].toBlock, c.ranges[1].fromBlock], [10, 11]);
});

test('ranges from different providers are not merged either', () => {
  // Same origin is not the same provenance: two operators are two sources, and one
  // lying does not implicate the other. Merging them would make that undiagnosable.
  const c = addRange(addRange(EMPTY_COVERAGE, op(1, 10, 'op-1')), op(11, 20, 'op-2'));
  assert.equal(c.ranges.length, 2);
  assert.deepEqual(c.ranges.map((r) => r.providerId), ['op-1', 'op-2']);
});

test('overlap across provenances keeps both ranges', () => {
  // Those blocks genuinely were ingested twice, once verified and once not. A reader
  // asking "is block 7 verified?" must find the `self` range that says so.
  const c = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), op(5, 15));
  assert.equal(c.ranges.length, 2);
  assert.equal(isVerifiedAt(c, 7), true);
  assert.equal(isVerifiedAt(c, 12), false, 'a provider-only block reported as verified');
});

test('a gap becomes a first-class hole, never interpolated away', () => {
  const c = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), self(21, 30));
  assert.equal(c.ranges.length, 2, 'a real gap was joined into one range');
  assert.deepEqual(c.holes, [{ fromBlock: 11, toBlock: 20 }]);
});

test('the 2-hour gap 10 §6.3 says cannot be closed stays open', () => {
  // The withdrawn "local-index catch-up; history continuous" promise: 1,200 blocks is
  // far past smoldot's pinned window, so it cannot be closed with verified data. Code
  // that quietly closed it would be re-implementing a promise the spec withdrew.
  const c = addRange(addRange(EMPTY_COVERAGE, self(1, 1000)), self(2201, 3000));
  assert.deepEqual(c.holes, [{ fromBlock: 1001, toBlock: 2200 }]);
  assert.equal(c.holes[0].toBlock - c.holes[0].fromBlock + 1, 1200);
});

test('a hole is fillable by a provider without becoming verified', () => {
  let c = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), self(21, 30));
  c = addRange(c, op(11, 20));
  assert.deepEqual(c.holes, [], 'the hole was not filled');
  assert.equal(c.ranges.length, 3, 'the filled span lost its separate provenance');
  assert.equal(isVerifiedAt(c, 15), false, 'provider-filled blocks reported as verified');
  assert.equal(isVerifiedAt(c, 5), true);
});

test('holesIn reports a span with no coverage at all', () => {
  assert.deepEqual(holesIn([], { fromBlock: 1, toBlock: 100 }), [{ fromBlock: 1, toBlock: 100 }]);
  assert.deepEqual(holesIn([]), []);
});

test('holesIn respects an explicit span wider than the ranges', () => {
  const holes = holesIn([self(10, 20)], { fromBlock: 1, toBlock: 30 });
  assert.deepEqual(holes, [{ fromBlock: 1, toBlock: 9 }, { fromBlock: 21, toBlock: 30 }]);
});

test('an unattributable range is refused', () => {
  // A non-`self` range with no provider is exactly the one a later reader would be
  // tempted to treat as verified.
  assert.throws(() => addRange(EMPTY_COVERAGE, { fromBlock: 1, toBlock: 2, origin: 'operator', ingestedAt: 1 }), CoverageError);
  assert.throws(() => addRange(EMPTY_COVERAGE, { ...self(1, 2), providerId: 'x' }), CoverageError);
});

test('a backwards or non-integer range is refused', () => {
  assert.throws(() => addRange(EMPTY_COVERAGE, self(10, 1)), CoverageError);
  assert.throws(() => addRange(EMPTY_COVERAGE, self(1.5, 10)), CoverageError);
});

test('invalidating one range leaves the rest of the index intact', () => {
  // "Corruption of one range invalidates that range, not the index." Rebuilding
  // everything would turn a local fault into a full resync the user pays for.
  const bad = self(21, 30);
  let c = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), bad);
  c = invalidateRange(c, bad);
  assert.equal(c.ranges.length, 1);
  assert.deepEqual([c.ranges[0].fromBlock, c.ranges[0].toBlock], [1, 10]);
  assert.equal(isVerifiedAt(c, 5), true, 'the surviving range was dropped too');
  assert.equal(isVerifiedAt(c, 25), false);
});

test('invalidation recomputes holes rather than leaving stale ones', () => {
  // Provenances differ, so the three stay three ranges and the middle one is separately
  // invalidatable. The hole it leaves must appear — a stale empty `holes` would render
  // as continuous history over blocks the index no longer has.
  const middle = op(11, 20, 'op-1');
  let c = addRange(addRange(addRange(EMPTY_COVERAGE, self(1, 10)), middle), op(21, 30, 'op-2'));
  assert.equal(c.ranges.length, 3);
  assert.deepEqual(c.holes, []);
  c = invalidateRange(c, middle);
  assert.deepEqual(c.holes, [{ fromBlock: 11, toBlock: 20 }]);
  assert.equal(isVerifiedAt(c, 5), true, 'an unrelated range was dropped');
});

test('merging same-provenance ranges makes invalidation coarser, and that is the rule', () => {
  // A consequence worth pinning rather than discovering later. 10 §6.3 permits joining
  // same-provenance ranges and makes integrity checks apply *per range* — so once
  // 1..10 and 11..20 have joined, the range IS 1..20 and corruption anywhere in it
  // invalidates the whole span. There is no sub-range surgery, and a caller must not
  // expect invalidating a span it once added to leave the rest of that span behind.
  const first = self(1, 10);
  let c = addRange(addRange(EMPTY_COVERAGE, first), self(11, 20));
  assert.equal(c.ranges.length, 1, 'precondition: same provenance joined');

  // Naming the original sub-range no longer matches anything: it is not a range now.
  const untouched = invalidateRange(c, first);
  assert.equal(untouched.ranges.length, 1, 'a stale sub-range reference removed something');

  // The stored range is the unit, and dropping it drops the whole span.
  c = invalidateRange(c, c.ranges[0]);
  assert.deepEqual(c.ranges, []);
  assert.equal(isVerifiedAt(c, 5), false);
});

test('joining keeps the older ingest time', () => {
  // The joined range has been held since the earlier ingest; taking the newer time
  // would make a long-held range look freshly fetched to any staleness policy.
  const c = addRange(addRange(EMPTY_COVERAGE, self(1, 10, 100)), self(11, 20, 500));
  assert.equal(c.ranges[0].ingestedAt, 100);
});

test('an inverted span is refused, not answered with "no holes"', () => {
  // The arithmetic returns `[]` for a backwards span, and `[]` from `holesIn` means *no
  // holes* — complete coverage. So a transposed pair of arguments reported a fully
  // covered index over blocks nothing had ingested, in the one module whose purpose is
  // to make missing data visible.
  const ranges = [self(1, 10)];
  assert.throws(() => holesIn(ranges, { fromBlock: 100, toBlock: 50 }), CoverageError);
  assert.throws(() => holesIn(ranges, { fromBlock: 1.5, toBlock: 50 }), CoverageError);
  // The same call the right way round still answers, so the guard is not just refusing.
  assert.deepEqual(holesIn(ranges, { fromBlock: 50, toBlock: 100 }), [
    { fromBlock: 50, toBlock: 100 },
  ]);
});

test('a single-block span is legal, and is not an inverted one', () => {
  assert.deepEqual(holesIn([self(1, 10)], { fromBlock: 20, toBlock: 20 }), [
    { fromBlock: 20, toBlock: 20 },
  ]);
});

test('non-canonical coverage is refused rather than silently carried forward', () => {
  // `addRange` compares each existing range against the *incoming* one and never against
  // the others, so two same-provenance ranges that already overlap survive every add
  // that follows. A `Coverage` is an ordinary object — most obviously one rehydrated from
  // IndexedDB, the storage INV-FE-7 assumes gets corrupted — so its shape is checked on
  // the way in, not assumed from having been produced correctly once.
  const overlapping = { ranges: [self(1, 10), self(5, 20)], holes: [] };
  assert.throws(() => addRange(overlapping, self(100, 110)), CoverageError);

  const touching = { ranges: [self(1, 10), self(11, 20)], holes: [] };
  assert.throws(() => addRange(touching, self(100, 110)), CoverageError);

  const malformed = { ranges: [{ fromBlock: 10, toBlock: 1, origin: 'self', ingestedAt: 1 }], holes: [] };
  assert.throws(() => addRange(malformed, self(100, 110)), CoverageError);
});

test('differing provenances may overlap, and that is not "non-canonical"', () => {
  // The check must not be "no two ranges overlap": keeping a `self` and an `operator`
  // range over the same blocks apart is the whole point of the no-splice rule, and a
  // canonicity check that forbade it would delete the distinction it exists to protect.
  const both = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), op(5, 15));
  assert.equal(both.ranges.length, 2);
  assert.doesNotThrow(() => addRange(both, self(100, 110)));
});

test('what addRange produces is what addRange accepts', () => {
  // The invariant is closed under the API: every output is a legal input. Without that,
  // the check above would be an obstacle to ordinary use rather than a corruption guard.
  let c = EMPTY_COVERAGE;
  for (const r of [self(1, 10), op(5, 15), self(30, 40), self(11, 12), op(200, 210, 'op-2')]) {
    c = addRange(c, r);
    assert.doesNotThrow(() => addRange(c, self(9000, 9001)), 'output was not a legal input');
  }
});
