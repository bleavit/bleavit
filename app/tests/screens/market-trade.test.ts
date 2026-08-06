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
  QUOTE_DISAGREEMENT_RECOVERY,
  REAPED_BOOK_COPY,
  ledgerFrozen,
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

function verified<T>(value: T): Verified<T> {
  return { value, status: { kind: 'verified-finalized', ...AT } };
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
    const [marker, charge] = raw.split(':');
    if (marker !== 'quote') return { ok: false, reason: `the quote decoder was handed "${raw}"` };
    return { ok: true, value: { charge: BigInt(charge ?? '0') } };
  },
  phaseFlags: (raw) =>
    raw.startsWith('bad') ? { ok: false, reason: 'not a u32' } : { ok: true, value: Number(raw) },
};

interface CallLog {
  readonly calls: { api: string; storagePrefix: string; argsHex?: string }[];
  readonly storage: string[];
}

const B = 100_000_000_000n;
const CHARGE = 5_015_000n;

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
  bookId: 7n,
  book: { kind: 'decision', domain: 'primary' },
  proposalState: verified('Trading'),
  amount: 5_000_000n,
  quoteArgsHex: '0xdeadbeef',
  clientCharge: CHARGE,
  feeMetadataBps: verified(FEE_BPS),
  feeParamsPerbill: verified(FEE_BPS * 100_000n),
  bounds: verified(BOUNDS),
  spendable: verified(1_000_000_000n),
};

async function readTicket(
  values: Readonly<Record<string, string>> = LIVE_BOOK,
  params: MarketReadParams = DECISION,
  quoteResult = `quote:${CHARGE}`,
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
  const { read } = await readTicket(
    { 'key:phase-flags': '0' },
    {
      ...DECISION,
      bookId: 9n,
      book: { kind: 'baseline', domain: 'primary' },
      proposalState: undefined,
      epoch: 4,
    },
  );
  assert.equal(read.kind, 'screen');
  if (read.kind !== 'screen') return;
  assert.equal(read.screen.kind, 'reaped');
  if (read.screen.kind !== 'reaped') return;
  assert.equal(read.screen.epoch.value, 4);
  // No quote, no book, no inputs: there is no field a fail-closed zero could occupy.
  assert.deepEqual(Object.keys(read.screen).sort(), ['epoch', 'kind']);
});

test('a reaped read never reaches quote(), so no zero quote can be produced to render', async () => {
  const { log } = await readTicket(
    { 'key:phase-flags': '0' },
    {
      ...DECISION,
      bookId: 9n,
      book: { kind: 'baseline', domain: 'primary' },
      proposalState: undefined,
      epoch: 4,
    },
  );
  assert.deepEqual(log.calls, [], 'a reaped book was priced');
});

test('every other mapping/book combination is CORRUPT, not reaped', async () => {
  // §11.5: "A present mapping with an absent or mismatched book is corrupt chain state and
  // triggers the compatibility hard block." Reap removes both atomically, so each of these
  // states is unreachable from a completed reap and must not wear the reaped label.
  const baseline: MarketReadParams = {
    ...DECISION,
    bookId: 9n,
    book: { kind: 'baseline', domain: 'primary' },
    proposalState: undefined,
    epoch: 4,
  };
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
  const { read } = await readTicket(LIVE_BOOK, {
    ...DECISION,
    book: { kind: 'baseline', domain: 'primary' },
    proposalState: undefined,
  });
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
  // FE-CHAIN-005 fires and the ticket blocks.
  const { read } = await readTicket(LIVE_BOOK, DECISION, 'bad');
  const { inputs } = tradable(read);
  assert.equal(inputs.quote.chargeFromChain.value, 0n);
  assert.ok(tradeBlocks(inputs).some((block) => block.code === 'FE-CHAIN-005'));
  assert.equal(read.kind === 'screen' ? read.undecodable.length : 0, 1);
});

test('every figure carries the reader’s one pin', async () => {
  const { read } = await readTicket();
  const screen = tradable(read);
  const leaves = [
    screen.bookId,
    screen.inputs.marketOpen,
    screen.inputs.quote.chargeFromChain,
    screen.inputs.maxTrade,
    screen.inputs.tradingEnabled,
  ];
  for (const leaf of leaves) {
    assert.equal(leaf.status.kind, 'verified-finalized');
    assert.ok('blockHash' in leaf.status && leaf.status.blockHash === BLOCK);
  }
  // The client's own recompute is `Combined`, because it is derived from more than one read.
  assert.equal(screen.clientCharge.kind, 'stated');
});

/* ------------------------------------------------------------------------------ the render */

const UNIT = { decimals: 6, symbol: 'USDC' } as const;

function markupOf(screen: MarketTradeScreen): string {
  return renderToStaticMarkup(
    h(MarketTrade, { screen, ...UNIT, onTrade: () => undefined }),
  );
}

test('the reaped arm renders no price, no symbol and no trade control', async () => {
  const { read } = await readTicket(
    { 'key:phase-flags': '0' },
    {
      ...DECISION,
      bookId: 9n,
      book: { kind: 'baseline', domain: 'primary' },
      proposalState: undefined,
      epoch: 4,
    },
  );
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
  assert.ok(html.includes('What the chain says this costs'), html);
  assert.ok(html.includes('What this client recomputes'), html);
  // 5,015,000 base units at six decimals, twice: the chain's and the client's.
  assert.equal([...html.matchAll(/5\.015000 USDC/g)].length, 2);
});

test('FE-CHAIN-005 renders as a refusal with a recovery, and disables the control', async () => {
  // E6: blocked, not warned about. A red notice among the others would lose the one thing
  // that is different about this failure — that the user has nothing to retry.
  const { read } = await readTicket(LIVE_BOOK, { ...DECISION, clientCharge: CHARGE + 1n });
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
    { ...DECISION, amount: MIN_TRADE - 1n, spendable: verified(0n) },
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
