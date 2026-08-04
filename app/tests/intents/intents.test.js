/**
 * The hostile-intent corpus — 10 §13.1–§13.3, 11 §11.14, 15 §4.8.
 *
 * This suite is about what admission **refuses**. A handoff parser that accepts every
 * well-formed document is trivially green and worthless: the subsystem's entire security
 * argument is that a hostile document cannot become a signature, and that argument is
 * made of refusals.
 *
 * Two properties here are worth more than the rest of the file, because both were absent
 * from the first version of this package and neither was visible in a green run:
 *
 *  - **The digest gate exists and is live.** `FE-HANDOFF-010` was defined and never
 *    emitted, so a truncated or altered document was admitted exactly like an intact one.
 *    A test that a valid document parses cannot see that. The tamper cases below can.
 *  - **Refusal details echo nothing from the document.** 10 §13.4 forbids rendering
 *    attacker-supplied text in the confirm flow, and the detail strings were composing
 *    document field names into the message.
 *
 * The sharpest structural case is the *asymmetry*: an unknown key at the top level is
 * tolerated, and an unknown key inside `action` is refused. It reads like an
 * inconsistency, which is exactly why it is worth pinning — 10 §13.2 says a top-level
 * extra is a producer annotation no consumer reads, while one inside `action` is a
 * proposed semantic and "precisely where an encoded call would be placed".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { digestPreimage } from '@bleavit/handoff-envelope';
import * as intentsModule from '@bleavit/intents';
import {
  INTENT_ACTIONS,
  INTENT_DOMAIN_TAG,
  INTENT_SCHEMA,
  MAX_DEPTH,
  MAX_DOCUMENT_BYTES,
  REFUSAL_CODES,
  RETIRED_CODES,
  admitIntent,
  clampLimits,
  narrowMaxAge,
} from '@bleavit/intents';

const LIVE = {
  genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
  specVersion: 2,
  contractVersion: 24,
};
const NOW = 1_000;

/** The producer's hash. Callers supply their own primitive (10 §13.1); this is node's. */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const ctx = (over = {}) => ({ live: LIVE, currentBlock: NOW, digest: sha256, ...over });

const core = (d) => ({
  schema: d.schema,
  binding: d.binding,
  action: d.action,
  limits: d.limits,
});

/** A document as a producer would emit it: the core, then the digest over that core. */
const sign = (d, tag = INTENT_DOMAIN_TAG) =>
  JSON.stringify({ ...d, digest: sha256(digestPreimage(tag, core(d))) });

const body = (over = {}) => ({
  schema: INTENT_SCHEMA,
  binding: { ...LIVE },
  action: { kind: 'prepare_pass_position', id: '7', collateral: '1000000' },
  limits: { maxCost: '1100000' },
  ...over,
});

const admit = (text, c = ctx()) => admitIntent(text, c);
const admitDoc = (over = {}, c = ctx()) => admit(sign(body(over)), c);

async function refusalOf(over = {}, c = ctx()) {
  const r = await admitDoc(over, c);
  assert.equal(r.ok, false, 'document was accepted but should have been refused');
  return r.refusal.code;
}

/** For inputs that are not documents-with-overrides: raw text, and non-text entirely. */
async function refusalOfRaw(value, c = ctx()) {
  const r = await admit(value, c);
  assert.equal(r.ok, false, 'input was accepted but should have been refused');
  return r.refusal.code;
}

// --- the happy path exists, so the refusals below mean something -----------

test('a well-formed intent is admitted', async () => {
  const r = await admitDoc();
  assert.equal(r.ok, true, r.ok === false ? r.refusal.detail : '');
  assert.equal(r.intent.action.kind, 'prepare_pass_position');
  assert.equal(r.intent.action.id, 7n);
  assert.equal(r.intent.action.collateral, 1000000n);
  assert.equal(r.intent.limits.maxCost, 1100000n);
});

test('the action vocabulary is exactly three (11 §11.14.2)', () => {
  assert.deepEqual([...INTENT_ACTIONS].sort(), [
    'close_position',
    'prepare_fail_position',
    'prepare_pass_position',
  ]);
});

