/**
 * §6.3's per-range integrity checks and the covered-query surface — 10 §6.3 (F8).
 *
 * Two things the section mandated and nothing implemented:
 *
 * > Cursor integrity checks (hash-at-edge, genesis binding, spec-version-at-edge) apply per
 * > range; corruption of one range invalidates that range, not the index.
 *
 * > Every history query returns data *plus* the coverage it came from.
 *
 * The first had no substrate — `CoverageRange` as §6.3 declares it two paragraphs earlier
 * carries a span, an origin, a provider id and a timestamp, and none of the three checks can be
 * evaluated against any of them — and `invalidateRange` therefore had no caller. The second had
 * a declared type, `CoveredResult<T>`, and no producer, so every read returned bare rows.
 *
 * Both failures are the same shape and it is the one this package exists to prevent: an answer
 * that renders as complete because nothing beside it says otherwise.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import 'fake-indexeddb/auto';

import {
  EMPTY_COVERAGE,
  LocalIndex,
  addRange,
  boundarySet,
  checkIndexAtBoot,
  covered,
  coveredSamples,
  holesIn,
  isVerifiedAt,
  priceSample,
  providerRange,
  readCoverage,
  verifyRange,
  verifyRanges,
  writeCoverage,
} from '@bleavit/local-index';
import type { CoverageRange, RangeEdgeFacts } from '@bleavit/local-index';
import { selfRange } from '@bleavit/local-index/testing';
import { nth } from './nth.ts';

const GENESIS = `0x${'11'.repeat(32)}`;
const OTHER_CHAIN = `0x${'22'.repeat(32)}`;
const hashAt = (block: number): string => `0x${block.toString(16).padStart(64, '0')}`;
const edgeAt = (block: number, specVersion = 3, genesisHash = GENESIS) => ({
  genesisHash,
  hash: hashAt(block),
  specVersion,
});
const factsAt = (block: number, specVersion = 3, genesisHash = GENESIS): RangeEdgeFacts => ({
  genesisHash,
  hash: hashAt(block),
  specVersion,
});

/**
 * A range as an untyped caller supplies it — a record rehydrated from IndexedDB, or one an
 * older schema wrote. `as unknown as` is banned across `app/`, so this is one assertion through
 * one documented helper, and its only use is a refusal test.
 */
const asRange = (record: Record<string, unknown>): CoverageRange => record as CoverageRange;

const self = (from: number, to: number): CoverageRange => selfRange(from, to, 1, edgeAt(to));
const op = (from: number, to: number, providerId = 'op-1'): CoverageRange =>
  providerRange('operator', providerId, from, to, 1, edgeAt(to));

test('a range with no edge is refused — the three checks would have nothing to read', () => {
  // The fields are what makes §6.3's sentence executable. Without them `verifyRange` compares
  // three values against `undefined`, every comparison is `false`, and a range with no edge at
  // all reports as **corrupt** rather than as unverifiable — so the client drops honest ranges
  // on a schema slip.
  const noEdge = asRange({ fromBlock: 1, toBlock: 10, ingestedAt: 1, origin: 'self' });
  assert.throws(() => addRange(EMPTY_COVERAGE, noEdge), /carries no edge/);
});

test('each of §6.3’s three checks catches a different corruption', () => {
  const range = self(1, 100);
  assert.deepEqual(verifyRange(range, factsAt(100)), { kind: 'ok' });

  // Genesis binding: a range from another chain is well-formed in every other respect, and its
  // ids collide with this chain's because both number their proposals from one.
  const wrongChain = verifyRange(range, factsAt(100, 3, OTHER_CHAIN));
  assert.equal(wrongChain.kind, 'invalid');
  assert.match(wrongChain.kind === 'invalid' ? wrongChain.reason : '', /genesis/);

  // Hash at edge: a reorg past the range's end, or a partially written record.
  const reorged = verifyRange(range, { ...factsAt(100), hash: hashAt(999) });
  assert.equal(reorged.kind, 'invalid');
  assert.match(reorged.kind === 'invalid' ? reorged.reason : '', /block hash/);

  // Spec version at edge: rows decoded with metadata the runtime has since replaced decode to
  // plausible values of the wrong shape rather than failing.
  const upgraded = verifyRange(range, factsAt(100, 4));
  assert.equal(upgraded.kind, 'invalid');
  assert.match(upgraded.kind === 'invalid' ? upgraded.reason : '', /spec_version/);
});

