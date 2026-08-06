/**
 * The S3 trade ticket's precondition rows — 11 §11.5 P-1 and P-2.
 *
 * Every test here is a refusal, because a precondition layer that only proves the
 * happy path proves nothing: the whole point is to refuse before the user pays a
 * fee for a transaction the runtime was always going to reject.
 *
 * Four properties get more attention than the rest, because each is a case where
 * every other row reads green and the ticket is still wrong: the fee cross-check
 * (both surfaces read fine and disagree), the quote agreement (the quote reads fine
 * and is a base unit off), the slippage bound (the draft was written against a
 * quote that has since moved) and the sell-side balance (the holdings are checked
 * against the wrong quantity, in the wrong asset).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mayPrepareTrade,
  orderTotal,
  perbillToBps,
  tradeBlocks,
  type ProposalState,
  type TradeInputs,
} from '@bleavit/features-tx';
import type { FinalizedBlockRef } from '@bleavit/chain-client';
// `finalize` is test-only on purpose — see packages/chain-client/src/testing.ts.
import { finalize } from '@bleavit/chain-client/testing';
import type { HexString } from '@bleavit/shared-types';

const here = dirname(fileURLToPath(import.meta.url));
const DOC_11 = resolve(here, '../../../docs/architecture/11-frontend-workflows.md');

const TEST_CHAIN = `0x${'ce'.repeat(32)}` as HexString;

/** B′ — the single finalized pin every row of one gate is read at (11 §11.4). */
const B_PRIME: FinalizedBlockRef = {
  chain: TEST_CHAIN,
  blockHash: `0x${'11'.repeat(32)}` as HexString,
  blockNumber: 1_000,
};

/** A second finalized block, for the one property a type cannot carry. */
const LATER: FinalizedBlockRef = {
  chain: TEST_CHAIN,
  blockHash: `0x${'22'.repeat(32)}` as HexString,
  blockNumber: 1_001,
};

/** A finalized reading at B′, as the precondition layer receives one. */
const at = <T,>(value: T) => finalize(value, B_PRIME);

/**
 * The inputs a ticket may legitimately be missing — every one of them a read the
 * client might not have performed.
 */
type OptionalTicketKey =
  | 'proposalState'
  | 'baselineBookPresent'
  | 'baselineWindowOpen'
  | 'baselineVaultOpen';

/**
 * The same ticket with one read absent.
 *
 * Written as a key removal rather than `{ ...ticket, key: undefined }`, which
 * `exactOptionalPropertyTypes` refuses — and rightly: *absent* and *present and
 * undefined* are different states, and the one these tests mean is absent.
 */
function without(inputs: TradeInputs, key: OptionalTicketKey): TradeInputs {
  const { [key]: _omitted, ...rest } = inputs;
  return rest;
}

function decisionTicket(patch: Partial<TradeInputs> = {}): TradeInputs {
  return {
    book: { kind: 'decision', domain: 'primary' },
    // Drafted at exactly the charge below, so the bound is satisfiable and every
    // slippage test moves one side of it deliberately.
    order: { direction: 'buy', maxCost: 1_003_000n },
    proposalState: at<ProposalState>('Trading'),
    marketOpen: at(true),
    fee: { metadataBps: at(30n), paramsPerbill: at(3_000_000n) },
    quote: {
      fromChain: at({ cost: 1_000_000n, fee: 3_000n }),
      fromClient: { cost: 1_000_000n, fee: 3_000n },
    },
    amount: 1_000_000n,
    minTrade: at(10_000n),
    maxTrade: at(50_000_000n),
    spendable: at(5_000_000n),
    tradingEnabled: at(true),
    ledgerFrozen: at(false),
    ...patch,
  };
}

/** The same book, sold. The seller delivers positions and receives net USDC. */
function sellTicket(patch: Partial<TradeInputs> = {}): TradeInputs {
  return decisionTicket({
    order: { direction: 'sell', minProceeds: 990_000n },
    // `cost` is what the wrapper pays before the fee it withholds (02 §4).
    quote: {
      fromChain: at({ cost: 1_000_000n, fee: 3_000n }),
      fromClient: { cost: 1_000_000n, fee: 3_000n },
    },
    ...patch,
  });
}

function baselineTicket(patch: Partial<TradeInputs> = {}): TradeInputs {
  const { proposalState: _unused, ...rest } = decisionTicket();
  return {
    ...rest,
    book: { kind: 'baseline', domain: 'primary' },
    baselineBookPresent: at(true),
    baselineWindowOpen: at(true),
    baselineVaultOpen: at(true),
    ...patch,
  };
}

const checks = (inputs: TradeInputs): string[] => tradeBlocks(inputs).map((row) => row.check);

