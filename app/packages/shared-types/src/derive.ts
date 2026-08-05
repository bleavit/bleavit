/**
 * Arithmetic over provenance — INV-FE-1 and 10 §2.1, at the one place a screen loses them.
 *
 * A screen that renders `limit − used`, or `graceEnd − now`, is rendering a value that came
 * from **two** reads. Every such site in this client was writing the result out by hand and
 * carrying *one* input's status:
 *
 * ```ts
 * <Count datum={{ value: limit.value - used.value, status: limit.status }} />
 * ```
 *
 * That is a promotion. If `used` came from a provider and `limit` from the light client, the
 * difference renders with a verified badge — which is precisely INV-FE-1's prohibition
 * ("RPC-fallback, provider … data is never promoted to verified"), reached by arithmetic
 * rather than by an assignment, so nothing in the firewall or the badge types can see it.
 *
 * ## The result is never stronger than its weakest input
 *
 * `combine` ranks the six statuses by how much each *claims*, and takes the weakest. The
 * ordering, and why each step is where it is:
 *
 * | Rank | Status | Claims |
 * |---|---|---|
 * | 1 | `verified-finalized` | light-client verified, canonical |
 * | 2 | `verified-best` | light-client verified, may still reorg |
 * | 3 | `derived-local` | computed from blocks *this client* ingested; §2.2 gives no promotion path, but the range is its own |
 * | 4 | `stale-cache` | was verified once, at a stated block, and says so |
 * | 5 | `provider` | never verified by this client |
 * | 6 | `external-proposal` | not an observation at all — somebody's *request* |
 *
 * The two unverified-but-once-observed kinds are ordered by how much they claim about *now*:
 * `derived-local` claims a coverage range that may be current, `stale-cache` states its own
 * age. Nothing safety-bearing turns on that pair — both are unverified, which is the property
 * the rule exists to preserve — but the order must be fixed rather than incidental, so it is
 * written down here and asserted.
 *
 * ## Two verified reads at different blocks do not combine at all
 *
 * This is the case that cannot be fixed by weakening a badge. `limit` verified at block 1000
 * and `used` verified at block 1200 are each true; their difference describes **neither**
 * block, and there is no status meaning "true of no block". Returning the older status would
 * assert the value held at 1000, which it did not.
 *
 * So the result is a union with an `incomparable` arm, and a screen holding one renders the
 * reason rather than a number. In this client that is also the *actionable* answer: reads
 * spanning two blocks is what INV-FE-2's pre-sign refresh exists to collapse, so "these were
 * read at different blocks" tells the user to refresh, which is exactly right.
 *
 * Unverified statuses carry no block, so no such check is possible for them — and none is
 * needed: the result is already unverified, and an unverified value makes no claim about a
 * block that a mismatch could falsify.
 */

import type { VerificationStatus, Verified } from './provenance.js';

/** Rank by how much the status claims. Lower is stronger. Total and fixed. */
const RANK: Readonly<Record<VerificationStatus['kind'], number>> = Object.freeze({
  'verified-finalized': 1,
  'verified-best': 2,
  'derived-local': 3,
  'stale-cache': 4,
  provider: 5,
  'external-proposal': 6,
});

/** True for the two statuses that name a block, and so can disagree about which one. */
function blockOf(status: VerificationStatus): string | undefined {
  return status.kind === 'verified-finalized' || status.kind === 'verified-best'
    ? status.blockHash
    : undefined;
}

export type Combined<T> =
  | { readonly kind: 'stated'; readonly datum: Verified<T> }
  /**
   * The inputs are verified at different blocks, so the derived value is true of no block.
   *
   * Deliberately not a weaker status: every status this client has asserts something about
   * a block or about a source, and this value has neither.
   */
  | { readonly kind: 'incomparable'; readonly reason: string };

/**
 * Combine the provenance of the reads a derived value was computed from.
 *
 * Takes the statuses rather than the values because the arithmetic is the caller's — this
 * function has no opinion about what `limit − used` means, only about what may be claimed
 * of the answer.
 */
export function combineStatus(
  statuses: readonly VerificationStatus[],
): { readonly kind: 'stated'; readonly status: VerificationStatus } | { readonly kind: 'incomparable'; readonly reason: string } {
  if (statuses.length === 0) {
    // A derived value with no inputs is not derived. Refusing beats inventing a status,
    // which at zero inputs would have to be the *strongest* one by any fold.
    return {
      kind: 'incomparable',
      reason: 'No reads were supplied, so nothing can be claimed about the result.',
    };
  }

  let weakest = statuses[0] as VerificationStatus;
  for (const status of statuses) {
    if (RANK[status.kind] > RANK[weakest.kind]) weakest = status;
  }

  // Only meaningful when the *weakest* still names a block: if anything unverified is in
  // the mix the result is unverified already, and makes no block claim to falsify.
  if (blockOf(weakest) !== undefined) {
    const blocks = new Set(statuses.map((status) => blockOf(status)));
    if (blocks.size > 1) {
      return {
        kind: 'incomparable',
        reason:
          'These values were read at different blocks, so a figure derived from them is not ' +
          'true of either one. Refresh to read them together.',
      };
    }
  }

  return { kind: 'stated', status: weakest };
}

/** `combineStatus` with the caller's computed value attached. */
export function combine<T>(value: T, statuses: readonly VerificationStatus[]): Combined<T> {
  const combined = combineStatus(statuses);
  return combined.kind === 'stated'
    ? { kind: 'stated', datum: { value, status: combined.status } }
    : combined;
}

/** The two-input case, which is nearly every site. */
export function combine2<A, B, R>(
  a: Verified<A>,
  b: Verified<B>,
  compute: (a: A, b: B) => R,
): Combined<R> {
  return combine(compute(a.value, b.value), [a.status, b.status]);
}
