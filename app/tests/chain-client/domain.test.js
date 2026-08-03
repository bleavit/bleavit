/**
 * The 10 §11 two-domain rules, checked against the **real** boundary the chain publishes.
 *
 * The boundary comes from `app/fixtures/chainhead/constant.ledger.service_id_base.json` —
 * F2's recording of the `ConditionalLedger::ServiceIdBase` metadata constant — rather
 * than from `1n << 63n` written here. That is the same no-hardcode rule 10 §5.4 applies
 * to every other chain value, and it is why contract v23 gave the boundary a metadata
 * home at all: a suite that spelled the literal would keep passing after the chain moved
 * it, which is precisely the drift the metadata home exists to expose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  CrossDomainTotalError,
  DomainBoundaryError,
  attachDomain,
  domainBoundaryFrom,
  domainOf,
  isDomainAgnosticCall,
  ledgerPalletFor,
  partitionByDomain,
  positionSourceFor,
  totalWithinDomain,
} from '@bleavit/chain-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '..', '..', 'fixtures', 'chainhead', 'constant.ledger.service_id_base.json');

/** Read the constant exactly as a client would: from metadata, little-endian. */
function serviceIdBaseFromMetadata() {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const presence = fixture.requests.find((r) => r.method === 'metadata_presence');
  assert.ok(presence, 'the recording carries no metadata_presence for ServiceIdBase');
  assert.equal(presence.response.present, true, 'ServiceIdBase absent from metadata');
  const hex = presence.response.layout.value;
  const bytes = hex.slice(2).match(/../g) ?? [];
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(parseInt(bytes[i], 16));
  return value;
}

const SERVICE_ID_BASE = serviceIdBaseFromMetadata();
const boundary = domainBoundaryFrom(SERVICE_ID_BASE);

test('the boundary the chain publishes is 2^63 (02 §9, 16 §7.1)', () => {
  // Asserted against the spec's stated value — the fixture supplies it, this checks it.
  assert.equal(SERVICE_ID_BASE, 1n << 63n);
});

test('domain is a total function of the id, at and around the boundary', () => {
  assert.equal(domainOf(0n, boundary), 'primary');
  assert.equal(domainOf(SERVICE_ID_BASE - 1n, boundary), 'primary');
  assert.equal(domainOf(SERVICE_ID_BASE, boundary), 'service', 'the base itself is the first service id');
  assert.equal(domainOf(SERVICE_ID_BASE + 1n, boundary), 'service');
  assert.equal(domainOf((1n << 64n) - 1n, boundary), 'service');
  assert.throws(() => domainOf(-1n, boundary), DomainBoundaryError);
});

test('a missing or nonsensical constant fails closed rather than defaulting', () => {
  // Defaulting to 2^63 would label every hosted position as a governance one the moment
  // the constant went missing — the exact error 11 §11.2a exists to prevent.
  assert.throws(() => domainBoundaryFrom(undefined), DomainBoundaryError);
  assert.throws(() => domainBoundaryFrom(0n), DomainBoundaryError);
  assert.throws(() => domainBoundaryFrom(-1n), DomainBoundaryError);
});

test('writes route to two pallets, with no default (11 §11.2a rule 5)', () => {
  assert.equal(ledgerPalletFor('primary'), 'ConditionalLedger');
  assert.equal(ledgerPalletFor('service'), 'ServiceLedger');
  assert.throws(() => ledgerPalletFor('either'), DomainBoundaryError);
  // Only the market calls are domain-agnostic, because the market pallet routes internally.
  assert.equal(isDomainAgnosticCall('market.buy'), true);
  assert.equal(isDomainAgnosticCall('market.sell'), true);
  for (const call of ['ledger.split', 'ledger.merge', 'ledger.redeem', 'ledger.transfer']) {
    assert.equal(isDomainAgnosticCall(call), false, `${call} must be addressed to an instance`);
  }
});

test('no selector may produce a cross-domain total (10 §11 rule 3)', () => {
  const rows = [
    attachDomain(1n, 100n, boundary),
    attachDomain(2n, 200n, boundary),
  ];
  assert.deepEqual(totalWithinDomain(rows), { domain: 'primary', total: 300n });

  const mixed = [...rows, attachDomain(SERVICE_ID_BASE + 5n, 900n, boundary)];
  // The refusal is the feature: a merged figure asserts a backing pool that does not
  // exist, and on screen it looks like a larger correct number.
  assert.throws(() => totalWithinDomain(mixed), CrossDomainTotalError);
  assert.equal(totalWithinDomain([]), undefined);
});

test('both domains render, partitioned, never merged', () => {
  const rows = [
    attachDomain(7n, 'gov', boundary),
    attachDomain(SERVICE_ID_BASE, 'hosted-a', boundary),
    attachDomain(SERVICE_ID_BASE + 1n, 'hosted-b', boundary),
  ];
  const split = partitionByDomain(rows);
  assert.deepEqual(split.primary, ['gov']);
  assert.deepEqual(split.service, ['hosted-a', 'hosted-b']);
  assert.equal(split.primary.length + split.service.length, rows.length, 'partition must be total');
});

test('the FE-P2 cross-check is per domain, view and prefix inseparable (10 §11)', () => {
  // Satisfying one domain's view with the other's keys makes the check vacuous in
  // exactly the case it exists for, so these are returned together.
  assert.deepEqual(positionSourceFor('primary'), {
    api: 'account_positions',
    storagePallet: 'ConditionalLedger',
  });
  assert.deepEqual(positionSourceFor('service'), {
    api: 'service_positions',
    storagePallet: 'ServiceLedger',
  });
});

test('the two position views are distinct surfaces in the recorded feed', () => {
  // Anti-vacuity for the rule above: if the chain only served one view, every
  // per-domain assertion here would be describing a distinction that does not exist.
  const dir = resolve(HERE, '..', '..', 'fixtures', 'chainhead');
  for (const surface of ['api.account_positions', 'api.service_positions']) {
    const fixture = JSON.parse(readFileSync(resolve(dir, `${surface}.json`), 'utf8'));
    const presence = fixture.requests.find((r) => r.method === 'metadata_presence');
    assert.equal(presence.response.present, true, `${surface} absent from the runtime`);
  }
  for (const surface of ['storage.ledger.positions', 'storage.service_ledger.positions']) {
    const fixture = JSON.parse(readFileSync(resolve(dir, `${surface}.json`), 'utf8'));
    assert.equal(fixture.surface, surface);
  }
});
