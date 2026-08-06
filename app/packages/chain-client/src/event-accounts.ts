/**
 * Which accounts a decoded runtime event names — 10 §6.5, F8.
 *
 * `packages/local-index`'s ingest loop decides whether a block contains one of the user's
 * extrinsics by asking whether any event in it names a watched account. `IndexedEvent.accounts`
 * is the input to that decision, and nothing produced it: the loop received the list already
 * built. This is the producer.
 *
 * ## Why it cannot be a table, and why it cannot read values
 *
 * Two routes were considered and both are dead ends, measured rather than argued:
 *
 * **A hand-written table cannot be derived from doc 02 §6.** That section freezes event
 * *names* and gives field lists only for the events it bolds — 31 of the ingest set carry no
 * field list at all, and `pallet-market`/`pallet-oracle` delegate wholly to the §5 and §7.2
 * tables. A §6-only account table cannot be written; it would fail halfway through the read.
 *
 * **A value-driven walk cannot work either.** PAPI decodes `AccountId32` to a plain **SS58
 * string**, so a walk over a decoded event cannot tell an account from any other string field —
 * a justification hash rendered as text, a metadata symbol, a chain name.
 *
 * So the discrimination comes from **metadata type ids**, which is also the only version that
 * cannot drift from the runtime: the id is resolved from the blob, and the walk descends the
 * declared type tree alongside the decoded value. It handles the collection cases a table gets
 * wrong for free — `Attestor.MembersSet` carries `Vec<T::AccountId>` and `RecallEnacted` a
 * `BoundedVec`, and neither is a special case here.
 *
 * ## Both failure directions are silent, which is why this fails loudly
 *
 * Attribute too narrowly and the user's history is quietly incomplete — the worst shape,
 * because a filtered history and an empty one look identical on screen. Attribute too broadly
 * and §6.5's cost claim (*"proportional to the user's own activity, not chain activity"*)
 * becomes false: a body fetch for every block the chain produces, on a light client, on a
 * phone.
 *
 * Neither shows up as an error, so every shape surprise here **throws** rather than returning
 * what it managed to collect. A partial account list is precisely the silent narrow failure.
 */

import { getSs58AddressInfo } from '@polkadot-api/substrate-bindings';
import type { ChainMetadata } from './metadata.js';

/** The path FRAME gives the account type. One type, one id — asserted, not assumed. */
const ACCOUNT_PATH = 'sp_core::crypto::AccountId32';

declare const accountKeyBrand: unique symbol;

/**
 * An account in the one form that cannot silently mismatch: its 32-byte public key, `0x` hex.
 *
 * **SS58 is not that form, and the difference is total.** PAPI decodes `AccountId32` to an
 * SS58 string *in the chain's own prefix* — measured: Alice, supplied to the encoder as the
 * generic-format `5Grwva…` (prefix 42), comes back out of the decoder as `fvJdNW3p…` (prefix
 * **22622**, this chain's). Same public key, and the two strings share nothing.
 *
 * That matters because the ingest loop's decision is `watched.has(account)` — a string
 * comparison. A watched set built from addresses a user pasted, or from another chain's
 * rendering, would match **nothing, ever**, and the symptom is an empty transaction history:
 * indistinguishable from a user who has never transacted, which is 10 §6.5's silent-narrow
 * failure in its purest form. Nothing errors, nothing logs, the app looks fine.
 *
 * So accounts leave this module as public keys, which is what `packages/local-index` already
 * compares against, and the brand keeps an SS58 string from being passed where one is due.
 */
export type AccountKey = string & { readonly [accountKeyBrand]: true };

/**
 * How deep the walker will descend before refusing.
 *
 * Not a performance guard: the walk is bounded by the decoded value, which is finite. It is a
 * shape guard — a runtime whose event nesting exceeds this is one whose shape assumptions here
 * deserve re-reading rather than a silently truncated account list. Measured headroom: the
 * deepest account in this runtime's event set sits at depth 6.
 */
const MAX_DEPTH = 32;

export class EventAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventAccountError';
  }
}

/**
 * An SS58 address as an {@link AccountKey} — the one place the conversion happens.
 *
 * Exported so a **watched set** is built through the same function the extractor uses. Two
 * conversions written separately is how a prefix mismatch survives review: both look right,
 * and the failure they produce is an empty history rather than an error.
 *
 * Refuses a valid address whose public key is not 32 bytes. `getSs58AddressInfo` reports
 * `isValid: true` for 20-byte (Ethereum-shaped) and 33-byte keys — they are valid SS58
 * addresses, just not `AccountId32`s — so *"check isValid, take publicKey"* would produce a
 * key that can never equal anything the chain emits, silently (V-163's shape, reached here
 * from the watched-set side rather than the storage-key side).
 */
