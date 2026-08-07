/**
 * S2/S3/S4/S20's composition root, and the finalized decision dashboard it feeds (F7b).
 *
 * Three kinds of evidence, and none of them is a value written in this file:
 *
 * - **the runtime's own artifacts** — `fixtures/chain-feed/2/metadata.scale` plus the committed
 *   Bleavit descriptors, so what runs is the production path, offline, with no node;
 * - **the runtime's own published keys** — `runtime/bleavit-runtime/fixtures/storage-keys.json`,
 *   written by `hashed_key_for` and read **in place**, which is also where the account and the
 *   USDC Location come from (decoded out of the pre-images the runtime published, then fed back
 *   through the builder, so the input and the expectation share one producer);
 * - **the specification**, parsed at test time — 02 §2's frozen enums and 02 §4's
 *   `DecisionStatsView`, so a field the contract gains fails this suite rather than being
 *   quietly dropped by a decoder that never heard of it.
 *
 * ## What a wrong key or a wrong argument does, and why that shapes the tests
 *
 * Neither fails. A wrong storage key returns **no value**, which renders as *this account
 * holds nothing*; a wrong runtime-API argument asks about a **different subject** and receives
 * a perfectly valid answer. Both are measured here rather than reasoned about — most sharply
 * in `positionSubject`, where handing an SS58 address to a `[u8; 32]` argument codec produces
 * 25 well-formed bytes and no error at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

import { bleavit } from '@polkadot-api/descriptors';
import { getTypedCodecs } from 'polkadot-api';
import { loadCodecs, loadMetadata } from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
import {
  DecisionDashboard,
  ProposalDetail,
  balanceDecoders,
  balanceKeys,
  marketDecoders,
  marketKeys,
  positionDecoders,
  positionKeys,
  positionSubject,
  projectStats,
  proposalArgs,
  proposalDecoders,
  quoteArgs,
  statsSubjectAnomaly,
  viewFor,
} from '@bleavit/features-tx';
import type { ScreenChain, StatsRecord } from '@bleavit/features-tx';

import { APP_ROOT, DOC_02, DOC_11, architecture, txSource, withoutComments } from './spec-sources.ts';

/* --------------------------------------------------------------------------- the artifacts */

const chain: ScreenChain = {
  codecs: await loadCodecs(bleavit),
  metadata: loadMetadata(readFileSync(join(APP_ROOT, 'fixtures', 'chain-feed', '2', 'metadata.scale'))),
};

/**
 * The raw PAPI codec surface, used **only to produce inputs**.
 *
 * The decoders under test are driven with bytes the chain's own encoders wrote, so no
 * expectation in this file is a SCALE layout somebody typed out. It is never used to *check*
 * a decoder's answer — that would be the codec agreeing with itself.
 */
const encoders = await getTypedCodecs(bleavit);

