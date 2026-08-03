/**
 * The trade-quote pipeline in base units — 04 §6.1/§6.4.
 *
 * `./lmsr.js` is the mathematics; this is the extrinsic. Between them sit three
 * roundings, and they are the whole reason this module exists separately:
 *
 * 1. `baseUnitsToFixed` **floors** base units into 64.64 whole USDC;
 * 2. the ×10⁶ rescale back to base units **truncates** inside the 64.64 multiply;
 * 3. a charge then **ceils** and a payout **floors** (04 §4, maker-adverse).
 *
 * A caller who computes the cost to thirty digits and rounds once at the end
 * gets a different base-unit answer from the runtime often enough to matter,
 * and the direction of the disagreement is the bad one: quoting under the
 * chain's charge produces a `max_cost` the chain refuses (04 §6.1 step 4), so
 * the user signs a transaction that reverts and pays the fee for it.
 *
 * **Every tunable is an argument.** `mkt.fee`, `MinTrade` and `MaxTradeRatio`
 * are chain-read values (02 §9), so nothing here defaults them — a client that
 * forgets to pass one gets a type error, not a stale launch value silently
 * baked into a quote (15 §5.4).
 *
 * @see docs/architecture/04-markets-and-pricing.md §6.1, §6.4
 */

import { ProtocolError, fixedFault } from './errors.js';
import {
  type Fixed,
  FRAC_BITS,
  add,
  fromInteger,
  fromRaw,
  mul,
  roundChargeUp,
  roundPayoutDown,
} from './fixed.js';
import {
  type LmsrSide,
  isWithinDomain,
  lmsrBuyCost,
  lmsrPriceLong,
  lmsrSellProceeds,
  priceToGrid1e9,
} from './lmsr.js';

/**
 * USDC base units per whole USDC (6 decimals).
 *
 * A D-17 identity pin, not a tunable: 15 §5.4 names the token decimals among
 * the values legitimately compiled into the bundle, because they are used to
 * *verify* the chain rather than parameterise it.
 */
export const USDC_ONE = 1_000_000n;

/** Denominator of the basis-point projection 02 §9 publishes `Market::Fee` in. */
export const BPS_DENOMINATOR = 10_000n;

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

/** A book's LMSR state, in base units, as `FutarchyApi` reports it. */
export interface BookState {
  /** Net LONG quantity sold by the maker. */
  readonly qLong: bigint;
  /** Net SHORT quantity sold by the maker. */
  readonly qShort: bigint;
  /** Subsidy parameter `b`. */
  readonly b: bigint;
}

/** The chain's per-trade bounds, read from metadata (02 §9). */
export interface TradeBounds {
  /** `Market::MinTrade`, in base units. */
  readonly minTrade: bigint;
  /** `Market::MaxTradeRatio` numerator (launch 1). */
  readonly maxTradeNumerator: bigint;
  /** `Market::MaxTradeRatio` denominator (launch 4, giving `b/4`). */
  readonly maxTradeDenominator: bigint;
}

/**
 * The 02 §4 `QuoteView` shape, computed locally.
 *
 * Deliberately the *same* shape the runtime API returns, so a client can put
 * its own computation beside a `FutarchyApi` quote and compare them field by
 * field — which is the conservative cross-check FE-P2 leaves open.
 *
 * `cost` is the gross charge on a buy and the gross proceeds on a sell, before
 * the fee, exactly as `market-core::quote` names it.
 */
export interface QuoteView {
  readonly cost: bigint;
  readonly fee: bigint;
  /** Post-trade marginal price on the 1e9 stored-quote grid. */
  readonly pAfter1e9: bigint;
  /** `MaxTrade` for this book — data, not a refusal. See `withinTradeBounds`. */
  readonly maxTrade: bigint;
  /** Post-trade `|q_L − q_S| / b ≤ 48`. 02 §4 freezes this as the domain predicate only. */
  readonly withinDomain: boolean;
}

/** A buy quote. `total` is the figure `max_cost` must cover (04 §6.1 step 4). */
export interface BuyQuote extends QuoteView {
  readonly total: bigint;
}

