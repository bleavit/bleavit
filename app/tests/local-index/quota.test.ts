/**
 * The §9.2 quota manager — *"retention auto-tunes to budget (degrades depth, never
 * correctness)"* (10 §9.2, §9.3; 15 §4.8's *"eviction never touches tx-path tables"* row).
 *
 * Run against a real IndexedDB (`fake-indexeddb`), because three of the properties below are
 * about **transactions** and a stub grants those for free while proving nothing.
 *
 * The section's title is the whole specification and the second half is the hard one. A
 * retention policy that frees bytes is trivial; one that frees bytes without ever telling the
 * user something false is not, and §9.2 enumerates the three falsehoods by name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import 'fake-indexeddb/auto';

import {
  DEGRADATION_LADDER,
  LocalIndex,
  METADATA_BOUND,
  QUOTA_SHARES,
  STORAGE_CAP_BYTES,
  applyQuota,
  compactSettledEvents,
  downsample,
  evictionOrder,
  measureUsage,
  platformBudget,
  priceSample,
  quotaSharesAgree,
  readCoverage,
  readDownsampled,
  sourceKeyOf,
  writeCoverage,
  writeDownsampled,
} from '@bleavit/local-index';
import {
  MAX_REPORTED_STEPS,
  TX_PATH_TABLES,
  evictMetadataToBudget,
  laddersAgree,
  measureDepth,
  mergeDownsampled,
  nextResolution,
  pendingDecoderCount,
  rawEventId,
  readMetadataBlob,
  readPendingRawEvicted,
} from '@bleavit/local-index';
import type { Candle, PriceSample, QuotaShares, RowSizes, SettledProposal } from '@bleavit/local-index';
import { selfRange } from '@bleavit/local-index/testing';
import { nth } from './nth.ts';

const GENESIS = `0x${'e5'.repeat(32)}`;
const HOUR = 3_600;

const edgeAt = (toBlock: number) => ({
  genesisHash: GENESIS,
  hash: `0x${toBlock.toString(16).padStart(64, '0')}`,
  specVersion: 3,
});

/**
 * Row sizes, supplied by the caller because §9.1 publishes *"~120 B effective per row"* as a
 * **modelling assumption** and labels it as one. A module that compiled 120 in would be
 * publishing an assumption as a measurement.
 *
 * The figures here are deliberately enormous so a handful of rows exceeds a 300 MB share: the
 * property under test is the ladder's behaviour, not how long it takes to write 2.5 million
 * rows into `fake-indexeddb`.
 */
const SIZES: RowSizes = {
  priceSample: 100 * 1000 * 1000,
  candle: 1000,
  event: 100 * 1000 * 1000,
  archiveRow: 1000,
};

async function freshDb(): Promise<LocalIndex> {
  const db = new LocalIndex(GENESIS);
  await db.delete();
  await db.open();
  return db;
}

const sample = (at: number, block: number, price: number, bookId = 'book-1'): PriceSample =>
  priceSample({ bookId, blockNumber: block, blockTimestampMs: at * 1000, price1e9: BigInt(price), origin: 'self' });

/**
 * One hourly bar, for fixtures that need the **candle** tier at a size no fold could build in a
 * test. Written directly rather than through `foldCandles` because what is under test is the
 * tier's size, and folding 130,000 bars would take longer than the property is worth.
 */
const hourly = (hour: number, bookId = 'book-1'): Candle => ({
  bookId,
  resolution: 'candles1h',
  openAt: hour * HOUR,
  open1e9: 100n,
  high1e9: 100n,
  low1e9: 100n,
  close1e9: 100n,
  samples: 1,
  fromBlock: hour,
  toBlock: hour,
  sourceKey: sourceKeyOf({ origin: 'self' }),
  origin: 'self',
});

const fromIndexer = (at: number, block: number, price: number, providerId = 'acme'): PriceSample =>
  priceSample({
    bookId: 'book-1',
    blockNumber: block,
    blockTimestampMs: at * 1000,
    price1e9: BigInt(price),
    origin: 'indexer',
    providerId,
  });

test('§9.2’s caps and shares are the published cells, and the shares are checked against them', () => {
  // The caps are published **in §9.2's own text**, which since SQ-557's ruling says so outright:
  // they are "client-local values owned by this section", because a browser storage quota is not
  // a chain parameter and doc 13 is the chain registry. The `13-parameters.md` citation this line
  // used to carry pointed at a document with no such row and has been removed.
  assert.equal(STORAGE_CAP_BYTES.desktop, 300 * 1000 * 1000);
  assert.equal(STORAGE_CAP_BYTES.mobile, 75 * 1000 * 1000);

  // A share table that does not sum to the cap either wastes budget or over-commits it, and
  // neither is visible from any single row.
  assert.equal(quotaSharesAgree(), true);
  assert.deepEqual(QUOTA_SHARES, {
    rawSamples: 0.6,
    candles: 0.2,
    eventsAndArchive: 0.15,
    metadata: 0.05,
  });

  // Re-derive the cells §9.2 publishes *for* those shares, which is what makes the reading
  // checked rather than asserted: the depth tables state "share: 180 MB desktop / 45 MB mobile"
  // for raw samples and "60 MB / 15 MB" for candles1h. Decimal MB is the only reading under
  // which both come out exact, which is why the constants are 10^6-based.
  const desktop = platformBudget('desktop');
  const mobile = platformBudget('mobile');
  assert.equal(desktop.rawSampleBytes, 180 * 1000 * 1000);
  assert.equal(mobile.rawSampleBytes, 45 * 1000 * 1000);
  assert.equal(desktop.candleBytes, 60 * 1000 * 1000);
  assert.equal(mobile.candleBytes, 15 * 1000 * 1000);
});

test('§9.3’s byte bound IS §9.2’s metadata share, and the count is what binds', () => {
  // **This test asserted the opposite until SQ-557 was ruled**, and that is worth stating: it
  // pinned `metadataBytes < METADATA_BOUND.bytes` — the *contradiction* — as though it were a
  // property. §9.3 published 16 MB / 6 MB against a 15 MB / 3.75 MB share, which exceeded its
  // own share in both cases and is a bound that cannot bind; the ruling cut §9.3 to the share.
  // A test that pins a defect passes for exactly as long as the defect lives, which is the
  // pattern this repository keeps finding in its own suites.
  assert.equal(METADATA_BOUND.desktop.bytes, 15 * 1000 * 1000);
  assert.equal(METADATA_BOUND.mobile.bytes, 3.75 * 1000 * 1000);
  assert.equal(platformBudget('desktop').metadataBytes, METADATA_BOUND.desktop.bytes);
  assert.equal(platformBudget('mobile').metadataBytes, METADATA_BOUND.mobile.bytes);
  assert.equal(
    platformBudget('mobile').metadataBytes,
    QUOTA_SHARES.metadata * STORAGE_CAP_BYTES.mobile,
    'the §9.3 bound and the §9.2 share have drifted apart again',
  );
  // The `min` is kept even though the two agree: they are two independently editable numbers in
  // two sections, and the tighter one is the only safe composition.
  assert.equal(platformBudget('desktop').metadataBytes, Math.min(15 * 1000 * 1000, METADATA_BOUND.desktop.bytes));
  // At the measured 0.14 MB gz blob the COUNT limit is what actually binds: eight blobs are
  // ~1.1 MB against a 15 MB budget.
  assert.equal(platformBudget('desktop').metadataBlobs, 8);
  assert.equal(platformBudget('mobile').metadataBlobs, 3);
  assert.ok(8 * 0.14 * 1000 * 1000 < platformBudget('desktop').metadataBytes);
});

test('there is no default platform — a client that cannot say takes the phone’s cap by mistake', () => {
  // The unsafe direction is four times the storage on the device most likely to have none.
  assert.throws(() => platformBudget('tablet' as 'desktop'));
});

test('§9.2’s eviction order: oldest first, and imported before self-ingested at equal age', () => {
  // Age leads and provenance breaks the tie, in that order — the reverse would evict a fresh
  // provider row ahead of an ancient verified one and call it a retention policy. The tie break
  // itself is the honest one: a provider row can be re-fetched from the provider that supplied
  // it, while a self-ingested row past smoldot's pinned window cannot be recovered at all.
  const ordered = [
    { at: 20, origin: 'self' as const },
    { at: 10, origin: 'self' as const },
    { at: 10, origin: 'indexer' as const, providerId: 'acme' },
  ].sort(evictionOrder);
  assert.deepEqual(
    ordered.map((r) => [r.at, r.origin]),
    [
      [10, 'indexer'],
      [10, 'self'],
      [20, 'self'],
    ],
  );
});

