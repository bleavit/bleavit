/**
 * The §8.3 health ladder and the §8.4 live sampling loop — 10 §8.3/§8.4, 14 TH-49 (F9).
 *
 * The interesting assertions here are all **refusals to do the obvious thing**: a probe that
 * does not resurrect a disabled source, a counter that resets, a round that keeps its findings
 * when a later check explodes, and a selection the provider cannot predict. Each is a case
 * where correct-looking code silently produces a client that reports a source as healthy when
 * it is not, or as verified when nothing was compared.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LADDER,
  PAGES_PER_SAMPLED_ROW,
  ProviderCannotServeError,
  afterProbe,
  canServeReads,
  effectiveCoverage,
  livenessRefusal,
  probeDue,
  runSamplingRound,
  selectSample,
} from '@bleavit/providers';
import * as barrel from '@bleavit/providers';
import * as testing from '@bleavit/providers/testing';
import { runSamplingRoundAtRate, selectSampleAtRate } from '@bleavit/providers/testing';

import { assertTestingSubpathIsQuarantined } from '../shared/testing-subpath.ts';
import type { Provider, ProviderPage, RowVerdict, SampledRow } from '@bleavit/providers';

const HEALTHY: Provider = { id: 'p1', kind: 'indexer', health: { kind: 'healthy' } };

const FAILED = { kind: 'failed', why: 'timeout' } as const;
const FAST = { kind: 'responded', latencyMs: 10 } as const;
const SLOW = { kind: 'responded', latencyMs: LADDER.slowAboveMs + 1 } as const;

function pages(count: number, rowsPerPage = 1): readonly ProviderPage[] {
  return Array.from({ length: count }, (_unused, page) => ({
    rows: Array.from({ length: rowsPerPage }, (_ignored, index) => ({
      reference: `${page}:${index}`,
      claimed: `claim-${page}-${index}`,
    })),
  }));
}

/** A randomness source that records how it was called. See the "no argument" test. */
function spyRandom(value: number): { readonly draw: () => number; readonly args: number[] } {
  const args: number[] = [];
  return {
    // A `function`, not an arrow: `arguments.length` is the assertion, and an arrow has none.
    draw: function draw(): number {
      args.push(arguments.length);
      return value;
    },
    args,
  };
}

// ------------------------------------------------------------------ the ladder

test('a probe never resurrects a provider the user switched off', () => {
  const off: Provider = {
    ...HEALTHY,
    health: { kind: 'disabled', by: 'user', reason: 'I do not trust this operator' },
  };
  assert.deepEqual(afterProbe(off, FAST), off);
});

test('a probe never resurrects a provider that auto-disabled', () => {
  // §8.4: "re-enabling is an explicit user action". The source that failed a sampling round is
  // exactly the source whose next health probe succeeds — a ladder written as a pure function
  // of the latest outcome switches it straight back on, and the user is never told.
  const off: Provider = {
    ...HEALTHY,
    health: { kind: 'disabled', by: 'auto', reason: 'a spot-checked row did not match' },
  };
  assert.deepEqual(afterProbe(off, FAST), off);
  assert.deepEqual(afterProbe(off, SLOW), off);
});

test('consecutive failures walk the ladder and disable at the threshold', () => {
  let provider = HEALTHY;
  for (let i = 1; i < LADDER.disableAfter; i += 1) {
    provider = afterProbe(provider, FAILED);
    assert.equal(provider.health.kind, 'failing');
    if (provider.health.kind === 'failing') {
      assert.equal(provider.health.consecutiveFailures, i);
    }
  }
  provider = afterProbe(provider, FAILED);
  assert.equal(provider.health.kind, 'disabled');
  if (provider.health.kind !== 'disabled') return;
  assert.equal(provider.health.by, 'auto');
  assert.match(provider.health.reason, new RegExp(String(LADDER.disableAfter)));
});

