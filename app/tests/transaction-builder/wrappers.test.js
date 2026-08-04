/**
 * Call wrappers — multisig and proxy (11 §11.3), and the identity split they create.
 *
 * The defect this suite exists for is not an encoding mistake. It is that a wrapped call
 * has **two** accounts — the one it executes as, and the one that pays — and a
 * precondition table written for one account silently checks the wrong one. That failure
 * is invisible in the healthy case and dangerous in the unhealthy one: every row reports
 * green against the signer's balance while the runtime rejects the inner call because the
 * proxied account is short. The user signed something they were told would work.
 *
 * The approval-state tests cover states a healthy local chain will not produce on demand
 * (a second approval, an already-approved signer, the threshold-reaching call), which is
 * why `deriveApproval` is a pure function over the frozen read rather than something you
 * can only exercise against a live multisig.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_WRAPPER,
  actingAccount,
  deriveApproval,
  feePayer,
  proxyTypeCovers,
  splitsIdentity,
  wrapperRefusalReason,
} from '@bleavit/transaction-builder';

const SIGNER = '5Signer';
const REAL = '5Real';
const MULTI = '5Multisig';
const OTHER = '5Other';

// A finalized read in the shape chain-client hands back; the brand has no runtime
// representation, so a plain object is the right test input (see fees.test.js).
const finalized = (value) => ({
  value,
  status: { kind: 'verified-finalized', blockHash: `0x${'22'.repeat(32)}`, blockNumber: 7 },
});

const proxy = (proxyType) => ({ kind: 'proxy', real: REAL, proxyType });
const multisig = (threshold) => ({ kind: 'multisig', multisig: MULTI, threshold, otherSignatories: [OTHER] });
const entry = (approvals, when = { height: 100, index: 2 }) =>
  finalized({ when, deposit: 1n, depositor: OTHER, approvals });

test('an unwrapped call has one identity', () => {
  assert.equal(actingAccount(NO_WRAPPER, SIGNER), SIGNER);
  assert.equal(feePayer(NO_WRAPPER, SIGNER), SIGNER);
  assert.equal(splitsIdentity(NO_WRAPPER, SIGNER), false);
});

test('a proxy call acts as `real` while the signer still pays', () => {
  // The whole point: these two must NOT be the same account. A test asserting only
  // `actingAccount === REAL` would pass on an implementation that also billed REAL.
  const w = proxy('Any');
  assert.equal(actingAccount(w, SIGNER), REAL);
  assert.equal(feePayer(w, SIGNER), SIGNER);
  assert.notEqual(actingAccount(w, SIGNER), feePayer(w, SIGNER));
  assert.equal(splitsIdentity(w, SIGNER), true);
});

test('a multisig call acts as the multisig account while the signer still pays', () => {
  const w = multisig(2);
  assert.equal(actingAccount(w, SIGNER), MULTI);
  assert.equal(feePayer(w, SIGNER), SIGNER);
  assert.notEqual(actingAccount(w, SIGNER), feePayer(w, SIGNER));
  assert.equal(splitsIdentity(w, SIGNER), true);
});

test('the fee payer is the signer under every wrapper', () => {
  // Stated as its own property because it is the half that looks too obvious to test,
  // and it is exactly the half a "just use `who`" refactor would break.
  for (const w of [NO_WRAPPER, proxy('Any'), proxy(undefined), multisig(1), multisig(3)]) {
    assert.equal(feePayer(w, SIGNER), SIGNER, `fee payer moved under ${w.kind}`);
  }
});

test('no entry means the first approval, and the timepoint MUST be absent', () => {
  // `as_multi` rejects a timepoint on the opening approval (`UnexpectedTimepoint`).
  const step = deriveApproval(finalized(null), SIGNER, 2);
  assert.equal(step.kind, 'first');
  assert.equal(step.maybeTimepoint, undefined);
  assert.equal(step.approvalsSoFar, 0);
  assert.equal(step.approvalsNeeded, 2);
});

test('an existing entry means the recorded timepoint MUST be carried', () => {
  // And it must be the *recorded* one — a fresh or derived timepoint is `WrongTimepoint`.
  const when = { height: 4242, index: 3 };
  const step = deriveApproval(entry([OTHER], when), SIGNER, 2);
  assert.equal(step.kind, 'subsequent');
  assert.deepEqual(step.maybeTimepoint, when);
  assert.equal(step.approvalsSoFar, 1);
});

test('the approval that reaches the threshold is marked as executing', () => {
  // This is the one that dispatches the inner call, so it is the one whose preconditions
  // actually decide an outcome rather than an approval record.
  const reaching = deriveApproval(entry([OTHER]), SIGNER, 2);
  assert.equal(reaching.kind, 'subsequent');
  assert.equal(reaching.executes, true);

  const notYet = deriveApproval(entry([OTHER]), SIGNER, 3);
  assert.equal(notYet.kind, 'subsequent');
  assert.equal(notYet.executes, false);
});

test('a signer who already approved is refused before paying for the rejection', () => {
  const step = deriveApproval(entry([OTHER, SIGNER]), SIGNER, 3);
  assert.equal(step.kind, 'already-approved');
  assert.deepEqual(step.maybeTimepoint, { height: 100, index: 2 });
  const reason = wrapperRefusalReason(step);
  assert.match(reason, /already approved/);
  assert.match(reason, /2 of 3/);
});

test('a refusal reason exists only for the refused step', () => {
  // Anti-vacuity for the assertion above: if `wrapperRefusalReason` returned a string
  // unconditionally, the previous test would pass on a function that refuses everything.
  assert.equal(wrapperRefusalReason(deriveApproval(finalized(null), SIGNER, 2)), undefined);
  assert.equal(wrapperRefusalReason(deriveApproval(entry([OTHER]), SIGNER, 2)), undefined);
});

test('an unknown proxy type is treated as absent, not as permitted (INV-FE-12)', () => {
  // The tempting inversion — "not known to be restricted, so allow" — turns a `NotProxy`
  // rejection into something the user pays for after being told it would work.
  assert.equal(proxyTypeCovers(undefined, 'market.buy'), false);
  assert.equal(proxyTypeCovers('Any', 'market.buy'), true);
  assert.equal(proxyTypeCovers('Governance', 'market.buy'), false);
});

test('a non-positive or fractional threshold is refused rather than coerced', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => deriveApproval(finalized(null), SIGNER, bad), RangeError, `threshold ${bad}`);
  }
});

test('threshold 1 executes on the opening approval', () => {
  // Degenerate but real: `as_multi` with threshold 1 is a plain dispatch. A confirm
  // screen built on "the opening approval never executes" would tell a 1-of-N signer
  // they were recording an intent while the call actually dispatched — the surface
  // describing a different transaction from the one being signed. This assertion is the
  // property; the `kind`/`approvalsNeeded` checks below are not a substitute for it.
  const step = deriveApproval(finalized(null), SIGNER, 1);
  assert.equal(step.kind, 'first');
  assert.equal(step.executes, true);
  assert.equal(step.approvalsNeeded, 1);

  // ...and it must NOT execute at any higher threshold, or the flag says nothing.
  for (const threshold of [2, 3, 7]) {
    const later = deriveApproval(finalized(null), SIGNER, threshold);
    assert.equal(later.executes, false, `opening approval executed at threshold ${threshold}`);
  }
});
