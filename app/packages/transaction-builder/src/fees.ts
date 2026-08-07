/**
 * Fee currency and mortality/nonce — 11 §11.3, §11.5 (D-12, X-14 resolved).
 *
 * Two things that look like presentation and are not. A fee estimate decides whether an
 * account can transact at all, and a mortality era decides how long a signed payload stays
 * replayable; both are computed from finalized reads or not computed.
 *
 * **The rate is read, bounded, and never defaulted.** `fee.vit_usdc_rate` is a
 * `Constitution.Params` storage read, light-client verified, PARAM-adjustable and bounded
 * to [0.1×, 10×] of its reference. All three matter separately: unreadable means *no
 * figure* rather than a stale one, and a rate outside its own bounds means the key is not
 * usable rather than clamped — clamping would quietly transact at a price the constitution
 * says is impossible, which is worse than refusing, because the user would never learn the
 * chain and the client disagreed.
 *
 * **USDC-only accounts are always viable**, which is why headroom is computed in the
 * *selected* asset rather than converted to VIT for a single comparison. An account with
 * no VIT at all must be able to pay, so a viability check denominated in VIT would deny
 * exactly the accounts D-12 exists to serve.
 *
 * **The chain's own fee figure is sourced, and that is now a verified fact rather than a
 * conservative posture (FE-P1, V-301).** 10 §2.3 names the fee estimate and the fee
 * headroom explicitly among the values that MUST be `Finalized<T>` — *"named explicitly
 * because it is the one an implementer is most likely to take from a wallet or an RPC"* —
 * and then qualified itself: *"FE-P1 leaves the exact PAPI fee-estimation surface open, so
 * until it resolves the conservative reading is in force"*. FE-P1's fee half is resolved.
 * PAPI 2.1.8 answers `getEstimatedFees` from `TransactionPaymentApi_query_info` issued as
 * `chainHead.call$(null, …)`, and `null` resolves to the **finalized** hash (V-82), so the
 * figure is verified state and the strong reading applies. This module therefore takes the
 * fee as a read rather than as a number: `bigint` accepted a wallet's guess, an RPC's
 * answer and a literal on equal terms with a light-client read, and no type said otherwise.
 *
 * **And two reads are not one reading.** The fee and the rate are separate reads, so the
 * estimate goes through `meet`, which refuses a pair from different blocks instead of
 * picking one. INV-FE-2 requires a precondition to be evaluated at a single finalized
 * block, and a fee priced at B against a rate read at B−1 is exactly the composite that
 * requirement excludes — invisible in the arithmetic, and wrong on the confirm screen.
 *
 * **One reading is still not B′.** `meet` binds the two reads to each other and not to the
 * block the gate pinned, so a consistent pair read at B−1 passed it. 11 §11.4 rule 2 requires
 * an exact read at B′ and 10 §2.3 puts the fee headroom under that rule, so `estimateFee`
 * takes `GatePassed` and refuses a read from any other block — the same discipline `nonceFor`
 * has always applied, which is why the fee's lacking it was a gap rather than a choice.
 *
 * **The tip is refused, because `partial_fee` excludes it.** 10 §2.3 names that as one of the
 * three ways to hold the right API and still get an unsourced number, and `FeeEstimate.headroom`
 * is documented as *the* amount that must be free. A headroom that omitted the tip would
 * understate by exactly the tip, and the account would come up short after the user had
 * already signed. Whether headroom absorbs the tip or renders as its own line is not settled
 * — 11 §11.3 and §11.5 are both silent — so the module refuses a tipped estimate
 * (`FE-FEE-002`) rather than publishing a figure it cannot stand behind.
 */

import { derive, meet, type Finalized } from '@bleavit/chain-client';
import type { GatePassed } from './machine.js';

export type { FeeAsset } from './fee-asset.js';

import type { FeeAsset } from './fee-asset.js';

export class FeeRateUnusableError extends Error {
  readonly code = 'FE-FEE-001';
  constructor(message: string) {
    super(message);
    this.name = 'FeeRateUnusableError';
  }
}

