/**
 * §8.4's spot re-derivation, produced rather than declared — 10 §8.4, 14 TH-50. F9.
 *
 * ## What was missing, precisely
 *
 * `spot-check.test.ts` proves the pass: which blocks it asks about, where it stops, what it does
 * with `out-of-reach`, and that a disagreement becomes `FE-PROV-003`. Every one of its cases
 * supplies a **synthetic `SnapshotSpotCheck` closure** — a function that answers `disagrees`
 * because the test told it to. What that certifies is the importer's behaviour *given verdicts*.
 *
 * The gated property is that chain state **produces** them. §8.4's re-derivation is a named
 * TH-50 mitigation, and until 2026-08-06 nothing in the repository turned a block's movements
 * into a `SpotVerdict` — every caller was a closure in a suite — so the mitigation could not have
 * reached a chain and no test would have noticed. This is the snapshot half of the finding
 * `chainRowCheck` and `lying-indexer.test.ts` closed for the sampler.
 *
 * ## Driven from the recorded transcripts, in the same shape as the sampler suite
 *
 * `@bleavit/mock-runtime` replays the deterministic chainHead-v1 transcripts recorded against a
 * booted release node (02 §11 row 4). The reader below issues the **real recorded**
 * `chainHead_v1_storage` read of `System.Events` at the pinned block, through the mock — which
 * refuses a request it was never taught, so a suite that drifted onto data the recording does not
 * carry fails loudly rather than comparing a value against itself.
 *
 * ## What the recording can and cannot supply, stated rather than implied
 *
 * The corpus is **one pinned block**, and its `System.Events` value is two `System.ExtrinsicSuccess`
 * records carrying no ledger movement at all (the same fact `tests/chain-client` establishes from
 * the other side). So the recording supplies exactly one real chain answer: *nothing happened here*.
 * That is enough for the direction that matters most and is the cheapest to get wrong — a
 * publisher **fabricating** a movement at a block this device can read — and it is the direction
 * `admitSnapshot` is structurally unable to catch, because a fabricated movement with matching
 * balances is internally consistent.
 *
 * The opposite direction (the chain has movements the document **deleted**) cannot be driven from
 * this corpus, since no recorded block has any. It is covered below over synthetic observations,
 * which is honest about what each case proves rather than implying the recording did more.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  SNAPSHOT_FORMAT,
  chainSpotCheck,
  importSnapshotStream,
  projectOp,
  serializeSnapshot,
  snapshotPreimage,
  spotCheckSnapshot,
} from '@bleavit/providers';
import type {
  BlockMovementRead,
  ImportRequest,
  Provider,
  SnapshotChunk,
  SnapshotDocument,
  SnapshotOp,
} from '@bleavit/providers';
import { createFixtureBundle, createMockRuntime } from '@bleavit/mock-runtime';
import type { MockRuntime } from '@bleavit/mock-runtime';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', '..', 'fixtures', 'chainhead');

/** `System.Events` — the one storage key a block's movements are derived from (10 §6.5). */
const SYSTEM_EVENTS_KEY = '0x26aa394eea5630e07c48ae0c9558cef780d41e5e16056765bc8461851072c9d7';

const sha256 = (preimage: Uint8Array): string =>
  createHash('sha256').update(preimage).digest('hex');

const BINDING = { genesisHash: '0xfeed', specVersion: 2, contractVersion: 23 } as const;

function loadRuntime(): MockRuntime {
  const names = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));
  const report = JSON.parse(readFileSync(join(FIXTURE_DIR, 'fixtures-report.json'), 'utf8'));
  const fixtures = names
    .filter((name) => name !== 'fixtures-report.json')
    .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')));
  return createMockRuntime(createFixtureBundle(report, fixtures));
}

/**
 * The pinned block's **number**, decoded from the recorded header rather than written here.
 *
 * A `Header` is `parent_hash [32] ++ number (Compact<u32>) ++ …`, so the number is the compact
 * integer at byte 32. Only the one-byte mode is decoded, and a wider one throws: this suite must
 * fail loudly if the recording is ever re-taken at a block past 63 rather than silently comparing
 * against the wrong number.
 */
function pinnedBlockNumber(runtime: MockRuntime): number {
  const response = runtime.respond('chainHead_v1_header', [
    'subscription-1',
    runtime.pinnedBlock(),
  ]) as { direct?: { result?: string } };
  const header = response.direct?.result;
  assert.ok(typeof header === 'string', 'the transcript records the pinned block\'s header');
  const bytes = Buffer.from(header.slice(2), 'hex');
  const compact = bytes[32] ?? 0;
  assert.equal(compact & 0b11, 0, 'the recorded block number is a single-byte compact');
  return compact >> 2;
}

