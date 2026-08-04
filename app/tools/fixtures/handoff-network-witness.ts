/**
 * The positive control for `tools/check-handoff-network.mjs`. NOT part of the build.
 *
 * Every primitive D-21 forbids on a handoff path appears here exactly once, in the form
 * the scanner is supposed to catch. `--witness` fails unless all of them are flagged, so
 * a pattern that quietly stops matching — a rename, a regex edit, a changed file filter —
 * shows up as a failure rather than as a cleaner-looking green run.
 *
 * It lives under `tools/fixtures/` because nothing there is in a tsconfig `include` or in
 * dependency-cruiser's scan, so this file is never compiled and never linked. If it ever
 * needs to move, the constant in the scanner moves with it — do not "tidy" it into a
 * package, where it would become the violation it exists to detect.
 */

export async function everyForbiddenPrimitive(url: string): Promise<unknown> {
  const viaFetch = await fetch(url);

  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);

  const socket = new WebSocket(url);
  const stream = new EventSource(url);

  navigator.sendBeacon(url, 'payload');

  importScripts(url);

  void navigator.serviceWorker;

  const dynamic = await import(url);

  return [viaFetch, xhr, socket, stream, dynamic];
}

declare function importScripts(...urls: string[]): void;
