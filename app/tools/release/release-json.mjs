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

export class ReleaseJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseJsonError';
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every file in the built tree, as release-relative POSIX paths. Sorted, so the map is a
 * function of the tree and not of directory-read order. */
export function walkTree(root, base = root, out = []) {
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) walkTree(path, base, out);
    else out.push(relative(base, path).replaceAll('\\', '/'));
  }
  return out;
}

export function perFileHashes(distDir, { exclude = [] } = {}) {
  const hashes = {};
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
export function buildRecipeDigest(appRoot, inputs) {
  const hash = createHash('sha256');
  for (const relativePath of [...inputs].sort()) {
    const path = resolve(appRoot, relativePath);
    let bytes;
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
 * Descriptor metadata hashes and the served `spec_version` window, read from the committed
 * chain feed rather than restated.
 *
 * 10 §5.1 makes the primary/recovery pair a gate rather than a nicety, so a feed with one
 * directory is refused here too: a release that pinned only the primary would claim a
 * window it cannot serve, and the recovery image is the one that becomes current during
 * exactly the incident it exists for.
 */
export function readChainFeed(feedDir) {
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
  if (recovery !== primary + 1) {
    throw new ReleaseJsonError(`recovery spec_version must be primary + 1; got ${primary}, ${recovery}`);
  }
  const descriptorMetadataHashes = {};
  let contractVersion;
  for (const version of versions) {
    const dir = join(feedDir, String(version));
    const info = JSON.parse(readFileSync(join(dir, 'runtime-info.json'), 'utf8'));
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
  return { specVersionRange: { primary, recovery }, descriptorMetadataHashes, contractVersion };
}

/** Assemble the document. `arweaveManifestTxId` is null here by construction — 12 §1.2's
 * pass 2 is the only thing that may fill it, and a builder that could pre-fill it would be
 * asserting a content address for bytes it has not uploaded. */
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
}) {
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
export function requiredIdentityFields(identitySource) {
  const start = identitySource.indexOf('export interface ReleaseIdentity {');
  if (start === -1) throw new ReleaseJsonError('packages/verify no longer declares ReleaseIdentity');
  const body = identitySource.slice(start, identitySource.indexOf('\n}', start));
  const fields = [...body.matchAll(/^\s*readonly ([A-Za-z0-9_]+)(\?)?:/gm)]
    .filter((match) => match[2] === undefined)
    .map((match) => match[1]);
  if (fields.length === 0) {
    throw new ReleaseJsonError('parsed no required fields out of ReleaseIdentity; the shape moved');
  }
  return fields;
}
