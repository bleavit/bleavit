/**
 * Two-outcome LMSR — 04 §3, in the numerically stable form 04 §4 mandates.
 *
 * ```
 * C(q_L, q_S) = b · ln(e^{q_L/b} + e^{q_S/b})
 *             = max(q_L,q_S) + b · ln(1 + e^{−|q_L−q_S|/b})   ← what is computed
 * p_L = e^{q_L/b} / (e^{q_L/b} + e^{q_S/b})
 * ```
 *
 * Every quantity here is 64.64 in **whole USDC**, not base units — the runtime
 * converts at the extrinsic boundary and so does `./quote.js`. Keeping the two
 * apart is why `Fixed` is branded.
 *
 * @see docs/architecture/04-markets-and-pricing.md §3, §4
 */

import { fixedFault, ProtocolError } from './errors.js';
import {
  type Fixed,
  LN_2,
  ONE,
  add,
  div,
  exp2Negative,
  ln,
  lnOnePlus,
  mul,
  sub,
  toRaw,
} from './fixed.js';

/**
 * The LMSR validity domain: `|q_L − q_S| / b ≤ 48` (04 §4). A trade that would
 * leave it MUST be rejected, not clamped.
 *
 * **Why this is compiled in when 15 §5.4 forbids literal chain constants.**
 * That rule governs *chain state and tunables* — anything the runtime could
 * amend under it, which the client must therefore read from metadata rather
 * than assume. This is neither. It is not in 02 §9's frozen metadata-constant
 * table, there is no `Params` key for it, and no governance track can move it:
 * it is a property of the 64.64 representation itself, sitting in the same
 * sentence of 04 §4 as the fractional-bit count and the error bounds. This
 * package already compiles in the rest of that kernel — the 64-entry `exp2`
 * table, `ln 2` to 96 bits, the guard-bit count — because the package *is* the
 * kernel. Refusing this one number would not make the client read it from
 * anywhere; there is nowhere to read it from. It would only make the client
 * unable to predict a refusal the runtime will certainly make.
 *
 * The value is reachable in ordinary trading, which is why predicting it
 * matters: `MaxTrade = b/4` bounds a single extrinsic, so ~192 maximal
 * same-side trades walk a book from the symmetric start to the edge.
 */
export const LMSR_DOMAIN_BOUND = 48n;

/** Side of a two-outcome book. Gate books read YES ↦ Long, NO ↦ Short (04 §3). */
export type LmsrSide = 'long' | 'short';

/** `1.0` on the 1e9 grid the chain stores quotes and observations on (02 §9 `FixedU64`). */
export const PRICE_ONE_1E9 = 1_000_000_000n;

/**
 * Project a 64.64 marginal price onto that grid
 * (`market-core::price_1e9_quantities`). Truncates — a stored quote is never
 * rounded up into a band it did not reach.
 */
export function priceToGrid1e9(price: Fixed): bigint {
  return (toRaw(price) * PRICE_ONE_1E9) >> 64n;
}

/**
 * Reject a state outside `|q_L − q_S| / b ≤ 48`.
 *
 * Compared as `diff > 48·b` rather than by dividing first: the division would
 * truncate and let a state just past the clamp through.
 */
export function ensureDomain(qLong: Fixed, qShort: Fixed, b: Fixed): void {
  if (toRaw(b) === 0n) {
    throw fixedFault('DivisionByZero', 'LMSR subsidy parameter b is zero');
  }
  const diff = qLong >= qShort ? toRaw(qLong) - toRaw(qShort) : toRaw(qShort) - toRaw(qLong);
  if (diff > toRaw(b) * LMSR_DOMAIN_BOUND) {
    throw fixedFault('Domain', `|q_L − q_S| / b exceeds ${LMSR_DOMAIN_BOUND}`);
  }
}

/** True when the state is inside the domain — the non-throwing form. */
export function isWithinDomain(qLong: Fixed, qShort: Fixed, b: Fixed): boolean {
  try {
    ensureDomain(qLong, qShort, b);
    return true;
  } catch (error) {
    if (error instanceof ProtocolError) return false;
    throw error;
  }
}

/** `e^{−|q_L−q_S|/b}`, the shared tail of the cost and price paths. */
function expNegDisplacement(qLong: Fixed, qShort: Fixed, b: Fixed): Fixed {
  const high = qLong >= qShort ? qLong : qShort;
  const low = qLong >= qShort ? qShort : qLong;
  const displacement = div(sub(high, low), b);
  // e^{-x} = 2^{-x/ln 2}: the negative-exponent kernel takes a base-2 argument.
  return exp2Negative(div(displacement, LN_2));
}

