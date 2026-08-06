/**
 * S12/S13's composition root — the keys and decoders, built from two chains' own artifacts
 * (F18, 11 §11.9, 02 §7.4/§7.7).
 *
 * `funding-reads.ts` receives keys and decoders; this is what produces them. The suite drives
 * it with the **committed artifacts of both chains** — `fixtures/chain-feed/2/metadata.scale`
 * plus the Bleavit descriptors, and `fixtures/foreign-chain-feed/asset-hub-paseo/…` plus the
 * Asset Hub ones — so what is exercised is the production path, offline, with no node.
 *
 * ## The oracle is Rust, and the values are never typed here
 *
 * The expected local keys come from `runtime/bleavit-runtime/fixtures/storage-keys.json`,
 * written by the runtime's own `hashed_key_for` and read **in place**. The USDC Location and
 * the account are not written out in this file either — they are **decoded out of the
 * pre-images the runtime published**, then fed back through the builder as typed values. So
 * the inputs and the expectation come from the same producer, and neither was authored here.
 *
 * ## What a wrong key does, and why that shapes the tests
 *
 * It returns no value. An absent value is indistinguishable from an account holding nothing,
 * so the deposit screen renders **0 USDC** either way — and the near miss is worse, because a
 * key one hash short is a map *prefix*, which `descendantsValues` answers with the whole map.
 * Every assertion below is therefore against a full key from an independent producer, never
 * against a shape this file believes to be right.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { bleavit, assethub_paseo } from '@polkadot-api/descriptors';
import { UnknownStorageItemError, loadCodecs, loadMetadata } from '@bleavit/chain-client';
import { fundingDecoders, fundingKeys } from '@bleavit/features-tx';
import type { FundingChain } from '@bleavit/features-tx';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..');
/** Read in place — a copied expectation is one a regeneration cannot correct. */
const RUNTIME_FIXTURE = join(
  APP,
  '..',
  'runtime',
  'bleavit-runtime',
  'fixtures',
  'storage-keys.json',
);

interface RuntimeEntry {
  readonly name: string;
  readonly pallet: string;
  readonly item: string;
  readonly preimages: readonly string[];
  readonly key: string;
}

const fixture = JSON.parse(readFileSync(RUNTIME_FIXTURE, 'utf8')) as {
  readonly schema: string;
  readonly entries: readonly RuntimeEntry[];
};
assert.equal(fixture.schema, 'bleavit.storage-keys.v1');

const entry = (name: string): RuntimeEntry => {
  const found = fixture.entries.find((e) => e.name === name);
  assert.ok(found, `the runtime fixture no longer publishes "${name}"`);
  return found;
};

const local: FundingChain = {
  codecs: await loadCodecs(bleavit),
  metadata: loadMetadata(readFileSync(join(APP, 'fixtures', 'chain-feed', '2', 'metadata.scale'))),
};
const assetHub: FundingChain = {
  codecs: await loadCodecs(assethub_paseo),
  metadata: loadMetadata(
    readFileSync(
      join(APP, 'fixtures', 'foreign-chain-feed', 'asset-hub-paseo', '2004002', 'metadata.scale'),
    ),
  ),
};

/**
 * Decode one of the runtime's published pre-images back into a typed value.
 *
 * This is what keeps the test single-generator: the Location and the account it feeds the
 * builder are the runtime's own bytes, not a literal written here that could drift from them.
 */
function publishedValue(entryName: string, position: number): unknown {
  const e = entry(entryName);
  const item = (local.codecs as { query: Record<string, Record<string, unknown>> }).query[
    e.pallet
  ]?.[e.item];
  const inner = (item as { args?: { inner?: unknown } } | undefined)?.args?.inner;
  assert.ok(Array.isArray(inner), `${e.pallet}.${e.item} has no per-position codecs`);
  const codec = inner[position] as { dec(raw: string): unknown };
  return codec.dec(e.preimages[position]!);
}

const USDC_LOCATION = publishedValue('foreign_assets_account', 0);
const WHO = publishedValue('foreign_assets_account', 1) as string;

const keys = fundingKeys({ local, assetHub, usdcLocation: USDC_LOCATION });
const decoders = fundingDecoders({ local, assetHub });

