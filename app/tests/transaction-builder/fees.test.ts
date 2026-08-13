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
  TipNotPriceableError,
  MORTAL_ERA_BLOCKS,
  MORTAL_ERA_BLOCKS_RAW_EXTERNAL,
  PHASE_PROXIMITY_WARNING_BLOCKS,
  admitRate,
  declaredCoverageIds,
  estimateFee,
  mortalityFor,
  nonceFor,
  phaseBoundaryWarning,
} from '@bleavit/transaction-builder';
import type {
  GatePassed,
  PreconditionResult,
  TxPreparation,
  VitUsdcRate,
} from '@bleavit/transaction-builder';
// `finalize` is test-only on purpose — see packages/chain-client/src/testing.ts.
import { finalize } from '@bleavit/chain-client/testing';
import type { Finalized, FinalizedBlockRef } from '@bleavit/chain-client';
import type { HexString } from '@bleavit/shared-types';
import type { CompatClassification } from '@bleavit/descriptors';
import { gateForTest } from './gate-fixture.ts';

/**
 * The compat verdict this fixture gates against — 10 §3.2's `full` row.
 *
 * `gate()` now requires one and requires it to prove signing: INV-FE-12 disables signing
 * wherever compatibility is unproven, so a fixture that could omit the verdict would be
 * exercising a gate this client does not ship.
 */
const PROVEN: CompatClassification = { mode: 'full', specVersion: 1, disabled: [], proven: [] };


/** The chain identity every pin in this file is read against (F18). Named, not inlined:
 *  the field exists so two reads can agree on it, and copies agree until one is edited. */
const TEST_CHAIN = `0x${'ce'.repeat(32)}` as `0x${string}`;


const SCALE = 1_000_000n;
const PIN = { chain: TEST_CHAIN, blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 1 };
const finalized = <T>(value: T): Finalized<T> => finalize(value, PIN);
const rate = (value: bigint, reference = 1_000_000n): Finalized<VitUsdcRate> =>
  finalized({ value, reference, scale: SCALE });

/** The preparation the gate fixture below runs over. Its contents are not the subject. */
const GATE_PREP: TxPreparation = {
  scaleHex: '0x0403aabbcc',
  signingAccount: '5Grw',
  builtFor: { specVersion: 2, metadataHash: `0x${'ab'.repeat(32)}` },
  preparedAt: { chain: TEST_CHAIN, blockHash: `0x${'22'.repeat(32)}`, blockNumber: 99 },
  requires: ['P-1'],
  feeAsset: 'USDC',
};

/**
 * One passing result per obligation `P-1` imposes.
 *
 * The whole set, because the gate demands coverage **per clause** rather than per row: a
 * lone result naming `P-1` used to satisfy the row and now covers one of its obligations.
 */
const passingResults = (at: FinalizedBlockRef): readonly PreconditionResult[] =>
  declaredCoverageIds('P-1', GATE_PREP.feeAsset).map((id) => ({
    id,
    ok: true,
    requirement: 'r',
    expected: 'e',
    actual: 'a',
    at,
  }));

/**
 * A real `GatePassed`, pinned to a chosen block.
 *
 * The brand is a non-exported `unique symbol`, so a test cannot mint one — and that is the
 * property being exercised rather than dodged: what these functions require is *the gate's
 * own pin*, so the fixture is obtained by running the gate, the only way anything can. The
 * suite then proves they refuse a mismatched one.
 */
const makeGatePin = async (blockHash: HexString, blockNumber: number): Promise<GatePassed> => {
  const at: FinalizedBlockRef = { chain: TEST_CHAIN, blockHash, blockNumber };
  const outcome = await gateForTest(GATE_PREP, at, GATE_PREP.builtFor, PROVEN, passingResults(at));
  assert.equal(outcome.kind, 'proceed', 'the gate fixture no longer opens');
  return outcome.passed;
};

