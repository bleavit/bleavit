/**
 * Differential certification of the LMSR port against the reference corpus.
 *
 * The fixture is derived from `reference-model/fixtures/vectors.json`
 * (`bleavit.reference-model.v4`) — the single generator doc 04 §5 mandates,
 * and the same corpus the Rust differential suites replay. Its numbers are
 * decimal strings produced at 100-digit precision.
 *
 * TOLERANCE POLICY (fixed; never widened to make a row pass):
 *  - Integer base-unit results (what the chain charges/pays): EXACT equality.
 *  - Values the spec computes on the floored 1e9 grid: absolute 2e-9.
 *  - Pure real transcendental results (LMSR cost/price): relative 1e-12.
 *
 * The `*_raw_64x64_nearest` fields in the fixture are deliberately unused. They
 * are JSON *numbers*, so values like 9.45386032498672e+21 have already lost
 * precision on serialization; they cannot serve as expectations. The decimal
 * strings are the only usable ground truth.
 */

import { describe, expect, it } from 'vitest';

import vectors from './__fixtures__/vectors.slim.json';
import { LMSR_DOMAIN_BOUND, MIN_TRADE_USDC, QUOTE_CLAMP_MAX, QUOTE_CLAMP_MIN } from './constants';
import {
  DEFAULT_MKT_FEE_BPS,
  binaryEntropy,
  buy,
  clampQuoteForDisplay,
  cost,
  costOfBuy,
  displacementCost,
  displacementForPriceMove,
  makerLossAtPrice,
  makerLossBound,
  makerLossBreakdown,
  maxTradeAmount,
  priceLong,
  priceShort,
  proceedsOfSell,
  sampleCurve,
  sell,
  withinDomain,
} from './lmsr';
import { USDC, bpsUp, roundChargeUp, roundPayoutDown } from './units';

/** Relative tolerance for pure real transcendental results. */
const REL = 1e-12;

function expectRel(actual: number, expected: string, rel = REL): void {
  const e = Number(expected);
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - e)).toBeLessThanOrEqual(Math.abs(e) * rel);
}

const V = vectors.lmsr_vectors;
/** Doc 04 §5 fixes the whole vector table at b = 10,000 USDC. */
const B = 10_000;

