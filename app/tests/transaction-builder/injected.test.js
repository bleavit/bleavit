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
} from '@bleavit/signing';

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

test('it declares external custody and a decoded payload — and nothing else', async () => {
  // `metadata-hash` is FE-P6 and unresolved; declaring it would tell the user their wallet
  // verified the call when nothing here has established it can. `hashed-payload` is
  // refused outright: signing a hash of an oversized payload signs something nobody saw.
  const { capabilities } = INJECTED_DESCRIPTOR('talisman');
  assert.ok(capabilities.has('external-key-custody'));
  assert.ok(capabilities.has('decoded-payload'));
  assert.ok(!capabilities.has('metadata-hash'), 'metadata-hash is FE-P6, unresolved');
  assert.ok(!capabilities.has('hashed-payload'));
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
