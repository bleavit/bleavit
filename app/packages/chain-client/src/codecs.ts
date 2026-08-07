/**
 * Typed SCALE decoding for the screen read layers — F7's last item.
 *
 * ## It needs metadata, not a client
 *
 * `api.query.X.Y.getValue()` decodes internally and therefore needs a live client, which is
 * why this looked blocked on a `createClient` that `light-client.ts` deliberately does not
 * wire. But `getTypedCodecs(descriptors)` is a root export of `polkadot-api` and builds the
 * codecs from the descriptors alone — measured, not assumed: it returns
 * `{query, tx, event, apis, constants, view}` with no chain, no provider and no network.
 *
 * So the decode layer is buildable and testable exactly like every other layer here, and
 * the ruling that `createClient` must sit *above* the read layer — so a metadata
 * incompatibility becomes 10 §5.2's `ReadOnlyIncompatible` rather than a constructor throw —
 * stands untouched. It was never this item's dependency, the same false premise that held
 * F4's last item.
 *
 * ## Why the descriptors are an argument
 *
 * `chain-client` is the only package the firewall lets import `polkadot-api` (10 §10.1,
 * app-code rule 13), and it must not gain an edge to the generated descriptor package on
 * top of that. Taking `descriptors` as a parameter keeps the dependency direction as
 * 10 §10.1 requires and lets a suite drive this with any chain's descriptors.
 *
 * ## A decode failure is a value, never an exception
 *
 * INV-FE-12 and app-code rule 10: *"undecodable data renders as raw SCALE with a warning;
 * never guess at encodings."* A thrown error would be caught somewhere up the stack and
 * turned into a zero or an empty list — the guess the rule forbids, and indistinguishable
 * on screen from a chain that really says zero. So every decoder returns a discriminated
 * result and the screens render the raw bytes.
 *
 * The return types are **structural**: this module names none of the consumers' types, so
 * `chain-client` gains no edge to `application` or to a feature unit. TypeScript checks the
 * shapes match at each call site.
 */

import { getTypedCodecs } from 'polkadot-api';

/** The result shape the read layers consume. Restated structurally, never imported. */
export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * The codec surface, typed as `unknown` at the point the lookup happens.
 *
 * This is the accurate type rather than a weakening. `getTypedCodecs` returns a **mapped
 * type keyed by the real pallet and member names**, and the lookup here is by *string* —
 * `decodeStorage(codecs, 'Constitution', 'PhaseFlags', …)` — so no static type describes
 * the relation between the argument and the result. Declaring `Record<string, …>` and
 * asserting into it would be a lie the compiler cannot check, and `as unknown as` is banned
 * across `app/` for exactly that reason (app-code rule 2); the gate caught the first
 * version of this file doing it.
 *
 * So the shape is `unknown` and the narrowing is done at runtime, where the check is real.
 */
export interface ChainCodecs {
  readonly query: unknown;
}

/**
 * The runtime-API half of the same surface, declared apart from {@link ChainCodecs}.
 *
 * Two interfaces rather than one member added to the first, and the reason is the same one
 * `storageKeyBuilder` gives for taking `{ readonly query: unknown }` inline: a function
 * should name the part of the codec surface it actually reaches. A single widened interface
 * would also make every existing two-line storage stub in the suites fail to typecheck for a
 * property none of them touches, which is churn that teaches nothing.
 *
 * `apis` is `unknown` for {@link ChainCodecs}' reason exactly — the lookup below is by
 * *string*, and PAPI's real type is a mapped type keyed by the runtime's own API and method
 * names, so no static type relates the argument to the result. Asserting into a
 * `Record<string, …>` would be a claim the compiler cannot check.
 */
export interface ChainApiCodecs {
  readonly apis: unknown;
}

/** A storage item's value codec, as far as this module needs to know. */
interface StorageCodec {
  readonly value: { dec(input: string): unknown };
}

/**
 * A runtime API's codec pair, as far as this module needs to know.
 *
 * The **arguments** and the **result** are separate codecs and both are needed, because both
 * halves fail silently on their own. A wrong argument does not error — it asks about a
 * different subject and receives a perfectly valid answer — and a result decoded by the
 * wrong method's codec yields a plausible record from the right bytes.
 */
