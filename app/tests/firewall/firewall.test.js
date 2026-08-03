/**
 * The negative-compilation corpus — 10 §10.2, 15 §4.8.
 *
 * Every other suite in doc 15 §4.8 tests that the app WORKS. This is the only one
 * that tests that the firewall REJECTS. A fixture that starts compiling is a
 * firewall regression, and it is the kind of regression nothing else would catch:
 * an unbranded `Finalized<T>` or a hoisted `node_modules` leaves every positive
 * test green.
 *
 * Each fixture is compiled on its own. `POSITIVE-CONTROL.ts` must succeed —
 * without it, a corpus where every fixture failed for an unrelated reason (a
 * broken tsconfig, a missing lib) would masquerade as a working firewall.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const tsc = resolve(here, '../../node_modules/.bin/tsc');

/** Compile one fixture in isolation. Returns { ok, output }. */
function compile(fixture) {
  try {
    execFileSync(
      tsc,
      [
        join(fixtureDir, fixture),
        '--noEmit',
        '--strict',
        '--target', 'ES2022',
        '--module', 'ESNext',
        '--moduleResolution', 'Bundler',
        '--skipLibCheck',
      ],
      { cwd: here, stdio: 'pipe', encoding: 'utf8' },
    );
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const fixtures = readdirSync(fixtureDir).filter((f) => f.endsWith('.ts'));
const forbidden = fixtures.filter((f) => !f.startsWith('POSITIVE-CONTROL'));

test('anti-vacuity: the positive control compiles', () => {
  const { ok, output } = compile('POSITIVE-CONTROL.ts');
  assert.equal(
    ok,
    true,
    'The positive control must compile. If it does not, every "rejected" result below ' +
      `is meaningless because the toolchain cannot succeed at all.\n${output}`,
  );
});

test('the corpus is not empty', () => {
  assert.ok(forbidden.length >= 5, `expected >= 5 forbidden fixtures, found ${forbidden.length}`);
});

for (const fixture of forbidden) {
  test(`firewall rejects: ${fixture}`, () => {
    const { ok, output } = compile(fixture);
    assert.equal(
      ok,
      false,
      `${fixture} COMPILED. This is a firewall regression, not a test failure — ` +
        'a forbidden import or a forgeable Finalized<T> is now accepted by the ' +
        'type system. Do not relax this test; find what stopped rejecting.',
    );
    assert.ok(output.length > 0, `${fixture} failed without diagnostics — check the harness`);
  });
}
