/**
 * Running 10 §5.2's classifier — the caller `probeCriticalSurface` never had. F26.
 *
 * `packages/descriptors` has held the whole classifier since F4: `probeCriticalSurface`,
 * `classify`, `classifyForeign`, the three-mode lattice, the fail-closed coverage refusal.
 * Every one of them is a pure function, every one is tested, and **none of them ran**.
 * `probeCriticalSurface` was defined once and called zero times, because it takes a
 * `CompatSurface` and only PAPI's *typed* api produces one — and nothing in this client
 * constructed a typed api. The classifier that decides whether the app may sign had never
 * examined a runtime, for either chain.
 *
 * The consequence is worse than a missing feature, and `AGENTS.md` states it about the gate
 * that guards the *other* end of this: *"10 §5.2's classifier probes exactly the frozen set,
 * so an unfrozen read is one the compat lattice cannot fail on."* The freeze was enforced;
 * the consumer the freeze exists for had never run.
 *
 * ## Above the read layer, and that is the ruling this file is built around
 *
 * `light-client.ts` has always declined to construct `createClient`, because doing so *"would
 * place metadata compatibility underneath the read layer — the app would fail to construct a
 * client instead of booting into `ReadOnlyIncompatible` and telling the user why."* That
 * ruling is kept literally: nothing here is reachable from `ChainHeadConnection`, from
 * `FinalizedReader`, or from any read. The transport is already up and serving before this
 * module is called, and **every** failure below is a returned value:
 *
 *  - a runtime whose `spec_version` this release ships no descriptors for is
 *    `read-only-incompatible`, which is a boot state (10 §3.1) rather than an exception;
 *  - a runtime whose version could not be established at all, or whose compat surface could
 *    not be pulled, is `unestablished` — see {@link CompatVerdict} for why that is not one of
 *    the three modes.
 *
 * ## The probe is injected, exactly as `chain-boot.ts` injects `start`
 *
 * The one function that names PAPI lives in `@bleavit/chain-client/compat`, and importing it
 * here would pull `polkadot-api` into every Node suite that imports `@bleavit/application` —
 * `tests/screens` does. So the rules live here, the function arrives as an argument, and
 * `compat-boot.ts` is the single supply site. That is F18's shape, in the same package, for
 * the same reason.
 */

import {
  FOREIGN_CHAIN_PINS,
  SUPPORTED_SPEC_VERSIONS,
  classify,
  classifyForeign,
  depositMayProceed,
  probeCriticalSurface,
  probeForeignSurface,
  runtimeFor,
  type CompatClassification,
  type CompatSurface,
  type ForeignChainPin,
  type ForeignClassification,
  type RuntimeRole,
} from '@bleavit/descriptors';
import type { RuntimeVersionReport } from '@bleavit/chain-client';

/**
 * What this session was able to establish about a runtime.
 *
 * **`unestablished` is not a fourth compatibility mode.** 10 §3.2's lattice has exactly
 * three, and each is a claim *about the runtime*: `full` says every frozen surface was
 * checked and passed, `restricted` names the ones that did not, `read-only-incompatible`
 * says this release ships no descriptors for that `spec_version`. None of them is available
 * to a client that could not read the runtime version, or could not pull a compat surface at
 * all — synthesising `restricted` with every surface disabled would put *"this surface is
 * absent from this runtime"* on screen about surfaces nothing looked at, which is the exact
 * fabrication `classify`'s coverage refusal exists to prevent, one layer up.
 *
 * So it is a separate arm, and consumers fail closed on it: no surface is proven, nothing may
 * be signed. **10 §3.1 gives it no state**, which is a real gap in the boot machine rather
 * than something to invent UX for — a client that reached `CompatCheck` and could not
 * complete it has no edge to take. Recorded as a spec question rather than resolved here.
 */
export type CompatVerdict =
  | { readonly kind: 'classified'; readonly classification: CompatClassification }
  | { readonly kind: 'unestablished'; readonly reason: string };

/** The same distinction for the foreign verdict — 02 §7.7, §13 rule 8. Never merged. */
export type ForeignVerdict =
  | { readonly kind: 'classified'; readonly classification: ForeignClassification }
  | { readonly kind: 'unestablished'; readonly reason: string };

/** A pulled compat surface and the transient client behind it, which the caller closes. */
export interface PulledSurface {
  readonly compat: CompatSurface;
  close(): void;
}

