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
  ForeignProbeCoverageError,
  ProbeCoverageError,
  SUPPORTED_SPEC_VERSIONS,
  callIsProven,
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
  type SupportedRuntime,
} from '@bleavit/descriptors';
import type { RuntimeVersionReport } from '@bleavit/chain-client';

/** The committed descriptor-set name for a `spec_version` — 10 §5.1. A string-literal union. */
export type DescriptorKey = SupportedRuntime['descriptorKey'];

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
 * be signed.
 *
 * **SQ-1011 and SQ-1012 are ruled (2026-08-08), and the ruling ratified this shape rather
 * than replacing it.** 10 §3.1 now carries the state this arm had no edge for —
 * `CompatUnavailable`, non-terminal, retrying into `CompatCheck` on the `SyncDegraded`
 * backoff — under the new error code `FE-COMPAT-003`, and §3.2 says in as many words that its
 * table has three rows because the lattice has three modes and this outcome is not one of
 * them. The foreign half needed no contract change at all: 02 §7.7 already blocks the funding
 * flow on an *"unavailable **or unprobed**"* surface, so the distinction was frozen there
 * before 10 §5.2 had a name for it. `ForeignMode` therefore keeps five arms and `CompatMode`
 * three, and the two `unestablished` arms below stay where they are.
 */
export type CompatVerdict =
  | {
      readonly kind: 'classified';
      readonly classification: CompatClassification;
      /**
       * The `:code` hash of the runtime that was actually examined.
       *
       * `CompatClassification.specVersion` is a **label**, read from the transport before the
       * surface was pulled from a different connection; this is the identity of what the
       * probe walked. Carried so the two can be compared by anything downstream, and so a
       * record of a verdict names a runtime rather than a number.
       *
       * `undefined` **exactly** when no surface was pulled, which is the
       * `read-only-incompatible` short-circuit: this release ships no descriptors for that
       * `spec_version`, so there was nothing to examine it with and nothing was examined. It
       * is a fact about that arm rather than a missing value — every arm that probed has one.
       */
      readonly codeHash: string | undefined;
    }
  | {
      readonly kind: 'unestablished';
      /**
       * 10 §9.4's code for a verdict that could not be reached, added with the SQ-1011 /
       * SQ-1012 ruling. A literal type rather than a `string`, so a site that omits it or
       * writes another code does not compile — the code is a property of the arm, not a
       * convention each construction site is trusted to follow.
       */
      readonly code: 'FE-COMPAT-003';
      readonly reason: string;
    }
  | {
      /**
       * The boot never reached `CompatCheck`, so no probe was even attempted.
       *
       * **Distinct from `unestablished`, and the distinction is the error code (R-6 review,
       * 2026-08-08).** 10 §3.1 draws the only edge into `CompatUnavailable` from
       * `CompatCheck`, and that state's published recovery is *"retries into `CompatCheck`"*.
       * A release that pins no chain spec, or bundles no worker, satisfies neither: there is
       * nothing to retry, and the conditions are `FE-BOOT-001` / `FE-BOOT-002` /
       * `FE-BOOT-004`, which the **session** owns and this verdict does not. Stamping
       * `FE-COMPAT-003` on it would publish a recovery the client cannot perform, which is
       * the same shape of defect as a mode claimed about a runtime nothing read.
       *
       * So this arm carries **no code**. The reasons come from the session, and the caller
       * that has one should render those rather than anything from here.
       */
      readonly kind: 'not-attempted';
      readonly reason: string;
    };

/** The same distinction for the foreign verdict — 02 §7.7, §13 rule 8. Never merged. */
export type ForeignVerdict =
  | {
      readonly kind: 'classified';
      readonly classification: ForeignClassification;
      /** As {@link CompatVerdict}: the runtime examined, or `undefined` where none was. */
      readonly codeHash: string | undefined;
    }
  | {
      readonly kind: 'unestablished';
      /**
       * 10 §9.4's code for a verdict that could not be reached, added with the SQ-1011 /
       * SQ-1012 ruling. A literal type rather than a `string`, so a site that omits it or
       * writes another code does not compile — the code is a property of the arm, not a
       * convention each construction site is trusted to follow.
       */
      readonly code: 'FE-COMPAT-003';
      readonly reason: string;
    };

/** A pulled compat surface and the transient client behind it, which the caller closes. */
export interface PulledSurface {
  readonly compat: CompatSurface;
  /**
   * The `:code` hash of the runtime this surface describes — `StaticApis.id`.
   *
   * Carried so the verdict can name the runtime it examined. See {@link classifyLocalRuntime}
   * for why a `spec_version` alone is a label rather than a binding.
   */
  readonly codeHash: string;
  close(): void;
}

