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
 */

import type { Finalized } from '@bleavit/chain-client';
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
 */
export function admitRate(read: Finalized<VitUsdcRate>): AdmittedRate {
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
  return rate as AdmittedRate;
}

export interface FeeEstimate {
  readonly vit: bigint;
  readonly usdc: bigint;
  readonly selected: FeeAsset;
  /** The amount that must be free in the selected asset. */
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
 */
export function estimateFee(
  feeInVit: bigint,
  rate: AdmittedRate,
  selected: FeeAsset,
): FeeEstimate {
  if (feeInVit < 0n) throw new FeeRateUnusableError('a negative fee is not an estimate');
  const usdc = (feeInVit * rate.value + rate.scale - 1n) / rate.scale;
  return {
    vit: feeInVit,
    usdc,
    selected,
    headroom: selected === 'VIT' ? feeInVit : usdc,
    disclosure:
      `fee.vit_usdc_rate = ${rate.value}/${rate.scale} (reference ${rate.reference}, ` +
      'bounded [0.1×, 10×], PARAM-adjustable)',
  };
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
