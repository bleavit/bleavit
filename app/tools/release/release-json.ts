/**
 * `release.json` — what the bundle pins about itself (12 §1.1, INV-FE-11, F11).
 *
 * The field set is not a convenience bag: INV-FE-11 enumerates exactly what a bundle must
 * pin, and `packages/verify`'s `ReleaseIdentity` reproduces that list as **required**
 * fields for the reason recorded there — an identity record missing a pin is not a partial
 * identity, it is a bundle that cannot prove one of the things the invariant says it
 * proves. This module is the producer on the other side of that consumer, so the two are
 * checked against each other by `tests/release` rather than kept in step by hand.
 *
 * ## Readiness, not silence
 *
 * Several pins cannot exist before genesis: there is no production chain to take a genesis
 * hash from, no seated bootnode operator, no chosen gateway set, no release keyring. The
 * options were to block the build, or to emit `null` and hope. Both are worse than the
 * third: the document carries a **`readiness` block naming every unresolved blocker**, and
 * `release:check --production` exits non-zero while any remain. That is the same shape the
 * chain-side `tools/release/` already uses, and it keeps the pipeline exercised on every
 * commit — a release pipeline that only runs at a tag is a release pipeline that is first
 * debugged during a release.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const RELEASE_SCHEMA = 'bleavit.app-release.v1';

/** The `runtime-info.json` fields this reader consumes. */
interface RuntimeInfo {
  readonly spec_version: number;
  readonly metadata_sha256: string;
  readonly integration_contract_version: number;
}

/** What the feed pins: the paired spec versions and each one's measured metadata hash. */
export interface ChainFeedPins {
  readonly specVersionRange: { readonly primary: number; readonly recovery: number };
  readonly descriptorMetadataHashes: Record<number, string>;
  readonly contractVersion: number;
}

/** The `fixtures/foreign-chain-feed/<chain>/<spec_version>/runtime-info.json` fields read here. */
interface ForeignRuntimeInfo {
  readonly schema?: unknown;
  readonly label?: unknown;
  readonly relay?: unknown;
  readonly core_version?: { readonly spec_version?: unknown };
  readonly metadata?: { readonly sha256?: unknown };
}

/**
 * What a release pins about the foreign chain its funding leg reads — 12 §1.1, §1.6.
 *
 * `network` is the **relay** whose Asset Hub this release targets, not a chain name: 12 §1.6
 * monitors Asset Hub `spec_version` "on both networks", and 08 §2.5 / 09 §6.3 open HRMP to
 * Paseo's Asset Hub at Phase 2 and Polkadot's at Phase 3 — so which one a release pins is a
 * property of the relay it targets.
 */
export interface ForeignFeedPins {
  readonly network: string | null;
  /** `spec_version` → sha256 of the descriptor metadata. Bare hex, as the Bleavit map is. */
  readonly descriptorMetadataHashes: Record<string, string>;
}

const FOREIGN_INFO_SCHEMA = 'bleavit.foreign-runtime-info.v1';

/**
 * The one label the release format has a slot for.
 *
 * `release.json` carries a single `assetHub` block, so a foreign chain the feed pins under
 * any other label has nowhere in the document to live. Publishing it *as* the Asset Hub set
 * would be a mislabel a consumer cannot detect, and dropping it silently would be worse, so
 * the reader refuses instead of doing either. Kept as a literal rather than imported from
 * `packages/descriptors` because this tool runs over the source tree and must not acquire a
 * build-order dependency on the package graph — the same reason `check-foreign-feed.ts`
 * parses `foreign.ts` rather than importing it.
 */
const FOREIGN_SLOT_LABEL = 'Asset Hub';

/** `0x…` or bare, normalised to the bare hex `Sha256Hex` this document publishes. */
function bareHex(value: unknown): string {
  return typeof value === 'string' && value.startsWith('0x') ? value.slice(2) : String(value ?? '');
}

