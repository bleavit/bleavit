/**
 * The chainHead-v1 transport — 10 §4.1, §4.2.
 *
 * Driven at the **wire level** by F2's recorded transcripts through a provider shaped
 * exactly like `getSmProvider`'s (`tests/chain-client/recorded-provider.ts`), so the code
 * exercised here is the code that will run against smoldot: same request ids, same follow
 * subscription, same started/items/done handshake, same demultiplexing.
 *
 * Every branch in this transport is a **failure** branch — `limitReached`, `operationError`,
 * `stop`, an unpinned block, a paused operation — and the recorder only ever captured
 * happy paths, because it ran against a healthy node. So the failure branches are driven
 * by injected events. That is stated rather than glossed: the transcripts prove the
 * transport speaks the protocol a real node speaks; the injections prove it does the right
 * thing when the node says no.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ChainHeadConnection,
  ChainHeadError,
  SubscriptionStoppedError,
  FinalizedReader,
  blockNumberFromHeader,
} from '@bleavit/chain-client';
import { createMockRuntime } from '@bleavit/mock-runtime';
import type { HexString } from '@bleavit/shared-types';

import { argsFor, bundle, keyFor, recordedProvider, sentWith } from './recorded-provider.ts';

/** The chain identity every verified fixture in this file is read against (F18).
 *  A named constant rather than a literal per site: the point of the field is that two
 *  reads agree on it, and copies of a hex string agree until one is edited. */
const TEST_CHAIN = `0x${'ce'.repeat(32)}` as HexString;


const fixtures = bundle();
const runtime = () => createMockRuntime(fixtures);

test('open() follows the chain and learns its finalized block from the transcripts', async () => {
  const mock = runtime();
  const { provider, sent } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });

  const first = sent[0];
  assert.ok(first, 'the transport sent nothing at all');
  assert.equal(first.method, 'chainHead_v1_follow');
  assert.deepEqual(first.params, [true], 'withRuntime must be set or chainHead_v1_call is unavailable');

  const pin = await connection.pinnedBlock();
  assert.equal(pin.blockHash, mock.pinnedBlock());
  // The number is decoded from the real recorded SCALE header, not carried alongside it:
  // chainHead reports finalized blocks by hash only, and `Finalized<T>` records a number.
  assert.equal(pin.blockNumber, 1);
});

test('the block number is decoded from real recorded headers, in every compact mode', () => {
  // Single-byte mode, from the transcripts themselves.
  const recorded = [...fixtures.fixtures.values()]
    .flatMap((f) => f.requests)
    .find((r) => r.method === 'chainHead_v1_header');
  assert.ok(recorded, 'no header was recorded — this test would be vacuous');
  const header = (recorded.response as { direct: { result: HexString } }).direct.result;
  assert.equal(blockNumberFromHeader(header), 1);

  // The other three SCALE compact modes. A header decoder that only ever meets mode 0
  // works for the first 63 blocks of a chain and then silently reads the wrong number,
  // which would mislabel every provenance record after that.
  const parent = `0x${'11'.repeat(32)}`;
  const tail = '00'.repeat(64);
  assert.equal(blockNumberFromHeader(`${parent}fc${tail}`), 63); // mode 0, max
  assert.equal(blockNumberFromHeader(`${parent}0101${tail}`), 64); // mode 1
  assert.equal(blockNumberFromHeader(`${parent}02000100${tail}`), 16384); // mode 2
  assert.equal(blockNumberFromHeader(`${parent}0300000040${tail}`), 1073741824); // mode 3
});

test('a storage read replays the recorded operation handshake', async () => {
  const mock = runtime();
  const { provider, sent } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();
  const { key, type } = keyFor(fixtures, 'storage.epoch.recent_cohort_summaries');

  const items = await connection.storage(pin, key, type);
  assert.ok(Array.isArray(items));

  const request = sentWith(sent, 'chainHead_v1_storage');
  assert.deepEqual(request.params, ['subscription-1', pin.blockHash, [{ key, type }], null]);
});

test('a runtime call returns the recorded output', async () => {
  const mock = runtime();
  const { provider } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();
  const output = await connection.call(
    pin,
    'FutarchyApi_account_positions',
    argsFor(fixtures, 'api.account_positions'),
  );
  assert.match(output, /^0x[0-9a-f]*$/);
});