// --- the digest gate (10 §13.1, 11 §11.14.1) -------------------------------

test('a document altered after it was digested is REFUSED (FE-HANDOFF-010)', async () => {
  // The mutation that proves the gate is live rather than merely present. Without it,
  // every other test in this file passes on a parser that never checks a digest — which
  // is exactly the state this package shipped in.
  const doc = JSON.parse(sign(body()));
  doc.action.collateral = '9000000'; // nine times the money, same digest
  assert.equal(await refusalOfRaw(JSON.stringify(doc)), 'FE-HANDOFF-010');
});

test('truncation is caught, not just substitution', async () => {
  const doc = JSON.parse(sign(body()));
  delete doc.limits.maxCost; // the cost ceiling simply removed in transit
  assert.equal(await refusalOfRaw(JSON.stringify(doc)), 'FE-HANDOFF-010');
});

test('a missing or malformed digest field is refused', async () => {
  const doc = JSON.parse(sign(body()));
  delete doc.digest;
  assert.equal(await refusalOfRaw(JSON.stringify(doc)), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw(JSON.stringify({ ...doc, digest: 'NOTHEX' })), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw(JSON.stringify({ ...doc, digest: 'abc' })), 'FE-HANDOFF-002');
});

test('the digest is domain-separated: a context-tagged digest does not validate an intent', async () => {
  // The NUL-terminated tag exists so a digest computed for one format cannot certify
  // another. Without separation these bytes would be identical.
  assert.equal(await refusalOfRaw(sign(body(), 'bleavit.context.v1')), 'FE-HANDOFF-010');
});

test('a top-level annotation does NOT break the digest', async () => {
  // The digest covers the defined core projection, not the whole document. If extras were
  // hashed, a relay that adds an annotation would corrupt a document it did not alter —
  // and the tolerated-extras rule would be unusable in practice.
  const doc = JSON.parse(sign(body()));
  doc.producedBy = 'some-tool';
  const r = await admit(JSON.stringify(doc));
  assert.equal(r.ok, true, r.ok === false ? r.refusal.detail : '');
});

test('there is no unchecked path: admission requires a digest function', async () => {
  await assert.rejects(() => admitIntent(sign(body()), { live: LIVE, currentBlock: NOW }), TypeError);
  // ...and no exported entry point performs the structural parse without it. A gate the
  // caller can decline to use is the `assertCheckable` defect in `packages/verify`.
  assert.equal('parseIntent' in intentsModule, false, 'a digest-free parse entry point exists');
});

test('a digest function that returns garbage is a programmer error, not a refusal', async () => {
  // Every `FE-HANDOFF-*` code names something a *file* did. Rendering a broken client as
  // "this file is damaged" would hide the bug in the one place a user cannot debug it.
  await assert.rejects(() => admitDoc({}, ctx({ digest: () => 'NOT HEX' })), TypeError);
});

test('an async digest is supported, because SubtleCrypto is async', async () => {
  const r = await admitDoc({}, ctx({ digest: async (bytes) => sha256(bytes) }));
  assert.equal(r.ok, true, r.ok === false ? r.refusal.detail : '');
});

// --- the asymmetry --------------------------------------------------------

test('an unknown key at the TOP LEVEL is tolerated', async () => {
  const doc = JSON.parse(sign(body()));
  const r = await admit(JSON.stringify({ ...doc, producedBy: 'some-tool', note: 42 }));
  assert.equal(r.ok, true, r.ok === false ? r.refusal.detail : '');
});

test('an unknown key inside `action` is REFUSED (FE-HANDOFF-004)', async () => {
  // Precisely where an encoded call would be placed. Tolerating it is tolerating
  // the attack.
  assert.equal(
    await refusalOf({ action: { ...body().action, call: '0xdeadbeef' } }),
    'FE-HANDOFF-004',
  );
});

