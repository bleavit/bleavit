/**
 * The composition root — 10 §4.1's `createClient(getSmProvider(...))`, minus the client.
 *
 * **This is the only module in the package that names PAPI or smoldot.** Everything else
 * is written against the structural interfaces in `topology.ts` and `transport.ts`, which
 * is what lets the wiring rules, the operation protocol and every refusal be executed per
 * commit without a WASM light client or a network. The cost of that arrangement is the
 * risk that a structural interface drifts from the real API and the tests keep passing
 * against a fiction — so this module does not merely *use* the real types, it **binds**
 * them: `asTopologyClient` and `asTransportProvider` below are assignability assertions
 * that the compiler checks on every build. If smoldot 3.x or PAPI 2.x changes shape, this
 * file stops compiling.
 *
 * What is deliberately **not** here: `createClient`. PAPI's typed client is the consumer
 * of descriptors, and descriptors are F4. Introducing it now would place metadata
 * compatibility underneath the read layer, where 10 §5.2's `full`/`restricted`/
 * `read-only-incompatible` classifier cannot see it — the app would fail to construct a
 * client instead of booting into `ReadOnlyIncompatible` and telling the user why.
 *
 * **Honest limit.** Everything below the structural seam — that smoldot actually syncs,
 * that browser-WSS peers are reachable (FE-P4), that the follow subscription behaves as
 * specified against a real node — is *not* verified by any test in this repository. It is
 * type-checked and it is small enough to read in one sitting, which is the most that can
 * be claimed for it until the B7 drills exercise it against a live topology.
 */

import { getSmProvider } from 'polkadot-api/sm-provider';
import { startFromWorker } from 'polkadot-api/smoldot/from-worker';

import type { HexString } from '@bleavit/shared-types';
import { ChainHeadConnection, type JsonRpcProviderLike } from './transport.js';
import {
  startTopology,
  type BundledChain,
  type SmoldotClientLike,
  type Topology,
} from './topology.js';

/** The real smoldot types, taken from the pinned API rather than re-declared. */
type RealSmoldotClient = ReturnType<typeof startFromWorker>;
type RealSmoldotChain = Awaited<ReturnType<RealSmoldotClient['addChain']>>;

/**
 * The two bindings that keep the structural interfaces honest. Written as functions
 * because an unused type alias is erased and proves nothing; these are called on the one
 * path that constructs a live client, so the assertion cannot be deleted without deleting
 * the wiring it guards.
 */
function asTopologyClient(client: RealSmoldotClient): SmoldotClientLike<RealSmoldotChain> {
  return client;
}

function asTransportProvider(provider: ReturnType<typeof getSmProvider>): JsonRpcProviderLike {
  return provider;
}

export interface LightClientOptions {
  /**
   * A worker already running smoldot's `run` entry point. Constructed by the shell, not
   * here: the `new Worker(new URL('polkadot-api/smoldot/worker', import.meta.url))` form
   * is a bundler contract, and a package that hardcoded it would decide the app's build
   * tool from four layers down.
   */
  readonly worker: Worker;
  readonly relay: BundledChain;
  readonly para: BundledChain;
  /** 10 §4.3 expert setting; local-only, never remote-configured. */
  readonly extraBootnodes?: readonly string[];
}

export interface LightClient {
  readonly transport: ChainHeadConnection;
  readonly topology: Topology<RealSmoldotChain>;
  stop(): Promise<void>;
}

/**
 * Ask a raw smoldot chain for its genesis hash.
 *
 * Safe to drive `nextJsonRpcResponse()` directly here, and **only** here: this runs inside
 * the `getSmProvider` factory, before the provider has attached its own reader to the
 * chain. Two consumers of that method race for each response, so a probe issued after
 * PAPI is attached would steal messages from it.
 */
async function probeGenesisHash(chain: RealSmoldotChain): Promise<HexString> {
  const id = 'bleavit-genesis-probe';
  chain.sendJsonRpc(JSON.stringify({ jsonrpc: '2.0', id, method: 'chainSpec_v1_genesisHash', params: [] }));
  for (;;) {
    const raw = await chain.nextJsonRpcResponse();
    const message = JSON.parse(raw) as { id?: string; result?: unknown; error?: { message?: string } };
    if (message.id !== id) continue;
    if (message.error !== undefined) {
      throw new Error(`chainSpec_v1_genesisHash failed: ${message.error.message ?? 'unknown error'}`);
    }
    if (typeof message.result !== 'string') {
      throw new Error(`chainSpec_v1_genesisHash returned ${JSON.stringify(message.result)}`);
    }
    return message.result as HexString;
  }
}

/**
 * Start the light client: worker → smoldot → two chains → provider → chainHead transport.
 *
 * The `getChain` factory builds a **fresh topology on every call**, which looks wasteful
 * and is not. PAPI's `getSmProvider` keeps a `WeakSet` of chains it has seen and refuses a
 * repeat with a console warning rather than an error — so a factory that closed over one
 * `Chain` and returned it again after a reconnect would leave the app connected to
 * nothing, reporting no failure. smoldot de-duplicates identical chains internally, so
 * re-adding costs a lookup; its own documentation asks callers to trust that rather than
 * de-duplicating themselves.
 */
export async function startLightClient(options: LightClientOptions): Promise<LightClient> {
  const client = startFromWorker(options.worker);
  const topologies: Topology<RealSmoldotChain>[] = [];
  let latest: Topology<RealSmoldotChain> | undefined;

  const provider = getSmProvider(async () => {
    const topology = await startTopology(asTopologyClient(client), {
      relay: options.relay,
      para: options.para,
      genesisHashOf: probeGenesisHash,
      ...(options.extraBootnodes === undefined ? {} : { extraBootnodes: options.extraBootnodes }),
    });
    topologies.push(topology);
    latest = topology;
    // The transport follows the **parachain**. The relay client exists so parachain
    // finality is derivable from relay-finalized para-inclusion (§4.1); nothing reads
    // Bleavit state from it.
    return topology.para;
  });

  let transport: ChainHeadConnection;
  try {
    transport = await ChainHeadConnection.open(asTransportProvider(provider));
  } catch (error) {
    for (const topology of topologies) topology.stop();
    await client.terminate();
    throw error;
  }

  if (latest === undefined) throw new Error('the provider connected without building a topology');

  return {
    transport,
    topology: latest,
    async stop() {
      transport.close();
      for (const topology of topologies) topology.stop();
      await client.terminate();
    },
  };
}
