/**
 * S3 — the trading ticket, for decision, gate, Baseline and external books.
 *
 * `trade-ticket.test.ts` already covers which rows refuse a signature. What is asserted here
 * is everything between the chain and the user's eyes, and every property in it is one a
 * happy-path render satisfies either way:
 *
 * - a **reaped** Baseline book answers every read with nothing, and nothing formats as
 *   `0.00` — which on a trading screen reads as *worth zero* rather than *gone*;
 * - a **corrupt** mapping (present, resolving to no book or to another one) is a different
 *   state with a different consequence, and labelling it reaped hides a hard block;
 * - `FE-CHAIN-005` is a **block**, and rendering it as one more red notice among the rest
 *   loses the one thing E6 says about it — that there is nothing to retry;
 * - an in-Trade preview is forbidden, and the only demonstrable form of *"the screen has
 *   none"* is a type with nowhere to put one.
 *
 * The rules are parsed out of doc 11 at test time, and the per-trade bounds out of the
 * recorded metadata. Nothing normative is restated in this file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';

import {
  BOOK_DOMAIN_COPY,
  LEDGER_FROZEN_BIT,
  MARKET_READS,
  MarketTrade,
  MixedPinError,
  QUOTE_COPY,
  QUOTE_DISAGREEMENT_RECOVERY,
  QUOTE_FEE_LABEL,
  REAPED_BOOK_COPY,
  ledgerFrozen,
  orderTotal,
  readMarketTrade,
  tradeBlocks,
  tradingEnabled,
  type MarketDecoders,
  type MarketKeys,
  type MarketReadParams,
  type MarketReader,
  type MarketTradeRead,
  type MarketTradeScreen,
} from '@bleavit/features-tx';
import type { Finalized, StorageItem } from '@bleavit/chain-client';
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString, Verified } from '@bleavit/shared-types';
import { maxTradeAmount } from '@bleavit/protocol';

import {
  DISABLED_BUTTON,
  DOC_02,
  DOC_11,
  architecture,
  declarationOf,
  recordedScalar,
  recordedU32Pair,
  theLineContaining,
  txSource,
} from './spec-sources.ts';

const CHAIN: HexString = `0x${'ce'.repeat(32)}`;
const BLOCK: HexString = `0x${'11'.repeat(32)}`;
const AT = { chain: CHAIN, blockHash: BLOCK, blockNumber: 42 };
/** A second finalized block, for the readings a caller may bring from the wrong one. */
const LATER = { chain: CHAIN, blockHash: `0x${'22'.repeat(32)}` as HexString, blockNumber: 43 };

/**
 * A finalized reading at the reader's pin, as the composition root supplies one.
 *
 * `finalize` from `@bleavit/chain-client/testing` and not a hand-written status object:
 * production code cannot name it (`no-finalized-minting-outside-chain-client`), and a
 * fixture that hand-built one would be a fixture that could not tell whether the module
 * under test had stopped needing the brand.
 */
const at = <T,>(value: T): Finalized<T> => finalize(value, AT);

/** A `provider` reading — what a caller must NOT be able to launder into a precondition. */
function providerRead<T>(value: T): Verified<T> {
  return { value, status: { kind: 'provider', providerId: 'operator-1', sampled: false } };
}

/* --------------------------------------------------------------- the chain's own constants */

const MIN_TRADE = recordedScalar('constant.market.min_trade');
const [MAX_TRADE_NUM, MAX_TRADE_DEN] = recordedU32Pair('constant.market.max_trade_ratio');
const FEE_BPS = recordedScalar('constant.market.fee');
const BOUNDS = {
  minTrade: MIN_TRADE,
  maxTradeNumerator: MAX_TRADE_NUM,
  maxTradeDenominator: MAX_TRADE_DEN,
};

test('the recorded per-trade bounds are usable ones, not zeroes', () => {
  // Anti-vacuity for every bounds assertion below: a zero `MinTrade` admits everything and a
  // zero ratio admits nothing, and both make the interesting comparisons pass by accident.
  assert.ok(MIN_TRADE > 0n, 'MinTrade recorded as zero');
  assert.ok(MAX_TRADE_NUM > 0n && MAX_TRADE_DEN > 0n, 'MaxTradeRatio recorded as a degenerate');
  assert.ok(FEE_BPS > 0n, 'the recorded market fee is zero, so no fee row can fail');
});

