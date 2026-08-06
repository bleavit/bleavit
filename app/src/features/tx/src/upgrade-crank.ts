/**
 * The upgrade crank — 11 §11.8.4, E19. F17's most safety-critical piece.
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
 * ## "Streaming" is the word the specification uses, and it had to be made true
 *
 * The first implementation took a whole `Uint8Array` and hashed it in one call. That is not
 * what step 3 says, and the difference is not stylistic. A 5 MB runtime arrives from a
 * gateway as a response body; materialising it before hashing needs the whole artifact
 * resident **and** a hash function that accepts it in one piece, which is the combination
 * §11.8.4's own memory note calls out as the architecturally heavy part of this screen. So
 * the input is an **async chunk source** and the hasher is an incremental one, fed chunk by
 * chunk — the bounded-memory half of the note is now a property of the signature.
 *
 * The bytes are still retained, deliberately: submission needs the whole Wasm as a call
 * argument, and if the caller kept its *own* copy alongside the one that was hashed, the
 * bytes submitted and the bytes verified would be two different objects that nothing binds
 * together. The verified bytes therefore live **inside the brand**, so a submission carries
 * exactly what was hashed. That is the same reason `RecomputedProof` carries its value.
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
 * `leadTimeCountdown` is not that arithmetic and the distinction is exact: it subtracts
 * `now` from the **stored** `applicable_at`, and never derives `applicable_at` from
 * anything. E19 asks for the countdown; the prohibition is on producing the deadline, not
 * on saying how far away the chain's own deadline is.
 *
 * ## The memory cost is stated rather than discovered
 *
 * §11.8.4's honesty note: hashing streams in bounded chunks, but *submission* needs the
 * whole Wasm in memory as a call argument. FE-P10 is unresolved, so whether a multi-MB
 * extrinsic survives smoldot in-browser is **not established** — and `submissionOutlook`
 * says so rather than implying it will work.
 */

import { combine2, type Combined, type Verified } from '@bleavit/shared-types';
import type { FeeAsset } from '@bleavit/transaction-builder';

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
  /** Exactly the bytes that were hashed — never a caller's parallel copy. */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly hash: string;
  readonly [ARTIFACT_VERIFIED]: true;
}

/**
 * An incremental hash — `update` per chunk, `digest` once.
 *
 * Injected for the reason the one-shot version was: BLAKE2b-256 is not in `SubtleCrypto`,
 * so it is a bundled or host implementation, while the *comparison* — the part that decides
 * whether a user is asked to sign — is identical everywhere and lives here.
 */
export interface StreamingHasher {
  update(chunk: Uint8Array): void;
  digest(): string;
}

/**
 * Where the artifact bytes come from.
 *
 * `totalBytes` is optional because a gateway may not declare one, and **`undefined` is not
 * zero**: a progress display that treated an undeclared length as zero would render a
 * complete-looking bar for a download that has not started. E19 asks for fetch progress;
 * `FetchProgress` carries the distinction rather than flattening it.
 */
export interface ArtifactSource {
  readonly totalBytes?: number | undefined;
  chunks(): AsyncIterable<Uint8Array>;
}

/** E19's *"artifact fetch progress"* — bytes seen, and whether a total was ever declared. */
export interface FetchProgress {
  readonly bytesRead: number;
  readonly totalBytes: number | undefined;
}

/** One hard block this screen can produce. */
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

/** A source that yields nothing hashes to the empty digest, which is a real hash of nothing. */
export class EmptyArtifactError extends Error {
  constructor() {
    super(
      'The artifact source yielded no bytes. An empty download is not a runtime, and hashing ' +
        'it would produce a well-formed digest of nothing — which a comparison against the ' +
        'authorized hash would simply report as a mismatch, hiding a transport failure behind ' +
        'a content failure. Refetch the artifact.',
    );
    this.name = 'EmptyArtifactError';
  }
}

/**
 * Stream the artifact, hash it as it arrives, and verify it against the authorized hash.
 *
 * Throws rather than returning a result. A refusal that a caller can ignore is not a hard
 * block, and §11.8.4 calls this one.
 *
 * `onProgress` is optional because progress is a *display*, and a verification that
 * depended on somebody watching it would be a verification with an optional step.
 */