/**
 * A tip was asked for, and this module cannot price one — 10 §9.4 `FE-FEE-002`.
 *
 * `TransactionPaymentApi_query_info`'s `partial_fee` **excludes the tip** (10 §2.3, which
 * names it among the three ways to hold the right API and still get an unsourced number).
 * So a headroom computed from `partial_fee` understates what the account must hold by
 * exactly the tip, and the shortfall lands as a rejected transaction *after* the user has
 * signed — the one point in the flow where consent has already been given.
 *
 * Whether headroom must absorb the tip or render as its own line is not this module's call:
 * 11 §11.3 and §11.5 are both silent, and `FeeEstimate.headroom` is documented as *the*
 * amount that must be free. Refusing is the only reading that cannot understate, so it is
 * the one in force until that question is ruled.
 */
export class TipNotPriceableError extends Error {
  readonly code = 'FE-FEE-002';
  constructor(message: string) {
    super(message);
    this.name = 'TipNotPriceableError';
  }
}

/**
 * `fee.vit_usdc_rate` as the constitution publishes it, with the bounds it is held to.
 *
 * The reference is carried alongside the live value because the bound is *relative* to it
 * ([0.1×, 10×]); a client holding only the live value cannot tell an amended rate from an
 * out-of-range one, and would have to trust whichever it was handed.
 */
export interface VitUsdcRate {
  /** USDC per VIT, scaled by `scale`. Integer arithmetic throughout — see `packages/protocol`. */
  readonly value: bigint;
  readonly reference: bigint;
  readonly scale: bigint;
}

declare const RATE_ADMITTED: unique symbol;

/**
 * A rate that has passed `admitRate` — the only kind `estimateFee` accepts.
 *
 * The brand exists because `admitRate` used to return the same `VitUsdcRate` it was given,
 * so the bounds check was **advisory**: any caller could build a rate literal, or take one
 * from a provider read, and hand it straight to `estimateFee`. Every test called
 * `admitRate` first, so the omission was invisible — the suite proved the checker worked
 * and never that anything used it.
 *
 * What that buys an attacker is a number on a confirm screen. A 100× rate makes a fee look
 * negligible in the currency the user is reading, or makes headroom look unreachable in the
 * one they hold; either way the figure they consent to is not the figure the chain charges.
 * 11 §11.3 requires the *live bounded* rate, and "bounded" is the half a type can carry.
 *
 * Same construction as `GatePassed` and `Finalized<T>`: a phantom `unique symbol` no caller
 * outside this module can mint.
 */
export type AdmittedRate = VitUsdcRate & { readonly [RATE_ADMITTED]: true };

const LOWER_NUMERATOR = 1n;
const LOWER_DENOMINATOR = 10n;
const UPPER_MULTIPLE = 10n;

/**
 * Admit a rate only if it is within [0.1×, 10×] of its reference.
 *
 * Cross-multiplied rather than divided: a division would floor the bound itself, and a
 * rate one unit outside a floored bound reads as inside it.
 *
 * **The read's pin travels with the admitted rate.** This used to return a bare
 * `AdmittedRate`, which threw away the one thing that says *which block* the constitution
 * published that rate at — so `estimateFee` had no way to check that its two inputs
 * described the same state, and no caller could be made to supply it. `derive` reattaches
 * the pin of the read that was actually checked; it cannot attach any other, which is why
 * it is the sanctioned spelling rather than a `finalize` call this package is barred from.
 */
export function admitRate(read: Finalized<VitUsdcRate>): Finalized<AdmittedRate> {
  const rate = read.value;
  if (rate.scale <= 0n) {
    throw new FeeRateUnusableError('fee.vit_usdc_rate has a non-positive scale; no figure can be computed');
  }
  if (rate.value <= 0n || rate.reference <= 0n) {
    throw new FeeRateUnusableError('fee.vit_usdc_rate is non-positive; refusing to price a fee from it');
  }
  if (rate.value * LOWER_DENOMINATOR < rate.reference * LOWER_NUMERATOR) {
    throw new FeeRateUnusableError(
      `fee.vit_usdc_rate ${rate.value} is below 0.1× its reference ${rate.reference}; the ` +
        'constitution does not admit this rate, and clamping it would transact at a price ' +
        'the chain says is impossible',
    );
  }
  if (rate.value > rate.reference * UPPER_MULTIPLE) {
    throw new FeeRateUnusableError(
      `fee.vit_usdc_rate ${rate.value} is above 10× its reference ${rate.reference}; the ` +
        'constitution does not admit this rate',
    );
  }
  return derive(read, (checked) => checked as AdmittedRate);
}

