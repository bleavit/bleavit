/**
 * The LMSR market maker — doc 04 §3–§6, with the worked example of §12.
 *
 * Every Bleavit book is a two-outcome LMSR with subsidy parameter `b`. Three
 * things about this module are deliberate:
 *
 *  1. **The pure math is unit-agnostic.** `C` is positively homogeneous —
 *     `C(k·b, k·q_L, k·q_S) = k·C(b, q_L, q_S)` — so `cost`, `priceLong`,
 *     `displacementCost` and friends work in whatever unit `b` and `q` are
 *     given. Doc 04 §5 states its vectors in whole USDC; the chain states
 *     everything in 6-decimal base units. Both are the same function.
 *  2. **The wrapper is not.** `buy`/`sell` model the doc 04 §6.1 extrinsic,
 *     which is denominated in USDC **base units** and rounds to that grid.
 *     `MinTrade = 1 USDC` and the maker-adverse rounding only mean anything on
 *     the base-unit grid, so those two functions require it.
 *  3. **The pure maths never throws; the wrapper refuses.** `cost` and
 *     `priceLong` stay finite and accurate outside the `|q_L − q_S|/b ≤ 48`
 *     domain, and must, because the stability argument below depends on it.
 *     `buy`/`sell` do not: they model the §6.1 extrinsic, which enforces the
 *     domain against the *post-trade* state before it will return anything, so
 *     an out-of-domain post-state comes back `evaluable: false` with
 *     `PriceBoundExceeded` and zeroed money fields. The corollary is worth
 *     stating because it is easy to get backwards: on any `evaluable: true`
 *     result `withinDomain` is necessarily `true`, so the **refusal** is the
 *     domain check and the flag is not. The chain agrees —
 *     `crates/market-core/fixtures/chain-quote-agreement.json` records
 *     `exactly_on_the_domain_edge/buy_long` as a bare `PriceBoundExceeded`
 *     error with no cost beside it.
 *
 * Numerical form matters at the tails. `C` uses the log-sum-exp identity
 * `max(q_L,q_S) + b·ln(1 + e^{−|q_L−q_S|/b})` that doc 04 §4 names, and prices
 * use the logistic rather than a ratio of exponentials. The payoff is *not* at
 * the `48·b` domain edge: there the correction term `b·e^{−48}` is below one ulp
 * of `max(q_L,q_S)` in either form, which is exactly why `C(10⁴, 48·10⁴, 0)`
 * evaluates to `480,000` on the nose. The payoff is past the edge — point 3
 * obliges this module to quote post-states the domain rejects, and beyond
 * `|q_L − q_S|/b ≈ 709` the naive `e^{q_L/b} + e^{q_S/b}` overflows to
 * `Infinity` while the naive price ratio degenerates to `Infinity/Infinity =
 * NaN`. The forms used here stay finite and still return the number doc 02 §4
 * requires.
 */

import { cite } from './citations';
import {
  LMSR_DOMAIN_BOUND,
  MAX_TRADE_RATIO,
  MIN_TRADE_USDC,
  QUOTE_CLAMP_MAX,
  QUOTE_CLAMP_MIN,
} from './constants';
import type { ScalarSide, TradeSide } from './types';
import { bpsUp, roundChargeUp, roundPayoutDown } from './units';

export const LMSR_CITATION = cite('04', '§3', 'two-outcome LMSR per book');
export const DOMAIN_CITATION = cite('04', '§4', '|q_L − q_S| / b ≤ 48; PriceBoundExceeded');
export const WRAPPER_CITATION = cite('04', '§6.1', 'branch-USDC auto-split wrapper');

/**
 * `mkt.fee` — 30 bps, doc 13 §1, non-refundable on every path (doc 04 §6.1).
 *
 * This is a governable constitution key, not a kernel constant, so it lives in
 * the params registry at runtime. It is repeated here only as the default
 * argument of `buy`/`sell`; a caller holding a live `Params` should pass it.
 */
export const DEFAULT_MKT_FEE_BPS = 30;

export const FEE_CITATION = cite('13', '§1', 'mkt.fee = 30 bps');

/**
 * Why a quote or trade was refused. These are the `pallet-market` `Error`
 * variants (`pallets/market/src/lib.rs`), not the proposal-level
 * `RejectReason` set in `types.ts` — different vocabulary, different layer.
 */
