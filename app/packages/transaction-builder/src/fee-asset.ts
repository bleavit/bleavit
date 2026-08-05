/**
 * The fee currency — D-12/X-14, 11 §11.3.
 *
 * Fees are payable in VIT **or** USDC through `pallet-asset-tx-payment` (runtime index 13),
 * and 11 §11.3 is explicit that *"every precondition table below computes fee headroom in
 * the **selected** fee asset"* so that "USDC-only accounts are always viable". The two live
 * in different pallets — VIT in `Balances`/`System.Account`, USDC in `ForeignAssets.Account`
 * — so this is not a label on one read but a choice of which storage item is read at all.
 *
 * A table that fixed one asset would fail in the direction that strands a user: reading
 * USDC headroom for a VIT-paying account reports "insufficient" against a balance the
 * transaction never touches, and reading VIT for a USDC-only account reports healthy
 * headroom in a currency the account does not hold.
 *
 * ## Why this is its own module
 *
 * Two consumers need it and neither may import the other: `fees.ts` estimates the charge in
 * the selected asset, `rows.ts` decides which balance the precondition table reads, and
 * `fees.ts → machine.ts → rows.ts` already runs one way. Declaring it in `fees.ts` and
 * importing it back into `rows.ts` closed that loop — a cycle dependency-cruiser rejects
 * outright, and rightly: a cycle is how a module ends up initialized against a half-built
 * peer at runtime.
 *
 * The alternative — a second copy of the union in `rows.ts` — is worse than the cycle. The
 * two would never meet in a call site, so a drift between them would be invisible to the
 * compiler and would surface as a client that checks headroom in one currency and charges
 * in the other. A leaf module with no imports of its own is the shape that gives one
 * definition to both without an edge between them.
 */

export type FeeAsset = 'VIT' | 'USDC';

/** Every fee currency, for exhaustive iteration in tests and selectors. */
export const FEE_ASSETS: readonly FeeAsset[] = Object.freeze(['VIT', 'USDC'] as const);

/**
 * Narrow an unchecked value to a `FeeAsset`.
 *
 * Exists because the consumers of this package include untyped JavaScript, where an omitted
 * or misspelled asset would otherwise flow into a table lookup and match nothing — quietly
 * returning a precondition row *minus its fee headroom clause*, which reads as a row that
 * passed. The type system cannot reach that caller; this predicate can.
 */
export function isFeeAsset(value: unknown): value is FeeAsset {
  return value === 'VIT' || value === 'USDC';
}