test('V-84: a reader reads at ITS OWN pin after the finalized head advances', async () => {
  // The defect this pins shut: when the transport chose the block, a reader pinned at N
  // could be handed a value read at N+1 and would label it N. The returned value is
  // perfectly valid — only its provenance is a lie — so nothing about the value can
  // detect it. The assertion has to be on the wire.
  const moved: HexString = `0x${'ab'.repeat(32)}`;
  const mock = runtime();
  const { provider, sent, state } = recordedProvider(mock, {
    // The transcripts are recorded at a single block, so the *second* block has to be
    // supplied: a header claiming number 2. Nothing else about the read path is faked.
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_header' || request.params[1] !== moved) return false;
      emit({ jsonrpc: '2.0', id: request.id, result: `0x${'11'.repeat(32)}08${'00'.repeat(64)}` });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const reader = await FinalizedReader.open(connection);
  const original = reader.at.blockHash;

  state.followEvent({ event: 'finalized', finalizedBlockHashes: [moved], prunedBlockHashes: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const head = await connection.pinnedBlock();
  assert.equal(head.blockHash, moved, 'the transport head did not advance');
  assert.equal(head.blockNumber, 2);

  const { key, type } = keyFor(fixtures, 'storage.constitution.phase_flags');
  await reader.storage(key, type);

  const last = sentWith(sent, 'chainHead_v1_storage', 'last');
  assert.equal(last.params[1], original, 'the read was issued against the moved head, not the pin');
  assert.notEqual(last.params[1], moved);
});

test('the head advancing does not kill a reader (that is what pinning is for)', async () => {
  // The converse mistake: a reader that refused every read once the chain moved would
  // have a useful life of one block time, which is not a safety property, just an outage.
  const mock = runtime();
  const { provider, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const reader = await FinalizedReader.open(connection);

  state.followEvent({ event: 'finalized', finalizedBlockHashes: [`0x${'cd'.repeat(32)}`] });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const { key, type } = keyFor(fixtures, 'storage.constitution.phase_flags');
  const read = await reader.storage(key, type);
  assert.equal(read.status.blockHash, reader.at.blockHash);
});

test('limitReached is a refusal, never an empty result', async () => {
  // A transport that reported this as "no items" would render "this account holds no
  // positions" when the truth is "the light client declined to look".
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_storage') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: { result: 'limitReached' } });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();
  await assert.rejects(
    () => connection.storage(pin, '0x00', 'value'),
    (error) => error instanceof ChainHeadError && /limitReached/.test(error.message),
  );
});

test('operationError rejects, and names the unpinned-block possibility', async () => {
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    intercept(request, { emit, followEvent }) {
      if (request.method !== 'chainHead_v1_call') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: { result: 'started', operationId: 'op-err' } });
      followEvent({ event: 'operationError', operationId: 'op-err', error: 'block not pinned' });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();
  await assert.rejects(
    () => connection.call(pin, 'FutarchyApi_epoch_status'),
    (error) => error instanceof ChainHeadError && /block not pinned/.test(error.message),
  );
});

test('a paused operation is continued, not left hanging', async () => {
  // Of the three ways to handle `operationWaitingForContinue`, hanging is the worst: it
  // is indistinguishable from a slow chain, so it produces a bug report about the network.
  const mock = runtime();
  const { provider, sent } = recordedProvider(mock, {
    intercept(request, { emit, followEvent }) {
      if (request.method !== 'chainHead_v1_storage') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: { result: 'started', operationId: 'op-wait' } });
      followEvent({ event: 'operationStorageItems', operationId: 'op-wait', items: [{ key: '0x01', value: '0x0a' }] });
      followEvent({ event: 'operationWaitingForContinue', operationId: 'op-wait' });
      queueMicrotask(() => {
        followEvent({ event: 'operationStorageItems', operationId: 'op-wait', items: [{ key: '0x02', value: '0x0b' }] });
        followEvent({ event: 'operationStorageDone', operationId: 'op-wait' });
      });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();
  const items = await connection.storage(pin, '0x00', 'descendantsValues');

  assert.deepEqual(items, [
    { key: '0x01', value: '0x0a' },
    { key: '0x02', value: '0x0b' },
  ], 'items must accumulate across every operationStorageItems event');
  assert.ok(
    sent.some((r) => r.method === 'chainHead_v1_continue'),
    'the transport never acknowledged the paused operation',
  );
});

test('a stopped subscription fails every pending and every future read', async () => {
  // chainHead's guarantees are scoped to a live subscription, so `stop` does not fail one
  // read — it invalidates every pin the connection ever handed out.
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    intercept(request, { emit, followEvent }) {
      if (request.method !== 'chainHead_v1_storage') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: { result: 'started', operationId: 'op-stop' } });
      queueMicrotask(() => followEvent({ event: 'stop' }));
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();

  await assert.rejects(() => connection.storage(pin, '0x00', 'value'), SubscriptionStoppedError);
  await assert.rejects(() => connection.pinnedBlock(), SubscriptionStoppedError);
  await assert.rejects(() => connection.call(pin, 'FutarchyApi_epoch_status'), SubscriptionStoppedError);
});

test('an unpinned block yields no block number rather than a guessed one', async () => {
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_header') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: null });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  await assert.rejects(
    () => connection.pinnedBlock(),
    (error) => error instanceof ChainHeadError && /not pinned/.test(error.message),
  );
});

test('the transport asks for nothing the recording does not contain', async () => {
  // Anti-vacuity for every test above: the recorded provider refuses unknown requests, so
  // a transport that had silently started asking for a different surface, a different
  // argument or a different block would fail here rather than pass on a humoured answer.
  const mock = runtime();
  const { provider } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const reader = await FinalizedReader.open(connection);
  const { key, type } = keyFor(fixtures, 'storage.ledger.positions');
  await reader.storage(key, type);
  await assert.rejects(
    () => reader.storage('0xdeadbeef', 'value'),
    /has no recorded response/,
    'the mock answered a request that was never recorded',
  );
});

test('V-85: an operation event that arrives before the started response is not lost', async () => {
  // The `started` response and the operation's own events are separate messages, and
  // awaiting the former yields to the microtask queue — so the completion event can be
  // delivered before the handler that is waiting for it exists. Dropping it there hung the
  // read forever, and a hung read on screen is a slow chain: the failure mode that produces
  // a bug report about the network rather than about the client.
  //
  // Emitted deliberately out of order here, which is the sharper version of what the
  // recorded provider does naturally: the completion arrives strictly first.
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    intercept(request, { emit, followEvent }) {
      if (request.method !== 'chainHead_v1_call') return false;
      followEvent({ event: 'operationCallDone', operationId: 'op-early', output: '0xbeef' });
      emit({ jsonrpc: '2.0', id: request.id, result: { result: 'started', operationId: 'op-early' } });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();
  assert.equal(await connection.call(pin, 'FutarchyApi_epoch_status'), '0xbeef');
});

test('buffered events for operations that never register are bounded', async () => {
  // The buffer is filled by the node, so an unbounded map here is remote-controlled memory
  // growth against the 10 §9.4 budget. Dropping the oldest is safe: a dropped orphan can
  // only ever fail a read, never complete one wrongly.
  const mock = runtime();
  const { provider, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  for (let i = 0; i < 5000; i += 1) {
    state.followEvent({ event: 'operationCallDone', operationId: `ghost-${i}`, output: '0x00' });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Still serving reads, and not holding 5000 operations' worth of events.
  const pin = await connection.pinnedBlock();
  assert.equal(pin.blockNumber, 1);
  const orphans = connection.orphanCountForTest();
  assert.ok(orphans <= 32, `orphan buffer grew to ${orphans}`);
});

/* ------------------------------------------------ the three Codex P1 findings (PR #229) */

test('V-93: a subscription that stops before initialized fails boot rather than hanging', async () => {
  // `chainHead_v1_follow` succeeds, then the subscription stops before ever announcing a
  // finalized block — an early worker or connection failure does exactly this. The follow
  // request has already left `#pending` by then, so nothing rejected the wait for the
  // first block and boot hung. The race below is deliberate: a regression must fail this
  // test in two seconds rather than hang the suite, because a hang in CI reads as an
  // infrastructure problem and gets retried instead of diagnosed.
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: 'subscription-1' });
      queueMicrotask(() => followEvent({ event: 'stop' }));
      return true;
    },
  });

  const hang = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('open() never settled — the boot hang is back')), 2000).unref();
  });
  await assert.rejects(
    () => Promise.race([ChainHeadConnection.open(provider, { chain: TEST_CHAIN }), hang]),
    SubscriptionStoppedError,
  );
});

