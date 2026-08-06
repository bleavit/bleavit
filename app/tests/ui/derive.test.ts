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

/** The chain identity every verified fixture in this file is read against (F18).
 *  A named constant rather than a literal per site: the point of the field is that two
 *  reads agree on it, and copies of a hex string agree until one is edited. */
const TEST_CHAIN = `0x${'ce'.repeat(32)}` as HexString;


// Annotated, not inferred. Without the annotation every `kind` widens to `string` and the
// fixtures stop being `VerificationStatus` at all — the same widening that silently turned a
// discriminant into a plain string in the handoff suites.
const AT = (n: number, hash: HexString): VerificationStatus =>
  ({ kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: hash, blockNumber: n });
const BEST = (n: number, hash: HexString): VerificationStatus =>
  ({ kind: 'verified-best', chain: TEST_CHAIN, blockHash: hash, blockNumber: n });
const PROVIDER: VerificationStatus = { kind: 'provider', providerId: 'p', sampled: false };
const STALE: VerificationStatus = { kind: 'stale-cache', asOfBlock: 10, ageMs: 5_000 };
const LOCAL: VerificationStatus = {
  kind: 'derived-local',
  // `CoverageRef` is `{ranges, holes}`, and a range carries its **origin** — 10 §6.3 makes a
  // range boundary a rendered fact, so the field a badge needs most is the one this fixture
  // used to omit. It also said `{from, to}` once, a shape the client never produces, so every
  // assertion reaching through it was reading a coverage record the type does not admit.
  coverage: { ranges: [{ fromBlock: 1, toBlock: 2, origin: 'self' }], holes: [] },
};
const PROPOSAL: VerificationStatus = { kind: 'external-proposal' };

/**
 * Narrow `combineStatus`'s union to the arm the test expects.
 *
 * These exist for the **failure message**, not for the narrowing. When the wrong arm comes
 * back they report the refusal's own reason, where `assert.equal('incomparable', 'stated')`
 * reports only that two strings differ and leaves the diagnosis to a rerun.
 *
 * An earlier version of this comment claimed `assert.equal(result.kind, 'stated')` cannot
 * narrow. Measured under this repo's toolchain, that is wrong and worth stating precisely,
 * because it decides whether a suite needs helpers at all: **`node:assert/strict`'s `equal`
 * is an alias for `strictEqual`, which carries `asserts actual is T`, so it does narrow** —
 * while plain `node:assert`'s `equal` (`==` semantics) does not. Every suite here imports the
 * strict namespace, so the distinction never bites; it would the moment one did not.
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
  assert.deepEqual(status, { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xaa', blockNumber: 100 });
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

/* ------------------------------------------------------- F18: two chains, two lineages */

/** A second chain — Asset Hub's stand-in (02 §7.7). */
const OTHER_CHAIN = `0x${'a5'.repeat(32)}` as HexString;
const ON_OTHER = (n: number, hash: HexString): VerificationStatus =>
  ({ kind: 'verified-finalized', chain: OTHER_CHAIN, blockHash: hash, blockNumber: n });

test('two chains refuse — and at the SAME block hash, so it is the chain doing the work', () => {
  // The construction is the point. A cross-chain pair with *different* blocks is already
  // refused by the block check, so a test using one would pass with the chain check
  // deleted — it would be witnessing nothing. Holding the hash equal removes the block
  // check from the picture entirely, and the only thing left that can refuse is the chain.
  const result = combineStatus([AT(100, '0xaa'), ON_OTHER(100, '0xaa')]);
  assert.equal(result.kind, 'incomparable');
  assert.ok(
    result.kind === 'incomparable' && /different chains/.test(result.reason),
    `expected the cross-chain reason, got: ${result.kind === 'incomparable' ? result.reason : 'stated'}`,
  );
});

test('the cross-chain refusal does NOT tell the user to refresh', () => {
  // The reason is the deliverable here, not the refusal. Two chains never share a block,
  // so this pair was already being refused before F18 — with "Refresh to read them
  // together", which is advice that cannot ever succeed. A user following it retries
  // forever. Wrong advice on a real refusal is worse than a bare refusal.
  const result = combineStatus([AT(100, '0xaa'), ON_OTHER(200, '0xbb')]);
  assert.equal(result.kind, 'incomparable');
  assert.ok(
    result.kind === 'incomparable' && !/[Rr]efresh/.test(result.reason),
    'the cross-chain refusal must not suggest refreshing',
  );
});

test('same chain, different blocks still gets the refresh advice — which does work there', () => {
  // The complement, so the previous test cannot pass by the reason simply never mentioning
  // refreshing. Within one chain, reading together is exactly what fixes it.
  const result = combineStatus([AT(100, '0xaa'), AT(200, '0xbb')]);
  assert.ok(
    result.kind === 'incomparable' && /[Rr]efresh/.test(result.reason),
    'the same-chain block mismatch must still say how to fix it',
  );
});

test('an unverified input still suppresses the chain check, as it does the block check', () => {
  // A provider status carries no chain, so `chains` would be {chainA, undefined} — size 2.
  // If the chain check ran on an already-unverified result it would report "different
  // chains" for what is really just an unverified figure, replacing a correct weak badge
  // with a refusal. The guard is the same `blockOf(weakest) !== undefined` gate.
  assert.equal(stated(combineStatus([AT(100, '0xaa'), PROVIDER])).kind, 'provider');
  assert.equal(stated(combineStatus([ON_OTHER(1, '0xff'), PROVIDER])).kind, 'provider');
});
