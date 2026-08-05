/**
 * Typed SCALE decoding without a client — F7's last item.
 *
 * The suite drives the **real** codecs, built from the committed descriptors, with no node
 * and no network. That is the property under test as much as any assertion here: if
 * `getTypedCodecs` ever required a connection, this file stops passing rather than the
 * defect surfacing at boot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bleavit } from '@polkadot-api/descriptors';
import { decodeStorage, loadCodecs, storageDecoder } from '@bleavit/chain-client';
import type { ChainCodecs, DecodeResult } from '@bleavit/chain-client';

const codecs = await loadCodecs(bleavit);

/** PAPI's encode/decode pair for one storage item, as far as this suite needs it. */
interface ValueCodec {
  enc(value: unknown): string;
  dec(raw: string): unknown;
}

/**
 * Reach a storage codec by name, narrowing at runtime.
 *
 * `ChainCodecs.query` is `unknown` deliberately (see the comment on it in `codecs.ts`):
 * the lookup is by *string*, so no static type relates the argument to the result. This
 * suite therefore does the same runtime narrowing the module under test does, rather than
 * asserting a shape the compiler cannot check — and it throws rather than returning
 * `undefined`, so a missing codec is reported as itself instead of as a property access on
 * `undefined` three lines later.
 */
function valueCodec(surface: ChainCodecs, pallet: string, item: string): ValueCodec {
  const query = surface.query as Record<string, Record<string, unknown> | undefined>;
  const entry = query[pallet]?.[item] as { value?: unknown } | undefined;
  const value = entry?.value;
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { dec?: unknown }).dec !== 'function' ||
    typeof (value as { enc?: unknown }).enc !== 'function'
  ) {
    throw new Error(`${pallet}.${item} has no encode/decode pair on the codec surface`);
  }
  return value as ValueCodec;
}

/** The reason a decode refused, or a throw if it did not refuse at all. */
function refusal(result: DecodeResult<unknown>): string {
  assert.equal(result.ok, false, `expected a refusal, got ${JSON.stringify(result)}`);
  return result.reason;
}

test('codecs are built from descriptors alone — no client, no network', () => {
  assert.ok(codecs.query, 'the codec surface has no query group');
  assert.doesNotThrow(
    () => valueCodec(codecs, 'Constitution', 'PhaseFlags'),
    'a known storage item has no codec',
  );
});

test('a real storage value round-trips through the real codec', () => {
  // Encode with the codec's own encoder, then decode through the module under test. Using
  // the codec both ways is deliberate: this asserts the *wiring* — that `decodeStorage`
  // reaches the right codec and returns its value — and not that PAPI can encode, which is
  // PAPI's own business.
  const codec = valueCodec(codecs, 'Constitution', 'PhaseFlags');
  const encoded = codec.enc(codec.dec(codec.enc(0)));
  const result = decodeStorage(codecs, 'Constitution', 'PhaseFlags', encoded);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('an unknown storage entry is reported, not thrown', () => {
  // The codec surface is a **Proxy that throws** on an unknown name rather than returning
  // `undefined` — measured here, and it made the first version's two `=== undefined` guards
  // dead code. Both levels are exercised because both throw.
  for (const [pallet, item] of [
    ['NoSuchPallet', 'X'],
    ['Constitution', 'NoSuchItem'],
  ] as const) {
    const result = decodeStorage(codecs, pallet, item, '0x00');
    assert.equal(result.ok, false, `${pallet}.${item} decoded to something`);
    assert.match(result.reason, new RegExp(`no storage entry "${pallet}\\.${item}"`));
  }
});

test('a surface that returns undefined instead of throwing is handled too', () => {
  // A plain object, a future PAPI, or a test double. No longer the expected path, so it is
  // asserted separately rather than folded into the case above.
  const plain = { query: { P: {} } };
  const result = decodeStorage(plain, 'P', 'I', '0x00');
  assert.equal(result.ok, false);
  assert.match(result.reason, /no storage entry "P\.I"/);
});

test('malformed bytes come back as a reason, never as an exception', () => {
  // INV-FE-12 / app-code rule 10. A throw here would be caught somewhere up the stack and
  // turned into a zero — the guess the rule forbids, indistinguishable on screen from a
  // chain that really says zero.
  const result = decodeStorage(codecs, 'Constitution', 'PhaseFlags', '0x');
  assert.equal(result.ok, false, 'empty input decoded to something');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0, 'the failure carries no reason');
});

test('a thrown non-Error still produces a readable reason', () => {
  // `error.message` on a thrown string is `undefined`, which renders as the word
  // "undefined" beside the raw bytes and says nothing at all.
  const hostile = {
    query: { P: { I: { value: { dec() { throw 'a bare string'; } } } } },
  };
  const result = decodeStorage(hostile, 'P', 'I', '0x00');
  assert.equal(result.ok, false);
  assert.match(result.reason, /a bare string/);
});

test('storageDecoder binds one item and keeps the codec surface out of its caller', () => {
  const decode = storageDecoder(codecs, 'Constitution', 'PhaseFlags');
  assert.equal(typeof decode, 'function');
  assert.equal(decode.length, 1, 'the bound decoder takes anything but the raw bytes');
  assert.equal(decode('0x').ok, false);
});

test('the bound decoder really is bound to the item it was given', () => {
  // Mutation M50b survived the first version of the test above: it only asserted that
  // decoding `0x` fails, which is true of every storage item, so a decoder that ignored its
  // `item` argument and always read `PhaseFlags` passed. The binding is asserted here by
  // giving an item that does not exist and requiring the failure to name THAT item.
  const bound = storageDecoder(codecs, 'Constitution', 'DefinitelyNotAnItem');
  const result = bound('0x00');
  assert.equal(result.ok, false);
  assert.match(result.reason, /DefinitelyNotAnItem/);

  // And the pallet half, for the same reason.
  const otherPallet = storageDecoder(codecs, 'NotAPalletEither', 'PhaseFlags');
  assert.match(refusal(otherPallet('0x00')), /NotAPalletEither/);
});