test('the edge is the range’s toBlock, and a join carries the HIGHER edge forward', () => {
  // A range grows forward, so its high end is the block a resumed ingest continues from and the
  // one a reorg invalidates first. Keeping the incoming range's edge unconditionally would
  // leave a hash describing a block *inside* the joined range, and `verifyRange` would then
  // compare the chain's answer at `toBlock` against facts about a different block — reporting
  // every joined range as corrupt.
  const joined = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), self(11, 20));
  assert.equal(joined.ranges.length, 1);
  assert.equal(nth(joined.ranges, 0, 'range').edge.hash, hashAt(20));
  assert.deepEqual(verifyRange(nth(joined.ranges, 0, 'range'), factsAt(20)), { kind: 'ok' });

  // ...and the same when the ranges arrive newest-first, which §6.4's backfill order makes the
  // ordinary case rather than an exotic one.
  const reversed = addRange(addRange(EMPTY_COVERAGE, self(11, 20)), self(1, 10));
  assert.equal(nth(reversed.ranges, 0, 'range').edge.hash, hashAt(20));
});

test('“cannot say” KEEPS a range; only a disagreement invalidates it', () => {
  // The asymmetry is the whole safety argument. An unreachable chain, a block outside smoldot's
  // pinned window and a light client still syncing all produce "cannot say", and dropping on
  // that would empty the index every time the network is poor — a corruption response triggered
  // by ordinary offline use.
  const coverage = addRange(addRange(EMPTY_COVERAGE, self(1, 10)), op(21, 30));
  const nothingKnown = verifyRanges(coverage, () => undefined);
  assert.equal(nothingKnown.coverage.ranges.length, 2, 'an unreachable chain emptied the index');
  assert.equal(nothingKnown.unchecked.length, 2);
  assert.deepEqual(nothingKnown.invalidated, []);
});

test('one bad range is dropped and the rest of the index survives — with its holes recomputed', () => {
  const good = self(1, 10);
  const bad = op(21, 30);
  const coverage = addRange(addRange(EMPTY_COVERAGE, good), bad);
  const checked = verifyRanges(coverage, (range) =>
    range.origin === 'self' ? factsAt(range.toBlock) : factsAt(range.toBlock, 9),
  );
  assert.equal(checked.invalidated.length, 1);
  assert.equal(nth(checked.invalidated, 0, 'check').range.origin, 'operator');
  assert.equal(checked.coverage.ranges.length, 1, '§6.3 invalidates the range, not the index');
  assert.equal(isVerifiedAt(checked.coverage, 5), true, 'an unrelated range was dropped too');
  // The holes are recomputed rather than carried over: a stale empty `holes` renders as
  // continuous history over blocks the index no longer has.
  assert.deepEqual(holesIn(checked.coverage.ranges), []);
});

test('the boot path runs the checks, persists what survived, and reports what it lost', async () => {
  // The write-back is the point. Without it the check reports a problem, the corrupt range is
  // still there on the next load, the same warning appears forever and nothing improves.
  const db = new LocalIndex(GENESIS);
  await db.delete();
  await db.open();
  await writeCoverage(db, addRange(addRange(EMPTY_COVERAGE, self(1, 10)), op(21, 30)));

  const report = await checkIndexAtBoot(db, (range) =>
    range.origin === 'self' ? factsAt(range.toBlock) : factsAt(range.toBlock, 9),
  );
  assert.equal(report.invalidated.length, 1);
  assert.equal(report.dropped.length, 0);
  assert.equal(report.pendingDecoder, 0);

  const persisted = await readCoverage(db);
  assert.equal(persisted.ranges.length, 1, 'the invalidation was reported but never written back');
  assert.equal(isVerifiedAt(persisted, 5), true);
  await db.delete();
});

test('a boot that finds nothing wrong does not rewrite the meta row', async () => {
  // A needless write on the one structure whose corruption this function exists to survive is
  // a needless chance for a partial one.
  const db = new LocalIndex(GENESIS);
  await db.delete();
  await db.open();
  await writeCoverage(db, addRange(EMPTY_COVERAGE, self(1, 10)));
  let writes = 0;
  db.meta.hook('updating', () => {
    writes += 1;
  });
  db.meta.hook('creating', () => {
    writes += 1;
  });
  const report = await checkIndexAtBoot(db, (range) => factsAt(range.toBlock));
  assert.deepEqual(report.invalidated, []);
  assert.equal(writes, 0, 'a clean boot rewrote the coverage row');
  await db.delete();
});

