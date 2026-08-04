/**
 * Hash-pinned chain specs and the two-chain smoldot topology — 10 §4.1, §4.3, §3.1.
 *
 * Everything here is *our* wiring: the order chains are added in, the linkage that makes
 * `potentialRelayChains` effective, the dial set, the identity check, and what happens to
 * the chains when identity fails. None of it needs a WASM light client to be wrong, and
 * none of it needs one to be tested — the smoldot client is a double that records what it
 * was asked to do, which is exactly the surface these rules are about.
 *
 * What this cannot show is that smoldot then syncs. That is FE-P4 and the B7 drills.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  ChainSpecIntegrityError,
  TopologyError,
  WrongChainError,
  chainSpecHash,
  startTopology,
  verifyBundledChainSpec,
} from '@bleavit/chain-client';

const RELAY_GENESIS = `0x${'11'.repeat(32)}`;
const PARA_GENESIS = `0x${'22'.repeat(32)}`;

function specText(overrides = {}) {
  return JSON.stringify({
    name: 'Bleavit',
    id: 'bleavit',
    chainType: 'Live',
    bootNodes: ['/dns/a.example/tcp/443/wss/p2p/12D3KooWA'],
    genesis: { raw: { top: { '0x3a636f6465': '0x00' } } },
    ...overrides,
  });
}

async function bundled(text, pinned) {
  return { pinned: { ...pinned, sha256: await chainSpecHash(text) }, chainSpec: text };
}

async function pair(overrides = {}) {
  const relayText = specText({ id: 'paseo-local', name: 'Paseo Local', ...overrides.relaySpec });
  const paraText = specText({ id: 'bleavit', relayChain: 'paseo-local', ...overrides.paraSpec });
  return {
    relay: await bundled(relayText, { id: 'paseo-local', kind: 'relay', genesisHash: RELAY_GENESIS }),
    para: await bundled(paraText, {
      id: 'bleavit',
      kind: 'para',
      genesisHash: PARA_GENESIS,
      relayChainId: 'paseo-local',
    }),
  };
}

/** A smoldot client double that records what it was asked to do. */
function fakeClient() {
  const calls = [];
  const removed = [];
  const client = {
    async addChain(options) {
      const chain = {
        options,
        sendJsonRpc() {},
        async nextJsonRpcResponse() {
          return '{}';
        },
        remove() {
          removed.push(chain);
        },
      };
      calls.push({ options, chain });
      return chain;
    },
    async terminate() {},
  };
  return { client, calls, removed };
}

/** Answer the identity probe honestly: relay first, then parachain (that is the order). */
function start(client, specs, options = {}) {
  let probes = 0;
  return startTopology(client, {
    ...specs,
    genesisHashOf: async () => (probes++ === 0 ? RELAY_GENESIS : PARA_GENESIS),
    ...options,
  });
}

