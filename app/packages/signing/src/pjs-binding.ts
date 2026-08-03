/**
 * The one module that names `polkadot-api/pjs-signer` — 11 §11.3 (V-96).
 *
 * Everything in `injected.ts` is written against structural types; this binds them to the
 * real ones, so a stack drift breaks the *build* rather than surfacing as a runtime error
 * in front of a user holding a hardware wallet. It is the `light-client.ts` pattern, and
 * it is also what keeps the firewall exemption honest: `packages/signing` may reach
 * `polkadot-api/pjs-signer` and nothing else under `polkadot-api`, enforced by
 * `signing-may-only-reach-the-signer-surface`.
 *
 * The assignment below is the whole point. If PAPI's `getInjectedExtensions` or
 * `connectInjectedExtension` change shape, `PjsSignerApi` stops being satisfied here and
 * `tsc -b` fails — which is the only check that can notice, since no test in this repo can
 * install a browser extension.
 */

import { connectInjectedExtension, getInjectedExtensions } from 'polkadot-api/pjs-signer';

import type { PjsSignerApi } from './injected.js';

/** The real pjs-signer entry points, checked against the structural surface. */
export const PJS: PjsSignerApi = {
  getInjectedExtensions,
  connectInjectedExtension,
};