export type TradeRejection =
  | 'NotTrading'
  | 'AmountTooSmall'
  | 'AmountTooLarge'
  | 'PriceBoundExceeded'
  | 'ArithmeticOverflow';

/**
 * Mirrors doc 02 §4 `QuoteView`, plus the fields an explainer needs that the
 * on-chain view does not carry (the pre-trade price, the unrounded gross, and
 * why the trade would be refused).
 */
export interface QuoteResult {
  /** Which of the four frozen `TradeSide` variants this quote describes. */
  readonly side: TradeSide;
  /**
   * Gross USDC base units, excluding fee: charged on a buy (rounded **up**),
   * paid on a sell (rounded **down**). Both directions favour the escrow.
   */
  readonly cost: number;
  /** Fee in base units at `feeBps`, rounded up. Basis is `cost` (doc 04 §6.1). */
  readonly fee: number;
  /** Buy: `cost + fee`, the total debit. Sell: `cost − fee`, the net credit. */
  readonly total: number;
  /** Instantaneous LONG price before the trade. */
  readonly priceBefore: number;
  /** Instantaneous LONG price after the trade — doc 02 §4 `p_after_1e9`. */
  readonly priceAfter: number;
  /**
   * The unrounded real gross. Doc 04 §5's vectors certify *this*, not `cost`:
   * V1 is 512.494795136… USDC, which the chain charges as 512.494796.
   */
  readonly exactGross: number;
  /** `b/4` — doc 02 §4 `max_trade`, so one trade moves the logit by ≤ 0.25. */
  readonly maxTrade: number;
  /**
   * Post-trade `|q_L − q_S|/b ≤ 48`. Doc 02 §4 freezes it as post-trade only.
   *
   * Conservatively always `true` whenever `evaluable` is: the wrapper refuses an
   * out-of-domain post-state outright rather than pricing it, so the pair
   * (`evaluable: true`, `withinDomain: false`) is not a state the chain returns.
   */
  readonly withinDomain: boolean;
  /**
   * The quote was computed *and* the wrapper would accept the post-state.
   * `false` means the book is missing or closed, the inputs are not arithmetic,
   * or the trade would push the book outside the priced domain.
   */
  readonly evaluable: boolean;
  /** `null` when the trade would be accepted. */
  readonly rejection: TradeRejection | null;
}

/** One point of the cost/price curve, for the market scene. */
export interface CurveSample {
  /** Net inventory `q_L − q_S` at this point, in the same unit as `b`. */
  readonly netQ: number;
  /** Signed distance from the book's current net inventory. */
  readonly delta: number;
  /** LONG price at this point. */
  readonly priceLong: number;
  /** `C` at this point, holding `q_S` at the book's current value. */
  readonly cost: number;
  /** `C(here) − C(current)`: what a trader pays to walk the book here. */
  readonly costFromCurrent: number;
}

/** The `b·ln 2 − b·H(p)` decomposition doc 04 §12 checks its worked example against. */
export interface MakerLossBreakdown {
  /** LONG units the displacement requires, `b·(logit p′ − logit p)`. */
  readonly delta: number;
  /** What the maker collects for it, `b·ln((1 − p)/(1 − p′))`. */
  readonly revenue: number;
  /** What the maker owes at settlement `s = p′`: `delta · p′`. */
  readonly expectedPayout: number;
  /** `expectedPayout − revenue`. Equals `b·[ln 2 − H(p′)]` when `p = 0.5`. */
  readonly loss: number;
}

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

function requirePositiveB(b: number): void {
  if (!Number.isFinite(b) || b <= 0) {
    throw new RangeError('LMSR subsidy parameter b must be finite and positive');
  }
}

function requireProbability(p: number, open: boolean): void {
  const ok = open ? p > 0 && p < 1 : p >= 0 && p <= 1;
  if (!Number.isFinite(p) || !ok) {
    throw new RangeError(
      `probability must lie in ${open ? '(0, 1)' : '[0, 1]'}; received ${String(p)}`,
    );
  }
}

/**
 * `C(q_L, q_S) = b · ln(e^{q_L/b} + e^{q_S/b})` — doc 04 §3.
 *
 * Evaluated in the log-sum-exp form doc 04 §4 mandates for stability. At the
 * domain edge `q_L/b = 48` the direct form would exponentiate 48 and lose the
 * low bits of the sum; here the exponent is never positive, so the correction
 * term degrades gracefully to `b·e^{−48}` instead of overflowing.
 *
 * Deliberately does **not** enforce the domain — this is the pure function, and
 * the market scene samples it past the edge to draw the curve. The §6.1 wrapper
 * (`buy`/`sell`) is where the domain becomes a refusal.
 */
