/**
 * The `@bleavit/protocol` differential against the reference corpus — 04 §5, 15 §4.8.
 *
 * 04 §5 rule 2 is the obligation this file discharges: the frontend's port
 * "differential-tests against V1–V6 *and* the JSON corpus". The bounds are
 * 04 §4's and are asserted as stated there — relative for `exp2`, 2 ulp
 * absolute for `log2`/`ln`, 8 ulp for a marginal price, and `8·2⁻⁶⁴·b` for a
 * cost — not as a single hand-picked tolerance, because the four bounds
 * differ by orders of magnitude and the loosest would hide a violation of
 * the tightest.
 *
 * **Nothing here restates a number from the corpus.** Every expectation is
 * either read from the file or derived from a spec identity. A test that
 * hardcodes what the implementation happens to produce agrees with a wrong
 * value as readily as a right one, and the standing justification is in this
 * repository's own history: the hand-computed V1 that shipped in the superseded
 * spec was wrong by ~14 orders of magnitude above the §4 bound, and every test
 * pinned to it passed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LMSR_DOMAIN_BOUND,
  ProtocolError,
  exp2,
  exp2Negative,
  fromInteger,
  fromRaw,
  ln,
  lmsrBuyCost,
  lmsrCost,
  lmsrDisplacementBetweenPrices,
  lmsrDisplacementCost,
  lmsrPriceLong,
  lmsrPriceShort,
  lmsrSellProceeds,
  log2,
  makerWorstCaseLoss,
  toRaw,
} from '@bleavit/protocol';
import type { Fixed, LmsrSide } from '@bleavit/protocol';

import { absDiff, bigFrom, catchThrown, decimalToRaw64x64, loadCorpus } from './corpus.ts';

const corpus = loadCorpus();

/** 04 §4: `log2`/`ln` ≤ 2 ulp absolute; kernel primitives share the bound. */
const PRIMITIVE_MAX_ULP = 2n;
/** 04 §4: marginal price ≤ 8 ulp absolute. */
const PRICE_MAX_ULP = 8n;

/**
 * 04 §4's per-trade bound, in ulp: "per-trade cost error ≤ 8·2⁻⁶⁴·b USDC".
 *
 * The scaling by `b` is not slack, it is the arithmetic. Every cost is
 * `max(q) + b · ln(…)`, so the ≤ 2 ulp of the `ln` is multiplied by `b` on its
 * way into the result; a flat 8-ulp bound would be unmeetable by any
 * implementation, including the runtime's. What 04 §4 goes on to say is the
 * part that matters economically: `8·2⁻⁶⁴·b` stays below one USDC base unit
 * for every `b ≤ 10⁹` USDC, so the whole error band is invisible at the
 * currency grid where the charge is actually taken.
 */
function costUlpBound(bWholeUsdc: bigint): bigint {
  return 8n * BigInt(bWholeUsdc);
}

const B_10K_WHOLE = 10_000n;
const B_10K = fromInteger(B_10K_WHOLE);
const B_10K_COST_ULP = costUlpBound(B_10K_WHOLE);

/** Whole USDC as 64.64, the unit every LMSR entry point takes. */
function usdc(text: string | number): Fixed {
  return fromRaw(decimalToRaw64x64(String(text)));
}

/**
 * A corpus `side` field as the kernel's own `LmsrSide`.
 *
 * Checked rather than asserted, because the kernel branches on
 * `side === 'long'` and treats everything else as SHORT. A corpus regenerated
 * with `"LONG"` would therefore quote the *opposite* side, and V6 — a refusal
 * test — would still see a refusal and still pass, having exercised a trade it
 * was not written to exercise.
 */
function lmsrSide(text: string): LmsrSide {
  if (text !== 'long' && text !== 'short') {
    throw new Error(`the corpus states side ${JSON.stringify(text)}; the kernel knows long/short`);
  }
  return text;
}

