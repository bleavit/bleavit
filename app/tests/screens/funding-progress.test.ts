/**
 * The arrival rule — 11 §11.9: *"local finality on AH ≠ delivery"*. F18.
 *
 * > The tracker shows "sent — awaiting arrival" until the **futarchy-chain** connection
 * > observes the balance credit in finalized state.
 *
 * This is the rule with **no on-chain symptom**. Every read involved is genuine, every badge
 * says `verified-finalized`, the chain agrees with all of it, and a tracker that got it wrong
 * tells a user their money arrived when it has not. Nothing later can detect that: there is no
 * failing transaction, no error, no divergence — only a screen making a claim about a chain
 * that never made it.
 *
 * The union already stops the crudest version: `credited` carries `creditedAtLocalBlock`, and
 * the Asset Hub leg has nothing to fill it from. What a **producer** can still get wrong is
 * *which chain the leaf it fills it with came from*, and that is what `depositProgress`
 * refuses. Every fixture below therefore holds the **block hash equal across the two chains**
 * — a cross-chain pair with different hashes passes with the chain check deleted and witnesses
 * nothing, which is V-155's finding applied to this module.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MixedBlockProgressError,
  UnfinalizedProgressError,
  WrongChainProgressError,
  depositProgress,
  progressCopy,
} from '@bleavit/features-tx';
import type { HexString, Verified, VerificationStatus } from '@bleavit/shared-types';

const LOCAL: HexString = `0x${'ce'.repeat(32)}`;
const ASSET_HUB: HexString = `0x${'a5'.repeat(32)}`;
/** Held EQUAL across the two chains on purpose — see this file's header. */
const BLOCK: HexString = `0x${'11'.repeat(32)}`;
const OTHER_BLOCK: HexString = `0x${'22'.repeat(32)}`;

const at = <T>(
  value: T,
  chain: HexString,
  kind: 'verified-finalized' | 'verified-best' = 'verified-finalized',
  blockHash: HexString = BLOCK,
  blockNumber = 900,
): Verified<T> => ({ value, status: { kind, chain, blockHash, blockNumber } });

const AH_BLOCK = at(500, ASSET_HUB);
const CREDIT = { atBlock: at(900, LOCAL), amount: at(10_000_000n, LOCAL) };

const observations = (
  overrides: Partial<Parameters<typeof depositProgress>[0]> = {},
): Parameters<typeof depositProgress>[0] => ({
  assetHubBlock: AH_BLOCK,
  credit: CREDIT,
  localChain: LOCAL,
  assetHubChain: ASSET_HUB,
  ...overrides,
});

/* --------------------------------------------------------------- the three ordinary stages */

test('nothing sent is nothing sent', () => {
  const progress = depositProgress(observations({ assetHubBlock: undefined, credit: undefined }));
  assert.equal(progress.kind, 'not-sent');
  assert.match(progressCopy(progress), /Nothing has been sent yet/);
});

test('an Asset Hub block with no local observation is SENT, never arrived', () => {
  const progress = depositProgress(observations({ credit: undefined }));
  assert.equal(progress.kind, 'sent-awaiting-arrival');
  assert.ok(!('creditedAtLocalBlock' in progress), 'the sent arm carried a local credit');
  assert.match(progressCopy(progress), /message was sent, not that the funds have arrived/);
});

test('a finalized local credit is the only thing that reaches credited', () => {
  const progress = depositProgress(observations());
  assert.ok(progress.kind === 'credited');
  assert.equal(progress.assetHubBlock.value, 500);
  assert.equal(progress.creditedAtLocalBlock.value, 900);
  assert.equal(progress.creditedAmount.value, 10_000_000n);
  assert.match(progressCopy(progress), /its own finalized state/);
});

/* ------------------------------------------------- the rule with no on-chain symptom */

test('a credit read on ASSET HUB can never be rendered as credited', () => {
  // The whole milestone in one assertion. Both leaves are real, finalized, proof-backed reads;
  // both would badge `verified-finalized`; and `credited`'s copy says "this chain has seen the
  // balance in its own finalized state" — about Asset Hub. The block hash is held equal to the
  // local one, so a check that compared BLOCKS instead of CHAINS would pass this.
  assert.throws(
    () =>
      depositProgress(
        observations({ credit: { atBlock: at(900, ASSET_HUB), amount: at(10_000_000n, ASSET_HUB) } }),
      ),
    WrongChainProgressError,
  );
  // One leaf is enough — a model half-read from the wrong chain is not half wrong.
  assert.throws(
    () =>
      depositProgress(
        observations({ credit: { atBlock: at(900, LOCAL), amount: at(10_000_000n, ASSET_HUB) } }),
      ),
    WrongChainProgressError,
  );
  assert.throws(
    () =>
      depositProgress(
        observations({ credit: { atBlock: at(900, ASSET_HUB), amount: at(10_000_000n, LOCAL) } }),
      ),
    WrongChainProgressError,
  );
});