export function cost(b: number, qLong: number, qShort: number): number {
  requirePositiveB(b);
  const hi = Math.max(qLong, qShort);
  return hi + b * Math.log1p(Math.exp(-Math.abs(qLong - qShort) / b));
}

/**
 * `p_L = 1/(1 + e^{−(q_L − q_S)/b})` — doc 04 §3, in logistic form.
 *
 * The ratio-of-exponentials form in the spec text is the same function; the
 * logistic is what survives `q_L − q_S = ±48·b`, where the corpus expects
 * 1.4e-21 rather than an overflow-driven 0 or NaN.
 */
export function priceLong(b: number, qLong: number, qShort: number): number {
  requirePositiveB(b);
  return 1 / (1 + Math.exp((qShort - qLong) / b));
}

/**
 * `p_S = 1 − p_L` — doc 04 §3.
 *
 * Computed as the mirrored logistic rather than by subtraction. The two agree
 * to a rounding unit in the middle of the range, but only the mirrored form
 * keeps the significant digits of a price near zero, which is exactly where
 * gate books trade (doc 04 §9: `p_max` is 0.05).
 */
export function priceShort(b: number, qLong: number, qShort: number): number {
  return priceLong(b, qShort, qLong);
}

/**
 * `|q_L − q_S| / b ≤ 48` — doc 04 §4. Exactly `48·b` is inside.
 *
 * The bound is what makes the fixed-point kernel's error analysis hold, and
 * what stops a book from being walked to a price the maker cannot quote.
 */
export function withinDomain(b: number, qLong: number, qShort: number): boolean {
  requirePositiveB(b);
  return Math.abs(qLong - qShort) / b <= LMSR_DOMAIN_BOUND;
}

/**
 * Unrounded gross cost of buying `amount` units of `side` — doc 04 §3,
 * `cost(buy Δ LONG) = C(q_L + Δ, q_S) − C(q_L, q_S)`.
 *
 * Gate books map YES ↦ Long and NO ↦ Short (doc 04 §3), so this covers them too.
 */
export function costOfBuy(
  b: number,
  qLong: number,
  qShort: number,
  side: ScalarSide,
  amount: number,
): number {
  const after =
    side === 'Long'
      ? cost(b, qLong + amount, qShort)
      : cost(b, qLong, qShort + amount);
  return after - cost(b, qLong, qShort);
}

/**
 * Unrounded gross proceeds of selling `amount` units of `side` — doc 04 §6.1,
 * `proceeds = C(q) − C(q − Δ)`.
 *
 * Path independence is structural: this is the same expression as `costOfBuy`
 * evaluated between the same two states, which is why a round trip costs
 * exactly the two fees (doc 04 §5 V5).
 */
export function proceedsOfSell(
  b: number,
  qLong: number,
  qShort: number,
  side: ScalarSide,
  amount: number,
): number {
  const before = cost(b, qLong, qShort);
  const after =
    side === 'Long'
      ? cost(b, qLong - amount, qShort)
      : cost(b, qLong, qShort - amount);
  return before - after;
}

/** `logit p = ln(p/(1−p))`, the natural coordinate of an LMSR book. */
function logit(p: number): number {
  requireProbability(p, true);
  return Math.log(p / (1 - p));
}

/**
 * `Δ = b·(logit p′ − logit p)` — doc 04 §3. Units to move the LONG price
 * from `from` to `to`; negative when `to < from`.
 *
 * This is the quantity that makes `b` interpretable: `b` is the number of
 * units one logit of price movement costs, so doubling `b` doubles the capital
 * an attacker needs for the same displacement (doc 14's manipulation cost).
 */
export function displacementForPriceMove(b: number, from: number, to: number): number {
  requirePositiveB(b);
  return b * (logit(to) - logit(from));
}

/**
 * `b · ln((1 − p)/(1 − p′))` — doc 04 §3, the cost of that displacement.
 *
 * Note it is not `Δ · p′`: the trader pays the integral of a rising price
 * curve, so the average execution price sits strictly between `p` and `p′`.
 * Doc 04 §6.2 turns on exactly this fact — a buy opening at a quote of 0.5
 * still executes above 0.5 and so recovers less than `cost` under VOID.
 */
