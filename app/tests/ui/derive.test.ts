/**
 * Provenance arithmetic — `@bleavit/shared-types`' `combine`, and `ui`'s `Derived`.
 *
 * The rule under test is one sentence: **a value derived from several reads is never stronger
 * than its weakest input, and two verified reads at different blocks do not combine at all.**
 *
 * It exists because the client had two sites writing the result out by hand and carrying one
 * input's status, which promotes provider data to verified by arithmetic — INV-FE-1's exact
 * prohibition, reached by a route no badge type and no firewall rule can see.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { combine, combine2, combineStatus } from '@bleavit/shared-types';
import { Derived } from '@bleavit/ui';

const AT = (n, hash) => ({ kind: 'verified-finalized', blockHash: hash, blockNumber: n });
const BEST = (n, hash) => ({ kind: 'verified-best', blockHash: hash, blockNumber: n });
const PROVIDER = { kind: 'provider', providerId: 'p', sampled: false };
const STALE = { kind: 'stale-cache', asOfBlock: 10, ageMs: 5_000 };
const LOCAL = { kind: 'derived-local', coverage: { from: 1, to: 2 } };
const PROPOSAL = { kind: 'external-proposal' };

test('two finalized reads at the same block combine, keeping that block', () => {
  const result = combineStatus([AT(100, '0xaa'), AT(100, '0xaa')]);
  assert.equal(result.kind, 'stated');
  assert.equal(result.status.kind, 'verified-finalized');
  assert.equal(result.status.blockHash, '0xaa');
});

test('a provider input makes the result provider — never the verified input’s badge', () => {
  // The whole reason the module exists. `limit` verified, `used` from a provider: the
  // difference is not a verified fact, and rendering it as one is the promotion INV-FE-1
  // forbids.
  const result = combineStatus([AT(100, '0xaa'), PROVIDER]);
  assert.equal(result.kind, 'stated');
  assert.equal(result.status.kind, 'provider');
});

test('the weakest input wins across every pair, in the declared order', () => {
  const order = [AT(1, '0xaa'), BEST(1, '0xaa'), LOCAL, STALE, PROVIDER, PROPOSAL];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < order.length; j += 1) {
      const result = combineStatus([order[i], order[j]]);
      assert.equal(result.kind, 'stated', `${i},${j} should be statable`);
      assert.equal(
        result.status.kind,
        order[Math.max(i, j)].kind,
        `combining ${order[i].kind} with ${order[j].kind} must yield the weaker`,
      );
    }
  }
});

test('two verified reads at DIFFERENT blocks refuse — no status can express that value', () => {
  const result = combineStatus([AT(100, '0xaa'), AT(120, '0xbb')]);
  assert.equal(result.kind, 'incomparable');
  assert.match(result.reason, /different blocks/);
});

test('finalized and best at the same hash combine to the weaker, not to incomparable', () => {
  // A block read while best and again after finalization is *one* block. Refusing here would
  // make the common case unrenderable and teach callers to route around the rule.
  const result = combineStatus([AT(100, '0xaa'), BEST(100, '0xaa')]);
  assert.equal(result.kind, 'stated');
  assert.equal(result.status.kind, 'verified-best');
});

test('an unverified input suppresses the block check rather than forcing incomparable', () => {
  // Once the answer is unverified it asserts nothing about a block, so differing blocks among
  // the verified inputs cannot falsify it. Refusing here would be fail-closed theatre that
  // hides an ordinary provider figure.
  const result = combineStatus([AT(100, '0xaa'), AT(120, '0xbb'), PROVIDER]);
  assert.equal(result.kind, 'stated');
  assert.equal(result.status.kind, 'provider');
});

test('zero inputs refuse — a fold over nothing would return the STRONGEST status', () => {
  const result = combineStatus([]);
  assert.equal(result.kind, 'incomparable');
});

test('combine2 computes the value and carries the combined status', () => {
  const a = { value: 500, status: AT(9, '0xaa') };
  const b = { value: 120, status: AT(9, '0xaa') };
  const result = combine2(a, b, (x, y) => x - y);
  assert.equal(result.kind, 'stated');
  assert.equal(result.datum.value, 380);
  assert.equal(result.datum.status.kind, 'verified-finalized');
});

test('combine2 refuses across blocks even though the arithmetic would succeed', () => {
  const a = { value: 500, status: AT(9, '0xaa') };
  const b = { value: 120, status: AT(11, '0xbb') };
  const result = combine2(a, b, (x, y) => x - y);
  assert.equal(result.kind, 'incomparable');
  assert.equal(result.datum, undefined);
});

test('combine attaches an already-computed value', () => {
  const result = combine(7n, [AT(1, '0xaa'), STALE]);
  assert.equal(result.kind, 'stated');
  assert.equal(result.datum.value, 7n);
  assert.equal(result.datum.status.kind, 'stale-cache');
});

// ---------------------------------------------------------------------------
// <Derived> — both arms must reach the screen.
// ---------------------------------------------------------------------------

test('Derived renders the value with its badge when statable', () => {
  const combined = combine2(
    { value: 500, status: AT(9, '0xaa') },
    { value: 120, status: AT(9, '0xaa') },
    (x, y) => x - y,
  );
  const markup = renderToStaticMarkup(
    h(Derived, { combined, render: (v) => String(v), name: 'blocks remaining' }),
  );
  assert.match(markup, /380/);
  assert.match(markup, /blocks remaining/);
});

test('Derived renders the REASON when incomparable — never an empty space', () => {
  // The property that matters: a missing figure must look missing. Rendering nothing is how
  // "we cannot say" becomes indistinguishable from zero, or from still loading.
  const combined = combine2(
    { value: 500, status: AT(9, '0xaa') },
    { value: 120, status: AT(11, '0xbb') },
    (x, y) => x - y,
  );
  const markup = renderToStaticMarkup(h(Derived, { combined, render: (v) => String(v) }));
  assert.match(markup, /Not available/);
  assert.match(markup, /different blocks/);
  // And emphatically not the number it would have computed.
  assert.doesNotMatch(markup, /380/);
});

test('Derived never renders a badge on the incomparable arm', () => {
  // A badge is a claim about provenance; there is no provenance to claim here, and a
  // `verified` badge beside "Not available" would be worse than either alone.
  const combined = { kind: 'incomparable', reason: 'test reason' };
  const markup = renderToStaticMarkup(h(Derived, { combined, render: (v) => String(v) }));
  assert.doesNotMatch(markup, /badge/);
});
