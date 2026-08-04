/**
 * Mount the shell — F7.
 *
 * ## Why this is not in `main.ts`
 *
 * F11 wrote `boot` into `main.ts` alongside a top-level `document.getElementById('app')`,
 * and `index.ts` re-exported it. That makes the package's *library* surface execute a
 * browser bootstrap at import: `await import('@bleavit/application')` in Node throws
 * `ReferenceError: document is not defined` before a single test runs. It was invisible
 * while nothing imported the package, and the first thing that did — F7's own suite —
 * failed on it immediately.
 *
 * So the two are separated by role, which is what the module comment in `main.ts` already
 * said they were: `main.ts` is the side-effect entry Vite builds and nothing imports, and
 * this file is a function.
 *
 * ## The initial state is "not read yet", and that is not a placeholder
 *
 * The shell renders before any chain read completes. `bootstrapPhase: undefined` is the
 * honest description of that moment, and `sudoBannerFor` treats it as INV-FE-12 requires —
 * the banner shows, with copy saying the phase could not be established. A client that
 * showed a clean header until the first read landed would be asserting post-sudo
 * governance for as long as the light client takes to sync, which on a cold start is the
 * longest and least attended part of a session.
 */

import { mount as mountTree } from '@bleavit/ui';
import { registerReleaseWorker, type WorkerStatus } from './release-worker.js';
import { Shell, type ShellChainState } from './shell.js';
import { SCREENS } from './screens.js';

/**
 * What the shell shows before anything has been read.
 *
 * Every field is `stale-cache`-free and `provider`-free by construction: there is nothing
 * to be stale about yet. `verified-best` is the honest status for a value the client has
 * not obtained — except there is no such value, so the header renders zeros badged as
 * *unread*. Modelled as `external-proposal`? No: nothing external proposed them. They are
 * simply absent, and the header renders them as an unfinished read at block 0, which is
 * what `verified-best` at height 0 says.
 */
function initialChainState(): ShellChainState {
  const unread = { kind: 'verified-best', blockHash: '0x', blockNumber: 0 } as const;
  return {
    epoch: { value: 0, status: unread },
    phaseLabel: { value: 'connecting…', status: unread },
    finalizedHeight: { value: 0, status: unread },
    // Unread, not post-sudo. This is what makes the banner show during sync.
    bootstrapPhase: undefined,
  };
}

/** The screen named by the current hash, or the first primary one. */
export function screenForHash(hash: string, handoffEnabled: boolean): string {
  const match = SCREENS.find((screen) => screen.path === hash);
  if (match !== undefined) return match.id;
  return handoffEnabled ? 'S21' : 'S2';
}

export async function boot(container: Element): Promise<WorkerStatus> {
  const handoffEnabled = true;
  const active = screenForHash(globalThis.location?.hash ?? '', handoffEnabled);
  mountTree(
    container,
    <Shell chain={initialChainState()} handoffEnabled={handoffEnabled} activeScreen={active}>
      <p className="shell__pending">
        Connecting to the chain with this device’s own light client. Nothing on this screen is
        a chain reading until it carries a badge saying so.
      </p>
    </Shell>,
  );
  // Registered after the tree is up: a release-worker failure must not stop the app
  // rendering, since the verification panel is one of the things that still renders when
  // smoldot never starts (10 §3.2).
  return registerReleaseWorker();
}
