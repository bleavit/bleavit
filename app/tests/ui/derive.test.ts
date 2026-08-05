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
import type { Combined, HexString, Verified, VerificationStatus } from '@bleavit/shared-types';
import { Derived } from '@bleavit/ui';

// Annotated, not inferred. Without the annotation every `kind` widens to `string` and the
// fixtures stop being `VerificationStatus` at all — the same widening that silently turned a
// discriminant into a plain string in the handoff suites.
const AT = (n: number, hash: HexString): VerificationStatus =>
  ({ kind: 'verified-finalized', blockHash: hash, blockNumber: n });
const BEST = (n: number, hash: HexString): VerificationStatus =>
  ({ kind: 'verified-best', blockHash: hash, blockNumber: n });
const PROVIDER: VerificationStatus = { kind: 'provider', providerId: 'p', sampled: false };
const STALE: VerificationStatus = { kind: 'stale-cache', asOfBlock: 10, ageMs: 5_000 };
const LOCAL: VerificationStatus = {
  kind: 'derived-local',
  // `CoverageRef` is `{ranges, holes}` of `{fromBlock, toBlock}`. This fixture said
  // `{from, to}` — a shape the client never produces, so every assertion that reached
  // through it was reading a coverage record the type does not admit.
  coverage: { ranges: [{ fromBlock: 1, toBlock: 2 }], holes: [] },
};
const PROPOSAL: VerificationStatus = { kind: 'external-proposal' };

/**
 * Narrow `combineStatus`'s union to the arm the test expects.
 *
 * `assert.equal(result.kind, 'stated')` does not narrow — it is not an assertion signature —
 * so every `result.status` after one was reaching into an arm TypeScript could not see. The
 * helpers are also better tests than the pattern they replace: when the wrong arm comes back
 * they report the refusal's **own reason**, where `assert.equal('incomparable', 'stated')`
 * reports only that two strings differ and leaves the diagnosis to a rerun.
 */
function stated(result: ReturnType<typeof combineStatus>): VerificationStatus {
  assert.ok(
    result.kind === 'stated',
    `expected a statable status, got incomparable: ${result.kind === 'incomparable' ? result.reason : ''}`,
  );
  return result.status;
}

// Widened to the refusing arm alone, so it serves `combineStatus` and `combine`/`combine2`
// alike: what a caller asserts here is the refusal, and the two unions' `stated` arms differ
// only in what they carry, which this helper never reads.
function incomparable(
  result: { readonly kind: 'stated' } | { readonly kind: 'incomparable'; readonly reason: string },
): string {
  assert.ok(result.kind === 'incomparable', 'expected a refusal; the inputs combined');
  return result.reason;
}

function statedDatum<T>(result: Combined<T>): Verified<T> {
  assert.ok(
    result.kind === 'stated',
    `expected a value, got incomparable: ${result.kind === 'incomparable' ? result.reason : ''}`,
  );
  return result.datum;
}

test('two finalized reads at the same block combine, keeping that block', () => {
  const status = stated(combineStatus([AT(100, '0xaa'), AT(100, '0xaa')]));
  assert.equal(status.kind, 'verified-finalized');
  assert.deepEqual(status, { kind: 'verified-finalized', blockHash: '0xaa', blockNumber: 100 });
});

test('a provider input makes the result provider — never the verified input’s badge', () => {
  // The whole reason the module exists. `limit` verified, `used` from a provider: the
  // difference is not a verified fact, and rendering it as one is the promotion INV-FE-1
  // forbids.
  assert.equal(stated(combineStatus([AT(100, '0xaa'), PROVIDER])).kind, 'provider');
});

test('the weakest input wins across every pair, in the declared order', () => {
  const order: readonly VerificationStatus[] = [
    AT(1, '0xaa'), BEST(1, '0xaa'), LOCAL, STALE, PROVIDER, PROPOSAL,
  ];
  // Iterated by entry rather than by index: under `noUncheckedIndexedAccess` `order[i]` is
  // possibly-undefined, and the expected value is `i >= j ? a : b` anyway — which says the
  // rule (*later in the list is weaker*) instead of recomputing it with `Math.max`.
  for (const [i, a] of order.entries()) {
    for (const [j, b] of order.entries()) {
      assert.equal(
        stated(combineStatus([a, b])).kind,
        (i >= j ? a : b).kind,
        `combining ${a.kind} with ${b.kind} must yield the weaker`,
      );
    }
  }
});