describe('doc 04 §5 authoritative vectors V1–V6', () => {
  it('V1 — cost of buying 1,000 LONG from a symmetric start', () => {
    expectRel(costOfBuy(B, 0, 0, 'Long', 1000), V.V1.value);
    // The same number by the explicit two-state difference the spec writes out.
    expectRel(cost(B, 1000, 0) - cost(B, 0, 0), V.V1.value);
    // C is homogeneous, so the base-unit spelling of the same book agrees.
    expectRel(costOfBuy(B * USDC, 0, 0, 'Long', 1000 * USDC) / USDC, V.V1.value);
  });

  it('V2 — price after V1', () => {
    expectRel(priceLong(B, 1000, 0), V.V2.value);
    // p_S is the complement; the mirrored logistic must still sum to one.
    expect(Math.abs(priceLong(B, 1000, 0) + priceShort(B, 1000, 0) - 1)).toBeLessThan(1e-15);
  });

  it('V3 — displacing the price 0.5 → 0.6', () => {
    expectRel(displacementForPriceMove(B, 0.5, 0.6), V.V3.delta);
    expectRel(displacementCost(B, 0.5, 0.6), V.V3.cost);
  });

  it('V4 — worst-case maker loss is b · ln 2', () => {
    expectRel(makerLossBound(B), V.V4.value);
    // Doc 04 §6.3: the same figure is the seeded headroom per book, and it is
    // the loss at the entropy-minimising ends of the price range.
    expectRel(makerLossAtPrice(B, 1), V.V4.value);
    expectRel(makerLossAtPrice(B, 0), V.V4.value);
  });

  it('V5 — a round trip costs exactly the two fees', () => {
    // Fee basis: the corpus computes −2 × 0.003 × 512.494795136…, i.e. both
    // legs charge on the SAME gross. That is not an approximation — path
    // independence makes the sell proceeds bit-identical to the buy cost, so
    // there is only one basis. The 30 bps here applies to the unrounded real;
    // the on-chain wrapper rounds each leg to base units first, asserted below.
    const gross = costOfBuy(B, 0, 0, 'Long', 1000);
    const back = proceedsOfSell(B, 1000, 0, 'Long', 1000);
    expect(back).toBe(gross); // exact, not merely close
    expectRel(gross, V.V5.proceeds_before_fees);
    expectRel(-2 * 0.003 * gross, V.V5.net_fees_only);
  });

  it('V6 — a buy leaving the domain is rejected, and 48·b itself is inside', () => {
    // The fixture states the edge in whole USDC; the wrapper works in base
    // units, so the same state is scaled by 1e6. C is homogeneous, so both
    // spellings describe one book.
    expect(Number(V.V6.b)).toBe(B);
    expect(Number(V.V6.q_long) / B).toBe(LMSR_DOMAIN_BOUND);
    expect(withinDomain(B, Number(V.V6.q_long), Number(V.V6.q_short))).toBe(true);
    expect(withinDomain(B, Number(V.V6.q_long) + 1, 0)).toBe(false);

    const q = buy(B * USDC, Number(V.V6.q_long) * USDC, 0, 'Long', Number(V.V6.amount) * USDC);
    expect(q.withinDomain).toBe(false);
    expect(q.rejection).toBe(V.V6.error);
    // The chain refuses rather than pricing it: `quote` maps the fixed-point
    // domain error to PriceBoundExceeded and the view returns the G-1 zero
    // sentinel. `chain-quote-agreement.json` records this same book as a bare
    // error with no cost beside it, and the replay suite below asserts that row.
    expect(q.evaluable).toBe(false);
    expect(q.cost).toBe(0);
    expect(q.fee).toBe(0);
    expect(q.total).toBe(0);
  });
});

describe('doc 04 §5 high-precision corpus', () => {
  const hp = vectors.high_precision_corpus;
  const b = Number(hp.b);

  it('carries the nine rows this suite certifies', () => {
    expect(hp.samples).toHaveLength(9);
    expect(b).toBe(B);
  });

  for (const row of hp.samples) {
    it(`C and p_L at q = (${row.q_long}, ${row.q_short})`, () => {
      const qL = Number(row.q_long);
      const qS = Number(row.q_short);
      expectRel(cost(b, qL, qS), row.cost);
      expectRel(priceLong(b, qL, qS), row.price_long);
    });
  }

  it('is symmetric under swapping the two sides', () => {
    for (const row of hp.samples) {
      const qL = Number(row.q_long);
      const qS = Number(row.q_short);
      expect(cost(b, qL, qS)).toBe(cost(b, qS, qL));
      expect(priceShort(b, qL, qS)).toBe(priceLong(b, qS, qL));
    }
  });
});

describe('doc 04 §12 worked maker-loss example', () => {
  const ex = vectors.lmsr_maker_example;
  const b = Number(ex.b);
  const p = Number(ex.p);

  it('reproduces the displacement ledger', () => {
    const br = makerLossBreakdown(b, 0.5, p);
    expectRel(br.delta, ex.delta);
    expectRel(br.revenue, ex.displacement_revenue);
    expectRel(br.expectedPayout, ex.expected_payout);
    expectRel(br.loss, ex.loss);
  });

  it('agrees with the closed form b·[ln 2 − H(p)]', () => {
    // From a symmetric start the two derivations coincide identically:
    // payout − revenue = b·[ln 2 − H(p′)]. §12 leans on that identity.
    expectRel(makerLossAtPrice(b, p), ex.loss);
    // ≈180.43 USDC realized against a 17,328.68 USDC bound — the two orders of
    // magnitude §12 exists to show.
    expect(makerLossAtPrice(b, p)).toBeLessThan(makerLossBound(b) / 90);
  });

  it('binary entropy is symmetric and peaks at one half', () => {
    expect(binaryEntropy(0.5)).toBeCloseTo(Math.LN2, 15);
    expect(binaryEntropy(p)).toBeCloseTo(binaryEntropy(1 - p), 15);
    expect(binaryEntropy(0)).toBe(0);
    expect(binaryEntropy(1)).toBe(0);
  });
});

