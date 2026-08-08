/**
 * The Node host for the light client — F27. The one module that names `node:worker_threads`.
 *
 * `light-client.ts` is the browser host and says why the two cannot be one: the browser
 * worker pair fails **silently** under Node rather than loudly, so the choice is a seam
 * rather than a runtime check. Everything below that seam — the topology, the §3.1 identity
 * check, the Asset Hub leg, the teardown — is shared, and this file adds no second copy of
 * any of it. It supplies a factory and nothing else.
 *
 * ## Why this exists at all
 *
 * 15 §4.8's Zombienet row requires the client's data layer exercised *"against the published
 * topology"*, and `light-client.ts`'s own header names the gap it leaves:
 *
 * > Everything below the structural seam … is *not* verified by any test in this repository.
 * > It is type-checked and it is small enough to read in one sitting, which is the most that
 * > can be claimed for it until the B7 drills exercise it against a live topology.
 *
 * A drill cannot exercise it from a browser, and the drill helpers run under the pinned
 * Zombienet binary's own Node with no bundler and no `Worker` global. So the seam is what
 * makes that sentence retirable.
 *
 * ## It is a harness entry point, and it stays out of the shipped client
 *
 * Nothing under `app/src/` may import this. The canonical client boots in a browser or in the
 * F22 desktop shell, both of which have a real `Worker`, and a Node path reachable from the
 * app would be a second way to construct a chain connection — which is the thing app-code
 * rule 13 exists to prevent. It lives **inside** `packages/chain-client` for exactly that
 * reason: the rule names this package, so the smoldot import stays where the rule can see it.
 * A harness under `app/tools/` would have been outside dependency-cruiser's scanned set and
 * the rule would never have fired.
 *
 * ## The spawn form is concrete here, deliberately
 *
 * `light-client.ts` declines to hardcode `new Worker(new URL('polkadot-api/smoldot/worker',
 * import.meta.url))` because that spelling is a bundler contract and a package that fixed it
 * would decide the app's build tool. Under Node there is no bundler: `worker_threads.Worker`
 * takes a real path, `new URL(spec, import.meta.url)` does **not** resolve a bare specifier,
 * and `import.meta.resolve` is the mechanism that does. So the form is decided by the runtime
 * rather than chosen, and writing it here costs nothing that ruling was protecting.
 */

import { Worker } from 'node:worker_threads';
import { startFromWorker } from 'polkadot-api/smoldot/from-node-worker';

import { startLightClientWith, type LightClient } from './light-client.js';
import type { BundledChain } from './topology.js';

export interface NodeLightClientOptions {
  readonly relay: BundledChain;
  readonly para: BundledChain;
  /**
   * 10 §4.3's expert setting, and the reason a locally generated spec can be booted at all.
   *
   * `chain-spec-builder` never writes a `bootNodes` entry and the pinned Paseo generator does
   * not either, so every locally generated spec carries an empty list — and `startTopology`
   * refuses to dial nothing. The addresses are unioned onto the spec **after**
   * `verifyBundledChainSpec` has hashed the bytes on disk, so supplying them does not disturb
   * the pin.
   *
   * Read them from a spawned node with `system_localListenAddresses`, which returns full
   * multiaddrs carrying the peer id. A fixed p2p port would not: smoldot needs the peer id to
   * dial, and the port alone cannot supply it.
   */
  readonly extraBootnodes?: readonly string[];
}

/**
 * The Node worker, spawned the way Node resolves modules.
 *
 * A factory rather than a constructed worker, matching `WorkerSource` in the application's
 * `chain-session.ts`: a caller that turns out to have nothing to boot against never starts a
 * WASM light client nothing will read.
 */
export function nodeSmoldotWorker(): Worker {
  return new Worker(new URL(import.meta.resolve('polkadot-api/smoldot/node-worker')));
}

/**
 * Start the light client on this Node process.
 *
 * The returned `LightClient` is the same value `startLightClient` returns, so a harness drives
 * the identical transport, the identical Asset Hub leg and the identical compat providers the
 * browser does. That is the whole point: a drill that exercised a Node-only variant would
 * attest a code path the client does not run.
 *
 * **`stop()` terminates the worker FIRST, and that order is a fix rather than a preference**
 * (2026-08-08, found by the first real run). Tearing down in the obvious order — remove the
 * chains, terminate the client, then the thread — races: a JSON-RPC response already in flight
 * for a removed chain reaches `@polkadot-api/smoldot`'s node-worker bridge, which throws
 * `Error: Can't reference removed chain`. In a browser that throw lands inside the worker and
 * the page survives. Under Node it is dispatched on the **parent's** `MessagePort` and rethrown
 * from `process.nextTick`, which no `try`/`catch` can reach and which **kills the process** —
 * observed killing a run whose light client had already synced both chains and read the runtime.
 *
 * Terminating the thread first removes the sender, so there is no message left to mishandle.
 * `client.terminate()` is then attempted and its failure ignored, because the thread it would
 * talk to is already gone: the resource it exists to release has been released more forcefully.
 */
/**
 * The one worker error this host absorbs, and why absorbing it is not papering over a defect.
 *
 * Removing a smoldot chain races any JSON-RPC response already in flight for it: the response
 * reaches `@polkadot-api/smoldot`'s bridge, finds no chain, and throws. **In a browser that
 * throw stays inside the worker.** Under Node it becomes an uncaught exception in the worker
 * thread, which Node re-raises in the parent and which terminates the process — so the
 * *identical* race is survivable on one host and fatal on the other.
 *
 * It is not a rare shutdown path. `compatProvider().release()` removes a transient two-chain
 * topology on **every** compat probe, and 10 §3.2 re-runs the classifier on every
 * `CodeUpdated`. The first real drill run died here, after its light client had already synced
 * both chains and read the runtime — the work was done and the process died reporting nothing.
 *
 * Matched on the bridge's own message, deliberately narrowly: every other worker error is
 * re-raised unchanged, because a host that swallowed them would turn a dead light client into
 * a silent one. If a future `@polkadot-api/smoldot` reworded this, the match stops firing and
 * the process starts dying again — loudly, which is the safe direction for a guard to fail in.
 */
const REMOVED_CHAIN_RACE = /Can't reference removed chain/;

export async function startNodeLightClient(
  options: NodeLightClientOptions,
): Promise<LightClient> {
  const worker = nodeSmoldotWorker();
  worker.on('error', (error: Error) => {
    if (REMOVED_CHAIN_RACE.test(error.message)) return;
    throw error;
  });
  let client: LightClient;
  try {
    client = await startLightClientWith({
      relay: options.relay,
      para: options.para,
      ...(options.extraBootnodes === undefined ? {} : { extraBootnodes: options.extraBootnodes }),
      startClient: () => startFromWorker(worker),
    });
  } catch (error) {
    // Terminated first, so a re-thrown terminal error cannot leave the thread behind — the
    // same ordering `startChainSession` keeps one layer up, and for the same reason.
    await worker.terminate();
    throw error;
  }

  return {
    ...client,
    async stop() {
      // The thread goes first — see this function's header for the race it closes.
      await worker.terminate();
      try {
        await client.stop();
      } catch {
        // Expected: every path in `client.stop()` speaks to a worker that no longer exists.
        // The chains, the transport and the topologies died with the thread that hosted them.
      }
    },
  };
}
