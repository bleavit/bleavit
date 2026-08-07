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
import { type ChainMetadata, type StorageHasher, storageHashers } from './metadata.js';

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * One key argument: the hasher metadata declares for it, and its SCALE encoding.
 *
 * {@link StorageHasher} is declared in `metadata.ts` rather than here, and the move was a
 * `no-circular` violation rather than a preference: metadata is where the hasher set is
 * *derived* from, so a type declared here and imported there put the two modules in a cycle.
 * It stays exported from `@bleavit/chain-client` through the barrel.
 */
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
 * How many bytes a hasher puts **in front of** the key it concatenates.
 *
 * Measured from the hasher itself rather than tabulated: hashing the empty input yields the
 * digest and nothing else, so its length *is* the offset at which the encoded key begins.
 * A written-down table would be a second copy of a fact `HASHERS` already holds, and the two
 * could disagree — at which point a key decoder would read a storage key from the wrong byte
 * and produce a well-formed value for the wrong subject.
 *
 * All three hashers this client builds keys for are concat forms, so every key it can build
 * is also a key it can take apart; `Identity` is the degenerate case and correctly answers 0.
 * Anything else refuses here exactly as {@link storageKey} refuses it.
 */
export function concatDigestBytes(hasher: StorageHasher): number {
  const digest = HASHERS[hasher];
  if (digest === undefined) throw new UnsupportedHasherError(hasher);
  return digest(new Uint8Array()).length;
}

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

/**
 * One storage item's key construction, bound to a chain.
 *
 * `arity` is exported because a caller that holds the wrong number of key values has made
 * the double-map-vs-tuple-key mistake, and it should be able to say so before building
 * anything.
 */
export interface StorageKeyBuilder {
  readonly pallet: string;
  readonly item: string;
  readonly arity: number;
  readonly hashers: readonly StorageHasher[];
  /** The 32-byte prefix: the whole key for a plain item, the map prefix otherwise. */
  readonly prefix: HexString;
  /** The full key for one entry. `values` must have exactly `arity` elements. */
  key(values: readonly unknown[]): HexString;
}

/** A storage entry as PAPI's `getTypedCodecs` returns it, as far as this module needs. */
interface TypedStorageEntry {
  readonly args: { readonly inner: readonly { enc(value: unknown): Uint8Array }[] };
}

export class KeyArityError extends Error {
  constructor(pallet: string, item: string, expected: number, actual: number) {
    super(
      `"${pallet}.${item}" is keyed by ${expected} hashed position(s) and was given ` +
        `${actual}. This is the double-map-versus-tuple-key mistake: doc 02 writes both ` +
        '`Welfare.Snapshots` and `ConditionalLedger.Positions` as `(A, B) -> V`, but the ' +
        'first hashes ONE encoded tuple and the second hashes TWO values separately. Both ' +
        'produce a well-formed key, and the wrong one returns no value.',
    );
    this.name = 'KeyArityError';
  }
}

export class KeyCodecUnavailableError extends Error {
  constructor(pallet: string, item: string, detail: string) {
    super(
      `cannot obtain per-position key codecs for "${pallet}.${item}" from the pinned ` +
        `polkadot-api: ${detail}. Refusing rather than falling back to a prefix, which the ` +
        "node answers with the whole map. If polkadot-api was bumped, this client's " +
        'key-building surface moved with it and the runtime storage-key fixture will say so.',
    );
    this.name = 'KeyCodecUnavailableError';
  }
}

/**
 * Build one storage item's keys from a chain's own codecs and its own metadata.
 *
 * ## The two sources, and why both are needed
 *
 * Neither artifact answers the question alone. **Metadata** carries the hashers and nothing
 * that can encode a value; **the descriptors** carry codecs and no hasher. So this takes
 * both, and — the part that makes it safe rather than merely convenient — **requires them
 * to agree on the key arity** before building anything.
 *
 * ## `args.inner` is a measured internal, not a documented export
 *
 * `getTypedCodecs(…).query.P.I.args` is a codec over the whole key tuple; its `enc` produces
 * one buffer, which is the right pre-image for a single map over a tuple key and the wrong
 * one for a double map. Its **`inner`** property is an array of one codec per hashed
 * position, which is what this needs — and it is a `@polkadot-api/substrate-bindings`
 * internal with no compatibility promise.
 *
 * That was measured before being relied on, over the whole read surface rather than a spot
 * check: across **739** storage items on the two pinned chains (379 Bleavit, 360 Asset Hub
 * Paseo), `args.inner.length` equals the metadata hasher count every time — including
 * `Welfare.Snapshots`, the tuple-key case, where it is 1 and not 2. And on all 11 entries of
 * `runtime/bleavit-runtime/fixtures/storage-keys.json`, `inner[i]` re-encodes the pre-image
 * the **runtime itself** published, byte for byte.
 *
 * The arity cross-check below is what keeps that measurement honest over time: if a PAPI
 * bump reshapes `inner`, this refuses instead of silently building short keys. `app/tests/
 * chain-client/storage-keys.test.ts` fails on the same commit, against the Rust oracle.
 */
export function storageKeyBuilder(
  codecs: { readonly query: unknown },
  metadata: ChainMetadata,
  pallet: string,
  item: string,
): StorageKeyBuilder {
  // `storageHashers` throws on an absent item, which must happen before the codec lookup:
  // PAPI's `query` is a Proxy that throws its own, less specific error for the same cause.
  const hashers = storageHashers(metadata, pallet, item);

  let entry: unknown;
  try {
    entry = (codecs.query as Record<string, Record<string, unknown>>)[pallet]?.[item];
  } catch (error) {
    throw new KeyCodecUnavailableError(pallet, item, String(error));
  }
  const inner: unknown = (entry as { args?: { inner?: unknown } } | undefined)?.args?.inner;
  if (!Array.isArray(inner)) {
    throw new KeyCodecUnavailableError(pallet, item, '`args.inner` is not an array');
  }
  if (inner.length !== hashers.length) {
    // The two artifacts disagree. Neither is presumed right — one of them no longer
    // describes this chain, and building a key from either would be a guess.
    throw new KeyArityError(pallet, item, hashers.length, inner.length);
  }
  const codecList = inner as TypedStorageEntry['args']['inner'];
  for (const [position, codec] of codecList.entries()) {
    if (typeof codec?.enc !== 'function') {
      throw new KeyCodecUnavailableError(pallet, item, `position ${position} has no \`enc\``);
    }
  }

  const prefix = storagePrefix(pallet, item);
  return {
    pallet,
    item,
    arity: hashers.length,
    hashers,
    prefix,
    key(values) {
      if (values.length !== hashers.length) {
        throw new KeyArityError(pallet, item, hashers.length, values.length);
      }
      const args: StorageKeyArg[] = [];
      for (const [position, hasher] of hashers.entries()) {
        try {
          args.push({ hasher, encoded: codecList[position]!.enc(values[position]) });
        } catch (error) {
          // PAPI's own messages are accurate and contextless — an SS58 address that fails
          // its checksum reports `Invalid checksum` with no hint of which read it was for.
          // Naming the surface and the position is the difference between a diagnosable
          // failure and one that looks like a library bug.
          throw new Error(
            `key position ${position} of "${pallet}.${item}" could not be encoded: ` +
              `${String(error)}`,
          );
        }
      }
      return storageKey(pallet, item, args);
    },
  };
}