test('raw samples degrade into candles1h, and the label is written with the delete', async () => {
  const db = await freshDb();
  // Two closed hourly buckets, both over the raw-sample share at these row sizes.
  await db.priceSamples.bulkPut([
    sample(10, 1, 100),
    sample(20, 2, 300),
    sample(HOUR + 10, 3, 200),
  ]);
  await writeCoverage(db, { ranges: [selfRange(1, 3, 1, edgeAt(3))], holes: [] });

  const report = await applyQuota(db, {
    budget: platformBudget('desktop'),
    sizes: SIZES,
    now: 10 * HOUR,
    pinnedSpecVersions: [3],
  });

  // The oldest bucket went first — §9.2's "applied oldest-first".
  const first = nth(report.steps, 0, 'quota step');
  assert.equal(first.kind, 'downsample');
  assert.equal(first.from, 'raw');
  assert.equal(first.to, 'candles1h');

  // The raw rows are gone and an hourly candle replaced them, open/close intact.
  const candle = nth(await db.candles1h.toArray(), 0, 'candle');
  assert.equal(candle.open1e9, 100n);
  assert.equal(candle.close1e9, 300n);
  assert.equal(candle.high1e9, 300n);

  // §9.2: "an evicted range becomes a labelled 'downsampled' range, not a hole, and never a
  // silent splice". All three are asserted separately, because a checker that only says "the
  // data is still there" cannot tell them apart.
  const labels = await readDownsampled(db);
  assert.ok(labels.length >= 1, 'the evicted range carries no resolution label — a silent splice');
  assert.equal(nth(labels, 0, 'label').resolution, 'candles1h');
  // The label covers the blocks whose raw rows went, rather than an arbitrary span: a label that
  // named the wrong blocks would leave the evicted ones unlabelled, which is the silent splice.
  assert.equal(nth(labels, 0, 'label').fromBlock, 1);
  assert.equal(nth(labels, 0, 'label').toBlock, 2);
  const coverage = await readCoverage(db);
  assert.deepEqual(coverage.holes, [], 'an evicted range was rendered as a hole');
  await db.delete();
});

test('the downsampled label participates in the caller’s transaction rather than its own', async () => {
  // The property the label needs and a second `put` cannot give it. §9.2 makes the label part
  // of the eviction rather than a note about it, so a crash between the delete and the label
  // must leave *neither* — which is only true if `writeDownsampled` joins the ambient
  // transaction. A function that opened its own would commit here and survive the rollback.
  const db = await freshDb();
  await assert.rejects(
    db.transaction('rw', db.meta, async () => {
      await writeDownsampled(db, [downsample(1, 2, 'candles1h', 5)]);
      throw new Error('the tab closed mid-eviction');
    }),
  );
  assert.deepEqual(await readDownsampled(db), [], 'the label committed outside the transaction');
  await db.delete();
});

test('the ladder walks §9.2’s order and stops at the floor rather than throwing', async () => {
  const db = await freshDb();
  // Enough closed hourly buckets that the candle share is exceeded too, so the run has to go
  // past the first rung. `candles1d` has no successor, and §9.2 justifies that arithmetically:
  // a daily row costs `books × 120 B/day` ≈ 19.1 KB/day even at the 159-book maximum.
  const samples: PriceSample[] = [];
  for (let i = 0; i < 6; i += 1) samples.push(sample(i * HOUR + 10, i + 1, 100 + i));
  await db.priceSamples.bulkPut(samples);

  const report = await applyQuota(db, {
    budget: platformBudget('desktop'),
    // A candle costs as much as a sample here, so degrading raw never relieves the candle
    // share and the ladder must keep climbing.
    sizes: { ...SIZES, candle: 100 * 1000 * 1000 },
    now: 100 * HOUR,
    pinnedSpecVersions: [3],
  });

  const rungs = report.steps.filter((s) => s.kind === 'downsample').map((s) => `${s.from}->${s.to}`);
  assert.ok(rungs.length > 0, 'the ladder never ran');
  // Ladder order is the guarantee: applied out of order it frees the same bytes and destroys
  // more resolution than it had to.
  const rank = (r: string): number => DEGRADATION_LADDER.indexOf(r as 'raw');
  for (let i = 1; i < rungs.length; i += 1) {
    const [prev] = nth(rungs, i - 1, 'rung').split('->');
    const [next] = nth(rungs, i, 'rung').split('->');
    assert.ok(rank(next ?? '') >= rank(prev ?? ''), `the ladder went backwards: ${rungs.join(', ')}`);
  }
  // Running out of rungs is a **reported outcome**, not a throw: §9.2 states plainly that the
  // raw tier is genuinely thin against a fully-subscribed hosted partition, so a quota manager
  // that threw here would turn a budgeted state into a crash on the busiest chain. Asserted as
  // the value it must take — every sample here costs 100 MB against a 60 MB candle share, so the
  // ladder reaches its floor still over budget. `typeof … === 'boolean'` passed for any run.
  assert.equal(report.exhausted, true, 'a run that hit the floor still over budget reported healthy');
  assert.equal(await db.candles1d.count() > 0, true, 'the ladder never reached the floor');
  await db.delete();
});

test('a bucket that has not closed is never degraded', async () => {
  // Folding half a bucket now and the other half later writes two candles under one key, and
  // the second silently replaces the first — a bar describing part of an hour, rendered as the
  // hour.
  const db = await freshDb();
  await db.priceSamples.bulkPut([sample(10, 1, 100), sample(20, 2, 300)]);
  const report = await applyQuota(db, {
    budget: platformBudget('desktop'),
    sizes: SIZES,
    // Inside the very bucket the samples are in.
    now: 30,
    pinnedSpecVersions: [3],
  });
  assert.equal(report.steps.filter((s) => s.kind === 'downsample').length, 0);
  assert.equal(await db.priceSamples.count(), 2, 'a live bucket was folded');
  assert.equal(report.exhausted, true, 'over budget with nothing eligible must be reported');
  await db.delete();
});

test('two provenances in one bucket become two candles, not one overwritten row', async () => {
  // The storage half of the no-splice rule. `foldCandles` refuses to merge across provenance in
  // memory; a table keyed without the source would take the two candles it produced and store
  // one on top of the other, so the label survives and the number under it is whichever row was
  // written last.
  const db = await freshDb();
  await db.priceSamples.bulkPut([sample(10, 1, 100), fromIndexer(20, 2, 900)]);
  // The mobile budget, so a single 100 MB sample is still over the 45 MB raw share and BOTH
  // provenance groups are degraded — otherwise the run stops after the first and the assertion
  // below would pass by counting one candle against one remaining sample.
  await applyQuota(db, {
    budget: platformBudget('mobile'),
    sizes: SIZES,
    now: 10 * HOUR,
    pinnedSpecVersions: [3],
  });
  assert.equal(await db.priceSamples.count(), 0, 'a raw sample survived, so this proves nothing');
  const candles = await db.candles1h.toArray();
  assert.equal(candles.length, 2, 'two sources collapsed into one stored candle');
  assert.deepEqual(candles.map((c) => c.origin).sort(), ['indexer', 'self']);
  const verified = candles.find((c) => c.origin === 'self');
  assert.ok(verified);
  assert.equal(verified.high1e9, 100n, 'the indexer’s price leaked into the verified bar');
  await db.delete();
});

test('settled proposals’ events compact into proposalsArchive, in one transaction', async () => {
  const db = await freshDb();
  await db.events.bulkPut(
    [1, 2, 3].map((n) => ({
      id: `${n}:0`,
      blockNumber: n,
      pallet: 'Epoch',
      name: 'ProposalSettled',
      decoded: true as const,
      origin: 'self' as const,
    })),
  );
  // An event belonging to something else, in the same blocks. This is the whole test: §9.2
  // permits compacting "`events` for settled+reaped proposals" and nothing else, and `events`
  // carries no proposal reference (10 §7 publishes no column list — SQ-607), so a block-span
  // delete removes other proposals' events, market trades and ledger movements alike.
  await db.events.put({
    id: '2:9',
    blockNumber: 2,
    pallet: 'Market',
    name: 'Traded',
    decoded: true as const,
    origin: 'self' as const,
  });

  const proposal: SettledProposal = {
    proposalId: 'p-1',
    settledAt: 99,
    fromBlock: 1,
    toBlock: 3,
    summary: 'settled: PASS',
    eventIds: ['1:0', '2:0', '3:0'],
    provenance: { origin: 'self' },
  };
  const compacted = await compactSettledEvents(db, proposal);
  assert.equal(compacted, 3);
  assert.equal(await db.events.count(), 1, 'an event outside the proposal was compacted away');
  assert.ok(await db.events.get('2:9'), 'the Market.Traded row in the same block was deleted');
  const archived = nth(await db.proposalsArchive.toArray(), 0, 'archive row');
  assert.equal(archived.compactedEvents, 3, 'the compaction cannot be explained, only counted');
  assert.equal(archived.origin, 'self');

  // Replay is a no-op rather than an error: the ids are already gone.
  assert.equal(await compactSettledEvents(db, proposal), 0);

  // A named row outside the declared span means the summary describes a narrower range than it
  // replaces — the two halves of one claim disagreeing.
  await db.events.put({
    id: '99:0',
    blockNumber: 99,
    pallet: 'Epoch',
    name: 'ProposalSettled',
    decoded: true as const,
    origin: 'self' as const,
  });
  await assert.rejects(() => compactSettledEvents(db, { ...proposal, eventIds: ['99:0'] }));
  // A backwards span deletes nothing and would publish a summary of nothing.
  await assert.rejects(() => compactSettledEvents(db, { ...proposal, fromBlock: 9, toBlock: 1 }));
  await db.delete();
});