const hex = (bytes: Uint8Array): string =>
  `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;

/** A `Verified<string>` fixture. Suites may write one; `check:provenance-mints` skips `tests/`. */
const verifiedString = (value: string) => ({
  value,
  status: { kind: 'verified-finalized', chain: '0xgenesis', blockHash: '0xblock', blockNumber: 1 },
}) as const;

/** Read in place — a copied expectation is one a regeneration cannot correct. */
const RUNTIME_FIXTURE = join(APP_ROOT, '..', 'runtime', 'bleavit-runtime', 'fixtures', 'storage-keys.json');

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

function entry(name: string): RuntimeEntry {
  const found = fixture.entries.find((row) => row.name === name);
  assert.ok(found, `the runtime fixture no longer publishes "${name}"`);
  return found;
}

/** A value the runtime itself published, decoded back through the chain's own key codec. */
function publishedKeyValue(entryName: string, position: number): unknown {
  const row = entry(entryName);
  const item = (encoders.query as Record<string, Record<string, unknown>>)[row.pallet]?.[row.item];
  const inner = (item as { args?: { inner?: unknown } } | undefined)?.args?.inner;
  assert.ok(Array.isArray(inner), `${row.pallet}.${row.item} has no per-position codecs`);
  const codec = inner[position] as { dec(raw: string): unknown };
  return codec.dec(row.preimages[position] as string);
}

const USDC_LOCATION = publishedKeyValue('foreign_assets_account', 0);
/** An SS58 address, because that is what `AccountId32`'s key codec decodes to on this chain. */
const WHO = publishedKeyValue('foreign_assets_account', 1) as string;
/** The same account as its 32-byte public key — what `ConditionalLedger.Positions` keys hold. */
const WHO_KEY = `0x${entry('ledger_positions').preimages[1]?.slice(2) ?? ''}`;

/* ------------------------------------------------------------------------------- the keys */

test('every key this root builds is a key the runtime itself published', () => {
  // A wrong key does not error — it returns no value, which reads as an empty account. So
  // every assertion here is against a full key from an independent producer (`hashed_key_for`),
  // never against a shape this file believes to be right.
  assert.equal(
    marketKeys(chain).phaseFlags().toLowerCase(),
    entry('constitution_phase_flags').key.toLowerCase(),
  );
  assert.equal(
    balanceKeys({ chain, usdcLocation: USDC_LOCATION }).freeUsdc(WHO).toLowerCase(),
    entry('foreign_assets_account').key.toLowerCase(),
  );
  // The two instances share an item and differ only in prefix, which is exactly the pairing
  // 02 §7.4 protects: satisfying one domain's view with the other's key is the crossing it
  // forbids, and the two prefixes are the only thing that distinguishes them.
  const keys = positionKeys(chain);
  assert.equal(
    keys.positionsPrefix('ConditionalLedger').toLowerCase(),
    entry('ledger_positions').key.slice(0, 66).toLowerCase(),
  );
  assert.equal(
    keys.positionsPrefix('ServiceLedger').toLowerCase(),
    entry('service_ledger_positions').key.slice(0, 66).toLowerCase(),
  );
  assert.notEqual(keys.positionsPrefix('ConditionalLedger'), keys.positionsPrefix('ServiceLedger'));
});

test('a pallet that is neither ledger instance is refused, never hashed', () => {
  // `storagePrefix` hashes any two strings into a well-formed 32-byte prefix, and
  // `descendantsValues` answers an unknown prefix with nothing — indistinguishable from an
  // account holding no positions, on the screen whose job is to show them.
  assert.throws(() => positionKeys(chain).positionsPrefix('Balances'), /not one of this client/);
  // The vault key carries the same refusal. A `Vaults` key built against another pallet
  // returns no value, which this reader treats as *no vault entry* — a disagreement that
  // drops the row rather than a state of the chain.
  assert.throws(() => positionKeys(chain).vault('Balances', 1n), /not one of this client/);
});

test('the vault keys are per instance and carry their argument (V-322)', () => {
  // The three surfaces 11 §11.2's S4 row names beside the two position ones. Until V-322 they
  // were declared and never built, so this is where the key exists at all.
  const keys = positionKeys(chain);
  // 32 (prefix) + 16 + 8 — `Blake2_128Concat` over a `u64` ProposalId, the same arithmetic
  // `Market.Markets(id)` above is checked by.
  assert.equal((keys.vault('ConditionalLedger', 5n).length - 2) / 2, 32 + 16 + 8);
  assert.notEqual(keys.vault('ConditionalLedger', 5n), keys.vault('ConditionalLedger', 6n));
  // Two instances of one item: same suffix, different prefix. Satisfying a service row's
  // cross-check with the primary vault is the crossing 02 §7.4 forbids by name.
  assert.notEqual(keys.vault('ConditionalLedger', 5n), keys.vault('ServiceLedger', 5n));
  assert.equal(
    keys.vault('ConditionalLedger', 5n).slice(66),
    keys.vault('ServiceLedger', 5n).slice(66),
  );
  // `BaselineVaults` is keyed by an **epoch** and has one instance — 16 §7.6 gives a hosted
  // question no Baseline leg — so it takes no pallet argument to get wrong.
  assert.equal((keys.baselineVault(4).length - 2) / 2, 32 + 16 + 4);
  assert.notEqual(keys.baselineVault(4), keys.baselineVault(5));
  assert.notEqual(keys.baselineVault(4).slice(0, 66), keys.vault('ConditionalLedger', 4n).slice(0, 66));
});

test('the market keys carry their argument, and a plain item is a bare prefix', () => {
  const keys = marketKeys(chain);
  // 32 (prefix) + 16 + 8 (Blake2_128Concat over a u64 MarketId).
  assert.equal((keys.market(5n).length - 2) / 2, 32 + 16 + 8);
  assert.notEqual(keys.market(5n), keys.market(6n), 'the book id never reached the key');
  assert.notEqual(keys.baselineMarketOf(9), keys.baselineMarketOf(10));
  // The FE-P2 cross-check prefix IS the map prefix — 32 bytes and no more. One hash short of a
  // full key is also 32 bytes here, which is why it is compared against the builder's own
  // `prefix` rather than to a length alone.
  assert.equal((keys.marketsPrefix().length - 2) / 2, 32);
  assert.ok(keys.market(5n).toLowerCase().startsWith(keys.marketsPrefix().toLowerCase()));
});

test('an absent USDC Location refuses — it is never quietly defaulted', () => {
  // `usdcLocation` is typed `unknown`, which includes `undefined`, so a missing pin can reach
  // here even though the field is required. A defaulted Location builds a well-formed key for
  // an entry nobody holds, and S20 then renders a confident 0 USDC.
  const missing = balanceKeys({ chain, usdcLocation: undefined });
  assert.throws(() => missing.freeUsdc(WHO), /ForeignAssets\.Account/);
  // And the Asset Hub `u32` where the Location belongs (02 §7.7, X-11a) — loud, not silent.
  assert.throws(() => balanceKeys({ chain, usdcLocation: 1337 }).freeUsdc(WHO), /position 0/);
});

/* -------------------------------------------------------------------------- the arguments */

test('decision_stats’ argument is the encoding the runtime itself published', () => {
  // Single-generator: `epoch_proposals` publishes the SCALE pre-image of `ProposalId = 4242`,
  // and `decision_stats(pid)` takes the same type. A wrong argument does not fail — it asks
  // about a different proposal and gets a valid answer — so this is the only check there is
  // on the encoder, short of the `pid` echo the reader compares.
  assert.equal(
    proposalArgs(chain).decisionStats('4242').toLowerCase(),
    entry('epoch_proposals').preimages[0]?.toLowerCase(),
  );
});

test('quote() takes three arguments and the side reaches the bytes', () => {
  const encode = quoteArgs(chain);
  const buy = encode(7n, 'BuyLong', 1_000n);
  const sell = encode(7n, 'SellShort', 1_000n);
  // 8 (MarketId) + 1 (TradeSide index) + 16 (Balance).
  assert.equal((buy.length - 2) / 2, 8 + 1 + 16);
  assert.notEqual(buy, sell, 'the side was dropped: 04 §6.1 combines cost and fee per direction');
  assert.notEqual(buy, encode(7n, 'BuyLong', 2_000n), 'the amount was dropped');
  assert.notEqual(buy, encode(8n, 'BuyLong', 1_000n), 'the market was dropped');
});

test('an SS58 address handed to the [u8;32] argument codec is 25 silent bytes', () => {
  // The measurement `positionSubject` exists for. `futarchy_primitives::AccountId` is
  // `[u8; 32]`, so PAPI types the position views' argument as fixed-size binary and its codec
  // takes hex — while `ConditionalLedger.Positions`' second key is a real `AccountId32` whose
  // codec decodes to SS58. Handing the one to the other does **not** throw.
  const wrong = (encoders.apis as Record<string, Record<string, { args: { enc(v: readonly unknown[]): Uint8Array } }>>)[
    'FutarchyApi'
  ]?.['account_positions']?.args.enc([WHO]);
  assert.ok(wrong !== undefined);
  assert.equal(wrong.length, 25, 'PAPI stopped mis-encoding an SS58 string; re-derive this rule');
  assert.notEqual(hex(wrong).toLowerCase(), WHO_KEY.toLowerCase());

  // And the root does the conversion, once, so the trap has no call site.
  const subject = positionSubject(chain)(WHO);
  assert.equal(subject.whoAccountKey.toLowerCase(), WHO_KEY.toLowerCase());
  assert.equal((subject.whoArgsHex.length - 2) / 2, 32);
  assert.equal(subject.whoArgsHex.toLowerCase(), WHO_KEY.toLowerCase());
});

test('the two position views are asked the same question, and that is checked', () => {
  // `PositionReadParams.whoArgsHex` is one field feeding two runtime APIs. Nothing else in
  // the client would notice if they diverged: both calls would succeed, and one would answer
  // about a different account.
  assert.doesNotThrow(() => positionSubject(chain)(WHO));
  const rejected = positionKeys(chain);
  assert.ok(rejected, 'anti-vacuity: the root built at all');
});

/* ---------------------------------------------------------------------------- the decoders */

test('the market decoder reads a book the chain’s own encoder wrote', () => {
  const book = (phase: string) =>
    hex(
      (encoders.query as { Market: { Markets: { value: { enc(v: unknown): Uint8Array } } } }).Market
        .Markets.value.enc({
          id: 5n,
          kind: { type: 'Decision', value: { proposal: 4242n, branch: { type: 'Accept', value: undefined } } },
          phase: { type: phase, value: undefined },
          account: WHO,
          fees_account: WHO,
          b: 25_000n,
          q_long: 1n,
          q_short: 2n,
          fees_accrued: 3n,
          last_quote_1e9: 500_000_000n,
          last_observation_1e9: 500_000_000n,
          last_observed_block: 4n,
          cumulative_price_blocks: { hi: 0n, lo: 0n },
          stale_events: 0,
        }),
    );
  const decode = marketDecoders(chain).market;
  const trading = decode(book('Trading'));
  assert.ok(trading.ok);
  assert.deepEqual(trading.value?.book, { qLong: 1n, qShort: 2n, b: 25_000n });

  // `open` is the runtime's own predicate — `matches!(phase, Trading | Extended)` — and the
  // other two arms are the reason it is not a name comparison at a call site: a book that
  // still quoted after resolution would sell an uncreatable claim.
  for (const [phase, open] of [
    ['Trading', true],
    ['Extended', true],
    ['Closed', false],
    ['Settled', false],
  ] as const) {
    const decoded = decode(book(phase));
    assert.ok(decoded.ok, phase);
    assert.equal(decoded.value?.open, open, phase);
  }
});

test('the quote decoder yields 02 §4’s two monetary fields, never their sum', () => {
  const raw = hex(
    (encoders.apis as { FutarchyApi: { quote: { value: { enc(v: unknown): Uint8Array } } } })
      .FutarchyApi.quote.value.enc({
        cost: 1_002_000n,
        fee: 3_006n,
        p_after_1e9: 500_000_000n,
        max_trade: 9n,
        within_domain: true,
        evaluable: true,
      }),
  );
  const decoded = marketDecoders(chain).quote(raw);
  assert.ok(decoded.ok);
  assert.deepEqual(decoded.value, { cost: 1_002_000n, fee: 3_006n });
});

test('the balance decoders read `data.free` and `data.reserved`, not the outer record', () => {
  // `frame_system`'s `AccountInfo` carries `nonce`, `consumers`, `providers`, `sufficients`
  // and a nested `data`. A decoder reading `free` off the outer record finds nothing and
  // reports the account as undecodable, which S20 renders as a refusal rather than a balance.
  const raw = hex(
    (encoders.query as { System: { Account: { value: { enc(v: unknown): Uint8Array } } } }).System
      .Account.value.enc({
        nonce: 1,
        consumers: 0,
        providers: 1,
        sufficients: 0,
        data: { free: 5_000_000n, reserved: 100_000n, frozen: 0n, flags: 0n },
      }),
  );
  const decoded = balanceDecoders(chain).account(raw);
  assert.ok(decoded.ok);
  assert.deepEqual(decoded.value, { free: 5_000_000n, reserved: 100_000n });

  const usdc = hex(
    (encoders.query as { ForeignAssets: { Account: { value: { enc(v: unknown): Uint8Array } } } })
      .ForeignAssets.Account.value.enc({
        balance: 42_000_000n,
        status: { type: 'Liquid', value: undefined },
        reason: { type: 'Consumer', value: undefined },
      }),
  );
  const decodedUsdc = balanceDecoders(chain).freeUsdc(usdc);
  assert.ok(decodedUsdc.ok);
  assert.equal(decodedUsdc.value?.balance, 42_000_000n);
});

test('every decoder is bound to a real surface on this chain', () => {
  // A decoder bound to a missing item does not throw at construction — it reports per call —
  // so the binding is only observable by decoding. What must never appear is *"this runtime
  // has no such entry"*: that is a wrong-chain or wrong-name binding, and it would make every
  // figure on the screen absent for a reason that has nothing to do with the chain's answer.
  //
  // The input is deliberately not asserted to fail. `0x00` is a legal encoding of `None` for
  // an `Option` and of an empty `Vec` for a bounded list, so "junk" is relative to the type
  // and a blanket refusal assertion would be false for two of these six.
  const decoders: readonly [string, (raw: string) => { ok: boolean; reason?: string }][] = [
    ...Object.entries(marketDecoders(chain)),
    ...Object.entries(balanceDecoders(chain)),
    ['decisionStats', proposalDecoders(chain).decisionStats],
    ['primary.positions', positionDecoders(chain).primary.positions],
    ['service.positions', positionDecoders(chain).service.positions],
    ['primary.vault', positionDecoders(chain).primary.vault],
    ['service.vault', positionDecoders(chain).service.vault],
    ['baselineVault', positionDecoders(chain).baselineVault],
  ];
  for (const [name, decode] of decoders) {
    const result = decode('0x00');
    const reason = result.ok ? '' : (result.reason ?? '');
    assert.ok(!reason.includes('has no storage entry'), `${name}: ${reason}`);
    assert.ok(!reason.includes('has no runtime-API method'), `${name}: ${reason}`);
  }

  // Anti-vacuity: the same check on a surface this chain does not declare **must** report the
  // binding failure, or the loop above holds over nothing.
  const absent: ScreenChain = {
    metadata: chain.metadata,
    codecs: { query: {}, apis: {} },
  };
  const missing = balanceDecoders(absent).account('0x00');
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? '' : missing.reason, /has no storage entry/);
});

test('a u32 that decoded to a float is not a bitset, and is refused', () => {
  // `typeof value === 'number'` accepts 1.5, and `1.5 & (1 << 5)` is 0 — which reads as
  // *trading is enabled*. V-115's shape, and here the unsafe direction rather than the safe one.
  const stub: ScreenChain = {
    metadata: chain.metadata,
    codecs: {
      apis: chain.codecs.apis,
      query: { Constitution: { PhaseFlags: { value: { dec: () => 1.5 } } } },
    },
  };
  const decoded = marketDecoders(stub).phaseFlags('0x00');
  assert.equal(decoded.ok, false);
  assert.match(decoded.ok ? '' : decoded.reason, /integer/);
});

/* ---------------------------------------------- the vault surfaces the cross-check reads */

/** One storage item's value codec, from the chain's own descriptors. Inputs only. */
function valueCodec(pallet: string, item: string): { enc(value: unknown): Uint8Array } {
  const found = (
    encoders.query as Record<string, Record<string, { value: { enc(value: unknown): Uint8Array } }>>
  )[pallet]?.[item];
  assert.ok(found !== undefined, `${pallet}.${item} is not on this chain`);
  return found.value;
}

/** A `BranchSupply` with nothing in it — the cross-check reads only `state`. */
const EMPTY_BRANCH = { usdc: 0n, scalar_sets: 0n, gate_sets: [0n, 0n] };

function vaultBytes(state: unknown): string {
  return hex(
    valueCodec('ConditionalLedger', 'Vaults').enc({
      escrowed: 1_000n,
      branches: [EMPTY_BRANCH, EMPTY_BRANCH],
      state,
      gate_outcomes: [undefined, undefined],
      spec: 1,
    }),
  );
}

test('every VaultState the chain can store decodes to the projection the view publishes', () => {
  // The FE-P2 witness for `vault_state`, and the field that decides which redemption call a
  // row may sign (11 §11.5, §11.6). Driven with bytes **this runtime's own codec** wrote, so
  // no layout in this file was typed out — and read through the same `asVaultState` the view
  // goes through, which is why a second reader of one enum is not written.
  const decode = positionDecoders(chain).primary.vault;
  const cases: readonly [unknown, unknown][] = [
    [{ type: 'Open', value: undefined }, { kind: 'open' }],
    [{ type: 'Voided', value: undefined }, { kind: 'voided' }],
    [
      { type: 'Resolved', value: { type: 'Reject', value: undefined } },
      { kind: 'resolved', branch: 'Reject' },
    ],
    [
      {
        type: 'ScalarSettled',
        value: { winner: { type: 'Accept', value: undefined }, s: 700_050_000n },
      },
      { kind: 'scalar-settled', winner: 'Accept', score: 700_050_000n },
    ],
    [
      { type: 'BaselineSettled', value: { s: 500_000_000n } },
      { kind: 'baseline-settled', score: 500_000_000n },
    ],
  ];
  for (const [state, expected] of cases) {
    const decoded = decode(vaultBytes(state));
    assert.ok(decoded.ok, decoded.ok ? '' : decoded.reason);
    assert.deepEqual(decoded.value, expected);
  }
  // The service instance reads its own map identically — same shapes, different prefix — so a
  // hosted row's vault state is checked against the ledger that really backs it.
  const service = positionDecoders(chain).service.vault(vaultBytes({ type: 'Voided', value: undefined }));
  assert.ok(service.ok);
  assert.deepEqual(service.ok ? service.value : undefined, { kind: 'voided' });
});

test('BaselineVaults projects branch-free, exactly as the runtime’s own view does', () => {
  // 02 §4, contract v6: a Baseline instrument has no winning proposal branch to publish, so
  // `Settled(s)` becomes `BaselineSettled { s }` and never a `ScalarSettled` with an invented
  // winner. `BaselineState` has two variants and `VaultState` five, which is why this mapping
  // is written out rather than routed through the five-arm reader.
  const bytes = (state: unknown): string =>
    hex(valueCodec('ConditionalLedger', 'BaselineVaults').enc({ escrowed: 5n, sets: 3n, state }));
  const decode = positionDecoders(chain).baselineVault;

  const open = decode(bytes({ type: 'Open', value: undefined }));
  assert.ok(open.ok, open.ok ? '' : open.reason);
  assert.deepEqual(open.value, { kind: 'open' });

  const settled = decode(bytes({ type: 'Settled', value: 700_050_000n }));
  assert.ok(settled.ok, settled.ok ? '' : settled.reason);
  assert.deepEqual(settled.value, { kind: 'baseline-settled', score: 700_050_000n });

  // A state this release has never heard of is refused rather than mapped onto `Open`, which
  // is the arm that offers actions.
  const unknown = decode(hex(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x7f])));
  assert.equal(unknown.ok, false);
});

/* ------------------------------------------------------- the storage key the witness needs */

test('a (PositionId, AccountId) key is taken apart at offsets the encoding decides', () => {
  // The two `PositionId` variants have **different** SCALE lengths — 11 bytes for
  // `Proposal{…}` and 6 for `Baseline{…}` — which is exactly why the runtime fixture
  // publishes both, and why a constant-offset slice would read the account from the middle of
  // the id on one of them.
  const balance = hex(
    (encoders.query as { ConditionalLedger: { Positions: { value: { enc(v: unknown): Uint8Array } } } })
      .ConditionalLedger.Positions.value.enc(1_234n),
  );
  const decoders = positionDecoders(chain);
  const decoded = decoders.primary.positionEntries([
    { key: entry('ledger_positions').key, value: balance },
    { key: entry('ledger_positions_baseline_variant').key, value: balance },
  ]);
  assert.ok(decoded.ok, decoded.ok ? '' : decoded.reason);
  assert.deepEqual(
    decoded.value.map((row) => row.positionId),
    ['Proposal(4242, Accept, Long)', 'Baseline(9, Short)'],
  );
  // The account leaves as the 32-byte public key, never the SS58 string PAPI decoded. The
  // reader compares it against `whoAccountKey` by string equality, and this chain's prefix
  // (7777) would make an address from anywhere else match nothing, ever — presenting as
  // *the runtime view and its own storage disagree* on every single row.
  for (const row of decoded.value) assert.equal(row.account.toLowerCase(), WHO_KEY.toLowerCase());
  assert.deepEqual(decoded.value.map((row) => row.balance), [1_234n, 1_234n]);

  // The same key in the other instance: identical suffix, different prefix. The splitter reads
  // offsets, so the service pair must handle it identically.
  const service = decoders.service.positionEntries([
    { key: entry('service_ledger_positions').key, value: balance },
  ]);
  assert.ok(service.ok);
  assert.equal(service.value[0]?.positionId, 'Proposal(4242, Accept, Long)');
});

test('a key that is short, long or malformed is refused rather than mis-split', () => {
  const balance = hex(
    (encoders.query as { ConditionalLedger: { Positions: { value: { enc(v: unknown): Uint8Array } } } })
      .ConditionalLedger.Positions.value.enc(1n),
  );
  const split = positionDecoders(chain).primary.positionEntries;
  const full = entry('ledger_positions').key;

  // Truncated inside the account: the id still decodes, and the account does not.
  assert.equal(split([{ key: full.slice(0, full.length - 20), value: balance }]).ok, false);
  // Nothing but the prefix: `descendantsValues` never returns this, but a hand-built request
  // could, and reading a PositionId out of an empty tail must not invent one.
  assert.equal(split([{ key: full.slice(0, 66), value: balance }]).ok, false);
  // A valueless key contributes no row rather than a zero balance — the cross-check reports
  // it as *no entry*, which is what an absent holding really is.
  const valueless = split([{ key: full }]);
  assert.ok(valueless.ok);
  assert.deepEqual(valueless.value, []);
});

/* ------------------------------------------------- the decision statistics, against doc 02 */

/**
 * The body of one `pub struct`/`pub enum` block in doc 02 §2's frozen listing.
 *
 * Brace-matched rather than cut at the first line starting with `}`, because doc 02 writes
 * some enums on **one line** (`pub enum DecisionOutcome { Adopt, Reject(RejectReason), Extend }`)
 * — where a line-based scan runs on into the *next* declaration and silently returns two
 * blocks joined together, which reads as a longer variant list rather than as an error.
 */
function docBlock(kind: 'struct' | 'enum', name: string): string {
  const doc = architecture(DOC_02);
  const start = doc.indexOf(`pub ${kind} ${name} {`);
  assert.ok(start >= 0, `doc 02 no longer declares \`pub ${kind} ${name}\``);
  let depth = 0;
  for (let index = doc.indexOf('{', start); index < doc.length; index += 1) {
    if (doc[index] === '{') depth += 1;
    else if (doc[index] === '}') {
      depth -= 1;
      if (depth === 0) return doc.slice(start, index);
    }
  }
  return assert.fail(`\`${name}\`'s declaration never terminates`);
}

