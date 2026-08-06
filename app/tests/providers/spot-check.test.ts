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
  SPOT_CHECK_BLOCK_CEILING,
  admitSnapshot,
  importSnapshotStream,
  projectOp,
  rejectSnapshot,
  serializeSnapshot,
  snapshotPreimage,
  snapshotRefusal,
  spotCheckSnapshot,
} from '@bleavit/providers';
import type {
  Provider,
  SnapshotChunk,
  SnapshotDocument,
  SpotClaim,
  SpotVerdict,
} from '@bleavit/providers';

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

const PUBLISHER: Provider = { id: 'archive-one', kind: 'snapshot', health: { kind: 'healthy' } };

async function* streamOf(text: string): AsyncIterable<SnapshotChunk> {
  yield { text, bytes: new TextEncoder().encode(text).length };
}

/**
 * A light client that can serve blocks `>= reachableFrom` and knows {@link trueHistory}.
 *
 * The chain's answer is built from a document rather than from the one under test, which is the
 * whole point: a checker derived from the document it is checking agrees with it by
 * construction, which is the same defect `app/tools/snapshot` avoids by reading balances from
 * chain state instead of folding its own ops.
 */
function lightClient(
  reachableFrom: number,
  truth: SnapshotDocument = trueHistory(),
  reachableTo = Number.POSITIVE_INFINITY,
) {
  const asked: number[] = [];
  const check = async (claim: SpotClaim): Promise<SpotVerdict> => {
    asked.push(claim.block);
    // The two sides are stated, not inferred, because a real light client knows both: `above` is
    // ahead of this device's head, `below` is past the bottom of its pinned window.
    if (claim.block > reachableTo) return { kind: 'out-of-reach', where: 'above-window' };
    if (claim.block < reachableFrom) return { kind: 'out-of-reach', where: 'below-window' };
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
  assert.equal(report.reach, 'whole-document', 'the walk ran out of document, not out of window');
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
  // One, not four: the newest covered block already answers *below the window*, and the window is
  // one contiguous interval, so every older covered block is unreachable too. The walk is finished
  // rather than abandoned, and `reach` says which.
  assert.equal(report.outOfReach, 1);
  assert.equal(report.reach, 'window-floor');
});

test('DEEP HISTORY LARGER THAN THE CEILING is admitted, not refused as an unfinished check', async () => {
  // The blocker this direction exists for, in the shape that reaches a user. §6.4 assigns deep
  // history to snapshots *"by design, not by omission"*, so a document whose whole coverage sits
  // below the reachable window is the format's primary case rather than an edge one — and it is
  // the case an undirected `out-of-reach` got exactly backwards.
  //
  // With one verdict and no side, the loop inferred *above the window* from `compared === 0` and
  // kept descending: it spent all 512 asks on blocks whose answer it already had, hit the ceiling,
  // raised `spot-check-incomplete`, and the importer turned that into `FE-PROV-003`. §8.4 lists
  // three causes for that code and *"this device did not finish"* is not one of them; §8.4 names
  // the depth limit as **disclosed**, not as a refusal. So a valid 216,000-block snapshot was
  // rejected, and INV-FE-15's acceleration obligation with it.
  const coverage = { fromBlock: 1_000, toBlock: 217_999 };
  assert.ok(
    coverage.toBlock - coverage.fromBlock + 1 > SPOT_CHECK_BLOCK_CEILING,
    'the case needs coverage LARGER than the ceiling — inside it, the old walk terminated anyway',
  );
  const document: SnapshotDocument = {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range: { ...coverage },
    coverage: [{ ...coverage }],
    vaults: [{ vault: 'v1', branches: ['FAIL', 'PASS'] }],
    ops: [{ kind: 'split', block: 1_500, vault: 'v1', account: 'alice', amount: '1000' }],
    balances: [
      { vault: 'v1', account: 'alice', branch: 'FAIL', amount: '1000' },
      { vault: 'v1', account: 'alice', branch: 'PASS', amount: '1000' },
    ],
  };
  assert.equal(admit(document).kind, 'admitted', 'the file screens pass — nothing is wrong with it');

  // Every answer is `below-window`: this device's pinned window is at the head and the whole
  // document predates it.
  let asked = 0;
  const report = await spotCheckSnapshot(document, async () => {
    asked += 1;
    return { kind: 'out-of-reach', where: 'below-window' };
  });

  assert.deepEqual(report.findings, [], 'no finding: §8.4 discloses this limit, it does not refuse');
  assert.equal(report.compared, 0, 'nothing was inside the window, and the report says so plainly');
  assert.equal(report.outOfReach, 1);
  assert.equal(report.reach, 'window-floor');
  assert.equal(asked, 1, 'one ask, not 512 — the rest have a known answer');

  // And end to end, which is where the refusal was measured: the importer admits it and mints.
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    {
      provider: PUBLISHER,
      admission: { expectedPin: sha256(snapshotPreimage(document)), binding: { ...BINDING } },
      sha256,
      maxInputBytes: 1_000_000,
      budgetBytes: 10_000_000,
      footprint: [],
      importedAt: 1_700_000_000_000,
    },
    {
      spotCheck: async () => ({ kind: 'out-of-reach', where: 'below-window' }),
      confirmEviction: async () => true,
    },
  );
  assert.equal(outcome.kind, 'imported');
  if (outcome.kind !== 'imported') return;
  assert.equal(outcome.spotCheck.reach, 'window-floor');
  assert.equal(outcome.minted.status.kind, 'provider');
  if (outcome.minted.status.kind !== 'provider') return;
  // Admitted is not verified: nothing was compared, so nothing claims it was. That pairing is the
  // whole of §8.4's honest limit — the rows load, and they say what they are.
  assert.equal(outcome.minted.status.sampled, false);
});

