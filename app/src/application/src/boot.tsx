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
import { Outlet, screenFor } from './routes.js';
import { implementedScreens } from './composition.js';

/**
 * What the shell shows before anything has been read: nothing, said out loud.
 *
 * This used to build a sentinel — `{ kind: 'verified-best', chain: '0x', blockHash: '0x',
 * blockNumber: 0 }` — and hang `0`, `'connecting…'` and `0` off it, with a comment arguing
 * that `verified-best` at height 0 "says" an unfinished read. It does not. INV-FE-9 defines
 * `verified-best` as *"unfinalized/best-head data"* and 10 §2.1 lists it as a light-client
 * read that may still reorg; nothing had been read here at all, on any chain, so the status
 * was a false statement and the zeros were values the client invented. That it was inert —
 * `combineStatus` refuses the empty chain id — made it harmless downstream without making it
 * true on screen, and the screen is where a badge is read.
 *
 * The repair is that the model now admits absence, so the pre-read state has a way to be
 * itself: every field is `undefined` and `EpochHeader` renders a sentence rather than a
 * number. `phaseFlags` was already `undefined` here, which is what makes the sudo banner show
 * during sync — the other three now say the same thing about themselves.
 */
function initialChainState(): ShellChainState {
  return {
    epoch: undefined,
    phaseLabel: undefined,
    finalizedHeight: undefined,
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
  // The composition root lives in `composition.tsx` — the only place the three compilation
  // units meet. It is a map rather than an import inside `routes.tsx` because `tx` and
  // `handoff` may not see each other (10 §10.2); assembling it at the top level is what
  // keeps that true while still letting one outlet render either unit's screens.
  const implemented = implementedScreens();
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
