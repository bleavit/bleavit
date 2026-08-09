/**
 * `verify-release`'s verdict and the signer registry — 12 §1.3–§1.5, §2.2, §2.3 (F13).
 *
 * These rules are only ever exercised on the outcomes a healthy release never produces, so
 * that is what the suite is: a revoked key that still signs, two signatures from one key, two
 * attestations from one organization, a deleted file in an expedited delta, and a
 * disjointness check that would pass by comparing the wrong thing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReleaseIdentity } from '@bleavit/verify';
import { runSelfCheck } from '@bleavit/verify';

import type { Population } from '../../tools/verify-release/registry.ts';
import {
  DISJOINT_PAIRS,
  KEYED_POPULATIONS,
  RegistryError,
  checkControllerQuorum,
  checkDisjointness,
  keyringFor,
  operatorsIn,
  parseRegistry,
} from '../../tools/verify-release/registry.ts';
import type { Attestation, Keyring, ReleaseSignature } from '../../tools/verify-release/verdict.ts';
import {
  ATTESTATION_FLOOR,
  EXPEDITED_SCOPE,
  SIGNATURE_FLOOR,
  VerifyError,
  countAttestations,
  countReleaseSignatures,
  diffScope,
  releaseVerdict,
} from '../../tools/verify-release/verdict.ts';

const KEYRING: Keyring = { generation: 3, revokedKeyIds: [] };
const sig = (keyId: string, over: Partial<ReleaseSignature> = {}): ReleaseSignature => ({
  keyId,
  generation: 3,
  valid: true,
  ...over,
});
const att = (keyId: string, organization: unknown, over: Partial<Attestation> = {}): Attestation => ({
  keyId,
  organization,
  valid: true,
  generation: 3,
  ...over,
});

/** A registry entry with every field the schema requires, so a test states only what it varies. */
const who = (
  id: string,
  population: Population,
  operator: string,
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  id,
  population,
  operator,
  organization: `${operator} Ltd`,
  ...(population === 'release-signer' || population === 'attestor'
    ? { generation: 3, revocationIndex: REVOCATION.next() }
    : {}),
  ...over,
});

/** Hands out a fresh revocation index per entry: 02 §12 gives one bit to one key. */
const REVOCATION = { value: 0, next(): number { this.value += 1; return this.value - 1; } };

/** The first element, with the reason it had to be there — `[0]` on an empty list is not a
 * failing assertion, it is a `TypeError` blamed on the harness. */
const first = <T>(items: readonly T[], what: string): T => {
  const item = items[0];
  assert.ok(item !== undefined, `expected at least one ${what}, got none`);
  return item;
};

// `arweaveManifestTxId`, not `releaseTxid`. Typing this suite caught the fixture still
// naming the field the consumer stopped requiring: `ReleaseIdentity` demands the asset-tree
// manifest address, and a fixture carrying the retired name described a document no producer
// emits — the second half of the very defect that interface's own comment records.
const identity: ReleaseIdentity = {
  arweaveManifestTxId: 'R'.repeat(43),
  sourceCommit: 'a'.repeat(40),
  perFileHashes: { 'index.html': 'a'.repeat(64) },
  descriptorMetadataHashes: { 2: 'b'.repeat(64) },
  specVersionRange: { primary: 2, recovery: 3 },
  chainSpecHashes: { relay: `0x${'c'.repeat(64)}`, para: `0x${'d'.repeat(64)}` },
  genesisHashes: { relay: `0x${'e'.repeat(64)}`, para: `0x${'f'.repeat(64)}` },
};
const cleanCheck = runSelfCheck(identity, { 'index.html': 'a'.repeat(64) });

test('two signatures from one key is one key', () => {
  // §1.4 says "distinct active keys", and the point of the floor is that a release survives
  // the loss or compromise of any single key. Counting signatures would let one key be a
  // unilateral shipping authority while satisfying the arithmetic.
  const counted = countReleaseSignatures([sig('K1'), sig('K1')], KEYRING);
  assert.equal(counted.distinctKeys, 1);
  assert.equal(countReleaseSignatures([sig('K1'), sig('K2')], KEYRING).distinctKeys, 2);
});

test('a revoked key does not count, which is the case §2.3 exists for', () => {
  // The compromised key is the one still signing. Counting before revocation is exactly the
  // failure the on-chain revocation set was added to prevent.
  const counted = countReleaseSignatures([sig('K1'), sig('K2')], { generation: 3, revokedKeyIds: ['K2'] });
  assert.equal(counted.distinctKeys, 1);
  assert.match(first(counted.rejected, 'rejection').why, /revoked/);
});