test('a success RESETS the failure count — the ladder counts consecutive, not cumulative', () => {
  // The whole difference between §8.3's ladder and a defect: a cumulative counter disables
  // every provider eventually given enough uptime, and an auto-disable whose real cause is age
  // reads to a user as a source that broke.
  let provider = HEALTHY;
  const failuresShortOfDisabling = LADDER.disableAfter - 1;
  for (let i = 0; i < failuresShortOfDisabling; i += 1) provider = afterProbe(provider, FAILED);
  provider = afterProbe(provider, FAST);
  assert.equal(provider.health.kind, 'healthy');
  for (let i = 0; i < failuresShortOfDisabling; i += 1) provider = afterProbe(provider, FAILED);
  assert.equal(provider.health.kind, 'failing', 'the count restarted, so this must not disable');
});

test('a SLOW response resets the count too — a response is a response', () => {
  let provider = HEALTHY;
  for (let i = 0; i < LADDER.disableAfter - 1; i += 1) provider = afterProbe(provider, FAILED);
  provider = afterProbe(provider, SLOW);
  assert.equal(provider.health.kind, 'slow');
  provider = afterProbe(provider, FAILED);
  assert.equal(provider.health.kind, 'failing');
  if (provider.health.kind === 'failing') assert.equal(provider.health.consecutiveFailures, 1);
});

test('Slow never disables on its own, however long it lasts', () => {
  // §8.3: a slow provider is an honest one, and turning a network condition into a
  // missing-data incident is the failure the ladder's shape exists to prevent.
  let provider = HEALTHY;
  for (let i = 0; i < LADDER.disableAfter * 10; i += 1) provider = afterProbe(provider, SLOW);
  assert.equal(provider.health.kind, 'slow');
});

test('FE-PROV-001 is emitted for an auto-disable and for nothing else', () => {
  let provider = HEALTHY;
  assert.equal(livenessRefusal(provider), undefined);
  for (let i = 0; i < LADDER.disableAfter; i += 1) provider = afterProbe(provider, FAILED);
  const refusal = livenessRefusal(provider);
  assert.equal(refusal?.code, 'FE-PROV-001');
  const byUser: Provider = {
    ...HEALTHY,
    health: { kind: 'disabled', by: 'user', reason: 'switched off' },
  };
  assert.equal(livenessRefusal(byUser), undefined, 'a user decision is not a refusal to report');
});

// ------------------------------------------------------------------ the schedule

test('a provider that has never been probed is due NOW — §8.3 "on enable"', () => {
  // Written as `now - last >= interval` over a `last` initialised to the enable time, this is
  // false, and the provider serves reads for ten minutes on no evidence at all.
  assert.equal(probeDue(null, 0), true);
  assert.equal(probeDue(null, 1_700_000_000_000), true);
});

test('the interval boundary is inclusive, and a moment before it is not due', () => {
  const last = 1_000_000;
  assert.equal(probeDue(last, last + LADDER.probeEveryMs), true);
  assert.equal(probeDue(last, last + LADDER.probeEveryMs - 1), false);
});

test('a clock that moved backwards makes a probe due, not never-due', () => {
  // `now - last` goes negative after a system time adjustment. A scheduler that then stops
  // silently is worse than one that probes twice.
  assert.equal(probeDue(2_000_000, 1_000), true);
});

// ------------------------------------------------------------------ selection

test('the randomness source is called with NO argument — it cannot be seeded from the data', () => {
  // The load-bearing property of the whole loop. A selection derived from anything the
  // provider serves is a selection the provider knows in advance, and it then serves honest
  // rows at exactly those positions for one row per 16 pages.
  const random = spyRandom(0);
  selectSample(pages(64), random.draw);
  assert.ok(random.args.length > 0, 'the source must actually be used');
  assert.deepEqual(
    [...new Set(random.args)],
    [0],
    'selectSample passed something to the randomness source',
  );
});

test('one row per 16 pages, stratified so every window is represented', () => {
  const random = spyRandom(0);
  const selection = selectSample(pages(64), random.draw);
  assert.equal(selection.strata, 4);
  assert.equal(selection.rows.length, 4);
  assert.deepEqual(
    selection.rows.map((row) => row.stratum),
    [0, 1, 2, 3],
  );
  // With `random` pinned at 0 each stratum yields its first page: uniform draws over the whole
  // set could have put all four in one window, which is what a forger clustering forgeries
  // relies on.
  assert.deepEqual(
    selection.rows.map((row) => row.page),
    [0, 16, 32, 48],
  );
});

