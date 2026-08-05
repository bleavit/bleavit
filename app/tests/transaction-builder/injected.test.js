/**
 * The injected (PJS extension) signer adapter — 11 §11.3.
 *
 * Driven by a fake extension, because a real one needs a browser with something installed
 * and this is where the safety properties live. The *binding* to the real
 * `polkadot-api/pjs-signer` is `pjs-binding.ts`, checked by `tsc -b` — the only check that
 * can notice a stack drift, since no test here can install an extension.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AccountNotHeldError,
  INJECTED_DESCRIPTOR,
  NoExtensionError,
  SignerRegistry,
  availableExtensions,
  connectInjected,
  describeSigner,
  grantsDecodedPayload,
  grantsExternalKeyCustody,
  grantsHashedPayload,
  requireCapability,
} from '@bleavit/signing';
import * as signingExports from '@bleavit/signing';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const signerFor = (address) => ({
  publicKey: new Uint8Array(32),
  // Deterministic and payload-derived, so a test cannot pass on a constant.
  signBytes: async (data) => Uint8Array.from([data.length & 0xff, address.charCodeAt(1) & 0xff, 0xab]),
});

function fakeApi(extensions, accounts = [ALICE]) {
  let live = accounts;
  return {
    api: {
      getInjectedExtensions: () => extensions,
      connectInjectedExtension: async (name) => ({
        name,
        getAccounts: () => live.map((address) => ({ address, polkadotSigner: signerFor(address) })),
      }),
    },
    setAccounts: (next) => { live = next; },
  };
}

const request = (account) => ({
  prep: { scaleHex: '0x0102030405', call: 'market.buy' },
  window: { at: { blockHash: `0x${'11'.repeat(32)}`, blockNumber: 7 }, results: [] },
  account,
});

test('an absent extension is named, not surfaced as a generic failure', async () => {
  const { api } = fakeApi(['talisman']);
  await assert.rejects(() => connectInjected(api, 'subwallet', 'Bleavit'), NoExtensionError);
  // The message must say what *is* there, or the user has nothing to act on.
  await assert.rejects(
    () => connectInjected(api, 'subwallet', 'Bleavit'),
    /found talisman/,
  );
});

test('no extensions at all is a normal state with its own wording', async () => {
  const { api } = fakeApi([]);
  assert.deepEqual(availableExtensions(api), []);
  await assert.rejects(() => connectInjected(api, 'talisman', 'Bleavit'), /none are installed or enabled/);
});

test('the descriptor names the extension rather than "Browser extension"', async () => {
  const descriptor = INJECTED_DESCRIPTOR('talisman');
  assert.equal(descriptor.id, 'injected:talisman');
  assert.match(descriptor.label, /talisman/);
  // A single `injected` id cannot distinguish two installed extensions.
  assert.notEqual(INJECTED_DESCRIPTOR('subwallet').id, descriptor.id);
});

test('decoded-payload is granted ONLY when the extension exposes signTx (#17)', () => {
  // **This test previously asserted the defect.** It required `decoded-payload` on a
  // descriptor built with no decode channel at all, while the adapter signed through
  // `signBytes` — so the suite certified the false claim rather than catching it. PAPI's
  // `signBytes` signs "an arbitrary payload" and may refuse extrinsic-shaped bytes; only
  // `signTx` hands the extension the metadata it needs to render the call (11 §11.3).
  const withoutDecode = INJECTED_DESCRIPTOR('talisman');
  assert.ok(withoutDecode.capabilities.has('external-key-custody'));
  assert.equal(
    withoutDecode.capabilities.has('decoded-payload'),
    false,
    'an extension that only signs raw bytes shows the user an opaque blob',
  );

  const withDecode = INJECTED_DESCRIPTOR('talisman', async () => new Uint8Array([1]));
  assert.ok(withDecode.capabilities.has('decoded-payload'));
  // ...and the grant records that it was *proven* rather than attested.
  const g = withDecode.grants.find((x) => x.capability === 'decoded-payload');
  assert.match(g.basis, /^proven:/);

  // Neither of the other two, under either construction.
  for (const d of [withoutDecode, withDecode]) {
    assert.equal(d.capabilities.has('metadata-hash'), false, 'metadata-hash: the runtime emits no digest, so mode 1 is rejected on chain (SQ-594/B21)');
    assert.equal(d.capabilities.has('hashed-payload'), false);
  }
});

test('signing an account the extension does not hold is refused before the prompt', async () => {
  // A signature from the wrong account is *valid* and the transaction is rejected on
  // nonce or origin — so this must fail here, not as a wallet error the user cannot read.
  const { api } = fakeApi(['talisman'], [ALICE]);
  const adapter = await connectInjected(api, 'talisman', 'Bleavit');
  await assert.rejects(() => adapter.sign(request(BOB)), AccountNotHeldError);
  await assert.rejects(() => adapter.sign(request(BOB)), new RegExp(ALICE));
});

test('accounts are re-read per signature, not captured at connect time', async () => {
  // An extension's account set changes while the page is open — the user switches, locks
  // or revokes. A set captured at connect would let a revoked account look signable right
  // up to the prompt.
  const { api, setAccounts } = fakeApi(['talisman'], [ALICE]);
  const adapter = await connectInjected(api, 'talisman', 'Bleavit');
  assert.ok((await adapter.sign(request(ALICE))).signatureHex.startsWith('0x'));

  setAccounts([BOB]);
  await assert.rejects(() => adapter.sign(request(ALICE)), AccountNotHeldError);
  assert.equal((await adapter.sign(request(BOB))).signedBy, BOB);
});

test('the signature is over the prepared payload bytes', async () => {
  const { api } = fakeApi(['talisman'], [ALICE]);
  const adapter = await connectInjected(api, 'talisman', 'Bleavit');
  const signed = await adapter.sign(request(ALICE));
  // 5 payload bytes -> the fake encodes the length it was handed; a signer given the hex
  // string, or an empty buffer, would produce a different first byte.
  assert.match(signed.signatureHex, /^0x05/);
  assert.equal(signed.signerId, 'injected:talisman');
});

test('the adapter is registrable — it is not marked test-only', async () => {
  const { api } = fakeApi(['talisman']);
  const registry = new SignerRegistry();
  registry.register(await connectInjected(api, 'talisman', 'Bleavit'));
  assert.equal(registry.list().length, 1);
  assert.equal(registry.supporting('external-key-custody').length, 1);
  assert.equal(registry.supporting('metadata-hash').length, 0, 'FE-P6 is unresolved');
});

/* ============================================================================
 * The adversarial-review round: findings #17, #18 and #20 (F6).
 * ========================================================================== */