test('a signature from a previous keyring generation does not count', () => {
  // It verifies against a keyring this release did not publish.
  const counted = countReleaseSignatures([sig('K1'), sig('K2', { generation: 2 })], KEYRING);
  assert.equal(counted.distinctKeys, 1);
  assert.match(first(counted.rejected, 'rejection').why, /generation/);
});

test('an invalid signature does not count and says so', () => {
  const counted = countReleaseSignatures([sig('K1'), sig('K2', { valid: false })], KEYRING);
  assert.equal(counted.distinctKeys, 1);
  assert.match(first(counted.rejected, 'rejection').why, /does not verify/);
});

test('a keyring with no generation is refused rather than defaulted', () => {
  assert.throws(() => countReleaseSignatures([sig('K1')], { revokedKeyIds: [] }), VerifyError);
});

test('attestations are counted by organization, not by signature', () => {
  // §1.4 gate 2: "builders in different organizations/infrastructure". Two attestations from
  // one org is one reproduction, and independence is the entire claim.
  assert.equal(countAttestations([att('A', 'acme'), att('B', 'acme')], KEYRING).independentOrganizations, 1);
  assert.equal(countAttestations([att('A', 'acme'), att('B', 'globex')], KEYRING).independentOrganizations, 2);
});

test('an attestation with no declared organization is refused, not counted', () => {
  // It cannot be shown independent of any other.
  const counted = countAttestations([att('A', 'acme'), att('B', '  ')], KEYRING);
  assert.equal(counted.independentOrganizations, 1);
  assert.match(first(counted.rejected, 'rejection').why, /independence is unshowable/);
});

test('the verdict fails on any one floor, and names which', () => {
  const base = { selfCheck: cleanCheck, keyring: KEYRING };
  assert.equal(
    releaseVerdict({ ...base, signatures: [sig('K1'), sig('K2')], attestations: [att('A', 'acme'), att('B', 'globex')] }).ok,
    true,
  );
  const oneKey = releaseVerdict({
    ...base,
    signatures: [sig('K1')],
    attestations: [att('A', 'acme'), att('B', 'globex')],
  });
  assert.equal(oneKey.ok, false);
  assert.match(oneKey.failures.join(' '), /distinct active keys/);
  const oneOrg = releaseVerdict({
    ...base,
    signatures: [sig('K1'), sig('K2')],
    attestations: [att('A', 'acme'), att('B', 'acme')],
  });
  assert.equal(oneOrg.ok, false);
  assert.match(oneOrg.failures.join(' '), /independent attesting organization/);
});

