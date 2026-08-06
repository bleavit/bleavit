/**
 * What a redemption pays, and whether the fee applies at all — 11 §11.5, 03 §5.3/§5.3a.
 *
 * `packages/protocol`'s `redemption.ts` owns the arithmetic and says explicitly that it does
 * **not** own the classification: *"the charged set is decided one layer up
 * (`src/features/tx`) and not by this function's caller guessing."* This module is that layer.
 * Nothing here recomputes a fee; it decides which call is charged, whether the rate may be
 * quoted at all, and what the screen is therefore permitted to display.
 *
 * ## The exempt arm has no `fee` field, and that is the control
 *
 * 11 §11.5 rule 1: the deduction *"MUST NOT be applied, shown, or implied"* for `redeem`,
 * `redeem_void` or any `merge*`, because *"applying it to an exempt call misstates the par
 * promise G-3 depends on"*. P-4, P-5 and §11.6 each say the figure MUST be shown **without a
 * fee line**.
 *
 * An optional `fee?: Combined<bigint>` plus a comment would satisfy all of that and would be
 * one careless render away from breaking it — the same shape `ProposalView` refused for
 * decision statistics. So {@link RedemptionQuote} is a discriminated union whose `exempt` arm
 * carries **no** `fee` and **no** `net`: a screen cannot render a fee line for an exempt call
 * because there is nothing to render, and `net` — the word §11.5 rule 3 makes the headline —
 * exists only where a deduction really happened.
 *
 * ## An unreadable rate blocks a charged redemption and not an exempt one
 *
 * §11.5 rule 5 disables *"the net-payout figure"* and blocks the transaction when either
 * published form of the rate is unreadable or the two disagree. An exempt call has no
 * net-payout figure: its payout is the gross, at par, by a rule that does not mention the
 * rate. Blocking `redeem` because `ledger.redeem_fee` could not be read would be a client
 * refusing what the runtime accepts — the failure 15 §4.8's mirror rule names — and it would
 * do it on the par leg G-3 is stated about. So the rate rows are evaluated only where they
 * bear, and that asymmetry is asserted rather than assumed.
 *
 * ## The out-of-domain rate is a refusal, never a number
 *
 * `redemptionAmounts` **throws** on a rate outside the `Perbill` domain where the runtime
 * waives the fee (03 §5.3a(5) fails open; 11 §11.5 rule 5 requires a client to do the
 * opposite). That throw is caught here exactly once and turned into the `unavailable` arm, so
 * every screen meets it as data. A caller that let it propagate would render a blank region,
 * which is how *"we cannot say"* becomes indistinguishable from zero.
 *
 * @see docs/architecture/11-frontend-workflows.md §11.5, §11.6
 * @see docs/architecture/03-conditional-ledger.md §5.3, §5.3a
 */

import {
  RedemptionRateError,
  firstChargedGross,
  redemptionAmounts,
  redemptionAmountsPair,
} from '@bleavit/protocol';
import { combine, type Combined, type VerificationStatus, type Verified } from '@bleavit/shared-types';

import { perbillToBps } from './trade-ticket.js';

/**
 * Every S4 call that moves USDC to a claimant, primary-domain names (11 §11.2's S4 row).
 *
 * `split*` is absent because it takes USDC rather than paying it, and `transfer` because it
 * moves an instrument between accounts without settling one.
 */
export type PayoutCall =
  | 'merge'
  | 'merge_scalar'
  | 'merge_gate'
  | 'redeem'
  | 'redeem_scalar'
  | 'redeem_scalar_pair'
  | 'redeem_gate'
  | 'redeem_baseline'
  | 'redeem_baseline_pair'
  | 'redeem_void';

/**
 * The charged set of 11 §11.5 rule 1, verbatim and in its order.
 *
 * `app/tests/screens` parses **03 §5.3's own `Fee (§5.3a)` column** and compares, so the two
 * documents check each other rather than this list being trusted. `merge*` is not in that
 * table at all — it is a mint/burn primitive, exempt by §5.3a(1)'s prose — which the suite
 * states as a boundary rather than leaving as a gap.
 */
export type ChargedCall =
  | 'redeem_scalar'
  | 'redeem_scalar_pair'
  | 'redeem_gate'
  | 'redeem_baseline'
  | 'redeem_baseline_pair';

