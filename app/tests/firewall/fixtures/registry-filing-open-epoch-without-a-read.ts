// expect-error: TS2322 — 11 §11.8.6 O-8: `AlreadyFinal` is a finalized read of `ClosedAt`
// MUST FAIL: an open epoch is a chain answer, so it cannot be written as a structural literal.
//
// The 2026-08-09 P2. `EpochClosure` carried three arms and only two of them held evidence:
// `closed` carried the block and `unread` carried the reason, while `open` was
// `{ kind: 'open' }` — no datum, no pin, and no producer. Any caller could satisfy `file`'s
// `AlreadyFinal` precondition without ever reading `ClosedAt[epoch][spec_version]`, and
// `filingBlocks` would then raise no block at all.
//
// That direction is what makes it expensive rather than merely wrong. `unread` and `closed`
// both refuse, so a hand-assembled one of those costs a user nothing. `open` **permits**, and
// a filing is bonded: the user posts the bond and the runtime reverts the call it paid for.
//
// The repair is the one this branch already applied to a `Verified<T>` with no producer — make
// the unproven state unrepresentable rather than check for it. `open` now carries the read
// that established the absence and a module-private brand, so `epochClosure` is the only
// producer and this literal does not typecheck.
import { filingBlocks } from '@bleavit/features-tx';
import type { BondQuoteState, FrozenSpecVersions } from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
declare const filingBond: BondQuoteState;
declare const filingsUsed: Verified<number>;
declare const filingsBound: Verified<number>;
declare const frozenSpecVersions: FrozenSpecVersions;

export const blocks = filingBlocks({
  kind: 'incident',
  class: 'S2',
  freeUsdc,
  filingBond,
  filingsUsed,
  filingsBound,
  frozenSpecVersions,
  // No read happened. This is the assertion the type must refuse.
  epochClosed: { kind: 'open' },
  evidenceHash: '0xevidence',
});
