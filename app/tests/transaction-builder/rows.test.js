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

import { ALL_CLAUSES, PRECONDITION_ROWS, rowsFor } from '@bleavit/transaction-builder';
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
