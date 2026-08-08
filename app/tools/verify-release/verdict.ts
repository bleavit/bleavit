/**
 * `verify-release`'s verdict — 12 §1.3, §1.4, §1.5, §2.3 (F13).
 *
 * 12 §1.3 requires that *anyone* can reproduce the verdict with no project infrastructure.
 * The fetching is the CLI's; the deciding is here, so it can be exercised against the
 * outcomes a healthy release never produces — which is the only place these rules are ever
 * really tested.
 *
 * ## Three floors, and each is counted in the way that is easy to get wrong
 *
 * **Signatures.** §1.4's release-signature floor is "≥ 2 valid release-key signatures from
 * **distinct active keys of the current keyring generation**, counted **after excluding
 * every key marked revoked**". Three separate conditions, and dropping any one of them
 * yields a checker that passes a release it should refuse: two signatures from *one* key is
 * one key; a signature from a *previous* generation is a signature against a keyring this
 * release did not publish; and counting before revocation is exactly the case §2.3 exists
 * for — the compromised key is the one still signing.
 *
 * **Attestations.** §1.4 gate 2 requires "≥ 2 independent attestations: builders in
 * **different organizations/infrastructure**". Counting signatures rather than organizations
 * satisfies the letter and voids the point: two attestations from one org is one
 * reproduction, and the whole claim is that two independent parties got the same bytes.
 *
 * **Files.** The comparison itself is `packages/verify`'s `runSelfCheck`, reused rather than
 * reimplemented, so the CLI and the in-app self-check cannot disagree about what "matches"
 * means — including its third finding kind, the *unexpected* served file that a
 * manifest-driven loop cannot see.
 *
 * ## `diff-scope` is a two-directional comparison
 *
 * §1.5's expedited lane is admissible only when the delta is confined to descriptors,
 * descriptor metadata and release metadata, with **zero app-code delta**: "every other file
 * in the built tree MUST be byte-identical to the incumbent release". A checker that
 * iterated the new tree would miss a *deleted* file, and a deletion outside the permitted
 * scope is exactly as much of an app-code delta as an edit.
 */

import type { SelfCheckResult } from '@bleavit/verify';
import { parseMinisignPublicKey, verifyMinisign } from './minisign.ts';
import type { MinisignPublicKey } from './minisign.ts';

export class VerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerifyError';
  }
}

/** §1.4's floors. A deployment MAY require more and MUST state its minimum explicitly. */
export const SIGNATURE_FLOOR = 2;
export const ATTESTATION_FLOOR = 2;

/** One detached release signature, as the CLI presents it after verifying the bytes. */
export interface ReleaseSignature {
  readonly keyId: string;
  readonly generation: number;
  readonly valid: boolean;
  /**
   * Why it did not verify, when it did not.
   *
   * Optional because the field is only meaningful on the failing arm, and carried at all
   * because *"the signature does not verify"* is the wrong sentence for the case that
   * matters most: a **restated trusted comment** leaves the artifact bytes intact and fails
   * only the global signature, and an operator told the bytes are wrong will go and check
   * the bytes. `releaseSignatureFrom` fills it from `verifyMinisign`'s own reason.
   */
  readonly why?: string | undefined;
}

/**
 * Build a `ReleaseSignature` by actually verifying the bytes.
 *
 * Until this existed, `valid` was **the caller's word** — a signature check that defaults to
 * whatever the caller believes, which is the `assertCheckable` shape this repository has met
 * in `admitIntent`, `admitEvidence` and `admitSnapshot`. Nothing about `countReleaseSignatures`
 * changes: it still takes supplied values, because §1.3's promise is a verdict reproducible
 * with no project infrastructure and a counting function that fetched could not run in the
 * container §1.3 describes. What changes is that there is now one function that produces them
 * honestly, and it is the one the CLI uses.
 *
 * `generation` is supplied rather than read from the signature, because minisign carries no
 * generation — it is a property of the **keyring** a key belongs to (12 §2.1), and inventing
 * a place for it inside the signature file would be inventing a format.
 */
