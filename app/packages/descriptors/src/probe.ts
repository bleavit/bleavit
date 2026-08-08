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
 *  4. A surface absent from the runtime yields a shared **`Incompatible`** helper, so absence
 *     is *detectable* and fails closed — what INV-FE-12 requires and what the classifier
 *     relies on. Which helper depends on the group, and the first version of this note got it
 *     wrong by naming one for all six: `getCompatibilityHelper` builds `inOutIncompat` and
 *     then returns **`result.args`** for `tx`, **`result.value`** for `constants`/`event`, and
 *     the whole `{args, value}` object only for `query`/`apis`/`view`. So an absent `tx` entry
 *     — 02 §7.7's frozen Asset Hub call is one — is the *flat* `incompatible` singleton with
 *     no `args` property at all, which `levelOf` must read as a top-level `level`. It does,
 *     and `tests/descriptors/compat.test.ts` pins all six against the real PAPI proxy rather
 *     than against this paragraph.
 *
 *     Two consequences of these being **module-level singletons**, both measured:
 *     `helperFor`'s `undefined` branch is **unreachable** against a real compat object (the
 *     proxy always returns a helper), so it guards a hand-built surface and nothing else; and
 *     PAPI mutates `inOutIncompat` in place with `Object.assign`, after which
 *     `isCompatible(Incompatible)` answers `true` for **every** absent storage entry. That is
 *     harmless only because this module never passes a threshold — which is rule 3, arrived at
 *     from a second direction.
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
 * exposure `topology.ts` closes with an assignability binding in `light-client.ts`.
 * `tests/descriptors/types/papi-shapes.ts` closes it at the type level; the **production**
 * binding is `pullBleavitSurface`'s return annotation in
 * `app/src/application/src/compat-boot.ts`, which is where PAPI's `ChainCompatSurface<D>`
 * meets this module's `CompatSurface` on the one path that produces a value — the way
 * `light-client.ts` does for smoldot's `Chain`. (It is **not** in `compat-session.ts`, which
 * names no PAPI type at all; this note said so until the review caught it.) What *is* pinned
 * executably here is the numeric `CompatibilityLevel` mapping and the absence behaviour of
 * rule 4: the suite imports PAPI's real enum and builds a real compat object over the
 * committed metadata, because the ordering is what `isCompatible` compares and a renumbering
 * would silently turn `Partial` into a pass.
 */

import type { CompatibilityLevel, SurfaceProbe } from './compat.js';
import { CRITICAL_SURFACE, type CriticalSurfaceEntry } from './critical-surface.js';
import { FOREIGN_SURFACE, type ForeignSurfaceEntry } from './foreign.js';

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

/**
 * `(await api.getStaticApis()).compat`, structurally.
 *
 * **Five of PAPI's six groups, and the omission is deliberate.** PAPI publishes
 * `tx`, `constants`, `apis`, `view`, `query` and `event`. A group appears here when
 * something in this repository probes it: the four `CRITICAL_SURFACE` groups, plus `tx`,
 * which **`FOREIGN_SURFACE` needs** — 02 §7.7 freezes `PolkadotXcm.limited_reserve_transfer_assets`
 * as a *call*, and a foreign classification that skipped it would be one where the frozen
 * surface with the most to lose is the one never checked. `view` is absent because no
 * frozen surface is a view function; adding it would publish a group nothing reads, and
 * assignability from PAPI is unaffected either way (a wider source satisfies a narrower
 * target).
 *
 * `tx` is **not** the answer to SQ-577. That question is about Bleavit's *own* call
 * surface, which doc 02 does not enumerate, so `CRITICAL_SURFACE` still carries no call
 * entry and `callIsProven` still answers `false` outside `full`. What this group makes
 * probeable is the one call a *different* document froze.
 */
export interface CompatSurface {
  readonly apis: Record<string, Record<string, AnyCompatHelper>>;
  readonly query: Record<string, Record<string, AnyCompatHelper>>;
  readonly constants: Record<string, Record<string, AnyCompatHelper>>;
  readonly event: Record<string, Record<string, AnyCompatHelper>>;
  readonly tx: Record<string, Record<string, AnyCompatHelper>>;
}

/** The groups a probe may ask about — the keys of {@link CompatSurface}, as a value type. */
export type ProbeGroup = keyof CompatSurface;

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

/** One surface, in the three coordinates a compat lookup needs. */
interface ProbeTarget {
  readonly id: string;
  readonly compatGroup: ProbeGroup;
  readonly pallet: string;
  readonly member: string;
}

function helperFor(compat: CompatSurface, entry: ProbeTarget): AnyCompatHelper | undefined {
  const group = compat[entry.compatGroup] as Record<string, Record<string, AnyCompatHelper>> | undefined;
  return group?.[entry.pallet]?.[entry.member];
}

/**
 * Probe one list of targets. The body both public entry points share.
 *
 * A helper this cannot even look up is reported `incompatible`, not skipped — see
 * {@link probeCriticalSurface} for why that direction is the only safe one.
 */
function probeAll(compat: CompatSurface, targets: readonly ProbeTarget[]): readonly SurfaceProbe[] {
  return targets.map((entry) => {
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
  return probeAll(compat, surface);
}

/**
 * Probe every `FOREIGN_SURFACE` entry — 02 §7.7, against **Asset Hub's** compat surface.
 *
 * A separate entry point rather than a `surface` argument to the one above, because the two
 * take compat objects from **different chains** and nothing structural distinguishes them:
 * both are `CompatSurface`. `classifyForeign` and `classify` are already different types for
 * exactly that reason (§13 rule 8 — *"reported separately and never folded into the local
 * one"*), and a single probe function taking either list would be the one place a caller
 * could hand Bleavit's compat object the foreign list and get three `incompatible` results
 * that read as a broken Asset Hub. Two names cannot prevent that either, but they make the
 * mistake visible at the call site, which is where the chain is chosen.
 */
export function probeForeignSurface(
  compat: CompatSurface,
  surface: readonly ForeignSurfaceEntry[] = FOREIGN_SURFACE,
): readonly SurfaceProbe[] {
  return probeAll(compat, surface);
}
