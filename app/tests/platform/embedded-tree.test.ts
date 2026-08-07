/**
 * The embedded-tree assertion — F22's whole point (10 §10.1; 12 §1).
 *
 * The desktop shell embeds `dist/` and refuses to open a window unless it is the tree the
 * release signed, digest for digest. That claim is made twice, in two languages, because the
 * build machine and the running binary are different places: `app/tools/desktop/` asserts it
 * before a binary exists, and `app/crates/embedded-tree/` asserts it before a window does.
 *
 * ## What this suite is, and what the Rust side is
 *
 * Two implementations of one comparison agree only if something makes them. That something
 * is **`app/crates/embedded-tree/fixtures/self-check-cases.json`**, read **in place** by both
 * sides — the same single-generator discipline the vector corpus and the storage-key fixture
 * already follow. It publishes file **content** rather than digests on purpose: a corpus of
 * digests would never exercise either side's hash function, and two implementations agreeing
 * on a comparison they both skipped is not agreement.
 *
 * So this file does three things:
 *
 * 1. replays every corpus case through the **production** `runSelfCheck` and requires the
 *    published verdict, which is the differential;
 * 2. re-derives each case's `perFileHashes` from its own content, so a corpus whose pins
 *    stopped describing its own files fails rather than certifying a wrong expectation;
 * 3. drives the parts the Rust side has no analogue for — reading a real directory, the
 *    publishability leg, and the shell-config rules that decide whether the embedded tree
 *    stays byte-identical after Tauri has processed it.
 *
 * ## The vacuity cases are the point of the whole file
 *
 * An empty tree, an absent directory, and a manifest pinning nothing are the three inputs
 * over which a comparison reports success having compared nothing. Each is asserted to
 * refuse. `assertCheckable`'s own refusal is the same rule one layer up.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import type { Sha256Hex } from '@bleavit/verify';
import { assertCheckable, readPerFileHashes, runSelfCheck } from '@bleavit/verify';

import {
  EXPECTED_FRONTEND_DIST,
  EmbeddedTreeError,
  assertEmbeddedTree,
  checkShellConfig,
  hashTree,
  normaliseKey,
  readTree,
  sha256,
} from '../../tools/desktop/embedded-tree.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '../..');
const CORPUS = join(APP_ROOT, 'crates/embedded-tree/fixtures/self-check-cases.json');
const SHELL_CONFIG = join(APP_ROOT, 'src-tauri/tauri.conf.json');

interface CorpusCase {
  readonly name: string;
  readonly why: string;
  readonly perFileHashes: Readonly<Record<string, string>>;
  readonly tree: Readonly<Record<string, string>>;
  readonly expected: readonly { readonly kind: string; readonly path: string }[];
  readonly expectedVerified: number;
}

function corpus(): readonly CorpusCase[] {
  const parsed: unknown = JSON.parse(readFileSync(CORPUS, 'utf8'));
  assert.ok(typeof parsed === 'object' && parsed !== null, 'the corpus did not parse');
  const cases = (parsed as { cases?: unknown }).cases;
  assert.ok(Array.isArray(cases), 'the corpus has no `cases` array');
  return cases as readonly CorpusCase[];
}

/** Build the `path → digest` map from a case's published content, the way each side must. */
function servedFromCase(entry: CorpusCase): Record<string, Sha256Hex> {
  const tree = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(entry.tree)) {
    tree.set(path, new TextEncoder().encode(content));
  }
  return hashTree(tree);
}

