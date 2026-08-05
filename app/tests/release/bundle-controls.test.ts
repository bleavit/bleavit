/**
 * SRI, the SBOM and the determinism check — 12 §1.1, §5.3 (F11).
 *
 * Three build-time controls that share a failure mode: each of them is easy to make
 * *present* and hard to make *enforced*. An `integrity` attribute on an element the browser
 * does not check, an SBOM generated from the installed tree instead of the lockfile, and a
 * normalizer that rewrites nondeterminism away instead of reporting it — all three look
 * like the control and are not it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SriError, injectSri, sha384 } from '../../tools/release/sri.mjs';
import { SbomError, buildSbom, parseLockfile, splitPackageKey } from '../../tools/release/sbom.mjs';
import { checkDeterminism, environmentProbes } from '../../tools/release/normalize.mjs';

const bytes = (text) => Buffer.from(text, 'utf8');

test('every script and stylesheet gains an enforced integrity attribute', () => {
  const html = '<script type="module" src="./assets/a.js"></script><link rel="stylesheet" href="./assets/b.css">';
  const result = injectSri(html, (href) => bytes(`contents of ${href}`));
  assert.equal(result.protectedRefs.length, 2);
  assert.ok(result.html.includes(`integrity="${sha384(bytes('contents of ./assets/a.js'))}"`));
  assert.ok(result.html.includes('crossorigin="anonymous"'));
});

test('a rel the browser does not check is skipped and reported, never decorated', () => {
  // `integrity` on `<link rel="manifest">` is enforced by nothing. Emitting it would look
  // like coverage — and a reader counts an attribute they can see.
  const html = '<link rel="manifest" href="./manifest.webmanifest">';
  const result = injectSri(html, () => bytes('{}'));
  assert.equal(result.protectedRefs.length, 0);
  assert.deepEqual(result.skipped, [{ href: './manifest.webmanifest', rel: 'manifest' }]);
  assert.ok(!result.html.includes('integrity'));
});

test('a subresource the build did not emit fails the release', () => {
  // The alternative — skipping it — leaves an `index.html` whose unprotected subresources
  // are exactly the ones nobody noticed were missing.
  assert.throws(() => injectSri('<script src="./assets/gone.js"></script>', () => undefined), SriError);
});

test('an off-release subresource URL is refused outright', () => {
  // `default-src none` plus an enumerated `connect-src` mean a release referencing one is
  // broken on arrival, so this is a refusal rather than a skip.
  assert.throws(() => injectSri('<script src="https://cdn.example/x.js"></script>', () => bytes('x')), SriError);
  assert.throws(() => injectSri('<script src="//cdn.example/x.js"></script>', () => bytes('x')), SriError);
});

test('an integrity attribute that is already present is refused, not trusted', () => {
  const html = '<script src="./a.js" integrity="sha384-whatever"></script>';
  assert.throws(() => injectSri(html, () => bytes('a')), SriError);
});

test('the SBOM reads the lockfile, and refuses a lockfile version it has not been checked against', () => {
  const good = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    '',
    "  '@scope/pkg@1.2.3':",
    '    resolution: {integrity: sha512-YWJj}',
    '',
    '  vite@8.1.4:',
    '    resolution: {integrity: sha512-ZGVm}',
    '',
  ].join('\n');
  const components = parseLockfile(good);
  assert.deepEqual(
    components.map((component) => `${component.name}@${component.version}`),
    ['@scope/pkg@1.2.3', 'vite@8.1.4'],
  );
  assert.throws(() => parseLockfile(good.replace("'9.0'", "'6.0'")), SbomError);
  // An SBOM listing nothing is indistinguishable from a clean one, so an unparseable
  // packages section fails rather than emitting an empty component list.
  assert.throws(() => parseLockfile("lockfileVersion: '9.0'\n\npackages:\n\n"), SbomError);
});

test('scoped names survive and a peer-resolution suffix is context, not a version', () => {
  assert.deepEqual(splitPackageKey('@bleavit/protocol@0.0.0'), { name: '@bleavit/protocol', version: '0.0.0' });
  assert.deepEqual(splitPackageKey('vite@8.1.4(@types/node@20.0.0)'), { name: 'vite', version: '8.1.4' });
  assert.throws(() => splitPackageKey('novers'), SbomError);
});

test('the SBOM carries no timestamp and no serial number', () => {
  // Both are conventional and both are nondeterministic. Including them would make the SBOM
  // the one file that differs between two environments building the same commit — defeating
  // the byte-identical requirement it is meant to support.
  const sbom = buildSbom([{ name: 'vite', version: '8.1.4', integrity: 'sha512-ZGVm' }], {
    name: '@bleavit/app',
    version: '1.0.0',
  });
  assert.ok(!('timestamp' in sbom));
  assert.ok(!('serialNumber' in sbom));
  assert.ok(!('timestamp' in sbom.metadata));
  assert.equal(sbom.components[0].purl, 'pkg:npm/vite@8.1.4');
  assert.equal(sbom.components[0].hashes[0].alg, 'SHA-512');
});

test('the determinism check reports an embedded build path rather than erasing it', () => {
  // A normalizer that edited the tree would make two environments agree by deleting the
  // evidence that they disagreed. This one names the file and the string.
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/a.js'), 'const x = "/home/builder/app/src/main.ts";');
  writeFileSync(join(dir, 'assets/b.js'), 'const y = 1;');
  const probes = environmentProbes({ appRoot: '/home/builder/app', home: '/home/builder' });
  const findings = checkDeterminism(dir, ['assets/a.js', 'assets/b.js'], probes);
  assert.equal(findings.length, 2, 'the build path and the home directory are separate findings');
  assert.equal(findings[0].path, 'assets/a.js');
});

test('a clean tree yields no determinism findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bleavit-clean-'));
  writeFileSync(join(dir, 'a.js'), 'export const x = 1;');
  const probes = environmentProbes({ appRoot: '/home/builder/app', home: '/home/builder' });
  assert.deepEqual(checkDeterminism(dir, ['a.js'], probes), []);
});
