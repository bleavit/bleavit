/**
 * The compatibility verdict, moving — 10 §3.1, §3.2; INV-FE-12.
 *
 * `compat-session.test.ts` covers the classifier's decisions. This file covers what happens to
 * the answer afterwards, which is where F26's R-6 review found two defects that no green run
 * could show:
 *
 *  1. `startShell` typed its `connect` as `() => Promise<unknown>` and discarded the result, so
 *     the verdict reached nothing — no screen, no signing gate, no re-classification.
 *  2. §3.2 re-runs the classifier on **every** `CodeUpdated` and §3.1 retries `CompatUnavailable`
 *     on a 1 s→60 s backoff; neither had a driver, so a session classified once at boot and
 *     reported that verdict for the rest of its life.
 *
 * Everything here is driven through injected seams — the classifier, the runtime reading, the
 * finalized-block subscription and the timer — so the backoff is asserted in microseconds and no
 * chain is involved. That is `chain-boot.ts`'s shape and `compat-session.test.ts`'s.
 *
 * **Every mode assertion names the mode.** 10 §5.2's verdict *is* the mode, so asserting
 * `verdict.kind === 'classified'` would say only that some chain answered — which is true of
 * `full`, of `restricted` and of `read-only-incompatible` alike, and is therefore satisfied by
 * exactly the confusion these tests exist to prevent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

import {
  COMPAT_RETRY_MAX_MS,
  COMPAT_RETRY_MIN_MS,
  CompatNotice,
  Shell,
  compatRetryDelayMs,
  signingBlockedReason,
  startShell,
  verdictAllowsSigning,
  watchCompat,
  type BootedShell,
  type CompatVerdict,
  type ConnectedChain,
  type ScheduleDelay,
  type ShellChainState,
} from '@bleavit/application';
import { CRITICAL_SURFACE, type CompatClassification } from '@bleavit/descriptors';
import type { RuntimeVersionReport } from '@bleavit/chain-client';
import { DOC_10, architecture, theLineContaining } from './spec-sources.ts';

/* ------------------------------------------------------------------------------- fixtures */

const runtime = (specVersion: number): RuntimeVersionReport => ({
  specName: 'bleavit',
  specVersion,
  implVersion: 0,
  transactionVersion: 1,
});

const classification = (mode: CompatClassification['mode'], specVersion = 1): CompatClassification => ({
  mode,
  specVersion,
  disabled:
    mode === 'restricted'
      ? [
          {
            id: CRITICAL_SURFACE[0]!.id,
            level: 'incompatible',
            reason: 'the fixture broke this surface on purpose',
          },
        ]
      : [],
  proven: mode === 'full' ? CRITICAL_SURFACE.map((entry) => entry.id) : [],
});

const classified = (mode: CompatClassification['mode'], specVersion = 1): CompatVerdict => ({
  kind: 'classified',
  classification: classification(mode, specVersion),
  codeHash: `0x${'c0de'.repeat(16)}`,
});

const unestablished = (reason = 'the probe did not complete'): CompatVerdict => ({
  kind: 'unestablished',
  code: 'FE-COMPAT-003',
  reason,
});

/**
 * A timer whose delays are recorded and fired by hand.
 *
 * The whole point of injecting one: a suite that waited out 10 §3.1's real sequence would take
 * over two minutes to reach the ceiling, so it would be written against a shortened backoff and
 * would then be asserting a cadence the client does not ship.
 */
