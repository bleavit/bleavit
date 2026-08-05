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
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const tsc = resolve(here, '../../node_modules/.bin/tsc');

interface CompileResult {
  readonly ok: boolean;
  readonly output: string;
}

/** Compile one fixture in isolation. */
function compile(fixture: string): CompileResult {
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
    // `execFileSync` rejects with an Error carrying `stdout`/`stderr`, which is not in the
    // Error type. Narrowed rather than asserted: if a future Node stops decorating it, this
    // yields an empty diagnostic and the per-fixture `expect-error` assertion fails loudly,
    // instead of an `as any` quietly producing "undefinedundefined" that matches nothing.
    const streams = err as { stdout?: string | Buffer; stderr?: string | Buffer };
    return { ok: false, output: `${streams.stdout ?? ''}${streams.stderr ?? ''}` };
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

/**
 * The error each fixture MUST produce, declared in the fixture's own first line.
 *
 * Added because "did not compile" is not the property this corpus exists to prove
 * (V-91). Two fixtures were added and passed while proving nothing: both failed with
 * **TS2307, module not found**, because the fixture package did not depend on the
 * packages they were testing. A corpus whose whole purpose is demonstrating rejection
 * cannot tell rejection from a missing file unless it looks at the reason.
 *
 * TS2307 is a legitimate expectation for *some* fixtures — 10 §10.2 makes module
 * resolution the primary gate, so a forbidden package edge is *supposed* to be
 * unresolvable. That is exactly why the expectation is per fixture rather than a blanket
 * ban: the same diagnostic is the proof in one file and the vacuum in another.
 */
function expectedError(fixture: string): string | undefined {
  const first = readFileSync(join(fixtureDir, fixture), 'utf8').split('\n', 1)[0] ?? '';
  const match = first.match(/^\/\/ expect-error:\s*(TS\d+)\b/);
  return match?.[1];
}

test('every forbidden fixture declares the error it must produce', () => {
  const undeclared = forbidden.filter((f) => expectedError(f) === undefined);
  assert.deepEqual(
    undeclared,
    [],
    'a fixture with no `// expect-error: TSxxxx` first line can pass by failing for any ' +
      'reason at all — a missing dependency reads exactly like a working firewall (V-91)',
  );
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

    const expected = expectedError(fixture);
    assert.ok(
      output.includes(`error ${expected}`),
      `${fixture} failed, but not for the declared reason. Expected ${expected}; got:\n${output}\n` +
        'A fixture that fails for an unrelated reason — most often TS2307 because the ' +
        'fixture package does not depend on what it is testing — proves nothing.',
    );
  });
}
