/**
 * Test-only surface for `local-index` — the `self` range constructor.
 *
 * `selfRange` mints `origin: 'self'`, the one origin `isVerifiedAt` treats as light-client
 * verified, and it does so from three plain numbers. Exported from the package barrel it was
 * a capability every consumer held: `providers` backfills from operator endpoints, indexers
 * and snapshots, and one call would have relabelled any of that as verified — the silent
 * promotion 10 §2.2 gives no path for and §6.3's no-splice rule exists to prevent.
 *
 * So it lives here instead, reachable only by a deliberate subpath import that
 * `no-range-minting-outside-ingest` forbids production code from making. Same shape as
 * `@bleavit/signing/testing`, and for the same reason: the thing that must not ship is
 * separated from the thing that must, and the separation is enforced rather than intended.
 *
 * Suites need it because a coverage fixture has to start somewhere, and building one through
 * the whole ingest loop would make every test of `addRange`/`holesIn`/`candles` depend on
 * the loop's correctness — so a bug there would make those suites agree with it.
 */

import Dexie from 'dexie';

import { SCHEMA_V1, databaseName } from './store.js';

export { selfRange } from './coverage.js';

/**
 * §9.2's label writer — production code inside this package, **test-only reachability** outside it.
 *
 * `writeDownsampled` takes no transaction of its own: §9.2 obligation 1 binds the label to the
 * delete (*"written in the same storage transaction that deletes the rows"*), so it must be called
 * inside the `rw` that performs the eviction, and `applyQuota` is its only production caller —
 * through a relative import, not through this file. What it may not be is a **barrel** export: any
 * consumer could then write the label with no eviction behind it, leaving rows present and
 * `meta.downsampled` claiming they were folded. That exact phantom-label state was found by
 * mutation one round ago inside this package, and a barrel export is the way to reach it from
 * outside.
 *
 * It lives here rather than nowhere because the suites must exercise the **real** writer: a test
 * that hand-wrote `db.meta.put({ key: 'downsampled', … })` would assert against its own idea of
 * the row shape, which is how a storage test passes while the storage does not agree — the same
 * reason `legacyIndexV1` below is a helper rather than raw IndexedDB calls.
 */
export { writeDownsampled } from './store.js';

/**
 * A database at the **schema this package first shipped** — the thing a migration upgrades from.
 *
 * It lives here rather than in the suite because `dexie` is `local-index`'s dependency and not
 * the test root's, and it is test-only for the same reason `selfRange` is: production code has
 * no business opening this database at an old version. A suite that hand-rolled the old object
 * stores through raw IndexedDB would be asserting against its own idea of what Dexie writes,
 * which is the shape of a migration test that passes while the migration does not.
 */
export function legacyIndexV1(paraGenesisHash: string): Dexie {
  const db = new Dexie(databaseName(paraGenesisHash));
  db.version(1).stores({ ...SCHEMA_V1 });
  return db;
}
