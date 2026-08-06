/**
 * `storageKeyBuilder` — the composition-root half of key construction (F18, 02 §7).
 *
 * `storageKey` takes pre-encoded bytes and a named hasher per position. Something has to
 * produce both, and neither artifact this client ships can do it alone:
 *
 *  - **metadata** carries the hashers and nothing that can encode a value;
 *  - **the descriptors** carry codecs and no hasher at all — `getTypedCodecs` returns
 *    `{value, args}` per storage entry, measured, with the hasher dropped at generation.
 *
 * So the builder takes both and requires them to **agree on the key arity** before building
 * anything. That cross-check is the whole safety argument, because the codec side is a
 * `@polkadot-api/substrate-bindings` internal (`args.inner`) with no compatibility promise.
 *
 * ## What this suite proves, and against what
 *
 * The oracle is `runtime/bleavit-runtime/fixtures/storage-keys.json` — written by the
 * runtime's own `hashed_key_for` and read **in place**. For every entry, the pre-image the
 * *runtime* published is decoded with PAPI's position codec, fed back through the builder as
 * a typed value, and the resulting key compared against the key the *runtime* published.
 * Two independent producers, meeting on a value neither invented.
 *
 * A wrong storage key does not fail — it returns no value, which is indistinguishable from
 * an account holding nothing. That is why the arity check refuses rather than degrading: a
 * short key is a map *prefix*, and `descendantsValues` answers a prefix with the whole map.
 * Not a missing balance — everybody's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { bleavit, assethub_paseo } from '@polkadot-api/descriptors';
import {
  KeyArityError,
  KeyCodecUnavailableError,
  UnknownHasherTagError,
  UnknownStorageItemError,
  loadCodecs,
  loadMetadata,
  storageHashers,
  storageKeyBuilder,
  storagePrefix,
} from '@bleavit/chain-client';
import type { ChainMetadata, StorageHasher } from '@bleavit/chain-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..');
/** Read in place. A copied expectation is one a regeneration cannot correct. */
const RUNTIME_FIXTURE = join(
  APP,
  '..',
  'runtime',
  'bleavit-runtime',
  'fixtures',
  'storage-keys.json',
);
const LOCAL_METADATA = join(APP, 'fixtures', 'chain-feed', '2', 'metadata.scale');
const ASSET_HUB_METADATA = join(
  APP,
  'fixtures',
  'foreign-chain-feed',
  'asset-hub-paseo',
  '2004002',
  'metadata.scale',
);

interface RuntimeEntry {
  readonly name: string;
  readonly pallet: string;
  readonly item: string;
  readonly hashers: readonly StorageHasher[];
  readonly preimages: readonly string[];
  readonly key: string;
}

const fixture = JSON.parse(readFileSync(RUNTIME_FIXTURE, 'utf8')) as {
  readonly schema: string;
  readonly entries: readonly RuntimeEntry[];
};
assert.equal(fixture.schema, 'bleavit.storage-keys.v1');

const localMetadata = loadMetadata(readFileSync(LOCAL_METADATA));
const assetHubMetadata = loadMetadata(readFileSync(ASSET_HUB_METADATA));
// Through `loadCodecs`, not `getTypedCodecs` directly: `polkadot-api` is not a declared
// dependency of this suite, and an import that resolves only by pnpm hoisting is one that
// breaks on an unrelated dependency change. `chain-client` is the package permitted to name
// the chain SDK (10 §10.1, app-code rule 13), and the rest of this suite already goes
// through it.
const localCodecs = await loadCodecs(bleavit);
const assetHubCodecs = await loadCodecs(assethub_paseo);

/**
 * PAPI's per-position key codecs, reached the same way the builder reaches them.
 *
 * The suite needs them to turn the runtime's published pre-image back into a typed value —
 * the only way to drive the builder's real input path with data it did not invent.
 */
function positionCodecs(
  codecs: unknown,
  pallet: string,
  item: string,
): readonly { enc(value: unknown): Uint8Array; dec(raw: string): unknown }[] {
  const entry = (codecs as { query: Record<string, Record<string, unknown>> }).query[pallet]?.[
    item
  ];
  const inner = (entry as { args?: { inner?: unknown } } | undefined)?.args?.inner;
  assert.ok(Array.isArray(inner), `${pallet}.${item} has no args.inner`);
  return inner as readonly { enc(value: unknown): Uint8Array; dec(raw: string): unknown }[];
}

