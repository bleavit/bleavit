// expect-error: TS2353 — 11 §11.8.6 O-8: `file`'s `(epoch, spec_version)` has ONE home
// MUST FAIL: a filing cannot name a spec version beside the read that was keyed to one.
//
// The 2026-08-09 P2, first face, second half. The instance is closed by a type
// (`registry-filing-closure-for-the-other-instance.ts`); `epoch` and `spec_version` are
// numbers and no type can hold them — but they need no comparison either, because there is
// nothing left to compare. `FilingInputs` used to carry its own `specVersion` beside an
// `epochClosed` read that named none, so the version the client checked `ClosedAt` under and
// the version the filing named were two independent values and nothing compared them.
//
// `ClosureSubject` is now the single home of the pair, `filingBlocks` reads it from there, and
// an encoder for `file` (still absent — `points` has no home either, SQ-1031) must take both
// from the same place. This is `guardianCall`'s rule in another domain: the value evaluated
// and the value dispatched are one value.
//
// Excess-property checking is the whole mechanism, and that is the point rather than a
// weakness — a second home cannot be added back without deleting this fixture.
import { filingBlocks } from '@bleavit/features-tx';
import type { BondQuoteState, EpochClosure, FrozenSpecVersions } from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
declare const filingBond: BondQuoteState;
declare const filingsUsed: Verified<number>;
declare const filingsBound: Verified<number>;
declare const frozenSpecVersions: FrozenSpecVersions;
declare const epochClosed: EpochClosure<'incident'>;

export const blocks = filingBlocks({
  kind: 'incident',
  class: 'S2',
  freeUsdc,
  filingBond,
  filingsUsed,
  filingsBound,
  frozenSpecVersions,
  epochClosed,
  // The read above already says which version it was taken under. This is a second one.
  specVersion: 3,
  evidenceHash: '0xevidence',
});