test('an unknown key inside `limits` is REFUSED', async () => {
  assert.equal(await refusalOf({ limits: { maxCost: '1', callData: '0x00' } }), 'FE-HANDOFF-004');
});

test('an unknown key inside `binding` is REFUSED', async () => {
  // 10 §13.1 tolerates extras "at the top level only", so every nested core object is
  // closed. `binding` was open, which meant a foreign field in the one object whose whole
  // job is to pin which chain this document is for was silently dropped.
  assert.equal(
    await refusalOf({ binding: { ...LIVE, rpcEndpoint: 'wss://evil.example' } }),
    'FE-HANDOFF-004',
  );
});

test('the two rules are genuinely different, on the same document', async () => {
  // If the top-level rule were also "refuse", the first assertion would pass for the
  // wrong reason and the asymmetry would be untested.
  const withTop = JSON.parse(sign(body()));
  withTop.harmlessAnnotation = 'x';
  assert.equal((await admit(JSON.stringify(withTop))).ok, true);
  assert.equal(
    await refusalOf({ action: { ...body().action, harmlessAnnotation: 'x' } }),
    'FE-HANDOFF-004',
  );
});

// --- schema, chain binding, runtime version -------------------------------

test('the schema is matched by exact equality, not by prefix', async () => {
  for (const schema of ['bleavit.intent.v2', 'bleavit.intent.v1-draft', 'evil.bleavit.intent.v1']) {
    assert.equal(await refusalOf({ schema }), 'FE-HANDOFF-001', schema);
  }
});

test('a document for another chain is refused', async () => {
  assert.equal(await refusalOf({ binding: { ...LIVE, genesisHash: '0xdef' } }), 'FE-HANDOFF-005');
  assert.equal(await refusalOf({ binding: { ...LIVE, contractVersion: 23 } }), 'FE-HANDOFF-005');
});

test('a NEWER runtime is refused and an OLDER one is admitted (10 §13.3)', async () => {
  // The deliberate asymmetry: a newer document describes a surface this client cannot
  // check (INV-FE-12 fails safe), while an older one is rebuilt against live descriptors
  // — an intent's version never selects an encoding.
  assert.equal(await refusalOf({ binding: { ...LIVE, specVersion: 3 } }), 'FE-HANDOFF-006');
  assert.equal((await admitDoc({ binding: { ...LIVE, specVersion: 1 } })).ok, true);
});

test('a version outside u32 is refused rather than compared', async () => {
  assert.equal(await refusalOf({ binding: { ...LIVE, specVersion: 2 ** 32 } }), 'FE-HANDOFF-002');
  assert.equal(await refusalOf({ binding: { ...LIVE, contractVersion: -1 } }), 'FE-HANDOFF-002');
  assert.equal(await refusalOf({ binding: { ...LIVE, specVersion: '2' } }), 'FE-HANDOFF-002');
});

// --- malformed and hostile shapes -----------------------------------------

test('a malformed document is refused, not repaired', async () => {
  assert.equal(await refusalOfRaw('not json at all'), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw('[]'), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw('null'), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw(JSON.stringify({ ...body(), binding: undefined })), 'FE-HANDOFF-002');
});

test('the input is text; a caller-built object is refused', async () => {
  // Every transport 10 §13.4 names delivers text. Accepting an object let a **getter**
  // throw out of the parser instead of returning a refusal, and let a property return a
  // different value on each read — so the value that was validated need not be the value
  // that was used.
  const hostile = { get schema() { throw new Error('boom'); } };
  assert.equal(await refusalOfRaw(hostile), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw(42), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw(null), 'FE-HANDOFF-002');
  assert.equal(await refusalOfRaw(JSON.parse(sign(body()))), 'FE-HANDOFF-002');
});

test('an over-deep document is refused before it is read semantically', async () => {
  let nested = { deep: true };
  for (let i = 0; i < MAX_DEPTH + 3; i += 1) nested = { nested };
  assert.equal(await refusalOfRaw(JSON.stringify({ ...body(), padding: nested })), 'FE-HANDOFF-002');
  // Arrays nest too. A guard that walks only objects leaves this unbounded.
  let arrays = [1];
  for (let i = 0; i < MAX_DEPTH + 3; i += 1) arrays = [arrays];
  assert.equal(await refusalOfRaw(JSON.stringify({ ...body(), padding: arrays })), 'FE-HANDOFF-002');
});

