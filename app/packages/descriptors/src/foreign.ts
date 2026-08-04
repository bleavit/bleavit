/**
 * Foreign-chain compatibility — 02 §7.7, §13 rule 8; 10 §5.2; 11 §11.9.1 (SQ-587).
 *
 * Every other surface this package classifies lives in **Bleavit's** metadata. The deposit
 * leg does not: 11 §11.9.1 opens a second light-client connection to **Asset Hub**, reads
 * the user's USDC there and submits an AH-side reserve transfer. 02 §7.7 freezes those
 * three surfaces; this module is the verdict on them.
 *
 * **The verdict is separate, and keeping it separate is the whole point.** §13 rule 8 is
 * explicit that a foreign surface is *"reported separately and never folded into the local
 * one"*. The reason is not tidiness: `INTEGRATION_CONTRACT_VERSION` is a Bleavit runtime
 * constant, so nothing in the local verdict can attest anything about Asset Hub, and a
 * merged `mode` would let a healthy Bleavit runtime vouch for a foreign chain it cannot
 * see. So the two verdicts are different **types**, and neither is assignable to the
 * other's functions — `ForeignMode` carries `wrong-chain`/`unreachable`, which `CompatMode`
 * does not, and `CompatMode` carries `read-only-incompatible`, which this does not. That
 * mutual non-assignability is asserted by the suite rather than left to coincidence.
 *
 * **A genesis mismatch is `wrong-chain`, not `unsupported`, and the distinction is the same
 * one `packages/verify` draws for the release identity.** An unsupported `spec_version` is
 * *this* chain further along — the pin is right and the release is behind. A different
 * genesis is a *different chain*, where every balance rendered belongs to someone else. The
 * first is a compatibility state a user can wait out; the second is never recoverable by
 * retrying, so it does not share a mode with it.
 *
 * **Fail-closed twice over.** An unprobed surface is refused rather than counted as passing
 * (the same rule `classify` enforces, and for the same reason — a check that passes by
 * shrinking). And with **no pin at all** the verdict is `unreachable`: 02 §7.7's surfaces
 * are frozen, but this release ships no Asset Hub artifacts yet, and R-2 forbids inventing
 * a genesis hash to make the path look complete. `FOREIGN_CHAIN_PINS` is therefore
 * deliberately empty and the deposit leg is deliberately blocked — see the constant's own
 * note for what has to arrive before it can be filled.
 */

import type { CompatibilityLevel, DisabledSurface, SurfaceProbe } from './compat.js';

/**
 * The frozen 02 §7.7 surfaces, by the id a probe reports.
 *
 * Ids are chain-scoped (`assethub.`) so a foreign id can never collide with a
 * `CRITICAL_SURFACE` id and be mistaken for a local one in a log, a probe map, or a
 * user-facing reason string.
 */
export const FOREIGN_SURFACE = [
  {
    id: 'assethub.Assets.Account',
    kind: 'storage',
    citation: '02 §7.7; 11 §11.9.1 — "AH USDC balance ≥ amount + AH-side fees"',
  },
  {
    id: 'assethub.System.Account',
    kind: 'storage',
    citation: '02 §7.7; 11 §11.9.1 — AH-side existential and fee viability',
  },
  {
    id: 'assethub.PolkadotXcm.limited_reserve_transfer_assets',
    kind: 'call',
    citation: '02 §7.7; 11 §11.9.1 — the deposit leg',
  },
] as const satisfies readonly ForeignSurfaceEntry[];

export interface ForeignSurfaceEntry {
  readonly id: string;
  readonly kind: 'storage' | 'call';
  readonly citation: string;
}

/**
 * What a release pins about a foreign chain — 02 §7.7 / §13 rule 8.
 *
 * All three fields are required and none is defaulted. A pin missing its genesis hash
 * cannot answer the `wrong-chain` question, and a pin that could not answer it would make
 * the one terminal verdict unreachable.
 */
