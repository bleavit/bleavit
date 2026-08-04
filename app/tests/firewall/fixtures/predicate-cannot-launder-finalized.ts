// expect-error: TS2322 — a `x is Finalized<T>` predicate asserts the brand it cannot check, so it is a third mint mechanism (V-81)
// MUST FAIL: a narrowing helper must not be able to mint the 10 §2.1 brand.
//
// `forged-finalized.ts` proves a literal cannot inhabit `Finalized<T>` directly. That is
// only half the property, and the other half was false: `chain-client` exported
// `isFinalized(v: Verified<T>): v is Finalized<T>`, and a type predicate *asserts* the
// phantom field rather than checking it — it cannot check it, since the field has no
// runtime representation, which is exactly what lets the design survive structured
// clone. So the same literal the fixture above rejects compiled clean when passed
// through the predicate, and every package can name `Verified<T>` because it lives in
// the dependency-free `shared-types`.
//
// The predicate is now `hasFinalizedStatus`, which narrows the *status* and returns no
// brand. This fixture pins that: the narrowed value must still be unassignable to
// `Finalized<T>`.
import { hasFinalizedStatus, type Finalized } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';

const forged: Verified<number> = {
  value: 1,
  status: { kind: 'verified-finalized', blockHash: '0xdead', blockNumber: 1 },
};

export let laundered: Finalized<number> | undefined;
if (hasFinalizedStatus(forged)) {
  laundered = forged;
}