export function releaseSignatureFrom(
  message: Uint8Array,
  signatureText: string,
  publicKeyText: string,
  generation: number,
): ReleaseSignature {
  let key: MinisignPublicKey;
  try {
    key = parseMinisignPublicKey(publicKeyText);
  } catch (error) {
    // A key file that cannot be parsed is not a signature that failed — but it is certainly
    // not one that passed, and there is no key id to report it under.
    throw new VerifyError(
      `this public key cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const verdict = verifyMinisign(message, signatureText, key);
  return verdict.ok
    ? { keyId: verdict.keyId, generation, valid: true }
    : { keyId: key.keyId, generation, valid: false, why: verdict.reason };
}

/**
 * The `ReleaseChannel` keyring the signatures are counted against (12 §2.1, §2.3).
 *
 * `generation` is optional in the *type* because this function is the thing that checks it:
 * §2.1 carries it as a `u32` and a keyring arriving without one is refused, so a required
 * field here would make the refusal unreachable from a caller and untestable from a suite —
 * a validator whose invalid input cannot be expressed validates nothing.
 */
export interface Keyring {
  readonly generation?: number | undefined;
  readonly revokedKeyIds?: readonly string[] | undefined;
}

/** An independent reproduction of the build, per §1.4 gate 2. */
export interface Attestation {
  readonly keyId: string;
  readonly organization?: unknown;
  readonly valid: boolean;
  /**
   * The keyring generation this attestor key belongs to (§2.1).
   *
   * Required, and required for the same reason `countReleaseSignatures` reads it: §5.2 has the
   * monitor verify *"the minisign signatures and ≥ 2 attestations against the current keyring
   * generation"*, so an attestation carrying none cannot be counted against one. It was absent
   * until 2026-08-08, which made §2.3's revocation rule unreachable for attestors — see
   * `countAttestations`.
   */
  readonly generation: number;
  /**
   * Why it did not verify, when it did not — the same field `ReleaseSignature` carries, for
   * the same reason. *"The attestation signature does not verify"* is the wrong sentence for
   * an attestation by a key the registry never published, and an operator told the bytes are
   * wrong goes and checks bytes that are intact.
   */
  readonly why?: string | undefined;
}

/** Why one signature or attestation did not count. Reported, never merely subtracted. */
export interface RejectedCredential {
  readonly keyId: string;
  readonly why: string;
}

export interface SignatureCount {
  readonly distinctKeys: number;
  readonly accepted: readonly string[];
  readonly rejected: readonly RejectedCredential[];
}

export interface AttestationCount {
  readonly independentOrganizations: number;
  readonly organizations: readonly string[];
  readonly rejected: readonly RejectedCredential[];
}

/**
 * Count the signatures that actually satisfy §1.4.
 *
 * `signatures` are `{ keyId, generation, valid }`; `keyring` is
 * `{ generation, revokedKeyIds }`. Everything is supplied rather than fetched, because §1.3's
 * promise is that the verdict is reproducible with no project infrastructure — a function
 * that reached for a node would be a function that cannot run in the container §1.3 describes.
 */
export function countReleaseSignatures(
  signatures: readonly ReleaseSignature[],
  keyring: Keyring,
): SignatureCount {
  if (!Number.isInteger(keyring?.generation)) {
    throw new VerifyError('the keyring declares no generation; §2.1 carries it as a u32');
  }
  const revoked = new Set<string>(keyring.revokedKeyIds ?? []);
  const accepted = new Set<string>();
  const rejected: RejectedCredential[] = [];
  for (const signature of signatures) {
    if (!signature.valid) {
      // The supplied reason when there is one: see `ReleaseSignature.why`. A restated
      // trusted comment fails here with the artifact bytes intact, and the generic sentence
      // would send an operator to check the bytes.
      rejected.push({
        keyId: signature.keyId,
        why: signature.why ?? 'the signature does not verify',
      });
      continue;
    }
    if (signature.generation !== keyring.generation) {
      rejected.push({
        keyId: signature.keyId,
        why: `signed under keyring generation ${signature.generation}, not the current ${keyring.generation}`,
      });
      continue;
    }
    if (revoked.has(signature.keyId)) {
      // §2.3: a revoked key is invalid for every verification from the moment the revocation
      // is observed at a finalized head. This is the case the whole revocation path exists
      // for — the compromised key is the one still signing.
      rejected.push({ keyId: signature.keyId, why: 'the key is marked revoked in ReleaseChannel' });
      continue;
    }
    accepted.add(signature.keyId);
  }
  return { distinctKeys: accepted.size, accepted: [...accepted].sort(), rejected };
}

/**
 * Count attestations by **organization**, per §1.4 gate 2's "different
 * organizations/infrastructure". Two attestations from one org is one reproduction.
 *
 * ## The keyring is a parameter, and it was missing
 *
 * §2.3 point 2 names the three verifications a revoked key must be invalid for: *"self-check,
 * update verification, **attestation counting**"*. Until 2026-08-08 this function took no
 * keyring at all, so a revoked attestor key kept counting toward gate 2 — the one credential
 * class where §2.3's own sentence spells the requirement out. The sibling implementation in
 * `tools/monitoring/attestation_monitor.py` applies the bitmask to release keys and attestor
 * keys alike, so the two disagreed and only one was right.
 *
 * The keyring is **required** rather than optional for the reason this repository has closed
 * three times over: an optional keyring is a revocation check that defaults off, and a caller
 * that forgets it gets a verdict, not a type error.
 */
export function countAttestations(
  attestations: readonly Attestation[],
  keyring: Keyring,
): AttestationCount {
  if (!Number.isInteger(keyring?.generation)) {
    throw new VerifyError('the keyring declares no generation; §2.1 carries it as a u32');
  }
  const revoked = new Set<string>(keyring.revokedKeyIds ?? []);
  const organizations = new Set<string>();
  const rejected: RejectedCredential[] = [];
  for (const attestation of attestations) {
    if (!attestation.valid) {
      rejected.push({
        keyId: attestation.keyId,
        why: attestation.why ?? 'the attestation signature does not verify',
      });
      continue;
    }
    if (attestation.generation !== keyring.generation) {
      // §5.2: attestations are verified against the *current* keyring generation. An
      // attestation under a previous one reproduces a build against a keyring this release
      // did not publish.
      rejected.push({
        keyId: attestation.keyId,
        why: `attested under keyring generation ${attestation.generation}, not the current ${keyring.generation}`,
      });
      continue;
    }
    if (revoked.has(attestation.keyId)) {
      rejected.push({ keyId: attestation.keyId, why: 'the key is marked revoked in ReleaseChannel' });
      continue;
    }
    if (typeof attestation.organization !== 'string' || attestation.organization.trim().length === 0) {
      // Refused rather than counted: an attestation with no declared organization cannot be
      // shown to be independent of any other, and independence is the entire claim.
      rejected.push({ keyId: attestation.keyId, why: 'no organization declared, so independence is unshowable' });
      continue;
    }
    organizations.add(attestation.organization.trim());
  }
  return { independentOrganizations: organizations.size, organizations: [...organizations].sort(), rejected };
}

/**
 * The whole verdict. `selfCheck` is `packages/verify`'s `SelfCheckResult` — reused, so the
 * CLI and the in-app check cannot disagree about what "matches" means.
 */
export interface VerdictInputs {
  readonly selfCheck: SelfCheckResult;
  readonly signatures: readonly ReleaseSignature[];
  readonly keyring: Keyring;
  readonly attestations: readonly Attestation[];
  readonly minimumSignatures?: number;
  /**
   * §1.3's `--require-attestations N`, held to the same rule as the signature minimum.
   *
   * §1.4 states that rule about a deployment's minimum: it MAY require more, MUST state its
   * minimum explicitly rather than inherit one silently, and MUST NOT configure fewer. The
   * sentence sits in the release-signature paragraph, and the flag that makes an attestation
   * minimum configurable is §1.3's — so a configurable minimum with no floor under it would
   * be the one place a release could be told to accept a single reproduction.
   */
  readonly minimumAttestations?: number;
}

export interface Verdict {
  readonly ok: boolean;
  readonly failures: readonly string[];
  readonly signatures: SignatureCount;
  readonly attestations: AttestationCount;
}

export function releaseVerdict({
  selfCheck,
  signatures,
  keyring,
  attestations,
  minimumSignatures = SIGNATURE_FLOOR,
  minimumAttestations = ATTESTATION_FLOOR,
}: VerdictInputs): Verdict {
  if (minimumSignatures < SIGNATURE_FLOOR) {
    // §1.4: "A deployment MAY require more and MUST state its minimum explicitly rather than
    // inherit one silently; it MUST NOT configure fewer."
    throw new VerifyError(
      `a minimum of ${minimumSignatures} is below 12 §1.4's floor of ${SIGNATURE_FLOOR}; a deployment ` +
        'may require more and must not configure fewer',
    );
  }
  if (minimumAttestations < ATTESTATION_FLOOR) {
    throw new VerifyError(
      `a minimum of ${minimumAttestations} attestation(s) is below 12 §1.4 gate 2's floor of ` +
        `${ATTESTATION_FLOOR}; a deployment may require more and must not configure fewer`,
    );
  }
  const failures: string[] = [];
  const sigs = countReleaseSignatures(signatures, keyring);
  const atts = countAttestations(attestations, keyring);

  if (!selfCheck.ok) {
    failures.push(
      `${selfCheck.findings.length} file finding(s): ` +
        selfCheck.findings.map((finding) => `${finding.kind} ${finding.path}`).join(', '),
    );
  }
  if (sigs.distinctKeys < minimumSignatures) {
    failures.push(
      `${sigs.distinctKeys} valid signature(s) from distinct active keys; ${minimumSignatures} required ` +
        `(12 §1.4). Rejected: ${sigs.rejected.map((r) => `${r.keyId} — ${r.why}`).join('; ') || 'none'}`,
    );
  }
  if (atts.independentOrganizations < minimumAttestations) {
    failures.push(
      `${atts.independentOrganizations} independent attesting organization(s); ${minimumAttestations} required ` +
        '(12 §1.4 gate 2 — builders in different organizations/infrastructure)',
    );
  }
  return { ok: failures.length === 0, failures, signatures: sigs, attestations: atts };
}

