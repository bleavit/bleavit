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

import { runSelfCheck } from '@bleavit/verify';

import {
  DISJOINT_PAIRS,
  RegistryError,
  checkControllerQuorum,
  checkDisjointness,
  operatorsIn,
  parseRegistry,
} from '../../tools/verify-release/registry.mjs';
import {
  ATTESTATION_FLOOR,
  SIGNATURE_FLOOR,
  VerifyError,
  countAttestations,
  countReleaseSignatures,
  diffScope,
  releaseVerdict,
} from '../../tools/verify-release/verdict.mjs';

const KEYRING = { generation: 3, revokedKeyIds: [] };
const sig = (keyId, over = {}) => ({ keyId, generation: 3, valid: true, ...over });
const att = (keyId, organization, over = {}) => ({ keyId, organization, valid: true, ...over });

const identity = {
  releaseTxid: 'R'.repeat(43),
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
  assert.match(counted.rejected[0].why, /revoked/);
});

test('a signature from a previous keyring generation does not count', () => {
  // It verifies against a keyring this release did not publish.
  const counted = countReleaseSignatures([sig('K1'), sig('K2', { generation: 2 })], KEYRING);
  assert.equal(counted.distinctKeys, 1);
  assert.match(counted.rejected[0].why, /generation/);
});

test('an invalid signature does not count and says so', () => {
  const counted = countReleaseSignatures([sig('K1'), sig('K2', { valid: false })], KEYRING);
  assert.equal(counted.distinctKeys, 1);
  assert.match(counted.rejected[0].why, /does not verify/);
});

test('a keyring with no generation is refused rather than defaulted', () => {
  assert.throws(() => countReleaseSignatures([sig('K1')], { revokedKeyIds: [] }), VerifyError);
});

test('attestations are counted by organization, not by signature', () => {
  // §1.4 gate 2: "builders in different organizations/infrastructure". Two attestations from
  // one org is one reproduction, and independence is the entire claim.
  assert.equal(countAttestations([att('A', 'acme'), att('B', 'acme')]).independentOrganizations, 1);
  assert.equal(countAttestations([att('A', 'acme'), att('B', 'globex')]).independentOrganizations, 2);
});

test('an attestation with no declared organization is refused, not counted', () => {
  // It cannot be shown independent of any other.
  const counted = countAttestations([att('A', 'acme'), att('B', '  ')]);
  assert.equal(counted.independentOrganizations, 1);
  assert.match(counted.rejected[0].why, /independence is unshowable/);
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
  // the candidate tree alone would report this delta as admissible.
  const incumbent = { 'assets/app.js': 'x', 'assets/descriptors/bleavit.js': 'd' };
  const removed = diffScope(incumbent, { 'assets/descriptors/bleavit.js': 'd' });
  assert.equal(removed.admissible, false);
  assert.deepEqual(removed.outOfScope, [{ path: 'assets/app.js', change: 'removed' }]);
  const added = diffScope(incumbent, { ...incumbent, 'assets/new.js': 'y' });
  assert.equal(added.admissible, false);
  assert.deepEqual(added.outOfScope, [{ path: 'assets/new.js', change: 'added' }]);
});

test('a descriptor-only delta is admissible for the expedited lane', () => {
  const incumbent = { 'assets/app.js': 'x', 'assets/descriptors/bleavit.js': 'd', 'release.json': 'r' };
  const candidate = { 'assets/app.js': 'x', 'assets/descriptors/bleavit.js': 'D', 'release.json': 'R' };
  const result = diffScope(incumbent, candidate);
  assert.equal(result.admissible, true);
  assert.match(result.detail, /12 §1\.5 admits/);
});

