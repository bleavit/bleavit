// expect-error: TS2307 — the `exports` map is the boundary: a deep path is not resolvable, which is 10 §10.2's primary gate — module resolution, not a lint
// MUST FAIL: the package `exports` map admits "." and "./testing" only, so a deep
// path into the construction site is unreachable.
import { finalize } from '@bleavit/chain-client/src/provenance.js';
export const x = finalize;