test('the count rounds UP — a short round still verifies something', () => {
  // Rounding down lets every import below 16 pages verify nothing at all and report a clean
  // round, which is the "passes by shrinking" shape. A rate is a floor on effort.
  const random = spyRandom(0);
  assert.equal(selectSample(pages(1), random.draw).rows.length, 1);
  assert.equal(selectSample(pages(PAGES_PER_SAMPLED_ROW), random.draw).rows.length, 1);
  assert.equal(selectSample(pages(PAGES_PER_SAMPLED_ROW + 1), random.draw).rows.length, 2);
  assert.equal(selectSample([], random.draw).rows.length, 0);
});

test('a randomness source out of range is clamped rather than yielding no row', () => {
  const selection = selectSample(pages(1, 5), () => 1);
  assert.equal(selection.rows.length, 1);
  assert.equal(selection.rows[0]?.index, 4, 'clamped to the last candidate');
  assert.equal(selectSample(pages(1, 5), () => -1).rows[0]?.index, 0);
});

test('a window whose pages are all empty is counted, never silently dropped', () => {
  // A provider that answers with empty pages has served nothing to check. A selection that
  // just returned fewer rows would make that indistinguishable from a small dataset.
  const served: readonly ProviderPage[] = [
    ...Array.from({ length: PAGES_PER_SAMPLED_ROW }, () => ({ rows: [] })),
    ...pages(1),
  ];
  const selection = selectSample(served, () => 0);
  assert.equal(selection.strata, 2);
  assert.equal(selection.emptyStrata, 1);
  assert.equal(selection.rows.length, 1);
});

test('the draw is over ROWS in the window, not over pages', () => {
  // Pages are not uniform in size, and drawing a page first then a row inside it would sample
  // a row on a 1-row page 40 times as often as a row on a 40-row page.
  const uneven: readonly ProviderPage[] = [pages(1, 1)[0]!, pages(1, 3)[0]!];
  const selection = selectSample(uneven, () => 0.99);
  assert.equal(selection.rows.length, 1);
  assert.equal(selection.rows[0]?.page, 1);
  assert.equal(selection.rows[0]?.index, 2);
});

// --------------------------------------------------- the rate is not a caller's to choose

test('the production entry points take NO rate argument', () => {
  // §8.4 states 1-in-16 normatively and 14 TH-49's residual-risk arithmetic is computed from
  // it, so a rate parameter on the production path is a control a caller switches off by
  // passing a number: at a large enough rate every import forms one stratum, one row is
  // compared, and every round still reports `clean`. Nothing fails; the sampler is off.
  //
  // Two halves, as with the required hash function. *Type level*: the directive is itself the
  // assertion — if a third parameter ever came back, `tsc` reports it as unused and
  // `check:types` goes red. *Runtime*: the arity catches a signature that grew an **optional**
  // rate, which every existing call site still satisfies and no type error would reveal.
  const uncallable: () => unknown = () =>
    // @ts-expect-error the 1-in-16 rate is normative; the loosened form is behind /testing
    selectSample(pages(64), () => 0, 1_000_000);
  assert.equal(typeof uncallable, 'function');
  assert.equal(selectSample.length, 2);
  assert.equal(runSamplingRound.length, 4);
});

test('the loosened form is NOT reachable from the package barrel', () => {
  // The other half of the control, and the half a dependency-cruiser rule cannot supply.
  // `no-loosened-sampling-rate-in-production` forbids production code importing
  // `@bleavit/providers/testing` — it says nothing about the barrel, so one line
  // (`export { selectSampleAtRate } from './sampling.js'`) puts the rate back in every
  // consumer's reach with no subpath import anywhere and the rule still green. Measured, not
  // assumed: that mutation survived the whole gate set on 2026-08-06 until this test existed.
  //
  // It enumerated two names by hand until 2026-08-06, which is the same defect one level up: a
  // third loosened export would have slipped past a test that lists what to look for. The shared
  // helper takes the whole `/testing` **namespace**, so the quarantine covers whatever is in it.
  // The same hole in `chain-client`, `local-index` and `signing` is closed by the same helper in
  // their own suites.
  assertTestingSubpathIsQuarantined(
    {
      packageName: '@bleavit/providers',
      barrel,
      testing,
      barrelMustExport: ['selectSample', 'runSamplingRound'],
    },
    assert,
  );
});

