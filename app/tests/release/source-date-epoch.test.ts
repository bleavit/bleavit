/**
 * The recipe's own variable — 12 §1.1 (SQ-1009).
 *
 * 12 §1.1 lists `SOURCE_DATE_EPOCH` in the deterministic-build recipe and this pipeline never
 * set it. What is asserted here is the resolution — injected value first, the source commit's
 * time otherwise — plus the two things about it that are easy to get wrong in the direction
 * nothing notices:
 *
 *  - **The value has to be exported**, not merely computed. `vite` and `esbuild` are child
 *    processes, so a resolver that returned the right string and left the environment alone
 *    would satisfy every test written about its return value and change nothing about the
 *    build.
 *  - **A malformed injected value is refused, not coerced.** `Number('1e3')` is 1000 and
 *    `int('1e3')` raises, so a lenient parser here would make the two pipelines in this
 *    repository disagree about the same string. `fixtures/source-date-epoch-cases.json` is
 *    read IN PLACE here and by `tools/release/tests/test_release_common.py`, which is what
 *    turns "consistent with the chain side" from a claim into a test.
 *
 * What none of this proves: setting the variable does not make a clock-reading tool
 * deterministic, only one that honours the convention. The byte-identical property still
 * rests on the tree being clock-free, and `tools/ci/check-release-reproducibility.py` is what
 * tests that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOURCE_DATE_EPOCH,
  SourceDateEpochError,
  commitEpoch,
  parseSourceDateEpoch,
  resolveSourceDateEpoch,
} from '../../tools/release/source-date-epoch.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(APP_ROOT, '..');

interface EpochCase {
  readonly raw: string;
  readonly canonical: string;
  readonly why: string;
}
interface EpochRefusal {
  readonly raw: string;
  readonly why: string;
}

const corpus = JSON.parse(
  readFileSync(join(APP_ROOT, 'fixtures/source-date-epoch-cases.json'), 'utf8'),
) as { accepted: EpochCase[]; refused: EpochRefusal[] };

test('the shared corpus is not empty', () => {
  // A fixture that lost its cases would leave the loops below passing over nothing, in both
  // languages at once — which is the failure a shared corpus exists to prevent, not to cause.
  assert.ok(corpus.accepted.length >= 5, 'the epoch corpus holds almost no accepted cases');
  assert.ok(corpus.refused.length >= 6, 'the epoch corpus holds almost no refusals');
});

test('every accepted case parses to its canonical value', () => {
  for (const accepted of corpus.accepted) {
    assert.equal(
      parseSourceDateEpoch(accepted.raw),
      accepted.canonical,
      `${JSON.stringify(accepted.raw)}: ${accepted.why}`,
    );
  }
});

test('every refused case is refused', () => {
  for (const refusal of corpus.refused) {
    assert.throws(
      () => parseSourceDateEpoch(refusal.raw),
      SourceDateEpochError,
      `${JSON.stringify(refusal.raw)}: ${refusal.why}`,
    );
  }
});

test('a negative value is refused for being negative, not for being unparseable', () => {
  // The two refusals are separate sentences on the Python side too. An operator who typed a
  // minus sign needs to be told about the minus sign.
  assert.throws(() => parseSourceDateEpoch('-1'), /non-negative/);
  assert.throws(() => parseSourceDateEpoch('12.0'), /integer/);
});

test('a value past 2^53 survives exactly', () => {
  // Parsed through `BigInt`, because `Number('18446744073709551617')` is 18446744073709551616
  // and two different injected values would then round into agreement — V-74's shape, in the
  // one place where the rounded value is what gets compared across two environments.
  assert.equal(parseSourceDateEpoch('18446744073709551617'), '18446744073709551617');
  assert.notEqual(parseSourceDateEpoch('18446744073709551617'), parseSourceDateEpoch('18446744073709551616'));
});

test('spellings this parser refuses that Python int() would accept', () => {
  // Stated rather than hidden. `int('1_2')` is 12 and `int('١٢')` is 12, so the two
  // implementations are not identical — this one is stricter. That direction is safe: both
  // environments of the *client* build run this parser, so they refuse the same strings and
  // no false agreement is possible; a looser parser here could accept a value the chain-side
  // one rejects, which is the direction that produces two answers to one question.
  assert.throws(() => parseSourceDateEpoch('1_2'), SourceDateEpochError);
  assert.throws(() => parseSourceDateEpoch('١٢'), SourceDateEpochError);
});

test('with nothing injected, the epoch is the source commit time', () => {
  const environment: Record<string, string | undefined> = {};
  const resolved = resolveSourceDateEpoch(REPO_ROOT, environment);
  const head = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  assert.equal(resolved, head);
  // Derived, never chosen: `release.json` publishes the source commit, so a third-party
  // rebuilder recomputes this value from the document rather than being told it (R-2).
  assert.equal(commitEpoch(REPO_ROOT), head);
});

test('an injected value wins, and the commit is not consulted at all', () => {
  // Pointed at a directory with no git history, so a resolver that derived anyway would throw
  // rather than quietly agree. This is what keeps a build from a source tarball working.
  const nowhere = mkdtempSync(join(tmpdir(), 'bleavit-no-git-'));
  try {
    const environment: Record<string, string | undefined> = { [SOURCE_DATE_EPOCH]: '1700000000' };
    assert.equal(resolveSourceDateEpoch(nowhere, environment), '1700000000');
  } finally {
    rmSync(nowhere, { recursive: true, force: true });
  }
});

test('the resolved value is exported, so child processes inherit it', () => {
  // The half that does the work. `vite` and `esbuild` are spawned by `build.ts`, and a
  // variable this process resolved but did not export is one they never see — a control with
  // a correct return value and no effect, which is the defect class this repository keeps
  // finding. It is `build-runtime.sh`'s `export SOURCE_DATE_EPOCH` line, in TypeScript.
  const environment: Record<string, string | undefined> = {};
  const resolved = resolveSourceDateEpoch(REPO_ROOT, environment);
  assert.equal(environment[SOURCE_DATE_EPOCH], resolved);

  // And an injected value is written back in canonical form, so the child sees the same
  // string the manifest will record rather than the spelling somebody typed.
  const padded: Record<string, string | undefined> = { [SOURCE_DATE_EPOCH]: ' 0001700000000 ' };
  assert.equal(resolveSourceDateEpoch(REPO_ROOT, padded), '1700000000');
  assert.equal(padded[SOURCE_DATE_EPOCH], '1700000000');
});

test('an exported-but-empty variable is unset, not a value', () => {
  // The shell's own rule (`[[ -z "${SOURCE_DATE_EPOCH:-}" ]]`), kept here so the two
  // pipelines answer the same way. A shell that exported an empty variable stated nothing,
  // and reading it as a value would put the empty string into a recipe comparison.
  const head = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  for (const blank of ['', '   ']) {
    const environment: Record<string, string | undefined> = { [SOURCE_DATE_EPOCH]: blank };
    assert.equal(resolveSourceDateEpoch(REPO_ROOT, environment), head);
  }
  // The parser still refuses both — the leniency belongs to the resolver, one layer up.
  assert.throws(() => parseSourceDateEpoch(''), SourceDateEpochError);
});

test('a malformed injected value is refused, and the build stops', () => {
  // Never silently replaced by the commit time. A value the operator stated and the pipeline
  // ignored is worse than no value: the two environments would agree on an epoch neither was
  // asked for, and the run would look like evidence for the recipe it did not follow.
  const environment: Record<string, string | undefined> = { [SOURCE_DATE_EPOCH]: 'yesterday' };
  assert.throws(() => resolveSourceDateEpoch(REPO_ROOT, environment), SourceDateEpochError);
  assert.equal(environment[SOURCE_DATE_EPOCH], 'yesterday', 'a refused value is not rewritten');
});

test('with no git history and nothing injected, the refusal names the fix', () => {
  const nowhere = mkdtempSync(join(tmpdir(), 'bleavit-no-git-'));
  try {
    assert.throws(
      () => resolveSourceDateEpoch(nowhere, {}),
      /Set SOURCE_DATE_EPOCH explicitly/,
      'the failure must name how to fix it, not merely that git said no',
    );
  } finally {
    rmSync(nowhere, { recursive: true, force: true });
  }
});
