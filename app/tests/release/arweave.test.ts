/**
 * The two-pass Arweave deploy — 12 §1.2 (F11).
 *
 * The live flow is prototype gate FE-P7 and is not resolved here; R-2 forbids answering a
 * `[VERIFY]` tag by assumption. What *is* determinate without a gateway is the flow's
 * arithmetic — which TXID is recorded where, which file may not be in which pass, and why
 * the second manifest address necessarily differs from the first — and that is what this
 * suite pins, against a recording uploader.
 *
 * The circularity being broken is worth restating, because a reader's first instinct is
 * that one upload would do: `release.json` records the manifest TXID of the tree it belongs
 * to, so uploading it in pass 1 would make that field a hash of bytes that include the
 * field.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type {
  AssetTree,
  ManifestEntry,
  ReleaseDocumentLike,
  Uploader,
} from '../../tools/release/arweave.ts';
import {
  ArweaveDeployError,
  assertPublishable,
  releaseUndername,
  twoPassDeploy,
} from '../../tools/release/arweave.ts';

/** What an uploader must never return, expressed so the refusal can be exercised. */
const notATxid = (value: string | undefined): string => value as string;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** One recorded call, so a test can assert what the driver did rather than only what it returned. */
type UploaderCall =
  | { readonly kind: 'tree'; readonly entries: Map<string, ManifestEntry> }
  | { readonly kind: 'file'; readonly path: string; readonly tags: Readonly<Record<string, string>> };

interface RecordingUploader extends Uploader {
  readonly calls: UploaderCall[];
}

/** A deterministic stand-in: the "TXID" is a content address of what it was given, which is
 * exactly the property the real flow depends on — one different entry, one different
 * address. */
function recordingUploader(): RecordingUploader {
  const calls: UploaderCall[] = [];
  const address = (input: string): string =>
    createHash('sha256').update(input).digest('base64url').slice(0, 43);
  return {
    calls,
    async uploadTree(entries: ReadonlyMap<string, ManifestEntry>) {
      const manifest = [...entries.keys()]
        .sort()
        .map((path) => {
          const entry = entries.get(path);
          assert.ok(entry, `the manifest lists ${path} with no entry`);
          // `ManifestEntry` is a union — bytes to upload, or an already-uploaded sibling's
          // address — and the stand-in must address both arms, which is exactly the
          // property the real two-pass flow turns on.
          return `${path}:${'txid' in entry ? entry.txid : sha256(entry.bytes)}`;
        })
        .join('|');
      calls.push({ kind: 'tree', entries: new Map(entries) });
      return address(manifest);
    },
    async uploadFile(path: string, contents: Uint8Array, tags: Readonly<Record<string, string>>) {
      calls.push({ kind: 'file', path, tags });
      return address(`${path}:${Buffer.from(contents).toString('base64')}`);
    },
  };
}

const treeOf = (entries: Readonly<Record<string, string>>): Map<string, Uint8Array> =>
  new Map(Object.entries(entries).map(([path, text]) => [path, new TextEncoder().encode(text)]));

/** A document that genuinely describes its tree — the only thing the driver will publish. */
function releaseFor(tree: AssetTree): ReleaseDocumentLike {
  const perFileHashes: Record<string, string> = {};
  for (const [path, bytes] of tree) perFileHashes[path] = sha256(bytes);
  return {
    schema: 'bleavit.app-release.v1',
    version: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    perFileHashes,
    specVersionRange: { primary: 2, recovery: 3 },
    descriptorMetadataHashes: { 2: 'b'.repeat(64), 3: 'c'.repeat(64) },
    // No `releaseTxid`. It is not a field 12 §1.2 defines, and it could never be filled:
    // `M′` addresses a manifest containing this file. The driver now refuses a document
    // carrying it, so a producer left on the superseded format fails loudly.
    arweaveManifestTxId: null,
  };
}

const TREE = treeOf({ 'index.html': '<!doctype html>', 'assets/a.js': 'x' });