export interface FeeEstimate {
  readonly vit: bigint;
  readonly usdc: bigint;
  readonly selected: FeeAsset;
  /**
   * The amount that must be free in the selected asset.
   *
   * **Untipped, and structurally so.** `partial_fee` excludes the tip (10 §2.3), so this
   * figure is complete only for a transaction carrying none — which `estimateFee` enforces
   * by refusing any other (`FE-FEE-002`). It is not a floor a caller may add a tip to and
   * still call headroom.
   */
  readonly headroom: bigint;
  /** Shown in expert mode — 11 §11.5 requires the key and its bounds to be displayed. */
  readonly disclosure: string;
}

/**
 * Both currencies for one fee, and the headroom in the selected one.
 *
 * Rounds the USDC leg **up**. A fee estimate that rounds down understates what the account
 * must hold, and the failure lands as a rejected transaction after signing — the one point
 * in the flow where the user has already committed.
 *
 * **Takes the chain's VIT fee as a read, not as a number (10 §2.3; FE-P1, V-301).** The
 * figure this prices is `TransactionPaymentApi_query_info`'s `partial_fee` for these exact
 * bytes, and PAPI answers it at the finalized block — so it *is* available as
 * `Finalized<bigint>`, and there is no longer any reason for the type to accept a value
 * with no read behind it. The previous `bigint` parameter is the exact shape 10 §2.3 warns
 * about: it took a wallet's estimate, an RPC's answer, and a literal on the same terms as a
 * light-client read.
 *
 * **Returns `undefined` when the two reads disagree about the block.** That is `meet`'s
 * refusal, not a failure mode invented here: two reads at two blocks describe no single
 * state, and INV-FE-2 evaluates every precondition at one finalized block. A caller that
 * gets `undefined` has no fee figure — which is the honest answer, and the same shape
 * `admitRate` already takes for an out-of-bounds rate.
 *
 * **And one reading is not B′.** `meet` enforces that the two reads agree with *each other*
 * and says nothing about *which* block they agree on, so a consistent pair read at B−1 used
 * to satisfy it. 11 §11.4 rule 2 requires every precondition row to be an exact read at B′,
 * and the fee headroom is such a row — 10 §2.3 names it explicitly. `nonceFor` below already
 * takes `GatePassed` for exactly this reason; the fee is the same obligation and had none of
 * the enforcement. Hashes are compared rather than heights, because two blocks can share a
 * height across a reorg and the gate pinned one of them.
 *
 * **A tip is refused, not absorbed (`FE-FEE-002`).** See `TipNotPriceableError`: `partial_fee`
 * excludes it, so pricing one here would understate `headroom` by exactly the tip.
 */
export function estimateFee(
  passed: GatePassed,
  feeInVit: Finalized<bigint>,
  rate: Finalized<AdmittedRate>,
  selected: FeeAsset,
  tip: bigint = 0n,
): Finalized<FeeEstimate> | undefined {
  if (feeInVit.value < 0n) throw new FeeRateUnusableError('a negative fee is not an estimate');
  if (tip !== 0n) {
    throw new TipNotPriceableError(
      `a tip of ${tip} was requested, and partial_fee excludes the tip (10 §2.3), so the ` +
        'headroom this returns would understate what the account must hold by exactly that ' +
        'amount — and the shortfall would land as a rejection after signing. Whether headroom ' +
        'absorbs the tip or renders as its own line is an open spec question (11 §11.3, §11.5)',
    );
  }
  for (const [what, read] of [
    ['fee', feeInVit],
    ['rate', rate],
  ] as const) {
    if (read.status.blockHash !== passed.at.blockHash) {
      throw new RangeError(
        `the ${what} was read at ${read.status.blockHash} but the gate pinned ` +
          `${passed.at.blockHash}; a fee priced against another block is not the exact read ` +
          'at B′ that 11 §11.4 rule 2 requires',
      );
    }
  }
  return meet(feeInVit, rate, (fee, admitted) => {
    const usdc = (fee * admitted.value + admitted.scale - 1n) / admitted.scale;
    return {
      vit: fee,
      usdc,
      selected,
      headroom: selected === 'VIT' ? fee : usdc,
      disclosure:
        `fee.vit_usdc_rate = ${admitted.value}/${admitted.scale} (reference ${admitted.reference}, ` +
        'bounded [0.1×, 10×], PARAM-adjustable)',
    };
  });
}