test('the loosened form still exists, and behaves — it is quarantined, not deleted', async () => {
  // The stratification logic is untestable at a single rate, so the rate-taking form has to
  // exist. `@bleavit/providers/testing` is where it lives, and
  // `no-loosened-sampling-rate-in-production` is what stops production code importing it.
  const selection = selectSampleAtRate(pages(64), () => 0, 32);
  assert.equal(selection.strata, 2);
  const round = await runSamplingRoundAtRate(HEALTHY, pages(64), async () => MATCH, () => 0, 32);
  assert.equal(round.outcome, 'clean');
  assert.equal(round.result.rowsChecked, 2);
});

test('a rate below 1 is refused rather than silently clamped', () => {
  assert.throws(() => selectSampleAtRate(pages(4), () => 0, 0), RangeError);
  assert.throws(() => selectSampleAtRate(pages(4), () => 0, 1.5), RangeError);
});

// ------------------------------------------------------------------ the round

const MATCH: RowVerdict = { kind: 'match' };

test('a disabled provider cannot be sampled at all', async () => {
  // §8.3 makes Disabled the one state that stops reads, so a disabled source served nothing.
  // Sampling it would either overwrite a user's own decision with an automatic one or record a
  // clean verdict about rows no user was ever shown.
  const off: Provider = {
    ...HEALTHY,
    health: { kind: 'disabled', by: 'user', reason: 'switched off' },
  };
  await assert.rejects(
    () => runSamplingRound(off, pages(16), async () => MATCH, () => 0),
    ProviderCannotServeError,
  );
});

test('the round is gated on `canServeReads`, which until now nothing anywhere called', async () => {
  // The predicate documented itself as *"the one predicate a read path calls"* and had no caller
  // in the repository: neither production entry point consulted it, so `unprobed` — a state added
  // precisely so an unanswered source could not serve — stopped nothing. A round over one is a
  // verdict about rows nobody was shown, exactly like the disabled case above.
  const unprobed: Provider = { ...HEALTHY, health: { kind: 'unprobed' } };
  assert.equal(canServeReads(unprobed), false);
  await assert.rejects(
    () => runSamplingRound(unprobed, pages(16), async () => MATCH, () => 0),
    (error: unknown) =>
      error instanceof ProviderCannotServeError && /nothing has answered for it yet/.test(error.message),
  );

  // And it is satisfiable, which is what makes it a gate rather than a wall: a caller holding
  // pages the source served performed the request that produced them, so it advances §8.3's
  // ladder from that outcome first. "Probe on enable" becomes structural instead of scheduled.
  const answered = afterProbe(unprobed, FAST);
  assert.equal(canServeReads(answered), true);
  const round = await runSamplingRound(answered, pages(16), async () => MATCH, () => 0);
  assert.equal(round.outcome, 'clean');
});

test('a FAILING provider still serves, because §8.3 says only Disabled stops reads', async () => {
  // The narrowing this predicate used to make, found while wiring it in. §8.3's normative shape is
  // one sentence: "`Failing` counts **consecutive** failures, so one timeout in a healthy series
  // cannot ratchet the ladder; and only `Disabled` stops reads". Excluding `failing` here is that
  // same ratchet one clause along — one timeout would have taken the source off every read path
  // while the ladder itself still called it live, and no sampling round could then produce the
  // success that resets the counter.
  const failing = afterProbe(HEALTHY, FAILED);
  assert.equal(failing.health.kind, 'failing');
  assert.equal(canServeReads(failing), true);
  const round = await runSamplingRound(failing, pages(16), async () => MATCH, () => 0);
  assert.equal(round.outcome, 'clean');

  // `slow` too, for the reason §8.3 states outright: a slow provider is an honest one.
  assert.equal(canServeReads(afterProbe(HEALTHY, SLOW)), true);
});

