/**
 * The production caller of 10 §5.2's classifier — F26. The `chain-boot.ts` of the compat leg.
 *
 * `compat-session.ts` holds every rule; this file holds the three things a rule cannot
 * supply: the module that names PAPI, the committed descriptor sets, and the assignability
 * binding between what PAPI produces and what the probe reads.
 *
 * ## Both imports are dynamic, and both for a stated reason
 *
 * `@bleavit/chain-client/compat` names `polkadot-api`, so a static import would evaluate it
 * in every Node suite that imports `@bleavit/application` — `tests/screens` does, and that is
 * exactly the failure `chain-boot.ts` was written to avoid for the smoldot worker.
 *
 * `@polkadot-api/descriptors` is the larger cost: it carries every committed runtime's
 * metadata, which 10 §9.3 budgets as *bounded* release-shipped blobs and §9.4 weighs. A
 * static import would put all three chains' blobs in the entry chunk of every session,
 * including the ones that never reach a chain. So each set is fetched only when a runtime
 * is on-chain that needs it, and a session that never connects fetches none.
 *
 * ## The descriptor set is chosen by the chain, never by the caller
 *
 * 10 §5.1 commits descriptors **per `spec_version`**, and B16 makes a primary runtime's
 * paired terminal-recovery runtime a live-capable entry rather than an operator footnote —
 * recovery can become current under `OnlyInherents`, so a client that only ever loaded the
 * primary set would be stranded during exactly the incident recovery exists for. `runtimeFor`
 * resolves the role and this file maps the role to the artifact, so the two cannot disagree
 * about which set describes which chain.
 */

import type { RuntimeRole } from '@bleavit/descriptors';
import type { LightClient } from '@bleavit/chain-client/light-client';
import type { BundledChain, RuntimeVersionReport } from '@bleavit/chain-client';
// Type-only, therefore erased: naming this file's provider type loads no PAPI module.
// `CompatProvider` is PAPI's own `JsonRpcProvider` and deliberately **not** the wider
// `JsonRpcProviderLike` the read layer speaks — see `compat.ts` for why the two are not
// interchangeable in this direction.
import type { CompatProvider } from '@bleavit/chain-client/compat';
import {
  classifyAssetHub,
  classifyLocalRuntime,
  foreignIdentityVerdict,
  type CompatVerdict,
  type ForeignVerdict,
  type PulledSurface,
} from './compat-session.js';

/**
 * Pull a chain's compat surface, and assert it is the shape the probe reads.
 *
 * **This is the production assignability binding**, and it is the point of this function
 * existing at all rather than `openCompatSurface` being called inline. `probe.ts` records
 * the exposure it closes:
 *
 * > What that leaves unproven is that these shapes still match PAPI's — the same exposure
 * > `topology.ts` closes with an assignability binding in `light-client.ts`. There is no
 * > equivalent here yet, because nothing constructs a `TypedApi`.
 *
 * Something constructs one now, so the assertion is made where the value is produced:
 * `surface.compat` is PAPI's own `ChainCompatSurface<D>` and the annotated `CompatSurface`
 * return type is the probe's structural one, so if PAPI 2.x reshapes `compat` this stops
 * compiling. `tests/descriptors/types/papi-shapes.ts` proves the same relation for the type;
 * this proves it for the value, on the one path that has one — and being on that path is
 * what stops it being deleted as unused.
 *
 * There is no cast. A cast here would assert the relation instead of checking it, which is
 * the difference between a binding and a comment.
 */
async function pullBleavitSurface(
  provider: CompatProvider,
  role: RuntimeRole,
): Promise<PulledSurface> {
  const [{ openCompatSurface }, descriptors] = await Promise.all([
    import('@bleavit/chain-client/compat'),
    import('@polkadot-api/descriptors'),
  ]);
  // 10 §5.1's per-`spec_version` commitment, and B16's pair: recovery is a live-capable
  // entry, so the role decides the artifact and there is no arm that falls back to primary.
  const set = role === 'recovery' ? descriptors.bleavit_recovery : descriptors.bleavit;
  // `compat` is PAPI's `ChainCompatSurface<typeof set>`; the return type is the probe's
  // structural `CompatSurface`. Nothing is cast — see this function's header.
  return openCompatSurface(provider, set);
}

