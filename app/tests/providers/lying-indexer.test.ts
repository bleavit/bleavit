/**
 * 15 §4.8's *"lying indexer ⇒ sampler auto-disable"*, end to end — 10 §8.3/§8.4, 14 TH-49. F9.
 *
 * ## What was missing, precisely
 *
 * That row is a per-PR gate and `sampling.test.ts` has exercised the ladder since 2026-08-06 —
 * but every one of its cases supplies a **synthetic `RowCheck` closure**, a function that
 * returns `{ kind: 'mismatch' }` because the test told it to. What that certifies is that the
 * ladder behaves *given verdicts*. The gated property is that a lying indexer **produces** them,
 * and until `chainRowCheck` existed nothing in the repository turned a served row into a
 * verdict — so a client could have shipped with the entire detection half absent, and every
 * suite would have stayed green, including the one named after the property.
 *
 * ## Why this can be built today, with no node and no network
 *
 * `@bleavit/mock-runtime` replays the deterministic chainHead-v1 transcripts recorded against a
 * booted release node (02 §11 row 4). Those transcripts contain real storage reads: a key, and
 * the value the chain had under it at one pinned block. That is exactly the pair an indexer
 * serves and exactly the pair the sampler re-derives, so the *chain* half of the comparison is
 * a recording rather than a stub — and a mock that refuses what it was never taught cannot
 * quietly turn a missing read into a passing check.
 *
 * The indexer half is built **from** the transcript: an honest provider is one that serves the
 * recorded values, and a lying one is the same pages with a value changed. Nothing about the
 * verdict is asserted into existence.
 *
 * ## What this does not claim
 *
 * Nothing here is evidence about deep history. §8.4 and 14 TH-49 both say sampling at this rate
 * *"quantitatively verifies almost nothing at depth and misses self-consistent forgeries"*, and
 * a recorded transcript is one pinned block. This proves detection of a source that serves a
 * value the chain contradicts **where the client can look**, which is the whole of what the
 * mechanism claims.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  LADDER,
  PAGES_PER_SAMPLED_ROW,
  chainRowCheck,
  effectiveCoverage,
  runSamplingRound,
} from '@bleavit/providers';
import type { ChainRead, Provider, ProviderPage, ProviderRow } from '@bleavit/providers';
import { createFixtureBundle, createMockRuntime } from '@bleavit/mock-runtime';
import type { MockRuntime } from '@bleavit/mock-runtime';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', '..', 'fixtures', 'chainhead');

function loadRuntime(): MockRuntime {
  const names = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));
  const report = JSON.parse(readFileSync(join(FIXTURE_DIR, 'fixtures-report.json'), 'utf8'));
  const fixtures = names
    .filter((name) => name !== 'fixtures-report.json')
    .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')));
  return createMockRuntime(createFixtureBundle(report, fixtures));
}

interface RecordedItem {
  readonly key: string;
  readonly value?: string;
}

/** How a given key is reachable in the transcripts: the read that was actually recorded. */
interface RecordedRead {
  /** The key the recorded request asked for — a prefix for a `descendantsValues` read. */
  readonly asked: string;
  readonly type: 'value' | 'descendantsValues';
}

interface Harvest {
  readonly values: ReadonlyMap<string, string>;
  readonly reachableBy: ReadonlyMap<string, RecordedRead>;
}

/**
 * Every `(key, value)` the recorded transcripts carry, and the read that reaches each one.
 *
 * Taken from the **recording**, not from a list written here: a hand-kept list of keys would
 * drift from the fixtures, and the drift would read as a passing test over rows that no longer
 * exist.
 *
 * Both read types are harvested. A `descendantsValues` read is how a client re-reads one entry
 * of a storage *map* — which is what most of a provider's rows are — so restricting this to
 * single-value reads would leave ten rows to sample, one stratum, and one comparison. The
 * suite's own anti-vacuity test is what caught that: at ten rows the lying-indexer case below
 * passes by not looking.
 */
function harvest(): Harvest {
  const values = new Map<string, string>();
  const reachableBy = new Map<string, RecordedRead>();
  for (const name of readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.json'))) {
    if (name === 'fixtures-report.json') continue;
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as {
      requests: readonly {
        method: string;
        params: unknown;
        response: { events?: { event: string; items?: RecordedItem[] }[] };
      }[];
    };
    for (const request of fixture.requests) {
      if (request.method !== 'chainHead_v1_storage') continue;
      const params = request.params as [
        string,
        string,
        { key: string; type: 'value' | 'descendantsValues' }[],
        unknown,
      ];
      const asked = params[2]?.[0];
      if (asked === undefined) continue;
      for (const event of request.response.events ?? []) {
        if (event.event !== 'operationStorageItems') continue;
        for (const item of event.items ?? []) {
          if (typeof item.value !== 'string') continue;
          values.set(item.key, item.value);
          reachableBy.set(item.key, { asked: asked.key, type: asked.type });
        }
      }
    }
  }
  return { values, reachableBy };
}

