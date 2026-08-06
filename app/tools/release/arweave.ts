/**
 * The two-pass Arweave deploy — 12 §1.2, F11.
 *
 * A pure driver over an injected `uploader`. The concrete Turbo-SDK/permaweb-deploy
 * adapter is **not** here, and that is deliberate rather than unfinished: 12 §1.2 closes
 * with `[VERIFY the exact two-pass flow against live gateway behavior — prototype gate
 * FE-P7]`, and R-2 forbids resolving a `[VERIFY]` tag by assumption. What *is* determinate
 * without a gateway is the flow's arithmetic — which TXID goes where, which file may not be
 * in which pass, and why `M′ ≠ M` — and that is what this module fixes and what
 * `tests/release` exercises against a recording uploader.
 *
 * ## The circularity, and the reason there are two passes at all
 *
 * `release.json` records the manifest TXID of the tree it is part of. Uploading it in pass
 * 1 would make that field a hash of bytes that include the field, so:
 *
 * 1. Upload `dist/` **without** `release.json` → path manifest TXID `M`.
 * 2. Patch `release.json.arweaveManifestTxId = M`, upload it as a tagged sibling TX, and
 *    re-upload the path manifest now including it → `M′`.
 *
 * `M′ ≠ M` necessarily, because the second manifest references one more transaction. 12
 * §1.2 states that consequence explicitly, so an uploader that returns the same TXID twice
 * has not done what it was asked, and this driver refuses rather than reporting success —
 * the failure would otherwise surface as a release whose `release.json` names a manifest
 * that does not contain it.
 *
 * `release.json` records **`M`, the asset-tree manifest**, not `M′`. The app resolves its
 * own base TXID at runtime from `location`, and the verification CLI checks both.
 */

export class ArweaveDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArweaveDeployError';
  }
}

/** The built asset tree: release-relative path → emitted bytes. */
export type AssetTree = ReadonlyMap<string, Uint8Array>;

/** A path-manifest entry: bytes to upload, or the address of an already-uploaded sibling. */
export type ManifestEntry = { bytes: Uint8Array } | { txid: string };

/**
 * The upload surface this driver needs.
 *
 * Injected rather than imported: `arweave.ts` is a pure driver over an uploader, and the
 * Turbo-SDK adapter that satisfies it is prototype gate FE-P7, whose `[VERIFY]` R-2 forbids
 * resolving by assumption. Keeping the port here is what lets the two-pass flow be tested
 * with no network at all.
 */
export interface Uploader {
  uploadTree(entries: ReadonlyMap<string, ManifestEntry>): Promise<string>;
  uploadFile(path: string, bytes: Uint8Array, tags: Readonly<Record<string, string>>): Promise<string>;
}

/** As much of the release document as this driver reads. */
export interface ReleaseDocumentLike {
  readonly schema?: unknown;
  readonly perFileHashes?: Record<string, string>;
  readonly [field: string]: unknown;
}

export interface TwoPassDeployInputs {
  readonly tree: AssetTree;
  readonly releaseJson: ReleaseDocumentLike;
  readonly uploader: Uploader;
  readonly version: string;
  readonly sha256: (bytes: Uint8Array) => string;
}

export interface TwoPassDeployResult {
  readonly assetManifestTxId: string;
  readonly releaseJsonTxId: string;
  readonly manifestTxId: string;
  readonly undername: string;
  readonly releaseJson: ReleaseDocumentLike;
  readonly releaseBytes: Uint8Array;
}

/** The immutable per-release undername of 12 §1.2: `v1-2-3_futarchy`. */
export function releaseUndername(version: string): string {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new ArweaveDeployError(`version ${version} is not a semver this can undername`);
  }
  return `v${version.replaceAll('.', '-').replaceAll('+', '-')}_futarchy`;
}

/**
 * Run the flow.
 *
 * `tree` is a `Map<path, Uint8Array>` of the built asset tree, and it MUST NOT already
 * contain `release.json` — a caller that included it would get a manifest TXID recorded
 * inside the very file that changed the manifest, which is the circularity the two passes
 * exist to break. Refused loudly, because the resulting release verifies against itself
 * and fails against everyone else.
 */
