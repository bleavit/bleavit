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
import type {
  AddChainOptionsLike,
  AssetHubLeg,
  BundledChain,
  PinnedChainSpec,
  SmoldotChainLike,
  SmoldotClientLike,
  TopologyOptions,
} from '@bleavit/chain-client';
// The consumer of the leg's verdict, imported so the two are bound by a test rather than by
// a convention: what `attachAssetHub` reports has to be what `classifyForeign` can read.
import { classifyForeign } from '@bleavit/descriptors';
import type { HexString } from '@bleavit/shared-types';

const RELAY_GENESIS: HexString = `0x${'11'.repeat(32)}`;
const PARA_GENESIS: HexString = `0x${'22'.repeat(32)}`;
const ASSET_HUB_GENESIS: HexString = `0x${'33'.repeat(32)}`;

/** What each fixture chain answers the identity probe with, by its spec `id`. */
const GENESIS_BY_ID: Readonly<Record<string, HexString>> = {
  'paseo-local': RELAY_GENESIS,
  bleavit: PARA_GENESIS,
  'asset-hub': ASSET_HUB_GENESIS,
};

/** A pin with the hash left out — `bundled()` computes it from the bytes it is given. */
type UnhashedPin = Omit<PinnedChainSpec, 'sha256'>;

function specText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'Bleavit',
    id: 'bleavit',
    chainType: 'Live',
    bootNodes: ['/dns/a.example/tcp/443/wss/p2p/12D3KooWA'],
    genesis: { raw: { top: { '0x3a636f6465': '0x00' } } },
    ...overrides,
  });
}

async function bundled(text: string, pinned: UnhashedPin): Promise<BundledChain> {
  return { pinned: { ...pinned, sha256: await chainSpecHash(text) }, chainSpec: text };
}

interface PairOverrides {
  readonly relaySpec?: Record<string, unknown>;
  readonly paraSpec?: Record<string, unknown>;
}

