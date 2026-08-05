/**
 * The producer/consumer join, bound to the document the build actually emits — 12 §1.1,
 * INV-FE-11 (F10/F11).
 *
 * `tools/release/build.mjs` writes `release.json`; `packages/verify` reads it. Two suites
 * could each be green while the pair disagreed — and did: the producer emitted
 * `arweaveManifestTxId`, the consumer required `releaseTxid`, and the producer-side test
 * compared the document against a list kept beside the producer. So this suite runs the
 * real pipeline and feeds its real output to the real reader, in the same
 * one-artifact-two-checkers discipline the vector corpus and the multisig fixture follow.
 *
 * The interesting assertion is the **refusal**. Pre-genesis there is no seated bootnode
 * operator, no gateway set, no genesis hash and no keyring, so today's build is genuinely
 * not a release — and the consumer has to say so for the right reason rather than render a
 * panel of green rows whose absent neighbours are the problem.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mayOperate, parseReleaseDocument, runSelfCheck, verifyChainIdentity } from '@bleavit/verify';

import type { ReleaseDocument } from '../../tools/release/release-json.ts';
import { pipeline } from '../../tools/release/build.ts';

const built = pipeline();

/** The emitted document, promoted to what a published release would carry. Derived from the
 * real one rather than hand-written, so a field the producer renames breaks this too. */
function asPublished(release: ReleaseDocument): Record<string, unknown> {
  return {
    ...release,
    // Only the asset-tree manifest. There is deliberately no `releaseTxid`: a fixture
    // carrying one would describe a document the deploy driver refuses to publish, and
    // this corpus would then be certifying a format that cannot exist.
    arweaveManifestTxId: 'M'.repeat(43),
    chainSpecHashes: { relay: `0x${'a'.repeat(64)}`, para: `0x${'b'.repeat(64)}` },
    genesisHashes: { relay: `0x${'c'.repeat(64)}`, para: `0x${'d'.repeat(64)}` },
    readiness: { productionReady: true, blockers: [], note: '' },
  };
}

test('the build the repository can make today is refused, and for the right reason', () => {
  const verdict = parseReleaseDocument(built.release);
  assert.equal(verdict.kind, 'refused');
  assert.equal(verdict.reason, 'not-a-production-release');
  assert.match(verdict.detail, /readiness blocker/);
});

test('a published document parses into the identity the panel and self-check consume', () => {
  const verdict = parseReleaseDocument(asPublished(built.release));
  assert.equal(verdict.kind, 'identity', JSON.stringify(verdict));
  const identity = verdict.identity;
  assert.equal(identity.sourceCommit, built.release.sourceCommit);
  assert.deepEqual(identity.specVersionRange, built.release.specVersionRange);
  // The whole point of the join: the parsed identity is directly usable by the two
  // consumers, with no adapter in between for a future refactor to get wrong.
  const served = { ...identity.perFileHashes };
  assert.equal(runSelfCheck(identity, served).ok, true);
  const verdictChain = verifyChainIdentity(identity, {
    relayGenesis: identity.genesisHashes.relay,
    paraGenesis: identity.genesisHashes.para,
    relaySpecHash: identity.chainSpecHashes.relay,
    paraSpecHash: identity.chainSpecHashes.para,
  });
  assert.equal(mayOperate(verdictChain), true);
});

test('an unpublished document is refused — a build output is not a release', () => {
  // `arweaveManifestTxId: null` is exactly what the builder emits before 12 §1.2's second
  // pass patches it. A bundle serving that record has no content address, so there is
  // nothing a user could compare the bytes they received against.
  //
  // This test used to null `releaseTxid` instead — a field the served document never
  // carried a value for, so it was asserting that the parser refuses a document that is
  // *always* in that state. It passed for a reason that made every genuine release refuse.
  const document = { ...asPublished(built.release), arweaveManifestTxId: null };
  const verdict = parseReleaseDocument(document);
  assert.equal(verdict.kind, 'refused');
  assert.equal(verdict.reason, 'unpublished');
});

test('a present-but-malformed pin is refused exactly like an absent one', () => {
  const malformed: readonly (readonly [string, unknown])[] = [
    ['chainSpecHashes', { relay: '', para: `0x${'b'.repeat(64)}` }],
    ['genesisHashes', { relay: `0x${'c'.repeat(64)}`, para: '0xdeadbeef' }],
    ['sourceCommit', 'HEAD'],
  ];
  for (const [field, value] of malformed) {
    const verdict = parseReleaseDocument({ ...asPublished(built.release), [field]: value });
    assert.equal(verdict.kind, 'refused', `${field} was accepted`);
  }
});

test('a document pinning no files is refused, not treated as a passing self-check', () => {
  const verdict = parseReleaseDocument({ ...asPublished(built.release), perFileHashes: {} });
  assert.equal(verdict.kind, 'refused');
  assert.equal(verdict.reason, 'no-file-hashes');
});

test('an unpaired runtime window is refused (10 §5.1)', () => {
  // A bundle claiming a window it cannot serve would report `full` compatibility for a
  // runtime it has no descriptors for.
  const verdict = parseReleaseDocument({
    ...asPublished(built.release),
    specVersionRange: { primary: 2, recovery: 4 },
  });
  assert.equal(verdict.kind, 'refused');
  assert.equal(verdict.reason, 'unpaired-runtimes');
});

test('a supported runtime with no descriptor hash is refused', () => {
  const verdict = parseReleaseDocument({
    ...asPublished(built.release),
    descriptorMetadataHashes: { 2: 'e'.repeat(64) },
  });
  assert.equal(verdict.kind, 'refused');
  assert.equal(verdict.reason, 'undescribed-runtime');
});

test('a prototype-backed record is read by own keys only', () => {
  // The document arrives from a gateway. A plain lookup consults the prototype chain while
  // enumeration does not, so the pair that is validated would not be the pair that is used.
  const hostile: unknown = Object.create({ schema: 'bleavit.app-release.v1' });
  const verdict = parseReleaseDocument(hostile);
  assert.equal(verdict.kind, 'refused');
  // Narrowed rather than read off the union: `reason` exists only on the refusal arm, so
  // asserting it without the check above would be reading a field the accepting arm does
  // not have — which is how a test can go on "passing" against `undefined`.
  assert.ok(verdict.kind === 'refused');
  assert.equal(verdict.reason, 'not-a-release-record');
});

test('a non-object, a string and null are all refused rather than throwing', () => {
  for (const input of [null, undefined, 'release', 42, []]) {
    assert.equal(parseReleaseDocument(input).kind, 'refused');
  }
});
