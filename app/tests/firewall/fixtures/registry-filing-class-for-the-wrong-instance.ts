// expect-error: TS2322 — 07 §7: validate_class admits S1|S2|S3 on Incident and Scope(_) on Milestone
// MUST FAIL: a milestone filing cannot carry an incident severity, because `FilingInputs` is a
// union keyed on the instance and the arms take disjoint class types.
//
// The 2026-08-08 major. `registry_core::file(epoch, class, points, evidence_hash,
// spec_version)` refuses a mismatched class with `InvalidClass` — after the bond is committed
// — and `FilingInputs` carried **no `class` field at all**, so the model could not describe
// two of the call's five arguments and `filingBlocks` had nothing to check. A row whose read
// is undeclared is vacuously satisfied by `clauseGroupsFor`, so O-8 reported complete coverage
// of a precondition nothing evaluated.
//
// A predicate would have been the weaker half of the same rule: this client is the thing that
// decides what to encode, so the admissible set belongs in the type the form fills in. The
// instance decides the class, exactly as `validate_class` does.
import { filingBlocks } from '@bleavit/features-tx';
import type { BondQuoteState, EpochClosure, FrozenSpecVersions } from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
declare const filingBond: BondQuoteState;
declare const filingsUsed: Verified<number>;
declare const filingsBound: Verified<number>;
declare const frozenSpecVersions: FrozenSpecVersions;
declare const epochClosed: EpochClosure;

export const blocks = filingBlocks({
  kind: 'milestone',
  // `S2` is an incident severity. The Milestone instance takes `{ scope }` and nothing else.
  class: 'S2',
  freeUsdc,
  filingBond,
  filingsUsed,
  filingsBound,
  specVersion: 3,
  frozenSpecVersions,
  epochClosed,
  evidenceHash: '0xevidence',
});
