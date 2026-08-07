/**
 * 10 §9.4's *IndexedDB growth* row, where it is actually enforced — §9.2, §9.3; INV-FE-7. F14.
 *
 * ## The defect this suite is written against
 *
 * §9.4 budgets *"§9.2 caps (300 MB / 75 MB) with auto-tuned retention"* and names its
 * enforcement *"quota manager + tests"*. The manager existed in full — caps, the four shares,
 * the ladder, the labels, the refusals — with **1,146 lines of tests behind it and no caller
 * outside them**. Nothing in `app/src` imported it, so on a running client the cap was held by
 * nothing at all, and every gate over the numbers passed because every number was right.
 *
 * That is why the cases below are not about the ladder's behaviour, which
 * `tests/local-index/quota.test.ts` owns. They are about the three things a threshold binding
 * structurally cannot see:
 *
 * 1. the manager **runs** on the client's own boot path, against a real database;
 * 2. the cap it runs against is §9.2's, chosen by a classification that **fails closed**;
 * 3. what it did **reaches a surface**, because §9.2 calls the ladder *"deterministic and
 *    user-visible"* and a deletion nobody is told about is the one outcome that clause forbids.
 *
 * Run against a real IndexedDB (`fake-indexeddb`) for the reason the package's own suite gives:
 * three of the properties are about transactions, and a stub grants those for free.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import 'fake-indexeddb/auto';

import {
  IndexBootDisclosure,
  MODELLED_ROW_BYTES,
  MODELLED_ROW_SIZES,
  bootLocalIndex,
  cannotObserve,
  deviceHints,
  enforceStorageBudget,
  retentionDisclosure,
  storagePlatform,
  type IndexChainIdentity,
  type RetentionOutcome,
} from '@bleavit/features-analysis';
import {
  LocalIndex,
  QUOTA_SHARES,
  STORAGE_CAP_BYTES,
  ingestLockName,
  platformBudget,
  priceSample,
  rawEventId,
  readDownsampled,
  readPendingRawEvicted,
  type LockManagerLike,
} from '@bleavit/local-index';
import { releaseMetadataPins, releaseParaChain } from '@bleavit/application';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../..');
const REPO = resolve(HERE, '../../..');

const appSource = (relative: string): string => readFileSync(join(APP, relative), 'utf8');

const architecture = (doc: string): string =>
  readFileSync(join(REPO, 'docs/architecture', doc), 'utf8');

/** Source with comments removed, so a name inside a doc comment is not read as code. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * Every module of the client, swept rather than listed.
 *
 * Two cases below assert that something is named in exactly **one** place, and a hand-written
 * list makes those assertions satisfiable by adding a file. `node_modules` is excluded because
 * the workspace links every package into each unit's own tree, so the sweep would otherwise
 * report the package sources four times over under different paths.
 */
