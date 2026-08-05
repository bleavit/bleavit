/**
 * The multisig account, bound to the runtime's own derivation — 11 §11.3, 02 §7.6 (F6).
 *
 * `Multisig.as_multi` executes the inner call as an account nobody chooses, and that
 * account is what every 11 §11.5 precondition row reads. An earlier draft took it as a
 * caller-supplied field, where a wrong value fails in the dangerous direction: the client
 * reads some other account's healthy balance, reports every row green, and the runtime
 * rejects. The user signed something the client had told them would work.
 *
 * So the client derives it — and a derivation is only as good as what it is checked
 * against. The fixture here is written by `pallet_multisig` itself
 * (`runtime/bleavit-runtime/src/tests_multisig_derivation.rs`) and is read **in place**,
 * never copied, for the same reason the vector corpus is: two copies of an artifact that
 * must agree is one copy too many. The Rust suite checks the file still describes that
 * runtime; this one checks the client still agrees with the file. Whichever side moved is
 * the side that goes red.
 *
 * The pre-image and the account are asserted **separately** on purpose. A client whose
 * pre-image matches and whose account does not has a hashing problem; one whose pre-image
 * differs has an encoding problem — and encoding is where the real mistakes are, because
 * the domain prefix is a fixed-size array carrying no length prefix while the signatory
 * list is a `Vec` that does, and SCALE's compact length changes width at 64 elements.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { blake2b } from '@noble/hashes/blake2b';

import {
  MultisigDerivationError,
  actingAccount,
  deriveMultisigAccount,
  multisigWrapper,
  otherSignatories,
} from '@bleavit/transaction-builder';
import type { Blake2b256, PublicKeyHex } from '@bleavit/transaction-builder';

const HERE = dirname(fileURLToPath(import.meta.url));
// Read in place. `app/` is a sibling of `runtime/`, and the fixture belongs to the runtime
// that produced it — a copy under `app/` would be a second artifact to keep in step.
const FIXTURE = resolve(HERE, '../../../runtime/bleavit-runtime/fixtures/multisig-derivation.json');

/** The shape `pallet_multisig` writes. Declared here because the file is read in place. */
interface DerivationCase {
  readonly name: string;
  readonly signatories: readonly PublicKeyHex[];
  readonly threshold: number;
  readonly account: string;
  readonly preimage: string;
}
interface DerivationFixture {
  readonly schema: string;
  readonly prefix: string;
  readonly hash: string;
  readonly cases: readonly DerivationCase[];
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as DerivationFixture;

/** blake2b with a 32-byte digest. Node's OpenSSL exposes blake2b512, not this. */
const blake2b256: Blake2b256 = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });

const hex = (bytes: Uint8Array): string => '0x' + Buffer.from(bytes).toString('hex');
const caseNamed = (name: string): DerivationCase => {
  const found = fixture.cases.find((c) => c.name === name);
  assert.ok(found, `fixture has no case ${name}`);
  return found;
};

/** The nth signatory of a case, or a throw naming how many it declares. */
const nthKey = (c: DerivationCase, index: number): PublicKeyHex => {
  const key = c.signatories[index];
  if (key === undefined) {
    throw new Error(`case ${c.name} declares ${c.signatories.length} signatories; no index ${index}`);
  }
  return key;
};

/** The nth byte of a pre-image, or a throw naming how short it was. */
const byteAt = (preimage: Uint8Array, index: number): number => {
  const byte = preimage[index];
  if (byte === undefined) throw new Error(`pre-image is ${preimage.length} bytes; no index ${index}`);
  return byte;
};

test('the fixture is the one this suite expects', () => {
  // A renamed schema or an empty case list must fail loudly rather than vacuously pass.
  assert.equal(fixture.schema, 'bleavit.multisig-derivation.v1');
  assert.equal(fixture.hash, 'blake2b-256');
  assert.ok(fixture.cases.length >= 9, `only ${fixture.cases.length} cases`);
});