function assertWithinUlp(actual: bigint, expected: bigint, maxUlp: bigint, what: string): void {
  const delta = absDiff(actual, expected);
  assert.ok(
    delta <= maxUlp,
    `${what}: ${delta} ulp from the reference (bound ${maxUlp}). ` +
      `actual=${actual} expected=${expected}`,
  );
}

test('the corpus is present, current, and not empty', () => {
  // Anti-vacuity. Every assertion below iterates a corpus array; if the file
  // were empty or reshaped, those loops would pass by running zero times.
  assert.equal(corpus.schema, 'bleavit.reference-model.v4');
  assert.ok(corpus.lmsr_vectors, 'lmsr_vectors missing');
  assert.ok(corpus.high_precision_corpus.samples.length > 0, 'no high-precision samples');
  assert.equal(
    corpus.transcendental_corpus.rows.length,
    corpus.transcendental_corpus.count,
    'the transcendental corpus disagrees with its own declared count',
  );
  assert.ok(
    corpus.transcendental_corpus.count >= 1000,
    `04 §4 requires ≥ 10³ adversarial points; the corpus carries ${corpus.transcendental_corpus.count}`,
  );
});

test('V1 — cost of buying 1,000 LONG from the symmetric start', () => {
  const { V1 } = corpus.lmsr_vectors;
  const cost = lmsrBuyCost(fromInteger(0n), fromInteger(0n), B_10K, 'long', usdc(1000));
  assertWithinUlp(toRaw(cost), bigFrom(V1.raw_64x64_nearest), B_10K_COST_ULP, 'V1 cost');
  // The decimal projection and the raw integer are two spellings of one value;
  // checking both catches a corpus row whose halves disagree.
  assertWithinUlp(toRaw(cost), decimalToRaw64x64(V1.value), B_10K_COST_ULP, 'V1 cost (decimal)');
});

test('V2 — marginal price after V1', () => {
  const { V2 } = corpus.lmsr_vectors;
  const price = lmsrPriceLong(usdc(1000), fromInteger(0n), B_10K);
  assertWithinUlp(toRaw(price), bigFrom(V2.raw_64x64_nearest), PRICE_MAX_ULP, 'V2 price');

  // p_L + p_S = 1 exactly: the short side is defined as the complement, so a
  // drift here would mean the subtraction itself is wrong.
  const short = lmsrPriceShort(usdc(1000), fromInteger(0n), B_10K);
  assert.equal(toRaw(price) + toRaw(short), toRaw(fromInteger(1n)), 'p_L + p_S ≠ 1');
});

test('V3 — displacing the price from 0.50 to 0.60', () => {
  const { V3 } = corpus.lmsr_vectors;
  const delta = lmsrDisplacementBetweenPrices(B_10K, usdc('0.5'), usdc('0.6'));
  const cost = lmsrDisplacementCost(B_10K, usdc('0.5'), usdc('0.6'));
  assertWithinUlp(toRaw(delta), decimalToRaw64x64(V3.delta), B_10K_COST_ULP, 'V3 delta');
  assertWithinUlp(toRaw(cost), decimalToRaw64x64(V3.cost), B_10K_COST_ULP, 'V3 cost');

  // The price-expressed and quantity-expressed forms are the same trade. Buying
  // `delta` from the symmetric start must cost what the displacement costs — the
  // agreement 04 §3 asserts between its two formulations.
  const byQuantity = lmsrBuyCost(fromInteger(0n), fromInteger(0n), B_10K, 'long', delta);
  assertWithinUlp(toRaw(byQuantity), toRaw(cost), B_10K_COST_ULP, 'V3 forms disagree');
});

test('V4 — worst-case maker loss is b·ln 2, which is also the seeded headroom', () => {
  const { V4 } = corpus.lmsr_vectors;
  const loss = makerWorstCaseLoss(B_10K);
  assertWithinUlp(toRaw(loss), bigFrom(V4.raw_64x64_nearest), B_10K_COST_ULP, 'V4 loss');

  // 04 §6.3: the same number is `C(0,0)`, which is why the book is solvent by
  // construction. Deriving it a second way pins the identity rather than the digits.
  const costAtOrigin = lmsrCost(fromInteger(0n), fromInteger(0n), B_10K);
  assertWithinUlp(toRaw(costAtOrigin), toRaw(loss), B_10K_COST_ULP, 'C(0,0) ≠ b·ln 2');
});