export async function twoPassDeploy({
  tree,
  releaseJson,
  uploader,
  version,
  sha256,
}: TwoPassDeployInputs): Promise<TwoPassDeployResult> {
  if (tree.has('release.json')) {
    throw new ArweaveDeployError(
      'the pass-1 tree must not contain release.json: its manifest TXID field would then ' +
        'describe a tree that includes the field',
    );
  }
  if (releaseJson.arweaveManifestTxId !== null) {
    throw new ArweaveDeployError(
      'release.json already names a content address; a rebuild must start from an unpatched ' +
        'document rather than overwrite a published one',
    );
  }
  if ('releaseTxid' in releaseJson) {
    // The field this driver used to fabricate. It cannot be filled — `M′` addresses a
    // manifest containing this file — so a document carrying it was built by a producer
    // still operating on the superseded format, and publishing it would serve a permanent
    // `null` under a name a verifier reads as the release address.
    throw new ArweaveDeployError(
      'release.json carries a `releaseTxid` field, which 12 §1.2 does not define: the final ' +
        'manifest TXID addresses a manifest containing this file and can never be written ' +
        'into it. The pinned address is `arweaveManifestTxId`; `M′` is observed from ' +
        '`location` at runtime',
    );
  }
  assertPublishable(releaseJson, tree, sha256);

  const assetManifestTxId = await uploader.uploadTree(entriesOf(tree));
  assertTxid(assetManifestTxId, 'pass 1 path manifest');

  const patched = { ...releaseJson, arweaveManifestTxId: assetManifestTxId };
  const releaseBytes = new TextEncoder().encode(`${JSON.stringify(patched, null, 2)}\n`);

  const releaseJsonTxId = await uploader.uploadFile('release.json', releaseBytes, {
    'App-Release': version,
    'App-Manifest': assetManifestTxId,
    'Content-Type': 'application/json',
  });
  assertTxid(releaseJsonTxId, 'release.json sibling transaction');

  // **The final manifest references the sibling by TXID, not by bytes.** Handing the second
  // `uploadTree` the release document's *content* would let an uploader mint a second,
  // independent transaction for it — so the tagged `App-Release` transaction a verifier
  // looks up and the one the manifest actually resolves would be different objects with the
  // same bytes today and no guarantee of it tomorrow. Passing the address makes the binding
  // the driver's, not the uploader's.
  const finalEntries = entriesOf(tree);
  finalEntries.set('release.json', { txid: releaseJsonTxId });
  const manifestTxId = await uploader.uploadTree(finalEntries);
  assertTxid(manifestTxId, 'pass 2 path manifest');

  if (manifestTxId === assetManifestTxId) {
    throw new ArweaveDeployError(
      'pass 2 returned the pass-1 manifest TXID. The second manifest references one more ' +
        'transaction, so an identical address means release.json was not included — the ' +
        'release would name a manifest that does not contain it',
    );
  }

  return {
    /** What `release.json` records: the asset-tree manifest (12 §1.2). */
    assetManifestTxId,
    releaseJsonTxId,
    /**
     * What the ArNS name is repointed to — 12 §1.2's `M′`. Returned to the deployer, and
     * deliberately **not** merged into `releaseJson`: it is not in the served bytes and
     * cannot be, so a returned object carrying it described a document nobody receives.
     * That is precisely how the unfillable `releaseTxid` field survived its own tests.
     */
    manifestTxId,
    undername: releaseUndername(version),
    /** Exactly the object whose serialization is `releaseBytes`, so the two cannot diverge. */
    releaseJson: patched,
    releaseBytes,
  };
}

const entriesOf = (tree: AssetTree): Map<string, ManifestEntry> =>
  new Map([...tree].map(([path, bytes]) => [path, { bytes }]));

/**
 * Refuse to publish a document that is not a release record for *this* tree.
 *
 * The driver used to accept whatever object it was handed, so a three-field stub was
 * publishable — and the flow would have produced a perfectly well-formed deployment of a
 * release document that pins nothing. Two things are checked, and the second is the one that
 * matters: the schema and the required pins must be present, and **`perFileHashes` must
 * describe exactly this tree, digest for digest**. A release whose manifest and whose
 * hash map disagree is the failure every downstream verifier reports as tampering.
 */
export function assertPublishable(
  releaseJson: ReleaseDocumentLike,
  tree: AssetTree,
  sha256: (bytes: Uint8Array) => string,
): void {
  if (releaseJson?.schema !== 'bleavit.app-release.v1') {
    throw new ArweaveDeployError(`not a release document: schema is ${releaseJson?.schema}`);
  }
  for (const field of ['sourceCommit', 'perFileHashes', 'specVersionRange', 'descriptorMetadataHashes']) {
    if (releaseJson[field] === undefined || releaseJson[field] === null) {
      throw new ArweaveDeployError(`release document is missing ${field}`);
    }
  }
  if (typeof sha256 !== 'function') {
    // Required, not optional: an optional hasher is a hash check that defaults to off.
    throw new ArweaveDeployError('a sha256 function is required to bind the document to the tree');
  }
  const { perFileHashes } = releaseJson;
  if (perFileHashes === undefined) {
    throw new ArweaveDeployError('release document is missing perFileHashes');
  }
  const pinned = Object.keys(perFileHashes).sort();
  const actual = [...tree.keys()].sort();
  if (pinned.join('\n') !== actual.join('\n')) {
    throw new ArweaveDeployError(
      `release.json pins ${pinned.length} file(s) and the tree has ${actual.length}; ` +
        `only in the document: [${pinned.filter((p) => !tree.has(p))}]; ` +
        `only in the tree: [${actual.filter((p) => !pinned.includes(p))}]`,
    );
  }
  for (const [path, bytes] of tree) {
    const digest = sha256(bytes);
    if (digest !== perFileHashes[path]) {
      throw new ArweaveDeployError(
        `${path} hashes to ${digest} and release.json pins ${perFileHashes[path]}`,
      );
    }
  }
}

/** Arweave TXIDs are 43 base64url characters. Checked because a stub or an error object
 * stringifies to something that would otherwise be recorded as a content address. */
function assertTxid(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ArweaveDeployError(`${what} did not return a 43-character base64url TXID: ${value}`);
  }
}
