/**
 * The chainHead-v1 transport — 10 §4.1, §4.2.
 *
 * Driven at the **wire level** by F2's recorded transcripts through a provider shaped
 * exactly like `getSmProvider`'s (`tests/chain-client/recorded-provider.mjs`), so the code
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

import { argsFor, bundle, keyFor, recordedProvider } from './recorded-provider.mjs';

const fixtures = bundle();
const runtime = () => createMockRuntime(fixtures);

test('open() follows the chain and learns its finalized block from the transcripts', async () => {
  const mock = runtime();
  const { provider, sent } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider);

  assert.equal(sent[0].method, 'chainHead_v1_follow');
  assert.deepEqual(sent[0].params, [true], 'withRuntime must be set or chainHead_v1_call is unavailable');

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
  assert.equal(blockNumberFromHeader(recorded.response.direct.result), 1);

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
  const connection = await ChainHeadConnection.open(provider);
  const pin = await connection.pinnedBlock();
  const { key, type } = keyFor(fixtures, 'storage.epoch.recent_cohort_summaries');

  const items = await connection.storage(pin, key, type);
  assert.ok(Array.isArray(items));

  const request = sent.find((r) => r.method === 'chainHead_v1_storage');
  assert.deepEqual(request.params, ['subscription-1', pin.blockHash, [{ key, type }], null]);
});

test('a runtime call returns the recorded output', async () => {
  const mock = runtime();
  const { provider } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider);
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
  const moved = `0x${'ab'.repeat(32)}`;
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
  const connection = await ChainHeadConnection.open(provider);
  const reader = await FinalizedReader.open(connection);
  const original = reader.at.blockHash;

  state.followEvent({ event: 'finalized', finalizedBlockHashes: [moved], prunedBlockHashes: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const head = await connection.pinnedBlock();
  assert.equal(head.blockHash, moved, 'the transport head did not advance');
  assert.equal(head.blockNumber, 2);

  const { key, type } = keyFor(fixtures, 'storage.constitution.phase_flags');
  await reader.storage(key, type);

  const storageRequests = sent.filter((r) => r.method === 'chainHead_v1_storage');
  const last = storageRequests.at(-1);
  assert.equal(last.params[1], original, 'the read was issued against the moved head, not the pin');
  assert.notEqual(last.params[1], moved);
});

test('the head advancing does not kill a reader (that is what pinning is for)', async () => {
  // The converse mistake: a reader that refused every read once the chain moved would
  // have a useful life of one block time, which is not a safety property, just an outage.
  const mock = runtime();
  const { provider, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider);
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
  const connection = await ChainHeadConnection.open(provider);
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
  const connection = await ChainHeadConnection.open(provider);
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
  const connection = await ChainHeadConnection.open(provider);
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
  const connection = await ChainHeadConnection.open(provider);
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
  const connection = await ChainHeadConnection.open(provider);
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
  const connection = await ChainHeadConnection.open(provider);
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
  const connection = await ChainHeadConnection.open(provider);
  const pin = await connection.pinnedBlock();
  assert.equal(await connection.call(pin, 'FutarchyApi_epoch_status'), '0xbeef');
});

test('buffered events for operations that never register are bounded', async () => {
  // The buffer is filled by the node, so an unbounded map here is remote-controlled memory
  // growth against the 10 §9.4 budget. Dropping the oldest is safe: a dropped orphan can
  // only ever fail a read, never complete one wrongly.
  const mock = runtime();
  const { provider, state } = recordedProvider(mock);
  const connection = await ChainHeadConnection.open(provider);
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
