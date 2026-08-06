/**
 * `@bleavit/protocol` — the normative TypeScript port of Bleavit's market math.
 *
 * Five layers, bottom up:
 *
 * * `fixed`      — the guarded 64.64 kernel (04 §4): `exp2`, `log2`, `ln`, and the
 *   maker-adverse currency rounding.
 * * `lmsr`       — the cost function, prices, buy/sell and displacement (04 §3).
 * * `quote`      — what `buy`/`sell` actually charge, in base units (04 §6.1).
 * * `twap`       — the slew-capped observation accumulator (04 §7).
 * * `redemption` — what a charged redemption pays, in base units (03 §5.3a).
 *
 * The last one is the reason this package is *protocol* math rather than market
 * math: 11 §11.5 makes `net` the headline figure on a redemption exactly as
 * `quote` is on a trade, both are certified against the same generated corpus,
 * and splitting them would put one integer-rounding discipline in two packages.
 *
 * Everything is `bigint`. Nothing here reads the chain, holds state, or knows
 * what provenance is: a value this package computes is `derived-local` in the
 * caller's hands (10 §2.1), and it is the caller that labels it.
 *
 * Conformance is defined by 04 §5 against `reference-model/fixtures/vectors.json`
 * — the single generated corpus, which the backend certifies against too. The
 * suite in `app/tests/protocol` reads that file directly rather than a copy, so
 * there is nothing to keep in sync and no second generator (04 §5, rule 1).
 */

export {
  type FixedErrorKind,
  type MarketErrorCode,
  ProtocolError,
  fixedFault,
  marketCodeForFixedError,
} from './errors.js';

export {
  type Fixed,
  FRAC_BITS,
  LN_2,
  ONE,
  ONE_RAW,
  ZERO,
  add,
  div,
  exp2,
  exp2Negative,
  fromInteger,
  fromRaw,
  ln,
  lnOnePlus,
  log2,
  mul,
  roundChargeUp,
  roundPayoutDown,
  sub,
  toRaw,
} from './fixed.js';

export {
  type LmsrSide,
  LMSR_DOMAIN_BOUND,
  PRICE_ONE_1E9,
  ensureDomain,
  isWithinDomain,
  lmsrBuyCost,
  lmsrCost,
  lmsrDisplacementBetweenPrices,
  lmsrDisplacementCost,
  lmsrPriceLong,
  lmsrPriceShort,
  lmsrSellProceeds,
  makerWorstCaseLoss,
  priceToGrid1e9,
} from './lmsr.js';

export {
  type BookState,
  type BuyQuote,
  type QuoteView,
  type SellQuote,
  type TradeBounds,
  BPS_DENOMINATOR,
  USDC_ONE,
  baseUnitsToFixed,
  ensureTradeBounds,
  feeUp,
  fixedToBaseUnitsDown,
  fixedToBaseUnitsUp,
  maxTradeAmount,
  quoteBuy,
  quoteSell,
  withinTradeBounds,
} from './quote.js';

export {
  type PairLegs,
  type RedemptionAmounts,
  PERBILL_ONE,
  RedemptionRateError,
  SCORE_ONE_1E9,
  firstChargedGross,
  pairLegs,
  redemptionAmounts,
  redemptionAmountsPair,
  redemptionFee,
  redemptionFeePair,
} from './redemption.js';

export {
  type ObservationOutcome,
  type ObservationParams,
  type ObservationState,
  intervalsElapsed,
  isStaleGap,
  mul1e9,
  mul1e9Up,
  observe,
  pow1e9,
  pow1e9Up,
  slewBounds,
  twapBetween,
  windowStaleEvents,
} from './twap.js';