describe('the doc 04 §6.1 wrapper, on the base-unit grid', () => {
  const b = B * USDC;

  it('V1 through buy(): charges round up, fee is 30 bps of the rounded cost', () => {
    const q = buy(b, 0, 0, 'Long', 1000 * USDC);
    expect(q.side).toBe('BuyLong');
    expect(q.evaluable).toBe(true);
    expect(q.rejection).toBeNull();
    expect(q.withinDomain).toBe(true);

    // Integer base-unit results: exact equality, no tolerance.
    expect(q.cost).toBe(roundChargeUp(q.exactGross));
    expect(q.cost).toBe(512_494_796);
    expect(q.fee).toBe(bpsUp(q.cost, DEFAULT_MKT_FEE_BPS));
    expect(q.fee).toBe(1_537_485);
    expect(q.total).toBe(q.cost + q.fee);

    // …and the underlying real is still the certified V1 figure.
    expectRel(q.exactGross / USDC, V.V1.value);
    expectRel(q.priceAfter, V.V2.value);
    expect(q.priceBefore).toBe(0.5);
    expect(q.maxTrade).toBe(maxTradeAmount(b));
  });

  it('sell() floors the proceeds and withholds the fee from them', () => {
    const q = sell(b, 1000 * USDC, 0, 'Long', 1000 * USDC);
    expect(q.side).toBe('SellLong');
    expect(q.cost).toBe(roundPayoutDown(q.exactGross));
    expect(q.cost).toBe(512_494_795);
    expect(q.fee).toBe(bpsUp(q.cost, DEFAULT_MKT_FEE_BPS));
    expect(q.fee).toBe(1_537_485);
    expect(q.total).toBe(q.cost - q.fee);
    expect(q.total).toBe(510_957_310);
    expect(q.priceAfter).toBe(0.5);
  });

  it('takes the fee basis from the ROUNDED cost — §6.1 step 3', () => {
    // §6.1 step 3 reads `cost = ceil(C(q + Δ) − C(q)); fee = ceil(mkt.fee · cost)`:
    // the fee basis is the ALREADY-ROUNDED cost, never the real gross. V1 cannot
    // tell those two readings apart — both yield 1,537,485 — so it is asserted
    // here on the two states that can. Both grosses were recomputed independently
    // at 60 decimal digits (Python `Decimal`, the same value the corpus states for
    // V1 to all its digits), and the two readings differ by one base unit in
    // OPPOSITE directions, so this is not "whichever fee is larger".
    //
    // buy 601 USDC from (0,0): gross = 305,014,333.152319418625848429907…
    //   ceil → 305,014,334, and 30 bps of that is 915,044 — one MORE than the
    //   915,043 the unrounded gross would give.
    const bought = buy(b, 0, 0, 'Long', 601 * USDC);
    expect(bought.cost).toBe(305_014_334);
    expect(bought.fee).toBe(915_044);
    expect(bpsUp(bought.exactGross, DEFAULT_MKT_FEE_BPS)).toBe(915_043);

    // sell 2,352 USDC back to (0,0): gross = 1,244,990,000.127665146139709446…
    //   floor → 1,244,990,000, and 30 bps of that is 3,734,970 — one FEWER than
    //   the 3,734,971 the unrounded gross would give. Withholding on the
    //   unrounded basis would over-charge the seller.
    const sold = sell(b, 2_352 * USDC, 0, 'Long', 2_352 * USDC);
    expect(sold.cost).toBe(1_244_990_000);
    expect(sold.fee).toBe(3_734_970);
    expect(bpsUp(sold.exactGross, DEFAULT_MKT_FEE_BPS)).toBe(3_734_971);
  });

  it('V5 on the base-unit grid: two fees plus exactly one unit of dust', () => {
    // The corpus states V5 in real arithmetic. The chain settles on the base-unit
    // grid, where doc 04 §4's maker-adverse rounding adds at most one base unit
    // per trade. This ties the certified real to the integers actually moved.
    const bought = buy(b, 0, 0, 'Long', 1_000 * USDC);
    const sold = sell(b, 1_000 * USDC, 0, 'Long', 1_000 * USDC);
    const net = bought.total - sold.total;
    expect(net).toBe(3_074_971);
    expect(net).toBe(bought.fee + sold.fee + 1);

    // V5's exact real net, in base units: the grid costs the trader strictly
    // more, by the two fee ceilings plus the single unit of dust — under 3.
    const corpusFees = -Number(V.V5.net_fees_only) * USDC;
    expect(net - corpusFees).toBeGreaterThan(0);
    expect(net - corpusFees).toBeLessThan(3);
  });

  it('enforces the §6.1 step-2 bounds before the step-3 cost', () => {
    expect(buy(b, 0, 0, 'Long', MIN_TRADE_USDC - 1).rejection).toBe('AmountTooSmall');
    expect(buy(b, 0, 0, 'Long', MIN_TRADE_USDC).rejection).toBeNull();
    expect(buy(b, 0, 0, 'Long', maxTradeAmount(b)).rejection).toBeNull();
    expect(buy(b, 0, 0, 'Long', maxTradeAmount(b) + 1).rejection).toBe('AmountTooLarge');
    // An oversized trade reports its own error, not PriceBoundExceeded, even
    // though it would also leave the domain: the extrinsic checks bounds before
    // it computes any cost. It is still unevaluable, because the *quote* view
    // takes the other path — it never checks the bounds at all, so all it sees
    // is a post-state outside the domain.
    const huge = buy(b, 0, 0, 'Long', 100 * b);
    expect(huge.withinDomain).toBe(false);
    expect(huge.rejection).toBe('AmountTooLarge');
    expect(huge.evaluable).toBe(false);
  });

  it('is unevaluable only for a closed book or non-arithmetic inputs', () => {
    const closed = buy(b, 0, 0, 'Long', 1000 * USDC, DEFAULT_MKT_FEE_BPS, false);
    expect(closed.evaluable).toBe(false);
    expect(closed.rejection).toBe('NotTrading');
    expect(closed.cost).toBe(0);

    // Selling more than the book holds is a checked-subtraction failure.
    const over = sell(b, 10 * USDC, 0, 'Long', 20 * USDC);
    expect(over.evaluable).toBe(false);
    expect(over.rejection).toBe('ArithmeticOverflow');

    expect(buy(0, 0, 0, 'Long', USDC).evaluable).toBe(false);
    expect(buy(b, 0, 0, 'Long', Number.NaN).evaluable).toBe(false);
  });

  it('an overflowing book is unevaluable, never a non-finite Balance', () => {
    // Doc 02 §4 lists an *overflowing* book alongside a missing/closed one as a
    // state that MUST report `evaluable: false`; doc 04 §4 aborts the extrinsic
    // on overflow rather than wrapping. Finite inputs do not imply a finite
    // quote, and both of these states clear the input guard.
    for (const q of [
      // `q_L + Δ` overflows to Infinity.
      buy(b, 1e308, 0, 'Long', 1e308),
      // `gross` stays finite but `gross · 30 bps` overflows.
      buy(b, 1e307, 0, 'Long', 1e307),
      sell(b, 1e308, 0, 'Long', 1e308),
    ]) {
      expect(q.evaluable).toBe(false);
      expect(q.rejection).toBe('ArithmeticOverflow');
      // Every Balance field stays a real, renderable integer.
      expect(Number.isFinite(q.cost)).toBe(true);
      expect(Number.isFinite(q.fee)).toBe(true);
      expect(Number.isFinite(q.total)).toBe(true);
      expect(q.cost).toBe(0);
      expect(q.total).toBe(0);
    }
  });

  it('evaluates the pure curve far outside the domain without overflowing', () => {
    // The wrapper refuses a post-state this far out, but the *pure* functions
    // must still evaluate C and p at ratios the domain never admits — and that,
    // not the 48·b edge, is where the doc 04 §4 log-sum-exp form earns its keep.
    // At |q_L − q_S|/b = 1,000 the naive forms break outright: e^1000 is
    // Infinity, so the naive C is Infinity and the naive price ratio
    // e^{q_L/b}/(e^{q_L/b} + e^{q_S/b}) is Infinity/Infinity. The market scene
    // samples these directly to draw the curve, so stability here is load-bearing
    // rather than decorative.
    expect(Number.isFinite(cost(b, 1_000 * b, 0))).toBe(true);
    // C(Δ,0) − C(0,0) = Δ + b·ln(1 + e^{−Δ/b}) − b·ln 2, and that middle term is
    // e^{−1000} — so the gross is Δ − b·ln 2 to far inside one base unit.
    expect(cost(b, 1_000 * b, 0) - cost(b, 0, 0)).toBeCloseTo(1_000 * b - b * Math.LN2, 0);
    expect(priceLong(b, 1_000 * b, 0)).toBe(1);
    expect(priceShort(b, 1_000 * b, 0)).toBe(0);

    // The wrapper, on the same book: refused, and refused with the bounds error
    // it would hit first rather than with the domain one.
    const far = buy(b, 0, 0, 'Long', 1_000 * b);
    expect(far.evaluable).toBe(false);
    expect(far.withinDomain).toBe(false);
    expect(far.rejection).toBe('AmountTooLarge');
    expect(far.cost).toBe(0);
  });

  it('quotes SHORT as the mirror of LONG', () => {
    const long = buy(b, 0, 0, 'Long', 1000 * USDC);
    const short = buy(b, 0, 0, 'Short', 1000 * USDC);
    expect(short.side).toBe('BuyShort');
    expect(short.cost).toBe(long.cost);
    expect(short.priceAfter).toBeCloseTo(1 - long.priceAfter, 15);
  });
});

