// expect-error: TS2741 — 06 §4 rule 4: the funder's reads are bound to the funder
// MUST FAIL: spreading genuine funder reads and replacing the balance breaks the binding.
//
// The 2026-08-09 sweep, third brand. `funderReads(who, …)` exists so the account and the reads
// taken for it are one value, and `checkSubmit` throws `WrongSubjectError` when `account` does
// not match the declared funder. A spread keeps `account` — so the subject check passes — while
// replacing the figure the control is actually decided on:
//
//   const forged = { ...funderReads(who, mine), freeBalance: somebodyElsesBalance };
//
// `checkSubmit` blocks when `freeBalance.value < classBond.value` and when
// `entriesThisEpoch.value >= maxPerAccount.value`. Falling through either is the permit, and
// the action is **bonded** — the same consequence class as `EpochClosure`'s re-keyed closure
// one screen over, and reached the same way.
//
// The repair is `ProducedByFunderReads`, a phantom marker carrying a `#private` member, which
// TypeScript drops from a spread type. See `ProducedByEpochClosure` for the argument.
import { checkSubmit, funderReads } from '@bleavit/features-tx';
import type { SubmitInputs } from '@bleavit/features-tx';
import type { Finalized } from '@bleavit/chain-client';

declare const base: Omit<SubmitInputs, 'funderReads'>;
declare const mine: {
  readonly entriesThisEpoch: Finalized<number> | undefined;
  readonly freeBalance: Finalized<bigint>;
};
/** A real finalized balance read. It is not this funder's. */
declare const somebodyElsesBalance: Finalized<bigint>;

const genuine = funderReads(base.funder, mine);

export const check = checkSubmit({
  ...base,
  // `account` is untouched, so `WrongSubjectError` never fires. The figure the bond is
  // checked against is another account's.
  funderReads: { ...genuine, freeBalance: somebodyElsesBalance },
});
