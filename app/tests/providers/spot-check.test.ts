/**
 * §8.4's deterministic spot re-derivation — 10 §8.4, 14 TH-50 (F9).
 *
 * The corpus in `snapshot.test.ts` proves the **internal** screens: shape, canonical form, pin,
 * coverage, conservation, derived rows. Every one of them is satisfiable by a competent forger,
 * by construction — that is what "self-consistent" means, and it is why that corpus deliberately
 * admits one deep forgery.
 *
 * This is the screen that asks the chain, and the case it exists for is the **shallow** forgery:
 * a document whose movements sit inside the window the light client can still read, and which
 * every internal screen passes. It is a named TH-50 mitigation and it had no implementation, no
 * injection point and no test until 2026-08-06.
 *
 * Two things the suite is careful about:
 *
 *  - The forged documents here are **admitted** by `admitSnapshot` first, asserted explicitly.
 *    A spot-check test over a document that was already rejected proves nothing about the spot
 *    check.
 *  - `out-of-reach` is asserted to be neither a pass nor a failure, in both directions. A pass
 *    built out of unreachable blocks is §8.4's stated blind spot reported as a verification
 *    result, which is the claim 10 §2.3 and TH-50 both decline to make.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  SNAPSHOT_FORMAT,
  SPOT_CHECK_MAX_BLOCKS,
  admitSnapshot,
  projectOp,
  rejectSnapshot,
  serializeSnapshot,
  snapshotPreimage,
  spotCheckSnapshot,
} from '@bleavit/providers';
import type { SnapshotDocument, SpotClaim, SpotVerdict } from '@bleavit/providers';

const sha256 = (preimage: Uint8Array): string =>
  createHash('sha256').update(preimage).digest('hex');

const BINDING = { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 } as const;

/** The truth: what the chain actually did over blocks 10..13. */
function trueHistory(): SnapshotDocument {
  return {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range: { fromBlock: 10, toBlock: 13 },
    coverage: [{ fromBlock: 10, toBlock: 13 }],
    vaults: [{ vault: 'v1', branches: ['FAIL', 'PASS'] }],
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
      { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
    ],
  };
}

function admit(document: SnapshotDocument) {
  const text = serializeSnapshot(document);
  return admitSnapshot(
    text,
    { expectedPin: sha256(snapshotPreimage(document)), binding: { ...BINDING } },
    sha256,
  );
}

/**
 * A light client that can serve blocks `>= reachableFrom` and knows {@link trueHistory}.
 *
 * The chain's answer is built from a document rather than from the one under test, which is the
 * whole point: a checker derived from the document it is checking agrees with it by
 * construction, which is the same defect `app/tools/snapshot` avoids by reading balances from
 * chain state instead of folding its own ops.
 */
function lightClient(reachableFrom: number, truth: SnapshotDocument = trueHistory()) {
  const asked: number[] = [];
  const check = async (claim: SpotClaim): Promise<SpotVerdict> => {
    asked.push(claim.block);
    if (claim.block < reachableFrom) return { kind: 'out-of-reach' };
    const derived = truth.ops.filter((op) => op.block === claim.block).map(projectOp);
    const same =
      derived.length === claim.movements.length &&
      derived.every((movement, at) => movement === claim.movements[at]);
    return same ? { kind: 'agrees' } : { kind: 'disagrees', derived };
  };
  return { check, asked };
}

// ------------------------------------------------------------------ the positive control

test('an honest snapshot inside the reachable window is re-derived clean', async () => {
  // Anti-vacuity for every rejection below: a screen that disagreed with everything would look
  // identical to one that works.
  const document = trueHistory();
  assert.equal(admit(document).kind, 'admitted');
  const chain = lightClient(10);
  const report = await spotCheckSnapshot(document, chain.check);
  assert.deepEqual(report.findings, []);
  assert.equal(report.compared, 4);
  assert.equal(report.outOfReach, 0);
});

// -------------------------------------------------- the case this screen exists for (TH-50)