describe('path independence (doc 04 §5 V5, generalised)', () => {
  // A deterministic table, not a generator: every row is an integer count of
  // base units below 2^53, so (q + a) − a is exact and the round trip really
  // does return the book to its starting q-state.
  const cases: readonly (readonly [number, number, number, number])[] = [
    [10_000 * USDC, 0, 0, 1_000 * USDC],
    [10_000 * USDC, 0, 0, 1 * USDC],
    [10_000 * USDC, 250_000 * USDC, 0, 2_500 * USDC],
    [10_000 * USDC, 12_345 * USDC, 6_789 * USDC, 2_000 * USDC],
    [25_000 * USDC, 6_029 * USDC, 0, 6_250 * USDC],
    [250_000 * USDC, 0, 3_333 * USDC, 62_500 * USDC],
    [1_000 * USDC, 47_000 * USDC, 0, 250 * USDC],
  ];

  for (const [b, qL, qS, amount] of cases) {
    it(`b=${b} q=(${qL},${qS}) amount=${amount}`, () => {
      for (const side of ['Long', 'Short'] as const) {
        const bought = buy(b, qL, qS, side, amount);
        const postLong = side === 'Long' ? qL + amount : qL;
        const postShort = side === 'Short' ? qS + amount : qS;
        const sold = sell(b, postLong, postShort, side, amount);

        // 1. The q-state returns exactly.
        expect(side === 'Long' ? postLong - amount : postShort - amount).toBe(
          side === 'Long' ? qL : qS,
        );

        // 2. The gross is bit-identical in both directions — the reason the
        //    round trip has a single fee basis.
        expect(sold.exactGross).toBe(bought.exactGross);

        // 3. The trader's net outlay is the two fees plus at most one base
        //    unit of maker-adverse rounding (doc 04 §4: charges up, payouts
        //    down, cumulative maker benefit ≤ 1 base unit per trade).
        const net = bought.total - sold.total;
        const dust = bought.cost - sold.cost;
        expect(net).toBe(bought.fee + sold.fee + dust);
        expect(dust).toBeGreaterThanOrEqual(0);
        expect(dust).toBeLessThanOrEqual(1);

        // 4. Never negative: a round trip cannot pay the trader. It can be
        //    exactly zero — see the deep-out-of-the-money case below.
        expect(net).toBeGreaterThanOrEqual(0);
        expect(Object.is(net, -0)).toBe(false);
      }
    });
  }

  it('a deep out-of-the-money side quotes and round-trips at zero base units', () => {
    // b = 1,000 USDC, q_L = 47,000 USDC: the LONG side sits 47 logits up, so a
    // 250 USDC SHORT buy is worth ≈ 2e-12 base units — the instrument pays
    // ~4e-21 at any settlement. Two separate effects collapse that to zero:
    // the two C values differ below a double ulp at this magnitude, and
    // `roundChargeUp`'s float-noise epsilon absorbs anything under 1e-9 base
    // units anyway. The 64.64 chain would ceil a strictly positive gross to
    // ONE base unit here, so this port is up to 1 base unit (1e-6 USDC) cheap
    // in the far tail — the same order as the maker-adverse dust doc 04 §4
    // already tolerates per trade, and in a region no book trades in.
    // Doc 04 §6.3's drain bound is untouched: the trade moves the book toward
    // symmetry, so it consumes no headroom.
    const b = 1_000 * USDC;
    const q = buy(b, 47_000 * USDC, 0, 'Short', 250 * USDC);
    expect(q.evaluable).toBe(true);
    expect(q.rejection).toBeNull();
    expect(q.exactGross).toBe(0);
    expect(q.cost).toBe(0);
    expect(q.fee).toBe(0);
    expect(q.total).toBe(0);
    // The LONG price saturates to exactly 1 in double, but the SHORT price
    // still carries its ~5e-21 — that is precisely why priceShort is the
    // mirrored logistic and not `1 − priceLong`, which would report a flat 0.
    expect(q.priceAfter).toBe(1);
    expect(priceShort(b, 47_000 * USDC, 250 * USDC)).toBeGreaterThan(0);
    expect(1 - q.priceAfter).toBe(0);
  });

  it('the price returns to where it started', () => {
    const b = 10_000 * USDC;
    const bought = buy(b, 0, 0, 'Long', 1_000 * USDC);
    const sold = sell(b, 1_000 * USDC, 0, 'Long', 1_000 * USDC);
    expect(sold.priceAfter).toBe(bought.priceBefore);
  });
});

