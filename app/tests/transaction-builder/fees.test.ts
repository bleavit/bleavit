/**
 * Fee currency and mortality/nonce — 11 §11.3, §11.5.
 *
 * Everything here is about a *refusal* or a *rounding direction*, which is why it is
 * tested rather than eyeballed: both are invisible when right and expensive when wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FeeRateUnusableError,
  MORTAL_ERA_BLOCKS,
  MORTAL_ERA_BLOCKS_RAW_EXTERNAL,
  PHASE_PROXIMITY_WARNING_BLOCKS,
  admitRate,
  estimateFee,
  gate,
  mortalityFor,
  nonceFor,
  phaseBoundaryWarning,
} from '@bleavit/transaction-builder';
import type { GatePassed, TxPreparation, VitUsdcRate } from '@bleavit/transaction-builder';
// `finalize` is test-only on purpose — see packages/chain-client/src/testing.ts.
import { finalize } from '@bleavit/chain-client/testing';
import type { Finalized, FinalizedBlockRef } from '@bleavit/chain-client';
import type { HexString } from '@bleavit/shared-types';

const SCALE = 1_000_000n;
const PIN = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 1 };
const finalized = <T>(value: T): Finalized<T> => finalize(value, PIN);
const rate = (value: bigint, reference = 1_000_000n): Finalized<VitUsdcRate> =>
  finalized({ value, reference, scale: SCALE });

/** The preparation the gate fixture below runs over. Its contents are not the subject. */
const GATE_PREP: TxPreparation = {
  scaleHex: '0x0403aabbcc',
  builtFor: { specVersion: 2, metadataHash: `0x${'ab'.repeat(32)}` },
  preparedAt: { blockHash: `0x${'22'.repeat(32)}`, blockNumber: 99 },
  requires: ['P-1'],
};

/**
 * A real `GatePassed`, pinned to a chosen block.
 *
 * The brand is a non-exported `unique symbol`, so a test cannot mint one — and that is the
 * property being exercised rather than dodged: what these functions require is *the gate's
 * own pin*, so the fixture is obtained by running the gate, the only way anything can. The
 * suite then proves they refuse a mismatched one.
 */
const gatePin = (blockHash: HexString = `0x${'11'.repeat(32)}`, blockNumber = 1): GatePassed => {
  const at: FinalizedBlockRef = { blockHash, blockNumber };
  const outcome = gate(GATE_PREP, at, GATE_PREP.builtFor, [
    { id: 'P-1', ok: true, requirement: 'r', expected: 'e', actual: 'a', at },
  ]);
  assert.equal(outcome.kind, 'proceed', 'the gate fixture no longer opens');
  return outcome.passed;
};

test('a rate inside [0.1x, 10x] of its reference is admitted', () => {
  assert.equal(admitRate(rate(1_000_000n)).value, 1_000_000n);
  assert.equal(admitRate(rate(100_000n)).value, 100_000n);      // exactly 0.1x
  assert.equal(admitRate(rate(10_000_000n)).value, 10_000_000n); // exactly 10x
});

test('a rate outside its bounds is refused, never clamped', () => {
  // Clamping would transact at a price the constitution says is impossible, and the user
  // would never learn the chain and the client disagreed.
  assert.throws(() => admitRate(rate(99_999n)), FeeRateUnusableError);
  assert.throws(() => admitRate(rate(10_000_001n)), FeeRateUnusableError);
});

test('the bound is cross-multiplied, not divided', () => {
  // A divided bound floors, and a rate outside a floored bound reads as inside it.
  //
  // The discriminating case has to be picked, not guessed: reference 17 makes the true
  // lower bound 1.7, which floors to 1. The correct check refuses value 1 (1x10 = 10 <
  // 17); a floored one asks `1 < 1` and admits it. An earlier version of this test used
  // reference 7 and value 0 — and value 0 is rejected by the non-positive guard several
  // lines above, so it never reached the bound logic at all and the mutation survived.
  assert.throws(() => admitRate(rate(1n, 17n)), FeeRateUnusableError);
  assert.equal(admitRate(rate(2n, 17n)).value, 2n); // 20 >= 17, genuinely in range
});

test('an unreadable or nonsensical rate yields no figure rather than a default', () => {
  assert.throws(() => admitRate(finalized({ value: 1n, reference: 1n, scale: 0n })), FeeRateUnusableError);
  assert.throws(() => admitRate(rate(0n)), FeeRateUnusableError);
  assert.throws(() => admitRate(finalized({ value: 1n, reference: 0n, scale: SCALE })), FeeRateUnusableError);
});