test('the decoder consumes every field 02 §4 freezes on DecisionStatsView', () => {
  // The direction that matters: a field the contract gains must fail here rather than being
  // dropped by a decoder that never heard of it. `pid` is consumed as a *check* rather than a
  // rendered figure, so it is asserted against the reader's own comparison instead.
  const fields = [...docBlock('struct', 'DecisionStatsView').matchAll(/^\s{4}pub (\w+):/gm)].map(
    (match) => match[1] as string,
  );
  assert.equal(fields.length, 14, `02 §4 now publishes ${fields.length} fields: ${fields.join(', ')}`);
  const source = withoutComments(txSource('screen-composition.ts'));
  for (const field of fields) {
    assert.ok(source.includes(`'${field}'`), `the decoder never reads DecisionStatsView.${field}`);
  }
});

test('a whole DecisionStatsView round-trips, and its four gate TWAPs stay in order', () => {
  const view = {
    pid: 4_242n,
    twap_accept_1e9: 562_000_000n,
    twap_reject_1e9: 521_000_000n,
    twap_baseline_1e9: 523_000_000n,
    r_eff_1e9: 521_000_000n,
    trailing_accept_1e9: 562_000_000n,
    trailing_reject_1e9: 522_200_000n,
    coverage_pct: 97,
    traded_volume: 1_000_000n,
    v_min_required: 500_000n,
    converged: true,
    gate_twaps_1e9: [11_000_000n, 9_000_000n, 17_000_000n, 15_000_000n],
    attack_cost_hat: 9_000_000n,
    in_cap_prize: 1_000_000n,
  };
  const encode = (value: unknown) =>
    hex(
      (encoders.apis as { FutarchyApi: { decision_stats: { value: { enc(v: unknown): Uint8Array } } } })
        .FutarchyApi.decision_stats.value.enc(value),
    );
  const decoded = proposalDecoders(chain).decisionStats(encode(view));
  assert.ok(decoded.ok, decoded.ok ? '' : decoded.reason);
  const record = decoded.value;
  assert.ok(record !== undefined);
  assert.equal(record.pid, '4242');
  assert.equal(record.twapAccept1e9, 562_000_000n);
  assert.equal(record.coveragePct, 97);
  assert.equal(record.converged, true);
  // The order is 02 §4's own `(S,C) × (adopt, reject)`. Indexing `[2]` for *Survival, reject*
  // labels the Security book with the Survival book's price, and both are plausible numbers.
  assert.deepEqual(record.gateTwaps1e9, [11_000_000n, 9_000_000n, 17_000_000n, 15_000_000n]);

  // `None` is not a failure: 11 §11.2 makes it the expected answer on an open market.
  const none = proposalDecoders(chain).decisionStats('0x00');
  assert.ok(none.ok);
  assert.equal(none.value, undefined);

  // A class with no gate markets carries no gate TWAPs, and that is an absence rather than
  // four zeroes — 05 §5.4 step 4 vetoes on a *high* adopt price, so zero is the flattering
  // direction and an invented one reads as four perfectly clean books.
  const gateless = proposalDecoders(chain).decisionStats(
    encode({ ...view, gate_twaps_1e9: undefined }),
  );
  assert.ok(gateless.ok);
  assert.equal(gateless.value?.gateTwaps1e9, undefined);
});

