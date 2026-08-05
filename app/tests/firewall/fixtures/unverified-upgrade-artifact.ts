// expect-error: TS2741 — 11 §11.8.4 step 3: the artifact is hash-verified BEFORE submission, and the brand is what says it was
// MUST FAIL: `VerifiedArtifact` carries a module-private phantom brand and `verifyArtifact`
// is its only producer. Bytes that were never hashed against the chain's authorized hash
// must not be assemblable into an `UpgradeSubmission` — "never reaches the wallet" is the
// spec's own wording, and a runtime upgrade is the most consequential signature this client
// can produce.
import type { UpgradeSubmission, AuthorizedUpgrade } from '@bleavit/features-tx';

declare const authorized: AuthorizedUpgrade;

const downloadedButUnchecked = { byteLength: 4_194_304, hash: '0xwhatever' } as const;

export const submission: UpgradeSubmission = {
  artifact: downloadedButUnchecked,
  authorized,
};
