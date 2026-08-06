/**
 * Storage-key construction — 02 §7.
 *
 * A chainHead storage key is `twox128(pallet) ++ twox128(item)` for a plain item or a map
 * *prefix*, and for a single map entry a further `hasher_i(encoded_key_i)` per key
 * argument, in key order.
 *
 * ## Why the args half arrived second
 *
 * This module shipped with {@link storagePrefix} alone (V-156), and the reason is worth
 * keeping because it is what shaped {@link storageKey}'s signature.
 *
 * The prefix is checkable against ground truth: `app/fixtures/chainhead/` records real
 * storage requests, and 65 of its 67 key items are exactly 32 bytes — a prefix — because
 * the recorder reads whole maps with `descendantsValues`. The other **two** are
 * single-entry reads of `ForeignAssets.{Asset,Metadata}(usdcLocation)` and do carry a real
 * `Blake2_128Concat` (V-159 — an earlier version of this comment said *every* key was a
 * prefix, which was false).
 *
 * So the corpus certifies the prefix completely and certifies one hasher, on one key type,
 * in one pallet. That is not enough to build on: no `Twox64Concat`, no `Identity`, no
 * multi-key map, no tuple key. And the alternative — testing against
 * `@polkadot-api/substrate-bindings` — tests the library this module is built from against
 * itself.
 *
 * This matters more than a normal gap because **a wrong storage key does not fail**. It
 * returns no value, and an absent value is indistinguishable from an account that holds
 * nothing. A mis-hashed `ForeignAssets.Account` key and a genuinely empty balance render
 * the same screen: *0 USDC*.
 *
 * The oracle is now `runtime/bleavit-runtime/fixtures/storage-keys.json`, written by the
 * runtime's own storage types (`hashed_key_for`) and read **in place** by
 * `app/tests/chain-client/storage-keys.test.ts` — the same single-generator discipline
 * `multisig-derivation.json` and `chain-quote-agreement.json` follow.
 *
 * ## Why keys arrive already encoded
 *
 * {@link storageKey} takes each key as bytes rather than as a value plus a codec, because
 * every key is hashed **separately** and PAPI's `getTypedCodecs` cannot supply that: its
 * `args` codec encodes the whole key tuple as one buffer, which is the right pre-image for
 * a single map over a tuple key and the wrong one for a double map. Those two shapes are
 * indistinguishable in doc 02's type column — `Welfare.Snapshots` and
 * `ConditionalLedger.Positions` are both written `(A, B) → V` — and they produce different
 * keys. Splitting encoding from hashing puts that choice at the call site, where the
 * metadata that answers it lives, and the fixture carries both shapes so a caller that
 * confused them fails.
 *
 * ## Why the names are separate arguments
 *
 * The same reason `decodeStorage` takes them separately: a dotted string invites a caller
 * to assemble a name by concatenation, and `"Epoch.Proposals"` hashed as one string is a
 * perfectly well-formed key for a storage item that does not exist.
 */

import { Blake2128Concat, Identity, Twox64Concat, Twox128 } from '@polkadot-api/substrate-bindings';
import type { HexString } from '@bleavit/shared-types';

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * The hashers the 02 §7 read surface actually uses.
 *
 * Deliberately not every hasher FRAME defines. An unused name here would be untested
 * surface — and the failure mode of a storage hasher is silence, so untested is not a
 * risk this module can carry. A metadata-driven caller meeting anything else gets a
 * refusal from {@link storageKey} rather than a guess.
 *
 * **`Identity` was missing from the first version, and the way it was missing is the
 * point.** It was omitted after checking which hashers *this repository's pallets*
 * declare — `Blake2_128Concat` and `Twox64Concat`, and nothing else. But the read
 * surface is not this repository's pallets: counting hashers in the shipped
 * `metadata.scale` gives 130 `Blake2128Concat`, 50 `Twox64Concat` and **4 `Identity`**,
 * three of them in `pallet_preimage` — and `Preimage.StatusFor` and
 * `Preimage.PreimageFor` are frozen 02 §7.6 reads backing 11 §11.5's P-10 preconditions
 * (*"the payload preimage is noted with a matching hash and length"*, *"pinned and cannot
 * be reaped"*). A client that cannot key them cannot mirror two dispatch checks. So: ask
 * the artifact, not the source tree.
 *
 * Note the spelling. Metadata tags it `Blake2128Concat`; FRAME and the Rust fixture spell
 * it `Blake2_128Concat`. A metadata-driven caller must map, and the two differ by exactly
 * one underscore — which is why {@link storageKey} refuses an unknown name loudly instead
 * of falling back.
 */
export type StorageHasher = 'Blake2_128Concat' | 'Twox64Concat' | 'Identity';

/** One key argument: the hasher metadata declares for it, and its SCALE encoding. */
export interface StorageKeyArg {
  readonly hasher: StorageHasher;
  readonly encoded: Uint8Array;
}

/**
 * Thrown when a caller names a hasher this module does not implement.
 *
 * A returned prefix would be far worse than a throw: `descendantsValues` answers a prefix
 * by returning **every** entry in the map, so a silently-degraded key reads as one
 * account's balance and is the whole book's.
 */
export class UnsupportedHasherError extends Error {
  constructor(hasher: string) {
    super(
      `${hasher} is not a hasher this client builds keys for (this runtime's read surface ` +
        'uses Blake2_128Concat, Twox64Concat and Identity). Refusing rather than returning ' +
        'a shorter key, which the node would answer as a map prefix. If this came from ' +
        "metadata, check the spelling: metadata tags it `Blake2128Concat`, FRAME spells it " +
        '`Blake2_128Concat`.',
    );
    this.name = 'UnsupportedHasherError';
  }
}

const HASHERS: Readonly<Record<StorageHasher, (encoded: Uint8Array) => Uint8Array>> =
  Object.freeze({
    Blake2_128Concat: Blake2128Concat,
    Twox64Concat: Twox64Concat,
    // The degenerate hasher: the key IS its own SCALE encoding, no digest and nothing
    // appended. Taken from the bindings rather than written as `(x) => x` so all three
    // come from one place, and pinned by a fixture vector like the other two — the
    // hasher that looks too simple to get wrong is the one whose wrong output nobody
    // notices, because a plausible key comes out either way.
    Identity,
  });

/**
 * The 32-byte key of a plain storage item, or the prefix of a map.
 *
 * This is the key to pass to `transport.storage(…, 'value')` for a plain item and to
 * `transport.storage(…, 'descendantsValues')` for a whole map.
 */
export function storagePrefix(pallet: string, item: string): HexString {
  return `0x${hex(Twox128(encoder.encode(pallet)))}${hex(Twox128(encoder.encode(item)))}`;
}

/**
 * The full key of one map entry: the prefix followed by each key's hash, in key order.
 *
 * Passing no keys returns exactly {@link storagePrefix}, which is correct — that *is* the
 * key of a plain value — and is why the fixture carries `Constitution.PhaseFlags` as its
 * zero-key control.
 */
export function storageKey(
  pallet: string,
  item: string,
  keys: readonly StorageKeyArg[],
): HexString {
  let out: string = storagePrefix(pallet, item);
  for (const key of keys) {
    const hasher = HASHERS[key.hasher];
    // Present-but-undefined is reachable from untyped metadata, which is the only way
    // this function is called in production.
    if (hasher === undefined) throw new UnsupportedHasherError(key.hasher);
    out += hex(hasher(key.encoded));
  }
  return out as HexString;
}