test('the local USDC key is the one the runtime itself published', () => {
  // `ForeignAssets.Account(USDC_LOCATION, who)` — 02 §7.4, and the whole withdraw leg reads
  // through it. Built from a Location and an account this file decoded rather than typed.
  assert.equal(
    keys.localFreeUsdc(WHO).toLowerCase(),
    entry('foreign_assets_account').key.toLowerCase(),
  );
});

test('the phase-flags key is the runtime’s, and it is a bare 32-byte prefix', () => {
  const published = entry('constitution_phase_flags');
  assert.equal(keys.phaseFlags().toLowerCase(), published.key.toLowerCase());
  // A plain item's key IS its prefix. Asserted because the same 32 bytes used as a MAP key
  // would be answered with every entry in that map, and the two cases look identical here.
  assert.equal((keys.phaseFlags().length - 2) / 2, 32);
});

test('the account is taken from the runtime’s pre-image, not written here', () => {
  // Anti-vacuity for the two tests above: if `publishedValue` silently returned something
  // useless, `localFreeUsdc` would still have produced *a* key and the comparison would have
  // failed loudly — but a WHO of `undefined` would fail for the wrong reason. Pin the shape.
  assert.equal(typeof WHO, 'string');
  assert.ok(WHO.length > 40, 'the decoded account does not look like an SS58 address');
  assert.notEqual(USDC_LOCATION, undefined);
});

test('the Asset Hub keys are built on Asset Hub, at the shape §7.7 freezes', () => {
  const usdc = keys.assetHubUsdc(1337, WHO);
  // 32 (prefix) + 16+4 (Blake2_128Concat over a u32) + 16+32 (over an AccountId32) = 100.
  // Written as a sum rather than as `100` so a reader can see which part is which — and
  // because a key SHORT by one component is a prefix, which returns the whole map.
  assert.equal((usdc.length - 2) / 2, 32 + (16 + 4) + (16 + 32));

  const account = keys.assetHubAccount(WHO);
  assert.equal((account.length - 2) / 2, 32 + (16 + 32));

  // Different pallets, so different prefixes. A shared prefix would mean one of the two was
  // built against the wrong item and is reading the other's map.
  assert.notEqual(usdc.slice(0, 66), account.slice(0, 66));
});

test('the asset index reaches the key — the same `who` at two indices differs', () => {
  // `assetId` is a parameter with no default (02 §7.7 pins the Asset Hub of the relay each
  // release targets). If it were dropped on the floor, every asset would share one key and
  // the deposit screen would show a balance in the wrong asset.
  assert.notEqual(keys.assetHubUsdc(1337, WHO), keys.assetHubUsdc(1984, WHO));
});

test('a surface that exists on only one chain cannot be built from the other', () => {
  // Two of the four are structurally chain-bound: `Assets.Account` exists only on Asset Hub
  // and `Constitution.PhaseFlags` only here (measured against both metadata blobs). Swapping
  // the two chains is therefore a construction-time failure, not a wrong figure on screen.
  assert.throws(
    () => fundingKeys({ local: assetHub, assetHub: local, usdcLocation: USDC_LOCATION }),
    UnknownStorageItemError,
  );
});

test('the other two surfaces exist on BOTH chains — stated, because it bounds the test above', () => {
  // `System.Account` and `ForeignAssets.Account` are declared by both runtimes, so no
  // artifact check can catch a chain swap on those two — the builder would succeed and the
  // key would even come out the same. What catches a swap is `fundingReaders`, which refuses
  // two readers with the same chain identity at read time. The two controls are complements,
  // and claiming the construction check covers all four would be false.
  //
  // Asserted against the metadata rather than through `fundingKeys`, because `fundingKeys`
  // builds all four surfaces and would fail on the chain-bound ones first — which is what the
  // previous test is about, and would make this one pass for that reason instead of its own.
  const declares = (chain: FundingChain, pallet: string, item: string): boolean =>
    chain.metadata.pallets
      .find((p) => p.name === pallet)
      ?.storage?.items.some((i) => i.name === item) ?? false;

  for (const [pallet, item] of [
    ['System', 'Account'],
    ['ForeignAssets', 'Account'],
  ] as const) {
    assert.ok(declares(local, pallet, item), `local does not declare ${pallet}.${item}`);
    assert.ok(declares(assetHub, pallet, item), `assetHub does not declare ${pallet}.${item}`);
  }
  // And the two that ARE chain-bound, which is what makes the previous test's throw specific.
  assert.equal(declares(local, 'Assets', 'Account'), false);
  assert.equal(declares(assetHub, 'Constitution', 'PhaseFlags'), false);
});

