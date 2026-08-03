/**
 * The smoldot topology — 10 §4.1, §4.3, §3.1.
 *
 * One smoldot instance hosting **two** chains: the relay light client and the futarchy
 * parachain client, linked through `potentialRelayChains`. Parachain finality derives
 * from relay-finalized para-inclusion, so the relay client is not an accessory to the
 * parachain client — it is what makes a parachain read verifiable at all. 10 §3.1 states
 * the consequence in one line: *"the parachain client cannot run without the relay
 * client, so 'single-chain mode' does not exist"*. This module has no code path that
 * returns a topology without both, which is that sentence expressed as a type.
 *
 * Written against **structural** smoldot types rather than importing smoldot, for the
 * same reason `reads.ts` injects its transport: the wiring rules below (order, linkage,
 * dial set, identity, teardown-on-failure) are the part that can be got wrong, and they
 * are worth testing without a WASM light client and a network. `light-client.ts` is the
 * one module that names the real API, and it type-checks these interfaces against it — so
 * a structural type that drifted from smoldot 3.x breaks the build rather than rotting.
 */

import type { HexString } from '@bleavit/shared-types';
import {
  assertGenesisIdentity,
  verifyBundledChainSpec,
  type ParsedChainSpec,
  type PinnedChainSpec,
} from './chain-spec.js';

/** The subset of smoldot's `Chain` this layer uses. */
export interface SmoldotChainLike {
  sendJsonRpc(rpc: string): void;
  nextJsonRpcResponse(): Promise<string>;
  remove(): void;
}

/** The subset of smoldot's `AddChainOptions` this layer sets. */
export interface AddChainOptionsLike<C extends SmoldotChainLike = SmoldotChainLike> {
  chainSpec: string;
  potentialRelayChains?: C[];
  databaseContent?: string;
  disableJsonRpc?: boolean;
}

/**
 * The subset of smoldot's `Client` this layer uses.
 *
 * Generic in the chain type so a caller holding real smoldot `Chain` objects gets real
 * `Chain` objects back. Without that, composing this module with PAPI would need a cast
 * at exactly the seam the structural typing exists to keep honest — and a cast there is
 * indistinguishable from having never checked.
 */
export interface SmoldotClientLike<C extends SmoldotChainLike = SmoldotChainLike> {
  addChain(options: AddChainOptionsLike<C>): Promise<C>;
  terminate(): Promise<void>;
}

export class TopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopologyError';
  }
}

/** One bundled spec: the pin, and the exact bytes the release shipped. */
export interface BundledChain {
  readonly pinned: PinnedChainSpec;
  readonly chainSpec: string;
}

export interface TopologyOptions<C extends SmoldotChainLike = SmoldotChainLike> {
  readonly relay: BundledChain;
  readonly para: BundledChain;
  /**
   * Reads a chain's genesis hash (`chainSpec_v1_genesisHash`). Injected so the identity
   * check is exercised by tests without a synced light client — the check is the part
   * that must not be skippable, not the RPC call that feeds it.
   */
  readonly genesisHashOf: (chain: C) => Promise<HexString>;
  /**
   * 10 §4.3 expert setting: user-supplied bootnodes. **Local-only, never
   * remote-configured** — nothing in this package fetches them, and they are applied
   * strictly *after* the bundled bytes have been checked against the release pin, so an
   * override cannot be a route around the pin.
   */
  readonly extraBootnodes?: readonly string[];
}

export interface Topology<C extends SmoldotChainLike = SmoldotChainLike> {
  readonly relay: C;
  readonly para: C;
  readonly relaySpec: ParsedChainSpec;
  readonly paraSpec: ParsedChainSpec;
  /** Remove both chains. Idempotent. */
  stop(): void;
}

