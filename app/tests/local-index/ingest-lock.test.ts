/**
 * The `fut-ingest` single-writer lock — 10 §6.5, §4.4 (F8).
 *
 * The per-write transaction in `loop-store` makes each write atomic and does nothing about
 * **two writers**. Two tabs with the app open is the ordinary case, not an edge one.
 *
 * What breaks is not the rows — ids are deterministic and `bulkPut` is idempotent, which is
 * why §6.5 pairs the lock *with* idempotence rather than relying on either alone. What breaks
 * is **coverage**: each tab holds its own in-memory `Coverage` and writes it wholesale, so
 * the last writer wins and a stale tab can erase a live one's advance. Both writes are
 * individually atomic and mutually destructive, which is exactly what a transaction cannot see.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IngestLockError, ingestLockName, withIngestLock } from '@bleavit/local-index';
import type { LockManagerLike } from '@bleavit/local-index';

type LockMode = 'exclusive' | 'shared';

const GENESIS = `0x${'a1'.repeat(32)}`;
const OTHER = `0x${'b2'.repeat(32)}`;

/**
 * A Web Locks stand-in that models **mode**, not just name occupancy.
 *
 * The first version tracked names only, so `mode: 'shared'` and `mode: 'exclusive'` behaved
 * identically and a mutation swapping them survived — the fake was granting the property
 * under test for free. Shared holders coexist; an exclusive request conflicts with any
 * holder, and any request conflicts with an exclusive holder. That is the whole of the
 * semantics this module depends on.
 */
function lockManager() {
  /** name -> array of modes currently held */
  const holders = new Map<string, LockMode[]>();
  const conflicts = (name: string, mode: LockMode): boolean => {
    const current = holders.get(name) ?? [];
    if (current.length === 0) return false;
    return mode === 'exclusive' || current.includes('exclusive');
  };
  return {
    get held() {
      return new Set([...holders.entries()].filter(([, m]) => m.length > 0).map(([n]) => n));
    },
    async request(name: string, options: { mode?: LockMode; ifAvailable?: boolean }, callback: (lock: unknown | null) => Promise<void>) {
      const mode = options.mode ?? 'exclusive';
      if (options.ifAvailable && conflicts(name, mode)) {
        await callback(null);
        return;
      }
      const current = holders.get(name) ?? [];
      holders.set(name, [...current, mode]);
      try {
        await callback({ name, mode });
      } finally {
        const after = holders.get(name) ?? [];
        const index = after.indexOf(mode);
        if (index >= 0) after.splice(index, 1);
        holders.set(name, after);
      }
    },
  };
}

test('the lock is scoped to the chain — one chain must not block another', () => {
  // Two chains are two databases and two independent ingest streams. A global lock would let
  // a tab indexing Paseo stall a tab indexing Polkadot for no reason, and the scoping mirrors
  // `databaseName`'s so the lock and the thing it guards cannot disagree about "one ingester".
  assert.equal(ingestLockName(GENESIS), 'fut-ingest@a1a1a1a1');
  assert.notEqual(ingestLockName(GENESIS), ingestLockName(OTHER));
});

test('the body runs under the lock, and the lock is released afterwards', async () => {
  const locks = lockManager();
  let heldDuringBody = false;
  const outcome = await withIngestLock(locks, GENESIS, async () => {
    heldDuringBody = locks.held.has(ingestLockName(GENESIS));
    return 42;
  });
  assert.equal(outcome.kind, 'ran');
  assert.equal(outcome.value, 42);
  assert.equal(heldDuringBody, true);
  assert.equal(locks.held.size, 0, 'a lock that is never released makes the first tab the only tab forever');
});

test('a second holder gets `busy` and its body NEVER runs', async () => {
  // The property the whole module exists for. `busy` rather than an exception because this
  // is the normal multi-tab case, and an exception would push every caller into a catch that
  // has to tell "somebody else is ingesting" from "something is wrong".
  const locks = lockManager();
  let secondRan = false;
  await withIngestLock(locks, GENESIS, async () => {
    const outcome = await withIngestLock(locks, GENESIS, async () => {
      secondRan = true;
    });
    assert.equal(outcome.kind, 'busy');
  });
  assert.equal(secondRan, false, 'two ingesters would overwrite each other’s coverage');
});

test('a different chain is NOT blocked while one is held, so the scoping is not decorative', async () => {
  const locks = lockManager();
  let otherRan = false;
  await withIngestLock(locks, GENESIS, async () => {
    const outcome = await withIngestLock(locks, OTHER, async () => {
      otherRan = true;
    });
    assert.equal(outcome.kind, 'ran');
  });
  assert.equal(otherRan, true);
});

test('a null lock under ifAvailable is treated as NOT held', async () => {
  // Web Locks' documented "not available" signal. Treating it as held runs the body
  // unlocked — the exact failure, from the one branch a happy-path test never enters.
  const nullGranting: LockManagerLike = {
    async request(_name, _options, callback) {
      await callback(null);
    },
  };
  let ran = false;
  const outcome = await withIngestLock(nullGranting, GENESIS, async () => {
    ran = true;
  });
  assert.equal(outcome.kind, 'busy');
  assert.equal(ran, false);
});

test('an absent Web Locks API REFUSES rather than running unlocked', async () => {
  // The tempting fallback is "run unlocked just this once", which is the double-writer
  // reached by the one code path nobody tests. App-code rule 10: an unproven capability is
  // absent, and absence disables the dependent surface with a named reason.
  await assert.rejects(
    () => withIngestLock(undefined, GENESIS, async () => 1),
    (error) => {
      assert.ok(error instanceof IngestLockError);
      assert.match(error.message, /Ingestion is disabled rather than run unlocked/);
      // And the message states the bounded cost, so the refusal is not read as a broken app.
      assert.match(error.message, /the local index is an accelerator/);
      return true;
    },
  );
});

test('the lock is released even when the body throws', async () => {
  // A body that throws while holding the lock would otherwise strand ingestion for the life
  // of the tab, and the symptom — "ingestion stopped and nothing says why" — is the one that
  // gets diagnosed as a broken app.
  const locks = lockManager();
  await assert.rejects(
    () => withIngestLock(locks, GENESIS, async () => { throw new Error('write failed'); }),
    /write failed/,
  );
  assert.equal(locks.held.size, 0);
  const after = await withIngestLock(locks, GENESIS, async () => 'recovered');
  assert.equal(after.kind, 'ran');
});