test('EVICTION NEVER TOUCHES TX-PATH TABLES (15 §4.8)', async () => {
  // §9.2: the ladder "degrades chart resolution and event granularity only. It never touches:
  // the tx path, layer-1 data, coverage metadata". `txHistory` is neither a chart nor an event
  // stream — it is the user's own record of what they signed — and `snapshotsImported` is the
  // provenance record for everything a provider supplied. Losing either to a storage sweep is
  // not a depth degradation, it is data loss with a retention label on it.
  const db = await freshDb();
  await db.txHistory.bulkPut([
    { id: '0000000001:00000', blockNumber: 1, extrinsicIndex: 0, account: 'alice', call: 'Market.buy', origin: 'self' },
    { id: '0000000002:00000', blockNumber: 2, extrinsicIndex: 0, account: 'alice', call: 'Market.sell', origin: 'self' },
  ]);
  await db.snapshotsImported.put({ id: 's-1', origin: 'snapshot', providerId: 'acme', importedAt: 1, fromBlock: 1, toBlock: 2 });
  const coverageBefore = { ranges: [selfRange(1, 9, 1, edgeAt(9))], holes: [] };
  await writeCoverage(db, coverageBefore);

  // Maximum pressure: everything is over budget and every rung runs.
  const samples: PriceSample[] = [];
  for (let i = 0; i < 12; i += 1) samples.push(sample(i * HOUR + 10, i + 1, 100 + i));
  await db.priceSamples.bulkPut(samples);
  await db.events.bulkPut(
    [1, 2].map((n) => ({
      id: `${n}:9`,
      blockNumber: n,
      pallet: 'Market',
      name: 'Traded',
      decoded: true as const,
      origin: 'self' as const,
    })),
  );

  const report = await applyQuota(db, {
    budget: platformBudget('mobile'),
    sizes: { ...SIZES, candle: 100 * 1000 * 1000 },
    now: 1_000 * HOUR,
    pinnedSpecVersions: [3],
  });
  assert.ok(report.steps.length > 0, 'nothing was evicted, so this proves nothing');

  // Iterated from `TX_PATH_TABLES` rather than named here: a constant documented as *"named so
  // the rule can be asserted rather than read"* and then not read by the assertion is two lists
  // that agree until one is edited.
  assert.deepEqual([...TX_PATH_TABLES], ['txHistory', 'snapshotsImported']);
  const survivors: Record<string, number> = {};
  for (const table of TX_PATH_TABLES) survivors[table] = await db.table(table).count();
  assert.deepEqual(
    survivors,
    { txHistory: 2, snapshotsImported: 1 },
    'the retention ladder deleted from a table §9.2 says it never touches',
  );
  // Coverage metadata survives too — §9.2 names it in the same never-touch list, and an
  // evicted range must stay covered rather than becoming a hole.
  const after = await readCoverage(db);
  assert.equal(after.ranges.length, 1, 'the ladder dropped a coverage range');
  assert.deepEqual(after.holes, [], 'the ladder turned an evicted range into a hole');
  // ...and the events that were NOT named as settled are still there: compaction is permitted
  // only for settled+reaped proposals, and no `settled` list was supplied.
  assert.equal(await db.events.count(), 2, 'events were evicted without a settled-proposal claim');
  await db.delete();
});

test('measured usage is per §9.2 share, and metadata is measured rather than modelled', async () => {
  const db = await freshDb();
  await db.priceSamples.bulkPut([sample(10, 1, 100)]);
  await db.metadataCache.put({ specVersion: 3, bytes: 12_345, lastUsedAt: 1, blob: new Uint8Array(1), origin: 'self' as const });
  const usage = await measureUsage(db, SIZES);
  assert.equal(usage.rawSampleBytes, SIZES.priceSample);
  // `metadataCache` rows carry their real byte count, so this share is the one figure here that
  // is not a model — and `RowSizes` deliberately has no entry for it.
  assert.equal(usage.metadataBytes, 12_345);
  assert.equal(usage.totalBytes, SIZES.priceSample + 12_345);
  // A zero or absent row size makes the table it describes weightless, so the ladder never
  // reaches it and the budget is enforced against a figure that omits the largest table.
  await assert.rejects(() => measureUsage(db, { ...SIZES, priceSample: 0 }));
  await db.delete();
});

test('candle→candle degradation folds a WHOLE target bucket, or the second write destroys the first', async () => {
  // The defect an R-6 review found and the reason eligibility is asked per **target bucket**.
  // The first version tested `c.openAt + width <= lastClosedEnd` — the *target* width added to a
  // *source* row — so of the four hours belonging to one 4 h bucket only the first qualified.
  // That bucket was written from one hour, and the next pass wrote it again from the remaining
  // three **under the same key**, replacing it: an hour of history gone, with coverage still
  // claiming those blocks and the label still saying nothing is missing.
  const db = await freshDb();
  const hours: PriceSample[] = [];
  for (let h = 4; h < 8; h += 1) hours.push(sample(h * HOUR + 10, 100 + h, h * 10));
  await db.priceSamples.bulkPut(hours);

  const budget = platformBudget('mobile');
  // **`now` sits just past the bucket's close, and that is the whole test.** With `now` far in
  // the future every hour is eligible under either reading, so the defect — the *target* width
  // added to a *source* row — is invisible. At `now = 8 h` the wrong reading admits only the
  // first of the four hours belonging to the 04:00 bucket, writes the bar from it, and lets the
  // next pass replace that bar with one built from the other three.
  await applyQuota(db, { budget, sizes: SIZES, now: 8 * HOUR, pinnedSpecVersions: [3] });
  assert.equal(await db.candles1h.count(), 4, 'the four hours did not become four hourly candles');

  // A candle size at which four hourly rows are over the 15 MB mobile candle share and one 4 h
  // row is under it, so the ladder stops at exactly the rung under test rather than continuing
  // to daily — which would leave `candles4h` empty and the assertion passing for the wrong
  // reason on the way to failing for it.
  const report = await applyQuota(db, {
    budget,
    sizes: { ...SIZES, candle: 10 * 1000 * 1000 },
    now: 8 * HOUR,
    pinnedSpecVersions: [3],
  });
  assert.equal(await db.candles1d.count(), 0, 'the ladder went past the rung under test');
  const fourHour = await db.candles4h.toArray();
  assert.equal(fourHour.length, 1, 'the 4 h bucket was written more than once, or not at all');
  const bar = nth(fourHour, 0, 'candle');
  // Built from all four hours: open from the first, close from the last, span covering them all.
  assert.equal(bar.samples, 4, 'the 4 h bar summarises fewer hours than its bucket contains');
  assert.equal(bar.fromBlock, 104, 'the 4 h bar does not span the whole bucket');
  assert.equal(bar.toBlock, 107);
  assert.equal(bar.open1e9, 40n, 'the bar opens on an hour that is not the bucket’s first');
  assert.equal(bar.close1e9, 70n, 'the bar closes on an hour that is not the bucket’s last');
  assert.equal(await db.candles1h.count(), 0, 'an hourly candle survived its own degradation');
  assert.ok(report.steps.some((s) => s.kind === 'downsample' && s.from === 'candles1h'));
  await db.delete();
});

test('the ladder REPORTS exhaustion rather than looping when a rung stops making progress', async () => {
  // Running out of room is a budgeted, expected state under §9.2 — thin against a
  // fully-subscribed hosted partition (~7 days desktop, ~2 days mobile) — so it is reported, and
  // an unbounded loop is not an admissible failure mode for a reported state. Every other termination condition here is a property of
  // *other* code (the delete really removing rows, the measurement really shrinking); when one
  // of those is wrong the loop folds the same bucket forever and takes the tab with it.
  const db = await freshDb();
  // A single closed bucket whose fold cannot bring the share under budget, because a candle
  // costs as much as the samples it replaced.
  await db.priceSamples.bulkPut([sample(10, 1, 100), sample(20, 2, 200)]);
  const report = await applyQuota(db, {
    budget: platformBudget('mobile'),
    sizes: { ...SIZES, candle: 100 * 1000 * 1000 },
    now: 100 * HOUR,
    pinnedSpecVersions: [3],
  });
  assert.equal(report.exhausted, true, 'still over budget with nothing left to give up');
  assert.equal(await db.priceSamples.count(), 0);
  await db.delete();
});

test('exhaustion covers the EVENTS share and the hard total cap, not just the two chart shares', async () => {
  // §9.2's caps are on the **total** ("300 MB desktop / 75 MB mobile"); the shares are internal.
  // A report computed from the chart shares alone answered `exhausted: false` for a database
  // hundreds of megabytes past both — which is the one thing that number exists to say.
  const db = await freshDb();
  await db.events.bulkPut(
    [1, 2, 3, 4, 5].map((n) => ({
      id: `${n}:0`,
      blockNumber: n,
      pallet: 'Market',
      name: 'Traded',
      decoded: true as const,
      origin: 'self' as const,
    })),
  );
  const report = await applyQuota(db, {
    budget: platformBudget('mobile'),
    sizes: SIZES,
    now: 100 * HOUR,
    pinnedSpecVersions: [3],
    // No settled proposals: the events share has no rung it can relieve, which is exactly the
    // state that must still be reported.
  });
  assert.equal(report.steps.length, 0, 'something was evicted, so exhaustion is not what is under test');
  assert.ok(report.after.eventBytes > platformBudget('mobile').eventBytes);
  assert.ok(report.after.totalBytes > platformBudget('mobile').capBytes);
  assert.equal(report.exhausted, true, 'a database past its event share AND its hard cap reported healthy');
  await db.delete();
});

