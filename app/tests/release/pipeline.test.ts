/**
 * The pipeline over the tree it actually built — 12 §1.1, F11.
 *
 * The other suites in this directory test the pieces. This one runs the whole pipeline and
 * asserts properties of the emitted `dist/`, because the failures that matter here are
 * failures of *composition*: a control applied in the wrong order still passes its own unit
 * test. Two orderings are load-bearing and both are asserted end to end —
 *
 *  - the worker's baked map must be computed **after** the CSP substitution and the SRI
 *    injection, or it pins an `index.html` that no longer exists and the release refuses
 *    its own entry document;
 *  - `release.json` must be written **after** the worker's map is substituted, or it pins a
 *    `sw.js` that was rewritten afterwards.
 *
 * Get either backwards and the release still fails closed — at the user, which is the wrong
 * place for a build error to surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASSET_MAP_PLACEHOLDER,
  CONNECT_SRC_PLACEHOLDER,
  assertNoTestOnlySigner,
  pipeline,
  readBakedAssetMap,
} from '../../tools/release/build.ts';
import { requiredIdentityFields } from '../../tools/release/release-json.ts';
import { verifySri } from '../../tools/release/sri.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = join(APP_ROOT, 'dist');

// One build for the whole file. `pipeline()` is deterministic given the tree, so running it
// per test would only make the suite slower and the failures harder to attribute.
const built = pipeline();
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
const worker = readFileSync(join(DIST, 'sw.js'), 'utf8');

/**
 * The producer assets ship, and ship PINNED — F21.
 *
 * `skills/` and `schemas/` are what a user hands their analysis tool, and the instructions
 * inside them say they ship with the client. That sentence has to be true: a producer told
 * to look in `schemas/` and finding nothing there falls back to whatever the model
 * remembers about the format, which is the one input this whole subsystem is built to
 * distrust.
 *
 * The pinning half is the part a copy step alone would get wrong. Files copied in **after**
 * the worker's map is baked are same-origin paths the release does not contain, and the
 * worker refuses those — fail-closed, at the user, for no reason at all. So the assertion
 * is not "the files exist" but "the files exist AND the worker will serve them".
 */
test('the producer assets are in the release tree and pinned by the worker', () => {
  const map = readBakedAssetMap(worker);
  const required = [
    'schemas/bleavit.intent.v1.schema.json',
    'schemas/bleavit.context.v1.schema.json',
    'schemas/bleavit.receipt.v1.schema.json',
    'skills/bleavit-analysis/SKILL.md',
    'skills/bleavit-analysis/INSTRUCTIONS-chatgpt.md',
    'skills/bleavit-analysis/INSTRUCTIONS-generic.md',
    'skills/bleavit-analysis/reference/safety.md',
    'skills/bleavit-analysis/reference/formats.md',
  ];
  for (const path of required) {
    const onDisk = readFileSync(join(DIST, path));
    assert.equal(
      map[path],
      createHash('sha256').update(onDisk).digest('hex'),
      `${path} is not pinned to its own bytes — the worker would refuse it`,
    );
  }
  // The corpus ships whole rather than as a sample: a producer debugging a refusal needs
  // the case that produces THEIR code, and there is no way to know in advance which.
  const examples = Object.keys(map).filter((path) =>
    path.startsWith('skills/bleavit-analysis/examples/'),
  );
  assert.ok(examples.length >= 16, `only ${examples.length} examples reached the release tree`);
  assert.ok(
    examples.some((path) => path.includes('refused-FE-HANDOFF-004')),
    'the foreign-key-in-action case is the one this format exists for; it must ship',
  );
});

test('no placeholder survives into the built tree', () => {
  assert.ok(!indexHtml.includes(CONNECT_SRC_PLACEHOLDER));
  assert.ok(!worker.includes(ASSET_MAP_PLACEHOLDER));
});

