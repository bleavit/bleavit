/**
 * `meet` and `readmitFromLeader` — 10 §2.1, §4.4, and F18's two-chain rule.
 *
 * Both functions were exported from the package root with **no test of their own**. That
 * was survivable while there was one chain: `meet`'s block check and
 * `readmitFromLeader`'s pin comparison were each doing one obvious thing. F18 adds a
 * second light client (Asset Hub, 02 §7.7), and at that point both functions start
 * deciding something they were never asked before — whether two reads describe the same
 * *chain* — so the gap stops being survivable.
 *
 * Every cross-chain case below holds the **block hash equal** across the two chains. That
 * is deliberate and it is the only construction that proves anything: two real chains
 * never share a block hash, so a cross-chain pair with different hashes is refused by the
 * pre-existing block check and would pass with the chain check deleted. Such a test
 * witnesses nothing. Fixing the hash removes the block check from the picture and leaves
 * the chain comparison as the only thing that can refuse.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { derive, meet, readmitFromLeader } from '@bleavit/chain-client';
import type { Verified } from '@bleavit/shared-types';

const CHAIN_A = `0x${'ce'.repeat(32)}` as `0x${string}`;
const CHAIN_B = `0x${'a5'.repeat(32)}` as `0x${string}`;
const BLOCK = `0x${'11'.repeat(32)}` as `0x${string}`;

const pin = (chain: `0x${string}`, blockHash = BLOCK, blockNumber = 42) =>
  ({ chain, blockHash, blockNumber }) as const;

/**
 * `finalize` is deliberately not exported from the package root, so a test cannot wrap a
 * value it already holds — which is the whole design. `readmitFromLeader` is the other
 * mint site and it is a *checked* one, so building fixtures through it exercises the real
 * admission path rather than working around it.
 */
function finalizedOn(chain: `0x${string}`, value: number, blockHash = BLOCK, blockNumber = 42) {
  const raw: Verified<number> = {
    value,
    status: { kind: 'verified-finalized', chain, blockHash, blockNumber },
  };
  const admitted = readmitFromLeader(raw, pin(chain, blockHash, blockNumber));
  assert.ok(admitted, 'the fixture itself must be admissible');
  return admitted;
}

/* ---------------------------------------------------------------------------- derive */

test('derive carries the READ’s pin, not one the caller could name', () => {
  // The whole of why this exists. Every reader in `src/` used to write its own
  // `finalized(value)` helper closing over a `FinalizedBlockRef`, which took any value at all
  // and returned a `verified-finalized` badge — so whether the badge was true was decided at
  // the call site rather than by the type. `derive` cannot be reached without a read, and the
  // pin it attaches is that read's own.
  const read = finalizedOn(CHAIN_A, 100, BLOCK, 42);
  const out = derive(read, (value) => value * 2);
  assert.equal(out.value, 200);
  assert.equal(out.status.chain, CHAIN_A);
  assert.equal(out.status.blockHash, BLOCK);
  assert.equal(out.status.blockNumber, 42);
});

test('derive grants nothing: it has no way in without an existing read', () => {
  // Stated as a property of the signature rather than as a runtime check, because that is
  // where it lives. `finalize(value, pin)` takes two caller-supplied arguments and so labels
  // anything; `derive(read, compute)` takes a `Finalized<A>`, and a caller holding no read
  // has nothing to pass. The observable half is that the pin is never an argument — so a
  // derived value cannot be attributed to a block the input was not read at.
  const read = finalizedOn(CHAIN_A, 7, BLOCK, 42);
  const other = derive(read, () => 'anything at all');
  assert.deepEqual({ ...other.status }, { ...read.status });
});

test('derive composes without drifting off the pin', () => {
  const read = finalizedOn(CHAIN_B, 3, BLOCK, 9);
  const twice = derive(derive(read, (n) => n + 1), (n) => n * 10);
  assert.equal(twice.value, 40);
  assert.equal(twice.status.chain, CHAIN_B);
  assert.equal(twice.status.blockNumber, 9);
});

/* ------------------------------------------------------------------------------ meet */

test('meet combines two reads from the same chain at the same block', () => {
  const combined = meet(finalizedOn(CHAIN_A, 10), finalizedOn(CHAIN_A, 32), (a, b) => a + b);
  assert.ok(combined);
  assert.equal(combined.value, 42);
  assert.equal(combined.status.chain, CHAIN_A);
  assert.equal(combined.status.blockHash, BLOCK);
});

test('meet refuses two chains AT THE SAME BLOCK HASH — the chain check, isolated', () => {
  // With the hash held equal the block check cannot fire, so a refusal here is the chain
  // comparison and nothing else. Delete that line and this test fails; delete it and use
  // different hashes instead, and the test passes while the property is gone.
  const combined = meet(finalizedOn(CHAIN_A, 10), finalizedOn(CHAIN_B, 32), (a, b) => a + b);
  assert.equal(combined, undefined);
});

test('meet still refuses two blocks on one chain — the older check is not replaced', () => {
  const other = `0x${'22'.repeat(32)}` as `0x${string}`;
  const combined = meet(
    finalizedOn(CHAIN_A, 10),
    finalizedOn(CHAIN_A, 32, other, 43),
    (a, b) => a + b,
  );
  assert.equal(combined, undefined);
});

/* ------------------------------------------------------------ readmitFromLeader (§4.4) */

test('a leader value is re-admitted against its own pin', () => {
  const raw: Verified<number> = {
    value: 7,
    status: { kind: 'verified-finalized', chain: CHAIN_A, blockHash: BLOCK, blockNumber: 42 },
  };
  const admitted = readmitFromLeader(raw, pin(CHAIN_A));
  assert.ok(admitted);
  assert.equal(admitted.value, 7);
});

test('re-admission refuses a payload from another chain at the same block and number', () => {
  // The realistic follower-tab mistake once the leader holds two light clients: an Asset
  // Hub payload checked against the futarchy pin. Every other field is made to agree, so
  // only the chain can catch it.
  const raw: Verified<number> = {
    value: 7,
    status: { kind: 'verified-finalized', chain: CHAIN_B, blockHash: BLOCK, blockNumber: 42 },
  };
  assert.equal(readmitFromLeader(raw, pin(CHAIN_A)), undefined);
});

test('re-admission still refuses an unverified payload and a mismatched block', () => {
  const provider: Verified<number> = {
    value: 7,
    status: { kind: 'provider', providerId: 'p', sampled: false },
  };
  assert.equal(readmitFromLeader(provider, pin(CHAIN_A)), undefined);

  const wrongNumber: Verified<number> = {
    value: 7,
    status: { kind: 'verified-finalized', chain: CHAIN_A, blockHash: BLOCK, blockNumber: 43 },
  };
  assert.equal(readmitFromLeader(wrongNumber, pin(CHAIN_A)), undefined);
});
