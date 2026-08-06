/**
 * Per-event account extraction — 10 §6.5, F8.
 *
 * The ingest loop fetches a block's body only when an event in it names a watched account.
 * Both ways of getting that wrong are **silent**: attribute too narrowly and the history is
 * quietly incomplete (a filtered history and an empty one look identical), attribute too
 * broadly and §6.5's cost claim collapses into a body fetch per block, on a phone.
 *
 * ## The recorded corpus cannot be the oracle here, and that was measured
 *
 * `app/fixtures/chainhead/storage.system.events.json` decodes to **two** events, both
 * `System.ExtrinsicSuccess` — the recorder caught a block of inherents. It contains no
 * account-bearing event at all, so unlike the storage-key work there is nothing in it to
 * check an extraction against.
 *
 * So this suite uses two independent things instead:
 *
 * 1. **A round trip through PAPI's own codec.** Events are encoded with the runtime's
 *    `System.Events` codec from accounts chosen here, decoded back, and put through the
 *    extractor. The codec is not what is under test — the walker is — so this is fair.
 * 2. **A cross-check over every event variant in the runtime.** The walker's whole premise is
 *    *"an account is type id 1"*. That premise is checked against a **different** derivation:
 *    the `typeName` strings FRAME emits (`T::AccountId`, `Vec<T::AccountId>`). Two derivations
 *    from different inputs, agreeing across the entire event surface, is evidence a
 *    hand-written table could never produce.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { bleavit } from '@polkadot-api/descriptors';
import {
  EventAccountError,
  accountKey,
  eventAccountReader,
  loadCodecs,
  loadMetadata,
} from '@bleavit/chain-client';
import type { ChainMetadata } from '@bleavit/chain-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..');

const metadata = loadMetadata(readFileSync(join(APP, 'fixtures', 'chain-feed', '2', 'metadata.scale')));
const codecs = await loadCodecs(bleavit);
const reader = eventAccountReader(metadata);

/** Generic-format (prefix 42) addresses — deliberately NOT this chain's rendering. */
const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

interface EventCodec {
  enc(records: unknown): Uint8Array;
  dec(raw: string): { event: unknown }[];
}

const eventsCodec = (
  codecs as { query: Record<string, Record<string, { value: EventCodec }>> }
).query['System']!['Events']!.value;

/** Encode one event through the runtime's own codec, then decode it back. */
function roundTrip(event: unknown): unknown {
  const record = { phase: { type: 'ApplyExtrinsic', value: 0 }, event, topics: [] };
  const bytes = eventsCodec.enc([record]);
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return eventsCodec.dec(hex)[0]!.event;
}

test('the account type id is resolved from metadata and is unique', () => {
  // The walker's entire premise. If this stopped being one id, every extraction below would
  // still "work" and silently cover half the events.
  assert.equal(typeof reader.accountTypeId, 'number');
  // `lookup` is `readonly unknown[]` by design — its element shape is the SDK's tagged union,
  // narrowed where it is walked rather than asserted at the type boundary.
  const matching = (metadata.lookup as readonly { path: string[] }[]).filter(
    (t) => t.path.join('::') === 'sp_core::crypto::AccountId32',
  );
  assert.equal(matching.length, 1, 'account attribution is only well-defined for one type id');
});

test('both accounts of a Balances.Transfer are found', () => {
  const event = roundTrip({
    type: 'Balances',
    value: { type: 'Transfer', value: { from: ALICE, to: BOB, amount: 42n } },
  });
  assert.deepEqual([...reader.accounts(event)], [accountKey(ALICE), accountKey(BOB)]);
});