test('disjointness is evaluated over operators — the key-id reading would pass forever', () => {
  // A minisign key id is never also an Arweave address, so intersecting identifiers is
  // disjoint by construction: the checker would report success having compared nothing.
  // That is why §2.2 point 1 requires the operator mapping before point 2 can mean anything.
  const entries = parseRegistry({
    entries: [
      { id: 'RWQ-1', population: 'release-signer', operator: 'Ada' },
      { id: 'RWQ-2', population: 'release-signer', operator: 'Grace' },
      { id: 'ar://ANT-1', population: 'arns-controller', operator: 'Ada' },
      { id: 'ar://ANT-2', population: 'arns-controller', operator: 'Linus' },
      { id: 'mon-1', population: 'monitor-operator', operator: 'Grace' },
    ],
  });
  const { violations } = checkDisjointness(entries);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].operator, 'Ada');
  assert.deepEqual(violations[0].populations, ['release-signer', 'arns-controller']);
  assert.match(violations[0].reason, /self-verifying malicious release/);
});

test('a monitor operator who is also an ArNS controller is a violation', () => {
  // §5.2's monitor is the compensating control for a hostile repoint; a controller watching
  // their own repoint is not an independent observer.
  const entries = parseRegistry({
    entries: [
      { id: 'RWQ-1', population: 'release-signer', operator: 'Ada' },
      { id: 'ar://ANT-1', population: 'arns-controller', operator: 'Linus' },
      { id: 'mon-1', population: 'monitor-operator', operator: 'Linus' },
    ],
  });
  const { violations } = checkDisjointness(entries);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].populations, ['monitor-operator', 'arns-controller']);
});

test('attestors may overlap release signers — §2.2 separates two populations, not four', () => {
  const entries = parseRegistry({
    entries: [
      { id: 'RWQ-1', population: 'release-signer', operator: 'Ada' },
      { id: 'ATT-1', population: 'attestor', operator: 'Ada' },
      { id: 'ar://ANT-1', population: 'arns-controller', operator: 'Linus' },
      { id: 'mon-1', population: 'monitor-operator', operator: 'Grace' },
    ],
  });
  assert.deepEqual(checkDisjointness(entries).violations, []);
  assert.equal(DISJOINT_PAIRS.length, 2);
});

test('an empty population is reported separately from a clean separation', () => {
  // Disjointness between an empty set and anything passes. Passing because a population is
  // empty is not the same claim as passing because two populations do not overlap, and only
  // the second is the control working.
  const entries = parseRegistry({
    entries: [{ id: 'RWQ-1', population: 'release-signer', operator: 'Ada' }],
  });
  const { violations, empty } = checkDisjointness(entries);
  assert.deepEqual(violations, []);
  assert.equal(empty.length, 2);
  assert.match(empty[0].detail, /for want of members/);
});

test('a key with no operator is refused, because it is invisible to the check', () => {
  assert.throws(
    () => parseRegistry({ entries: [{ id: 'RWQ-1', population: 'release-signer' }] }),
    RegistryError,
  );
  assert.throws(
    () => parseRegistry({ entries: [{ id: 'RWQ-1', population: 'release-signer', operator: '   ' }] }),
    RegistryError,
  );
  assert.throws(() => parseRegistry({ entries: [] }), RegistryError);
  assert.throws(
    () => parseRegistry({ entries: [{ id: 'RWQ-1', population: 'signer', operator: 'Ada' }] }),
    RegistryError,
  );
});

test('single-key ANT custody is refused outright (12 §4.2)', () => {
  const one = parseRegistry({ entries: [{ id: 'ar://ANT-1', population: 'arns-controller', operator: 'Linus' }] });
  assert.equal(checkControllerQuorum(one).length, 1);
  assert.match(checkControllerQuorum(one)[0], /3-of-5/);
  assert.equal(operatorsIn(one, 'arns-controller').size, 1);
  const none = parseRegistry({ entries: [{ id: 'RWQ-1', population: 'release-signer', operator: 'Ada' }] });
  assert.match(checkControllerQuorum(none)[0], /launch blocks/);
});