test('the emitted policy has exactly one connect-src, and it is the derived allowlist', () => {
  // Read the *policy*, not the file: the surrounding comment names the directives it
  // explains, and asserting over the whole document would have this test agree with prose.
  const meta = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/.exec(indexHtml);
  assert.ok(meta, 'index.html carries a meta CSP');
  const policy = meta[1];
  assert.ok(policy !== undefined, 'the meta CSP declares no content');
  assert.equal((policy.match(/connect-src/g) ?? []).length, 1);
  assert.ok(policy.includes(`connect-src ${built.connectSrc}`));
  assert.ok(policy.includes("script-src 'self' 'wasm-unsafe-eval'"), '12 §5.1 keeps this exact');
  assert.ok(policy.includes("default-src 'none'"));
  // Meta-CSP cannot set it, so emitting it would buy a console error and nothing else.
  assert.ok(!policy.includes('frame-ancestors'));
  /*
   * `style-src` is asserted verbatim, and this assertion is younger than the directive it
   * guards (F28). Until Tailwind arrived nothing in the tree emitted CSS, so the directive
   * cost nothing and nothing tested it. It now has a way to be widened: `vite.config.ts`
   * carries a `serve`-only plugin that adds `'unsafe-inline'` so the dev server can inject
   * its hot-replaced styles. That plugin cannot run at build time, but "cannot" is a claim
   * about a config file one edit could falsify, and the failure would be silent — a release
   * that permits inline styles looks exactly like one that does not.
   *
   * So both halves are checked: the directive is exactly `'self'`, and the marker the dev
   * relaxation writes appears nowhere in the built document.
   */
  assert.ok(policy.includes("style-src 'self';"), "12 §5.1 keeps style-src at 'self' exactly");
  assert.ok(!policy.includes('unsafe-inline'), 'no inline allowance may reach a built tree');
  assert.ok(!indexHtml.includes('--dev-only'), 'the dev-only CSP relaxation must never ship');
});