export function accountKey(address: string): AccountKey {
  const info = getSs58AddressInfo(address);
  if (!info.isValid) {
    throw new EventAccountError(`"${address}" is not a valid SS58 address`);
  }
  if (info.publicKey.length !== 32) {
    throw new EventAccountError(
      `"${address}" is a valid SS58 address whose public key is ${info.publicKey.length} bytes, ` +
        'not 32. It is not an AccountId32, so no event on this chain can ever name it — which ' +
        'would present as an empty history rather than as an error.',
    );
  }
  let hex = '0x';
  for (const byte of info.publicKey) hex += byte.toString(16).padStart(2, '0');
  return hex as AccountKey;
}

/** A metadata type as `unifyMetadata` publishes it, reduced to what the walk needs. */
interface LookupType {
  readonly id: number;
  readonly path: readonly string[];
  readonly def:
    | { readonly tag: 'composite'; readonly value: readonly Field[] }
    | { readonly tag: 'variant'; readonly value: readonly Variant[] }
    | { readonly tag: 'sequence'; readonly value: number }
    | { readonly tag: 'array'; readonly value: { readonly len: number; readonly type: number } }
    | { readonly tag: 'tuple'; readonly value: readonly number[] }
    | { readonly tag: 'primitive'; readonly value: string }
    | { readonly tag: 'compact'; readonly value: number }
    | { readonly tag: string; readonly value: unknown };
}

interface Field {
  readonly name?: string | undefined;
  readonly type: number;
}

interface Variant {
  readonly name: string;
  readonly fields: readonly Field[];
  readonly index: number;
}


/**
 * A reader bound to one chain's metadata.
 *
 * Built once so the type-id resolution and its uniqueness check happen at composition time —
 * a runtime this client cannot read accounts out of should fail while the app is wiring
 * itself up, not on the first block of a backfill.
 */
export interface EventAccountReader {
  /** The resolved `AccountId32` type id. Exposed so a suite can assert it was resolved at all. */
  readonly accountTypeId: number;
  /** The outer `RuntimeEvent` type id this reader walks from. */
  readonly eventTypeId: number;
  /**
   * Every account a decoded outer runtime event names, deduplicated, in encounter order.
   *
   * Takes the **outer** event (`{type: 'Balances', value: {type: 'Transfer', value: {…}}}`)
   * rather than a pallet event, because that is the shape `System.Events` decodes to and
   * re-wrapping at the call site is a chance to wrap it as the wrong pallet.
   *
   * Returns {@link AccountKey}s, never the SS58 strings PAPI decoded — see the type.
   */
  accounts(event: unknown): readonly AccountKey[];
}

/**
 * The lookup, checked to be a list of typed entries rather than asserted to be one.
 *
 * `ChainMetadata.lookup` is `readonly unknown[]`: the element shape is the SDK's tagged union
 * and this is where it gets narrowed. An entry that does not carry a numeric `id`, a `path`
 * array and a tagged `def` is refused — a `lookup` this walker cannot read is one it must not
 * silently return no accounts from, since that reads as "no block concerns this user" forever.
 */
function lookupTypes(metadata: ChainMetadata): LookupType[] {
  if (metadata.lookup.length === 0 || typeof metadata.outerEnums?.event !== 'number') {
    throw new EventAccountError(
      'this metadata carries no `lookup` entries and `outerEnums.event`, so no event type tree ' +
        'can be walked. Refusing rather than returning no accounts, which would read as ' +
        '"this block concerns nobody" for every block on the chain.',
    );
  }
  return metadata.lookup.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new EventAccountError(`metadata lookup entry ${i} is not a type record`);
    }
    const { id, path, def } = entry as { id?: unknown; path?: unknown; def?: unknown };
    if (
      typeof id !== 'number' ||
      !Array.isArray(path) ||
      typeof def !== 'object' ||
      def === null ||
      typeof (def as { tag?: unknown }).tag !== 'string'
    ) {
      throw new EventAccountError(`metadata lookup entry ${i} is not shaped like a type record`);
    }
    return { id, path: path as readonly string[], def: def as LookupType['def'] };
  });
}

