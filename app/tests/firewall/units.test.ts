/**
 * The §10.2 compilation units, checked against the specification's own reference sets.
 *
 * ## The hole this closes
 *
 * 10 §10.2 states an **exact reference set** per unit:
 *
 * > `app/src/features/tx/**` … references exactly `{shared-types, chain-client, protocol,
 * > simulation, transaction-builder, signing, platform, ui}`.
 *
 * Those sets are the primary gate — pnpm's isolated `node_modules` makes an undeclared import
 * unresolvable, so the manifest **is** the firewall. And until 2026-08-06 nothing compared a
 * manifest against the document: `firewall.test.ts` proves the corpus fixtures fail to compile,
 * and dependency-cruiser proves the edges it names are refused. Neither notices a *widened
 * manifest*. Adding `@bleavit/providers` to `src/features/tx/package.json` makes the forbidden
 * import resolve, the negative fixture keeps failing (it is compiled standalone, from
 * `tests/firewall`, where the package is unresolvable for its own reason), and the
 * dependency-cruiser rule only fires once somebody writes the import. So the boundary could be
 * removed and the corpus would stay green — which is the shape this repository keeps finding:
 * a control that is present and no longer able to detect anything.
 *
 * ## Why the expected sets are parsed from doc 10 rather than written here
 *
 * A list transcribed into a test agrees with the transcriber, not with the specification. §10.2
 * carries the three sets in one sentence each, in a fixed form, so they are extracted from the
 * document itself: a spec amendment that widens a unit changes this test's expectation, which is
 * correct, and a *silent* widening of a manifest fails it, which is the point. The extractor is
 * strict — it refuses to run on a §10.2 it cannot parse — because an extractor that fell back to
 * an empty set would turn a rewritten spec into a vacuous test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..', '..');
const DOC10 = resolve(APP, '..', 'docs', 'architecture', '10-frontend-architecture.md');

const UNITS = ['tx', 'analysis', 'handoff'] as const;
type Unit = (typeof UNITS)[number];

/**
 * Pull each unit's reference set out of §10.2.
 *
 * The pattern is anchored on the document's own phrasing — a bulleted line naming the unit's
 * path, then `references` (optionally `exactly`), then a brace-delimited list. Anything else
 * is a parse failure rather than a smaller set.
 */
function declaredSets(): ReadonlyMap<Unit, readonly string[]> {
  const doc = readFileSync(DOC10, 'utf8');
  const found = new Map<Unit, readonly string[]>();
  for (const unit of UNITS) {
    const pattern = new RegExp(
      `app/src/features/${unit}/\\*\\*[^\\n]*?references(?: exactly)? \`?\\{([^}]*)\\}`,
    );
    const match = pattern.exec(doc);
    assert.ok(
      match !== null,
      `10 §10.2 no longer states a reference set for features/${unit} in the form this test ` +
        'parses. Fix the extractor against the new wording — do not delete the test, because ' +
        'an unparsed set is an unchecked boundary.',
    );
    const names = (match[1] ?? '')
      .split(',')
      .map((name) => name.replace(/[`*\s]/g, ''))
      .filter((name) => name.length > 0);
    assert.ok(names.length > 0, `features/${unit}'s reference set parsed as empty`);
    found.set(unit, names.sort());
  }
  return found;
}

function manifestDependencies(unit: Unit): readonly string[] {
  const manifest = JSON.parse(
    readFileSync(join(APP, 'src', 'features', unit, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  return Object.keys(manifest.dependencies ?? {})
    .map((name) => name.replace(/^@bleavit\//, ''))
    .sort();
}

const DECLARED = declaredSets();

test('the extractor found all three reference sets — otherwise this suite proves nothing', () => {
  assert.equal(DECLARED.size, UNITS.length);
  // The tx unit is the one that matters most and the one whose set is smallest, so a parse that
  // silently produced the *other* unit's list would show up here.
  assert.ok(!DECLARED.get('tx')?.includes('providers'));
  assert.ok(DECLARED.get('analysis')?.includes('providers'));
});

for (const unit of UNITS) {
  test(`src/features/${unit}'s manifest is EXACTLY 10 §10.2's reference set`, () => {
    const expected = DECLARED.get(unit) ?? [];
    const actual = manifestDependencies(unit);
    assert.deepEqual(
      actual,
      [...expected],
      `src/features/${unit}/package.json and 10 §10.2 disagree about this unit's reference ` +
        'set. The manifest IS the primary firewall gate — pnpm\'s isolated node_modules makes ' +
        'an undeclared import unresolvable — so a widened manifest silently removes the ' +
        'boundary while every other suite stays green. Change the spec first (R-1) if the ' +
        'widening is intended.',
    );
  });
}

test('the tx unit can reach no acceleration or handoff package, by manifest', () => {
  // Restated as the property rather than as a set comparison, because this is the sentence
  // INV-FE-3 actually makes: "provider-supplied data … is barred from the transaction path
  // structurally — by build-time package dependency boundaries enforced in CI".
  const forbidden = [
    'providers',
    'local-index',
    'contexts',
    'intents',
    'receipts',
    'llm-handoff',
    'handoff-envelope',
    'features-analysis',
    'features-handoff',
  ];
  const reachable = manifestDependencies('tx');
  assert.deepEqual(
    forbidden.filter((name) => reachable.includes(name)),
    [],
  );
});
