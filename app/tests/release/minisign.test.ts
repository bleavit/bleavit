/**
 * Minisign verification — 12 §1.4, F13.
 *
 * ## The oracle is the *other* implementation, not a fixture written beside this one
 *
 * This repository already verifies minisign, in Python, in
 * `tools/monitoring/attestation_monitor.py` — the 12 §5.2 out-of-band monitor. That code was
 * written independently, ships, and has its own suite. So every case here runs through
 * **both** implementations and requires them to agree: two independent parsers over the same
 * bytes, and two independent Ed25519 verifiers (`node:crypto`'s OpenSSL binding on one side,
 * a pure-stdlib RFC 8032 implementation on the other).
 *
 * That matters more than usual for a signature check. A verifier that returns `true` for
 * everything passes every "a valid signature verifies" test perfectly, and the natural
 * fixture — one signature produced by the same code that reads it — cannot tell the two
 * apart. Agreement across two languages and two crypto stacks can.
 *
 * The signatures themselves are produced here with `node:crypto`, because minisign is not
 * installed in this environment and inventing a fixture file by hand would be asserting the
 * format against my own reading of it. Producing them from the *format* and checking them
 * with **two** readers is the honest version: if my reading of the layout were wrong, the
 * Python side — written before this module and not from the same notes — would disagree.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign as signEd25519, getHashes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MinisignFormatError,
  parseMinisignPublicKey,
  parseMinisignSignature,
  verifyMinisign,
} from '../../tools/verify-release/minisign.ts';
import { countReleaseSignatures, releaseSignatureFrom } from '../../tools/verify-release/verdict.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const KEY_ID = Buffer.from([0x8a, 0x1b, 0x2c, 0x3d, 0x4e, 0x5f, 0x60, 0x71]);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const RAW_PUBLIC = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** A minisign public-key file for the generated key. */
function publicKeyFile(keyId: Buffer = KEY_ID): string {
  const packet = Buffer.concat([Buffer.from('Ed', 'latin1'), keyId, RAW_PUBLIC]);
  return `untrusted comment: minisign public key\n${b64(packet)}\n`;
}

interface SignOptions {
  readonly prehashed?: boolean;
  readonly trustedComment?: string;
  readonly keyId?: Buffer;
  /** Re-state the trusted comment *after* signing — the attack the global signature stops. */
  readonly restatedComment?: string;
}

/**
 * Produce a detached signature the way minisign specifies it.
 *
 * Two signatures over two different messages: the primary over the artifact (or its
 * BLAKE2b-512 digest), the global over `primary || trusted_comment`.
 */
function signFile(message: Uint8Array, options: SignOptions = {}): string {
  const algorithm = options.prehashed === true ? 'ED' : 'Ed';
  const trusted = options.trustedComment ?? 'timestamp:1754400000\tfile:app.tar.gz';
  const signed =
    algorithm === 'Ed' ? Buffer.from(message) : createHash('blake2b512').update(message).digest();
  const primary = signEd25519(null, signed, privateKey);
  const global = signEd25519(null, Buffer.concat([primary, Buffer.from(trusted, 'utf8')]), privateKey);
  const packet = Buffer.concat([
    Buffer.from(algorithm, 'latin1'),
    options.keyId ?? KEY_ID,
    primary,
  ]);
  const shown = options.restatedComment ?? trusted;
  return [
    'untrusted comment: signature from minisign secret key',
    b64(packet),
    `trusted comment: ${shown}`,
    b64(global),
    '',
  ].join('\n');
}

/**
 * The same verification, through `tools/monitoring/attestation_monitor.py`.
 *
 * The module is imported and called directly rather than re-implemented, so this is the
 * shipping code path rather than a second reading of it.
 */
function pythonVerdict(message: Uint8Array, signatureText: string, keyText: string): boolean {
  const script = `
import base64, json, sys
sys.path.insert(0, ${JSON.stringify(join(REPO, 'tools/monitoring'))})
from attestation_monitor import parse_minisign_public_key, verify_minisign
payload = json.load(sys.stdin)
message = base64.b64decode(payload["message"])
try:
    key = parse_minisign_public_key(payload["key"])
except ValueError:
    print("false"); raise SystemExit(0)
print("true" if verify_minisign(message, payload["signature"], key) else "false")
`;
  const out = execFileSync('python3', ['-c', script], {
    input: JSON.stringify({
      message: Buffer.from(message).toString('base64'),
      signature: signatureText,
      key: keyText,
    }),
    encoding: 'utf8',
  });
  return out.trim() === 'true';
}

