/**
 * 10 §9.4's chain-spec row, measured over the tree the release **emits**.
 *
 * The row budgets *"relay + para + Asset Hub, gz, lazy"* — three artifacts a browser fetches
 * on demand. Until this suite existed the gate weighed the repository paths
 * `release-sources.json` declares, and nothing copied those into the bundle: the only other
 * consumer, `tools/release/connect-src.ts`, opens them at build time for their bootnode
 * multiaddrs. So a release could declare a spec, pin its hash, be weighed, pass, and emit no
 * chain spec at all for a browser to boot from (P1 on PR #254, 2026-08-06).
 *
 * Every case below is about a **disagreement between a declaration and an emitted tree**,
 * which is exactly the class a source-path measurement cannot express. The trees are built in
 * the OS temp directory rather than in `dist/`, so a failing case leaves nothing behind.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BudgetError,
  checkChainSpecs,
  emittedChainSpecs,
  type ReleaseSources,
} from '../../tools/check-artifact-budget.ts';
import { RELEASE_CHAIN_SPEC_DIR, assertChainSpecsEmitted } from '../../tools/release/build.ts';

const BUDGET = 3.5e6;
const RELAY = 'deploy/chain-specs/out/relay.json';
const PARA = 'deploy/chain-specs/out/para.json';

/** A raw chain spec, small enough that only a deliberately tiny budget refuses it. */
function specBody(id: string): string {
  return JSON.stringify({ id, name: id, genesis: { raw: { top: {} } }, bootNodes: [] });
}

function sha256(body: string): string {
  return `0x${createHash('sha256').update(body).digest('hex')}`;
}

/** A throwaway release tree carrying exactly the named emitted specs. */
function withRelease<T>(
  emitted: Readonly<Record<string, string>>,
  run: (distDir: string) => T,
): T {
  const distDir = mkdtempSync(join(tmpdir(), 'bleavit-budget-test-'));
  try {
    mkdirSync(join(distDir, RELEASE_CHAIN_SPEC_DIR), { recursive: true });
    for (const [name, body] of Object.entries(emitted)) {
      writeFileSync(join(distDir, RELEASE_CHAIN_SPEC_DIR, name), body);
    }
    return run(distDir);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

function sources(partial: Partial<ReleaseSources> = {}): ReleaseSources {
  return { chainSpecs: [], chainSpecHashes: {}, ...partial };
}

test('a declared chain spec the release never emitted is refused', () => {
  // The finding, in one case. Weighing the source path would have called this measured.
  withRelease({}, (distDir) => {
    assert.throws(
      () => checkChainSpecs(sources({ chainSpecs: [RELAY] }), distDir, BUDGET, false),
      (error: unknown) =>
        error instanceof BudgetError && /emits no chain-specs\/relay\.json/.test(error.message),
    );
  });
});

test('an emitted chain spec no declaration covers is refused', () => {
  // The inverse direction, which a declaration-driven loop structurally cannot see: bytes a
  // user downloads that no budget weighed and no connect-src class derived a bootnode from.
  withRelease({ 'relay.json': specBody('relay') }, (distDir) => {
    assert.throws(
      () => checkChainSpecs(sources(), distDir, BUDGET, false),
      (error: unknown) => error instanceof BudgetError && /no.*entry declares/.test(error.message),
    );
  });
});

test('a pinned role that no emitted spec hashes to is refused', () => {
  // 10 §4.1 verifies the bundled bytes against this pin before smoldot sees them, so an
  // unmatched pin is a boot that fails at the user however small the bundle measures.
  withRelease({ 'relay.json': specBody('relay') }, (distDir) => {
    assert.throws(
      () =>
        checkChainSpecs(
          sources({ chainSpecs: [RELAY], chainSpecHashes: { relay: `0x${'0'.repeat(64)}` } }),
          distDir,
          BUDGET,
          false,
        ),
      (error: unknown) => error instanceof BudgetError && /no emitted spec hashes/.test(error.message),
    );
  });
});

test('a consistent release — declared, emitted and pinned to the emitted bytes — is admitted', () => {
  // The positive control. Without it every refusal above is satisfied by a checker that
  // refuses unconditionally.
  const relay = specBody('relay');
  const para = specBody('para');
  withRelease({ 'relay.json': relay, 'para.json': para }, (distDir) => {
    checkChainSpecs(
      sources({
        chainSpecs: [RELAY, PARA],
        chainSpecHashes: { relay: sha256(relay), para: sha256(para) },
      }),
      distDir,
      BUDGET,
      false,
    );
  });
});

test('the budget is weighed over the emitted bytes', () => {
  // Stated as a pair, because a size gate that measured nothing would pass the first half.
  const relay = specBody('relay');
  withRelease({ 'relay.json': relay }, (distDir) => {
    const declared = sources({ chainSpecs: [RELAY] });
    checkChainSpecs(declared, distDir, BUDGET, false);
    assert.throws(
      () => checkChainSpecs(declared, distDir, 1, false),
      (error: unknown) => error instanceof BudgetError && /combined budget/.test(error.message),
    );
  });
});

test('two declarations that emit under one name are refused rather than resolved', () => {
  // The survivor would be whichever was copied last, which is a property of list order.
  withRelease({ 'relay.json': specBody('relay') }, (distDir) => {
    assert.throws(
      () =>
        checkChainSpecs(
          sources({ chainSpecs: [RELAY, 'deploy/chain-specs/other/relay.json'] }),
          distDir,
          BUDGET,
          false,
        ),
      (error: unknown) => error instanceof BudgetError && /both emit as/.test(error.message),
    );
  });
});

test('an absent release tree is refused, never treated as an empty one', () => {
  assert.throws(
    () => checkChainSpecs(sources(), join(tmpdir(), 'bleavit-no-such-release-tree'), BUDGET, false),
    (error: unknown) => error instanceof BudgetError && /release:build/.test(error.message),
  );
});

test('the pre-genesis posture is admitted: nothing declared, nothing pinned, nothing emitted', () => {
  withRelease({}, (distDir) => {
    checkChainSpecs(sources(), distDir, BUDGET, false);
    assert.deepEqual(emittedChainSpecs(distDir), []);
  });
});

test('a pinned hash with nothing declared is refused', () => {
  withRelease({}, (distDir) => {
    assert.throws(
      () => checkChainSpecs(sources({ chainSpecHashes: { relay: '0xdeadbeef' } }), distDir, BUDGET, false),
      (error: unknown) => error instanceof BudgetError && /pins 1 chain-spec hash/.test(error.message),
    );
  });
});

test('the build refuses to certify a tree that lost a declared chain spec', () => {
  // `release:build --check` does not copy, so this is the half that catches a re-checked
  // tree whose chain specs were removed after the map was baked.
  withRelease({ 'relay.json': specBody('relay') }, (distDir) => {
    assertChainSpecsEmitted(distDir, [RELAY]);
    assert.throws(
      () => assertChainSpecsEmitted(distDir, [RELAY, PARA]),
      /absent from the emitted release tree/,
    );
  });
});
