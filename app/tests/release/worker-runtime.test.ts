/**
 * The **built** service worker, executed — 12 §5.2 (F11).
 *
 * `service-worker.test.js` covers the policy: pure functions over data, where the decisions
 * live. Adversarial review pointed out what that leaves uncovered, and it is the important
 * part — *the policy is only a control if the worker calls it*. Deleting the digest check
 * from `sw.ts`, or returning a cached response without re-verifying it, left that suite
 * entirely green.
 *
 * So this file loads `dist/sw.js` — the actual IIFE the release ships — into a `vm` context
 * with a fabricated `ServiceWorkerGlobalScope`, captures the handlers it registers, and
 * drives them. What is asserted is the behaviour a gateway would meet: a tampered body, a
 * `404` carrying HTML, a forged cache entry, and a path the release does not contain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { pipeline, readBakedAssetMap } from '../../tools/release/build.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(APP_ROOT, 'dist');
const BASE = 'https://gw.example/TXID/';

// The worker under test is the one the pipeline emits, not a re-import of its source.
//
// This file and `pipeline.test.js` both build into `app/dist/`, so the suite runs with
// `--test-concurrency=1`: two `node --test` workers rebuilding the same directory in
// parallel produce a torn tree, and the resulting failure looks like a worker defect rather
// than like the harness racing itself.
pipeline();
const WORKER_SOURCE = readFileSync(join(DIST, 'sw.js'), 'utf8');
const ASSETS = readBakedAssetMap(WORKER_SOURCE);

const sha256 = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

/** A `Cache` with just enough of the API for the worker, and an escape hatch for forging. */
function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(request) {
      const hit = store.get(new URL(request.url).pathname);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      store.set(new URL(request.url).pathname, response.clone());
    },
    async delete(request) {
      return store.delete(new URL(request.url).pathname);
    },
  };
}

/**
 * Boot `dist/sw.js` with a controllable network. `serve(path)` decides what the "gateway"
 * answers, so a test can hand the worker exactly the response a hostile one would.
 */