/** Both implementations, required to agree, with the TypeScript verdict returned. */
function agreed(message: Uint8Array, signatureText: string, keyText = publicKeyFile()): boolean {
  const key = parseMinisignPublicKey(keyText);
  const mine = verifyMinisign(message, signatureText, key);
  const theirs = pythonVerdict(message, signatureText, keyText);
  assert.equal(
    mine.ok,
    theirs,
    `the two implementations disagree: TypeScript ${mine.ok}, Python ${theirs}` +
      (mine.ok ? '' : ` (${mine.reason})`),
  );
  return mine.ok;
}

const ARTIFACT = new TextEncoder().encode('the built release tree, byte for byte');

test('node:crypto really carries the two primitives this module assumes', () => {
  // Measured, not assumed — the module's own note says so, and a missing `blake2b512` would
  // make every prehashed signature fail with a message about the signature rather than the
  // platform.
  assert.ok(getHashes().includes('blake2b512'));
  assert.equal(RAW_PUBLIC.length, 32);
});

test('a valid signature verifies, in both modes, and both implementations agree', () => {
  assert.equal(agreed(ARTIFACT, signFile(ARTIFACT)), true);
  assert.equal(agreed(ARTIFACT, signFile(ARTIFACT, { prehashed: true })), true);
});

test('a restated trusted comment is REFUSED — the only mutation the primary check cannot see', () => {
  // The whole reason the second signature exists. The trusted comment is not covered by the
  // primary signature at all, and it is the only part a person reads: an attacker holding any
  // validly signed artifact can restate it as anything, and a verifier that skips the global
  // signature passes every file check while the human-readable claim is unauthenticated.
  const forged = signFile(ARTIFACT, {
    trustedComment: 'timestamp:1754400000\tfile:app.tar.gz',
    restatedComment: 'timestamp:1754400000\tfile:bleavit-release-1.4.2-audited.tar.gz',
  });
  assert.equal(agreed(ARTIFACT, forged), false);

  // And the refusal names the reason, because "does not verify" would send an operator to
  // check the artifact bytes, which are fine.
  const verdict = verifyMinisign(ARTIFACT, forged, parseMinisignPublicKey(publicKeyFile()));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /trusted comment is not signed/);
});

test('tampered artifact bytes are refused by both implementations', () => {
  const signature = signFile(ARTIFACT);
  const tampered = new TextEncoder().encode('the built release tree, byte for bytf');
  assert.equal(agreed(tampered, signature), false);
});

test('a signature by another key is refused on the id, not left to the crypto', () => {
  // §1.4 counts DISTINCT keys, so the id is the identity the count is over. Verifying against
  // the wrong key would also fail — but slowly and with a message about the bytes.
  const other = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(agreed(ARTIFACT, signFile(ARTIFACT, { keyId: other })), false);
  const verdict = verifyMinisign(
    ARTIFACT,
    signFile(ARTIFACT, { keyId: other }),
    parseMinisignPublicKey(publicKeyFile()),
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /is by key 0102030405060708/);
});

test('an unrecognised algorithm refuses rather than defaulting to one this code implements', () => {
  const signature = signFile(ARTIFACT);
  const lines = signature.split('\n');
  const packet = Buffer.from(lines[1]!, 'base64');
  packet.write('Zz', 0, 'latin1');
  lines[1] = packet.toString('base64');
  const rewritten = lines.join('\n');
  assert.throws(() => parseMinisignSignature(rewritten), MinisignFormatError);
  const verdict = verifyMinisign(ARTIFACT, rewritten, parseMinisignPublicKey(publicKeyFile()));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /unrecognised minisign algorithm "Zz"/);
  // The Python side refuses it too, which is what makes this a shared rule rather than a
  // choice one implementation made.
  assert.equal(pythonVerdict(ARTIFACT, rewritten, publicKeyFile()), false);
});

test('a malformed file is `ok: false` with a reason — never a thrown parse turning into valid', () => {
  // A boolean return would let a caller record a parse failure as "does not verify", which is
  // a different fact with a different next step. `verdict.ts` reports every rejection with a
  // `why` for exactly that reason.
  for (const broken of [
    '',
    'untrusted comment: x\nnot base64 at all\ntrusted comment: y\nalso not\n',
    `untrusted comment: x\n${b64(Buffer.alloc(10))}\ntrusted comment: y\n${b64(Buffer.alloc(64))}\n`,
  ]) {
    const verdict = verifyMinisign(ARTIFACT, broken, parseMinisignPublicKey(publicKeyFile()));
    assert.equal(verdict.ok, false);
    assert.ok(verdict.reason.length > 0);
    assert.equal(pythonVerdict(ARTIFACT, broken, publicKeyFile()), false);
  }
});

