/**
 * The page side of the release-scoped service worker — 12 §5.2, F11.
 *
 * Thin by design. The decisions live in `@bleavit/platform`'s policy; what is here is the
 * three things only the page can do: register the worker, own the user's pin, and turn an
 * explicit user action into the one message that lets a waiting release take over.
 *
 * **Registration failure is not an integrity failure.** The first load arrived from a
 * content address, and the worker's job begins after that. So a browser with service
 * workers disabled, a private window, or an insecure origin loses offline capability and
 * subsequent-fetch pinning — and is told so — rather than being blocked. The status is
 * returned rather than logged, because 12 §5.2's verification surface is the place a user
 * finds out what protections are actually running, and a `console.warn` is not that place.
 */

import { ACTIVATE_MESSAGE } from '@bleavit/platform';

/** Where the pin lives. Release-agnostic on purpose: pinning is a choice about *which*
 * release to run, so a key scoped to the current one could never express it. */
const PIN_KEY = 'bleavit.release.pinned';

export type WorkerStatus =
  | { readonly kind: 'active'; readonly waitingUpdate: boolean }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

export function isPinned(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(PIN_KEY) === 'true';
}

export function setPinned(storage: Pick<Storage, 'setItem'>, pinned: boolean): void {
  storage.setItem(PIN_KEY, pinned ? 'true' : 'false');
}

export async function registerReleaseWorker(): Promise<WorkerStatus> {
  if (!('serviceWorker' in navigator)) {
    return {
      kind: 'unavailable',
      reason:
        'this browser context has no service worker, so assets are not cached or re-checked ' +
        'after the first load; the release you loaded is unaffected',
    };
  }
  try {
    // Relative to the document, so the same bundle registers correctly at every content
    // address it is served from — `/<txid>/sw.js` on a path gateway, `/sw.js` on a
    // sandboxed subdomain. Nothing here parses a TXID out of the URL (FE-P7).
    const registration = await navigator.serviceWorker.register(
      new URL('sw.js', document.baseURI),
      { scope: new URL('./', document.baseURI).pathname },
    );
    return { kind: 'active', waitingUpdate: registration.waiting !== null };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Hand over to a waiting release. Called only from an explicit user action — 12 §5.2's
 * "activation only on explicit user action", which is why there is no `updatefound`
 * handler here that does this by itself.
 */
export async function activateWaitingRelease(storage: Pick<Storage, 'getItem'>): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const waiting = registration?.waiting;
  if (!waiting) return false;
  waiting.postMessage({ type: ACTIVATE_MESSAGE, pinned: isPinned(storage) });
  return true;
}
