/**
 * Provenance typing — 10 §2.1, INV-FE-9.
 *
 * This package is the dependency-free root of the graph, which is exactly why
 * `Finalized<T>` is NOT here. If its brand lived in the package every other
 * package depends on, every package could construct one and 10 §2.1's guarantee
 * would be void — silently, with green CI. `Finalized<T>` lives in
 * `@bleavit/chain-client` and nowhere else.
 */

export type HexString = `0x${string}`;

/** Opaque to this package; `@bleavit/local-index` owns the real shape. */
export interface CoverageRef {
  readonly ranges: readonly { readonly fromBlock: number; readonly toBlock: number }[];
  readonly holes: readonly { readonly fromBlock: number; readonly toBlock: number }[];
}

/**
 * Which chain a verified read was made against — its **genesis hash**, which is the
 * one identifier a light client has already proved for itself (10 §3.1's identity
 * check) rather than one taken on the word of whatever served the read.
 *
 * This exists because F18 adds a second light client (Asset Hub, 02 §7.7) and a
 * block reference alone does not identify an observation once there is more than one
 * chain to observe. `blockNumber` collides *trivially* across chains — every chain
 * has a block 1,000 — and while two genesis-distinct chains will not share a block
 * *hash*, "these two reads are comparable" is a claim about the chain and was being
 * inferred from the block. Making it explicit is what lets `meet` refuse a
 * cross-chain combination **for the stated reason** instead of by a collision
 * argument that holds only accidentally.
 */
export type ChainId = HexString;

/**
 * The six statuses of INV-FE-9 (15 §2, amended 2026-08-03 by D-21).
 *
 * `external-proposal` is the bottom of the lattice and the only member with no
 * block reference — a value an external tool *requested* is not true *at* any
 * block, because it is not an observation of the chain at all.
 *
 * The two verified members carry `chain` for the reason given on `ChainId`: after
 * F18 there are two light clients, and a status that named only a block would let a
 * balance read on Asset Hub and one read on the futarchy chain sit side by side as
 * indistinguishable "verified" figures.
 */
export type VerificationStatus =
  | {
      readonly kind: 'verified-finalized';
      readonly chain: ChainId;
      readonly blockHash: HexString;
      readonly blockNumber: number;
    }
  | {
      readonly kind: 'verified-best';
      readonly chain: ChainId;
      readonly blockHash: HexString;
      readonly blockNumber: number;
    }
  | { readonly kind: 'derived-local'; readonly coverage: CoverageRef }
  | { readonly kind: 'provider'; readonly providerId: string; readonly sampled: boolean }
  | { readonly kind: 'stale-cache'; readonly asOfBlock: number; readonly ageMs: number }
  | { readonly kind: 'external-proposal' };

export interface Verified<T> {
  readonly value: T;
  readonly status: VerificationStatus;
}

/**
 * The one status a chosen value may carry when it is displayed as a data item
 * (INV-FE-1 as amended; 11 §11.14.4). Constructing this is deliberately
 * unrestricted: it asserts nothing, and the type system's job here is to stop it
 * being mistaken for an observation, not to stop it being made.
 */
export function externalProposal<T>(value: T): Verified<T> {
  return { value, status: { kind: 'external-proposal' } };
}

/** True for every status that is NOT a light-client-verified finalized read. */
export function isUnverified(status: VerificationStatus): boolean {
  return status.kind !== 'verified-finalized';
}
