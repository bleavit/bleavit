/**
 * The P-1…P-15 precondition tables — 11 §11.5.
 *
 * What is worth testing about a table of declarations is the *binding*, not the contents:
 * the contents are the spec's, and restating them here would only prove the file was
 * copied twice. So these assert the two properties a declaration can get wrong silently —
 * that every clause reads from a surface the chain actually publishes, and that a clause
 * marked as a constants-API read really cites a constant.
 *
 * The first is also enforced by the compiler (`SurfaceId` is a generated literal union),
 * and that is deliberately not a reason to skip it here. The type-level version of this
 * check shipped broken: `(typeof CRITICAL_SURFACE)[number]['id']` widens to `string`
 * because the array carries an explicit annotation, so every clause typechecked against
 * every string. A runtime assertion cannot be widened away.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_CLAUSES,
  NO_WRAPPER,
  PRECONDITION_ROWS,
  accountForClause,
  clausesNeedingOtherAccounts,
  rowsFor,
} from '@bleavit/transaction-builder';
import { CRITICAL_SURFACE } from '@bleavit/descriptors';

const ROW_IDS = [
  'P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6', 'P-7', 'P-8',
  'P-9', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15',
];

test('11 §11.5 publishes fifteen rows and every one carries clauses', () => {
  assert.deepEqual(Object.keys(PRECONDITION_ROWS).sort(), [...ROW_IDS].sort());
  for (const id of ROW_IDS) {
    assert.ok(rowsFor(id).length > 0, `${id} has no clauses — it would pass the gate by default`);
  }
});

test('every clause reads from a surface the frozen manifest publishes', () => {
  const published = new Set(CRITICAL_SURFACE.map((entry) => entry.id));
  assert.ok(published.size > 100, 'the surface set looks empty — this test would be vacuous');
  for (const clause of ALL_CLAUSES) {
    assert.ok(
      published.has(clause.surface),
      `${clause.row} reads ${clause.surface}, which the runtime does not publish`,
    );
  }
});

test('a clause marked as a constants-API read cites a constant, and vice versa', () => {
  // 11 §11.4 rule 2 makes the constants API a *distinct* source, not a variant of storage:
  // MinSplit, MinTransfer, MaxPositionsPerAccount and the per-trade bounds have no storage
  // representation at all. A clause that looked for one in storage would find nothing and
  // have to invent a default — the hardcode X-11e/X-11h forbid. Both directions, because
  // reading a *storage* item through the constants API fails just as silently.
  const group = new Map(CRITICAL_SURFACE.map((entry) => [entry.id, entry.compatGroup]));
  const expected = { constant: 'constants', storage: 'query', 'runtime-api': 'apis' };
  for (const clause of ALL_CLAUSES) {
    assert.equal(
      group.get(clause.surface),
      expected[clause.source],
      `${clause.row} declares source '${clause.source}' but ${clause.surface} is a ` +
        `'${group.get(clause.surface)}' surface`,
    );
  }
});

test('the constants-API clauses are the ones 11 §11.5 marks [C]', () => {
  // Anti-vacuity for the test above: if no clause were marked `constant`, the both-ways
  // check would pass over an empty set. 11 §11.5 marks per-trade bounds, MinSplit,
  // MinTransfer and MaxPositionsPerAccount with `[C]`, so those must be present.
  const constants = ALL_CLAUSES.filter((clause) => clause.source === 'constant');
  assert.ok(constants.length >= 8, `only ${constants.length} constants-API clauses`);
  const cited = new Set(constants.map((clause) => clause.surface));
  for (const required of [
    'constant.ledger.min_split',
    'constant.ledger.min_transfer',
    'constant.ledger.max_positions_per_account',
    'constant.market.min_trade',
    'constant.market.max_trade_ratio',
  ]) {
    assert.ok(cited.has(required), `11 §11.5 marks ${required} [C] and no clause reads it`);
  }
});

test('P-12 points at the dispatch-check mirror rather than restating it', () => {
  // 09 §1.2 ↔ 11 §11.5's execute list is diffed by tools/ci/check-dispatch-mirror.py
  // (15 §4.8). A second full copy here would be something for that gate to agree with
  // instead of a source to check — which is the shape of the defect SQ-552 was.
  assert.ok(
    rowsFor('P-12').length < 13,
    'P-12 has grown into a full copy of the dispatch list; the mirror gate owns that diff',
  );
});

test('rowsFor refuses an unknown row rather than returning an empty set', () => {
  // An empty precondition set is indistinguishable from "nothing to check", and a call
  // that reached the gate with no rows would pass it (11 §11.4 rule 1).
  assert.throws(() => rowsFor('P-99'), /refusing to treat that as "nothing to check"/);
});

// ---------------------------------------------------------------------------
// Clause subjects — 11 §11.3's multisig and proxy wrappers, applied to the table.
//
// The defect these guard is not an encoding mistake but a silent misattribution: a
// wrapped call executes as the multisig or proxied account while the signer pays, so a
// clause with no subject implicitly reads "the signer" and checks the wrong balance.
// It fails green — the signer is healthy, every row passes, and the runtime rejects the
// inner call because the proxied account is short.
// ---------------------------------------------------------------------------

test('every clause declares whose account it reads', () => {
  const subjects = new Set(['chain', 'acting', 'signer', 'recipient']);
  for (const c of ALL_CLAUSES) {
    assert.ok(subjects.has(c.subject), `${c.row} "${c.requirement}" has subject ${c.subject}`);
  }
});

test('no clause reads one account for two different questions', () => {
  // The conflation this splits: 11 §11.5's P-3 text is "USDC balance >= amount + fee
  // headroom", which is one read only while signer and origin coincide. A clause whose
  // requirement names both a spendable amount and a fee is checking two accounts under a
  // wrapper, so the table must not contain one.
  const conflated = ALL_CLAUSES.filter(
    (c) => /\bfee\b/.test(c.requirement) && /\b(balance|covers the amount|holds?)\b/.test(c.requirement) && c.subject !== 'signer',
  );
  assert.deepEqual(
    conflated.map((c) => `${c.row}: ${c.requirement}`),
    [],
    'a clause mixes a spendable balance with a fee; split it by subject',
  );
});

test('P-3 checks the amount against the acting account and the fee against the signer', () => {
  const p3 = rowsFor('P-3');
  const amount = p3.find((c) => c.requirement.includes('covers the amount'));
  const fee = p3.find((c) => c.requirement.includes('fee headroom'));
  assert.ok(amount && fee, 'P-3 lost its split balance clauses');
  assert.equal(amount.subject, 'acting');
  assert.equal(fee.subject, 'signer');
});

test('an unwrapped call resolves every clause to the signer', () => {
  const SIGNER = '5Signer';
  for (const c of ALL_CLAUSES) {
    if (c.subject === 'recipient') continue;
    const who = accountForClause(c, NO_WRAPPER, SIGNER);
    if (c.subject === 'chain') assert.equal(who, undefined, `${c.row} chain clause named an account`);
    else assert.equal(who, SIGNER, `${c.row} "${c.requirement}"`);
  }
});

test('a proxy sends acting clauses to `real` and fee clauses to the signer', () => {
  const SIGNER = '5Signer';
  const wrapper = { kind: 'proxy', real: '5Real', proxyType: 'Any' };
  const p3 = rowsFor('P-3');
  const amount = p3.find((c) => c.requirement.includes('covers the amount'));
  const fee = p3.find((c) => c.requirement.includes('fee headroom'));
  assert.equal(accountForClause(amount, wrapper, SIGNER), '5Real');
  assert.equal(accountForClause(fee, wrapper, SIGNER), SIGNER);
  // The two must differ, or the split is decorative.
  assert.notEqual(accountForClause(amount, wrapper, SIGNER), accountForClause(fee, wrapper, SIGNER));
});

test('a multisig sends acting clauses to the multisig account', () => {
  const SIGNER = '5Signer';
  const wrapper = { kind: 'multisig', multisig: '5Multi', threshold: 2, otherSignatories: ['5Other'] };
  const acting = ALL_CLAUSES.find((c) => c.subject === 'acting');
  assert.equal(accountForClause(acting, wrapper, SIGNER), '5Multi');
  assert.equal(accountForClause({ ...acting, subject: 'signer' }, wrapper, SIGNER), SIGNER);
});

test('a recipient clause refuses to fall back to the signer', () => {
  // P-9's bounds are about the destination. Substituting the sender would check a healthy
  // sender's position count against the recipient's bound and pass a transfer the runtime
  // refuses — so an absent recipient throws rather than defaulting.
  const recipientClause = ALL_CLAUSES.find((c) => c.subject === 'recipient');
  assert.ok(recipientClause, 'P-9 lost its recipient clauses');
  assert.throws(() => accountForClause(recipientClause, NO_WRAPPER, '5Signer'), /recipient/);
  assert.equal(accountForClause(recipientClause, NO_WRAPPER, '5Signer', '5Dest'), '5Dest');
});

test('wrapping actually moves reads off the signer', () => {
  // Anti-vacuity for the whole mechanism: if no row had an account-scoped clause, every
  // test above would pass while the wrapper changed nothing that gets read.
  const SIGNER = '5Signer';
  const proxied = { kind: 'proxy', real: '5Real', proxyType: 'Any' };
  assert.equal(clausesNeedingOtherAccounts('P-1', NO_WRAPPER, SIGNER).length, 0);
  assert.ok(
    clausesNeedingOtherAccounts('P-1', proxied, SIGNER).length >= 2,
    'P-1 has no clause the proxy moves; the split would be inert',
  );
});

test('the acting subject is used by more than one row', () => {
  // A single acting clause in a single row would satisfy every assertion above while
  // leaving the other fourteen rows implicitly reading the signer.
  const rows = new Set(ALL_CLAUSES.filter((c) => c.subject === 'acting').map((c) => c.row));
  assert.ok(rows.size >= 8, `only ${rows.size} rows carry an acting clause`);
});