test('every runtime case derives byte-for-byte, pre-image and account separately', () => {
  for (const c of fixture.cases) {
    const derived = deriveMultisigAccount(c.signatories, c.threshold, blake2b256);
    assert.equal(hex(derived.preimage), c.preimage, `${c.name}: SCALE pre-image`);
    assert.equal(derived.account, c.account, `${c.name}: derived account`);
    assert.deepEqual([...derived.signatories], c.signatories, `${c.name}: signatory order`);
  }
});

test('the domain prefix carries no length prefix', () => {
  // `b"modlpy/utilisuba"` is a `&[u8; 16]`, so SCALE writes sixteen raw bytes. Encoding it
  // as a `Vec` would prepend a compact length and derive a different account for every
  // multisig in existence — while still producing a well-formed address.
  const c = fixture.cases[0];
  assert.ok(c, 'the fixture carries no cases');
  const derived = deriveMultisigAccount(c.signatories, c.threshold, blake2b256);
  assert.equal(hex(derived.preimage.slice(0, 16)), fixture.prefix);
});

test('the SCALE compact length widens at 64 signatories', () => {
  // The boundary a hardcoded one-byte prefix gets wrong: every small committee still
  // derives correctly, and a large one silently does not.
  const small = caseNamed('sixty_three_signatories');
  const large = caseNamed('sixty_four_signatories');
  const a = deriveMultisigAccount(small.signatories, small.threshold, blake2b256);
  const b = deriveMultisigAccount(large.signatories, large.threshold, blake2b256);
  // One more 32-byte key, and one more byte of compact length.
  assert.equal(b.preimage.length - a.preimage.length, 33);
  assert.equal(byteAt(a.preimage, 16) & 0b11, 0b00, 'single-byte compact mode');
  assert.equal(byteAt(b.preimage, 16) & 0b11, 0b01, 'two-byte compact mode');
});

test('the threshold is part of the derivation, not a display value', () => {
  // Same signatories, different threshold, different account. A client that ignored the
  // threshold would read a 3-of-3's state while signing for a 2-of-3.
  const two = caseNamed('two_of_five');
  const four = caseNamed('four_of_five');
  assert.deepEqual(two.signatories, four.signatories, 'precondition: the same set');
  assert.notEqual(two.account, four.account);
  assert.equal(deriveMultisigAccount(two.signatories, 2, blake2b256).account, two.account);
  assert.equal(deriveMultisigAccount(four.signatories, 4, blake2b256).account, four.account);
});

test('the caller need not sort, and the order it supplies changes nothing', () => {
  // The pallet requires an ascending vector and the pre-image depends on it, but an
  // unsorted set is not a mistake the user made — so it is normalised here rather than
  // refused, and the normalisation is what the fixture proves correct.
  const c = caseNamed('two_of_three');
  const shuffled = [nthKey(c, 2), nthKey(c, 0), nthKey(c, 1)];
  const derived = deriveMultisigAccount(shuffled, c.threshold, blake2b256);
  assert.equal(derived.account, c.account);
  assert.deepEqual([...derived.signatories], c.signatories, 'the ascending order is restored');
});

test('uppercase hex is accepted and normalised, not silently mis-sorted', () => {
  // Byte order and lowercase-string order agree; uppercase-string order does not, so an
  // un-normalised uppercase key would sort before every lowercase one and derive a
  // different account.
  const c = caseNamed('two_of_three');
  const upper = c.signatories.map((k: PublicKeyHex) => `0x${k.slice(2).toUpperCase()}`);
  assert.equal(deriveMultisigAccount(upper, c.threshold, blake2b256).account, c.account);
});

test('a duplicate signatory is refused rather than deduplicated', () => {
  // The runtime rejects it (`SenderInSignatories`/`SignatoriesOutOfOrder`), and quietly
  // dropping one would derive the account of a set nobody asked for.
  const c = caseNamed('two_of_three');
  assert.throws(
    () => deriveMultisigAccount([...c.signatories, nthKey(c, 0)], 2, blake2b256),
    MultisigDerivationError,
  );
});