test('a SHALLOW forgery inside the pinned window passes every internal screen and fails here', async () => {
  // Alice's split at block 13 is doubled and the balances are adjusted to match, so the document
  // replays, reconciles, orders and pins perfectly — every screen in `snapshot.test.ts` passes.
  // Nothing internal can catch it, because nothing internal knows what the chain did.
  const forged: SnapshotDocument = {
    ...trueHistory(),
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
      { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
      // The lie: a movement at a block the client can still read.
      { kind: 'split', block: 13, vault: 'v1', account: 'mallory', amount: '9000' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
      { vault: 'v1', account: 'mallory', branch: 'FAIL', amount: '9000' },
      { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '9000' },
    ],
  };
  assert.equal(admit(forged).kind, 'admitted', 'the forgery must survive the internal screens');

  const chain = lightClient(10);
  const report = await spotCheckSnapshot(forged, chain.check);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.screen, 'spot-check');
  assert.match(report.findings[0]?.why ?? '', /block 13/);
});

test('the OMISSION direction is caught too — a deleted movement is the cheaper forgery', async () => {
  // A publisher who drops one `redeem` produces a document that replays, reconciles and pins,
  // and it overstates a holder's balance forever. A checker asked only "is this movement real"
  // can never see it; the claim carries the block's WHOLE movement list, including when empty.
  const truncated: SnapshotDocument = {
    ...trueHistory(),
    ops: trueHistory().ops.slice(0, 3),
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
      { vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
    ],
  };
  assert.equal(admit(truncated).kind, 'admitted', 'the omission must survive the internal screens');

  const chain = lightClient(10);
  const report = await spotCheckSnapshot(truncated, chain.check);
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0]?.why ?? '', /block 13/);
});

test('a covered block with no movements is still a claim, and it is asked about', async () => {
  const document = trueHistory();
  const chain = lightClient(10);
  const seen: SpotClaim[] = [];
  await spotCheckSnapshot(document, async (claim) => {
    seen.push(claim);
    return chain.check(claim);
  });
  // Blocks 10..13 each carry exactly one movement here, so add an empty one and re-check.
  const wider: SnapshotDocument = {
    ...document,
    range: { fromBlock: 10, toBlock: 14 },
    coverage: [{ fromBlock: 10, toBlock: 14 }],
  };
  assert.equal(admit(wider).kind, 'admitted');
  const claims: SpotClaim[] = [];
  await spotCheckSnapshot(wider, async (claim) => {
    claims.push(claim);
    return { kind: 'agrees' };
  });
  const empty = claims.find((claim) => claim.block === 14);
  assert.ok(empty !== undefined, 'block 14 is covered, so the document claims nothing happened');
  assert.deepEqual(empty.movements, []);
  assert.ok(seen.length > 0);
});

// ------------------------------------------------------------- the honest limit (§8.4, TH-50)

test('a DEEP forgery is not detected, and the report says the blocks were out of reach', async () => {
  // The unflattering half, asserted rather than described. §8.4: these mechanisms "do not detect
  // a self-consistent forgery of history at depths the light client cannot reach". A suite that
  // only proved detection would be evidence for a guarantee the design declines to make.
  const forged: SnapshotDocument = {
    ...trueHistory(),
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'mallory', amount: '7777' },
      { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'mallory', amount: '200' },
      { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
    ],
    balances: [
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
      { vault: 'v1', account: 'mallory', branch: 'FAIL', amount: '7577' },
      { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '7577' },
    ],
  };
  assert.equal(admit(forged).kind, 'admitted');

  // A light client whose window starts past the whole document — the ordinary case for deep
  // history, which is exactly what §6.4 assigns snapshots.
  const chain = lightClient(1_000);
  const report = await spotCheckSnapshot(forged, chain.check);
  assert.deepEqual(report.findings, [], 'no finding — this is the stated blind spot');
  assert.equal(report.compared, 0, 'and nothing was compared, which the report states plainly');
  assert.equal(report.outOfReach, 4);
});

