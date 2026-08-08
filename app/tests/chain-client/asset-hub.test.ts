/**
 * Connecting the Asset Hub leg — 11 §11.9.1, E17.
 *
 * `topology.test.ts` covers attaching the *chain*; this covers turning an attached chain into
 * a *connection*, which is a separate step with its own three ways of going wrong. All three
 * are silent, which is why the sequencing was lifted out of `light-client.ts` — the one module
 * in the package no test executes — into a form that takes its transport by injection.
 *
 * The third was found last and is the one this file could most easily have gone on missing:
 * every test below awaited its first `connect` before issuing the second, so all of them
 * described a connector between attempts and none described one **during** an attempt. That is
 * the state E17's *"retry AH sync"* acts on by construction, since the deposit leg stops
 * waiting long before a cold Asset Hub finishes syncing.
 *
 * Neither rule is about smoldot, so neither needs it. What is *not* covered here is
 * everything below that seam: that `getSmProvider` really does refuse a repeated chain, and
 * that a real follow subscription behaves as `ChainHeadConnection` expects. Those are FE-P4
 * and the B7 drills, exactly as `light-client.ts` says of itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assetHubConnector } from '@bleavit/chain-client';
import type { AssetHubLeg, BundledChain, SmoldotChainLike } from '@bleavit/chain-client';
import type { HexString } from '@bleavit/shared-types';

const GENESIS: HexString = `0x${'33'.repeat(32)}`;

/** A stand-in for the bundle; only `pinned.genesisHash` is read by the connector's callers. */
const BUNDLE = {
  pinned: { id: 'asset-hub', kind: 'para', sha256: `0x${'00'.repeat(32)}`, genesisHash: GENESIS },
  chainSpec: '{}',
} as const satisfies BundledChain;

interface FakeChain extends SmoldotChainLike {
  readonly label: string;
}

function fakeChain(label: string): FakeChain {
  return {
    label,
    sendJsonRpc() {},
    async nextJsonRpcResponse() {
      return '{}';
    },
    remove() {},
  };
}

/** An attached leg over a given chain, recording whether it was detached. */
function attachedLeg(chain: FakeChain, detached: FakeChain[]): AssetHubLeg<FakeChain> {
  return {
    kind: 'attached',
    chain,
    spec: { id: 'asset-hub', name: 'Asset Hub', relayChain: 'paseo-local', bootNodes: ['/dns/a'] },
    genesisHash: GENESIS,
    detach: () => {
      detached.push(chain);
    },
  };
}

test('a connected leg carries the transport and the genesis it attached on', async () => {
  const chain = fakeChain('ah');
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, []),
    openTransport: async () => 'transport',
    closeTransport: () => {},
  });
  const connection = await connector.connect(BUNDLE);
  assert.ok(connection.kind === 'attached', 'the leg did not connect');
  assert.equal(connection.transport, 'transport');
  assert.equal(connection.genesisHash, GENESIS);
});

test('a refused leg is passed through with nothing to read from', async () => {
  // Every arm but `attached` reaches the caller unchanged: the connector adds a transport, it
  // does not add a verdict. And a refused arm has no `transport` **field**, which is what
  // stops a caller reading through the refusal rather than a flag they must remember.
  const opened: string[] = [];
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => ({ kind: 'wrong-chain', genesisHash: `0x${'ff'.repeat(32)}`, reason: 'different chain' }),
    openTransport: async () => {
      opened.push('opened');
      return 'transport';
    },
    closeTransport: () => {},
  });
  const connection = await connector.connect(BUNDLE);
  assert.equal(connection.kind, 'wrong-chain');
  assert.equal('transport' in connection, false, 'a refused leg carried a transport');
  assert.deepEqual(opened, [], 'a transport was opened over a chain we refused');
});

test('a transport that fails to open DETACHES the chain', async () => {
  // The chain attached and proved its identity; only the follow subscription failed. Left
  // alone it goes on syncing with nothing reading it — the unreferenced-chain leak, in the
  // one path where the obvious code never reaches the teardown.
  const chain = fakeChain('ah');
  const detached: FakeChain[] = [];
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, detached),
    openTransport: async () => {
      throw new Error('follow stopped before the first finalized block');
    },
    closeTransport: () => {},
  });

  const connection = await connector.connect(BUNDLE);
  assert.equal(connection.kind, 'unavailable');
  assert.deepEqual(detached, [chain], 'the chain was left syncing after its transport failed');
  assert.match(connection.reason, /never reported a finalized block/);
});