/* --------------------------------------------------------------------- the document bindings */

test('the trading bit is 02 §7.3’s bit 5, read by NAME rather than by index', () => {
  // A bit assignment is wire format frozen in the contract — the same class as a call index —
  // and `PhaseFlags` is a bitset with no ordering, which is what V-115 records. The bit is
  // therefore looked up by its declared name, so a reassignment in the contract fails here
  // rather than silently inverting the trading gate.
  const sentence = /Bit assignments: ([^|]+?); bits 8–31 reserved/.exec(architecture(DOC_02));
  assert.ok(sentence?.[1] !== undefined, '02 §7.3 states no bit assignments');
  const declared = new Map(
    sentence[1].split(',').map((part) => {
      const [bit, name] = part.split('=').map((piece) => piece.trim());
      return [name as string, Number(bit)] as const;
    }),
  );
  assert.equal(declared.size, 8, `parsed ${JSON.stringify([...declared])}`);
  const bit = declared.get('ledger frozen (PB-LEDGER-FREEZE)');
  assert.ok(bit !== undefined, '02 §7.3 assigns no ledger-frozen bit');
  assert.equal(LEDGER_FROZEN_BIT, 1 << bit);
});

test('the freeze bit reads as a bit, and the trading gate is its complement', () => {
  // Both numeric readings of a bitset are wrong in an unsafe direction, so neither is used:
  // a real value with high bits set must not read as *frozen*, and the freeze bit alone must.
  assert.equal(ledgerFrozen(LEDGER_FROZEN_BIT), true);
  assert.equal(tradingEnabled(LEDGER_FROZEN_BIT), false);
  assert.equal(ledgerFrozen(0), false);
  assert.equal(tradingEnabled(0), true);
  // Bits 0–4 and 6–7 set, bit 5 clear: trading is enabled and a numeric comparison would not
  // say so (`0xDF >= 32` is true).
  assert.equal(ledgerFrozen(0xdf), false);
  assert.ok(0xdf >= LEDGER_FROZEN_BIT, 'the witness must be a value a comparison gets wrong');
});

test('11 §11.5’s reaped-book rule states all three MUSTs this screen implements', () => {
  const line = theLineContaining(architecture(DOC_11), 'MUST label the book **reaped/archived**');
  assert.match(line, /MUST NOT render a missing or fail-closed zero quote as a market price/);
  assert.match(line, /MUST disable every trade action on it/);
  assert.match(line, /present mapping with an absent or mismatched book is corrupt chain state/);
});

test('no arm of this screen has a field an in-Trade preview could occupy', () => {
  // §11.2's own sentence, parsed for the terms it forbids. S2 made this structural by giving
  // its pre-decision arm no statistics field; S3 has no arm with one at all, which is a claim
  // about the declaration rather than about any render.
  const line = theLineContaining(architecture(DOC_11), 'other in-Trade preview derived from it');
  assert.match(line, /MUST render no projected uplift, projected PASS\/REJECT/);

  const declaration = declarationOf(txSource('market-trade.tsx'), 'MarketTradeScreen');
  for (const forbidden of ['uplift', 'projected', 'decisionStats', 'preview', 'pass', 'reject']) {
    assert.doesNotMatch(
      declaration,
      new RegExp(forbidden, 'i'),
      `MarketTradeScreen mentions "${forbidden}"`,
    );
  }
  // The declaration was really found, or the loop above holds over an empty string.
  assert.match(declaration, /readonly kind: 'tradable'/);
  assert.match(declaration, /readonly kind: 'reaped'/);
});

test('E6 makes FE-CHAIN-005 a block with no client-side recovery, and this screen agrees', () => {
  const line = theLineContaining(architecture(DOC_11), '**E6 Viewing an active market.**');
  const code = /\*\*`(FE-CHAIN-\d+)`\*\*/.exec(line);
  assert.ok(code?.[1] !== undefined, 'E6 names no failure code');
  assert.match(line, /trading is \*\*blocked\*\*, not warned about/);
  assert.match(line, /R: none client-side/);
  // The screen's own copy says the same thing to the user: there is nothing to retry.
  assert.match(QUOTE_DISAGREEMENT_RECOVERY, /nothing to retry/i);
  // And the code the screen renders is the document's, not a second spelling of it.
  assert.ok(txSource('market-trade.tsx').includes(`'${code[1]}'`), `${code[1]} is not the code used`);
});

