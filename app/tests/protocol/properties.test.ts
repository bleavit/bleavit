/**
 * The 15 §4.8 property obligations for the protocol port.
 *
 * That row names three by name — "cost path-independence, loss ≤ b·ln 2, slew
 * bound" — and they are the three that carry economic weight rather than
 * numerical weight: path-independence is what makes a split trade not a
 * discount, the `b·ln 2` bound is 04 §6.3's proof that a book cannot issue an
 * unbacked claim, and the slew bound is what converts price manipulation into
 * capital × time. The slew bound lives in `twap.test.js` with the rest of the
 * accumulator; the other two are here, with the base-unit rounding discipline
 * that surrounds them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ONE,
  ProtocolError,
  add,
  ensureTradeBounds,
  exp2,
  fixedToBaseUnitsDown,
  fixedToBaseUnitsUp,
  feeUp,
  fromInteger,
  fromRaw,
  isWithinDomain,
  LMSR_DOMAIN_BOUND,
  ln,
  lmsrBuyCost,
  lmsrCost,
  lmsrSellProceeds,
  log2,
  makerWorstCaseLoss,
  maxTradeAmount,
  mul,
  PRICE_ONE_1E9,
  quoteBuy,
  quoteSell,
  sub,
  toRaw,
  USDC_ONE,
  withinTradeBounds,
} from '@bleavit/protocol';
import type { Fixed, LmsrSide } from '@bleavit/protocol';

import { absDiff, catchThrown, decimalToRational, loadCorpus } from './corpus.ts';

const corpus = loadCorpus();

const COMPOSED_MAX_ULP = 8n;
const B_10K_UNITS = 10_000n * USDC_ONE;

/** Launch values, passed in as the chain publishes them — never defaulted (02 §9). */
const LAUNCH_BOUNDS = {
  minTrade: 1n * USDC_ONE,
  maxTradeNumerator: 1n,
  maxTradeDenominator: 4n,
};
const LAUNCH_FEE_BPS = 30n;

function usdcFixed(whole: bigint | number): Fixed {
  return fromInteger(BigInt(whole));
}

// ---------------------------------------------------------------------------
// Cost path-independence (15 §4.8)
// ---------------------------------------------------------------------------

test('path-independence: reaching a state in steps costs exactly what reaching it at once costs', () => {
  const b = usdcFixed(10_000);
  const start = { long: 0n, short: 0n };

  // The cost function telescopes: each step is C(after) − C(before), so a
  // sequence of steps sums to C(final) − C(initial) with no residue. In integer
  // arithmetic that is an exact equality, not an approximate one, and asserting
  // it approximately would hide a subtraction bug worth ulps.
  const single = lmsrBuyCost(usdcFixed(start.long), usdcFixed(start.short), b, 'long', usdcFixed(1000));

  let stepped = 0n;
  let long = start.long;
  for (const step of [100n, 250n, 400n, 250n]) {
    stepped += toRaw(lmsrBuyCost(usdcFixed(long), usdcFixed(start.short), b, 'long', usdcFixed(step)));
    long += step;
  }
  assert.equal(long, 1000n, 'the steps must reach the same state');
  assert.equal(stepped, toRaw(single), 'stepped cost ≠ single cost');
});

test('path-independence: the order of interleaved long and short buys does not change the total', () => {
  const b = usdcFixed(10_000);

  function walk(steps: ReadonlyArray<readonly [LmsrSide, bigint]>) {
    let long = 0n;
    let short = 0n;
    let total = 0n;
    for (const [side, amount] of steps) {
      total += toRaw(lmsrBuyCost(usdcFixed(long), usdcFixed(short), b, side, usdcFixed(amount)));
      if (side === 'long') long += amount;
      else short += amount;
    }
    return { total, long, short };
  }

  const forward = walk([
    ['long', 300n],
    ['short', 700n],
    ['long', 200n],
    ['short', 100n],
  ]);
  const reordered = walk([
    ['short', 100n],
    ['long', 200n],
    ['short', 700n],
    ['long', 300n],
  ]);

  assert.equal(forward.long, reordered.long);
  assert.equal(forward.short, reordered.short);
  assert.equal(forward.total, reordered.total, 'LMSR cost depends on the order of trades');
});

