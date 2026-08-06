/**
 * Storage hashers, read from a chain's own metadata — 02 §7.
 *
 * ## Why this exists at all
 *
 * {@link storageKey} needs one hasher per key position, and **nothing else in this client
 * can supply it**. `getTypedCodecs(descriptors)` returns `{value, args}` per storage entry
 * and carries no hasher; the descriptors are generated from metadata with that field
 * dropped. So the hasher has exactly one source, and it is the metadata blob itself.
 *
 * Reading it from a *declaration* instead was tried and is the defect V-160 records: the
 * hasher set was derived from the hashers this repository's own pallets use, which misses
 * `Identity` — four items use it, three of them in `pallet_preimage`, and two of those are
 * frozen 02 §7.6 reads behind 11 §11.5's P-10 preconditions. The read surface is not this
 * repository's source tree. Ask the artifact.
 *
 * ## The spellings differ by one underscore
 *
 * Metadata tags the hasher `Blake2128Concat`. FRAME, and therefore
 * `runtime/bleavit-runtime/fixtures/storage-keys.json`, spells it `Blake2_128Concat`. This
 * module maps between them in one place so no caller has to remember which side it is on,
 * and an unrecognised tag is refused rather than defaulted — a defaulted hasher produces a
 * key that is well-formed and wrong, which the node answers with silence.
 */

import { decAnyMetadata, unifyMetadata } from '@polkadot-api/substrate-bindings';

/**
 * The hashers the 02 §7 read surface actually uses.
 *
 * Deliberately not every hasher FRAME defines. An unused name here would be untested
 * surface — and the failure mode of a storage hasher is silence, so untested is not a risk
 * this client can carry. Anything else is refused rather than guessed.
 *
 * **`Identity` was missing from the first version, and the way it was missing is the
 * point.** It was omitted after checking which hashers *this repository's pallets* declare —
 * `Blake2_128Concat` and `Twox64Concat`, and nothing else (V-160). But the read surface is
 * not this repository's pallets: counting hashers in the shipped `metadata.scale` gives 130
 * `Blake2128Concat`, 50 `Twox64Concat` and **4 `Identity`**, three of them in
 * `pallet_preimage` — and `Preimage.StatusFor` and `Preimage.PreimageFor` are frozen 02 §7.6
 * reads backing 11 §11.5's P-10 preconditions (*"the payload preimage is noted with a
 * matching hash and length"*, *"pinned and cannot be reaped"*). A client that cannot key
 * them cannot mirror two dispatch checks. So: ask the artifact, not the source tree.
 *
 * Note the spelling. Metadata tags it `Blake2128Concat`; FRAME and the Rust fixture spell it
 * `Blake2_128Concat`. {@link storageHashers} is the one place that maps between them.
 */
export type StorageHasher = 'Blake2_128Concat' | 'Twox64Concat' | 'Identity';

/**
 * A chain's decoded metadata.
 *
 * Deliberately **narrow rather than opaque**, and narrower than what `unifyMetadata` returns:
 * these are the three members this client reads, declared at the precision each consumer
 * needs. Naming the SDK's full type in an exported signature would publish a
 * `@polkadot-api/substrate-bindings` internal — one that has changed across minor versions —
 * to every caller.
 *
 * `lookup` is `readonly unknown[]` because its element shape is a tagged union the walker in
 * `event-accounts.ts` narrows as it descends; declaring a guessed shape here would put an
 * unchecked claim in the type system rather than a check in the code.
 *
 * The alternative — declaring only `pallets` and reaching the rest through `as unknown as` —
 * is banned across `app/` (app-code rule 2) and the `check:casts` gate caught the first draft
 * of this file doing exactly that, in eight places. The gate was right: a double assertion
 * here would have been a shape claim nothing could check.
 */
export interface ChainMetadata {
  readonly pallets: readonly UnifiedPallet[];
  readonly lookup: readonly unknown[];
  readonly outerEnums: { readonly event: number };
}