test('a threshold that cannot be met is refused', () => {
  // It derives a real account that can never dispatch, so the client would show
  // preconditions for an address the multisig cannot act from.
  const c = caseNamed('two_of_three');
  assert.throws(() => deriveMultisigAccount(c.signatories, 4, blake2b256), MultisigDerivationError);
  assert.throws(() => deriveMultisigAccount(c.signatories, 0, blake2b256), MultisigDerivationError);
  assert.throws(() => deriveMultisigAccount(c.signatories, 1.5, blake2b256), MultisigDerivationError);
});

test('a malformed public key is refused, not padded', () => {
  const c = caseNamed('two_of_three');
  for (const bad of ['0x00', 'not-hex', '', '0x' + 'g'.repeat(64), nthKey(c, 0).slice(2)]) {
    assert.throws(
      () => deriveMultisigAccount([bad, nthKey(c, 1)], 1, blake2b256),
      MultisigDerivationError,
      JSON.stringify(bad),
    );
  }
});

test('the hash is required and its output width is checked', () => {
  // blake2b-512 is what node offers by name, and a 64-byte digest truncated to 32 is NOT
  // blake2b-256 — it is a different function with a different answer. Refused rather than
  // sliced, because slicing would produce a plausible address for every multisig.
  const c = caseNamed('two_of_three');
  // Deliberately outside the signature: the throw is what an untyped caller meets, and
  // the comment above says why silently defaulting to a hash function would be worse.
  // A parameter of `Blake2b256 | undefined` rather than `as unknown as`, which the
  // 10 §2.1 cast gate bans workspace-wide (it defeats every nominal technique there is).
  const missingHasher = (hasher: Blake2b256 | undefined): Blake2b256 => hasher as Blake2b256;
  assert.throws(
    () => deriveMultisigAccount(c.signatories, 2, missingHasher(undefined)),
    MultisigDerivationError,
  );
  assert.throws(
    () => deriveMultisigAccount(c.signatories, 2, (b: Uint8Array) => blake2b(b, { dkLen: 64 })),
    MultisigDerivationError,
  );
});

test('other_signatories excludes the signer and keeps the ascending order', () => {
  const c = caseNamed('two_of_three');
  const derived = deriveMultisigAccount(c.signatories, c.threshold, blake2b256);
  const others = otherSignatories(derived, nthKey(c, 1));
  assert.deepEqual([...others], [nthKey(c, 0), nthKey(c, 2)]);
});

test('a signer outside the set is refused, because the chain would derive elsewhere', () => {
  // `ensure_sorted_and_insert` inserts the caller into the set before deriving, so a
  // signer who is not a member produces a *different* account on chain — and every
  // precondition just evaluated belongs to an account the transaction never acts as.
  const c = caseNamed('two_of_three');
  const derived = deriveMultisigAccount(c.signatories, c.threshold, blake2b256);
  const stranger = '0x' + 'ab'.repeat(32);
  assert.throws(() => otherSignatories(derived, stranger), MultisigDerivationError);
  assert.throws(() => multisigWrapper(derived, stranger), MultisigDerivationError);
});

test('the wrapper points the acting account at the derived multisig', () => {
  // The whole reason the derivation exists: `actingAccount` is what 11 §11.5's rows read.
  const c = caseNamed('two_of_three');
  const derived = deriveMultisigAccount(c.signatories, c.threshold, blake2b256);
  const signer = c.signatories[1];
  assert.ok(signer, 'the fixture case has fewer than two signatories');
  const wrapper = multisigWrapper(derived, signer);
  assert.equal(actingAccount(wrapper, signer), c.account);
  assert.notEqual(actingAccount(wrapper, signer), signer);
  assert.equal(wrapper.kind, 'multisig');
  assert.equal(wrapper.threshold, c.threshold);
});