async function pair(overrides: PairOverrides = {}): Promise<{ relay: BundledChain; para: BundledChain }> {
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

/** The chain the double hands back, carrying the options it was created from. */
interface FakeChain extends SmoldotChainLike {
  readonly options: AddChainOptionsLike<FakeChain>;
}

interface FakeClient {
  readonly client: SmoldotClientLike<FakeChain>;
  readonly calls: { options: AddChainOptionsLike<FakeChain>; chain: FakeChain }[];
  readonly removed: FakeChain[];
}

/** A smoldot client double that records what it was asked to do. */
function fakeClient(): FakeClient {
  const calls: { options: AddChainOptionsLike<FakeChain>; chain: FakeChain }[] = [];
  const removed: FakeChain[] = [];
  const client: SmoldotClientLike<FakeChain> = {
    async addChain(options) {
      const chain: FakeChain = {
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

/** The nth recorded `addChain`, or a throw naming how many there really were. */
function nthCall(calls: FakeClient['calls'], n: number): FakeClient['calls'][number] {
  const call = calls[n];
  if (call === undefined) throw new Error(`addChain was called ${calls.length} time(s), not ${n + 1}`);
  return call;
}

/**
 * Answer the identity probe honestly, keyed on **which chain is being probed**.
 *
 * Was a call counter — relay first, then parachain. That is no longer sufficient now a
 * third chain can attach at an arbitrary later moment, and a counter would have answered
 * the Asset Hub probe with the parachain's genesis: the fixture would then agree with a
 * defect where the topology probed the wrong chain object.
 */
function start(
  client: SmoldotClientLike<FakeChain>,
  specs: { relay: BundledChain; para: BundledChain },
  options: Partial<TopologyOptions<FakeChain>> = {},
) {
  return startTopology(client, {
    ...specs,
    genesisHashOf: async (chain) => {
      const id = String((JSON.parse(chain.options.chainSpec) as { id?: unknown }).id);
      const genesis = GENESIS_BY_ID[id];
      if (genesis === undefined) throw new Error(`no genesis fixture for chain id ${JSON.stringify(id)}`);
      return genesis;
    },
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

test('a spec carrying neither genesis form is refused here rather than inside addChain', async () => {
  // smoldot accepts a `genesis.raw` map or a `genesis.stateRootHash` and nothing else; its
  // failure for a third form reads like a connectivity problem — an hour spent on the network
  // for a packaging defect.
  const text = specText({ genesis: { runtimeGenesis: { code: '0x00' } } });
  const pinned: PinnedChainSpec = {
    id: 'bleavit',
    kind: 'relay',
    sha256: await chainSpecHash(text),
    genesisHash: RELAY_GENESIS,
  };
  await assert.rejects(
    () => verifyBundledChainSpec(text, pinned),
    (error) => error instanceof ChainSpecIntegrityError && /raw/.test(error.message),
  );
});

test('a PARACHAIN anchored on a bare state root is accepted — F18, 2026-08-08', async () => {
  // The correction. This file used to refuse anything without `genesis.raw`, on the ground that
  // *"smoldot accepts only raw chain specifications"*. The pinned smoldot@3.3.2 says otherwise
  // in its own words — handed a raw genesis it logs that initialisation time *"can be
  // significantly improved by replacing the `raw` field with `stateRootHash`"* — and executing
  // both forms of one dev Asset Hub spec returned the identical genesis hash with `addChain`
  // resolving in 3 ms instead of 23,644 ms. Every published light-client spec uses this form,
  // so the old rule also meant this client could not load the artifact 02 §7.7 will pin.
  const text = specText({
    id: 'asset-hub',
    relay_chain: 'paseo-local',
    genesis: { stateRootHash: `0x${'ee'.repeat(32)}` },
  });
  const parsed = await verifyBundledChainSpec(text, {
    id: 'asset-hub',
    kind: 'para',
    sha256: await chainSpecHash(text),
    genesisHash: ASSET_HUB_GENESIS,
    relayChainId: 'paseo-local',
  });
  assert.equal(parsed.id, 'asset-hub');
});

test('a RELAY anchored on a bare state root is refused unless it carries a checkpoint', async () => {
  // A relay establishes its own finality from the GRANDPA authority set in genesis storage.
  // Without that storage and without a `lightSyncState` it syncs and never finalizes — which
  // on screen, and in a drill log, is indistinguishable from slow sync.
  const bare = specText({ id: 'paseo-local', genesis: { stateRootHash: `0x${'ee'.repeat(32)}` } });
  const pin = async (text: string): Promise<PinnedChainSpec> => ({
    id: 'paseo-local',
    kind: 'relay',
    sha256: await chainSpecHash(text),
    genesisHash: RELAY_GENESIS,
  });
  await assert.rejects(
    async () => verifyBundledChainSpec(bare, await pin(bare)),
    (error) => error instanceof ChainSpecIntegrityError && /never finalize/.test(error.message),
  );
  // …and a checkpoint makes it admissible, so the refusal is about the missing finality source
  // rather than about the form.
  const checkpointed = specText({
    id: 'paseo-local',
    genesis: { stateRootHash: `0x${'ee'.repeat(32)}` },
    lightSyncState: { finalizedBlockHeader: '0x00', grandpaAuthoritySet: '0x00' },
  });
  await verifyBundledChainSpec(checkpointed, await pin(checkpointed));
});

test('a spec declaring BOTH genesis forms is refused rather than resolved', async () => {
  // `relayChainOf`'s argument, applied to the anchor: two declarations of one fact are a spec
  // that has been edited, and the two need not describe the same state.
  const text = specText({ genesis: { raw: { top: {} }, stateRootHash: `0x${'ee'.repeat(32)}` } });
  await assert.rejects(
    async () =>
      verifyBundledChainSpec(text, {
        id: 'bleavit',
        kind: 'relay',
        sha256: await chainSpecHash(text),
        genesisHash: RELAY_GENESIS,
      }),
    (error) => error instanceof ChainSpecIntegrityError && /declares both/.test(error.message),
  );
});

test('a `stateRootHash` that is not a 32-byte hash is not a genesis form at all', async () => {
  // The shape check is what stops `"stateRootHash": "soon"` reading as an anchor. smoldot would
  // reject it inside `addChain`, where the message names neither the field nor the file.
  for (const stateRootHash of ['', '0xdeadbeef', 32, null]) {
    const text = specText({ id: 'asset-hub', relay_chain: 'paseo-local', genesis: { stateRootHash } });
    await assert.rejects(
      async () =>
        verifyBundledChainSpec(text, {
          id: 'asset-hub',
          kind: 'para',
          sha256: await chainSpecHash(text),
          genesisHash: ASSET_HUB_GENESIS,
          relayChainId: 'paseo-local',
        }),
      (error) => error instanceof ChainSpecIntegrityError && /neither/.test(error.message),
      `accepted ${JSON.stringify(stateRootHash)}`,
    );
  }
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
  assert.equal(JSON.parse(nthCall(calls, 0).options.chainSpec).id, 'paseo-local');
  assert.equal(nthCall(calls, 0).options.potentialRelayChains, undefined);
  assert.equal(JSON.parse(nthCall(calls, 1).options.chainSpec).id, 'bleavit');
  assert.deepEqual(nthCall(calls, 1).options.potentialRelayChains, [nthCall(calls, 0).chain]);
  assert.equal(topology.relay, nthCall(calls, 0).chain);
  assert.equal(topology.para, nthCall(calls, 1).chain);
});

test('a parachain naming a relay we did not bundle is refused', async () => {
  const built = await pair({ paraSpec: { relayChain: 'westend' } });
  const specs = {
    relay: built.relay,
    para: { ...built.para, pinned: { ...built.para.pinned, relayChainId: 'westend' } },
  };
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

  const relaySpec = JSON.parse(nthCall(calls, 0).options.chainSpec);
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

/* ------------------------------------------------ the lazy Asset Hub leg — 11 §11.9.1, E17 */

/**
 * A bundled Asset Hub spec. `pin` overrides land on the pin, `spec` overrides on the bytes,
 * so a test can make exactly one of the two wrong — which is what most of these are about.
 */
async function assetHubBundle(
  overrides: { spec?: Record<string, unknown>; pin?: Partial<UnhashedPin> } = {},
): Promise<BundledChain> {
  const text = specText({
    id: 'asset-hub',
    name: 'Asset Hub',
    relayChain: 'paseo-local',
    ...overrides.spec,
  });
  return bundled(text, {
    id: 'asset-hub',
    kind: 'para',
    genesisHash: ASSET_HUB_GENESIS,
    relayChainId: 'paseo-local',
    ...overrides.pin,
  });
}

/** Narrow to the attached arm, reporting the refusal's own reason when it is not. */
function attached<C extends SmoldotChainLike>(
  leg: AssetHubLeg<C>,
): Extract<AssetHubLeg<C>, { kind: 'attached' }> {
  assert.ok(
    leg.kind === 'attached',
    `expected an attached Asset Hub leg, got ${leg.kind}: ${leg.kind === 'attached' ? '' : leg.reason}`,
  );
  return leg;
}

/** Narrow to a refusing arm — deliberately widened, so a caller reads only `reason`. */
function refused<C extends SmoldotChainLike>(
  leg: AssetHubLeg<C>,
): { readonly kind: string; readonly reason: string } {
  assert.ok(leg.kind !== 'attached', 'expected the Asset Hub leg to be refused; it attached');
  return leg;
}

test('boot connects TWO chains — Asset Hub is attached later, or never (E17)', async () => {
  // 11 E17: "AH connection syncs on entering the flow (lazy — the AH chain is not connected
  // at boot)", and 10 §9.3 budgets its chain spec as lazy too. A session that never opens
  // the funding flow must never pay for a third chain's memory and sync — and an Asset Hub
  // failure must never happen during boot, where the only thing it could do is degrade a
  // state that has nothing to do with it.
  const specs = await pair();
  const { client, calls } = fakeClient();
  const topology = await start(client, specs);
  assert.equal(calls.length, 2, 'boot added a chain the funding flow had not asked for');

  const leg = attached(await topology.attachAssetHub(await assetHubBundle()));
  assert.equal(calls.length, 3);
  assert.equal(leg.chain, nthCall(calls, 2).chain);
});

test('the Asset Hub chain is linked to the relay Chain OBJECT the topology already holds', async () => {
  // Same rule as the parachain's, and the reason `attachAssetHub` is a method: there is no
  // other client and no other relay in scope, so "same smoldot instance" is not a rule
  // anyone has to remember. Passing `[]` would let smoldot resolve the relay by `id` against
  // every chain in the client.
  const specs = await pair();
  const { client, calls } = fakeClient();
  const topology = await start(client, specs);
  await topology.attachAssetHub(await assetHubBundle());
  assert.deepEqual(nthCall(calls, 2).options.potentialRelayChains, [nthCall(calls, 0).chain]);
  assert.equal(nthCall(calls, 0).chain, topology.relay);
});

test('a wrong Asset Hub genesis removes THAT chain and leaves the app running', async () => {
  // The whole asymmetry in one test. A wrong parachain genesis is terminal for the client;
  // a wrong Asset Hub genesis blocks deposits and nothing else. If this ever tears down the
  // topology, every screen goes dark for a leg most sessions never use.
  const specs = await pair();
  const { client, calls, removed } = fakeClient();
  const topology = await start(client, specs);
  const leg = await topology.attachAssetHub(
    await assetHubBundle({ pin: { genesisHash: `0x${'ff'.repeat(32)}` } }),
  );

  assert.equal(leg.kind, 'wrong-chain');
  assert.deepEqual(removed, [nthCall(calls, 2).chain], 'the wrong Asset Hub chain was left syncing');
  assert.equal(removed.includes(topology.relay), false, 'the relay was torn down by an Asset Hub failure');
  assert.equal(removed.includes(topology.para), false, 'the parachain was torn down by an Asset Hub failure');
});

test('a wrong Asset Hub genesis is reported as wrong-chain, carrying the hash that answered', async () => {
  // The reason this arm exists at all. `classifyForeign` separates "could not be reached —
  // retry" from "a different chain — retrying will not change this", and it draws that
  // distinction from whether the observation carries a genesis hash. A leg that removed the
  // chain and reported `unavailable` would be truthful about the outcome and wrong about the
  // remedy: the user would retry a sync that can never succeed.
  const specs = await pair();
  const { client } = fakeClient();
  const topology = await start(client, specs);
  const impostor: HexString = `0x${'ff'.repeat(32)}`;
  const leg = await topology.attachAssetHub(await assetHubBundle({ pin: { genesisHash: impostor } }));

  assert.ok(leg.kind === 'wrong-chain', `expected wrong-chain, got ${leg.kind}`);
  assert.equal(leg.genesisHash, ASSET_HUB_GENESIS, 'the hash reported is not the one that answered');
  assert.match(leg.reason, /different chain/);
  assert.doesNotMatch(leg.reason, /retry(?!ing will not)/i);

  // And the consequence, through the module that actually decides it. Both directions are
  // asserted, because "wrong-chain" from one call proves nothing unless a hash-less
  // observation demonstrably yields something else.
  const observe = (genesisHash: string | undefined) =>
    classifyForeign({ chainLabel: 'Asset Hub', genesisHash, specVersion: undefined, probes: [] }).mode;
  assert.equal(observe(leg.genesisHash), 'wrong-chain');
  assert.equal(observe(undefined), 'unreachable');
});

test('every Asset Hub failure is a returned value, never a throw', async () => {
  // A throw would have to be caught by every call site and turned back into exactly this
  // union, and the one call site that let it propagate would take a screen down for a leg
  // that only blocks deposits.
  const specs = await pair();
  const intact = await assetHubBundle();
  const cases: readonly (readonly [string, BundledChain])[] = [
    ['a relay spec in the Asset Hub slot', (await pair()).relay],
    // The pin is the field `bundled()` computes, so this one is built by hand: it is the
    // *substituted bytes* case, and it has to break the hash rather than the spec.
    ['bytes that do not match the pin', { ...intact, pinned: { ...intact.pinned, sha256: `0x${'00'.repeat(32)}` } }],
    ['a spec naming a relay we did not bundle', await assetHubBundle({
      spec: { relayChain: 'westend' },
      pin: { relayChainId: 'westend' },
    })],
    ['nothing to dial', await assetHubBundle({ spec: { bootNodes: [] } })],
    ['a non-raw spec', await assetHubBundle({ spec: { genesis: { runtimeGenesis: { code: '0x00' } } } })],
    ['the parachain\'s own genesis', await assetHubBundle({ pin: { genesisHash: PARA_GENESIS } })],
    ['a wrong genesis', await assetHubBundle({ pin: { genesisHash: `0x${'ff'.repeat(32)}` } })],
  ];

  for (const [label, bundle] of cases) {
    const { client } = fakeClient();
    const topology = await start(client, specs);
    const leg = await topology.attachAssetHub(bundle);
    assert.ok(leg.kind !== 'attached', `${label}: the Asset Hub leg attached and should not have`);
    assert.ok(refused(leg).reason.length > 0, `${label}: the refusal carried no reason`);
  }
});

test('an Asset Hub bundle pinning one of OUR genesis hashes is refused', async () => {
  // A build that put the Bleavit bundle in the Asset Hub slot would pass every other check:
  // the bytes match their own pin, the relay linkage is right, and the probed genesis equals
  // the pinned one. The deposit screen would then read USDC balances off the futarchy chain
  // and label them Asset Hub — wrong in the dangerous direction, and invisible, because both
  // chains answer every read they are asked consistently.
  const specs = await pair();
  for (const genesisHash of [PARA_GENESIS, RELAY_GENESIS]) {
    const { client, calls } = fakeClient();
    const topology = await start(client, specs);
    const leg = await topology.attachAssetHub(await assetHubBundle({ pin: { genesisHash } }));
    assert.match(refused(leg).reason, /not a second chain/);
    assert.equal(calls.length, 2, 'the duplicate chain was added before being refused');
  }
});

test('an Asset Hub spec naming a different relay never gets added', async () => {
  // smoldot would form no linkage and the chain would sit un-finalized, which on screen is
  // indistinguishable from slow sync — so the user would wait rather than see a diagnosis.
  const specs = await pair();
  const { client, calls } = fakeClient();
  const topology = await start(client, specs);
  const leg = await topology.attachAssetHub(
    await assetHubBundle({ spec: { relayChain: 'westend' }, pin: { relayChainId: 'westend' } }),
  );
  assert.match(refused(leg).reason, /slow sync/);
  assert.equal(calls.length, 2);
});

test('detach removes the Asset Hub chain alone', async () => {
  const specs = await pair();
  const { client, calls, removed } = fakeClient();
  const topology = await start(client, specs);
  const leg = attached(await topology.attachAssetHub(await assetHubBundle()));

  leg.detach();
  assert.deepEqual(removed, [nthCall(calls, 2).chain]);
  // Idempotent by membership, not by swallowed exception. `remove()` throws on an already
  // removed chain and the topology discards that — which makes a double removal *look*
  // harmless while being exactly how a real one would hide.
  leg.detach();
  assert.deepEqual(removed, [nthCall(calls, 2).chain]);
});

test('a STALE leg detaching does not disown the chain that replaced it', async () => {
  // The sequence is ordinary: a screen attaches, unmounts, remounts — and then the first
  // screen's cleanup runs late. Clearing the cache on that call would leave the second
  // chain live but unreferenced, and send the next entry into the flow to add a third.
  // Both would sync; neither would be reachable.
  const specs = await pair();
  const { client, calls, removed } = fakeClient();
  const topology = await start(client, specs);

  const first = attached(await topology.attachAssetHub(await assetHubBundle()));
  first.detach();
  const second = attached(await topology.attachAssetHub(await assetHubBundle()));

  first.detach(); // the late cleanup
  assert.equal(removed.includes(second.chain), false, 'a stale detach removed the live chain');

  const third = attached(await topology.attachAssetHub(await assetHubBundle()));
  assert.equal(third.chain, second.chain, 'a stale detach cleared the cache and added a third chain');
  assert.equal(calls.length, 4, 'one chain per attach, and the stale detach added none');
});

test('stop() removes an attached Asset Hub chain too', async () => {
  // The leak this closes: `getSmProvider`'s factory builds a *fresh topology* on every
  // reconnect, so a lazily-attached chain that `stop()` did not own would outlive the
  // topology that added it — and go on syncing, unreferenced, for the rest of the session.
  const specs = await pair();
  const { client, removed } = fakeClient();
  const topology = await start(client, specs);
  const leg = attached(await topology.attachAssetHub(await assetHubBundle()));

  topology.stop();
  assert.equal(removed.length, 3);
  assert.ok(removed.includes(leg.chain), 'stop() left the Asset Hub chain running');
});

test('a successful attach is cached; a failed one stays retryable', async () => {
  // Two rules with two different reasons. Re-entering the funding flow must not add a chain
  // each time — and E17's recovery action is literally "retry AH sync", which a cached
  // failure would turn into a button that does nothing for the rest of the session.
  const specs = await pair();
  const { client, calls } = fakeClient();
  const topology = await start(client, specs);

  const first = attached(await topology.attachAssetHub(await assetHubBundle()));
  const second = attached(await topology.attachAssetHub(await assetHubBundle()));
  assert.equal(calls.length, 3, 'a second entry into the funding flow added a second chain');
  assert.equal(first.chain, second.chain);

  // After a detach the next attach is a fresh chain, not the cached one.
  first.detach();
  const third = attached(await topology.attachAssetHub(await assetHubBundle()));
  assert.equal(calls.length, 4);
  assert.notEqual(third.chain, first.chain);
});

test('a retry after a transient failure succeeds', async () => {
  // The failure that is genuinely worth retrying: the chain was added but the identity probe
  // did not answer. Nothing about the release is wrong, so a second attempt must be allowed
  // to attach — and it must attach the chain, not return the remembered failure.
  const specs = await pair();
  const { client, removed } = fakeClient();
  let failNext = true;
  const topology = await startTopology(client, {
    ...specs,
    genesisHashOf: async (chain) => {
      const id = String((JSON.parse(chain.options.chainSpec) as { id?: unknown }).id);
      if (id === 'asset-hub' && failNext) {
        failNext = false;
        throw new Error('no response');
      }
      const genesis = GENESIS_BY_ID[id];
      if (genesis === undefined) throw new Error(`no genesis fixture for chain id ${JSON.stringify(id)}`);
      return genesis;
    },
  });

  const failed = await topology.attachAssetHub(await assetHubBundle());
  assert.equal(failed.kind, 'unavailable');
  assert.equal(removed.length, 1, 'the half-attached Asset Hub chain was left running');

  const retried = attached(await topology.attachAssetHub(await assetHubBundle()));
  assert.equal(retried.genesisHash, ASSET_HUB_GENESIS);
});

test('every Asset Hub refusal says deposits alone are affected', async () => {
  // The copy carries the scope, because the leg is reported on a screen that has no idea
  // what else the client can still do. A reason that said only "Asset Hub is unavailable"
  // reads, to a user, as an outage.
  const specs = await pair();
  const { client } = fakeClient();
  const topology = await start(client, specs);
  const leg = await topology.attachAssetHub(await assetHubBundle({ spec: { bootNodes: [] } }));
  assert.match(refused(leg).reason, /Deposits are unavailable/);
  assert.match(refused(leg).reason, /nothing else in the app is affected/);
});

/* ------------------------------- the second handle 10 §5.2's foreign probe needs (F26) */

test('reuse:false yields a SECOND handle beside the cached one, without displacing it', async () => {
  // Why this exists at all: `getSmProvider` keeps a `WeakSet` of the chains it has been
  // handed and its `disconnect` calls `chain.remove()`, so one smoldot `Chain` serves one
  // JSON-RPC connection, ever. The deposit leg needs two — the reader that fetches balances
  // and the transient PAPI client that probes the 02 §7.7 surfaces — and the cache is what
  // stopped a second existing. It is not a second light client: smoldot de-duplicates
  // identical chain specs internally, which is the same property the local provider factory
  // already relies on when it rebuilds a whole topology per connection.
  const specs = await pair();
  const { client, calls } = fakeClient();
  const topology = await start(client, specs);

  const reader = attached(await topology.attachAssetHub(await assetHubBundle()));
  const probe = attached(await topology.attachAssetHub(await assetHubBundle(), { reuse: false }));
  assert.notEqual(probe.chain, reader.chain, 'the probe was handed the reader’s own chain');
  assert.equal(calls.length, 4);

  // Still the same identity and the same verified spec — an uncached attach must not be a
  // way around `verifyBundledChainSpec` or the genesis check.
  assert.equal(probe.genesisHash, reader.genesisHash);
  assert.equal(probe.spec.id, reader.spec.id);
});

test('an uncached leg is not remembered, so releasing it never disturbs the reader', async () => {
  const specs = await pair();
  const { client, calls, removed } = fakeClient();
  const topology = await start(client, specs);

  const reader = attached(await topology.attachAssetHub(await assetHubBundle()));
  const probe = attached(await topology.attachAssetHub(await assetHubBundle(), { reuse: false }));
  probe.detach();

  assert.ok(removed.includes(probe.chain), 'the probe handle was left syncing with nothing reading it');
  assert.equal(removed.includes(reader.chain), false, 'releasing the probe took down the deposit reader');

  // The cache still points at the reader: a caller re-entering the flow gets the connection
  // it already has, not a third chain.
  const again = attached(await topology.attachAssetHub(await assetHubBundle()));
  assert.equal(again.chain, reader.chain);
  assert.equal(calls.length, 4, 'the probe’s release cleared the cache and added another chain');
});

test('an uncached leg is still owned by stop(), even if the caller never releases it', async () => {
  const specs = await pair();
  const { client, removed } = fakeClient();
  const topology = await start(client, specs);

  const probe = attached(await topology.attachAssetHub(await assetHubBundle(), { reuse: false }));
  topology.stop();
  assert.ok(removed.includes(probe.chain), 'an unreleased probe handle outlived its topology');
});

test('reuse:false does not become the default by omission', async () => {
  // The direction that would be silent: every entry into the funding flow adding a chain.
  const specs = await pair();
  const { client, calls } = fakeClient();
  const topology = await start(client, specs);

  await topology.attachAssetHub(await assetHubBundle());
  await topology.attachAssetHub(await assetHubBundle(), {});
  await topology.attachAssetHub(await assetHubBundle(), { reuse: true });
  assert.equal(calls.length, 3, 'an omitted or empty option added a chain');
});