export async function verifyArtifact(
  source: ArtifactSource,
  authorized: AuthorizedUpgrade,
  hasher: StreamingHasher,
  onProgress?: (progress: FetchProgress) => void,
): Promise<VerifiedArtifact> {
  const parts: Uint8Array[] = [];
  let bytesRead = 0;
  for await (const chunk of source.chunks()) {
    // Hash and retain in the same pass. Two passes over two collections is how the bytes
    // that were hashed and the bytes that are submitted come apart.
    hasher.update(chunk);
    parts.push(chunk);
    bytesRead += chunk.byteLength;
    onProgress?.({ bytesRead, totalBytes: source.totalBytes });
  }
  if (bytesRead === 0) throw new EmptyArtifactError();

  const computed = hasher.digest();
  if (computed !== authorized.codeHash.value) {
    throw new UpgradeHashMismatchError(authorized.codeHash.value, computed);
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  // Phantom brand — never materialised. One mint site, as with `Finalized<T>`.
  return { bytes, byteLength: bytesRead, hash: computed } as VerifiedArtifact;
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
 * E19's lead-time countdown — blocks remaining until the **stored** `applicable_at`.
 *
 * A `Combined<number>` because it is arithmetic over two reads: taking `applicable_at`'s
 * badge for the difference would claim the chain told us the current block, and a pair read
 * at different blocks describes neither. Negative means the deadline has passed, which is a
 * real answer and is not clamped to zero — an operator whose control is disabled for some
 * *other* reason needs to be able to tell "not yet" from "long since".
 */
export function leadTimeCountdown(
  authorized: AuthorizedUpgrade,
  now: Verified<number>,
): Combined<number> {
  return combine2(authorized.applicableAt, now, (applicableAt, current) => applicableAt - current);
}

/**
 * §11.8.4 step 4's *"fee headroom for a multi-MB extrinsic (displayed — it is large)"*.
 *
 * The row carried no fee clause at all until this review, on the one extrinsic in the
 * client whose fee is genuinely different in kind: length fees scale with the call, and a
 * multi-megabyte argument makes this the most expensive transaction the app can build. An
 * operator who reaches the wallet and is refused for fee has lost the download too.
 *
 * The estimate is **supplied**, never derived: it comes from the runtime's own fee query
 * for these exact bytes, and a client-side approximation of a length fee is the hardcoded
 * chain constant app-code rule 7 forbids, wearing arithmetic.
 */
export interface UpgradeFeeInputs {
  /** Which asset the fee is paid in — 11 §11.3's selector, no default. */
  readonly asset: FeeAsset;
  /** Free balance in that asset. `System.Account` for VIT, `ForeignAssets` for USDC. */
  readonly free: Verified<bigint>;
  /** The chain's estimate for **these** bytes. Supplied, never approximated here. */
  readonly estimatedFee: Verified<bigint>;
}

export interface FeeHeadroom {
  readonly covered: boolean;
  /** Zero when covered; otherwise how much more is needed, in the selected asset. */
  readonly shortfall: bigint;
}

export function upgradeFeeHeadroom(inputs: UpgradeFeeInputs): Combined<FeeHeadroom> {
  return combine2(inputs.free, inputs.estimatedFee, (free, fee) =>
    free >= fee ? { covered: true, shortfall: 0n } : { covered: false, shortfall: fee - free },
  );
}

/**
 * Whether fee headroom blocks the submission.
 *
 * An **incomparable** headroom blocks, exactly as an insufficient one does. This is the
 * largest fee the client can incur and the direction of error is a lost download plus a
 * failed signature, so "we could not establish it" is not a reason to proceed.
 */
export function feeHeadroomBlock(
  headroom: Combined<FeeHeadroom>,
): { readonly check: string; readonly detail: string } | undefined {
  if (headroom.kind === 'incomparable') {
    return {
      check: 'Fee headroom',
      detail:
        `This client cannot establish whether your balance covers the fee. ${headroom.reason} ` +
        'A runtime upgrade is the largest extrinsic this client builds, so its fee is not ' +
        'assumed to be small enough not to matter.',
    };
  }
  if (headroom.datum.value.covered) return undefined;
  return {
    check: 'Fee headroom',
    detail:
      'Your balance in the selected fee asset does not cover the fee for this extrinsic. A ' +
      'runtime upgrade carries the whole Wasm as a call argument, so its length fee is far ' +
      'larger than any other transaction here — this is not the usual rounding shortfall.',
  };
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

/** E19's progress line. Says *how much* when a total was declared, and says so when not. */
export function progressLine(progress: FetchProgress): string {
  const read = (progress.bytesRead / (1024 * 1024)).toFixed(1);
  if (progress.totalBytes === undefined) {
    return (
      `${read} MiB fetched. This gateway did not declare a length, so there is no ` +
      'percentage to show — the download is not stalled and its size is simply not known ' +
      'in advance.'
    );
  }
  const total = (progress.totalBytes / (1024 * 1024)).toFixed(1);
  return `${read} MiB of ${total} MiB fetched.`;
}