test('V5 — a round trip returns the cost, and the loss is exactly the two fees', () => {
  const { V1, V5 } = corpus.lmsr_vectors;
  const cost = lmsrBuyCost(fromInteger(0n), fromInteger(0n), B_10K, 'long', usdc(1000));
  // Path independence: selling back from the post-trade state returns the state
  // to the origin, so the proceeds equal the cost before fees.
  const proceeds = lmsrSellProceeds(usdc(1000), fromInteger(0n), B_10K, 'long', usdc(1000));
  assertWithinUlp(
    toRaw(proceeds),
    decimalToRaw64x64(V5.proceeds_before_fees),
    B_10K_COST_ULP,
    'V5 proceeds',
  );
  assertWithinUlp(toRaw(proceeds), toRaw(cost), 0n, 'V5 round trip is not path-independent');
  assertWithinUlp(
    toRaw(proceeds),
    bigFrom(V1.raw_64x64_nearest),
    B_10K_COST_ULP,
    'V5 proceeds ≠ V1 cost',
  );

  // The net is fees only, and the corpus states it as a negative decimal.
  // Derived from V1 and the 30 bps rate rather than copied: 2 × fee.
  const netRaw = decimalToRaw64x64(V5.net_fees_only);
  assert.ok(netRaw < 0n, 'V5 net must be a loss');
  const feeTwice = (decimalToRaw64x64(V1.value) * 2n * 30n) / 10_000n;
  assertWithinUlp(-netRaw, feeTwice, B_10K_COST_ULP, 'V5 net is not two 30 bps fees');
});

test('V6 — a trade leaving the price domain is refused, and the edge itself is not', () => {
  const { V6 } = corpus.lmsr_vectors;
  const b = usdc(V6.b);
  const qLong = usdc(V6.q_long);
  const qShort = usdc(V6.q_short);

  // The stated state sits exactly on the bound and must be evaluable: 48·b is
  // inside the domain, and a client that refused it would refuse a book the
  // chain is happily quoting.
  assert.equal(toRaw(qLong), toRaw(b) * LMSR_DOMAIN_BOUND, 'V6 state is not the exact edge');
  assert.doesNotThrow(() => lmsrCost(qLong, qShort, b));

  const error = catchThrown(() => lmsrBuyCost(qLong, qShort, b, lmsrSide(V6.side), usdc(V6.amount)));
  assert.ok(error instanceof ProtocolError, `V6 refused with ${error}`);
  assert.equal(error.code, V6.error);
});

test('the high-precision corpus reproduces cost and price at every sampled state', () => {
  const samples = corpus.high_precision_corpus.samples;
  const b = usdc(corpus.high_precision_corpus.b);
  let checked = 0;
  for (const sample of samples) {
    const qLong = usdc(sample.q_long);
    const qShort = usdc(sample.q_short);
    const where = `q=(${sample.q_long}, ${sample.q_short})`;

    assertWithinUlp(
      toRaw(lmsrCost(qLong, qShort, b)),
      bigFrom(sample.cost_raw_64x64_nearest),
      B_10K_COST_ULP,
      `cost at ${where}`,
    );
    assertWithinUlp(
      toRaw(lmsrPriceLong(qLong, qShort, b)),
      bigFrom(sample.price_raw_64x64_nearest),
      PRICE_MAX_ULP,
      `price at ${where}`,
    );
    checked += 1;
  }
  assert.equal(checked, samples.length);
});