test('§11.2a rule 3: the hosted-book copy denies governance participation outright', () => {
  const rule = theLineContaining(
    architecture(DOC_11),
    'copy MUST NOT imply that trading a hosted book participates in governing Bleavit',
  );
  assert.match(rule, /External activity is never presented as governance or protocol health/);

  // Silence is what a reader fills in from context — every other book on this screen is a
  // governance market — so the service copy says what it is *not*.
  assert.match(BOOK_DOMAIN_COPY.service.note, /does not participate in governing Bleavit/);
  assert.notEqual(BOOK_DOMAIN_COPY.service.label, BOOK_DOMAIN_COPY.primary.label);
  // And the primary copy must not carry the denial, or the assertion above is about neither.
  assert.doesNotMatch(BOOK_DOMAIN_COPY.primary.note, /does not participate/);
});

/* ------------------------------------------------------------------------- the read layer */

const KEYS: MarketKeys = {
  market: (bookId) => `key:markets:${bookId}`,
  baselineMarketOf: (epoch) => `key:baseline-of:${epoch}`,
  marketsPrefix: () => 'prefix:markets',
  phaseFlags: () => 'key:phase-flags',
};

/** Each decoder refuses the others' marker, so a swapped call site is a visible failure. */
const DECODERS: MarketDecoders = {
  market: (raw) => {
    if (raw.startsWith('bad')) return { ok: false, reason: 'not a MarketBook' };
    const [marker, open, qLong, qShort, b] = raw.split(':');
    if (marker !== 'book') return { ok: false, reason: `the book decoder was handed "${raw}"` };
    return {
      ok: true,
      value: {
        open: open === 'open',
        book: { qLong: BigInt(qLong ?? '0'), qShort: BigInt(qShort ?? '0'), b: BigInt(b ?? '0') },
      },
    };
  },
  baselineMarketOf: (raw) => {
    if (raw.startsWith('bad')) return { ok: false, reason: 'not a MarketId' };
    const [marker, id] = raw.split(':');
    if (marker !== 'maps-to') return { ok: false, reason: `the mapping decoder was handed "${raw}"` };
    return { ok: true, value: BigInt(id ?? '0') };
  },
  quote: (raw) => {
    if (raw.startsWith('bad')) return { ok: false, reason: 'not a QuoteView' };
    // Two fields, decoded separately, because 02 §4 publishes two — see the cost/fee tests.
    const [marker, cost, fee] = raw.split(':');
    if (marker !== 'quote') return { ok: false, reason: `the quote decoder was handed "${raw}"` };
    return { ok: true, value: { cost: BigInt(cost ?? '0'), fee: BigInt(fee ?? '0') } };
  },
  phaseFlags: (raw) =>
    raw.startsWith('bad') ? { ok: false, reason: 'not a u32' } : { ok: true, value: Number(raw) },
};

interface CallLog {
  readonly calls: { api: string; storagePrefix: string; argsHex?: string }[];
  readonly storage: string[];
}

const B = 100_000_000_000n;
/** 02 §4's two fields, not their sum — the whole point of the pair below. */
const COST = 5_000_000n;
const FEE = 15_000n;
const QUOTE = { cost: COST, fee: FEE } as const;
/** `cost + fee` on a buy, and the amount `max_cost` must cover (04 §6.1 step 4). */
const BUY_TOTAL = COST + FEE;

function reader(
  values: Readonly<Record<string, string>>,
  quoteResult: string,
  log: CallLog,
): MarketReader {
  return {
    at: AT,
    async storage(key: string): Promise<Finalized<readonly StorageItem[]>> {
      log.storage.push(key);
      const value = values[key];
      return finalize(value === undefined ? [] : [{ key, value }], AT);
    },
    async crossCheckedCall(source) {
      log.calls.push({ ...source });
      return finalize({ result: quoteResult, witness: [] as readonly StorageItem[] }, AT);
    },
  };
}

const LIVE_BOOK = { 'key:markets:7': `book:open:0:0:${B}`, 'key:phase-flags': '0' } as const;

