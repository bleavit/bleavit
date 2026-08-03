// MUST FAIL: the package `exports` map admits "." and "./testing" only, so a deep
// path into the construction site is unreachable.
import { finalize } from '@bleavit/chain-client/src/provenance.js';
export const x = finalize;