function clientModules(): readonly string[] {
  return readdirSync(join(APP, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.tsx?$/.test(entry))
    .filter(
      (entry) => !entry.split('/').includes('dist') && !entry.split('/').includes('node_modules'),
    )
    .map((entry) => join('src', entry));
}

const HOUR = 3_600;

/** The pinned chain these cases open an index for. Any valid genesis; the lock is scoped to it. */
const CHAIN: IndexChainIdentity = { kind: 'pinned', paraGenesisHash: `0x${'e5'.repeat(32)}` };

/**
 * A Web Locks stand-in that always grants — the ordinary single-tab case.
 *
 * Structural rather than the real API, which is what `LockManagerLike` is for: the branch that
 * has to be tested is the one a happy-path environment never enters, and `fake-indexeddb` brings
 * no `navigator.locks` with it.
 */
function freeLock(): LockManagerLike {
  return {
    request: async (_name, _options, callback) => {
      await callback({});
    },
  };
}

/** A Web Locks stand-in that is always held by somebody else — `ifAvailable`'s `null`. */
function heldLock(): LockManagerLike {
  return {
    request: async (_name, _options, callback) => {
      await callback(null);
    },
  };
}

/** A database of its own per case, so one case's rows cannot decide another's outcome. */
async function freshDb(tag: string): Promise<LocalIndex> {
  const db = new LocalIndex(`0x${tag.repeat(32).slice(0, 64)}`);
  await db.delete();
  await db.open();
  return db;
}

const sample = (at: number, block: number): ReturnType<typeof priceSample> =>
  priceSample({
    bookId: 'book-1',
    blockNumber: block,
    blockTimestampMs: at * 1000,
    price1e9: BigInt(block),
    origin: 'self',
  });

// ------------------------------------------------------- the pass runs, against §9.2's cap

test('the budget in force is §9.2’s own cap and §9.2’s own shares, on a real database', async () => {
  // The cap is derived from `platformBudget` rather than passed in, because it is those figures
  // that have to be under test: a case handing the pass its own budget would prove the ladder
  // works and say nothing about which cap a running client holds.
  const db = await freshDb('a1');
  const rows = 40;
  for (let i = 0; i < rows; i += 1) await db.priceSamples.put(sample(i * HOUR, i + 1));

  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: { platform: 'mobile', why: 'this case pins the platform rather than sniffing one' },
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: (rows + 2) * HOUR,
  });
  assert.equal(outcome.kind, 'applied');
  if (outcome.kind !== 'applied') return;
  assert.equal(outcome.budget.capBytes, STORAGE_CAP_BYTES.mobile);
  assert.equal(outcome.budget.rawSampleBytes, STORAGE_CAP_BYTES.mobile * QUOTA_SHARES.rawSamples);
  assert.equal(outcome.budget.eventBytes, STORAGE_CAP_BYTES.mobile * QUOTA_SHARES.eventsAndArchive);
  // 40 rows at §9.1's 120 B model is far inside a 45 MB share, so nothing is folded — asserted
  // rather than glossed over, because an unchanged database is the honest result here and the
  // next case is the one that proves a rung can still reach the rows.
  assert.equal(outcome.report.exhausted, false);
  assert.deepEqual(outcome.report.refusals, []);
  assert.equal(await db.priceSamples.count(), rows);
  db.close();
  await db.delete();
});

test('an over-budget events share is cut by the client’s own call, and the loss is recorded', async () => {
  // A rung that really deletes, reached through the production entry point rather than through
  // `applyQuota`. §9.1's raw-blob bound is the rung a case can reach at a realistic size: each
  // blob is a whole block's `System.Events`, so four of them exceed mobile's 11.25 MB events
  // share, where the *modelled* tiers would need hundreds of thousands of rows.
  const db = await freshDb('b2');
  const blob = 4 * 1000 * 1000;
  for (const block of [10, 11, 12, 13]) {
    await db.events.put({
      id: rawEventId(block),
      blockNumber: block,
      pallet: 'System',
      name: 'Events',
      origin: 'self',
      decoded: false,
      raw: new Uint8Array(blob),
      pendingBlock: block,
    });
  }
  const share = STORAGE_CAP_BYTES.mobile * QUOTA_SHARES.eventsAndArchive;
  assert.ok(4 * blob > share, 'the fixture no longer exceeds the events share it is sized against');

  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: { platform: 'mobile', why: 'pinned by this case' },
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 20 * HOUR,
  });
  assert.equal(outcome.kind, 'applied');
  if (outcome.kind !== 'applied') return;

  // Oldest first, and only as far as the bound requires: 16 MB down to 8 MB is two blocks.
  const left = await db.events.count();
  assert.equal(left, 2);
  assert.ok(outcome.report.after.eventBytes <= outcome.budget.eventBytes);
  assert.ok(outcome.report.after.eventBytes < outcome.report.before.eventBytes);
  const step = outcome.report.steps.find((s) => s.kind === 'evict-pending-raw');
  assert.ok(step !== undefined, 'the pass deleted rows and reported no step for it');

  // §9.2 calls the ladder user-visible, and this rung's record is the one the boot surface
  // already renders. A deletion with no record is the outcome that clause forbids.
  const record = await readPendingRawEvicted(db);
  assert.ok(record !== undefined, 'raw blobs were discarded and nothing recorded it');
  assert.equal(record.blocks, 2);
  assert.equal(record.oldestBlock, 10);

  // And the **sequence** reaches the screen, not only the count. §9.2 calls the ladder
  // *"deterministic and user-visible"* and `QuotaReport.steps` is what renders it; a report whose
  // step list has no reader is the producer-with-no-reader shape this milestone is about, in the
  // milestone that is about it. Summarised per rung, because one `downsample` step is one folded
  // bucket and a full desktop pass is thousands of them.
  const html = renderToStaticMarkup(
    h(IndexBootDisclosure, {
      state: { kind: 'not-opened', reason: 'this case renders the retention arm' },
      retention: outcome,
    }),
  );
  assert.ok(html.includes('Degraded: evict-pending-raw'), html);
  assert.ok(html.includes('1 time(s) in this pass'), html);
  db.close();
  await db.delete();
});