test('a round trip returns the book to its exact starting state and cost', () => {
  const b = usdcFixed(10_000);
  for (const amount of [1n, 100n, 1000n, 2500n]) {
    const cost = lmsrBuyCost(usdcFixed(0), usdcFixed(0), b, 'long', usdcFixed(amount));
    const proceeds = lmsrSellProceeds(usdcFixed(amount), usdcFixed(0), b, 'long', usdcFixed(amount));
    assert.equal(toRaw(cost), toRaw(proceeds), `round trip at ${amount} is not path-independent`);
  }
});

test('splitting a trade is never cheaper once base-unit rounding is applied', () => {
  // The economically load-bearing form of path-independence. In exact arithmetic
  // the split and the single trade cost the same; every rounding step is
  // maker-adverse (04 §4), so in base units the split must cost at least as
  // much. If it ever cost less, splitting would be a discount and the rounding
  // rule would be pointed the wrong way.
  const book = { qLong: 0n, qShort: 0n, b: B_10K_UNITS };
  const single = quoteBuy(book, 'long', 1000n * USDC_ONE, LAUNCH_FEE_BPS, LAUNCH_BOUNDS);

  let qLong = 0n;
  let splitTotal = 0n;
  for (const step of [200n, 300n, 500n]) {
    const quote = quoteBuy(
      { qLong, qShort: 0n, b: B_10K_UNITS },
      'long',
      step * USDC_ONE,
      LAUNCH_FEE_BPS,
      LAUNCH_BOUNDS,
    );
    splitTotal += quote.total;
    qLong += step * USDC_ONE;
  }

  assert.equal(qLong, 1000n * USDC_ONE);
  assert.ok(
    splitTotal >= single.total,
    `splitting was cheaper: ${splitTotal} < ${single.total}`,
  );
  // And not cheaper by more than the rounding can account for: three ceilings on
  // the cost plus three on the fee.
  assert.ok(splitTotal - single.total <= 6n, `split premium ${splitTotal - single.total} exceeds the rounding budget`);
});

// ---------------------------------------------------------------------------
// Maker loss ≤ b·ln 2 (15 §4.8; 04 §6.3)
// ---------------------------------------------------------------------------

test('one-sided drain rises monotonically toward b·ln 2 and never passes it', () => {
  // 04 §6.3: drain(x) = Δ − [C(Δ,0) − C(0,0)] = b·[ln 2 − ln(1 + e^-x)], whose
  // supremum is b·ln 2, approached strictly from below. This is the whole
  // solvency argument — the seeded headroom is exactly b·ln 2, so a drain that
  // could *exceed* it would let a book issue a claim it cannot deliver.
  const b = usdcFixed(10_000);
  const bound = toRaw(makerWorstCaseLoss(b));

  function drainAt(x: bigint): bigint {
    const delta = usdcFixed(10_000n * x);
    return toRaw(delta) - toRaw(lmsrBuyCost(usdcFixed(0), usdcFixed(0), b, 'long', delta));
  }

  let previous = -1n;
  let checked = 0;
  for (const x of [1n, 2n, 4n, 8n, 12n, 16n, 24n, 32n, 40n]) {
    const drain = drainAt(x);
    assert.ok(drain < bound, `drain at x=${x} reached the b·ln 2 bound: ${drain} ≥ ${bound}`);
    assert.ok(drain > previous, `drain is not monotone at x=${x}`);
    previous = drain;
    checked += 1;
  }
  assert.equal(checked, 9);

  // The gap has closed to far below one USDC base unit by x = 40 — "approached
  // strictly from below" in the only sense that is observable at the currency grid.
  assert.ok(bound - previous < toRaw(fromInteger(1n)) / 1_000_000n, 'the drain does not approach b·ln 2');

  // Past x ≈ 45 the tail underflows: e^-47 ≈ 3.9 × 10⁻²¹ is below one 64.64 ulp
  // (≈ 5.4 × 10⁻²⁰), so `ln(1 + e^-x)` rounds to zero and the drain lands
  // exactly ON b·ln 2 rather than below it. That is not a defect, and it is why
  // I-12 is written `maker loss ≤ b·ln 2 + rounding_bound` while 04 §6.3's
  // derivation says `<`: the strict inequality is a statement about the reals,
  // and the grid cannot hold a difference that small. What must never happen —
  // and what is asserted here — is drain exceeding the seed.
  for (const x of [45n, 46n, 47n]) {
    const drain = drainAt(x);
    assert.ok(drain <= bound, `drain at x=${x} exceeded the seed: ${drain} > ${bound}`);
    assert.ok(drain >= previous, `drain regressed at x=${x}`);
    previous = drain;
  }
  assert.equal(previous, bound, 'the drain should saturate at exactly b·ln 2 once the tail underflows');
});

