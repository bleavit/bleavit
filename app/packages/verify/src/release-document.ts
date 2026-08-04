/**
 * Reading `release.json` — the consumer side of the F11 producer (12 §1.1, INV-FE-11).
 *
 * `app/tools/release/build.mjs` writes this document; `ReleaseIdentity` is what the rest of
 * `packages/verify` consumes. This module is the join, and it exists as its own file because
 * the join is where the two halves can silently disagree: the producer emitted
 * `arweaveManifestTxId` while the consumer required `releaseTxid`, and the test that should
 * have noticed compared the producer against a list kept beside the producer.
 *
 * ## Refusal, not repair, and not a partial identity
 *
 * Every path here returns a verdict rather than throwing or filling a gap. A malformed
 * record is a *finding about the bundle*, and 10 §3.2 lists the verification panel among
 * the surfaces that must still render when nothing else does — so the panel has to be able
 * to say "this release cannot describe itself" rather than crashing on the way to saying it.
 *
 * Three refusals are worth stating outright, because each is a place where being lenient
 * would produce a bundle that *looks* verified:
 *
 * 1. **An unpublished document is refused.** `releaseTxid: null` is what the builder emits
 *    before 12 §1.2's second pass fills it in. A bundle serving that record has no content
 *    address, so nothing a user could compare it against exists — and INV-FE-11's first pin
 *    is exactly that address.
 * 2. **A record with unresolved readiness blockers is refused.** The blockers are the pins
 *    the build could not make. Accepting the document and rendering the fields that *are*
 *    present would show a verification panel full of green rows whose absent neighbours are
 *    the reason the release is not one.
 * 3. **A hash that is present but not a hash is refused**, in the same way and for the same
 *    reason a missing one is: `verifyChainIdentity` compares pins against a live chain, and
 *    a malformed pin is a comparison that can never match, shipped in a record that claimed
 *    to be complete.
 */

import type { Hash32, ReleaseIdentity, SpecVersionRange } from './identity.js';

export const RELEASE_SCHEMA = 'bleavit.app-release.v1';

export type ReleaseDocumentVerdict =
  | { readonly kind: 'identity'; readonly identity: ReleaseIdentity }
  | { readonly kind: 'refused'; readonly reason: string; readonly detail: string };

const HASH32 = /^0x[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const TXID = /^[A-Za-z0-9_-]{43}$/;

function refuse(reason: string, detail: string): ReleaseDocumentVerdict {
  return { kind: 'refused', reason, detail };
}

/**
 * Read own, non-getter properties only.
 *
 * The same discipline `runSelfCheck` applies, for the same reason: this document arrives
 * from a gateway, `Object.entries` and a plain lookup disagree on a prototype-backed
 * object, and a getter can return a different value on each read — so the pair that is
 * validated would not be the pair that is used.
 */
function own(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function readHashMap(source: unknown, pattern: RegExp): Record<string, string> | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.getOwnPropertyNames(source)) {
    const value = own(source, key);
    if (typeof value !== 'string' || !pattern.test(value)) return undefined;
    out[key] = value;
  }
  return out;
}