test('a clean ticket has no blocks, so every refusal below is the row named', () => {
  // Anti-vacuity. Without this, a fixture broken in some unrelated way would make
  // every "this refuses" test pass for the wrong reason.
  assert.deepEqual(tradeBlocks(decisionTicket()), []);
  assert.equal(mayPrepareTrade(decisionTicket()), true);
  assert.deepEqual(tradeBlocks(sellTicket()), []);
  assert.deepEqual(tradeBlocks(baselineTicket()), []);
});

test('P-1 admits Trading and Extended, and nothing else (D-8 cut forecast trading)', () => {
  for (const state of ['Trading', 'Extended'] as const) {
    assert.deepEqual(tradeBlocks(decisionTicket({ proposalState: at(state) })), []);
  }
  for (const state of ['Submitted', 'Deciding', 'Resolved', 'Settled', 'Voided'] as const) {
    const blocked = checks(decisionTicket({ proposalState: at<ProposalState>(state) }));
    assert.ok(
      blocked.includes('P-1 proposal state'),
      `${state} must block: a book that still quoted after resolution sells an uncreatable claim`,
    );
  }
});

test('an unread proposal state blocks — unread is not passed', () => {
  const blocked = tradeBlocks(without(decisionTicket(), 'proposalState'));
  assert.equal(blocked.length, 1);
  assert.match(blocked[0]?.detail ?? '', /not read/);
});

test('every row is read at one B′, and a ticket mixing two blocks is refused', () => {
  // The type carries the block but cannot compare two of them. Rows read at two
  // finalized blocks are each true and their conjunction describes a state that
  // never existed — and nothing on screen tells it apart from one that did.
  const mixed = decisionTicket({ spendable: finalize(5_000_000n, LATER) });
  const blocked = tradeBlocks(mixed);
  assert.deepEqual(blocked.map((row) => row.check), ['ticket pin']);
  // The message must name the leaf and both pins: "the ticket is inconsistent"
  // sends nobody anywhere.
  assert.match(blocked[0]?.detail ?? '', /the spendable balance at .*block 1001/);
  assert.match(blocked[0]?.detail ?? '', /block 1000/);
  // It fires on any leaf, including the optional P-2 reads, not just the one above.
  for (const patch of [
    { marketOpen: finalize(true, LATER) },
    { fee: { metadataBps: finalize(30n, LATER), paramsPerbill: at(3_000_000n) } },
    { minTrade: finalize(10_000n, LATER) },
  ] satisfies Partial<TradeInputs>[]) {
    assert.deepEqual(checks(decisionTicket(patch)), ['ticket pin']);
  }
  assert.deepEqual(
    checks(baselineTicket({ baselineVaultOpen: finalize(true, LATER) })),
    ['ticket pin'],
  );
});

test('the two published fee forms must agree under the 02 §9 rule 4 projection', () => {
  // Both surfaces read cleanly and disagree — the case where every other row is
  // green and the quote is nonetheless computed from a stale rate.
  const stale = decisionTicket({ fee: { metadataBps: at(30n), paramsPerbill: at(4_000_000n) } });
  const blocked = tradeBlocks(stale);
  assert.deepEqual(blocked.map((row) => row.check), ['P-1 fee cross-check']);
  // The message must name both readings; "the fee is wrong" sends an operator
  // nowhere, and neither surface is preferred on disagreement.
  assert.match(blocked[0]?.detail ?? '', /30 bps/);
  assert.match(blocked[0]?.detail ?? '', /40 bps/);
});

test('the projection floors, and the flooring is what makes 30 bps reachable', () => {
  assert.equal(perbillToBps(3_000_000n), 30n);
  // A rate between two basis points projects down, so an exact-division check
  // would refuse a lawful rate rather than compare it.
  assert.equal(perbillToBps(3_099_999n), 30n);
  assert.equal(perbillToBps(0n), 0n);
  assert.throws(() => perbillToBps(-1n), RangeError);
});

test('FE-CHAIN-005: a one-base-unit quote disagreement blocks trading', () => {
  // The direction that matters is the unsafe one — a client under the chain's
  // charge hands the user a transaction that reverts (04 §6.1 step 4) — but both
  // block, because either means the port and the runtime disagree.
  for (const clientCost of [999_999n, 1_000_001n]) {
    const blocked = tradeBlocks(
      decisionTicket({
        quote: {
          fromChain: at({ cost: 1_000_000n, fee: 3_000n }),
          fromClient: { cost: clientCost, fee: 3_000n },
        },
      }),
    );
    assert.deepEqual(blocked.map((row) => row.code), ['FE-CHAIN-005']);
  }
});

