/**
 * Export scope, consent, canonical JSON and the digest — 10 §13.1, 11 §11.14.4 (F20).
 *
 * Two properties here are the kind that a reasonable implementation gets subtly wrong,
 * and both are about honesty rather than correctness:
 *
 *  - **Consent is per export and never inherited.** Opt-in alone is satisfied by a
 *    checkbox that remembers, and a remembered scope is how a user who once shared
 *    holdings for a single question ships them to a third party forever after.
 *  - **Pseudonymization is labelled for what it is.** It replaces the address and does
 *    nothing about the holdings, which remain a fingerprint. A user believing an
 *    "anonymised" capsule is anonymous is the failure this label exists to prevent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_SCOPES,
  CONTEXT_DOMAIN_TAG,
  PUBLIC_SCOPES,
  RECEIPT_DOMAIN_TAG,
  ScopeError,
  canonicalJson,
  defaultScope,
  digestPreimage,
  includesAccountData,
  pseudonymizationLabel,
  scopeFromConsent,
} from '@bleavit/contexts';
import * as contextsModule from '@bleavit/contexts';

const decode = (bytes) => new TextDecoder().decode(bytes);

// --- scope and consent ----------------------------------------------------

test('the default scope excludes every account-bearing scope', () => {
  const scope = defaultScope();
  assert.equal(includesAccountData(scope), false);
  for (const account of ACCOUNT_SCOPES) {
    assert.equal(scope.included.includes(account), false, `${account} is in the default scope`);
  }
  for (const pub of PUBLIC_SCOPES) assert.ok(scope.included.includes(pub));
  assert.equal(scope.pseudonymized, false);
});

test('consent cannot be inherited — defaultScope takes no previous scope', () => {
  // Structural, not a convention: a `defaultScope(previous)` signature is all it would
  // take to make consent sticky, and the clause exists to prevent exactly that.
  assert.equal(defaultScope.length, 0, 'defaultScope accepts an argument it could inherit from');
  const first = scopeFromConsent(['proposal', 'positions']);
  assert.equal(includesAccountData(first), true);
  // The next export starts from the default, not from what was shared last time.
  assert.equal(includesAccountData(defaultScope()), false);
});

test('an account scope arrives only by being asked for', () => {
  assert.equal(includesAccountData(scopeFromConsent(['proposal', 'market'])), false);
  assert.equal(includesAccountData(scopeFromConsent(['balances'])), true);
});

test('an unknown scope is refused rather than ignored', () => {
  assert.throws(() => scopeFromConsent(['proposal', 'private_key']), ScopeError);
});

test('pseudonymization without account data is refused', () => {
  // The flag would be a claim about nothing, and a flag that sometimes means nothing
  // is one a user learns to disregard.
  assert.throws(() => scopeFromConsent(['proposal'], true), ScopeError);
  assert.doesNotThrow(() => scopeFromConsent(['positions'], true));
});

test('the pseudonymization label says what it does NOT do', () => {
  const label = pseudonymizationLabel(scopeFromConsent(['positions'], true));
  assert.match(label, /does not hide your holdings/i);
  assert.match(label, /fingerprint/i);
  assert.match(label, /cannot be un-sent/i);
});

test('no label is offered when nothing account-bearing is in scope', () => {
  // Offering it would imply the capsule otherwise identifies the user.
  assert.equal(pseudonymizationLabel(defaultScope()), undefined);
});

// --- canonical JSON -------------------------------------------------------

test('keys are sorted and separators minimal', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ z: { y: 1, x: 2 } }), '{"z":{"x":2,"y":1}}');
  assert.equal(canonicalJson([1, 2, 3]), '[1,2,3]');
});

test('key order in the input does not change the output', () => {
  assert.equal(canonicalJson({ a: 1, b: 2, c: 3 }), canonicalJson({ c: 3, b: 2, a: 1 }));
});

test('a bigint serializes as a decimal string, exactly', () => {
  // Base-unit amounts run past 2^53. A lossy conversion produces a document whose
  // digest is stable and whose contents are wrong — the failure mode is silence (V-74).
  const big = 9007199254740993000000n;
  assert.equal(canonicalJson({ amount: big }), `{"amount":"${big.toString()}"}`);
});

test('an unsafe integer NUMBER is refused rather than rounded', () => {
  assert.throws(() => canonicalJson({ amount: 9007199254740993 }), TypeError);
  assert.doesNotThrow(() => canonicalJson({ amount: 42 }));
});

test('non-finite numbers and undefined have no representation', () => {
  assert.throws(() => canonicalJson({ x: Number.NaN }), TypeError);
  assert.throws(() => canonicalJson({ x: Number.POSITIVE_INFINITY }), TypeError);
  assert.throws(() => canonicalJson(undefined), TypeError);
});

test('an undefined member is omitted while an explicit null is kept', () => {
  assert.equal(canonicalJson({ a: undefined, b: null }), '{"b":null}');
});

// --- digest pre-image -----------------------------------------------------

test('the pre-image is tag ++ NUL ++ canonical(core)', () => {
  const bytes = digestPreimage(CONTEXT_DOMAIN_TAG, { b: 1, a: 2 });
  assert.equal(decode(bytes), `${CONTEXT_DOMAIN_TAG}\u0000{"a":2,"b":1}`);
  assert.equal(bytes.includes(0), true, 'the NUL terminator is missing');
});

test('the domain tag separates the two formats', () => {
  // Without separation a receipt's digest could validate a context.
  const core = { same: 'core' };
  assert.notDeepEqual(
    Array.from(digestPreimage(CONTEXT_DOMAIN_TAG, core)),
    Array.from(digestPreimage(RECEIPT_DOMAIN_TAG, core)),
  );
});

test('the NUL makes the tag/payload boundary unambiguous', () => {
  // Concatenation alone is ambiguous: tag "ab" + payload "c" and tag "a" + payload "bc"
  // are the same bytes. With the terminator they cannot collide.
  const a = decode(digestPreimage('ab', 'c'));
  const b = decode(digestPreimage('a', 'bc'));
  assert.notEqual(a, b);
});

test('a tag containing NUL is refused', () => {
  assert.throws(() => digestPreimage('bad\u0000tag', {}), TypeError);
});

test('the module offers no signing or authentication helper', () => {
  // 10 §13.1: capsules are deliberately unsigned, because signing one with the user's
  // chain key reuses a signing key for a non-chain purpose and manufactures an artifact
  // that looks authoritative. A helper here that LOOKED like authentication would be
  // exactly that artifact.
  const authish = Object.keys(contextsModule).filter((n) =>
    /sign|authenticate|verifySignature|attest/i.test(n),
  );
  assert.deepEqual(authish, [], 'contexts exports something that could pass for authentication');
});
