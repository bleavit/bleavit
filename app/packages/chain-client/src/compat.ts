/**
 * `createClient` — 10 §4.1's missing half, and 10 §5.2's only source of a compat surface.
 *
 * `light-client.ts` opens the chain and stops; its header says why `createClient` is not
 * there, and that ruling is unchanged and is the reason this is a **separate module behind a
 * separate subpath export**:
 *
 * > Introducing it now would place metadata compatibility underneath the read layer, where
 * > 10 §5.2's `full`/`restricted`/`read-only-incompatible` classifier cannot see it — the
 * > app would fail to construct a client instead of booting into `ReadOnlyIncompatible` and
 * > telling the user why.
 *
 * Nothing here is on the read path. `ChainHeadConnection` is opened, and every
 * `Finalized<T>` is produced, without this module ever being loaded: it is imported through
 * `@bleavit/chain-client/compat`, and the only importer is the composition root that asks
 * for a verdict. A runtime this release cannot decode therefore fails **here**, in a
 * function whose result is a value, long after the client is up and rendering.
 *
 * ## Why the probe goes through the typed api, and why that is not negotiable
 *
 * 10 §5.2, resolving FE-P1: the surface is `(await api.getStaticApis()).compat[group][pallet]
 * [member]`, it exists on `getTypedApi(descriptors)` and **not** on `getUnsafeApi()`, and
 * `isCompatible()` must be called with no threshold because PAPI's default is
 * `BackwardsCompatible`. The trap the same section names is the reason the descriptors are a
 * required argument here with no default: *"with no descriptors supplied at all PAPI reports
 * the value side as `identical`, which reads as full compatibility while nothing was
 * compared."* There is no arm of this module that produces a compat surface without a
 * descriptor set, so that reading is unreachable rather than avoided.
 *
 * ## The client is transient, and that is a resource decision rather than a style
 *
 * A compat surface is a **static** fact about (descriptors × the runtime at a block). Once
 * it has been pulled there is nothing left to subscribe to, and a `PolkadotClient` left
 * alive holds a second `chainHead_v1_follow` on the chain for the life of the tab, pinning
 * blocks against the same node budget `PIN_WINDOW` exists to respect. So the caller is
 * handed a `close()` and every failure path closes before it returns.
 *
 * ## Honest limit
 *
 * Like `light-client.ts`, no test in this repository executes this function: it needs a
 * provider that completes PAPI's own chainHead handshake, which is a running node. What is
 * verified per commit is everything on either side of it — the classifier above
 * (`app/src/application/src/compat-session.ts`, driven with this seam injected) and the
 * probe below (`@bleavit/descriptors`). That is the same seam `chain-boot.ts` draws around
 * `startLightClient`, in the same place and for the same reason.
 */

import { createClient, type ChainDefinition, type TypedApi } from 'polkadot-api';

/**
 * PAPI's own `JsonRpcProvider`, taken from `createClient` rather than re-declared.
 *
 * **Deliberately not `transport.ts`'s `JsonRpcProviderLike`, and the reason is a measured
 * fact rather than a preference.** The structural type is *wider* than PAPI's — its
 * `JsonRpcMessageLike` makes `method` optional, so one value can describe a response and a
 * notification — and under `exactOptionalPropertyTypes` that width flows the wrong way
 * through the callback: `JsonRpcProviderLike` is **not** assignable to `JsonRpcProvider`,
 * while PAPI's real provider *is* assignable to `JsonRpcProviderLike`. That asymmetry is
 * exactly right for what each side does. `ChainHeadConnection` **consumes** messages, so it
 * benefits from accepting more than PAPI promises; `createClient` **is handed** a provider,
 * so it must be handed one that meets PAPI's contract and not a superset of it. Taking the
 * type from `createClient` itself means a compat client can only ever be built over a real
 * provider, and the compiler says so rather than a cast hiding it.
 */
export type CompatProvider = Parameters<typeof createClient>[0];

/**
 * `(await api.getStaticApis()).compat`, as PAPI types it for a given descriptor set.
 *
 * Exported so the composition root can bind it against `@bleavit/descriptors`' structural
 * `CompatSurface` — the assignability check `topology.ts` gets from `asTopologyClient`. It
 * cannot be done in this package: `packages/descriptors` may not import the chain SDK, and
 * `nothing-bypasses-chain-client` forbids this package importing anything but
 * `shared-types`. The one module that legitimately sees both sides is the application layer,
 * so the type travels there and the assertion lives with the value it describes.
 */
export type ChainCompatSurface<D extends ChainDefinition> = Awaited<
  ReturnType<TypedApi<D>['getStaticApis']>
>['compat'];

/** A pulled compat surface and the client it came from, which the caller must close. */
export interface OpenCompatSurface<D extends ChainDefinition> {
  readonly compat: ChainCompatSurface<D>;
  /** Destroy the transient client. Idempotent; safe after a failure. */
  close(): void;
}

/**
 * Build a transient typed client over `provider` and pull its compat surface.
 *
 * `at` is left at PAPI's default, which is **`"finalized"`** — read from the pinned
 * `PullOptions` declaration rather than assumed. That is the same rule every
 * transaction-critical read in this client follows (10 §4.2 rule 1), and it is the rule that
 * matters most here: this verdict decides whether the app may sign, so classifying against a
 * best-block runtime would enable signing against a runtime the chain may still reorg away.
 * Passing `"best"` is not offered.
 *
 * **Throws rather than returning a verdict**, deliberately. This module cannot tell a
 * network failure from a runtime it cannot decode, and inventing a `CompatMode` for either
 * would be exactly the fabricated probe result 10 §5.2 refuses. The caller turns the throw
 * into the named, fail-closed *"the runtime could not be established"* state, where the
 * distinction is one the caller has the context to draw.
 */
export async function openCompatSurface<D extends ChainDefinition>(
  provider: CompatProvider,
  descriptors: D,
): Promise<OpenCompatSurface<D>> {
  const client = createClient(provider);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    client.destroy();
  };
  try {
    const { compat } = await client.getTypedApi(descriptors).getStaticApis();
    return { compat, close };
  } catch (error) {
    close();
    throw error;
  }
}
