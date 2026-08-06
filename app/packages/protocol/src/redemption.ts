/**
 * The 03 §5.3a redemption fee, in base units.
 *
 * This is the second thing the client has to be able to say before a user
 * signs: `./quote.js` answers *what will this trade charge*, and this module
 * answers *what will this redemption pay*. 11 §11.5 makes `net` the headline
 * figure on every charged redemption, so getting it wrong is not a cosmetic
 * error — it is the number the user decides on.
 *
 * Three properties carry the whole module, and each is a case where the
 * obvious implementation disagrees with the chain:
 *
 * 1. **The waiver tests the net, not the gross** (§5.3a(2)). `fee(g) = 0`
 *    exactly when `g − ceil(g·rate) < min_split`. A gross test (`g < min_split`)
 *    disagrees across the whole boundary band, not at an edge: at the 30 bps
 *    default a gross of 10,000 has a provisional fee of 30, so the runtime
 *    **waives it and pays 10,000** while a gross-based client displays a 30 fee
 *    and a 9,970 net. That is ordinary traffic, and the confirm screen would
 *    disagree with the chain on it.
 * 2. **A pair charges what its legs would charge** (§5.3a(2a)):
 *    `fee_pair(a) = fee(floor(a·s)) + fee(floor(a·(1−s)))`, **not** `fee(a)`.
 *    A waiver applied per call against a fee applied to a combined base is what
 *    made the pair path pay *less* than leg-by-leg redemption of the same
 *    holdings. At `a = 20,000`, `s = 0.70005`, 30 bps: `fee(a)` gives a net of
 *    19,940 against leg-by-leg's 19,957 — the assembled holder punished for
 *    being assembled, which inverts the atomic call's whole reason to exist.
 *
 *    **`fee(a)` errs in both directions, measured** (`app/tests/protocol`, over
 *    the corpus's own rows): the waiver makes it *over*state at `a = 20,000`
 *    (60 against 43, one leg falling under `min_split`), and two independent
 *    per-leg ceilings make it *under*state at `a = 1,000,000` (3,000 against
 *    3,001). The second is the direction a client must fear — a fee below the
 *    chain's puts a net **above** what the account receives on the screen the
 *    user decides on.
 * 3. **The fee rounds up**, against the claimant (§5.3a(2), 03 §7 R-1). Same
 *    direction as `./quote.js`'s charge, for the same reason: a figure a base
 *    unit under the chain's is a figure the user will find wrong afterwards.
 *
 * **Where this deliberately does not mirror the runtime.** `effective_redeem_fee`
 * on the chain fails **open** — a missing, malformed or out-of-domain rate reads
 * as zero, waiving the fee, because taking value from a claimant on the strength
 * of a record the runtime could not parse is the worse direction (03 §5.3a(5)).
 * A client MUST NOT copy that: 11 §11.5 rule 5 says an unreadable rate disables
 * the net-payout figure and blocks the transaction, because a fee-free payout the
 * client cannot verify is a promise it cannot keep. So an out-of-domain rate
 * **throws** here where the chain would waive. The divergence is one-directional
 * and safe: every rate governance can actually set is inside the domain (13 rule
 * 7 screens it at the amendment boundary), so the arm only fires on state that is
 * already malformed.
 *
 * **Every tunable is an argument**, exactly as in `./quote.js`. `ledger.redeem_fee`
 * and `ledger.min_split` are chain reads (02 §9, 13 §1); nothing here defaults
 * them, so a caller that forgets one gets a type error rather than a stale launch
 * value baked into a payout.
 *
 * Conformance is 04 §5's: `app/tests/protocol` replays the corpus's
 * `ledger_fee_scenarios` family — the same generated artifact the backend
 * certifies against — rather than any expectation written beside this code.
 *
 * @see docs/architecture/03-conditional-ledger.md §5.3a
 * @see docs/architecture/11-frontend-workflows.md §11.5
 */

import { PRICE_ONE_1E9 } from './lmsr.js';