test('the parser bounds are computed from the format, not chosen', async () => {
  // 10 §13.2: "Parser bounds are computed, not chosen." An intent carries no chain view,
  // so its ceiling is the frozen core at its widest 02-frozen type widths — about a
  // kilobyte — and not a round number with three orders of magnitude of slack in it.
  assert.ok(MAX_DOCUMENT_BYTES > 500 && MAX_DOCUMENT_BYTES < 4096, `bound is ${MAX_DOCUMENT_BYTES}`);
  assert.notEqual(MAX_DOCUMENT_BYTES, 64 * 1024);
  assert.equal(MAX_DEPTH, 3);
  const pad = 'a'.repeat(MAX_DOCUMENT_BYTES);
  assert.equal(await refusalOfRaw(JSON.stringify({ ...body(), pad })), 'FE-HANDOFF-002');
});

test('the byte cap counts UTF-8 bytes, not UTF-16 code units', async () => {
  // A four-byte character is one UTF-16 unit pair and four bytes. Measuring `.length`
  // admitted a document up to four times the stated cap.
  const astral = String.fromCodePoint(0x1f600).repeat(Math.ceil(MAX_DOCUMENT_BYTES / 3));
  assert.ok(astral.length < MAX_DOCUMENT_BYTES, 'the fixture must pass a UTF-16 length check');
  assert.ok(new TextEncoder().encode(astral).byteLength > MAX_DOCUMENT_BYTES);
  assert.equal(await refusalOfRaw(JSON.stringify({ ...body(), pad: astral })), 'FE-HANDOFF-002');
});

test('an unknown action is refused', async () => {
  assert.equal(await refusalOf({ action: { kind: 'drain_account', id: '1' } }), 'FE-HANDOFF-003');
  assert.equal(await refusalOf({ action: { kind: 'ledger.transfer', id: '1' } }), 'FE-HANDOFF-003');
});

// --- the id ---------------------------------------------------------------

test('the id is a canonical u64 decimal string and nothing else', async () => {
  // Every target in this vocabulary is a `u64` chain id, and 11 §11.14.4 defends against
  // id substitution by rendering what the id *resolves to*. An id that cannot be resolved
  // has no identity to render, so admitting one would disable the defence. Restricting to
  // canonical decimals also removes, in one rule rather than a blocklist, every string
  // that is not an id.
  const RTL_OVERRIDE = String.fromCharCode(0x202e); // renders "7<RLO>8" as "87"
  const NUL = String.fromCharCode(0);
  for (const id of [
    'proposal-7', // the old fixture: plausible, and not an id
    'https://evil.example/7', // a URL where a number belongs
    `7${RTL_OVERRIDE}8`, // a bidirectional override: renders as "87"
    `7${NUL}`, // a control character
    '007', // two spellings of one id
    ' 7',
    '7 ',
    '0x7',
    '1e3',
    '-1',
    '',
    '18446744073709551616', // u64::MAX + 1
  ]) {
    assert.equal(await refusalOf({ action: { ...body().action, id } }), 'FE-HANDOFF-002', id);
  }
  assert.equal((await admitDoc({ action: { ...body().action, id: '18446744073709551615' } })).ok, true);
});

test('a numeric id is refused, because u64 does not survive JSON', async () => {
  assert.equal(await refusalOf({ action: { ...body().action, id: 7 } }), 'FE-HANDOFF-002');
});

// --- sizing rules ---------------------------------------------------------

test('a prepare is sized in COLLATERAL and refuses a fraction', async () => {
  // 11 §11.14.2: users budget in USDC, and the LMSR inversion is exactly the arithmetic
  // an external tool gets wrong.
  assert.equal(
    await refusalOf({ action: { ...body().action, fractionPpm: 500000 } }),
    'FE-HANDOFF-004',
  );
});