test('the metadata pins are the cache’s own keys when no runtime can be named', async () => {
  // §9.3 pins the current and next-authorized runtimes non-evictable and both are chain facts.
  // A client that has read nothing would otherwise supply an empty pinned set — which does not
  // mean "nothing to pin", it means "every blob may go" — and the first pass of an unsynced
  // session would drop the era the next block needs under the 3-blob mobile bound.
  const db = await freshDb('c3');
  // Sized so the **count** bound is the one that binds: four blobs of 0.5 MB are 2 MB against
  // §9.3's 3.75 MB mobile byte bound and four rows against its 3-blob bound. The pinned case
  // below and this control therefore differ in the pinned set alone.
  const bytes = 500 * 1000;
  for (const specVersion of [1, 2, 3, 4]) {
    await db.metadataCache.put({
      specVersion,
      blob: new Uint8Array([1]),
      bytes,
      lastUsedAt: specVersion,
      origin: 'self',
    });
  }
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: { platform: 'mobile', why: 'pinned by this case' },
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 10 * HOUR,
  });
  assert.equal(outcome.kind, 'applied');
  if (outcome.kind !== 'applied') return;
  // Four blobs against a 3-blob bound: with an empty pinned set the LRU rung would delete one.
  // Everything present is pinned instead, so the rung refuses and **nothing is evicted**.
  assert.equal(await db.metadataCache.count(), 4);
  const refusal = outcome.report.refusals.find((step) => step.rung === 'evict-metadata');
  assert.ok(refusal !== undefined, 'the metadata rung neither evicted nor refused');
  // And the refusal does not end the pass: §9.2's order is a guarantee about what is degraded
  // first, not a licence to skip everything after the first rung that says no.
  assert.equal(outcome.report.after.metadataBytes, 4 * bytes);
  db.close();
  await db.delete();
});

test('an empty pinned set is what the union makes unreachable, and it would evict', async () => {
  // The negative control for the case above. Without it that assertion is satisfied by a
  // manager that never evicts metadata at all, and the pinning would be proving nothing.
  const db = await freshDb('d4');
  // The same fixture as the case above, to the byte: the two differ in the pinned set alone.
  const bytes = 500 * 1000;
  for (const specVersion of [1, 2, 3, 4]) {
    await db.metadataCache.put({
      specVersion,
      blob: new Uint8Array([1]),
      bytes,
      lastUsedAt: specVersion,
      origin: 'self',
    });
  }
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: { platform: 'mobile', why: 'pinned by this case' },
    pins: { kind: 'named', specVersions: [] },
    now: 10 * HOUR,
  });
  assert.equal(outcome.kind, 'applied');
  if (outcome.kind !== 'applied') return;
  assert.equal(await db.metadataCache.count(), 3);
  assert.deepEqual(outcome.report.refusals, []);
  db.close();
  await db.delete();
});