const DECISION: MarketReadParams = {
  bookId: at(7n),
  book: { kind: 'decision', domain: 'primary' },
  // Drafted at exactly the refreshed charge, so the bound is satisfiable and every
  // slippage test moves one side of it deliberately.
  order: { direction: 'buy', maxCost: BUY_TOTAL },
  proposalState: at('Trading'),
  amount: 5_000_000n,
  quoteArgsHex: '0xdeadbeef',
  clientQuote: QUOTE,
  feeMetadataBps: at(FEE_BPS),
  feeParamsPerbill: at(FEE_BPS * 100_000n),
  bounds: at(BOUNDS),
  spendable: at(1_000_000_000n),
};

/** The same ticket, sold: the seller delivers positions and receives `cost − fee`. */
const SELL: MarketReadParams = {
  ...DECISION,
  order: { direction: 'sell', minProceeds: COST - FEE },
};

const BASELINE: MarketReadParams = (() => {
  const { proposalState: _unused, ...rest } = DECISION;
  return {
    ...rest,
    bookId: at(9n),
    book: { kind: 'baseline', domain: 'primary' },
    epoch: at(4),
  };
})();

async function readTicket(
  values: Readonly<Record<string, string>> = LIVE_BOOK,
  params: MarketReadParams = DECISION,
  quoteResult = `quote:${COST}:${FEE}`,
): Promise<{ read: MarketTradeRead; log: CallLog }> {
  const log: CallLog = { calls: [], storage: [] };
  const read = await readMarketTrade(reader(values, quoteResult, log), KEYS, DECODERS, params);
  return { read, log };
}

function tradable(read: MarketTradeRead): Extract<MarketTradeScreen, { kind: 'tradable' }> {
  assert.equal(read.kind, 'screen');
  if (read.kind !== 'screen') throw new Error('unreachable');
  assert.equal(read.screen.kind, 'tradable');
  if (read.screen.kind !== 'tradable') throw new Error('unreachable');
  return read.screen;
}

test('a live decision book yields a tradable ticket with no blocking rows', async () => {
  // The anti-vacuity control for every refusal below: the happy path must actually pass, or
  // a screen that blocked everything would satisfy all of them.
  const { read } = await readTicket();
  assert.deepEqual([...tradeBlocks(tradable(read).inputs)], []);
});

test('quote() is admitted only alongside the Market.Markets prefix it must agree with', async () => {
  // 10 §4.2's FE-P2 conservative default. The prefix is the client's own witness for a
  // runtime-API result on the transaction path, and it is read at the same pin.
  const { log } = await readTicket();
  assert.deepEqual(log.calls, [
    { api: MARKET_READS.quote, storagePrefix: KEYS.marketsPrefix(), argsHex: DECISION.quoteArgsHex },
  ]);
});

test('MaxTrade is DERIVED from this book’s b and the chain ratio, never a constant', async () => {
  // 02 §9 freezes the ratio, not a ceiling: the ceiling depends on the book. Computed through
  // `packages/protocol`'s own function so the client cannot acquire a second implementation
  // of a bound — including of its two degenerate cases, which return zero rather than throw.
  const { read } = await readTicket();
  const { inputs } = tradable(read);
  assert.equal(inputs.maxTrade.value, maxTradeAmount(B, BOUNDS));
  assert.equal(inputs.maxTrade.value, (B * MAX_TRADE_NUM) / MAX_TRADE_DEN);
  assert.equal(inputs.minTrade.value, MIN_TRADE);
  // A different book gives a different ceiling, or the equality above is a coincidence.
  const { read: smaller } = await readTicket({ ...LIVE_BOOK, 'key:markets:7': 'book:open:0:0:8000' });
  assert.notEqual(tradable(smaller).inputs.maxTrade.value, inputs.maxTrade.value);
});

test('an absent Baseline mapping AND an absent book is reaped, and carries no book at all', async () => {
  const { read } = await readTicket({ 'key:phase-flags': '0' }, BASELINE);
  assert.equal(read.kind, 'screen');
  if (read.kind !== 'screen') return;
  assert.equal(read.screen.kind, 'reaped');
  if (read.screen.kind !== 'reaped') return;
  assert.equal(read.screen.epoch.value, 4);
  // No quote, no book, no inputs: there is no field a fail-closed zero could occupy.
  assert.deepEqual(Object.keys(read.screen).sort(), ['epoch', 'kind']);
});