export interface ForeignChainPin {
  /** Stable label used in user-facing copy, e.g. `Asset Hub`. */
  readonly label: string;
  /** The chain this release was built against. Compared before anything else. */
  readonly genesisHash: string;
  /** The `spec_version`s this release ships descriptors for (10 §5.1). */
  readonly supportedSpecVersions: readonly number[];
}

/**
 * The pinned foreign chains of this release — **deliberately empty**.
 *
 * 02 §7.7 freezes the surfaces; it does not conjure the artifacts. Filling this needs the
 * pinned Asset Hub runtime wasm put through `tools/release/`'s extraction, exactly as the
 * Bleavit feed is — 10 §5.1 requires descriptors be generated from built runtime artifacts
 * and **never** from a live node, so fetching the genesis hash from a public RPC to make
 * this array non-empty would be the discipline F2 exists to prevent, dressed as progress.
 * Two `[VERIFY]` tags ride the same wait (02 §7.7's asset index and the exact AH extrinsic).
 *
 * Empty is a *state*, not an absence: `classifyForeign` returns `unreachable` for a chain
 * with no pin, which blocks the deposit leg with a named reason and leaves every other
 * surface of the app untouched.
 */
export const FOREIGN_CHAIN_PINS: readonly ForeignChainPin[] = [];

export type ForeignMode =
  /** Pinned chain, supported runtime, every §7.7 surface proven. */
  | 'full'
  /** Pinned chain, supported runtime, at least one surface disabled. */
  | 'restricted'
  /** Right chain, runtime outside this release's descriptor set (10 §5.1). */
  | 'unsupported'
  /** Genesis hash ≠ the pin. A different chain. Terminal — never retry into it. */
  | 'wrong-chain'
  /** No pin, or no connection. The lazy AH chain of 11 E17 that never synced. */
  | 'unreachable';

export interface ForeignClassification {
  /** Discriminant. Present so a merged verdict is a type error, not a silent widening. */
  readonly domain: 'foreign';
  readonly chain: string;
  readonly mode: ForeignMode;
  readonly specVersion: number | undefined;
  readonly disabled: readonly DisabledSurface[];
  readonly proven: readonly string[];
  /** Why the deposit leg is blocked, when it is. `undefined` exactly when mode is `full`. */
  readonly reason: string | undefined;
}

export class ForeignProbeCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForeignProbeCoverageError';
  }
}

export interface ForeignObservation {
  readonly chainLabel: string;
  /** `undefined` when the chain was never reached — not an empty string, which is a value. */
  readonly genesisHash: string | undefined;
  readonly specVersion: number | undefined;
  readonly probes: readonly SurfaceProbe[];
}

function reasonFor(entry: ForeignSurfaceEntry, level: CompatibilityLevel): string {
  if (level === 'incompatible') {
    return `${entry.id} is absent from this Asset Hub runtime, or its shape is no longer readable (${entry.citation}).`;
  }
  return `${entry.id} changed shape in a way this release cannot decode safely (${entry.citation}).`;
}

/**
 * Classify a foreign chain against this release's pin.
 *
 * Order is load-bearing and mirrors `packages/verify`'s: **identity before compatibility**.
 * A `spec_version` verdict computed against the wrong chain describes a runtime this app
 * was never talking to, so the genesis comparison runs first and short-circuits.
 */