export class ReleaseJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseJsonError';
  }
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every file in the built tree, as release-relative POSIX paths. Sorted, so the map is a
 * function of the tree and not of directory-read order. */
export function walkTree(root: string, base = root, out: string[] = []): string[] {
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) walkTree(path, base, out);
    else out.push(relative(base, path).replaceAll('\\', '/'));
  }
  return out;
}

export function perFileHashes(
  distDir: string,
  { exclude = [] }: { readonly exclude?: readonly string[] } = {},
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of walkTree(distDir)) {
    if (exclude.includes(path)) continue;
    if (!/^[A-Za-z0-9._/-]+$/.test(path)) {
      // The map is substituted into the service worker as a JS string literal, and a path
      // outside this alphabet would need escaping the substitution does not do. Refused at
      // the source rather than escaped downstream: a path this build cannot represent is a
      // path a verifier would compare wrongly.
      throw new ReleaseJsonError(`emitted path is outside the release path alphabet: ${path}`);
    }
    hashes[path] = sha256(readFileSync(join(distDir, path)));
  }
  return hashes;
}

/**
 * The build-recipe digest — a hash over the files that *decide* what the build produces.
 *
 * Named inputs rather than "the whole repo": the digest's job is to let a second builder
 * say "I used the same recipe", and a digest that moved on every source edit would say
 * nothing, because it would never match across two commits that legitimately share a
 * recipe. A missing input is an error, not a skipped one — a recipe digest computed over
 * four of five files is a digest that agrees with a build it did not describe.
 */
export function buildRecipeDigest(appRoot: string, inputs: readonly string[]): string {
  const hash = createHash('sha256');
  for (const relativePath of [...inputs].sort()) {
    const path = resolve(appRoot, relativePath);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      throw new ReleaseJsonError(`build recipe input ${relativePath} is missing`);
    }
    hash.update(relativePath).update('\0').update(sha256(bytes)).update('\n');
  }
  return hash.digest('hex');
}

/**
 * The **tree digest** — 12 §1.1's "identical tree hash", INV-FE-10's "byte-identical output
 * whose tree hash equals the published release manifest" (F13).
 *
 * Neither section fixes an algorithm, so this one is *derived from the framing already in
 * this file* rather than invented beside it: `buildRecipeDigest` above hashes
 * `path \0 <file digest> \n` per sorted input, and this does the same over the per-file map.
 * One framing for both means a reader who has understood one has understood the other, and
 * a second implementation has one thing to reproduce.
 *
 * Three properties are load-bearing:
 *
 *  - **Sorted**, so the digest is a function of the tree and not of directory-read order —
 *    the same reason `walkTree` sorts.
 *  - **Path-committing**, so renaming a file changes the digest even though every byte in
 *    the tree is unchanged. A digest over the file hashes alone would call a renamed tree
 *    reproduced.
 *  - **`\0` and `\n` framed**, so the serialization is injective *without borrowing that
 *    property from the digests being 64 characters long. Bare concatenation is injective
 *    only while every digest has the same length — true today, and a silent dependency on
 *    a fact about SHA-256 rather than about this function. It is also the framing
 *    `buildRecipeDigest` above already uses, so there is one convention here and not two.
 *
 * An empty map is refused rather than digested. Two builds that emitted nothing agree on the
 * digest of nothing, and "the build produced no files" must never read as "the two
 * environments reproduced each other". A malformed entry is refused for the same reason: the
 * map would not be what it claims, and the digest would certify it anyway.
 *
 * `perFileHashes` restricts emitted paths to `[A-Za-z0-9._/-]`, which is why sorting agrees
 * across languages here: over that alphabet JavaScript's UTF-16 code-unit order and Python's
 * code-point order are the same order.
 */