export function eventAccountReader(metadata: ChainMetadata): EventAccountReader {
  const lookup = lookupTypes(metadata);
  const byId = new Map<number, LookupType>();
  for (const type of lookup) byId.set(type.id, type);

  const accounts = lookup.filter((t) => t.path.join('::') === ACCOUNT_PATH);
  if (accounts.length !== 1) {
    // Zero means this runtime does not use `AccountId32` and every assumption below is void.
    // More than one means the id is ambiguous, and picking either would silently attribute
    // half the events. Neither is a state to guess through.
    throw new EventAccountError(
      `expected exactly one \`${ACCOUNT_PATH}\` type in this runtime's metadata, found ` +
        `${accounts.length}. Attribution cannot be resolved to a single type id.`,
    );
  }
  const accountTypeId = accounts[0]!.id;
  const eventTypeId = metadata.outerEnums.event;

  function resolve(id: number, where: string): LookupType {
    const type = byId.get(id);
    if (type === undefined) {
      throw new EventAccountError(`${where}: metadata has no type ${id}`);
    }
    return type;
  }

  /**
   * The decoded value for a field list, split per field.
   *
   * PAPI's composite/variant payload shape depends on the field list, and getting this wrong
   * is how an account goes missing: read a one-field newtype as an object and the descent
   * stops one level too early, silently.
   */
  function fieldValues(fields: readonly Field[], value: unknown, where: string): unknown[] {
    if (fields.length === 0) return [];
    const named = fields.every((f) => typeof f.name === 'string' && f.name.length > 0);
    if (named) {
      if (typeof value !== 'object' || value === null) {
        throw new EventAccountError(`${where}: expected a record for ${fields.length} named field(s)`);
      }
      const record = value as Record<string, unknown>;
      return fields.map((f) => record[f.name as string]);
    }
    // A single unnamed field is a newtype: PAPI yields the inner value directly, with no
    // wrapper. Treating it as a one-element array would look past the account inside it.
    if (fields.length === 1) return [value];
    if (!Array.isArray(value)) {
      throw new EventAccountError(`${where}: expected a tuple for ${fields.length} unnamed fields`);
    }
    return value as unknown[];
  }

  function walk(
    typeId: number,
    value: unknown,
    depth: number,
    where: string,
    out: AccountKey[],
  ): void {
    if (depth > MAX_DEPTH) {
      throw new EventAccountError(`${where}: event nesting exceeded ${MAX_DEPTH} levels`);
    }
    if (value === undefined || value === null) return;

    if (typeId === accountTypeId) {
      // The descent stops here even though `AccountId32` is a composite over `[u8; 32]`:
      // PAPI special-cases it and yields an SS58 string. Anything else means the decoder's
      // representation moved, and guessing at the new one is how a wrong account — or none —
      // enters the history.
      if (typeof value !== 'string') {
        throw new EventAccountError(
          `${where}: an AccountId32 decoded to ${typeof value}, not the expected SS58 string`,
        );
      }
      // Converted here, not at the call site: the SS58 string PAPI produced carries THIS
      // chain's prefix, and a watched set in any other rendering would match nothing.
      const key = accountKey(value);
      if (!out.includes(key)) out.push(key);
      return;
    }

    const type = resolve(typeId, where);
    switch (type.def.tag) {
      case 'composite': {
        const fields = type.def.value as readonly Field[];
        const values = fieldValues(fields, value, where);
        fields.forEach((f, i) => walk(f.type, values[i], depth + 1, `${where}.${f.name ?? i}`, out));
        return;
      }
      case 'variant': {
        const variants = type.def.value as readonly Variant[];
        if (typeof value !== 'object' || value === null) {
          throw new EventAccountError(`${where}: expected a tagged value for a variant type`);
        }
        const tag = (value as { type?: unknown }).type;
        if (typeof tag !== 'string') {
          // Reached for `Option`-shaped and unit-only enums in some PAPI versions. A variant
          // whose tag cannot be read cannot be descended, and descending the WRONG variant
          // would read fields that are not there — so stop, rather than try each one.
          return;
        }
        const variant = variants.find((v) => v.name === tag);
        if (variant === undefined) {
          throw new EventAccountError(
            `${where}: decoded variant "${tag}" is not declared by type ${typeId}; this event ` +
              'was decoded against different metadata than it is being attributed with',
          );
        }
        const inner = (value as { value?: unknown }).value;
        const values = fieldValues(variant.fields, inner, `${where}::${tag}`);
        variant.fields.forEach((f, i) =>
          walk(f.type, values[i], depth + 1, `${where}::${tag}.${f.name ?? i}`, out),
        );
        return;
      }
      case 'sequence': {
        // `Vec<T::AccountId>` and `BoundedVec<…>` both land here, which is why collections
        // need no special case: the element type is walked once per element.
        if (!Array.isArray(value)) return;
        const element = type.def.value as number;
        value.forEach((v, i) => walk(element, v, depth + 1, `${where}[${i}]`, out));
        return;
      }
      case 'array': {
        const { len, type: element } = type.def.value as { len: number; type: number };
        // A `[u8; 32]` decodes to a hex string, not an array — and it is never an account by
        // itself, since the account type id is caught above. Nothing to descend.
        if (!Array.isArray(value)) return;
        for (let i = 0; i < Math.min(len, value.length); i += 1) {
          walk(element, value[i], depth + 1, `${where}[${i}]`, out);
        }
        return;
      }
      case 'tuple': {
        const members = type.def.value as readonly number[];
        if (!Array.isArray(value)) return;
        members.forEach((m, i) => walk(m, value[i], depth + 1, `${where}.${i}`, out));
        return;
      }
      default:
        // `primitive` and `compact` are leaves, and an unknown tag is treated as one too —
        // deliberately, because the alternative is to invent a descent for a shape this
        // client has never seen. An unknown tag that DID contain an account would be a miss,
        // so the suite asserts the tag set is exactly the seven this runtime declares.
        return;
    }
  }

  return {
    accountTypeId,
    eventTypeId,
    accounts(event: unknown): readonly AccountKey[] {
      const out: AccountKey[] = [];
      walk(eventTypeId, event, 0, 'RuntimeEvent', out);
      return out;
    },
  };
}