/**
 * `1.0` as a `Perbill` inner scalar — the unit `ledger.redeem_fee` is stored in.
 *
 * Numerically equal to {@link SCORE_ONE_1E9} and deliberately a separate name:
 * `Perbill` is Substrate's and `FixedU64` is ours, they are free to move apart,
 * and a single constant serving both would make that a silent break rather than
 * a compile error.
 */
export const PERBILL_ONE = 1_000_000_000n;

/**
 * `1.0` as a settlement score `s` (`futarchy_primitives::kernel::SCORE_SCALE`).
 *
 * Aliased rather than re-declared: this is the same 1e9 grid `./lmsr.js` already
 * names for quotes and observations, because `FixedU64` has **one** scale. Two
 * literals would be two chances to drift on a value with no metadata home to
 * re-read (02 §9 exposes no `ScoreScale` constant — checked against
 * `tools/release/surface-manifest.json`, not assumed).
 */
export const SCORE_ONE_1E9 = PRICE_ONE_1E9;

/**
 * A rate or score outside its own domain.
 *
 * Separate from `ProtocolError` because that type carries a `pallet-market`
 * dispatch code, and there is no dispatch error to name here: the chain does not
 * refuse an out-of-domain rate, it waives the fee. This is the *client* refusing
 * to state a number it cannot verify (11 §11.5 rule 5), which is a different
 * event and must not be reported as a prediction of what the runtime will do.
 */
export class RedemptionRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedemptionRateError';
  }
}

/** A charged redemption's three figures. `net` is the headline (11 §11.5 rule 3). */
export interface RedemptionAmounts {
  /** The claim value the instrument burns. */
  readonly gross: bigint;
  /** The protocol's deduction — never summed with the §11.3 transaction fee. */
  readonly fee: bigint;
  /** What the account receives: `gross − fee`. */
  readonly net: bigint;
}

/** The LONG and SHORT gross payouts a pair's holdings would take leg by leg. */
export interface PairLegs {
  readonly long: bigint;
  readonly short: bigint;
}

function requireBaseUnits(value: bigint, what: string): bigint {
  if (value < 0n) throw new RedemptionRateError(`${what} must be a non-negative base-unit amount`);
  return value;
}

function requireRate(rate: bigint): bigint {
  if (rate < 0n || rate > PERBILL_ONE) {
    throw new RedemptionRateError(
      `ledger.redeem_fee is outside the Perbill domain (${rate.toString()}); the chain waives the ` +
        'fee on an unreadable record, but a client must not display a payout it cannot verify ' +
        '(11 §11.5 rule 5)',
    );
  }
  return rate;
}

function requireScore(sRaw: bigint): bigint {
  if (sRaw < 0n || sRaw > SCORE_ONE_1E9) {
    throw new RedemptionRateError(
      `settlement score is outside [0, 1] on the 1e9 grid (${sRaw.toString()})`,
    );
  }
  return sRaw;
}

/** `ceil(gross · rate / 1e9)` in exact integer arithmetic — rounds against the claimant. */
function chargeUp(gross: bigint, rate: bigint): bigint {
  const numerator = gross * rate;
  return numerator === 0n ? 0n : (numerator - 1n) / PERBILL_ONE + 1n;
}

/**
 * The fee on a gross payout — 03 §5.3a(2).
 *
 * ```
 * fee(g) = 0                if g − ceil(g · rate) < min_split
 *        = ceil(g · rate)   otherwise
 * ```
 *
 * Applies **only** to the charged calls of §5.3a(1). Calling it for `redeem`,
 * `redeem_void` or any `merge*` overstates nothing — it returns a number for a
 * call that is exempt, which is why the charged set is decided one layer up
 * (`src/features/tx`) and not by this function's caller guessing.
 */
export function redemptionFee(gross: bigint, rate: bigint, minSplit: bigint): bigint {
  requireBaseUnits(gross, 'gross payout');
  requireBaseUnits(minSplit, 'ledger.min_split');
  const fee = chargeUp(gross, requireRate(rate));
  /* c8 ignore next 3 -- unreachable while `rate ≤ PERBILL_ONE`; kept because §5.3a(2)
     states `fee(g) ≤ g` as the reason no payout can go negative, and a silent
     violation of it would be a negative `net` rendered as a payout. */
  if (fee > gross) {
    throw new RedemptionRateError('redemption fee exceeds the gross payout');
  }
  return gross - fee < minSplit ? 0n : fee;
}

