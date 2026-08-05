/**
 * The upgrade crank — 11 §11.8.4. F17's most safety-critical piece.
 *
 * ## The artifact is verified before the wallet ever sees it
 *
 * > **Verify the artifact hash against the authorized hash BEFORE submission** —
 * > client-side, streaming BLAKE2b-256 over the downloaded bytes; a mismatch hard-blocks
 * > with `FE-UPG-001` and never reaches the wallet.
 *
 * "Never reaches the wallet" is the part a convention cannot carry. `VerifiedArtifact` is
 * branded and `verifyArtifact` is its only producer, and `UpgradeSubmission` requires one —
 * so bytes that were never hashed cannot be assembled into a submission. The failure this
 * prevents is a user signing a runtime upgrade for code nobody checked, which is the single
 * most consequential signature the client can produce.
 *
 * ## `applicable_at` is read, never recomputed
 *
 * > read the stored field, do **not** recompute `authorized_at + DescriptorLeadTime`
 * > client-side
 *
 * SQ-552 is why: `DescriptorLeadTime` was once a precondition on `execute`, whose clock
 * `execute` itself starts, and the recomputation was either unsatisfiable or reading some
 * earlier authorization's timestamp. So `PendingUpgrade.applicable_at` is a **required
 * field** here and there is no lead-time arithmetic in this module at all — a reader can
 * confirm that by its absence.
 *
 * ## The memory cost is stated rather than discovered
 *
 * §11.8.4's honesty note: hashing streams in bounded chunks, but *submission* needs the
 * whole Wasm in memory as a call argument. FE-P10 is unresolved, so whether a multi-MB
 * extrinsic survives smoldot in-browser is **not established** — and `submissionOutlook`
 * says so rather than implying it will work.
 */

import type { Verified } from '@bleavit/shared-types';

declare const ARTIFACT_VERIFIED: unique symbol;

/** What the chain authorized. Both fields are reads, not derivations. */
export interface AuthorizedUpgrade {
  readonly codeHash: Verified<string>;
  /** From `PendingUpgrade`. **Read**, never recomputed from `authorized_at` (SQ-552). */
  readonly applicableAt: Verified<number>;
}

/**
 * Bytes whose hash was checked against the authorized hash.
 *
 * Branded; `verifyArtifact` is the only producer. Without it an unverified `Uint8Array`
 * would satisfy `UpgradeSubmission` and §11.8.4 step 3's *"never reaches the wallet"* would
 * be a claim about the code rather than a property of it.
 */
export interface VerifiedArtifact {
  readonly byteLength: number;
  readonly hash: string;
  readonly [ARTIFACT_VERIFIED]: true;
}

/** The one hard block this screen can produce. */
export class UpgradeHashMismatchError extends Error {
  readonly code = 'FE-UPG-001';

  constructor(authorized: string, computed: string) {
    super(
      `FE-UPG-001: the downloaded runtime does not match the authorized upgrade. The chain ` +
        `authorized ${authorized} and these bytes hash to ${computed}. This is a hard block — ` +
        'the artifact is not offered to a wallet, and no gateway is retried into acceptance. ' +
        'Obtain the artifact from another gateway and try again.',
    );
    this.name = 'UpgradeHashMismatchError';
  }
}

/**
 * Verify downloaded bytes against the authorized hash.
 *
 * `computeHash` is injected: BLAKE2b-256 belongs to whatever hashing the platform provides
 * (`SubtleCrypto` has no BLAKE2b, so this is a bundled implementation or a host one), and
 * the *comparison* — the part that decides whether a user is asked to sign — is identical
 * everywhere and lives here. Same split `packages/verify` uses.
 *
 * Throws rather than returning a result. A refusal that a caller can ignore is not a hard
 * block, and §11.8.4 calls this one.
 */
export function verifyArtifact(
  bytes: Uint8Array,
  authorized: AuthorizedUpgrade,
  computeHash: (bytes: Uint8Array) => string,
): VerifiedArtifact {
  const computed = computeHash(bytes);
  if (computed !== authorized.codeHash.value) {
    throw new UpgradeHashMismatchError(authorized.codeHash.value, computed);
  }
  // Phantom brand — never materialised. One mint site, as with `Finalized<T>`.
  return { byteLength: bytes.byteLength, hash: computed } as VerifiedArtifact;
}

/** A submission that can only be built from verified bytes. */
export interface UpgradeSubmission {
  readonly artifact: VerifiedArtifact;
  readonly authorized: AuthorizedUpgrade;
}

/** Whether the stored `applicable_at` has been reached. Read, not recomputed. */
export function isApplicable(authorized: AuthorizedUpgrade, now: Verified<number>): boolean {
  return now.value >= authorized.applicableAt.value;
}

/**
 * What the client can honestly say about submitting a multi-MB extrinsic.
 *
 * FE-P10 is unresolved: whether smoldot and the transaction pool accept an extrinsic this
 * size in-browser is **not established**. So this returns a statement of uncertainty rather
 * than a prediction — and 10 §12's own conservative posture says the in-browser fetch and
 * hash-verify path ships regardless, with the operator-CLI handoff as the fallback.
 */
export function submissionOutlook(artifact: VerifiedArtifact): string {
  const mib = (artifact.byteLength / (1024 * 1024)).toFixed(1);
  return (
    `This runtime is ${mib} MiB, and submitting it needs the whole thing in memory as a ` +
    'call argument. Whether an extrinsic this size survives the light client and the ' +
    'transaction pool in a browser has not been established (FE-P10). If it fails, the ' +
    'artifact is already verified — the same bytes can be submitted with the operator CLI, ' +
    'and nothing needs re-downloading.'
  );
}
