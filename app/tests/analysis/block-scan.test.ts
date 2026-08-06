/**
 * The ingest scanner — 10 §6.5, F8's composition root.
 *
 * `event-accounts.ts` and `ingest.ts` were each built and each tested; nothing joined them,
 * and the join is where the interesting failures are. All of them are **silent**, so every
 * test here is written against the failure rather than the happy path.
 *
 * ## The oracle is the runtime's own codec, plus the one recorded transcript
 *
 * `app/fixtures/chainhead/storage.system.events.json` is a real `System.Events` value read
 * from this runtime at a pinned block — and it decodes to **two `System.ExtrinsicSuccess`
 * events and no account at all** (measured for F8's account work, and re-asserted here so it
 * cannot quietly change). That makes it a perfect *negative* oracle and a useless positive
 * one, so account-bearing blocks are built by encoding through the runtime's own
 * `System.Events` codec, exactly as `tests/chain-client/event-accounts.test.ts` does.
 *
 * The negative case is worth as much as the positive one here: a block of pure inherents
 * must scan to *no attribution*, and the whole §6.5 cost claim is that such blocks — nearly
 * all of them — never trigger a body fetch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { bleavit } from '@polkadot-api/descriptors';
import { accountKey, eventAccountReader, loadCodecs, loadMetadata } from '@bleavit/chain-client';
import { BlockScanError, blockScanner, watchedAccounts } from '@bleavit/features-analysis';
import { needsBodyFetch, attributedExtrinsics } from '@bleavit/local-index';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..');

const metadata = loadMetadata(
  readFileSync(join(APP, 'fixtures', 'chain-feed', '2', 'metadata.scale')),
);
const codecs = await loadCodecs(bleavit);
const scanner = blockScanner(codecs, eventAccountReader(metadata));

/**
 * The header facts every scan carries — 10 §6.3's hash-at-edge and spec-version-at-edge.
 *
 * They enter the index here because this is where a block becomes a scan, and they are **read
 * from the header** rather than derived: an edge check against a hash the client computed from
 * its own rows would agree with itself by construction, which is the vacuous-check shape this
 * client keeps finding.
 */
const at = (number: number, specVersion = 3) => ({
  number,
  hash: `0x${number.toString(16).padStart(64, '0')}`,
  specVersion,
  // The block's own timestamp — 10 §9.2's candle buckets are aligned to it, and a device
  // clock would align them exactly and meaninglessly.
  timestampMs: number * 6_000,
});

/** Generic-format (prefix 42) addresses — deliberately NOT this chain's rendering. */
const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

interface EventCodec {
  enc(records: unknown): Uint8Array;
}

const eventsCodec = (
  codecs as { query: Record<string, Record<string, { value: EventCodec }>> }
).query['System']!['Events']!.value;

interface RecordSpec {
  readonly phase: { readonly type: string; readonly value?: unknown };
  readonly event: unknown;
}

