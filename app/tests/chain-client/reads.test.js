/**
 * The finalized-only read layer — 10 §2.2, §4.1, §4.2, §11.
 *
 * Driven by F2's `packages/mock-runtime` over the recorded chainHead transcripts, so this
 * runs per commit with no node and no network. That is not a convenience: the properties
 * being checked here are about what the reader *refuses*, and a suite that needed a live
 * chain would be run rarely enough that the refusals could rot unnoticed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createFixtureBundle, createMockRuntime } from '@bleavit/mock-runtime';
import {
  FinalizedReader,
  UnverifiedReadError,
  domainBoundaryFrom,
  positionSourceFor,
  providerRead,
} from '@bleavit/chain-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', '..', 'fixtures', 'chainhead');

function bundle() {
  const names = readdirSync(FIXTURE_DIR).filter((n) => n.endsWith('.json') && n !== 'fixtures-report.json');
  const report = JSON.parse(readFileSync(join(FIXTURE_DIR, 'fixtures-report.json'), 'utf8'));
  return createFixtureBundle(report, names.map((n) => JSON.parse(readFileSync(join(FIXTURE_DIR, n), 'utf8'))));
}

/** Adapt the recorded transcripts to the transport interface. */
function transportFrom(runtime, overridePin) {
  return {
    pinnedBlock: () => overridePin?.() ?? { blockHash: runtime.pinnedBlock(), blockNumber: 1 },
    storage(key, type) {
      const response = runtime.respond('chainHead_v1_storage', [
        'subscription-1', runtime.pinnedBlock(), [{ key, type }], null,
      ]);
      const items = [];
      for (const event of response.events ?? []) {
        if (event.event === 'operationStorageItems') items.push(...(event.items ?? []));
      }
      return items;
    },
    call(api, argsHex = '0x') {
      const response = runtime.respond('chainHead_v1_call', [
        'subscription-1', runtime.pinnedBlock(), api, argsHex,
      ]);
      for (const event of response.events ?? []) {
        if (event.event === 'operationCallDone') return event.output;
      }
      throw new Error(`${api} produced no result in the recorded transcript`);
    },
  };
}

const fixtures = bundle();

/** The storage key a recorded surface reads, taken from the transcript itself. */
function keyFor(surface) {
  const request = fixtures.fixtures.get(surface).requests.find((r) => r.method === 'chainHead_v1_storage');
  return request.params[2][0];
}

test('a storage read yields Finalized<T> pinned to the reader block', () => {
  const reader = new FinalizedReader(transportFrom(createMockRuntime(fixtures)));
  const { key, type } = keyFor('storage.epoch.recent_cohort_summaries');
  const read = reader.storage(key, type);
  assert.equal(read.status.kind, 'verified-finalized');
  assert.equal(read.status.blockHash, reader.at.blockHash);
  assert.ok(Array.isArray(read.value));
});

test('a runtime-API result is finalized at the same block', () => {
  const reader = new FinalizedReader(transportFrom(createMockRuntime(fixtures)));
  const read = reader.call('FutarchyApi_epoch_status');
  assert.equal(read.status.kind, 'verified-finalized');
  assert.match(read.value, /^0x[0-9a-f]+$/);
  assert.equal(read.status.blockHash, reader.at.blockHash);
});

/** The argument a recorded runtime-API call was made with, from the transcript itself. */
function argsFor(surface) {
  const request = fixtures.fixtures.get(surface).requests.find((r) => r.method === 'chainHead_v1_call');
  return request.params[3];
}

test('the FE-P2 cross-check pairs each domain view with its OWN prefix (10 §11)', () => {
  const reader = new FinalizedReader(transportFrom(createMockRuntime(fixtures)));
  for (const domain of ['primary', 'service']) {
    const source = positionSourceFor(domain);
    const prefix = keyFor(domain === 'service' ? 'storage.service_ledger.positions' : 'storage.ledger.positions');
    const read = reader.crossCheckedCall({
      api: source.api,
      storagePrefix: prefix.key,
      argsHex: argsFor(`api.${source.api}`),
    });
    assert.equal(read.status.kind, 'verified-finalized');
    assert.match(read.value.result, /^0x[0-9a-f]*$/);
    assert.ok(Array.isArray(read.value.witness));
  }
  // The pairing itself: satisfying one domain's view with the other's keys would make
  // the check vacuous in exactly the case it exists for.
  assert.notEqual(positionSourceFor('primary').storagePallet, positionSourceFor('service').storagePallet);
  assert.notEqual(positionSourceFor('primary').api, positionSourceFor('service').api);
});

test('a reader refuses to serve reads after the transport re-pins (INV-FE-2)', () => {
  const runtime = createMockRuntime(fixtures);
  let moved = false;
  const transport = transportFrom(runtime, () =>
    moved
      ? { blockHash: `0x${'ab'.repeat(32)}`, blockNumber: 99 }
      : { blockHash: runtime.pinnedBlock(), blockNumber: 1 },
  );
  const reader = new FinalizedReader(transport);
  const { key, type } = keyFor('storage.constitution.phase_flags');
  reader.storage(key, type); // fine while the pin holds
  moved = true;
  // A set of values from different blocks is not a consistent view: each individually
  // verified, the combination fictional.
  assert.throws(() => reader.storage(key, type), UnverifiedReadError);
  assert.throws(() => reader.call('FutarchyApi_epoch_status'), UnverifiedReadError);
});

test('a malformed pin is refused at construction', () => {
  const runtime = createMockRuntime(fixtures);
  const transport = transportFrom(runtime, () => ({ blockHash: '0xdead', blockNumber: 1 }));
  assert.throws(() => new FinalizedReader(transport), UnverifiedReadError);
});

test('attaching a domain refuses a value from a different block', () => {
  const reader = new FinalizedReader(transportFrom(createMockRuntime(fixtures)));
  const boundary = domainBoundaryFrom(1n << 63n);
  const good = reader.storage(keyFor('storage.ledger.positions').key, 'descendantsValues');
  assert.equal(reader.domained(1n, good, boundary).value.domain, 'primary');
  assert.equal(reader.domained(1n << 63n, good, boundary).value.domain, 'service');

  const foreign = { ...good, status: { ...good.status, blockHash: `0x${'cd'.repeat(32)}` } };
  assert.throws(() => reader.domained(1n, foreign, boundary), UnverifiedReadError);
});

test('there is no path from a provider read to Finalized<T> (10 §2.2)', () => {
  // The never-promote rule is enforced by *absence*: no function in the package accepts
  // a ProviderRead and returns a Finalized. Hash equality authenticates the header, not
  // the storage values under it.
  const read = providerRead(42n, 'operator-1', true);
  assert.equal(read.status.kind, 'provider');
  // The type-level half is pinned by tests/firewall/fixtures/forged-finalized.ts and
  // predicate-cannot-launder-finalized.ts; this asserts the runtime shape stays labelled.
  assert.equal('blockHash' in read.status, false, 'a provider read must carry no block reference');
});

test('the reader offers no archive-depth read (10 §4.2)', () => {
  // smoldot exposes the chainHead group only; there are no `archive_*` methods. A read
  // API that offered depth would have to fall back to a provider to honour it, which is
  // exactly the promotion path §2.2 deleted.
  const reader = new FinalizedReader(transportFrom(createMockRuntime(fixtures)));
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(reader));
  assert.deepEqual(
    methods.filter((m) => /archive|history|at\b|depth/i.test(m) && m !== 'at').sort(),
    [],
    'the reader grew a depth-taking read',
  );
});
