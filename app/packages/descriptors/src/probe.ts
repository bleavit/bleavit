/**
 * The PAPI compatibility probe — 10 §5.2; FE-P1 (resolved, V-87).
 *
 * 10 §5.2 left the exact API as **[VERIFY exact PAPI 2.x names/semantics — FE-P1]**.
 * Answered from the lockfile-pinned tree; the four facts that shape this module:
 *
 *  1. The surface is `(await api.getStaticApis()).compat[group][pallet][member]`, reached
 *     through the **typed** api. There is no `getCompatibilityToken()` — that was 1.x.
 *  2. `compat` exists only when `Safe extends true`, i.e. on `getTypedApi(descriptors)`.
 *     `getUnsafeApi()` types it as `unknown`, and its own docstring says it "does not
 *     provide any runtime compatibility checks protection".
 *  3. `isCompatible(from = CompatibilityLevel.BackwardsCompatible)` — the **default
 *     threshold is `BackwardsCompatible`**, so `Partial` reports `false`. This module
 *     calls it with no argument, deliberately: the threshold belongs to PAPI, and a
 *     locally-chosen one would be a second opinion about safety with no basis.
 *  4. A surface absent from the runtime yields the `inOutIncompat` singleton —
 *     `Incompatible`, `isCompatible: () => false`. Absence is therefore *detectable* and
 *     fails closed, which is what INV-FE-12 requires and what the classifier relies on.
 *
 * The trap worth naming: with no descriptors at all, PAPI's helper reports the value side
 * as `identical`. That reads as "fully compatible" while nothing was compared. So probing
 * MUST go through a descriptor-bearing typed api, and this module's entry point takes the
 * compat object rather than a client, so a caller cannot hand it an unsafe api by accident
 * — `getUnsafeApi()` has no `compat` member to pass.
 *
 * **Structural types, and what that does and does not buy.** This module names no PAPI
 * type, so `descriptors` stays free of the chain SDK and the probe is exercisable without
 * one. What that leaves unproven is that these shapes still match PAPI's — the same
 * exposure `topology.ts` closes with an assignability binding in `light-client.ts`. There
 * is no equivalent here yet, because nothing constructs a `TypedApi` until F6 wires
 * `createClient`. What *is* pinned now, executably, is the numeric `CompatibilityLevel`
 * mapping: the suite imports PAPI's real enum and asserts this ordering against it,
 * because the ordering is what `isCompatible` compares and a renumbering would silently
 * turn `Partial` into a pass.
 */

import type { CompatibilityLevel, SurfaceProbe } from './compat.js';
import { CRITICAL_SURFACE, type CriticalSurfaceEntry } from './critical-surface.js';

/** PAPI's `CompatHelper`, structurally. */
export interface CompatHelperLike {
  readonly level: number;
  isCompatible(from?: number): boolean;
}

function isArgsValue(helper: AnyCompatHelper): helper is ArgsValueCompatHelperLike {
  return 'args' in helper && 'value' in helper;
}

/**
 * The level to report for a helper.
 *
 * Storage, runtime APIs and view fns carry an `args` and a `value` side and **no top-level
 * `level`** — PAPI computes their `isCompatible` as `min(args.level, value.level)`. Taking
 * the same minimum here keeps the reported level and the reported verdict about the same
 * thing; reading a missing top-level `level` would yield `undefined`, which names as
 * `incompatible` and would contradict a `true` verdict beside it.
 */
function levelOf(helper: AnyCompatHelper): number {
  return isArgsValue(helper) ? Math.min(helper.args.level, helper.value.level) : helper.level;
}

/** PAPI's `ArgsValueCompatHelper` — storage, runtime APIs and view fns carry both sides. */
export interface ArgsValueCompatHelperLike {
  readonly args: CompatHelperLike;
  readonly value: CompatHelperLike;
  isCompatible(from?: number): boolean;
}

export type AnyCompatHelper = CompatHelperLike | ArgsValueCompatHelperLike;

/** `(await api.getStaticApis()).compat`, structurally. */
export interface CompatSurface {
  readonly apis: Record<string, Record<string, AnyCompatHelper>>;
  readonly query: Record<string, Record<string, AnyCompatHelper>>;
  readonly constants: Record<string, Record<string, AnyCompatHelper>>;
  readonly event: Record<string, Record<string, AnyCompatHelper>>;
}

/**
 * PAPI's numeric `CompatibilityLevel`, named.
 *
 * The mapping is pinned by a test against the real enum rather than trusted, because the
 * ordering is what `isCompatible` compares against and a silently renumbered enum would
 * turn `Partial` into a pass.
 */
export const COMPATIBILITY_LEVELS: readonly CompatibilityLevel[] = [
  'incompatible',
  'partial',
  'backwards-compatible',
  'identical',
];

export function levelName(level: number): CompatibilityLevel {
  return COMPATIBILITY_LEVELS[level] ?? 'incompatible';
}

function helperFor(compat: CompatSurface, entry: CriticalSurfaceEntry): AnyCompatHelper | undefined {
  const group = compat[entry.compatGroup] as Record<string, Record<string, AnyCompatHelper>> | undefined;
  return group?.[entry.pallet]?.[entry.member];
}

/**
 * Probe every `CRITICAL_SURFACE` entry.
 *
 * A helper this cannot even look up is reported `incompatible`, not skipped. Skipping
 * would hand the classifier a short list, and the classifier refuses a short list — but
 * only if it is short. A silently-dropped entry that reappeared as "not required" would be
 * the same defect one layer up.
 */
export function probeCriticalSurface(
  compat: CompatSurface,
  surface: readonly CriticalSurfaceEntry[] = CRITICAL_SURFACE,
): readonly SurfaceProbe[] {
  return surface.map((entry) => {
    const helper = helperFor(compat, entry);
    if (helper === undefined) {
      return { id: entry.id, compatible: false, level: 'incompatible' as const };
    }
    return {
      id: entry.id,
      // No threshold argument: PAPI's default is `BackwardsCompatible`, so `Partial`
      // is not a pass, and choosing our own would be a second opinion about safety.
      compatible: helper.isCompatible(),
      level: levelName(levelOf(helper)),
    };
  });
}
