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
 *  - **A connect that arrives while one is still running joins it.** The rule above held only
 *    once an attach had *finished*: the cache is written at the end, so during the attach the
 *    slot was still empty and a second caller ran the whole sequence again — another chain,
 *    another genesis probe, another `chainHead_follow` — and the last to finish overwrote the
 *    cache, leaking every earlier transport, since `close()` reaches only what the cache
 *    holds. That window is not a corner: E17's recovery action is *"retry AH sync"* and the
 *    deposit screen stops waiting long before a cold Asset Hub finishes, so a retry lands
 *    mid-attach by construction.
 *  - **An abandoned attempt takes back down whatever it built.** Joining a running attach is
 *    only safe if there is a way out of it, and the first version had none: a shared attempt
 *    that never settled pinned the slot for the life of the connector, so the retry control
 *    it was protecting could never start anything again. `probeGenesisHash` loops without a
 *    timer and an Asset Hub genesis probe has been *observed* pending past five minutes, so
 *    that is the ordinary case rather than the pathological one. `connect` therefore takes
 *    the bound itself and `close()` abandons too, and an attempt that finds itself abandoned
 *    detaches its chain and closes its transport instead of installing them.
 *
 * All four are properties of the sequencing, not of smoldot, so they are tested with fakes.
 *
 * Two of these look like they belong in `topology.attach`, the deeper layer. They do not: that
 * function owns the lifetime of a **chain**, this one owns the lifetime of a **transport**, and
 * only the second can be abandoned without disturbing 10 §5.2's compat probe, which holds a
 * deliberately separate handle through `AttachOptions.reuse: false`.
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

export interface AssetHubConnectOptions {
  /**
   * How long this call waits before **abandoning the attempt** — 11 E17; 02 §7.7.
   *
   * The bound is here rather than around the call because a wrapper can only abandon the
   * *wait*. `openDepositLeg` used to race `connectAssetHub` against a timer and report
   * *blocked with diagnostics*, which satisfies E17's `F:` row and quietly breaks its `R:`
   * row: the attach kept running, the connector kept it as the answer to every later
   * `connect`, and *"retry AH sync"* could then never start a new one. A control that
   * reports a failure it cannot recover from is worse than the unbounded wait it replaced.
   *
   * Omitted means wait indefinitely, which is right for a caller with no screen to unblock.
   */
  readonly deadlineMs?: number;
}

export interface AssetHubConnector<T> {
  /**
   * Idempotent for success, retryable after failure, and **shared while in flight**.
   *
   * See `attachAssetHub` for the first two reasons and this module's header for the third.
   */
  connect(assetHub: BundledChain, options?: AssetHubConnectOptions): Promise<AssetHubConnection<T>>;
  /**
   * Close the transport if one is open, and abandon an attempt that is still running.
   *
   * Does **not** detach a *cached* chain — `stop()` owns that. It does detach a chain an
   * abandoned attempt goes on to attach, because after this call nothing owns it.
   */
  close(): void;
}

/** A bound as a person would say it. Sub-second bounds exist only in suites, and "0s" is a lie. */
function bound(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

export function assetHubConnector<C extends SmoldotChainLike, T>(
  options: AssetHubConnectorOptions<C, T>,
): AssetHubConnector<T> {
  let open: { readonly connection: Extract<AssetHubConnection<T>, { kind: 'attached' }>; readonly transport: T } | undefined;
  let inFlight: Promise<AssetHubConnection<T>> | undefined;
  /**
   * Bumped whenever an attempt is abandoned — by its deadline, or by `close()`.
   *
   * An attempt reads it at each of its two await points. Finding it changed means nobody is
   * waiting for what it is building any more, so it takes back down whatever it has built so
   * far. Without this, abandoning was a lie in both directions: `close()` returned while an
   * attach went on to install a live transport nothing could reach, and a timed-out attempt
   * left a second chain syncing for the rest of the session.
   */
  let generation = 0;

  function abandon(): void {
    generation += 1;
    inFlight = undefined;
  }

  const abandoned = (): AssetHubConnection<T> => ({
    kind: 'unavailable',
    reason:
      'The Asset Hub connection was abandoned before it completed. Deposits are unavailable ' +
      'until it is retried; nothing else in the app is affected (11 E17).',
  });

  async function attempt(assetHub: BundledChain): Promise<AssetHubConnection<T>> {
    const mine = generation;
    const stale = () => mine !== generation;

    const leg = await options.attach(assetHub);
    if (leg.kind !== 'attached') return leg;
    if (stale()) {
      leg.detach();
      return abandoned();
    }

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

    if (stale()) {
      options.closeTransport(transport);
      leg.detach();
      return abandoned();
    }

    const connection = { kind: 'attached', transport, genesisHash: leg.genesisHash } as const;
    open = { connection, transport };
    return connection;
  }

  return {
    connect(assetHub, connectOptions) {
      if (open !== undefined) return Promise.resolve(open.connection);

      if (inFlight === undefined) {
        const slot = attempt(assetHub).finally(() => {
          // Only when this attempt is still the current one. An abandoned attempt cleared the
          // slot at the moment it was abandoned, and a retry may already have installed its
          // own — clearing unconditionally here would discard that newer attempt's slot and
          // let a third attach start beside it.
          if (inFlight === slot) inFlight = undefined;
        });
        inFlight = slot;
      }
      const joined = inFlight;

      const deadlineMs = connectOptions?.deadlineMs;
      if (deadlineMs === undefined) return joined;

      return new Promise<AssetHubConnection<T>>((resolve, reject) => {
        const timer = setTimeout(() => {
          abandon();
          resolve({
            kind: 'unavailable',
            reason:
              `The Asset Hub connection did not complete within ${bound(deadlineMs)}. ` +
              'It is a second light client syncing from scratch, so this is what an unreachable ' +
              'or very slow Asset Hub looks like from here. Deposits are unavailable until it ' +
              'syncs; nothing else in the app is affected (11 E17).',
          });
        }, deadlineMs);
        joined.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },
    close() {
      // Before the cached half, because an attempt in flight must not install a transport
      // after the caller has been told the connector is closed.
      abandon();
      if (open === undefined) return;
      options.closeTransport(open.transport);
      open = undefined;
    },
  };
}