/** The same, for 02 §7.7's per-release foreign pin. */
async function pullAssetHubSurface(provider: CompatProvider): Promise<PulledSurface> {
  const [{ openCompatSurface }, descriptors] = await Promise.all([
    import('@bleavit/chain-client/compat'),
    import('@polkadot-api/descriptors'),
  ]);
  return openCompatSurface(provider, descriptors.assethub_paseo);
}

/**
 * Classify the runtime this client is connected to — 10 §5.2, the `CompatCheck` state.
 *
 * Takes the started `LightClient` rather than opening anything: the transport is already up
 * and already serving reads before this is called, which is `light-client.ts`'s ruling about
 * `createClient` expressed as an ordering the caller cannot get wrong.
 *
 * The runtime version comes from the transport's own follow subscription rather than from a
 * second call. `withRuntime` is already true, so this costs nothing and — more importantly —
 * it is the runtime of the **finalized** head the transport is pinning, which is the block
 * every transaction-critical read is taken at.
 */
export async function classifyChain(client: LightClient): Promise<CompatVerdict> {
  return classifyLocalRuntime({
    runtime: client.transport.finalizedRuntime(),
    pullFor: (role) => pullBleavitSurface(client.compatProvider(), role),
  });
}

/**
 * Classify Asset Hub — 02 §7.7; 11 §11.9.1's *"AH connection synced & descriptors compatible"*.
 *
 * **Every failure is a returned verdict and none is a throw**, which is 11 E17's rule
 * (*"blocked with diagnostics, never a blind send anyway"*) and 02 §7.7's (*"a withdraw is
 * unaffected"*) in one signature: this function is reachable only from the deposit leg, and a
 * verdict is all it can produce.
 *
 * The transient handle is **always** released, including when the probe throws. It is a
 * second smoldot chain handle beside the one the deposit reader holds (see
 * `AttachOptions.reuse`), and leaving it attached would leave a light client syncing that
 * nothing reads — the unreferenced-chain leak `detach()` exists to prevent, in the one path
 * where the obvious code does not reach the teardown.
 */
export async function classifyAssetHubFor(
  client: LightClient,
  assetHub: BundledChain,
  chainLabel: string,
  /**
   * The Asset Hub runtime, as the **reader's** connection reports it.
   *
   * Supplied by the deposit leg rather than read from the probe handle, which carries no
   * `ChainHeadConnection` of its own. That is the right source and not merely the available
   * one: it is the runtime of the finalized head the deposit preconditions are read at, so
   * the verdict and the reads describe the same block. `undefined` — no Asset Hub connection
   * open, or none that has reported a finalized block — yields `unsupported` with a named
   * reason rather than a guess, which is 02 §7.7's fail-closed direction.
   */
  runtime: RuntimeVersionReport | undefined,
): Promise<ForeignVerdict> {
  const handle = await client.assetHubCompatProvider(assetHub);
  if (handle.kind !== 'attached') {
    // `wrong-chain` carries the **observed** genesis and `unavailable` carries none, so the
    // one call reaches the terminal verdict for the first and the retryable one for the
    // second. Collapsing them here would report a different chain as *"could not be
    // reached"*, which invites a retry that can never succeed.
    return foreignIdentityVerdict(
      chainLabel,
      handle.kind === 'wrong-chain' ? handle.genesisHash : undefined,
    );
  }

  try {
    return await classifyAssetHub({
      chainLabel,
      genesisHash: handle.genesisHash,
      runtime,
      pull: () => pullAssetHubSurface(handle.provider),
    });
  } finally {
    handle.release();
  }
}