test('the maker never loses more than the seed on a walk that returns', () => {
  // A book walked out and back must end no worse than it started: the sell
  // proceeds it pays out are exactly the cost it took in.
  const b = usdcFixed(25_000);
  const out = lmsrBuyCost(usdcFixed(0), usdcFixed(0), b, 'short', usdcFixed(5000));
  const back = lmsrSellProceeds(usdcFixed(0), usdcFixed(5000), b, 'short', usdcFixed(5000));
  assert.equal(toRaw(out), toRaw(back));
});

// ---------------------------------------------------------------------------
// The kernel identities that stand in for the exp2 table's self-check
// ---------------------------------------------------------------------------

test('exp2 and log2 invert each other across the domain', () => {
  // The 64-entry factor table has no external oracle; what pins it is that its
  // entries square into one another. Through the public surface the equivalent
  // check is the round trip, which walks a different subset of table entries for
  // every input and fails at whichever row is wrong.
  let checked = 0;
  for (const raw of [
    1n << 63n, // 0.5
    1n << 64n, // 1
    (3n << 64n) / 2n, // 1.5
    (13n << 64n) / 4n, // 3.25
    10n << 64n,
    (63n << 64n) / 2n, // 31.5
  ]) {
    const x = fromRaw(raw);
    const roundTrip = log2(exp2(x));
    assert.ok(
      absDiff(toRaw(roundTrip), raw) <= COMPOSED_MAX_ULP,
      `log2(exp2(${raw})) drifted by ${absDiff(toRaw(roundTrip), raw)} ulp`,
    );
    checked += 1;
  }
  assert.equal(checked, 6);
});

test('exp2 is multiplicative, which exercises the factor table combinatorially', () => {
  // Tuples, not `bigint[][]`: `noUncheckedIndexedAccess` would otherwise
  // destructure each row to `bigint | undefined`.
  const pairs: ReadonlyArray<readonly [bigint, bigint]> = [
    [1n << 62n, 1n << 61n],
    [(5n << 64n) / 4n, (7n << 64n) / 8n],
    [3n << 64n, (11n << 64n) / 16n],
  ];
  for (const [aRaw, bRaw] of pairs) {
    const a = fromRaw(aRaw);
    const b = fromRaw(bRaw);
    const product = mul(exp2(a), exp2(b));
    const combined = exp2(add(a, b));
    assert.ok(
      absDiff(toRaw(product), toRaw(combined)) <= COMPOSED_MAX_ULP,
      `2^a · 2^b ≠ 2^(a+b) for ${aRaw}, ${bRaw}`,
    );
  }
});

test('exp2(1) is exactly 2 and ln(1) is exactly 0', () => {
  assert.equal(toRaw(exp2(fromInteger(1n))), toRaw(fromInteger(2n)));
  assert.equal(toRaw(ln(ONE)), 0n);
  assert.equal(toRaw(log2(ONE)), 0n);
});

// ---------------------------------------------------------------------------
// Rounding discipline (04 §4) and the base-unit quote pipeline (04 §6.1)
// ---------------------------------------------------------------------------

test('charges round up and payouts round down, bracketing the exact value', () => {
  // 04 §4: rounding is always maker-adverse from the trader's side. A value
  // with any fractional part must therefore ceil as a charge and floor as a
  // payout, and the two must differ by exactly one base unit.
  const withFraction = fromRaw(toRaw(fromInteger(7n)) + 1n); // 7 + 2^-64 whole USDC
  const up = fixedToBaseUnitsUp(withFraction);
  const down = fixedToBaseUnitsDown(withFraction);
  assert.equal(up - down, 1n);
  assert.equal(down, 7n * USDC_ONE);

  // An exact multiple must not be inflated: ceiling an exact value is that value.
  const exact = fromInteger(7n);
  assert.equal(fixedToBaseUnitsUp(exact), fixedToBaseUnitsDown(exact));
});