export const CHARGED_CALLS: readonly ChargedCall[] = Object.freeze([
  'redeem_scalar',
  'redeem_scalar_pair',
  'redeem_gate',
  'redeem_baseline',
  'redeem_baseline_pair',
]);

/**
 * The pair calls, whose fee base is their **legs** and not their gross (03 §5.3a(2a)).
 *
 * Kept as its own set rather than inferred from the `_pair` suffix: the suffix is a naming
 * convention and the rule is about the fee base, so a future charged call that happens to end
 * in `_pair` would silently acquire the wrong arithmetic.
 */
export const PAIR_CALLS: readonly ChargedCall[] = Object.freeze([
  'redeem_scalar_pair',
  'redeem_baseline_pair',
]);

/** Why an exempt call is exempt, in the client's own words. One per call, no default. */
export const EXEMPTIONS: Readonly<Record<Exclude<PayoutCall, ChargedCall>, string>> = Object.freeze({
  redeem:
    'This is the par leg. Winning branch-USDC redeems 1:1 and carries no redemption fee ' +
    '(03 §5.3a(1), G-3).',
  redeem_void:
    'This vault was voided. VOID is protocol failure, so no redemption fee is charged — the ' +
    'rate shown is what the account receives (03 §5.3a(1), 11 §11.6).',
  merge:
    'Merging a complete pair pays at par and carries no redemption fee: every merge primitive ' +
    'is exempt (03 §5.3a(1)).',
  merge_scalar:
    'Consolidating a same-branch set pays no USDC at all. It mints one branch-USDC from two ' +
    'legs and carries no fee (11 §11.6 step 1a).',
  merge_gate:
    'Consolidating a same-branch gate set pays no USDC at all. It mints one branch-USDC from ' +
    'two legs and carries no fee (11 §11.6 step 1a).',
});

export function isCharged(call: PayoutCall): call is ChargedCall {
  return (CHARGED_CALLS as readonly string[]).includes(call);
}

export function isPairCall(call: PayoutCall): boolean {
  return (PAIR_CALLS as readonly string[]).includes(call);
}

/**
 * The two published forms of the redemption-fee rate (11 §11.5's preamble, 02 §9 rule 4).
 *
 * `undefined` means *unread*, which rule 5 treats exactly as it treats a disagreement. It is
 * not the same as zero, and the type says so: a zero rate is a readable rate that charges
 * nothing, and collapsing the two would display a fee-free payout the client cannot verify.
 */
export interface RedemptionRateReadings {
  /** `ConditionalLedger::RedemptionFee`, basis points, from the constants API. */
  readonly metadataBps: Verified<bigint> | undefined;
  /** Raw `params(ledger.redeem_fee)`, a `Perbill` inner scalar. */
  readonly paramsPerbill: Verified<bigint> | undefined;
}

/** A reason the payout figure cannot be stated, or the transaction cannot be signed. */
export interface RedemptionBlock {
  readonly check: string;
  readonly detail: string;
}

export interface RedemptionInputs {
  readonly call: PayoutCall;
  /**
   * The claim value the instrument burns — 03 §5.3's own **gross payout** column.
   *
   * Supplied rather than derived here: the gross is a different formula per call
   * (`a`, `floor(a·s)`, `floor(a/2)`, …) and computing it from a call name plus an amount
   * would put a second implementation of §5.3's table in the client.
   */
  readonly gross: Verified<bigint>;
  /**
   * The settlement score `s` on the 1e9 grid. Required for a pair call and refused for
   * anything else — a pair's fee is `fee(floor(a·s)) + fee(floor(a·(1−s)))` and cannot be
   * derived from the gross alone (03 §5.3a(2a)).
   */
  readonly settlementScore?: Verified<bigint> | undefined;
  readonly rate: RedemptionRateReadings;
  /** `ConditionalLedger::MinSplit` `[C]`. `undefined` is unread, and unread blocks. */
  readonly minSplit: Verified<bigint> | undefined;
}

/**
 * What the screen may display.
 *
 * `charged` narrows `call` to {@link ChargedCall}, so an exempt call cannot reach the arm
 * that carries a fee even by construction at a call site.
 */
