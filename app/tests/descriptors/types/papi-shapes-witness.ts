/**
 * The witness for `papi-shapes.ts` — a shape that MUST be rejected.
 *
 * A positive control that only ever succeeds cannot distinguish *"the shapes match"* from
 * *"nothing was compared"*, and here that was not hypothetical. The first version of the
 * binding spelled the member union `Group[keyof Group][keyof Group[keyof Group]]`, whose
 * inner `keyof` is taken across the **union** of pallet objects and therefore yields only
 * their common keys — which is `never`, since pallets share no member names. Indexing by
 * `never` gives `never`, `never` is assignable to everything, and the positive control
 * compiled while comparing nothing at all. This file is what caught it.
 *
 * **It imports `RealCompat` and `EveryMemberOf` from the file it witnesses rather than
 * restating them.** A witness carrying its own copy of a definition proves the copy fires,
 * not the rule — and that is exactly how the first version of this file failed to notice
 * the fix: it kept the broken spelling and went on compiling after the real one was
 * repaired.
 *
 * `level: string` rather than a missing member, deliberately: a missing member is caught by
 * any structural check at all, while a member of the wrong *type* is what a real PAPI
 * change would look like — `CompatibilityLevel` becoming a string union, say, which is
 * exactly the sort of ergonomic change an SDK makes between minors.
 */

import type { EveryMemberOf, RealCompat } from './papi-shapes.js';

interface WrongHelper {
  readonly level: string;
  isCompatible(from?: number): boolean;
}

export function mustNotCompile(real: EveryMemberOf<RealCompat['constants']>): WrongHelper {
  return real;
}