test('a failed transport is retryable, and the retry really opens one', async () => {
  // E17's recovery action is "retry AH sync". A remembered failure would make that button do
  // nothing for the rest of the session — and the failure here is the *transient* kind, so
  // caching it is wrong in the direction that strands a working chain.
  const chain = fakeChain('ah');
  let fail = true;
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, []),
    openTransport: async () => {
      if (fail) {
        fail = false;
        throw new Error('no finalized block');
      }
      return 'transport';
    },
    closeTransport: () => {},
  });

  assert.equal((await connector.connect(BUNDLE)).kind, 'unavailable');
  const second = await connector.connect(BUNDLE);
  assert.ok(second.kind === 'attached', 'the retry returned the remembered failure');
  assert.equal(second.transport, 'transport');
});

test('a second connect NEVER opens a second provider over the same chain', async () => {
  // `getSmProvider` keeps a WeakSet of the chains it has been handed and refuses a repeat
  // with a **console warning, not an error** — so a second provider yields a transport
  // connected to nothing that reports success. Leaving the funding flow and coming back is
  // all it takes, and the symptom is a deposit screen that simply never loads.
  const chain = fakeChain('ah');
  const opens: FakeChain[] = [];
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, []),
    openTransport: async (c) => {
      opens.push(c);
      return `transport-${opens.length}`;
    },
    closeTransport: () => {},
  });

  const first = await connector.connect(BUNDLE);
  const second = await connector.connect(BUNDLE);
  assert.equal(opens.length, 1, 'a second provider was opened over a chain PAPI would refuse');
  assert.ok(first.kind === 'attached' && second.kind === 'attached');
  assert.equal(first.transport, second.transport);
});

test('the transport is handed the bundle, so its identity is the PIN', async () => {
  // The identity a transport stamps on every read it serves is a release-chosen value, not
  // one the chain reported. Passing only the chain would leave the caller reaching for the
  // pin some other way — which is where a mutable holding variable comes from, and how a
  // second connection ends up stamped with the first one's identity.
  const chain = fakeChain('ah');
  const seen: BundledChain[] = [];
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, []),
    openTransport: async (_c, bundled) => {
      seen.push(bundled);
      return 'transport';
    },
    closeTransport: () => {},
  });

  await connector.connect(BUNDLE);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.pinned.genesisHash, GENESIS);
});

test('close() closes the transport and leaves the chain to the topology', async () => {
  // The two lifetimes are deliberately separate: `stop()` owns every chain this topology
  // added, so a connector that also detached would be a second owner of the same resource —
  // and the one whose ordering nobody checks.
  const chain = fakeChain('ah');
  const detached: FakeChain[] = [];
  const closed: string[] = [];
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, detached),
    openTransport: async () => 'transport',
    closeTransport: (t) => {
      closed.push(t);
    },
  });

  await connector.connect(BUNDLE);
  connector.close();
  assert.deepEqual(closed, ['transport']);
  assert.deepEqual(detached, [], 'the connector detached a chain the topology owns');

  connector.close(); // idempotent
  assert.deepEqual(closed, ['transport']);
});

