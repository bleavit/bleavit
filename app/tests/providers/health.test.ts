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
  allProvidersDown,
  canServeReads,
  canSupplyPinnedImport,
  defaultProviders,
  effectiveCoverage,
  fleetState,
  shouldAutoDisable,
} from '@bleavit/providers';
import type { Provider, ProviderHealth } from '@bleavit/providers';

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
  assert.match(SAMPLING_GUARANTEE, /comparing two independent snapshot producers/);
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
    // Re-pointed 2026-08-07, and it is the **second** time this table was found scoped around
    // the drift it exists to catch. The pair used to read the document's *"two independent
    // snapshot producers"* against a rendering of *"two independent sources"* — so the clause
    // was extracted, the pair passed, and the substituted noun survived every green run exactly
    // as `labels` had. In this client's vocabulary a *source* is any provider (`Provider.kind`
    // is `snapshot | indexer`), and `FE-PROV-004` diffs snapshots only, so the wider noun named
    // a cross-check the client does not implement.
    [
      'The only available cross-check is diffing two independent snapshot producers',
      /only cross-check for deep history is comparing two independent snapshot producers/,
    ],
    // Added 2026-08-06, and its absence was the whole finding: the shipped string rendered
    // *"supports and recommends"* as *"supports and labels"* — a third verb, belonging to a
    // different obligation (INV-FE-15's origin labelling) — and this table extracted the four
    // clauses around it and not this one. A gate scoped around the drift it exists to catch
    // cannot fail on it, so the substitution survived every green run.
    [
      'which the import UI supports and recommends',
      /which this client supports and recommends/,
    ],
  ];
  for (const [source, rendered] of clauses) {
    assert.ok(bullet.includes(source), `10 §8.4 no longer says "${source}" — re-read the copy`);
    assert.match(SAMPLING_GUARANTEE, rendered);
  }
});

test('doc 10 spells the cross-check clause ONE way — §2.3 and §8.4 must agree on the verb', () => {
  // The contradiction the clause above was substituted around, gated so it cannot come back.
  // §8.4 said *"which the import UI supports and recommends"* and §2.3 said *"which the UI
  // supports and discloses"*, of the same control, and a client shipping one fixed string can
  // satisfy only one of them. Ruled in §2.3 under R-1 on 2026-08-06 — §8.4 owns the clause and
  // designates it normative UI copy, and recommending is the stronger and safer obligation
  // because a diff is a falsifier. See PLAN.md · *Decision log*.
  //
  // Fixing `health.ts` without ruling this would have picked a side silently, and the next
  // reader of §2.3 would have found the code disagreeing with the section they were reading.
  const doc = readFileSync(
    resolve(HERE, '..', '..', '..', 'docs', 'architecture', '10-frontend-architecture.md'),
    'utf8',
  );
  const mentions = doc
    .split('\n')
    .filter((line) => /two independent snapshot producers/.test(line))
    .filter((line) => /which the (import )?UI supports and/.test(line));
  assert.ok(mentions.length >= 2, 'doc 10 should state this control in both §2.3 and §8.4');
  for (const line of mentions) {
    assert.match(
      line,
      /which the (import )?UI supports and \*{0,2}recommends/,
      `doc 10 states the cross-check control with a verb other than "recommends": ${line.slice(0, 200)}`,
    );
  }
});

// ------------------------------------------------------------------ the fleet (§8.3's close)

const HEALTHS: readonly ProviderHealth[] = [
  { kind: 'unprobed' },
  { kind: 'healthy' },
  { kind: 'slow', observedMs: 9_000 },
  { kind: 'failing', consecutiveFailures: 2, everAnswered: true },
  { kind: 'disabled', by: 'auto', cause: 'mismatch', reason: 'a spot-checked row did not match' },
  { kind: 'disabled', by: 'user', reason: 'switched off' },
];

function providerAt(index: number): Provider {
  const health = HEALTHS[index];
  assert.ok(health !== undefined);
  return { id: `p${index}`, kind: 'indexer', health };
}