test('a changed file fails the verdict through the same self-check the app runs', () => {
  // Reused rather than reimplemented, so the CLI and the in-app check cannot disagree about
  // what "matches" means — including the *unexpected* served file a manifest-driven loop
  // cannot see.
  const tampered = runSelfCheck(identity, { 'index.html': 'a'.repeat(64), 'evil.js': 'b'.repeat(64) });
  const verdict = releaseVerdict({
    selfCheck: tampered,
    signatures: [sig('K1'), sig('K2')],
    attestations: [att('A', 'acme'), att('B', 'globex')],
    keyring: KEYRING,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures.join(' '), /unexpected evil\.js/);
});

test('a deployment may require more signatures and may not configure fewer', () => {
  assert.equal(SIGNATURE_FLOOR, 2);
  assert.equal(ATTESTATION_FLOOR, 2);
  assert.throws(
    () =>
      releaseVerdict({
        selfCheck: cleanCheck,
        signatures: [sig('K1')],
        attestations: [att('A', 'acme'), att('B', 'globex')],
        keyring: KEYRING,
        minimumSignatures: 1,
      }),
    VerifyError,
  );
});

test('diff-scope sees a deletion, not only an edit', () => {
  // §1.5 requires every other file to be *byte-identical*; a missing file is not. A loop over
  // the candidate tree alone would report this delta as admissible — and under 12 §1.1 that is
  // not an edge case, since a content-hash rename is always a removal paired with an addition.
  const incumbent = { 'assets/8f1c0a24.js': 'x', 'sw.js': 'd' };
  const removed = diffScope(incumbent, { 'sw.js': 'd' });
  assert.equal(removed.admissible, false);
  assert.deepEqual(removed.outOfScope, [{ path: 'assets/8f1c0a24.js', change: 'removed' }]);
  const added = diffScope(incumbent, { ...incumbent, 'assets/2c6ab913.js': 'y' });
  assert.equal(added.admissible, false);
  assert.deepEqual(added.outOfScope, [{ path: 'assets/2c6ab913.js', change: 'added' }]);
});

test('EXPEDITED_SCOPE allowlists no asset prefix, because no build output is one', () => {
  // The pin on the ruling this suite exists to hold. `'assets/descriptors/'` sat in this list
  // and the build has never emitted that path: an allowlisted asset prefix is what let the
  // lane that skips the 72 h soak be authorized on an imaginary path, and every suite over it
  // agreed because the fixtures invented the same output.
  for (const prefix of EXPEDITED_SCOPE) {
    assert.equal(prefix.startsWith('assets/'), false, `${prefix} allowlists a built asset path`);
  }
  assert.deepEqual([...EXPEDITED_SCOPE], ['release.json', 'CHANGELOG.md', 'release-history.json']);
});

test('a descriptor refresh, as the build emits one, is refused and told why', () => {
  // 12 §1.1 names every chunk by its content alone, so refreshing a descriptor renames its
  // chunk, then the entry chunk that imports it, then `index.html` which names that. Nothing
  // else moves here — this is the most favourable descriptor-only delta that can exist, and it
  // is still indistinguishable from an app-code delta in the published tree.
  const incumbent = {
    'index.html': 'h',
    'assets/8f1c0a24.js': 'e',
    'assets/4b9d7e05.js': 'd',
    'sw.js': 'w',
  };
  const candidate = {
    'index.html': 'H',
    'assets/2c6ab913.js': 'E',
    'assets/d05e3f78.js': 'D',
    'sw.js': 'w',
  };
  const result = diffScope(incumbent, candidate);
  assert.equal(result.admissible, false);
  assert.deepEqual(result.outOfScope, [
    { path: 'assets/2c6ab913.js', change: 'added' },
    { path: 'assets/4b9d7e05.js', change: 'removed' },
    { path: 'assets/8f1c0a24.js', change: 'removed' },
    { path: 'assets/d05e3f78.js', change: 'added' },
    { path: 'index.html', change: 'changed' },
  ]);
  assert.match(result.detail, /content-hash rename/);
  assert.match(result.detail, /indistinguishable from an app-code delta/);
  assert.match(result.detail, /expedited lane\s+is therefore unavailable/);
  assert.match(result.detail, /standard lane with its 72 h soak/);
});

test('a delta that edits a fixed-name file gets the generic refusal, not the rename sentence', () => {
  // `sw.js` keeps its name because a browser resolves it by URL, so its delta arrives as
  // `changed` — which a content hash cannot produce. The structural explanation must not
  // swallow this: a classifier that matched every refusal would explain nothing.
  const incumbent = { 'assets/8f1c0a24.js': 'e', 'sw.js': 'w' };
  const result = diffScope(incumbent, { 'assets/8f1c0a24.js': 'e', 'sw.js': 'W' });
  assert.equal(result.admissible, false);
  assert.deepEqual(result.outOfScope, [{ path: 'sw.js', change: 'changed' }]);
  assert.doesNotMatch(result.detail, /content-hash rename/);
  assert.match(result.detail, /§1\.5 requires zero app-code delta/);
});

test('a release-metadata-only delta is still admissible for the expedited lane', () => {
  // The half of §1.5 that survives 12 §1.1: changelog, release history and `release.json`
  // itself keep fixed names, so a delta confined to them is expressible in the built tree.
  const incumbent = { 'assets/8f1c0a24.js': 'e', 'release.json': 'r', 'CHANGELOG.md': 'c' };
  const candidate = {
    'assets/8f1c0a24.js': 'e',
    'release.json': 'R',
    'CHANGELOG.md': 'C',
    'release-history.json': 'H',
  };
  const result = diffScope(incumbent, candidate);
  assert.equal(result.admissible, true);
  assert.deepEqual(result.outOfScope, []);
  assert.match(result.detail, /no published app asset moved/);
});

test('disjointness is evaluated over operators — the key-id reading would pass forever', () => {
  // A minisign key id is never also an Arweave address, so intersecting identifiers is
  // disjoint by construction: the checker would report success having compared nothing.
  // That is why §2.2 point 1 requires the operator mapping before point 2 can mean anything.
  const entries = parseRegistry({
    entries: [
      who('RWQ-1', 'release-signer', 'Ada'),
      who('RWQ-2', 'release-signer', 'Grace'),
      who('ar://ANT-1', 'arns-controller', 'Ada'),
      who('ar://ANT-2', 'arns-controller', 'Linus'),
      who('mon-1', 'monitor-operator', 'Grace'),
    ],
  });
  const { violations } = checkDisjointness(entries);
  assert.equal(violations.length, 1);
  assert.equal(first(violations, 'violation').operator, 'Ada');
  assert.deepEqual(first(violations, 'violation').populations, ['release-signer', 'arns-controller']);
  assert.match(first(violations, 'violation').reason, /self-verifying malicious release/);
});

test('a monitor operator who is also an ArNS controller is a violation', () => {
  // §5.2's monitor is the compensating control for a hostile repoint; a controller watching
  // their own repoint is not an independent observer.
  const entries = parseRegistry({
    entries: [
      who('RWQ-1', 'release-signer', 'Ada'),
      who('ar://ANT-1', 'arns-controller', 'Linus'),
      who('mon-1', 'monitor-operator', 'Linus'),
    ],
  });
  const { violations } = checkDisjointness(entries);
  assert.equal(violations.length, 1);
  assert.deepEqual(first(violations, 'violation').populations, ['monitor-operator', 'arns-controller']);
});

test('attestors may overlap release signers — §2.2 separates two populations, not four', () => {
  const entries = parseRegistry({
    entries: [
      who('RWQ-1', 'release-signer', 'Ada'),
      who('ATT-1', 'attestor', 'Ada'),
      who('ar://ANT-1', 'arns-controller', 'Linus'),
      who('mon-1', 'monitor-operator', 'Grace'),
    ],
  });
  assert.deepEqual(checkDisjointness(entries).violations, []);
  assert.equal(DISJOINT_PAIRS.length, 2);
});

test('an empty population is reported separately from a clean separation', () => {
  // Disjointness between an empty set and anything passes. Passing because a population is
  // empty is not the same claim as passing because two populations do not overlap, and only
  // the second is the control working.
  const entries = parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada')] });
  const { violations, empty } = checkDisjointness(entries);
  assert.deepEqual(violations, []);
  assert.equal(empty.length, 2);
  assert.match(first(empty, 'unseated pair').detail, /for want of members/);
});

test('a key with no operator is refused, because it is invisible to the check', () => {
  assert.throws(
    () => parseRegistry({ entries: [{ id: 'RWQ-1', population: 'release-signer' }] }),
    RegistryError,
  );
  assert.throws(
    () => parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada', { operator: '   ' })] }),
    RegistryError,
  );
  assert.throws(() => parseRegistry({ entries: [] }), RegistryError);
  assert.throws(
    () => parseRegistry({ entries: [{ id: 'RWQ-1', population: 'signer', operator: 'Ada' }] }),
    RegistryError,
  );
});

test('single-key ANT custody is refused outright (12 §4.2)', () => {
  const one = parseRegistry({ entries: [who('ar://ANT-1', 'arns-controller', 'Linus')] });
  assert.equal(checkControllerQuorum(one).length, 1);
  assert.match(first(checkControllerQuorum(one), 'quorum finding'), /3-of-5/);
  assert.equal(operatorsIn(one, 'arns-controller').size, 1);
  const none = parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada')] });
  assert.match(first(checkControllerQuorum(none), 'quorum finding'), /launch blocks/);
});

test('an unknown field is refused, because a misspelled one is a silently absent one', () => {
  // `organisation` would leave the entry with no organization at all, and §1.4 gate 2 counts
  // by that field — so the silent reading of a typo is "independent of nobody".
  assert.throws(
    () => parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada', { organisation: 'Acme' })] }),
    RegistryError,
  );
});

test('an entry with no organization is refused, because independence is unshowable', () => {
  assert.throws(
    () => parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada', { organization: '  ' })] }),
    RegistryError,
  );
});

test('a keyring generation belongs to minisign keys and to nothing else', () => {
  // §2.1 tags keyrings by generation and §2.2 point 1 lists ANT controller addresses in the
  // same registry. A generation on an address is a claim §2.1 does not make.
  assert.deepEqual([...KEYED_POPULATIONS], ['release-signer', 'attestor']);
  assert.throws(
    () => parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada', { generation: undefined })] }),
    RegistryError,
  );
  assert.throws(
    () => parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada', { revocationIndex: undefined })] }),
    RegistryError,
  );
  assert.throws(
    () => parseRegistry({ entries: [who('ar://ANT-1', 'arns-controller', 'Linus', { generation: 3 })] }),
    RegistryError,
  );
  assert.throws(
    () => parseRegistry({ entries: [who('RWQ-1', 'release-signer', 'Ada', { revocationIndex: 64 })] }),
    RegistryError,
  );
});

test('one revocation bit cannot name two keys', () => {
  // 02 §12 indexes `revoked_key_bits` into the generation's published keyring, so two keys at
  // one index means revoking either revokes both and a verifier cannot say which was meant.
  assert.throws(
    () =>
      parseRegistry({
        entries: [
          who('RWQ-1', 'release-signer', 'Ada', { revocationIndex: 0 }),
          who('RWQ-2', 'release-signer', 'Grace', { revocationIndex: 0 }),
        ],
      }),
    RegistryError,
  );
  // The same index in a different generation is a different keyring and is admissible.
  assert.equal(
    parseRegistry({
      entries: [
        who('RWQ-1', 'release-signer', 'Ada', { revocationIndex: 0, generation: 3 }),
        who('RWQ-2', 'release-signer', 'Grace', { revocationIndex: 0, generation: 4 }),
      ],
    }).length,
    2,
  );
});

test('the revocation bitmask resolves to key ids through the published registry', () => {
  // §2.3 sets a bit; `countReleaseSignatures` excludes a key id. Without this resolution the
  // caller would have to name the revoked keys itself, which is the caller's word again.
  const entries = parseRegistry({
    entries: [
      who('RWQ-1', 'release-signer', 'Ada', { revocationIndex: 0, generation: 3 }),
      who('RWQ-2', 'release-signer', 'Grace', { revocationIndex: 5, generation: 3 }),
    ],
  });
  assert.deepEqual(keyringFor(entries, 3, 0n).revokedKeyIds, []);
  assert.deepEqual(keyringFor(entries, 3, 1n << 5n).revokedKeyIds, ['RWQ-2']);
  assert.deepEqual(keyringFor(entries, 3, 0b100001n).revokedKeyIds, ['RWQ-1', 'RWQ-2']);
  // A bit no key claims is a disagreement between the chain and the registry, not a skip.
  assert.throws(() => keyringFor(entries, 3, 1n << 9n), RegistryError);
  assert.throws(() => keyringFor(entries, 3, 1n << 64n), RegistryError);
});

test('a revoked attestor key stops counting, which §2.3 names in as many words', () => {
  // §2.3 point 2 lists the three verifications a revoked key must be invalid for: self-check,
  // update verification and **attestation counting**. Until this landed `countAttestations`
  // took no keyring, so the one it spells out was the one it could not perform.
  const revoked: Keyring = { generation: 3, revokedKeyIds: ['A'] };
  assert.equal(countAttestations([att('A', 'acme'), att('B', 'globex')], KEYRING).independentOrganizations, 2);
  const counted = countAttestations([att('A', 'acme'), att('B', 'globex')], revoked);
  assert.equal(counted.independentOrganizations, 1);
  assert.ok(first(counted.rejected, 'rejection').why.includes('marked revoked'));
});

test('an attestation from a previous keyring generation does not count', () => {
  // §5.2 verifies attestations "against the current keyring generation".
  const counted = countAttestations([att('A', 'acme', { generation: 2 }), att('B', 'globex')], KEYRING);
  assert.equal(counted.independentOrganizations, 1);
  assert.match(first(counted.rejected, 'rejection').why, /generation 2, not the current 3/);
});

test('a deployment may require more attestations and may not configure fewer', () => {
  const inputs = {
    selfCheck: cleanCheck,
    signatures: [sig('K1'), sig('K2')],
    keyring: KEYRING,
    attestations: [att('A', 'acme'), att('B', 'globex')],
  };
  assert.equal(releaseVerdict({ ...inputs, minimumAttestations: 2 }).ok, true);
  assert.equal(releaseVerdict({ ...inputs, minimumAttestations: 3 }).ok, false);
  assert.throws(() => releaseVerdict({ ...inputs, minimumAttestations: 1 }), VerifyError);
});
