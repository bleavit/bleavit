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
  writeCoverage,
  writeDownsampled,
} from '@bleavit/local-index';
import {
  TX_PATH_TABLES,
  evictMetadataToBudget,
  laddersAgree,
  mergeDownsampled,
  nextResolution,
  readMetadataBlob,
} from '@bleavit/local-index';
import type { PriceSample, RowSizes, SettledProposal } from '@bleavit/local-index';
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
  assert.notEqual(nth(labels, 0, 'label').resolution, 'raw');
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
  // a daily row costs `books × 120 B/day` even at max load.
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
  // Running out of rungs is a **reported outcome**, not a throw: §9.2 states plainly that deep
  // the raw tier is genuinely thin against a fully-subscribed hosted partition, so a quota
  // manager that threw here would turn a budgeted state into a crash on the busiest chain.
  assert.equal(typeof report.exhausted, 'boolean');
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
  await db.snapshotsImported.put({ id: 's-1', providerId: 'acme', importedAt: 1, fromBlock: 1, toBlock: 2 });
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
  await db.metadataCache.put({ specVersion: 3, bytes: 12_345, lastUsedAt: 1, blob: new Uint8Array(1) });
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
    { specVersion: 1, bytes: 400, lastUsedAt: 1, blob: new Uint8Array([1]) },
    { specVersion: 2, bytes: 400, lastUsedAt: 2, blob: new Uint8Array([2]) },
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
  // §9.2 states that running out of room is *"a reported outcome"* — deep raw history "is not
  // achievable within the caps" at max load — so an unbounded loop is not an admissible failure
  // mode for it, and a retention pass that never returns takes the tab with it. Every other
  // termination condition in that loop is a property of *other* code; this is the one that is
  // a property of the loop.
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
