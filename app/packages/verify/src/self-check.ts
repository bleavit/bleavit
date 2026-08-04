/**
 * The signed release self-check — INV-FE-8's distribution-channel detection mechanism.
 *
 * INV-FE-8 names the threat precisely: no single operator — including "the Arweave
 * gateway, ArNS controller … or the CI system" — may **silently** alter the application.
 * The word doing the work is *silently*. The invariant does not promise alteration is
 * impossible; it promises it is detectable, and it closes with the rule that governs this
 * whole module: **"Detected divergence is surfaced to the user; it is never silently
 * repaired."**
 *
 * ## There is no repair function, and that is structural
 *
 * A `repair()` or `refetch()` here would be the natural next thing to write, and it is
 * exactly the thing the invariant forbids. Re-fetching a file that failed its hash asks
 * the same channel that just served wrong bytes for better ones — a gateway that tampered
 * once answers the retry too, and the user sees a moment's flicker instead of a warning.
 * So this module returns findings and nothing else: there is no function to call that
 * makes a divergence go away, which means no caller can accidentally provide one.
 *
 * ## Both directions of divergence, because one of them is the interesting one
 *
 * A changed file is the obvious tamper. An **extra** file — present in what was served,
 * absent from the signed manifest — is the one a per-file loop over the manifest cannot
 * see, and it is how a payload arrives: nothing the manifest lists has changed, so a
 * checker that iterates the manifest reports everything in order. Missing, changed and
 * unexpected are therefore three separate findings rather than a boolean.
 */

import type { Hash32, ReleaseIdentity } from './identity.js';

export type SelfCheckFindingKind = 'changed' | 'missing' | 'unexpected';

export interface SelfCheckFinding {
  readonly kind: SelfCheckFindingKind;
  readonly path: string;
  /** The hash the signed manifest pins. Absent for an `unexpected` file. */
  readonly pinned?: Hash32;
  /** The hash of what was actually served. Absent for a `missing` file. */
  readonly served?: Hash32;
  /** What the user is told. Never phrased as a transient problem. */
  readonly detail: string;
}

export interface SelfCheckResult {
  readonly ok: boolean;
  readonly findings: readonly SelfCheckFinding[];
  /** How many files the signed manifest pins — the denominator of "all verified". */
  readonly pinnedCount: number;
  /** How many were served and matched. */
  readonly verifiedCount: number;
}

/**
 * Compare what a gateway served against what the release signed.
 *
 * `served` is a path → content-hash map the caller computed from the bytes it actually
 * received. Hashing is the caller's job because the platforms differ (`SubtleCrypto` in a
 * browser, node's `createHash`, Tauri's filesystem) and a package that reached for one of
 * them would not run in the others — while the comparison, which is the part that decides
 * whether a user is warned, is identical everywhere and belongs in one tested place.
 */
export function runSelfCheck(
  identity: ReleaseIdentity,
  served: Readonly<Record<string, Hash32>>,
): SelfCheckResult {
  const findings: SelfCheckFinding[] = [];
  let verifiedCount = 0;

  for (const [path, pinned] of Object.entries(identity.perFileHashes)) {
    const actual = served[path];
    if (actual === undefined) {
      findings.push({
        kind: 'missing',
        path,
        pinned,
        detail: `${path} is part of this signed release and was not served`,
      });
      continue;
    }
    if (actual !== pinned) {
      findings.push({
        kind: 'changed',
        path,
        pinned,
        served: actual,
        detail:
          `${path} does not match the hash this release signed. The file you received is ` +
          'not the file that was published.',
      });
      continue;
    }
    verifiedCount += 1;
  }

  // The direction a manifest-driven loop cannot see: served files nobody signed.
  for (const [path, actual] of Object.entries(served)) {
    if (!(path in identity.perFileHashes)) {
      findings.push({
        kind: 'unexpected',
        path,
        served: actual,
        detail:
          `${path} was served but is not part of this signed release. Nothing that was ` +
          'published is missing or altered, which is why this is reported separately.',
      });
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    pinnedCount: Object.keys(identity.perFileHashes).length,
    verifiedCount,
  };
}

/**
 * A self-check over an empty manifest is a failure, not a pass.
 *
 * `runSelfCheck` on a release pinning no files would return `ok: true` having compared
 * nothing — the vacuous green this repository keeps rediscovering. A release that pins no
 * files is a broken release record, so it is refused here rather than reported as verified.
 */
export function assertCheckable(identity: ReleaseIdentity): void {
  if (Object.keys(identity.perFileHashes).length === 0) {
    throw new Error(
      'this release record pins no file hashes, so a self-check over it would verify ' +
        'nothing and report success; refusing to treat that as a passing check',
    );
  }
}