/** Encode a block's worth of records through the runtime's own codec. */
function encodeEvents(records: readonly RecordSpec[]): string {
  const bytes = eventsCodec.enc(records.map((r) => ({ ...r, topics: [] })));
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const transfer = (from: string, to: string): unknown => ({
  type: 'Balances',
  value: { type: 'Transfer', value: { from, to, amount: 42n } },
});

const success = (): unknown => ({
  type: 'System',
  value: {
    type: 'ExtrinsicSuccess',
    value: { dispatch_info: { weight: { ref_time: 1n, proof_size: 1n }, class: { type: 'Normal' }, pays_fee: { type: 'Yes' } } },
  },
});

/** The recorded `System.Events` value, read exactly as the storage-key suite reads it. */
function recordedEventsValue(): string {
  const doc = JSON.parse(
    readFileSync(join(APP, 'fixtures', 'chainhead', 'storage.system.events.json'), 'utf8'),
  ) as {
    requests: readonly {
      response: { events?: readonly { items?: readonly { value?: string }[] }[] };
    }[];
  };
  for (const request of doc.requests) {
    for (const event of request.response.events ?? []) {
      for (const item of event.items ?? []) {
        if (item.value !== undefined) return item.value;
      }
    }
  }
  throw new Error('the recorded transcript carries no System.Events value');
}

test('a block that cannot be decoded REFUSES — it never scans to an empty block', () => {
  // The whole safety property, and one line of code either way. An empty `events` array is a
  // well-formed answer meaning "no event here names anyone": no body is fetched, the block is
  // recorded as ingested, and the user's transaction is gone from their history with nothing
  // anywhere reporting a problem.
  assert.throws(
    () => scanner.scan(at(100), '0xdeadbeef'),
    (error) => {
      assert.ok(error instanceof BlockScanError);
      assert.equal(error.blockNumber, 100);
      assert.match(error.message, /Refusing rather than recording an empty scan/);
      return true;
    },
  );

  // Not vacuous: a well-formed blob at the same call site scans.
  const scan = scanner.scan(at(100), encodeEvents([{ phase: { type: 'ApplyExtrinsic', value: 0 }, event: transfer(ALICE, BOB) }]));
  assert.equal(scan.events.length, 1);
});

test('an unrecognised phase refuses, because every available default is wrong', () => {
  // Defaulting to `finalization` drops the attribution silently — a finalization event never
  // attributes, by design. Defaulting to `apply-extrinsic` needs an index nobody supplied,
  // and a made-up index attributes the event to a DIFFERENT extrinsic, which `loop.ts` then
  // decodes and renders as the user's.
  //
  // The runtime's own codec cannot encode a phase that does not exist, so the record is
  // handed to the scanner through a codec stub — the only way to reach the branch at all.
  const stub = {
    query: {
      System: {
        Events: {
          value: {
            dec: () => [
              { phase: { type: 'SomethingNew', value: 3 }, event: transfer(ALICE, BOB), topics: [] },
            ],
          },
        },
      },
    },
  };
  // No cast: `ChainCodecs.query` is `unknown` precisely so a stub is assignable — app-code
  // rule 2 bans `as unknown as` across `app/`, and this is the shape that makes it needless.
  const stubbed = blockScanner(stub, eventAccountReader(metadata));
  assert.throws(
    () => stubbed.scan(at(7), '0x00'),
    (error) => {
      assert.ok(error instanceof BlockScanError);
      assert.match(error.message, /unrecognised phase "SomethingNew"/);
      return true;
    },
  );
});

test('an ApplyExtrinsic phase with a non-index value refuses rather than being coerced', () => {
  // Same failure as `ingest.ts`'s out-of-range refusal, one step earlier: decoding at a bad
  // index does not throw, it returns a different extrinsic.
  const stub = {
    query: {
      System: {
        Events: {
          value: {
            dec: () => [
              { phase: { type: 'ApplyExtrinsic', value: -1 }, event: transfer(ALICE, BOB), topics: [] },
            ],
          },
        },
      },
    },
  };
  // No cast: `ChainCodecs.query` is `unknown` precisely so a stub is assignable — app-code
  // rule 2 bans `as unknown as` across `app/`, and this is the shape that makes it needless.
  const stubbed = blockScanner(stub, eventAccountReader(metadata));
  assert.throws(() => stubbed.scan(at(7), '0x00'), /ApplyExtrinsic with a non-index value/);
});

test('the scan feeds `needsBodyFetch`, and the accounts match a set built the same way', () => {
  // V-164 end to end. PAPI renders accounts in THIS chain's SS58 prefix (7777, 02 §8), so a watched
  // set in any other rendering matches nothing ever — presenting as an empty transaction
  // history with no error anywhere. `watchedAccounts` is the same conversion the scanner
  // emits, which is what makes `watched.has(account)` a comparison of like with like.
  const eventsHex = encodeEvents([
    { phase: { type: 'Initialization' }, event: success() },
    { phase: { type: 'ApplyExtrinsic', value: 0 }, event: success() },
    { phase: { type: 'ApplyExtrinsic', value: 1 }, event: transfer(ALICE, BOB) },
    { phase: { type: 'ApplyExtrinsic', value: 1 }, event: success() },
  ]);
  const scan = scanner.scan(at(512), eventsHex);
  assert.equal(scan.number, 512);
  assert.deepEqual(
    scan.events.map((event) => `${event.pallet}.${event.name}`),
    ['System.ExtrinsicSuccess', 'System.ExtrinsicSuccess', 'Balances.Transfer', 'System.ExtrinsicSuccess'],
  );
  assert.deepEqual(scan.events[0]?.phase, { kind: 'initialization' });
  assert.deepEqual(scan.events[2]?.phase, { kind: 'apply-extrinsic', index: 1 });

  const watched = watchedAccounts([ALICE]);
  assert.equal(needsBodyFetch(scan, watched), true);
  assert.deepEqual([...attributedExtrinsics(scan, watched)], [1]);

  // And a set built from the SS58 string the chain would render matches NOTHING — the
  // failure `accountKey` exists to prevent, asserted rather than described.
  const rendered = new Set(scan.events.flatMap((event) => [...event.accounts]));
  assert.ok(rendered.has(accountKey(ALICE)));
  assert.ok(!rendered.has(ALICE));
});

test('a block of pure inherents attributes nobody — §6.5 costs nothing on almost every block', () => {
  // The negative case carries as much as the positive one: `System.ExtrinsicSuccess` is
  // emitted for EVERY extrinsic in EVERY block, so treating it as attribution would fetch a
  // body per block on a light client, on a phone, while every "does it find my transactions"
  // test stayed green.
  const scan = scanner.scan(at(1), recordedEventsValue());
  assert.deepEqual(
    scan.events.map((event) => `${event.pallet}.${event.name}`),
    ['System.ExtrinsicSuccess', 'System.ExtrinsicSuccess'],
    'the recorded transcript is a block of inherents — the premise this negative oracle rests on',
  );
  assert.deepEqual(scan.events.flatMap((event) => [...event.accounts]), []);
  assert.equal(needsBodyFetch(scan, watchedAccounts([ALICE, BOB])), false);
});

test('`extrinsicCount` is passed through and never derived from the events (SQ-595)', () => {
  // Deriving it as `max index + 1` makes `ingest.ts`'s bounds check vacuous BY CONSTRUCTION —
  // a check that cannot fail. So it is absent unless supplied.
  const eventsHex = encodeEvents([
    { phase: { type: 'ApplyExtrinsic', value: 4 }, event: transfer(ALICE, BOB) },
  ]);
  assert.equal(scanner.scan(at(9), eventsHex).extrinsicCount, undefined);
  assert.equal(scanner.scan(at(9), eventsHex, 12).extrinsicCount, 12);

  // Asserted by absence too, comments stripped first — a raw scan reports the prose that
  // explains the rule as the rule being broken.
  const source = readFileSync(join(APP, 'src/features/analysis/src/block-scan.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const forbidden of ['Math.max', 'length + 1', '+ 1']) {
    assert.ok(!source.includes(forbidden), `block-scan.ts must not compute a count — ${forbidden}`);
  }
});

test('the scanner does not fetch — it is handed the value read at the block it stamps', () => {
  // A scanner that could fetch could fetch at a different block than the one it stamps, which
  // is the read-at-the-block-I-pinned rule `chain-client` makes structural (V-84). `scan`
  // takes the raw value; there is no transport in this module's signature at all.
  const source = readFileSync(join(APP, 'src/features/analysis/src/block-scan.ts'), 'utf8');
  assert.ok(!source.includes('await'), 'the scanner is synchronous — nothing here can fetch');
});

test('§6.5’s two decode failures get two answers — one refuses, one stores raw', () => {
  // The split. An unreadable `System.Events` blob **throws** (asserted above): an empty `events`
  // array is a well-formed answer meaning "no event in this block names anyone", so degrading to
  // it fetches no body, records the block as ingested, and drops the user's transaction from
  // their history with nothing reporting a problem.
  //
  // An unavailable **era metadata** is not that. The bytes are intact and simply not decodable
  // yet, and §6.5's answer is to store them raw, keep going, and count them — refusing there
  // stops the whole run at the first block from an older runtime, which is every backfill across
  // an upgrade. The caller reaches this arm when it has no codecs for the block's spec_version at
  // all, which is why it cannot be decided inside `scan`: a scanner bound to one runtime's
  // codecs has nothing to test.
  const pending = scanner.pendingScan(at(4_000, 2), '0x010203', 'no metadata blob for spec_version 2');
  assert.deepEqual(pending.events, [], 'a pending-decode scan must carry no half-decoded events');
  assert.deepEqual(pending.pendingDecode?.raw, new Uint8Array([1, 2, 3]));
  assert.match(pending.pendingDecode?.reason ?? '', /spec_version 2/);
  assert.equal(pending.specVersion, 2);
  assert.equal(pending.hash, at(4_000).hash);

  // A reason is required: §6.5 surfaces this as "N events pending decoder", and a row with no
  // reason cannot be explained to the user whose history is incomplete because of it.
  assert.throws(() => scanner.pendingScan(at(4_000, 2), '0x01', '  '), BlockScanError);
  // ...and the bytes must be bytes, or the raw row can never be decoded when the metadata lands.
  assert.throws(() => scanner.pendingScan(at(4_000, 2), '0xzz', 'why'), BlockScanError);
});

test('the scan carries §6.3’s edge facts from the HEADER, not from what it decoded', () => {
  // The edge check exists to notice a reorg past the coverage edge. A hash the client computed
  // from its own rows would agree with itself by construction — the vacuous-check shape.
  const eventsHex = recordedEventsValue();
  const scan = scanner.scan(at(777, 5), eventsHex);
  assert.equal(scan.hash, at(777).hash);
  assert.equal(scan.specVersion, 5);
});

test('a Market.Traded event is decoded into 10 §9.1’s fill, through the runtime’s own codec', () => {
  // The scan-time aggregate's input, and the decode has to live here for the same reason
  // `accounts` does: `local-index` may not import the chain SDK, so a field of a decoded event
  // reaches it as a value or not at all.
  //
  // Encoded through the runtime's own `System.Events` codec rather than hand-built, because the
  // property under test is *what this runtime emits*: a hand-built record would prove only that
  // the scanner reads the shape the test author had in mind.
  const eventsHex = encodeEvents([
    {
      phase: { type: 'ApplyExtrinsic', value: 0 },
      event: {
        type: 'Market',
        value: {
          type: 'Traded',
          value: {
            market: 7n,
            who: ALICE,
            side: { type: 'BuyLong' },
            amount: 1_000_000n,
            cost: 500_000n,
            p_after: 612_345_678n,
          },
        },
      },
    },
  ]);
  const scan = scanner.scan(at(1_234), eventsHex);
  const event = scan.events[0];
  assert.ok(event?.trade, '02 §5’s Traded event reached the index with no p_after to fold');
  // 02 §2 makes `MarketId` a u64, whose values run past 2^53 — a number would round two adjacent
  // books onto one chart key, so the id leaves as a canonical decimal string.
  assert.equal(event.trade.bookId, '7');
  assert.equal(typeof event.trade.bookId, 'string');

  // **Asserted past 2^53, because a small id proves nothing**: `String(Number(7n))` and
  // `7n.toString()` are the same string, so a fixture in the low integers passes whichever way
  // the conversion is written. Above the safe range the two disagree, and the disagreement is a
  // chart key shared by two books whose prices are then one series.
  const big = (1n << 53n) + 1n;
  const bigScan = scanner.scan(at(1_236), encodeEvents([
    {
      phase: { type: 'ApplyExtrinsic', value: 0 },
      event: {
        type: 'Market',
        value: {
          type: 'Traded',
          value: {
            market: big,
            who: ALICE,
            side: { type: 'BuyLong' },
            amount: 1n,
            cost: 1n,
            p_after: 1n,
          },
        },
      },
    },
  ]));
  assert.equal(bigScan.events[0]?.trade?.bookId, big.toString());
  assert.notEqual(bigScan.events[0]?.trade?.bookId, String(Number(big)));
  assert.equal(event.trade.price1e9, 612_345_678n);
  assert.equal(event.trade.eventIndex, 0);

  // The block's own timestamp reaches the scan, because 10 §9.2's buckets are aligned to it.
  assert.equal(scan.blockTimestampMs, 1_234 * 6_000);

  // ...and nothing else carries a fill: `local-index` refuses a payload on any other event,
  // because a number that is not `p_after` in a price series is a price the chain never had.
  const plain = scanner.scan(at(1_235), encodeEvents([
    { phase: { type: 'ApplyExtrinsic', value: 0 }, event: transfer(ALICE, BOB) },
  ]));
  assert.equal(plain.events[0]?.trade, undefined);
});