describe('domain, clamp and per-trade bounds', () => {
  it('withinDomain admits exactly 48·b and rejects one unit past it', () => {
    expect(withinDomain(1, LMSR_DOMAIN_BOUND, 0)).toBe(true);
    expect(withinDomain(1, -LMSR_DOMAIN_BOUND, 0)).toBe(true);
    expect(withinDomain(1, LMSR_DOMAIN_BOUND + 1e-9, 0)).toBe(false);
    expect(withinDomain(10_000, 0, 480_000)).toBe(true);
    expect(withinDomain(10_000, 0, 480_001)).toBe(false);
  });

  it('maxTradeAmount is b/4, floored as the chain divides', () => {
    expect(maxTradeAmount(10_000 * USDC)).toBe(2_500 * USDC);
    expect(maxTradeAmount(3)).toBe(0);
    expect(maxTradeAmount(7)).toBe(1);
  });

  it('the display clamp changes nothing inside [0.001, 0.999]', () => {
    expect(clampQuoteForDisplay(0.5)).toBe(0.5);
    expect(clampQuoteForDisplay(QUOTE_CLAMP_MIN)).toBe(QUOTE_CLAMP_MIN);
    expect(clampQuoteForDisplay(QUOTE_CLAMP_MAX)).toBe(QUOTE_CLAMP_MAX);
    // The domain admits prices around 1.4e-21; the clamp is display-only, and
    // the underlying price is untouched.
    const tail = priceLong(10_000, 0, 480_000);
    expect(tail).toBeGreaterThan(0);
    expect(tail).toBeLessThan(1e-20);
    expect(clampQuoteForDisplay(tail)).toBe(QUOTE_CLAMP_MIN);
    expect(clampQuoteForDisplay(1)).toBe(QUOTE_CLAMP_MAX);
  });

  it('cost still computes outside the domain — doc 02 §4 needs the number', () => {
    expect(withinDomain(10_000, 600_000, 0)).toBe(false);
    expect(Number.isFinite(cost(10_000, 600_000, 0))).toBe(true);
    // At 60 logits the log-sum-exp correction is b·e^{−60} ≈ 8.8e-23, which is
    // below one double ulp of 600,000 — so C rounds to max(q_L, q_S) exactly.
    // That saturation is the reason the domain bound exists at 48: past it the
    // price and the cost stop carrying information.
    expect(cost(10_000, 600_000, 0)).toBe(600_000);
    expect(cost(10_000, 480_000, 0)).toBe(480_000);
  });

  it('rejects a non-positive b rather than returning a plausible number', () => {
    expect(() => cost(0, 0, 0)).toThrow(RangeError);
    expect(() => priceLong(-1, 0, 0)).toThrow(RangeError);
    expect(() => displacementForPriceMove(10_000, 0, 0.5)).toThrow(RangeError);
    expect(() => binaryEntropy(1.5)).toThrow(RangeError);
  });
});