/**
 * What classifying a chain costs: the runtime it reports, and a way to pull a surface.
 *
 * **`pullFor` names an artifact, never carries one**, and that keeps the whole seam free of
 * PAPI types. An earlier shape passed the descriptors through this module as an opaque
 * `unknown` and cast them back at the supply site — a cast that asserts the very relation the
 * type system was there to check. Loading the artifact is the supply site's job
 * (`compat-boot.ts`); resolving *which* artifact from the `spec_version` is this module's, and
 * neither has to know the other's types for the two decisions to stay bound.
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
  /**
   * Pull the compat surface for a **`descriptorKey`** — 10 §5.1's committed per-`spec_version`
   * artifact name, resolved through `SUPPORTED_RUNTIMES`.
   *
   * Keyed by `descriptorKey` and not by `role`. The first version passed the role and the
   * supply site mapped `recovery → bleavit_recovery`, which is correct **only** because the
   * table happens to be one primary and one recovery: `descriptorKey` is the committed fact
   * 10 §5.1 makes per `spec_version`, `role` is a property of the *pair*, and a release
   * shipping two primaries would silently probe one runtime with the other's descriptors. It
   * is a string-literal union, so nothing about PAPI crosses this seam either way.
   */
  readonly pullFor: (descriptorKey: DescriptorKey, signal: AbortSignal) => Promise<PulledSurface>;
  /**
   * The transport's finalized runtime **now** — read again once the surface is in hand.
   *
   * This is the binding between the verdict's label and the runtime the verdict describes.
   * `runtime` above is read from the transport before the pull; the surface comes from a
   * *separate* client at *its* finalized head, and nothing connects the two. So a runtime
   * upgrade landing inside the examination window would produce a `full` verdict stamped with
   * the `spec_version` of a runtime that is no longer current — the same class of defect as a
   * stale `spec_version`, arriving from the other side. Any change, or an answer that can no
   * longer be established, is `unestablished`.
   */
  readonly runtimeNow: () => RuntimeVersionReport | undefined;
  /** Which `spec_version`s this release ships descriptors for. Defaults to the release set. */
  readonly supported?: readonly number[];
  /** How long a pull may take before it is abandoned. See {@link COMPAT_PULL_DEADLINE_MS}. */
  readonly deadlineMs?: number;
}

/**
 * How long a compat pull may take before the client stops waiting for it.
 *
 * A **UI** timeout, not a chain tunable: 10 §5.4's no-hardcode rule governs values the chain
 * publishes, and there is no `Params` key, no metadata constant and nowhere to read a
 * client-side deadline from. What makes it necessary is that the alternative is unbounded —
 * `getStaticApis` waits for its own client's first finalized block, so a chain that never
 * syncs leaves the promise pending for the life of the tab.
 *
 * Chosen against 10 §9.4's own budget rather than picked: the render row budgets first
 * meaningful paint in seconds, and this runs after it, so a deadline an order of magnitude
 * above a healthy pull is generous while still being a deadline.
 */
export const COMPAT_PULL_DEADLINE_MS = 30_000;

/**
 * A signal that aborts after `deadlineMs`.
 *
 * `AbortSignal.timeout` rather than a controller plus a `setTimeout`, because its timer does
 * not hold the event loop open and there is no clean-up path to forget. It is created **per
 * pull** and never reused: PAPI attaches its abort listener *after* subscribing, so an
 * already-spent signal never rejects, and a shared one would silently become that.
 */
function pullDeadline(deps: { readonly deadlineMs?: number }): AbortSignal {
  return AbortSignal.timeout(deps.deadlineMs ?? COMPAT_PULL_DEADLINE_MS);
}

/** Whether a rejection is PAPI's abort. Its `AbortError` is a plain `Error`, never a `DOMException`. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function because(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a probe failure is a defect in **this release**, and must stay loud.
 *
 * **The probe itself can fail, and it took a repro to see it.** PAPI defers compat
 * computation to *property access* — `compat[group][pallet][member]` is a proxy path — so
 * every failure `@polkadot-api/metadata-compatibility` can have on a runtime it cannot map
 * happens **inside** `probeCriticalSurface`/`probeForeignSurface`, not inside the pull. Both
 * probes originally sat in a bare `try { … } finally { close() }` with no `catch`, so an
 * unmappable runtime made `classifyAssetHub` reject and `openDepositLeg` reject with it — a
 * screen that never renders, which is the opposite of 11 E17's *"blocked with diagnostics
 * (never a blind send anyway)"* and of INV-FE-12's *"absence disables the dependent surface
 * with a named reason"*.
 *
 * The two coverage errors are the exception. They are not failures to *read a chain*: they
 * mean this release's own frozen surface list and its own probe disagree about how many
 * entries exist, which is a packaging defect in the artifact the client shipped. Turning that
 * into a polite *"deposits are unavailable"* would hide a broken release behind a message
 * about somebody else's network.
 */