test('A DEVICE FURTHER BEHIND THAN THE CEILING is disclosed, not refused', async () => {
  // The first of the two live configurations that reached the ceiling with nothing wrong with
  // the file, and this suite asserted a refusal on it until 2026-08-06. Every answer is
  // `above-window`: this device is more than SPOT_CHECK_BLOCK_CEILING blocks behind the
  // document's newest covered block, which is a fact about the device and not about the
  // publisher. §8.4's three `FE-PROV-003` causes are all statements about the document, so the
  // pass discloses where it stopped instead of refusing.
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 0, toBlock: 100_000 },
    coverage: [{ fromBlock: 0, toBlock: 100_000 }],
  };
  const report = await spotCheckSnapshot(document, async () => ({
    kind: 'out-of-reach',
    where: 'above-window',
  }));
  assert.equal(report.reach, 'ceiling');
  assert.equal(report.outOfReach, SPOT_CHECK_BLOCK_CEILING);
  assert.deepEqual(report.findings, [], 'a disclosure raises no finding');
  assert.equal(report.compared, 0);
  // And it does not become a refusal one layer along either: nothing here is an FE-PROV-003.
  assert.deepEqual(rejectSnapshot(report.findings).findings, []);
});

test('THE SECOND ceiling configuration — more reachable blocks than asks — is also disclosed', async () => {
  // The one whose refusal was **permanent**, which is what made it worse than the first. Every
  // covered block here is inside the window and agrees, so the old remedy sentence — *"try again
  // when this device has caught up with the chain"* — was false: this device had caught up, and
  // the document simply covers more reachable blocks than one pass will ask about. Catching up
  // more changes nothing, so the file could never be imported.
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 0, toBlock: 100_000 },
    coverage: [{ fromBlock: 0, toBlock: 100_000 }],
  };
  assert.equal(admit(document).kind, 'admitted', 'the file screens pass — nothing is wrong with it');
  const report = await spotCheckSnapshot(document, async () => ({ kind: 'agrees' }));
  assert.equal(report.reach, 'ceiling');
  assert.equal(report.compared, SPOT_CHECK_BLOCK_CEILING, 'every ask was spent comparing');
  assert.deepEqual(report.findings, [], 'no finding: this device ran out of asks, not the file');
});

test('out-of-reach is neither a pass nor a failure, and is counted separately', async () => {
  const document = trueHistory();
  const chain = lightClient(12);
  const report = await spotCheckSnapshot(document, chain.check);
  assert.deepEqual(report.findings, []);
  assert.equal(report.compared, 2, 'blocks 12 and 13');
  // One, not two: the walk stops the moment it leaves the window below, because the reachable
  // window is one contiguous interval and every older covered block is unreachable too. The
  // count is what was *asked*, and asking about the rest is spending a user's device to be told
  // something already known.
  assert.equal(report.outOfReach, 1, 'block 11 answered out-of-reach and the walk stopped there');
  assert.equal(report.reach, 'window-floor');
  assert.deepEqual(chain.asked, [13, 12, 11]);
});