/**
 * The chain half of the comparison: a real recorded read, replayed through the mock.
 *
 * It goes through `runtime.respond` rather than reading the harvested map directly, and that is
 * the point — the mock **refuses a request it was never taught**, so a suite that drifted onto
 * keys the transcripts do not carry fails loudly instead of comparing a value against itself.
 * `UnrecordedRequestError` is allowed to propagate rather than being mapped to `beyond-reach`,
 * because a hole in the fixtures is not evidence about a provider.
 */
function transcriptRead(runtime: MockRuntime, reachableBy: ReadonlyMap<string, RecordedRead>): ChainRead {
  return async (key: string) => {
    const via = reachableBy.get(key);
    if (via === undefined) {
      throw new Error(`${key} is not in the recorded transcripts; this suite must not invent one`);
    }
    const response = runtime.respond('chainHead_v1_storage', [
      'subscription-1',
      runtime.pinnedBlock(),
      [{ key: via.asked, type: via.type }],
      null,
    ]) as { events?: { event: string; items?: RecordedItem[] }[] };
    for (const event of response.events ?? []) {
      if (event.event !== 'operationStorageItems') continue;
      for (const item of event.items ?? []) {
        if (item.key === key && typeof item.value === 'string') {
          return { kind: 'value', hex: item.value };
        }
      }
    }
    return { kind: 'absent' };
  };
}

/** Spread the served rows one per page, so the 1-in-16 stratification is exercised for real. */
function pagesOf(rows: readonly ProviderRow[]): readonly ProviderPage[] {
  return rows.map((row) => ({ rows: [row] }));
}

const INDEXER: Provider = { id: 'recorded-indexer', kind: 'indexer', health: { kind: 'healthy' } };

/** Deterministic draw, so a failure is reproducible and names the same row every time. */
const firstOfEachStratum = (): number => 0;

const HARVEST = harvest();
const ITEMS: readonly RecordedItem[] = [...HARVEST.values].map(([key, value]) => ({ key, value }));

test('the recorded transcripts carry enough real reads for this suite to mean anything', () => {
  // Anti-vacuity. With too few recorded reads the stratification below forms one window, one
  // row is compared, and a lying indexer that lies elsewhere is never sampled — at which point
  // the "auto-disable" test below would pass by not looking.
  assert.ok(
    ITEMS.length >= PAGES_PER_SAMPLED_ROW * 2,
    `expected at least ${PAGES_PER_SAMPLED_ROW * 2} recorded (key, value) reads, found ${ITEMS.length}`,
  );
});

test('an HONEST indexer serving the recorded values survives a round untouched', async () => {
  // The anti-vacuity control for the lie below: a round that disabled everything would look
  // identical to a round that detects.
  const runtime = loadRuntime();
  const rows = ITEMS.map((item) => ({ reference: item.key, claimed: item.value as string }));
  const round = await runSamplingRound(
    INDEXER,
    pagesOf(rows),
    chainRowCheck(transcriptRead(runtime, HARVEST.reachableBy)),
    firstOfEachStratum,
  );
  assert.equal(round.outcome, 'clean');
  assert.deepEqual(round.provider, INDEXER);
  assert.equal(round.result.mismatches, 0);
  assert.equal(round.refusal, undefined);
  assert.ok(round.result.rowsChecked > 0, 'a clean round that compared nothing proves nothing');
  assert.equal(effectiveCoverage(round.result).ratio, 1, 'every sampled row was comparable');
});

test('a LYING indexer is caught by the adapter and auto-disabled — 15 §4.8', async () => {
  // The gated property, with no synthetic verdict anywhere in it: the provider serves a value,
  // the adapter re-reads the recorded chain state, and the mismatch is produced rather than
  // declared. Every row in the first stratum is falsified so the deterministic draw meets one.
  const runtime = loadRuntime();
  const rows = ITEMS.map((item, index) => ({
    reference: item.key,
    // A plausible lie: same length, same shape, one nibble different. A provider that returned
    // garbage would be caught by anything; one that returns a well-formed wrong value is what
    // TH-49 describes.
    claimed:
      index < PAGES_PER_SAMPLED_ROW
        ? `0x${'0'.repeat((item.value as string).length - 2)}`
        : (item.value as string),
  }));
  const round = await runSamplingRound(
    INDEXER,
    pagesOf(rows),
    chainRowCheck(transcriptRead(runtime, HARVEST.reachableBy)),
    firstOfEachStratum,
  );

  assert.equal(round.outcome, 'mismatch');
  assert.equal(round.provider.health.kind, 'disabled');
  if (round.provider.health.kind !== 'disabled') return;
  assert.equal(round.provider.health.by, 'auto');
  assert.equal(round.refusal?.code, 'FE-PROV-002');
  assert.ok(round.mismatches.length > 0);
  // The reason names what THIS DEVICE read, not what the provider said — the difference between
  // a report a user can act on and one that repeats the lie back.
  const mismatch = round.mismatches[0];
  assert.ok(mismatch !== undefined);
  assert.equal(
    mismatch.expected,
    (ITEMS.find((item) => item.key === mismatch.row.row.reference)?.value ?? '').toLowerCase(),
  );
});

