/**
 * The reproducibility manifest — 12 §1.1, INV-FE-10 (F13).
 *
 * This is the producer half of a comparison whose consumer is Python
 * (`tools/ci/check-release-reproducibility.py`), and the split is deliberate: the comparison
 * needs two JSON files and no toolchain, so the CI job that runs it costs seconds. The cost
 * of the split is that one definition of a tree hash now lives in two languages, so
 * `fixtures/tree-digest-cases.json` is read **in place** here and by that checker's tests.
 * A divergence turns one of the two red — the same shape `crates/embedded-tree` and
 * `tests/platform` already use for the shell's startup assertion.
 *
 * Nothing here builds. `pipeline.test.ts` owns the end-to-end build; these are the pure
 * functions, exercised against trees a real build never produces.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReleaseJsonError, sha256, treeDigest } from '../../tools/release/release-json.ts';
import {
  REPRO_MANIFEST_SCHEMA,
  ReproManifestError,
  assertReleaseJsonDescribesTree,
  buildReproManifest,
  collectReleaseFiles,
  describeEnvironment,
  pnpmVersionFrom,
} from '../../tools/release/repro-manifest.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface DigestCase {
  readonly name: string;
  readonly why: string;
  readonly files: Record<string, string>;
  readonly treeDigest: string;
}
interface DigestRefusal {
  readonly name: string;
  readonly why: string;
  readonly files: Record<string, string>;
}

const fixture = JSON.parse(
  readFileSync(join(APP_ROOT, 'fixtures/tree-digest-cases.json'), 'utf8'),
) as { cases: DigestCase[]; refusals: DigestRefusal[] };

test('the committed tree-digest cases are not empty', () => {
  // A fixture that lost its cases would leave both assertions below passing over nothing,
  // in both languages at once — which is the failure the shared fixture exists to prevent.
  assert.ok(fixture.cases.length >= 4, 'the digest fixture holds almost no cases');
  assert.ok(fixture.refusals.length >= 3, 'the digest fixture holds almost no refusals');
});

test('every committed digest case reproduces here', () => {
  for (const digestCase of fixture.cases) {
    assert.equal(treeDigest(digestCase.files), digestCase.treeDigest, `${digestCase.name}: ${digestCase.why}`);
  }
});

test('every committed refusal is refused here', () => {
  for (const refusal of fixture.refusals) {
    assert.throws(() => treeDigest(refusal.files), ReleaseJsonError, `${refusal.name}: ${refusal.why}`);
  }
});

test('the digest sorts, so it is a function of the tree and not of read order', () => {
  const forward = { 'dist/a.js': 'a'.repeat(64), 'dist/b.js': 'b'.repeat(64) };
  const backward = { 'dist/b.js': 'b'.repeat(64), 'dist/a.js': 'a'.repeat(64) };
  assert.equal(treeDigest(forward), treeDigest(backward));
});

test('the digest commits to the path, so a rename is not a reproduction', () => {
  // A digest over the file hashes alone would call a tree with every file renamed a
  // faithful reproduction of the original.
  assert.notEqual(
    treeDigest({ 'dist/app.js': 'a'.repeat(64) }),
    treeDigest({ 'dist/main.js': 'a'.repeat(64) }),
  );
});

test('pnpm reports its version through the user agent it sets', () => {
  assert.equal(pnpmVersionFrom('pnpm/10.23.0 npm/? node/v22.19.0 linux x64'), '10.23.0');
  // Read rather than spawned, so `null` is the honest answer when this ran under something
  // that is not pnpm — never a guessed version, which would enter a comparison as a value.
  assert.equal(pnpmVersionFrom('npm/10.9.0 node/v22.19.0 linux x64'), null);
  assert.equal(pnpmVersionFrom(null), null);
});

test('an environment must be named, in an alphabet that survives an artifact name', () => {
  // An environment with no stable id cannot be shown to be a *different* environment from
  // the other one, which is the whole property the manifest supports.
  assert.throws(() => describeEnvironment('', APP_ROOT), ReproManifestError);
  assert.throws(() => describeEnvironment('Desktop Shell', APP_ROOT), ReproManifestError);
  assert.throws(() => describeEnvironment('../escape', APP_ROOT), ReproManifestError);
  assert.equal(describeEnvironment('desktop-shell', APP_ROOT).id, 'desktop-shell');
});

test('the axes that mean nothing are held where they cannot prove independence', () => {
  /**
   * The consumer requires at least one **substantive** axis to differ. `hostname` differs
   * between any two runners and says nothing about whether the build is reproducible, so if
   * it ever moved into `substantive` the gate would be satisfied by every pair of machines
   * and would go on printing the same green line. This is that separation, asserted on the
   * producing side where the mistake would be made.
   */
  const environment = describeEnvironment('app', APP_ROOT);
  assert.ok(!('hostname' in environment.substantive), 'hostname is not an environment axis');
  assert.ok('hostname' in environment.incidental);
  assert.ok(!('runner' in environment.substantive), 'the runner name is not an environment axis');
  assert.equal(environment.substantive['buildPath'], APP_ROOT);
  // 12 §1.1's own recorded measurement varied absolute path depth, and it is the axis the
  // two CI jobs are actually given, so an implementation that stopped recording it would
  // leave the comparison with nothing to find a difference in.
  assert.ok(Object.keys(environment.substantive).length >= 8);
});

