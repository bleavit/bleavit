// expect-error: TS2307 — the `exports` map is the boundary: a deep path is not resolvable, which is 10 §10.2's primary gate — module resolution, not a lint
// MUST FAIL: the package `exports` map admits ".", "./light-client" and "./testing" only,
// so a deep path into the construction site is unreachable.
//
// This fixture covers the deep route only, and on its own it proved less than its wording
// suggested: the barrel re-exported `finalize` outright until 2026-08-05 (V-118), so the
// construction site was reachable by simply asking for it. The front door is now covered by
// `barrel-cannot-mint-finalized.ts`, and the two are only meaningful together.
import { finalize } from '@bleavit/chain-client/src/provenance.js';
export const x = finalize;
