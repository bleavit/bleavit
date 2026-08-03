/**
 * The runtime-compatibility classifier — 10 §5.2, §3.2, §5.3; INV-FE-12.
 *
 * A pure function over probe results. It holds no client, performs no read, and knows
 * nothing about PAPI: the adapter that asks a live runtime lives in `chain-client`, which
 * is the only package permitted to touch the chain SDK. That split is not tidiness. The
 * classifier decides whether the app may sign, so it is exactly the thing that must be
 * exercisable against every combination of probe outcomes — including the ones a healthy
 * chain never produces — without a chain to produce them.
 *
 * **The lattice, from 10 §3.2's table:**
 *
 * | mode | reached at boot as | signing |
 * |---|---|---|
 * | `full` | `Ready` | enabled |
 * | `restricted` | `ReadyRestricted` | **per-surface** |
 * | `read-only-incompatible` | `ReadOnlyIncompatible` | disabled |
 *
 * Two rules that are easy to get backwards:
 *
 * - **`read-only-incompatible` is about the `spec_version`, not about how much broke.**
 *   10 §3.1 draws the edge as *"spec_version unsupported"* and §3.2 as *"uncovered upgrade
 *   enacted"*. A covered runtime with half its surface missing is `restricted` with named
 *   disabled surfaces — the app boots, reads what it can and says what it cannot do.
 *   Collapsing "lots of failures" into `read-only-incompatible` would take the app offline
 *   for a partial upgrade it could have survived.
 * - **A partial probe is not a pass.** PAPI's `isCompatible()` defaults its threshold to
 *   `BackwardsCompatible`, so `Partial` reports `false` (V-87). This module takes the
 *   boolean the probe already computed rather than re-deriving one, precisely so the
 *   threshold lives in one place — but it records the level too, because a `Partial`
 *   surface and an absent one need different copy for the user.
 */

import { CRITICAL_SURFACE, type CriticalSurfaceEntry } from './critical-surface.js';

/** 10 §3.2's three modes. */
export type CompatMode = 'full' | 'restricted' | 'read-only-incompatible';

/**
 * PAPI's `CompatibilityLevel`, mirrored as a string union.
 *
 * Mirrored rather than imported so this package does not depend on the chain SDK. The
 * adapter in `chain-client` maps the numeric enum onto these names, and a test pins the
 * mapping against the real enum so the mirror cannot drift silently (V-87).
 */
export type CompatibilityLevel = 'incompatible' | 'partial' | 'backwards-compatible' | 'identical';

export interface SurfaceProbe {
  readonly id: string;
  /** What the probe concluded. `false` for absent, and for `partial` at the default threshold. */
  readonly compatible: boolean;
  readonly level: CompatibilityLevel;
}

export interface DisabledSurface {
  readonly id: string;
  readonly level: CompatibilityLevel;
  /** User-facing cause, distinguishing "the runtime no longer has this" from "it changed shape". */
  readonly reason: string;
}

export interface CompatClassification {
  readonly mode: CompatMode;
  readonly specVersion: number;
  /** Named disabled surfaces — 10 §3.1: restricted mode names them rather than failing lazily. */
  readonly disabled: readonly DisabledSurface[];
  /** Ids that passed. Signing gates read this, never the absence of a disabled entry. */
  readonly proven: readonly string[];
}

export class ProbeCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeCoverageError';
  }
}

function reasonFor(entry: CriticalSurfaceEntry, level: CompatibilityLevel): string {
  const where = `${entry.pallet}.${entry.member}`;
  if (level === 'incompatible') {
    return `${where} is absent from this runtime, or its shape is no longer readable (${entry.citation}).`;
  }
  return `${where} changed shape in a way this release cannot decode safely (${entry.citation}).`;
}

/**
 * Classify a runtime.
 *
 * `supportedSpecVersions` is the set this release ships descriptors for. It is the whole
 * of the `read-only-incompatible` test: 10 §5.1 makes descriptors a per-`spec_version`
 * commitment, and a runtime outside that set cannot be decoded at all, which is why the
 * only surface `ReadOnlyIncompatible` renders is the fixed-layout `ReleaseChannel` pointer
 * (§5.3) — readable *without* current metadata by design.
 *
 * **Every entry of `CRITICAL_SURFACE` must have a probe.** A missing probe is refused
 * rather than treated as a pass: a classifier that silently ignored the surfaces nobody
 * asked about would report `full` for a runtime it never examined, which is the failure
 * INV-FE-12 exists to prevent and the exact shape of F2's whitelist defect — a check that
 * passes by shrinking.
 */
export function classify(
  specVersion: number,
  supportedSpecVersions: readonly number[],
  probes: readonly SurfaceProbe[],
  surface: readonly CriticalSurfaceEntry[] = CRITICAL_SURFACE,
): CompatClassification {
  if (!supportedSpecVersions.includes(specVersion)) {
    return { mode: 'read-only-incompatible', specVersion, disabled: [], proven: [] };
  }

  const byId = new Map(probes.map((p) => [p.id, p]));
  const missing = surface.filter((entry) => !byId.has(entry.id)).map((entry) => entry.id);
  if (missing.length > 0) {
    throw new ProbeCoverageError(
      `${missing.length} of ${surface.length} CRITICAL_SURFACE entries were never probed ` +
        `(first: ${missing[0]}). An unprobed surface is not a passing one.`,
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

  return {
    mode: disabled.length === 0 ? 'full' : 'restricted',
    specVersion,
    disabled,
    proven,
  };
}

/** Whether a read surface may be used. Reads the proven set, never the absence of a failure. */
export function surfaceIsProven(classification: CompatClassification, id: string): boolean {
  return classification.mode !== 'read-only-incompatible' && classification.proven.includes(id);
}

/**
 * Whether a **call** may be signed — 10 §3.2's per-surface signing in `restricted` mode.
 *
 * Currently `false` for every call in every mode but `full`, and that is a fail-closed
 * placeholder rather than a design: `tools/release/surface-manifest.json` carries no
 * `call` entries, because doc 02 freezes the read contract and has no extrinsic section,
 * while 10 §5.2 names calls as part of `CRITICAL_SURFACE` and §3.2 makes the per-surface
 * signing unit exactly the call (**SQ-574**). Until the manifest gains them there is
 * nothing to probe, and INV-FE-12 is explicit about what to do with an unproven
 * capability: it is *absent*, and absence disables the dependent surface with a named
 * reason. The alternative — permitting every call in `restricted` mode because none is
 * known to be broken — would sign against a runtime whose call surface was never checked.
 */
export function callIsProven(classification: CompatClassification, _call: string): boolean {
  return classification.mode === 'full';
}

/** The named reason a call is unavailable, for the surface that has to say so. */
export function callUnavailableReason(
  classification: CompatClassification,
  call: string,
): string | undefined {
  if (classification.mode === 'full') return undefined;
  if (classification.mode === 'read-only-incompatible') {
    return `This release has no descriptors for runtime ${classification.specVersion}; signing is disabled until a newer release is loaded (10 §5.3).`;
  }
  return (
    `${call} cannot be signed in restricted mode: this release cannot yet prove a call's ` +
    'compatibility, because the frozen contract does not enumerate calls (SQ-574). An ' +
    'unproven capability is treated as absent (INV-FE-12).'
  );
}
