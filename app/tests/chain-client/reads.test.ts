/**
 * The finalized-only read layer — 10 §2.2, §4.1, §4.2, §11.
 *
 * Driven through the **real** `ChainHeadConnection` over F2's recorded transcripts, not
 * through a bespoke adapter written for this suite. That distinction earned itself: the
 * bespoke adapter this file used to carry satisfied a synchronous interface no smoldot
 * transport can implement (V-83) and let the transport choose the block a read was
 * labelled with (V-84). A test double built to match an interface will always match it —
 * which is why the double here is a *provider*, at the wire, and the transport under it
 * is production code.
 *
 * Everything asserted below is a **refusal**, and refusals rot unnoticed in a suite that
 * runs rarely, so this runs per commit with no node and no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ChainHeadConnection,
  FinalizedReader,
  UnverifiedReadError,
  domainBoundaryFrom,
  positionSourceFor,
  providerRead,
} from '@bleavit/chain-client';
import type { ChainHeadTransport, LedgerDomain } from '@bleavit/chain-client';
import { createMockRuntime } from '@bleavit/mock-runtime';
import type { HexString } from '@bleavit/shared-types';

import { argsFor, bundle, keyFor, recordedProvider } from './recorded-provider.ts';

/** The chain identity every verified fixture in this file is read against (F18).
 *  A named constant rather than a literal per site: the point of the field is that two
 *  reads agree on it, and copies of a hex string agree until one is edited. */
const TEST_CHAIN = `0x${'ce'.repeat(32)}` as HexString;


const fixtures = bundle();

async function reader() {
  const { provider } = recordedProvider(createMockRuntime(fixtures));
  return FinalizedReader.open(await ChainHeadConnection.open(provider, { chain: TEST_CHAIN }));
}

test('a storage read yields Finalized<T> pinned to the reader block', async () => {
  const r = await reader();
  const { key, type } = keyFor(fixtures, 'storage.epoch.recent_cohort_summaries');
  const read = await r.storage(key, type);
  assert.equal(read.status.kind, 'verified-finalized');
  assert.equal(read.status.blockHash, r.at.blockHash);
  assert.ok(Array.isArray(read.value));
});

test('a runtime-API result is finalized at the same block', async () => {
  const r = await reader();
  const read = await r.call('FutarchyApi_epoch_status');
  assert.equal(read.status.kind, 'verified-finalized');
  assert.match(read.value, /^0x[0-9a-f]+$/);
  assert.equal(read.status.blockHash, r.at.blockHash);
});

test('the FE-P2 cross-check pairs each domain view with its OWN prefix (10 §11)', async () => {
  const r = await reader();
  // `as const satisfies` rather than a bare literal: the loop feeds `positionSourceFor`,
  // so a mistyped domain would otherwise be a plain string and fail at runtime instead of
  // being checked against the union the two ledgers actually publish.
  for (const domain of ['primary', 'service'] as const satisfies readonly LedgerDomain[]) {
    const source = positionSourceFor(domain);
    const prefix = keyFor(
      fixtures,
      domain === 'service' ? 'storage.service_ledger.positions' : 'storage.ledger.positions',
    );
    const read = await r.crossCheckedCall({
      api: source.api,
      storagePrefix: prefix.key,
      argsHex: argsFor(fixtures, `api.${source.api}`),
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

test('both legs of the cross-check are issued at the same block', async () => {
  // A cross-check whose halves came from different blocks is worse than no check at all:
  // disagreement would be expected, so agreement would prove nothing.
  //
  // The head is moved **between the two legs**, which is the only arrangement that can
  // detect the defect. An earlier version of this test let the head sit still, so a
  // witness leg that re-read "the current head" agreed with the call leg by coincidence
  // and the assertion passed on a broken implementation — a vacuous test that looked like
  // a real one (caught by mutation R1).
  const moved: HexString = `0x${'ab'.repeat(32)}`;
  let calls = 0;
  const { provider, sent, state } = recordedProvider(createMockRuntime(fixtures), {
    intercept(request) {
      if (request.method === 'chainHead_v1_call') {
        calls += 1;
        queueMicrotask(() =>
          state.followEvent({ event: 'finalized', finalizedBlockHashes: [moved] }),
        );
      }
      return false;
    },
  });
  const r = await FinalizedReader.open(await ChainHeadConnection.open(provider, { chain: TEST_CHAIN }));
  const source = positionSourceFor('primary');
  await r.crossCheckedCall({
    api: source.api,
    storagePrefix: keyFor(fixtures, 'storage.ledger.positions').key,
    argsHex: argsFor(fixtures, `api.${source.api}`),
  });

  assert.equal(calls, 1, 'the call leg never ran, so the head never moved');
  const blocks = new Set(
    sent
      .filter((s) => s.method === 'chainHead_v1_call' || s.method === 'chainHead_v1_storage')
      .map((s) => s.params[1]),
  );
  assert.deepEqual([...blocks], [r.at.blockHash]);
  assert.notEqual(r.at.blockHash, moved);
});

test('a malformed pin is refused when the reader is opened', async () => {
  // Annotated so the shape is checked against the real port; `0xdead` is still a
  // well-formed `0x…` string, and the malformation under test is its *length*, which
  // only the runtime check can see.
  const transport: ChainHeadTransport = {
    pinnedBlock: async () => ({ chain: TEST_CHAIN, blockHash: '0xdead', blockNumber: 1 }),
    storage: async () => [],
    call: async () => '0x',
    // No runtime established. Required by the port rather than optional, so a double has to
    // say so — `undefined` here is the honest answer for a transport nothing followed.
    finalizedRuntime: () => undefined,
  };
  await assert.rejects(() => FinalizedReader.open(transport), UnverifiedReadError);
});

test('attaching a domain refuses a value from a different block', async () => {
  const r = await reader();
  const boundary = domainBoundaryFrom(1n << 63n);
  const good = await r.storage(keyFor(fixtures, 'storage.ledger.positions').key, 'descendantsValues');
  assert.equal(r.domained(1n, good, boundary).value.domain, 'primary');
  assert.equal(r.domained(1n << 63n, good, boundary).value.domain, 'service');

  const otherBlock: HexString = `0x${'cd'.repeat(32)}`;
  const foreign = { ...good, status: { ...good.status, blockHash: otherBlock } };
  assert.throws(() => r.domained(1n, foreign, boundary), UnverifiedReadError);
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

test('the reader offers no archive-depth read (10 §4.2)', async () => {
  // There are no `archive_*` methods in smoldot@3.3.2 — that half of §4.2 is confirmed.
  // The other half, "smoldot exposes the chainHead group only", was RETRACTED when FE-P5
  // resolved (2026-08-07): the legacy group is present, and `state_getMetadata`/`state_call`
  // accept any hash at unbounded depth. What actually bounds depth is hash acquisition — a
  // light client cannot verify a full node's height→hash answer, so `chain_getBlockHash`
  // returns null for every height but genesis and best.
  //
  // The assertion is unchanged and still correct on the corrected grounds: a read API that
  // offered depth would have to fall back to a provider to honour it, which is exactly the
  // promotion path §2.2 deleted.
  const r = await reader();
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(r));
  assert.deepEqual(
    methods.filter((m) => /archive|history|at\b|depth/i.test(m) && m !== 'at').sort(),
    [],
    'the reader grew a depth-taking read',
  );
});