interface ApiCodec {
  readonly args: { enc(values: readonly unknown[]): Uint8Array };
  readonly value: { dec(input: string): unknown };
}

function isStorageCodec(candidate: unknown): candidate is StorageCodec {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const value: unknown = (candidate as { value?: unknown }).value;
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as { dec?: unknown }).dec === 'function';
}

/**
 * Build the codecs for a chain from its descriptors. No client, no network.
 *
 * Async because `getTypedCodecs` is: the descriptors carry their metadata lazily. The
 * return type widens to `ChainCodecs` by ordinary assignability — PAPI's result has a
 * `query` property, and `unknown` accepts it — so no assertion is involved.
 */
export async function loadCodecs(
  descriptors: Parameters<typeof getTypedCodecs>[0],
): Promise<ChainCodecs & ChainApiCodecs> {
  return getTypedCodecs(descriptors);
}

/**
 * Decode one storage value, naming the item in any failure.
 *
 * **The codec surface is a Proxy that throws on an unknown name** — measured, not assumed:
 * `codecs.query.NoSuchPallet.X` raises *"Runtime entry Storage(NoSuchPallet.X) not found"*
 * rather than yielding `undefined`. The first version of this function guarded with
 * `=== undefined` on both levels, and both guards were **dead code**: the property access
 * threw before either could run. That is the sort of defect a happy-path test never sees,
 * and the reason the lookup happens inside the `try` below.
 *
 * Two failures are therefore distinguished, and only two, because only two are knowable:
 * the entry does not exist in this runtime, and the bytes did not decode. A Proxy that
 * throws cannot tell "no such pallet" from "no such item", and inventing that distinction
 * would put detail in a message that nothing established.
 *
 * The pallet and item stay separate arguments rather than a dotted string so a caller
 * cannot assemble a name by concatenation and have it silently mean something else.
 */
export function decodeStorage<T>(
  codecs: ChainCodecs,
  pallet: string,
  item: string,
  raw: string,
): DecodeResult<T> {
  let candidate: unknown;
  try {
    candidate = (codecs.query as Record<string, Record<string, unknown>>)[pallet]?.[item];
  } catch (error) {
    return {
      ok: false,
      reason: `this runtime has no storage entry "${pallet}.${item}" (${String(error)})`,
    };
  }
  if (!isStorageCodec(candidate)) {
    // Reached when the surface *returns* rather than throws — a plain object, a future
    // PAPI, or a test double. It is no longer the expected path, which is why the throw
    // above is handled first, and it is a real check rather than a cast: something that
    // is not a codec cannot decode, and saying so beats calling `.dec` on it.
    return { ok: false, reason: `this runtime has no storage entry "${pallet}.${item}"` };
  }
  try {
    return { ok: true, value: candidate.value.dec(raw) as T };
  } catch (error) {
    // The message, not the stack: it reaches a user through `Undecodable`, beside the raw
    // bytes. `String(error)` rather than `error.message` because a thrown non-Error has no
    // `.message` and would render as `undefined`, which says nothing at all.
    return { ok: false, reason: String(error) };
  }
}

/**
 * A decoder bound to one storage item.
 *
 * Curried so the read layers can hold `(raw) => DecodeResult<T>` and stay ignorant of the
 * codec surface — which is what lets them be tested with a two-line stub, and what keeps
 * the chain SDK out of every package above this one.
 */
export function storageDecoder<T>(
  codecs: ChainCodecs,
  pallet: string,
  item: string,
): (raw: string) => DecodeResult<T> {
  return (raw) => decodeStorage<T>(codecs, pallet, item, raw);
}

/**
 * Look one runtime API's codec pair up, or say why it is not there.
 *
 * The lookup is inside the `try` for {@link decodeStorage}'s measured reason: PAPI's `apis`
 * surface is a **Proxy that throws** on a name the runtime does not declare —
 * `codecs.apis.NoSuchApi.foo` raises *"Runtime entry Runtime API(NoSuchApi.foo) not found"*
 * rather than yielding `undefined`, so an `=== undefined` guard around it is dead code.
 */
