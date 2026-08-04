/**
 * The verification panel's data model — INV-FE-11, 10 §3.2 (`FE-BOOT-002`).
 *
 * INV-FE-11 requires the bundle to display its pinned identity "in an **always-available**
 * verification panel", and 10 §3.2 makes that literal: under `WorkerFailed` — smoldot
 * refused to start, so **no verified read exists** — the renderable surface is "docs,
 * settings, verification panel, cached dashboard". The panel is listed among the things
 * that still work when the light client does not.
 *
 * That is a load-bearing constraint, not a nicety, and it is the reason this module is
 * shaped the way it is. The moment a user most needs to know *what they are running* is
 * the moment something has gone wrong — a boot failure, a tamper warning, a chain that
 * answered with the wrong genesis. A panel that needed the chain to render would be
 * unavailable in precisely those cases, and its absence would look like part of the same
 * outage rather than a missing safety surface.
 *
 * So `buildPanel` is **synchronous and takes no chain handle**. It cannot await a read, it
 * cannot hold a client, and it cannot fail because a connection is down: the offline case
 * is not an error path but the ordinary one. Chain-derived facts enter only as an already-
 * resolved `ChainIdentityVerdict`, which is `undefined` when nothing has been verified yet
 * — and `undefined` renders as *not yet verified*, never as verified.
 */

import {
  mayOperate,
  type ChainIdentityVerdict,
  type Hash32,
  type ReleaseIdentity,
} from './identity.js';
import type { SelfCheckResult } from './self-check.js';

/** One labelled fact in the panel. */
export interface PanelRow {
  readonly label: string;
  readonly value: string;
  /**
   * Whether this row is a *pin* (compiled into the bundle, true offline) or an
   * *observation* (something a live chain reported). Distinguishing them is the point:
   * a panel that renders both identically lets a pin masquerade as a verification.
   */
  readonly kind: 'pinned' | 'observed';
}

export type PanelStatus =
  | 'verified'
  /** Nothing has been checked against a chain yet — not a failure, not a pass. */
  | 'unverified'
  /** The self-check found divergence, or the chain identity did not match. */
  | 'divergent';

export interface VerificationPanel {
  readonly status: PanelStatus;
  readonly rows: readonly PanelRow[];
  /** Present when something diverged. Surfaced, never repaired (INV-FE-8). */
  readonly warnings: readonly string[];
  /**
   * Whether the chain identity has been **positively verified** — the gate for signing.
   *
   * Named for the check rather than for permission, because the earlier name
   * (`mayOperate`) invited the fail-open reading it shipped with: an app that had simply
   * never run the check got `true`, so *omitting* verification was indistinguishable
   * from passing it. INV-FE-11 requires identity verification at boot and makes a
   * mismatch terminal; "not checked yet" must therefore sit on the same side as "wrong",
   * not on the same side as "right".
   *
   * This is deliberately **not** what decides whether the panel renders. 10 §3.2 lists
   * the panel among the surfaces that still work under `FE-BOOT-002`, when no verified
   * read exists at all — so the panel is always available and this flag is false while
   * it renders. The two questions were conflated in one boolean, and separating them is
   * the fix.
   */
  readonly chainIdentityVerified: boolean;
}

const short = (hash: Hash32 | string): string =>
  hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;

/**
 * Build the panel from bundle-pinned data plus whatever has been verified so far.
 *
 * Synchronous by design — see the module note. Both optional arguments absent is the
 * `WorkerFailed` case, and it produces a complete panel of pinned rows with status
 * `unverified`.
 */
export function buildPanel(
  identity: ReleaseIdentity,
  selfCheck?: SelfCheckResult,
  chain?: ChainIdentityVerdict,
): VerificationPanel {
  const rows: PanelRow[] = [
    { label: 'Release (Arweave TXID)', value: identity.releaseTxid, kind: 'pinned' },
    { label: 'Source commit', value: identity.sourceCommit, kind: 'pinned' },
    {
      label: 'Files pinned',
      value: String(Object.keys(identity.perFileHashes).length),
      kind: 'pinned',
    },
    {
      label: 'Supported spec versions',
      value: `${identity.specVersionRange.primary} (primary), ${identity.specVersionRange.recovery} (recovery)`,
      kind: 'pinned',
    },
    { label: 'Relay chain spec', value: short(identity.chainSpecHashes.relay), kind: 'pinned' },
    { label: 'Parachain chain spec', value: short(identity.chainSpecHashes.para), kind: 'pinned' },
    { label: 'Relay genesis', value: short(identity.genesisHashes.relay), kind: 'pinned' },
    { label: 'Parachain genesis', value: short(identity.genesisHashes.para), kind: 'pinned' },
  ];
  for (const [specVersion, hash] of Object.entries(identity.descriptorMetadataHashes)) {
    rows.push({
      label: `Descriptor metadata (spec ${specVersion})`,
      value: short(hash),
      kind: 'pinned',
    });
  }

  const warnings: string[] = [];
  let status: PanelStatus = 'unverified';

  if (selfCheck !== undefined) {
    rows.push({
      label: 'Release self-check',
      value: selfCheck.ok
        ? `all ${selfCheck.pinnedCount} files match`
        : `${selfCheck.findings.length} finding(s) across ${selfCheck.pinnedCount} pinned files`,
      kind: 'observed',
    });
    for (const finding of selfCheck.findings) warnings.push(finding.detail);
  }

  if (chain !== undefined) {
    rows.push({
      label: 'Chain identity',
      value: chain.kind === 'verified' ? 'matches the pinned identity' : chain.kind,
      kind: 'observed',
    });
    if (chain.kind !== 'verified') warnings.push(chain.detail);
  }

  // Status is derived last, from both channels. `verified` requires *both* to have run
  // and passed: a self-check alone says the bundle is intact, not that it is talking to
  // the right chain, and either one reported as "verified" on its own would overstate.
  if (warnings.length > 0) {
    status = 'divergent';
  } else if (selfCheck?.ok === true && chain?.kind === 'verified') {
    status = 'verified';
  }

  return {
    status,
    rows,
    warnings,
    // Fail-closed on the unchecked path: an absent verdict is "not verified", never
    // "fine so far". The previous form returned true when `chain === undefined`, which
    // made skipping the check indistinguishable from passing it.
    chainIdentityVerified: chain === undefined ? false : mayOperate(chain),
  };
}
