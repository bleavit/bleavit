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
import type {
  InjectedExtensionLike,
  PjsSignerApi,
  PolkadotSignerLike,
  SigningRequest,
} from '@bleavit/signing';
import { gate } from '@bleavit/transaction-builder';
import type { GatePassed, TxPreparation } from '@bleavit/transaction-builder';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

/**
 * @param address the account this signer holds
 * @param opts `withSignTx` models a fully capable extension — the case that must STILL not
 *   yield `decoded-payload`, because the capability also depends on this client being able
 *   to call it. `record` captures which channel was used, so a test can assert the signing
 *   path rather than only the descriptor.
 */
interface SignerOptions {
  /** Captures which channel was used, so a test can assert the signing path. */
  readonly record?: string[];
  readonly withSignTx?: boolean;
}

const signerFor = (address: string, opts: SignerOptions = {}): PolkadotSignerLike => ({
  publicKey: new Uint8Array(32),
  // Deterministic and payload-derived, so a test cannot pass on a constant.
  signBytes: async (data: Uint8Array) => {
    opts.record?.push('signBytes');
    return Uint8Array.from([data.length & 0xff, address.charCodeAt(1) & 0xff, 0xab]);
  },
  ...(opts.withSignTx
    ? {
        signTx: async () => {
          opts.record?.push('signTx');
          return Uint8Array.from([0xff]);
        },
      }
    : {}),
});

function fakeApi(
  extensions: readonly string[],
  accounts: readonly string[] = [ALICE],
  opts: SignerOptions = {},
): { api: PjsSignerApi; setAccounts: (next: readonly string[]) => void } {
  let live = accounts;
  return {
    api: {
      getInjectedExtensions: () => extensions,
      connectInjectedExtension: async (name: string): Promise<InjectedExtensionLike> => ({
        name,
        getAccounts: () => live.map((address) => ({ address, polkadotSigner: signerFor(address, opts) })),
      }),
    },
    setAccounts: (next: readonly string[]) => { live = next; },
  };
}

const PREP: TxPreparation = {
  scaleHex: '0x0102030405',
  builtFor: { specVersion: 2, metadataHash: `0x${'ab'.repeat(32)}` },
  preparedAt: { blockHash: `0x${'22'.repeat(32)}`, blockNumber: 6 },
  requires: ['P-1'],
};

/** A real gate proof — `GatePassed` is branded and only `gate()` mints one (10 §2.1). */
const WINDOW: GatePassed = (() => {
  const at = { blockHash: `0x${'11'.repeat(32)}` as const, blockNumber: 7 };
  const outcome = gate(PREP, at, PREP.builtFor, [
    { id: 'P-1', ok: true, requirement: 'r', expected: 'e', actual: 'a', at },
  ]);
  assert.equal(outcome.kind, 'proceed', 'the gate fixture no longer opens');
  return outcome.passed;
})();

const request = (account: string): SigningRequest => ({ prep: PREP, window: WINDOW, account });

/**
 * A signer that must never be reached — `requireCapability` refuses before it would be.
 *
 * Present because `SignerAdapter` requires it, and a throw rather than a stub: if the
 * refusal under test ever stopped happening, this would say so instead of returning a
 * signature nobody checked.
 */
const notSigned = (): Promise<never> => {
  throw new Error('requireCapability let a call through to the signer');
};

/**
 * A preparation carrying bytes the type refuses.
 *
 * `TxPreparation.scaleHex` is `0x${string}`, and the corpus below is exactly the strings
 * that are *not* that — an unprefixed pair, a hex-looking string with a non-hex digit.
 * The adapter's runtime guard is the subject (INV-FE-14: the exact raw SCALE bytes), and
 * the compile-time half being right is why the cast is needed to ask the question.
 */