test('a reaped read never reaches quote(), so no zero quote can be produced to render', async () => {
  const { log } = await readTicket({ 'key:phase-flags': '0' }, BASELINE);
  assert.deepEqual(log.calls, [], 'a reaped book was priced');
});

test('every other mapping/book combination is CORRUPT, not reaped', async () => {
  // §11.5: "A present mapping with an absent or mismatched book is corrupt chain state and
  // triggers the compatibility hard block." Reap removes both atomically, so each of these
  // states is unreachable from a completed reap and must not wear the reaped label.
  const baseline = BASELINE;
  const cases: readonly [string, Readonly<Record<string, string>>][] = [
    ['mapping absent, book present', { 'key:markets:9': `book:open:0:0:${B}`, 'key:phase-flags': '0' }],
    ['mapping present, book absent', { 'key:baseline-of:4': 'maps-to:9', 'key:phase-flags': '0' }],
    [
      'mapping present, pointing elsewhere',
      {
        'key:baseline-of:4': 'maps-to:11',
        'key:markets:9': `book:open:0:0:${B}`,
        'key:phase-flags': '0',
      },
    ],
  ];
  for (const [label, values] of cases) {
    const { read } = await readTicket(values, baseline);
    assert.equal(read.kind, 'corrupt', label);
    if (read.kind !== 'corrupt') continue;
    assert.match(read.detail, /11 §11\.5|corrupt chain state/, label);
  }
});

test('a Baseline ticket with no epoch refuses instead of reading nothing', async () => {
  // Without the epoch there is no mapping to consult, so "reaped" and "live" are the same
  // read. Answering either way would be a guess about a book that pays out.
  const { epoch: _absent, ...noEpoch } = BASELINE;
  const { read } = await readTicket(LIVE_BOOK, noEpoch);
  assert.equal(read.kind, 'corrupt');
});

test('a decision book with no Markets row is corrupt, never an empty price', async () => {
  const { read } = await readTicket({ 'key:phase-flags': '0' });
  assert.equal(read.kind, 'corrupt');
});

test('an unreadable PhaseFlags fails CLOSED — frozen, not enabled', async () => {
  // INV-FE-12: unread and undecodable collapse to one answer, and the unsafe direction here
  // is offering a trade the runtime refuses after the user has signed.
  for (const flags of [undefined, 'bad']) {
    const values: Record<string, string> = { 'key:markets:7': `book:open:0:0:${B}` };
    if (flags !== undefined) values['key:phase-flags'] = flags;
    const { read } = await readTicket(values);
    const { inputs } = tradable(read);
    assert.equal(inputs.tradingEnabled.value, false, String(flags));
    assert.equal(inputs.ledgerFrozen.value, true, String(flags));
    assert.equal(read.kind === 'screen' ? read.undecodable.length : 0, 1, String(flags));
    const blocks = tradeBlocks(inputs).map((block) => block.check);
    assert.ok(blocks.includes('P-1 PhaseFlags') && blocks.includes('P-1 PB-LEDGER-FREEZE'));
  }
});

test('an undecodable quote charges zero, which cannot agree with a real recompute', async () => {
  // The dangerous alternative is a ticket that passes on a figure nobody read. Zero is not a
  // price here — it is a value that cannot equal the client's non-zero recompute, so
  // FE-CHAIN-005 fires and the ticket blocks. Both fields go to zero, not just the total.
  const { read } = await readTicket(LIVE_BOOK, DECISION, 'bad');
  const { inputs } = tradable(read);
  assert.deepEqual(inputs.quote.fromChain.value, { cost: 0n, fee: 0n });
  assert.ok(tradeBlocks(inputs).some((block) => block.code === 'FE-CHAIN-005'));
  assert.equal(read.kind === 'screen' ? read.undecodable.length : 0, 1);
});