test('a database that goes away becomes a reported outcome, never a thrown boot', async () => {
  // INV-FE-7 makes local storage loss "a performance and convenience event only", so the boot
  // path may not throw here for the same reason `bootLocalIndex` may not. The arm is
  // `interrupted` rather than `not-run` because a pass was attempted — see the case below, which
  // is the same failure reached with a resolvable pinned set.
  const db = await freshDb('e5');
  db.close();
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: { platform: 'desktop', why: 'pinned by this case' },
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 10 * HOUR,
  });
  assert.equal(outcome.kind, 'interrupted');
  assert.ok(outcome.kind === 'interrupted' && outcome.reason.length > 0);
  await db.delete();
});

test('no database means no pass, and that is not the same as being inside the budget', async () => {
  const outcome = await enforceStorageBudget(undefined, {
    chain: CHAIN,
    locks: freeLock(),
    profile: { platform: 'desktop', why: 'pinned by this case' },
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 10 * HOUR,
  });
  assert.equal(outcome.kind, 'not-run');
});

// -------------------------------------------------------- one writer, because the pass deletes

test('a tab that cannot take fut-ingest defers, and writes nothing', async () => {
  // 10 §4.4 gives the writer role to the leader. The race this closes is §9.2 obligation 1's:
  // `applyQuota` reads the `downsampled` accumulator once and each fold writes the whole set
  // back, so two passes together let the later one erase a label whose rows the earlier already
  // deleted — the silent splice, produced by a user having the app open twice.
  const db = await freshDb('d1');
  for (let i = 0; i < 20; i += 1) await db.priceSamples.put(sample(i * HOUR, i + 1));
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: heldLock(),
    profile: storagePlatform({ mobile: true }),
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 30 * HOUR,
  });
  assert.equal(outcome.kind, 'deferred');
  // And it is not `applied`: a deferred tab did not measure and must not report a budget.
  assert.ok(outcome.kind === 'deferred' && outcome.reason.includes('another tab'));
  assert.equal(await db.priceSamples.count(), 20);
  db.close();
  await db.delete();
});

test('the lock is scoped to the chain, so two chains are two writers not one', () => {
  // A single global lock would let a tab indexing one chain block a tab indexing another for no
  // reason, and the scoping has to be the database's own or the lock and the thing it guards
  // disagree about what "one writer" means.
  assert.notEqual(ingestLockName(CHAIN.paraGenesisHash), ingestLockName(`0x${'a1'.repeat(32)}`));
  assert.ok(ingestLockName(CHAIN.paraGenesisHash).startsWith('fut-ingest@'));
});

test('no Web Locks means no pass, and nothing is written unlocked', async () => {
  // The package refuses to *ingest* without the API, so on such an environment nothing writes to
  // the index and there is nothing accumulating for a budget to hold back. Running the ladder
  // unlocked instead would be the one code path nobody tests doing the thing the lock prevents.
  const db = await freshDb('e2');
  for (let i = 0; i < 10; i += 1) await db.priceSamples.put(sample(i * HOUR, i + 1));
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: undefined,
    profile: storagePlatform({ mobile: true }),
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 30 * HOUR,
  });
  assert.equal(outcome.kind, 'not-run');
  assert.ok(outcome.kind === 'not-run' && outcome.reason.includes('Web Locks'));
  assert.equal(await db.priceSamples.count(), 10);
  db.close();
  await db.delete();
});