test('V-94: a discarded storage item is a refusal, never an empty result', async () => {
  // The node answers `started` *and* declines to run the query. For a one-key request that
  // is `discardedItems: 1`, `operationStorageDone` with no items, and — before this fix —
  // a resolved read of `[]`. The pinned `@polkadot-api/substrate-client` raises
  // `OperationLimitError` on exactly this (`discardedItems === inputs.length`), so it is a
  // refusal by the reference implementation's own reading, not a strictness of ours.
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    intercept(request, { emit, followEvent }) {
      if (request.method !== 'chainHead_v1_storage') return false;
      emit({
        jsonrpc: '2.0',
        id: request.id,
        result: { result: 'started', operationId: 'op-discard', discardedItems: 1 },
      });
      queueMicrotask(() => followEvent({ event: 'operationStorageDone', operationId: 'op-discard' }));
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();

  await assert.rejects(
    () => connection.storage(pin, '0x00', 'value'),
    (error) => error instanceof ChainHeadError && /discarded 1 of 1/.test(error.message),
    'a discarded query resolved as "this key holds nothing"',
  );
});

test('V-94: discardedItems: 0 still resolves — the guard is not "always refuse"', async () => {
  // Positive control. Every recorded transcript carries `discardedItems: 0`, so a guard
  // written as an unconditional refusal would fail here; without this, "rejects on 1" is
  // equally satisfied by "rejects on everything".
  const mock = runtime();
  const { provider } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const pin = await connection.pinnedBlock();
  const { key, type } = keyFor(fixtures, 'storage.ledger.positions');

  const items = await connection.storage(pin, key, type);
  assert.ok(Array.isArray(items));
});

test('V-95: pins are released as finality advances, and never the current head', async () => {
  // chainHead pins every block it announces until told otherwise, and the node's pin
  // budget is finite — so a transport that never unpins does not degrade, it accumulates
  // until the node ends the subscription and every read fails at once, after an uptime
  // long enough that nobody connects the two events.
  const mock = runtime();
  const { provider, sent, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN, pinWindow: 4 });

  const hash = (n: number): HexString => `0x${n.toString(16).padStart(64, '0')}`;
  for (let n = 2; n <= 40; n += 1) {
    state.followEvent({ event: 'newBlock', blockHash: hash(n) });
    state.followEvent({ event: 'finalized', finalizedBlockHashes: [hash(n)], prunedBlockHashes: [] });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pinned = connection.pinnedCountForTest();
  assert.ok(pinned <= 6, `pins grew unbounded: ${pinned} held after 39 blocks with a window of 4`);

  const unpins = sent.filter((request) => request.method === 'chainHead_v1_unpin');
  assert.ok(unpins.length > 0, 'the transport never released a pin');
});

test('V-95: the finalized head survives a flood of unfinalized announcements', async () => {
  // The head-protection branch, given the only workload that reaches it. Under normal
  // block production the head has always moved past whatever the window is trimming, so
  // asserting "the head was not released" during a finalizing run asserts nothing — that
  // version of this test passed with the protection deleted.
  //
  // `newBlock` without `finalized` is the case the guard exists for: announcements pile
  // up, the head stays put, and it reaches the front of the window while still being the
  // block every reader is about to pin.
  const mock = runtime();
  const { provider, sent, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN, pinWindow: 4 });
  const head = (await connection.pinnedBlock()).blockHash;

  for (let n = 2; n <= 20; n += 1) {
    state.followEvent({ event: 'newBlock', blockHash: `0x${n.toString(16).padStart(64, '0')}` });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  const released = sent
    .filter((request) => request.method === 'chainHead_v1_unpin')
    .flatMap((request) => request.params[1]);
  assert.ok(released.length > 0, 'nothing was trimmed — this test would be vacuous');
  assert.ok(
    !released.includes(head),
    'the current finalized head was unpinned; every reader about to pin it would fail',
  );
});

test('V-95: pruned blocks are released immediately', async () => {
  const mock = runtime();
  const { provider, sent, state } = recordedProvider(mock);
  await ChainHeadConnection.open(provider, { chain: TEST_CHAIN, pinWindow: 64 });

  const orphan: HexString = `0x${'ab'.repeat(32)}`;
  const head: HexString = `0x${'cd'.repeat(32)}`;
  state.followEvent({ event: 'newBlock', blockHash: orphan });
  state.followEvent({
    event: 'finalized',
    finalizedBlockHashes: [head],
    prunedBlockHashes: [orphan],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The window is wide enough that nothing ages out; only pruning can have released it.
  const released = sent
    .filter((request) => request.method === 'chainHead_v1_unpin')
    .flatMap((request) => request.params[1]);
  assert.deepEqual(released, [orphan]);
});

test('V-95: the block-number cache is evicted with the pin it belongs to', async () => {
  // The second, quieter leak in the same handler: `#headerNumbers` is keyed by block hash
  // and grew once per finalized block for the life of the tab. Nothing about a read would
  // ever look wrong, which is why it needs its own observable rather than a symptom.
  const mock = runtime();
  const { provider, state } = recordedProvider(mock, {
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_header') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: `0x${'11'.repeat(32)}08${'00'.repeat(64)}` });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN, pinWindow: 2 });

  const hash = (n: number): HexString => `0x${n.toString(16).padStart(64, '0')}`;
  for (let n = 2; n <= 20; n += 1) {
    state.followEvent({ event: 'newBlock', blockHash: hash(n) });
    state.followEvent({ event: 'finalized', finalizedBlockHashes: [hash(n)], prunedBlockHashes: [] });
    await connection.pinnedBlock(); // caches a number for each head in turn
  }

  assert.ok(
    connection.headerCacheCountForTest() <= 4,
    `the header cache grew with the chain: ${connection.headerCacheCountForTest()} entries after 19 blocks`,
  );
});

test('onFinalized emits EVERY hash in a multi-block finalization, in order', async () => {
  // `finalizedBlockHashes` is an array because several blocks can finalize at once, and the
  // connection keeps only `.at(-1)` for its own head. That is right for "where is the chain
  // now" and wrong for anything that has to see each block: an ingestion consumer built on
  // the head alone skips every intermediate block, and the local index would then show
  // coverage holes constantly under entirely normal operation — a gap indicator that is
  // always on tells a user nothing.
  const mock = runtime();
  const { provider, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });

  const seen: HexString[] = [];
  const unsubscribe = connection.onFinalized((hash) => seen.push(hash));

  const a: HexString = `0x${'a1'.repeat(32)}`;
  const b: HexString = `0x${'b2'.repeat(32)}`;
  const c: HexString = `0x${'c3'.repeat(32)}`;
  state.followEvent({ event: 'finalized', finalizedBlockHashes: [a, b, c], prunedBlockHashes: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(seen, [a, b, c], 'all three, in the order the node reported them');

  // ...and the head is still the last one, so the two notions stay separate.
  const head = await connection.pinnedBlock().catch(() => undefined);
  assert.ok(head === undefined || head.blockHash === c);

  // Unsubscribing really stops delivery — a listener that outlives its owner would keep a
  // dead consumer's closure alive for the life of the connection.
  unsubscribe();
  state.followEvent({ event: 'finalized', finalizedBlockHashes: [`0x${'d4'.repeat(32)}`], prunedBlockHashes: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(seen.length, 3, 'no delivery after unsubscribe');

  connection.close();
});

test('a finalized hash is emitted while it is still pinned', async () => {
  // The one ordering requirement that is real: emission after `#announcePinned`, so a
  // listener that immediately reads at the hash it was handed finds it pinned.
  //
  // What this deliberately does NOT claim — an earlier draft of the comment beside the
  // emission did — is that emission must precede the unpin. `#unpin` takes
  // `prunedBlockHashes`, a set disjoint from the finalized ones, so no ordering between the
  // two can hand a listener a released hash. Stating it would be a reassurance with nothing
  // behind it.
  const mock = runtime();
  const { provider, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });

  const pinnedWhenSeen: number[] = [];
  connection.onFinalized(() => pinnedWhenSeen.push(connection.pinnedCountForTest()));

  const a: HexString = `0x${'e5'.repeat(32)}`;
  state.followEvent({ event: 'finalized', finalizedBlockHashes: [a], prunedBlockHashes: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(pinnedWhenSeen.length, 1);
  const firstSeen = pinnedWhenSeen[0];
  assert.ok(firstSeen !== undefined && firstSeen > 0, 'the hash was announced-and-pinned before the listener ran');
  connection.close();
});

/* -------------------------------------------- the finalized runtime (10 §5.2's input, F26) */

/** `chainHead_v1_follow`'s `RuntimeEvent`, at the field names smoldot's serialiser uses. */
const validRuntime = (specVersion: number) => ({
  type: 'valid',
  spec: {
    specName: 'bleavit',
    implName: 'bleavit',
    authoringVersion: 1,
    specVersion,
    implVersion: 0,
    transactionVersion: 1,
    apis: [],
  },
});

test('the recorded corpus establishes no runtime, and that is reported as absent', async () => {
  // The recorder never captured `finalizedBlockRuntime`, so the honest answer over the
  // transcripts is `undefined`. Asserted rather than left implicit, because `undefined` is
  // what the classifier fails closed on and a suite that never saw it would not notice the
  // field being dropped on the way through.
  const mock = runtime();
  const { provider } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  assert.equal(connection.finalizedRuntime(), undefined);
  connection.close();
});

test('the runtime of the initialized finalized block is read off the follow event', async () => {
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: 'subscription-1' });
      followEvent({
        event: 'initialized',
        finalizedBlockHashes: [mock.pinnedBlock() as HexString],
        finalizedBlockRuntime: validRuntime(2),
      } as never);
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  const reported = connection.finalizedRuntime();
  assert.ok(reported, 'the runtime the node reported was dropped');
  assert.equal(reported.specVersion, 2);
  assert.equal(reported.specName, 'bleavit');
  assert.equal(reported.transactionVersion, 1);
  connection.close();
});

test('an `invalid` runtime is absent — the TYPE TAG decides, not whether a spec came with it', async () => {
  // The node saying it could not build the runtime is not a `spec_version`. A classifier
  // handed a half-report would classify a chain against a runtime nobody has.
  //
  // The `spec` is deliberately **well-formed and complete** here, which is the whole test: a
  // reader that only checked whether the fields were present would accept this and report
  // `specVersion: 2` for a block whose runtime the node says it could not construct. Omitting
  // the spec would let that reader pass — a mutant flipping the `type` check survived exactly
  // that fixture.
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: 'subscription-1' });
      followEvent({
        event: 'initialized',
        finalizedBlockHashes: [mock.pinnedBlock() as HexString],
        finalizedBlockRuntime: {
          ...validRuntime(2),
          type: 'invalid',
          error: 'could not compile the runtime',
        },
      } as never);
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  assert.equal(connection.finalizedRuntime(), undefined);
  connection.close();
});

test('a runtime event with an unknown type tag is absent too', async () => {
  // Neither `valid` nor `invalid`: the JSON-RPC spec's `RuntimeEvent` may grow a variant, and
  // an unknown one is something this client cannot interpret. Fail closed on it rather than
  // reading whatever fields happen to be there.
  const mock = runtime();
  const { provider } = recordedProvider(mock, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: 'subscription-1' });
      followEvent({
        event: 'initialized',
        finalizedBlockHashes: [mock.pinnedBlock() as HexString],
        finalizedBlockRuntime: { ...validRuntime(2), type: 'someFutureVariant' },
      } as never);
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });
  assert.equal(connection.finalizedRuntime(), undefined);
  connection.close();
});

test('a runtime announced on an unfinalized block is NOT reported until that block finalizes', async () => {
  // The property that decides whether the app may sign early. `newRuntime` arrives on a
  // block that can still be reorged away; promoting it there would classify — and enable
  // signing — against a runtime the chain never adopted.
  const upgraded: HexString = `0x${'77'.repeat(32)}`;
  const mock = runtime();
  const { provider, state } = recordedProvider(mock, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: 'subscription-1' });
      followEvent({
        event: 'initialized',
        finalizedBlockHashes: [mock.pinnedBlock() as HexString],
        finalizedBlockRuntime: validRuntime(2),
      } as never);
      return true;
    },
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_header' || request.params[1] !== upgraded) return false;
      emit({ jsonrpc: '2.0', id: request.id, result: `0x${'11'.repeat(32)}08${'00'.repeat(64)}` });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });

  state.followEvent({ event: 'newBlock', blockHash: upgraded, newRuntime: validRuntime(3) } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(connection.finalizedRuntime()?.specVersion, 2, 'a best-block runtime was promoted');

  state.followEvent({ event: 'finalized', finalizedBlockHashes: [upgraded], prunedBlockHashes: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(connection.finalizedRuntime()?.specVersion, 3, 'the finalized upgrade was not adopted');
  connection.close();
});

test('two upgrades finalized in one batch leave the LATER one standing', async () => {
  // Order, not map-iteration order: the announcements arrive in insertion order and the
  // chain's order is the only one that decides which runtime is current.
  const first: HexString = `0x${'81'.repeat(32)}`;
  const second: HexString = `0x${'82'.repeat(32)}`;
  const mock = runtime();
  const { provider, state } = recordedProvider(mock, {
    onFollow({ id, emit, followEvent }) {
      emit({ jsonrpc: '2.0', id, result: 'subscription-1' });
      followEvent({
        event: 'initialized',
        finalizedBlockHashes: [mock.pinnedBlock() as HexString],
        finalizedBlockRuntime: validRuntime(2),
      } as never);
      return true;
    },
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_header') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: `0x${'11'.repeat(32)}08${'00'.repeat(64)}` });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });

  // Announced newest-first, so an implementation that took "the last entry it knows about"
  // rather than walking the finalized list in order reports 3 instead of 4.
  state.followEvent({ event: 'newBlock', blockHash: second, newRuntime: validRuntime(4) } as never);
  state.followEvent({ event: 'newBlock', blockHash: first, newRuntime: validRuntime(3) } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));

  state.followEvent({
    event: 'finalized',
    finalizedBlockHashes: [first, second],
    prunedBlockHashes: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(connection.finalizedRuntime()?.specVersion, 4);
  connection.close();
});

test('the announced-runtime map is bounded by the pin window, like the other two caches', async () => {
  const mock = runtime();
  const { provider, state } = recordedProvider(mock, {
    intercept(request, { emit }) {
      if (request.method !== 'chainHead_v1_header') return false;
      emit({ jsonrpc: '2.0', id: request.id, result: `0x${'11'.repeat(32)}08${'00'.repeat(64)}` });
      return true;
    },
  });
  const connection = await ChainHeadConnection.open(provider, { chain: TEST_CHAIN });

  const announced: HexString[] = [];
  for (let i = 0; i < 40; i += 1) {
    const hash = `0x${i.toString(16).padStart(2, '0').repeat(32)}` as HexString;
    announced.push(hash);
    state.followEvent({ event: 'newBlock', blockHash: hash, newRuntime: validRuntime(2) } as never);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Not vacuous: the window already trimmed 40 down to 16, so the map is non-empty and
  // bounded by the same window rather than by nothing. A test that only checked the final
  // zero would pass against an implementation that never wrote to the map at all.
  const held = connection.runtimeCacheCountForTest();
  assert.ok(held > 0, 'no runtime was recorded at all — this assertion would be vacuous');
  assert.ok(held <= 16, `the announced-runtime map grew past the pin window (${held})`);
  // A map fed once per runtime upgrade is sparse, and sparse is not bounded: it is trimmed
  // with the pins that carry it, which is the only bound that depends on nothing a caller does.
  state.followEvent({ event: 'finalized', finalizedBlockHashes: [], prunedBlockHashes: announced });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(connection.runtimeCacheCountForTest(), 0);
  connection.close();
});