test('the stylesheet is linked, and it carries an SRI digest like every other subresource', () => {
  /*
   * 12 §5.3 requires build-generated `integrity` on every `<script>` **and `<link>`**, and
   * until F28 the tree emitted no stylesheet, so the `<link>` half of that sentence was
   * untested. The existing SRI test iterates `<script … src>` only, and `build.ts`'s
   * post-condition is satisfied by any single `integrity="sha384-` in the document — which
   * the scripts already supply. So a stylesheet shipping with no digest would have passed.
   *
   * The existence assertion is the load-bearing half. Without it, a change that routed CSS
   * back through a JS-injected `<style>` element would leave this file with nothing to check,
   * and the only thing left to notice would be the browser refusing it at run time under
   * `style-src 'self'` — in production, not in CI.
   */
  const links = [...indexHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 1, 'the built document links at least one stylesheet');
  for (const link of links) {
    assert.match(link, /integrity="sha384-/, `stylesheet link carries no SRI digest: ${link}`);
  }
});

test('every script in the entry document carries an SRI digest of the file that was emitted', () => {
  const scripts = [...indexHtml.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)];
  assert.ok(scripts.length > 0, 'the entry document loads at least one script');
  for (const [tag, src] of scripts) {
    assert.match(tag, /integrity="sha384-/, `${src} carries no integrity attribute`);
  }
  // Presence is the weaker half. A digest that is present and *wrong* makes the browser
  // refuse to execute and the page go blank — fail-closed and completely opaque — so every
  // declared digest is re-derived from the bytes actually emitted.
  const resolve = (href: string): Uint8Array => readFileSync(join(DIST, href.replace(/^\.?\//, '')));
  assert.deepEqual(verifySri(indexHtml, resolve), []);
});

test('the worker pins the whole tree except itself, and pins it after the tree was final', () => {
  const baked = readBakedAssetMap(worker);
  const pinned = Object.keys(baked).sort();
  const expected = built.files.filter((path) => path !== 'sw.js').sort();
  assert.deepEqual(pinned, expected);
  // **Every** digest is re-derived from the file on disk, not just the entry document. An
  // earlier version checked `index.html` alone, which passes while the JavaScript asset —
  // the file that actually executes — is pinned to something else entirely.
  for (const path of pinned) {
    assert.equal(baked[path], sha256Of(join(DIST, path)), `${path}: baked digest`);
    assert.equal(baked[path], built.release.perFileHashes[path], `${path}: release.json digest`);
  }
  // The ordering assertion: the baked digest is of the *final* index.html, the one that
  // already carries the substituted CSP and the injected SRI attributes.
  assert.ok(readFileSync(join(DIST, 'index.html'), 'utf8').includes('integrity="sha384-'));
});

test('release.json pins the worker as it was finally written', () => {
  assert.equal(built.release.perFileHashes['sw.js'], sha256Of(join(DIST, 'sw.js')));
});

test('release.json carries every field INV-FE-11 requires, read from the consumer', () => {
  // The field names come from `packages/verify`'s `ReleaseIdentity` declaration, not from a
  // list beside the producer. A hand-kept list made this test compare the producer with a
  // second copy of the producer, and it agreed with itself while the consumer required
  // `releaseTxid` and the document emitted only `arweaveManifestTxId`.
  //
  // That mismatch was then "fixed" from the wrong end, by adding `releaseTxid` to the
  // producer — a field that can never hold a true value, since `M′` addresses a manifest
  // containing this file. The consumer now declares `arweaveManifestTxId`, which the document
  // really carries; the anchor below is what stops this test passing against a consumer
  // that has drifted back to demanding the impossible one.
  const identity = readFileSync(join(APP_ROOT, 'packages/verify/src/identity.ts'), 'utf8');
  const required = requiredIdentityFields(identity);
  assert.ok(required.includes('arweaveManifestTxId'), 'the consumer no longer declares arweaveManifestTxId');
  assert.equal(
    required.includes('releaseTxid'),
    false,
    'the consumer is demanding `releaseTxid` again — a field no served document can carry',
  );
  for (const field of required) {
    assert.ok(field in built.release, `release.json is missing ${field}, which ReleaseIdentity requires`);
  }
});

test('the release document is the shape packages/verify consumes', () => {
  // The producer/consumer pair, checked mechanically rather than kept in step by hand.
  // `ReleaseIdentity` demands a path → hash record and a `{primary, recovery}` window.
  assert.equal(typeof built.release.perFileHashes, 'object');
  assert.equal(typeof built.release.specVersionRange.primary, 'number');
  assert.equal(built.release.specVersionRange.recovery, built.release.specVersionRange.primary + 1);
  for (const version of Object.values(built.release.specVersionRange)) {
    const hash = built.release.descriptorMetadataHashes[version];
    // Asserted present before it is matched: `assert.match(undefined, …)` throws a type
    // error rather than the finding, and the finding here — a live-capable spec version
    // with no pinned descriptor hash — is the whole point of the 10 §5.1 pair.
    assert.ok(hash !== undefined, `spec_version ${version} has no pinned descriptor hash`);
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
});

test('the manifest TXID is null until the deploy fills it', () => {
  // A builder that could pre-fill it would be asserting a content address for bytes it has
  // not uploaded. 12 §1.2's pass 2 is the only thing that may write this field.
  assert.equal(built.release.arweaveManifestTxId, null);
});

test('the readiness block names every pin this tree cannot make', () => {
  assert.equal(built.release.readiness.productionReady, false);
  assert.ok(built.release.readiness.blockers.length > 0);
  // The blockers a reader would expect to see pre-genesis, checked by substring so the
  // wording can improve without the suite pinning prose.
  const joined = built.release.readiness.blockers.join('\n');
  for (const expected of ['genesis hash', 'bootnode operators', 'gateway', 'key id']) {
    assert.ok(joined.includes(expected), `no blocker mentions ${expected}:\n${joined}`);
  }
});

test('the PWA manifest is scoped relatively, so it survives content addressing', () => {
  // An absolute `/` scope would escape the release directory on a path gateway and claim
  // every other transaction served by that host.
  const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
});

test('no test-only signer reached the release tree', () => {
  assert.doesNotThrow(() => assertNoTestOnlySigner(DIST, built.files));
});

test('the test-only signer gate can fail — checked against a tree that contains one', () => {
  // 10 §10.1's rule is about the *emitted chunk*, which is where it can actually break: a
  // tree-shaking regression or a barrel re-export puts the symbol in a bundle while every
  // import in the source still looks correct. A gate proven only by a green run is not
  // proven, so it is pointed at a tree that violates it.
  const fixture = resolve(APP_ROOT, 'tools/fixtures/release-tree-witness');
  assert.throws(() => assertNoTestOnlySigner(fixture, ['assets/leaked.js']), /test-only signer/);
});

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