test('out-of-reach is neither a pass nor a failure, and is counted separately', async () => {
  const document = trueHistory();
  const chain = lightClient(12);
  const report = await spotCheckSnapshot(document, chain.check);
  assert.deepEqual(report.findings, []);
  assert.equal(report.compared, 2, 'blocks 12 and 13');
  assert.equal(report.outOfReach, 2, 'blocks 10 and 11');
});

// ------------------------------------------------------------------ determinism and bounds

test('the walk is DOWNWARD from the newest covered block — the window is at the top', async () => {
  // §4.2: the light client serves a pinned window at the head. Walking upward from the oldest
  // block spends the whole bound on history nothing can answer for, and reports a clean pass
  // consisting entirely of `out-of-reach`.
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 10, toBlock: 13 },
  };
  const chain = lightClient(10);
  await spotCheckSnapshot(document, chain.check);
  assert.deepEqual(chain.asked, [13, 12, 11, 10]);
});

test('the pass is bounded, and the bound is spent on the newest blocks', async () => {
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 0, toBlock: 100_000 },
    coverage: [{ fromBlock: 0, toBlock: 100_000 }],
  };
  assert.equal(admit(document).kind, 'admitted');
  const asked: number[] = [];
  await spotCheckSnapshot(document, async (claim) => {
    asked.push(claim.block);
    return { kind: 'out-of-reach' };
  });
  assert.equal(asked.length, SPOT_CHECK_MAX_BLOCKS);
  assert.equal(asked[0], 100_000);
  assert.equal(asked[asked.length - 1], 100_000 - SPOT_CHECK_MAX_BLOCKS + 1);
});

test('the same document and the same chain produce the same report — §8.4 says deterministic', async () => {
  const document = trueHistory();
  const first = await spotCheckSnapshot(document, lightClient(11).check);
  const second = await spotCheckSnapshot(document, lightClient(11).check);
  assert.deepEqual(first, second);
});

test('a checker that throws aborts the pass rather than shrinking it silently', async () => {
  // The opposite of `runSamplingRound`'s rule, and the difference is the adversary: there the
  // reference is provider-supplied, so a planted one that reliably errors could discard a
  // round's findings. Here the block numbers come from coverage this module already validated,
  // so a throw is the client's own failure — and continuing past it would report a smaller
  // comparison than was attempted, which reads as evidence.
  await assert.rejects(
    () =>
      spotCheckSnapshot(trueHistory(), async () => {
        throw new Error('the light client is not started');
      }),
    /light client is not started/,
  );
});

test('a spot-check finding rejects as FE-PROV-003 with the chain-disagreement remedy', async () => {
  // Not the download-again advice: the file is internally consistent and contradicts the chain,
  // which is what a forged snapshot looks like. Telling somebody to re-download it is wrong,
  // and it is the advice they would act on.
  const chain = lightClient(10);
  const forged: SnapshotDocument = {
    ...trueHistory(),
    ops: [
      { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
      { kind: 'redeem', block: 13, vault: 'v1', account: 'bob', branch: 'PASS', amount: '500' },
      { kind: 'split', block: 13, vault: 'v1', account: 'mallory', amount: '9000' },
    ],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '800' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '800' },
      { vault: 'v1', account: 'bob', branch: 'FAIL', amount: '500' },
      { vault: 'v1', account: 'mallory', branch: 'FAIL', amount: '9000' },
      { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '9000' },
    ],
  };
  const report = await spotCheckSnapshot(forged, chain.check);
  const refusal = rejectSnapshot(report.findings).refusal;
  assert.equal(refusal.code, 'FE-PROV-003');
  assert.match(refusal.detail, /re-derived part of the snapshot from the chain/);
  assert.match(refusal.detail, /what a forged snapshot looks like/);
  assert.doesNotMatch(refusal.detail, /Check that the download completed/);
});

test('maxBlocks must be a positive integer — a zero bound would check nothing and pass', async () => {
  await assert.rejects(() => spotCheckSnapshot(trueHistory(), async () => ({ kind: 'agrees' }), 0), RangeError);
  await assert.rejects(
    () => spotCheckSnapshot(trueHistory(), async () => ({ kind: 'agrees' }), 1.5),
    RangeError,
  );
});
