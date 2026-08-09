// expect-error: TS2322 — 11 §11.8.6 O-8: only `epochClosure` may report an epoch open
// MUST FAIL: a `Verified<undefined>` from somewhere else is not a `ClosedAt` read.
//
// The sibling of `registry-filing-open-epoch-without-a-read.ts`, and it exists because that
// one alone does not prove what it looks like it proves. Measured by mutation: deleting the
// brand from the `open` arm left that fixture failing exactly as before, because the required
// `read` field was doing all the work. A required field refuses an *empty* literal; it does
// not refuse a literal filled in with whatever `Verified<undefined>` the caller had lying
// around — a read of a different key, at a different block, about a different epoch.
//
// So the brand is the half that makes `epochClosure` the only producer, and this is the
// fixture that keeps it load-bearing. It also puts `EpochClosure` under `check:casts`, which
// discovers brands rather than listing them, so `as EpochClosure` is refused outside
// `registry-filing.ts` too — the assertion a brand alone can never stop.
import { filingBlocks } from '@bleavit/features-tx';
import type { BondQuoteState, ClosureSubject, FrozenSpecVersions } from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
declare const filingBond: BondQuoteState;
declare const filingsUsed: Verified<number>;
declare const filingsBound: Verified<number>;
declare const frozenSpecVersions: FrozenSpecVersions;
/** Some other finalized read that happens to carry `undefined`. It is not this one. */
declare const someOtherRead: Verified<undefined>;
/** A perfectly well-formed subject, so the fixture fails on the brand and not on the key. */
declare const subject: ClosureSubject<'incident'>;

export const blocks = filingBlocks({
  kind: 'incident',
  class: 'S2',
  freeUsdc,
  filingBond,
  filingsUsed,
  filingsBound,
  frozenSpecVersions,
  epochClosed: { kind: 'open', subject, read: someOtherRead },
  evidenceHash: '0xevidence',
});