function isReleaseManifestDefect(error: unknown): boolean {
  return error instanceof ProbeCoverageError || error instanceof ForeignProbeCoverageError;
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
      code: 'FE-COMPAT-003',
      reason:
        'This client could not read which runtime the chain is on, so no surface has been ' +
        'checked. Nothing is treated as available and nothing can be signed (10 §5.2, INV-FE-12).',
    };
  }
  if (!supported.includes(runtime.specVersion)) {
    // The whole of the `read-only-incompatible` test, made without a probe — see above.
    // No surface was pulled, so nothing was examined — see `CompatVerdict.codeHash`.
    return {
      kind: 'classified',
      classification: classify(runtime.specVersion, supported, []),
      codeHash: undefined,
    };
  }

  const descriptorKey = runtimeFor(runtime.specVersion)?.descriptorKey;
  if (descriptorKey === undefined) {
    return {
      kind: 'unestablished',
      code: 'FE-COMPAT-003',
      reason:
        `Runtime ${runtime.specVersion} is listed as supported but names no descriptor set, ` +
        'so there is nothing to compare this release against (10 §5.1).',
    };
  }

  let surface: PulledSurface;
  try {
    surface = await deps.pullFor(descriptorKey, pullDeadline(deps));
  } catch (error) {
    return {
      kind: 'unestablished',
      code: 'FE-COMPAT-003',
      reason: isAbort(error)
        ? `This client waited for runtime ${runtime.specVersion}'s metadata and gave up. ` +
          'Nothing is treated as available until it can be checked (10 §5.2).'
        : `This client could not read runtime ${runtime.specVersion}'s metadata to check it ` +
          `against this release: ${because(error)}. Nothing is treated as available until it can.`,
    };
  }

  try {
    const probes = probeCriticalSurface(surface.compat);
    const moved = runtimeMoved(runtime, deps.runtimeNow());
    if (moved !== undefined) {
      return {
        kind: 'unestablished',
        code: 'FE-COMPAT-003',
        reason:
          `The runtime changed while this client was checking it (${moved}), so this release ` +
          'cannot say which one it examined. Nothing is treated as available until the check ' +
          'is repeated (10 §5.2).',
      };
    }
    return {
      kind: 'classified',
      classification: classify(runtime.specVersion, supported, probes),
      codeHash: surface.codeHash,
    };
  } catch (error) {
    if (isReleaseManifestDefect(error)) throw error; // See `isReleaseManifestDefect`.
    return {
      kind: 'unestablished',
      code: 'FE-COMPAT-003',
      reason:
        `This client could not compare runtime ${runtime.specVersion} against this release: ` +
        `${because(error)}. Nothing is treated as available until it can.`,
    };
  } finally {
    surface.close();
  }
}

/**
 * How the runtime moved between the label and the examination, or `undefined`.
 *
 * Compares **every** version field, not just `spec_version`. A runtime can be replaced without
 * `spec_version` moving — `impl_version` and `transaction_version` are separate counters and
 * 02 §13 rule 7 is explicit that they are independent — so a `spec_version`-only comparison
 * would agree across exactly the swap it exists to notice. `spec_name` too: a chain answering
 * under a different name is not a version change at all.
 *
 * **Exported because it is also how a `CodeUpdated` is seen.** 10 §3.2 re-runs the classifier on
 * every `CodeUpdated`, and the observable a light client has for one is exactly this comparison at
 * the finalized head: `chainHead_v1_follow(withRuntime)` reports `newRuntime` on the block whose
 * runtime changed, and `ChainHeadConnection` promotes that reading into `finalizedRuntime()` once
 * the block finalizes. `compat-driver.ts` therefore watches this predicate rather than a decoded
 * `System.Events` entry: the event and the version report describe the same upgrade, and only the
 * version report is already finalized-only, already parsed, and already fail-closed on a
 * connection that has lost track of which runtime it is on.
 */
