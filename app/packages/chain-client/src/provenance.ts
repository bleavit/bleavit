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

import type { ChainId, HexString, Verified } from '@bleavit/shared-types';

declare const FINALIZED: unique symbol;

/** The only type the transaction path accepts (10 §2.3). */
export type Finalized<T> = Verified<T> & {
  readonly status: {
    readonly kind: 'verified-finalized';
    readonly chain: ChainId;
    readonly blockHash: HexString;
    readonly blockNumber: number;
  };
  readonly [FINALIZED]: true;
};

/**
 * A finalized block the light client has verified, used to pin a read.
 *
 * `chain` is the genesis hash of the client that verified it. It is part of the *pin*
 * rather than something a caller passes alongside, because every `finalize` call takes
 * its status straight from a pin — so a read cannot acquire the wrong chain identity
 * without the transport handing out the wrong pin, which is the one place it is checked
 * (10 §3.1's genesis obligation).
 */
export interface FinalizedBlockRef {
  readonly chain: ChainId;
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
    status: {
      kind: 'verified-finalized',
      chain: at.chain,
      blockHash: at.blockHash,
      blockNumber: at.blockNumber,
    },
  } as Finalized<T>;
}

/**
 * The unary case of {@link meet}: one finalized read, decoded or projected.
 *
 * 10 §2.2 assigns `verified-finalized` to values read through smoldot with storage
 * proofs checked, **or computed client-side purely from such values**. `meet` served
 * that second clause for two reads and nothing served it for one, so a reader needing a
 * `Finalized<boolean>` out of a `Finalized<readonly StorageItem[]>` had no sanctioned
 * path at all. `market-reads.ts` hand-built a `verified-finalized` status object
 * instead: brand-less, structurally a `Verified<T>`, and asserting finality for values
 * it had never read.
 *
 * This grants nothing the barrel did not already export. `meet(a, a, (v) => f(v))` is
 * exactly this function, and both need a `Finalized<A>` to start from — which only a
 * read produces. `finalize` stays withheld for the reason `index.ts` gives: it mints
 * from a value and a pin the caller supplies, and there is no read anywhere in that.
 *
 * `compute` receives `A` rather than the whole `Finalized<A>`, for the reason
 * `DatumProps.render` does: a projection that could see the pin could ignore its input
 * and stamp an unrelated value with it, which is the laundering this replaces.
 */
export function derive<A, B>(read: Finalized<A>, compute: (value: A) => B): Finalized<B> {
  return finalize(compute(read.value), read.status);
}

/**
 * Meet of two finalized reads: the result is finalized only if both were read from
 * the same chain at the SAME block. Two values from different blocks are not a
 * consistent view, and INV-FE-2 requires every precondition to be evaluated at a
 * single finalized block — so this returns `undefined` rather than silently picking
 * one.
 *
 * The chain is checked **first and on its own** (F18). It is not redundant with the
 * block check: two chains will not share a block hash, so a cross-chain meet would
 * already return `undefined` — but only by a collision argument, and a safety
 * property that holds because a hash function is good is a property nobody can read
 * off this code. Once Asset Hub is a second light client, "these two reads are
 * comparable" is a statement about the chain, so the chain is what is compared.
 */
export function meet<A, B, C>(
  a: Finalized<A>,
  b: Finalized<B>,
  combine: (a: A, b: B) => C,
): Finalized<C> | undefined {
  if (a.status.chain !== b.status.chain) return undefined;
  if (a.status.blockHash !== b.status.blockHash) return undefined;
  return finalize(combine(a.value, b.value), a.status);
}

/**
 * The status narrowing — deliberately **not** a `v is Finalized<T>` predicate.
 *
 * It used to be one, and that quietly defeated the entire brand (F3, V-81). A type
 * predicate returning `v is Finalized<T>` *asserts* the phantom field; it cannot check
 * it, because the field has no runtime representation — that absence is the whole
 * reason the design survives structured clone. So a predicate is a **third mint
 * mechanism**, indistinguishable in effect from `as Finalized<T>`, and it was exported
 * from the package root. Measured under the corpus's own toolchain: the forged literal
 * `{value, status:{kind:'verified-finalized',…}}` is rejected outright, and the *same
 * literal* passed through the old `isFinalized` compiled clean. Anything that could
 * name `Verified<T>` — which is every package, since it lives in `shared-types` — could
 * therefore mint a value the transaction path accepts, with green CI. That is precisely
 * the failure 10 §2.1 warns is "void silently".
 *
 * Narrowing the *status* is still useful and is safe, because the returned type carries
 * no brand: a caller that needs `Finalized<T>` must make a read or go through
 * `readmitFromLeader`, neither of which a forged literal can reach.
 */
export function hasFinalizedStatus<T>(
  v: Verified<T>,
): v is Verified<T> & { status: { kind: 'verified-finalized'; blockHash: HexString; blockNumber: number } } {
  return v.status.kind === 'verified-finalized';
}

/**
 * The second — and only other — mint site: re-admitting a value that crossed a
 * structured-clone boundary from this tab's leader (10 §4.4).
 *
 * 10 §4.4 makes follower tabs render from finalized-state slices the leader broadcasts
 * over `BroadcastChannel`, and states the provenance ruling explicitly: those are
 * `verified-finalized` values verified *by the leader tab* — same origin, same release,
 * same TCB — "so this is not a provenance downgrade". Structured clone strips the
 * phantom field's *type* (it never had a runtime form), so the value arrives as a plain
 * `Verified<T>` and something must put the brand back.
 *
 * This is named for what it is: a **trust decision**, not a verification. It cannot
 * check anything about the sender — that is why it is not a predicate, why it takes the
 * leader's block pin explicitly rather than reading it off the payload, and why it
 * refuses any value that does not already claim finalized status at that exact block. A
 * caller must therefore already know which block the leader pinned, which a forged
 * literal arriving from nowhere does not.
 */
export function readmitFromLeader<T>(
  v: Verified<T>,
  leaderPin: FinalizedBlockRef,
): Finalized<T> | undefined {
  if (!hasFinalizedStatus(v)) return undefined;
  // Chain first, for the reason `meet` gives — and here it is load-bearing rather than
  // merely clearer. A follower tab holds a pin per chain (F18 gives the leader two light
  // clients), so re-admitting against *a* pin instead of the *right* pin is a mistake a
  // caller can actually make: the payload would be an Asset Hub read and the pin the
  // futarchy one. The block hashes differ, so this was already refused — but a future
  // caller passing the payload's own block through would sail past a hash-only check.
  if (v.status.chain !== leaderPin.chain) return undefined;
  if (v.status.blockHash !== leaderPin.blockHash) return undefined;
  if (v.status.blockNumber !== leaderPin.blockNumber) return undefined;
  return finalize(v.value, leaderPin);
}