test('the fee always rounds up and is never zero on a non-zero charge', () => {
  assert.equal(feeUp(0n, 30n), 0n);
  assert.equal(feeUp(1n, 30n), 1n, 'a one-unit charge must still carry a fee');
  assert.equal(feeUp(10_000n, 30n), 30n, 'an exact multiple must not be inflated');
  assert.equal(feeUp(10_001n, 30n), 31n);
  // Monotone: a bigger charge never carries a smaller fee.
  let previous = 0n;
  for (let amount = 0n; amount < 5000n; amount += 137n) {
    const fee = feeUp(amount, 30n);
    assert.ok(fee >= previous);
    previous = fee;
  }
});

test('quoteBuy reproduces V1 in base units, derived from the corpus rather than restated', () => {
  const { numerator, denominator } = decimalToRational(corpus.lmsr_vectors.V1.value);
  // ceil(V1 · 10^6). The runtime ceils a value that has already been truncated
  // into 64.64, so the two ceilings could in principle differ — they cannot
  // here, because V1's fractional part in base units (0.1362…) is nowhere near
  // an integer boundary and the kernel's error is ≤ 8·2⁻⁶⁴.
  const scaled = numerator * USDC_ONE;
  const expectedCost = scaled / denominator + (scaled % denominator === 0n ? 0n : 1n);

  const quote = quoteBuy(
    { qLong: 0n, qShort: 0n, b: B_10K_UNITS },
    'long',
    1000n * USDC_ONE,
    LAUNCH_FEE_BPS,
    LAUNCH_BOUNDS,
  );
  assert.equal(quote.cost, expectedCost, 'the base-unit charge disagrees with V1');
  assert.equal(quote.fee, feeUp(expectedCost, LAUNCH_FEE_BPS));
  assert.equal(quote.total, quote.cost + quote.fee);
});

test('quoteSell withholds the fee from the proceeds rather than adding it', () => {
  const book = { qLong: 1000n * USDC_ONE, qShort: 0n, b: B_10K_UNITS };
  const quote = quoteSell(book, 'long', 1000n * USDC_ONE, LAUNCH_FEE_BPS, LAUNCH_BOUNDS);
  // `cost` is the gross figure in both directions, as `market-core::quote` names it.
  assert.equal(quote.net, quote.cost - quote.fee);
  assert.ok(quote.net < quote.cost, 'the fee was not withheld');

  // And a sell's proceeds must not exceed the matching buy's cost: the payout
  // floors where the charge ceils, so the maker keeps the dust either way.
  const buy = quoteBuy(
    { qLong: 0n, qShort: 0n, b: B_10K_UNITS },
    'long',
    1000n * USDC_ONE,
    LAUNCH_FEE_BPS,
    LAUNCH_BOUNDS,
  );
  assert.ok(quote.cost <= buy.cost, 'a round trip returned more than it cost');
});

test('selling more than the book holds is an arithmetic error, not a price-domain one', () => {
  // `market-core::quote` forms the post-trade quantity in base units first, so
  // an oversized sell underflows a `Balance` before the LMSR is reached. A port
  // that let the kernel see it first would report `PriceBoundExceeded` for what
  // is really an oversized order — a different sentence to show the user.
  const book = { qLong: 10n * USDC_ONE, qShort: 0n, b: B_10K_UNITS };
  const error = catchThrown(() =>
    quoteSell(book, 'long', 11n * USDC_ONE, LAUNCH_FEE_BPS, LAUNCH_BOUNDS),
  );
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, 'ArithmeticOverflow');
});

