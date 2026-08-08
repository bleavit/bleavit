/**
 * S12/S13's wiring — 11 §11.9, 02 §7.7. F18's own composition root.
 *
 * `funding-reads.ts` holds the reads, `funding-composition.ts` the keys and decoders, and
 * `chain-client` the two light-client connections. Nothing joined them, which is what F18's
 * row means by *"the second light-client connection to Asset Hub, and only that"*: every
 * piece existed and no module attached Asset Hub, opened a reader over it and paired it with
 * the local one.
 *
 * ## The two legs are separate functions, and that is 02 §7.7 written into signatures
 *
 * §11.9.1 makes *"AH connection synced & descriptors compatible"* a precondition **row**, and
 * 11 E17 requires the deposit flow *"blocked with diagnostics (never a blind 'send anyway')"*.
 * §11.9.2 says the opposite about withdraw: it is a **local** `pallet_xcm` call over 02 §7.4
 * reads, and *"without the AH connection the check degrades to a warning, never silently
 * skipped"*.
 *
 * So {@link openWithdrawLeg} takes **no Asset Hub connector at all** — the argument is not in
 * scope, exactly as `readWithdrawInputs` takes no Asset Hub reader. A future edit cannot
 * couple the two without changing that signature and meeting §11.9.2 on the way past. The
 * failure this shape forbids is the tempting one: a single `openFunding()` that connects both
 * chains and returns both legs, which takes withdraw offline every time Asset Hub is slow and
 * presents an Asset Hub outage to the user as *funding is down*.
 *
 * ## Release artifacts are not the connection, and only the connection is asymmetric
 *
 * Both legs are built from `FundingChains` — one chain's metadata and descriptors each, which
 * are committed release data (`fixtures/chain-feed/`, `fixtures/foreign-chain-feed/`) and are
 * present whether or not any chain is reachable. Building a key from Asset Hub's metadata
 * costs nothing and reaches no network. What §11.9.2 makes asymmetric is the **live**
 * connection, which is where this module enforces it.
 *
 * ## A same-chain reader pair is loud, not a blocked deposit
 *
 * `fundingReaders` throws `SameChainError` when the two readers share a chain identity, and
 * this module lets that throw propagate rather than turning it into `blocked`. That is
 * deliberate. `attachAssetHub` already refuses a bundle pinning our own genesis, so reaching
 * it needs the *local* transport to be on Asset Hub — at which point every futarchy figure on
 * every screen is already a foreign read under a local label, and a polite *"deposits are
 * unavailable"* would hide a release nothing else in the client can detect. The one class of
 * defect this repository keeps finding is a true statement about the wrong chain; it does not
 * get a friendly message.
 *
 * ## The foreign verdict is computed here now, and it is a **row**, not a gate
 *
 * This header used to say `assetHubCompatible` *"is not computed here and is not defaulted"*,
 * because nothing constructed a typed API. F26 built that (`compat-boot.ts`), so the leg now
 * runs 10 §5.2's foreign classifier and carries the result — the value `readDepositInputs`
 * has always required and nothing produced.
 *
 * **It does not turn `ready` into `blocked`.** §11.9.1 makes *"AH connection synced &
 * descriptors compatible"* a precondition **row**, and a row is something the user is shown
 * failing, at B′, beside the others. A `restricted` Asset Hub whose readers opened perfectly
 * well would, under a gate, produce a screen that never renders and a diagnosis the user
 * never sees — E17 asks for the opposite, *"blocked with diagnostics"*. So the verdict rides
 * on the `ready` arm and `depositBlocks` refuses on it. `blocked` stays what it always was:
 * the chain is not attached, or a reader could not be opened.
 *
 * Attaching the chain remains a different fact from its runtime being compatible; what has
 * changed is that both are now established rather than one being assumed.
 */