test('the downsampled label is CLIPPED, never dropped from blocks it does not cover', async () => {
  // The label is what stops an evicted range reading as a silent splice, so a merge that drops a
  // whole finer range removes the label from blocks the incoming range never touched — and those
  // blocks' raw samples are already gone.
  const adjacent = mergeDownsampled([downsample(100, 199, 'candles1h', 1)], downsample(200, 299, 'candles1d', 2));
  assert.deepEqual(
    adjacent.map((r) => [r.fromBlock, r.toBlock, r.resolution]),
    [
      [100, 199, 'candles1h'],
      [200, 299, 'candles1d'],
    ],
    'a merely ADJACENT finer range lost its label',
  );

  const straddled = mergeDownsampled([downsample(100, 300, 'candles1h', 1)], downsample(150, 200, 'candles1d', 2));
  assert.deepEqual(
    straddled.map((r) => [r.fromBlock, r.toBlock, r.resolution]),
    [
      [100, 149, 'candles1h'],
      [150, 200, 'candles1d'],
      [201, 300, 'candles1h'],
    ],
    'the parts outside the coarser range lost their label',
  );
});

test('no span ever carries two labels claiming two resolutions', () => {
  // A coarser stored range must keep its blocks and the finer incoming label must lose them,
  // or blocks 150..200 below would promise detail that was evicted earlier.
  const merged = mergeDownsampled([downsample(100, 200, 'candles1d', 1)], downsample(150, 250, 'candles1h', 2));
  assert.deepEqual(
    merged.map((r) => [r.fromBlock, r.toBlock, r.resolution]),
    [
      [100, 200, 'candles1d'],
      [201, 250, 'candles1h'],
    ],
  );
  // Every block is claimed at most once, checked rather than read off the shape above.
  const claimed = new Set<number>();
  for (const r of merged) {
    for (let b = r.fromBlock; b <= r.toBlock; b += 1) {
      assert.ok(!claimed.has(b), `block ${b} carries two resolution labels`);
      claimed.add(b);
    }
  }
  // Same-resolution neighbours still join, or the list grows once per eviction pass forever.
  const joined = mergeDownsampled([downsample(100, 199, 'candles1h', 1)], downsample(200, 299, 'candles1h', 2));
  assert.deepEqual(joined.map((r) => [r.fromBlock, r.toBlock]), [[100, 299]]);
});

test('the two spellings of §9.2’s ladder are one ladder', () => {
  // `nextResolution` derives from the coarse-rung array so its narrow return type is a property
  // of that array rather than an assertion — which only holds while the two arrays agree. The
  // check this replaced (`if (next === 'raw') throw`) could never fire: `raw` is at index 0, so
  // it is never anybody's successor.
  assert.equal(laddersAgree(), true);
  assert.equal(nextResolution('raw'), 'candles1h');
  assert.equal(nextResolution('candles1d'), undefined);
});

test('the metadata cache records a use, so its LRU order is not insertion order in disguise', async () => {
  // §9.3 evicts least-recently-*used*. Nothing wrote `lastUsedAt`, so `orderBy('lastUsedAt')`
  // returned insertion order — which for metadata means the **oldest era** is discarded first,
  // exactly the blob the deepest rows need and the rows that cannot be re-decoded any other way.
  const db = await freshDb();
  await db.metadataCache.bulkPut([
    { specVersion: 1, bytes: 400, lastUsedAt: 1, blob: new Uint8Array([1]), origin: 'self' as const },
    { specVersion: 2, bytes: 400, lastUsedAt: 2, blob: new Uint8Array([2]), origin: 'self' as const },
  ]);
  const blob = await readMetadataBlob(db, 1, 500);
  assert.deepEqual(blob?.blob, new Uint8Array([1]));
  assert.equal((await db.metadataCache.get(1))?.lastUsedAt, 500, 'the use was not recorded');
  // Now spec 2 is the least recently used, and it is the one that goes.
  assert.deepEqual(await evictMetadataToBudget(db, { maxBlobs: 1, maxBytes: 10_000, pinned: [] }), [2]);
  // An absent era is `undefined`, never a throw: that is §6.5's raw-row path, where the caller
  // stores the event raw and counts it pending rather than guessing with the metadata it has.
  assert.equal(await readMetadataBlob(db, 99, 500), undefined);
  await db.delete();
});


test('a delete that removes nothing ENDS the pass rather than folding the same bucket forever', async () => {
  // The progress guard, exercised through the only failure that reaches it: a delete that
  // silently matches nothing. That is not hypothetical — it is what a primary key missing a
  // component does, and it is how this defect was found (a mutation run dropped `sourceKey` from
  // the `priceSamples` key, `bulkDelete` matched nothing, the share never fell, and the ladder
  // folded one bucket until the process was killed).
  //
  // §9.2 states that running out of room is a reported outcome — against a fully-subscribed
  // hosted partition the raw tier is genuinely thin (~7 days desktop, ~2 days mobile) — so an
  // unbounded loop is not an admissible failure mode for it, and a retention pass that never
  // returns takes the tab with it. Every other termination condition in that loop is a property
  // of *other* code; this is the one that is a property of the loop. (The blanket "not
  // achievable within the caps" this comment used to quote was withdrawn as false by SQ-557.)
  // A DBCore middleware that swallows deletes — the seam Dexie publishes for exactly this.
  // Installed **before** `open()`: middleware added afterwards does not reach the already-built
  // stack, and the first version of this test silently deleted normally and proved nothing.
  const db = new LocalIndex(GENESIS);
  let blocked = 0;
  db.use({
    stack: 'dbcore',
    name: 'delete-nothing',
    create: (down) => ({
      ...down,
      table: (name: string) => {
        const table = down.table(name);
        return {
          ...table,
          mutate: (req: { type: string }) => {
            if ((req.type === 'delete' || req.type === 'deleteRange') && name === 'priceSamples') {
              blocked += 1;
              return Promise.resolve({ numFailures: 0, failures: {}, lastResult: undefined, results: [] });
            }
            return table.mutate(req as Parameters<typeof table.mutate>[0]);
          },
        };
      },
    }),
  });
  await db.delete();
  await db.open();
  await db.priceSamples.bulkPut([sample(10, 1, 100), sample(20, 2, 300)]);

  const report = await applyQuota(db, {
    budget: platformBudget('mobile'),
    sizes: SIZES,
    now: 100 * HOUR,
    pinnedSpecVersions: [3],
  });
  assert.equal(report.exhausted, true, 'a pass that could not free anything reported healthy');
  assert.ok(blocked > 0, 'the middleware never saw a delete, so nothing was under test');
  assert.equal(await db.priceSamples.count(), 2, 'the middleware did not actually block the delete');
  // One attempt, then the guard stops it. Without the guard this test never returns at all.
  assert.ok(
    report.steps.filter((s) => s.kind === 'downsample').length <= 2,
    'the ladder retried a rung that was making no progress',
  );
  await db.delete();
});

test('a bucket folded in TWO passes accumulates rather than being written over', async () => {
  // §9.2 obligation 2's named failure, and folding whole buckets does not close it: whole-bucket
  // folding holds *within* a pass, and a backfill chunk landing older samples for an
  // already-folded hour arrives in a **later** one. A bare `bulkPut` then writes a bar over the
  // earlier bar — "a bar describing part of an hour, rendered as the hour" — with the coverage
  // still claiming those blocks and the downsampled label still saying nothing is missing.
  const db = await freshDb();
  const budget = platformBudget('mobile');
  await db.priceSamples.bulkPut([sample(100, 200, 500), sample(200, 210, 700)]);
  await applyQuota(db, { budget, sizes: SIZES, now: 10 * HOUR, pinnedSpecVersions: [3] });
  const first = nth(await db.candles1h.toArray(), 0, 'candle');
  assert.equal(first.samples, 2);

  // The backfill catches up: two older observations inside the SAME hour.
  await db.priceSamples.bulkPut([sample(10, 100, 300), sample(20, 110, 900)]);
  await applyQuota(db, { budget, sizes: SIZES, now: 10 * HOUR, pinnedSpecVersions: [3] });

  const bars = await db.candles1h.toArray();
  assert.equal(bars.length, 1, 'the second fold wrote a second row instead of rolling in');
  const bar = nth(bars, 0, 'candle');
  assert.equal(bar.samples, 4, 'the second fold replaced the first bar — an hour of history gone');
  assert.equal(bar.open1e9, 300n, 'the bar no longer opens on the hour’s first observation');
  assert.equal(bar.close1e9, 700n, 'the bar no longer closes on the hour’s last');
  assert.equal(bar.high1e9, 900n);
  assert.equal(bar.low1e9, 300n);
  assert.equal(bar.fromBlock, 100);
  assert.equal(bar.toBlock, 210);
  await db.delete();
});