export function treeDigest(files: Readonly<Record<string, string>>): string {
  const paths = Object.keys(files).sort();
  if (paths.length === 0) {
    throw new ReleaseJsonError('a tree digest over zero files certifies nothing; refusing');
  }
  const hash = createHash('sha256');
  for (const path of paths) {
    const digest = files[path];
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new ReleaseJsonError(`${path} carries ${JSON.stringify(digest)}, which is not a sha256`);
    }
    hash.update(path).update('\0').update(digest).update('\n');
  }
  return hash.digest('hex');
}

/**
 * Descriptor metadata hashes and the served `spec_version` window, read from the committed
 * chain feed rather than restated.
 *
 * 10 §5.1 makes the primary/recovery pair a gate rather than a nicety, so a feed with one
 * directory is refused here too: a release that pinned only the primary would claim a
 * window it cannot serve, and the recovery image is the one that becomes current during
 * exactly the incident it exists for.
 */
export function readChainFeed(feedDir: string): ChainFeedPins {
  const versions = readdirSync(feedDir)
    .filter((entry) => /^[0-9]+$/.test(entry) && statSync(join(feedDir, entry)).isDirectory())
    .map(Number)
    .sort((a, b) => a - b);
  if (versions.length !== 2) {
    throw new ReleaseJsonError(
      `the chain feed must carry exactly one primary and one recovery spec_version ` +
        `(10 §5.1); found ${versions.length}: ${versions.join(', ')}`,
    );
  }
  const [primary, recovery] = versions;
  if (primary === undefined || recovery === undefined) {
    throw new ReleaseJsonError('the chain feed yielded no spec versions');
  }
  if (recovery !== primary + 1) {
    throw new ReleaseJsonError(`recovery spec_version must be primary + 1; got ${primary}, ${recovery}`);
  }
  const descriptorMetadataHashes: Record<number, string> = {};
  let contractVersion: number | undefined;
  for (const version of versions) {
    const dir = join(feedDir, String(version));
    const info = JSON.parse(readFileSync(join(dir, 'runtime-info.json'), 'utf8')) as RuntimeInfo;
    if (info.spec_version !== version) {
      throw new ReleaseJsonError(`chain-feed/${version} declares spec_version ${info.spec_version}`);
    }
    // **Re-hash the metadata rather than copying the header's claim about it.** INV-FE-11
    // makes this a *pin* — something the bundle asserts and a verifier re-derives — and a
    // pin copied from a sibling JSON file pins that file's opinion. A stale-but-well-formed
    // header would produce a descriptor hash that matches nothing, and the failure would
    // surface as a compat probe against a runtime the release never actually described.
    const measured = sha256(readFileSync(join(dir, 'metadata.scale')));
    if (info.metadata_sha256 !== measured) {
      throw new ReleaseJsonError(
        `chain-feed/${version}: runtime-info.json declares metadata_sha256 ${info.metadata_sha256} ` +
          `but metadata.scale hashes to ${measured}`,
      );
    }
    descriptorMetadataHashes[version] = measured;
    contractVersion ??= info.integration_contract_version;
    if (info.integration_contract_version !== contractVersion) {
      throw new ReleaseJsonError(
        `the paired runtimes disagree on the integration contract version ` +
          `(${contractVersion} vs ${info.integration_contract_version})`,
      );
    }
  }
  if (contractVersion === undefined) {
    throw new ReleaseJsonError('no runtime in the feed declares an integration contract version');
  }
  return { specVersionRange: { primary, recovery }, descriptorMetadataHashes, contractVersion };
}

