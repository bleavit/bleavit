/**
 * Connecting the Asset Hub leg — 11 §11.9.1, E17.
 *
 * `topology.attachAssetHub` adds the chain; this turns an attached chain into a *connection*
 * — and it lives here, generic in the transport, rather than inside `light-client.ts`, for
 * the reason that module states about itself: it is the one file naming PAPI and smoldot,
 * and nothing written inside it is executed by any test. The two rules below are exactly the
 * kind that must be, because both fail silently:
 *
 *  - **A transport that fails to open detaches the chain.** The chain attached and proved its
 *    identity; only the follow subscription failed. Left alone it would go on syncing with
 *    nothing reading it — the same unreferenced-chain leak `stop()` exists to prevent, in the
 *    one path where the obvious code does not reach the teardown.
 *  - **A second connect must not open a second provider over the same chain.** PAPI's
 *    `getSmProvider` keeps a `WeakSet` of the chains it has been handed and refuses a repeat
 *    with a **console warning, not an error** — so the second call yields a transport
 *    connected to nothing that reports success. A user leaving the funding flow and coming
 *    back is all it takes.
 *
 * Both are properties of the sequencing, not of smoldot, so they are tested with fakes.
 */

import type { HexString } from '@bleavit/shared-types';
import type { AssetHubLeg, BundledChain, SmoldotChainLike } from './topology.js';

/**
 * A connected Asset Hub leg, generic in the transport.
 *
 * Mirrors `AssetHubLeg`: only `attached` carries a transport, so a refused leg has nothing
 * to read from and the compiler enforces it. The two unions stay separate rather than one
 * extending the other, because a transport can fail to open *after* the chain attached and
 * its identity checked out — a different fact about the world from a wrong chain, and a
 * retryable one where a wrong chain is not.
 */
export type AssetHubConnection<T> =
  | { readonly kind: 'attached'; readonly transport: T; readonly genesisHash: HexString }
  | Exclude<AssetHubLeg<SmoldotChainLike>, { kind: 'attached' }>;

export interface AssetHubConnectorOptions<C extends SmoldotChainLike, T> {
  /** Usually `(bundled) => topology.attachAssetHub(bundled)`. */
  readonly attach: (assetHub: BundledChain) => Promise<AssetHubLeg<C>>;
  /**
   * Opens a follow subscription over the attached chain.
   *
   * Takes the bundle as well as the chain, because the transport is what stamps a chain
   * identity onto every read it serves and that identity is the **pin** — a release-chosen
   * value, not one the chain reported. Handing it only the chain would leave the caller
   * reaching for the pin some other way, which is where a mutable holding variable comes
   * from and how a second connection ends up stamped with the first one's identity.
   */
  readonly openTransport: (chain: C, assetHub: BundledChain) => Promise<T>;
  readonly closeTransport: (transport: T) => void;
}

export interface AssetHubConnector<T> {
  /** Idempotent for success, retryable after failure. See `attachAssetHub` for both reasons. */
  connect(assetHub: BundledChain): Promise<AssetHubConnection<T>>;
  /** Close the transport if one is open. Does **not** detach the chain — `stop()` owns that. */
  close(): void;
}

export function assetHubConnector<C extends SmoldotChainLike, T>(
  options: AssetHubConnectorOptions<C, T>,
): AssetHubConnector<T> {
  let open: { readonly connection: Extract<AssetHubConnection<T>, { kind: 'attached' }>; readonly transport: T } | undefined;

  return {
    async connect(assetHub) {
      if (open !== undefined) return open.connection;

      const leg = await options.attach(assetHub);
      if (leg.kind !== 'attached') return leg;

      let transport: T;
      try {
        transport = await options.openTransport(leg.chain, assetHub);
      } catch (error) {
        // Detach rather than leave a chain nothing reads from. Reported as retryable, which
        // it is: the release is right, the chain is right, the subscription is not.
        leg.detach();
        return {
          kind: 'unavailable',
          reason:
            'The Asset Hub connection was established but never reported a finalized block: ' +
            `${error instanceof Error ? error.message : String(error)}. Deposits are ` +
            'unavailable until it syncs; nothing else in the app is affected (11 E17).',
        };
      }

      const connection = { kind: 'attached', transport, genesisHash: leg.genesisHash } as const;
      open = { connection, transport };
      return connection;
    },
    close() {
      if (open === undefined) return;
      options.closeTransport(open.transport);
      open = undefined;
    },
  };
}