test('a bucket that frees nothing SKIPS ITSELF rather than abandoning the rung', async () => {
  // The progress guard has two jobs and an earlier version confused them. It must stop the loop
  // retrying a bucket that freed nothing — otherwise a delete matching nothing folds one bucket
  // forever and takes the tab with it. It must NOT stop the rung, because a bucket can freely
  // free nothing: rolling up a bucket holding a single candle writes one row for one row, and a
  // guard that gave up there would report `exhausted` while later buckets holding four rows
  // apiece were still foldable and still over budget.
  const db = await freshDb();
  // Hour 0 holds one hourly candle (folds 1 → 1, freeing nothing); hours 4..7 hold four, which
  // roll into one 4 h bar and free three rows.
  const hours: PriceSample[] = [sample(10, 1, 100)];
  for (let h = 4; h < 8; h += 1) hours.push(sample(h * HOUR + 10, 10 * h, 100 + h));
  await db.priceSamples.bulkPut(hours);
  const budget = platformBudget('mobile');
  await applyQuota(db, { budget, sizes: SIZES, now: 24 * HOUR, pinnedSpecVersions: [3] });
  assert.equal(await db.candles1h.count(), 5, 'the raw rung did not fold every closed hour');

  const report = await applyQuota(db, {
    budget,
    // Five hourly rows are over the 15 MB mobile candle share; two 4 h rows are under it.
    sizes: { ...SIZES, candle: 4 * 1000 * 1000 },
    now: 24 * HOUR,
    pinnedSpecVersions: [3],
  });
  // The 00:00 bucket is folded first and frees nothing (one candle in, one out). The rung must
  // still reach the 04:00 bucket, whose four hours roll into one bar and free three rows.
  const rolled = report.steps.filter((s) => s.kind === 'downsample' && s.from === 'candles1h');
  assert.equal(rolled.length, 2, 'the rung stopped at the bucket that freed nothing');
  assert.deepEqual(
    rolled.map((s) => (s.kind === 'downsample' ? s.bucketOpenAt : -1)),
    [0, 4 * HOUR],
    'the cursor did not advance past the bucket that freed nothing, or skipped one it never tried',
  );
  assert.equal(await db.candles4h.count(), 2);
  assert.equal(report.exhausted, false, 'a database the ladder could still relieve reported exhausted');
  await db.delete();
});

test('the ladder reads ONE BUCKET per pass, not the whole table (§9.2 at its own scale)', async () => {
  // The quota manager could not run at the scale it enforces: `degradeOldestBucket`
  // re-materialised the whole table per bucket, so a pass cost rows × buckets — at the desktop
  // raw share that is ~1.5 M rows re-read thousands of times. The suite was structurally blind to
  // it because `SIZES.priceSample` is set so a handful of rows exceeds the share.
  //
  // Measured through Dexie's own DBCore seam, which is what makes this an assertion about work
  // done rather than about wall-clock on this machine.
  const db = new LocalIndex(GENESIS);
  let rowsRead = 0;
  db.use({
    stack: 'dbcore',
    name: 'count-rows-read',
    create: (down) => ({
      ...down,
      table: (name: string) => {
        const table = down.table(name);
        return {
          ...table,
          query: async (req: Parameters<typeof table.query>[0]) => {
            const answer = await table.query(req);
            if (name === 'priceSamples') rowsRead += answer.result.length;
            return answer;
          },
        };
      },
    }),
  });
  await db.delete();
  await db.open();

  // A realistic row size with a scaled-down share, because inserting the 1.5 M rows a real
  // desktop share admits is not a test — the property under test is how the work scales.
  const BUCKETS = 40;
  const PER_BUCKET = 5;
  const rows: PriceSample[] = [];
  for (let b = 0; b < BUCKETS; b += 1) {
    for (let i = 0; i < PER_BUCKET; i += 1) {
      // Distinct blocks, because `priceSamples` is keyed `[bookId+sourceKey+blockNumber]`: a
      // fixture repeating a block per bucket stores one row and measures nothing.
      rows.push(sample(b * HOUR + i * 60 + 1, b * 100 + i, 100 + i));
    }
  }
  await db.priceSamples.bulkPut(rows);
  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };
  // A share of five rows, so all but the last bucket folds and the pass is a full one.
  const budget = { ...platformBudget('desktop'), rawSampleBytes: 600, candleBytes: 12_000_000 };

  rowsRead = 0;
  const report = await applyQuota(db, { budget, sizes, now: 1_000 * HOUR, pinnedSpecVersions: [3] });
  assert.ok(report.steps.length >= BUCKETS - 1, 'the pass folded almost nothing, so it proves nothing');
  assert.equal(await db.priceSamples.count() <= PER_BUCKET, true);

  // One bucket per pass reads about `PER_BUCKET + 1` rows; the whole-table version read all 200
  // once per bucket, which is 8,000. The bound below is an order of magnitude under that and an
  // order of magnitude over the bounded reading, so it fails on the defect and not on noise.
  assert.ok(
    rowsRead < BUCKETS * PER_BUCKET * 4,
    `the ladder materialised ${rowsRead} sample rows for ${BUCKETS} buckets of ${PER_BUCKET}; ` +
      'a whole-table read per bucket is what this bound exists to fail on',
  );
  await db.delete();
});

test('§9.2’s measured-and-current depth is REPORTED, per tier, with the measured rate', async () => {
  // §9.2 makes this a MUST: *"Raw depth is the tier that moves with hosted occupancy, so a client
  // MUST present it as measured-and-current rather than as a promise"*. `QuotaReport` carried no
  // field a surface could present, so the only available figure was §9.2's planning table — a
  // promise nobody made, since `svc.max_live` is a governance row that moves under the client.
  const db = await freshDb();
  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };
  // Two days of observations, four a day: a measured rate of exactly 4 rows/day.
  const rows: PriceSample[] = [];
  for (let day = 0; day < 3; day += 1) {
    for (let i = 0; i < 4; i += 1) {
      rows.push(sample(day * 24 * HOUR + i * 6 * HOUR, day * 10 + i, 100));
    }
  }
  rows.pop();
  await db.priceSamples.bulkPut(rows);

  const budget = { ...platformBudget('desktop'), rawSampleBytes: 120_000 };
  const depth = await measureDepth(db, budget, sizes, 100 * HOUR);
  const raw = nth(depth.tiers, 0, 'tier');
  assert.equal(raw.tier, 'raw');
  assert.equal(raw.rows, 11);
  assert.equal(raw.oldest, 0);
  assert.equal(raw.newest, 2 * 24 * HOUR + 12 * HOUR);
  assert.equal(raw.heldDays, 2.5, 'the held depth is not measured from the rows themselves');
  assert.ok(raw.rowsPerDay !== undefined);
  assert.equal(raw.rowsPerDay, 11 / 2.5);
  // The budgeted depth follows from the measured rate and the share — §9.2's "computed from the
  // measured ingest rate; there is no fixed '90 days' promise", as a number.
  assert.equal(Math.round((raw.budgetedDays ?? 0) * 100) / 100, 227.27);

  // An unmeasurable rate is ABSENT, never zero and never a default: a tier holding one row has
  // no span to divide by, and a rate invented there reports a budgeted depth of infinity.
  const empty = nth(depth.tiers, 1, 'tier');
  assert.equal(empty.tier, 'candles1h');
  assert.equal(empty.rows, 0);
  assert.equal(empty.oldest, undefined);
  assert.equal(empty.rowsPerDay, undefined);
  assert.equal(empty.budgetedDays, undefined);

  // Every ladder rung is reported, so a surface cannot present one tier as though it were the set.
  assert.deepEqual(depth.tiers.map((tier) => tier.tier), [...DEGRADATION_LADDER]);

  // ...and a pass reports the depth it LEAVES the user in, not the one it found them in.
  const report = await applyQuota(db, { budget, sizes, now: 100 * HOUR, pinnedSpecVersions: [3] });
  assert.equal(report.depth.measuredAt, 100 * HOUR);
  assert.equal(nth(report.depth.tiers, 0, 'tier').rows, await db.priceSamples.count());
  await db.delete();
});