test('release.json records the asset-tree manifest, and the final manifest differs from it', async () => {
  const uploader = recordingUploader();
  const result = await twoPassDeploy({
    tree: TREE,
    releaseJson: releaseFor(TREE),
    uploader,
    version: '1.2.3',
    sha256,
  });
  assert.match(result.assetManifestTxId, /^[A-Za-z0-9_-]{43}$/);
  // 12 §1.2 states the consequence explicitly: the second manifest references one more
  // transaction, so `M′ ≠ M`. What the name is repointed to is `M′`; what the release
  // records is `M`.
  assert.notEqual(result.manifestTxId, result.assetManifestTxId);
  assert.deepEqual(uploader.calls.map((call) => call.kind), ['tree', 'file', 'tree']);

  // **Asserted on the UPLOADED BYTES, not on the returned object.** This is the whole
  // repair. The previous version checked `result.releaseJson`, which the driver was free
  // to decorate with fields the served document does not contain — and it did exactly
  // that, writing `releaseTxid: M′` into the returned object while uploading a document
  // whose value was `null`. Every producer test passed and `parseReleaseDocument` refused
  // every real deployment as `unpublished`. Only the bytes are the release.
  const uploaded = JSON.parse(new TextDecoder().decode(result.releaseBytes));
  assert.equal(uploaded.arweaveManifestTxId, result.assetManifestTxId);
  assert.equal('releaseTxid' in uploaded, false, 'an unfillable field is back in the served document');
  assert.deepEqual(uploaded, result.releaseJson, 'the returned object must BE the served document');
});

test('the final manifest references the sibling by TXID, not by a second copy of its bytes', async () => {
  // Handing the second `uploadTree` the document's content would let an uploader mint an
  // independent transaction for it, so the tagged `App-Release` transaction a verifier looks
  // up and the one the manifest resolves would be different objects.
  const uploader = recordingUploader();
  const result = await twoPassDeploy({
    tree: TREE,
    releaseJson: releaseFor(TREE),
    uploader,
    version: '1.2.3',
    sha256,
  });
  const finalTree = uploader.calls.filter((call) => call.kind === 'tree').at(-1);
  assert.ok(finalTree, 'the driver made no second tree upload');
  const entry = finalTree.entries.get('release.json');
  assert.ok(entry, 'the final manifest does not list release.json');
  // Checked as a discriminated union rather than as two field reads: `ManifestEntry` is
  // *either* bytes to upload *or* an already-uploaded sibling's address, and `entry.bytes
  // === undefined` would also be satisfied by an entry that has neither.
  assert.ok('txid' in entry, 'release.json was re-sent as bytes instead of referenced by TXID');
  assert.equal(entry.txid, result.releaseJsonTxId);
  assert.equal('bytes' in entry, false, 'the bytes are not passed a second time');
});

test('the sibling transaction carries the tags a verifier looks it up by', async () => {
  const uploader = recordingUploader();
  const result = await twoPassDeploy({
    tree: TREE,
    releaseJson: releaseFor(TREE),
    uploader,
    version: '1.2.3',
    sha256,
  });
  const file = uploader.calls.find((call) => call.kind === 'file');
  assert.ok(file, 'the driver uploaded no sibling transaction');
  assert.equal(file.path, 'release.json');
  assert.equal(file.tags['App-Release'], '1.2.3');
  assert.equal(file.tags['App-Manifest'], result.assetManifestTxId);
});

test('a document that does not describe this tree is refused before anything is uploaded', async () => {
  // A three-field stub used to be publishable, and the flow would have produced a
  // well-formed deployment of a release record that pins nothing.
  const uploader = recordingUploader();
  await assert.rejects(
    twoPassDeploy({
      tree: TREE,
      releaseJson: { schema: 'bleavit.app-release.v1', version: '1.2.3', arweaveManifestTxId: null },
      uploader,
      version: '1.2.3',
      sha256,
    }),
    ArweaveDeployError,
  );
  assert.equal(uploader.calls.length, 0, 'nothing was uploaded');
});