const GATE_PIN_CASES = [
  [`0x${'11'.repeat(32)}` as HexString, 1],
  [`0x${'11'.repeat(32)}` as HexString, 500],
  [`0x${'11'.repeat(32)}` as HexString, 900],
  [`0x${'22'.repeat(32)}` as HexString, 12],
  [`0x${'99'.repeat(32)}` as HexString, 1],
  [`0x${'ab'.repeat(32)}` as HexString, 1],
] as const;
const GATE_PINS = new Map<string, GatePassed>(
  await Promise.all(
    GATE_PIN_CASES.map(async ([hash, number]) => [
      `${hash}:${number}`,
      await makeGatePin(hash, number),
    ] as const),
  ),
);
const gatePin = (blockHash: HexString = `0x${'11'.repeat(32)}`, blockNumber = 1): GatePassed => {
  const passed = GATE_PINS.get(`${blockHash}:${blockNumber}`);
  assert.ok(passed, `no gate fixture for ${blockHash} at ${blockNumber}`);
  return passed;
};

test('a rate inside [0.1x, 10x] of its reference is admitted', () => {
  assert.equal(admitRate(rate(1_000_000n)).value.value, 1_000_000n);
  assert.equal(admitRate(rate(100_000n)).value.value, 100_000n);      // exactly 0.1x
  assert.equal(admitRate(rate(10_000_000n)).value.value, 10_000_000n); // exactly 10x
});

test('the admitted rate carries the pin of the read that was checked (FE-P1, V-301)', () => {
  // The pin is what lets `estimateFee` tell one reading from two. Dropping it was how the
  // old signature made the block-agreement check unstateable rather than merely unchecked.
  const read = rate(1_000_000n);
  const admitted = admitRate(read);
  assert.equal(admitted.status.blockHash, read.status.blockHash);
  assert.equal(admitted.status.chain, read.status.chain);
  assert.equal(admitted.status.kind, 'verified-finalized');
});

/** Assert an estimate exists, then hand back its value. A refusal here is a test failure. */
const estimated = (
  fee: bigint,
  admitted: ReturnType<typeof admitRate>,
  selected: 'VIT' | 'USDC',
) => {
  const out = estimateFee(gatePin(), finalized(fee), admitted, selected);
  assert.ok(out !== undefined, 'the two reads share a pin, so this must not be refused');
  return out.value;
};

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
  assert.equal(admitRate(rate(2n, 17n)).value.value, 2n); // 20 >= 17, genuinely in range
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
  assert.equal(estimated(1n, admitted, 'USDC').usdc, 2n); // 1.5 -> 2, not 1
  assert.equal(estimated(2n, admitted, 'USDC').usdc, 3n);
});

test('headroom is denominated in the selected asset, so USDC-only accounts stay viable', () => {
  // A viability check denominated in VIT would deny exactly the accounts D-12 exists for.
  const admitted = admitRate(rate(2_000_000n));
  assert.equal(estimated(100n, admitted, 'VIT').headroom, 100n);
  assert.equal(estimated(100n, admitted, 'USDC').headroom, 200n);
});

test('the estimate discloses the key and its bounds (11 §11.5, expert mode)', () => {
  const disclosure = estimated(1n, admitRate(rate(1_000_000n)), 'VIT').disclosure;
  assert.match(disclosure, /fee\.vit_usdc_rate/);
  assert.match(disclosure, /0\.1×, 10×/);
});

test('the estimate carries the pin of the reads it priced (10 §2.3, FE-P1)', () => {
  // 10 §2.3 names the fee estimate among the values that MUST be `Finalized<T>`. An
  // estimate that came back unpinned would be a number the confirm screen could render
  // without ever saying which state produced it.
  const out = estimateFee(gatePin(), finalized(7n), admitRate(rate(1_000_000n)), 'VIT');
  assert.ok(out !== undefined);
  assert.equal(out.status.kind, 'verified-finalized');
  assert.equal(out.status.blockHash, PIN.blockHash);
  assert.equal(out.value.vit, 7n);
});