/**
 * The Asset Hub descriptor set, read from the committed foreign chain feed — 12 §1.1, §1.6.
 *
 * 12 §1.1 requires `release.json` to record descriptor metadata hashes **"including the Asset
 * Hub descriptor set"**, and §1.6 explains why it is a separate set rather than a row in the
 * Bleavit map: Asset Hub upgrades ride the Fellowship's schedule, ship through the expedited
 * lane, and a stale Asset Hub set degrades only the funding flow.
 *
 * **Derived, never declared.** The hashes already exist as committed artifacts — the feed at
 * `fixtures/foreign-chain-feed/` is what `.papi/polkadot-api.json` generates descriptors
 * from and what `FOREIGN_CHAIN_PINS` is checked against — so copying them into
 * `release-sources.json` by hand would create a second home for a value that has one, and
 * the copy that rots is always the one nothing reads back (app-code rule 7). It also removes
 * the failure this reader replaced: the set was a hand-declared field nobody had filled, so
 * `release.json` published an empty Asset Hub map while the artifacts sat in the tree.
 *
 * **Re-hashed, not copied**, for the reason `readChainFeed` gives: INV-FE-11 makes this a
 * *pin*, and a pin taken from a sibling JSON file pins that file's opinion of a blob rather
 * than the blob.
 *
 * An absent or empty feed returns empty and is **not** an error here: a release targeting a
 * relay whose Asset Hub this repository has not pinned is a state the rollout explicitly has
 * (08 §2.5), and `classifyForeign` reports it as `unreachable` with the deposit leg blocked.
 * The caller turns it into a named readiness blocker.
 */
export function readForeignChainFeed(feedDir: string): ForeignFeedPins {
  const empty: ForeignFeedPins = { network: null, descriptorMetadataHashes: {} };
  let chainDirs: string[];
  try {
    chainDirs = readdirSync(feedDir)
      .filter((entry) => statSync(join(feedDir, entry)).isDirectory())
      .sort();
  } catch {
    return empty;
  }
  const [chain, ...extra] = chainDirs;
  if (chain === undefined) return empty;
  if (extra.length > 0) {
    throw new ReleaseJsonError(
      `the foreign chain feed carries ${chainDirs.length} chains (${chainDirs.join(', ')}) and ` +
        'release.json has one foreign slot. A release pins the Asset Hub of the relay it ' +
        'targets (08 §2.5), so choosing between them here would be a property of directory ' +
        'order rather than of anything anyone decided.',
    );
  }

  const chainPath = join(feedDir, chain);
  const versions = readdirSync(chainPath)
    .filter((entry) => /^[0-9]+$/.test(entry) && statSync(join(chainPath, entry)).isDirectory())
    .sort();
  if (versions.length === 0) return empty;

  const descriptorMetadataHashes: Record<string, string> = {};
  let network: string | null = null;
  for (const version of versions) {
    const dir = join(chainPath, version);
    const where = `foreign-chain-feed/${chain}/${version}`;
    const info = JSON.parse(readFileSync(join(dir, 'runtime-info.json'), 'utf8')) as ForeignRuntimeInfo;
    if (info.schema !== FOREIGN_INFO_SCHEMA) {
      throw new ReleaseJsonError(`${where}: schema is ${JSON.stringify(info.schema)}`);
    }
    if (info.label !== FOREIGN_SLOT_LABEL) {
      throw new ReleaseJsonError(
        `${where}: the feed pins ${JSON.stringify(info.label)}, and release.json has a slot ` +
          `only for ${JSON.stringify(FOREIGN_SLOT_LABEL)}. Publishing it under that name would ` +
          'mislabel a chain the funding leg never reads.',
      );
    }
    // The directory name is the selector a consumer resolves a `spec_version` through, so a
    // directory disagreeing with the runtime inside it hands out the wrong artifact while
    // every internal check still passes — the rule both feeds already carry.
    if (String(info.core_version?.spec_version) !== version) {
      throw new ReleaseJsonError(
        `${where}: declares spec_version ${String(info.core_version?.spec_version)}`,
      );
    }
    const measured = sha256(readFileSync(join(dir, 'metadata.scale')));
    const declared = bareHex(info.metadata?.sha256);
    if (declared !== measured) {
      throw new ReleaseJsonError(
        `${where}: runtime-info.json declares metadata sha256 ${declared} but metadata.scale ` +
          `hashes to ${measured}`,
      );
    }
    descriptorMetadataHashes[version] = measured;

    const relay = typeof info.relay === 'string' ? info.relay : null;
    if (relay === null) throw new ReleaseJsonError(`${where}: declares no relay`);
    if (network === null) network = relay;
    else if (network !== relay) {
      throw new ReleaseJsonError(
        `${where}: the feed's runtimes disagree on the relay (${network} vs ${relay}); a ` +
          'release targets one',
      );
    }
  }
  return { network, descriptorMetadataHashes };
}