const withPayloadHex = (scaleHex: string): SigningRequest => ({
  ...request(ALICE),
  prep: { ...PREP, scaleHex: scaleHex as TxPreparation['scaleHex'] },
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

test('the injected signer cannot claim a decode it cannot perform', async () => {
  // **This test has asserted the wrong thing twice.** First it required `decoded-payload`
  // on a descriptor with no decode channel at all, certifying the false claim. Then it
  // required the grant whenever the *extension* exposed `signTx` — which reads like the
  // fix and is not one, because the grant followed the counterparty while `sign()` kept
  // using `signBytes`. Both versions passed. Both told the user their wallet had rendered
  // a call it never saw.
  //
  // The capability needs BOTH conditions, and the second is the one about us:
  //
  //   1. the extension exposes `signTx` (a fact about the counterparty), and
  //   2. this adapter can *call* it — `SignTxFn` takes call data, signed extensions,
  //      metadata and a block number as four arguments, and a `TxPreparation` carries one
  //      opaque `scaleHex`. The app has no extrinsic encoder, so there is nothing to pass.
  //
  // (2) is false today, so the grant is absent however capable the extension is. When an
  // encoder lands and (2) becomes true, this test fails and re-granting is a deliberate
  // edit rather than a quiet one.
  const descriptor = INJECTED_DESCRIPTOR('talisman');
  assert.ok(descriptor.capabilities.has('external-key-custody'));
  assert.equal(
    descriptor.capabilities.has('decoded-payload'),
    false,
    'signBytes shows the user an opaque blob; the capability must not be claimed for it',
  );

  // ...and it stays absent when the extension is fully capable, which is the half the
  // previous version got wrong. A descriptor built from a `signTx`-exposing extension is
  // still built by an adapter that will call `signBytes`.
  const { api } = fakeApi(['talisman'], [ALICE], { withSignTx: true });
  const adapter = await connectInjected(api, 'talisman', 'Bleavit');
  assert.equal(
    adapter.descriptor.capabilities.has('decoded-payload'),
    false,
    'a capable extension does not make the CLIENT capable — condition (2) is still false',
  );

  for (const d of [descriptor, adapter.descriptor]) {
    assert.equal(d.capabilities.has('metadata-hash'), false, 'metadata-hash: the runtime emits no digest, so mode 1 is rejected on chain (SQ-594/B21)');
    assert.equal(d.capabilities.has('hashed-payload'), false);
  }
});

test('the signature really is produced by the channel the capabilities describe', async () => {
  // The anti-drift assertion neither earlier version made: it reads which function the
  // adapter *called*. Every previous test inspected the descriptor and none watched the
  // signing path, which is exactly how a grant and a channel disagreed through two rounds
  // of review. If `sign()` is ever routed through `signTx`, this fails and the capability
  // has to be revisited in the same edit.
  const called: string[] = [];
  const { api } = fakeApi(['talisman'], [ALICE], { withSignTx: true, record: called });
  const adapter = await connectInjected(api, 'talisman', 'Bleavit');
  await adapter.sign(request(ALICE));

  assert.deepEqual(called, ['signBytes']);
  assert.equal(
    adapter.descriptor.capabilities.has('decoded-payload'),
    false,
    'signBytes was used, so decoded-payload must be absent — the two are one fact',
  );
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
  // Each argument is deliberately outside its parameter type. That IS the test: the
  // sentence above says a self-declared set makes "proven" and "claimed" the same word,
  // and these are what a transport that merely *claims* the capability supplies — a
  // missing function, a string where a function belongs, a null hasher. The runtime check
  // is what makes the grant evidence rather than assertion, so the suite has to reach it.
  const claimed = <T>(evidence: unknown): T => evidence as T;
  assert.throws(() => grantsDecodedPayload(claimed({ kind: 'sign-tx', signTx: undefined })), TypeError);
  assert.throws(() => grantsDecodedPayload(claimed({ kind: 'sign-tx', signTx: 'yes I can' })), TypeError);
  assert.throws(() => grantsHashedPayload(claimed({ kind: 'hasher', hasher: null })), TypeError);
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
    () => requireCapability({ descriptor: d, sign: notSigned }, 'decoded-payload', 'FE-P6.'),
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
  const withPayload = withPayloadHex;

  await assert.rejects(() => adapter.sign(withPayload('0xzz')), /not 0x-prefixed hex/);
  await assert.rejects(() => adapter.sign(withPayload('0x01g2')), /not 0x-prefixed hex/);
  await assert.rejects(() => adapter.sign(withPayload('0102')), /not 0x-prefixed hex/);
  await assert.rejects(() => adapter.sign(withPayload('0x')), /empty payload/);
  await assert.rejects(() => adapter.sign(withPayload('0x123')), /odd-length/);

  // A real payload still signs, so the guard is not simply refusing everything.
  const ok = await adapter.sign(withPayload('0x0102030405'));
  assert.match(ok.signatureHex, /^0x[0-9a-f]+$/);
});