test('a close is a FRACTION and refuses an absolute amount', async () => {
  // An absolute amount from a stale capsule can exceed the current holding or leave
  // unredeemable dust. A security choice, not a convenience.
  const close = { kind: 'close_position', id: '1', fractionPpm: 250000 };
  assert.equal((await admitDoc({ action: close })).ok, true);
  assert.equal(await refusalOf({ action: { ...close, collateral: '5' } }), 'FE-HANDOFF-004');
});

test('a fraction outside (0, 1_000_000] ppm is refused', async () => {
  for (const fractionPpm of [0, -1, 1000001, 1.5]) {
    assert.equal(
      await refusalOf({ action: { kind: 'close_position', id: '1', fractionPpm } }),
      'FE-HANDOFF-007',
      `fractionPpm ${fractionPpm} was accepted`,
    );
  }
});

test('a missing or zero collateral is refused, never defaulted', async () => {
  // "There is no safe default for money."
  const base = { kind: 'prepare_pass_position', id: '1' };
  assert.equal(await refusalOf({ action: base }), 'FE-HANDOFF-007');
  assert.equal(await refusalOf({ action: { ...base, collateral: '0' } }), 'FE-HANDOFF-007');
  assert.equal(await refusalOf({ action: { ...base, collateral: -5 } }), 'FE-HANDOFF-007');
});

test('a large collateral survives as an exact integer', async () => {
  // JSON numbers past 2^53 lose precision silently — the trap the vector corpus hit
  // (V-74). A decimal string is accepted; a lossy number is not laundered into one.
  const big = '9007199254740993000000';
  const r = await admitDoc({ action: { ...body().action, collateral: big } });
  assert.equal(r.ok, true);
  assert.equal(r.intent.action.collateral, BigInt(big));
});

test('an amount is a decimal string; a JSON number is refused rather than converted', async () => {
  // Admitting both spellings would mean the same amount has two forms, one of which is
  // lossy above a threshold no producer is tracking.
  assert.equal(await refusalOf({ action: { ...body().action, collateral: 1000000 } }), 'FE-HANDOFF-007');
  for (const collateral of ['1e6', '1.5', '0x10', ' 1', '1_000', '01', '-1']) {
    assert.equal(
      await refusalOf({ action: { ...body().action, collateral } }),
      'FE-HANDOFF-007',
      collateral,
    );
  }
});

test('an amount past u128 is refused rather than carried as an unbounded BigInt', async () => {
  const overflow = (2n ** 128n).toString();
  assert.equal(await refusalOf({ action: { ...body().action, collateral: overflow } }), 'FE-HANDOFF-007');
  assert.equal(await refusalOf({ limits: { maxCost: overflow } }), 'FE-HANDOFF-007');
  const max = (2n ** 128n - 1n).toString();
  assert.equal((await admitDoc({ action: { ...body().action, collateral: max } })).ok, true);
});

test('a deadline outside u32 is refused', async () => {
  assert.equal(await refusalOf({ limits: { deadlineBlock: 2 ** 32 } }), 'FE-HANDOFF-007');
  assert.equal(await refusalOf({ limits: { deadlineBlock: 0 } }), 'FE-HANDOFF-007');
  assert.equal(await refusalOf({ limits: { deadlineBlock: '5000' } }), 'FE-HANDOFF-007');
});

test('a buy ceiling and a sell floor in one document are refused', async () => {
  assert.equal(await refusalOf({ limits: { maxCost: '1', minProceeds: '1' } }), 'FE-HANDOFF-007');
});

// --- expiry, at admission -------------------------------------------------

test('a deadline already past on arrival is FE-HANDOFF-008', async () => {
  // 11 §11.14.1 lists expiry among the *admission* checks — properties of a file. The
  // document never becomes a transaction.
  assert.equal(await refusalOf({ limits: { deadlineBlock: NOW - 1 } }), 'FE-HANDOFF-008');
  assert.equal(await refusalOf({ limits: { deadlineBlock: NOW } }), 'FE-HANDOFF-008');
  assert.equal((await admitDoc({ limits: { deadlineBlock: NOW + 1 } })).ok, true);
});

