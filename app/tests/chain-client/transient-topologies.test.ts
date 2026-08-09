/**
 * The release accounting for 10 §4.1's transient compat-probe handle.
 *
 * **This file exists because the R-6 review of 2026-08-08 found a leak that had shipped, and
 * diagnosed why it could:** neither `compatProvider()` nor `assetHubCompatProvider()` had a
 * single test. The leak was a counting error — `getSmProvider` re-invokes its chain factory
 * on every halt and on `onReady(null)`, each call adds a relay **and** a parachain, and the
 * handle remembered only the newest pair. Every earlier pair kept syncing until the client
 * terminated, on a path 10 §3.2 re-runs on every `CodeUpdated`.
 *
 * The count itself lives inside a PAPI closure and no assertion can reach it through
 * `compatProvider()`. So the accounting is extracted and driven here directly, which is the
 * whole of what a test can honestly claim: that tracking N topologies and releasing stops N
 * of them and leaves the shared registry clean. That smoldot syncs, and that PAPI really
 * re-invokes the factory, remain outside what any test in this repository reaches —
 * `light-client.ts` says so at its own head.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { transientTopologies } from '@bleavit/chain-client/light-client';

interface FakeTopology {
  readonly name: string;
  stopped: number;
  stop(): void;
}

function topology(name: string): FakeTopology {
  return {
    name,
    stopped: 0,
    stop(): void {
      this.stopped += 1;
    },
  };
}

test('releasing stops every topology the handle created, not only the last', () => {
  // Three, because the defect is invisible at one and ambiguous at two: a handle that keeps
  // only the newest passes a two-element test if the assertion is written on the last one.
  const registry: FakeTopology[] = [];
  const handle = transientTopologies(registry);
  const made = [topology('first'), topology('second'), topology('third')];
  for (const each of made) {
    registry.push(each);
    handle.track(each);
  }

  handle.releaseAll();

  assert.deepEqual(
    made.map((t) => [t.name, t.stopped]),
    [
      ['first', 1],
      ['second', 1],
      ['third', 1],
    ],
  );
  assert.deepEqual(registry, [], 'a released topology stayed in the shared registry');
});

test('a released topology leaves the registry, so teardown does not stop it twice', () => {
  // `stop()` on the client walks the same array. A handle that stopped its topologies and
  // left them listed would have each stopped again on teardown — harmless today and exactly
  // the kind of double-free that stops being harmless when `stop()` grows a side effect.
  const survivor = topology('the reader');
  const registry: FakeTopology[] = [survivor];
  const handle = transientTopologies(registry);
  const probe = topology('the probe');
  registry.push(probe);
  handle.track(probe);

  handle.releaseAll();
  for (const each of registry) each.stop(); // what `LightClient.stop()` does

  assert.equal(probe.stopped, 1, 'the probe topology was stopped twice');
  assert.equal(survivor.stopped, 1, 'the reader topology was not stopped by teardown');
});

test('releasing twice is a no-op, and one handle never releases another', () => {
  const registry: FakeTopology[] = [];
  const handle = transientTopologies(registry);
  const first = topology('first');
  registry.push(first);
  handle.track(first);

  handle.releaseAll();
  handle.releaseAll();

  assert.equal(first.stopped, 1);
  assert.deepEqual(registry, []);
});

test('a topology tracked after release is stopped at once, never left running', () => {
  // **The late `track()`** — the same leak, one race later, and the case this handle is most
  // likely to meet in production rather than least.
  //
  // `compatProvider()`'s factory is `async () => { const topology = await newTopology();
  // created.track(topology); return topology.para; }`, and the pull it feeds carries
  // `COMPAT_PULL_DEADLINE_MS`. When the deadline fires first, `classifyChain`'s `finally`
  // calls `release()` while every in-flight `newTopology()` is still awaiting
  // `startTopology` — which is exactly what a slow or unreachable chain produces, the very
  // condition the deadline exists for.
  //
  // The pinned SDK does not cancel those calls. `getSmProvider`'s teardown is
  // `() => { isRunning = false; }` and nothing more; the pending factory promise still
  // resolves, and `sm-provider` then runs `resolvedChain.remove()`, which removes the
  // **parachain alone**. The relay chain and the `Topology` survive, and `track()` files
  // them under a handle whose one `release()` has already run and will not run again — so
  // they sync unreferenced until `LightClient.stop()`. A handle that closes the first leak
  // and leaves this one open has not closed the leak.
  //
  // Three late arrivals, for the reason the first case states: `getSmProvider` re-invokes
  // the factory on every halt and on `onReady(null)`, so several are in flight at once, and
  // a latch that handled only the newest passes at two if the assertion names the last one.
  const survivor = topology('the reader');
  const registry: FakeTopology[] = [survivor];
  const handle = transientTopologies(registry);
  const early = topology('before the deadline');
  registry.push(early);
  handle.track(early);

  handle.releaseAll(); // the deadline fires and `classifyChain`'s `finally` runs

  const late = [topology('first late'), topology('second late'), topology('third late')];
  for (const each of late) {
    registry.push(each); // `newTopology()` pushed it before returning
    handle.track(each);
  }

  assert.deepEqual(
    late.map((t) => [t.name, t.stopped]),
    [
      ['first late', 1],
      ['second late', 1],
      ['third late', 1],
    ],
    'a topology that arrived after release was left running',
  );
  assert.deepEqual(registry, [survivor], 'a late topology stayed in the shared registry');
  assert.equal(early.stopped, 1, 'the released topology was stopped again');
  assert.equal(survivor.stopped, 0, 'a late arrival stopped the reader topology');

  // And teardown must still not double-stop what this handle already stopped.
  handle.releaseAll();
  for (const each of registry) each.stop(); // what `LightClient.stop()` does
  assert.deepEqual(
    late.map((t) => t.stopped),
    [1, 1, 1],
    'a late topology was stopped twice',
  );
  assert.equal(survivor.stopped, 1, 'the reader topology was not stopped by teardown');
});

test('two handles account separately, which is what makes a per-call handle safe', () => {
  // `compatProvider()` returns a fresh handle per call and 10 §3.2 re-classifies on every
  // `CodeUpdated`, so two handles are live whenever one probe outlives the start of another.
  // Releasing one must not stop the other's chains.
  const registry: FakeTopology[] = [];
  const earlier = transientTopologies(registry);
  const later = transientTopologies(registry);
  const mine = topology('earlier probe');
  const theirs = topology('later probe');
  registry.push(mine, theirs);
  earlier.track(mine);
  later.track(theirs);

  earlier.releaseAll();

  assert.equal(mine.stopped, 1);
  assert.equal(theirs.stopped, 0, 'releasing one handle stopped a topology it did not create');
  assert.deepEqual(registry, [theirs]);
});
