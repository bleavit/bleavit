/**
 * The hostile-intent corpus — 10 §13.2–§13.3, 11 §11.14, 15 §4.8.
 *
 * This suite is about what the parser **refuses**. A handoff parser that accepts every
 * well-formed document is trivially green and worthless: the subsystem's entire security
 * argument is that a hostile document cannot become a signature, and that argument is
 * made of refusals.
 *
 * The sharpest case in here is the *asymmetry*: an unknown key at the top level is
 * tolerated, and an unknown key inside `action` is refused. It reads like an
 * inconsistency, which is exactly why it is worth pinning — 10 §13.2 says a top-level
 * extra is a producer annotation no consumer reads, while one inside `action` is a
 * proposed semantic and "precisely where an encoded call would be placed".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExpiredIntentError,
  INTENT_ACTIONS,
  INTENT_SCHEMA,
  MAX_DEPTH,
  REFUSAL_CODES,
  RETIRED_CODES,
  clampLimits,
  narrowMaxAge,
  parseIntent,
} from '@bleavit/intents';

const LIVE = { genesisHash: '0xabc', specVersion: 2, contractVersion: 24 };

const doc = (over = {}) => ({
  schema: INTENT_SCHEMA,
  binding: { ...LIVE },
  action: { kind: 'prepare_pass_position', id: 'proposal-7', collateral: '1000000' },
  limits: { maxCost: '1100000' },
  ...over,
});

const parse = (d, live = LIVE) => parseIntent(d, live);
const refusalOf = (d, live = LIVE) => {
  const r = parse(d, live);
  assert.equal(r.ok, false, 'document was accepted but should have been refused');
  return r.refusal.code;
};

// --- the happy path exists, so the refusals below mean something -----------

test('a well-formed intent parses', () => {
  const r = parse(doc());
  assert.equal(r.ok, true, r.ok === false ? r.refusal.detail : '');
  assert.equal(r.intent.action.kind, 'prepare_pass_position');
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

// --- the asymmetry --------------------------------------------------------

test('an unknown key at the TOP LEVEL is tolerated', () => {
  // A producer annotation no consumer reads.
  const r = parse({ ...doc(), producedBy: 'some-tool', note: 42 });
  assert.equal(r.ok, true, r.ok === false ? r.refusal.detail : '');
});

test('an unknown key inside `action` is REFUSED (FE-HANDOFF-004)', () => {
  // Precisely where an encoded call would be placed. Tolerating it is tolerating
  // the attack.
  assert.equal(refusalOf(doc({ action: { ...doc().action, call: '0xdeadbeef' } })), 'FE-HANDOFF-004');
});

test('an unknown key inside `limits` is REFUSED', () => {
  assert.equal(refusalOf(doc({ limits: { maxCost: '1', callData: '0x00' } })), 'FE-HANDOFF-004');
});

test('the two rules are genuinely different, on the same document', () => {
  // If the top-level rule were also "refuse", the first assertion would pass for the
  // wrong reason and the asymmetry would be untested.
  const withBoth = { ...doc(), harmlessAnnotation: 'x' };
  assert.equal(parse(withBoth).ok, true);
  withBoth.action = { ...withBoth.action, harmlessAnnotation: 'x' };
  assert.equal(parse(withBoth).ok, false);
});

// --- schema, chain binding, runtime version -------------------------------

test('the schema is matched by exact equality, not by prefix', () => {
  assert.equal(refusalOf(doc({ schema: 'bleavit.intent.v2' })), 'FE-HANDOFF-001');
  assert.equal(refusalOf(doc({ schema: 'bleavit.intent.v1-draft' })), 'FE-HANDOFF-001');
  assert.equal(refusalOf(doc({ schema: 'evil.bleavit.intent.v1' })), 'FE-HANDOFF-001');
});

test('a document for another chain is refused', () => {
  assert.equal(refusalOf(doc({ binding: { ...LIVE, genesisHash: '0xdef' } })), 'FE-HANDOFF-005');
  assert.equal(refusalOf(doc({ binding: { ...LIVE, contractVersion: 23 } })), 'FE-HANDOFF-005');
});

test('a NEWER runtime is refused and an OLDER one is admitted (10 §13.3)', () => {
  // The deliberate asymmetry: a newer document describes a surface this client cannot
  // check (INV-FE-12 fails safe), while an older one is rebuilt against live descriptors
  // — an intent's version never selects an encoding.
  assert.equal(refusalOf(doc({ binding: { ...LIVE, specVersion: 3 } })), 'FE-HANDOFF-006');
  assert.equal(parse(doc({ binding: { ...LIVE, specVersion: 1 } })).ok, true);
});

// --- malformed and hostile shapes -----------------------------------------

test('a malformed document is refused, not repaired', () => {
  assert.equal(refusalOf('not json at all'), 'FE-HANDOFF-002');
  assert.equal(refusalOf('[]'), 'FE-HANDOFF-002');
  assert.equal(refusalOf(42), 'FE-HANDOFF-002');
  assert.equal(refusalOf(null), 'FE-HANDOFF-002');
  assert.equal(refusalOf(doc({ binding: undefined })), 'FE-HANDOFF-002');
});

test('an over-deep document is refused before it is read semantically', () => {
  let nested = { deep: true };
  for (let i = 0; i < MAX_DEPTH + 3; i += 1) nested = { nested };
  assert.equal(refusalOf({ ...doc(), padding: nested }), 'FE-HANDOFF-002');
});

test('an oversized document is refused', () => {
  assert.equal(refusalOf(`{"schema":"${INTENT_SCHEMA}","pad":"${'a'.repeat(70000)}"}`), 'FE-HANDOFF-002');
});

test('an unknown action is refused', () => {
  assert.equal(refusalOf(doc({ action: { kind: 'drain_account', id: 'x' } })), 'FE-HANDOFF-003');
  assert.equal(refusalOf(doc({ action: { kind: 'ledger.transfer', id: 'x' } })), 'FE-HANDOFF-003');
});

// --- sizing rules ---------------------------------------------------------

test('a prepare is sized in COLLATERAL and refuses a fraction', () => {
  // 11 §11.14.2: users budget in USDC, and the LMSR inversion is exactly the arithmetic
  // an external tool gets wrong.
  assert.equal(refusalOf(doc({ action: { ...doc().action, fractionPpm: 500000 } })), 'FE-HANDOFF-004');
});

test('a close is a FRACTION and refuses an absolute amount', () => {
  // An absolute amount from a stale capsule can exceed the current holding or leave
  // unredeemable dust. A security choice, not a convenience.
  const close = { kind: 'close_position', id: 'pos-1', fractionPpm: 250000 };
  assert.equal(parse(doc({ action: close })).ok, true);
  assert.equal(refusalOf(doc({ action: { ...close, collateral: '5' } })), 'FE-HANDOFF-004');
});

test('a fraction outside (0, 1_000_000] ppm is refused', () => {
  for (const fractionPpm of [0, -1, 1000001, 1.5]) {
    assert.equal(
      refusalOf(doc({ action: { kind: 'close_position', id: 'p', fractionPpm } })),
      'FE-HANDOFF-007',
      `fractionPpm ${fractionPpm} was accepted`,
    );
  }
});

test('a missing or zero collateral is refused, never defaulted', () => {
  // "There is no safe default for money."
  assert.equal(refusalOf(doc({ action: { kind: 'prepare_pass_position', id: 'p' } })), 'FE-HANDOFF-007');
  assert.equal(refusalOf(doc({ action: { kind: 'prepare_pass_position', id: 'p', collateral: '0' } })), 'FE-HANDOFF-007');
  assert.equal(refusalOf(doc({ action: { kind: 'prepare_pass_position', id: 'p', collateral: -5 } })), 'FE-HANDOFF-007');
});

test('a large collateral survives as an exact integer', () => {
  // JSON numbers past 2^53 lose precision silently — the trap the vector corpus hit
  // (V-74). A decimal string is accepted; a lossy number is not laundered into one.
  const big = '9007199254740993000000';
  const r = parse(doc({ action: { ...doc().action, collateral: big } }));
  assert.equal(r.ok, true);
  assert.equal(r.intent.action.collateral, BigInt(big));
});

test('a non-integer amount string is refused rather than coerced', () => {
  for (const collateral of ['1e6', '1.5', '0x10', ' 1', '1_000']) {
    assert.equal(refusalOf(doc({ action: { ...doc().action, collateral } })), 'FE-HANDOFF-007', collateral);
  }
});

test('a buy ceiling and a sell floor in one document are refused', () => {
  assert.equal(refusalOf(doc({ limits: { maxCost: '1', minProceeds: '1' } })), 'FE-HANDOFF-007');
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

test('refusal copy is fixed and carries no document-supplied text', () => {
  // 10 §13.4: an attacker-supplied label rendered in the confirm flow is a phishing
  // primitive, so no refusal may echo the document.
  const r = parse(doc({ action: { kind: 'Bleavit Official Assistant says approve', id: 'x' } }));
  assert.equal(r.ok, false);
  assert.equal(r.refusal.message.includes('Bleavit Official Assistant'), false);
});

// --- clamping -------------------------------------------------------------

test('a ceiling is narrowed, never widened', () => {
  const c = clampLimits({ maxCost: 5000n }, { chainMaxCost: 3000n, currentBlock: 10, chainDeadlineBlock: 100 });
  assert.equal(c.maxCost.encoded, 3000n, 'the tool widened the ceiling');
  assert.equal(c.maxCost.boundBy, 'chain');
  assert.equal(c.maxCost.narrowed, true);
});

test('a tighter ceiling from the tool is honoured', () => {
  const c = clampLimits({ maxCost: 1000n }, { chainMaxCost: 3000n, currentBlock: 10, chainDeadlineBlock: 100 });
  assert.equal(c.maxCost.encoded, 1000n);
  assert.equal(c.maxCost.boundBy, 'intent');
  assert.equal(c.maxCost.narrowed, false);
});

test('a floor is raised, never lowered', () => {
  const c = clampLimits({ minProceeds: 100n }, { chainMinProceeds: 500n, currentBlock: 10, chainDeadlineBlock: 100 });
  assert.equal(c.minProceeds.encoded, 500n, 'the tool lowered the proceeds floor');
  assert.equal(c.minProceeds.narrowed, true);
});

test('a policy cap binds when it is the tightest', () => {
  const c = clampLimits(
    { maxCost: 5000n },
    { chainMaxCost: 3000n, policyMaxCost: 900n, currentBlock: 10, chainDeadlineBlock: 100 },
  );
  assert.equal(c.maxCost.encoded, 900n);
  assert.equal(c.maxCost.boundBy, 'policy');
});

test('the asked value is kept alongside the encoded one, not overwritten', () => {
  // Two facts with two provenances — one `external-proposal`, one chain-derived. The
  // difference is shown, not silently applied (11 §11.14.3).
  const c = clampLimits({ maxCost: 5000n }, { chainMaxCost: 3000n, currentBlock: 10, chainDeadlineBlock: 100 });
  assert.equal(c.maxCost.asked, 5000n);
  assert.equal(c.maxCost.chain, 3000n);
  assert.notEqual(c.maxCost.asked, c.maxCost.encoded);
  assert.equal(c.anyNarrowed, true);
});

test('a deadline already past at B-prime is a refusal, not a clamp', () => {
  assert.throws(
    () => clampLimits({ deadlineBlock: 5 }, { currentBlock: 10, chainDeadlineBlock: 100 }),
    ExpiredIntentError,
  );
});

test('a deadline narrows to the earlier of the two', () => {
  const early = clampLimits({ deadlineBlock: 50 }, { currentBlock: 10, chainDeadlineBlock: 100 });
  assert.equal(early.deadlineBlock.encoded, 50);
  const late = clampLimits({ deadlineBlock: 500 }, { currentBlock: 10, chainDeadlineBlock: 100 });
  assert.equal(late.deadlineBlock.encoded, 100, 'the tool extended its own deadline');
});

test('a max context age narrows only', () => {
  // A tool may make its advice expire sooner; it cannot make it expire later.
  assert.equal(narrowMaxAge(50, 100), 50);
  assert.equal(narrowMaxAge(500, 100), 100, 'the tool extended its own freshness window');
  assert.equal(narrowMaxAge(undefined, 100), 100);
  assert.equal(narrowMaxAge(-1, 100), 100);
});