test('every figure carries the reader’s one pin', async () => {
  const { read } = await readTicket();
  const screen = tradable(read);
  const leaves = [
    screen.inputs.marketOpen,
    screen.inputs.quote.fromChain,
    screen.inputs.minTrade,
    screen.inputs.maxTrade,
    screen.inputs.tradingEnabled,
    screen.inputs.ledgerFrozen,
    screen.quote.fromChain.cost,
    screen.quote.fromChain.fee,
    screen.quote.fromChain.total,
  ];
  for (const leaf of leaves) {
    assert.equal(leaf.status.kind, 'verified-finalized');
    assert.ok('blockHash' in leaf.status && leaf.status.blockHash === BLOCK);
  }
  // The client's own recompute is `Combined`, because it is derived from more than one read.
  assert.equal(screen.quote.fromClient.total.kind, 'stated');
  assert.equal(screen.bookId.kind, 'stated');
});

/* ------------------------------------------------- what the leaves are, and where they came from */

test('the S3 reader mints no provenance of its own — every leaf descends from a read', () => {
  // V-182. A local `finalized` helper wrapped any value in a hand-written
  // `verified-finalized` status: brand-less, structurally a `Verified<T>`, and applied to
  // nine values — two caller-supplied inputs the chain was never asked about, and two more
  // the payload of caller-supplied `Verified<T>`s whose own status it discarded. Neither
  // `check:casts` nor the render gate can see that shape (the first looks for an assertion,
  // the second for a `.status` access), so what covers it is this assertion over the source.
  const source = txSource('market-reads.ts');
  assert.doesNotMatch(
    source,
    /kind:\s*'verified-finalized'/,
    'market-reads.ts constructs a verification status of its own',
  );
  assert.doesNotMatch(source, /\bas\s+Finalized</, 'market-reads.ts asserts the brand');
  // And the sanctioned derivations really are what it uses, or the two assertions above
  // hold over a module that has stopped producing finalized leaves altogether.
  assert.match(source, /\bderive\(/);
  assert.match(source, /\bmeet\(/);
});

test('a caller-supplied reading from another block is refused, not combined', async () => {
  // §11.4 pins one B′ per gate. A `MinTrade` read at B′+1 stamped with B′'s pin is a row
  // that is true of a state nobody observed, and no badge on the screen can express that.
  //
  // Both kinds of leaf are exercised deliberately. `bounds` is *combined* with the book
  // read, so `meet` refuses it whatever this module checks; `spendable` is passed straight
  // through and nothing downstream would notice — which is what the up-front check covers.
  for (const patch of [
    { bounds: finalize(BOUNDS, LATER) },
    { spendable: finalize(1_000_000_000n, LATER) },
    { feeMetadataBps: finalize(FEE_BPS, LATER) },
  ]) {
    await assert.rejects(
      readTicket(LIVE_BOOK, { ...DECISION, ...patch }),
      (error: unknown) => error instanceof MixedPinError,
      Object.keys(patch)[0],
    );
  }
  // Both directions of the same rule: the reader's own pin passes.
  await assert.doesNotReject(readTicket(LIVE_BOOK, DECISION));
});

test('the book id and the epoch render under the CALLER’s provenance, never re-stamped', async () => {
  // Neither is a read this module makes: a decision book's id comes from a proposal record
  // and a Baseline epoch from cohort history (§11.5's own sentence). The helper that used to
  // stamp both with the reader's pin turned a provider-served id into a verified one, which
  // is INV-FE-1's promotion performed by a formatting convenience.
  const { read } = await readTicket(LIVE_BOOK, { ...DECISION, bookId: providerRead(7n) });
  const screen = tradable(read);
  assert.equal(screen.bookId.kind, 'stated');
  if (screen.bookId.kind !== 'stated') return;
  assert.equal(screen.bookId.datum.status.kind, 'provider');
  assert.equal(screen.bookId.datum.value, '7');

  const { read: reaped } = await readTicket(
    { 'key:phase-flags': '0' },
    { ...BASELINE, epoch: providerRead(4) },
  );
  assert.equal(reaped.kind, 'screen');
  if (reaped.kind !== 'screen' || reaped.screen.kind !== 'reaped') return;
  assert.equal(reaped.screen.epoch.status.kind, 'provider');
});

test('cost and fee are read APART, so a pair that agrees on the total still blocks', async () => {
  // 02 §4 publishes two fields and 04 §6.1 combines them differently per direction. A chain
  // answer of (cost 5,001,000, fee 14,000) and a client answer of (5,000,000, 15,000) agree
  // on a buy's total to the base unit and disagree on a sell's net by 2,000. A reader that
  // decoded one summed charge could not produce this test at all.
  const chain = { cost: COST + 1_000n, fee: FEE - 1_000n };
  assert.equal(orderTotal('buy', chain), orderTotal('buy', QUOTE), 'the fixture must agree');
  assert.notEqual(orderTotal('sell', chain), orderTotal('sell', QUOTE));

  const { read } = await readTicket(LIVE_BOOK, DECISION, `quote:${chain.cost}:${chain.fee}`);
  const { inputs } = tradable(read);
  assert.deepEqual(inputs.quote.fromChain.value, chain);
  const disagreement = tradeBlocks(inputs).find((block) => block.code === 'FE-CHAIN-005');
  assert.ok(disagreement !== undefined, 'a quote disagreeing field-by-field was admitted');
});

test('the direction is threaded from the caller — a sell is not evaluated as a buy', async () => {
  // The slippage row compares the refreshed quote against the bound this ticket encodes, and
  // the two directions bound opposite sides. A defaulted direction would read a sale's floor
  // as a purchase's ceiling and pass every ticket whose net happened to be small.
  const { read: buy } = await readTicket();
  assert.equal(tradable(buy).inputs.order.direction, 'buy');
  assert.deepEqual([...tradeBlocks(tradable(buy).inputs)], []);

  const { read: sell } = await readTicket(LIVE_BOOK, SELL);
  assert.equal(tradable(sell).inputs.order.direction, 'sell');
  assert.deepEqual([...tradeBlocks(tradable(sell).inputs)], []);

  // A floor one base unit above the net refuses, and the same figures as a buy do not.
  const { read: tooHigh } = await readTicket(LIVE_BOOK, {
    ...SELL,
    order: { direction: 'sell', minProceeds: COST - FEE + 1n },
  });
  assert.deepEqual(
    tradeBlocks(tradable(tooHigh).inputs).map((block) => block.check),
    ['P-1 slippage bound'],
  );
});

/* ------------------------------------------------------------------------------ the render */

const UNIT = { decimals: 6, symbol: 'USDC' } as const;

function markupOf(screen: MarketTradeScreen): string {
  return renderToStaticMarkup(
    h(MarketTrade, { screen, ...UNIT, onTrade: () => undefined }),
  );
}

test('the reaped arm renders no price, no symbol and no trade control', async () => {
  const { read } = await readTicket({ 'key:phase-flags': '0' }, BASELINE);
  assert.equal(read.kind, 'screen');
  if (read.kind !== 'screen') return;
  const html = markupOf(read.screen);

  assert.ok(html.includes(REAPED_BOOK_COPY), 'the reaped/archived label is missing');
  assert.match(html, /archived/i);
  // The three MUSTs, mechanically: no trade action, and no figure in the traded asset. A
  // fail-closed zero would render as "0.000000 USDC".
  assert.equal(html.includes('<button'), false, 'a reaped book offered a trade action');
  assert.equal(html.includes(UNIT.symbol), false, 'a reaped book rendered a price');
  assert.equal(html.includes('0.000000'), false, 'a reaped book rendered a zero quote');
});

test('the tradable arm labels the domain the DATUM established, not the call site', async () => {
  for (const domain of ['primary', 'service'] as const) {
    const { read } = await readTicket(LIVE_BOOK, {
      ...DECISION,
      book: { kind: 'decision', domain },
    });
    const html = markupOf(tradable(read));
    assert.ok(html.includes(BOOK_DOMAIN_COPY[domain].label), `${domain}: label missing`);
    assert.ok(html.includes(BOOK_DOMAIN_COPY[domain].note), `${domain}: note missing`);
    const other = domain === 'primary' ? 'service' : 'primary';
    assert.equal(
      html.includes(BOOK_DOMAIN_COPY[other].label),
      false,
      `${domain}: the ${other} label rendered too`,
    );
  }
});

test('both quotes render, as two figures — never one averaged number', async () => {
  const { read } = await readTicket();
  const html = markupOf(tradable(read));
  assert.ok(html.includes(QUOTE_COPY.buy.chain), html);
  assert.ok(html.includes(QUOTE_COPY.buy.client), html);
  // 5.015000 = cost + fee at six decimals, twice: the chain's total and the client's.
  assert.equal([...html.matchAll(/5\.015000 USDC/g)].length, 2);
});

test('02 §4’s two fields render APART on both sides, with 04 §6.1’s combination', async () => {
  // The old screen rendered one `Amount` per side. Two offsetting differences sum to the
  // same number, so a user comparing one figure per side would see agreement for a pair
  // that blocks the ticket — and on a sale the fee moves the payout the other way.
  const { read } = await readTicket();
  const html = markupOf(tradable(read));
  for (const label of [QUOTE_COPY.buy.cost, QUOTE_FEE_LABEL, QUOTE_COPY.buy.total]) {
    assert.equal(
      [...html.matchAll(new RegExp(`>${label}<`, 'g'))].length,
      2,
      `${label} did not render once per side`,
    );
  }
  // The figures themselves, each twice — cost, fee and the buy's total, all distinct.
  assert.equal([...html.matchAll(/5\.000000 USDC/g)].length, 2, 'the cost is missing');
  assert.equal([...html.matchAll(/0\.015000 USDC/g)].length, 2, 'the fee is missing');
  assert.equal([...html.matchAll(/5\.015000 USDC/g)].length, 2, 'the total is missing');
});

test('a sale renders 04 §6.1’s OTHER combination, and says so in the labels', async () => {
  // `cost + fee` on a buy, `cost − fee` on a sell. One label set would be wrong for
  // whichever direction it was not written for, and "total debited" over a payout is a
  // sentence that reverses the sign of the trade in the user's head.
  const { read } = await readTicket(LIVE_BOOK, SELL);
  const html = markupOf(tradable(read));
  assert.ok(html.includes(QUOTE_COPY.sell.chain), html);
  assert.ok(html.includes(QUOTE_COPY.sell.cost), 'the sell-side cost label is missing');
  assert.ok(html.includes(QUOTE_COPY.sell.total), 'the sell-side net label is missing');
  assert.equal(html.includes(QUOTE_COPY.buy.total), false, 'a sale rendered a buy’s total');
  // 4.985000 = cost − fee, and the buy's 5.015000 must not appear anywhere on a sale.
  assert.equal([...html.matchAll(/4\.985000 USDC/g)].length, 2);
  assert.equal(html.includes('5.015000 USDC'), false, 'a sale rendered cost + fee');
});

test('FE-CHAIN-005 renders as a refusal with a recovery, and disables the control', async () => {
  // E6: blocked, not warned about. A red notice among the others would lose the one thing
  // that is different about this failure — that the user has nothing to retry.
  const { read } = await readTicket(LIVE_BOOK, {
    ...DECISION,
    clientQuote: { cost: COST, fee: FEE + 1n },
  });
  const html = markupOf(tradable(read));
  assert.ok(html.includes('data-code="FE-CHAIN-005"'), html);
  assert.ok(html.includes(QUOTE_DISAGREEMENT_RECOVERY), 'the refusal carries no recovery');
  assert.match(html, DISABLED_BUTTON, 'trading was not blocked');
  // And it is not *also* rendered as an ordinary danger notice, which would say the same
  // thing twice in two registers.
  assert.equal(html.includes('data-severity="danger"'), false);
});

test('every failing row renders, not the first — a user with three problems sees three', async () => {
  // §11.4 rule 5's discipline. Stopping at the first shows one obstacle per signing attempt.
  const { read } = await readTicket(
    { 'key:markets:7': `book:closed:0:0:${B}`, 'key:phase-flags': String(LEDGER_FROZEN_BIT) },
    { ...DECISION, amount: MIN_TRADE - 1n, spendable: at(0n) },
  );
  const { inputs } = tradable(read);
  const blocks = tradeBlocks(inputs);
  assert.ok(blocks.length >= 4, `only ${blocks.length} rows refused`);
  const html = markupOf(tradable(read));
  const notices = [...html.matchAll(/data-severity="danger"/g)].length;
  assert.equal(notices, blocks.filter((block) => block.code === undefined).length);
  assert.match(html, DISABLED_BUTTON);
});

test('with nothing refusing, the control is enabled and no danger notice renders', async () => {
  // The complement of the two tests above, so neither passes for a screen that always blocks.
  const html = markupOf(tradable((await readTicket()).read));
  assert.doesNotMatch(html, DISABLED_BUTTON);
  assert.equal(html.includes('data-severity="danger"'), false);
  assert.equal(html.includes('data-code='), false);
});
