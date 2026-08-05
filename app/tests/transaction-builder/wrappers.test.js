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
  PROXY_DELEGATION_SURFACE,
  actingAccount,
  deriveApproval,
  proxyAdmits,
  feePayer,
  proxyTypeCovers,
  splitsIdentity,
  wrapperRefusalReason,
} from '@bleavit/transaction-builder';
import { CRITICAL_SURFACE } from '@bleavit/descriptors';

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
/**
 * The `(multisig, callHash)` key every `Multisig.Multisigs` read belongs to (02 §7.6).
 * Carried by the helpers because a read without its key is what finding #4 was about.
 */
const KEY = { multisig: MULTI, callHash: `0x${'ab'.repeat(32)}` };
const OTHER_KEY = { multisig: MULTI, callHash: `0x${'cd'.repeat(32)}` };

const read = (entry, key = KEY) => finalized({ key, entry });
const absent = (key = KEY) => read(null, key);
const entry = (approvals, when = { height: 100, index: 2 }, key = KEY) =>
  read({ when, deposit: 1n, depositor: OTHER, approvals }, key);

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
  const step = deriveApproval(absent(), KEY, SIGNER, 2);
  assert.equal(step.kind, 'first');
  assert.equal(step.maybeTimepoint, undefined);
  assert.equal(step.approvalsSoFar, 0);
  assert.equal(step.approvalsNeeded, 2);
});

test('an existing entry means the recorded timepoint MUST be carried', () => {
  // And it must be the *recorded* one — a fresh or derived timepoint is `WrongTimepoint`.
  const when = { height: 4242, index: 3 };
  const step = deriveApproval(entry([OTHER], when), KEY, SIGNER, 2);
  assert.equal(step.kind, 'subsequent');
  assert.deepEqual(step.maybeTimepoint, when);
  assert.equal(step.approvalsSoFar, 1);
});

test('the approval that reaches the threshold is marked as executing', () => {
  // This is the one that dispatches the inner call, so it is the one whose preconditions
  // actually decide an outcome rather than an approval record.
  const reaching = deriveApproval(entry([OTHER]), KEY, SIGNER, 2);
  assert.equal(reaching.kind, 'subsequent');
  assert.equal(reaching.executes, true);

  const notYet = deriveApproval(entry([OTHER]), KEY, SIGNER, 3);
  assert.equal(notYet.kind, 'subsequent');
  assert.equal(notYet.executes, false);
});

test('a signer who already approved is refused before paying for the rejection', () => {
  const step = deriveApproval(entry([OTHER, SIGNER]), KEY, SIGNER, 3);
  assert.equal(step.kind, 'already-approved');
  assert.deepEqual(step.maybeTimepoint, { height: 100, index: 2 });
  const reason = wrapperRefusalReason(step);
  assert.match(reason, /already approved/);
  assert.match(reason, /2 of 3/);
});

test('an already-approved signer COMPLETES a threshold-ready call', () => {
  // The defect this replaced: `already-approved` was returned on membership alone, so a
  // 2-of-2 whose members had both used `approve_as_multi` — which stores a hash-only
  // approval and never carries a call — had *no* member able to complete it from the
  // canonical client. That is a client refusing what the runtime accepts, the direction
  // 15 §4.8's mirror rule forbids.
  //
  // The runtime is unambiguous (`operate`, pallet-multisig 49.0.0): the execution branch
  // `maybe_call.filter(|_| approvals >= threshold)` is evaluated BEFORE the
  // `AlreadyApproved` arm, so supplying the full call dispatches it.
  const step = deriveApproval(entry([OTHER, SIGNER]), KEY, SIGNER, 2);
  assert.equal(step.kind, 'completes');
  assert.equal(step.executes, true);
  assert.equal(step.dispatch, 'as_multi');
  assert.equal(step.alreadyApproved, true);
  assert.deepEqual(step.maybeTimepoint, { height: 100, index: 2 });
  // And it is not refused, which is the whole user-visible consequence.
  assert.equal(wrapperRefusalReason(step), undefined);
});

