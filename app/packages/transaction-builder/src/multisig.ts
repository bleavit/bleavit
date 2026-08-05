/**
 * The multisig account, derived rather than trusted — 11 §11.3, 02 §7.6 (F6).
 *
 * `Multisig.as_multi(threshold, other_signatories, …, call)` executes the inner call as an
 * account **nobody chooses**: `pallet_multisig` derives it from the signatory set and the
 * threshold. That account is what every 11 §11.5 precondition row must read, because the
 * balances, positions, bonds and locks that decide whether the inner call succeeds belong
 * to it and not to the signer (`wrappers.ts` has the identity split in full).
 *
 * ## Why it is derived here instead of being passed in
 *
 * An earlier draft took the multisig account as a caller-supplied field on the wrapper. A
 * wrong value there is silent and fails in the dangerous direction: the client reads some
 * other account's healthy balance, reports every precondition green, and the runtime
 * rejects the inner call. The user signed something the client had told them would work —
 * which is the exact failure the whole precondition table exists to prevent, arriving
 * through the one field nobody checked.
 *
 * So `MultisigAccount` is a branded string only `deriveMultisigAccount` can mint, in the
 * same way `Finalized<T>` is constructible only inside `chain-client` and for the same
 * reason: a value that decides what gets read must not be writable as a literal.
 *
 * ## The derivation is the runtime's, and a fixture proves it
 *
 * `pallet_multisig::Pallet::multi_account_id` computes
 * `blake2_256(SCALE(b"modlpy/utilisuba", who, threshold))` and reads an `AccountId32` off
 * the front of the digest. Every part of that is a place to be subtly wrong — the prefix is
 * a fixed-size array and carries *no* length prefix while `who` is a `Vec` and does, the
 * signatory order is part of the pre-image rather than just the set, and SCALE's compact
 * length changes width at 64 elements, so a client that hardcoded a one-byte prefix derives
 * a wrong account for a large committee and a well-formed address either way.
 *
 * None of that is checkable by reasoning, so it is checked against the runtime:
 * `runtime/bleavit-runtime/fixtures/multisig-derivation.json` is written by
 * `pallet_multisig` itself and carries the pre-image **and** the account for each case. The
 * two fields are separate deliberately — a client whose pre-image matches and whose account
 * does not has a hashing problem, while one whose pre-image differs has an encoding
 * problem, and publishing only the account makes both look identical.
 *
 * ## The hash is injected
 *
 * `blake2b-256` is not a platform primitive anywhere this app runs (`SubtleCrypto` does not
 * have it and node's OpenSSL exposes `blake2b512`, not the 256-bit variant), so the caller
 * supplies it — the same discipline `packages/verify` and the handoff digest use. What
 * belongs here is the pre-image construction, which must not vary; what does not is a
 * bundled copy of a hash function whose correctness this package cannot check.
 */

declare const MULTISIG_DERIVED: unique symbol;

/**
 * A multisig address that was computed from its signatory set, not typed by a caller.
 *
 * A plain `string` would let `{ multisig: '0x…' }` name any account at all.
 */
export type MultisigAccount = string & { readonly [MULTISIG_DERIVED]: true };

/** A 32-byte public key as lowercase `0x`-prefixed hex. */
export type PublicKeyHex = string;

/** A blake2b digest with a 32-byte output. Supplied by the caller — see the module note. */
export type Blake2b256 = (bytes: Uint8Array) => Uint8Array;

export interface MultisigDerivation {
  /** The account the inner call executes as. */
  readonly account: MultisigAccount;
  /** The signatory set in the strictly ascending order `as_multi` requires. */
  readonly signatories: readonly PublicKeyHex[];
  readonly threshold: number;
  /** The exact bytes hashed. Carried so a disagreement localises to encoding or hashing. */
  readonly preimage: Uint8Array;
}

export class MultisigDerivationError extends Error {}

/** `b"modlpy/utilisuba"` — pallet_multisig's domain prefix, as raw ASCII. */
const PREFIX = new TextEncoder().encode('modlpy/utilisuba');
const PUBLIC_KEY_BYTES = 32;
const U16_MAX = 65535;

const HEX32 = /^0x[0-9a-f]{64}$/;

