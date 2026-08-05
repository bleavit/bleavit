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

export class VerifyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerifyError';
  }
}

/** §1.4's floors. A deployment MAY require more and MUST state its minimum explicitly. */
export const SIGNATURE_FLOOR = 2;
export const ATTESTATION_FLOOR = 2;

/**
 * Count the signatures that actually satisfy §1.4.
 *
 * `signatures` are `{ keyId, generation, valid }`; `keyring` is
 * `{ generation, revokedKeyIds }`. Everything is supplied rather than fetched, because §1.3's
 * promise is that the verdict is reproducible with no project infrastructure — a function
 * that reached for a node would be a function that cannot run in the container §1.3 describes.
 */
export function countReleaseSignatures(signatures, keyring) {
  if (!Number.isInteger(keyring?.generation)) {
    throw new VerifyError('the keyring declares no generation; §2.1 carries it as a u32');
  }
  const revoked = new Set(keyring.revokedKeyIds ?? []);
  const accepted = new Set();
  const rejected = [];
  for (const signature of signatures) {
    if (!signature.valid) {
      rejected.push({ keyId: signature.keyId, why: 'the signature does not verify' });
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
 */
export function countAttestations(attestations) {
  const organizations = new Set();
  const rejected = [];
  for (const attestation of attestations) {
    if (!attestation.valid) {
      rejected.push({ keyId: attestation.keyId, why: 'the attestation signature does not verify' });
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
export function releaseVerdict({ selfCheck, signatures, keyring, attestations, minimumSignatures = SIGNATURE_FLOOR }) {
  if (minimumSignatures < SIGNATURE_FLOOR) {
    // §1.4: "A deployment MAY require more and MUST state its minimum explicitly rather than
    // inherit one silently; it MUST NOT configure fewer."
    throw new VerifyError(
      `a minimum of ${minimumSignatures} is below 12 §1.4's floor of ${SIGNATURE_FLOOR}; a deployment ` +
        'may require more and must not configure fewer',
    );
  }
  const failures = [];
  const sigs = countReleaseSignatures(signatures, keyring);
  const atts = countAttestations(attestations);

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
  if (atts.independentOrganizations < ATTESTATION_FLOOR) {
    failures.push(
      `${atts.independentOrganizations} independent attesting organization(s); ${ATTESTATION_FLOOR} required ` +
        '(12 §1.4 gate 2 — builders in different organizations/infrastructure)',
    );
  }
  return { ok: failures.length === 0, failures, signatures: sigs, attestations: atts };
}

/** §1.5's admissible delta scope for the expedited lane. */
export const EXPEDITED_SCOPE = Object.freeze([
  'assets/descriptors/',
  'release.json',
  'CHANGELOG.md',
  'release-history.json',
]);

function inScope(path, scope) {
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
export function diffScope(incumbent, candidate, scope = EXPEDITED_SCOPE) {
  const outOfScope = [];
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