export function runtimeMoved(
  before: RuntimeVersionReport,
  after: RuntimeVersionReport | undefined,
): string | undefined {
  if (after === undefined) return 'the runtime can no longer be established';
  if (after.specName !== before.specName) return `spec_name ${before.specName} → ${after.specName}`;
  if (after.specVersion !== before.specVersion) {
    return `spec_version ${before.specVersion} → ${after.specVersion}`;
  }
  if (after.implVersion !== before.implVersion) {
    return `impl_version ${before.implVersion} → ${after.implVersion}`;
  }
  if (after.transactionVersion !== before.transactionVersion) {
    return `transaction_version ${before.transactionVersion} → ${after.transactionVersion}`;
  }
  return undefined;
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
  readonly pull: (signal: AbortSignal) => Promise<PulledSurface>;
  /** Asset Hub's finalized runtime **now** — see {@link CompatProbeDeps.runtimeNow}. */
  readonly runtimeNow: () => RuntimeVersionReport | undefined;
  readonly pins?: readonly ForeignChainPin[];
  /** How long a pull may take. See {@link COMPAT_PULL_DEADLINE_MS}. */
  readonly deadlineMs?: number;
}

/**
 * Classify Asset Hub — 02 §7.7, §13 rule 8; 11 §11.9.1's first precondition row.
 *
 * A **separate function returning a separate type**, because §13 rule 8 requires a foreign
 * verdict *"reported separately and never folded into the local one"*: nothing in Bleavit's
 * runtime can attest anything about Asset Hub, so a merged mode would let a healthy Bleavit
 * runtime vouch for a chain it cannot see.
 *
 * **Identity before compatibility, and *before the probe*.** The verdict itself still comes
 * from `classifyForeign` — a wrong-chain ruling must come from the module that owns the pin
 * comparison, and this function must not be able to produce one of its own — but the *probe*
 * is skipped for a chain whose genesis does not match the pin. The first version pulled a
 * compat surface from the wrong chain and then discarded the result, which contradicted this
 * paragraph while it was being read: `foreign.ts`'s ordering exists because *"a `spec_version`
 * verdict computed against the wrong chain describes a runtime this app was never talking
 * to"*, and computing one in order to throw it away still spends a connection, a metadata
 * fetch and a proxy walk on a chain the release has already refused. Production was saved
 * only by `classifyAssetHubFor` short-circuiting one layer up, which is a caller's habit
 * rather than this function's property.
 *
 * Probing therefore happens only where a probe could mean something; {@link
 * foreignIdentityVerdict} is the same decision for a caller that never got far enough to hold
 * a probe, and it reaches it through the same {@link identitySettles} rather than a copy — a
 * second copy of the pin comparison is a second place for the two to disagree.
 */
export function foreignIdentityVerdict(
  chainLabel: string,
  genesisHash: string | undefined,
  pins: readonly ForeignChainPin[] = FOREIGN_CHAIN_PINS,
): ForeignVerdict {
  const observed = { chainLabel, genesisHash, specVersion: undefined };
  return identitySettles(observed, pins) ?? runtimeUnread(chainLabel);
}

/**
 * The verdict identity alone settles, or `undefined` when it settles nothing.
 *
 * Three outcomes need no probe and no runtime, and `classifyForeign` owns all three: no pin
 * (`unreachable`), no chain reached (`unreachable`), and a genesis that is not the pinned one
 * (`wrong-chain`). Each is a claim the pin comparison can make on its own, so a surface pulled
 * here would be pulled from a chain this release has already refused or cannot name.
 *
 * Its converse is the whole point: a **pinned chain whose genesis matches** has passed
 * identity, so nothing about identity can decide the rest, and the caller must answer for what
 * it could or could not read. `undefined` is that hand-off.
 */
function identitySettles(
  observed: {
    readonly chainLabel: string;
    readonly genesisHash: string | undefined;
    readonly specVersion: number | undefined;
  },
  pins: readonly ForeignChainPin[],
): ForeignVerdict | undefined {
  const pin = pins.find((each) => each.label === observed.chainLabel);
  // An absent `genesisHash` cannot equal a pin's, so this one test covers all three cases —
  // and covers them in the direction that matters, since what it must not admit is a chain
  // that never proved its identity.
  if (pin !== undefined && observed.genesisHash === pin.genesisHash) return undefined;
  return {
    kind: 'classified',
    classification: classifyForeign({ ...observed, probes: [] }, pins),
    codeHash: undefined,
  };
}