test('a signatory who never approved also completes an already-met threshold', () => {
  // `maybe_pos` is filtered at `approvals < threshold`, so once the threshold is met the
  // runtime records NO approval — it just dispatches. Reporting this as `subsequent` would
  // tell the user their approval reaches the threshold when the threshold was already
  // reached and their approval is never stored.
  const step = deriveApproval(entry([OTHER, '5Third']), KEY, SIGNER, 2);
  assert.equal(step.kind, 'completes');
  assert.equal(step.alreadyApproved, false);
  assert.equal(step.executes, true);
});

test('the already-approved refusal survives while the threshold is still short', () => {
  // Anti-vacuity for the two above: a fix that returned `completes` unconditionally would
  // delete the refusal, and this is the case the runtime really does reject —
  // `approvals < threshold` with the signer on the list finds no insertion position and
  // returns `AlreadyApproved`.
  const step = deriveApproval(entry([OTHER, SIGNER]), KEY, SIGNER, 3);
  assert.equal(step.kind, 'already-approved');
  assert.match(wrapperRefusalReason(step), /already approved/);
});

test('the threshold-met boundary is exact, not approximate', () => {
  // n === threshold is `completes`; n === threshold - 1 is still an approval to be made.
  // An off-by-one here is invisible in the happy path and wrong in both directions: too
  // eager offers an execution the runtime will not perform, too lazy refuses a lawful one.
  assert.equal(deriveApproval(entry([OTHER, SIGNER]), KEY, SIGNER, 2).kind, 'completes');
  assert.equal(deriveApproval(entry([OTHER]), KEY, SIGNER, 2).kind, 'subsequent');
  assert.equal(deriveApproval(entry([OTHER]), KEY, SIGNER, 1).kind, 'first', 'threshold 1 short-circuits');
});

test('a refusal reason exists only for the refused step', () => {
  // Anti-vacuity for the assertion above: if `wrapperRefusalReason` returned a string
  // unconditionally, the previous test would pass on a function that refuses everything.
  assert.equal(wrapperRefusalReason(deriveApproval(absent(), KEY, SIGNER, 2)), undefined);
  assert.equal(wrapperRefusalReason(deriveApproval(entry([OTHER]), KEY, SIGNER, 2)), undefined);
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
    assert.throws(() => deriveApproval(absent(), KEY, SIGNER, bad), RangeError, `threshold ${bad}`);
  }
});

test('threshold 1 executes on the opening approval', () => {
  // Degenerate but real: `as_multi` with threshold 1 is a plain dispatch. A confirm
  // screen built on "the opening approval never executes" would tell a 1-of-N signer
  // they were recording an intent while the call actually dispatched — the surface
  // describing a different transaction from the one being signed. This assertion is the
  // property; the `kind`/`approvalsNeeded` checks below are not a substitute for it.
  const step = deriveApproval(absent(), KEY, SIGNER, 1);
  assert.equal(step.kind, 'first');
  assert.equal(step.executes, true);
  assert.equal(step.approvalsNeeded, 1);

  // ...and it must NOT execute at any higher threshold, or the flag says nothing.
  for (const threshold of [2, 3, 7]) {
    const later = deriveApproval(absent(), KEY, SIGNER, threshold);
    assert.equal(later.executes, false, `opening approval executed at threshold ${threshold}`);
  }
});

/* ============================================================================
 * The adversarial-review round: findings #3, #4 and #5 (F6 majors).
 * ========================================================================== */

test('an approval read at another call’s key is refused, not reused (#4)', () => {
  // 02 §7.6 keys Multisig.Multisigs by (AccountId, [u8;32]) — one multisig can have any
  // number of concurrent pending calls. `deriveApproval` took an unkeyed entry, so a read
  // for call hash H1 could be supplied while building H2.
  assert.throws(
    () => deriveApproval(entry([OTHER], { height: 100, index: 2 }, OTHER_KEY), KEY, SIGNER, 2),
    /refusing to treat one pending call's approval state as another's/,
  );
  // Same multisig, same hash, different multisig account: also refused.
  const elsewhere = { multisig: OTHER, callHash: KEY.callHash };
  assert.throws(() => deriveApproval(absent(elsewhere), KEY, SIGNER, 2), /refusing to treat/);
  // The matching key still works, or this test would pass by refusing everything.
  assert.equal(deriveApproval(absent(), KEY, SIGNER, 2).kind, 'first');
});

