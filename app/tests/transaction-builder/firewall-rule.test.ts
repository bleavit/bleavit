/**
 * The two production rules that quarantine the test-only `GatePassed` mint, proven live.
 *
 * The generic dependency-cruiser witness proves its shared matchers can report something,
 * but another witness violation could mask one of these named rules disappearing. These probes
 * run the production config over a real production path and require each rule by name.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Violation {
  readonly from: string;
  readonly to: string;
  readonly rule: { readonly name: string; readonly severity: string };
}

function cruise(target: string): readonly Violation[] {
  let raw: string;
  try {
    raw = execFileSync(
      join(APP, 'node_modules', '.bin', 'depcruise'),
      [target, '--config', '.dependency-cruiser.mjs', '--output-type', 'json'],
      { cwd: APP, encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (error) {
    const streams = error as { stdout?: string | Buffer };
    raw = String(streams.stdout ?? '');
  }
  const report = JSON.parse(raw) as { summary?: { violations?: readonly Violation[] } };
  return report.summary?.violations ?? [];
}

function assertProductionRule(
  directory: string,
  source: string,
  ruleName: string,
  expectedTarget: RegExp,
): void {
  const absolute = join(APP, directory);
  mkdirSync(absolute, { recursive: true });
  try {
    writeFileSync(join(absolute, 'probe.ts'), source);
    const violations = cruise(directory);
    const byRule = violations.filter((violation) => violation.rule.name === ruleName);
    assert.equal(
      byRule.length,
      1,
      `${ruleName} did not fire from a production package. Reported instead: ${
        violations.map((violation) => violation.rule.name).join(', ') || '(nothing)'
      }`,
    );
    assert.equal(byRule[0]?.rule.severity, 'error');
    assert.match(byRule[0]?.to ?? '', expectedTarget);
  } finally {
    rmSync(absolute, { recursive: true, force: true });
  }
}

test('the production testing-subpath rule rejects the explicit-value gate mint', () => {
  assertProductionRule(
    'packages/signing/.gate-testing-probe',
    "import '@bleavit/transaction-builder/testing';\nexport const probe = true;\n",
    'no-test-gate-mint-in-production',
    /transaction-builder(?:\/testing|\/src\/testing|\/dist\/testing)/,
  );
});
test('the production deep-module rule rejects a relative machine import', () => {
  assertProductionRule(
    'packages/signing/.gate-machine-probe',
    "import '../../transaction-builder/src/machine.js';\nexport const probe = true;\n",
    'no-deep-gate-mint-import-in-production',
    /transaction-builder\/src\/machine/,
  );
});