/**
 * What classifying a chain costs: the runtime it reports, and a way to pull a surface.
 *
 * **`pullFor` takes a role, not a descriptor set**, and that keeps the whole seam free of
 * PAPI types. An earlier shape passed the descriptors through this module as an opaque
 * `unknown` and cast them back at the supply site — a cast that asserts the very relation
 * the type system was there to check. Selecting the artifact is the supply site's job
 * (`compat-boot.ts`), deciding *which role* is this module's, and neither has to know the
 * other's types for the two decisions to stay bound.
 */
export interface CompatProbeDeps {
  /**
   * The runtime at the transport's **finalized** head, or `undefined` if none is known.
   *
   * Supplied rather than read, because this module holds no transport: `ChainHeadConnection`
   * reports it off the follow subscription it already opened. `undefined` is a real answer
   * and produces `unestablished` — never a default `spec_version`, which would classify a
   * chain against a runtime nobody observed.
   */
  readonly runtime: RuntimeVersionReport | undefined;
  /** Pull the compat surface for a runtime role's committed descriptor set (10 §5.1, B16). */
  readonly pullFor: (role: RuntimeRole) => Promise<PulledSurface>;
  /** Which `spec_version`s this release ships descriptors for. Defaults to the release set. */
  readonly supported?: readonly number[];
}