test('§9.2’s depth is read from the INDEX, on BOTH tiers, so a tier past V8’s spread limit measures', async () => {
  // The retention pass crashed exactly when the database was largest. `measureDepth` computed each
  // tier's extremes with `Math.min(...instants)` / `Math.max(...instants)` over **every row of the
  // tier**, and V8 refuses a spread above roughly 125,390 arguments — measured here: 125,000 is
  // fine, 130,000 throws `RangeError: Maximum call stack size exceeded`. `applyQuota` calls
  // `measureDepth` on every pass, so the whole retention pass threw once any tier passed that
  // size.
  //
  // **`candles1h` is the tier the arithmetic was about, and it is a separate call site.** The
  // first version of this fixture seeded 130,000 `priceSamples` — a tier with no producer at all
  // in production (SQ-782), so the regression test for a production crash exercised a path
  // production never reaches, while the candle loop went unexercised. `candles1h` grows
  // 159 books × 24 h = 3,816 rows/day at the registry maximum, arriving in about 33 days — roughly
  // a quarter of §9.2's own published 131-day desktop candle depth, and before the 500,000-row
  // candle share triggers any relief. On mobile the 125,000-row share and the crash arrive
  // together. Both tiers are seeded here, and the candle one is the load-bearing half.
  //
  // The suite was structurally blind to this in the same way it had been blind to the whole-table
  // read: the DBCore seam test resets its counter before `applyQuota`, and `measureDepth` runs
  // when the fixture table is nearly empty. So this fixture is a real tier past the limit.
  const db = await freshDb();
  const N = 130_000;
  const CHUNK = 10_000;
  for (let base = 0; base < N; base += CHUNK) {
    const rows: PriceSample[] = [];
    const bars: Candle[] = [];
    for (let i = 0; i < CHUNK; i += 1) {
      rows.push(sample(base + i, base + i, 100));
      bars.push(hourly(base + i));
    }
    await db.priceSamples.bulkPut(rows);
    await db.candles1h.bulkPut(bars);
  }
  assert.equal(await db.priceSamples.count(), N);
  assert.equal(await db.candles1h.count(), N, 'the tier with a producer is not past the spread limit');

  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };
  const depth = await measureDepth(db, platformBudget('desktop'), sizes, 10_000_000 * HOUR);
  const raw = nth(depth.tiers, 0, 'tier');
  assert.equal(raw.rows, N);
  assert.equal(raw.oldest, 0, 'the oldest instant is not the first entry of the ordered index');
  assert.equal(raw.newest, N - 1, 'the newest instant is not the last entry of the ordered index');
  assert.ok(raw.rowsPerDay !== undefined && raw.rowsPerDay > 0);

  // The candle arm, measured through its own call site — `table.orderBy('openAt')`, not the raw
  // tier's `at`.
  const hours = nth(depth.tiers, 1, 'tier');
  assert.equal(hours.tier, 'candles1h');
  assert.equal(hours.rows, N);
  assert.equal(hours.oldest, 0, 'the candle tier’s extremes are not read from its ordered index');
  assert.equal(hours.newest, (N - 1) * HOUR);
  assert.ok(hours.rowsPerDay !== undefined && hours.rowsPerDay > 0);

  // ...and the whole pass survives it, which is the property the crash actually took down.
  //
  // **The budget below leaves nothing over its share, and this comment says so rather than
  // claiming coverage the assertions do not have** — an earlier version stated *"the budget here
  // is over the raw share, so the ladder runs rather than short-circuiting"*, which was false:
  // 130,000 × 120 B is 15.6 MB against the 180 MB desktop raw share and the 60 MB candle share,
  // so the first `held <= budgetForShare` breaks and **no rung does any work**. `stepsPerformed`
  // is asserted at zero so the claim and the fixture cannot drift apart again.
  //
  // That is still the case worth asserting, because `applyQuota` calls `measureDepth`
  // unconditionally at the end of every pass: an index that is large and *inside* its budget is
  // the common state, and it is the one that threw. What is deliberately **not** exercised here is
  // the ladder folding a tier this size, and the reason is the harness rather than the code —
  // measured on the pinned `fake-indexeddb`, one 3,600-key `bulkDelete` against a 130,000-row
  // table had not returned after **nine minutes** (the same delete against this suite's ordinary
  // fixtures is instant, and the inserts above take ~10 s and ~7 s). A fixture that cannot finish
  // is not a stronger test; the ladder's own behaviour at scale is asserted where it can be —
  // "the ladder reads ONE BUCKET per pass", through Dexie's DBCore seam, which counts the work per
  // fold rather than performing it a hundred thousand times.
  const idle = await applyQuota(db, {
    budget: platformBudget('desktop'),
    sizes,
    now: 10_000_000 * HOUR,
    pinnedSpecVersions: [3],
  });
  assert.equal(idle.depth.tiers.length, 4);
  assert.deepEqual([...idle.refusals], []);
  assert.equal(idle.stepsPerformed, 0, 'the fixture is now over its share — the comment above is wrong again');
  assert.equal(nth(idle.depth.tiers, 1, 'tier').rows, N, 'the pass re-measured the candle tier as something else');
  await db.delete();
});

test('a tier’s rate is measured over ONE population — the count comes off the index too', async () => {
  // `Table.count()` counts rows; an index counts **entries**, and a row missing the indexed field
  // is not an entry. The extremes come off `orderBy('at')`, so a count taken from the table would
  // divide one population's rows by another population's span — measured on the pinned Dexie, a
  // table holding one row with no `at` answers 3 to `count()` and 2 to `orderBy('at').count()`.
  //
  // Both directions of that error are conservative (an over-count shortens the budgeted depth,
  // which understates rather than overstates), which is precisely why nothing would have caught
  // it drifting. §9.2 makes measured depth a `MUST`, so the quantity is pinned rather than left
  // to be conservative by luck.
  const db = await freshDb();
  await db.priceSamples.bulkPut([sample(0, 1, 100), sample(2 * 24 * HOUR, 2, 200)]);
  // The shape a writer that omitted the block timestamp produces — well-formed enough to store,
  // invisible to the `at` index.
  await db.priceSamples.put({
    bookId: 'book-1',
    sourceKey: sourceKeyOf({ origin: 'self' }),
    blockNumber: 3,
    price1e9: 300n,
    origin: 'self',
  } as PriceSample);

  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };
  const depth = await measureDepth(db, platformBudget('desktop'), sizes, 100 * HOUR);
  const raw = nth(depth.tiers, 0, 'tier');
  assert.equal(await db.priceSamples.count(), 3, 'the fixture no longer holds an unindexed row');
  assert.equal(raw.rows, 2, 'the count and the extremes describe different populations');
  assert.equal(raw.heldDays, 2);
  assert.equal(raw.rowsPerDay, 1, 'the rate divided one population’s rows by another’s span');
  await db.delete();
});

test('a rung that REFUSES does not abandon the rungs after it', async () => {
  // §9.2 orders the ladder and the order **is** the guarantee — which cuts both ways. Three
  // ordinary-data refusals threw straight out of `applyQuota`: `evictMetadataToBudget`'s pinned-set
  // refusal is step 1, so the whole chart ladder was skipped; `compactSettledEvents`' provenance
  // refusal is step 3, so the §6.5 raw-blob bound in step 4 never ran. The result is unbounded
  // growth in the one tier §9.1 forbids retaining, under a pass that reported nothing at all.
  //
  // The refusals themselves are right. Ending the pass is not.
  const db = await freshDb();
  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };

  // Step 1 refuses: two pinned blobs against a one-blob budget is a release configuration that
  // does not fit its own platform bound, and §9.3 forbids resolving it by evicting a pin.
  await db.metadataCache.bulkPut([
    { specVersion: 3, bytes: 100, lastUsedAt: 1, blob: new Uint8Array(1), origin: 'self' },
    { specVersion: 4, bytes: 100, lastUsedAt: 2, blob: new Uint8Array(1), origin: 'self' },
  ]);

  // Step 2 has work: four closed hours of samples, over a one-row raw share.
  await db.priceSamples.bulkPut([
    sample(10, 1, 100),
    sample(20, 2, 200),
    sample(HOUR + 10, 3, 300),
    sample(2 * HOUR + 10, 4, 400),
  ]);

  // Step 3 refuses: a settled proposal spanning two provenances cannot become one summary.
  await db.events.bulkPut([
    { id: '1:0', blockNumber: 1, pallet: 'Epoch', name: 'ProposalSettled', decoded: true as const, origin: 'self' as const },
    {
      id: '2:0',
      blockNumber: 2,
      pallet: 'Epoch',
      name: 'ProposalSettled',
      decoded: true as const,
      origin: 'operator' as const,
      providerId: 'op-1',
    },
    { id: '3:0', blockNumber: 3, pallet: 'Epoch', name: 'ProposalSettled', decoded: true as const, origin: 'self' as const },
  ]);

  // Step 4 has work: three raw blobs over the events share.
  for (const block of [10, 20, 30]) {
    await db.events.put({
      id: rawEventId(block),
      blockNumber: block,
      pendingBlock: block,
      pallet: '(pending decoder)',
      name: '(era metadata unavailable)',
      decoded: false as const,
      raw: new Uint8Array(1_000_000),
      origin: 'self' as const,
    });
  }

  const settled: SettledProposal[] = [
    {
      proposalId: 'p-mixed',
      settledAt: 99,
      fromBlock: 1,
      toBlock: 2,
      summary: 'settled: PASS',
      eventIds: ['1:0', '2:0'],
      provenance: { origin: 'self' },
    },
    // The proposal AFTER the refusal — a refusal in one unit of work must not cost the next one
    // its depth either.
    {
      proposalId: 'p-clean',
      settledAt: 99,
      fromBlock: 3,
      toBlock: 3,
      summary: 'settled: FAIL',
      eventIds: ['3:0'],
      provenance: { origin: 'self' },
    },
  ];

  const report = await applyQuota(db, {
    budget: { ...platformBudget('desktop'), rawSampleBytes: 120, eventBytes: 1_500_000, metadataBlobs: 1 },
    sizes,
    now: 100 * HOUR,
    pinnedSpecVersions: [3, 4],
    settled,
  });

  // Every rung reported, in §9.2's order — the refusals in their place in the sequence rather
  // than as an exception that erased everything after them.
  assert.deepEqual(
    report.refusals.map((r) => [r.rung, r.at]),
    [
      ['evict-metadata', 'metadata'],
      ['compact-events', 'p-mixed'],
    ],
    'a refusal was swallowed, or one fired that should not have',
  );
  assert.match(nth(report.refusals, 0, 'refusal').reason, /pinned metadata alone/);
  assert.match(nth(report.refusals, 1, 'refusal').reason, /one summary cannot carry two origins/);

  // Step 2 ran despite step 1 refusing.
  assert.ok(
    report.steps.some((s) => s.kind === 'downsample'),
    'the metadata refusal skipped the whole chart ladder',
  );
  // Step 3's second proposal ran despite its first refusing.
  assert.ok(
    report.steps.some((s) => s.kind === 'compact-events' && s.proposalId === 'p-clean'),
    'one refused proposal cost every later proposal its compaction',
  );
  // Step 4 ran despite step 3 refusing — the §9.1 bound on the tier that must never grow.
  const bound = report.steps.find((s) => s.kind === 'evict-pending-raw');
  assert.ok(bound, 'the compaction refusal skipped the §6.5 raw-blob bound entirely');
  assert.deepEqual(
    bound.kind === 'evict-pending-raw'
      ? { blocks: bound.blocks, oldestBlock: bound.oldestBlock, newestBlock: bound.newestBlock }
      : undefined,
    { blocks: 2, oldestBlock: 10, newestBlock: 20 },
  );

  // Nothing the refusals touched was destroyed: refusing costs depth, which §9.2 permits.
  assert.equal(await db.metadataCache.count(), 2, 'a pinned blob was evicted by the refused rung');
  assert.equal(await db.events.get('1:0') !== undefined, true, 'the refused compaction deleted its events anyway');
  await db.delete();
});