/** `C(q_L, q_S)` in the log-sum-exp form (04 §3/§4). */
export function lmsrCost(qLong: Fixed, qShort: Fixed, b: Fixed): Fixed {
  ensureDomain(qLong, qShort, b);
  const high = qLong >= qShort ? qLong : qShort;
  return add(high, mul(b, lnOnePlus(expNegDisplacement(qLong, qShort, b))));
}

/** Marginal price of the LONG side, `p_L ∈ (0,1)`. */
export function lmsrPriceLong(qLong: Fixed, qShort: Fixed, b: Fixed): Fixed {
  ensureDomain(qLong, qShort, b);
  const expNeg = expNegDisplacement(qLong, qShort, b);
  const denominator = add(ONE, expNeg);
  return qLong >= qShort ? div(ONE, denominator) : div(expNeg, denominator);
}

/** Marginal price of the SHORT side, `p_S = 1 − p_L`. */
export function lmsrPriceShort(qLong: Fixed, qShort: Fixed, b: Fixed): Fixed {
  return sub(ONE, lmsrPriceLong(qLong, qShort, b));
}

/** Cost of buying `amount` on `side`, before currency rounding and fees. */
export function lmsrBuyCost(
  qLong: Fixed,
  qShort: Fixed,
  b: Fixed,
  side: LmsrSide,
  amount: Fixed,
): Fixed {
  const before = lmsrCost(qLong, qShort, b);
  const after =
    side === 'long'
      ? lmsrCost(add(qLong, amount), qShort, b)
      : lmsrCost(qLong, add(qShort, amount), b);
  return sub(after, before);
}

/** Proceeds from selling `amount` on `side`, before currency rounding and fees. */
export function lmsrSellProceeds(
  qLong: Fixed,
  qShort: Fixed,
  b: Fixed,
  side: LmsrSide,
  amount: Fixed,
): Fixed {
  const before = lmsrCost(qLong, qShort, b);
  const after =
    side === 'long'
      ? lmsrCost(sub(qLong, amount), qShort, b)
      : lmsrCost(qLong, sub(qShort, amount), b);
  return sub(before, after);
}

/** `logit p` as (sign, magnitude); both branches stay inside the unsigned kernel. */
function logitSignedMagnitude(price: Fixed): { positive: boolean; magnitude: Fixed } {
  if (toRaw(price) === 0n || price >= ONE) {
    throw fixedFault('Domain', 'price must be strictly inside (0, 1)');
  }
  const complement = sub(ONE, price);
  return price >= complement
    ? { positive: true, magnitude: ln(div(price, complement)) }
    : { positive: false, magnitude: ln(div(complement, price)) };
}

/**
 * `Δ = b · (logit p′ − logit p)` — the quantity that displaces the book from
 * one price to another (04 §3). Returned as an unsigned magnitude; the caller
 * reads the direction off the price movement.
 */
export function lmsrDisplacementBetweenPrices(b: Fixed, from: Fixed, to: Fixed): Fixed {
  const start = logitSignedMagnitude(from);
  const end = logitSignedMagnitude(to);
  const displacement =
    start.positive === end.positive
      ? start.magnitude >= end.magnitude
        ? sub(start.magnitude, end.magnitude)
        : sub(end.magnitude, start.magnitude)
      : add(start.magnitude, end.magnitude);
  return mul(displacement, b);
}

/**
 * `cost = b · ln((1 − p)/(1 − p′))` — the revenue of that same displacement
 * (04 §3). Distinct from `lmsrBuyCost` only in being expressed against prices
 * rather than quantities; the two agree, which is vector V3.
 */
export function lmsrDisplacementCost(b: Fixed, from: Fixed, to: Fixed): Fixed {
  const fromComplement = sub(ONE, from);
  const toComplement = sub(ONE, to);
  if (toRaw(toComplement) === 0n) {
    throw fixedFault('Domain', 'target price must be strictly below 1');
  }
  return mul(b, ln(div(fromComplement, toComplement)));
}

/**
 * Worst-case maker loss for a book, `b · ln 2` (04 §3 V4, §6.3).
 *
 * This is also the seeded headroom, which is why the identity matters: 04 §6.3
 * proves the book solvent by construction precisely because the two are the
 * same number.
 */
export function makerWorstCaseLoss(b: Fixed): Fixed {
  return mul(b, LN_2);
}
