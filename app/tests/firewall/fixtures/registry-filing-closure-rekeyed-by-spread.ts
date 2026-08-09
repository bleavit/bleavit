// expect-error: TS2322 — 11 §11.8.6 O-8: a closure reading cannot be re-keyed after the read
// MUST FAIL: spreading a genuine `open` and replacing its subject re-points real evidence.
//
// The 2026-08-09 P5, and the third fixture on this one type — which is the finding. The first
// proved `{ kind: 'open' }` is refused; the second proved a filled-in literal is refused; both
// were about *assembling* a value, and neither asked what a caller can do with one it
// legitimately holds. The answer was: everything.
//
//   const legit = epochClosure({ registry: 'incident', epoch: 40, specVersion: 2 }, read);
//   const forged = { ...legit, subject: { registry: 'incident', epoch: 41, specVersion: 9 } };
//
// No cast, no assertion, nothing for `check:casts` to see. Object spread copies own enumerable
// properties **including symbol-keyed ones**, and TypeScript's spread type keeps them, so the
// brand rides along onto a payload that was replaced. Measured before the repair:
// `filingBlocks` returned `[]` — no block at all — for a filing against `(41, 9)` while the
// only `ClosedAt` read this client ever performed was of `(40, 2)`. That is precisely the
// wrong-key admission the subject repair was written to prevent, on a **bonded** action,
// reached through the one door nobody had tried.
//
// The repair is a marker whose member a spread cannot carry: TypeScript drops `#private`
// members from a spread type, so the forged object misses a required property. See
// `ProducedByEpochClosure` in `registry-filing.ts` for why `#private` and not `private`, and
// for why the `unique symbol` stays beside it rather than being replaced by it.
import { filingBlocks, epochClosure } from '@bleavit/features-tx';
import type {
  BondQuoteState,
  ClosureSubject,
  FilingOccupancy,
  FrozenSpecVersions,
} from '@bleavit/features-tx';
import type { Verified } from '@bleavit/shared-types';

declare const freeUsdc: Verified<bigint>;
declare const filingBond: BondQuoteState;
declare const filingsUsed: FilingOccupancy<'incident'>;
declare const filingsBound: Verified<number>;
declare const frozenSpecVersions: FrozenSpecVersions;
/** The key the read was really taken against. */
declare const subject: ClosureSubject<'incident'>;
/** The chain's own `Option<BlockNumber>` answer for that key. */
declare const read: Verified<number | undefined>;

const legit = epochClosure(subject, read);
if (legit.kind !== 'open') throw new Error('this fixture is about the open arm');

export const blocks = filingBlocks({
  kind: 'incident',
  class: 'S2',
  freeUsdc,
  filingBond,
  filingsUsed,
  filingsBound,
  frozenSpecVersions,
  // Genuine evidence, re-pointed at a key nobody read. This is the expression the type must
  // refuse — and the one no assertion gate can ever see, because there is no assertion.
  epochClosed: { ...legit, subject: { registry: 'incident', epoch: 41, specVersion: 9 } },
  evidenceHash: '0xevidence',
});