/** A sell quote. `net` is the figure `min_proceeds` bounds. */
export interface SellQuote extends QuoteView {
  readonly net: bigint;
}

/**
 * Base units → 64.64 whole USDC (`market-core::fx`).
 *
 * The fractional part floors. That is not an approximation to tidy up: it is
 * the runtime's own conversion, and reproducing it is the only way the last
 * base unit comes out the same.
 */
export function baseUnitsToFixed(value: bigint): Fixed {
  if (value < 0n) {
    throw fixedFault('Domain', `negative balance: ${value}`);
  }
  const whole = value / USDC_ONE;
  if (whole > U64_MAX) {
    throw fixedFault('Overflow', `balance exceeds the u64 whole-unit range: ${value}`);
  }
  return add(fromInteger(whole), fromRaw(((value % USDC_ONE) << FRAC_BITS) / USDC_ONE));
}

/** 64.64 whole USDC → base units, rounding a charge **up** (04 §4). */
export function fixedToBaseUnitsUp(value: Fixed): bigint {
  return roundChargeUp(mul(value, fromInteger(USDC_ONE)));
}

/** 64.64 whole USDC → base units, rounding a payout **down** (04 §4). */
export function fixedToBaseUnitsDown(value: Fixed): bigint {
  return roundPayoutDown(mul(value, fromInteger(USDC_ONE)));
}

/** `ceil(amount · feeBps / 10_000)` (`market-core::fee_up`). */
export function feeUp(amount: bigint, feeBps: bigint): bigint {
  if (amount < 0n || feeBps < 0n) {
    throw fixedFault('Domain', 'fee inputs must be non-negative');
  }
  const scaled = amount * feeBps;
  if (scaled > U128_MAX) {
    throw fixedFault('Overflow', 'fee product exceeds u128');
  }
  return scaled / BPS_DENOMINATOR + (scaled % BPS_DENOMINATOR === 0n ? 0n : 1n);
}

/** `MaxTrade` for a book: `b · numerator / denominator`, launch `b/4` (04 §6.4). */
export function maxTradeAmount(b: bigint, bounds: TradeBounds): bigint {
  // Both degenerate cases return **zero**, not an error, because that is what
  // `market-core::max_trade_amount` does — its two `checked_*` misses each fall
  // through to 0. A ceiling of zero admits no trade at all, which is the
  // status-quo-default direction (G-1); throwing here would be a *safer-looking*
  // choice that disagrees with the chain, and disagreeing with the chain is the
  // one thing this package must not do.
  if (bounds.maxTradeDenominator === 0n) return 0n;
  const scaled = b * bounds.maxTradeNumerator;
  if (scaled > U128_MAX) return 0n;
  return scaled / bounds.maxTradeDenominator;
}

/**
 * `MinTrade ≤ amount ≤ MaxTrade` (04 §6.4), throwing the dispatch error the
 * extrinsic would return. Both bounds are mandatory and neither has a default.
 *
 * **This is a precondition, not part of the quote.** 02 §4 and 11 §11.5 P-1
 * keep them apart deliberately, and `market-core::quote` does the same: it
 * publishes `max_trade` as *data* and refuses nothing, while `buy_book` (the
 * extrinsic) enforces it. The separation is what lets a client price a trade it
 * is about to tell the user is too large — "your 5,000 USDC order exceeds the
 * 2,500 per-trade cap; here is what 2,500 would cost" needs the quote and the
 * refusal at the same time. Folding the check into `quoteBuy` would make that
 * screen impossible to build and would disagree with the runtime's own quote.
 */
export function ensureTradeBounds(b: bigint, amount: bigint, bounds: TradeBounds): void {
  if (amount < bounds.minTrade) {
    throw new ProtocolError('AmountTooSmall', `amount ${amount} is below MinTrade`);
  }
  if (amount > maxTradeAmount(b, bounds)) {
    throw new ProtocolError('AmountTooLarge', `amount ${amount} is above MaxTrade`);
  }
}

/** The non-throwing form of the 11 §11.5 P-1 precondition. */
export function withinTradeBounds(b: bigint, amount: bigint, bounds: TradeBounds): boolean {
  return amount >= bounds.minTrade && amount <= maxTradeAmount(b, bounds);
}

