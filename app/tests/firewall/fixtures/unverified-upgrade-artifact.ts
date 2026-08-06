// expect-error: TS2739 — 11 §11.8.4 step 3: the artifact is hash-verified BEFORE submission, and the brand is what says it was
// MUST FAIL: `VerifiedArtifact` carries a module-private phantom brand and `verifyArtifact`
// is its only producer. Bytes that were never hashed against the chain's authorized hash
// must not be assemblable into an `UpgradeSubmission` — "never reaches the wallet" is the
// spec's own wording, and a runtime upgrade is the most consequential signature this client
// can produce.
//
// Since F17 the brand carries the **bytes** as well, so the literal is missing two members
// rather than one (TS2739, not TS2741). That is not a weaker proof: the retained bytes are
// exactly the ones the streaming hash consumed, which is what stops a caller submitting a
// parallel copy the hash never saw.
import type { UpgradeSubmission, AuthorizedUpgrade } from '@bleavit/features-tx';

declare const authorized: AuthorizedUpgrade;

const downloadedButUnchecked = { byteLength: 4_194_304, hash: '0xwhatever' } as const;

export const submission: UpgradeSubmission = {
  artifact: downloadedButUnchecked,
  authorized,
};
