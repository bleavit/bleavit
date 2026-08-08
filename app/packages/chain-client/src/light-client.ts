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
 * **That ruling still holds, and F26 kept it by moving the *provider* rather than the
 * client.** `createClient` lives in `compat.ts`, behind its own subpath export, and nothing
 * on the read path imports it. What this module now hands out is the two things only it can
 * supply — a provider for this chain, and a *second* Asset Hub chain handle — so the compat
 * client is built **above** the transport, after it is already serving reads. The ordering
 * the ruling protects is structural rather than remembered: `startLightClient` returns a
 * working `LightClient` whether or not anybody ever asks for a compat surface, and an
 * undecodable runtime fails in a function whose result is a value.
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
import { WrongChainError } from './chain-spec.js';
import { ChainHeadConnection, type JsonRpcProviderLike } from './transport.js';
import type { CompatProvider } from './compat.js';
import {
  assetHubConnector,
  type AssetHubConnection as AssetHubLegConnection,
} from './asset-hub.js';
import {
  startTopology,
  type AssetHubLeg,
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

/** 11 §11.9.1's second light client, at this package's transport type. */
export type AssetHubConnection = AssetHubLegConnection<ChainHeadConnection>;

export interface LightClient {
  readonly transport: ChainHeadConnection;
  readonly topology: Topology<RealSmoldotChain>;
  /**
   * Connect Asset Hub — **lazily**, on entering the funding flow (11 E17).
   *
   * Called by the deposit screen, never by boot. Repeat calls return the same connection:
   * `getSmProvider` keeps a `WeakSet` of chains it has been handed and refuses a repeat with
   * a console warning rather than an error, so a second provider over the same `Chain` would
   * yield a transport connected to nothing while reporting no failure.
   */
  connectAssetHub(assetHub: BundledChain): Promise<AssetHubConnection>;
  /**
   * A provider for **this chain**, for 10 §5.2's compat probe — not for reading.
   *
   * A **fresh handle per call**, each over its own topology, and both halves matter.
   * `getSmProvider` refuses a chain it has already been handed with a console warning rather
   * than an error, so sharing the transport's provider would eventually yield a client
   * connected to nothing and reporting success. And a topology this call created is a
   * topology this call must give back — hence `release()`, not a bare provider.
   */
  compatProvider(): CompatProviderHandle;
  /**
   * A provider for a **second, transient** Asset Hub chain handle — 02 §7.7's compat probe.
   *
   * Separate from `connectAssetHub` because one smoldot `Chain` serves one JSON-RPC
   * connection and closing it removes the chain (see `AttachOptions.reuse`). The deposit leg
   * needs the reader *and* the probe, so it needs two handles; this is the second, and
   * `release()` returns it. `release()` never touches the connection the reader holds.
   *
   * Returns the leg's refusal instead of a provider when the chain does not attach — the
   * same arms `connectAssetHub` reports, so a `wrong-chain` verdict stays `wrong-chain`
   * rather than becoming "the probe failed".
   */
  assetHubCompatProvider(assetHub: BundledChain): Promise<AssetHubCompatProvider>;
  stop(): Promise<void>;
}

/**
 * A transient handle for a compat probe: a provider, and the way to give it back.
 *
 * `release()` is not optional politeness. The factory behind this provider adds **two** chains
 * — relay and parachain, because 10 §3.1 says a parachain client cannot run without a relay
 * client — while `getSmProvider`'s `disconnect` removes only the one chain it was handed. So a
 * probe that merely destroyed its PAPI client would leave a relay light client syncing with
 * nothing reading it, once per probe, and 10 §3.2 re-runs the classifier on **every**
 * `CodeUpdated`.
 */
export interface CompatProviderHandle {
  readonly provider: CompatProvider;
  /** Stop the topology this provider created. Idempotent. */
  release(): void;
}

/** A transient Asset Hub handle for the compat probe, or the leg's own reason for refusing. */
export type AssetHubCompatProvider =
  | {
      readonly kind: 'attached';
      readonly provider: CompatProvider;
      readonly genesisHash: HexString;
      /** Remove this handle. Never affects the reader's handle. */
      release(): void;
    }
  | Exclude<AssetHubLeg<RealSmoldotChain>, { kind: 'attached' }>;

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
  return startLightClientWith({
    relay: options.relay,
    para: options.para,
    ...(options.extraBootnodes === undefined ? {} : { extraBootnodes: options.extraBootnodes }),
    startClient: () => startFromWorker(options.worker),
  });
}