test('the builder reproduces every key the runtime itself published', () => {
  assert.ok(fixture.entries.length >= 11, 'the fixture shrank; re-read it before trusting this');
  for (const entry of fixture.entries) {
    const builder = storageKeyBuilder(localCodecs, localMetadata, entry.pallet, entry.item);
    assert.equal(builder.arity, entry.hashers.length, `${entry.name}: arity`);
    assert.deepEqual([...builder.hashers], [...entry.hashers], `${entry.name}: hashers`);

    // Decode the RUNTIME's pre-image into a typed value, then hand that value to the
    // builder. This is the production path — a caller supplies values, not bytes — driven
    // by data written on the other side of the language boundary.
    const codecs = positionCodecs(localCodecs, entry.pallet, entry.item);
    const values = entry.preimages.map((preimage, position) => codecs[position]!.dec(preimage));

    assert.equal(builder.key(values).toLowerCase(), entry.key.toLowerCase(), entry.name);
  }
});

test('a plain item builds exactly its 32-byte prefix, and that is its whole key', () => {
  const builder = storageKeyBuilder(localCodecs, localMetadata, 'Constitution', 'PhaseFlags');
  assert.equal(builder.arity, 0);
  assert.deepEqual([...builder.hashers], []);
  assert.equal(builder.key([]), storagePrefix('Constitution', 'PhaseFlags'));
  assert.equal((builder.key([]).length - 2) / 2, 32);
});

test('the tuple-key map and the double map are told apart — the distinction doc 02 hides', () => {
  // Doc 02 §7 writes both as `(A, B) -> V`. `Welfare.Snapshots` hashes ONE encoded tuple;
  // `ConditionalLedger.Positions` hashes TWO values separately. A caller that confused them
  // would build a well-formed key belonging to nobody.
  const snapshots = storageKeyBuilder(localCodecs, localMetadata, 'Welfare', 'Snapshots');
  const positions = storageKeyBuilder(localCodecs, localMetadata, 'ConditionalLedger', 'Positions');
  assert.equal(snapshots.arity, 1, 'Welfare.Snapshots is a single map over a tuple key');
  assert.equal(positions.arity, 2, 'ConditionalLedger.Positions is a double map');

  // And the confusion is refused rather than encoded: the tuple-key map takes one value.
  assert.throws(() => snapshots.key([1, 2]), KeyArityError);
  assert.throws(() => positions.key([1]), KeyArityError);
});

test('the two ledger instances share a key shape and never a prefix', () => {
  const primary = storageKeyBuilder(localCodecs, localMetadata, 'ConditionalLedger', 'Positions');
  const service = storageKeyBuilder(localCodecs, localMetadata, 'ServiceLedger', 'Positions');
  assert.deepEqual([...primary.hashers], [...service.hashers]);
  assert.notEqual(
    primary.prefix,
    service.prefix,
    'a shared prefix would merge two ledger domains (11 §11.2a, I-4 holds per instance)',
  );
});

test('an absent storage item is refused, never read as a plain value', () => {
  // The dangerous default. A plain item has zero hashers, so treating an absent item as
  // plain would build a 32-byte prefix for a typo — which the node answers with a map.
  assert.throws(
    () => storageKeyBuilder(localCodecs, localMetadata, 'Constitution', 'PhaseFlagz'),
    UnknownStorageItemError,
  );
  assert.throws(
    () => storageKeyBuilder(localCodecs, localMetadata, 'NotAPallet', 'Account'),
    UnknownStorageItemError,
  );
});

test('an unrecognised hasher tag is refused rather than defaulted', () => {
  const forged: ChainMetadata = {
    lookup: [],
    outerEnums: { event: 0 },
    pallets: [
      {
        name: 'Fake',
        storage: {
          items: [{ name: 'Item', type: { tag: 'map', value: { hashers: [{ tag: 'Blake2_256' }] } } }],
        },
      },
    ],
  };
  assert.throws(() => storageHashers(forged, 'Fake', 'Item'), UnknownHasherTagError);
});