/**
 * The chain half: a real recorded read, replayed through the mock, mapped to movements.
 *
 * It answers for exactly one block, because the corpus pins exactly one — every other block is
 * genuinely beyond this transport's reach and says so, which is the same honest answer a light
 * client gives for depth. The recorded value is asserted, so *"this block carries no ledger
 * movement"* is a claim about the recording rather than about this function.
 */
function transcriptMovements(runtime: MockRuntime, pinned: number): BlockMovementRead {
  return async (block: number) => {
    // The corpus pins exactly one block, so the side is a comparison against it — the same fact a
    // light client reads off its own head and pinned window, and never a guess this module makes.
    if (block !== pinned) {
      return { kind: 'out-of-reach', where: block > pinned ? 'above-window' : 'below-window' };
    }
    const response = runtime.respond('chainHead_v1_storage', [
      'subscription-1',
      runtime.pinnedBlock(),
      [{ key: SYSTEM_EVENTS_KEY, type: 'value' }],
      null,
    ]) as { events?: { event: string; items?: { key: string; value?: string }[] }[] };
    let value: string | undefined;
    for (const event of response.events ?? []) {
      if (event.event !== 'operationStorageItems') continue;
      for (const item of event.items ?? []) {
        if (item.key === SYSTEM_EVENTS_KEY) value = item.value;
      }
    }
    assert.equal(
      value,
      '0x0800000000000000226cf83e5517020000000100000000002261c91900020000',
      'the recorded events at the pinned block: two ExtrinsicSuccess records, no ledger movement',
    );
    return { kind: 'movements', observed: [] };
  };
}

/** A document covering the pinned block and claiming `ops` happened in it. */
function documentOver(block: number, ops: readonly SnapshotOp[]): SnapshotDocument {
  const splits = ops.filter((op) => op.kind === 'split');
  return {
    format: SNAPSHOT_FORMAT,
    binding: { ...BINDING },
    range: { fromBlock: block, toBlock: block },
    coverage: [{ fromBlock: block, toBlock: block }],
    vaults: splits.length > 0 ? [{ vault: 'v1', branches: ['FAIL', 'PASS'] }] : [],
    ops,
    balances: splits.flatMap((op) =>
      op.kind === 'split'
        ? [
            { vault: op.vault, account: op.account, branch: 'FAIL', amount: op.amount },
            { vault: op.vault, account: op.account, branch: 'PASS', amount: op.amount },
          ]
        : [],
    ),
  };
}

const PUBLISHER: Provider = { id: 'archive-one', kind: 'snapshot', health: { kind: 'healthy' } };

function requestFor(document: SnapshotDocument): ImportRequest {
  return {
    provider: PUBLISHER,
    admission: { expectedPin: sha256(snapshotPreimage(document)), binding: { ...BINDING } },
    sha256,
    maxInputBytes: 1_000_000,
    budgetBytes: 10_000_000,
    footprint: [],
    importedAt: 1_700_000_000_000,
  };
}

async function* streamOf(text: string): AsyncIterable<SnapshotChunk> {
  yield { text, bytes: new TextEncoder().encode(text).length };
}

// ------------------------------------------------------- driven by the recorded transcripts

test('the corpus really answers for the block this suite checks — anti-vacuity', () => {
  // Without this, every case below could pass by the reader never reaching the mock at all.
  const runtime = loadRuntime();
  const pinned = pinnedBlockNumber(runtime);
  assert.equal(pinned, 1, 'the recorded header pins block 1');
  const items = runtime.respond('chainHead_v1_storage', [
    'subscription-1',
    runtime.pinnedBlock(),
    [{ key: SYSTEM_EVENTS_KEY, type: 'value' }],
    null,
  ]);
  assert.ok(items !== undefined);
  // And the mock refuses what it was never taught, so a drifting suite fails rather than passing.
  assert.throws(() =>
    runtime.respond('chainHead_v1_storage', [
      'subscription-1',
      '0xnot-a-recorded-block',
      [{ key: SYSTEM_EVENTS_KEY, type: 'value' }],
      null,
    ]),
  );
});

