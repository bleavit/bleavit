/**
 * Provider health and the honest guarantee — 10 §8.1–§8.4 (F9).
 *
 * The never-promote rule needs no test here: `Finalized<T>` is unnameable outside
 * `chain-client`, so this package cannot produce one whatever it does. What is testable is
 * what the client *says* about a provider, which is where F9's failures live.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLING_GUARANTEE,
  afterSampling,
  defaultProviders,
  effectiveCoverage,
  shouldAutoDisable,
} from '@bleavit/providers';

test('the shipped provider list is empty, from a function with nothing to inherit', () => {
  // 10 §8.1: strictly opt-in in every mode. A configurable default is how "opt-in" quietly
  // becomes "on for most people" — the same reason `defaultScope()` takes no argument.
  assert.deepEqual(defaultProviders(), []);
  assert.equal(defaultProviders.length, 0, 'the default takes an argument it could inherit from');
});

test('any mismatch disables — there is no acceptable error rate', () => {
  // §8.3 says "auto-disable on sampling mismatch" with no threshold. A threshold is what
  // turns one caught lie into a tolerated one.
  assert.equal(shouldAutoDisable({ rowsChecked: 1000, mismatches: 1, unverifiable: 0 }), true);
  assert.equal(shouldAutoDisable({ rowsChecked: 1000, mismatches: 0, unverifiable: 0 }), false);
});

test('unverifiable rows count neither way', () => {
  // A row whose object is gone proves nothing. Counting it as a pass would let a provider
  // evade sampling by serving only unverifiable rows — the cheapest available evasion.
  assert.equal(shouldAutoDisable({ rowsChecked: 100, mismatches: 0, unverifiable: 100 }), false);
  const coverage = effectiveCoverage({ rowsChecked: 100, mismatches: 0, unverifiable: 98 });
  assert.equal(coverage.checked, 2);
  assert.equal(coverage.ofTotal, 100);
  assert.equal(coverage.meaningful, false, 'a 2-of-100 round must not read as a 100-row check');
});

test('a round that really did check is reported as meaningful', () => {
  // The anti-vacuity control: without it every assertion above passes for the trivial
  // reason that nothing is ever meaningful.
  const coverage = effectiveCoverage({ rowsChecked: 100, mismatches: 0, unverifiable: 10 });
  assert.equal(coverage.checked, 90);
  assert.equal(coverage.meaningful, true);
  assert.equal(effectiveCoverage({ rowsChecked: 0, mismatches: 0, unverifiable: 0 }).meaningful, false);
});

test('an auto-disabled provider always carries a reason', () => {
  // A source that vanishes with no explanation reads as a broken app, and the user
  // re-enables it.
  const provider = { id: 'snapshots.example', kind: 'snapshot', health: { kind: 'healthy' } };
  const after = afterSampling(provider, { rowsChecked: 64, mismatches: 3, unverifiable: 0 });
  assert.equal(after.health.kind, 'disabled');
  assert.equal(after.health.by, 'auto');
  assert.match(after.health.reason, /3 of 64/);
  assert.match(after.health.reason, /nothing it supplied was ever treated as verified/);
  // A clean round leaves it alone.
  assert.equal(
    afterSampling(provider, { rowsChecked: 64, mismatches: 0, unverifiable: 0 }).health.kind,
    'healthy',
  );
});

test('the guarantee statement includes the half that is unflattering', () => {
  // §8.4 makes this normative UI copy. A client stating only the first half would be
  // claiming a guarantee the design explicitly declines to make.
  assert.match(SAMPLING_GUARANTEE, /malformed/);
  assert.match(SAMPLING_GUARANTEE, /does not detect a self-consistent forgery/);
  assert.match(SAMPLING_GUARANTEE, /comparing two independent sources/);
});