test('a hash map that disagrees with the tree is refused in both directions', () => {
  const good = releaseFor(TREE);
  // A file in the tree that the document does not pin — the direction a per-entry loop over
  // the document cannot see, and how a payload arrives.
  const extra = new Map(TREE).set('assets/extra.js', new TextEncoder().encode('payload'));
  assert.throws(() => assertPublishable(good, extra, sha256), ArweaveDeployError);
  // A pinned file that is not in the tree.
  const indexBytes = TREE.get('index.html');
  assert.ok(indexBytes, 'the fixture tree carries index.html');
  assert.throws(() => assertPublishable(good, new Map([['index.html', indexBytes]]), sha256), ArweaveDeployError);
  // Right paths, wrong digest.
  const tampered = new Map(TREE).set('assets/a.js', new TextEncoder().encode('y'));
  assert.throws(() => assertPublishable(good, tampered, sha256), ArweaveDeployError);
  assert.doesNotThrow(() => assertPublishable(good, TREE, sha256));
});

test('the hasher is required, because an optional one is a hash check that defaults off', () => {
  // The type already forbids omitting it; the runtime refusal is what covers a caller that
  // reached this function without one — through JSON, a spread, or a config object. Both
  // halves are wanted, so the fixture names what it is doing rather than hiding it in a
  // bare cast: `absent` produces the value an untyped caller would have passed.
  const absent = (hasher: ((bytes: Uint8Array) => string) | undefined): ((bytes: Uint8Array) => string) =>
    hasher as (bytes: Uint8Array) => string;
  assert.throws(() => assertPublishable(releaseFor(TREE), TREE, absent(undefined)), ArweaveDeployError);
});

test('release.json in the pass-1 tree is refused', async () => {
  // The resulting release verifies against itself and fails against everyone else, which is
  // the worst shape a distribution bug can take.
  const tree = new Map(TREE).set('release.json', new TextEncoder().encode('{}'));
  await assert.rejects(
    twoPassDeploy({ tree, releaseJson: releaseFor(tree), uploader: recordingUploader(), version: '1.2.3', sha256 }),
    ArweaveDeployError,
  );
});

test('a release document that already names a content address is refused', async () => {
  await assert.rejects(
    twoPassDeploy({
      tree: TREE,
      releaseJson: { ...releaseFor(TREE), arweaveManifestTxId: 'A'.repeat(43) },
      uploader: recordingUploader(),
      version: '1.2.3',
      sha256,
    }),
    ArweaveDeployError,
  );
  // A document carrying `releaseTxid` at all is refused, filled in or not: the field is
  // not one 12 §1.2 defines and can never hold a true value, so its presence means the
  // producer is on the superseded format. Publishing it would serve a permanent `null`
  // under a name a verifier reads as the release address.
  await assert.rejects(
    twoPassDeploy({
      tree: TREE,
      releaseJson: { ...releaseFor(TREE), releaseTxid: 'A'.repeat(43) },
      uploader: recordingUploader(),
      version: '1.2.3',
      sha256,
    }),
    ArweaveDeployError,
  );
});

test('an uploader that returns the pass-1 address twice is refused, not reported as success', async () => {
  // The symptom in production would be a release whose `release.json` names a manifest that
  // does not contain it — visible only to whoever checks, which is nobody by default.
  const constant = 'B'.repeat(43);
  await assert.rejects(
    twoPassDeploy({
      tree: TREE,
      releaseJson: releaseFor(TREE),
      uploader: { uploadTree: async () => constant, uploadFile: async () => 'C'.repeat(43) },
      version: '1.2.3',
      sha256,
    }),
    ArweaveDeployError,
  );
});

test('a non-TXID from the uploader fails rather than being recorded as a content address', async () => {
  await assert.rejects(
    twoPassDeploy({
      tree: TREE,
      releaseJson: releaseFor(TREE),
      // An uploader that answers with something that is not a TXID — the reason the driver
      // checks its return rather than trusting it. Typed through `notATxid` so the fixture
      // states that the wrong-shaped answer is the input under test.
      uploader: { uploadTree: async () => notATxid(undefined), uploadFile: async () => 'C'.repeat(43) },
      version: '1.2.3',
      sha256,
    }),
    ArweaveDeployError,
  );
});

test('the per-release undername is derived from the version', () => {
  assert.equal(releaseUndername('1.2.3'), 'v1-2-3_futarchy');
  assert.equal(releaseUndername('1.2.3-rc.1'), 'v1-2-3-rc-1_futarchy');
  assert.throws(() => releaseUndername('latest'), ArweaveDeployError);
});
