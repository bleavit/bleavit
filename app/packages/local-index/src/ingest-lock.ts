/**
 * The `fut-ingest` single-writer lock — 10 §6.5 and §4.4 (F8).
 *
 * > Ingest writes remain idempotent (deterministic PKs, cursor-range advance in the same
 * > IndexedDB transaction), **single-writer via the leader's `fut-ingest` lock** (§4.4).
 *
 * The transaction in `loop-store.ts` makes each write atomic. It does nothing about **two
 * writers**, and two tabs both ingesting is the ordinary case rather than an edge one — a
 * user with the app open twice.
 *
 * ## What actually breaks without it, since "they'd both write the same rows" is the wrong worry
 *
 * The rows are fine: ids are deterministic and `bulkPut` is idempotent, which is exactly why
 * §6.5 pairs the lock with idempotence rather than relying on either alone. What breaks is
 * **coverage**. Each tab holds its own in-memory `Coverage` and writes it wholesale into one
 * `meta` row, so the last writer wins — and if tab A is ingesting blocks 1000–1100 while tab
 * B resumed from a stale read at 900, B's write erases A's advance. The next reader then sees
 * coverage that omits blocks whose rows *are* stored, which is the harmless direction, or —
 * if B is the one running ahead — coverage that claims blocks whose rows are still A's
 * uncommitted future, which is not.
 *
 * A per-write transaction cannot see this: both writes are individually atomic and mutually
 * destructive.
 *
 * ## Absence of the API is a refusal, not a fallback
 *
 * `navigator.locks` is unavailable in a few older environments, and the tempting fallback is
 * to run unlocked "just this once". That is precisely the double-writer the lock exists to
 * prevent, reached by the one code path nobody tests. So `withIngestLock` **throws** when the
 * API is absent — app-code rule 10's shape: an unproven capability is *absent*, and absence
 * disables the dependent surface with a named reason rather than silently degrading.
 *
 * The cost is bounded and worth stating: on such an environment the client does not ingest,
 * and every INV-FE-4 workflow still works, because the local index is an accelerator and the
 * transaction path never reads it (INV-FE-7).
 *
 * ## `ifAvailable`, not a queue
 *
 * A follower that *waits* for the lock becomes the ingester the moment the leader closes,
 * which sounds right and is not: it would resume from whatever coverage that tab last read,
 * which may be minutes stale. §4.4 elects a leader through `fut-leader` and gives ingestion
 * to the leader only, so a tab that cannot take `fut-ingest` immediately is not the leader
 * and should not queue for it. Requesting with `ifAvailable` makes "somebody else is
 * ingesting" a fast, explicit answer instead of a hang.
 */

/** The Web Locks surface this module needs. Structural, so a test can supply its own. */
export interface LockManagerLike {
  request(
    name: string,
    options: { readonly mode?: 'exclusive' | 'shared'; readonly ifAvailable?: boolean },
    callback: (lock: unknown | null) => Promise<void>,
  ): Promise<void>;
}

export class IngestLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestLockError';
  }
}

/**
 * The lock name, scoped to the chain.
 *
 * Two chains are two databases (`databaseName`) and therefore two independent ingest
 * streams; one global lock would let a tab indexing Paseo block a tab indexing Polkadot for
 * no reason. The scoping mirrors the database's, so the lock and the thing it guards cannot
 * disagree about what "one ingester" means.
 */
export function ingestLockName(paraGenesisHash: string): string {
  return `fut-ingest@${paraGenesisHash.slice(2, 10)}`;
}

export type LockOutcome<T> =
  | { readonly kind: 'ran'; readonly value: T }
  /** Another tab holds it. Not an error — it is the system working. */
  | { readonly kind: 'busy' };

/**
 * Run `fn` while holding the exclusive `fut-ingest` lock for this chain.
 *
 * Returns `busy` rather than throwing when another tab holds it, because that is the normal
 * multi-tab case and an exception would push every caller into a catch block that has to
 * distinguish "somebody else is ingesting" from "something is wrong".
 */
export async function withIngestLock<T>(
  locks: LockManagerLike | undefined,
  paraGenesisHash: string,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  if (locks === undefined) {
    throw new IngestLockError(
      'Web Locks is unavailable, so single-writer ingestion cannot be guaranteed (10 §6.5). ' +
        'Ingestion is disabled rather than run unlocked: two tabs writing coverage would ' +
        'overwrite each other, and the loser’s advance is lost silently. Every workflow still ' +
        'works — the local index is an accelerator and the transaction path never reads it.',
    );
  }
  let outcome: LockOutcome<T> = { kind: 'busy' };
  await locks.request(
    ingestLockName(paraGenesisHash),
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      // `null` is Web Locks' documented "not available" signal under `ifAvailable`. Treating
      // it as held would run the body unlocked — the exact failure, from the one branch a
      // happy-path test never enters.
      if (lock === null) return;
      outcome = { kind: 'ran', value: await fn() };
    },
  );
  return outcome;
}
