// expect-error: TS2322 — 11 §11.2a rule 2: no figure may span both ledger domains
// MUST FAIL: `totalOf` takes the domain first and its rows as `LedgerRow<NoInfer<D>>[]`, so
// inference is fixed by the first argument alone. Without `NoInfer` a mixed array widens `D`
// to `'primary' | 'service'`, the `domain` argument still satisfies it, and a merged total
// compiles — which is exactly the number that asserts one backing pool where I-4 holds per
// instance against two separate sovereign accounts.
import { totalOf, type LedgerRow } from '@bleavit/features-tx';

declare const primary: LedgerRow<'primary'>;
declare const hosted: LedgerRow<'service'>;

export const merged: bigint = totalOf('primary', [primary, hosted]);
