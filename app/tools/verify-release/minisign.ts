/**
 * Minisign verification — 12 §1.4, §2.1 (F13).
 *
 * `verdict.ts` counts signatures that are already `{ keyId, generation, valid }`, and until
 * now nothing produced that `valid`. A caller-supplied boolean is a signature check that
 * defaults to whatever the caller believes — the `assertCheckable` shape this client has met
 * in `admitIntent`, `admitEvidence` and `admitSnapshot`. This module is the missing half:
 * bytes in, a verdict out, with the reason when it refuses.
 *
 * ## The trusted comment is verified, and that is the whole point of the second signature
 *
 * A minisign `.minisig` carries **two** Ed25519 signatures over different messages:
 *
 * - the **primary** signature, over the file (or its BLAKE2b-512 digest — see below);
 * - the **global** signature, over `primary_signature || trusted_comment`.
 *
 * The trusted comment is *not covered by the primary signature at all*. It is also the only
 * part of the file a human reads — "bleavit release 1.4.2, built 2026-08-06" — and it is what
 * a person uses to decide **what** they are trusting, as distinct from whether the bytes are
 * intact. A verifier that checks the primary signature and skips the global one therefore
 * passes every file check while leaving that claim entirely unauthenticated: an attacker who
 * obtains any validly-signed artifact can restate its trusted comment as anything at all and
 * the verdict does not move. Both signatures are checked here, and a test tampers with the
 * trusted comment alone and requires the refusal — because that is the only mutation the
 * primary check cannot see.
 *
 * ## The algorithm is read from the packet, and an unknown one refuses
 *
 * `Ed` signs the file directly; `ED` signs `BLAKE2b-512(file)` (minisign's prehashed mode,
 * which is what any tool signing a large artifact emits). Reading it is not optional: guess
 * the wrong one and verification fails, which is safe but reports *"the signature does not
 * verify"* for a signature that is fine. The unsafe direction is a **default** — an
 * unrecognised two-byte tag is a signature scheme this code does not implement, and treating
 * it as one it does is how a future algorithm gets verified by the wrong rules.
 *
 * ## Ed25519 comes from the platform, not from this file
 *
 * `node:crypto` verifies Ed25519 and hashes BLAKE2b-512 natively (both measured, not assumed
 * — see the suite). Hand-rolling RFC 8032 here would put a second implementation of the one
 * primitive whose failure is silent into a repository that already has one in
 * `tools/monitoring/attestation_monitor.py`, and the suite differentials against exactly that
 * one rather than against a second copy written beside it.
 */

import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto';

/** Minisign's two algorithm tags. Read from the packet, never assumed. */
const ALGORITHM_PURE = 'Ed';
const ALGORITHM_PREHASHED = 'ED';

const KEY_PACKET_BYTES = 42; // 2 algorithm + 8 key id + 32 public key
const SIGNATURE_PACKET_BYTES = 74; // 2 algorithm + 8 key id + 64 signature
const GLOBAL_SIGNATURE_BYTES = 64;

export class MinisignFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MinisignFormatError';
  }
}

export interface MinisignPublicKey {
  /** Hex, lower-case. The identity §1.4 counts *distinct* keys by. */
  readonly keyId: string;
  readonly publicKey: Uint8Array;
}

export interface MinisignSignature {
  readonly algorithm: string;
  readonly keyId: string;
  readonly signature: Uint8Array;
  /**
   * The human-readable claim. Covered by the **global** signature only, which is why this
   * module verifies both — see the module note.
   */
  readonly trustedComment: string;
  readonly globalSignature: Uint8Array;
}

