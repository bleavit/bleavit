// expect-error: TS2741 — 11 §11.7.1: the conviction lock is displayed BEFORE signing, and the brand is what says it was
// MUST FAIL: `LockDisclosed` carries a module-private phantom brand and `discloseLock` is
// its only producer. A hand-built object of the right shape would let a vote reach a signer
// with no lock ever computed — and that failure is silent: the extrinsic succeeds and the
// user finds out up to 32 enactment periods later that their tokens are locked.
//
// Same device as `GatePassed` and `Finalized<T>`, for the same reason. The declared code
// names the brand specifically, so a literal that happened to match every visible field
// would still fail here and the expectation says which property does the work.
import type { LockDisclosed } from '@bleavit/transaction-builder';

const pretendIComputedIt = {
  conviction: 'Locked6x',
  lockBlocks: 0,
  unlocksAtEarliest: 0,
  weightTenths: 60,
} as const;

export const lock: LockDisclosed = pretendIComputedIt;