function decodeKey(hex: PublicKeyHex, position: number): Uint8Array {
  const normalized = typeof hex === 'string' ? hex.toLowerCase() : '';
  if (!HEX32.test(normalized)) {
    throw new MultisigDerivationError(
      `signatory ${position} is not a 32-byte 0x-prefixed hex public key`,
    );
  }
  const bytes = new Uint8Array(PUBLIC_KEY_BYTES);
  for (let i = 0; i < PUBLIC_KEY_BYTES; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return bytes;
}

function encodeKey(bytes: Uint8Array): PublicKeyHex {
  let out = '0x';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Lexicographic byte order — `AccountId32`'s own `Ord`, which is what the pallet sorts by. */
function compareKeys(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < PUBLIC_KEY_BYTES; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * SCALE's compact integer, for the `Vec<AccountId32>` length prefix.
 *
 * The width changes at 64 and again at 2^14 — the boundary a hardcoded single byte gets
 * wrong while every small committee still derives correctly.
 */
function compactU32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) {
    throw new MultisigDerivationError(`compact length must be a non-negative integer: ${value}`);
  }
  if (value < 0b1_000000) return Uint8Array.of(value << 2);
  if (value < 0b01_00000000_000000) {
    const encoded = value * 4 + 0b01;
    return Uint8Array.of(encoded & 0xff, (encoded >>> 8) & 0xff);
  }
  if (value < 0b01_00000000_00000000_00000000_000000) {
    const encoded = value * 4 + 0b10;
    return Uint8Array.of(
      encoded & 0xff,
      (encoded >>> 8) & 0xff,
      (encoded >>> 16) & 0xff,
      (encoded >>> 24) & 0xff,
    );
  }
  // SCALE's big-integer mode. Unreachable for a signatory list the runtime bounds, and
  // refused rather than approximated: a wrong length prefix derives a valid-looking
  // address for a different account.
  throw new MultisigDerivationError(`compact length ${value} is past the four-byte mode`);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Derive the account `as_multi` will execute the inner call as.
 *
 * `signatories` is the **whole** set including the eventual signer, in any order; the
 * ascending order the pallet requires is produced here rather than demanded of the caller,
 * because an unsorted set is not an error the user made — but a *duplicate* is refused,
 * since the runtime rejects it (`SenderInSignatories` / `SignatoriesOutOfOrder`) and
 * silently deduplicating would derive an account for a set nobody asked for.
 */
export function deriveMultisigAccount(
  signatories: readonly PublicKeyHex[],
  threshold: number,
  blake2b256: Blake2b256,
): MultisigDerivation {
  if (typeof blake2b256 !== 'function') {
    throw new MultisigDerivationError('a blake2b-256 function is required; there is no default');
  }
  if (!Array.isArray(signatories) || signatories.length === 0) {
    throw new MultisigDerivationError('a multisig needs at least one signatory');
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > U16_MAX) {
    throw new MultisigDerivationError(`threshold must be a u16 of at least 1, got ${threshold}`);
  }
  if (threshold > signatories.length) {
    // Not merely unsatisfiable: it derives a real account that can never dispatch, so a
    // client would show preconditions for an address the multisig can never act from.
    throw new MultisigDerivationError(
      `threshold ${threshold} exceeds the ${signatories.length} signatories`,
    );
  }

  const keys = signatories.map(decodeKey);
  const sorted = [...keys].sort(compareKeys);
  for (let i = 1; i < sorted.length; i += 1) {
    if (compareKeys(sorted[i - 1]!, sorted[i]!) === 0) {
      throw new MultisigDerivationError('the signatory set contains a duplicate');
    }
  }

  const preimage = concat([
    // A `&[u8; 16]`: sixteen raw bytes, no length prefix. The one part of the pre-image
    // that is not length-delimited, and the easiest to encode as a `Vec` by mistake.
    PREFIX,
    compactU32(sorted.length),
    ...sorted,
    Uint8Array.of(threshold & 0xff, (threshold >>> 8) & 0xff),
  ]);

  const digest = blake2b256(preimage);
  if (!(digest instanceof Uint8Array) || digest.length !== PUBLIC_KEY_BYTES) {
    throw new MultisigDerivationError(
      'the supplied hash did not return 32 bytes; blake2b-256 is required, not blake2b-512',
    );
  }

  return {
    account: encodeKey(digest) as MultisigAccount,
    signatories: sorted.map(encodeKey),
    threshold,
    preimage,
  };
}

/**
 * The `other_signatories` argument, in the order `as_multi` demands.
 *
 * The signer must be in the derived set. If it is not, the *chain* would derive a different
 * account — `ensure_sorted_and_insert` inserts the caller into the set before deriving — so
 * every precondition the client just evaluated belongs to an account this transaction will
 * never act as. Refused rather than encoded.
 */
export function otherSignatories(
  derivation: MultisigDerivation,
  signer: PublicKeyHex,
): readonly PublicKeyHex[] {
  const normalized = typeof signer === 'string' ? signer.toLowerCase() : '';
  if (!HEX32.test(normalized)) {
    throw new MultisigDerivationError('the signer is not a 32-byte 0x-prefixed hex public key');
  }
  if (!derivation.signatories.includes(normalized)) {
    throw new MultisigDerivationError(
      'the signer is not one of this multisig\'s signatories, so the chain would derive a ' +
        'different account than the one these preconditions were read against',
    );
  }
  return derivation.signatories.filter((key) => key !== normalized);
}