describe('sampleCurve for the market scene', () => {
  const b = 10_000;

  it('spans the displayable price range with monotone prices', () => {
    const s = sampleCurve(b, 1_000, 0, 65);
    expect(s).toHaveLength(65);

    const first = s[0];
    const last = s[64];
    const mid = s[32];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(mid).toBeDefined();
    if (!first || !last || !mid) return;

    expect(first.priceLong).toBeCloseTo(QUOTE_CLAMP_MIN, 12);
    expect(last.priceLong).toBeCloseTo(QUOTE_CLAMP_MAX, 12);
    expect(mid.netQ).toBeCloseTo(0, 9);
    expect(mid.priceLong).toBeCloseTo(0.5, 12);

    for (let i = 1; i < s.length; i += 1) {
      const prev = s[i - 1];
      const cur = s[i];
      if (!prev || !cur) throw new Error('dense sample array');
      expect(cur.netQ).toBeGreaterThan(prev.netQ);
      expect(cur.priceLong).toBeGreaterThan(prev.priceLong);
      expect(cur.cost).toBeGreaterThan(prev.cost);
    }
  });

  it('reports each sample relative to the book’s current state', () => {
    const qL = 2_500;
    const s = sampleCurve(b, qL, 0, 33);
    for (const sample of s) {
      expect(sample.delta).toBeCloseTo(sample.netQ - qL, 9);
      // costFromCurrent is what a trader pays to walk the book to this point,
      // which is exactly costOfBuy when the point is to the right.
      if (sample.delta > 0) {
        expect(sample.costFromCurrent).toBeCloseTo(
          costOfBuy(b, qL, 0, 'Long', sample.delta),
          9,
        );
      }
      expect(sample.cost).toBeCloseTo(cost(b, sample.netQ, 0), 9);
    }
  });

  it('never samples outside the LMSR domain, however wide the span asked for', () => {
    const s = sampleCurve(b, 0, 0, 9, 1_000);
    for (const sample of s) {
      expect(withinDomain(b, sample.netQ, 0)).toBe(true);
    }
    expect(() => sampleCurve(b, 0, 0, 1)).toThrow(RangeError);
  });
});