/** Assemble the document. `arweaveManifestTxId` is null here by construction — 12 §1.2's
 * pass 2 is the only thing that may fill it, and a builder that could pre-fill it would be
 * asserting a content address for bytes it has not uploaded. */
export interface ReleaseJsonInputs {
  readonly version: string;
  readonly sourceCommit: string;
  readonly buildRecipe: string;
  /** Path → sha256, over the emitted tree. */
  readonly files: Record<string, string>;
  readonly chainFeed: ChainFeedPins;
  readonly chainIdentity: {
    // `null` per field, never an absent field and never a placeholder: an unmade pin has to
    // survive into the document as one, because `readiness.blockers` naming it and the field
    // itself carrying a plausible-looking value would state two different things about the
    // same fact — and the one a consumer parses is the field.
    readonly chainSpecHashes: Readonly<Record<string, string | null>>;
    readonly genesisHashes: Readonly<Record<string, string | null>>;
    readonly ss58Prefix: number | null;
    readonly paraId: number | null;
    /** Per token, e.g. `{ VIT: 12, USDC: 6 }` — D-17 pins USDC at 6. */
    readonly decimals: Readonly<Record<string, number>> | null;
  };
  readonly assetHub?:
    | {
        readonly network: string | null;
        readonly descriptorMetadataHashes: Readonly<Record<string, string>>;
      }
    | undefined;
  readonly connectSrc: readonly string[];
  readonly sbomSha256: string;
  readonly signing: {
    readonly keyringGeneration: number | null;
    readonly keyIds: readonly string[];
  };
  /** Every pin this tree cannot yet make. `--production` refuses while any remain. */
  readonly blockers: readonly string[];
}

/**
 * `release.json` as it is written.
 *
 * Declared rather than left as `object`, because the suite that checks this document is the
 * one place a field-name slip surfaces — and `object` made every field access an error and
 * every `as` a temptation. It is **not** a second copy of `packages/verify`'s
 * `ReleaseIdentity`: the required-field list is still parsed out of that interface at test
 * time (a hand-written list beside the producer is exactly how `releaseTxid` came to be
 * demanded by the consumer and never emitted here), and this type only says what the
 * builder writes.
 */
export interface ReleaseDocument {
  readonly schema: string;
  readonly version: string;
  readonly sourceCommit: string;
  readonly buildRecipeDigest: string;
  readonly arweaveManifestTxId: string | null;
  readonly perFileHashes: Record<string, string>;
  readonly specVersionRange: ChainFeedPins['specVersionRange'];
  readonly descriptorMetadataHashes: Record<number, string>;
  readonly assetHub: NonNullable<ReleaseJsonInputs['assetHub']>;
  readonly integrationContractVersion: number;
  readonly chainSpecHashes: ReleaseJsonInputs['chainIdentity']['chainSpecHashes'];
  readonly genesisHashes: ReleaseJsonInputs['chainIdentity']['genesisHashes'];
  readonly chainIdentity: {
    readonly ss58Prefix: number | null;
    readonly paraId: number | null;
    readonly decimals: ReleaseJsonInputs['chainIdentity']['decimals'];
  };
  readonly connectSrc: readonly string[];
  readonly sbomSha256: string;
  readonly keyringGeneration: number | null;
  readonly signingKeyIds: readonly string[];
  readonly readiness: {
    readonly productionReady: boolean;
    readonly blockers: readonly string[];
    readonly note: string;
  };
}