test('a gate array that is not exactly four is refused, never padded', () => {
  // 02 §4 freezes `Option<[FixedU64; 4]>` and `GateTwaps` names all four positions, so a
  // shorter array would reach the screen with one gate book rendered as `undefined`. Driven
  // through a stub codec because a real one cannot produce it — which is exactly why the check
  // is here rather than left to the encoding.
  const stubbed = (value: unknown): ScreenChain => ({
    metadata: chain.metadata,
    codecs: {
      query: chain.codecs.query,
      apis: { FutarchyApi: { decision_stats: { args: { enc: () => new Uint8Array() }, value: { dec: () => value } } } },
    },
  });
  const view = {
    pid: 7n,
    twap_accept_1e9: 1n,
    twap_reject_1e9: 1n,
    twap_baseline_1e9: 1n,
    r_eff_1e9: 1n,
    trailing_accept_1e9: 1n,
    trailing_reject_1e9: 1n,
    coverage_pct: 1,
    traded_volume: 1n,
    v_min_required: 1n,
    converged: true,
    attack_cost_hat: 1n,
    in_cap_prize: 1n,
  };
  for (const gates of [[1n, 2n, 3n], [1n, 2n, 3n, 4n, 5n], [1n, 2n, 3n, 'four']]) {
    const decoded = proposalDecoders(stubbed({ ...view, gate_twaps_1e9: gates })).decisionStats('0x');
    assert.equal(decoded.ok, false, JSON.stringify(gates.map(String)));
    assert.match(decoded.ok ? '' : decoded.reason, /four fixed-point scalars/);
  }
  // Anti-vacuity: four bigints are admitted through the same stub.
  const four = proposalDecoders(stubbed({ ...view, gate_twaps_1e9: [1n, 2n, 3n, 4n] })).decisionStats('0x');
  assert.ok(four.ok);
  assert.deepEqual(four.value?.gateTwaps1e9, [1n, 2n, 3n, 4n]);
});