test('an HONEST snapshot of the recorded block is re-derived clean', async () => {
  // The positive control for the fabrication case below: a checker that disagreed with everything
  // would look identical to one that works.
  const runtime = loadRuntime();
  const pinned = pinnedBlockNumber(runtime);
  const document = documentOver(pinned, []);
  const report = await spotCheckSnapshot(
    document,
    chainSpotCheck(transcriptMovements(runtime, pinned)),
  );
  assert.deepEqual(report.findings, []);
  assert.equal(report.compared, 1, 'a clean report that compared nothing proves nothing');
});

test('a FABRICATED movement at the recorded block is caught, and disables the publisher', async () => {
  // The gated property, with no synthetic verdict in it: the document claims a movement, the
  // adapter re-derives the recorded block's events, and the disagreement is produced.
  //
  // And the second half — §8.4 binds `FE-PROV-002` to *"any mismatch against chain state"*, and
  // §8.3 makes auto-disable the response. Before 2026-08-06 the importer rejected the file and
  // never touched `Provider.health`, so a publisher caught contradicting the chain kept serving
  // every other screen.
  const runtime = loadRuntime();
  const pinned = pinnedBlockNumber(runtime);
  const forged = documentOver(pinned, [
    { kind: 'split', block: pinned, vault: 'v1', account: 'mallory', amount: '1000' },
  ]);
  const outcome = await importSnapshotStream(streamOf(serializeSnapshot(forged)), requestFor(forged), {
    spotCheck: chainSpotCheck(transcriptMovements(runtime, pinned)),
    confirmEviction: async () => {
      throw new Error('a rejected snapshot must never reach the eviction preview');
    },
  });

  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind !== 'rejected') return;
  assert.equal(outcome.refusal.code, 'FE-PROV-003');
  assert.match(outcome.refusal.detail, /re-derived part of the snapshot from the chain/);
  assert.deepEqual([...new Set(outcome.findings.map((finding) => finding.screen))], ['spot-check']);

  assert.equal(outcome.provider.health.kind, 'disabled');
  if (outcome.provider.health.kind !== 'disabled') return;
  assert.equal(outcome.provider.health.by, 'auto');
  assert.match(outcome.provider.health.reason, /blocks this device re-derived from the chain/);
  assert.equal(outcome.disabled?.code, 'FE-PROV-002');
});

test('a file-integrity refusal does NOT disable the publisher', async () => {
  // The distinction the auto-disable rests on: a damaged download, a snapshot of another chain
  // and an unfinished check are statements about the file or about this device. Only a
  // disagreement is evidence about the publisher, and disabling on the others would take honest
  // sources offline for a truncated download.
  const runtime = loadRuntime();
  const pinned = pinnedBlockNumber(runtime);
  const document = documentOver(pinned, []);
  const outcome = await importSnapshotStream(
    streamOf(serializeSnapshot(document)),
    { ...requestFor(document), admission: { expectedPin: 'not-the-pin', binding: { ...BINDING } } },
    {
      spotCheck: chainSpotCheck(transcriptMovements(runtime, pinned)),
      confirmEviction: async () => true,
    },
  );
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind !== 'rejected') return;
  assert.equal(outcome.refusal.code, 'FE-PROV-003');
  assert.deepEqual(outcome.provider, PUBLISHER, 'untouched');
  assert.equal(outcome.disabled, undefined);
});

// ------------------------------------------------- the derivation itself, over observations

const MOVEMENT = (block: number, account: string, amount: string): SnapshotOp => ({
  kind: 'split',
  block,
  vault: 'v1',
  account,
  amount,
});

test('the derived list is put in CHAIN order — block, then extrinsic, then event', async () => {
  // §8.2's rule, and the half `bleavit.snapshot.v1` cannot express (SQ-615): the file carries only
  // the block. The chain side carries both indices, so within a reachable block the document's
  // order must match the chain's — which makes this comparison strictly stronger than any file
  // screen. A reader returning events in whatever order a decoder walked them would otherwise
  // make an honest document look reordered.
  const check = chainSpotCheck(async () => ({
    kind: 'movements',
    observed: [
      { extrinsicIndex: 2, eventIndex: 0, op: MOVEMENT(10, 'carol', '3') },
      { extrinsicIndex: 0, eventIndex: 1, op: MOVEMENT(10, 'alice', '1') },
      { extrinsicIndex: 1, eventIndex: 0, op: MOVEMENT(10, 'bob', '2') },
    ],
  }));
  const ordered = ['alice', 'bob', 'carol'].map((who, at) =>
    projectOp(MOVEMENT(10, who, String(at + 1))),
  );
  assert.deepEqual(await check({ block: 10, movements: ordered }), { kind: 'agrees' });
  // And the reverse order is a disagreement rather than a set comparison that shrugs.
  const verdict = await check({ block: 10, movements: [...ordered].reverse() });
  assert.equal(verdict.kind, 'disagrees');
});