import type {
  AssetHubConnection,
  BundledChain,
  ChainHeadTransport,
  RuntimeVersionReport,
} from '@bleavit/chain-client';
import type { ForeignVerdict } from './compat-session.js';
import {
  fundingDecoders,
  fundingKeys,
  fundingReaders,
  type FundingChains,
  type FundingDecoders,
  type FundingKeys,
  type FundingReader,
  type FundingReaders,
} from '@bleavit/features-tx';

/**
 * The per-release funding pins, injected — 02 §7.7, §8.
 *
 * Neither has a default and neither is a literal in this source. The asset index is 1337 and
 * has been resolved twice (V-17, V-105), and it is *still* a parameter: §7.7 pins the Asset
 * Hub of the relay each release targets, so a compiled-in value would be a release constant
 * that stops tracking the release. The USDC `Location` is `unknown` for the reason
 * `FundingKeyInputs` gives — the chain's own codec is the only authority on its shape, and a
 * second declaration here would be one nothing can compare against the first.
 */
export interface FundingPins {
  /** The Asset Hub bundle this release ships, pinned and hash-checked before `addChain`. */
  readonly assetHub: BundledChain;
  /** The USDC XCM `Location`, as this chain's `ForeignAssets` codec accepts it (02 §8). */
  readonly usdcLocation: unknown;
}

/** Keys and decoders, built once per chain pair. Shared by both legs; neither is a connection. */
export interface FundingArtifacts {
  readonly keys: FundingKeys;
  readonly decoders: FundingDecoders;
}

/**
 * Build the four frozen surfaces' keys and decoders from the two chains' committed artifacts.
 *
 * Separated from the legs because it reaches no network and can fail for reasons that have
 * nothing to do with either chain being up: `storageKeyBuilder` refuses when a chain's
 * metadata and its descriptors disagree on a storage item's hasher count, and refuses an
 * absent item outright. Both are packaging defects, and finding them while the app is wiring
 * itself up beats finding them while a user is looking at a deposit screen.
 */
export function fundingArtifacts(chains: FundingChains, pins: FundingPins): FundingArtifacts {
  return {
    keys: fundingKeys({ ...chains, usdcLocation: pins.usdcLocation }),
    decoders: fundingDecoders(chains),
  };
}

/** Opening a reader at a transport's finalized head. Usually `FinalizedReader.open`. */
export type OpenReader<T> = (transport: T) => Promise<FundingReader>;

export interface WithdrawLegDeps<T extends ChainHeadTransport> {
  /** **This chain only.** There is deliberately no Asset Hub field on this interface. */
  readonly local: T;
  readonly openReader: OpenReader<T>;
  readonly artifacts: FundingArtifacts;
}

export interface DepositLegDeps<T extends ChainHeadTransport> extends WithdrawLegDeps<T> {
  /** Usually `client.connectAssetHub`. Attaches the chain lazily, on entering the flow (E17). */
  readonly connectAssetHub: (
    assetHub: BundledChain,
    options?: { readonly deadlineMs?: number },
  ) => Promise<AssetHubConnection<T>>;
  /** Overrides {@link ASSET_HUB_CONNECT_DEADLINE_MS}. Injected so a suite drives the boundary. */
  readonly assetHubDeadlineMs?: number;
  readonly pins: FundingPins;
  /**
   * 10 §5.2's **foreign** verdict — usually `classifyAssetHubFor` from `compat-boot.ts`.
   *
   * Injected, for the reason `chain-session.ts` injects `start`: the supplier names PAPI and
   * `@polkadot-api/descriptors`, and importing either here would load both into every Node
   * suite that imports `@bleavit/application`.
   *
   * It takes the runtime the **reader's** transport reports, so the verdict and the deposit
   * preconditions describe the same finalized block. A second follow subscription's own head
   * would be a verdict about a block nothing else in the flow used.
   */
  readonly classifyAssetHub: (
    assetHub: BundledChain,
    runtime: RuntimeVersionReport | undefined,
  ) => Promise<ForeignVerdict>;
}

/**
 * S13's leg — the local reader, and nothing else.
 *
 * `blocked` here means the **local** chain could not be read, which is a different fact from
 * every reason the deposit leg blocks. Sharing one reason string between the two would be the
 * *funding is down* message §11.9.2 exists to prevent.
 */