test('a local block presented as the Asset Hub extrinsic is refused', () => {
  // The other direction, and the one the `sent-awaiting-arrival` copy makes false: a bare block
  // number labelled "Asset Hub block (sent)" that is really this chain's height.
  assert.throws(
    () => depositProgress(observations({ assetHubBlock: at(500, LOCAL), credit: undefined })),
    WrongChainProgressError,
  );
});

test('two readers on one chain are refused before anything is read out of them', () => {
  // `fundingReaders`' refusal, at the tracker. Reached even with observations that are
  // otherwise impeccable, because the pair being one chain makes every label meaningless.
  assert.throws(
    () => depositProgress(observations({ assetHubChain: LOCAL, assetHubBlock: at(500, LOCAL) })),
    WrongChainProgressError,
  );
});

/* ------------------------------------------------------------------- finality, both sides */

test('a best-head local credit is AWAITING, which is what §11.9 says it is', () => {
  // Not an error and not credited: §11.9's own word is "until … in finalized state", so a
  // best-head observation is precisely the in-between state the sent arm describes. A reorg
  // can still take it away, and a tracker that showed "credited" would have to un-show it.
  const progress = depositProgress(
    observations({
      credit: { atBlock: at(900, LOCAL, 'verified-best'), amount: at(10_000_000n, LOCAL) },
    }),
  );
  assert.equal(progress.kind, 'sent-awaiting-arrival');

  const other = depositProgress(
    observations({
      credit: { atBlock: at(900, LOCAL), amount: at(10_000_000n, LOCAL, 'verified-best') },
    }),
  );
  assert.equal(other.kind, 'sent-awaiting-arrival');
});

test('a best-head ASSET HUB observation throws rather than picking an arm that lies', () => {
  // The asymmetry is deliberate. There is an arm whose copy fits an unfinalized *local* read —
  // "awaiting arrival" — and none that fits an unfinalized Asset Hub one: `not-sent` says
  // "Nothing has been sent yet" and the sent arm states "The Asset Hub side is final" as a
  // fact. Rounding to either would make the tracker assert what the read does not support.
  assert.throws(
    () =>
      depositProgress(
        observations({ assetHubBlock: at(500, ASSET_HUB, 'verified-best'), credit: undefined }),
      ),
    UnfinalizedProgressError,
  );
});

/* ------------------------------------------------------------------- two leaves, one block */

test('a credit assembled from two local blocks is refused', () => {
  // INV-FE-2's rule at the tracker: an amount read at one block beside a height read at
  // another is not a stale display, it is a view that never existed — and it renders exactly
  // like one that did.
  assert.throws(
    () =>
      depositProgress(
        observations({
          credit: { atBlock: at(900, LOCAL), amount: at(10_000_000n, LOCAL, 'verified-finalized', OTHER_BLOCK) },
        }),
      ),
    MixedBlockProgressError,
  );
});

/* --------------------------------------------------------------- a credit with no send */

test('a credit with no Asset Hub block is refused, never rounded down to not-sent', () => {
  // Returning `not-sent` would tell a user nothing has been sent while this chain has already
  // seen their funds, and `credited` cannot be built — it names the block the deposit was sent
  // in and there is none. So the observation is refused rather than reported wrongly.
  assert.throws(
    () => depositProgress(observations({ assetHubBlock: undefined })),
    /credit was observed with no Asset Hub block/,
  );
});

/* --------------------------------------------------------- the union, as a compile-time fact */

test('every non-finalized status is rejected as a source of chain identity', () => {
  // The four statuses that name no chain at all — `derived-local`, `provider`, `stale-cache`,
  // `external-proposal`. A provider-served "credit" is exactly the promotion 10 §2.2 gives no
  // path for, and here it would arrive as a tracker saying the funds landed.
  const statuses: readonly VerificationStatus[] = [
    { kind: 'provider', providerId: 'p', sampled: false },
    { kind: 'stale-cache', asOfBlock: 900, ageMs: 60_000 },
    { kind: 'derived-local', coverage: { ranges: [], holes: [] } },
    { kind: 'external-proposal' },
  ];
  for (const status of statuses) {
    assert.throws(
      () =>
        depositProgress(
          observations({
            credit: { atBlock: { value: 900, status }, amount: at(10_000_000n, LOCAL) },
          }),
        ),
      WrongChainProgressError,
      `${status.kind} was accepted as a futarchy-chain observation`,
    );
  }
});