/** §1.5's admissible delta scope for the expedited lane. */
export const EXPEDITED_SCOPE: readonly string[] = Object.freeze([
  'assets/descriptors/',
  'release.json',
  'CHANGELOG.md',
  'release-history.json',
]);

/** Path → sha256 over a built tree, as `release.json`'s `perFileHashes` carries it. */
export type FileHashes = Readonly<Record<string, string>>;

export interface ScopeChange {
  readonly path: string;
  readonly change: 'added' | 'removed' | 'changed';
}

export interface ScopeVerdict {
  readonly admissible: boolean;
  readonly outOfScope: readonly ScopeChange[];
  readonly detail: string;
}

function inScope(path: string, scope: readonly string[]): boolean {
  return scope.some((prefix) => path === prefix || path.startsWith(prefix));
}

/**
 * `verify-release diff-scope --against <incumbent-txid>`.
 *
 * Compares **both directions**. A loop over the new tree misses a *deleted* file, and a
 * deletion outside the permitted scope is exactly as much of an app-code delta as an edit —
 * §1.5's requirement is that every other file be *byte-identical*, which a missing file is
 * not.
 */
export function diffScope(
  incumbent: FileHashes,
  candidate: FileHashes,
  scope: readonly string[] = EXPEDITED_SCOPE,
): ScopeVerdict {
  const outOfScope: ScopeChange[] = [];
  for (const [path, hash] of Object.entries(incumbent)) {
    const now = candidate[path];
    if (now === hash) continue;
    if (inScope(path, scope)) continue;
    outOfScope.push({ path, change: now === undefined ? 'removed' : 'changed' });
  }
  for (const path of Object.keys(candidate)) {
    if (incumbent[path] !== undefined) continue;
    if (inScope(path, scope)) continue;
    outOfScope.push({ path, change: 'added' });
  }
  outOfScope.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    admissible: outOfScope.length === 0,
    outOfScope,
    detail:
      outOfScope.length === 0
        ? 'the delta is confined to the descriptor and release-metadata scope 12 §1.5 admits'
        : `${outOfScope.length} out-of-scope file(s); §1.5 requires zero app-code delta, so this ` +
          'release must use the standard lane with its 72 h soak',
  };
}
