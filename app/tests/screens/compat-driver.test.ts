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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COMPAT_RETRY_MAX_MS,
  COMPAT_RETRY_MIN_MS,
  CompatNotice,
  Shell,
  compatRetryDelayMs,
  decodeReleaseChannel,
  readReleaseChannel,
  releaseChannelKey,
  signingBlockedReason,
  startShell,
  verdictAllowsSigning,
  watchCompat,
  type BootedShell,
  type CompatVerdict,
  type ConnectedChain,
  type ReleaseChannelPointer,
  type ScheduleDelay,
  type ShellChainState,
} from '@bleavit/application';
import { CRITICAL_SURFACE, type CompatClassification } from '@bleavit/descriptors';
import type { FinalizedBlockRef, RuntimeVersionReport } from '@bleavit/chain-client';
// `finalize` is test-only on purpose — see packages/chain-client/src/testing.ts.
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString } from '@bleavit/shared-types';
import { APP_ROOT, DOC_10, REPO_ROOT, architecture, theLineContaining } from './spec-sources.ts';

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

/* ---------------------------------------- 10 §5.3's newer-release pointer (F26) */

/**
 * The `read-only-incompatible` arm told the user to load a newer release and pointed at
 * nothing: no module in `src` or `packages` read `Constitution.ReleaseChannel` at all. These
 * tests bind the repair to the two things that can make it wrong — the frozen key it reads, and
 * the frozen offsets it parses — and to the rule that matters more than either: an unread
 * channel must never render as *"there is no newer release"*.
 */

/** The block every pointer fixture is read at. */
const CHANNEL_PIN: FinalizedBlockRef = {
  chain: `0x${'ce'.repeat(32)}` as HexString,
  blockHash: '0xfeed',
  blockNumber: 909,
};

/**
 * A `ReleaseChannel` value at 02 §12's frozen layout — 168 bytes, fixed width, no prefixes.
 *
 * The offsets are written out here rather than imported, and that is the point of the fixture:
 * a builder that asked the module under test where the fields are would agree with it whatever
 * it said. `version` is `[u8; 32]` at 1 and `manifest_txid` is `[u8; 43]` at **33**, so a reader
 * that took 32 bytes for the TXID would produce a truncated Arweave address that fetches
 * nothing — and would look completely plausible on screen.
 */
function releaseChannelBytes(
  over: { readonly version?: string; readonly txid?: string; readonly updatedAt?: number } = {},
): string {
  const bytes = new Uint8Array(168);
  bytes[0] = 1; // schema
  const put = (text: string, at: number, width: number): void => {
    const encoded = new TextEncoder().encode(text);
    assert.ok(encoded.length <= width, `${text} does not fit in ${width} bytes`);
    bytes.set(encoded, at);
  };
  put(over.version ?? '', 1, 32);
  put(over.txid ?? '', 33, 43);
  const updatedAt = over.updatedAt ?? 0;
  bytes[108] = updatedAt & 0xff;
  bytes[109] = (updatedAt >>> 8) & 0xff;
  bytes[110] = (updatedAt >>> 16) & 0xff;
  bytes[111] = (updatedAt >>> 24) & 0xff;
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const channelRead = (raw: string | undefined) => finalize(raw, CHANNEL_PIN);

/** A canonical release, as a chain that has repointed publishes it. */
const NAMED_CHANNEL = releaseChannelBytes({
  version: '1.4.0',
  txid: 'A'.repeat(43),
  updatedAt: 4_242,
});

test('the pointer reads the key 02 §12 freezes, not one this client invented', () => {
  // A wrong storage key does not fail — it returns no value, which this module would report as
  // "the chain names no release". So the derivation is pinned against the key the recorder
  // actually sent to the node, and against the raw key the surface manifest freezes.
  const fixture: unknown = JSON.parse(
    readFileSync(
      resolve(APP_ROOT, 'fixtures/chainhead/storage.constitution.release_channel.json'),
      'utf8',
    ),
  );
  const requests = (fixture as { requests: { method: string; params: unknown }[] }).requests;
  // Read per method rather than by scanning for anything hex-shaped: the pinned block hash is
  // also a 32-byte hex string in these params, and a scan that swept it up would compare the
  // derived key against a block and report a mismatch that means nothing.
  const recorded = requests.flatMap((request) => {
    const params = Array.isArray(request.params) ? request.params : [];
    if (request.method === 'chainHead_v1_storage') {
      const items = params[2];
      return (Array.isArray(items) ? items : []).map((item) =>
        String((item as { key: unknown }).key),
      );
    }
    if (request.method === 'state_getStorage') return [String(params[0])];
    return [];
  });
  assert.equal(recorded.length, 2, 'the recorded exchange no longer sends both storage requests');
  for (const key of recorded) {
    assert.equal(key, releaseChannelKey(), 'the derived key is not the one the node was asked');
  }

  const manifest: unknown = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'tools/release/surface-manifest.json'), 'utf8'),
  );
  const entry = (manifest as { entries: { id: string; raw_key?: string }[] }).entries.find(
    (row) => row.id === 'storage.constitution.release_channel',
  );
  assert.ok(entry !== undefined, '02 §12 freezes no release-channel entry any more');
  assert.equal(entry.raw_key, releaseChannelKey(), 'the frozen raw key and the derived key differ');
});