/**
 * How the smoldot client is obtained — the one line of `startLightClient` that is about the
 * **host** rather than about this chain. F27.
 *
 * `polkadot-api` ships two worker pairs and they are not interchangeable.
 * `smoldot/worker` assigns a bare `onmessage`, which exists in a `DedicatedWorkerGlobalScope`
 * and not in Node, where loading it raises `ReferenceError: onmessage is not defined`; and
 * `startFromWorker` sets `worker.onmessage` on what Node gives it, an `EventEmitter` with no
 * such accessor, so the assignment succeeds as an inert own property and the client **hangs
 * with no error**. That second half is why this is a seam rather than a `typeof` check: the
 * browser path does not fail loudly off-browser, it fails silently.
 *
 * The Node pair (`smoldot/from-node-worker` + `smoldot/node-worker`) is in the same pinned
 * package, and both return smoldot's own `Client` — so everything below this line is shared
 * and neither host gets a second implementation of the topology, the identity check or the
 * teardown. `./node-light-client` supplies the Node factory and is the only module that names
 * `node:worker_threads`, so a browser bundle never sees it.
 */
export type SmoldotClientFactory = () => RealSmoldotClient;

/** {@link LightClientOptions} with the worker replaced by the factory that produces a client. */
export interface HostedLightClientOptions {
  readonly relay: BundledChain;
  readonly para: BundledChain;
  /** 10 §4.3 expert setting; local-only, never remote-configured. */
  readonly extraBootnodes?: readonly string[];
  readonly startClient: SmoldotClientFactory;
}