function scratchTree(): { root: string; dist: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'bleavit-repro-'));
  const dist = join(root, 'dist');
  const out = join(root, 'release-out');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  writeFileSync(join(dist, 'assets/app.js'), 'export {};');
  writeFileSync(join(out, 'release.json'), '{}');
  writeFileSync(join(out, 'sbom.cdx.json'), '{}');
  return { root, dist, out };
}

test('the map covers dist/ and the two release-out files 12 §1.1 names as output', () => {
  const { root, dist, out } = scratchTree();
  try {
    const files = collectReleaseFiles(dist, out);
    assert.deepEqual(Object.keys(files).sort(), [
      'dist/assets/app.js',
      'dist/index.html',
      'release-out/release.json',
      'release-out/sbom.cdx.json',
    ]);
    assert.equal(files['dist/index.html'], sha256('<!doctype html>'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a release output file that is missing is refused, not skipped', () => {
  // 12 §1.1's output is `dist/` **plus** `release.json` **plus** `sbom.cdx.json`. A manifest
  // that quietly dropped one would claim reproducibility for two thirds of the release, and
  // the SBOM is precisely the file most likely to differ between two builders — the pipeline
  // strips its timestamp and serial number for that reason.
  const { root, dist, out } = scratchTree();
  try {
    rmSync(join(out, 'sbom.cdx.json'));
    assert.throws(() => collectReleaseFiles(dist, out), ReproManifestError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an absent dist/ names the command that produces it', () => {
  const { root, out } = scratchTree();
  try {
    assert.throws(
      () => collectReleaseFiles(join(root, 'nowhere'), out),
      /release:build/,
      'the failure must name how to fix it, not merely that a directory is absent',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release.json must describe the tree the manifest is taken over', () => {
  const files = {
    'dist/index.html': 'a'.repeat(64),
    'release-out/release.json': 'b'.repeat(64),
    'release-out/sbom.cdx.json': 'c'.repeat(64),
  };
  assertReleaseJsonDescribesTree(files, { perFileHashes: { 'index.html': 'a'.repeat(64) } });

  // A pin for a file the tree does not contain, and a file the tree contains with no pin.
  // Both are `release.json` describing some other tree, and the manifest must not be able to
  // certify one — the two environments would then compare identical on `dist/` and differ on
  // `release.json` for a reason no path name explains.
  assert.throws(
    () => assertReleaseJsonDescribesTree(files, { perFileHashes: { 'gone.js': 'a'.repeat(64) } }),
    ReproManifestError,
  );
  assert.throws(
    () => assertReleaseJsonDescribesTree(files, { perFileHashes: { 'index.html': 'd'.repeat(64) } }),
    ReproManifestError,
  );
  // Refused rather than read as `{}`: an empty map binds nothing and would pass silently.
  assert.throws(() => assertReleaseJsonDescribesTree(files, { perFileHashes: {} }), ReproManifestError);
  assert.throws(() => assertReleaseJsonDescribesTree(files, {}), ReproManifestError);
});

test('the manifest carries the digest of its own file map', () => {
  const files = { 'dist/index.html': 'a'.repeat(64), 'release-out/release.json': 'b'.repeat(64) };
  const manifest = buildReproManifest({
    environment: describeEnvironment('app', APP_ROOT),
    sourceCommit: 'c13aace095c510f06262e6eeb09ae6a215b7f38b',
    buildRecipeDigest: 'd'.repeat(64),
    files,
  });
  assert.equal(manifest.schema, REPRO_MANIFEST_SCHEMA);
  // The consumer recomputes this from `files` and refuses a manifest that misstates it, so
  // a producer that let the two drift would be caught there. Asserted here too, because the
  // producer is where it would drift.
  assert.equal(manifest.treeDigest, treeDigest(files));
});