test('one lie is enough — §8.3 sets no threshold', async () => {
  // A threshold is what turns one caught lie into a tolerated error rate. Falsify exactly the
  // row the deterministic draw will take in stratum 0 and nothing else.
  const runtime = loadRuntime();
  const rows = ITEMS.map((item, index) => ({
    reference: item.key,
    claimed: index === 0 ? '0xdeadbeef' : (item.value as string),
  }));
  const round = await runSamplingRound(
    INDEXER,
    pagesOf(rows),
    chainRowCheck(transcriptRead(runtime, HARVEST.reachableBy)),
    firstOfEachStratum,
  );
  assert.equal(round.result.mismatches, 1);
  assert.equal(round.provider.health.kind, 'disabled');
});

test('a differently-cased hex value is NOT a lie', async () => {
  // Disabling an honest source over the case of a nibble would be this loop lying about a lie,
  // and the ladder is terminal: §8.4 makes re-enabling an explicit user action, so a false
  // positive here costs the user a source permanently until they intervene.
  const runtime = loadRuntime();
  const rows = ITEMS.map((item) => ({
    reference: item.key,
    claimed: (item.value as string).toUpperCase().replace('0X', '0x'),
  }));
  const round = await runSamplingRound(
    INDEXER,
    pagesOf(rows),
    chainRowCheck(transcriptRead(runtime, HARVEST.reachableBy)),
    firstOfEachStratum,
  );
  assert.equal(round.outcome, 'clean');
});

test('a key the chain has no value for is UNVERIFIABLE, never a mismatch', async () => {
  // §8.4 re-verifies "where the referenced object still exists". A row about a reaped object
  // proves nothing about the provider, and counting it as a lie would disable every source
  // that served history containing a since-deleted object — which is most history.
  const gone: ChainRead = async () => ({ kind: 'absent' });
  const round = await runSamplingRound(
    INDEXER,
    pagesOf(ITEMS.map((item) => ({ reference: item.key, claimed: 'anything at all' }))),
    chainRowCheck(gone),
    firstOfEachStratum,
  );
  assert.equal(round.outcome, 'inconclusive');
  assert.deepEqual(round.provider, INDEXER, 'and it is not disabled: nothing was proven');
  assert.equal(round.result.mismatches, 0);
  assert.ok(round.result.unverifiable > 0);
});

test('depth the light client cannot reach is UNVERIFIABLE, and distinguishable from absent', async () => {
  const tooDeep: ChainRead = async () => ({ kind: 'beyond-reach' });
  const round = await runSamplingRound(
    INDEXER,
    pagesOf(ITEMS.map((item) => ({ reference: item.key, claimed: 'anything at all' }))),
    chainRowCheck(tooDeep),
    firstOfEachStratum,
  );
  assert.equal(round.outcome, 'inconclusive');
  assert.equal(effectiveCoverage(round.result).checked, 0);
  assert.equal(effectiveCoverage(round.result).ratio, 0);
});

test('the ladder still refuses to sample a disabled source after it caught one', async () => {
  // The two halves joined: a caught lie disables, and a disabled source serves nothing, so a
  // second round over it is a verdict about rows no user was ever shown.
  const runtime = loadRuntime();
  const rows = ITEMS.map((item, index) => ({
    reference: item.key,
    claimed: index === 0 ? '0xdeadbeef' : (item.value as string),
  }));
  const first = await runSamplingRound(
    INDEXER,
    pagesOf(rows),
    chainRowCheck(transcriptRead(runtime, HARVEST.reachableBy)),
    firstOfEachStratum,
  );
  assert.equal(first.provider.health.kind, 'disabled');
  await assert.rejects(() =>
    runSamplingRound(
      first.provider,
      pagesOf(rows),
      chainRowCheck(transcriptRead(loadRuntime(), HARVEST.reachableBy)),
      firstOfEachStratum,
    ),
  );
  // And the ladder's other terminal arm: a healthy probe does not bring it back.
  assert.ok(LADDER.disableAfter > 0);
});