/** {@link startLightClient}, for a host that has its own way to start smoldot. */
export async function startLightClientWith(
  options: HostedLightClientOptions,
): Promise<LightClient> {
  const client = options.startClient();
  const topologies: Topology<RealSmoldotChain>[] = [];
  let latest: Topology<RealSmoldotChain> | undefined;

  /**
   * The wrong-chain latch — SQ-1026, found by the first run against a real chain (F27).
   *
   * 10 §3.1 makes `FE-BOOT-003` terminal with no override, and every layer was written as
   * though it were: `WrongChainError` exists, `startTopology` throws it, this function
   * re-throws, and `chain-session.ts` carries `if (error instanceof WrongChainError) throw
   * error;`. **None of it ran.** `getSmProvider` treats its chain factory as retryable and
   * calls it again on failure, forever — so the throw never left the factory. Measured
   * against a live topology with one byte of the parachain pin flipped: **265 raises in a
   * single run, none propagated**, `ChainHeadConnection.open` never settled, and
   * `chain-session.ts`'s branch was unreachable code.
   *
   * The retry is right for what PAPI can see — a dial that failed is worth retrying. It is
   * wrong for this one error, and only this one: a chain that is not this chain will still
   * not be this chain on the next attempt, so retrying is not merely useless but harmful.
   * It re-adds two chains per attempt and keeps a client dialling a chain it has already
   * proved it must refuse.
   *
   * So the latch does two things the factory alone cannot. It **fails fast** on every later
   * call, which stops the re-dialling; and it **rejects a promise the opener races**, which
   * is what carries the error across a boundary PAPI will not let a throw cross.
   */
  let terminal: WrongChainError | undefined;
  let latchTerminal: (error: WrongChainError) => void = () => {};
  const wrongChain = new Promise<never>((_resolve, reject) => {
    latchTerminal = reject;
  });

  const newTopology = async (): Promise<Topology<RealSmoldotChain>> => {
    // Fail fast rather than re-dial. See the latch above.
    if (terminal !== undefined) throw terminal;
    try {
      const topology = await startTopology(asTopologyClient(client), {
        relay: options.relay,
        para: options.para,
        genesisHashOf: probeGenesisHash,
        ...(options.extraBootnodes === undefined ? {} : { extraBootnodes: options.extraBootnodes }),
      });
      topologies.push(topology);
      return topology;
    } catch (error) {
      if (error instanceof WrongChainError) {
        terminal = error;
        latchTerminal(error);
      }
      throw error;
    }
  };

  const provider = getSmProvider(async () => {
    const topology = await newTopology();
    latest = topology;
    // The transport follows the **parachain**. The relay client exists so parachain
    // finality is derivable from relay-finalized para-inclusion (§4.1); nothing reads
    // Bleavit state from it.
    return topology.para;
  });

  let transport: ChainHeadConnection;
  try {
    // The pin, not the probe. `startTopology` has already asserted the *probed* genesis
    // equals this pinned value (10 §3.1), so the two agree — and taking the release's
    // pin makes the identity every read carries something the release chose, rather than
    // something the chain reported. If they ever disagree the topology has already
    // thrown, so this cannot be the quieter of two answers.
    // Raced against the latch, because the throw cannot reach here on its own — see
    // `newTopology`. `open()` would otherwise wait on a provider that retries forever.
    transport = await Promise.race([
      ChainHeadConnection.open(asTransportProvider(provider), {
        chain: options.para.pinned.genesisHash,
      }),
      wrongChain,
    ]);
  } catch (error) {
    // **Disconnect the provider, not only the chains.** `ChainHeadConnection.open` never
    // settled on this path, so its own `disconnect()` never runs — and `getSmProvider` sits
    // above a retrying sync provider that keeps calling the chain factory and `console.error`s
    // each refusal. Stopping the topologies removes the chains it would dial but not the loop
    // that keeps asking, so a state 10 §3.1 calls **terminal** was leaving an unbounded busy
    // loop behind it. Found by the F27 R-6 review; `topology.ts` states the principle this
    // half-kept.
    //
    // First, because the loop is what would otherwise re-add what the next two lines remove.
    try {
      provider(() => {}).disconnect();
    } catch {
      // A provider that never connected has nothing to release, which is the state wanted.
    }
    for (const topology of topologies) topology.stop();
    await client.terminate();
    throw error;
  }

  if (latest === undefined) throw new Error('the provider connected without building a topology');

  const topology = latest;
  /**
   * The Asset Hub leg. Every rule about sequencing and repeat calls lives in `asset-hub.ts`,
   * where it is executed by tests; what is supplied here is only the two things that need
   * PAPI — how a chain becomes a transport, and how that transport closes.
   */
  const assetHub = assetHubConnector<RealSmoldotChain, ChainHeadConnection>({
    attach: (bundled) => topology.attachAssetHub(bundled),
    // Safe to build the provider here, and only here, because the genesis probe has already
    // run — inside `attachAssetHub`, before this callback. `probeGenesisHash` drives
    // `nextJsonRpcResponse()` directly and two consumers of that method race for every
    // response, so it may only be used before a provider attaches its own reader.
    openTransport: async (chain, bundled) =>
      ChainHeadConnection.open(asTransportProvider(getSmProvider(async () => chain)), {
        // The pin, not the probe — and here the distinction has teeth the local one does
        // not: this identity is what every Asset Hub `Finalized<T>` carries, so it is what
        // stops an Asset Hub balance combining with a futarchy read (F18).
        chain: bundled.pinned.genesisHash,
      }),
    closeTransport: (connection) => {
      connection.close();
    },
  });

  return {
    transport,
    topology,
    connectAssetHub: (bundled) => assetHub.connect(bundled),
    compatProvider() {
      let created: Topology<RealSmoldotChain> | undefined;
      return {
        // **Not** through `asTransportProvider`. That binding narrows to the read layer's
        // deliberately wider `JsonRpcProviderLike`, which PAPI's `createClient` does not
        // accept — the width flows the wrong way through the callback (see `compat.ts`). The
        // compat client is handed the provider PAPI's own type describes, unmodified.
        provider: getSmProvider(async () => {
          const topology = await newTopology();
          created = topology;
          return topology.para;
        }),
        release() {
          if (created === undefined) return;
          // **Stops the whole topology, not just the para chain.** `getSmProvider`'s
          // `disconnect` removes only the chain it was handed, and this factory adds two —
          // relay and para. Handing out the *transport's* provider instead, as the first
          // version did, leaked a relay `Chain` and a `Topology` entry per probe, and 10 §3.2
          // re-runs the classifier on **every** `CodeUpdated`. A transient client whose
          // transience is only partial is worse than a persistent one, because nothing counts
          // the remainder.
          created.stop();
          const at = topologies.indexOf(created);
          if (at >= 0) topologies.splice(at, 1);
          created = undefined;
        },
      };
    },
    async assetHubCompatProvider(bundled) {
      // `reuse: false` — a second handle beside the reader's, never the reader's own. See
      // `AttachOptions.reuse` for why one handle cannot serve both.
      const leg = await topology.attachAssetHub(bundled, { reuse: false });
      if (leg.kind !== 'attached') return leg;
      return {
        kind: 'attached',
        // Built here and only here, after `attachAssetHub`'s genesis probe has already run
        // on this chain — `probeGenesisHash` drives `nextJsonRpcResponse()` directly, and a
        // provider attached first would race it for every response.
        provider: getSmProvider(async () => leg.chain),
        genesisHash: leg.genesisHash,
        release: () => {
          leg.detach();
        },
      };
    },
    async stop() {
      transport.close();
      assetHub.close();
      for (const each of topologies) each.stop();
      await client.terminate();
    },
  };
}