/* --------------------------------------------------------------- mortality and nonce */

/** 11 §11.3: era 64 blocks from B′, 256 for a raw-external payload. */
export const MORTAL_ERA_BLOCKS = 64;
export const MORTAL_ERA_BLOCKS_RAW_EXTERNAL = 256;
/** 11 §11.3: warn when a relevant phase boundary is closer than this. */
export const PHASE_PROXIMITY_WARNING_BLOCKS = 25;

export interface Mortality {
  readonly periodBlocks: number;
  readonly fromBlock: number;
}

/**
 * The era for a payload signed against B′ — **B′ being the block the gate actually pinned**.
 *
 * 11 §11.3 says "era 64 blocks from B′", and this used to take a bare `number`, which let a
 * caller name any block at all. That is the whole staleness bound: the gate reads
 * preconditions at one finalized block and then the user spends an unbounded amount of time
 * at a wallet prompt, during which balances, freezes and nonces move. Nothing re-checks
 * afterwards — what keeps a stale signature from being *included* is that the era expires.
 * An era anchored to the wrong block is therefore not an off-by-one; it is the bound not
 * being applied, and it is invisible because the transaction still looks perfectly valid.
 *
 * So the anchor is taken from `GatePassed`, which only `gate()` can mint. "The era starts at
 * the block the preconditions were read at" stops being a convention a caller must honour.
 *
 * A raw-external payload gets the longer era because it makes a round trip through an
 * air-gapped device or a QR scan, and a 64-block era would expire mid-transcription. It is
 * a *longer replay window*, so it is opt-in per payload rather than the default — the
 * shorter era is the safer one and the one every in-app signature uses.
 */
export function mortalityFor(passed: GatePassed, rawExternal = false): Mortality {
  const at = passed.at.blockNumber;
  if (!Number.isInteger(at) || at < 0) throw new RangeError(`not a block number: ${at}`);
  return {
    periodBlocks: rawExternal ? MORTAL_ERA_BLOCKS_RAW_EXTERNAL : MORTAL_ERA_BLOCKS,
    fromBlock: at,
  };
}

/**
 * The nonce to sign with: the finalized nonce at B′ plus what is already in flight.
 *
 * The in-flight count is *added*, never substituted: a broadcast transaction has consumed
 * a nonce the finalized state has not yet observed, so signing the finalized nonce again
 * produces a second transaction the chain will drop as a duplicate. Taking the finalized
 * read as the base is what keeps this from drifting — an internal counter alone loses
 * track the moment anything is signed elsewhere for the same account.
 */
export function nonceFor(
  passed: GatePassed,
  finalizedNonce: Finalized<bigint>,
  inFlight: number,
): bigint {
  if (!Number.isInteger(inFlight) || inFlight < 0) {
    throw new RangeError(`in-flight count must be a non-negative integer: ${inFlight}`);
  }
  // 11 §11.3 says "at B′", and B′ is the gate's pin. A nonce read one block earlier is a
  // perfectly valid `Finalized<bigint>` for a *different* state, and signing with it
  // produces a transaction the chain drops as a duplicate or a gap — a failure the user
  // sees as "nothing happened". Comparing the hash rather than the height is deliberate:
  // two blocks can share a height across a reorg, and the gate pinned one of them.
  if (finalizedNonce.status.blockHash !== passed.at.blockHash) {
    throw new RangeError(
      `the nonce was read at ${finalizedNonce.status.blockHash} but the gate pinned ` +
        `${passed.at.blockHash}; a nonce from another block does not describe the state ` +
        'this signature was gated against (11 §11.3)',
    );
  }
  return finalizedNonce.value + BigInt(inFlight);
}

/** 11 §11.3's proximity warning: a boundary inside the window invalidates the plan, not the tx. */
export function phaseBoundaryWarning(at: number, boundaryAt: number): string | undefined {
  const distance = boundaryAt - at;
  if (distance < 0 || distance >= PHASE_PROXIMITY_WARNING_BLOCKS) return undefined;
  return (
    `a phase boundary is ${distance} block(s) away (< ${PHASE_PROXIMITY_WARNING_BLOCKS}); ` +
    'preconditions evaluated now may not hold when this is included'
  );
}