test('the per-trade bound is a precondition, and the quote prices past it', () => {
  // 02 §4 / 11 §11.5 P-1 keep these apart, and `market-core::quote` does too: it
  // publishes `max_trade` as data and refuses nothing, while the extrinsic
  // enforces it. Keeping the split is what lets a client say "your order exceeds
  // the per-trade cap; here is what the cap would cost" — which needs the quote
  // and the refusal in the same breath.
  const book = { qLong: 0n, qShort: 0n, b: B_10K_UNITS };
  const ceiling = maxTradeAmount(B_10K_UNITS, LAUNCH_BOUNDS);
  assert.equal(ceiling, B_10K_UNITS / 4n, 'MaxTrade is not b/4 at the launch ratio');

  const oversized = quoteBuy(book, 'long', ceiling + 1n, LAUNCH_FEE_BPS, LAUNCH_BOUNDS);
  assert.ok(oversized.cost > 0n, 'an oversized order must still be priceable');
  assert.equal(oversized.maxTrade, ceiling, 'the quote must publish the cap it did not enforce');
  assert.equal(withinTradeBounds(B_10K_UNITS, ceiling + 1n, LAUNCH_BOUNDS), false);
  assert.equal(withinTradeBounds(B_10K_UNITS, ceiling, LAUNCH_BOUNDS), true);
  assert.equal(withinTradeBounds(B_10K_UNITS, LAUNCH_BOUNDS.minTrade - 1n, LAUNCH_BOUNDS), false);

  // The precondition itself refuses with the extrinsic's own dispatch errors.
  const tooSmall = catchThrown(() =>
    ensureTradeBounds(B_10K_UNITS, LAUNCH_BOUNDS.minTrade - 1n, LAUNCH_BOUNDS),
  );
  assert.ok(tooSmall instanceof ProtocolError);
  assert.equal(tooSmall.code, 'AmountTooSmall');

  const tooLarge = catchThrown(() => ensureTradeBounds(B_10K_UNITS, ceiling + 1n, LAUNCH_BOUNDS));
  assert.ok(tooLarge instanceof ProtocolError);
  assert.equal(tooLarge.code, 'AmountTooLarge');
  assert.doesNotThrow(() => ensureTradeBounds(B_10K_UNITS, ceiling, LAUNCH_BOUNDS));
});

test('a quote publishes the post-trade price and domain flag, as 02 §4 freezes them', () => {
  const book = { qLong: 0n, qShort: 0n, b: B_10K_UNITS };
  const quote = quoteBuy(book, 'long', 1000n * USDC_ONE, LAUNCH_FEE_BPS, LAUNCH_BOUNDS);
  assert.ok(quote.withinDomain);
  // Post-trade, not pre-trade: buying LONG must move the price up from 0.5.
  assert.ok(quote.pAfter1e9 > PRICE_ONE_1E9 / 2n, 'pAfter1e9 looks like the pre-trade price');

  // At the edge of the domain the flag is what carries the refusal, not an exception.
  const atEdge = { qLong: 48n * 1_000n * USDC_ONE, qShort: 0n, b: 1_000n * USDC_ONE };
  const edgeQuote = quoteBuy(atEdge, 'short', 1n * USDC_ONE, LAUNCH_FEE_BPS, LAUNCH_BOUNDS);
  assert.ok(edgeQuote.withinDomain, 'moving back toward the middle stays in the domain');
});

test('the price domain is closed at 48·b and refused one unit past it', () => {
  const b = usdcFixed(10_000);
  const edge = mul(b, fromInteger(LMSR_DOMAIN_BOUND));
  assert.ok(isWithinDomain(edge, fromInteger(0n), b), 'the domain must include its own bound');
  assert.ok(
    !isWithinDomain(fromRaw(toRaw(edge) + 1n), fromInteger(0n), b),
    'one ulp past the bound must be outside',
  );

  const error = catchThrown(() => lmsrCost(fromRaw(toRaw(edge) + 1n), fromInteger(0n), b));
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, 'PriceBoundExceeded');
  assert.equal(error.kind, 'Domain');
});

test('a subtraction underflow surfaces as PriceBoundExceeded, as the runtime maps it', () => {
  // `market-core::map_fixed` sends every kernel `Domain` fault — including a
  // subtraction underflow — to `PriceBoundExceeded`. Selling more than the book
  // has sold is exactly that case, and a client reporting it as an arithmetic
  // error would be describing a different failure from the one the chain returns.
  const b = usdcFixed(10_000);
  const error = catchThrown(() =>
    lmsrSellProceeds(usdcFixed(100), usdcFixed(0), b, 'long', usdcFixed(101)),
  );
  assert.ok(error instanceof ProtocolError);
  assert.equal(error.code, 'PriceBoundExceeded');
  assert.equal(error.kind, 'Domain');

  // The primitive underneath reports the same thing directly.
  const direct = catchThrown(() => sub(fromInteger(1n), fromInteger(2n)));
  assert.ok(direct instanceof ProtocolError);
  assert.equal(direct.kind, 'Domain');
});