function bootWorker(serve) {
  const handlers = new Map();
  const cache = fakeCache();
  const caches = {
    open: async () => cache,
    keys: async () => ['TXID'],
    delete: async () => true,
  };
  const context = {
    self: {
      location: { href: `${BASE}sw.js` },
      addEventListener: (type, handler) => handlers.set(type, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches,
    crypto: webcrypto,
    // The worker fetches by `Request` *and* by `URL` (`release.json` at install), and a
    // `URL` carries `href` rather than `url` — reading the wrong one turned every call into
    // `new URL(undefined)`.
    fetch: async (input) => serve(typeof input === 'string' ? input : (input.url ?? input.href)),
    Request,
    Response,
    Headers,
    URL,
    TextEncoder,
    TextDecoder,
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(WORKER_SOURCE, context);
  return { handlers, cache, context };
}

/** Drive the worker's `fetch` handler and return whatever it responded with. */
async function requestThrough(worker, path) {
  const handler = worker.handlers.get('fetch');
  assert.ok(handler, 'the built worker registers a fetch handler');
  let responded;
  handler({
    request: new worker.context.Request(new URL(path, BASE)),
    respondWith: (value) => {
      responded = value;
    },
  });
  return responded;
}

const honestGateway = async (url) => {
  const path = new URL(url).pathname.slice('/TXID/'.length) || 'index.html';
  if (path === 'release.json') {
    return new Response(JSON.stringify({ arweaveManifestTxId: 'TXID' }), { status: 200 });
  }
  try {
    return new Response(readFileSync(join(DIST, path)), { status: 200 });
  } catch {
    return new Response('missing', { status: 404 });
  }
};

test('the built worker registers install, activate, fetch and message handlers', () => {
  const worker = bootWorker(honestGateway);
  for (const type of ['install', 'activate', 'fetch', 'message']) {
    assert.ok(worker.handlers.has(type), `no ${type} handler`);
  }
});

test('an honest response for a pinned asset is served and cached', async () => {
  const worker = bootWorker(honestGateway);
  const response = await requestThrough(worker, 'index.html');
  assert.equal(response.status, 200);
  assert.equal(sha256(await response.clone().arrayBuffer()), ASSETS['index.html']);
});

test('a tampered body is refused by the worker, not merely by the policy function', async () => {
  const worker = bootWorker(async (url) =>
    new URL(url).pathname.endsWith('release.json')
      ? new Response(JSON.stringify({ arweaveManifestTxId: 'TXID' }), { status: 200 })
      : new Response('<script>stealKeys()</script>', { status: 200 }),
  );
  const response = await requestThrough(worker, 'index.html');
  assert.equal(response.status, 502);
  assert.match(await response.text(), /does not match the hash this release published/);
});

test('a 404 carrying a body is refused, because the status decides nothing about what renders', async () => {
  // The case the first draft passed straight through: a gateway answering `404` with
  // attacker-controlled HTML for `index.html` is a response the browser renders.
  const worker = bootWorker(async (url) =>
    new URL(url).pathname.endsWith('release.json')
      ? new Response(JSON.stringify({ arweaveManifestTxId: 'TXID' }), { status: 200 })
      : new Response('<h1>Enter your seed phrase</h1>', { status: 404 }),
  );
  const response = await requestThrough(worker, 'index.html');
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /seed phrase/);
});

test('a forged cache entry is re-verified on read and evicted', async () => {
  // `caches` is same-origin storage: any script on this origin can write into it. A worker
  // that trusted its own cache would serve the forgery as verified from then on.
  const worker = bootWorker(honestGateway);
  await worker.cache.put(new Request(new URL('index.html', BASE)), new Response('forged', { status: 200 }));
  const response = await requestThrough(worker, 'index.html');
  assert.equal(response.status, 502);
  assert.equal(worker.cache.store.has('/TXID/index.html'), false, 'the forgery was evicted');
});

test('a path this release does not contain is refused rather than forwarded', async () => {
  let reachedNetwork = false;
  const worker = bootWorker(async (url) => {
    if (new URL(url).pathname.endsWith('release.json')) {
      return new Response(JSON.stringify({ arweaveManifestTxId: 'TXID' }), { status: 200 });
    }
    reachedNetwork = true;
    return new Response('anything', { status: 200 });
  });
  const response = await requestThrough(worker, 'assets/injected.js');
  assert.equal(response.status, 404);
  assert.equal(reachedNetwork, false, 'the worker did not go to the network for it');
});

test('a release.json that names no manifest fails closed rather than defaulting a cache name', async () => {
  // A constant fallback name would be a cache two different releases share. The scope
  // promise rejects, so nothing is served — which is the direction that cannot leak.
  const worker = bootWorker(async () => new Response('{}', { status: 200 }));
  const handler = worker.handlers.get('fetch');
  let responded;
  handler({
    request: new worker.context.Request(new URL('index.html', BASE)),
    respondWith: (value) => {
      responded = value;
    },
  });
  await assert.rejects(responded, /arweaveManifestTxId/);
});

test('the message handler refuses activation unless `pinned` is an explicit boolean', () => {
  const worker = bootWorker(honestGateway);
  let skipped = 0;
  worker.context.self.skipWaiting = async () => {
    skipped += 1;
  };
  const message = worker.handlers.get('message');
  // The shortest message anyone would try, and the one that used to activate a *pinned*
  // release because a missing field defaulted to "not pinned".
  message({ data: { type: 'bleavit:activate-waiting-release' } });
  assert.equal(skipped, 0);
  message({ data: { type: 'bleavit:activate-waiting-release', pinned: true } });
  assert.equal(skipped, 0);
  message({ data: { type: 'bleavit:activate-waiting-release', pinned: false } });
  assert.equal(skipped, 1);
});