test('a stale ABSENCE is refused too — the dangerous half of #4', () => {
  // The subtle direction. A `null` read at H1 says only that H1 has no approvals; used for
  // H2 it reads as "nobody has approved yet", so the client sends maybe_timepoint: None for
  // a call that HAS a recorded timepoint. `as_multi` rejects it, after the user has paid.
  // An implementation that only checked the key when an entry was present would pass the
  // test above and fail here.
  assert.throws(() => deriveApproval(absent(OTHER_KEY), KEY, SIGNER, 2), /refusing to treat/);
});

test('threshold 1 dispatches as_multi_threshold_1, never as_multi (#5)', () => {
  // pallet-multisig 46.0.0 ensures `threshold >= 2` at three entry points
  // (MinimumThreshold). The 1-of-N dispatch is as_multi_threshold_1, which 11 §11.5's
  // check 13 already names in the SafetyFilter closure. Marking threshold 1 as executing
  // "through as_multi" described a call the runtime refuses outright.
  const one = deriveApproval(absent(), KEY, SIGNER, 1);
  assert.equal(one.dispatch, 'as_multi_threshold_1');
  assert.equal(one.executes, true);
  assert.equal(one.maybeTimepoint, undefined, 'as_multi_threshold_1 takes no timepoint');

  // Every threshold >= 2 uses as_multi, or the distinction is decorative.
  for (const threshold of [2, 3, 64]) {
    assert.equal(deriveApproval(absent(), KEY, SIGNER, threshold).dispatch, 'as_multi');
    assert.equal(deriveApproval(entry([OTHER]), KEY, SIGNER, threshold).dispatch, 'as_multi');
  }
});

test('threshold 1 ignores any stored entry rather than reporting a queue (#5)', () => {
  // as_multi_threshold_1 stores nothing, so an entry at this key cannot describe this
  // dispatch. Reporting "1 of 1 approvals recorded" from it would put a queue on screen
  // that does not exist.
  const step = deriveApproval(entry([OTHER]), KEY, SIGNER, 1);
  assert.equal(step.kind, 'first');
  assert.equal(step.approvalsSoFar, 0);
  assert.equal(step.dispatch, 'as_multi_threshold_1');
});

/* --------------------------------------------------------- #3 proxy delegation */

const delegation = (over = {}) => ({ delegate: SIGNER, proxyType: 'Any', delay: 0, ...over });
const readDelegations = (...delegations) =>
  ({ kind: 'read', read: finalized({ real: REAL, delegations }) });

test('a proxy wrapper with no delegation on chain is refused (#3)', () => {
  // The check did not exist. A wrapper could name `real = R` with proxyType 'Any', every
  // row would be evaluated against R — correctly, since that is the acting account — and
  // nothing established the signer may act for R at all. `pallet_proxy::proxy` returns
  // NotProxy after signature.
  const none = proxyAdmits(readDelegations(), REAL, SIGNER, 'ledger.split');
  assert.equal(none.ok, false);
  assert.match(none.reason, /NotProxy/);

  // A delegation to somebody else is not weaker evidence; it is about another account.
  const other = proxyAdmits(
    readDelegations(delegation({ delegate: OTHER })),
    REAL,
    SIGNER,
    'ledger.split',
  );
  assert.equal(other.ok, false);
});

test('an unreadable delegation set is absent, never assumed (#3, INV-FE-12)', () => {
  // The read can fail for ordinary reasons — smoldot still syncing, the pinned block
  // pruned. An empty array and an unperformed read must not be the same value: the first
  // means "nobody may act for this account", the second means "we do not know". Only one
  // of them is safe to act on, and it is not the one that looks like a pass.
  const unknown = proxyAdmits(
    { kind: 'unreadable', reason: 'the light client has no finalized block yet' },
    REAL,
    SIGNER,
    'x',
  );
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /no finalized block/);
});

