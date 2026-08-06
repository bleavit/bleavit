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
    () => scanner.scan(100, '0xdeadbeef'),
    (error) => {
      assert.ok(error instanceof BlockScanError);
      assert.equal(error.blockNumber, 100);
      assert.match(error.message, /Refusing rather than recording an empty scan/);
      return true;
    },
  );

  // Not vacuous: a well-formed blob at the same call site scans.
  const scan = scanner.scan(100, encodeEvents([{ phase: { type: 'ApplyExtrinsic', value: 0 }, event: transfer(ALICE, BOB) }]));
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
    () => stubbed.scan(7, '0x00'),
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
  assert.throws(() => stubbed.scan(7, '0x00'), /ApplyExtrinsic with a non-index value/);
});

test('the scan feeds `needsBodyFetch`, and the accounts match a set built the same way', () => {
  // V-164 end to end. PAPI renders accounts in THIS chain's SS58 prefix (22622), so a watched
  // set in any other rendering matches nothing ever — presenting as an empty transaction
  // history with no error anywhere. `watchedAccounts` is the same conversion the scanner
  // emits, which is what makes `watched.has(account)` a comparison of like with like.
  const eventsHex = encodeEvents([
    { phase: { type: 'Initialization' }, event: success() },
    { phase: { type: 'ApplyExtrinsic', value: 0 }, event: success() },
    { phase: { type: 'ApplyExtrinsic', value: 1 }, event: transfer(ALICE, BOB) },
    { phase: { type: 'ApplyExtrinsic', value: 1 }, event: success() },
  ]);
  const scan = scanner.scan(512, eventsHex);
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
  const scan = scanner.scan(1, recordedEventsValue());
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
  assert.equal(scanner.scan(9, eventsHex).extrinsicCount, undefined);
  assert.equal(scanner.scan(9, eventsHex, 12).extrinsicCount, 12);

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
