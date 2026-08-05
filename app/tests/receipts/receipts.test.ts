/**
 * `bleavit.receipt.v1` — the finalized result, export-only (10 §13.1; D-21).
 *
 * The load-bearing suite here is the one about **what a receipt refuses to carry**. 10 §13's
 * third rule bans an encoded call in *either* direction, and the outbound half is the one
 * that gets broken by writing the obvious code: the natural source for a receipt is the
 * `TxPreparation`, and 11 §11.4 rule 3 requires that object to carry `scaleHex`. Spreading
 * it in is one line and produces a document that looks more complete.
 *
 * A happy-path test cannot see that. So the corpus below hands `buildReceipt` the shapes a
 * caller would actually have — a whole preparation, a nested payload — and requires the
 * refusal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECEIPT_DOMAIN_TAG,
  RECEIPT_SCHEMA,
  ReceiptError,
  buildReceipt,
  receiptDigestPreimage,
  refuseUnverifiedExport,
  serializeReceipt,
} from '@bleavit/receipts';
import { CONTEXT_DOMAIN_TAG } from '@bleavit/contexts';
import { digestPreimage, equalBinding } from '@bleavit/handoff-envelope';

const decode = (bytes) => new TextDecoder().decode(bytes);

/**
 * A stand-in for `Finalized<T>`. The brand is a module-private symbol in `chain-client`,
 * so a test cannot mint one — and that is the property being relied on, not worked around:
 * what this suite checks is the *projection*, and TypeScript checks the provenance at the
 * one place it can be checked.
 */
/**
 * A complete `Finalized<T>` fixture.
 *
 * Two things the untyped version got wrong, both invisible at runtime. `as const` on the
 * discriminant: without it `kind` widens to `string` and the value stops being a
 * `Verified<T>` at all. And **`blockHash`/`blockNumber` are required** — the status this
 * helper claimed was `verified-finalized` carried no block, which is the one thing that
 * status *means*. Every assertion in this file has been running against a provenance label
 * with nothing behind it, which is exactly the condition 10 §2.1 exists to make untypeable.
 */
const finalized = <T,>(value: T) => ({
  value,
  status: {
    kind: 'verified-finalized' as const,
    blockHash: `0x${'11'.repeat(32)}` as const,
    blockNumber: 7,
  },
});

const BINDING = {
  genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
  specVersion: 2,
  contractVersion: 25,
};

const input = (over = {}) => ({
  binding: BINDING,
  anchor: finalized({ blockHash: '0xabc', blockNumber: 1_234, extrinsicIndex: 2 }),
  outcome: finalized({ call: 'Market.buy', success: true }),
  feeCharged: finalized({ asset: 'VIT', baseUnits: 12_345_678_901n }),
  ...over,
});

/* ---------------------------------------------- 10 §13 rule 3, the outbound half */

test('a whole TxPreparation is refused rather than having its scaleHex quietly dropped', () => {
  // This is the realistic call: the caller holds a preparation and passes it along.
  const preparation = {
    ...input(),
    scaleHex: '0x2904060000',
    mortality: { period: 64, phase: 3 },
  };
  assert.throws(() => buildReceipt(preparation), (error) => {
    assert.ok(error instanceof ReceiptError);
    assert.equal(error.code, 'FE-HANDOFF-002');
    // The expert text is `detail`, not `message`. 10 §13.3 requires fixed user copy AND
    // expert detail per code, and this suite used to assert the explanation on `message` —
    // which is what let `FE-HANDOFF-013` read one way here and another way in the parser's
    // table. `message` is now the one fixed sentence for the code, from one home.
    assert.match(error.detail, /bytes-shaped field/);
    assert.match(error.detail, /offer them back/);
    assert.equal(error.message, 'This file is damaged or not in the expected format.');
    return true;
  });
});