test('an out-of-reach ABOVE the window does not stop the walk', async () => {
  // The asymmetry a simpler rule gets wrong. A document whose newest covered block is ahead of
  // this device's head answers `out-of-reach` at the top; stopping there would compare nothing
  // while the blocks a few positions down are perfectly readable.
  const document = trueHistory();
  const chain = lightClient(10, trueHistory(), 12);
  const report = await spotCheckSnapshot(document, chain.check);
  assert.deepEqual(report.findings, []);
  assert.equal(report.compared, 3, 'blocks 12, 11 and 10, having descended past an unreachable 13');
  assert.equal(report.outOfReach, 1);
  assert.equal(report.reach, 'whole-document');
  assert.deepEqual(chain.asked, [13, 12, 11, 10]);
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

test('the pass is bounded, the bound is spent on the NEWEST blocks, and hitting it is STATED', async () => {
  // The ceiling exists so a document covering millions of blocks terminates. What it must never
  // do is stop **quietly**: the previous constant (128) simply ended the walk and returned a
  // clean report, so a document was admitted on a check that had not finished with nothing on
  // the report to say so — and 10 §4.2 puts the peers' own pruning depth at ~256, twice the
  // number the pass ever asked about.
  //
  // The answer to that is `reach`, not a refusal. What must hold is that the stop is visible and
  // that the bound is spent where the light client can actually answer, which is the head.
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 0, toBlock: 100_000 },
    coverage: [{ fromBlock: 0, toBlock: 100_000 }],
  };
  assert.equal(admit(document).kind, 'admitted');
  const asked: number[] = [];
  const report = await spotCheckSnapshot(document, async (claim) => {
    asked.push(claim.block);
    // Never `out-of-reach`: this device can see further than any window the specification
    // describes, so nothing terminates the walk except the ceiling.
    return { kind: 'agrees' };
  });
  assert.equal(asked.length, SPOT_CHECK_BLOCK_CEILING);
  assert.equal(asked[0], 100_000);
  assert.equal(asked[asked.length - 1], 100_000 - SPOT_CHECK_BLOCK_CEILING + 1);
  assert.equal(report.reach, 'ceiling', 'the stop is a stated fact, which is what the old bound lacked');
  assert.deepEqual(report.findings, []);
});

test('the ceiling is derived from 10 §4.2, and is not the old truncating bound', () => {
  // A number with a derivation rather than a preference: §4.2 states peers "prune state at ~256
  // blocks by default", so a client whose reachable depth is at most that finishes its walk well
  // inside this. Written as the product so the derivation is in the source and not only here.
  assert.equal(SPOT_CHECK_BLOCK_CEILING, 512);
  assert.ok(SPOT_CHECK_BLOCK_CEILING > 256, 'a ceiling below the documented pruning depth truncates');
});

test('a forgery past the OLD 128-block bound is now handed to the checker', async () => {
  // The regression in its exact shape. With the walk fixed at 128 blocks, a document covering
  // deep history put every forgery below the 128th-newest reachable block out of the checker's
  // sight — admitted, `findings: []`, and minted `sampled: true`.
  const truth: SnapshotDocument = {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range: { fromBlock: 0, toBlock: 100_000 },
    coverage: [{ fromBlock: 0, toBlock: 100_000 }],
    vaults: [],
    ops: [],
    balances: [],
  };
  const forged: SnapshotDocument = {
    ...truth,
    vaults: [{ vault: 'v1', branches: ['FAIL', 'PASS'] }],
    ops: [{ kind: 'split', block: 99_800, vault: 'v1', account: 'mallory', amount: '1000' }],
    balances: [
      { vault: 'v1', account: 'mallory', branch: 'FAIL', amount: '1000' },
      { vault: 'v1', account: 'mallory', branch: 'PASS', amount: '1000' },
    ],
  };
  assert.equal(admit(forged).kind, 'admitted', 'every internal screen passes — that is the point');
  const chain = lightClient(99_700, truth);
  const report = await spotCheckSnapshot(forged, chain.check);
  assert.ok(chain.asked.length > 128, `the old bound asked 128; this asked ${chain.asked.length}`);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.screen, 'spot-check');
  assert.match(report.findings[0]?.why ?? '', /block 99800/);
});

