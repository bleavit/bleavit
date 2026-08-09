// expect-error: TS2322 — 07 §7: the two registries allocate filing ids independently
// MUST FAIL: an incident challenge cannot take its bond from the milestone registry's filing.
//
// `challenge_filing(epoch, filing_id, evidence_hash)` names one filing and this row reads two
// things about it — the 72 h window and the filing's own stored bond. `freeUsdc >= bond` is the
// **permitting** comparison, so a bond read from another filing opens a bonded control whose
// real bond the account may not be able to post, and the chain refuses it after the signature.
//
// Two means close it, and they are not interchangeable. This fixture pins the first: a caller
// that knows which allocator it is challenging writes `ChallengeFilingInputs<'incident'>`, and a
// milestone reading in it is a shape that does not exist. The second is a comparison in
// `challengeFilingBlocks` over all three key components, which is what covers the caller whose
// `K` is the bare union — `ChallengeFilingInputs` defaults to it, unlike `FilingInputs`, whose
// two arms pin `K` concretely. A type parameter proves nothing until something tries to violate
// it, which is what this corpus is for.
import type {
  ChallengeBondReading,
  ChallengeFilingInputs,
  ChallengeWindowReading,
} from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
/** The window of the incident filing being challenged. */
declare const window: ChallengeWindowReading<'incident'>;
/** A real bond, of a real filing, read from `Filings` — on the **other** instance. */
declare const bond: ChallengeBondReading<'milestone'>;

export const inputs: ChallengeFilingInputs<'incident'> = {
  window,
  bond,
  freeUsdc,
  evidenceHash: '0xevidence',
};
