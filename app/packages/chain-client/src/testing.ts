/**
 * Test-only surface for `chain-client` — the `Finalized<T>` construction site.
 *
 * `finalize` mints the one type the transaction path accepts, from a value and a block
 * pin the caller simply supplies. Exported from the package barrel it was a capability
 * every consumer held, and the consumers that matter are `transaction-builder` and
 * `signing`: one call would have relabelled a provider read — or a literal invented on the
 * spot — as light-client-verified state, which is INV-FE-1's promotion arriving through
 * the front door. Neither existing control could see it. `check:casts` looks for
 * `as Finalized<T>` and there is no assertion; dependency-cruiser looks for a forbidden
 * import and `@bleavit/chain-client` is exactly what those packages may import.
 *
 * So it lives here instead, reachable only by a deliberate subpath import that
 * `no-finalized-minting-outside-chain-client` forbids production code from making. Same
 * shape as `@bleavit/signing/testing` and `@bleavit/local-index/testing`, and for the same
 * reason: the thing that must not ship is separated from the thing that must, and the
 * separation is enforced rather than intended.
 *
 * Suites need it because a fixture has to start somewhere, and building one through a real
 * read would make every suite that consumes a `Finalized<T>` depend on the transport, the
 * codecs and a recorded transcript — so a bug in any of those would make those suites agree
 * with it rather than catch it.
 *
 * `readmitFromLeader` is deliberately **not** the answer for fixtures even though it is
 * reachable from the barrel and does return a brand. It is the 10 §4.4 trust decision, and
 * a suite reaching for it would be asserting through a production path whose preconditions
 * it has to fake anyway — while quietly teaching the next reader that re-admission is the
 * ordinary way to obtain a `Finalized<T>`.
 */

export { finalize } from './provenance.js';
