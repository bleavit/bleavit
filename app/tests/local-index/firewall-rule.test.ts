/**
 * `no-range-minting-outside-ingest`, proven to **fire** — 15 §4.8's structural-firewall row.
 *
 * This suite exists because of the defect class this repository keeps finding: a rule that is
 * defined, cited, and structurally unable to report anything. It has happened at least four
 * times here (V-86's `node_modules/…` matchers, V-91's negative-compilation corpus, V-92's
 * workspace subpath, `FE-HANDOFF-010`'s unemitted code), and every instance looked identical
 * from the outside — a green run.
 *
 * `no-range-minting-outside-ingest` is the rule that stops `packages/providers` — the one
 * package whose whole job is backfilling from operator endpoints, indexers and snapshots — from
 * reaching `selfRange` and labelling any of it light-client verified. 10 §2.2 gives that
 * promotion no path at all, so the rule is the path's absence.
 *
 * ## Why the existing witness does not cover this
 *
 * `pnpm run depcruise:witness` proves the *matcher* can fire: its config restates the rule with
 * a `witness-` name and a `from` of `tests/depcruise-witness/`. That is a real control and it is
 * not this one. The production rule's `from` is `^(src|packages)/` with `pathNot: ^tests/`, and
 * nothing anywhere exercised **that** clause — a `from` narrowed by one character would leave
 * every witness green while `providers` could mint verified ranges freely.
 *
 * So this drives the **production config** over a module at a production path and asserts the
 * violation is reported **by name**. The module is written and removed inside the test, because
 * a permanent one would fail `pnpm run depcruise` — which is the loud direction, and is why the
 * cleanup is in a `finally`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROBE_DIR = join(APP, 'packages', '.depcruise-probe');
const PROBE = join(PROBE_DIR, 'mints-a-self-range.ts');
/** A second probe, inside the package the tx-path rule's `from` actually names. */
const WALLET_PROBE_DIR = join(APP, 'packages', 'transaction-builder', '.depcruise-probe');
const WALLET_PROBE = join(WALLET_PROBE_DIR, 'reaches-the-index.ts');

interface Violation {
  readonly from: string;
  readonly to: string;
  readonly rule: { readonly name: string; readonly severity: string };
}

function cruise(dir = 'packages/.depcruise-probe'): readonly Violation[] {
  let raw: string;
  try {
    raw = execFileSync(
      join(APP, 'node_modules', '.bin', 'depcruise'),
      [dir, '--config', '.dependency-cruiser.mjs', '--output-type', 'json'],
      { cwd: APP, encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (err) {
    // A non-zero exit is the expected outcome — the probe violates a rule — and the report is
    // still on stdout. Narrowed rather than asserted: if a future dependency-cruiser stops
    // writing the report on failure this yields no violations and the assertions below fail
    // loudly, instead of an `as any` producing "undefined" that matches nothing.
    const streams = err as { stdout?: string | Buffer };
    raw = String(streams.stdout ?? '');
  }
  const report = JSON.parse(raw) as { summary?: { violations?: readonly Violation[] } };
  return report.summary?.violations ?? [];
}

test('the production `no-range-minting-outside-ingest` rule is REPORTED, not merely declared', () => {
  mkdirSync(PROBE_DIR, { recursive: true });
  try {
    writeFileSync(
      PROBE,
      // A module at a production path reaching the one export that mints `origin: 'self'` from
      // three plain numbers. `@bleavit/local-index/testing` is a workspace **subpath**, so
      // enhanced-resolve does not follow the `exports` map and dependency-cruiser records the
      // bare specifier — which is exactly the shape V-92 showed a naive rule cannot match, and
      // why `WORKSPACE_SUBPATH` matches both spellings.
      "import '@bleavit/local-index/testing';\nexport const probe = true;\n",
    );
    const violations = cruise();
    const byRule = violations.filter((v) => v.rule.name === 'no-range-minting-outside-ingest');
    assert.equal(
      byRule.length,
      1,
      'the rule that stops `providers` labelling backfilled data light-client-verified did not ' +
        `fire on a production-path module that imports the mint. Reported instead: ${
          violations.map((v) => v.rule.name).join(', ') || '(nothing at all)'
        }`,
    );
    assert.equal(byRule[0]?.rule.severity, 'error', 'the rule fires as a warning, so CI stays green');
    assert.match(byRule[0]?.to ?? '', /local-index\/testing|local-index[\\/]dist[\\/]testing/);
  } finally {
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }
});

test('the `wallet-never-imports-acceleration` edge is REPORTED too', () => {
  // The other half of INV-FE-7, and the one every safety note in this package leans on:
  // `coverage.ts` says the `self` brand is tolerable *because* "the transaction path never reads
  // this package". Until now the only thing asserting that was a test that **greps the config
  // text** for the rule's name, which proves the rule is written and nothing about whether it
  // can report.
  //
  // The probe imports by **relative path** rather than by package specifier, and that is the
  // realistic bypass rather than a contrivance. An undeclared `@bleavit/local-index` does not
  // resolve, so dependency-cruiser records the bare specifier and this rule's `to`
  // (`^packages/local-index/`) cannot match it — that case is covered by the negative-compilation
  // fixture, where it fails as TS2307. What this rule exists for is the edge that *does* resolve:
  // a relative reach across the package boundary, or a `package.json` somebody widened.
  mkdirSync(WALLET_PROBE_DIR, { recursive: true });
  try {
    writeFileSync(WALLET_PROBE, "import '../../local-index/src/coverage.js';\nexport const probe = true;\n");
    const violations = cruise('packages/transaction-builder/.depcruise-probe');
    const byRule = violations.filter((v) => v.rule.name === 'wallet-never-imports-acceleration');
    assert.equal(
      byRule.length,
      1,
      'the rule keeping the transaction path away from the local index did not fire on a ' +
        `module inside transaction-builder that reaches it. Reported instead: ${
          violations.map((v) => v.rule.name).join(', ') || '(nothing at all)'
        }`,
    );
    assert.equal(byRule[0]?.rule.severity, 'error', 'the rule fires as a warning, so CI stays green');
    assert.match(byRule[0]?.to ?? '', /^packages\/local-index\//);
  } finally {
    rmSync(WALLET_PROBE_DIR, { recursive: true, force: true });
  }
});

test('anti-vacuity: with no probe present the rule reports nothing', () => {
  // Without this the assertion above could pass against a cruiser that reports the rule for
  // every module, or against a stale report from a previous run left on disk. It also proves
  // the cleanup in the `finally` really removed the probe — a leaked one would fail
  // `pnpm run depcruise` for every later session, with the cause a directory nobody expects.
  mkdirSync(PROBE_DIR, { recursive: true });
  try {
    writeFileSync(PROBE, "export const probe = true;\n");
    assert.deepEqual(
      cruise().filter((v) => v.rule.name === 'no-range-minting-outside-ingest'),
      [],
      'the rule fires on a module that imports nothing, so firing proves nothing',
    );
  } finally {
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }
});