test('an absent USDC Location refuses — it is never quietly defaulted', () => {
  // `usdcLocation` is typed `unknown`, which **includes** `undefined`, so a missing pin can
  // reach here even though the field is required. What must not happen is a fallback: a
  // defaulted Location builds a well-formed key for an entry nobody holds, and the withdraw
  // screen then renders a confident 0 USDC. A mutation sweep is why this test exists — adding
  // `?? { parents: 0, interior: 'Here' }` was the one change in this area the suite let pass.
  //
  // The complementary control is compile-time: `tests/firewall/fixtures/
  // funding-keys-without-a-usdc-location.ts` asserts the field cannot be omitted at all.
  const missing = fundingKeys({ local, assetHub, usdcLocation: undefined });
  assert.throws(
    () => missing.localFreeUsdc(WHO),
    (error: Error) => error.message.includes('ForeignAssets.Account'),
  );
});

test('the Asset Hub u32 is refused where the XCM Location belongs (02 §7.7)', () => {
  // X-11a: `ForeignAssets.Account` is keyed by the Location, NOT by the `1337` Asset Hub uses
  // for the same asset. Measured: the Location codec throws rather than encoding something,
  // so this confusion is loud. Pinned, because the failure mode of the alternative is silence.
  const wrong = fundingKeys({ local, assetHub, usdcLocation: 1337 });
  assert.throws(
    () => wrong.localFreeUsdc(WHO),
    (error: Error) =>
      error.message.includes('ForeignAssets.Account') && error.message.includes('position 0'),
  );
});

test('every decoder is bound to a real item on the chain it will read', () => {
  // A decoder bound to a missing item does not throw at construction — `storageDecoder`
  // returns a function that reports the failure per call — so the binding is checked by
  // decoding. Undecodable bytes must fail as *undecodable*, never as "this runtime has no
  // such entry", which is what a wrong-chain binding would say.
  //
  // The input is a single byte, and it took a failure to get right: `0xdeadbeef` is exactly
  // four bytes, so `Constitution.PhaseFlags` — a u32 — decoded it happily to 3735928559 and
  // the loop asserted the opposite. "Junk" is relative to the type, and this test needs bytes
  // too short for every one of the four.
  for (const [name, decode] of Object.entries(decoders)) {
    const result = decode('0x00');
    assert.equal(result.ok, false, `${name} decoded a single byte`);
    assert.ok(
      !result.reason.includes('has no storage entry'),
      `${name} is bound to an item its chain does not declare: ${result.reason}`,
    );
  }
});

test('phaseFlags decodes the bitset the recorder captured, and reads bit 4 (V-115)', () => {
  // The recorded value is `0x11000000` = 17. The defect this pins: `17 >= 4` is true and
  // `17 < 4` is false, so both numeric readings of a BITSET are wrong and neither errors —
  // one hides the sudo banner, the other skips D-13's caps.
  const decoded = decoders.phaseFlags('0x11000000');
  assert.ok(decoded.ok);
  assert.equal(decoded.value, 17);
  assert.equal((decoded.value & (1 << 4)) !== 0, true, 'bit 4 of 17 is set: sudo is present');
});

/* ------------------------------------------------- the narrows, driven through stub codecs */

/**
 * A chain whose codecs decode to whatever a test needs.
 *
 * The shape checks in `funding-composition.ts` are not exported, and every one of them
 * guards against a value a *real* codec cannot produce — a float out of a u32, a record
 * missing a field. Driving them through a stub is the only way to reach them, and a
 * mutation sweep found all three of them untested without it.
 *
 * `metadata` is the real one throughout: only `codecs` is stubbed, so the item names still
 * have to be right.
 */
function stubChain(decoded: Readonly<Record<string, unknown>>, real: FundingChain): FundingChain {
  const query: Record<string, Record<string, { value: { dec: () => unknown } }>> = {};
  for (const [qualified, value] of Object.entries(decoded)) {
    const [pallet, item] = qualified.split('.') as [string, string];
    query[pallet] ??= {};
    query[pallet][item] = { value: { dec: () => value } };
  }
  return { codecs: { query }, metadata: real.metadata };
}