test('a DELETED movement is caught, not only a fabricated one', async () => {
  // The cheaper forgery: dropping a `redeem` produces a document that replays, reconciles and
  // pins perfectly while overstating a holder's balance forever. It is caught because the claim
  // carries the block's whole movement list and the comparison is on length as well as content.
  const check = chainSpotCheck(async () => ({
    kind: 'movements',
    observed: [
      { extrinsicIndex: 0, eventIndex: 0, op: MOVEMENT(10, 'alice', '1') },
      { extrinsicIndex: 1, eventIndex: 0, op: MOVEMENT(10, 'bob', '2') },
    ],
  }));
  const verdict = await check({ block: 10, movements: [projectOp(MOVEMENT(10, 'alice', '1'))] });
  assert.equal(verdict.kind, 'disagrees');
  if (verdict.kind !== 'disagrees') return;
  assert.equal(verdict.derived.length, 2, 'the verdict names what THIS DEVICE read');
});

test('an EMPTY claim about a block the chain says is empty agrees', async () => {
  const check = chainSpotCheck(async () => ({ kind: 'movements', observed: [] }));
  assert.deepEqual(await check({ block: 10, movements: [] }), { kind: 'agrees' });
});

test('out-of-reach passes through untouched — it is evidence of nothing', async () => {
  // Both sides, and the side is **carried** rather than re-decided: this adapter holds no head and
  // no pinned window, so any rule it applied would be a guess dressed as a derivation — and it is
  // exactly that guess, one layer up, that refused a valid deep-history snapshot.
  for (const where of ['above-window', 'below-window'] as const) {
    const check = chainSpotCheck(async () => ({ kind: 'out-of-reach', where }));
    assert.deepEqual(await check({ block: 10, movements: [] }), { kind: 'out-of-reach', where });
  }
});

test('an out-of-enum SIDE is rejected here, exactly as its two neighbours are', async () => {
  // The one field the whole repair turns on, and the only one at this boundary that was trusted:
  // the extrinsic and event indices below are hardened at runtime and `where` was not. An
  // unrecognised value reads as `above-window` at every consumer testing for `below-window`,
  // which descends the whole document, spends the ceiling and admits it having compared nothing —
  // a silent misread ending in **admission**, which is the direction R-7 does not allow.
  const check = chainSpotCheck(async () => ({
    kind: 'out-of-reach',
    where: 'sideways' as 'below-window',
  }));
  await assert.rejects(
    () => check({ block: 10, movements: [] }),
    /neither "above-window" nor "below-window"/,
  );
});

test('two observations at one chain position throw — no tie-break here can be right', async () => {
  // One chain position holds one event. `app/tools/snapshot` refuses the identical shape on the
  // producing side, and the replay is order-sensitive, so guessing which came first is guessing
  // which history is true.
  const check = chainSpotCheck(async () => ({
    kind: 'movements',
    observed: [
      { extrinsicIndex: 1, eventIndex: 4, op: MOVEMENT(10, 'alice', '1') },
      { extrinsicIndex: 1, eventIndex: 4, op: MOVEMENT(10, 'bob', '2') },
    ],
  }));
  await assert.rejects(() => check({ block: 10, movements: [] }), /one chain position holds one/);
});

test('an observation about another block throws rather than being compared', async () => {
  // This device's own defect. The projection includes the block number, so comparing it silently
  // would surface as a disagreement blamed on the publisher.
  const check = chainSpotCheck(async () => ({
    kind: 'movements',
    observed: [{ extrinsicIndex: 0, eventIndex: 0, op: MOVEMENT(11, 'alice', '1') }],
  }));
  await assert.rejects(() => check({ block: 10, movements: [] }), /these disagree/);
});

test('a negative or fractional position throws — a position is a position', async () => {
  const check = chainSpotCheck(async () => ({
    kind: 'movements',
    observed: [{ extrinsicIndex: -1, eventIndex: 0, op: MOVEMENT(10, 'alice', '1') }],
  }));
  await assert.rejects(() => check({ block: 10, movements: [] }), /non-negative integer/);
});

test('a reader that throws aborts the pass — the pass is this device, not the publisher', async () => {
  const check = chainSpotCheck(async () => {
    throw new Error('the light client is not started');
  });
  await assert.rejects(
    () => spotCheckSnapshot(documentOver(1, []), check),
    /light client is not started/,
  );
});
