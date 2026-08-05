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
import type { RawPayloadPresentation, SigningRequest } from '@bleavit/signing';
import { gate } from '@bleavit/transaction-builder';
import type { GatePassed, TxPreparation } from '@bleavit/transaction-builder';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const SIG64 = `0x${'ab'.repeat(64)}`;
const PAYLOAD = '0x0102030405';

/** What a transport may answer with: a signature, or a function of the presentation. */
type Respond = string | ((presentation: RawPayloadPresentation) => string | Promise<string>);

const transport = (respond: Respond) => {
  const seen: RawPayloadPresentation[] = [];
  return {
    seen,
    adapter: rawPayloadSigner({
      id: 'qr',
      label: 'Air-gapped device (QR)',
      present: async (presentation) => {
        seen.push(presentation);
        return typeof respond === 'function' ? await respond(presentation) : respond;
      },
    }),
  };
};

const PREP: TxPreparation = {
  scaleHex: PAYLOAD,
  builtFor: { specVersion: 2, metadataHash: `0x${'ab'.repeat(32)}` },
  preparedAt: { blockHash: `0x${'22'.repeat(32)}`, blockNumber: 41 },
  requires: ['P-1'],
};

/**
 * A real gate proof at block 42.
 *
 * `GatePassed`'s brand is a non-exported `unique symbol`, so it is obtained by running the
 * gate rather than written — the same discipline `fees.test.ts` follows, and the reason
 * `as unknown as` is banned workspace-wide (10 §2.1).
 */
const WINDOW: GatePassed = (() => {
  const at = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 42 };
  const outcome = gate(PREP, at, PREP.builtFor, [
    { id: 'P-1', ok: true, requirement: 'r', expected: 'e', actual: 'a', at },
  ]);
  assert.equal(outcome.kind, 'proceed', 'the gate fixture no longer opens');
  return outcome.passed;
})();

/** The nth presentation the transport received, or a throw naming how many it saw. */
const shown = (seen: readonly RawPayloadPresentation[], index = 0): RawPayloadPresentation => {
  const presentation = seen[index];
  if (presentation === undefined) throw new Error(`the transport was shown ${seen.length} presentation(s)`);
  return presentation;
};

const request = (): SigningRequest => ({ prep: PREP, window: WINDOW, account: ALICE });

test('the transport is handed exactly the prepared payload', async () => {
  // The single property the whole module exists for: no edit between presentation and
  // signature. If this drifts, the user confirms one call and signs another.
  const { adapter, seen } = transport(SIG64);
  await adapter.sign(request());
  assert.equal(seen.length, 1);
  assert.equal(shown(seen).payloadHex, PAYLOAD);
  assert.equal(shown(seen).account, ALICE);
  assert.equal(shown(seen).atBlock, 42);
});

test('the presentation states the 256-block era, not the in-app 64', async () => {
  // A longer replay window is worth putting in front of someone rather than leaving
  // implicit — it is the price of the air gap.
  const { adapter, seen } = transport(SIG64);
  await adapter.sign(request());
  assert.equal(shown(seen).mortalityBlocks, RAW_EXTERNAL_ERA_BLOCKS);
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

test('metadata-hash stays refused — and the reason is now verified, not pending', async () => {
  // Was "FE-P6 is unresolved, assume nothing". SQ-594/V-122 settled the load-bearing half by
  // reading the pinned `frame-metadata-hash-extension`: the digest comes from a compile-time
  // env var this runtime's build never sets, so mode 1 is rejected `CannotLookup` ON CHAIN.
  // Granting the capability would build transactions the chain is guaranteed to refuse, and
  // the user would meet that failure after signing on a hardware wallet. Milestone B21.
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
  const listed = registry.list()[0];
  assert.ok(listed, 'the registry lists nothing after a register()');
  assert.equal(listed.label, 'Air-gapped device (QR)');
  assert.equal(registry.supporting('metadata-hash').length, 0);
});