/** `gross`, `fee` and `net` together, so a screen cannot render two of the three. */
export function redemptionAmounts(
  gross: bigint,
  rate: bigint,
  minSplit: bigint,
): RedemptionAmounts {
  const fee = redemptionFee(gross, rate, minSplit);
  return { gross, fee, net: gross - fee };
}

/**
 * `floor(a·s)` and `floor(a·(1−s))` — the bases a pair's fee is computed from.
 *
 * Integer arithmetic on the 1e9 grid rather than a division of decimals: the
 * two legs must floor **independently**, and their sum is `≤ a` rather than `= a`
 * whenever the flooring loses anything. That gap is exactly the pair path's
 * surviving gross advantage (§5.3a(2a)), so an implementation that derived the
 * short leg as `a − long` would erase it.
 */
export function pairLegs(amount: bigint, sRaw: bigint): PairLegs {
  requireBaseUnits(amount, 'pair amount');
  requireScore(sRaw);
  return {
    long: (amount * sRaw) / SCORE_ONE_1E9,
    short: (amount * (SCORE_ONE_1E9 - sRaw)) / SCORE_ONE_1E9,
  };
}

/**
 * The fee on `redeem_scalar_pair` / `redeem_baseline_pair` — 03 §5.3a(2a).
 *
 * `fee(floor(a·s)) + fee(floor(a·(1−s)))`, each leg applying its own waiver.
 */
export function redemptionFeePair(
  amount: bigint,
  sRaw: bigint,
  rate: bigint,
  minSplit: bigint,
): bigint {
  const legs = pairLegs(amount, sRaw);
  return (
    redemptionFee(legs.long, rate, minSplit) + redemptionFee(legs.short, rate, minSplit)
  );
}

/**
 * A pair's three figures. Gross is exactly `a` — only the fee base differs
 * (§5.3a(2a)), which is why this cannot be `redemptionAmounts(a, …)`.
 */
export function redemptionAmountsPair(
  amount: bigint,
  sRaw: bigint,
  rate: bigint,
  minSplit: bigint,
): RedemptionAmounts {
  const fee = redemptionFeePair(amount, sRaw, rate, minSplit);
  return { gross: amount, fee, net: amount - fee };
}

/**
 * The smallest gross that is charged at all — 03 §5.3a(2b).
 *
 * Useful to a screen that wants to say *payouts below this are not charged*, and
 * the reason it is a search rather than the doc's closed form is that the doc's
 * closed form is an **approximation** (`≈ min_split / (1 − rate)`). Deriving the
 * displayed threshold from the same predicate {@link redemptionFee} applies means
 * the sentence on screen and the number in the total cannot disagree.
 *
 * Returns `undefined` when no gross is ever charged — which is a reachable state,
 * not an error: at a 100 % rate the threshold is unreachable and the fee collects
 * nothing (§5.3a(2b)). A caller must render that as *no fee applies*, never as a
 * missing figure.
 *
 * Relies on the predicate being **monotone**: `g − ceil(g·rate)` is
 * non-decreasing in `g` for every rate ≤ 1, so the waived set is a prefix
 * interval and there is no second band to search for (§5.3a(2b)).
 */
export function firstChargedGross(
  rate: bigint,
  minSplit: bigint,
  searchCeiling: bigint,
): bigint | undefined {
  requireRate(rate);
  requireBaseUnits(minSplit, 'ledger.min_split');
  requireBaseUnits(searchCeiling, 'search ceiling');
  if (redemptionFee(searchCeiling, rate, minSplit) === 0n) return undefined;
  let waived = 0n;
  let charged = searchCeiling;
  while (charged - waived > 1n) {
    const mid = (waived + charged) / 2n;
    if (redemptionFee(mid, rate, minSplit) === 0n) waived = mid;
    else charged = mid;
  }
  return charged;
}