export function displacementCost(b: number, from: number, to: number): number {
  requirePositiveB(b);
  requireProbability(from, true);
  requireProbability(to, true);
  return b * Math.log((1 - from) / (1 - to));
}

/**
 * `b · ln 2` — doc 04 §6.3. The worst-case maker loss, and therefore exactly
 * the headroom the treasury seeds per book.
 *
 * The bound is `sup_x [x − ln((e^x + 1)/2)] = ln 2`, approached but never
 * reached, so a book seeded with `b·ln 2` complete sets is solvent by
 * construction and can never issue an unbacked claim (invariant I-12).
 */
export function makerLossBound(b: number): number {
  requirePositiveB(b);
  return b * Math.LN2;
}

/** `H(p) = −p·ln p − (1−p)·ln(1−p)` in nats — doc 04 §12. `H(0) = H(1) = 0`. */
export function binaryEntropy(p: number): number {
  requireProbability(p, false);
  if (p === 0 || p === 1) return 0;
  return -p * Math.log(p) - (1 - p) * Math.log(1 - p);
}

/**
 * `b · [ln 2 − H(p)]` — doc 04 §12, the maker loss actually realized when a
 * book walks from a symmetric start to `p` with revenue recycled.
 *
 * The gap between this and `makerLossBound` is the point of the §12 example:
 * a six-point move on a `b = 25,000` book costs the maker ≈ 180 USDC against a
 * 17,328 USDC worst case — two orders of magnitude of headroom unused.
 */
export function makerLossAtPrice(b: number, p: number): number {
  requirePositiveB(b);
  return b * (Math.LN2 - binaryEntropy(p));
}

/**
 * The displacement ledger behind `makerLossAtPrice` — doc 04 §12's "check:"
 * line: units delivered, revenue collected, payout owed at settlement `s = to`.
 *
 * Kept as an exported function because the identity
 * `expectedPayout − revenue = b·[ln 2 − H(to)]` (for `from = 0.5`) is the
 * clearest available explanation of *why* a market maker pays informed flow.
 */
export function makerLossBreakdown(b: number, from: number, to: number): MakerLossBreakdown {
  const delta = displacementForPriceMove(b, from, to);
  const revenue = displacementCost(b, from, to);
  const expectedPayout = delta * to;
  return { delta, revenue, expectedPayout, loss: expectedPayout - revenue };
}

/**
 * `MaxTrade = b/4` per extrinsic — doc 04 §6.4, so single-trade impact is
 * `|Δlogit| ≤ 0.25`.
 *
 * Floored, because the chain computes it as integer division on base units
 * (`market_core::max_trade_amount`). This is the bound that keeps ordinary
 * fill MEV finite without an order book (doc 04 §13).
 */
export function maxTradeAmount(b: number): number {
  requirePositiveB(b);
  return Math.floor(b * MAX_TRADE_RATIO);
}

/**
 * Clamp a price to `[0.001, 0.999]` for **display only** — doc 04 §4, doc 13 §2.
 *
 * The domain admits prices down to ≈1.4e-21; nobody can read that, and a
 * clamped quote must never be fed back into the math, so this is a separate
 * function rather than a mode of `priceLong`.
 */
export function clampQuoteForDisplay(p: number): number {
  if (Number.isNaN(p)) return p;
  return Math.min(QUOTE_CLAMP_MAX, Math.max(QUOTE_CLAMP_MIN, p));
}

// ---------------------------------------------------------------------------
// The doc 04 §6.1 wrapper
// ---------------------------------------------------------------------------

/**
 * Balances go to zero (matching doc 02 §4's `Balance` fields) but prices go to
 * NaN, deliberately: a scene that renders a price without checking `evaluable`
 * should break visibly rather than draw a confident 0.5.
 */
function unevaluable(side: TradeSide, rejection: TradeRejection, maxTrade: number): QuoteResult {
  return {
    side,
    cost: 0,
    fee: 0,
    total: 0,
    priceBefore: Number.NaN,
    priceAfter: Number.NaN,
    exactGross: Number.NaN,
    maxTrade,
    withinDomain: false,
    evaluable: false,
    rejection,
  };
}

function boundsRejection(b: number, amount: number): TradeRejection | null {
  // Doc 04 §6.1 step 2 runs before the cost computation of step 3, so an
  // oversized trade reports its own error rather than PriceBoundExceeded.
  if (amount < MIN_TRADE_USDC) return 'AmountTooSmall';
  if (amount > maxTradeAmount(b)) return 'AmountTooLarge';
  return null;
}