test('metadata and codecs must AGREE on arity — neither is presumed right', () => {
  // The check that makes building on `args.inner` safe rather than merely convenient. If a
  // polkadot-api bump reshaped `inner`, this is what fails instead of a short key shipping.
  const oneHasherTooMany: ChainMetadata = {
    lookup: [],
    outerEnums: { event: 0 },
    pallets: [
      {
        name: 'System',
        storage: {
          items: [
            {
              name: 'Account',
              type: {
                tag: 'map',
                value: { hashers: [{ tag: 'Blake2128Concat' }, { tag: 'Blake2128Concat' }] },
              },
            },
          ],
        },
      },
    ],
  };
  assert.throws(
    () => storageKeyBuilder(assetHubCodecs, oneHasherTooMany, 'System', 'Account'),
    KeyArityError,
    'System.Account is a single map; metadata claiming two must not be believed silently',
  );
});

test('a codec surface without per-position codecs is refused, not worked around', () => {
  assert.throws(
    () => storageKeyBuilder({ query: { System: { Account: {} } } }, assetHubMetadata, 'System', 'Account'),
    KeyCodecUnavailableError,
  );
});

test('an unencodable key value names the surface and the position', () => {
  const builder = storageKeyBuilder(assetHubCodecs, assetHubMetadata, 'System', 'Account');
  // PAPI's own message for this is `Invalid checksum`, with no hint of which read it was
  // for. A key-construction failure that cannot be located is one that gets misdiagnosed as
  // a library bug.
  assert.throws(
    () => builder.key(['not-an-address']),
    (error: Error) =>
      error.message.includes('System.Account') &&
      error.message.includes('position 0') &&
      error.message.includes('checksum'),
  );
});

test('an SS58 address that is VALID but not 32 bytes is refused', () => {
  // A distinct case from the one above, and the reason it is spelled out: SS58 admits public
  // keys of 1, 2, 4, 8, 20, 32 and 33 bytes, so a 20-byte (Ethereum-shaped) address is a
  // perfectly valid address that is not an `AccountId32`. Hashed into `System.Account` it
  // yields a well-formed key that returns no value — "this account holds nothing".
  //
  // The address below is generated, not found: prefix 42 over the 20-byte key 01..14, with
  // a real 2-byte blake2b checksum. `getSs58AddressInfo` reports `isValid: true`.
  //
  // The assertion is on `Invalid public key length` **specifically**, because that is what
  // makes this test prove what it claims: an address that was merely malformed would throw
  // `Invalid checksum` instead, and a weaker assertion would pass on it — which is exactly
  // how the first version of this test passed while testing nothing.
  const builder = storageKeyBuilder(assetHubCodecs, assetHubMetadata, 'System', 'Account');
  assert.throws(
    () => builder.key(['sKV7YV4Lvt5VjzHhF9TwcEEaEbCjLfP']),
    (error: Error) =>
      error.message.includes('System.Account') &&
      error.message.includes('position 0') &&
      error.message.includes('Invalid public key length'),
  );
});

test('metadata and codecs agree on arity for EVERY storage item on both chains', () => {
  // The measurement the builder's safety rests on, run as a gate rather than quoted from a
  // session note. A spot check would not have covered `Welfare.Snapshots`, which is exactly
  // the case where a logical-argument count and a hashed-position count differ.
  for (const [label, codecs, metadata] of [
    ['bleavit', localCodecs, localMetadata],
    ['assethub_paseo', assetHubCodecs, assetHubMetadata],
  ] as const) {
    let checked = 0;
    for (const pallet of metadata.pallets) {
      for (const item of pallet.storage?.items ?? []) {
        const builder = storageKeyBuilder(codecs, metadata, pallet.name, item.name);
        const inner = positionCodecs(codecs, pallet.name, item.name);
        assert.equal(
          builder.arity,
          inner.length,
          `${label}: ${pallet.name}.${item.name} arity disagrees`,
        );
        checked += 1;
      }
    }
    // Anti-vacuity: a metadata that decoded to nothing would pass the loop above in silence.
    assert.ok(checked > 300, `${label}: only ${checked} items checked; the metadata looks empty`);
  }
});