test('the step list is BOUNDED, the count is not, and no refusal is ever elided', async () => {
  // §9.2 calls the ladder "deterministic and user-visible", and `QuotaReport.steps` is what
  // renders it — so the list is a rendering and had no bound at all. One `downsample` step is one
  // folded bucket: a full pass at the desktop raw share (180 MB ÷ ~120 B ≈ 1.5 M rows) is
  // thousands of them, and the §6.5 raw-blob step used to carry one entry per discarded block, up
  // to ~225,000 at the desktop events share. Both are now envelope-and-count, the shape
  // `PendingRawEvictionRecord` already used.
  //
  // The half that must NOT be bounded is the refusals: they are what the pass could not do, they
  // are bounded by the rungs, and `refusals` is derived from `steps` precisely so one cannot go
  // unreported. A cap that elided them would be a silent failure produced by a display decision.
  const db = await freshDb();
  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };
  // 120 closed hourly buckets, two samples apiece: each fold frees one row, so the ladder runs
  // past the cap without any single transaction being large.
  const samples: PriceSample[] = [];
  for (let h = 0; h < 120; h += 1) {
    samples.push(sample(h * HOUR + 10, 2 * h + 1, 100));
    samples.push(sample(h * HOUR + 20, 2 * h + 2, 200));
  }
  await db.priceSamples.bulkPut(samples);
  // ...and a raw row the sparse index cannot reach, so the LAST rung refuses — after the cap has
  // already been reached by the chart ladder.
  await db.events.put({
    id: rawEventId(9_001),
    blockNumber: 9_001,
    pallet: '(pending decoder)',
    name: '(era metadata unavailable)',
    decoded: false,
    raw: new Uint8Array(16),
    origin: 'self',
  } as Parameters<typeof db.events.put>[0]);

  const report = await applyQuota(db, {
    budget: { ...platformBudget('desktop'), rawSampleBytes: 120, candleBytes: 120 * 200 },
    sizes,
    now: 1_000 * HOUR,
    pinnedSpecVersions: [3],
  });

  assert.ok(report.stepsPerformed > MAX_REPORTED_STEPS, 'the fixture no longer reaches the cap');
  const listed = report.steps.filter((s) => s.kind !== 'refused');
  assert.equal(listed.length, MAX_REPORTED_STEPS, 'the step list is unbounded again');
  assert.ok(
    report.stepsPerformed - listed.length > 0,
    'nothing was elided, so `stepsPerformed` is not carrying the part the list dropped',
  );
  // The refusal is present despite arriving long after the cap was reached.
  assert.deepEqual(report.refusals.map((r) => [r.rung, r.at]), [['evict-pending-raw', 'pending-raw']]);
  assert.ok(
    report.steps.some((s) => s.kind === 'refused'),
    'the refusal is in `refusals` but not in `steps`, so the two lists disagree',
  );
  await db.delete();
});

test('a fold whose transaction ABORTS leaves no label — not in storage, not in the accumulator', async () => {
  // §9.2 obligation 1: *"The 'downsampled' label is written in the same storage transaction that
  // deletes the rows."* The transaction gave that for free until the per-rung `catch` was added:
  // `degradeOldestBucket` merged the incoming range into the caller's accumulator **before**
  // opening its transaction, and the throw used to end the pass, so the phantom label went nowhere.
  // With the pass continuing, the next rung — which commits — persisted the whole accumulator,
  // including a "downsampled" range whose rows had never been deleted. Measured before the repair:
  // `priceSamples` still held its rows *and* `meta.downsampled` claimed they had been folded.
  //
  // The direction is safe (fidelity under-claimed, never over-claimed) and it is still a persisted
  // claim about a deletion that did not happen — which is the whole reason the label is bound to
  // the delete rather than written beside it.
  const db = new LocalIndex(GENESIS);
  let refusedWrites = 0;
  // Armed after the fixture is written: the middleware has to be installed **before** `open()` to
  // reach the built stack at all, and an unconditional one would refuse the seeding too.
  let armed = false;
  db.use({
    stack: 'dbcore',
    name: 'refuse-hourly-writes',
    create: (down) => ({
      ...down,
      table: (name: string) => {
        const table = down.table(name);
        return {
          ...table,
          mutate: (req: { type: string }) => {
            // Only the *write* into `candles1h`, so the raw rung's transaction aborts while the
            // `candles1h` → `candles4h` rung — which deletes from this table and writes to
            // another — still commits and persists whatever the accumulator holds.
            if (armed && name === 'candles1h' && req.type !== 'delete' && req.type !== 'deleteRange') {
              refusedWrites += 1;
              return Promise.reject(new Error('the fold’s coarse write was refused'));
            }
            return table.mutate(req as Parameters<typeof table.mutate>[0]);
          },
        };
      },
    }),
  });
  await db.delete();
  await db.open();

  // Raw rung: one closed hour of samples over blocks 1..5, which is the fold that will abort.
  await db.priceSamples.bulkPut([sample(10, 1, 100), sample(20, 5, 200)]);
  // candles1h rung: four closed hourly bars over blocks 1000..1003, which roll up and commit.
  await db.candles1h.bulkPut([0, 1, 2, 3].map((h) => ({ ...hourly(h), fromBlock: 1000 + h, toBlock: 1000 + h })));
  armed = true;

  const report = await applyQuota(db, {
    budget: { ...platformBudget('desktop'), rawSampleBytes: 120, candleBytes: 120 },
    sizes: { priceSample: 120, candle: 120, event: 120, archiveRow: 120 },
    now: 100 * HOUR,
    pinnedSpecVersions: [3],
  });

  assert.ok(refusedWrites > 0, 'the middleware never refused a write, so nothing was under test');
  // The raw rung refused, in its place in the sequence — the behaviour the per-rung catch added.
  assert.deepEqual(report.refusals.map((r) => [r.rung, r.at]), [['downsample', 'raw']]);
  // Its rows are still there, which is what makes a label about them false.
  assert.equal(await db.priceSamples.count(), 2, 'the aborted fold deleted its rows anyway');
  // And no label claims otherwise — neither persisted nor reported. Blocks 1..5 are the raw fold's
  // span; the committed `candles1h` → `candles4h` fold covers 1000..1003 and is expected.
  const persisted = await readDownsampled(db);
  assert.deepEqual(
    persisted.filter((range) => range.fromBlock <= 5),
    [],
    'a label was persisted for a fold whose transaction rolled back',
  );
  assert.deepEqual(
    report.downsampled.filter((range) => range.fromBlock <= 5),
    [],
    'the report carries a label for a fold that did not happen',
  );
  // The later rung really did run and really did persist its own label, or this test proves
  // nothing about the accumulator being carried across rungs.
  assert.deepEqual(
    persisted.map((range) => [range.fromBlock, range.toBlock, range.resolution]),
    [[1000, 1003, 'candles4h']],
    'the committed fold’s own label is missing, so the accumulator was never persisted at all',
  );
  await db.delete();
});

test('a label that cannot be WRITTEN takes the delete with it (§9.2 obligation 1)', async () => {
  // The obligation in the direction the existing transaction test cannot reach. That test proves
  // `writeDownsampled` joins an ambient transaction — a property of the function. This one is
  // about the **ladder**: that the fold's own label write is inside the fold's own transaction.
  //
  // The two are distinguished by exactly one failure, and it is the one §9.2 names: the label
  // write fails after the delete has been issued. Inside the transaction, both roll back and the
  // rows survive; written afterwards, the delete stands and the label is lost — rows gone with
  // nothing saying so, which is the silent splice the sentence forbids, arriving from the code
  // whose job is to prevent it. Found by mutation: moving `writeDownsampled` after the `rw` block
  // survived the whole suite.
  const db = new LocalIndex(GENESIS);
  let refusedLabels = 0;
  let armed = false;
  db.use({
    stack: 'dbcore',
    name: 'refuse-meta-writes',
    create: (down) => ({
      ...down,
      table: (name: string) => {
        const table = down.table(name);
        return {
          ...table,
          mutate: (req: { type: string }) => {
            if (armed && name === 'meta' && req.type !== 'delete' && req.type !== 'deleteRange') {
              refusedLabels += 1;
              return Promise.reject(new Error('the downsampled label could not be written'));
            }
            return table.mutate(req as Parameters<typeof table.mutate>[0]);
          },
        };
      },
    }),
  });
  await db.delete();
  await db.open();
  await db.priceSamples.bulkPut([sample(10, 1, 100), sample(20, 5, 200)]);
  armed = true;

  const report = await applyQuota(db, {
    budget: { ...platformBudget('desktop'), rawSampleBytes: 120 },
    sizes: { priceSample: 120, candle: 120, event: 120, archiveRow: 120 },
    now: 100 * HOUR,
    pinnedSpecVersions: [3],
  });

  assert.ok(refusedLabels > 0, 'the middleware never refused a label write, so nothing was tested');
  assert.deepEqual(report.refusals.map((r) => [r.rung, r.at]), [['downsample', 'raw']]);
  const rows = await db.priceSamples.count();
  const labels = await readDownsampled(db);
  // The failing combination is `rows === 0 && labels === []`: the rows were freed and nothing
  // records it. Asserted as the two facts rather than as their conjunction, so a run that fails
  // says which half went wrong.
  assert.equal(rows, 2, 'the delete committed while its label did not — the silent splice §9.2 forbids');
  assert.deepEqual([...labels], [], 'a label was persisted although its write was refused');
  await db.delete();
});