function fakeClock() {
  const queue: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const schedule: ScheduleDelay = (ms, run) => {
    const entry = { ms, run, cancelled: false };
    queue.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return {
    schedule,
    /** Every delay ever scheduled, cancelled ones included. The backoff sequence itself. */
    delays: (): readonly number[] => queue.map((entry) => entry.ms),
    /** Fire the newest live timer, as a real one would. */
    async fire(): Promise<void> {
      const entry = [...queue].reverse().find((each) => !each.cancelled);
      assert.ok(entry, 'no live timer was scheduled — the retry was never armed');
      entry.cancelled = true;
      entry.run();
      // The retry calls an async classifier; let its microtasks settle before asserting.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    live: (): number => queue.filter((entry) => !entry.cancelled).length,
  };
}

/* ------------------------------------------------------ 10 §3.1's backoff, read from the spec */

test('the retry backoff is the 1 s→60 s sequence 10 §3.1 writes on the edge', () => {
  // Read out of the document rather than restated, the same method `boot.test.ts` uses on the
  // diagram: a constant nobody compares to the specification is a constant that drifts.
  const edge = theLineContaining(architecture(DOC_10), 'CompatUnavailable --> CompatCheck');
  const bounds = /backoff (\d+)s→(\d+)s/.exec(edge);
  assert.ok(bounds, `10 §3.1 no longer states this edge's backoff: ${edge}`);
  assert.equal(COMPAT_RETRY_MIN_MS, Number(bounds[1]) * 1_000);
  assert.equal(COMPAT_RETRY_MAX_MS, Number(bounds[2]) * 1_000);

  // …and the same sequence is the one §3.1's bullet promises, by name.
  const bullet = theLineContaining(architecture(DOC_10), '**`CompatUnavailable`**');
  assert.match(bullet, /same 1 s→60 s backoff as `SyncDegraded`/);

  // Doubling between the stated endpoints, and it must actually reach the ceiling and stay
  // there: §3.1 keeps retrying "for as long as the probe keeps failing", so a sequence that
  // kept doubling past 60 s would stop retrying inside any session a user is present for.
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 20].map(compatRetryDelayMs),
    [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000],
  );
  // A counter that has gone wrong must not produce a zero-delay retry loop.
  assert.equal(compatRetryDelayMs(-1), COMPAT_RETRY_MIN_MS);
  assert.equal(compatRetryDelayMs(Number.NaN), COMPAT_RETRY_MIN_MS);
});

/* --------------------------------------------------------- CompatUnavailable is retried, not held */