test('an unresolvable pinned set costs the metadata rung and not the whole ladder', async () => {
  // The defect `applyQuota` was rewritten one level down to remove, reintroduced one level up:
  // a metadata-cache condition abandoning the chart ladder and §9.1's raw-blob bound. Fail-OPEN
  // on the cap this row enforces, which is the direction that matters.
  //
  // The pin resolution is made to fail by putting a key `cachedSpecVersions` refuses into the
  // cache — the one condition it throws on.
  const db = await freshDb('f3');
  // A string key where a spec version belongs. `cachedSpecVersions` refuses rather than
  // filtering, because a short pinned set is an eviction of the row it omitted.
  //
  // Written through the untyped `table()` handle rather than through a double assertion: 10
  // §2.1's cast gate bans `as unknown as` outright, and it is right to — the row this case needs
  // is one the declared type forbids, which is exactly what a corrupt store holds and exactly
  // what a cast would let a *production* module mint.
  await db.table('metadataCache').put({
    specVersion: 'not-a-version',
    blob: new Uint8Array([1]),
    bytes: 1000,
    lastUsedAt: 1,
    origin: 'self',
  });
  const blob = 4 * 1000 * 1000;
  for (const block of [10, 11, 12, 13]) {
    await db.events.put({
      id: rawEventId(block),
      blockNumber: block,
      pallet: 'System',
      name: 'Events',
      origin: 'self',
      decoded: false,
      raw: new Uint8Array(blob),
      pendingBlock: block,
    });
  }
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: { platform: 'mobile', why: 'pinned by this case' },
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 20 * HOUR,
  });
  assert.equal(outcome.kind, 'applied', 'a metadata-cache condition ended the whole pass');
  if (outcome.kind !== 'applied') return;
  // The metadata rung was made inert — nothing cached was discarded on an unknown pinned set —
  // and the fact is carried where a surface can state it.
  assert.ok(outcome.metadataRungSkipped !== undefined);
  assert.equal(await db.metadataCache.count(), 1);
  // And §9.1's raw-blob bound still ran, which is the tier the section forbids retaining.
  assert.equal(await db.events.count(), 2);
  // The **published** budget travels on the outcome, never the widened one handed to the pass.
  assert.equal(outcome.budget.metadataBlobs, platformBudget('mobile').metadataBlobs);
  db.close();
  await db.delete();
});

test('a pass that stops part-way never says nothing was removed', async () => {
  // `applyQuota` can throw AFTER committed folds — its closing `measureUsage`/`measureDepth`/
  // `budgetHolds` all run once the ladder has already deleted rows — so a caught throw may not
  // claim nothing was removed. It cannot say how much was, either, and that is what it says.
  const db = await freshDb('a4');
  db.close();
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: storagePlatform({ mobile: true }),
    pins: { kind: 'named', specVersions: [] },
    now: 10 * HOUR,
  });
  assert.equal(outcome.kind, 'interrupted');
  const html = renderToStaticMarkup(
    h(IndexBootDisclosure, {
      state: { kind: 'not-opened', reason: 'this case renders the interrupted arm' },
      retention: outcome,
    }),
  );
  assert.ok(html.includes('data-disclosure="storage-retention-interrupted"'), html);
  assert.ok(html.includes('cannot say how much'), html);
  assert.ok(!html.includes('nothing local was folded or removed'), html);
  await db.delete();
});

// ------------------------------------------------- the classification, and its safe direction

test('an unknown form factor takes the smaller cap, which is the direction §9.2 survives', () => {
  // `platformBudget` takes its platform as a required argument precisely because the unsafe
  // default is the desktop one — four times the storage on the device most likely to have none.
  // Every environment that publishes no hint lands here, including this test process.
  const unknown = storagePlatform({ mobile: undefined });
  assert.equal(unknown.platform, 'mobile');
  assert.equal(platformBudget(unknown.platform).capBytes, STORAGE_CAP_BYTES.mobile);
  assert.ok(unknown.why.includes('75 MB'), unknown.why);

  assert.equal(storagePlatform({ mobile: true }).platform, 'mobile');
  assert.equal(storagePlatform({ mobile: false }).platform, 'desktop');
  assert.equal(
    platformBudget(storagePlatform({ mobile: false }).platform).capBytes,
    STORAGE_CAP_BYTES.desktop,
  );
});

