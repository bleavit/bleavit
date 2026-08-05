/**
 * The smoldot topology — 10 §4.1, §4.3, §3.1.
 *
 * One smoldot instance hosting **two** chains at boot: the relay light client and the
 * futarchy parachain client, linked through `potentialRelayChains`. Parachain finality
 * derives from relay-finalized para-inclusion, so the relay client is not an accessory to
 * the parachain client — it is what makes a parachain read verifiable at all. 10 §3.1
 * states the consequence in one line: *"the parachain client cannot run without the relay
 * client, so 'single-chain mode' does not exist"*. This module has no code path that
 * returns a topology without both, which is that sentence expressed as a type.
 *
 * A **third** chain — Asset Hub, for the 11 §11.9 funding flow — joins the same instance
 * later, through `attachAssetHub`. Its lateness is normative rather than an optimization:
 * 11 E17 says *"the AH chain is not connected at boot"*, and the two chains above are
 * exactly what boot is. So the asymmetry between them runs all the way through this file:
 * a relay or parachain failure aborts `startTopology` and tears the whole topology down,
 * while **every** Asset Hub failure is a returned value that leaves the other two running.
 * There is no failure of the deposit leg that is allowed to become a failure of the app.
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

/**
 * The Asset Hub attachment — 11 §11.9.1 and E17, 02 §7.7.
 *
 * A discriminated union rather than a nullable chain, because **only the `attached` arm has
 * a `chain` field**. That is the same construction `Combined<T>` uses for its refusing arm:
 * a leg we have refused cannot be read from, and the compiler says so, rather than a caller
 * remembering to check a flag before dereferencing.
 *
 * `wrong-chain` carries the **observed** genesis rather than dropping it, and that is
 * load-bearing. `classifyForeign` distinguishes `unreachable` ("could not be reached — retry")
 * from `wrong-chain` ("a different chain — retrying will not change this"), and it draws that
 * distinction from whether an observation carries a genesis hash. A leg that discarded the
 * hash on mismatch would present a permanently wrong chain as a transient sync failure, and
 * the user would retry forever — the same defect as advising "refresh to read them together"
 * for two reads on different chains.
 */