/** A promise whose settlement this file controls, so an attach can be held open. */
function deferred<V>(): {
  readonly promise: Promise<V>;
  readonly resolve: (value: V) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: V) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<V>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a connect that arrives while one is IN FLIGHT joins it', async () => {
  // The idempotence test above proves the *second* connect reuses the first — but only once
  // the first has finished. During the attach the cache is still empty, so the guard did not
  // apply and the whole sequence ran again: another chain added, another genesis probe,
  // another follow subscription. The last one to finish wrote the cache, so every earlier
  // transport became unreachable and `close()` could never reach it.
  const chain = fakeChain('ah');
  const gate = deferred<AssetHubLeg<FakeChain>>();
  let attaches = 0;
  const opens: FakeChain[] = [];
  const connector = assetHubConnector<FakeChain, string>({
    attach: () => {
      attaches += 1;
      return gate.promise;
    },
    openTransport: async (c) => {
      opens.push(c);
      return `transport-${opens.length}`;
    },
    closeTransport: () => {},
  });

  const first = connector.connect(BUNDLE);
  const second = connector.connect(BUNDLE);
  assert.equal(attaches, 1, 'the second connect started a second attach while one was running');

  gate.resolve(attachedLeg(chain, []));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(opens.length, 1, 'the second connect opened a second follow subscription');
  assert.ok(a.kind === 'attached' && b.kind === 'attached', 'a joined connect did not attach');
  assert.equal(a.transport, b.transport, 'the two callers hold different transports');
});

test('a deadline ABANDONS the attempt — it does not merely stop waiting', async () => {
  // The join is only safe if there is a way out of it. Without one, a shared attempt that
  // never settles pins the slot for the life of the connector, and E17's `R: retry AH sync`
  // can never start anything again — a control reporting a failure it cannot recover from,
  // which is worse than the unbounded wait it replaced. `probeGenesisHash` loops with no
  // timer and a real Asset Hub genesis probe has been observed pending past five minutes, so
  // this is the ordinary case.
  const chain = fakeChain('ah');
  const gate = deferred<AssetHubLeg<FakeChain>>();
  const detached: FakeChain[] = [];
  let attaches = 0;
  const connector = assetHubConnector<FakeChain, string>({
    attach: () => {
      attaches += 1;
      return attaches === 1 ? gate.promise : Promise.resolve(attachedLeg(chain, detached));
    },
    openTransport: async () => 'transport',
    closeTransport: () => {},
  });

  const first = await connector.connect(BUNDLE, { deadlineMs: 20 });
  assert.equal(first.kind, 'unavailable');
  assert.ok(first.kind === 'unavailable' && /did not complete within 20ms/.test(first.reason));

  // The slot is clear, so this really is a new attempt rather than a renewed wait on the old.
  const retry = await connector.connect(BUNDLE);
  assert.equal(attaches, 2, 'the retry rejoined an attempt that had already been given up on');
  assert.equal(retry.kind, 'attached');

  // And when the abandoned attach finally lands, it takes its own chain back down instead of
  // displacing the connection the retry established.
  gate.resolve(attachedLeg(fakeChain('abandoned'), detached));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    detached.map((each) => each.label),
    ['abandoned'],
    'the abandoned attempt left its chain syncing with nothing reading it',
  );
});

test('close() abandons an attach that is still running', async () => {
  // `close()` used to be a no-op against an in-flight attach: it returned at `open ===
  // undefined`, the attempt then ran to completion, installed a live transport nothing had
  // asked for, and served it to every later connect. The join widened that to every joiner.
  const gate = deferred<AssetHubLeg<FakeChain>>();
  const detached: FakeChain[] = [];
  const closed: string[] = [];
  const connector = assetHubConnector<FakeChain, string>({
    attach: () => gate.promise,
    openTransport: async () => 'transport',
    closeTransport: (t) => {
      closed.push(t);
    },
  });

  const joined = connector.connect(BUNDLE);
  connector.close();
  gate.resolve(attachedLeg(fakeChain('late'), detached));

  assert.equal((await joined).kind, 'unavailable', 'a closed connector still handed out a leg');
  assert.deepEqual(detached.map((each) => each.label), ['late'], 'the late chain was left syncing');
  // No transport is opened at all: the attempt finds itself abandoned at the first of its two
  // checkpoints, before it would have opened one. Closing something never opened is the
  // failure mode this assertion exists to keep out.
  assert.deepEqual(closed, [], 'a transport was opened for a connector that had been closed');
});