function tradeSide(side: ScalarSide, buying: boolean): TradeSide {
  if (buying) return side === 'Long' ? 'BuyLong' : 'BuyShort';
  return side === 'Long' ? 'SellLong' : 'SellShort';
}

/**
 * Quote a buy through the doc 04 §6.1 wrapper. **Base units throughout.**
 *
 * Steps 2–3 of §6.1: bounds, then `cost = ceil(C(q + Δ) − C(q))` and
 * `fee = ceil(mkt.fee · cost)` — the fee basis is the *rounded* cost, matching
 * `market_core::quote`. Charges round up so the residual lands on the escrow's
 * side (doc 04 §4), which is worth at most one base unit per trade.
 *
 * `bookOpen` models the only condition doc 02 §4 lets set `evaluable: false`
 * on a well-formed request: a missing or non-`Trading` book.
 */
export function buy(
  b: number,
  qLong: number,
  qShort: number,
  side: ScalarSide,
  amount: number,
  feeBps: number = DEFAULT_MKT_FEE_BPS,
  bookOpen = true,
): QuoteResult {
  const ts = tradeSide(side, true);
  if (!Number.isFinite(b) || b <= 0) return unevaluable(ts, 'ArithmeticOverflow', 0);
  const maxTrade = maxTradeAmount(b);
  if (!bookOpen) return unevaluable(ts, 'NotTrading', maxTrade);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(qLong) || !Number.isFinite(qShort)) {
    return unevaluable(ts, 'ArithmeticOverflow', maxTrade);
  }

  const postLong = side === 'Long' ? qLong + amount : qLong;
  const postShort = side === 'Short' ? qShort + amount : qShort;
  const exactGross = costOfBuy(b, qLong, qShort, side, amount);
  // `Math.max(0, …)` normalises the negative zero the rounding epsilon
  // produces for a sub-base-unit gross. A deep out-of-the-money side really
  // does quote at zero base units — at 47 logits a SHORT is worth ~4e-21 — and
  // that is the correct charge, not a masked defect.
  const gross = Math.max(0, roundChargeUp(exactGross));
  const fee = Math.max(0, bpsUp(gross, feeBps));
  const total = gross + fee;
  // Doc 02 §4 requires `evaluable: false` for an *overflowing* book, and doc 04
  // §4 aborts the extrinsic on overflow rather than wrapping. Finite inputs are
  // not enough: `q + Δ` can overflow to `Infinity`, and `gross · bps` can
  // overflow while `gross` itself is finite. A `Balance` field must never carry
  // a non-finite value next to `evaluable: true`.
  if (!Number.isFinite(exactGross) || !Number.isFinite(total)) {
    return unevaluable(ts, 'ArithmeticOverflow', maxTrade);
  }
  // An out-of-domain post-state is a refusal, not a priced datum: the chain's
  // `quote` maps the fixed-point domain error to `PriceBoundExceeded` and the
  // view layer replaces every field with the G-1 zero sentinel. See
  // `chain-quote-agreement.json`'s `exactly_on_the_domain_edge/buy_long`, which
  // is exactly this row and carries an error with no cost beside it.
  //
  // The reported `rejection` still prefers a bounds failure, because the two
  // come from different places and the earlier one is what a trader would see:
  // `quote` never checks the trade bounds at all, while the §6.1 extrinsic
  // checks them *before* it computes any cost.
  const bounds = boundsRejection(b, amount);
  if (!withinDomain(b, postLong, postShort)) {
    return unevaluable(ts, bounds ?? 'PriceBoundExceeded', maxTrade);
  }

  return {
    side: ts,
    cost: gross,
    fee,
    total,
    priceBefore: priceLong(b, qLong, qShort),
    priceAfter: priceLong(b, postLong, postShort),
    exactGross,
    maxTrade,
    withinDomain: true,
    evaluable: true,
    rejection: bounds,
  };
}

/**
 * Quote a sell through the doc 04 §6.1 wrapper. **Base units throughout.**
 *
 * `proceeds = floor(C(q) − C(q − Δ))`, `fee = ceil(mkt.fee · proceeds)`
 * withheld from the proceeds — so `total` is what the seller actually
 * receives. Payouts round down for the same escrow-favouring reason charges
 * round up.
 *
 * A sell larger than the book's inventory on that side is `ArithmeticOverflow`,
 * not a negative quote: the chain's checked subtraction fails first.
 */
