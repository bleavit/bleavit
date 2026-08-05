/**
 * Run a `node --test` suite and refuse a run that executed **nothing**.
 *
 * ## Why this exists
 *
 * `node --test 'tests/whatever/*.test.js'` exits **0** when the pattern matches no files. A
 * suite that has been renamed, moved, or excluded therefore reports success — `# tests 0`,
 * `# fail 0`, green — and the CI job that depends on it goes green too. It is the same
 * vacuity failure this repository keeps finding in its own checkers: a control that can no
 * longer detect anything still reports success.
 *
 * It is not hypothetical here. Renaming four suites from `.js` to `.ts` during the
 * TypeScript migration silently emptied `test:mock-runtime`, and the only symptom was a
 * `# pass 0` nobody would read in a 900-test run.
 *
 * ## What it does
 *
 * Forwards its arguments to `node --test`, streams the output through unchanged so the TAP
 * report is exactly what it was, then parses the summary and fails if `# tests` is zero or
 * absent. The patterns are passed to **node's own glob**, not the shell's, so
 * `*.test.{js,ts}` matches both extensions and a half-migrated directory keeps running all
 * of its tests.
 *
 * Absent is treated the same as zero deliberately: if the summary line cannot be found, this
 * cannot prove anything ran, and an unprovable claim is refused rather than assumed
 * (INV-FE-12's shape, applied to the harness).
 */

import { spawn } from 'node:child_process';

const patterns = process.argv.slice(2);
if (patterns.length === 0) {
  console.error('run-suite: needs at least one test pattern');
  process.exit(2);
}

const child = spawn(process.execPath, ['--test', ...patterns], {
  stdio: ['inherit', 'pipe', 'inherit'],
});

let captured = '';
child.stdout.on('data', (chunk: Buffer) => {
  captured += chunk.toString();
  process.stdout.write(chunk);
});

child.on('close', (code: number | null) => {
  // `# tests N` is TAP's own summary line. Anchored so a test *named* something like
  // "# tests 0" in its description cannot satisfy it.
  const match = /^# tests (\d+)$/m.exec(captured);
  const ran = match === null ? 0 : Number(match[1]);
  if (ran === 0) {
    console.error(
      `\nrun-suite: the pattern(s) ${patterns.join(' ')} executed ${
        match === null ? 'an unknown number of' : 'zero'
      } tests.\n` +
        'An empty suite exits 0 and reads as a pass, so it is failed here instead. A ' +
        'renamed or moved file is the usual cause.',
    );
    process.exit(1);
  }
  process.exit(code ?? 1);
});