export function classifyForeign(
  observation: ForeignObservation,
  pins: readonly ForeignChainPin[] = FOREIGN_CHAIN_PINS,
  surface: readonly ForeignSurfaceEntry[] = FOREIGN_SURFACE,
): ForeignClassification {
  const base = {
    domain: 'foreign',
    chain: observation.chainLabel,
    disabled: [],
    proven: [],
  } as const;

  const pin = pins.find((p) => p.label === observation.chainLabel);
  if (pin === undefined) {
    return {
      ...base,
      mode: 'unreachable',
      specVersion: observation.specVersion,
      reason:
        `This release pins no ${observation.chainLabel} runtime, so nothing here can be ` +
        'verified against it. Deposits are unavailable; every other part of the app is ' +
        'unaffected (02 §7.7).',
    };
  }

  if (observation.genesisHash === undefined) {
    return {
      ...base,
      mode: 'unreachable',
      specVersion: observation.specVersion,
      reason: `${pin.label} could not be reached, so its surfaces were never checked. Deposits are unavailable until it syncs (11 §11.9.1, E17).`,
    };
  }

  if (observation.genesisHash !== pin.genesisHash) {
    return {
      ...base,
      mode: 'wrong-chain',
      specVersion: observation.specVersion,
      reason:
        `The chain answering as ${pin.label} has genesis ${observation.genesisHash}, and ` +
        `this release pins ${pin.genesisHash}. That is a different chain, not an older or ` +
        'newer runtime — no balance it reports describes your account here. Deposits are ' +
        'disabled and retrying will not change this.',
    };
  }

  if (observation.specVersion === undefined || !pin.supportedSpecVersions.includes(observation.specVersion)) {
    return {
      ...base,
      mode: 'unsupported',
      specVersion: observation.specVersion,
      reason:
        `This release ships no ${pin.label} descriptors for runtime ` +
        `${observation.specVersion ?? 'unknown'}; deposits are unavailable until a newer ` +
        'release is loaded (10 §5.1).',
    };
  }

  const byId = new Map(observation.probes.map((p) => [p.id, p]));
  const missing = surface.filter((entry) => !byId.has(entry.id)).map((entry) => entry.id);
  if (missing.length > 0) {
    throw new ForeignProbeCoverageError(
      `${missing.length} of ${surface.length} frozen ${pin.label} surfaces were never probed ` +
        `(first: ${missing[0]}). An unprobed surface is not a passing one (02 §7.7).`,
    );
  }

  const disabled: DisabledSurface[] = [];
  const proven: string[] = [];
  for (const entry of surface) {
    const probe = byId.get(entry.id);
    if (probe === undefined) continue; // unreachable; the coverage check above threw.
    if (probe.compatible) proven.push(entry.id);
    else disabled.push({ id: entry.id, level: probe.level, reason: reasonFor(entry, probe.level) });
  }

  if (disabled.length === 0) {
    return { ...base, mode: 'full', specVersion: observation.specVersion, disabled, proven, reason: undefined };
  }
  return {
    ...base,
    mode: 'restricted',
    specVersion: observation.specVersion,
    disabled,
    proven,
    reason:
      `${disabled.length} of ${surface.length} ${pin.label} surfaces this release depends on ` +
      `could not be verified: ${disabled.map((d) => d.id).join(', ')}. Deposits are disabled ` +
      '(02 §7.7 fails closed on an unverified surface).',
  };
}

/**
 * Whether the deposit leg may proceed — 11 §11.9.1.
 *
 * Requires **every** frozen surface, not merely the call: the two reads are what the
 * precondition rows are evaluated against, and a deposit constructed without them would be
 * one whose preconditions were never actually checked. 11 E17 is explicit that an
 * unavailable AH connection blocks the flow *"with diagnostics (never a blind 'send
 * anyway')"*, which is what `reason` carries.
 */
export function depositMayProceed(classification: ForeignClassification): boolean {
  return classification.mode === 'full';
}

/**
 * Whether the **withdraw** leg is affected — 11 §11.9.2. It never is.
 *
 * Stated as a function with a body of `false` rather than left implicit, because the
 * tempting shape is one `funding` verdict covering both legs, and that would take withdraw
 * offline whenever Asset Hub could not be reached. Withdraw is a *local* `pallet_xcm` call
 * over 02 §7.4 reads: it needs the local verdict and nothing from this module. 02 §7.7 says
 * so in as many words, and the suite asserts this returns `false` for every mode — an
 * assertion that exists to fail if someone later "fixes" it into a shared gate.
 */
export function withdrawIsBlockedBy(_classification: ForeignClassification): boolean {
  return false;
}