test('chainSpecHash agrees with an independent SHA-256', async () => {
  // Otherwise the pin and the checker are the same function agreeing with itself.
  const text = specText();
  const independent = `0x${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  assert.equal(await chainSpecHash(text), independent);
});

test('a spec whose bytes do not match the release pin is refused', async () => {
  const text = specText();
  await assert.rejects(
    () =>
      verifyBundledChainSpec(text, {
        id: 'bleavit',
        kind: 'relay',
        sha256: `0x${'00'.repeat(32)}`,
        genesisHash: RELAY_GENESIS,
      }),
    ChainSpecIntegrityError,
  );
});

test('a non-raw spec is refused here rather than inside addChain', async () => {
  // smoldot accepts raw specs only, and its failure for a non-raw one reads like a
  // connectivity problem — an hour spent on the network for a packaging defect.
  const text = specText({ genesis: { runtimeGenesis: { code: '0x00' } } });
  const pinned = { id: 'bleavit', kind: 'relay', sha256: await chainSpecHash(text), genesisHash: RELAY_GENESIS };
  await assert.rejects(
    () => verifyBundledChainSpec(text, pinned),
    (error) => error instanceof ChainSpecIntegrityError && /raw/.test(error.message),
  );
});

test('a relay spec that declares a relayChain is refused', async () => {
  // It would be treated as a parachain by smoldot, and the relay slot would silently be
  // empty — the one configuration 10 §3.1 says cannot exist.
  const specs = await pair({ relaySpec: { relayChain: 'polkadot' } });
  const { client, calls } = fakeClient();
  await assert.rejects(() => start(client, specs), ChainSpecIntegrityError);
  assert.equal(calls.length, 0);
});

test('both specs are verified before either chain is added', async () => {
  // Adding the relay and *then* discovering the parachain spec is unpinned would already
  // have connected the client to a network chosen by whoever supplied the bad bundle.
  const specs = await pair();
  const tampered = { ...specs, para: { ...specs.para, chainSpec: specs.para.chainSpec.replace('Bleavit', 'Bleavat') } };
  const { client, calls } = fakeClient();
  await assert.rejects(() => start(client, tampered), ChainSpecIntegrityError);
  assert.equal(calls.length, 0, 'a chain was added before the bundle was fully verified');
});

test('the relay is added first and the parachain is linked to that exact Chain object', async () => {
  // smoldot resolves relay candidates by object identity through a WeakMap. Passing `[]`
  // (the default) makes the parachain resolve its relay by `id` against every chain in the
  // client — the ambiguity smoldot's own documentation warns a near-miss `id` can exploit.
  const specs = await pair();
  const { client, calls } = fakeClient();
  const topology = await start(client, specs);

  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].options.chainSpec).id, 'paseo-local');
  assert.equal(calls[0].options.potentialRelayChains, undefined);
  assert.equal(JSON.parse(calls[1].options.chainSpec).id, 'bleavit');
  assert.deepEqual(calls[1].options.potentialRelayChains, [calls[0].chain]);
  assert.equal(topology.relay, calls[0].chain);
  assert.equal(topology.para, calls[1].chain);
});

test('a parachain naming a relay we did not bundle is refused', async () => {
  const specs = await pair({ paraSpec: { relayChain: 'westend' } });
  specs.para.pinned = { ...specs.para.pinned, relayChainId: 'westend' };
  const { client, calls } = fakeClient();
  await assert.rejects(() => start(client, specs), TopologyError);
  assert.equal(calls.length, 0);
});

test('a spec with nothing to dial is refused rather than left in permanent SyncDegraded', async () => {
  const specs = await pair({ paraSpec: { relayChain: 'paseo-local', bootNodes: [] } });
  const { client } = fakeClient();
  await assert.rejects(() => start(client, specs), TopologyError);
});

test('user bootnodes are added to the bundled set, never substituted for it', async () => {
  // A single hostile "helpful config" line that *replaced* the release dial set would be
  // an eclipse; 10 §4.3 allows local expert bootnodes, not a new network.
  const specs = await pair({ paraSpec: { relayChain: 'paseo-local', bootNodes: [] } });
  const { client, calls } = fakeClient();
  await start(client, specs, { extraBootnodes: ['/dns/local/tcp/30333/ws/p2p/12D3KooWZ'] });

  const relaySpec = JSON.parse(calls[0].options.chainSpec);
  assert.deepEqual(relaySpec.bootNodes, [
    '/dns/a.example/tcp/443/wss/p2p/12D3KooWA',
    '/dns/local/tcp/30333/ws/p2p/12D3KooWZ',
  ]);
});

test('an expert bootnode cannot smuggle a modified spec past the pin', async () => {
  // The override is applied strictly *after* verification, so the hash still authenticates
  // the bundled bytes. If the order were reversed the pin would authenticate whatever the
  // override produced, which is to say nothing.
  const specs = await pair();
  const forged = { ...specs, para: { ...specs.para, chainSpec: specs.para.chainSpec.replace('0x3a636f6465', '0x3a636f6466') } };
  const { client } = fakeClient();
  await assert.rejects(
    () => start(client, forged, { extraBootnodes: ['/dns/local/tcp/30333/ws/p2p/12D3KooWZ'] }),
    ChainSpecIntegrityError,
  );
});

test('a genesis mismatch is WrongChain and removes both chains', async () => {
  // Leaving them live behind a terminal screen would keep the client dialling and syncing
  // a chain we have just decided we cannot trust.
  const specs = await pair();
  const { client, calls, removed } = fakeClient();
  await assert.rejects(
    () =>
      startTopology(client, {
        ...specs,
        genesisHashOf: async () => `0x${'ff'.repeat(32)}`,
      }),
    (error) => error instanceof WrongChainError && error.code === 'FE-BOOT-003',
  );
  assert.equal(calls.length, 2);
  assert.equal(removed.length, 2, 'a chain was left running behind a terminal WrongChain');
});

test('the parachain identity is checked too, not just the relay', async () => {
  // Checking only the relay would authenticate the network and leave the chain the app
  // actually reads unverified — the more valuable of the two to substitute.
  const specs = await pair();
  const { client, removed } = fakeClient();
  let first = true;
  await assert.rejects(
    () =>
      startTopology(client, {
        ...specs,
        genesisHashOf: async () => {
          if (first) {
            first = false;
            return RELAY_GENESIS;
          }
          return `0x${'ee'.repeat(32)}`;
        },
      }),
    WrongChainError,
  );
  assert.equal(removed.length, 2);
});

test('the relay and parachain slots cannot be swapped', async () => {
  const specs = await pair();
  const { client, calls } = fakeClient();
  await assert.rejects(() => start(client, { relay: specs.para, para: specs.relay }), TopologyError);
  assert.equal(calls.length, 0);
});
