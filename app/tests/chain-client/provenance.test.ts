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

/* ---------------------------------------------------------------------------- derive */

test('derive projects one read and keeps its pin exactly', () => {
  // 10 §2.2's second clause — "computed client-side purely from such values". The pin is
  // carried over rather than re-taken from anywhere, so a decoded leaf is true at the same
  // block as the bytes it was decoded from.
  const read = finalizedOn(CHAIN_A, 21);
  const doubled = derive(read, (value) => value * 2);
  assert.equal(doubled.value, 42);
  assert.deepEqual(doubled.status, read.status);
});

test('derive is meet’s unary case, so it can grant nothing meet did not', () => {
  // Stated as an equality rather than as a comment, because the whole argument for
  // exporting `derive` from the barrel is that this identity holds: both need a
  // `Finalized<A>` to start from, which only a read produces.
  const read = finalizedOn(CHAIN_A, 21);
  const viaMeet = meet(read, read, (a) => a * 2);
  assert.ok(viaMeet);
  assert.deepEqual(derive(read, (value) => value * 2), viaMeet);
});

test('derive chains, so a decode and a projection of it stay one pin', () => {
  // The shape `market-reads.ts` uses: bytes → decoded → the one field a row reads. A
  // second pin appearing anywhere along that chain is the defect V-176 was.
  const decoded = derive(finalizedOn(CHAIN_A, 30), (value) => ({ bps: BigInt(value) }));
  const projected = derive(decoded, (figures) => figures.bps);
  assert.equal(projected.value, 30n);
  assert.equal(projected.status.blockHash, BLOCK);
  assert.equal(projected.status.chain, CHAIN_A);
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
