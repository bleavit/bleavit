/**
 * The release-scoped service worker's policy — 12 §5.2 (F11).
 *
 * 12 §5.2 withdraws the claim that this worker defends against a *hostile* worker, and the
 * suite is written to the claim that survives: once an honest release is installed, the
 * bytes it serves are the bytes it published, and anything else is refused rather than
 * cached. Three properties carry that, and each fails silently if it is got wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Handling, RequestVerdict } from '@bleavit/platform';
import {
  ACTIVATE_MESSAGE,
  acceptsBytes,
  assetHashesFrom,
  classify,
  releaseScope,
  shouldActivate,
  staleCaches,
} from '@bleavit/platform';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const scope = releaseScope('TXID', assetHashesFrom({ 'index.html': HASH_A, 'assets/x.js': HASH_B }), [
  'release.json',
]);
const SW_SCOPE = new URL('https://gw.example/TXID/');

const at = (path: string): Handling => classify(new URL(path, SW_SCOPE), SW_SCOPE, scope);

/**
 * The same classification, narrowed to a request this worker answers.
 *
 * `not-mine` is a separate arm for a reason — it is not the worker's to answer at all — so
 * a test that reached `acceptsBytes` or `.path` through it would be exercising a call the
 * worker never makes. Asserting the arm first is what keeps that distinction real here.
 */
const inRelease = (path: string): RequestVerdict => {
  const verdict = at(path);
  assert.notEqual(verdict.kind, 'not-mine', `${path} was classified as none of this worker's business`);
  return verdict as RequestVerdict;
};

test('a request for a pinned asset carries the hash it must match', () => {
  assert.deepEqual(at('assets/x.js'), { kind: 'hash-pinned', path: 'assets/x.js', sha256: HASH_B });
});

test('the release directory itself resolves to index.html', () => {
  // Every gateway serves the directory as the entry document; a worker that treated the
  // bare directory as an unknown path would refuse its own application's first request.
  const entry = inRelease('');
  assert.equal(entry.kind, 'hash-pinned');
  assert.equal(entry.path, 'index.html');
});

test('a same-origin path this release does not contain is refused, not forwarded', () => {
  // A worker that forwards what it does not recognise verifies only the paths an attacker
  // chose not to invent.
  const verdict = at('assets/injected.js');
  assert.equal(verdict.kind, 'out-of-release');
  assert.equal(acceptsBytes(verdict, HASH_A), false);
});

test('release.json is served without a baked hash, and that is the stronger check', () => {
  // Its integrity is the detached minisign signature `packages/verify` checks against the
  // shipped keyring. A SHA-256 here could only have been learned from the same channel the
  // worker is trying to validate — and the two-pass deploy rewrites the file after the tree
  // it belongs to is already addressed, so no such hash can exist at build time.
  const verdict = at('release.json');
  assert.equal(verdict.kind, 'signed-metadata');
  assert.equal(acceptsBytes(verdict, 'whatever'), true);
});

test('another release directory on the same gateway is not this worker’s business', () => {
  const other = classify(new URL('https://gw.example/OTHER/index.html'), SW_SCOPE, scope);
  assert.equal(other.kind, 'not-mine');
  const cross = classify(new URL('https://elsewhere.example/TXID/index.html'), SW_SCOPE, scope);
  assert.equal(cross.kind, 'not-mine');
});

test('bytes that do not match the pinned hash are refused', () => {
  assert.equal(acceptsBytes(inRelease('assets/x.js'), HASH_B), true);
  assert.equal(acceptsBytes(inRelease('assets/x.js'), HASH_A), false);
});

test('an empty asset map is refused rather than installed', () => {
  // It would make every request `out-of-release`, so the worker fails closed — at the user,
  // as a blank page with no explanation. A substitution step that silently produced nothing
  // is caught here and by the build's placeholder gate.
  assert.throws(() => releaseScope('TXID', assetHashesFrom({}), []), /pins no asset hashes/);
  assert.throws(() => releaseScope('', assetHashesFrom({ 'a.js': HASH_A }), []), /cache name/);
});

test('the asset map is read as own-key data and rejects a non-hash value', () => {
  // A `__proto__` entry in the substituted JSON, or a value that is not a digest, would
  // otherwise make `classify` answer for a path the release never published.
  const hostile = JSON.parse(`{"__proto__": {"assets/x.js": "${HASH_A}"}, "index.html": "${HASH_A}"}`);
  // `JSON.parse` makes `__proto__` an *own* property, so it is enumerated rather than
  // silently applied — and then refused, because its value is an object rather than a
  // digest. Refusing beats skipping: a map that quietly dropped an entry would leave the
  // named path classified `out-of-release`, which is fail-closed but unexplained.
  assert.throws(() => assetHashesFrom(hostile), /not a lowercase hex/);
  assert.equal(assetHashesFrom({ 'index.html': HASH_A }).get('assets/x.js'), undefined);
  assert.throws(() => assetHashesFrom({ 'a.js': 'not-a-hash' }), /lowercase hex/);
  assert.throws(() => assetHashesFrom({ 'a.js': HASH_A.toUpperCase() }), /lowercase hex/);
});

test('activation deletes every cache that is not this release’s', () => {
  // Stated as a set difference so the rule cannot be written as "delete the previous one"
  // and quietly leave three behind.
  assert.deepEqual(staleCaches(['TXID', 'OLD-1', 'OLD-2'], scope), ['OLD-1', 'OLD-2']);
  assert.deepEqual(staleCaches(['TXID'], scope), []);
});

test('a waiting release takes over only on the explicit message, and never while pinned', () => {
  assert.equal(shouldActivate(ACTIVATE_MESSAGE, false), true);
  assert.equal(shouldActivate(ACTIVATE_MESSAGE, true), false);
  assert.equal(shouldActivate('skipWaiting', false), false);
  assert.equal(shouldActivate(undefined, false), false);
  assert.equal(shouldActivate({ type: ACTIVATE_MESSAGE }, false), false);
});