function apiCodec(
  codecs: ChainApiCodecs,
  api: string,
  method: string,
): { readonly ok: true; readonly codec: ApiCodec } | { readonly ok: false; readonly reason: string } {
  let candidate: unknown;
  try {
    candidate = (codecs.apis as Record<string, Record<string, unknown>>)[api]?.[method];
  } catch (error) {
    return {
      ok: false,
      reason: `this runtime has no runtime-API method "${api}.${method}" (${String(error)})`,
    };
  }
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, reason: `this runtime has no runtime-API method "${api}.${method}"` };
  }
  const value: unknown = (candidate as { value?: unknown }).value;
  const args: unknown = (candidate as { args?: unknown }).args;
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { dec?: unknown }).dec !== 'function' ||
    typeof args !== 'object' ||
    args === null ||
    typeof (args as { enc?: unknown }).enc !== 'function'
  ) {
    return {
      ok: false,
      reason: `"${api}.${method}" does not expose the argument and result codecs this client builds against`,
    };
  }
  return { ok: true, codec: candidate as ApiCodec };
}

/**
 * Decode one runtime-API result, naming the method in any failure.
 *
 * The complement of {@link decodeStorage}, and it exists for the same reason: a screen that
 * reads `quote()` or `account_positions()` receives an opaque hex string from
 * `FinalizedReader`, and only the chain's own codecs can say what is in it. A decode failure
 * is a **value** here too (INV-FE-12) — a thrown error would be caught somewhere above and
 * turned into an empty list, which on a positions screen is *this account holds nothing*.
 *
 * The API and the method stay separate arguments rather than a dotted string, per
 * {@link decodeStorage}: a name assembled by concatenation can silently mean something else.
 */
export function decodeApiResult<T>(
  codecs: ChainApiCodecs,
  api: string,
  method: string,
  raw: string,
): DecodeResult<T> {
  const found = apiCodec(codecs, api, method);
  if (!found.ok) return { ok: false, reason: found.reason };
  try {
    return { ok: true, value: found.codec.value.dec(raw) as T };
  } catch (error) {
    // Measured: PAPI's result codecs throw `RangeError: Offset is outside the bounds of the
    // DataView` on short bytes. The message reaches a user through `Undecodable`, beside the
    // raw hex, so it is carried rather than replaced.
    return { ok: false, reason: String(error) };
  }
}

/** A decoder bound to one runtime-API method. The `apis` twin of {@link storageDecoder}. */
export function apiDecoder<T>(
  codecs: ChainApiCodecs,
  api: string,
  method: string,
): (raw: string) => DecodeResult<T> {
  return (raw) => decodeApiResult<T>(codecs, api, method, raw);
}

/**
 * The SCALE encoding of one runtime-API method's arguments, as `0x` hex.
 *
 * Hex rather than the `Uint8Array` PAPI returns, because that is what
 * `FinalizedReader.call`/`crossCheckedCall` take — and a conversion left at each call site is
 * a conversion each call site can get wrong.
 *
 * **This throws rather than returning a result, and the asymmetry with the decoders above is
 * deliberate.** A decode failure describes the chain: bytes arrived and could not be read,
 * which is a state a screen renders. An encode failure describes *this client*: it was asked
 * for the arguments of a call it is about to make and cannot build them, and there is nothing
 * to render because no read has happened. Returning a result would invite a caller to fall
 * back to `'0x'`, which is a **valid encoding of no arguments** — so a runtime API taking one
 * would be asked about whatever the empty argument list decodes to and would answer.
 */
export function apiArgs(
  codecs: ChainApiCodecs,
  api: string,
  method: string,
): (values: readonly unknown[]) => string {
  return (values) => {
    const found = apiCodec(codecs, api, method);
    if (!found.ok) throw new Error(found.reason);
    let encoded: Uint8Array;
    try {
      encoded = found.codec.args.enc(values);
    } catch (error) {
      throw new Error(
        `the arguments of "${api}.${method}" could not be encoded: ${String(error)}. This ` +
          'client would otherwise ask the runtime a different question and receive a valid ' +
          'answer to it.',
      );
    }
    let out = '0x';
    for (const byte of encoded) out += byte.toString(16).padStart(2, '0');
    return out;
  };
}