interface UnifiedPallet {
  readonly name: string;
  readonly storage?: { readonly items: readonly UnifiedItem[] } | undefined;
}

interface UnifiedItem {
  readonly name: string;
  readonly type:
    | { readonly tag: 'plain' }
    | { readonly tag: 'map'; readonly value: { readonly hashers: readonly { readonly tag: string }[] } };
}

/**
 * Metadata tag → the spelling FRAME and the runtime fixture use.
 *
 * Only the three this runtime's read surface actually uses, counted in the shipped
 * `metadata.scale`: 130 `Blake2128Concat`, 50 `Twox64Concat`, 4 `Identity`. A fourth tag
 * reaching {@link storageHashers} is refused there rather than added here speculatively —
 * an untested hasher whose failure mode is silence is not surface this client can carry.
 */
const TAGS: Readonly<Record<string, StorageHasher>> = Object.freeze({
  Blake2128Concat: 'Blake2_128Concat',
  Twox64Concat: 'Twox64Concat',
  Identity: 'Identity',
});

export class UnknownStorageItemError extends Error {
  constructor(pallet: string, item: string) {
    super(
      `this runtime's metadata declares no storage item "${pallet}.${item}". Refusing rather ` +
        'than treating it as a plain value: a plain value has zero hashers, so the absent ' +
        'item and a real one would build the same 32-byte prefix — which the node answers ' +
        'with the whole map rather than with an error.',
    );
    this.name = 'UnknownStorageItemError';
  }
}

export class UnknownHasherTagError extends Error {
  constructor(tag: string, pallet: string, item: string) {
    super(
      `"${pallet}.${item}" declares hasher "${tag}", which this client does not build keys ` +
        `for (it handles ${Object.keys(TAGS).join(', ')}). Refusing rather than guessing: a ` +
        'wrong hasher yields a well-formed key that returns no value, and no value is ' +
        'indistinguishable from an account holding nothing.',
    );
    this.name = 'UnknownHasherTagError';
  }
}

/**
 * Decode a metadata blob.
 *
 * Takes bytes rather than a source, because they arrive two ways that must not diverge: at
 * runtime from the chain itself, and in suites from the committed
 * `app/fixtures/chain-feed/<spec_version>/metadata.scale`. One decoder for both is what
 * makes the fixture-driven tests evidence about the production path.
 */
export function loadMetadata(raw: Uint8Array): ChainMetadata {
  // Both casts are into the SDK's own parameter types, and neither is `as unknown as`
  // (banned across `app/`, app-code rule 2). `decAnyMetadata` is typed for the metadata
  // union it knows; a foreign runtime's blob is the same bytes with a version this build's
  // type union may not name, which `check-foreign-feed.ts` already handles the same way.
  const any = decAnyMetadata(raw as Parameters<typeof decAnyMetadata>[0]);
  return unifyMetadata(any as Parameters<typeof unifyMetadata>[0]) as ChainMetadata;
}

/**
 * The hashers a storage item declares, in key order.
 *
 * A plain item yields `[]`, which is correct and is what makes {@link storageKey} return
 * exactly the 32-byte prefix for it. An **absent** item is an error rather than `[]`,
 * because those two are not the same thing and collapsing them is how a typo becomes a
 * whole-map read (see {@link UnknownStorageItemError}).
 */
export function storageHashers(
  metadata: ChainMetadata,
  pallet: string,
  item: string,
): readonly StorageHasher[] {
  const found = metadata.pallets
    .find((p) => p.name === pallet)
    ?.storage?.items.find((i) => i.name === item);
  if (found === undefined) throw new UnknownStorageItemError(pallet, item);
  if (found.type.tag === 'plain') return [];
  return found.type.value.hashers.map((h) => {
    const mapped = TAGS[h.tag];
    if (mapped === undefined) throw new UnknownHasherTagError(h.tag, pallet, item);
    return mapped;
  });
}