test('accounts come back as public keys, NOT as the SS58 string PAPI decoded', () => {
  // The defect this pins is total and silent. PAPI decodes `AccountId32` to SS58 in **this
  // chain's** prefix (7777, 02 §8), so an event naming Alice decodes to `fvJdNW3p…` while the same
  // key in generic format is `5Grwva…` — two strings with nothing in common. The ingest
  // decision is `watched.has(account)`, a string comparison, so a watched set in any other
  // rendering matches NOTHING and the user sees an empty history rather than an error.
  const event = roundTrip({
    type: 'Balances',
    value: { type: 'Transfer', value: { from: ALICE, to: BOB, amount: 1n } },
  });
  const [first] = reader.accounts(event);
  assert.ok(first !== undefined);
  assert.match(first, /^0x[0-9a-f]{64}$/, 'an account left this module in a renderable form');
  assert.notEqual(first, ALICE);

  // And the conversion is the same function on both sides, which is what makes the comparison
  // safe: a watched set built with `accountKey` matches what the extractor emits.
  assert.equal(first, accountKey(ALICE));
});

test('a Vec<T::AccountId> yields every element — collections are not a special case', () => {
  // `Attestor.MembersSet` carries `Vec<T::AccountId>`. A hand-written table gets exactly this
  // family wrong, because the field is one field and the accounts are many.
  const event = roundTrip({ type: 'Attestor', value: { type: 'MembersSet', value: { members: [ALICE, BOB] } } });
  assert.deepEqual([...reader.accounts(event)], [accountKey(ALICE), accountKey(BOB)]);
});

test('an event that names no account yields none — not an error, and not a hit', () => {
  // The recorded corpus is entirely this case, and it must stay distinguishable from "an
  // account the user does not watch": `attributedExtrinsics` branches on both.
  const event = roundTrip({
    type: 'System',
    value: {
      type: 'ExtrinsicSuccess',
      value: {
        dispatch_info: {
          weight: { ref_time: 1n, proof_size: 0n },
          class: { type: 'Normal' },
          pays_fee: { type: 'Yes' },
        },
      },
    },
  });
  assert.deepEqual([...reader.accounts(event)], []);
});

test('the same account twice in one event is reported once', () => {
  // A self-transfer, and the reason it matters is the cost claim: six events naming the user
  // in one extrinsic must produce one decode, not six.
  const event = roundTrip({
    type: 'Balances',
    value: { type: 'Transfer', value: { from: ALICE, to: ALICE, amount: 7n } },
  });
  assert.deepEqual([...reader.accounts(event)], [accountKey(ALICE)]);
});

