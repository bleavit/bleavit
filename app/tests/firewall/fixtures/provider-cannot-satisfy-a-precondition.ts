// expect-error: TS2345 — `evaluate` accepts only `Finalized<T>`; a provider read is a well-formed `Verified<T>` and still not assignable (11 §11.4 rule 4)
// MUST FAIL — 11 §11.4 rule 4; INV-FE-3.
//
// "Provider/local-index data never satisfies any precondition; every row reads chain
// state." Stated as a rule in the document, it would be a review obligation repeated
// every time someone adds a precondition. Here it is a property of `evaluate`'s
// signature: the only thing it accepts is `Finalized<T>`, whose brand is constructible
// only inside `@bleavit/chain-client`.
//
// A provider read is a perfectly well-formed `Verified<T>`. That is what makes this
// worth a fixture: nothing about the *value* is wrong, and a runtime check would have to
// know to look at the status. The type rejects it before anyone has to remember.
import { evaluate } from '@bleavit/transaction-builder';
import type { Verified } from '@bleavit/shared-types';

const fromAnOperator: Verified<bigint> = {
  value: 5_000n,
  status: { kind: 'provider', providerId: 'operator-1', sampled: true },
};

export const gated = evaluate(
  {
    id: 'P-1/balance covers the trade',
    requirement: 'balance covers the trade',
    source: { kind: 'storage', key: '0xdead', query: 'value' },
    satisfiedBy: (v: bigint) => v >= 1_000n,
    expected: () => '>= 1000',
  },
  fromAnOperator,
);