test('an unestablished boot verdict retries into the classifier on the §3.1 backoff', async () => {
  const clock = fakeClock();
  const published: CompatVerdict[] = [];
  let probes = 0;
  const stop = watchCompat({
    initial: unestablished(),
    reclassify: async () => {
      probes += 1;
      return unestablished(`attempt ${probes} did not complete either`);
    },
    runtimeNow: () => runtime(1),
    onFinalized: () => () => {},
    publish: (verdict) => published.push(verdict),
    schedule: clock.schedule,
  });

  // Nothing re-published yet — the boot verdict is the caller's and is already on screen.
  // A length check rather than `deepEqual(published, [])`: `@types/node` types that overload as
  // `asserts actual is T`, which narrows the array to `never[]` and makes every assertion below
  // it un-typecheckable — the shape of a test that stops being able to say anything.
  assert.equal(published.length, 0, 'the watch re-published the boot verdict');
  assert.equal(probes, 0, 'the watch probed before its first backoff elapsed');

  for (let attempt = 0; attempt < 8; attempt += 1) await clock.fire();

  assert.equal(probes, 8, 'the retry stopped firing while the probe was still failing');
  // Non-terminal: every attempt published a verdict, and every one of them is the fourth
  // outcome rather than a mode. §3.2 forbids synthesising a mode for a probe that read nothing.
  assert.equal(published.length, 8);
  for (const verdict of published) {
    assert.equal(verdict.kind, 'unestablished');
    assert.ok(verdict.kind === 'unestablished');
    assert.equal(verdict.code, 'FE-COMPAT-003');
    assert.equal(verdictAllowsSigning(verdict), false, 'an unestablished verdict permitted signing');
  }
  // The delays are §3.1's sequence, growing and then holding at the ceiling.
  assert.deepEqual(clock.delays().slice(0, 8), [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  stop();
});

test('a retry that classifies retires the backoff, and a later failure starts it again at 1 s', async () => {
  const clock = fakeClock();
  const published: CompatVerdict[] = [];
  const answers: CompatVerdict[] = [unestablished(), classified('full'), unestablished()];
  let probes = 0;
  const stop = watchCompat({
    initial: unestablished(),
    reclassify: async () => answers[probes++] ?? classified('full'),
    runtimeNow: () => runtime(1),
    onFinalized: () => () => {},
    publish: (verdict) => published.push(verdict),
    schedule: clock.schedule,
  });

  await clock.fire(); // 1 s  → unestablished, so the backoff grows
  await clock.fire(); // 2 s  → full, which retires the retry
  assert.equal(clock.live(), 0, 'a completed classification left a retry armed');
  const settled = published.at(-1);
  assert.ok(settled?.kind === 'classified');
  assert.equal(settled.classification.mode, 'full');
  assert.deepEqual(clock.delays(), [1_000, 2_000]);
  stop();
});

test('a watch that is stopped mid-backoff neither fires nor publishes', async () => {
  const clock = fakeClock();
  const published: CompatVerdict[] = [];
  let probes = 0;
  const stop = watchCompat({
    initial: unestablished(),
    reclassify: async () => {
      probes += 1;
      return unestablished();
    },
    runtimeNow: () => runtime(1),
    onFinalized: () => () => {},
    publish: (verdict) => published.push(verdict),
    schedule: clock.schedule,
  });
  stop();
  assert.equal(clock.live(), 0, 'a stopped watch left a timer holding the classifier');
  assert.equal(probes, 0);
  assert.equal(published.length, 0);
});

/* ------------------------------------------------------------- CodeUpdated re-runs the classifier */

test('a CodeUpdated re-runs the classifier, and the mode moves with the runtime (10 §3.2)', async () => {
  // §4.1 obligation 2 states the rule this asserts, citing §3.2: the classifier re-runs on
  // **every** `CodeUpdated`. Seen here as the finalized runtime report changing, which is what
  // `chainHead_v1_follow(withRuntime)` delivers for exactly that event.
  const spec = theLineContaining(architecture(DOC_10), 'partially transient client is worse');
  assert.match(spec, /re-runs the classifier on \*\*every\*\* `CodeUpdated`/);

  const clock = fakeClock();
  const published: CompatVerdict[] = [];
  let listener: (() => void) | undefined;
  let current = runtime(1);
  const probedAt: number[] = [];
  const stop = watchCompat({
    initial: classified('full', 1),
    reclassify: async () => {
      probedAt.push(current.specVersion);
      // The upgraded runtime moved a frozen surface: `full` becomes `restricted`.
      return current.specVersion === 1 ? classified('full', 1) : classified('restricted', 2);
    },
    runtimeNow: () => current,
    onFinalized: (each) => {
      listener = each;
      return () => {
        listener = undefined;
      };
    },
    publish: (verdict) => published.push(verdict),
    schedule: clock.schedule,
  });
  assert.ok(listener, 'the watch never subscribed to finalized blocks');

  // A block on the same runtime is not a `CodeUpdated` and must not re-probe: §4.1 charges a
  // probe a second `Chain` handle and an equal share of one core, so probing per block would
  // spend that continuously on a chain that has not upgraded.
  listener();
  await Promise.resolve();
  assert.deepEqual(probedAt, [], 'the watch re-probed a runtime that had not changed');
  assert.equal(published.length, 0, 'a block that changed nothing published a verdict');

  // Now the upgrade lands.
  current = runtime(2);
  listener();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(probedAt, [2], 'the classifier did not re-run on CodeUpdated');
  // Two publishes, in this order, and the first is the load-bearing one: §3.2 says the
  // previously established mode **MUST NOT** be carried across a runtime change the client was
  // unable to examine, and between the upgrade and the new verdict it has examined nothing.
  assert.equal(published.length, 2);
  const [dropped, reclassified] = published;
  assert.ok(dropped?.kind === 'unestablished');
  assert.equal(dropped.code, 'FE-COMPAT-003');
  assert.match(dropped.reason, /bleavit 2/);
  assert.equal(verdictAllowsSigning(dropped), false);
  assert.ok(reclassified?.kind === 'classified');
  assert.equal(reclassified.classification.mode, 'restricted', 'the mode did not follow the runtime');
  stop();
});

test('a runtime the transport can no longer name drops the mode too (10 §3.2)', async () => {
  // `ChainHeadConnection.finalizedRuntime()` answers `undefined` when announcements were
  // dropped and "an upgrade may have been among them". That is precisely a runtime change the
  // client was unable to examine, so the established mode may not survive it.
  const clock = fakeClock();
  const published: CompatVerdict[] = [];
  let listener: (() => void) | undefined;
  let current: RuntimeVersionReport | undefined = runtime(1);
  const stop = watchCompat({
    initial: classified('full', 1),
    reclassify: async () => unestablished('the runtime could not be read'),
    runtimeNow: () => current,
    onFinalized: (each) => {
      listener = each;
      return () => {};
    },
    publish: (verdict) => published.push(verdict),
    schedule: clock.schedule,
  });
  assert.ok(listener);

  current = undefined;
  listener();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(published.length >= 1);
  for (const verdict of published) {
    assert.equal(verdict.kind, 'unestablished', 'a mode survived a runtime nothing could name');
    assert.equal(verdictAllowsSigning(verdict), false);
  }
  // …and it is retried rather than left, because §3.1 makes this outcome non-terminal.
  assert.ok(clock.live() >= 1, 'an unestablished verdict was published with no retry armed');
  stop();
});

test('a CodeUpdated during a probe is not lost, and does not stack a second probe', async () => {
  // §4.1 obligation 1 makes a probe handle transient and charges it CPU share, so two probes at
  // once is the resource this module must not spend. Skipping the second upgrade would be the
  // other wrong answer — the client would report a mode about the runtime before last.
  const clock = fakeClock();
  const published: CompatVerdict[] = [];
  let listener: (() => void) | undefined;
  let current = runtime(1);
  let inFlight = 0;
  let maxInFlight = 0;
  const probedAt: number[] = [];
  let release: (() => void) | undefined;
  const stop = watchCompat({
    initial: classified('full', 1),
    reclassify: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      probedAt.push(current.specVersion);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      inFlight -= 1;
      return classified('full', current.specVersion);
    },
    runtimeNow: () => current,
    onFinalized: (each) => {
      listener = each;
      return () => {};
    },
    publish: (verdict) => published.push(verdict),
    schedule: clock.schedule,
  });
  assert.ok(listener);

  current = runtime(2);
  listener(); //                                        first probe starts and blocks
  await Promise.resolve();
  current = runtime(3);
  listener(); //                                        second upgrade, while the first is in flight
  await Promise.resolve();
  assert.deepEqual(probedAt, [2], 'a second probe was started beside the first');

  release?.(); //                                       the first probe completes
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  release?.(); //                                       …and the remembered re-run is now running
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  assert.equal(maxInFlight, 1, 'two probes ran at once');
  assert.deepEqual(probedAt, [2, 3], 'the upgrade that landed during a probe was dropped');
  stop();
});

/* --------------------------------------------------------------- the verdict reaches the shell */

test('startShell carries the verdict from connect into the rendered shell', async () => {
  // Defect 1 of the R-6 review, as a property rather than a type: `connect` returned `unknown`
  // and `startShell` dropped it, so nothing downstream could see what the classifier concluded.
  const shown: CompatVerdict[] = [];
  const booted: BootedShell = {
    worker: { kind: 'unavailable', reason: 'no service worker in this suite' },
    showCompat: (verdict) => shown.push(verdict),
    unmount: () => {},
  };
  const connected: ConnectedChain = { compat: classified('restricted') };

  await startShell({}, {
    mount: async () => booted,
    connect: async () => connected,
    onFailure: (_container, error) => {
      throw error;
    },
  });

  assert.equal(shown.length, 1, 'the boot verdict never reached the shell');
  const verdict = shown[0];
  assert.ok(verdict?.kind === 'classified');
  assert.equal(verdict.classification.mode, 'restricted', 'the shell was shown a different mode');
});

test('startShell subscribes the shell to every later verdict', async () => {
  const shown: CompatVerdict[] = [];
  let publish: ((verdict: CompatVerdict) => void) | undefined;
  await startShell({}, {
    mount: async () => ({
      worker: { kind: 'unavailable', reason: 'no service worker in this suite' },
      showCompat: (verdict) => shown.push(verdict),
      unmount: () => {},
    }),
    connect: async () => ({
      compat: classified('full'),
      watch: (each) => {
        publish = each;
        return () => {};
      },
    }),
    onFailure: (_container, error) => {
      throw error;
    },
  });

  assert.ok(publish, 'startShell never started the §3.2 watch');
  publish(classified('read-only-incompatible', 99));
  assert.equal(shown.length, 2);
  const latest = shown[1];
  assert.ok(latest?.kind === 'classified');
  assert.equal(latest.classification.mode, 'read-only-incompatible');
});

/* ------------------------------------------------------------------- what the shell then says */

const CHAIN: ShellChainState = {
  epoch: undefined,
  phaseLabel: undefined,
  finalizedHeight: undefined,
  phaseFlags: undefined,
};

const shellHtml = (compat: CompatVerdict | undefined): string =>
  renderToStaticMarkup(
    h(Shell, {
      chain: CHAIN,
      compat,
      handoffEnabled: true,
      activeScreen: 'S21',
      children: h('p', null, 'content'),
    }),
  );

test('the shell renders the MODE, and a restricted runtime names its disabled surfaces', () => {
  const html = shellHtml(classified('restricted'));
  assert.ok(html.includes('data-compat-mode="restricted"'), html);
  assert.ok(html.includes('data-compat-signing="disabled"'), html);
  // §3.1's whole difference between this mode and "claiming Ready and failing lazily".
  assert.ok(html.includes(`data-compat-disabled="${CRITICAL_SURFACE[0]!.id}"`), html);
});

test('a read-only-incompatible runtime says signing is off and points at a newer release', () => {
  const html = shellHtml(classified('read-only-incompatible', 4_242));
  assert.ok(html.includes('data-compat-mode="read-only-incompatible"'), html);
  assert.ok(html.includes('data-compat-signing="disabled"'), html);
  assert.match(html, /4242/);
  assert.match(html, /newer release/);
});

test('a full runtime renders no compat notice at all', () => {
  const html = shellHtml(classified('full'));
  assert.ok(!html.includes('data-compat-mode'), `a healthy session was given a notice: ${html}`);
});

test('CompatUnavailable states its reason and names NO disabled surface (10 §3.1)', () => {
  // The refusal §3.1 spells out: naming one here would put "this surface is absent from this
  // runtime" on screen about surfaces nothing looked at.
  const html = shellHtml(unestablished('the metadata could not be pulled'));
  assert.ok(html.includes('data-compat-code="FE-COMPAT-003"'), html);
  assert.ok(html.includes('data-compat-mode="none"'), html);
  assert.ok(!html.includes('data-compat-disabled'), `a surface was named as disabled: ${html}`);
  assert.match(html, /could not be pulled/);
});

test('a header surface the runtime dropped says so, rather than saying "not read yet"', () => {
  // INV-FE-12's read half — "reads continue only where compatibility probes pass" — with the
  // named reason the same invariant requires. The two absences are different facts: one is
  // about this client, the other about the chain, and a user waiting for a number that is never
  // coming is the worse of the two wrong answers.
  const epochId = CRITICAL_SURFACE.find((e) => e.pallet === 'Epoch' && e.member === 'EpochOf')?.id;
  assert.ok(epochId, 'CRITICAL_SURFACE no longer carries Epoch.EpochOf — this test is vacuous');
  const restricted: CompatVerdict = {
    kind: 'classified',
    classification: {
      mode: 'restricted',
      specVersion: 1,
      disabled: [{ id: epochId, level: 'incompatible', reason: 'Epoch.EpochOf is absent from this runtime.' }],
      proven: CRITICAL_SURFACE.filter((e) => e.id !== epochId).map((e) => e.id),
    },
    codeHash: undefined,
  };
  const html = shellHtml(restricted);
  assert.ok(html.includes('data-compat-unavailable="epoch"'), html);
  assert.match(html, /Epoch\.EpochOf is absent from this runtime/);

  // …and the same header with nothing classified yet says the honest other thing.
  const pending = shellHtml(undefined);
  assert.ok(!pending.includes('data-compat-unavailable'), pending);
  assert.match(pending, /Not read yet/);
});

test('the notice is rendered by CompatNotice itself, so no screen can forget it', () => {
  // Rendered directly, because `Shell` composing it is what makes it present on every route —
  // and a component only ever exercised through `Shell` would let a later layout change move it
  // behind a route without any test noticing.
  const html = renderToStaticMarkup(h(CompatNotice, { compat: classified('restricted') }));
  assert.ok(html.includes('data-compat-mode="restricted"'), html);
  assert.equal(renderToStaticMarkup(h(CompatNotice, { compat: undefined })), '');
});

/* ------------------------------------------------------------------ INV-FE-12's own sentence */

test('signingBlockedReason answers exactly where verdictAllowsSigning refuses', () => {
  const inv = theLineContaining(
    architecture('15-invariants-and-testing.md'),
    'INV-FE-12 (fail-safe under unknown runtimes)',
  );
  assert.match(inv, /signing is disabled wherever compatibility is unproven/);

  const cases: readonly CompatVerdict[] = [
    classified('full'),
    classified('restricted'),
    classified('read-only-incompatible'),
    unestablished(),
    { kind: 'not-attempted', reason: 'no chain was connected' },
  ];
  for (const verdict of cases) {
    const blocked = signingBlockedReason(verdict);
    assert.equal(
      blocked === undefined,
      verdictAllowsSigning(verdict),
      `the sentence and the gate disagree for ${verdict.kind}`,
    );
    if (blocked !== undefined) assert.ok(blocked.length > 0, 'a refusal with no reason');
  }
});