test('every bytes-shaped alias is refused, not just the one the codebase happens to use', () => {
  for (const field of [
    'scaleHex',
    'callData',
    'callBytes',
    'encodedCall',
    'payload',
    'payloadHex',
    'signature',
    'signedTx',
    'extrinsicHex',
    'preimage',
    'bytes',
    'hex',
    'blob',
  ]) {
    assert.throws(
      () => buildReceipt({ ...input(), [field]: '0xdead' }),
      ReceiptError,
      `${field} was accepted; a ban that covers one spelling covers nothing`,
    );
  }
});

test('a bytes-shaped field INSIDE a Finalized wrapper is refused — the case a shallow scan misses', () => {
  // This is where an encoded call would actually travel: `Finalized<T>` is a wrapper, so a
  // real payload sits at `outcome.value`, one level below where the obvious check looks.
  // The first version of the scan was shallow and passed this document.
  assert.throws(
    () => buildReceipt(input({ outcome: finalized({ call: 'Market.buy', success: true, scaleHex: '0x00' }) })),
    ReceiptError,
  );
});

test('a bytes-shaped field inside a labelled amount is refused too', () => {
  assert.throws(
    () => buildReceipt(input({ amounts: { net: finalized({ asset: 'USDC', baseUnits: 1n, preimage: '0x00' }) } })),
    ReceiptError,
  );
});

test('the emitted document contains no bytes-shaped key at any depth', () => {
  const receipt = buildReceipt(input());
  const serialized = serializeReceipt(receipt);
  for (const field of ['scaleHex', 'callData', 'encodedCall', 'signature', 'preimage']) {
    assert.equal(serialized.includes(field), false, `${field} reached the emitted document`);
  }
});

test('the call is a name, and a name cannot be resubmitted', () => {
  const receipt = buildReceipt(input());
  assert.equal(receipt.outcome.call, 'Market.buy');
  assert.equal(/^0x/.test(receipt.outcome.call), false);
});

/* ------------------------------------------------------------ the document itself */

test('the schema string is exact', () => {
  assert.equal(buildReceipt(input()).schema, 'bleavit.receipt.v1');
  assert.equal(RECEIPT_SCHEMA, 'bleavit.receipt.v1');
});

test('a failed dispatch is still a receipt — the outcome is a fact, not a success report', () => {
  const receipt = buildReceipt(
    input({ outcome: finalized({ call: 'Ledger.transfer', success: false, error: 'ConditionalLedger.ProtocolDestination' }) }),
  );
  assert.equal(receipt.outcome.success, false);
  assert.equal(receipt.outcome.error, 'ConditionalLedger.ProtocolDestination');
});

test('the anchor is carried, because re-reading the chain there is the only real check', () => {
  const receipt = buildReceipt(input());
  assert.deepEqual(receipt.anchor, { blockHash: '0xabc', blockNumber: 1_234, extrinsicIndex: 2 });
});

test('base-unit amounts survive past 2^53 as decimal strings, never as Numbers', () => {
  const big = 9_007_199_254_740_993n; // 2^53 + 1 — not representable as a double
  const receipt = buildReceipt(input({ feeCharged: finalized({ asset: 'USDC', baseUnits: big }) }));
  assert.equal(serializeReceipt(receipt).includes('"9007199254740993"'), true);
});

test('an absent amounts map and an empty one serialize identically — no third state', () => {
  assert.equal(serializeReceipt(buildReceipt(input())), serializeReceipt(buildReceipt(input({ amounts: {} }))));
});

test('named amounts are carried under their labels', () => {
  const receipt = buildReceipt(
    input({
      amounts: {
        net: finalized({ asset: 'USDC', baseUnits: 9_970n }),
        fee: finalized({ asset: 'USDC', baseUnits: 30n }),
      },
    }),
  );
  assert.equal(receipt.amounts.net.baseUnits, 9_970n);
  assert.equal(receipt.amounts.fee.baseUnits, 30n);
});

/* -------------------------------------------------------- the chain binding, shared */

test('the binding is carried verbatim and compares by exact equality', () => {
  const receipt = buildReceipt(input());
  assert.equal(equalBinding(receipt.binding, BINDING), true);
  assert.equal(equalBinding(receipt.binding, { ...BINDING, contractVersion: 24 }), false);
  assert.equal(equalBinding(receipt.binding, { ...BINDING, specVersion: 3 }), false);
  assert.equal(equalBinding(receipt.binding, { ...BINDING, genesisHash: '0x00' }), false);
});