test('the quote is compared field by field, not as one total', () => {
  // `cost` and `fee` are two published fields (02 §4) and 04 §6.1 combines them
  // differently per direction. These two agree on a buy's `cost + fee` and differ
  // on a sell's `cost − fee`, so a summed comparison would pass one direction of a
  // disagreement that is a defect in both.
  const offsetting = {
    fromChain: at({ cost: 1_000_000n, fee: 3_000n }),
    fromClient: { cost: 1_000_001n, fee: 2_999n },
  };
  assert.equal(
    orderTotal('buy', offsetting.fromChain.value),
    orderTotal('buy', offsetting.fromClient),
  );
  assert.deepEqual(checks(decisionTicket({ quote: offsetting })), ['P-1 quote agreement']);
});

test('orderTotal debits the fee on a buy and withholds it on a sell (04 §6.1)', () => {
  const quote = { cost: 1_000_000n, fee: 3_000n };
  assert.equal(orderTotal('buy', quote), 1_003_000n);
  assert.equal(orderTotal('sell', quote), 997_000n);
});

test('P-1 rechecks max_cost against the refreshed quote', () => {
  // §11.5's own words: "recheck max_cost/min_proceeds still satisfiable". The draft
  // was written against an earlier quote; every other row here passes, and the
  // signed call would come back SlippageExceeded.
  const drifted = decisionTicket({ order: { direction: 'buy', maxCost: 1_002_000n } });
  const blocked = tradeBlocks(drifted);
  assert.deepEqual(blocked.map((row) => row.check), ['P-1 slippage bound']);
  assert.match(blocked[0]?.detail ?? '', /1003000/);
  assert.match(blocked[0]?.detail ?? '', /1002000/);
  // Exactly at the bound is satisfiable: 04 §6.1 step 4 refuses `cost + fee > max_cost`.
  assert.deepEqual(tradeBlocks(decisionTicket({ order: { direction: 'buy', maxCost: 1_003_000n } })), []);
  // And the ceiling binds on the total, not on the cost — a bound between the two
  // is exactly the case a fee-less comparison would wave through.
  assert.deepEqual(
    checks(decisionTicket({ order: { direction: 'buy', maxCost: 1_000_000n } })),
    ['P-1 slippage bound'],
  );
});

test('P-1 rechecks min_proceeds against the refreshed net, not the gross', () => {
  // `min_proceeds` bounds the USDC-equivalent **net** (04 §6.1), so a floor between
  // the gross and the net must block. Set against `cost` alone it would not.
  assert.deepEqual(
    checks(sellTicket({ order: { direction: 'sell', minProceeds: 998_000n } })),
    ['P-1 slippage bound'],
  );
  assert.deepEqual(tradeBlocks(sellTicket({ order: { direction: 'sell', minProceeds: 997_000n } })), []);
});

test('the buy balance is checked against the charge, not the amount', () => {
  // On a buy the two differ by the fee. Checking the amount passes a trade the
  // runtime refuses for want of the last few base units — after the user signed.
  const inputs = decisionTicket({ spendable: at(1_000_000n) });
  assert.deepEqual(checks(inputs), ['P-1 USDC balance']);
  // Exactly the charge is enough; the check is not a strict inequality.
  assert.deepEqual(tradeBlocks({ ...inputs, spendable: at(1_003_000n) }), []);
});

test('the sell balance is the position holding against the amount sold', () => {
  // P-1 reads "user USDC balance (buy) / position balance (sell)". On a sell the
  // holdings are positions and the quote is USDC proceeds, so comparing them
  // passes a seller who holds less than they are selling whenever the sale pays
  // less than they hold — and the runtime then rejects it for inventory.
  const short = sellTicket({
    amount: 1_000_000n,
    quote: {
      fromChain: at({ cost: 800_000n, fee: 2_400n }),
      fromClient: { cost: 800_000n, fee: 2_400n },
    },
    order: { direction: 'sell', minProceeds: 700_000n },
    spendable: at(900_000n),
  });
  assert.deepEqual(checks(short), ['P-1 position balance']);
  assert.match(tradeBlocks(short)[0]?.detail ?? '', /1000000 position units/);
  // Holding exactly the amount sold is enough, even though the proceeds are lower.
  assert.deepEqual(tradeBlocks({ ...short, spendable: at(1_000_000n) }), []);
});

test('per-trade bounds come from the constants API and bind on both sides', () => {
  assert.deepEqual(checks(decisionTicket({ amount: 9_999n, minTrade: at(10_000n) })), [
    'P-1 per-trade minimum',
  ]);
  assert.deepEqual(
    checks(decisionTicket({ amount: 50_000_001n, maxTrade: at(50_000_000n) })),
    ['P-1 per-trade maximum'],
  );
});

test('PhaseFlags and PB-LEDGER-FREEZE each block on their own', () => {
  assert.deepEqual(checks(decisionTicket({ tradingEnabled: at(false) })), ['P-1 PhaseFlags']);
  assert.deepEqual(checks(decisionTicket({ ledgerFrozen: at(true) })), ['P-1 PB-LEDGER-FREEZE']);
});