test('expiry is compared against the chain clock, not the device clock', async () => {
  // The same document, two chain heights, two outcomes — and no reference to Date.
  const deadline = { limits: { deadlineBlock: 500 } };
  assert.equal((await admitDoc(deadline, ctx({ currentBlock: 499 }))).ok, true);
  assert.equal(await refusalOf(deadline, ctx({ currentBlock: 501 })), 'FE-HANDOFF-008');
});

// --- the refusal family ---------------------------------------------------

test('FE-HANDOFF-009 is retired and never emitted', () => {
  // 10 §13.3: "retired and MUST NOT be reassigned". A reused code makes two different
  // failures indistinguishable in every record written before and after the reuse.
  assert.ok(RETIRED_CODES.includes('FE-HANDOFF-009'));
  assert.equal(REFUSAL_CODES.includes('FE-HANDOFF-009'), false, 'a retired code was reassigned');
});

test('the family is 001..013 with exactly the retired gap', () => {
  const numbers = REFUSAL_CODES.map((c) => Number(c.slice('FE-HANDOFF-'.length))).sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13]);
});

test('no refusal echoes a document-supplied string (10 §13.4)', async () => {
  // An attacker-supplied string rendered anywhere in the refusal is a phishing primitive,
  // and expert `detail` is rendered too. The rule this pins is narrow and checkable:
  // a *number* that has already passed range validation may appear; a string never may.
  const MARK = 'Bleavit-Official-Assistant-says-approve';
  const cases = [
    { schema: MARK },
    { binding: { ...LIVE, genesisHash: MARK } },
    { binding: { ...LIVE, [MARK]: 1 } },
    { action: { kind: MARK, id: '1' } },
    { action: { ...body().action, id: MARK } },
    { action: { ...body().action, [MARK]: 'x' } },
    { action: { ...body().action, collateral: MARK } },
    { limits: { maxCost: MARK } },
    { limits: { [MARK]: 1 } },
  ];
  for (const over of cases) {
    const r = await admitDoc(over);
    assert.equal(r.ok, false, `${JSON.stringify(over)} was admitted`);
    assert.equal(r.refusal.message.includes(MARK), false, `message echoed the document: ${r.refusal.message}`);
    assert.equal(r.refusal.detail.includes(MARK), false, `detail echoed the document: ${r.refusal.detail}`);
  }
  // ...and the digest field, which is read before any of the above.
  const doc = JSON.parse(sign(body()));
  const r = await admit(JSON.stringify({ ...doc, digest: MARK }));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.detail.includes(MARK), false);
});

// --- clamping -------------------------------------------------------------

const clampCtx = (over = {}) => ({ currentBlock: 10, chainDeadlineBlock: 100, ...over });
const clamped = (limits, inputs) => {
  const c = clampLimits(limits, inputs);
  assert.equal(c.ok, true, c.ok === false ? c.refusal.detail : '');
  return c.limits;
};

test('a ceiling is narrowed, never widened', () => {
  const c = clamped({ maxCost: 5000n }, clampCtx({ chainMaxCost: 3000n }));
  assert.equal(c.maxCost.encoded, 3000n, 'the tool widened the ceiling');
  assert.equal(c.maxCost.boundBy, 'chain');
  assert.equal(c.maxCost.narrowed, true);
});

test('a tighter ceiling from the tool is honoured', () => {
  const c = clamped({ maxCost: 1000n }, clampCtx({ chainMaxCost: 3000n }));
  assert.equal(c.maxCost.encoded, 1000n);
  assert.equal(c.maxCost.boundBy, 'intent');
  assert.equal(c.maxCost.narrowed, false);
});

test('a floor is raised, never lowered', () => {
  const c = clamped({ minProceeds: 100n }, clampCtx({ chainMinProceeds: 500n }));
  assert.equal(c.minProceeds.encoded, 500n, 'the tool lowered the proceeds floor');
  assert.equal(c.minProceeds.narrowed, true);
});