/* ---------------------------------------------------------------- domain separation */

test('the domain tag separates the two outbound formats', () => {
  // Moved here from the contexts suite with the tag itself: without separation a receipt's
  // digest could validate a context, and this is the suite that can import both.
  const core = { same: 'core' };
  assert.notDeepEqual(
    Array.from(digestPreimage(CONTEXT_DOMAIN_TAG, core)),
    Array.from(digestPreimage(RECEIPT_DOMAIN_TAG, core)),
  );
});

test('the receipt pre-image is tag ++ NUL ++ canonical(core)', () => {
  const receipt = buildReceipt(input());
  const bytes = receiptDigestPreimage(receipt);
  // `\0` as an escape, never a literal NUL byte in the source. A literal one makes git
  // treat this whole file as **binary**: no line diff in any review, ever, and grep skips
  // it silently. That is a bad property for the file whose job is to be read.
  assert.equal(decode(bytes).startsWith(`${RECEIPT_DOMAIN_TAG}\0{`), true);
  assert.equal(bytes.includes(0), true, 'the NUL terminator is missing');
});

/* ------------------------------------------------- nothing that could pass for a signature */

/**
 * The banned verbs, matched as the export's **leading** word rather than as a substring
 * anywhere in it.
 *
 * A substring scan is what this test had first, and it flagged `refuseUnverifiedExport` —
 * a function that returns an error and could not authenticate anything — on the `verif` in
 * "Unverified". Loosening the pattern to make that pass would have let `verifySignature`
 * through with it. The property that actually matters is whether an export can be *called
 * to authenticate a capsule*, and that is carried by the verb the name starts with.
 */
const AUTHENTICATION_VERBS = ['sign', 'verify', 'authenticate', 'attest', 'certify', 'validate'];

const leadingVerb = (name) => (name.split(/(?=[A-Z])|_/)[0] ?? '').toLowerCase();

test('the package exports no signing, verification or authentication surface', async () => {
  const exported = Object.keys(await import('@bleavit/receipts'));
  assert.ok(exported.length > 0, 'nothing was exported; the scan would pass vacuously');
  for (const name of exported) {
    assert.equal(
      AUTHENTICATION_VERBS.includes(leadingVerb(name)),
      false,
      `${name} reads as authentication; 10 §13.1 makes capsules deliberately unsigned, and a ` +
        'helper that looked like a signature would manufacture the artifact that section refuses',
    );
  }
});

test('the authentication scan still catches the names it exists for', () => {
  // Negative control: a scan that can no longer fire reports success forever.
  for (const banned of ['signReceipt', 'verifyCapsule', 'authenticateExport', 'attestReceipt']) {
    assert.equal(AUTHENTICATION_VERBS.includes(leadingVerb(banned)), true, `${banned} was not caught`);
  }
  for (const allowed of ['refuseUnverifiedExport', 'buildReceipt', 'RECEIPT_DOMAIN_TAG']) {
    assert.equal(AUTHENTICATION_VERBS.includes(leadingVerb(allowed)), false, `${allowed} was wrongly caught`);
  }
});

/* --------------------------------------------------------------- FE-HANDOFF-013 */

test('an export with nothing verified is refused by code, and says nothing was exported', () => {
  const error = refuseUnverifiedExport('read-only-incompatible mode');
  assert.equal(error.code, 'FE-HANDOFF-013');
  // The mode is the "stated reason" 10 §13.1 asks for and travels as expert detail; what
  // the user reads is the same fixed sentence every time, whichever format refused.
  assert.match(error.detail, /read-only-incompatible mode/);
  assert.match(error.detail, /Nothing has been exported/);
  assert.equal(error.message, 'Bleavit cannot export while it has no verified view of the chain.');
  assert.ok(error.recovery.length > 0, '10 §13.3 requires a documented recovery per code');
});
