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

/**
 * The structural half of `@bleavit/local-index`'s coverage value — 10 §6.3.
 *
 * This package is the dependency-free root, so it carries the shape rather than the module
 * that maintains it. What it carries had to grow: a range's **origin** is not decoration on it.
 *
 * 10 §6.3 declares `origin` on `CoverageRange` and makes the boundary between two origins a
 * **rendered fact** (*"never silently spliced … a range boundary is a rendered fact"*), and
 * 10 §2.3 states that provider-fed history is an accepted residual risk whose *only* mitigation
 * is *"mandatory, non-suppressible provenance labelling"*. The shape here omitted the field, so
 * the one status that carries coverage — `derived-local` — reached every badge in the client
 * with the provenance already discarded, and the badge could say nothing truer than how many
 * gaps there were. A count of gaps is not a label: it says how much is missing and nothing
 * about who supplied what is present, which is the half INV-FE-15 requires *"to the pixel"*.
 */
export type CoverageRange = {
  readonly fromBlock: number;
  readonly toBlock: number;
} & (
  /**
   * `self` is the only light-client-verified origin (10 §6.3, §2.2 — no promotion path), and a
   * discriminated union rather than an optional field because *"operator"* on its own is not a
   * describable state: two operators are two sources, and one lying does not implicate the
   * other. An optional `providerId` lets a provider range exist without naming its provider,
   * which is exactly the range a later reader is tempted to treat as verified.
   */
  | { readonly origin: 'self'; readonly providerId?: undefined }
  | { readonly origin: 'operator' | 'snapshot' | 'indexer'; readonly providerId: string }
);

export interface CoverageRef {
  readonly ranges: readonly CoverageRange[];
  readonly holes: readonly { readonly fromBlock: number; readonly toBlock: number }[];
}

/**
 * The distinct sources a coverage set was assembled from, sorted — the boundary set 10 §6.3
 * calls a rendered fact.
 *
 * A set rather than a count, because a count is the one summary that cannot carry the fact:
 * *"3 sources"* reads as abundance, while `self + indexer:acme` reads as *part of this line is
 * third-party data*. It lives here rather than in `local-index` because the render layer must
 * be able to compute it from a `VerificationStatus` alone, and `packages/ui` may not import the
 * index (10 §10.1).
 */
export function coverageBoundarySet(coverage: CoverageRef): readonly string[] {
  const seen = new Set<string>();
  for (const range of coverage.ranges) {
    seen.add(range.origin === 'self' ? 'self' : `${range.origin}:${range.providerId ?? '?'}`);
  }
  return [...seen].sort();
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

/** The `provider` member of {@link VerificationStatus}, named so a signature can return it. */
export type ProviderStatus = Extract<VerificationStatus, { kind: 'provider' }>;

/**
 * The `provider` status — 10 §2.1, §2.2; INV-FE-15.
 *
 * Constructing this is unrestricted, for the same reason `externalProposal` above is
 * unrestricted and `chain-client`'s `providerRead` is allowlisted by `check:provenance-mints`:
 * **a `provider` status claims nothing.** It is the label that says a value was *not* verified
 * by this client, so writing one grants a caller no authority it did not have. 10 §2.2 gives it
 * no promotion path at all, and the transaction path takes `Finalized<T>`, whose brand lives in
 * `chain-client` and cannot be reached from here. Every other status is an assertion about an
 * observation, which is why every other status is minted behind a read.
 *
 * It lives here rather than beside `providerRead` because of the package graph, not by
 * preference. `packages/providers` is the client's one INV-FE-15 badge site (`mint.ts`), and
 * 10 §10.1 forbids it importing `chain-client` — the whole point of that edge being absent is
 * that a provider package must not be able to open a chain connection or name `Finalized<T>`.
 * So the sanctioned constructor had to exist in a package `providers` may depend on, and
 * `shared-types` is the only one. Widening `check:provenance-mints`' allowlist to a third
 * owning module was the alternative and is the weaker claim: the gate's value is that the list
 * is short, and one constructor with two call sites is easier to audit than three modules that
 * may each write a status longhand.
 *
 * **It cannot mint any other status.** `kind` is written here and is not a parameter, and the
 * return type is the `provider` member alone rather than the union, so a caller cannot reach
 * `verified-finalized` through it by any argument.
 *
 * `sampled` has no default. It is the difference between *"a source we spot-check"* and
 * *"this row's history was compared against the chain"*, so a caller that forgets it gets a
 * type error rather than the weaker claim silently. The provider id is the caller's own fact
 * and is not validated here; `mint.ts` refuses an empty one at its own boundary, where the
 * refusal can say why (a row that renders as *from a provider* and cannot say which is the
 * half of "origin to the pixel" a user acts on).
 */
export function provider(providerId: string, sampled: boolean): ProviderStatus {
  return { kind: 'provider', providerId, sampled };
}

/** True for every status that is NOT a light-client-verified finalized read. */
export function isUnverified(status: VerificationStatus): boolean {
  return status.kind !== 'verified-finalized';
}
