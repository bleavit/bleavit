/**
 * `Finalized<T>` and its brand — 10 §2.1, INV-FE-1, INV-FE-3.
 *
 * THIS MODULE IS THE ONLY PLACE `Finalized<T>` CAN BE CONSTRUCTED.
 *
 * The brand is part of the type, not a comment about it. A structural
 * intersection over `status.kind` alone is satisfied by any object literal, so
 * without the phantom field a package that never touches the light client could
 * mint a value the transaction path accepts. That defect shipped in an earlier
 * draft of doc 10 §2.1 and is exactly what `tests/firewall/` now forges against.
 *
 * Why a phantom `unique symbol` and not a class with a private member — the
 * genuinely nominal TypeScript option:
 *
 *   These values cross `postMessage` from the smoldot worker (10 §4.1) and are
 *   written to IndexedDB (10 §7). Structured clone strips prototypes, so a class
 *   instance arrives at the other side as a plain object and nominality is lost
 *   at precisely the one boundary that matters. A phantom field has no runtime
 *   representation at all, so structured clone is a no-op on it.
 *
 * The symbol is declared here and NOT exported. Nothing outside this module can
 * name it, so no object literal, spread, or `satisfies` can produce the field.
 * Only a deliberate double assertion can — which is grep-able and lint-banned.
 */

import type { HexString, Verified } from '@bleavit/shared-types';

declare const FINALIZED: unique symbol;

/** The only type the transaction path accepts (10 §2.3). */
export type Finalized<T> = Verified<T> & {
  readonly status: { readonly kind: 'verified-finalized'; readonly blockHash: HexString; readonly blockNumber: number };
  readonly [FINALIZED]: true;
};

/** A finalized block the light client has verified, used to pin a read. */
export interface FinalizedBlockRef {
  readonly blockHash: HexString;
  readonly blockNumber: number;
}

/**
 * The single construction site. Call ONLY with a value read through smoldot with
 * its storage proof checked, or computed purely from such values (INV-FE-1).
 *
 * This function is not exported from the package root for general use — see the
 * package `exports` map. Callers outside `@bleavit/chain-client` obtain
 * `Finalized<T>` by making a read, never by wrapping a value they already hold.
 */
export function finalize<T>(value: T, at: FinalizedBlockRef): Finalized<T> {
  // The one assertion in the codebase that produces the brand. The ESLint rule
  // `no-restricted-syntax` bans `Finalized`-shaped assertions everywhere else,
  // with a single file-scoped override for this module.
  return {
    value,
    status: { kind: 'verified-finalized', blockHash: at.blockHash, blockNumber: at.blockNumber },
  } as Finalized<T>;
}

/**
 * Meet of two finalized reads: the result is finalized only if both were read at
 * the SAME block. Two values from different blocks are not a consistent view, and
 * INV-FE-2 requires every precondition to be evaluated at a single finalized
 * block — so this returns `undefined` rather than silently picking one.
 */
export function meet<A, B, C>(
  a: Finalized<A>,
  b: Finalized<B>,
  combine: (a: A, b: B) => C,
): Finalized<C> | undefined {
  if (a.status.blockHash !== b.status.blockHash) return undefined;
  return finalize(combine(a.value, b.value), a.status);
}

/** Narrowing helper: never promotes, only recognises an already-finalized value. */
export function isFinalized<T>(v: Verified<T>): v is Finalized<T> {
  return v.status.kind === 'verified-finalized';
}