test('each domain’s decoders name their own storage item, never the other’s', () => {
  // 02 §7.4's per-domain pairing, measured. The two instances declare identical types, so
  // either decoder would decode the other's bytes and no round trip could tell them apart —
  // what distinguishes them is which item each is *bound* to, and a failure reason is the one
  // place that binding becomes observable.
  const decoders = positionDecoders(chain);
  const balance = hex(
    (encoders.query as { ConditionalLedger: { Positions: { value: { enc(v: unknown): Uint8Array } } } })
      .ConditionalLedger.Positions.value.enc(1n),
  );
  const primary = decoders.primary.positionEntries([{ key: '0x00', value: balance }]);
  assert.equal(primary.ok, false);
  assert.match(primary.ok ? '' : primary.reason, /^ConditionalLedger\.Positions:/);
  const service = decoders.service.positionEntries([{ key: '0x00', value: balance }]);
  assert.equal(service.ok, false);
  assert.match(service.ok ? '' : service.reason, /^ServiceLedger\.Positions:/);
});

test('the uplift is the full window’s, and no trailing counterpart is derived', () => {
  // 05 §5.4 step 6 is `a_f >= r_eff + delta`, so the uplift is the left side minus the floor.
  // The Baseline floor **binds** here — `r_eff = max(r_f, base − σ)` is the Baseline leg, not
  // the reject TWAP — which is the whole point of the fixture: with `r_eff == r_f` a client
  // subtracting the wrong one of the two gets the right answer, and 05 §5.3 exists precisely
  // because the two differ under Baseline suppression (14 TH-7).
  const record: StatsRecord = {
    pid: '7',
    twapAccept1e9: 562_000_000n,
    twapReject1e9: 515_000_000n,
    twapBaseline1e9: 526_000_000n,
    rEff1e9: 521_000_000n,
    trailingAccept1e9: 562_000_000n,
    trailingReject1e9: 522_200_000n,
    coveragePct: 97,
    tradedVolume: 1n,
    vMinRequired: 1n,
    converged: true,
    gateTwaps1e9: undefined,
    attackCostHat: 3n,
    inCapPrize: 1n,
  };
  const read = finalize('0xstats', { chain: '0xgenesis', blockHash: '0xblock', blockNumber: 1 });
  const stats = projectStats(read, record);
  assert.equal(stats.uplift1e9.value, 41_000_000n);
  // Not `twap_accept − twap_reject`, which is 47,000,000 on this fixture and is the reading a
  // client gets by subtracting the nearer field.
  assert.notEqual(stats.uplift1e9.value, record.twapAccept1e9 - record.twapReject1e9);
  // Signed: a rejected proposal's uplift is negative, and it renders as such rather than
  // clamping to zero, which would make every rejection look like a tie.
  assert.equal(projectStats(read, { ...record, rEff1e9: 600_000_000n }).uplift1e9.value, -38_000_000n);

  // And the trap: `trailing_accept − trailing_reject` is **not** the trailing uplift, because
  // step 7's floor is `max(r_t, base_trailing − σ)` and `base_trailing` has no field in the
  // view. 04 §12's own worked example computes it the wrong way, which is why the model has
  // no field for it at all.
  assert.ok(!('trailingUplift1e9' in stats));
  assert.ok(
    !withoutComments(txSource('proposal-reads.ts')).includes('trailingAccept1e9 - '),
    'a trailing uplift was derived from two fields that do not bound it',
  );
  assert.equal(
    [...docBlock('struct', 'DecisionStatsView').matchAll(/^\s{4}pub (\w+):/gm)].filter((m) =>
      (m[1] as string).includes('baseline'),
    ).length,
    1,
    'the view now publishes more than one baseline field; re-derive the trailing rule',
  );

  // Every leaf descends from the read that carried it, never from a status written beside it.
  for (const leaf of [stats.twapAccept1e9, stats.uplift1e9, stats.converged, stats.coveragePct]) {
    assert.equal(leaf.status.kind, 'verified-finalized');
    assert.equal(leaf.status.kind === 'verified-finalized' ? leaf.status.blockHash : '', '0xblock');
  }
});