test('the hint is read structurally, and anything that is not a boolean is no hint at all', () => {
  assert.equal(deviceHints(undefined).mobile, undefined);
  assert.equal(deviceHints(null).mobile, undefined);
  assert.equal(deviceHints({}).mobile, undefined);
  assert.equal(deviceHints({ userAgentData: null }).mobile, undefined);
  assert.equal(deviceHints({ userAgentData: {} }).mobile, undefined);
  // A truthy non-boolean is the shape that would otherwise classify a laptop as a phone, or a
  // phone as a laptop, through one `!!`.
  assert.equal(deviceHints({ userAgentData: { mobile: 'yes' } }).mobile, undefined);
  assert.equal(deviceHints({ userAgentData: { mobile: true } }).mobile, true);
  assert.equal(deviceHints({ userAgentData: { mobile: false } }).mobile, false);
});

// -------------------------------------------------------------- §9.1's row model, named once

test('the client charges §9.1’s published per-row figure, and charges it to every table', () => {
  // The package refuses a default because §9.1 labels the figure a modelling assumption, so
  // exactly one module in the client names it. Bound to the document here as well as by
  // `tools/ci/check-frontend-budgets.py`, because the two catch different edits: the gate sees
  // the constant, and this sees the four tables it is charged to.
  const nine = architecture('10-frontend-architecture.md');
  const published = /~(\d+) B effective per row/.exec(nine);
  assert.ok(published !== null, '10 §9.1 no longer publishes a per-row model');
  assert.equal(MODELLED_ROW_BYTES, Number(published[1]));
  assert.deepEqual(Object.values(MODELLED_ROW_SIZES), [
    MODELLED_ROW_BYTES,
    MODELLED_ROW_BYTES,
    MODELLED_ROW_BYTES,
    MODELLED_ROW_BYTES,
  ]);
  // A zero or absent size makes its table weightless, so the ladder never reaches it and the
  // budget is enforced against a figure that omits the largest table.
  for (const [name, value] of Object.entries(MODELLED_ROW_SIZES)) {
    assert.ok(Number.isFinite(value) && value > 0, `${name} is not a positive byte count`);
  }
});

// ------------------------------------------------------------------ the pass reaches a screen

test('what the pass did reaches the screen, including the depth §9.2 makes a MUST', async () => {
  const db = await freshDb('f6');
  for (let i = 0; i < 30; i += 1) await db.priceSamples.put(sample(i * HOUR, i + 1));
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: storagePlatform({ mobile: false }),
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 40 * HOUR,
  });
  assert.equal(outcome.kind, 'applied');
  const html = renderToStaticMarkup(
    h(IndexBootDisclosure, {
      state: { kind: 'not-opened', reason: 'this case renders the retention arm' },
      retention: outcome,
    }),
  );
  assert.ok(html.includes('data-disclosure="storage-retention"'), html);
  assert.ok(html.includes('300.0 MB'), html);
  // §9.2: "a client MUST present it as measured-and-current rather than as a promise". The
  // measured depth is rendered, and the budgeted depth beside it is derived from this device's
  // own rate — never from one of §9.2's four published planning columns.
  assert.ok(html.includes('Raw price history held now'), html);
  assert.ok(html.includes('Raw price history this budget admits'), html);
  assert.ok(html.includes('1.2 days'), html);
  db.close();
  await db.delete();
});

test('an unmeasurable rate renders as a stated absence, never as an unlimited depth', async () => {
  // One row has no span to divide by. A rate invented there produces a budgeted depth of
  // infinity, which is the one number this field must never report — so the copy says why.
  const db = await freshDb('a7');
  await db.priceSamples.put(sample(HOUR, 1));
  const outcome = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: storagePlatform({ mobile: undefined }),
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 10 * HOUR,
  });
  assert.equal(outcome.kind, 'applied');
  const items = retentionDisclosure(outcome);
  const admits = items[0]?.facts.find((fact) => fact.label.includes('this budget admits'));
  assert.ok(admits !== undefined, 'the budgeted-depth fact is not rendered');
  assert.ok(admits.value.includes('not measurable yet'), admits.value);
  assert.ok(!admits.value.includes('Infinity'), admits.value);
  db.close();
  await db.delete();
});