test('a fee read at a block the gate did not pin is refused (11 §11.4 rule 2)', () => {
  // The two are separate reads. Combining them across a block boundary produces an
  // arithmetically perfect figure that describes no state the chain was ever in — and it
  // is invisible, because nothing about the number looks wrong.
  //
  // `meet` alone did not catch this, and that is the point of the check being here. It
  // enforces that the two reads agree with *each other* and says nothing about *which*
  // block they agree on, so a consistent pair read one block behind B′ satisfied it. 11
  // §11.4 rule 2 requires an exact read at B′, and 10 §2.3 names the fee headroom among
  // the rows that obligation covers — so the gate's own pin is the reference, exactly as
  // `nonceFor` has always treated it.
  const otherBlock = finalize(3n, {
    chain: TEST_CHAIN,
    blockHash: `0x${'99'.repeat(32)}` as const,
    blockNumber: 2,
  });
  assert.throws(
    () => estimateFee(gatePin(), otherBlock, admitRate(rate(1_000_000n)), 'VIT'),
    /the fee was read at .* but the gate pinned/,
  );
});

test('a rate read at a block the gate did not pin is refused too (11 §11.4 rule 2)', () => {
  // Both inputs are sourced values under 10 §2.3, so both are checked. Testing only the
  // fee would leave the rate as the way through — and the rate is the input that decides
  // what the number *means* in the currency the user is reading.
  const otherBlock = finalize({ value: 1_000_000n, reference: 1_000_000n, scale: SCALE }, {
    chain: TEST_CHAIN,
    blockHash: `0x${'99'.repeat(32)}` as const,
    blockNumber: 2,
  });
  assert.throws(
    () => estimateFee(gatePin(), finalized(3n), admitRate(otherBlock), 'VIT'),
    /the rate was read at .* but the gate pinned/,
  );
});

test('a fee and a rate read on different chains yield no estimate (F18)', () => {
  // Asset Hub is a second light client. A fee read there priced against the futarchy
  // chain's constitution rate is two chains' state in one figure.
  //
  // This is also what keeps `meet` load-bearing after the B′ check landed above: the block
  // hashes all agree here, so only `meet` can see that the *chains* do not.
  const otherChain = finalize(3n, {
    chain: `0x${'aa'.repeat(32)}` as const,
    blockHash: PIN.blockHash,
    blockNumber: PIN.blockNumber,
  });
  assert.equal(estimateFee(gatePin(), otherChain, admitRate(rate(1_000_000n)), 'VIT'), undefined);
});

test('a negative fee is refused rather than priced', () => {
  assert.throws(
    () => estimateFee(gatePin(), finalized(-1n), admitRate(rate(1_000_000n)), 'VIT'),
    FeeRateUnusableError,
  );
});

test('a tip is refused rather than priced, and the code is FE-FEE-002 (10 §2.3, §9.4)', () => {
  // `partial_fee` excludes the tip, so a headroom computed from it understates what the
  // account must hold by exactly the tip — and the shortfall lands as a rejection *after*
  // the user has signed. Understating is the one failure this module must not choose, so
  // it refuses instead, and the refusal expires when the headroom question is ruled.
  assert.throws(
    () => estimateFee(gatePin(), finalized(7n), admitRate(rate(1_000_000n)), 'VIT', 5n),
    (err: unknown) => {
      assert.ok(err instanceof TipNotPriceableError);
      // The code is asserted, not just the class: 10 §9.4 admits no free-text errors, and
      // the taxonomy entry is what the confirm screen renders.
      assert.equal(err.code, 'FE-FEE-002');
      return true;
    },
  );
});

test('an explicit zero tip prices normally — the refusal is of a tip, not of the parameter', () => {
  // Anti-vacuity for the test above: a refusal that fired on every call would look
  // identical here and would have deleted the function rather than bounded it.
  const out = estimateFee(gatePin(), finalized(7n), admitRate(rate(1_000_000n)), 'VIT', 0n);
  assert.ok(out !== undefined);
  assert.equal(out.value.headroom, 7n);
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
