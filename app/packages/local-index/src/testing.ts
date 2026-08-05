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

export { selfRange } from './coverage.js';