test('a delegation read taken for another account is refused, not reused (SQ-590)', () => {
  // `Proxy.Proxies` is a MAP. A read keyed on someone else says nothing about `real`, and
  // its emptiness is the dangerous half: reported as "no delegation" it is indistinguishable
  // from a genuine absence, while reported as an admission it authorises a call the runtime
  // rejects with NotProxy. Refusing is the only reading that is about this transaction.
  const elsewhere = { kind: 'read', read: finalized({ real: OTHER, delegations: [delegation()] }) };
  const wrong = proxyAdmits(elsewhere, REAL, SIGNER, 'ledger.split');
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /Refusing to decide one account's proxy rights/);

  // An EMPTY read at the wrong key is refused too — the direction an implementation that
  // only checked the key when a delegation was present would get wrong, exactly as the
  // multisig stale-absence case above.
  const emptyElsewhere = { kind: 'read', read: finalized({ real: OTHER, delegations: [] }) };
  assert.match(proxyAdmits(emptyElsewhere, REAL, SIGNER, 'x').reason, /Refusing to decide/);
});

test('the STORED proxy type governs, not the one the wrapper claims (#3)', () => {
  // Checking a caller-supplied 'Any' against itself is self-agreement, not a check.
  const restricted = proxyAdmits(
    readDelegations(delegation({ proxyType: 'Governance' })),
    REAL,
    SIGNER,
    'ledger.split',
  );
  assert.equal(restricted.ok, false);
  assert.match(restricted.reason, /INV-FE-12/);
});

test('an announcement delay refuses the direct proxy call and says why (#3)', () => {
  // A non-zero delay makes the delegation announce-only: `proxy` is rejected with
  // Unannounced, and the call must go through announce + proxy_announced.
  const delayed = proxyAdmits(
    readDelegations(delegation({ delay: 10 })),
    REAL,
    SIGNER,
    'ledger.split',
  );
  assert.equal(delayed.ok, false);
  assert.match(delayed.reason, /announcement delay of 10 blocks/);
});

test('a real delegation is admitted, so the refusals are not vacuous (#3)', () => {
  const ok = proxyAdmits(readDelegations(delegation()), REAL, SIGNER, 'ledger.split');
  assert.equal(ok.ok, true);
  assert.equal(ok.delegation.delegate, SIGNER);
  // Picked from a set that also contains unusable rows, rather than "the first one".
  const mixed = proxyAdmits(
    readDelegations(delegation({ delay: 5 }), delegation({ proxyType: 'Governance' }), delegation()),
    REAL,
    SIGNER,
    'ledger.split',
  );
  assert.equal(mixed.ok, true);
  assert.equal(mixed.delegation.delay, 0);
});

test('the delegation surface is the one 02 §7.6 freezes, and it is probed (SQ-590)', () => {
  // The citation is bound to the generated CRITICAL_SURFACE rather than written as prose,
  // which is the half a mandate stated in words cannot supply: 10 §5.2's classifier probes
  // exactly the frozen set, so a surface that is merely *described* as required is one the
  // compatibility lattice can never fail on. Asserting the id exists in CRITICAL_SURFACE is
  // therefore the test — a string equality against itself would prove nothing.
  assert.equal(PROXY_DELEGATION_SURFACE, 'storage.proxy.proxies');
  const entryFor = CRITICAL_SURFACE.find((e) => e.id === PROXY_DELEGATION_SURFACE);
  assert.ok(entryFor, 'Proxy.Proxies is not in CRITICAL_SURFACE — 02 §7.6 must freeze it');
  assert.equal(entryFor.pallet, 'Proxy');
  assert.equal(entryFor.member, 'Proxies');
  assert.equal(entryFor.required, true, 'an optional delegation read is not a precondition');
});