test('§8.3 in one sentence: only Disabled stops reads, and unprobed is before the ladder', () => {
  // The predicate is exhaustive over the ladder rather than a two-name allowlist, so a sixth
  // state cannot be added and default to *serves* — the direction that cannot be walked back.
  // `failing` serving is §8.3's own clause, not a loosening: excluding it was the same ratchet
  // the *consecutive* rule exists to prevent, and it was invisible while nothing called this.
  assert.deepEqual(
    HEALTHS.map((health) => canServeReads({ id: 'p', kind: 'indexer', health })),
    [false, true, true, true, false, false],
  );
  // And the second predicate differs on exactly one state: a pinned file already in the user's
  // hands does not depend on the endpoint having answered a probe (see `canSupplyPinnedImport`).
  assert.deepEqual(
    HEALTHS.map((health) => canSupplyPinnedImport({ id: 'p', kind: 'indexer', health })),
    [true, true, true, true, false, false],
  );
});

test('an empty fleet is §8.1\'s posture and NOT an outage, in both functions', () => {
  // `providers.every(disabled)` answers `true` for an empty list, and a UI driven by it opens on
  // an incident banner every first run. The shipped list is empty (§8.1), so that is every run.
  assert.equal(allProvidersDown([]), false);
  const state = fleetState([]);
  assert.equal(state.kind, 'none-enabled');
  if (state.kind !== 'none-enabled') return;
  assert.match(state.explainer, /shown as gaps rather than filled in/);
});

test('all-down carries every reason and FE-PROV-001, and none-enabled carries neither', () => {
  const state = fleetState([providerAt(4), providerAt(5)]);
  assert.equal(state.kind, 'all-down');
  if (state.kind !== 'all-down') return;
  assert.equal(state.enabled, 2);
  assert.deepEqual(state.reasons, [
    'a spot-checked row did not match',
    'switched off',
  ]);
  assert.equal(state.code, 'FE-PROV-001');
});

test('`serving` is a PERMISSION, and a fleet answering nothing says so rather than reading as fine', () => {
  // The doc said *"sources that have answered a probe and are not switched off"* until
  // 2026-08-06, and the `failing`-serves change made it false in the direction that matters: a
  // `failing` source is one whose last probes did **not** answer, and §8.3's *"only Disabled
  // stops reads"* keeps it serving. So a fleet where every source has timed out twice reports
  // every one of them as serving, and a screen rendering that number alone says *3 sources
  // serving* over a fleet answering nothing.
  const allFailing = [0, 1, 2].map((n) => ({
    id: `p${n}`,
    kind: 'indexer' as const,
    health: { kind: 'failing' as const, consecutiveFailures: 2, everAnswered: true },
  }));
  const state = fleetState(allFailing);
  assert.equal(state.kind, 'serving', 'not all-down: all-down needs every source DISABLED');
  if (state.kind !== 'serving') return;
  assert.equal(state.enabled, 3);
  assert.equal(state.serving, 3, 'permitted to be read — that is what the field means');
  assert.equal(state.failing, 3, 'and none of them answered, which is the half that was missing');
  // `serving - failing` is the count that answered, so both facts are recoverable from the state.
  assert.equal(state.serving - state.failing, 0);
});

test('`failing` is counted apart from `unprobed`, and neither is folded into the other', () => {
  const mixed = [providerAt(1), providerAt(3), providerAt(0)];
  const state = fleetState(mixed);
  assert.equal(state.kind, 'serving');
  if (state.kind !== 'serving') return;
  assert.equal(state.enabled, 3);
  assert.equal(state.serving, 2, 'healthy and failing serve; unprobed does not');
  assert.equal(state.failing, 1);
  assert.equal(state.unprobed, 1);
});

test('`fleetState` decides all-down THROUGH `allProvidersDown`, not beside it', () => {
  // Two copies of one §8.3 sentence, and only the inline one ran: the exported predicate had no
  // caller anywhere, so editing the tested copy changed nothing the client does. Asserted over
  // every fleet of two, which is where the two spellings could differ at all.
  for (const first of HEALTHS.keys()) {
    for (const second of HEALTHS.keys()) {
      const fleet = [providerAt(first), providerAt(second)];
      assert.equal(
        fleetState(fleet).kind === 'all-down',
        allProvidersDown(fleet),
        `the two disagree on ${HEALTHS[first]?.kind} + ${HEALTHS[second]?.kind}`,
      );
    }
  }
});