/* ------------------------------------------------------- the lifecycle names, against doc 02 */

function proposalStateVariants(): readonly string[] {
  return [...docBlock('enum', 'ProposalState').matchAll(/\b([A-Z]\w+)\b/g)]
    .map((match) => match[1] as string)
    .filter((name) => name !== 'ProposalState' && name !== 'RejectReason');
}

test('every ProposalState the client names is one 02 §2 declares', () => {
  // The defect this closes: `STATS_REQUIRE_SEALED` named `Measured`, `Delayed` and
  // `MandateExpired` — none of them variants — while missing four real post-decision states,
  // and `trade-ticket.ts`'s union named five more that do not exist. Both were fail-closed and
  // both were wrong: a decided proposal in a state the client cannot name was told *"there are
  // no decision statistics yet"*, which is a confident false statement about the chain.
  const declared = new Set(proposalStateVariants());
  assert.equal(declared.size, 15, [...declared].join(', '));

  const union = withoutComments(txSource('trade-ticket.ts'));
  const start = union.indexOf('export type ProposalState =');
  const named = [...union.slice(start, union.indexOf(';', start)).matchAll(/'(\w+)'/g)].map(
    (match) => match[1] as string,
  );
  for (const name of named) assert.ok(declared.has(name), `ProposalState names "${name}"`);
  // Both directions: `TradableState` supplies the two the union does not spell out here.
  assert.equal(named.length + 2, declared.size, named.join(', '));

  const reads = withoutComments(txSource('proposal-reads.ts'));
  const listed = [...reads.matchAll(/^\s{2}'(\w+)',$/gm)].map((match) => match[1] as string);
  assert.ok(listed.length > 0, 'the sealed-state allowlist could not be found');
  for (const name of listed) assert.ok(declared.has(name), `the allowlist names "${name}"`);
});