test('an OVER-LONG packet is refused, so a signature file is not malleable', () => {
  // The mutation run found this gap in the suite rather than in the code. A *short* packet
  // fails anyway, further down, when a 54-byte "signature" does not verify — so testing only
  // that leaves the length check looking redundant. The case it really carries is the other
  // one: base64 decoding is permissive, `subarray(10, 74)` takes the first 64 bytes whatever
  // follows them, and a signature file with bytes appended would otherwise verify **exactly
  // like the original**. That is malleability — two different files, one verdict — in the
  // artifact whose whole job is to be the thing you compare against.
  const lines = signFile(ARTIFACT).split('\n');
  const packet = Buffer.from(lines[1]!, 'base64');
  lines[1] = b64(Buffer.concat([packet, Buffer.from('trailing')]));
  assert.equal(agreed(ARTIFACT, lines.join('\n')), false);

  // And the same for the public key, where an appended-to file would name the same key.
  const keyPacket = Buffer.from(publicKeyFile().split('\n')[1]!, 'base64');
  const longKey = `untrusted comment: k\n${b64(Buffer.concat([keyPacket, Buffer.from('x')]))}\n`;
  assert.throws(() => parseMinisignPublicKey(longKey), MinisignFormatError);
  assert.equal(pythonVerdict(ARTIFACT, signFile(ARTIFACT), longKey), false);
});

test('a signature missing its trusted-comment line is refused, not read positionally', () => {
  const lines = signFile(ARTIFACT).split('\n');
  lines[2] = 'comment: not the trusted one';
  const verdict = verifyMinisign(ARTIFACT, lines.join('\n'), parseMinisignPublicKey(publicKeyFile()));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /no trusted-comment line/);
});

test('a public-key packet of the wrong length is refused rather than sliced', () => {
  // A short packet would otherwise yield a 32-byte "key" made partly of the id, which fails
  // every verification — reported as a bad signature rather than as a bad key file.
  assert.throws(
    () => parseMinisignPublicKey(`untrusted comment: k\n${b64(Buffer.alloc(30))}\n`),
    MinisignFormatError,
  );
  // The bare-packet form (no comment line) is accepted, because minisign writes both.
  const bare = publicKeyFile().split('\n')[1]!;
  assert.equal(parseMinisignPublicKey(bare).keyId, KEY_ID.toString('hex'));
});

test('`valid` is no longer the caller\u2019s word — the count runs on verified bytes', () => {
  // The gap this closed: `countReleaseSignatures` took `{ keyId, generation, valid }` and
  // nothing produced that boolean, so the §1.4 floor was counted over whatever the caller
  // believed. `releaseSignatureFrom` is the one function that produces it honestly.
  const key = publicKeyFile();
  const good = releaseSignatureFrom(ARTIFACT, signFile(ARTIFACT), key, 3);
  assert.equal(good.valid, true);
  assert.equal(good.keyId, KEY_ID.toString('hex'));
  assert.equal(good.why, undefined);

  // And a restated trusted comment carries ITS OWN reason through to the rejection, because
  // "the signature does not verify" would send an operator to check bytes that are fine.
  const restated = releaseSignatureFrom(
    ARTIFACT,
    signFile(ARTIFACT, { restatedComment: 'an entirely different claim' }),
    key,
    3,
  );
  assert.equal(restated.valid, false);
  assert.match(restated.why ?? '', /trusted comment is not signed/);

  const counted = countReleaseSignatures([good, restated], { generation: 3, revokedKeyIds: [] });
  assert.equal(counted.distinctKeys, 1);
  assert.equal(counted.rejected.length, 1);
  assert.match(counted.rejected[0]!.why, /trusted comment is not signed/);
});

test('an unreadable public key throws rather than counting as a failed signature', () => {
  // Different facts with different next steps: a signature that does not verify is a claim
  // about the artifact, an unreadable key file is a claim about the verifier's own inputs —
  // and there is no key id to report the second one under.
  assert.throws(
    () => releaseSignatureFrom(ARTIFACT, signFile(ARTIFACT), 'untrusted comment: k\nnope\n', 1),
    /this public key cannot be read/,
  );
});