test('the cost function is symmetric under swapping the two sides', () => {
  // Not in the corpus as an assertion, but implied by every mirrored pair in
  // it: C(a,b) = C(b,a). The corpus carries such pairs, so a violation would
  // also break the row above — this states the property directly.
  const b = usdc(10_000);
  // Declared as tuples: under `noUncheckedIndexedAccess` a `bigint[][]` element
  // destructures to `bigint | undefined`, so a row of the wrong arity would be
  // a runtime surprise rather than a compile error.
  const mirroredPairs: ReadonlyArray<readonly [bigint, bigint]> = [
    [2500n, 0n],
    [12345n, 6789n],
    [240_000n, 0n],
  ];
  for (const [long, short] of mirroredPairs) {
    const forward = lmsrCost(fromInteger(long), fromInteger(short), b);
    const mirrored = lmsrCost(fromInteger(short), fromInteger(long), b);
    assert.equal(toRaw(forward), toRaw(mirrored), `C(${long},${short}) ≠ C(${short},${long})`);
  }
});

test('the transcendental corpus holds to the 04 §4 error bounds', () => {
  const { rows, exp2_relative_bound, primitive_abs_ulp_bound } = corpus.transcendental_corpus;

  // The corpus states its own bounds; read them rather than assume them, then
  // assert they are the ones 04 §4 fixes. A silently loosened corpus bound
  // would otherwise loosen this suite with it.
  assert.equal(exp2_relative_bound, '2**-63');
  assert.equal(bigFrom(primitive_abs_ulp_bound), PRIMITIVE_MAX_ULP);

  const seen = { exp2: 0, log2: 0, ln: 0 };
  for (const row of rows) {
    const input = fromRaw(bigFrom(row.in));
    const expected = bigFrom(row.out);
    switch (row.f) {
      case 'exp2': {
        const actual = toRaw(exp2(input));
        // relative error ≤ 2⁻⁶³  ⟺  |actual − expected| · 2⁶³ ≤ expected
        assert.ok(
          absDiff(actual, expected) * (1n << 63n) <= expected,
          `exp2(${row.in}) relative error exceeds 2⁻⁶³: ${actual} vs ${expected}`,
        );
        seen.exp2 += 1;
        break;
      }
      case 'log2': {
        assertWithinUlp(toRaw(log2(input)), expected, PRIMITIVE_MAX_ULP, `log2(${row.in})`);
        seen.log2 += 1;
        break;
      }
      case 'ln': {
        assertWithinUlp(toRaw(ln(input)), expected, PRIMITIVE_MAX_ULP, `ln(${row.in})`);
        seen.ln += 1;
        break;
      }
      default:
        assert.fail(`unknown corpus function ${row.f} — this suite must be widened before it passes`);
    }
  }
  assert.equal(seen.exp2 + seen.log2 + seen.ln, rows.length);
  for (const [name, count] of Object.entries(seen)) {
    assert.ok(count > 0, `the corpus exercised no ${name} rows`);
  }
});

test('the exp2 negative path is the reciprocal of the positive one', () => {
  // `exp2Negative` exists so the `[1,2)` kernel serves both signs with no
  // reciprocal division. The identity `2^x · 2^-x = 1` is what makes that
  // sound — but the bound it can be held to is *derived*, not chosen, and it
  // widens with x for a reason worth stating: `2^-x` in 64.64 has roughly
  // `64 − x` significant bits, so at x = 31.5 the operand itself carries only
  // ~32, and no arithmetic downstream can recover what the representation
  // never held. This is the same fact 04 §4 encodes by bounding `exp2`
  // *relatively* rather than absolutely.
  const one = toRaw(fromInteger(1n));
  let checked = 0;
  for (const value of ['0.5', '1', '3.25', '10.125', '31.5']) {
    const x = fromRaw(decimalToRaw64x64(value));
    const negative = toRaw(exp2Negative(x));
    const product = (toRaw(exp2(x)) * negative) >> 64n;
    // relative error ≤ 2⁻⁶³ (from exp2) + 1 ulp / |2^-x| (from exp2Negative),
    // scaled back onto the 64.64 grid, plus one for the final truncation.
    const bound = 2n + (1n << 64n) / negative + 1n;
    assertWithinUlp(product, one, bound, `2^${value} · 2^-${value} ≠ 1`);
    checked += 1;
  }
  assert.equal(checked, 5);
});