test('a pass that never ran never renders as one that found nothing to do', () => {
  const notRun: RetentionOutcome = { kind: 'not-run', reason: 'no local index was opened' };
  const items = retentionDisclosure(notRun);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, 'storage-retention-not-run');
  const html = renderToStaticMarkup(
    h(IndexBootDisclosure, {
      state: { kind: 'not-opened', reason: 'no chain is pinned' },
      retention: notRun,
    }),
  );
  assert.ok(html.includes('data-disclosure="storage-retention-not-run"'), html);
  assert.ok(!html.includes('data-disclosure="storage-retention"'), html);
  // The sentence has to say the difference out loud, because "no budget applied" reads as
  // "you are inside your budget" to anyone who is not looking for the distinction.
  assert.ok(html.includes('nothing was measured'), html);
});

test('both retention sentences cite a section 10 really has, and neither is awaiting a ruling', async () => {
  const db = await freshDb('b8');
  await db.priceSamples.put(sample(HOUR, 1));
  const applied = await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: storagePlatform({ mobile: true }),
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 10 * HOUR,
  });
  const items = [
    ...retentionDisclosure(applied),
    ...retentionDisclosure({ kind: 'not-run', reason: 'nothing opened' }),
  ];
  assert.equal(items.length, 2);
  const nine = architecture('10-frontend-architecture.md');
  for (const item of items) {
    // §9.2 supplies the rule *and* the words — it states what the ladder degrades and what it
    // never touches — so neither slot may wait on a ruling the way FE-IDX-002's four do.
    assert.equal(item.copy.kind, 'stated');
    if (item.copy.kind !== 'stated') continue;
    assert.equal(item.copy.cite, '10 §9.2');
    assert.match(nine, /^#{2,4} 9\.2[ .]/m, '10 no longer has a §9.2');
    assert.ok(item.copy.text.length > 0);
  }
  db.close();
  await db.delete();
});

// ------------------------------------------------------------------------- the wiring itself