export type WithdrawLeg =
  | { readonly kind: 'ready'; readonly reader: FundingReader; readonly artifacts: FundingArtifacts }
  | { readonly kind: 'blocked'; readonly reason: string };

/**
 * S12's leg — the branded reader pair, or the Asset Hub leg's own reason for refusing.
 *
 * `blocked` carries the reason the *Asset Hub* connection gave, unchanged: `attachAssetHub`
 * and `assetHubConnector` already distinguish a wrong chain (terminal, retrying cannot help)
 * from an unreachable one (retryable, E17's recovery action is *"retry AH sync"*), and
 * rewriting either into a generic sentence would discard the distinction a user acts on.
 */
export type DepositLeg =
  | {
      readonly kind: 'ready';
      readonly readers: FundingReaders;
      readonly artifacts: FundingArtifacts;
      /**
       * 10 §5.2's foreign verdict for this connection — §11.9.1's first precondition row.
       *
       * Present on `ready` and nowhere else, because it is a statement about a chain that
       * answered: a `blocked` leg has no Asset Hub connection to have a verdict about, and a
       * field carrying one would invite a screen to render a compatibility diagnosis for a
       * chain it never reached.
       */
      readonly foreign: ForeignVerdict;
    }
  | { readonly kind: 'blocked'; readonly reason: string };

