/**
 * The ingestion loop's decisions — 10 §6.5 (F8).
 *
 * §6.5's design rests on one claim: *"Blocks containing none of the user's extrinsics never
 * trigger a body fetch. Worst-case overhead is proportional to the user's own activity, not
 * chain activity."* Both ways of breaking it are silent, so both are tested here.
 *
 * Attribute too narrowly and history is *filtered*, which looks exactly like history that is
 * *empty*. Attribute too broadly — and the easiest way to do that is to treat
 * `System.ExtrinsicSuccess` as attribution, since it is emitted for every extrinsic in every
 * block — and the client fetches a body for every block the chain produces, on a light
 * client, on a phone, while every test of "does it find my transactions" stays green.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IngestError,
  attributedExtrinsics,
  bodyProvenance,
  needsBodyFetch,
  txRowKey,
} from '@bleavit/local-index';
import type { EventPhase, FinalizedBlockScan, IndexedEvent } from '@bleavit/local-index';

const ALICE = '0x' + '11'.repeat(32);
const BOB = '0x' + '22'.repeat(32);
const WATCHED = new Set([ALICE]);

const apply = (index: number): EventPhase => ({ kind: 'apply-extrinsic', index });
const event = (
  phase: EventPhase,
  pallet: string,
  name: string,
  accounts: readonly string[] = [],
): IndexedEvent => ({ phase, pallet, name, accounts });

const block = (events: readonly IndexedEvent[], extrinsicCount = 4): FinalizedBlockScan => ({
  number: 100,
  // §6.3's hash-at-edge and spec-version-at-edge, read from the header rather than derived —
  // a hash computed from what was ingested would agree with itself by construction.
  hash: `0x${'ab'.repeat(32)}`,
  specVersion: 3,
  blockTimestampMs: 600_000,
  extrinsicCount,
  events,
});

test('an extrinsic that names a watched account is fetched', () => {
  const scan = block([event(apply(2), 'Market', 'Traded', [ALICE])]);
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), [2]);
  assert.equal(needsBodyFetch(scan, WATCHED), true);
});

test('a block full of other people’s activity triggers no fetch at all', () => {
  // The cost claim, stated as a test: overhead is proportional to the user's activity.
  const scan = block([
    event(apply(0), 'Market', 'Traded', [BOB]),
    event(apply(1), 'ConditionalLedger', 'Split', [BOB]),
    event(apply(2), 'Balances', 'Transfer', [BOB]),
  ]);
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), []);
  assert.equal(needsBodyFetch(scan, WATCHED), false);
});

test('ExtrinsicSuccess never attributes, even when a decoder hands it the signer', () => {
  // The defect that makes every block a hit while every "does it find my transactions" test
  // stays green: `System.ExtrinsicSuccess` is emitted for every extrinsic in every block.
  //
  // **The account list here is deliberately non-empty**, and that is the whole point of this
  // fixture. An earlier version passed `[]` — which is what the runtime actually emits — so
  // the assertion held because of the empty list rather than because of the rule, and
  // deleting the correlation set killed no test. The realistic way this breaks is a decoder
  // that helpfully fills in the extrinsic's signer, and only a fixture that does the same
  // can tell the two apart.
  const scan = block([
    event(apply(0), 'System', 'ExtrinsicSuccess', [ALICE]),
    event(apply(1), 'System', 'ExtrinsicFailed', [ALICE]),
    event(apply(2), 'System', 'ExtrinsicSuccess', [ALICE]),
  ]);
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), []);
});

test('ExtrinsicSuccess still correlates with an attributed extrinsic in the same block', () => {
  const scan = block([
    event(apply(1), 'Market', 'Traded', [ALICE]),
    event(apply(1), 'System', 'ExtrinsicSuccess', []),
    event(apply(3), 'System', 'ExtrinsicSuccess', []),
  ]);
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), [1]);
});

test('a System event that does attribute is not filtered by pallet', () => {
  // "Ignore System" would be the tempting shortcut and it drops `NewAccount`/`KilledAccount`,
  // which is why the correlation set is enumerated by event rather than by pallet.
  const scan = block([event(apply(0), 'System', 'NewAccount', [ALICE])]);
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), [0]);
});

test('a Finalization or Initialization event never attributes', () => {
  // It belongs to no extrinsic — it is the runtime's own work — so attributing it would
  // fetch a body for a block the user never touched and leave no index to decode.
  const scan = block([
    { phase: { kind: 'finalization' }, pallet: 'Epoch', name: 'PhaseAdvanced', accounts: [ALICE] },
    { phase: { kind: 'initialization' }, pallet: 'Market', name: 'Observed', accounts: [ALICE] },
  ]);
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), []);
});

test('six events in one extrinsic produce one decode', () => {
  const scan = block(
    Array.from({ length: 6 }, () => event(apply(2), 'ConditionalLedger', 'Split', [ALICE])),
  );
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), [2]);
});

test('indices come back sorted, whatever order the events arrived in', () => {
  const scan = block(
    [3, 0, 2].map((index) => event(apply(index), 'Market', 'Traded', [ALICE])),
  );
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), [0, 2, 3]);
});

test('an index outside the block is refused, not skipped or clamped', () => {
  // A decode at a bad index does not throw — it returns a *different* extrinsic, and the
  // client renders someone else's transaction as the user's.
  assert.throws(
    () => attributedExtrinsics(block([event(apply(9), 'Market', 'Traded', [ALICE])], 4), WATCHED),
    IngestError,
  );
  assert.throws(
    () => attributedExtrinsics(block([event(apply(-1), 'Market', 'Traded', [ALICE])], 4), WATCHED),
    IngestError,
  );
  // Refused even when the out-of-range event is not the user's: a block whose events and
  // extrinsic count disagree is one this loop cannot read correctly at all.
  assert.throws(
    () => attributedExtrinsics(block([event(apply(9), 'Market', 'Traded', [BOB])], 4), WATCHED),
    IngestError,
  );
});

test('watching nothing fetches nothing', () => {
  // Not an error: a client with no accounts loaded has no history to build, and the loop
  // still runs for prices and events. Fetching every body "just in case" is the same defect
  // as attributing on a correlation event.
  const scan = block([event(apply(0), 'Market', 'Traded', [ALICE])]);
  assert.deepEqual(attributedExtrinsics(scan, new Set()), []);
});

test('an event naming several accounts hits if any one of them is watched', () => {
  const scan = block([event(apply(1), 'ConditionalLedger', 'Transferred', [BOB, ALICE])]);
  assert.deepEqual(attributedExtrinsics(scan, WATCHED), [1]);
});

test('body provenance follows the header, and there is no argument that overrides it', () => {
  // §6.5: the extrinsics-root check proves the body matches the header, and at depth the
  // header itself is layer-2 — so a backfilled body is `provider` however it was fetched.
  assert.equal(bodyProvenance('self'), 'verified-finalized');
  assert.equal(bodyProvenance('operator'), 'provider');
  assert.equal(bodyProvenance('snapshot'), 'provider');
  assert.equal(bodyProvenance('indexer'), 'provider');
  assert.equal(bodyProvenance.length, 1, 'no second argument by which a caller could promote');
});

test('the row key is deterministic and orders lexically by block', () => {
  // §6.5 requires idempotent writes with deterministic primary keys, because the loop
  // replays: a tab reloads mid-range, a leader hands over, a cursor rolls back.
  assert.equal(txRowKey(100, 2), txRowKey(100, 2));
  const keys = [txRowKey(9, 0), txRowKey(10, 0), txRowKey(9, 1)].sort();
  assert.deepEqual(keys, [txRowKey(9, 0), txRowKey(9, 1), txRowKey(10, 0)]);
  assert.throws(() => txRowKey(-1, 0), IngestError);
  assert.throws(() => txRowKey(1.5, 0), IngestError);
  assert.throws(() => txRowKey(1, -1), IngestError);
});