function withScratch(body: (root: string) => void): void {
  const scratch = mkdtempSync(join(tmpdir(), 'bleavit-f22-'));
  try {
    body(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('every corpus case produces the published verdict through the production comparison', () => {
  const cases = corpus();
  assert.ok(cases.length >= 6, 'the corpus lost cases');
  for (const entry of cases) {
    const pins = readPerFileHashes({ perFileHashes: entry.perFileHashes });
    assert.equal(pins.kind, 'pins', `case ${entry.name}: the corpus manifest was refused`);
    if (pins.kind !== 'pins') continue;

    const result = runSelfCheck({ perFileHashes: pins.perFileHashes }, servedFromCase(entry));
    const actual = result.findings
      .map((finding) => `${finding.kind} ${finding.path}`)
      .sort();
    const expected = entry.expected.map((finding) => `${finding.kind} ${finding.path}`).sort();
    assert.deepEqual(actual, expected, `case ${entry.name}`);
    assert.equal(result.verifiedCount, entry.expectedVerified, `case ${entry.name}`);
    assert.equal(result.ok, entry.expected.length === 0, `case ${entry.name}`);
    assert.equal(
      result.pinnedCount,
      Object.keys(entry.perFileHashes).length,
      `case ${entry.name}`,
    );
  }
});

test('the corpus pins really are the digests of the content it publishes', () => {
  // Without this the corpus could certify a wrong expectation on both sides at once: every
  // pin could be a hash of something else, both implementations would report the same
  // findings, and the differential would agree about a comparison that means nothing.
  for (const entry of corpus()) {
    for (const [path, content] of Object.entries(entry.tree)) {
      const key = normaliseKey(path);
      const pin = entry.perFileHashes[key];
      if (pin === undefined) continue; // an `unexpected` file, by construction unpinned
      const digest = sha256(new TextEncoder().encode(content));
      const shouldMatch = !entry.expected.some(
        (finding) => finding.kind === 'changed' && finding.path === key,
      );
      assert.equal(
        digest === pin,
        shouldMatch,
        `case ${entry.name}: ${key} is pinned to a digest its own content does not explain`,
      );
    }
  }
});

test('the corpus exercises all three directions and at least one clean case', () => {
  // The same assertion the Rust side makes. A corpus that drifted to only the easy cases
  // still passes the differential above, so coverage is asserted rather than assumed.
  const kinds = new Set(corpus().flatMap((entry) => entry.expected.map((f) => f.kind)));
  assert.deepEqual([...kinds].sort(), ['changed', 'missing', 'unexpected']);
  assert.ok(
    corpus().some((entry) => entry.expected.length === 0),
    'without a clean case the corpus proves only that everything is rejected',
  );
});

test('rooted asset keys and release-relative pins meet, on this side too', () => {
  // Tauri hands `/index.html`; `release.json` says `index.html`. If only one side
  // normalised, every file would be reported as BOTH missing and unexpected.
  assert.equal(normaliseKey('/assets/app.js'), 'assets/app.js');
  assert.equal(normaliseKey('assets/app.js'), 'assets/app.js');
  const bytes = new TextEncoder().encode('export const app = 1;\n');
  const digest = sha256(bytes);
  const result = runSelfCheck(
    { perFileHashes: { 'assets/app.js': digest } },
    hashTree(new Map([['/assets/app.js', bytes]])),
  );
  assert.equal(result.ok, true);
  assert.equal(result.verifiedCount, 1);
});

test('sha256 agrees with node on the empty string, the way the Rust side is pinned too', () => {
  assert.equal(
    sha256(new Uint8Array()),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(sha256(new TextEncoder().encode('x')), createHash('sha256').update('x').digest('hex'));
});

test('a manifest that pins nothing refuses, at both layers that could wave it through', () => {
  assert.equal(readPerFileHashes({ perFileHashes: {} }).kind, 'refused');
  assert.equal(readPerFileHashes({}).kind, 'refused');
  assert.throws(() => assertCheckable({ perFileHashes: {} }), /pins no file hashes/);
  withScratch((root) => {
    writeFileSync(join(root, 'index.html'), '<!doctype html>\n');
    assert.throws(
      () => assertEmbeddedTree({ perFileHashes: {} }, readTree(root)),
      EmbeddedTreeError,
    );
  });
});

test('an absent, empty, or non-directory tree refuses rather than verifying nothing', () => {
  withScratch((root) => {
    assert.throws(() => readTree(join(root, 'does-not-exist')), EmbeddedTreeError);
    mkdirSync(join(root, 'empty'));
    assert.throws(() => readTree(join(root, 'empty')), EmbeddedTreeError);
    writeFileSync(join(root, 'a-file'), 'x');
    assert.throws(() => readTree(join(root, 'a-file')), EmbeddedTreeError);
  });
  assert.throws(() => assertEmbeddedTree({ perFileHashes: { 'a.js': 'x' } }, new Map()), EmbeddedTreeError);
});

test('a symbolic link is refused rather than followed', () => {
  // A link is a path whose bytes are decided outside the tree. A release tree that depends
  // on the build machine's filesystem is not a release tree, and it hashes to whatever the
  // link happened to point at when the build ran.
  withScratch((root) => {
    const tree = join(root, 'tree');
    mkdirSync(tree);
    writeFileSync(join(root, 'outside.js'), 'globalThis.x = 1;\n');
    writeFileSync(join(tree, 'index.html'), '<!doctype html>\n');
    symlinkSync(join(root, 'outside.js'), join(tree, 'linked.js'));
    assert.throws(() => readTree(tree), /symbolic link/);
  });
});

test('readTree reads a nested directory into release-relative forward-slash paths', () => {
  withScratch((root) => {
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'skills/bleavit-analysis'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html>\n');
    writeFileSync(join(root, 'assets/app.js'), 'export const app = 1;\n');
    writeFileSync(join(root, 'skills/bleavit-analysis/SKILL.md'), '# Bleavit analysis\n');
    assert.deepEqual(
      [...readTree(root).keys()].sort(),
      ['assets/app.js', 'index.html', 'skills/bleavit-analysis/SKILL.md'],
    );
  });
});

test('the three divergence directions are each caught over a real directory', () => {
  withScratch((root) => {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html>\n');
    writeFileSync(join(root, 'assets/app.js'), 'export const app = 1;\n');
    const tree = readTree(root);
    const document = {
      schema: 'bleavit.app-release.v1',
      sourceCommit: '0'.repeat(40),
      specVersionRange: { min: 2, max: 3 },
      descriptorMetadataHashes: {},
      perFileHashes: hashTree(tree),
    };

    // The negative control. Without it every mutation below could "fire" for a reason that
    // has nothing to do with the mutation.
    assert.equal(assertEmbeddedTree(document, readTree(root)).selfCheck.ok, true);

    // Each direction must come back as an ENUMERATED FINDING of the right kind, not as a
    // throw. That is the property, not a stylistic preference: `assertPublishable` also
    // compares digests and throws on the first disagreement, so running it first made
    // `runSelfCheck` unreachable — the witness stayed green with the self-check replaced by a
    // hardcoded clean verdict. Asserting the *kind* here is what makes the ordering a tested
    // fact rather than a comment.
    const findingsFor = (): readonly string[] =>
      assertEmbeddedTree(document, readTree(root)).selfCheck.findings.map(
        (finding) => `${finding.kind} ${finding.path}`,
      );

    writeFileSync(join(root, 'index.html'), '<!doctype html><script>steal()</script>\n');
    assert.deepEqual(findingsFor(), ['changed index.html']);

    rmSync(join(root, 'index.html'));
    assert.deepEqual(findingsFor(), ['missing index.html']);

    writeFileSync(join(root, 'index.html'), '<!doctype html>\n');
    writeFileSync(join(root, 'assets/payload.js'), 'globalThis.exfiltrate = 1;\n');
    assert.deepEqual(findingsFor(), ['unexpected assets/payload.js']);

    // All three at once, counted separately. A verdict that collapsed to one finding would
    // still pass each single-direction case above.
    rmSync(join(root, 'assets/app.js'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><script>steal()</script>\n');
    assert.deepEqual(
      [...findingsFor()].sort(),
      ['changed index.html', 'missing assets/app.js', 'unexpected assets/payload.js'],
    );

    // And the direct call agrees, so the composition above adds nothing of its own.
    const direct = runSelfCheck(document, hashTree(readTree(root)));
    assert.deepEqual(
      direct.findings.map((finding) => `${finding.kind} ${finding.path}`).sort(),
      ['changed index.html', 'missing assets/app.js', 'unexpected assets/payload.js'],
    );
  });
});

test('the publishability leg is reachable, and only over a tree that already matched', () => {
  // The other half of the ordering. With the self-check first, 12 §1.2's gate runs on a tree
  // whose key sets and digests already agree — so what remains of it is the part the
  // self-check cannot answer: whether the document is a release *record* at all. A leg that
  // could never run would be as unproven as the self-check was.
  withScratch((root) => {
    writeFileSync(join(root, 'index.html'), '<!doctype html>\n');
    const tree = readTree(root);
    const complete = {
      schema: 'bleavit.app-release.v1',
      sourceCommit: '0'.repeat(40),
      specVersionRange: { min: 2, max: 3 },
      descriptorMetadataHashes: {},
      perFileHashes: hashTree(tree),
    };
    assert.equal(assertEmbeddedTree(complete, tree).selfCheck.ok, true);
    for (const field of ['schema', 'sourceCommit', 'specVersionRange', 'descriptorMetadataHashes']) {
      assert.throws(
        () => assertEmbeddedTree({ ...complete, [field]: null }, tree),
        EmbeddedTreeError,
        `a document with no ${field} is not a release record`,
      );
    }
  });
});

test('a document that is not a release record is refused before anything is compared', () => {
  withScratch((root) => {
    writeFileSync(join(root, 'index.html'), '<!doctype html>\n');
    const tree = readTree(root);
    // A hash map in a file is not a release document. `assertPublishable` is 12 §1.2's own
    // gate, run here so the desktop channel cannot ship against a document the web channel
    // would refuse to publish. It surfaces under this module's error type — one type for the
    // whole refusal surface, so a caller cannot catch half of them.
    assert.throws(() => assertEmbeddedTree({ perFileHashes: hashTree(tree) }, tree), EmbeddedTreeError);
    assert.throws(() => assertEmbeddedTree({ perFileHashes: hashTree(tree) }, tree), /schema/);
    assert.throws(() => assertEmbeddedTree('not an object', tree), EmbeddedTreeError);
    assert.throws(() => assertEmbeddedTree(null, tree), EmbeddedTreeError);
    assert.throws(() => assertEmbeddedTree([1, 2, 3], tree), EmbeddedTreeError);
  });
});

test('the committed shell config embeds the attested tree and rewrites nothing', () => {
  const config: unknown = JSON.parse(readFileSync(SHELL_CONFIG, 'utf8'));
  assert.deepEqual(checkShellConfig(config, EXPECTED_FRONTEND_DIST), []);
});

test('the shell-config rules each fire on the configuration they exist to forbid', () => {
  const cases: readonly (readonly [string, unknown, string])[] = [
    [
      'a configured CSP re-serialises every embedded HTML file',
      { build: { frontendDist: EXPECTED_FRONTEND_DIST }, app: { security: { csp: "default-src 'none'" } } },
      'app.security.csp',
    ],
    [
      'a configured devCsp does the same in development',
      { build: { frontendDist: EXPECTED_FRONTEND_DIST }, app: { security: { devCsp: 'x' } } },
      'app.security.devCsp',
    ],
    [
      'a dev server is a remote origin for application code',
      { build: { frontendDist: EXPECTED_FRONTEND_DIST, devUrl: 'http://localhost:5173' } },
      'build.devUrl',
    ],
    [
      'a frontendDist pointing anywhere else embeds a tree nothing attested',
      { build: { frontendDist: '../somewhere-else' } },
      'build.frontendDist',
    ],
    [
      'a frontendDist that is a URL means the code arrives over the network',
      { build: { frontendDist: 'https://example.invalid/app' } },
      'build.frontendDist',
    ],
    [
      'the asset-CSP escape hatch signals an intent to have Tauri modify assets',
      {
        build: { frontendDist: EXPECTED_FRONTEND_DIST },
        app: { security: { dangerousDisableAssetCspModification: true } },
      },
      'app.security.dangerousDisableAssetCspModification',
    ],
    ['an empty config is not a passing config', {}, 'build.frontendDist'],
  ];
  for (const [why, config, key] of cases) {
    const findings = checkShellConfig(config, EXPECTED_FRONTEND_DIST);
    assert.ok(findings.length > 0, `${why}: reported no problem`);
    assert.ok(
      findings.some((finding) => finding.key === key),
      `${why}: expected a finding on ${key}, got ${findings.map((f) => f.key).join(', ')}`,
    );
  }
});

test('the assertion module exports no repair or refetch path', () => {
  // INV-FE-8 closes with "detected divergence is surfaced to the user; it is never silently
  // repaired", and the shell has the stronger option: refuse to start. The rule is enforced
  // by absence, so the test states it — a future addition has to delete an assertion.
  const source = readFileSync(join(APP_ROOT, 'tools/desktop/embedded-tree.ts'), 'utf8');
  for (const name of ['repair', 'refetch', 'ignoreFinding', 'forceStart', 'overrideDivergence']) {
    assert.ok(
      !source.includes(`function ${name}`),
      `INV-FE-8: divergence is surfaced, never repaired — found ${name}`,
    );
  }
  // The negative control. Without it a typo in the needle makes this test pass for exactly
  // the reason it exists to prevent.
  assert.ok(source.includes(`function ${'assertEmbeddedTree'}`));
});