test('the recorded chain bytes decode at 02 §12’s offsets, and name no release yet', () => {
  // The genesis record: `schema = 1` and every published field empty. This is the arm a real
  // chain answers with today, and it is a chain fact rather than a defect — which is exactly
  // why it must not render as "you are up to date".
  const recorded: unknown = JSON.parse(
    readFileSync(
      resolve(APP_ROOT, 'fixtures/chainhead/storage.constitution.release_channel.json'),
      'utf8',
    ),
  );
  const value = (recorded as { requests: { response: unknown }[] }).requests
    .map((request) => request.response)
    .find((response): response is string => typeof response === 'string');
  assert.ok(value !== undefined, 'the fixture records no raw release-channel value');
  assert.equal((value.length - 2) / 2, 168, 'the recorded record is not the frozen 168 bytes');

  const pointer = decodeReleaseChannel(channelRead(value));
  assert.equal(pointer.kind, 'unnamed');
});

test('a repointed channel yields the version, the TXID and the block, each pinned', () => {
  const pointer = decodeReleaseChannel(channelRead(NAMED_CHANNEL));
  assert.equal(pointer.kind, 'named');
  assert.ok(pointer.kind === 'named');
  assert.equal(pointer.version.value, '1.4.0');
  assert.equal(pointer.manifestTxid.value, 'A'.repeat(43));
  assert.equal(pointer.updatedAt.value, 4_242);
  // Every field descends from the read, so a pointer cannot be shown at a block nothing read.
  for (const datum of [pointer.version, pointer.manifestTxid, pointer.updatedAt]) {
    assert.equal(datum.status.kind, 'verified-finalized');
    assert.equal(
      'blockHash' in datum.status ? datum.status.blockHash : undefined,
      CHANNEL_PIN.blockHash,
    );
  }
});

test('half a pointer is no pointer: a version with no TXID cannot be fetched', () => {
  assert.equal(decodeReleaseChannel(channelRead(releaseChannelBytes({ version: '1.4.0' }))).kind, 'unnamed');
  assert.equal(
    decodeReleaseChannel(channelRead(releaseChannelBytes({ txid: 'A'.repeat(43) }))).kind,
    'unnamed',
  );
});

test('bytes that are not the frozen layout are shown raw, never guessed at', () => {
  // App-code rule 10 and INV-FE-12. A guess here sends a stranded user after an artifact
  // nobody published, which is worse than telling them the record is unreadable.
  const short = decodeReleaseChannel(channelRead('0x0100'));
  assert.equal(short.kind, 'undecodable');
  assert.ok(short.kind === 'undecodable');
  assert.match(short.reason, /168/);
  assert.equal(short.rawHex, '0x0100');

  // An interior NUL is a refusal rather than a truncation: `"1.4.0\0evil"` cut at the NUL would
  // put a version on screen that the record does not name.
  const spliced = releaseChannelBytes({ version: '1.4.0', txid: 'A'.repeat(43) });
  const bytes = [...(spliced.slice(2).match(/../g) ?? [])];
  bytes[1 + 6] = '65'; // a byte past the version's terminating NUL
  assert.equal(decodeReleaseChannel(channelRead(`0x${bytes.join('')}`)).kind, 'undecodable');
});

test('a read that did not land is `unread`, and never silence', async () => {
  const pointer = await readReleaseChannel({
    storage: () => Promise.reject(new Error('the transport is down')),
  });
  assert.equal(pointer.kind, 'unread');
  assert.ok(pointer.kind === 'unread');
  assert.match(pointer.reason, /the transport is down/);
});