export function buildReleaseJson({
  version,
  sourceCommit,
  buildRecipe,
  files,
  chainFeed,
  chainIdentity,
  assetHub,
  connectSrc,
  sbomSha256,
  signing,
  blockers,
}: ReleaseJsonInputs): ReleaseDocument {
  return {
    schema: RELEASE_SCHEMA,
    version,
    sourceCommit,
    buildRecipeDigest: buildRecipe,
    /**
     * INV-FE-11's pinned "release content address" — 12 §1.2's asset-tree manifest `M`,
     * patched in by the second pass. `null` here is the pre-publication state, and
     * `parseReleaseDocument` refuses it as `unpublished`.
     *
     * There is deliberately **no `releaseTxid` field**. A previous round added one, meaning
     * the *final* manifest `M′`, and it could never be filled: `M′` addresses a manifest
     * that contains this file, so writing it in changes the file and therefore changes
     * `M′`. It shipped `null` in every real deployment while the deploy driver's returned
     * object carried the value — which is why the producer's tests passed and the consumer
     * refused every genuine release. 12 §1.2 resolves it the only way it can: `M` is
     * pinned here, `M′` is observed at runtime from `location`.
     */
    arweaveManifestTxId: null,
    perFileHashes: files,
    specVersionRange: chainFeed.specVersionRange,
    descriptorMetadataHashes: chainFeed.descriptorMetadataHashes,
    // Kept separate from the Bleavit set rather than merged into it: Asset Hub upgrades ride
    // the Fellowship's schedule, ship through the expedited lane, and degrade only the
    // funding flow (12 §1.6, D-12) — a merged map would make a stale Asset Hub set look like
    // a stale Bleavit descriptor, which is a far more serious thing.
    assetHub: assetHub ?? { network: null, descriptorMetadataHashes: {} },
    integrationContractVersion: chainFeed.contractVersion,
    chainSpecHashes: chainIdentity.chainSpecHashes,
    genesisHashes: chainIdentity.genesisHashes,
    chainIdentity: {
      ss58Prefix: chainIdentity.ss58Prefix,
      paraId: chainIdentity.paraId,
      decimals: chainIdentity.decimals,
    },
    connectSrc,
    sbomSha256,
    keyringGeneration: signing.keyringGeneration,
    signingKeyIds: signing.keyIds,
    readiness: {
      productionReady: blockers.length === 0,
      blockers,
      note:
        'Every entry is a pin this tree cannot yet make. `release:check --production` ' +
        'exits non-zero while any remain; an ordinary build still runs, so the pipeline ' +
        'is exercised on every commit rather than first debugged during a release.',
    },
  };
}

/**
 * The producer/consumer contract with `packages/verify`, **read from the consumer**.
 *
 * An earlier version of this was a hand-written list, and the test that compared the
 * document against it therefore compared the producer with a second copy of the producer:
 * `ReleaseIdentity` requires `releaseTxid` and the document emitted only
 * `arweaveManifestTxId`, and nothing noticed, because the list agreed with the document
 * rather than with the interface. So the field names are parsed out of `identity.ts` — the
 * declaration INV-FE-11's list is transcribed into — and a shape change there fails here.
 */
export function requiredIdentityFields(identitySource: string): string[] {
  const start = identitySource.indexOf('export interface ReleaseIdentity {');
  if (start === -1) throw new ReleaseJsonError('packages/verify no longer declares ReleaseIdentity');
  const body = identitySource.slice(start, identitySource.indexOf('\n}', start));
  const fields = [...body.matchAll(/^\s*readonly ([A-Za-z0-9_]+)(\?)?:/gm)]
    .filter((match) => match[2] === undefined)
    .map((match) => match[1] ?? '');
  if (fields.length === 0) {
    throw new ReleaseJsonError('parsed no required fields out of ReleaseIdentity; the shape moved');
  }
  return fields;
}