export function sell(
  b: number,
  qLong: number,
  qShort: number,
  side: ScalarSide,
  amount: number,
  feeBps: number = DEFAULT_MKT_FEE_BPS,
  bookOpen = true,
): QuoteResult {
  const ts = tradeSide(side, false);
  if (!Number.isFinite(b) || b <= 0) return unevaluable(ts, 'ArithmeticOverflow', 0);
  const maxTrade = maxTradeAmount(b);
  if (!bookOpen) return unevaluable(ts, 'NotTrading', maxTrade);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(qLong) || !Number.isFinite(qShort)) {
    return unevaluable(ts, 'ArithmeticOverflow', maxTrade);
  }
  const held = side === 'Long' ? qLong : qShort;
  if (amount > held) return unevaluable(ts, 'ArithmeticOverflow', maxTrade);

  const postLong = side === 'Long' ? qLong - amount : qLong;
  const postShort = side === 'Short' ? qShort - amount : qShort;
  const exactGross = proceedsOfSell(b, qLong, qShort, side, amount);
  const gross = Math.max(0, roundPayoutDown(exactGross));
  const fee = Math.max(0, bpsUp(gross, feeBps));
  const total = gross - fee;
  // Same doc 02 §4 / doc 04 §4 overflow rule as `buy` — see the note there.
  if (!Number.isFinite(exactGross) || !Number.isFinite(total)) {
    return unevaluable(ts, 'ArithmeticOverflow', maxTrade);
  }
  // Symmetry with `buy`. A sell reduces one side's inventory, so it can leave
  // the domain in the other direction; the guard is stated rather than assumed.
  const bounds = boundsRejection(b, amount);
  if (!withinDomain(b, postLong, postShort)) {
    return unevaluable(ts, bounds ?? 'PriceBoundExceeded', maxTrade);
  }

  return {
    side: ts,
    cost: gross,
    fee,
    total,
    priceBefore: priceLong(b, qLong, qShort),
    priceAfter: priceLong(b, postLong, postShort),
    exactGross,
    maxTrade,
    withinDomain: true,
    evaluable: true,
    rejection: bounds,
  };
}

// ---------------------------------------------------------------------------
// Curve sampling for the market scene
// ---------------------------------------------------------------------------

/** Half-width of the default sweep, in logits: `logit(0.999) = ln 999 ≈ 6.907`. */
const DISPLAY_SPAN_LOGITS = Math.log(QUOTE_CLAMP_MAX / (1 - QUOTE_CLAMP_MAX));

/**
 * Sample the book's price and cost curve across the displayable price range —
 * doc 04 §3 for the curve, doc 04 §4 for the window.
 *
 * The sweep is over net inventory `q_L − q_S`, holding `q_S` fixed, which is
 * precisely the axis a trader walks by buying or selling LONG. It is centred
 * on zero rather than on the book's current state so the drawn curve stays put
 * as the book trades and only the marker (`delta === 0`) moves.
 *
 * The half-width defaults to the quote clamp's logit, `ln 999`, because prices
 * outside `[0.001, 0.999]` are not displayed anyway; it is capped at the
 * `LMSR_DOMAIN_BOUND` of 48 so no sample can leave the domain.
 */
export function sampleCurve(
  b: number,
  qLong: number,
  qShort: number,
  points: number,
  spanLogits: number = DISPLAY_SPAN_LOGITS,
): CurveSample[] {
  requirePositiveB(b);
  if (!Number.isFinite(points) || points < 2) {
    throw new RangeError('sampleCurve needs at least 2 points');
  }
  const span = Math.min(Math.abs(spanLogits), LMSR_DOMAIN_BOUND) * b;
  const currentNet = qLong - qShort;
  const currentCost = cost(b, qLong, qShort);
  const n = Math.floor(points);

  const out: CurveSample[] = [];
  for (let i = 0; i < n; i += 1) {
    const netQ = -span + (2 * span * i) / (n - 1);
    const sampleLong = qShort + netQ;
    const c = cost(b, sampleLong, qShort);
    out.push({
      netQ,
      delta: netQ - currentNet,
      priceLong: priceLong(b, sampleLong, qShort),
      cost: c,
      costFromCurrent: c - currentCost,
    });
  }
  return out;
}
