// expect-error: TS2724 — the barrel withholds the mint: `finalize` is not an exported member of the package root
// MUST FAIL: the front door, tested because the side door already was.
//
// `deep-import-past-exports.ts` proves a deep path into the construction site is
// unreachable, and it has always passed. This fixture is its complement, and until 2026-08-05
// it did not exist — so the corpus asserted that `finalize` could not be obtained while the
// package barrel handed it to every caller with `export * from './provenance.js'` (V-118).
// A locked window next to an open door reads exactly like a locked house.
//
// The consumers that make this a signing defect rather than a tidiness one are
// `transaction-builder` and `signing`: both depend on `@bleavit/chain-client`, so both could
// call `finalize(anythingAtAll, {blockHash, blockNumber})` and obtain the one type the
// transaction path accepts. No assertion, so `check:casts` sees nothing; no forbidden edge,
// so dependency-cruiser sees nothing.
//
// The error code is `TS2724` rather than `TS2305` because `Finalized` is still exported and
// the compiler offers it as the near-miss. That is worth pinning: a future edit re-exporting
// `finalize` would restore the capability, and this fixture would then fail by *compiling*.
import { finalize } from '@bleavit/chain-client';
export const forged = finalize({ free: 1n }, { blockHash: '0xdead', blockNumber: 1 });
