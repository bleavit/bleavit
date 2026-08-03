/**
 * The raw-payload (air-gapped / hardware) signer — 11 §11.3.
 *
 * Everything asserted here is a refusal or an identity. The adapter's job is that the
 * bytes presented are the bytes signed, and that a scan which returned something other
 * than a signature never becomes one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RAW_EXTERNAL_ERA_BLOCKS,
  RAW_PAYLOAD_DESCRIPTOR,
  RawSignatureError,
  SignerCapabilityError,
  SignerRegistry,
  rawPayloadSigner,
  requireCapability,
} from '@bleavit/signing';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const SIG64 = `0x${'ab'.repeat(64)}`;
const PAYLOAD = '0x0102030405';

const transport = (respond) => {
  const seen = [];
  return {
    seen,
    adapter: rawPayloadSigner({
      id: 'qr',
      label: 'Air-gapped device (QR)',
      present: async (presentation) => {
        seen.push(presentation);
        return typeof respond === 'function' ? respond(presentation) : respond;
      },
    }),
  };
};

const request = () => ({
  prep: { scaleHex: PAYLOAD, call: 'market.buy' },
  window: { at: { blockHash: `0x${'11'.repeat(32)}`, blockNumber: 42 }, results: [] },
  account: ALICE,
});

test('the transport is handed exactly the prepared payload', async () => {
  // The single property the whole module exists for: no edit between presentation and
  // signature. If this drifts, the user confirms one call and signs another.
  const { adapter, seen } = transport(SIG64);
  await adapter.sign(request());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].payloadHex, PAYLOAD);
  assert.equal(seen[0].account, ALICE);
  assert.equal(seen[0].atBlock, 42);
});

test('the presentation states the 256-block era, not the in-app 64', async () => {
  // A longer replay window is worth putting in front of someone rather than leaving
  // implicit — it is the price of the air gap.
  const { adapter, seen } = transport(SIG64);
  await adapter.sign(request());
  assert.equal(seen[0].mortalityBlocks, RAW_EXTERNAL_ERA_BLOCKS);
  assert.equal(RAW_EXTERNAL_ERA_BLOCKS, 256);
});

test('a 64-byte signature is accepted, with or without 0x', async () => {
  assert.equal((await transport(SIG64).adapter.sign(request())).signatureHex, SIG64);
  assert.equal((await transport('ab'.repeat(64)).adapter.sign(request())).signatureHex, SIG64);
});

test('MultiSignature and ecdsa lengths are accepted', async () => {
  for (const bytes of [65, 66]) {
    const sig = `0x${'cd'.repeat(bytes)}`;
    assert.equal((await transport(sig).adapter.sign(request())).signatureHex, sig);
  }
});

test('an error string from a scanner is refused, not signed for', async () => {
  // The failure this exists for: a QR library that returns 'NotFoundException' on a bad
  // scan. Accepting any string would submit that as a signature and fail at the chain,
  // long after the device is back in a drawer.
  await assert.rejects(() => transport('NotFoundException').adapter.sign(request()), RawSignatureError);
  await assert.rejects(() => transport('').adapter.sign(request()), /it is empty/);
  await assert.rejects(() => transport('   ').adapter.sign(request()), /it is empty/);

  // The case that actually isolates the hex check. 'NotFoundException' above is caught by
  // the *length* rule — it has an odd character count — so deleting the hex validation
  // left every assertion above still passing. A 128-character non-hex string decodes to
  // exactly 64 "bytes" and sails through the length band, so only the hex rule can refuse
  // it, and it is the realistic shape: a scanner returning a base64 blob or a UUID run.
  await assert.rejects(
    () => transport('z'.repeat(128)).adapter.sign(request()),
    /not hexadecimal/,
  );
});

test('a wrong length is refused, on both sides of the accepted band', async () => {
  // 64 and 65-66 are the real lengths, so the discriminating cases are just outside them:
  // 63 (a truncated scan) and 67 (a frame boundary read twice). An earlier version of
  // this test asserted 65 was refused, which contradicts the adapter's own rule — the
  // MultiSignature prefix makes 65 valid.
  await assert.rejects(() => transport(`0x${'ab'.repeat(32)}`).adapter.sign(request()), /is 32 byte\(s\)/);
  await assert.rejects(() => transport(`0x${'ab'.repeat(63)}`).adapter.sign(request()), /is 63 byte\(s\)/);
  await assert.rejects(() => transport(`0x${'ab'.repeat(67)}`).adapter.sign(request()), /is 67 byte\(s\)/);
  await assert.rejects(() => transport('0xabc').adapter.sign(request()), RawSignatureError);
});

test('metadata-hash stays refused — FE-P6 is unresolved', async () => {
  // The load-bearing refusal: the device's own decode is what makes air-gapped signing
  // better than blind signing, and whether a Ledger Generic App does it for a custom
  // chain is unverified. A surface that claimed it would claim exactly that property.
  const { adapter } = transport(SIG64);
  assert.equal(adapter.descriptor.capabilities.has('metadata-hash'), false);
  assert.throws(
    () => requireCapability(adapter, 'metadata-hash', 'FE-P6 is unresolved.'),
    SignerCapabilityError,
  );
});

test('capabilities come from the flow, not from the transport', async () => {
  // A transport able to declare its own capabilities could declare metadata-hash.
  const { adapter } = transport(SIG64);
  assert.deepEqual(
    [...adapter.descriptor.capabilities].sort(),
    [...RAW_PAYLOAD_DESCRIPTOR.capabilities].sort(),
  );
});

test('the adapter is registrable and names its transport', async () => {
  const { adapter } = transport(SIG64);
  const registry = new SignerRegistry();
  registry.register(adapter);
  assert.match(adapter.descriptor.id, /:qr$/);
  assert.equal(registry.list()[0].label, 'Air-gapped device (QR)');
  assert.equal(registry.supporting('metadata-hash').length, 0);
});