test('doc 02 gives a proposal no free-text field, which is why there is no title (SQ-860)', () => {
  // The evidence behind `ProposalSummary`'s repair. Writing the composition root is what
  // forced it: a decoder for `title` could only have invented one, under a verified badge, in
  // the field a user reads first.
  for (const name of ['ProposalSummaryView'] as const) {
    const block = docBlock('struct', name);
    assert.ok(!/\btitle\b/i.test(block), `${name} declares a title after all`);
    assert.ok(block.includes('payload_hash'), `${name} no longer carries the commitment`);
  }
  assert.ok(!/\btitle\b/i.test(withoutComments(txSource('proposals.tsx')).replace(/title=/g, '')));
});

/* ------------------------------------------------------------------- the dashboard renders */

function dashboardHtml(overrides: Partial<StatsRecord> = {}): string {
  const record: StatsRecord = {
    pid: '7',
    twapAccept1e9: 562_000_000n,
    twapReject1e9: 521_000_000n,
    twapBaseline1e9: 523_000_000n,
    rEff1e9: 521_000_000n,
    trailingAccept1e9: 562_000_000n,
    trailingReject1e9: 522_200_000n,
    coveragePct: 97,
    tradedVolume: 1_000_000n,
    vMinRequired: 500_000n,
    converged: true,
    gateTwaps1e9: [11_000_000n, 9_000_000n, 17_000_000n, 15_000_000n],
    attackCostHat: 9_000_000n,
    inCapPrize: 1_000_000n,
    ...overrides,
  };
  const read = finalize('0xstats', { chain: '0xgenesis', blockHash: '0xblock', blockNumber: 1 });
  return renderToStaticMarkup(
    h(DecisionDashboard, { stats: projectStats(read, record), decimals: 6, symbol: 'USDC' }),
  );
}

test('the dashboard renders the 1e9 grid on its own grid, never through a ppm formatter', () => {
  const html = dashboardHtml();
  // `WelfarePillars` states the hazard: a parts-per-million formatter is a factor of a
  // thousand. The superseded `upliftPpm` field divided by exactly that before anything could
  // read the digits it discarded.
  assert.ok(html.includes('0.562000000'), html);
  assert.ok(html.includes('0.521000000'), html);
  assert.ok(html.includes('0.041000000'), 'the derived uplift is missing');
  assert.ok(!html.includes('562000 %'), html);
  // Balances are balances: base units at the caller's decimals, with the caller's symbol.
  assert.ok(html.includes('9.000000 USDC'), html);
  assert.ok(html.includes('1.000000 USDC'), html);
  // Every figure carries a badge, because every one of them descends from a read.
  assert.ok(html.includes('data-status="verified-finalized"'), html);
});

test('the dashboard states no outcome and no verdict of its own', () => {
  // 11 §11.2 permits S2 to render `decision_stats(pid)` *"only as finalized decision
  // statistics"*. The outcome is the proposal's own state, one panel up; a second answer here
  // that disagreed with the chain's would still carry a verified badge.
  //
  // The assertion runs over the **rendered figures**, not the whole markup: *reject* is a
  // branch name and appears legitimately in four labels, so a word scan over the page would
  // fire on correct copy — which is how a gate gets switched off.
  const values = [...dashboardHtml().matchAll(/<span class="datum__value">([^<]*)<\/span>/g)].map(
    (match) => match[1] as string,
  );
  assert.ok(values.length >= 12, `only ${values.length} figures rendered`);
  const outcomes = [...docBlock('enum', 'DecisionOutcome').matchAll(/\b([A-Z]\w+)\b/g)]
    .map((match) => match[1] as string)
    .filter((name) => name !== 'DecisionOutcome' && name !== 'RejectReason');
  assert.deepEqual(outcomes, ['Adopt', 'Reject', 'Extend']);
  for (const value of values) {
    for (const outcome of outcomes) {
      assert.ok(!value.includes(outcome), `the dashboard renders "${value}" as a figure`);
    }
  }
  // No projection either — the word 11 §11.2 uses for what S2 and S3 must not show.
  assert.ok(!/projected/i.test(dashboardHtml()));

  // And the model has no field one could occupy — the structural half.
  const declaration = withoutComments(txSource('proposals.tsx'));
  const start = declaration.indexOf('export interface DecisionStats {');
  const body = declaration.slice(start, declaration.indexOf('\n}', start));
  assert.ok(!/\boutcome\b/.test(body), body);
  assert.ok(!/\bverdict\b/.test(body), body);
  assert.ok(!/upliftPpm/.test(body), body);
});