test('a policy cap binds when it is the tightest', () => {
  const c = clamped({ maxCost: 5000n }, clampCtx({ chainMaxCost: 3000n, policyMaxCost: 900n }));
  assert.equal(c.maxCost.encoded, 900n);
  assert.equal(c.maxCost.boundBy, 'policy');
});

test('the asked value is kept alongside the encoded one, not overwritten', () => {
  // Two facts with two provenances — one `external-proposal`, one chain-derived. The
  // difference is shown, not silently applied (11 §11.14.3).
  const c = clamped({ maxCost: 5000n }, clampCtx({ chainMaxCost: 3000n }));
  assert.equal(c.maxCost.asked, 5000n);
  assert.equal(c.maxCost.chain, 3000n);
  assert.notEqual(c.maxCost.asked, c.maxCost.encoded);
  assert.equal(c.anyNarrowed, true);
});

test('a stated limit with no chain value to narrow against is REFUSED, not dropped', () => {
  // The fail-open this replaces looked like nothing: the whole `maxCost` entry was
  // omitted, so what reached the encoder was a trade with no cost bound at all — the
  // widest possible limit, produced by a function whose contract is that limits only
  // narrow.
  const missing = clampLimits({ maxCost: 5000n }, clampCtx({ chainMinProceeds: 1n }));
  assert.equal(missing.ok, false);
  assert.equal(missing.refusal.code, 'FE-HANDOFF-011');

  const floor = clampLimits({ minProceeds: 5n }, clampCtx({ chainMaxCost: 1n }));
  assert.equal(floor.ok, false);
  assert.equal(floor.refusal.code, 'FE-HANDOFF-011');

  const neither = clampLimits({}, clampCtx());
  assert.equal(neither.ok, false, 'a trade with no direction was clamped');
  assert.equal(neither.refusal.code, 'FE-HANDOFF-011');
});

test('a deadline that passes before the refresh is FE-HANDOFF-011, not -008', () => {
  // 11 §11.14.1's distinction: -008 says the *file* had expired on arrival; -011 says the
  // file was fine and the chain moved. Collapsing them either blames a good file or
  // leaves a gap between the two checks.
  const c = clampLimits({ deadlineBlock: 5 }, clampCtx({ chainMaxCost: 1n, currentBlock: 10 }));
  assert.equal(c.ok, false);
  assert.equal(c.refusal.code, 'FE-HANDOFF-011');
});

test('clamping returns a refusal rather than throwing', () => {
  // An exception escapes the FE-HANDOFF taxonomy entirely, and the import flow's whole
  // contract with the user is that every rejection arrives as a coded refusal.
  assert.doesNotThrow(() => clampLimits({ deadlineBlock: 5 }, clampCtx({ currentBlock: 10 })));
});

test('a deadline narrows to the earlier of the two', () => {
  const early = clamped({ deadlineBlock: 50 }, clampCtx({ chainMaxCost: 1n }));
  assert.equal(early.deadlineBlock.encoded, 50);
  const late = clamped({ deadlineBlock: 500 }, clampCtx({ chainMaxCost: 1n }));
  assert.equal(late.deadlineBlock.encoded, 100, 'the tool extended its own deadline');
});

test('a max context age narrows only', () => {
  // A tool may make its advice expire sooner; it cannot make it expire later.
  assert.equal(narrowMaxAge(50, 100), 50);
  assert.equal(narrowMaxAge(500, 100), 100, 'the tool extended its own freshness window');
  assert.equal(narrowMaxAge(undefined, 100), 100);
  // A negative request used to take the `undefined` branch and return the client's
  // maximum — a nonsensical input silently producing the *widest* answer.
  assert.equal(narrowMaxAge(-1, 100), 0);
  assert.equal(narrowMaxAge(Number.NaN, 100), 0);
  assert.equal(narrowMaxAge(Number.POSITIVE_INFINITY, 100), 100);
});
