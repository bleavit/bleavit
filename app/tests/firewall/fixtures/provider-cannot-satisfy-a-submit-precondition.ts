// expect-error: TS2322 — `checkSubmit` accepts only `Finalized<T>` leaves, and a provider read is a well-formed `Verified<T>` missing the brand (11 §11.4 rule 4)
// MUST FAIL — 11 §11.4 rule 4; INV-FE-3; 11 §11.5 P-10.
//
// The S5 submit gate is a precondition evaluator, so rule 4 binds it exactly as it binds
// `evaluate` and the S3 ticket: "provider/local-index data never satisfies any
// precondition; every row reads chain state."
//
// The provider leaf here is the intake queue length, and the choice is deliberate. Every
// other row passes, the value is plausible, and `Verified<number>` is a perfectly
// well-formed status — so `checkSubmit` would evaluate, find nothing wrong, and return an
// empty block list. `maySubmit` reads an empty block list as *every precondition passed*,
// which is how an operator snapshot walks a user to a `IntakeFull` after they have signed
// and paid the fee.
//
// A runtime guard would have to remember to look at `status.kind` on every leaf, on every
// future leaf, forever. `Finalized<T>` is constructible only inside `@bleavit/chain-client`,
// so the wrong input is untypeable instead.
import { checkSubmit, funderReads } from '@bleavit/features-tx';
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString, Verified } from '@bleavit/shared-types';

const at = {
  chain: `0x${'ce'.repeat(32)}` as HexString,
  blockHash: `0x${'11'.repeat(32)}` as HexString,
  blockNumber: 900_000,
};
const read = <T,>(value: T) => finalize(value, at);

// Read from an operator's snapshot rather than from the light client. Nothing about the
// value is wrong — that is the point.
const queueLenFromAnOperator: Verified<number> = {
  value: 3,
  status: { kind: 'provider', providerId: 'operator-1', sampled: true },
};

const hash = `0x${'ab'.repeat(32)}`;

export const check = checkSubmit({
  phase: read('Intake'),
  intakeQueueLen: queueLenFromAnOperator,
  maxIntakeQueue: read(64),
  maxPerAccount: read(4),
  funder: 'FUNDER',
  funderReads: funderReads('FUNDER', {
    entriesThisEpoch: read(0),
    freeBalance: read(10_000_000_000n),
  }),
  classBond: read(1_000_000_000n),
  preimage: {
    declaredHash: hash,
    declaredLen: 128,
    bytesHash: hash,
    bytesLen: 128,
    noted: read(true),
    requested: read(true),
  },
  resourcesMatchFootprint: read(true),
});