test('two verified reads at DIFFERENT blocks refuse — no status can express that value', () => {
  assert.match(incomparable(combineStatus([AT(100, '0xaa'), AT(120, '0xbb')])), /different blocks/);
});

test('finalized and best at the same hash combine to the weaker, not to incomparable', () => {
  // A block read while best and again after finalization is *one* block. Refusing here would
  // make the common case unrenderable and teach callers to route around the rule.
  assert.equal(stated(combineStatus([AT(100, '0xaa'), BEST(100, '0xaa')])).kind, 'verified-best');
});

test('an unverified input suppresses the block check rather than forcing incomparable', () => {
  // Once the answer is unverified it asserts nothing about a block, so differing blocks among
  // the verified inputs cannot falsify it. Refusing here would be fail-closed theatre that
  // hides an ordinary provider figure.
  assert.equal(
    stated(combineStatus([AT(100, '0xaa'), AT(120, '0xbb'), PROVIDER])).kind,
    'provider',
  );
});

test('zero inputs refuse — a fold over nothing would return the STRONGEST status', () => {
  assert.ok(incomparable(combineStatus([])).length > 0, 'the refusal carried no reason');
});

test('combine2 computes the value and carries the combined status', () => {
  const a = { value: 500, status: AT(9, '0xaa') };
  const b = { value: 120, status: AT(9, '0xaa') };
  const datum = statedDatum(combine2(a, b, (x: number, y: number) => x - y));
  assert.equal(datum.value, 380);
  assert.equal(datum.status.kind, 'verified-finalized');
});

test('combine2 refuses across blocks even though the arithmetic would succeed', () => {
  const a = { value: 500, status: AT(9, '0xaa') };
  const b = { value: 120, status: AT(11, '0xbb') };
  const result = combine2(a, b, (x: number, y: number) => x - y);
  assert.match(incomparable(result), /different blocks/);
  // `in`, not `=== undefined`: the refusing arm has no `datum` **field**, which is stronger
  // than its value being undefined and is what stops a caller reading through the refusal.
  assert.equal('datum' in result, false, 'the refusal carried a datum');
});

test('combine attaches an already-computed value', () => {
  const datum = statedDatum(combine(7n, [AT(1, '0xaa'), STALE]));
  assert.equal(datum.value, 7n);
  assert.equal(datum.status.kind, 'stale-cache');
});

// ---------------------------------------------------------------------------
// <Derived> — both arms must reach the screen.
// ---------------------------------------------------------------------------

test('Derived renders the value with its badge when statable', () => {
  const combined = combine2(
    { value: 500, status: AT(9, '0xaa') },
    { value: 120, status: AT(9, '0xaa') },
    (x: number, y: number) => x - y,
  );
  const markup = renderToStaticMarkup(
    h(Derived<number>, { combined, render: (v: number) => String(v), name: 'blocks remaining' }),
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
    (x: number, y: number) => x - y,
  );
  const markup = renderToStaticMarkup(h(Derived<number>, { combined, render: (v: number) => String(v) }));
  assert.match(markup, /Not available/);
  assert.match(markup, /different blocks/);
  // And emphatically not the number it would have computed.
  assert.doesNotMatch(markup, /380/);
});

test('Derived never renders a badge on the incomparable arm', () => {
  // A badge is a claim about provenance; there is no provenance to claim here, and a
  // `verified` badge beside "Not available" would be worse than either alone.
  const combined: Combined<number> = { kind: 'incomparable', reason: 'test reason' };
  const markup = renderToStaticMarkup(
    h(Derived<number>, { combined, render: (v: number) => String(v) }),
  );
  assert.doesNotMatch(markup, /badge/);
});