export type RedemptionQuote =
  | {
      readonly kind: 'exempt';
      readonly call: Exclude<PayoutCall, ChargedCall>;
      /** The whole payout. There is deliberately no `fee` and no `net` on this arm. */
      readonly gross: Combined<bigint>;
      readonly exemption: string;
    }
  | {
      readonly kind: 'charged';
      readonly call: ChargedCall;
      /** `net` first, because §11.5 rule 3 makes it the headline and `gross`/`fee` the itemization. */
      readonly net: Combined<bigint>;
      readonly gross: Combined<bigint>;
      readonly fee: Combined<bigint>;
    }
  | {
      readonly kind: 'unavailable';
      readonly call: PayoutCall;
      readonly reason: string;
    };

/**
 * The smallest gross that is charged at all — 03 §5.3a(2b), for the *"payouts below this are
 * not charged"* sentence.
 *
 * Three arms rather than `bigint | undefined`, because `undefined` would collapse two states
 * this screen must tell apart: *no gross is ever charged* is a fact about a 100 % rate, and
 * *the rate could not be read* is a fact about the client. A user reading the first when the
 * second is true has been told the protocol takes nothing, on no evidence.
 */
export type FeeThreshold =
  | { readonly kind: 'above'; readonly gross: bigint }
  | { readonly kind: 'never' }
  | { readonly kind: 'unknown'; readonly reason: string };

/**
 * The rows 11 §11.5 rule 5 requires before a **net** payout may be stated.
 *
 * Evaluated independently and all failures returned, the same discipline `tradeBlocks`
 * follows for §11.4 rule 5: a user with two problems should see two, not one per attempt.
 *
 * Exported because a caller assembling a confirm surface needs the rows themselves, and
 * because a predicate alone would let the reasons be paraphrased at each call site.
 */
export function redemptionRateBlocks(
  rate: RedemptionRateReadings,
  minSplit: Verified<bigint> | undefined,
): readonly RedemptionBlock[] {
  const blocks: RedemptionBlock[] = [];
  if (rate.metadataBps === undefined) {
    blocks.push({
      check: 'redemption fee rate',
      detail:
        'ConditionalLedger::RedemptionFee could not be read. A net payout is computed from ' +
        'chain-read values or it is not displayed at all (11 §11.5 rule 5).',
    });
  }
  if (rate.paramsPerbill === undefined) {
    blocks.push({
      check: 'redemption fee rate',
      detail:
        'params(ledger.redeem_fee) could not be read. The chain waives the fee on an ' +
        'unreadable record; a client must not display a payout it cannot verify ' +
        '(11 §11.5 rule 5).',
    });
  }
  if (rate.metadataBps !== undefined && rate.paramsPerbill !== undefined) {
    // 02 §9 rule 4's floored projection — exactly the cross-check P-1 applies to
    // `Market::Fee` ↔ `mkt.fee`. Neither side is preferred on disagreement: one of them is
    // stale, and quoting from the stale one states a payout the chain will not pay.
    const projected = perbillToBps(rate.paramsPerbill.value);
    if (projected !== rate.metadataBps.value) {
      blocks.push({
        check: 'redemption fee cross-check',
        detail:
          `ConditionalLedger::RedemptionFee reads ${rate.metadataBps.value} bps and ` +
          `params(ledger.redeem_fee) projects to ${projected} bps. The two published forms of ` +
          'one rate disagree, so neither can be quoted from (11 §11.5 rule 5).',
      });
    }
  }
  if (minSplit === undefined) {
    blocks.push({
      check: 'MinSplit',
      detail:
        'ConditionalLedger::MinSplit could not be read from the constants API. The fee waiver ' +
        'is defined against it (03 §5.3a(2)), so without it the net is not computable.',
    });
  }
  return blocks;
}

/**
 * The 03 §5.3a(2b) threshold, derived from the same predicate the total uses.
 *
 * `searchCeiling` bounds the binary search and belongs to the caller because it is a display
 * decision — how far up the client is willing to look before saying *"not in this range"* —
 * rather than a protocol value.
 */
