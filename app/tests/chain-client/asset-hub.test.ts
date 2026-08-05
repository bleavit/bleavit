/**
 * Connecting the Asset Hub leg — 11 §11.9.1, E17.
 *
 * `topology.test.ts` covers attaching the *chain*; this covers turning an attached chain into
 * a *connection*, which is a separate step with its own two ways of going wrong. Both are
 * silent, which is why the sequencing was lifted out of `light-client.ts` — the one module in
 * the package no test executes — into a form that takes its transport by injection.
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