/** Parse a served `release.json` into the identity the rest of this package consumes. */
export function parseReleaseDocument(document: unknown): ReleaseDocumentVerdict {
  if (own(document, 'schema') !== RELEASE_SCHEMA) {
    return refuse(
      'not-a-release-record',
      `this file does not declare itself a ${RELEASE_SCHEMA} document, so nothing in it can be ` +
        'read as a release identity',
    );
  }

  const readiness = own(document, 'readiness');
  const blockers = own(readiness, 'blockers');
  if (own(readiness, 'productionReady') !== true) {
    const named = Array.isArray(blockers) ? blockers.length : 0;
    return refuse(
      'not-a-production-release',
      `this record names ${named} unresolved readiness blocker(s) — pins the build could not ` +
        'make. Rendering the fields that are present would show a panel of green rows whose ' +
        'absent neighbours are the reason this is not a release.',
    );
  }

  const releaseTxid = own(document, 'releaseTxid');
  if (typeof releaseTxid !== 'string' || !TXID.test(releaseTxid)) {
    return refuse(
      'unpublished',
      'this record carries no Arweave content address, so there is nothing a user could ' +
        'compare the bytes they received against. It is a build output, not a release.',
    );
  }

  const sourceCommit = own(document, 'sourceCommit');
  if (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    return refuse('malformed-source-commit', 'the recorded source commit is not a git object id');
  }

  const perFileHashes = readHashMap(own(document, 'perFileHashes'), SHA256_HEX);
  if (perFileHashes === undefined || Object.keys(perFileHashes).length === 0) {
    return refuse(
      'no-file-hashes',
      'this record pins no file hashes, so a self-check over it would compare nothing and ' +
        'report success',
    );
  }

  // Keyed by `spec_version`, so the keys are converted rather than asserted: a key that is
  // not a spec version is refused here instead of sitting in the record as a hash for a
  // runtime nobody can name. (It also avoids `as unknown as`, which app-code rule 2 bans
  // across `app/` and the assertion gate rejects — correctly, since the double assertion
  // would have hidden exactly this shape mismatch.)
  const descriptorMetadataHashes = readDescriptorHashes(own(document, 'descriptorMetadataHashes'));
  if (descriptorMetadataHashes === undefined) {
    return refuse(
      'malformed-descriptor-hashes',
      'a descriptor metadata hash is not a SHA-256, or is keyed by something that is not a spec_version',
    );
  }

  const range = own(document, 'specVersionRange');
  const primary = own(range, 'primary');
  const recovery = own(range, 'recovery');
  if (!Number.isInteger(primary) || !Number.isInteger(recovery)) {
    return refuse('malformed-spec-range', 'the supported spec_version window is not a pair of integers');
  }
  if ((recovery as number) !== (primary as number) + 1) {
    // 10 §5.1's pairing rule, checked here as well as in the feed gate: a bundle that
    // claimed a window it cannot serve would report `full` compatibility for a runtime it
    // has no descriptors for.
    return refuse(
      'unpaired-runtimes',
      `the recovery spec_version must be primary + 1 (10 §5.1); this record says ${primary} and ${recovery}`,
    );
  }
  for (const version of [primary, recovery] as number[]) {
    if (descriptorMetadataHashes[version] === undefined) {
      return refuse(
        'undescribed-runtime',
        `spec_version ${version} is in the supported window and has no descriptor metadata hash`,
      );
    }
  }

  const chainSpecHashes = readPair(own(document, 'chainSpecHashes'));
  if (chainSpecHashes === undefined) {
    return refuse('malformed-chain-spec-hashes', 'a bundled chain-spec hash is absent or malformed');
  }
  const genesisHashes = readPair(own(document, 'genesisHashes'));
  if (genesisHashes === undefined) {
    return refuse('malformed-genesis-hashes', 'a genesis hash is absent or malformed');
  }

  return {
    kind: 'identity',
    identity: {
      releaseTxid,
      sourceCommit,
      perFileHashes: perFileHashes as Readonly<Record<string, Hash32>>,
      descriptorMetadataHashes,
      specVersionRange: { primary, recovery } as SpecVersionRange,
      chainSpecHashes,
      genesisHashes,
    },
  };
}

function readDescriptorHashes(source: unknown): Record<number, Hash32> | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const out: Record<number, Hash32> = {};
  for (const key of Object.getOwnPropertyNames(source)) {
    if (!/^[0-9]+$/.test(key)) return undefined;
    const value = own(source, key);
    if (typeof value !== 'string' || !SHA256_HEX.test(value)) return undefined;
    out[Number(key)] = value as Hash32;
  }
  return out;
}

function readPair(source: unknown): Readonly<Record<'relay' | 'para', Hash32>> | undefined {
  const relay = own(source, 'relay');
  const para = own(source, 'para');
  if (typeof relay !== 'string' || !HASH32.test(relay)) return undefined;
  if (typeof para !== 'string' || !HASH32.test(para)) return undefined;
  return { relay: relay as Hash32, para: para as Hash32 };
}