export type AssetHubLeg<C extends SmoldotChainLike = SmoldotChainLike> =
  | {
      readonly kind: 'attached';
      readonly chain: C;
      readonly spec: ParsedChainSpec;
      /** What the light client reported. Equal to the pin — checked before this is built. */
      readonly genesisHash: HexString;
      /** Remove **this** chain alone. Idempotent; never touches the relay or the parachain. */
      detach(): void;
    }
  | {
      readonly kind: 'wrong-chain';
      /** The chain that answered. Carried so the verdict is `wrong-chain`, not `unreachable`. */
      readonly genesisHash: HexString;
      readonly reason: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface Topology<C extends SmoldotChainLike = SmoldotChainLike> {
  readonly relay: C;
  readonly para: C;
  readonly relaySpec: ParsedChainSpec;
  readonly paraSpec: ParsedChainSpec;
  /**
   * Attach the Asset Hub chain — 11 §11.9.1's *"second light-client connection to Asset Hub
   * (same smoldot instance, additional chain)"*.
   *
   * **A method rather than a `startTopology` option, because 11 E17 makes the connection
   * lazy**: *"AH connection syncs on entering the flow — the AH chain is not connected at
   * boot"*. 10 §9.3 budgets the chain specs the same way (*"relay + para + Asset Hub, gz,
   * **lazy**"*). Adding it during boot would spend a third chain's memory and sync on every
   * session that never deposits, and would put an Asset Hub failure inside the boot machine —
   * where the only honest thing it could do is degrade a state that has nothing to do with it.
   *
   * A method rather than a free function for a second reason: it closes over this topology's
   * own client, relay `Chain` object and teardown list. So *"same smoldot instance"* is not a
   * rule to remember — there is no other client in scope — and `stop()` removes an attached
   * Asset Hub chain without anyone registering it.
   *
   * **Never throws.** Every failure is an arm of `AssetHubLeg`, because a throw here would
   * have to be caught by every call site and turned back into exactly this, and one call site
   * that let it propagate would take down a screen for a leg that only blocks deposits.
   */
  attachAssetHub(assetHub: BundledChain): Promise<AssetHubLeg<C>>;
  /** Remove every chain this topology added, including an attached Asset Hub. Idempotent. */
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
  const remove = (chain: C): void => {
    try {
      chain.remove();
    } catch {
      // `remove()` throws only if the chain or client is already gone, which is the
      // state we are trying to reach.
    }
  };
  /**
   * Remove one chain this topology is still tracking; a no-op if it has already gone.
   *
   * The membership test is what makes it genuinely idempotent rather than idempotent-by-
   * swallowed-exception. `remove()` on an already-removed chain throws and `remove` above
   * discards that, so calling it twice *looks* harmless — but the discarded throw is also
   * how a real double-removal would hide, and there is no reason to spend the ambiguity.
   */
  const removeOne = (chain: C): void => {
    const index = added.indexOf(chain);
    if (index < 0) return;
    added.splice(index, 1);
    remove(chain);
  };
  const stop = (): void => {
    while (added.length > 0) {
      const chain = added.pop();
      if (chain !== undefined) remove(chain);
    }
  };

  /** The Asset Hub chain, once attached. See `attach` for why only success is remembered. */
  let attached: Extract<AssetHubLeg<C>, { kind: 'attached' }> | undefined;

  async function attach(relayChain: C, assetHub: BundledChain): Promise<AssetHubLeg<C>> {
    // **Success is cached, failure is not**, and each half has its own reason. A user who
    // leaves the funding flow and comes back must not add a second chain; and a leg that
    // failed must be retryable, because E17's recovery action is literally *"retry AH sync"*
    // — a cached failure would make that button do nothing for the rest of the session.
    if (attached !== undefined) return attached;

    const blocked = (reason: string): AssetHubLeg<C> => ({
      kind: 'unavailable',
      reason: `${reason} Deposits are unavailable; nothing else in the app is affected (02 §7.7).`,
    });
    const because = (error: unknown): string => (error instanceof Error ? error.message : String(error));

    if (assetHub.pinned.kind !== 'para') {
      return blocked(`The Asset Hub slot was given a ${assetHub.pinned.kind} spec (${assetHub.pinned.id}).`);
    }
    // The check that catches a build putting one of *our* bundles in the Asset Hub slot.
    // Nothing downstream would notice: the bytes match their own pin, the relay linkage is
    // right, and the genesis check passes — so the deposit screen would read USDC balances
    // off the futarchy chain and label them Asset Hub. Wrong in the dangerous direction, and
    // invisible, since both chains answer every read consistently.
    if (
      assetHub.pinned.genesisHash === para.pinned.genesisHash ||
      assetHub.pinned.genesisHash === relay.pinned.genesisHash
    ) {
      return blocked(
        `The bundled Asset Hub spec (${assetHub.pinned.id}) pins the same genesis as the ` +
          'bundled relay or parachain, so it is not a second chain at all.',
      );
    }

    let assetHubSpec: ParsedChainSpec;
    try {
      assetHubSpec = await verifyBundledChainSpec(assetHub.chainSpec, assetHub.pinned);
    } catch (error) {
      return blocked(`The bundled Asset Hub chain spec did not verify: ${because(error)}.`);
    }
    if (assetHubSpec.relayChain !== relaySpec.id) {
      return blocked(
        `The Asset Hub spec names relay ${JSON.stringify(assetHubSpec.relayChain)} but this ` +
          `release bundles ${JSON.stringify(relaySpec.id)}; the linkage would never form and ` +
          'the chain would sit un-finalized, which on screen is indistinguishable from slow sync.',
      );
    }
    if (assetHubSpec.bootNodes.length === 0 && extra.length === 0) {
      return blocked(
        `The bundled Asset Hub spec (${assetHubSpec.id}) carries no bootnodes and none were ` +
          'supplied; the light client would have nothing to dial.',
      );
    }

    let chain: C;
    try {
      // Linked to the relay `Chain` object this topology already holds — the same object
      // identity rule the parachain follows, and the reason this is a method.
      chain = await client.addChain({
        chainSpec: withExtraBootnodes(assetHub.chainSpec, extra),
        potentialRelayChains: [relayChain],
      });
    } catch (error) {
      return blocked(`The Asset Hub chain could not be added to the light client: ${because(error)}.`);
    }
    added.push(chain);

    let observed: HexString;
    try {
      observed = await options.genesisHashOf(chain);
    } catch (error) {
      removeOne(chain);
      return blocked(`The Asset Hub chain did not report a genesis hash: ${because(error)}.`);
    }

    if (observed !== assetHub.pinned.genesisHash) {
      // Removed, but the observed hash is **kept** — see `AssetHubLeg`. A chain we will
      // never read from should not go on syncing, and a mismatch that lost the hash would
      // be reported as "could not be reached", which invites a retry that cannot succeed.
      removeOne(chain);
      return {
        kind: 'wrong-chain',
        genesisHash: observed,
        reason:
          `The chain answering as Asset Hub has genesis ${observed}, and this release pins ` +
          `${assetHub.pinned.genesisHash}. That is a different chain, not an older or newer ` +
          'runtime — no balance it reports describes your account. Deposits are disabled and ' +
          'retrying will not change this.',
      };
    }

    attached = {
      kind: 'attached',
      chain,
      spec: assetHubSpec,
      genesisHash: observed,
      detach: () => {
        removeOne(chain);
        // Only clear the cache if **this** leg is still the current one. A screen holding a
        // stale leg — detached, then re-entered, so a newer chain is live — would otherwise
        // clear the cache on unmount and leave that newer chain running unreferenced, while
        // the next entry into the flow added a third. Both chains sync; neither is reachable.
        if (attached?.chain === chain) attached = undefined;
      },
    };
    return attached;
  }

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

    return {
      relay: relayChain,
      para: paraChain,
      relaySpec,
      paraSpec,
      attachAssetHub: (assetHub) => attach(relayChain, assetHub),
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}
