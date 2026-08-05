/**
 * The positive control for `tools/check-handoff-network.ts`. NOT part of the build.
 *
 * Every primitive D-21 forbids on a handoff path appears here at least once, in the form
 * the scanner is supposed to catch, including the *evasions* an earlier version missed:
 * an alias rather than a call, a computed lookup, a call split across lines, an optional
 * call, and the two ways to build code from a string. `--witness` fails unless all of them
 * are flagged, so a pattern that quietly stops matching — a rename, a regex edit, a
 * changed file filter — shows up as a failure rather than as a cleaner-looking green run.
 *
 * It lives under `tools/fixtures/` because nothing there is in a tsconfig `include` or in
 * dependency-cruiser's scan, so this file is never compiled and never linked. If it ever
 * needs to move, the constant in the scanner moves with it — do not "tidy" it into a
 * package, where it would become the violation it exists to detect.
 */

export async function everyForbiddenPrimitive(url: string): Promise<unknown> {
  // The plain call, and the three spellings that a line-anchored call pattern missed.
  const viaFetch = await fetch(url);
  const aliased = globalThis.fetch;
  const optional = await fetch?.(url);
  const split = await fetch
    (url);

  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);

  const socket = new WebSocket(url);
  const shared = new SharedWorker(url);
  const worker = new Worker(url);
  const stream = new EventSource(url);

  navigator.sendBeacon(url, 'payload');

  importScripts(url);

  void navigator.serviceWorker;

  const dynamic = await import(url);

  // Requests wearing markup.
  const image = new Image();
  image.src = url;
  const link = document.createElement('link');
  link.href = url;

  // The two ways to spell a banned identifier without writing it.
  const computed = (globalThis as unknown as Record<string, unknown>)['fet' + 'ch'];
  const alsoComputed = navigator['connection' as keyof Navigator];
  const evaluated: unknown = eval('1 + 1');
  const constructed = new Function('return 1');

  return [viaFetch, aliased, optional, split, xhr, socket, shared, worker, stream, dynamic, image, link, computed, alsoComputed, evaluated, constructed];
}

declare function importScripts(...urls: string[]): void;

/**
 * The controls for the comment-blanking narrowing (added with `withoutComments`).
 *
 * The scanner stopped matching inside comments, because a module documenting *why* it makes
 * no network request trips its own gate on the word. That narrowing needs a control in both
 * directions, or it is one edit away from becoming a hole:
 *
 *  - a primitive named only in a comment MUST NOT be reported, and
 *  - a primitive named inside a **string** MUST still be reported.
 *
 * The second is the one that matters. Extending the blanking to string bodies would look
 * like the same cleanup and would void the gate, and the existing witness — which names
 * every primitive in *code* — would stay green through it.
 */

// A comment naming fetch, WebSocket and XMLHttpRequest. None of these may be reported.
/* Nor these, in a block comment: EventSource, sendBeacon, globalThis. */

export const NOT_INERT = 'fetch';
export const ALSO_NOT_INERT = "the string 'XMLHttpRequest' is how a computed lookup is spelled";
