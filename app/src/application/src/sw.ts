/**
 * The service-worker entry — 12 §5.2, F11.
 *
 * This file is deliberately thin: every decision it makes lives in `@bleavit/platform`'s
 * `service-worker` policy, where it can be tested outside a browser. What is here is the
 * IO — fetch, hash, cache, respond — and the two places where an error must not be
 * swallowed.
 *
 * It is bundled by `esbuild` as an **IIFE**, not by Vite as an ES module: module service
 * workers require `{ type: 'module' }` at registration and are not available in every
 * browser the release grid covers, and a distribution control that silently does not
 * install on a supported browser is worse than one that is a little old-fashioned.
 *
 * It is also deliberately **not minified**. It is the one file in the tree whose job is to
 * decide whether tampered bytes reach a user, so being readable at the content address it
 * was published from is a property worth three kilobytes.
 */

import {
  acceptsBytes,
  assetHashesFrom,
  classify,
  releaseScope,
  shouldActivate,
  staleCaches,
  type ReleaseScope,
} from '@bleavit/platform';

/**
 * Module-scoped, so it shadows the DOM `Window` typing of the global `self` without an
 * `as unknown as` (banned across `app/` — app-code rule 2).
 */
declare const self: ServiceWorkerGlobalScope;

/**
 * Substituted by `tools/release/build.mjs`. The token is replaced with the JSON text of
 * the release's path → SHA-256 map, escaped for a JS string literal, so the substitution
 * is quote-agnostic and survives whatever quoting style the bundler emits.
 *
 * A build that fails to substitute leaves the token here, `JSON.parse` throws, and the
 * worker never installs — which is the fail-closed direction. `release:check` also refuses
 * the tree outright, so the failure is caught before a user meets it.
 */
const RELEASE_ASSETS_JSON = '__BLEAVIT_RELEASE_ASSETS__';

/**
 * `release.json` authenticates itself with the detached minisign signatures 12 §1.1/§2.1
 * publish, verified by `packages/verify` against the shipped keyring. Pinning a SHA-256
 * for it here would be weaker, not stronger: the worker could only have learned that hash
 * from the same channel it is trying to validate, and the two-pass deploy (§1.2) rewrites
 * the file after the tree it belongs to is already addressed.
 */
const SIGNED_METADATA = ['release.json'];

const SCOPE_URL = new URL('./', self.location.href);

let scopePromise: Promise<ReleaseScope> | undefined;

/**
 * The cache name is `release.json`'s `arweaveManifestTxId` (12 §5.2), read once at install.
 * It cannot be baked: §1.2 only learns the manifest TXID after uploading the tree this
 * worker is part of, so baking it would make these bytes depend on a hash of these bytes.
 *
 * It is read without trusting it, and the distinction is the whole reason this is safe: it
 * *names a cache*, it does not *authorize a byte*. Every asset stored under it is still
 * checked against the baked map. What it must not do is fail open — an absent or malformed
 * `release.json` refuses the install rather than falling back to a constant name, because
 * a constant name is a cache two different releases would share.
 */
async function resolveScope(): Promise<ReleaseScope> {
  const assets = assetHashesFrom(JSON.parse(RELEASE_ASSETS_JSON) as Record<string, string>);
  const response = await fetch(new URL('release.json', SCOPE_URL), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`release.json is not served (${response.status}); refusing to install`);
  }
  const release: unknown = await response.json();
  const txid =
    typeof release === 'object' && release !== null && 'arweaveManifestTxId' in release
      ? (release as { arweaveManifestTxId: unknown }).arweaveManifestTxId
      : undefined;
  if (typeof txid !== 'string' || txid.length === 0) {
    throw new Error('release.json carries no arweaveManifestTxId; refusing to install');
  }
  return releaseScope(txid, assets, SIGNED_METADATA);
}

function scope(): Promise<ReleaseScope> {
  scopePromise ??= resolveScope();
  return scopePromise;
}

function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

