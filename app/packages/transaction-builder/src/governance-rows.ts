/**
 * The 11 §11.7.3 governance precondition rows G-1…G-9 — F16's first slice.
 *
 * Same discipline as the P-rows: every clause names the surface it reads, which of §11.4
 * rule 2's three sources that is, and **whose account** the read is against. The subject is
 * required, for the reason P-3 established — a wrapper splits identity, and a row that
 * resolves one account for both questions checks the wrong one and fails *green*.
 *
 * ## The subjects here are not obvious, and two are the whole point
 *
 * **G-5 `unlock(class, target)` reads the `target`, not the caller.** `pallet-conviction-
 * voting`'s unlock takes the account to unlock *for*, and anyone may call it. So the lock
 * expiry that decides whether the call succeeds is `ClassLocksFor(target)` — subject
 * `recipient`. Reading the caller's locks instead passes green whenever the caller happens
 * to have no lock, which is the ordinary case for somebody helpfully unlocking a friend's
 * tokens, and then the chain refuses. This is P-9's lesson in a new place: a third account
 * is a third subject, not a special case of the first two.
 *
 * **G-2's target address is a `recipient` read too.** Delegation hands voting power to
 * another account, and §11.3's anti-substitution rule applies to it: the address is
 * reviewed as a *chain-read identity*, not echoed from the form.
 *
 * Everything else is `acting`, not `signer`: `conviction_voting` operates on the origin's
 * own votes and locks, so under a proxy those are the proxied account's — while the fee
 * and the nonce stay with the signer, which is what the `signer` subject is for.
 *
 * ## What is deliberately absent
 *
 * There is no clause asserting a referendum will *pass*. G-6's `ratify`-track note says the
 * client pre-computes the prospective index from `ReferendumCount` and **warns** that an
 * interleaving submission changes it — a warning, not a precondition, because the index is
 * decided by inclusion order and no read at B′ can bind it. Encoding it as a precondition
 * would block a lawful submission on a race the user cannot avoid.
 */

import type { SurfaceId } from '@bleavit/descriptors';
import type { ClauseId } from './preconditions.js';
import type { ClauseSource, ClauseSubject } from './rows.js';

/** The 11 §11.7.3 rows. Separate from `PreconditionRowId` because the tables are separate. */
export type GovernanceRowId =
  | 'G-1' | 'G-2' | 'G-3' | 'G-4' | 'G-5' | 'G-6' | 'G-7' | 'G-8' | 'G-9';

export interface GovernanceClause {
  readonly row: GovernanceRowId;
  readonly requirement: string;
  readonly surface: SurfaceId;
  readonly source: ClauseSource;
  readonly subject: ClauseSubject;
  /**
   * Set where a clause states a consequence 11 §11.7.6 puts above the fold rather than a
   * condition that blocks. The lock a conviction vote imposes is the case: it never blocks
   * the call, and hiding it behind a step is what §11.2 constraint 3 forbids.
   */
  readonly aboveTheFold?: true;
}

const clause = (
  row: GovernanceRowId,
  requirement: string,
  surface: SurfaceId,
  source: ClauseSource,
  subject: ClauseSubject,
  extra: { readonly aboveTheFold?: true } = {},
): GovernanceClause => ({ row, requirement, surface, source, subject, ...extra });