test('the USDC leg rounds up', () => {
  // Rounding down understates what the account must hold, and the failure lands as a
  // rejection *after* signing — the one point where the user has already committed.
  const admitted = admitRate(rate(1_500_000n));
  assert.equal(estimateFee(1n, admitted, 'USDC').usdc, 2n); // 1.5 -> 2, not 1
  assert.equal(estimateFee(2n, admitted, 'USDC').usdc, 3n);
});

test('headroom is denominated in the selected asset, so USDC-only accounts stay viable', () => {
  // A viability check denominated in VIT would deny exactly the accounts D-12 exists for.
  const admitted = admitRate(rate(2_000_000n));
  assert.equal(estimateFee(100n, admitted, 'VIT').headroom, 100n);
  assert.equal(estimateFee(100n, admitted, 'USDC').headroom, 200n);
});

test('the estimate discloses the key and its bounds (11 §11.5, expert mode)', () => {
  const disclosure = estimateFee(1n, admitRate(rate(1_000_000n)), 'VIT').disclosure;
  assert.match(disclosure, /fee\.vit_usdc_rate/);
  assert.match(disclosure, /0\.1×, 10×/);
});

test('mortality is 64 blocks, and 256 only for a raw-external payload', () => {
  const pin = gatePin(`0x${'11'.repeat(32)}`, 500);
  assert.equal(mortalityFor(pin).periodBlocks, MORTAL_ERA_BLOCKS);
  assert.equal(mortalityFor(pin, true).periodBlocks, MORTAL_ERA_BLOCKS_RAW_EXTERNAL);
  // The longer era is a longer replay window, so it must be opt-in rather than default.
  assert.notEqual(MORTAL_ERA_BLOCKS, MORTAL_ERA_BLOCKS_RAW_EXTERNAL);
  assert.ok(MORTAL_ERA_BLOCKS < MORTAL_ERA_BLOCKS_RAW_EXTERNAL);
});

test('the era is anchored to the block the GATE pinned, not to a caller-chosen number', () => {
  // 11 §11.3: "era 64 blocks from B′". This took a bare `number` until an adversarial
  // review pointed out that the era IS the staleness bound — the user spends unbounded time
  // at a wallet prompt and nothing re-checks afterwards; what stops a stale signature being
  // included is that it expires. Anchored to the wrong block, the bound is simply not
  // applied, and the transaction still looks valid.
  assert.equal(mortalityFor(gatePin(`0x${'11'.repeat(32)}`, 900)).fromBlock, 900);
  assert.equal(mortalityFor(gatePin(`0x${'22'.repeat(32)}`, 12)).fromBlock, 12);
});

test('the nonce adds in-flight increments to the finalized read', () => {
  // A broadcast transaction has consumed a nonce the finalized state has not observed;
  // signing the finalized nonce again produces a duplicate the chain drops.
  assert.equal(nonceFor(gatePin(), finalized(7n), 0), 7n);
  assert.equal(nonceFor(gatePin(), finalized(7n), 3), 10n);
  assert.throws(() => nonceFor(gatePin(), finalized(7n), -1), RangeError);
});

test('a nonce read at a different block than the gate pinned is REFUSED', () => {
  // 11 §11.3 says "at B′". A nonce one block earlier is a perfectly valid Finalized<bigint>
  // describing a different state, and signing with it yields a duplicate or a gap — which
  // the user experiences as "nothing happened".
  assert.throws(() => nonceFor(gatePin(`0x${'99'.repeat(32)}`, 1), finalized(7n), 0), RangeError);
});

test('the block HASH decides, not the height — a reorg can reuse a height', () => {
  // Same height, different block. Comparing heights would accept the sibling.
  assert.throws(() => nonceFor(gatePin(`0x${'ab'.repeat(32)}`, 1), finalized(7n), 0), RangeError);
});

test('a phase boundary inside the window warns, outside it does not', () => {
  assert.equal(phaseBoundaryWarning(100, 100 + PHASE_PROXIMITY_WARNING_BLOCKS), undefined);
  assert.match(String(phaseBoundaryWarning(100, 110)), /phase boundary is 10 block\(s\) away/);
  assert.equal(phaseBoundaryWarning(100, 99), undefined, 'a passed boundary is not a proximity warning');
});