export function feeThreshold(
  rate: RedemptionRateReadings,
  minSplit: Verified<bigint> | undefined,
  searchCeiling: bigint,
): FeeThreshold {
  const blocks = redemptionRateBlocks(rate, minSplit);
  if (blocks.length > 0) {
    return { kind: 'unknown', reason: blocks.map((block) => block.detail).join(' ') };
  }
  // Both are defined: `redemptionRateBlocks` returned nothing, which it cannot do while
  // either is `undefined`. Narrowed by re-reading rather than asserted, since `as` is the
  // thing this repository spends a gate on.
  const perbill = rate.paramsPerbill;
  const floor = minSplit;
  if (perbill === undefined || floor === undefined) {
    return { kind: 'unknown', reason: 'the rate or MinSplit was not read' };
  }
  try {
    const first = firstChargedGross(perbill.value, floor.value, searchCeiling);
    return first === undefined ? { kind: 'never' } : { kind: 'above', gross: first };
  } catch (error) {
    return { kind: 'unknown', reason: reasonFor(error) };
  }
}

function reasonFor(error: unknown): string {
  return error instanceof RedemptionRateError
    ? error.message
    : `the redemption arithmetic refused these inputs: ${String(error)}`;
}

/**
 * Quote a redemption — the one place the charged/exempt decision is taken.
 *
 * Every figure is a {@link Combined} over the statuses of the reads it came from, so a value
 * derived from a chain read and a metadata constant carries the weaker of the two and a pair
 * read at two different blocks refuses outright rather than claiming a block neither
 * describes (`app/tests/screens` drives that case).
 */
export function quoteRedemption(inputs: RedemptionInputs): RedemptionQuote {
  const { call, gross } = inputs;

  if (!isCharged(call)) {
    if (inputs.settlementScore !== undefined) {
      // A settlement score on an exempt call means the ticket was assembled from two models.
      // It changes no figure here, which is exactly why it must not pass silently.
      return {
        kind: 'unavailable',
        call,
        reason:
          `a settlement score was supplied for ${call}, which is exempt and pays its gross. ` +
          'This ticket was built from two different models.',
      };
    }
    // The rate is deliberately not consulted. An exempt call has no net-payout figure, so
    // §11.5 rule 5 has nothing to disable, and blocking here would refuse the par leg on the
    // strength of a value that does not enter its payout.
    return {
      kind: 'exempt',
      call,
      gross: combine(gross.value, [gross.status]),
      exemption: EXEMPTIONS[call],
    };
  }

  const blocks = redemptionRateBlocks(inputs.rate, inputs.minSplit);
  if (blocks.length > 0) {
    return { kind: 'unavailable', call, reason: blocks.map((block) => block.detail).join(' ') };
  }
  const perbill = inputs.rate.paramsPerbill;
  const floor = inputs.minSplit;
  if (perbill === undefined || floor === undefined) {
    return { kind: 'unavailable', call, reason: 'the rate or MinSplit was not read' };
  }

  const statuses: VerificationStatus[] = [gross.status, perbill.status, floor.status];

  let amounts;
  if (isPairCall(call)) {
    const score = inputs.settlementScore;
    if (score === undefined) {
      return {
        kind: 'unavailable',
        call,
        reason:
          `${call} charges what its two legs would charge — fee(floor(a·s)) + ` +
          'fee(floor(a·(1−s))), each applying its own waiver (03 §5.3a(2a)) — so the ' +
          'settlement score is required. Computing fee(a) instead disagrees with the chain in ' +
          'both directions.',
      };
    }
    statuses.push(score.status);
    try {
      amounts = redemptionAmountsPair(gross.value, score.value, perbill.value, floor.value);
    } catch (error) {
      return { kind: 'unavailable', call, reason: reasonFor(error) };
    }
  } else {
    if (inputs.settlementScore !== undefined) {
      return {
        kind: 'unavailable',
        call,
        reason:
          `a settlement score was supplied for ${call}, whose fee base is its gross ` +
          '(03 §5.3a(2)). This ticket was built from two different models.',
      };
    }
    try {
      amounts = redemptionAmounts(gross.value, perbill.value, floor.value);
    } catch (error) {
      return { kind: 'unavailable', call, reason: reasonFor(error) };
    }
  }

  return {
    kind: 'charged',
    call,
    net: combine(amounts.net, statuses),
    gross: combine(amounts.gross, statuses),
    fee: combine(amounts.fee, statuses),
  };
}

/** Whether the ticket may hand off to `refreshAndGate` (11 §11.4 rule 1, §11.5 rule 5). */
export function mayPrepareRedemption(quote: RedemptionQuote): boolean {
  return quote.kind !== 'unavailable';
}