/** Add the user's bootnodes to an already-verified spec, never replacing the bundled set. */
function withExtraBootnodes(text: string, extra: readonly string[]): string {
  if (extra.length === 0) return text;
  const spec = JSON.parse(text) as Record<string, unknown>;
  const existing = Array.isArray(spec['bootNodes'])
    ? spec['bootNodes'].filter((n): n is string => typeof n === 'string')
    : [];
  // Union, bundled first: an expert adding a local node must not be able to *remove* the
  // release's dial set, or a single hostile "helpful config" line becomes an eclipse.
  spec['bootNodes'] = [...existing, ...extra.filter((n) => !existing.includes(n))];
  return JSON.stringify(spec);
}

/**
 * Start the two-chain topology.
 *
 * Order is load-bearing throughout:
 *
 *  1. **Both** specs are verified before **either** chain is added. Adding the relay and
 *     then discovering the parachain spec is unpinned would already have connected the
 *     client to a network chosen by whoever supplied the bad bundle.
 *  2. The relay is added first, and the parachain is added with `potentialRelayChains`
 *     set to exactly that `Chain` object. smoldot identifies relay candidates by object
 *     identity through a `WeakMap`; passing `[]` (the default) means the parachain
 *     resolves its relay by `id` against every chain in the client, which is the ambiguity
 *     smoldot's own documentation warns can be exploited by a near-miss `id`.
 *  3. The genesis identity check runs on **both** chains, and a failure removes them.
 *     Leaving the chains live behind a terminal `WrongChain` screen would keep the client
 *     dialling and syncing a chain we have just decided we cannot trust.
 */
export async function startTopology<C extends SmoldotChainLike>(
  client: SmoldotClientLike<C>,
  options: TopologyOptions<C>,
): Promise<Topology<C>> {
  const { relay, para } = options;
  if (relay.pinned.kind !== 'relay') {
    throw new TopologyError(`the relay slot was given a ${relay.pinned.kind} spec (${relay.pinned.id})`);
  }
  if (para.pinned.kind !== 'para') {
    throw new TopologyError(`the parachain slot was given a ${para.pinned.kind} spec (${para.pinned.id})`);
  }

  const relaySpec = await verifyBundledChainSpec(relay.chainSpec, relay.pinned);
  const paraSpec = await verifyBundledChainSpec(para.chainSpec, para.pinned);

  if (paraSpec.relayChain !== relaySpec.id) {
    throw new TopologyError(
      `the parachain spec names relay ${JSON.stringify(paraSpec.relayChain)} but the bundled relay is ` +
        `${JSON.stringify(relaySpec.id)}; smoldot would never form the linkage and the parachain would ` +
        'sit un-finalized, which on screen is indistinguishable from slow sync',
    );
  }

  const extra = options.extraBootnodes ?? [];
  // §4.3 makes the ≥ 8 browser-WSS dial set a *chain-side* requirement, enforced where the
  // spec is built (`tools/deploy/validate-chain-spec.py`), so this does not re-count it.
  // Zero is different in kind: a client with nothing to dial cannot make progress and
  // renders as `SyncDegraded` forever, blaming the network for a packaging defect.
  for (const [role, spec] of [
    ['relay', relaySpec],
    ['parachain', paraSpec],
  ] as const) {
    if (spec.bootNodes.length === 0 && extra.length === 0) {
      throw new TopologyError(
        `the bundled ${role} spec (${spec.id}) carries no bootnodes and none were supplied; ` +
          'the light client would have nothing to dial',
      );
    }
  }

  const added: C[] = [];
  const stop = (): void => {
    while (added.length > 0) {
      try {
        added.pop()?.remove();
      } catch {
        // `remove()` throws only if the chain or client is already gone, which is the
        // state we are trying to reach.
      }
    }
  };

  try {
    const relayChain = await client.addChain({ chainSpec: withExtraBootnodes(relay.chainSpec, extra) });
    added.push(relayChain);

    const paraChain = await client.addChain({
      chainSpec: withExtraBootnodes(para.chainSpec, extra),
      potentialRelayChains: [relayChain],
    });
    added.push(paraChain);

    assertGenesisIdentity(await options.genesisHashOf(relayChain), relay.pinned);
    assertGenesisIdentity(await options.genesisHashOf(paraChain), para.pinned);

    return { relay: relayChain, para: paraChain, relaySpec, paraSpec, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