test('a query answers with the coverage it came from, and its holes are span-bounded', () => {
  // §6.3: "Every history query returns data *plus* the coverage it came from; charts render
  // holes as visible gaps with an explainer, tables state 'complete within [ranges]'."
  const coverage = addRange(addRange(EMPTY_COVERAGE, self(100, 200)), op(300, 400));
  const answer = covered(coverage, { fromBlock: 50, toBlock: 500 }, ['a', 'b']);
  assert.deepEqual(answer.data, ['a', 'b']);
  assert.deepEqual(answer.span, { fromBlock: 50, toBlock: 500 });
  assert.equal(answer.ranges.length, 2);
  // The edge holes — the blocks at either end of the question no range reaches — are exactly
  // what the unbounded form drops, and dropping them turns "we hold the middle of what you
  // asked for" into "we hold all of it".
  assert.deepEqual(answer.holes, [
    { fromBlock: 50, toBlock: 99 },
    { fromBlock: 201, toBlock: 299 },
    { fromBlock: 401, toBlock: 500 },
  ]);
});

test('the ranges an answer carries keep their own edges rather than being clipped', () => {
  // Clipping to the span would produce ranges whose `toBlock` is not the block their `edge`
  // describes, so `verifyRange` would compare the chain's answer at one height against facts
  // recorded about another and report every queried range as corrupt.
  const coverage = addRange(EMPTY_COVERAGE, self(100, 200));
  const answer = covered(coverage, { fromBlock: 150, toBlock: 160 }, null);
  const range = nth(answer.ranges, 0, 'range');
  assert.equal(range.toBlock, 200, 'the range was clipped and its edge now describes nothing');
  assert.deepEqual(verifyRange(range, factsAt(200)), { kind: 'ok' });
  assert.deepEqual(answer.holes, []);
});

test('a query outside coverage is all hole, not an empty answer', () => {
  // The failure this closes: bare rows render as a complete series, so "there were no
  // observations in this window" and "we never ingested this window" arrive as the same empty
  // array — and the second is the silent splice §6.3 forbids.
  const answer = covered(addRange(EMPTY_COVERAGE, self(1, 10)), { fromBlock: 500, toBlock: 600 }, []);
  assert.deepEqual(answer.ranges, []);
  assert.deepEqual(answer.holes, [{ fromBlock: 500, toBlock: 600 }]);
});

test('an inverted span is refused rather than answered with “no holes”', () => {
  assert.throws(() => covered(EMPTY_COVERAGE, { fromBlock: 100, toBlock: 50 }, null), /runs backwards/);
});

test('the boundary set names the sources, because a count cannot carry the fact', () => {
  // 10 §6.3 makes a range boundary "a rendered fact" and §2.3 gives provider-fed history one
  // mitigation: "mandatory, non-suppressible provenance labelling". "3 sources" reads as
  // abundance; `indexer:acme + self` reads as *part of this line is third-party data*.
  const coverage = addRange(
    addRange(addRange(EMPTY_COVERAGE, self(1, 10)), op(11, 20, 'op-1')),
    providerRange('indexer', 'acme', 21, 30, 1, edgeAt(30)),
  );
  assert.deepEqual(boundarySet(coverage.ranges), ['indexer:acme', 'operator:op-1', 'self']);
  assert.deepEqual(boundarySet([]), []);
});

test('a store-backed query wraps its rows in the coverage read back from storage', async () => {
  const db = new LocalIndex(GENESIS);
  await db.delete();
  await db.open();
  await writeCoverage(db, addRange(EMPTY_COVERAGE, self(1, 10)));
  await db.priceSamples.bulkPut([
    priceSample({ bookId: 'book-1', blockNumber: 5, blockTimestampMs: 5_000, price1e9: 100n, origin: 'self' }),
    priceSample({ bookId: 'book-1', blockNumber: 50, blockTimestampMs: 50_000, price1e9: 200n, origin: 'self' }),
    priceSample({ bookId: 'book-2', blockNumber: 5, blockTimestampMs: 5_000, price1e9: 300n, origin: 'self' }),
  ]);
  const answer = await coveredSamples(db, 'book-1', { fromBlock: 1, toBlock: 20 });
  assert.equal(answer.data.length, 1, 'the query returned rows from outside the span or the wrong book');
  assert.equal(nth(answer.data, 0, 'sample').price1e9, 100n);
  assert.deepEqual(answer.holes, [{ fromBlock: 11, toBlock: 20 }]);
  assert.equal(nth(answer.ranges, 0, 'range').origin, 'self');
  await db.delete();
});