test('readReleaseChannel asks for the frozen key and decodes what comes back', async () => {
  const asked: string[] = [];
  const pointer = await readReleaseChannel({
    storage: (key: string) => {
      asked.push(key);
      return Promise.resolve(finalize([{ key, value: NAMED_CHANNEL }], CHANNEL_PIN));
    },
  });
  assert.deepEqual(asked, [releaseChannelKey()]);
  assert.equal(pointer.kind, 'named');
});

test('read-only-incompatible renders the pointer the mode’s own sentence promises', () => {
  const html = renderToStaticMarkup(
    h(CompatNotice, {
      compat: classified('read-only-incompatible', 4_242),
      channel: decodeReleaseChannel(channelRead(NAMED_CHANNEL)),
    }),
  );
  assert.ok(html.includes('data-compat-pointer="named"'), html);
  assert.match(html, /1\.4\.0/, 'the canonical release version is not on screen');
  assert.ok(html.includes('A'.repeat(43)), 'the Arweave TXID is not on screen');
  assert.match(html, /#4,?242/, 'the block the channel was last written at is not on screen');
});

test('the three arms that establish nothing say so, and never imply there is nothing', () => {
  // The defect class this repair is part of: answering from the absence of evidence. A client
  // that could not read the channel has established nothing about whether a newer release
  // exists, and a stranded user who reads "no newer release" stops looking.
  const arms: readonly (ReleaseChannelPointer | undefined)[] = [
    undefined,
    { kind: 'unread', reason: 'the transport is down' },
    { kind: 'unnamed', reason: 'the record names none' },
    { kind: 'undecodable', reason: 'six bytes', rawHex: '0xdeadbeef' },
  ];
  for (const channel of arms) {
    const html = renderToStaticMarkup(
      h(CompatNotice, { compat: classified('read-only-incompatible'), channel }),
    );
    assert.ok(/data-compat-pointer="/.test(html), `no pointer arm rendered for ${channel?.kind}`);
    assert.ok(
      /not (a statement that none exists|evidence that none exists)|Nothing is being inferred|may still have been published/.test(
        html,
      ),
      `an arm that established nothing did not say so: ${html}`,
    );
  }
});

test('the pointer is rendered on read-only-incompatible ALONE', () => {
  // `restricted` is a runtime that dropped a surface this release depends on. Telling that user
  // to load a newer app sends them after a fix that is not theirs to make, and `full` renders
  // no notice at all.
  const restricted = renderToStaticMarkup(
    h(CompatNotice, {
      compat: classified('restricted'),
      channel: decodeReleaseChannel(channelRead(NAMED_CHANNEL)),
    }),
  );
  assert.ok(!restricted.includes('data-compat-pointer'), restricted);
  assert.ok(!restricted.includes('1.4.0'), restricted);
  assert.equal(
    renderToStaticMarkup(
      h(CompatNotice, {
        compat: classified('full'),
        channel: decodeReleaseChannel(channelRead(NAMED_CHANNEL)),
      }),
    ),
    '',
  );
});

test('the shell passes the channel through, so no route can lose the pointer', () => {
  // §11.10's argument for the banner, applied here: the notice is rendered once in the shell,
  // outside the outlet. A `Shell` that accepted the reading and dropped it would render the
  // "load a newer release" sentence with nothing under it on every route.
  const html = renderToStaticMarkup(
    h(Shell, {
      chain: CHAIN,
      compat: classified('read-only-incompatible'),
      channel: decodeReleaseChannel(channelRead(NAMED_CHANNEL)),
      handoffEnabled: true,
      activeScreen: 'S21',
      children: h('p', null, 'content'),
    }),
  );
  assert.ok(html.includes('data-compat-pointer="named"'), html);
  assert.ok(html.includes('A'.repeat(43)), html);
});

test('10 §5.3 is what this reads, and it still says the raw key', () => {
  // The binding that makes the tests above non-vacuous: if the specification stopped naming the
  // fixed-layout raw key, a client reading it would be implementing a deleted mechanism.
  const line = theLineContaining(
    architecture(DOC_10),
    'fixed-layout raw storage key',
  );
  assert.match(line, /ReleaseChannel/);
  assert.match(line, /without current metadata/);
  assert.match(line, /newer-release pointer/);
});

/* -------------------------------------- the pointer reaches the shell, on every stranded verdict */

/** A `BootedShell` double that records what it was shown, verdict and pointer together. */
function recordingShell(): {
  readonly booted: BootedShell;
  readonly shown: { compat: CompatVerdict; channel: ReleaseChannelPointer | undefined }[];
} {
  const shown: { compat: CompatVerdict; channel: ReleaseChannelPointer | undefined }[] = [];
  return {
    shown,
    booted: {
      worker: { kind: 'unavailable', reason: 'no service worker in this suite' },
      showCompat: (compat, channel) => shown.push({ compat, channel }),
      unmount: () => {},
    },
  };
}

test('a stranded boot verdict is shown at once, then again with the pointer', async () => {
  // Two renders, in this order, and the order is the requirement rather than an artefact: the
  // notice explains why nothing works and must not wait on a round trip, and the pointer is the
  // remedy and must not be skipped because the notice already painted.
  const { booted, shown } = recordingShell();
  const pointer = decodeReleaseChannel(channelRead(NAMED_CHANNEL));
  let reads = 0;
  await startShell({}, {
    mount: async () => booted,
    connect: async () => ({
      compat: classified('read-only-incompatible', 9),
      readChannel: async () => {
        reads += 1;
        return pointer;
      },
    }),
    onFailure: (_container, error) => {
      throw error;
    },
  });
  assert.equal(reads, 1, 'the release channel was not read for a stranded verdict');
  assert.equal(shown.length, 2, `expected verdict-then-pointer: ${JSON.stringify(shown.length)}`);
  assert.equal(shown[0]?.channel, undefined, 'the notice waited on the pointer read');
  assert.equal(shown[1]?.channel, pointer);
});

test('a healthy verdict reads no channel at all', async () => {
  // §5.3 gives this key to a stranded client. A chain that answers everything else needs no
  // rescue read, and issuing one on every boot would be a round trip for nobody.
  const { booted, shown } = recordingShell();
  let reads = 0;
  for (const mode of ['full', 'restricted'] as const) {
    await startShell({}, {
      mount: async () => booted,
      connect: async () => ({
        compat: classified(mode),
        readChannel: async () => {
          reads += 1;
          return { kind: 'unnamed', reason: 'nothing' };
        },
      }),
      onFailure: (_container, error) => {
        throw error;
      },
    });
  }
  assert.equal(reads, 0, 'a healthy session read the release channel');
  assert.ok(shown.every((row) => row.channel === undefined), JSON.stringify(shown));
});

test('a session that becomes stranded MID-SESSION gets the pointer too', async () => {
  // The ordinary way a client is stranded: it booted fine and a runtime upgrade moved the
  // `spec_version` past what this release ships descriptors for. §3.2 re-runs the classifier on
  // every `CodeUpdated`, so a pointer read once at connect would be the one thing missing at
  // exactly the moment the mode it exists for arrives.
  const { booted, shown } = recordingShell();
  let publish: ((verdict: CompatVerdict) => void) | undefined;
  const pointer = decodeReleaseChannel(channelRead(NAMED_CHANNEL));
  await startShell({}, {
    mount: async () => booted,
    connect: async () => ({
      compat: classified('full'),
      readChannel: async () => pointer,
      watch: (each) => {
        publish = each;
        return () => {};
      },
    }),
    onFailure: (_container, error) => {
      throw error;
    },
  });
  assert.ok(publish, 'the §3.2 watch never started');
  publish(classified('read-only-incompatible', 9));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    shown.map((row) => row.channel),
    [undefined, undefined, pointer],
    'the mid-session stranded verdict never got its pointer',
  );
});

test('a channel read that throws still renders a pointer, and it is `unread`', async () => {
  // The injected function may reject where the real one does not, and an unhandled rejection
  // behind the `void` at the call site would leave the pointer silently absent — the state this
  // whole repair removes.
  const { booted, shown } = recordingShell();
  await startShell({}, {
    mount: async () => booted,
    connect: async () => ({
      compat: classified('read-only-incompatible', 9),
      readChannel: () => Promise.reject(new Error('the worker died')),
    }),
    onFailure: (_container, error) => {
      throw error;
    },
  });
  const last = shown[shown.length - 1];
  assert.equal(last?.channel?.kind, 'unread');
  assert.match(
    last?.channel?.kind === 'unread' ? last.channel.reason : '',
    /the worker died/,
  );
});

test('a boot that never connected offers no channel read', async () => {
  // `not-attempted` has no transport, so there is nothing to read through — the same arm, and
  // the same reason, as its missing `watch`.
  const { connectAndClassify } = await import('@bleavit/application');
  const connected = await connectAndClassify();
  assert.equal(connected.compat.kind, 'not-attempted');
  assert.equal(connected.readChannel, undefined, 'a chainless boot offered a channel read');
});