test('the composition root applies the storage budget, and against the handle it just opened', () => {
  // The finding this milestone exists to close: the manager implemented every clause of §9.2
  // and `app/src` never imported it. A behavioural case cannot see that — it calls the function
  // itself — so the claim is made a property of the composition root's source.
  const boot = withoutComments(appSource('src/application/src/boot.tsx'));
  assert.ok(boot.includes('enforceStorageBudget('), 'boot.tsx applies no storage budget');
  assert.ok(boot.includes('releaseMetadataPins()'), 'boot.tsx invents a metadata pin set');
  assert.ok(
    boot.includes('storagePlatform(deviceHints('),
    'boot.tsx does not classify the device, so it cannot have chosen a cap',
  );
  // The handle from the boot open, not a second `new LocalIndex(...)`: two construction sites
  // are two databases and two coverage writers, which §6.5's single-writer lock exists to stop.
  assert.match(
    boot,
    /const \{ state: [A-Za-z]+, db \} = await bootLocalIndex\(/,
    'boot.tsx does not take the database handle the boot check opened',
  );
  assert.ok(!/new LocalIndex\(/.test(boot), 'boot.tsx constructs its own index');
});

test('the quota manager has exactly one production call site, and one row model', () => {
  // The opposite failure to the one above, and as bad: two entry points are two platform
  // classifications, two row models and two pinned sets, which can disagree on the same device.
  //
  // **Swept, not hand-listed.** The first version of this case named three files and asserted the
  // absence of `applyQuota(` in each, which a new module under `src/features/analysis/` passes by
  // existing. Its own neighbour two cases down already used the recursive sweep, so the weaker
  // form was not even a cheaper one.
  const OWNER = 'src/features/analysis/src/index-quota.ts';
  const callers = clientModules().filter((file) =>
    /\bapplyQuota\s*\(/.test(withoutComments(appSource(file))),
  );
  assert.deepEqual(callers, [OWNER], 'the quota manager is applied from more than one module');
  assert.equal((withoutComments(appSource(OWNER)).match(/applyQuota\(/g) ?? []).length, 1);

  // And §9.1's row model has one home for the same reason — §9.4's own cell now claims it does,
  // which is a claim nothing enforced until this line.
  const models = clientModules().filter((file) =>
    /MODELLED_ROW_(BYTES|SIZES)\s*[:=]/.test(withoutComments(appSource(file))),
  );
  assert.deepEqual(models, [OWNER], '§9.1’s per-row model is declared in more than one module');
});

test('this release names no runtime to pin, and the client says exactly that', () => {
  // Bound to the wiring rather than asserted: the day a chain read lands, the `unnameable` arm
  // has to be replaced by the current and next-authorized spec versions §9.3 names.
  const pins = releaseMetadataPins();
  assert.equal(pins.kind, 'unnameable');
  assert.ok(pins.kind === 'unnameable' && pins.reason.length > 0);
  assert.equal(releaseParaChain().kind, 'unpinned');
});

test('nothing in this client drives an ingest run yet, which is what makes boot the only pass', async () => {
  // §9.2 computes retention from the *measured* ingest rate, and the boot path is the client's
  // only live moment with an open index. The day `app/src` drives `runIngest` — F18's light
  // client — a session can ingest for hours between boots, and this assertion fails so the
  // retention pass has to be added beside the run rather than being discovered missing.
  const modules = clientModules();
  assert.ok(modules.length > 20, `only ${modules.length} client modules were scanned`);
  const drivers = modules.filter((file) => /\brunIngest\s*\(/.test(withoutComments(appSource(file))));
  assert.deepEqual(
    drivers,
    [],
    'an ingest run exists in the client; 10 §9.2 needs a retention pass beside it, not only at boot',
  );
});

test('the boot path really does open no index today, so the pass is reachable and unreached', async () => {
  // The honest current state, stated rather than implied: `releaseParaChain()` is unpinned, so
  // `bootLocalIndex` opens nothing and the budget has nothing to apply to. It is the same
  // pre-genesis state `check:artifact-budget` gates on, and it is bound in `index-disclosure`
  // to `release-sources.json` so a pinned genesis fails that suite rather than this one.
  const chain = releaseParaChain();
  const { state, db } = await bootLocalIndex(chain, cannotObserve);
  assert.equal(state.kind, 'not-opened');
  // The release's own values throughout, not this file's fixtures — the whole point is that the
  // shipped composition reaches `not-run` for a stated reason rather than by an omission.
  const outcome = await enforceStorageBudget(db, {
    chain,
    locks: freeLock(),
    profile: storagePlatform(deviceHints(globalThis.navigator)),
    pins: releaseMetadataPins(),
    now: 10 * HOUR,
  });
  assert.equal(outcome.kind, 'not-run');
});

test('a pass that frees nothing writes no §9.2 label, so a label always means a delete', async () => {
  // §9.2 obligation 1 binds the "downsampled" label to the deletion — *"written in the same
  // storage transaction that deletes the rows"* — and the failure worth guarding on the
  // production path is the phantom one: a label persisted by a pass that folded nothing. A
  // client whose every boot appended a label would tell the user history had been degraded on
  // a device that has never been near its budget.
  const db = await freshDb('c9');
  for (let i = 0; i < 20; i += 1) await db.priceSamples.put(sample(i * HOUR, i + 1));
  await enforceStorageBudget(db, {
    chain: CHAIN,
    locks: freeLock(),
    profile: storagePlatform({ mobile: true }),
    pins: { kind: 'unnameable', reason: 'no chain read in this case' },
    now: 30 * HOUR,
  });
  assert.deepEqual(await readDownsampled(db), []);
  assert.equal(await db.priceSamples.count(), 20);
  db.close();
  await db.delete();
});