test('EVERY snapshot refusal cause is a statement about the DOCUMENT, never about this device', async () => {
  // The rule that decided the ceiling, kept as a property rather than as the one case that
  // produced it. §8.4 gives `FE-PROV-003` three causes — content-pin mismatch, malformed
  // encoding, failed internal consistency — and every one is a fact about the file. A fourth
  // cause (`incomplete-check`) existed until 2026-08-06 and was a fact about this device's work
  // budget; it is deleted, and this asserts the remaining set stays that shape.
  //
  // A ceiling this client chose can therefore never produce a refusal, however small it is set.
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 0, toBlock: 100_000 },
    coverage: [{ fromBlock: 0, toBlock: 100_000 }],
  };
  const report = await spotCheckSnapshot(document, async () => ({ kind: 'agrees' }), 4);
  assert.equal(report.reach, 'ceiling');
  assert.deepEqual(report.findings, [], 'a work budget is not evidence about a file');

  // And the fixed remedy copy no longer contains the sentence that was false: for a document
  // with more reachable covered blocks than the ceiling, "try again when this device has caught
  // up" described a wait that would never end.
  for (const cause of ['integrity', 'wrong-chain', 'chain-disagreement'] as const) {
    const refusal = snapshotRefusal(cause, 'detail');
    assert.equal(refusal.code, 'FE-PROV-003');
    assert.doesNotMatch(refusal.detail, /try again when this device has caught up/);
  }
});

test('a document ENTIRELY ABOVE this device, smaller than the ceiling, is its own reach', async () => {
  // `SpotCheckReach` had three arms and four producing situations until 2026-08-06, and this is
  // the fourth. A document whose whole coverage sits ahead of this device's head asks about every
  // covered block, compares none, raises no finding — and returned `whole-document`, whose own
  // description reads *"the walk ran out of document, not out of window"*. It had run out of
  // both, and a screen keying on `whole-document` to mean *fully re-derived* was therefore wrong
  // for a pass that verified nothing.
  //
  // It is not `window-floor` either, and the difference is what a user is told: `window-floor` is
  // permanent — that history is below the window and no sync brings it back — while this is
  // transient, and the same document re-checked after a sync compares blocks.
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 900, toBlock: 999 },
    coverage: [{ fromBlock: 900, toBlock: 999 }],
    ops: [],
    balances: [],
    vaults: [],
  };
  const covered = 100;
  assert.ok(covered < SPOT_CHECK_BLOCK_CEILING, 'smaller than the ceiling — larger is the ceiling case');
  assert.equal(admit(document).kind, 'admitted');

  let asked = 0;
  const report = await spotCheckSnapshot(document, async () => {
    asked += 1;
    return { kind: 'out-of-reach', where: 'above-window' };
  });
  assert.equal(asked, covered, 'every covered block was asked about — the walk ran out of document');
  assert.equal(report.reach, 'above-window-only');
  assert.equal(report.compared, 0, 'and it verified nothing, which the arm now says');
  assert.equal(report.outOfReach, covered);
  assert.deepEqual(report.findings, []);
});

test('an empty document keeps whole-document — it ran out of document with nothing above it', async () => {
  // The boundary of the arm above, so `above-window-only` cannot be read as *compared nothing*.
  // A document covering no blocks has an empty mandated set for a reason that is about the file
  // rather than about the window, and nothing was out of reach.
  const document: SnapshotDocument = {
    ...trueHistory(),
    range: { fromBlock: 10, toBlock: 13 },
    coverage: [],
    ops: [],
    balances: [],
    vaults: [],
  };
  const report = await spotCheckSnapshot(document, async () => ({ kind: 'agrees' }));
  assert.equal(report.reach, 'whole-document');
  assert.equal(report.compared, 0);
  assert.equal(report.outOfReach, 0);
});

test('an out-of-enum side is REFUSED rather than read as above-window', async () => {
  // The one field the whole repair turns on. `where` is untyped at an injected boundary, so an
  // out-of-enum value arrived as data and every `=== 'below-window'` test answered false —
  // reading it as `above-window`, which descends the whole document, spends the ceiling and
  // admits with `compared: 0`. Its two neighbours in `chainSpotCheck` (the extrinsic and event
  // indices) were hardened at runtime and this was not.
  await assert.rejects(
    () =>
      spotCheckSnapshot(trueHistory(), async () => ({
        kind: 'out-of-reach',
        where: 'sideways' as 'above-window',
      })),
    /neither "above-window" nor "below-window"/,
  );
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

test('the ceiling must be a positive integer — a zero bound would check nothing and pass', async () => {
  await assert.rejects(() => spotCheckSnapshot(trueHistory(), async () => ({ kind: 'agrees' }), 0), RangeError);
  await assert.rejects(
    () => spotCheckSnapshot(trueHistory(), async () => ({ kind: 'agrees' }), 1.5),
    RangeError,
  );
});