/**
 * The pinned chain answered, its genesis matched, and its runtime could not be read.
 *
 * **This is `FE-COMPAT-003` and not `unsupported`, and the difference is the recovery the user
 * is sent to** (10 §5.2; §9.4's code row; second-round review, 2026-08-09). `unsupported` names
 * a version — it says *this release ships no descriptors for the runtime that answered, so load
 * a newer release* — and a client that read no version has named nothing. 10 §5.2 rules exactly
 * this case: such a client *"has established nothing about the chain in front of it"*, the
 * outcome *"belongs one layer up"*, and it enters *"neither the three-mode union"* nor *"the
 * foreign arms"*. §9.4 raises the code *"on either chain: the runtime version could not be
 * read, or no compat surface could be pulled"* — both chains, both conditions.
 *
 * It is reachable rather than theoretical. `ChainHeadConnection.finalizedRuntime()` answers
 * `undefined` for a chain that is answering — a follow that has not initialized, a runtime
 * reported `invalid`, or dropped announcements that make the held reading uncertain — and the
 * deposit leg hands that reading straight to `classifyAssetHub`. Telling that user to load a
 * newer release is advice no release can satisfy; the truthful answer is that the probe did not
 * complete, which is the retry 10 §3.1 already schedules.
 */
function runtimeUnread(chainLabel: string): ForeignVerdict {
  return {
    kind: 'unestablished',
    code: 'FE-COMPAT-003',
    reason:
      `${chainLabel} answered and is the chain this release pins, but this client could not ` +
      'read which runtime it is on, so none of the surfaces the deposit depends on has been ' +
      'checked. Deposits are unavailable until the check completes; nothing else in the app ' +
      'is affected (02 §7.7).',
  };
}

export async function classifyAssetHub(deps: ForeignProbeDeps): Promise<ForeignVerdict> {
  const observed = {
    chainLabel: deps.chainLabel,
    genesisHash: deps.genesisHash,
    specVersion: deps.runtime?.specVersion,
  };
  const pins = deps.pins ?? FOREIGN_CHAIN_PINS;

  // Identity first, exactly as `foreign.ts` orders it. What identity cannot settle falls
  // through, and the first thing below it is the runtime reading — see `runtimeUnread` for why
  // an unread one is a code rather than a mode.
  const settled = identitySettles(observed, pins);
  if (settled !== undefined) return settled;
  if (deps.runtime === undefined) return runtimeUnread(deps.chainLabel);

  let surface: PulledSurface;
  try {
    surface = await deps.pull(pullDeadline(deps));
  } catch (error) {
    return {
      kind: 'unestablished',
      code: 'FE-COMPAT-003',
      reason: isAbort(error)
        ? `${deps.chainLabel} answered, but this client waited for its metadata and gave up. ` +
          'Deposits are unavailable; nothing else in the app is affected (02 §7.7).'
        : `${deps.chainLabel} answered, but this client could not read its metadata to check ` +
          `the surfaces the deposit depends on: ${because(error)}. Deposits are unavailable; ` +
          'nothing else in the app is affected (02 §7.7).',
    };
  }

  try {
    const probes = probeForeignSurface(surface.compat);
    const moved = runtimeMoved(deps.runtime, deps.runtimeNow());
    if (moved !== undefined) {
      return {
        kind: 'unestablished',
        code: 'FE-COMPAT-003',
        reason:
          `${deps.chainLabel}'s runtime changed while this client was checking it (${moved}), ` +
          'so this release cannot say which one it examined. Deposits are unavailable until ' +
          'the check is repeated; nothing else in the app is affected (02 §7.7).',
      };
    }
    return {
      kind: 'classified',
      classification: classifyForeign({ ...observed, probes }, pins),
      codeHash: surface.codeHash,
    };
  } catch (error) {
    if (isReleaseManifestDefect(error)) throw error; // See `isReleaseManifestDefect`.
    return {
      kind: 'unestablished',
      code: 'FE-COMPAT-003',
      reason:
        `${deps.chainLabel} answered, but this client could not compare its surfaces against ` +
        `this release: ${because(error)}. Deposits are unavailable; nothing else in the app ` +
        'is affected (02 §7.7).',
    };
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

/**
 * Whether signing is available at all — 10 §3.2's third column.
 *
 * **Delegates to `callIsProven` rather than restating its rule.** The first version tested
 * `mode === 'full'` here, which is *today's* answer only because SQ-577 leaves
 * `CRITICAL_SURFACE` with no `call` entries, so `callIsProven` has nothing to prove and
 * fail-closes to exactly that condition. Writing it out made two copies of one closed-set
 * decision, and the copy that would not move is this one: when SQ-577 lands and per-surface
 * signing becomes real, `callIsProven` starts answering per call in `restricted` mode and a
 * hardcoded `mode === 'full'` would silently keep the whole of `restricted` unsignable.
 *
 * The call name is `undefined` on purpose: this asks *"is any call provable?"*, which is the
 * question a global signing affordance asks. A per-call gate passes its own name.
 */
export function verdictAllowsSigning(verdict: CompatVerdict, call = '*'): boolean {
  return verdict.kind === 'classified' && callIsProven(verdict.classification, call);
}
