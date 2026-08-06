/**
 * The S3 trade ticket's precondition rows — 11 §11.5 P-1 and P-2.
 *
 * Every test here is a refusal, because a precondition layer that only proves the
 * happy path proves nothing: the whole point is to refuse before the user pays a
 * fee for a transaction the runtime was always going to reject.
 *
 * Two properties get more attention than the rest — the fee cross-check and the
 * quote agreement — because they are the two rows where the client can be
 * confidently wrong: both fee surfaces read fine and disagree, or the quote reads
 * fine and is a base unit off, and in each case every other row is green.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mayPrepareTrade,
  perbillToBps,
  tradeBlocks,
  type ProposalState,
  type TradeInputs,
} from '@bleavit/features-tx';
import type { HexString, Verified } from '@bleavit/shared-types';

const here = dirname(fileURLToPath(import.meta.url));
const DOC_11 = resolve(here, '../../../docs/architecture/11-frontend-workflows.md');

const TEST_CHAIN = `0x${'ce'.repeat(32)}` as HexString;

/** A finalized reading, shaped as the render layer receives one. */
const at = <T,>(value: T): Verified<T> => ({
  value,
  status: { kind: 'verified-finalized', chain: TEST_CHAIN, blockHash: '0xdead', blockNumber: 1000 },
});

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
    proposalState: at<ProposalState>('Trading'),
    marketOpen: at(true),
    fee: { metadataBps: at(30n), paramsPerbill: at(3_000_000n) },
    quote: { chargeFromChain: at(1_003_000n), chargeFromClient: 1_003_000n },
    amount: 1_000_000n,
    minTrade: at(10_000n),
    maxTrade: at(50_000_000n),
    spendable: at(5_000_000n),
    tradingEnabled: at(true),
    ledgerFrozen: at(false),
    ...patch,
  };
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

test('a clean decision ticket has no blocks, so every refusal below is the row named', () => {
  // Anti-vacuity. Without this, a fixture broken in some unrelated way would make
  // every "this refuses" test pass for the wrong reason.
  assert.deepEqual(tradeBlocks(decisionTicket()), []);
  assert.equal(mayPrepareTrade(decisionTicket()), true);
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
  for (const clientCharge of [1_002_999n, 1_003_001n]) {
    const blocked = tradeBlocks(
      decisionTicket({ quote: { chargeFromChain: at(1_003_000n), chargeFromClient: clientCharge } }),
    );
    assert.deepEqual(blocked.map((row) => row.code), ['FE-CHAIN-005']);
  }
});

test('the balance is checked against the charge, not the amount', () => {
  // On a buy the two differ by the fee. Checking the amount passes a trade the
  // runtime refuses for want of the last few base units — after the user signed.
  const inputs = decisionTicket({
    amount: 1_000_000n,
    quote: { chargeFromChain: at(1_003_000n), chargeFromClient: 1_003_000n },
    spendable: at(1_000_000n),
  });
  assert.deepEqual(checks(inputs), ['P-1 balance']);
  // Exactly the charge is enough; the check is not a strict inequality.
  assert.deepEqual(tradeBlocks({ ...inputs, spendable: at(1_003_000n) }), []);
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
    'FE-CHAIN-005',
    'per-trade min/max',
    'PhaseFlags',
    'PB-LEDGER-FREEZE',
  ]) {
    assert.ok(row.includes(phrase), `P-1 no longer mentions ${phrase}`);
  }
});
