/**
 * Storage-key construction — the half that can be verified today.
 *
 * A chainHead storage key is `twox128(pallet) ++ twox128(item)` for a plain item or a map
 * *prefix*, and for a single map entry a further `hasher(arg)` per key argument. This module
 * implements the **prefix only**, and the absence of the rest is deliberate rather than
 * unfinished work.
 *
 * ## Why there is no function here that takes key arguments
 *
 * The prefix is checkable against ground truth: `app/fixtures/chainhead/` records 65 real
 * storage requests issued against the runtime, and every one of their keys is exactly 32
 * bytes — a prefix — because the recorder reads whole maps with `descendantsValues` and never
 * a single entry. So the corpus certifies this function completely and certifies **nothing
 * whatever** about hasher application (V-156).
 *
 * That leaves two ways to add an args-taking function, and both are worse than not having one:
 *
 *  - Implement it and test it against the same corpus. The suite would report 65 surfaces and
 *    eight hasher combinations covered while exercising no hasher at all — the corpus declares
 *    hashers in its `metadata_presence` layout but never issues a key that uses one.
 *  - Implement it and test it against `@polkadot-api/substrate-bindings`' own hashers, which
 *    is what this module is built from. That tests the library against itself.
 *
 * A wrong storage key does not fail loudly: it returns no value, and an absent value is
 * indistinguishable from an account that holds nothing. A balance of zero is exactly what a
 * mis-hashed key produces, and exactly what a real empty account produces. So the args half
 * needs known-answer vectors from outside TypeScript, and this repository already has that
 * pattern twice — `runtime/bleavit-runtime/fixtures/multisig-derivation.json` and
 * `crates/market-core/fixtures/chain-quote-agreement.json`, each written by the Rust side and
 * read in place.
 *
 * Until those exist, a caller that needs a single map entry gets a **type error** rather than
 * a plausible key, which is the fail-closed shape: there is no function to call.
 *
 * ## Why the names are separate arguments
 *
 * The same reason `decodeStorage` takes them separately: a dotted string invites a caller to
 * assemble a name by concatenation, and `"Epoch.Proposals"` hashed as one string is a
 * perfectly well-formed key for a storage item that does not exist.
 */

import { Twox128 } from '@polkadot-api/substrate-bindings';
import type { HexString } from '@bleavit/shared-types';

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * The 32-byte key of a plain storage item, or the prefix of a map.
 *
 * This is the key to pass to `transport.storage(…, 'value')` for a plain item and to
 * `transport.storage(…, 'descendantsValues')` for a whole map — which between them are every
 * read this client currently issues.
 */
export function storagePrefix(pallet: string, item: string): HexString {
  return `0x${hex(Twox128(encoder.encode(pallet)))}${hex(Twox128(encoder.encode(item)))}`;
}