function decodeBase64(line: string): Uint8Array {
  // `Buffer.from(…, 'base64')` is famously permissive — it ignores characters outside the
  // alphabet rather than failing — so the packet length check below is what actually rejects
  // a corrupted line, and it is stated here so nobody removes it as redundant.
  return new Uint8Array(Buffer.from(line, 'base64'));
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function nonEmptyLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseMinisignPublicKey(text: string): MinisignPublicKey {
  const lines = nonEmptyLines(text);
  const encoded =
    lines.length === 1
      ? lines[0]
      : lines.length === 2 && lines[0]!.startsWith('untrusted comment:')
        ? lines[1]
        : undefined;
  if (encoded === undefined) {
    throw new MinisignFormatError(
      'a minisign public key is an optional `untrusted comment:` line and one base64 packet',
    );
  }
  const packet = decodeBase64(encoded);
  if (packet.length !== KEY_PACKET_BYTES) {
    throw new MinisignFormatError(
      `a minisign public-key packet is ${KEY_PACKET_BYTES} bytes (algorithm + id + key), got ${packet.length}`,
    );
  }
  const algorithm = Buffer.from(packet.subarray(0, 2)).toString('latin1');
  if (algorithm !== ALGORITHM_PURE) {
    // A public key is always tagged `Ed`; the prehash choice lives in the *signature*.
    throw new MinisignFormatError(`unsupported minisign public-key algorithm "${algorithm}"`);
  }
  return { keyId: toHex(packet.subarray(2, 10)), publicKey: packet.subarray(10, 42) };
}

export function parseMinisignSignature(text: string): MinisignSignature {
  const lines = nonEmptyLines(text);
  if (lines.length !== 4 || !lines[0]!.startsWith('untrusted comment:')) {
    throw new MinisignFormatError(
      'a minisign signature is four non-empty lines: untrusted comment, packet, trusted comment, global signature',
    );
  }
  // Both spellings occur in the wild; the reference tool writes the spaced one.
  const prefix = ['trusted comment:', 'trusted_comment:'].find((candidate) =>
    lines[2]!.startsWith(candidate),
  );
  if (prefix === undefined) {
    throw new MinisignFormatError('a minisign signature carries no trusted-comment line');
  }
  const packet = decodeBase64(lines[1]!);
  if (packet.length !== SIGNATURE_PACKET_BYTES) {
    throw new MinisignFormatError(
      `a minisign signature packet is ${SIGNATURE_PACKET_BYTES} bytes, got ${packet.length}`,
    );
  }
  const algorithm = Buffer.from(packet.subarray(0, 2)).toString('latin1');
  if (algorithm !== ALGORITHM_PURE && algorithm !== ALGORITHM_PREHASHED) {
    // Refused rather than defaulted: an unrecognised tag is a scheme this code does not
    // implement, and verifying it by another scheme's rules is the failure that matters.
    throw new MinisignFormatError(
      `unrecognised minisign algorithm "${algorithm}" — this verifier implements Ed and ED only`,
    );
  }
  const globalSignature = decodeBase64(lines[3]!);
  if (globalSignature.length !== GLOBAL_SIGNATURE_BYTES) {
    throw new MinisignFormatError(
      `a minisign global signature is ${GLOBAL_SIGNATURE_BYTES} bytes, got ${globalSignature.length}`,
    );
  }
  return {
    algorithm,
    keyId: toHex(packet.subarray(2, 10)),
    signature: packet.subarray(10, 74),
    trustedComment: lines[2]!.slice(prefix.length).replace(/^\s+/, ''),
    globalSignature,
  };
}

function ed25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey).toString('base64url') },
  });
  return verifyEd25519(null, message, key, signature);
}

/**
 * The outcome, with the reason when it refuses.
 *
 * A boolean would let a caller record a parse failure as *"the signature does not verify"*,
 * which is a different fact with a different next step — and `verdict.ts` reports every
 * rejection with a `why` precisely so a refused release says which condition failed.
 */
export type MinisignVerdict =
  | { readonly ok: true; readonly keyId: string; readonly trustedComment: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Verify a detached minisign signature over `message`.
 *
 * Both signatures are checked. The primary one covers the artifact; the global one covers
 * the trusted comment, which nothing else does — see the module note.
 */
export function verifyMinisign(
  message: Uint8Array,
  signatureText: string,
  publicKey: MinisignPublicKey,
): MinisignVerdict {
  let signature: MinisignSignature;
  try {
    signature = parseMinisignSignature(signatureText);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (signature.keyId !== publicKey.keyId) {
    return {
      ok: false,
      reason: `this signature is by key ${signature.keyId}, not ${publicKey.keyId}`,
    };
  }
  const signed =
    signature.algorithm === ALGORITHM_PURE
      ? message
      : new Uint8Array(createHash('blake2b512').update(message).digest());
  if (!ed25519(publicKey.publicKey, signed, signature.signature)) {
    return { ok: false, reason: 'the signature does not verify against these bytes' };
  }
  // The half a verifier is most likely to omit, and the one whose absence is invisible: the
  // trusted comment is covered by nothing else.
  const globalMessage = Buffer.concat([
    Buffer.from(signature.signature),
    Buffer.from(signature.trustedComment, 'utf8'),
  ]);
  if (!ed25519(publicKey.publicKey, globalMessage, signature.globalSignature)) {
    return {
      ok: false,
      reason:
        'the trusted comment is not signed by this key. The artifact bytes may be intact — ' +
        'the global signature covers the human-readable claim, and only it does, so a ' +
        'restated comment on an otherwise valid signature fails exactly here.',
    };
  }
  return { ok: true, keyId: signature.keyId, trustedComment: signature.trustedComment };
}
