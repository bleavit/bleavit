/**
 * Agreement with the chain's own quote surface.
 *
 * This suite is not part of the reference-corpus certification and is meant to
 * be read as a different kind of claim. `reference-model/fixtures/vectors.json`
 * states what the *arithmetic* is, and `lmsr.test.ts` binds this port to it.
 * `crates/market-core/fixtures/chain-quote-agreement.json` states something the
 * corpus structurally cannot: what **this runtime's `quote` actually answers**
 * for a given book — the roundings it applies, and which inputs it declines to
 * answer at all.
 *
 * That last distinction is the reason the fixture is worth replaying. A corpus
 * of numbers cannot record a refusal, so a port can agree with every vector and
 * still hand a reader a price the chain would never quote. This suite caught
 * exactly that: `buy()` used to price an out-of-domain post-state and report it
 * `evaluable: true`, while the chain maps the fixed-point domain error to
 * `PriceBoundExceeded` and returns the zero sentinel. Eight books × four sides
 * is a small fixture, and one of its 32 rows was the whole finding.
 *
 * Two things the fixture pins that are easy to get backwards:
 *
 *  - **`quote` does not check the trade bounds.** It checks the phase, then
 *    computes. So an amount far above `b/4` still quotes, provided the resulting
 *    book stays inside the domain. Bounds are the *extrinsic's* step 2, which is
 *    why this port keeps `rejection` (what a trade would return) separate from
 *    `evaluable` (whether a quote comes back at all).
 *  - **A sell of more than the book holds is `ArithmeticOverflow`,** not a
 *    negative price. The chain's checked subtraction fails before any curve is
 *    evaluated, which is why every `sell` row on a zero-inventory book in this
 *    fixture is that error rather than a domain one.
 */

import { describe, expect, it } from 'vitest';

import fixture from './__fixtures__/chain-quotes.json';
import { buy, maxTradeAmount, sell } from './lmsr';
import type { QuoteResult } from './lmsr';

interface SideOutcome {
  readonly error?: string;
  readonly cost?: string;
  readonly fee?: string;
  readonly p_after_1e9?: string;
  readonly max_trade?: string;
  readonly within_domain?: boolean;
}

interface QuoteCase {
  readonly name: string;
  readonly q_long: string;
  readonly q_short: string;
  readonly b: string;
  readonly amount: string;
  readonly buy_long: SideOutcome;
  readonly buy_short: SideOutcome;
  readonly sell_long: SideOutcome;
  readonly sell_short: SideOutcome;
}

const CASES = fixture.cases as readonly QuoteCase[];
const FEE_BPS = Number(fixture.fee_bps);

/** The 1e9 grid the chain reports `p_after` on. */
const PRICE_SCALE = 1_000_000_000;

/**
 * Every side of every book, flattened, so one loop can assert all 32 rows and a
 * failure names the exact row rather than a case.
 */
const ROWS = CASES.flatMap((c) => [
  { c, label: `${c.name}/buy_long`, expected: c.buy_long, run: () => quoteBuy(c, 'Long') },
  { c, label: `${c.name}/buy_short`, expected: c.buy_short, run: () => quoteBuy(c, 'Short') },
  { c, label: `${c.name}/sell_long`, expected: c.sell_long, run: () => quoteSell(c, 'Long') },
  { c, label: `${c.name}/sell_short`, expected: c.sell_short, run: () => quoteSell(c, 'Short') },
]);

function quoteBuy(c: QuoteCase, side: 'Long' | 'Short'): QuoteResult {
  return buy(Number(c.b), Number(c.q_long), Number(c.q_short), side, Number(c.amount), FEE_BPS);
}

function quoteSell(c: QuoteCase, side: 'Long' | 'Short'): QuoteResult {
  return sell(Number(c.b), Number(c.q_long), Number(c.q_short), side, Number(c.amount), FEE_BPS);
}

describe('chain quote agreement (bleavit.chain-quote-agreement.v1)', () => {
  it('replays every book and side the fixture records', () => {
    expect(CASES.length).toBeGreaterThan(0);
    expect(ROWS).toHaveLength(CASES.length * 4);

    for (const { label, expected, run } of ROWS) {
      const q = run();

      if (expected.error !== undefined) {
        // The chain returned no quote. Every money field must be the sentinel,
        // and the reported reason must be the chain's own error name.
        expect(q.evaluable, `${label}: expected a refusal, got a quote`).toBe(false);
        expect(q.cost, `${label} cost`).toBe(0);
        expect(q.fee, `${label} fee`).toBe(0);
        expect(q.total, `${label} total`).toBe(0);
        expect(q.rejection, `${label} rejection`).toBe(expected.error);
        continue;
      }

      expect(q.evaluable, `${label}: expected a quote, got a refusal`).toBe(true);
      // Integer base units the chain charges or pays: exact, no tolerance.
      expect(q.cost, `${label} cost`).toBe(Number(expected.cost));
      expect(q.fee, `${label} fee`).toBe(Number(expected.fee));
      expect(q.maxTrade, `${label} max_trade`).toBe(Number(expected.max_trade));
      expect(q.withinDomain, `${label} within_domain`).toBe(expected.within_domain);
      // `p_after` is reported on the 1e9 grid, and the chain FLOORS onto it
      // rather than rounding — visible in the fixture itself, where the two
      // sides of `symmetric_start` read 524,979,187 and 475,020,812 and sum to
      // 999,999,999 rather than to 1e9.
      //
      // Tolerance is one grid unit, and it is a statement about representation
      // rather than a concession. The chain computes in 64.64 fixed point and
      // this port in a double, so the two do not share a last bit; the
      // difference cannot exceed one unit in 1e9, which is a billionth of a
      // probability and below anything this app displays. Everything the chain
      // actually charges — cost and fee, in integer base units — is asserted
      // exactly, with no tolerance at all.
      const gridDelta = Math.abs(
        Math.floor(q.priceAfter * PRICE_SCALE) - Number(expected.p_after_1e9),
      );
      expect(gridDelta, `${label} p_after_1e9 off by ${gridDelta} grid units`).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('agrees that an out-of-domain buy is refused rather than priced', () => {
    // The single row that separated this port from the chain. It is asserted on
    // its own as well as in the loop above, because a regression here reads as
    // one failing row among 32 and it is the one that matters most: a reader
    // shown a price for a trade the chain will not quote has learned a fiction.
    const edge = CASES.find((c) => c.name === 'exactly_on_the_domain_edge');
    expect(edge, 'the fixture no longer carries the domain-edge book').toBeDefined();
    expect(edge!.buy_long.error).toBe('PriceBoundExceeded');

    const q = quoteBuy(edge!, 'Long');
    expect(q.evaluable).toBe(false);
    expect(q.withinDomain).toBe(false);
    expect(q.rejection).toBe('PriceBoundExceeded');
    expect(q.cost).toBe(0);

    // The mirror side of the same book is inside the domain and does quote, so
    // the refusal is a property of where the trade lands and not of the book.
    expect(edge!.buy_short.error).toBeUndefined();
    expect(quoteBuy(edge!, 'Short').evaluable).toBe(true);
  });

  it('keeps the fixture’s own trade bounds consistent with this port', () => {
    const { min_trade, max_trade_numerator, max_trade_denominator } = fixture.trade_bounds;
    expect(Number(max_trade_numerator) / Number(max_trade_denominator)).toBe(1 / 4);
    expect(Number(min_trade)).toBe(1_000_000);
    for (const c of CASES) {
      expect(maxTradeAmount(Number(c.b)), `${c.name} max_trade`).toBe(Number(c.b) / 4);
    }
  });
});
