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

import { mount as mountTree, type ReactNode } from '@bleavit/ui';
import { registerReleaseWorker, type WorkerStatus } from './release-worker.js';
import { Shell, type ShellChainState } from './shell.js';
import { Outlet, screenFor } from './routes.js';

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
    // Unread, not "sudo absent". This is what makes the banner show during sync.
    phaseFlags: undefined,
  };
}

/**
 * The id of the screen a hash names.
 *
 * Delegates to `screenFor` rather than repeating the lookup. The two were briefly separate
 * implementations of one rule, which is a drift waiting to happen: the navigation would
 * highlight one screen while the outlet rendered another, and both would look correct in
 * isolation.
 */
export function screenForHash(hash: string, handoffEnabled: boolean): string {
  return screenFor(hash, handoffEnabled).id;
}

export async function boot(container: Element): Promise<WorkerStatus> {
  const handoffEnabled = true;
  const hash = globalThis.location?.hash ?? '';
  const active = screenForHash(hash, handoffEnabled);
  // The composition root, and the only place the three compilation units meet. It is a map
  // rather than an import inside `routes.tsx` because `tx` and `handoff` may not see each
  // other (10 §10.2) — assembling them here is what keeps that true while still letting one
  // outlet render either. Empty for now: the screens take their models from the read layer,
  // which is wired per screen as each lands.
  const implemented: Readonly<Record<string, () => ReactNode>> = {};
  mountTree(
    container,
    <Shell chain={initialChainState()} handoffEnabled={handoffEnabled} activeScreen={active}>
      <Outlet hash={hash} handoffEnabled={handoffEnabled} implemented={implemented} />
    </Shell>,
  );
  // Registered after the tree is up: a release-worker failure must not stop the app
  // rendering, since the verification panel is one of the things that still renders when
  // smoldot never starts (10 §3.2).
  return registerReleaseWorker();
}