self.addEventListener('install', (event) => {
  // No `skipWaiting()` here, and none anywhere else in this file — 12 §5.2. A new release
  // installs and waits; it takes over only when the page asks, and only if the user has
  // not pinned the one they are running.
  event.waitUntil(
    (async () => {
      const current = await scope();
      const cache = await caches.open(current.cacheName);
      // Precache by exact hashed filename, verifying as we go: a precache that trusts the
      // response is a cache primed with whatever the gateway felt like sending.
      await Promise.all(
        [...current.assets.keys()].map(async (path) => {
          const request = new Request(new URL(path, SCOPE_URL), { cache: 'no-store' });
          const response = await fetch(request);
          if (!response.ok) throw new Error(`${path} is not served (${response.status})`);
          const bytes = await response.clone().arrayBuffer();
          const digest = toHex(await crypto.subtle.digest('SHA-256', bytes));
          const verdict = classify(new URL(request.url), SCOPE_URL, current);
          if (verdict.kind === 'not-mine' || !acceptsBytes(verdict, digest)) {
            throw new Error(`${path} does not match the hash this release published`);
          }
          await cache.put(request, response);
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const current = await scope();
      const names = await caches.keys();
      await Promise.all(staleCaches(names, current).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  event.respondWith(serve(request));
});

function refused(path: string, why: string): Response {
  // Refused, not retried. Re-fetching asks the channel that just served wrong bytes for
  // better ones (INV-FE-8's never-silently-repaired rule), and caching them would make one
  // bad response permanent.
  return new Response(`${path} was refused: ${why}`, {
    status: 502,
    statusText: 'Release integrity check failed',
  });
}

async function digestOf(response: Response): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer()));
}

async function serve(request: Request): Promise<Response> {
  const current = await scope();
  const verdict = classify(new URL(request.url), SCOPE_URL, current);
  if (verdict.kind === 'not-mine') return fetch(request);
  if (verdict.kind === 'out-of-release') {
    return new Response(verdict.reason, { status: 404, statusText: 'Not part of this release' });
  }

  const cache = await caches.open(current.cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // **The cache is re-verified on read, not trusted because it is ours.** `caches` is
    // same-origin storage: any script running on this origin — an injected one, a stale tab
    // from a previous release, a devtools session — can `cache.put` a forged response into
    // it, and from then on every request for that path would be served as verified without
    // a single byte being checked. Hashing on read costs a digest per hit and removes the
    // only place in this worker where bytes could be believed on provenance rather than on
    // content.
    if (verdict.kind === 'signed-metadata' || acceptsBytes(verdict, await digestOf(cached))) {
      return cached;
    }
    await cache.delete(request);
    return refused(verdict.path, 'the cached copy does not match the hash this release published');
  }

  const response = await fetch(request, { cache: 'no-store' });
  // **A non-2xx response is refused too, and this is not pedantry.** A gateway answering
  // `404` with an attacker-controlled HTML body for `index.html` is a response the browser
  // renders — the status code decides nothing about what the user sees. Passing it through
  // unhashed would make the one path an attacker fully controls also the one path this
  // worker does not check.
  if (!response.ok) {
    return refused(verdict.path, `the server answered ${response.status} for a file this release pins`);
  }
  if (!acceptsBytes(verdict, await digestOf(response))) {
    return refused(verdict.path, 'it does not match the hash this release published');
  }
  if (verdict.kind === 'hash-pinned') await cache.put(request, response.clone());
  return response;
}

/**
 * The only path to `skipWaiting()` in this file.
 *
 * The page owns the pin (it is a `localStorage` choice the worker cannot read) and sends
 * it alongside the request. That looks redundant — a pinned page could simply not ask —
 * and it is kept because the redundancy is the point: `shouldActivate` is the one tested
 * predicate for "may this release be replaced", so both halves of the rule are stated
 * where they are enforced rather than left implicit in a caller.
 */
self.addEventListener('message', (event) => {
  const data: unknown = event.data;
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  // `pinned` must be an explicit boolean. Defaulting a missing one to `false` made
  // `{ type: ACTIVATE_MESSAGE }` — the shortest message anyone would try — replace a
  // *pinned* release, which is exactly the user statement the pin exists to protect. An
  // absent field is now a refusal, so the fail-closed direction is the one that omits.
  if (typeof record['pinned'] !== 'boolean') return;
  if (shouldActivate(record['type'], record['pinned'])) void self.skipWaiting();
});
