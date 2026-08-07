/**
 * `app/tools/snapshot/archive-read.ts` — the archive-node adapter (10 §8.5.1, F24).
 *
 * Three properties carry this suite, and none of them is "the happy path works":
 *
 *  1. **`storageDone` is not a completeness proof.** The interface specification says it is
 *     *"always generated after all storage events have been generated"* and says nothing about
 *     early termination, caps or discarded items. A reader that trusted it would report an
 *     `observed` span it never observed — a document that passes every screen in 10 §8.4,
 *     because the movements it does carry are consistent, while describing a history that did
 *     not happen. So the tests here truncate iterations in each shape a server can truncate
 *     them and assert the span is never claimed.
 *  2. **Identity is pinned to the chain, never to the endpoint.** A node answering about
 *     another chain is refused before a block is read, and no URL reaches the document.
 *  3. **A block that cannot be decoded is refused, never emitted raw.** 10 §6.5's "pending
 *     decoder" row is a client accommodation; a producer emitting one publishes an op set it
 *     already knows is incomplete.
 *
 * The transport and the codec are both fakes, which is the point of injecting them: every
 * branch below is a failure branch, and a failure branch reachable only against a live archive
 * node is one nothing ever executes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type { Sha256 } from '@bleavit/providers';

import { buildSnapshot } from '../../tools/snapshot/build.ts';
import type { PositionedOp } from '../../tools/snapshot/build.ts';
import {
  readArchiveExport,
  readDescendants,
  type ArchiveCodec,
  type ArchiveTransport,
} from '../../tools/snapshot/archive-read.ts';

const sha256: Sha256 = (preimage) => createHash('sha256').update(preimage).digest('hex');

/* ------------------------------------------------------------------------ the fake chain */

const GENESIS = `0x${'ab'.repeat(32)}`;
const FROM = 10;
const TO = 13;

/** Deliberately not a real `System.Events` key: the adapter names no storage key of its own. */
const EVENTS_KEY = '0xe5e5e5e5';
const HOLDINGS_PREFIX = '0xd0d0';

const blockHash = (height: number): string => `0x${height.toString(16).padStart(64, '0')}`;
const heightOf = (hash: string): number => Number.parseInt(hash.slice(2), 16);
/** parent hash (32 B) then eight filler bytes — the adapter reads only the parent. */
const headerOf = (height: number): string =>
  `0x${blockHash(height - 1).slice(2)}${'00'.repeat(8)}`;
const metadataOf = (height: number): string => `0x0d${height.toString(16).padStart(4, '0')}`;
const eventsOf = (height: number): string => `0xee${height.toString(16).padStart(4, '0')}`;

/**
 * The chain's own holdings at block 13.
 *
 * alice split 1000 and merged 200 back; bob split 500. Read from state, never folded from the
 * movements above — which is what lets the last test in this file show a short read being
 * caught by the driver's differential rather than by anything here.
 */
const HOLDING_ROWS = [
  { key: `${HOLDINGS_PREFIX}00`, value: 'v1|alice|FAIL|800' },
  { key: `${HOLDINGS_PREFIX}01`, value: 'v1|alice|PASS|800' },
  { key: `${HOLDINGS_PREFIX}02`, value: 'v1|bob|FAIL|500' },
  { key: `${HOLDINGS_PREFIX}03`, value: 'v1|bob|PASS|500' },
] as const;

const MOVEMENTS: ReadonlyMap<number, readonly PositionedOp[]> = new Map([
  [
    10,
    [
      {
        at: { block: 10, extrinsicIndex: 2, eventIndex: 0 },
        op: { kind: 'split', block: 10, vault: 'v1', account: 'alice', amount: '1000' },
      },
    ] as readonly PositionedOp[],
  ],
  [
    11,
    [
      {
        at: { block: 11, extrinsicIndex: 1, eventIndex: 0 },
        op: { kind: 'split', block: 11, vault: 'v1', account: 'bob', amount: '500' },
      },
    ] as readonly PositionedOp[],
  ],
  [
    12,
    [
      {
        at: { block: 12, extrinsicIndex: 4, eventIndex: 1 },
        op: { kind: 'merge', block: 12, vault: 'v1', account: 'alice', amount: '200' },
      },
    ] as readonly PositionedOp[],
  ],
]);