test('every row matching is a clean round and leaves the provider alone', async () => {
  const round = await runSamplingRound(HEALTHY, pages(32), async () => MATCH, () => 0);
  assert.equal(round.outcome, 'clean');
  assert.deepEqual(round.provider, HEALTHY);
  assert.equal(round.result.rowsChecked, 2);
  assert.equal(round.result.mismatches, 0);
  assert.equal(round.refusal, undefined);
});

test('ANY mismatch auto-disables and emits FE-PROV-002', async () => {
  // §8.3 sets no threshold, and a threshold is what turns one caught lie into a tolerated
  // error rate.
  const round = await runSamplingRound(
    HEALTHY,
    pages(32),
    async (row: SampledRow) =>
      row.page === 0 ? { kind: 'mismatch', expected: 'what the chain says' } : MATCH,
    () => 0,
  );
  assert.equal(round.outcome, 'mismatch');
  assert.equal(round.provider.health.kind, 'disabled');
  if (round.provider.health.kind === 'disabled') assert.equal(round.provider.health.by, 'auto');
  assert.equal(round.refusal?.code, 'FE-PROV-002');
  assert.equal(round.mismatches.length, 1);
  assert.match(round.refusal?.detail ?? '', /what the chain says/);
});

test('a check that throws does not discard the mismatches already found', async () => {
  // The adversarial reason the round does not abort. The reference is provider-supplied, so a
  // publisher can embed one whose re-read reliably errors — and a round that threw would drop
  // the mismatch found a moment earlier and never disable the source.
  const round = await runSamplingRound(
    HEALTHY,
    pages(32),
    async (row: SampledRow) => {
      if (row.stratum === 0) return { kind: 'mismatch', expected: 'chain value' };
      throw new Error('malformed reference');
    },
    () => 0,
  );
  assert.equal(round.outcome, 'mismatch');
  assert.equal(round.provider.health.kind, 'disabled');
  assert.equal(round.result.unverifiable, 1);
});

test('a round where nothing was comparable is INCONCLUSIVE, not clean', async () => {
  // Unverifiable rows count neither way, so a round of nothing-but-unverifiable rows has no
  // evidence in it at all. Folding that into "clean" is how a provider serving only
  // unverifiable rows — the cheapest evasion there is — reads as a source that keeps passing.
  const round = await runSamplingRound(
    HEALTHY,
    pages(32),
    async () => ({ kind: 'unverifiable', why: 'object-gone' }),
    () => 0,
  );
  assert.equal(round.outcome, 'inconclusive');
  assert.deepEqual(round.provider, HEALTHY, 'and it is not disabled either: nothing was proven');
  assert.equal(round.result.unverifiable, 2);
  assert.equal(effectiveCoverage(round.result).checked, 0);
  assert.equal(effectiveCoverage(round.result).ratio, 0);
});

test('unverifiable rows count neither for nor against, and coverage says so', async () => {
  const round = await runSamplingRound(
    HEALTHY,
    pages(64),
    async (row: SampledRow) =>
      row.stratum < 3 ? { kind: 'unverifiable', why: 'beyond-reach' } : MATCH,
    () => 0,
  );
  assert.equal(round.outcome, 'clean');
  assert.equal(round.result.rowsChecked, 4);
  assert.equal(round.result.unverifiable, 3);
  const coverage = effectiveCoverage(round.result);
  assert.equal(coverage.checked, 1);
  assert.equal(coverage.ofTotal, 4);
  assert.equal(coverage.ratio, 0.25, 'one comparable row in four, reported as exactly that');
});

test('rows are checked sequentially, so a round is reproducible from its inputs', async () => {
  const seen: number[] = [];
  await runSamplingRound(
    HEALTHY,
    pages(64),
    async (row: SampledRow) => {
      seen.push(row.stratum);
      await new Promise((resolve) => setTimeout(resolve, seen.length === 1 ? 5 : 0));
      return MATCH;
    },
    () => 0,
  );
  assert.deepEqual(seen, [0, 1, 2, 3]);
});