function because(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function openWithdrawLeg<T extends ChainHeadTransport>(
  deps: WithdrawLegDeps<T>,
): Promise<WithdrawLeg> {
  try {
    return { kind: 'ready', reader: await deps.openReader(deps.local), artifacts: deps.artifacts };
  } catch (error) {
    return {
      kind: 'blocked',
      reason:
        `This chain could not be read at a finalized block: ${because(error)}. Withdrawals are ` +
        'unavailable until it can be; this is not an Asset Hub problem (11 §11.9.2).',
    };
  }
}

/**
 * S12's leg — attach Asset Hub, open a reader over each chain, pair them.
 *
 * Order is load-bearing: **Asset Hub first**. It is the leg that can refuse, and refusing
 * before the local reader is opened means a blocked deposit costs no local read and pins no
 * local block. The reverse order would open a reader whose block is then held for however long
 * the Asset Hub sync takes, and `FinalizedReader`'s pin is only readable while the transport
 * still holds that block.
 */
/**
 * How long the deposit leg waits for the Asset Hub connection — 11 E17; 02 §7.7. F27.
 *
 * **The obligation is on the client, and it was unmet.** E17's `F:` row requires *"AH
 * connection unavailable ⇒ flow blocked with diagnostics (never a blind 'send anyway')"*, and
 * 02 §7.7 requires an unavailable Asset Hub surface to *"block the funding flow with
 * diagnostics"*. `connectAssetHub` carries no deadline of its own — `attachAssetHub`'s genesis
 * probe loops on `nextJsonRpcResponse()` with no timer — so an Asset Hub that never answers
 * produced neither *blocked* nor *diagnostics*: it rendered as a spinner that never resolves.
 * Observed against a live topology, where Asset Hub's ~189k-entry genesis kept the probe
 * pending past five minutes.
 *
 * A **UI** timeout, on `COMPAT_PULL_DEADLINE_MS`'s stated grounds rather than by analogy: 10
 * §5.4's no-hardcode rule governs values the chain publishes, and there is no `Params` key, no
 * metadata constant and nowhere to read a client-side deadline from. Longer than the compat
 * pull because this one covers a **cold chain add** — a second smoldot chain syncing from
 * scratch — where that one covers a metadata read on a chain already synced.
 *
 * Injectable, so a suite drives the boundary without waiting on it.
 *
 * ## The value is here; the bound is not
 *
 * This module owns *how long a deposit screen may sit unanswered*, and that is all it owns.
 * The bound itself is applied inside `assetHubConnector.connect`, because a timer wrapped
 * around the call can only abandon the **wait** — a promise has no cancel, so the attach kept
 * running, the connector kept it as the answer to every later `connect`, and E17's `R: retry
 * AH sync` could never start a new one. Satisfying E17's *"blocked with diagnostics"* while
 * disabling its recovery action is worse than the unbounded wait it replaced.
 *
 * So the number is passed down rather than enforced here, and the connector abandons the work
 * it is bounding: it detaches the chain and closes any transport the abandoned attempt goes on
 * to open. Timing out and retrying is the expected path on a cold Asset Hub, not the unlucky
 * one, which is why that behaviour lives where a suite can hold two calls open and prove it.
 */
export const ASSET_HUB_CONNECT_DEADLINE_MS = 120_000;

export async function openDepositLeg<T extends ChainHeadTransport>(
  deps: DepositLegDeps<T>,
): Promise<DepositLeg> {
  let connection: AssetHubConnection<T>;
  try {
    connection = await deps.connectAssetHub(deps.pins.assetHub, {
      deadlineMs: deps.assetHubDeadlineMs ?? ASSET_HUB_CONNECT_DEADLINE_MS,
    });
  } catch (error) {
    // `assetHubConnector` never throws — every failure is an arm. A throw therefore means the
    // connector was replaced or the attach path itself failed, and it must still not take down
    // a screen for a leg that only blocks deposits.
    return {
      kind: 'blocked',
      reason:
        `The Asset Hub connection failed: ${because(error)}. Deposits are unavailable; nothing ` +
        'else in the app is affected (02 §7.7).',
    };
  }
  if (connection.kind !== 'attached') return { kind: 'blocked', reason: connection.reason };

  let assetHub: FundingReader;
  try {
    assetHub = await deps.openReader(connection.transport);
  } catch (error) {
    return {
      kind: 'blocked',
      reason:
        `Asset Hub could not be read at a finalized block: ${because(error)}. Deposits are ` +
        'unavailable until it syncs; nothing else in the app is affected (11 E17).',
    };
  }

  let local: FundingReader;
  try {
    local = await deps.openReader(deps.local);
  } catch (error) {
    return {
      kind: 'blocked',
      reason:
        `This chain could not be read at a finalized block: ${because(error)}. The deposit ` +
        'checks span both chains, so it is blocked rather than checked on one of them.',
    };
  }

  // The 02 §7.7 probe, **after** the readers, and the order is the same argument E17 makes
  // about the connection: the reader's transport is where the runtime version comes from, so
  // there is nothing to classify against until it has reported a finalized block. A
  // `restricted` or `unsupported` Asset Hub leaves this leg `ready`, so §11.9.1's row can fail
  // on screen rather than the screen not existing.
  //
  // **Wrapped, so this leg can only be `ready` or `blocked`.** `classifyAssetHubFor` returns a
  // verdict for every arm it knows about, and that is not the same as being unable to reject:
  // PAPI computes compat on *property access*, so a runtime its metadata layer cannot map
  // throws inside the probe rather than inside the pull. Unwrapped, that rejection propagated
  // out of `openDepositLeg` and the deposit screen never rendered at all — no diagnostics, no
  // row, nothing (reproduced, not reasoned). E17 wants the flow *blocked with diagnostics*, so
  // an injected classifier that throws becomes a blocked leg carrying what it threw.
  let foreign: ForeignVerdict;
  try {
    foreign = await deps.classifyAssetHub(deps.pins.assetHub, connection.transport.finalizedRuntime());
  } catch (error) {
    return {
      kind: 'blocked',
      reason:
        `The Asset Hub compatibility check could not be completed: ${because(error)}. Deposits ` +
        'are unavailable; nothing else in the app is affected (02 §7.7, 11 E17).',
    };
  }

  // Throws `SameChainError` rather than blocking — see this module's header.
  return {
    kind: 'ready',
    readers: fundingReaders(local, assetHub),
    artifacts: deps.artifacts,
    foreign,
  };
}
