/**
 * Provider health and the honest guarantee — 10 §8.1–§8.4 (F9).
 *
 * The never-promote rule needs no test here: `Finalized<T>` is unnameable outside
 * `chain-client`, so this package cannot produce one whatever it does. What is testable is
 * what the client *says* about a provider, which is where F9's failures live.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SAMPLING_GUARANTEE,
  afterSampling,
  defaultProviders,
  effectiveCoverage,
  shouldAutoDisable,
} from '@bleavit/providers';
import type { Provider } from '@bleavit/providers';

const HERE = dirname(fileURLToPath(import.meta.url));

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
  assert.equal(coverage.ratio, 0.02, 'a 2-of-100 round must not read as a 100-row check');
});

test('coverage reports the ratio and passes no judgement on it', () => {
  // It used to answer `meaningful`, true at or above a 50 % floor written in this package. §8.3's
  // release-constant licence covers how fast an endpoint answers; it does not license a line
  // between weak and strong evidence, and nothing anchored 0.5 (SQ-633). So the report is three
  // numbers, and a caller that wants to describe a round states "n of m were comparable".
  const coverage = effectiveCoverage({ rowsChecked: 100, mismatches: 0, unverifiable: 10 });
  assert.equal(coverage.checked, 90);
  assert.equal(coverage.ratio, 0.9);
  // The one judgement it does make is arithmetic: nothing sampled is a ratio of zero, not of one.
  assert.equal(effectiveCoverage({ rowsChecked: 0, mismatches: 0, unverifiable: 0 }).ratio, 0);
  // And no verdict field came back under another name.
  assert.deepEqual(Object.keys(coverage).sort(), ['checked', 'ofTotal', 'ratio']);
});

test('an auto-disabled provider always carries a reason', () => {
  // A source that vanishes with no explanation reads as a broken app, and the user
  // re-enables it.
  // Annotated rather than inferred: without it `kind` widens to `string` and the fixture is
  // not a `Provider` at all — which is precisely what a suite of object literals hides.
  const provider: Provider = {
    id: 'snapshots.example',
    kind: 'snapshot',
    health: { kind: 'healthy' },
  };
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

test('the guarantee statement is bound to 10 §8.4\'s own sentence, clause by clause', () => {
  // §8.4 calls this copy **normative**, and the shipped string is a plainer-English rendering of
  // it rather than a quotation — deliberately, since it is read by somebody deciding whether to
  // trust a source. What must not happen is the source sentence changing while the rendering
  // stays, so each clause is extracted from the document and paired with the words that carry it
  // here. The extraction fails if the bullet is reworded, which is the point: the pairing is then
  // re-read by a person instead of drifting.
  const doc = readFileSync(
    resolve(HERE, '..', '..', '..', 'docs', 'architecture', '10-frontend-architecture.md'),
    'utf8',
  );
  const bullet = doc
    .split('\n')
    .find((line) => line.startsWith('- **Honest guarantee statement (normative UI copy):**'));
  assert.ok(bullet !== undefined, '10 §8.4 no longer states the guarantee where this expects it');

  const clauses: readonly (readonly [string, RegExp])[] = [
    ['catch malformed, internally inconsistent, and shallow forgeries', /malformed data, internally inconsistent data, shallow forgeries/],
    ['catch liveness failures', /a source that has stopped responding/],
    [
      'They do not detect a self-consistent forgery of history at depths the light client cannot reach.',
      /does not detect a self-consistent forgery of history at a depth this device cannot reach/,
    ],
    [
      'The only available cross-check is diffing two independent snapshot producers',
      /only cross-check for deep history is comparing two independent sources/,
    ],
  ];
  for (const [source, rendered] of clauses) {
    assert.ok(bullet.includes(source), `10 §8.4 no longer says "${source}" — re-read the copy`);
    assert.match(SAMPLING_GUARANTEE, rendered);
  }
});