test('close() while the TRANSPORT is opening closes the one that lands', async () => {
  // The attempt's second checkpoint. Here the chain has already attached and the follow
  // subscription is in flight, so there is a real transport to lose — and losing it is exactly
  // the leak `close()` was supposed to prevent and could not reach.
  const chain = fakeChain('ah');
  const detached: FakeChain[] = [];
  const closed: string[] = [];
  const opening = deferred<string>();
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, detached),
    openTransport: () => opening.promise,
    closeTransport: (t) => {
      closed.push(t);
    },
  });

  const joined = connector.connect(BUNDLE);
  // Let the attach resolve so the attempt is parked inside `openTransport`, then close.
  await Promise.resolve();
  await Promise.resolve();
  connector.close();
  opening.resolve('transport');

  assert.equal((await joined).kind, 'unavailable');
  assert.deepEqual(closed, ['transport'], 'the transport that landed after close() was left open');
  assert.deepEqual(detached, [chain], 'its chain was left syncing with nothing reading it');
});

test('a bound that is not reached leaves the connection alone', async () => {
  // The negative control. A bound that refused a healthy connection would be worse than no
  // bound, and a suite that only ever sees the timeout cannot tell the two apart.
  const chain = fakeChain('ah');
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, []),
    openTransport: async () => 'transport',
    closeTransport: () => {},
  });
  const connection = await connector.connect(BUNDLE, { deadlineMs: 10_000 });
  assert.ok(connection.kind === 'attached', 'a healthy connect was refused by its own bound');
  assert.equal(connection.transport, 'transport');
});

test('a shared attempt that REFUSES is not remembered, so the next connect starts again', async () => {
  // The in-flight slot must clear on every settlement, not just on success. A refusal held in
  // it would turn "retry AH sync" into a button that replays one failure for the rest of the
  // session — the same defect the retryability test above guards, one layer up.
  const chain = fakeChain('ah');
  const gate = deferred<AssetHubLeg<FakeChain>>();
  let attaches = 0;
  const connector = assetHubConnector<FakeChain, string>({
    attach: () => {
      attaches += 1;
      return attaches === 1 ? gate.promise : Promise.resolve(attachedLeg(chain, []));
    },
    openTransport: async () => 'transport',
    closeTransport: () => {},
  });

  const first = connector.connect(BUNDLE);
  const joined = connector.connect(BUNDLE);
  gate.resolve({ kind: 'unavailable', reason: 'Asset Hub is not reachable from here.' });
  assert.equal((await first).kind, 'unavailable');
  assert.equal((await joined).kind, 'unavailable', 'the joined caller got a different answer');

  const third = await connector.connect(BUNDLE);
  assert.equal(attaches, 2, 'a refusal was remembered as if it were in flight');
  assert.equal(third.kind, 'attached');
});

test('an attach that THROWS clears the in-flight slot', async () => {
  // `assetHubConnector` never throws — every failure is an arm — so a throw means the attach
  // path itself broke. It must not leave a rejected promise cached as the answer to every
  // later connect, which is the shape a naive `inFlight` assignment produces.
  const chain = fakeChain('ah');
  let attaches = 0;
  const connector = assetHubConnector<FakeChain, string>({
    attach: () => {
      attaches += 1;
      return attaches === 1
        ? Promise.reject(new Error('the topology was stopped mid-attach'))
        : Promise.resolve(attachedLeg(chain, []));
    },
    openTransport: async () => 'transport',
    closeTransport: () => {},
  });

  await assert.rejects(connector.connect(BUNDLE), /stopped mid-attach/);
  const second = await connector.connect(BUNDLE);
  assert.equal(attaches, 2, 'a thrown attach was cached as the answer to every later connect');
  assert.equal(second.kind, 'attached');
});

test('close() then connect() opens a fresh transport rather than the closed one', async () => {
  // A screen that closes on unmount and reconnects on the next mount is the ordinary case,
  // and returning a closed transport would fail on the first read with an error about the
  // subscription rather than about the lifecycle.
  const chain = fakeChain('ah');
  let opens = 0;
  const connector = assetHubConnector<FakeChain, string>({
    attach: async () => attachedLeg(chain, []),
    openTransport: async () => `transport-${++opens}`,
    closeTransport: () => {},
  });

  const first = await connector.connect(BUNDLE);
  connector.close();
  const second = await connector.connect(BUNDLE);
  assert.ok(first.kind === 'attached' && second.kind === 'attached');
  assert.equal(second.transport, 'transport-2');
});
