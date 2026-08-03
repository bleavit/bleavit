/**
 * Failure codes — the chain's own, deliberately.
 *
 * This package exists so the client can say what the chain *will* do before the
 * user signs (11 §11.3–§11.4). That obligation covers refusals as much as
 * numbers: a quote screen that renders a price for a trade the runtime would
 * reject with `PriceBoundExceeded` has predicted the wrong thing just as surely
 * as one that renders the wrong price. So the codes here are the market
 * pallet's dispatch errors, spelled as the runtime spells them, and the mapping
 * from a kernel fault to a dispatch error mirrors `market-core::map_fixed`.
 *
 * `kind` is kept alongside `code` rather than folded into it because the two
 * answer different questions. `code` is what the extrinsic would return and is
 * what a user-facing string should be keyed on; `kind` is which arithmetic
 * boundary was crossed, which is what a bug report needs. Collapsing them would
 * make every domain fault indistinguishable from every overflow at the point
 * where an expert-mode panel wants to show the difference (10 §2.4).
 */

/** Which arithmetic boundary the 64.64 kernel hit (`futarchy_fixed::FixedError`). */
export type FixedErrorKind = 'Domain' | 'Overflow' | 'DivisionByZero';

/**
 * The subset of `pallet-market`'s errors this package can predict from state
 * plus the trade parameters alone. Errors that depend on chain state this
 * package never sees — `UnknownMarket`, `NotTrading`, `Ledger` — are the
 * precondition layer's job (11 §11.4), not the math's.
 */
export type MarketErrorCode =
  | 'PriceBoundExceeded'
  | 'ArithmeticOverflow'
  | 'SlippageExceeded'
  | 'AmountTooSmall'
  | 'AmountTooLarge';

/** A refusal this package predicts the runtime would produce. */
export class ProtocolError extends Error {
  readonly code: MarketErrorCode;
  /** The kernel fault behind `code`, when a kernel fault is what caused it. */
  readonly kind: FixedErrorKind | undefined;

  constructor(code: MarketErrorCode, message: string, kind?: FixedErrorKind) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.kind = kind;
  }
}

/**
 * `market-core::map_fixed`, reproduced exactly.
 *
 * Note that a *subtraction underflow* in the kernel is `Domain`, and `Domain`
 * maps to `PriceBoundExceeded` — not to an arithmetic error. That looks like a
 * mislabel until you see where it fires: every underflow reachable from the
 * LMSR path is a quantity walking outside the representable price band, which
 * is exactly what `PriceBoundExceeded` names.
 */
export function marketCodeForFixedError(kind: FixedErrorKind): MarketErrorCode {
  return kind === 'Domain' ? 'PriceBoundExceeded' : 'ArithmeticOverflow';
}

/** Raise a kernel fault already carrying its dispatch-level translation. */
export function fixedFault(kind: FixedErrorKind, message: string): ProtocolError {
  return new ProtocolError(marketCodeForFixedError(kind), message, kind);
}