/* ------------------------------------------------------------------------- the fake codec */

interface CodecOverrides {
  readonly decodeBlock?: ArchiveCodec['decodeBlock'];
  readonly decodeHoldings?: ArchiveCodec['decodeHoldings'];
  readonly decodeBinding?: ArchiveCodec['decodeBinding'];
}

/** Records which metadata each block was decoded with — §8.5.1's per-block rule, observable. */
const decodedWith: { block: number; metadata: string }[] = [];

function codec(overrides: CodecOverrides = {}): ArchiveCodec {
  return {
    metadataCall: { method: 'Metadata_metadata_at_version', args: '0x0f000000' },
    bindingCalls: [{ method: 'Core_version', args: '0x' }],
    eventsKey: () => EVENTS_KEY,
    holdingsPrefix: () => HOLDINGS_PREFIX,
    decodeBinding:
      overrides.decodeBinding ??
      (() => ({ kind: 'decoded', value: { specVersion: 2, contractVersion: 23 } })),
    decodeBlock:
      overrides.decodeBlock ??
      (({ block, metadata, events }) => {
        decodedWith.push({ block, metadata });
        // The block's own bytes decide, so a reader carrying another block's events forward
        // would produce the wrong movements rather than none.
        if (events !== eventsOf(block)) {
          return { kind: 'undecodable', why: `block ${block} was handed ${events}` };
        }
        return { kind: 'decoded', value: MOVEMENTS.get(block) ?? [] };
      }),
    decodeHoldings:
      overrides.decodeHoldings ??
      (({ entries }) => {
        const balances = entries.map((entry) => {
          const [vault, account, branch, amount] = (entry.value ?? '').split('|');
          return {
            vault: vault ?? '',
            account: account ?? '',
            branch: branch ?? '',
            amount: amount ?? '0',
          };
        });
        return {
          kind: 'decoded',
          value: { vaults: [{ vault: 'v1', branches: ['FAIL', 'PASS'] }], balances },
        };
      }),
  };
}

/* --------------------------------------------------------------------- the fake transport */

type StorageEvent = Readonly<Record<string, unknown>>;

interface StorageAsk {
  readonly blockHash: string;
  readonly key: string;
  readonly type: string;
  readonly paginationStartKey?: string;
  /** How many storage operations this transport has already served. */
  readonly round: number;
}

interface NodeSpec {
  readonly genesisHash?: string;
  readonly finalizedHeight?: number;
  readonly hashByHeight?: (height: number) => readonly string[];
  readonly header?: (height: number) => string;
  readonly body?: (height: number) => unknown;
  readonly call?: (hash: string, method: string, args: string) => unknown;
  readonly storage?: (ask: StorageAsk) => readonly StorageEvent[];
  /** `immediate` delivers events before `request` resolves, exercising the orphan buffer. */
  readonly delivery?: 'immediate' | 'later';
}

interface FakeNode extends ArchiveTransport {
  readonly methods: readonly string[];
  readonly asks: readonly StorageAsk[];
}

function storageOf(rows: readonly { key: string; value: string }[], pageSize: number) {
  return (ask: StorageAsk): readonly StorageEvent[] => {
    const start = ask.paginationStartKey;
    const after = start === undefined ? rows : rows.filter((row) => row.key > start);
    return [
      ...after.slice(0, pageSize).map((row) => ({ event: 'storage', key: row.key, value: row.value })),
      { event: 'storageDone' },
    ];
  };
}

const DEFAULT_STORAGE = (ask: StorageAsk): readonly StorageEvent[] => {
  if (ask.type === 'value') {
    return [
      { event: 'storage', key: ask.key, value: eventsOf(heightOf(ask.blockHash)) },
      { event: 'storageDone' },
    ];
  }
  return storageOf([...HOLDING_ROWS], 2)(ask);
};