function because(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Classify **this** chain's runtime — 10 §5.2, §3.2, INV-FE-12.
 *
 * Order is load-bearing and mirrors `classify`'s own: the `spec_version` decides first.
 *
 *  1. **No runtime reported ⇒ `unestablished`.** Nothing downstream may proceed on a guess.
 *  2. **Unsupported `spec_version` ⇒ `read-only-incompatible`, without probing.** Not an
 *     optimisation: 10 §5.1 commits descriptors *per `spec_version`*, so a runtime outside
 *     the set has no descriptor set to probe **with**, and probing it against the wrong one
 *     would produce a surface list describing a comparison that means nothing. `classify`
 *     already short-circuits on exactly this test; this is the same decision made one step
 *     earlier so the pull never happens.
 *  3. **Supported ⇒ pull the surface for that runtime's own descriptor set, and probe.**
 *     `probeCriticalSurface` reports an absent helper as `incompatible` rather than skipping
 *     it, and `classify` refuses a short probe list, so a surface nobody asked about cannot
 *     become a passing one.
 *
 * The transient client is closed on **every** path, including the one where `classify`
 * throws: a `ProbeCoverageError` is a defect in this release's own manifest, and leaking a
 * second `chainHead_v1_follow` while reporting it would add a resource leak to a bug report.
 */
export async function classifyLocalRuntime(deps: CompatProbeDeps): Promise<CompatVerdict> {
  const supported = deps.supported ?? SUPPORTED_SPEC_VERSIONS;
  const { runtime } = deps;
  if (runtime === undefined) {
    return {
      kind: 'unestablished',
      reason:
        'This client could not read which runtime the chain is on, so no surface has been ' +
        'checked. Nothing is treated as available and nothing can be signed (10 §5.2, INV-FE-12).',
    };
  }
  if (!supported.includes(runtime.specVersion)) {
    // The whole of the `read-only-incompatible` test, made without a probe — see above.
    return { kind: 'classified', classification: classify(runtime.specVersion, supported, []) };
  }

  const role = runtimeFor(runtime.specVersion)?.role;
  if (role === undefined) {
    return {
      kind: 'unestablished',
      reason:
        `Runtime ${runtime.specVersion} is listed as supported but names no descriptor set, ` +
        'so there is nothing to compare this release against (10 §5.1).',
    };
  }

  let surface: PulledSurface;
  try {
    surface = await deps.pullFor(role);
  } catch (error) {
    return {
      kind: 'unestablished',
      reason:
        `This client could not read runtime ${runtime.specVersion}'s metadata to check it ` +
        `against this release: ${because(error)}. Nothing is treated as available until it can.`,
    };
  }

  try {
    return {
      kind: 'classified',
      classification: classify(runtime.specVersion, supported, probeCriticalSurface(surface.compat)),
    };
  } finally {
    surface.close();
  }
}

export interface ForeignProbeDeps {
  /** Which pinned chain this is about. Matched against `FOREIGN_CHAIN_PINS` by label. */
  readonly chainLabel: string;
  /**
   * What the chain reported, never what the release pins.
   *
   * `undefined` means the chain was never reached — 11 E17's lazy Asset Hub that has not
   * synced. A `wrong-chain` leg carries the **observed** hash here, which is what lets
   * `classifyForeign` say *"a different chain, retrying will not change this"* instead of
   * reporting a permanent condition as a transient one.
   */
  readonly genesisHash: string | undefined;
  readonly runtime: RuntimeVersionReport | undefined;
  /** Pull the compat surface for this release's committed Asset Hub descriptor set (02 §7.7). */
  readonly pull: () => Promise<PulledSurface>;
  readonly pins?: readonly ForeignChainPin[];
}

/**
 * Classify Asset Hub — 02 §7.7, §13 rule 8; 11 §11.9.1's first precondition row.
 *
 * A **separate function returning a separate type**, because §13 rule 8 requires a foreign
 * verdict *"reported separately and never folded into the local one"*: nothing in Bleavit's
 * runtime can attest anything about Asset Hub, so a merged mode would let a healthy Bleavit
 * runtime vouch for a chain it cannot see.
 *
 * Identity is settled before compatibility, and `classifyForeign` does that itself — so an
 * unreachable or wrong chain is passed **through** it with an empty probe list rather than
 * short-circuited here. That matters: a wrong-chain verdict must come from the module that
 * owns the pin comparison, and this function must not be able to produce one of its own.
 * Probing happens only where a probe could mean something; {@link foreignIdentityVerdict} is
 * the same call for a caller that never got far enough to hold a probe.
 */
export function foreignIdentityVerdict(
  chainLabel: string,
  genesisHash: string | undefined,
  pins: readonly ForeignChainPin[] = FOREIGN_CHAIN_PINS,
): ForeignVerdict {
  return {
    kind: 'classified',
    classification: classifyForeign(
      { chainLabel, genesisHash, specVersion: undefined, probes: [] },
      pins,
    ),
  };
}

export async function classifyAssetHub(deps: ForeignProbeDeps): Promise<ForeignVerdict> {
  const observed = {
    chainLabel: deps.chainLabel,
    genesisHash: deps.genesisHash,
    specVersion: deps.runtime?.specVersion,
  };
  const pins = deps.pins ?? FOREIGN_CHAIN_PINS;

  // No chain reached, or a chain whose runtime we could not read: `classifyForeign` already
  // has the honest verdict for both (`unreachable` / `unsupported`) and reaches it without a
  // probe. Pulling a surface here would be pulling one from a chain we cannot name.
  if (deps.genesisHash === undefined || deps.runtime === undefined) {
    return { kind: 'classified', classification: classifyForeign({ ...observed, probes: [] }, pins) };
  }

  let surface: PulledSurface;
  try {
    surface = await deps.pull();
  } catch (error) {
    return {
      kind: 'unestablished',
      reason:
        `${deps.chainLabel} answered, but this client could not read its metadata to check ` +
        `the surfaces the deposit depends on: ${because(error)}. Deposits are unavailable; ` +
        'nothing else in the app is affected (02 §7.7).',
    };
  }

  try {
    const probes = probeForeignSurface(surface.compat);
    return { kind: 'classified', classification: classifyForeign({ ...observed, probes }, pins) };
  } finally {
    surface.close();
  }
}

/**
 * Whether the deposit leg's Asset Hub precondition holds — 11 §11.9.1 row 1.
 *
 * The value `readDepositInputs` has always required and nothing produced. `unestablished` is
 * `false` for the same reason an unprobed surface is not a passing one: not knowing is not a
 * weak yes.
 */
export function assetHubCompatible(verdict: ForeignVerdict): boolean {
  return verdict.kind === 'classified' && depositMayProceed(verdict.classification);
}

/** The sentence the deposit surface shows when the row does not hold. `undefined` when it does. */
export function assetHubBlockReason(verdict: ForeignVerdict): string | undefined {
  if (verdict.kind === 'unestablished') return verdict.reason;
  return verdict.classification.reason;
}

/**
 * Whether a read surface may be used, over a verdict rather than a classification.
 *
 * Exists so a caller never has to unwrap `CompatVerdict` itself: the unwrapping is where an
 * `unestablished` verdict would get an `?? true` and become the silent fallback INV-FE-12
 * forbids.
 */
export function verdictProvesSurface(verdict: CompatVerdict, id: string): boolean {
  return (
    verdict.kind === 'classified' &&
    verdict.classification.mode !== 'read-only-incompatible' &&
    verdict.classification.proven.includes(id)
  );
}

/** Whether signing is available at all — 10 §3.2's third column. */
export function verdictAllowsSigning(verdict: CompatVerdict): boolean {
  return verdict.kind === 'classified' && verdict.classification.mode === 'full';
}