test('a capability cannot be declared without the thing that performs it (#18)', () => {
  // The defect: `capabilities` was a Set literal the registry trusted, so a transport that
  // merely renders full hex could advertise itself as decode- and hash-capable. INV-FE-12
  // says an unproven capability is *absent*; a self-declared set makes "proven" and
  // "claimed" the same word.
  assert.throws(() => grantsDecodedPayload({ kind: 'sign-tx', signTx: undefined }), TypeError);
  assert.throws(() => grantsDecodedPayload({ kind: 'sign-tx', signTx: 'yes I can' }), TypeError);
  assert.throws(() => grantsHashedPayload({ kind: 'hasher', hasher: null }), TypeError);
  // An attestation needs a stated basis, not a bare assertion.
  assert.throws(() => grantsDecodedPayload({ kind: 'attested-flow', basis: 'trust me' }), TypeError);
  assert.throws(() => grantsExternalKeyCustody('sure'), TypeError);
});

test('metadata-hash is unreachable, not merely undeclared (#18)', () => {
  // FE-P6 has not established that any wallet honours CheckMetadataHash for a custom
  // chain, so there is deliberately NO grant function for it. Asserted over the package's
  // whole export surface rather than by naming what is absent, because a new grant helper
  // added later would otherwise slip past.
  const exported = Object.keys(signingExports).filter((n) => /^grants/.test(n));
  assert.ok(exported.length >= 3, 'no grant functions found — this check would be vacuous');
  assert.deepEqual(
    exported.filter((n) => /metadata/i.test(n)),
    [],
    'a metadata-hash grant exists; FE-P6 has not established it for any wallet',
  );
});

test('a descriptor’s capabilities are derived from its grants, never supplied (#18)', () => {
  const d = describeSigner({
    id: 'x',
    label: 'X',
    grants: [grantsExternalKeyCustody('the key stays in the device and only a signature returns')],
    testOnly: false,
  });
  assert.deepEqual([...d.capabilities], ['external-key-custody']);
  // A duplicate grant is refused: two bases for one capability hides which one applies.
  assert.throws(
    () =>
      describeSigner({
        id: 'x',
        label: 'X',
        grants: [
          grantsExternalKeyCustody('the key stays in the device and only a signature returns'),
          grantsExternalKeyCustody('a second, different justification for the same claim'),
        ],
        testOnly: false,
      }),
    /grants external-key-custody twice/,
  );
  // requireCapability still refuses what was never granted.
  assert.throws(
    () => requireCapability({ descriptor: d }, 'decoded-payload', 'FE-P6.'),
    /decoded-payload capability is not proven/,
  );
});

test('a proven grant and an attested one are distinguishable (#18)', () => {
  // Collapsing them would be the original defect one level up: a surface that cannot tell
  // a proof from a promise reports both as "proven".
  const proven = grantsDecodedPayload({ kind: 'sign-tx', signTx: async () => new Uint8Array() });
  const attested = grantsDecodedPayload({
    kind: 'attested-flow',
    basis: 'the device renders the call on its own screen from the complete payload',
  });
  assert.equal(proven.capability, attested.capability);
  assert.match(proven.basis, /^proven:/);
  assert.match(attested.basis, /^attested:/);
  assert.notEqual(proven.basis, attested.basis);
});

test('a non-hex payload is refused rather than signed as zero bytes (#20)', async () => {
  // `Number.parseInt('zz', 16)` is NaN and Uint8Array coerces NaN to 0, so '0xzz' has even
  // length, parses without error, and yields 0x00 — the adapter asks the wallet to sign a
  // byte the payload never contained. INV-FE-14 requires the exact raw SCALE bytes.
  const { api } = fakeApi(['talisman'], [ALICE]);
  const adapter = await connectInjected(api, 'talisman', 'Bleavit');
  const withPayload = (scaleHex) => ({ ...request(ALICE), prep: { scaleHex, call: 'market.buy' } });

  await assert.rejects(() => adapter.sign(withPayload('0xzz')), /not 0x-prefixed hex/);
  await assert.rejects(() => adapter.sign(withPayload('0x01g2')), /not 0x-prefixed hex/);
  await assert.rejects(() => adapter.sign(withPayload('0102')), /not 0x-prefixed hex/);
  await assert.rejects(() => adapter.sign(withPayload('0x')), /empty payload/);
  await assert.rejects(() => adapter.sign(withPayload('0x123')), /odd-length/);

  // A real payload still signs, so the guard is not simply refusing everything.
  const ok = await adapter.sign(withPayload('0x0102030405'));
  assert.match(ok.signatureHex, /^0x[0-9a-f]+$/);
});