/** Base-unit addition with the runtime's own overflow error. */
function checkedAdd(a: bigint, b: bigint): bigint {
  const sum = a + b;
  if (sum > U128_MAX) {
    throw new ProtocolError('ArithmeticOverflow', 'balance addition overflows u128');
  }
  return sum;
}

/**
 * Base-unit subtraction with the runtime's own error.
 *
 * `ArithmeticOverflow`, not `PriceBoundExceeded` — selling more than the book
 * has sold underflows a `Balance` in `market-core::quote` *before* the LMSR is
 * reached, so that is the error the user sees. Reaching the kernel first would
 * report a price-domain failure for what is really an oversized order.
 */
function checkedSub(a: bigint, b: bigint): bigint {
  if (a < b) {
    throw new ProtocolError('ArithmeticOverflow', 'balance subtraction underflows');
  }
  return a - b;
}

/**
 * What `buy(market, side, amount, max_cost)` will charge — 04 §6.1 steps 3–4.
 *
 * Mirrors `market-core::quote` step for step, including the order in which it
 * can fail: the post-trade quantity is formed in base units first, so an
 * oversized order reports the runtime's arithmetic error rather than a
 * price-domain one. Per-trade bounds are NOT enforced here — see
 * `ensureTradeBounds`.
 */
export function quoteBuy(
  book: BookState,
  side: LmsrSide,
  amount: bigint,
  feeBps: bigint,
  bounds: TradeBounds,
): BuyQuote {
  const postLong = side === 'long' ? checkedAdd(book.qLong, amount) : book.qLong;
  const postShort = side === 'short' ? checkedAdd(book.qShort, amount) : book.qShort;

  const cost = fixedToBaseUnitsUp(
    lmsrBuyCost(
      baseUnitsToFixed(book.qLong),
      baseUnitsToFixed(book.qShort),
      baseUnitsToFixed(book.b),
      side,
      baseUnitsToFixed(amount),
    ),
  );
  const fee = feeUp(cost, feeBps);
  const total = checkedAdd(cost, fee);
  return { cost, fee, total, ...postTradeView(postLong, postShort, book.b, bounds) };
}

/**
 * What `sell(market, side, amount, min_proceeds)` will credit — 04 §6.1.
 *
 * The fee is withheld *from* the proceeds: `net = proceeds − fee`, and `net` is
 * what `min_proceeds` bounds. Adding instead of subtracting is the natural
 * mistake and overstates the payout by twice the fee.
 */
export function quoteSell(
  book: BookState,
  side: LmsrSide,
  amount: bigint,
  feeBps: bigint,
  bounds: TradeBounds,
): SellQuote {
  const postLong = side === 'long' ? checkedSub(book.qLong, amount) : book.qLong;
  const postShort = side === 'short' ? checkedSub(book.qShort, amount) : book.qShort;

  const cost = fixedToBaseUnitsDown(
    lmsrSellProceeds(
      baseUnitsToFixed(book.qLong),
      baseUnitsToFixed(book.qShort),
      baseUnitsToFixed(book.b),
      side,
      baseUnitsToFixed(amount),
    ),
  );
  const fee = feeUp(cost, feeBps);
  if (fee > cost) {
    throw fixedFault('Domain', 'fee exceeds proceeds');
  }
  return { cost, fee, net: cost - fee, ...postTradeView(postLong, postShort, book.b, bounds) };
}

/** The post-trade half of a `QuoteView`, shared by both directions. */
function postTradeView(
  postLong: bigint,
  postShort: bigint,
  b: bigint,
  bounds: TradeBounds,
): Pick<QuoteView, 'pAfter1e9' | 'maxTrade' | 'withinDomain'> {
  const long = baseUnitsToFixed(postLong);
  const short = baseUnitsToFixed(postShort);
  const bFixed = baseUnitsToFixed(b);
  const withinDomain = isWithinDomain(long, short, bFixed);
  return {
    pAfter1e9: withinDomain ? priceToGrid1e9(lmsrPriceLong(long, short, bFixed)) : 0n,
    maxTrade: maxTradeAmount(b, bounds),
    withinDomain,
  };
}