export const GOVERNANCE_ROWS: Readonly<Record<GovernanceRowId, readonly GovernanceClause[]>> = {
  'G-1': [
    clause(
      'G-1',
      'the referendum is still Ongoing',
      'storage.referenda.referendum_info_for',
      'storage',
      'chain',
    ),
    clause(
      'G-1',
      'your vote balance is within your free VIT',
      'storage.conviction_voting.voting_for',
      'storage',
      'acting',
    ),
    clause(
      'G-1',
      'the tokens this vote locks, and for how long, shown before you sign',
      'storage.conviction_voting.class_locks_for',
      'storage',
      'acting',
      { aboveTheFold: true },
    ),
  ],
  'G-2': [
    clause(
      'G-2',
      'you have no direct votes recorded in this class — remove them first',
      'storage.conviction_voting.voting_for',
      'storage',
      'acting',
    ),
    clause(
      'G-2',
      'the account you are delegating to, as the chain resolves it',
      'storage.conviction_voting.voting_for',
      'storage',
      'recipient',
    ),
    clause(
      'G-2',
      'the tokens this delegation locks, and for how long',
      'storage.conviction_voting.class_locks_for',
      'storage',
      'acting',
      { aboveTheFold: true },
    ),
  ],
  'G-3': [
    clause(
      'G-3',
      'you are currently delegating in this class',
      'storage.conviction_voting.voting_for',
      'storage',
      'acting',
    ),
  ],
  'G-4': [
    clause(
      'G-4',
      'the vote exists',
      'storage.conviction_voting.voting_for',
      'storage',
      'acting',
    ),
    clause(
      'G-4',
      'the referendum has ended, or removal is otherwise allowed',
      'storage.referenda.referendum_info_for',
      'storage',
      'chain',
    ),
  ],
  'G-5': [
    // The subject is `recipient`, and that is the row's whole content: `unlock(class,
    // target)` unlocks for `target`, whom anyone may name. Reading the caller's locks
    // passes green whenever the caller has none — the ordinary case when somebody unlocks
    // for a friend — and the chain then refuses.
    clause(
      'G-5',
      'the lock on that account has expired — otherwise the exact time remaining',
      'storage.conviction_voting.class_locks_for',
      'storage',
      'recipient',
    ),
  ],
  'G-6': [
    clause(
      'G-6',
      'the track’s submission deposit is within your free VIT',
      'storage.referenda.track_queue',
      'storage',
      'signer',
    ),
    clause(
      'G-6',
      'the call is one this track admits',
      'storage.referenda.referendum_count',
      'storage',
      'chain',
    ),
    clause(
      'G-6',
      'the preimage is noted and its hash matches the call',
      'storage.preimage.preimage_for',
      'storage',
      'chain',
    ),
  ],
  'G-7': [
    clause(
      'G-7',
      'the referendum is still Preparing',
      'storage.referenda.referendum_info_for',
      'storage',
      'chain',
    ),
    clause(
      'G-7',
      'the decision deposit is within your free VIT',
      'storage.referenda.deciding_count',
      'storage',
      'signer',
    ),
  ],
  'G-8': [
    clause(
      'G-8',
      'the referendum has reached a terminal state',
      'storage.referenda.referendum_info_for',
      'storage',
      'chain',
    ),
  ],
  'G-9': [
    clause(
      'G-9',
      'you are the proposal’s proposer',
      'storage.execution_guard.queue',
      'storage',
      'acting',
    ),
    clause(
      'G-9',
      'the referendum is live on the ratify track',
      'storage.referenda.referendum_info_for',
      'storage',
      'chain',
    ),
    clause(
      'G-9',
      'its preimage decodes to ratify for exactly this proposal and index',
      'storage.preimage.preimage_for',
      'storage',
      'chain',
    ),
    clause(
      'G-9',
      'the artifact commitment is unchanged',
      'storage.execution_guard.attestation_bindings',
      'storage',
      'chain',
    ),
  ],
};

export const GOVERNANCE_ROW_IDS: readonly GovernanceRowId[] = Object.freeze(
  Object.keys(GOVERNANCE_ROWS) as GovernanceRowId[],
);

/** The clauses for a row. Total over the closed union — no unknown-row branch exists. */
export function governanceRowsFor(row: GovernanceRowId): readonly GovernanceClause[] {
  return GOVERNANCE_ROWS[row];
}

/** Whether an arbitrary declarable row id belongs to this table. */
export function isGovernanceRowId(row: string): row is GovernanceRowId {
  return (GOVERNANCE_ROW_IDS as readonly string[]).includes(row);
}

/**
 * Every obligation a G-row imposes — the same per-clause coverage identity the P/O table
 * derives, for the same reason.
 *
 * A G-row's clauses carry no `key` and no `anyOf`, so the discriminator is the requirement
 * sentence. Duplicated text within one row would merge two obligations into one, so it is
 * refused here rather than silently collapsed. `aboveTheFold` clauses are **included**: they
 * state a consequence rather than a condition, but 11 §11.7.6 requires them read and shown,
 * and dropping them from the coverage set would make "the lock this vote imposes" the one
 * fact a gate never demanded.
 */
export function governanceCoverageIds(row: GovernanceRowId): readonly ClauseId[] {
  const ids: ClauseId[] = [];
  const seen = new Set<ClauseId>();
  for (const entry of governanceRowsFor(row)) {
    const coverageId: ClauseId = `${entry.row}/${entry.requirement}`;
    if (seen.has(coverageId)) {
      throw new Error(
        `${row} declares "${entry.requirement}" twice, so two obligations share one coverage ` +
          'id and a single result would certify both.',
      );
    }
    seen.add(coverageId);
    ids.push(coverageId);
  }
  return ids;
}

/**
 * The clauses that state a consequence rather than a condition.
 *
 * 11 §11.7.6 puts the lock consequence of a conviction vote above the fold, and 11 §11.2
 * constraint 3 names it among the five facts that may not be deferred behind a step. It is
 * marked here rather than left to a screen, because a screen is where it gets forgotten.
 */
export function aboveTheFoldClauses(): readonly GovernanceClause[] {
  return GOVERNANCE_ROW_IDS.flatMap((row) =>
    GOVERNANCE_ROWS[row].filter((entry) => entry.aboveTheFold === true),
  );
}