function archiveNode(spec: NodeSpec = {}): FakeNode {
  const listeners = new Set<(method: string, params: unknown) => void>();
  const methods: string[] = [];
  const asks: StorageAsk[] = [];
  let operations = 0;

  const emit = (subscription: string, events: readonly StorageEvent[]): void => {
    for (const event of events) {
      for (const listener of listeners) {
        listener('archive_v1_storageEvent', { subscription, result: event });
      }
    }
  };

  return {
    methods,
    asks,
    onNotification(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request(method, params) {
      methods.push(method);
      const args = params as readonly unknown[];
      switch (method) {
        case 'archive_v1_genesisHash':
          return spec.genesisHash ?? GENESIS;
        case 'archive_v1_finalizedHeight':
          return spec.finalizedHeight ?? 100;
        case 'archive_v1_hashByHeight': {
          const height = args[0] as number;
          return spec.hashByHeight?.(height) ?? [blockHash(height)];
        }
        case 'archive_v1_header': {
          const height = heightOf(args[0] as string);
          return spec.header?.(height) ?? headerOf(height);
        }
        case 'archive_v1_body': {
          const height = heightOf(args[0] as string);
          // Not `?? default`: a spec that answers `null` is testing exactly that case, and a
          // nullish fallback would silently rewrite it into a healthy answer.
          if (spec.body === undefined) return [`0xbb${height.toString(16).padStart(4, '0')}`];
          return spec.body(height);
        }
        case 'archive_v1_call': {
          const [hash, name, callArgs] = args as [string, string, string];
          if (spec.call !== undefined) return spec.call(hash, name, callArgs);
          if (name === 'Metadata_metadata_at_version') {
            return { success: true, value: metadataOf(heightOf(hash)) };
          }
          return { success: true, value: '0xc0de' };
        }
        case 'archive_v1_storage': {
          operations += 1;
          const [hash, items] = args as [string, readonly Record<string, unknown>[]];
          const item = items[0] ?? {};
          const ask: StorageAsk = {
            blockHash: hash,
            key: String(item['key']),
            type: String(item['type']),
            ...(typeof item['paginationStartKey'] === 'string'
              ? { paginationStartKey: item['paginationStartKey'] }
              : {}),
            round: operations,
          };
          asks.push(ask);
          const subscription = `op-${operations}`;
          const events = (spec.storage ?? DEFAULT_STORAGE)(ask);
          if (spec.delivery === 'immediate') {
            emit(subscription, events);
            return subscription;
          }
          setTimeout(() => emit(subscription, events), 0);
          return subscription;
        }
        default:
          throw new Error(`the fake node was asked for ${method}`);
      }
    },
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return { genesisHash: GENESIS, fromBlock: FROM, toBlock: TO, ...overrides };
}

async function read(node: FakeNode, codecOverrides: CodecOverrides = {}, planOverrides = {}) {
  return readArchiveExport(node, plan(planOverrides), codec(codecOverrides));
}

function refusalOf(result: Awaited<ReturnType<typeof readArchiveExport>>): string {
  assert.equal(result.kind, 'refused', 'expected the reader to refuse');
  return result.kind === 'refused' ? result.why.join('\n') : '';
}

function readingOf(result: Awaited<ReturnType<typeof readArchiveExport>>) {
  assert.equal(
    result.kind,
    'read',
    result.kind === 'refused' ? result.why.join('\n') : 'expected a reading',
  );
  if (result.kind !== 'read') throw new Error('unreachable');
  return result;
}

/* ---------------------------------------------------------------- the group, and only it */

test('every request is in the archive_v1_* group §8.5.1 names', async () => {
  // 10 §8.5.1 binds the producer to seven methods, and the legacy `state_*`/`chain_*` pair is
  // excluded by name because it carries no versioned contract. A reader that reached for one
  // would be readable by exactly one node vendor, which is the opposite of reproduce-by-anyone.
  const node = archiveNode();
  readingOf(await read(node));
  const allowed = new Set([
    'archive_v1_genesisHash',
    'archive_v1_finalizedHeight',
    'archive_v1_hashByHeight',
    'archive_v1_header',
    'archive_v1_body',
    'archive_v1_storage',
    'archive_v1_call',
  ]);
  const outside = [...new Set(node.methods)].filter((method) => !allowed.has(method));
  assert.deepEqual(outside, [], 'a method outside the group reached the node');
  assert.ok(node.methods.length > 0, 'the reader issued nothing at all');
});

/* -------------------------------------------------------------------------- the identity */

test('a node on another chain is refused BEFORE any block is read', async () => {
  // The check has to come first or it is decoration: a reader that pinned heights, pulled
  // bodies and decoded events before comparing genesis would have spent the whole range
  // learning about a chain the consumer does not have.
  const node = archiveNode({ genesisHash: `0x${'cd'.repeat(32)}` });
  const why = refusalOf(await read(node));
  assert.match(why, /genesis hash/);
  assert.ok(
    !node.methods.includes('archive_v1_hashByHeight'),
    'the reader pinned block heights on a chain it had already been told was the wrong one',
  );
});

test('a genesis hash differing only in case is the SAME chain', async () => {
  // The anti-vacuity control for the refusal above. A comparison that refused `0xAB…` against
  // `0xab…` would reject honest nodes, and the first fix anyone reaches for is to stop
  // comparing.
  const node = archiveNode({ genesisHash: GENESIS.toUpperCase().replace('0X', '0x') });
  readingOf(await read(node));
});

test('the document is addressed by chain and block, and records no endpoint', async () => {
  // §8.2's reproducibility promise is a property of the document, so it must not depend on
  // which node answered. There is no endpoint field, which is why there is no addressing
  // convention to get wrong — asserted over the serialized export rather than over the type,
  // since a type says nothing about what a later field might carry.
  const result = readingOf(await read(archiveNode()));
  const text = JSON.stringify(result.export);
  assert.ok(!/https?:|wss?:|localhost|127\.0\.0\.1/i.test(text), text);
  assert.equal(result.export.binding.genesisHash, GENESIS);
  assert.deepEqual(result.export.range, { fromBlock: FROM, toBlock: TO });
});

/* ------------------------------------------------------- completeness, established not inferred */

test('an iteration issues a continuation AFTER storageDone, every time', async () => {
  // The load-bearing property. Four rows at two per page is exactly two pages of data — an
  // honest reader still issues a third operation, because the second one's `storageDone` is a
  // claim and the confirming continuation is what turns it into an observation.
  const node = archiveNode();
  const result = await readDescendants(node, blockHash(TO), HOLDINGS_PREFIX, 'descendantsValues');
  assert.equal(result.kind, 'concluded');
  assert.equal(result.kind === 'concluded' ? result.entries.length : -1, HOLDING_ROWS.length);
  assert.equal(node.asks.length, 3, 'the reader stopped at the first storageDone');
  assert.equal(node.asks[0]?.paginationStartKey, undefined);
  assert.equal(node.asks[1]?.paginationStartKey, HOLDING_ROWS[1].key);
  // The resume point is always the greatest key held, which is what makes "below the resume
  // point" a statement about omission rather than about ordering.
  assert.equal(node.asks[2]?.paginationStartKey, HOLDING_ROWS[3].key);
});

test('a server that re-serves its first page is NOT concluded', async () => {
  // The truncation that `storageDone` cannot distinguish from completion: the server ignores
  // `paginationStartKey` and answers every continuation with page one. A reader that stopped
  // when a continuation added no new key would call this done, holding two rows of three.
  const node = archiveNode({
    storage: () => [
      { event: 'storage', key: HOLDING_ROWS[0].key, value: HOLDING_ROWS[0].value },
      { event: 'storage', key: HOLDING_ROWS[1].key, value: HOLDING_ROWS[1].value },
      { event: 'storageDone' },
    ],
  });
  const result = await readDescendants(node, blockHash(TO), HOLDINGS_PREFIX, 'descendantsValues');
  assert.equal(result.kind, 'inconclusive');
  assert.match(result.kind === 'inconclusive' ? result.why : '', /below the resume point/);
});

test('a truncated holdings iteration produces NO observed span at all', async () => {
  // The property this whole file exists for, at the level a document is built from. There is
  // no reading to inspect: a partial balance sheet would state holdings the read cannot
  // support, and an empty one would assert the chain holds nothing, so neither is published.
  const node = archiveNode({
    storage: (ask) =>
      ask.type === 'value'
        ? DEFAULT_STORAGE(ask)
        : [
            { event: 'storage', key: HOLDING_ROWS[0].key, value: HOLDING_ROWS[0].value },
            { event: 'storage', key: HOLDING_ROWS[1].key, value: HOLDING_ROWS[1].value },
            { event: 'storageDone' },
          ],
  });
  const result = await read(node);
  const why = refusalOf(result);
  assert.match(why, /holdings read at block 13 did not conclude/);
  assert.ok(!('export' in result), 'a refusal must not carry a document');
});

test('a continuation that errors is inconclusive, not a short answer', async () => {
  const node = archiveNode({
    storage: (ask) =>
      ask.paginationStartKey === undefined
        ? [
            { event: 'storage', key: HOLDING_ROWS[0].key, value: HOLDING_ROWS[0].value },
            { event: 'storageDone' },
          ]
        : [{ event: 'storageError', error: 'the node gave up' }],
  });
  const result = await readDescendants(node, blockHash(TO), HOLDINGS_PREFIX, 'descendantsValues');
  assert.equal(result.kind, 'inconclusive');
  assert.match(result.kind === 'inconclusive' ? result.why : '', /the node gave up/);
});

test('a continuation carrying an unseen key BELOW the resume point is inconclusive', async () => {
  // Read from the other end: the resume point is the greatest key held, so a key beneath it
  // that we have never seen means an earlier page omitted it. The rows arrive complete in
  // count and are missing one in the middle, which no total could reveal.
  const node = archiveNode({
    storage: (ask) =>
      ask.paginationStartKey === undefined
        ? [
            { event: 'storage', key: HOLDING_ROWS[2].key, value: HOLDING_ROWS[2].value },
            { event: 'storageDone' },
          ]
        : [
            { event: 'storage', key: HOLDING_ROWS[0].key, value: HOLDING_ROWS[0].value },
            { event: 'storageDone' },
          ],
  });
  const result = await readDescendants(node, blockHash(TO), HOLDINGS_PREFIX, 'descendantsValues');
  assert.equal(result.kind, 'inconclusive');
});

test('the continuation budget refuses rather than truncating', async () => {
  // A server that always has one more key is indistinguishable from an endless one, and the
  // failure a bound must never have is a silent stop. Exceeding it is `inconclusive`.
  let issued = 0;
  const node = archiveNode({
    storage: () => {
      issued += 1;
      return [
        { event: 'storage', key: `${HOLDINGS_PREFIX}${issued.toString(16).padStart(8, '0')}`, value: 'x' },
        { event: 'storageDone' },
      ];
    },
  });
  const result = await readDescendants(
    node,
    blockHash(TO),
    HOLDINGS_PREFIX,
    'descendantsValues',
    3,
  );
  assert.equal(result.kind, 'inconclusive');
  assert.match(result.kind === 'inconclusive' ? result.why : '', /exceeded 3 continuations/);
});

test('an empty prefix concludes with nothing, rather than iterating forever', async () => {
  const node = archiveNode({ storage: () => [{ event: 'storageDone' }] });
  const result = await readDescendants(node, blockHash(TO), HOLDINGS_PREFIX, 'descendantsValues');
  assert.deepEqual(result, { kind: 'concluded', entries: [] });
  assert.equal(node.asks.length, 1, 'there is no resume point to continue from');
});

/* ------------------------------------------------------------------- observed, narrowed honestly */

test('a block whose events read fails leaves observed, and the span is not claimed', async () => {
  // The distinction the file is built on: a read that did not conclude is honest ignorance and
  // `observed` is the structure for recording it. Block 11 is missing from coverage; nothing
  // pretends otherwise, and nothing refuses either, because refusing would discard three
  // blocks that were read correctly.
  const node = archiveNode({
    storage: (ask) =>
      ask.type === 'value' && heightOf(ask.blockHash) === 11
        ? [{ event: 'storageError', error: 'this block is unavailable' }]
        : DEFAULT_STORAGE(ask),
  });
  const result = readingOf(await read(node));
  assert.deepEqual(result.export.observed, [
    { fromBlock: 10, toBlock: 10 },
    { fromBlock: 12, toBlock: 13 },
  ]);
  assert.ok(
    result.notes.some((note) => /block 11 is not observed/.test(note)),
    result.notes.join('\n'),
  );
  // And the movements from the unobserved block are not carried either — an op from a block
  // the reader never saw is the forgery in its purest form.
  assert.ok(!result.export.ops.some((entry) => entry.op.block === 11));
});

test('every block in observed had every read covering it conclude', async () => {
  // Stated as its own case because it is §8.5.1's rule verbatim, and because the failure it
  // guards is asymmetric: a missing span costs a producer a re-run, and a claimed one costs a
  // consumer a history that did not happen.
  const failing = new Set([11, 13]);
  const node = archiveNode({
    storage: (ask) =>
      ask.type === 'value' && failing.has(heightOf(ask.blockHash))
        ? [{ event: 'storageError', error: 'unavailable' }]
        : DEFAULT_STORAGE(ask),
  });
  const result = readingOf(await read(node));
  const covered = new Set<number>();
  for (const span of result.export.observed) {
    for (let height = span.fromBlock; height <= span.toBlock; height += 1) covered.add(height);
  }
  for (const height of failing) {
    assert.ok(!covered.has(height), `block ${height} was claimed after a read that did not conclude`);
  }
  assert.deepEqual([...covered].sort((a, b) => a - b), [10, 12]);
});

/* --------------------------------------------------------------------------- the decode */

test('an undecodable block refuses the whole read', async () => {
  // §8.5.1 is explicit: a producer that cannot decode a block refuses to publish it rather
  // than emitting it raw. Refusing the read names the real cause; dropping the block would
  // meet the same gap at `buildSnapshot`, one layer later, as a message about a missing
  // movement rather than about a decoder.
  const why = refusalOf(
    await read(archiveNode(), {
      decodeBlock: ({ block }) =>
        block === 12
          ? { kind: 'undecodable', why: 'an event variant this producer has no types for' }
          : { kind: 'decoded', value: MOVEMENTS.get(block) ?? [] },
    }),
  );
  assert.match(why, /block 12 could not be decoded/);
  assert.match(why, /no types for/);
});

test('a codec that THROWS refuses, rather than losing a range that was read correctly', async () => {
  // The codec's contract is that `undecodable` is a value; this is what makes that true of a
  // codec that does not honour it. A throw escaping would take out three blocks read perfectly
  // well, and it would arrive as a stack trace rather than as a reason a producer can act on.
  const why = refusalOf(
    await read(archiveNode(), {
      decodeBlock: ({ block }) => {
        if (block === 11) throw new RangeError('index out of range in this producer');
        return { kind: 'decoded', value: MOVEMENTS.get(block) ?? [] };
      },
    }),
  );
  assert.match(why, /decodeBlock at block 11 threw/);
  assert.match(why, /index out of range/);
});

test('a block whose own metadata cannot be obtained is refused, never decoded with another', async () => {
  const why = refusalOf(
    await read(
      archiveNode({
        call: (hash, method) =>
          method === 'Metadata_metadata_at_version' && heightOf(hash) === 12
            ? { success: false, error: 'no runtime at this block' }
            : { success: true, value: metadataOf(heightOf(hash)) },
      }),
    ),
  );
  assert.match(why, /Metadata_metadata_at_version at block 12/);
});

test('the metadata comes from the block being decoded, not once for the range', async () => {
  // 10 §6.5's discipline, and the reason FE-P5 does not reach this tool. A reader that fetched
  // metadata once and carried it across a runtime upgrade would mis-decode exactly the old
  // history a snapshot exists to carry — silently, because the wrong types still decode.
  decodedWith.length = 0;
  readingOf(await read(archiveNode()));
  assert.deepEqual(decodedWith, [
    { block: 10, metadata: metadataOf(10) },
    { block: 11, metadata: metadataOf(11) },
    { block: 12, metadata: metadataOf(12) },
    { block: 13, metadata: metadataOf(13) },
  ]);
});

/* ----------------------------------------------------------------------------- the range */

test('a range above the finalized height is refused', async () => {
  // Above it the interface guarantees nothing: `hashByHeight` may answer with several blocks
  // and `body` may answer null at any time. A span read there is not history yet.
  const why = refusalOf(await read(archiveNode({ finalizedHeight: 12 })));
  assert.match(why, /above this node's finalized height 12/);
});

test('a height answering with two hashes is refused', async () => {
  const why = refusalOf(
    await read(
      archiveNode({
        hashByHeight: (height) =>
          height === 12 ? [blockHash(12), blockHash(9999)] : [blockHash(height)],
      }),
    ),
  );
  assert.match(why, /returned 2 hashes/);
});

test('blocks that do not form one chain are refused', async () => {
  // The load-balanced-endpoint failure the interface specification warns about in its own
  // `finalizedHeight` note: two nodes behind one URL, answering about two histories. Each
  // answer is individually well-formed, which is why only the link between them can catch it.
  const why = refusalOf(
    await read(archiveNode({ header: (height) => (height === 12 ? headerOf(999) : headerOf(height)) })),
  );
  assert.match(why, /do not form one chain/);
});

test('a body the node will not serve is refused', async () => {
  const why = refusalOf(await read(archiveNode({ body: (height) => (height === 11 ? null : []) })));
  assert.match(why, /body of block 11/);
});

/* ------------------------------------------------------------------------- the plumbing */

test('storage events arriving before the operation is registered are not lost', async () => {
  // V-85's shape, on the archive sibling: awaiting `request` yields to the microtask queue, so
  // `storageDone` can be delivered before the handler that would consume it exists. Dropping
  // it there hangs the read forever, which on a producer's console reads as a slow node.
  const result = readingOf(await read(archiveNode({ delivery: 'immediate' })));
  assert.equal(result.export.ops.length, 3);
});

/* --------------------------------------------------------------- the loop, closed and open */

test('what the reader produces, the driver publishes', async () => {
  // The anti-vacuity control for every refusal above: the fake node describes a history that
  // reconciles, and it must come out the other end as a pinned document. Without this, a
  // reader that refused everything would pass the whole suite.
  const result = readingOf(await read(archiveNode()));
  const built = buildSnapshot(result.export, sha256);
  assert.equal(
    built.kind,
    'built',
    built.kind === 'refused' ? built.why.join('\n') : '',
  );
  if (built.kind !== 'built') throw new Error('unreachable');
  assert.deepEqual(built.document.coverage, [{ fromBlock: 10, toBlock: 13 }]);
  assert.equal(built.document.ops.length, 3);
});

test('the ONE truncation this cannot see is caught by the differential, not hidden', async () => {
  // A server that answers page one short, emits `storageDone`, and then answers the
  // continuation EMPTY is indistinguishable from one that is finished: the interface publishes
  // no total and no proof, so no reader can close that gap. It is named here rather than
  // papered over — and then shown to be closed one layer up, which is the whole argument for
  // reading the balance sheet from state instead of folding the reader's own ops.
  const node = archiveNode({
    storage: (ask) => {
      if (ask.type === 'value') return DEFAULT_STORAGE(ask);
      if (ask.paginationStartKey === undefined) {
        return [
          { event: 'storage', key: HOLDING_ROWS[0].key, value: HOLDING_ROWS[0].value },
          { event: 'storage', key: HOLDING_ROWS[1].key, value: HOLDING_ROWS[1].value },
          { event: 'storageDone' },
        ];
      }
      return [{ event: 'storageDone' }];
    },
  });
  const result = readingOf(await read(node));
  // The reader cannot tell, and says so by concluding.
  assert.equal(result.export.balances.length, 2);
  const built = buildSnapshot(result.export, sha256);
  assert.equal(built.kind, 'refused');
  assert.ok(
    built.kind === 'refused' && built.why.some((line) => /does not agree happened/.test(line)),
    built.kind === 'refused' ? built.why.join('\n') : '',
  );
});