test('THE CROSS-CHECK: type-id reachability agrees with FRAME’s own typeName, everywhere', () => {
  // The walker says "an account is type id 1". This checks that claim against a completely
  // different source — the `typeName` text FRAME emits into metadata — across every event
  // variant the runtime declares. Neither derivation is the other's oracle; agreement across
  // hundreds of variants is the evidence.
  interface Ty {
    id: number;
    path: string[];
    def: { tag: string; value: unknown };
  }
  const lookup = metadata.lookup as readonly Ty[];
  const byId = new Map(lookup.map((t) => [t.id, t]));
  const accountId = reader.accountTypeId;

  const reaches = new Map<number, boolean>();
  function reachesAccount(id: number, seen: Set<number>): boolean {
    if (id === accountId) return true;
    const cached = reaches.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return false; // a recursive type contributes nothing new
    seen.add(id);
    const t = byId.get(id);
    let found = false;
    if (t !== undefined) {
      const d = t.def;
      if (d.tag === 'composite') {
        found = (d.value as { type: number }[]).some((f) => reachesAccount(f.type, seen));
      } else if (d.tag === 'variant') {
        found = (d.value as { fields: { type: number }[] }[]).some((v) =>
          v.fields.some((f) => reachesAccount(f.type, seen)),
        );
      } else if (d.tag === 'sequence') {
        found = reachesAccount(d.value as number, seen);
      } else if (d.tag === 'array') {
        found = reachesAccount((d.value as { type: number }).type, seen);
      } else if (d.tag === 'tuple') {
        found = (d.value as number[]).some((m) => reachesAccount(m, seen));
      }
    }
    if (seen.size === 1) reaches.set(id, found);
    return found;
  }

  const outer = byId.get(reader.eventTypeId);
  assert.ok(outer && outer.def.tag === 'variant');
  const pallets = (outer.def.value as { name: string; fields: { type: number }[] }[]).map((v) => ({
    pallet: v.name,
    typeId: v.fields[0]?.type,
  }));

  let variantsChecked = 0;
  const disagreements: string[] = [];
  for (const { pallet, typeId } of pallets) {
    if (typeId === undefined) continue;
    const t = byId.get(typeId);
    if (t === undefined || t.def.tag !== 'variant') continue;
    for (const variant of t.def.value as {
      name: string;
      fields: { name?: string; type: number; typeName?: string }[];
    }[]) {
      for (const field of variant.fields) {
        variantsChecked += 1;
        const byType = reachesAccount(field.type, new Set());
        // FRAME writes the Rust source type. `AccountId` covers `T::AccountId`,
        // `Vec<T::AccountId>`, `BoundedVec<T::AccountId, _>` and the aliases built on them.
        const byName = /AccountId/.test(field.typeName ?? '');
        if (byType !== byName) {
          disagreements.push(
            `${pallet}.${variant.name}.${field.name ?? '?'}: typeName=${String(field.typeName)} ` +
              `reachesAccountType=${byType}`,
          );
        }
      }
    }
  }

  // Anti-vacuity: a run that checked nothing would pass the loop in silence.
  assert.ok(variantsChecked > 200, `only ${variantsChecked} event fields checked`);

  // **The two directions are not symmetric, and the asymmetry is the finding.**
  //
  // A name-based table can only ever be a SUBSET, because FRAME writes the associated-type
  // name and a runtime is free to alias it. So:
  //
  //   * `typeName says AccountId` ⇒ reachable by type id — must hold absolutely. A failure
  //     here means the walker misses something even a hand-written table would catch.
  //   * reachable by type id but NOT named `AccountId` — these are the aliases, and they are
  //     exactly what a table misses. Pinned by name so a new one is surfaced.
  const missedByWalker = disagreements.filter((d) => d.endsWith('reachesAccountType=false'));
  assert.deepEqual(missedByWalker, [], 'a field FRAME names as an account is not reachable by type id');

  const aliases = disagreements.filter((d) => d.endsWith('reachesAccountType=true')).sort();
  assert.deepEqual(
    aliases,
    [
      'Session.ValidatorDisabled.validator: typeName=T::ValidatorId reachesAccountType=true',
      'Session.ValidatorReenabled.validator: typeName=T::ValidatorId reachesAccountType=true',
    ],
    'a new AccountId alias appeared in the event surface; confirm it really is an account',
  );
  // Verified against the runtime rather than inferred from the name: `configs.rs` declares
  // `type ValidatorId = AccountId` (twice, for both session pallets). So the walker is right
  // about these two and the name-based derivation is wrong — which is the whole argument for
  // taking the discrimination from type ids. Two real events, `Session.ValidatorDisabled` and
  // `Session.ValidatorReenabled`, would be missing from a table built the obvious way.
});

test('every def tag the runtime declares is one the walker handles', () => {
  // The walker treats an unknown tag as a leaf, which is a MISS if that tag could contain an
  // account. Rather than invent a descent for a shape never seen, the tag set is asserted —
  // so a runtime introducing a new one fails here instead of quietly under-attributing.
  const handled = new Set(['composite', 'variant', 'sequence', 'array', 'tuple', 'primitive', 'compact']);
  const seen = new Set(
    (metadata.lookup as readonly { def: { tag: string } }[]).map((t) => t.def.tag),
  );
  assert.deepEqual([...seen].filter((t) => !handled.has(t)), []);
});

test('an event decoded against different metadata is refused, not partly attributed', () => {
  const forged = { type: 'Balances', value: { type: 'NoSuchVariant', value: { who: ALICE } } };
  assert.throws(() => reader.accounts(forged), EventAccountError);
});