test('a raw row the sparse index cannot reach refuses the BOUND, not the whole pass', async () => {
  // The third refusal, and the one that used to arrive first. `measureUsage` is the very first
  // call in `applyQuota` and it read the pending set through the sparse `pendingBlock` index, so
  // a single unreachable raw row threw before any rung ran: no chart ladder, no compaction, no
  // §6.5 bound, and no report — the index then grows without limit under a pass that said nothing.
  //
  // The division the repair draws: **eviction** needs the set enumerable *and oldest-first*, which
  // only the index gives, so it must refuse — an under-covering bound is worse than none.
  // **Measurement** needs neither, so it scans, which is the route that cannot miss. The refusal
  // survives exactly where it changes an outcome.
  const db = await freshDb();
  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };
  await db.events.put({
    id: rawEventId(41),
    blockNumber: 41,
    pallet: '(pending decoder)',
    name: '(era metadata unavailable)',
    decoded: false,
    raw: new Uint8Array(4_096),
    origin: 'self',
    // No `pendingBlock` — the shape a writer that forgot the field produces.
  } as Parameters<typeof db.events.put>[0]);
  await db.priceSamples.bulkPut([sample(10, 1, 100), sample(20, 2, 200), sample(HOUR + 10, 3, 300)]);

  const report = await applyQuota(db, {
    budget: { ...platformBudget('desktop'), rawSampleBytes: 120 },
    sizes,
    now: 100 * HOUR,
    pinnedSpecVersions: [3],
  });

  // Refused, named, and last — not first and not fatal.
  assert.deepEqual(
    report.refusals.map((r) => [r.rung, r.at]),
    [['evict-pending-raw', 'pending-raw']],
  );
  assert.match(nth(report.refusals, 0, 'refusal').reason, /cannot be reached by the 10 §9.1 bound/);
  // The chart ladder still ran — it shares no share with the events tier and never did.
  assert.ok(report.steps.some((s) => s.kind === 'downsample'), 'the pending-raw refusal skipped the chart ladder');
  // And the blob is still WEIGHED, so the share that is supposed to bound it can see it growing.
  // A measurement that quietly omitted the unreachable row would understate, which is the unsafe
  // direction: the events share would read as healthy while the tier §9.1 forbids kept growing.
  assert.equal(report.before.eventBytes, 4_096 + sizes.event);
  assert.equal(await pendingDecoderCount(db), 1, 'the refused bound deleted the row anyway');
  await db.delete();
});

test('compaction REFUSES a proposal whose events do not share the summary’s provenance', async () => {
  // §9.2 obligation 3: *"Provenance is never degraded on the way … the ladder degrades resolution
  // and may not relabel a source to do it."* `proposalsArchive` is keyed by proposal alone (§7),
  // so one settled proposal gets one summary — and the summary's origin was whatever the caller
  // supplied, with nothing comparing it against the rows it replaces. A proposal spanning a
  // self-ingested range and an operator-backfilled one therefore collapsed into a single row
  // rendering under one badge.
  const db = await freshDb();
  await db.events.bulkPut([
    { id: '1:0', blockNumber: 1, pallet: 'Epoch', name: 'ProposalSettled', decoded: true as const, origin: 'self' as const },
    {
      id: '2:0',
      blockNumber: 2,
      pallet: 'Epoch',
      name: 'ProposalSettled',
      decoded: true as const,
      origin: 'operator' as const,
      providerId: 'op-1',
    },
  ]);
  const proposal: SettledProposal = {
    proposalId: 'p-mixed',
    settledAt: 99,
    fromBlock: 1,
    toBlock: 2,
    summary: 'settled: PASS',
    eventIds: ['1:0', '2:0'],
    provenance: { origin: 'self' },
  };
  await assert.rejects(() => compactSettledEvents(db, proposal), /one summary cannot carry two origins/);
  assert.equal(await db.events.count(), 2, 'the refused compaction deleted the events anyway');
  assert.equal(await db.proposalsArchive.count(), 0);

  // The single-provenance case still compacts, so this is not a refusal that stops the ladder.
  assert.equal(
    await compactSettledEvents(db, { ...proposal, eventIds: ['1:0'], toBlock: 1 }),
    1,
  );
  // ...and a summary claiming a provenance none of its events carries is refused too — the same
  // mislabelling, arriving from a caller that named one source for rows from another.
  await assert.rejects(
    () =>
      compactSettledEvents(db, {
        ...proposal,
        eventIds: ['2:0'],
        fromBlock: 2,
        provenance: { origin: 'indexer', providerId: 'acme' },
      }),
    /relabelling a source/,
  );
  await db.delete();
});

test('§9.2’s shares are USER-ADJUSTABLE locally, and an incoherent table is refused', async () => {
  // §9.2 writes them as *"fixed internal shares (user-adjustable locally)"*, and the parenthesis
  // had no path: `QUOTA_SHARES` was frozen and `platformBudget` took no argument, so half the
  // sentence was published and half was not.
  const adjusted: QuotaShares = {
    rawSamples: 0.3,
    candles: 0.5,
    eventsAndArchive: 0.15,
    metadata: 0.05,
  };
  const budget = platformBudget('desktop', adjusted);
  assert.equal(budget.rawSampleBytes, 0.3 * 300 * 1000 * 1000);
  assert.equal(budget.candleBytes, 0.5 * 300 * 1000 * 1000);
  assert.deepEqual(budget.shares, adjusted);
  // The default is unchanged and is still §9.2's published table.
  assert.deepEqual(platformBudget('desktop').shares, QUOTA_SHARES);

  // A table that does not sum to the cap either strands budget or over-commits it, and neither
  // is visible from any single row — so it is refused rather than normalised.
  assert.throws(() => platformBudget('desktop', { ...adjusted, candles: 0.6 }));
  assert.throws(() => platformBudget('desktop', { ...adjusted, rawSamples: 0.2 }));
  assert.equal(quotaSharesAgree({ ...adjusted, metadata: 0 }), false, 'a zero share makes a tier weightless');

  // What a local preference cannot do is raise the metadata cache past §9.3's own bound — the
  // `min` still applies, so adjustability reaches the share and not the section that bounds it.
  const greedy = platformBudget('desktop', {
    rawSamples: 0.3,
    candles: 0.3,
    eventsAndArchive: 0.2,
    metadata: 0.2,
  });
  assert.equal(greedy.metadataBytes, METADATA_BOUND.desktop.bytes);
  await Promise.resolve();
});

test('the pending-decode blobs are bounded by the EVENTS share, and the pass says so', async () => {
  // §6.5 requires an undecodable block's `System.Events` value to be kept raw; §9.1 forbids
  // retaining chain-wide event data, and one such blob is exactly that — a whole block's events
  // regardless of the watched set, on the path that is the *expected* state of any backfill
  // across a runtime upgrade. `compactSettledEvents` cannot reach these rows and the chart ladder
  // has no rung for them, so the quota pass is where the bound has to be.
  const db = await freshDb();
  for (const block of [10, 20, 30]) {
    await db.events.put({
      id: rawEventId(block),
      blockNumber: block,
      pendingBlock: block,
      pallet: '(pending decoder)',
      name: '(era metadata unavailable)',
      decoded: false as const,
      raw: new Uint8Array(1_000_000),
      origin: 'self' as const,
    });
  }
  // A share that admits one blob and a row size small enough that the modelled overhead is not
  // what binds — the blobs are measured, so the share sees them growing.
  const budget = { ...platformBudget('desktop'), eventBytes: 1_500_000 };
  const sizes: RowSizes = { priceSample: 120, candle: 120, event: 120, archiveRow: 120 };
  const report = await applyQuota(db, { budget, sizes, now: 100 * HOUR, pinnedSpecVersions: [3] });

  const step = report.steps.find((s) => s.kind === 'evict-pending-raw');
  assert.ok(step, 'the raw blobs grew past their share with no rung able to reach them');
  // An envelope and a count — §9.2 calls the ladder "user-visible", and the desktop events share
  // admits on the order of 225,000 of these blobs, so the list is the thing being bounded.
  assert.deepEqual(
    step.kind === 'evict-pending-raw'
      ? { blocks: step.blocks, oldestBlock: step.oldestBlock, newestBlock: step.newestBlock }
      : undefined,
    { blocks: 2, oldestBlock: 10, newestBlock: 20 },
  );
  assert.equal(await pendingDecoderCount(db), 1);
  assert.ok(report.after.eventBytes <= budget.eventBytes);

  // Labelled in the same transaction as the delete: an unlabelled drop is a silent splice.
  const record = await readPendingRawEvicted(db);
  assert.ok(record, 'the eviction left nothing that could explain what the user lost');
  assert.equal(record.blocks, 2);
  await db.delete();
});