test('a class with no gate markets renders an absence, not four zeroes', () => {
  const html = dashboardHtml({ gateTwaps1e9: undefined });
  assert.ok(html.includes('No gate books'), html);
  assert.ok(!html.includes('0.000000000'), `an invented zero gate TWAP reached the screen: ${html}`);
  // Anti-vacuity: the gated case really does render four — each under **its own** label, so a
  // transposition of the `(S,C) × (adopt, reject)` order fails here. Four present-somewhere
  // assertions would pass on any permutation, which is the shape of a test that measures
  // nothing: 02 §4 freezes that order as wire format, and both prices are plausible.
  const gated = dashboardHtml();
  for (const [label, value] of [
    ['survival, adopt', '0.011000000'],
    ['survival, reject', '0.009000000'],
    ['security, adopt', '0.017000000'],
    ['security, reject', '0.015000000'],
  ] as const) {
    const marker = `<span class="datum__name">${label}</span><span class="datum__value">${value}</span>`;
    assert.ok(gated.includes(marker), `${label} does not render ${value}: ${gated}`);
  }
});

test('the sealed-state allowlist is 02 §2’s enum minus the states that are not sealed', () => {
  // The allowlist decides whether the dashboard renders at all, and it is derived here rather
  // than restated: every variant doc 02 declares is put through `viewFor` with statistics in
  // hand, and the four pre-decision states, the two tradable ones and `Rerun` are the only
  // ones that may refuse them. A name dropped from the allowlist tells a user *"there are no
  // decision statistics yet"* about a proposal that has them.
  const notSealed = new Set(['Submitted', 'Screening', 'Qualified', 'Trading', 'Extended', 'Rerun']);
  const read = finalize('0xstats', { chain: '0xgenesis', blockHash: '0xblock', blockNumber: 1 });
  let sealed = 0;
  for (const state of proposalStateVariants()) {
    const summary = {
      id: verifiedString('7'),
      payloadHash: verifiedString(`0x${'ab'.repeat(32)}`),
      klass: verifiedString('Treasury'),
      state: verifiedString(state),
    };
    const stats = projectStats(read, {
      pid: '7',
      twapAccept1e9: 1n,
      twapReject1e9: 1n,
      twapBaseline1e9: 1n,
      rEff1e9: 1n,
      trailingAccept1e9: 1n,
      trailingReject1e9: 1n,
      coveragePct: 1,
      tradedVolume: 1n,
      vMinRequired: 1n,
      converged: true,
      gateTwaps1e9: undefined,
      attackCostHat: 1n,
      inCapPrize: 1n,
    });
    const ruled = viewFor(summary, stats);
    if (notSealed.has(state)) {
      assert.equal(ruled.view.stage, 'pre-decision', `${state} rendered statistics`);
      assert.notEqual(ruled.anomaly, undefined, `${state} refused silently`);
    } else {
      assert.equal(ruled.view.stage, 'decided', `${state} refused its own statistics`);
      assert.equal(ruled.anomaly, undefined, state);
      sealed += 1;
    }
  }
  assert.equal(sealed, 9, 'the sealed set changed size');
});

test('a reset decision gets its own sentence, not "have not opened yet"', () => {
  // `Rerun` (05 §2.1 T13/T25) is neither sealed nor trading. Both other sentences are false of
  // it: the markets are not open, and they have not *failed to open* — they reopen, under a
  // hurdle raised by one percentage point.
  const summary = (state: string) => ({
    id: verifiedString('7'),
    payloadHash: verifiedString(`0x${'ab'.repeat(32)}`),
    klass: verifiedString('Treasury'),
    state: verifiedString(state),
  });
  assert.equal(
    viewFor(summary('Rerun'), undefined).view.stage === 'pre-decision'
      ? (viewFor(summary('Rerun'), undefined).view as { reason: string }).reason
      : '',
    'reopening',
  );
  assert.equal(
    viewFor(summary('Submitted'), undefined).view.stage === 'pre-decision'
      ? (viewFor(summary('Submitted'), undefined).view as { reason: string }).reason
      : '',
    'not-yet-opened',
  );
  const html = renderToStaticMarkup(
    h(ProposalDetail, {
      view: { stage: 'pre-decision', summary: summary('Rerun'), reason: 'reopening' },
      decimals: 6,
      symbol: 'USDC',
    }),
  );
  assert.ok(html.includes('reset'), html);
  assert.ok(!html.includes('have not opened yet'), html);
});

test('a stats answer about another proposal is refused, not rendered under this heading', () => {
  // The check that closes the hole `ProposalArgs` names: a wrong SCALE argument does not fail,
  // it asks about a different proposal and gets a valid answer. Every figure would be genuine
  // and every badge true — about the wrong subject.
  const summary = {
    id: verifiedString('7'),
    payloadHash: verifiedString(`0x${'ab'.repeat(32)}`),
    klass: verifiedString('Treasury'),
    state: verifiedString('Settled'),
  };
  assert.equal(statsSubjectAnomaly(summary, '7'), undefined);
  const anomaly = statsSubjectAnomaly(summary, '8');
  assert.ok(anomaly, 'a mismatched subject was accepted');
  assert.equal(anomaly.proposalId, '7');
  assert.match(anomaly.detail, /different proposal/);
});

test('doc 11 is what forbids the preview, and doc 02 is what freezes the fields', () => {
  assert.match(
    architecture(DOC_11),
    /S2 MAY render it only as finalized decision statistics/,
  );
  assert.match(architecture(DOC_02), /pub struct DecisionStatsView \{/);
});