test('an account in a NON-FIRST tuple position is found', () => {
  // Not a hypothetical: this runtime declares **12** tuple types containing `AccountId32`, and
  // five of them hold it at position 1 or 2 rather than 0 (types 475, 479, 583, 634, 839).
  // A walker that descended only the first member would find the account in some events and
  // not others — the silent-narrow failure, applied unevenly, which is harder to notice than
  // finding none at all.
  //
  // Driven through forged metadata because the walker is a pure function over (metadata,
  // decoded value): forging both reaches the branch precisely, where hunting for an event
  // that happens to use one of those tuples would test the search as much as the walker.
  const forged: ChainMetadata = {
    pallets: [],
    lookup: [
      { id: 1, path: ['sp_core', 'crypto', 'AccountId32'], def: { tag: 'composite', value: [] } },
      { id: 2, path: [], def: { tag: 'primitive', value: 'u32' } },
      { id: 3, path: [], def: { tag: 'tuple', value: [2, 1] } },
      {
        id: 4,
        path: ['pallet_x', 'pallet', 'Event'],
        def: { tag: 'variant', value: [{ name: 'Paired', fields: [{ name: 'pair', type: 3 }], index: 0 }] },
      },
      {
        id: 9,
        path: ['R', 'RuntimeEvent'],
        def: { tag: 'variant', value: [{ name: 'X', fields: [{ type: 4 }], index: 0 }] },
      },
    ],
    outerEnums: { event: 9 },
  };

  const forgedReader = eventAccountReader(forged);
  const found = forgedReader.accounts({
    type: 'X',
    value: { type: 'Paired', value: { pair: [7, ALICE] } },
  });
  assert.deepEqual([...found], [accountKey(ALICE)], 'the account sits at tuple position 1');
});

test('two AccountId32 types is ambiguous, and ambiguous is refused', () => {
  // Not producible from a real runtime today, which is exactly why it needs a forged case:
  // the check is unreachable by any fixture and a weakening of it ("at least one") survives
  // every other test in this file. If a future runtime carried the type twice, picking either
  // id would attribute some events and silently miss the rest.
  const twoAccounts: ChainMetadata = {
    pallets: [],
    lookup: [
      { id: 1, path: ['sp_core', 'crypto', 'AccountId32'], def: { tag: 'composite', value: [] } },
      { id: 2, path: ['sp_core', 'crypto', 'AccountId32'], def: { tag: 'composite', value: [] } },
      { id: 9, path: ['R', 'RuntimeEvent'], def: { tag: 'variant', value: [] } },
    ],
    outerEnums: { event: 9 },
  };
  assert.throws(() => eventAccountReader(twoAccounts), EventAccountError);

  // And none at all, the other end of the same check — a runtime this client cannot attribute
  // on must fail while wiring up, not report that no block concerns the user.
  const noAccounts: ChainMetadata = {
    pallets: [],
    lookup: [{ id: 9, path: ['R', 'RuntimeEvent'], def: { tag: 'variant', value: [] } }],
    outerEnums: { event: 9 },
  };
  assert.throws(() => eventAccountReader(noAccounts), EventAccountError);
});

test('metadata with no lookup is refused at construction', () => {
  // Fail-closed at wiring time. A reader that returned no accounts for everything would read
  // as "no block on this chain concerns this user" — forever, and without an error.
  const empty: ChainMetadata = { pallets: [], lookup: [], outerEnums: { event: 0 } };
  assert.throws(() => eventAccountReader(empty), EventAccountError);
});

test('accountKey refuses an address that is valid but not 32 bytes', () => {
  // Same trap as V-163, reached from the watched-set side: `getSs58AddressInfo` calls a
  // 20-byte (Ethereum-shaped) address valid. Converted blindly it becomes a key no event can
  // ever equal, so the user's history is empty and nothing says why.
  assert.throws(() => accountKey('sKV7YV4Lvt5VjzHhF9TwcEEaEbCjLfP'), EventAccountError);
  assert.throws(() => accountKey('not-an-address'), EventAccountError);
  // The positive control, so the two refusals above cannot pass by refusing everything.
  assert.match(accountKey(ALICE), /^0x[0-9a-f]{64}$/);
});
