/**
 * The production caller of `startLightClient` — F18.
 *
 * `chain-session.ts` holds every rule; this file holds the three values a rule cannot supply:
 * this release's pin, this build's worker source, and the function that actually names smoldot.
 *
 * ## The smoldot module is loaded lazily, and that is 10 §9.3 rather than a preference
 *
 * §9.3 budgets the chain specs and the light client as lazy, and §9.4 gives the wasm its own
 * *"(worker, lazy)"* row. A static `import { startLightClient }` here would put PAPI's smoldot
 * re-export into the entry chunk of every session, including the ones that never reach a
 * chain — and, more mundanely, into every Node suite that imports `@bleavit/application`,
 * where `tests/screens` would then evaluate a browser-only module at import time.
 *
 * So the import is dynamic and sits **inside** the injected `start`, which
 * `startChainSession` calls only after both blockers are clear. In this build they are not
 * clear, so the chunk is never fetched — which is the honest version of *"lazy"*.
 *
 * ## What this file deliberately does not do
 *
 * It does not read from a started client. Rendering live chain state needs a re-render path
 * that this build does not have — `boot.tsx` mounts once, and its own note records that the
 * §3.1 storage open has to move after the first paint for the same reason. That is F7's named
 * remainder, not this one's: what F18 owed was a light client with a caller and the funding
 * legs over it, and `funding-session.ts` is the second half.
 */

import type { LightClient } from '@bleavit/chain-client/light-client';
import { releaseChainSpecs, releaseWorkerSource } from './chain-identity.js';
import { startChainSession, type ChainSession } from './chain-session.js';

/**
 * Start this release's light client, or report why there is none.
 *
 * **Never catches `WrongChainError`.** 10 §3.1 makes `FE-BOOT-003` terminal with no override,
 * and a caller that logged it and carried on would be the boolean return `chain-spec.ts`
 * refuses to offer. The terminal screen it must become is F7's re-render path; until then the
 * rejection is loud rather than swallowed, which is the safe direction — a client that
 * silently continued past a wrong-chain verdict renders every balance as somebody else's.
 */
export async function connectChain(): Promise<ChainSession<LightClient>> {
  return startChainSession({
    specs: releaseChainSpecs(),
    worker: releaseWorkerSource(),
    start: async (options) => {
      const { startLightClient } = await import('@bleavit/chain-client/light-client');
      return startLightClient(options);
    },
  });
}