test('every failing row is reported, not just the first (11 §11.4 rule 5)', () => {
  // A gate that stopped at the first difference would show a user one obstacle
  // per signing attempt.
  const blocked = checks(
    decisionTicket({
      proposalState: at<ProposalState>('Resolved'),
      marketOpen: at(false),
      tradingEnabled: at(false),
      ledgerFrozen: at(true),
    }),
  );
  assert.deepEqual(blocked, [
    'P-1 proposal state',
    'P-1 market phase',
    'P-1 PhaseFlags',
    'P-1 PB-LEDGER-FREEZE',
  ]);
});

test('P-2: an absent Baseline book is reaped, never a book priced at zero', () => {
  const blocked = tradeBlocks(baselineTicket({ baselineBookPresent: at(false) }));
  assert.deepEqual(blocked.map((row) => row.check), ['P-2 Baseline book']);
  // §11.5's reaped-book paragraph: the UI must label it reaped/archived and must
  // not render the fail-closed zero quote as a market price.
  assert.match(blocked[0]?.detail ?? '', /reaped or archived/);
  assert.match(blocked[0]?.detail ?? '', /not a book with a zero price/);
});

test('P-2: each Baseline row fails closed when it was never read', () => {
  for (const key of ['baselineBookPresent', 'baselineWindowOpen', 'baselineVaultOpen'] as const) {
    const blocked = tradeBlocks(without(baselineTicket(), key));
    assert.equal(blocked.length, 1, `${key} unread must block exactly once`);
    assert.match(blocked[0]?.detail ?? '', /was not read/);
  }
});

test('P-2 takes the slippage recheck as P-1 does', () => {
  // §11.5's P-2 row reads "book state + slippage recheck as P-1", so the Baseline
  // book inherits the bound rather than trading without one.
  assert.deepEqual(
    checks(baselineTicket({ order: { direction: 'buy', maxCost: 1_002_000n } })),
    ['P-1 slippage bound'],
  );
});

test('a model that mixes the two books is refused rather than half-checked', () => {
  // A Baseline ticket carrying a proposal state, or a decision ticket carrying
  // P-2 reads, means the caller assembled one model from two. Either way some
  // rows would be evaluated against inputs that do not describe this book.
  assert.deepEqual(
    checks(baselineTicket({ proposalState: at<ProposalState>('Trading') })),
    ['book identity'],
  );
  assert.deepEqual(checks(decisionTicket({ baselineWindowOpen: at(true) })), ['book identity']);
});

test('a hosted book relaxes no row (11 §11.2a rule 4)', () => {
  // The domain is carried so the caller must have established it, and it changes
  // nothing here. Same inputs, both domains, identical verdicts.
  for (const kind of ['decision', 'gate'] as const) {
    const primary = decisionTicket({ book: { kind, domain: 'primary' } });
    const service = decisionTicket({ book: { kind, domain: 'service' } });
    assert.deepEqual(tradeBlocks(primary), tradeBlocks(service));
    const brokenPrimary = { ...primary, ledgerFrozen: at(true) };
    const brokenService = { ...service, ledgerFrozen: at(true) };
    assert.deepEqual(checks(brokenPrimary), checks(brokenService));
    assert.ok(checks(brokenService).length > 0, 'the comparison must not be between two empties');
  }
});

test('the module names no fee rate, bound or minimum of its own', () => {
  // app-code rule 7: every tunable is an argument. Asserted by absence with
  // comments stripped, since a compiled-in launch value is invisible until
  // governance moves the real one.
  const source = readFileSync(resolve(here, '../../src/features/tx/src/trade-ticket.ts'), 'utf8');
  const scannable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // 100_000n is the 02 §9 rule 4 projection divisor — a unit, not a tunable, and
  // the only numeric literal this module is allowed.
  const literals = [...new Set([...scannable.matchAll(/\b\d[\d_]*n\b/g)].map((m) => m[0]))];
  assert.deepEqual(literals.sort(), ['0n', '100_000n']);
});

test('the rows this module implements are the ones doc 11 §11.5 P-1 lists', () => {
  const text = readFileSync(DOC_11, 'utf8');
  const row = text.split('\n').find((line) => line.startsWith('| P-1 |'));
  assert.ok(row !== undefined, 'doc 11 §11.5 has no P-1 row');
  // Not a completeness proof — it is a tripwire on the phrases each check was
  // written from, so a spec amendment that removes one is not silently ignored.
  for (const phrase of [
    'Trading',
    'Extended',
    'max_cost',
    'min_proceeds',
    'still satisfiable',
    'FE-CHAIN-005',
    'position balance',
    'per-trade min/max',
    'PhaseFlags',
    'PB-LEDGER-FREEZE',
  ]) {
    assert.ok(row.includes(phrase), `P-1 no longer mentions ${phrase}`);
  }
});