test('a u32 that decoded to a float is not a bitset, and is refused (V-115)', () => {
  // `typeof value === 'number'` accepts 1.5, and `1.5 & (1 << 4)` is 0 — so a weakened check
  // does not error, it silently reports "sudo absent" and skips D-13's caps. That is V-115's
  // unsafe direction exactly, reached from a different starting point.
  const chain = stubChain({ 'Constitution.PhaseFlags': 1.5 }, local);
  const result = fundingDecoders({ local: chain, assetHub }).phaseFlags('0x00');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /integer/);
});

test('an account kept alive by a SUFFICIENT asset is viable — USDC is one (11 §11.9.1)', () => {
  // The mutation this pins: reading viability off `providers` alone. A user holding only
  // USDC on Asset Hub has `providers: 0` and `sufficients: 1` — which is precisely the user
  // the deposit screen exists for, and a providers-only reading would block them while
  // reporting a healthy-looking precondition failure.
  const viable = fundingDecoders({
    local,
    assetHub: stubChain({ 'System.Account': { providers: 0, sufficients: 1 } }, assetHub),
  }).systemAccount('0x00');
  assert.ok(viable.ok);
  assert.equal(viable.value?.viable, true, 'a sufficient-asset-only account is viable');

  const alsoViable = fundingDecoders({
    local,
    assetHub: stubChain({ 'System.Account': { providers: 1, sufficients: 0 } }, assetHub),
  }).systemAccount('0x00');
  assert.ok(alsoViable.ok);
  assert.equal(alsoViable.value?.viable, true, 'a provider reference is viability too');

  // And the complement, so the two above cannot pass by returning `true` unconditionally.
  const dead = fundingDecoders({
    local,
    assetHub: stubChain({ 'System.Account': { providers: 0, sufficients: 0 } }, assetHub),
  }).systemAccount('0x00');
  assert.ok(dead.ok);
  assert.equal(dead.value?.viable, false);
});

test('a System.Account missing its reference counts is undecodable, never "not viable"', () => {
  // INV-FE-12: an unestablished precondition is unestablished. Collapsing it to `false`
  // would render as a real, checked answer — and collapsing it to `true` would walk a user
  // to a signature the chain refuses.
  const chain = stubChain({ 'System.Account': { providers: 1 } }, assetHub);
  const result = fundingDecoders({ local, assetHub: chain }).systemAccount('0x00');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /providers.*sufficients|sufficients/);
});

test('a swapped chain pair is caught by the decoders too, on the surfaces that differ', () => {
  // `fundingKeys` refuses a swap outright. `fundingDecoders` cannot refuse at construction —
  // `storageDecoder` reports a missing item per call — so the swap surfaces on first use.
  //
  // Stated precisely, because the coverage is partial and claiming otherwise would be false:
  // this catches the swap through `phaseFlags` and `assetHubUsdc`, whose items exist on only
  // one chain each. It does NOT catch a `localFreeUsdc` bound to Asset Hub, because both
  // runtimes declare `ForeignAssets.Account` and — measured on the pinned pair — their
  // `AssetAccount` types are byte-identical, so either codec decodes the other's bytes. What
  // makes the split worth having anyway is that it is correct when they diverge, and the day
  // they diverge nothing else would notice.
  const swapped = fundingDecoders({ local: assetHub, assetHub: local });
  const flags = swapped.phaseFlags('0x11000000');
  assert.equal(flags.ok, false);
  assert.match(flags.ok ? '' : flags.reason, /has no storage entry/);

  const usdc = swapped.assetHubUsdc('0x00');
  assert.equal(usdc.ok, false);
  assert.match(usdc.ok ? '' : usdc.reason, /has no storage entry/);
});

test('a decoded asset account yields a bigint balance, and a bad shape is refused', () => {
  // `pallet-assets` account: balance u128, status, reason. Encoded here by hand from the
  // field widths rather than taken from a recording, because no fixture records a funded
  // USDC account — and the point is the SHAPE check, which must reject anything else.
  const balance = (1_234_567n).toString(16).padStart(32, '0');
  const le = (balance.match(/../g) ?? []).reverse().join('');
  const raw = `0x${le}0000`;
  const decoded = decoders.localFreeUsdc(raw);
  assert.ok(decoded.ok, `expected a decode, got: ${decoded.ok ? '' : decoded.reason}`);
  assert.equal(decoded.value?.balance, 1_234_567n);

  const short = decoders.localFreeUsdc('0x00');
  assert.equal(short.ok, false);
});
