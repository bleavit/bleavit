/**
 * The redemption ticket — 11 §11.5 rules 1–5, over 03 §5.3/§5.3a.
 *
 * `app/tests/protocol` already certifies the *arithmetic* against the generated corpus. What
 * is asserted here is the layer above it: which call is charged, whether the rate may be
 * quoted at all, and what a screen is therefore permitted to display. Every one of those is a
 * decision the corpus cannot make and a screen can get wrong while every number is right.
 *
 * Two bindings do the load-bearing work, and neither restates a claim beside the code:
 *
 * - the charged/exempt verdict is parsed out of **03 §5.3's own `Fee (§5.3a)` column**, and
 * - the same verdict is parsed out of **11 §11.5 rule 1's own prose**, independently.
 *
 * Three statements of one claim, so no two of them can agree by construction.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHARGED_CALLS,
  EXEMPTIONS,
  PAIR_CALLS,
  feeThreshold,
  isCharged,
  isPairCall,
  mayPrepareRedemption,
  quoteRedemption,
  redemptionRateBlocks,
  type PayoutCall,
  type RedemptionRateReadings,
} from '@bleavit/features-tx';
import { redemptionAmounts, redemptionAmountsPair } from '@bleavit/protocol';
import type { HexString, Verified } from '@bleavit/shared-types';

const here = dirname(fileURLToPath(import.meta.url));
const DOC_03 = resolve(here, '../../../docs/architecture/03-conditional-ledger.md');
const DOC_11 = resolve(here, '../../../docs/architecture/11-frontend-workflows.md');

const CHAIN: HexString = `0x${'ce'.repeat(32)}`;
const BLOCK: HexString = `0x${'11'.repeat(32)}`;

function verified<T>(value: T, blockHash: HexString = BLOCK, blockNumber = 42): Verified<T> {
  return { value, status: { kind: 'verified-finalized', chain: CHAIN, blockHash, blockNumber } };
}

/**
 * The two chain values these rules turn on, read where the client reads them.
 *
 * Typed constants were the first version and were wrong in a way that made a test pass for
 * no reason: an invented `min_split` of 1,000,000 waives the fee on every amount 03 §5.3a's
 * worked examples use, so the pair-vs-flat comparison compared two zeroes. Reading the
 * recorded metadata instead means the fixtures are the chain's own figures and the worked
 * examples in the specification are reproducible against them.
 */
function constantFromFixture(surface: string): bigint {
  const path = resolve(here, `../../fixtures/chainhead/${surface}.json`);
  const recorded: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const requests = (recorded as { requests: { method: string; response?: { expected_layout?: { value?: string } } }[] })
    .requests;
  const value = requests.find((row) => row.method === 'metadata_presence')?.response?.expected_layout
    ?.value;
  assert.ok(value !== undefined, `${surface} records no constant value`);
  const bytes = value.replace(/^0x/, '').match(/../g);
  assert.ok(bytes !== null, `${surface} has no readable encoding`);
  return BigInt(`0x${[...bytes].reverse().join('')}`);
}

/** `ConditionalLedger::RedemptionFee` in basis points, and its `Perbill` counterpart. */
const FEE_BPS = constantFromFixture('constant.ledger.redemption_fee');
const RATE_30BPS = FEE_BPS * 100_000n;
/** `ConditionalLedger::MinSplit` `[C]` — the floor the §5.3a(2) waiver is defined against. */
const MIN_SPLIT = constantFromFixture('constant.ledger.min_split');

test('the recorded constants are the ones 03 §5.3a’s worked examples use', () => {
  // Anti-vacuity for every fee assertion below. A zero rate charges nothing and a huge
  // `min_split` waives everything, and both make the interesting tests pass by accident.
  assert.equal(FEE_BPS, 30n, 'the recorded redemption fee is not the 30 bps the doc works in');
  assert.equal(MIN_SPLIT, 10_000n, 'the recorded MinSplit is not the one the doc works in');
});

/**
 * Both published forms of a rate, agreeing under 02 §9 rule 4's floored projection.
 *
 * No default parameters, deliberately: an earlier version defaulted `perbill` and
 * `rates(undefined)` therefore produced the **30 bps** readings rather than the unread ones,
 * so the *"an unreadable rate is not a zero rate"* assertion silently tested the happy path.
 * Passing `undefined` explicitly triggers a default in JavaScript, which is exactly the shape
 * of fixture that makes a test agree with itself.
 */
function rates(perbill: bigint, bps: bigint = perbill / 100_000n): RedemptionRateReadings {
  return { metadataBps: verified(bps), paramsPerbill: verified(perbill) };
}

/** Neither form readable — 11 §11.5 rule 5's first condition. */
const UNREAD_RATE: RedemptionRateReadings = { metadataBps: undefined, paramsPerbill: undefined };

// ------------------------------------------------------- the classification, bound twice

/** 03 §5.3's `Fee (§5.3a)` column, keyed by call name. Same parse `tests/protocol` uses. */
function docThreeVerdicts(): ReadonlyMap<string, 'charged' | 'exempt'> {
  const verdicts = new Map<string, 'charged' | 'exempt'>();
  for (const line of readFileSync(DOC_03, 'utf8').split('\n')) {
    if (!line.startsWith('| `redeem')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length !== 8) continue;
    const call = cells[1]?.replace(/`/g, '').replace(/\(.*$/, '');
    const feeCell = cells[5] ?? '';
    const charged = /\bcharged\b/.test(feeCell);
    const exempt = /\bexempt\b/.test(feeCell);
    // An ambiguous cell read as `charged` would apply a fee to an exempt call, which breaks
    // the par promise G-3 depends on. Refusing beats picking.
    assert.ok(call !== undefined && charged !== exempt, `03 §5.3 fee column unreadable: ${line}`);
    verdicts.set(call, charged ? 'charged' : 'exempt');
  }
  return verdicts;
}

/**
 * 11 §11.5 rule 1's own sentence, parsed independently of doc 03.
 *
 * *"The deduction applies to `ledger.redeem_scalar`, `redeem_scalar_pair`, `redeem_gate`,
 * `redeem_baseline` and `redeem_baseline_pair`."*
 */
function docElevenChargedSet(): readonly string[] {
  const text = readFileSync(DOC_11, 'utf8');
  const line = text
    .split('\n')
    .find((row) => row.includes('**Scope — the charged set, and nothing else.**'));
  assert.ok(line !== undefined, '11 §11.5 rule 1 is missing');
  // Terminated on the *next sentence*, not on the next `.`: the first period in the
  // sentence is the one inside `ledger.redeem_scalar`, and an earlier version matched that
  // and produced an empty set — which would have made every comparison below vacuous.
  const sentence = /The deduction applies to (.*?)\. It MUST NOT/.exec(line);
  assert.ok(sentence?.[1] !== undefined, 'rule 1 states no charged set');
  return [...sentence[1].matchAll(/`(?:ledger\.)?([a-z_]+)`/g)].map((match) => match[1] as string);
}

test('the charged set agrees with both documents, and neither is this code', () => {
  const fromEleven = docElevenChargedSet();
  assert.deepEqual([...CHARGED_CALLS], fromEleven);

  const fromThree = docThreeVerdicts();
  // Anti-vacuity: a parse that found nothing would make every comparison below trivially
  // true, which is exactly how a "documented" claim stops being one.
  assert.ok(fromThree.size >= 7, `03 §5.3 yielded only ${fromThree.size} rows`);
  for (const [call, verdict] of fromThree) {
    assert.equal(
      isCharged(call as PayoutCall),
      verdict === 'charged',
      `${call}: 03 §5.3 says ${verdict}`,
    );
  }
  // Both directions: every call this client calls charged must be charged in doc 03 too.
  for (const call of CHARGED_CALLS) {
    assert.equal(fromThree.get(call), 'charged', `${call} is charged here and not in 03 §5.3`);
  }
});

test('every merge primitive is exempt, and 03 §5.3 does not list it — a stated boundary', () => {
  const fromThree = docThreeVerdicts();
  for (const call of ['merge', 'merge_scalar', 'merge_gate'] as const) {
    // §5.3a(1)'s prose, not the §5.3 table: that table is "Redemption calls" and the
    // mint/burn primitives are not in it. Asserting the absence keeps that a boundary the
    // suite states rather than a gap it silently steps over.
    assert.equal(fromThree.has(call), false, `03 §5.3 unexpectedly lists ${call}`);
    assert.equal(isCharged(call), false);
    assert.ok(EXEMPTIONS[call].length > 0, `${call} has no stated exemption`);
  }
});

test('the pair set is the two calls whose fee base is their legs', () => {
  assert.deepEqual([...PAIR_CALLS], ['redeem_scalar_pair', 'redeem_baseline_pair']);
  for (const call of PAIR_CALLS) assert.ok(isPairCall(call), call);
  assert.equal(isPairCall('redeem_scalar'), false);
});

// ---------------------------------------------------------------- the exempt arm's shape

test('an exempt quote has no fee and no net field at all', () => {
  const quote = quoteRedemption({
    call: 'redeem',
    gross: verified(10_000_000n),
    rate: rates(RATE_30BPS),
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(quote.kind, 'exempt');
  // §11.5 rule 1: the deduction MUST NOT be applied, shown, **or implied**. The strongest
  // form of that is a value with nowhere to put one.
  assert.equal('fee' in quote, false, 'an exempt quote carried a fee');
  assert.equal('net' in quote, false, 'an exempt quote carried a net');
  assert.equal(quote.gross.kind, 'stated');
  assert.equal(quote.gross.kind === 'stated' ? quote.gross.datum.value : undefined, 10_000_000n);
});

test('an unreadable rate does not block an exempt redemption', () => {
  // §11.5 rule 5 disables "the net-payout figure". An exempt call has none: its payout is
  // the gross, at par, by a rule that never mentions the rate. Blocking here would refuse
  // the par leg G-3 is stated about — a client refusing what the runtime accepts.
  for (const call of ['redeem', 'redeem_void', 'merge', 'merge_scalar', 'merge_gate'] as const) {
    const quote = quoteRedemption({
      call,
      gross: verified(7n),
      rate: { metadataBps: undefined, paramsPerbill: undefined },
      minSplit: undefined,
    });
    assert.equal(quote.kind, 'exempt', `${call} was blocked by an unreadable redemption rate`);
    assert.ok(mayPrepareRedemption(quote), call);
  }
});

// --------------------------------------------------------------- the charged arm's rules

test('a charged quote leads with net, and net + fee reconstruct gross', () => {
  const gross = 10_000_000n;
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(gross),
    rate: rates(RATE_30BPS),
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(quote.kind, 'charged');
  if (quote.kind !== 'charged') return;
  // The arithmetic is `packages/protocol`'s, certified against the corpus. What is asserted
  // here is that this layer did not recompute it.
  const expected = redemptionAmounts(gross, RATE_30BPS, MIN_SPLIT);
  const stated = (combined: typeof quote.net): bigint =>
    combined.kind === 'stated' ? combined.datum.value : -1n;
  assert.equal(stated(quote.net), expected.net);
  assert.equal(stated(quote.gross), expected.gross);
  assert.equal(stated(quote.fee), expected.fee);
  assert.equal(stated(quote.net) + stated(quote.fee), gross);
  assert.ok(expected.fee > 0n, 'the fixture waives the fee, so this proves nothing');
});

test('the waiver is the net-based one, on the boundary band the doc names', () => {
  // §11.5 rule 2's worked example: at 30 bps a gross of 10,000 has a provisional fee of 30,
  // and the runtime waives it because 10,000 − 30 < min_split. A gross test (g < min_split)
  // would charge it. This is ordinary traffic, not an edge.
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(10_000n),
    rate: rates(RATE_30BPS),
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(quote.kind, 'charged');
  if (quote.kind !== 'charged') return;
  assert.equal(quote.fee.kind === 'stated' ? quote.fee.datum.value : -1n, 0n);
  assert.equal(quote.net.kind === 'stated' ? quote.net.datum.value : -1n, 10_000n);
});

test('a pair charges what its legs would charge, not fee(a)', () => {
  // 03 §5.3a(2a)'s own worked example: a = 20,000, s = 0.70005, 30 bps.
  const amount = 20_000n;
  const s = 700_050_000n;
  const quote = quoteRedemption({
    call: 'redeem_scalar_pair',
    gross: verified(amount),
    settlementScore: verified(s),
    rate: rates(RATE_30BPS),
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(quote.kind, 'charged');
  if (quote.kind !== 'charged') return;
  const pair = redemptionAmountsPair(amount, s, RATE_30BPS, MIN_SPLIT);
  const flat = redemptionAmounts(amount, RATE_30BPS, MIN_SPLIT);
  assert.equal(quote.fee.kind === 'stated' ? quote.fee.datum.value : -1n, pair.fee);
  // The fixture must actually distinguish the two, or this test passes for the wrong reason.
  assert.notEqual(pair.fee, flat.fee, 'the fixture does not separate fee_pair from fee(a)');
});

test('a pair without its settlement score refuses rather than falling back to fee(a)', () => {
  for (const call of PAIR_CALLS) {
    const quote = quoteRedemption({
      call,
      gross: verified(20_000n),
      rate: rates(RATE_30BPS),
      minSplit: verified(MIN_SPLIT),
    });
    assert.equal(quote.kind, 'unavailable', `${call} quoted without a score`);
    if (quote.kind !== 'unavailable') continue;
    assert.match(quote.reason, /5\.3a\(2a\)|settlement score/);
  }
});

test('a settlement score on a call whose base is its gross is refused', () => {
  // Supplied-and-ignored is the dangerous form: the figure would be right today and wrong
  // the moment somebody wires it in, and nothing would have flagged the mismatch.
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(20_000n),
    settlementScore: verified(500_000_000n),
    rate: rates(RATE_30BPS),
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(quote.kind, 'unavailable');
  const exempt = quoteRedemption({
    call: 'redeem',
    gross: verified(20_000n),
    settlementScore: verified(500_000_000n),
    rate: rates(RATE_30BPS),
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(exempt.kind, 'unavailable');
});

// ------------------------------------------------------------------- §11.5 rule 5's rows

test('an unreadable or disagreeing rate blocks a charged redemption, per row', () => {
  const cases: readonly [string, RedemptionRateReadings, RegExp][] = [
    ['metadata unread', { metadataBps: undefined, paramsPerbill: verified(RATE_30BPS) }, /RedemptionFee/],
    ['params unread', { metadataBps: verified(30n), paramsPerbill: undefined }, /params\(ledger\.redeem_fee\)/],
    // 02 §9 rule 4's floored projection: 3,000,000 perbill projects to 30 bps, so 31 is a
    // genuine disagreement rather than a rounding artefact.
    ['disagreement', { metadataBps: verified(31n), paramsPerbill: verified(RATE_30BPS) }, /disagree/],
  ];
  for (const [label, rate, pattern] of cases) {
    const blocks = redemptionRateBlocks(rate, verified(MIN_SPLIT));
    assert.ok(blocks.length > 0, `${label} produced no block`);
    assert.ok(blocks.some((block) => pattern.test(block.detail)), `${label}: ${JSON.stringify(blocks)}`);
    const quote = quoteRedemption({
      call: 'redeem_scalar',
      gross: verified(10_000_000n),
      rate,
      minSplit: verified(MIN_SPLIT),
    });
    assert.equal(quote.kind, 'unavailable', label);
    assert.equal(mayPrepareRedemption(quote), false, label);
  }
  // The agreeing case must produce nothing, or the rows above pass for the wrong reason.
  assert.deepEqual([...redemptionRateBlocks(rates(RATE_30BPS), verified(MIN_SPLIT))], []);
});

test('an unread MinSplit blocks, because the waiver is defined against it', () => {
  const blocks = redemptionRateBlocks(rates(RATE_30BPS), undefined);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0]?.detail ?? '', /MinSplit/);
});

test('an out-of-domain rate renders a refusal, never a number', () => {
  // 03 §5.3a(5) has the runtime **waive** the fee on an unparseable record; 11 §11.5 rule 5
  // requires the client to do the opposite. `redemptionAmounts` throws for that reason, and
  // this is where the throw becomes data a screen can render.
  const outOfDomain = 1_000_000_001n;
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(10_000_000n),
    // Both published forms agree — so the only thing wrong is the domain, and the rate rows
    // above cannot be what refuses it.
    rate: rates(outOfDomain, outOfDomain / 100_000n),
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(quote.kind, 'unavailable');
  if (quote.kind !== 'unavailable') return;
  assert.match(quote.reason, /Perbill domain/);
  assert.equal(mayPrepareRedemption(quote), false);
});

test('figures read at two different blocks refuse rather than claiming one', () => {
  // INV-FE-2's property, arriving through `combine`: a fee computed from a gross at block A
  // and a rate at block B is true of neither, and there is no status that says so.
  const other: HexString = `0x${'22'.repeat(32)}`;
  const quote = quoteRedemption({
    call: 'redeem_scalar',
    gross: verified(10_000_000n),
    rate: {
      metadataBps: verified(30n, other, 43),
      paramsPerbill: verified(RATE_30BPS, other, 43),
    },
    minSplit: verified(MIN_SPLIT),
  });
  assert.equal(quote.kind, 'charged');
  if (quote.kind !== 'charged') return;
  for (const figure of [quote.net, quote.gross, quote.fee]) {
    assert.equal(figure.kind, 'incomparable');
  }
});

// ------------------------------------------------------------------------ the threshold

test('the fee threshold has three arms, and unknown is not never', () => {
  const above = feeThreshold(rates(RATE_30BPS), verified(MIN_SPLIT), 10_000_000n);
  assert.equal(above.kind, 'above');
  if (above.kind === 'above') {
    // §5.3a(2b): the smallest charged gross nets exactly `min_split`.
    assert.equal(above.gross - redemptionAmounts(above.gross, RATE_30BPS, MIN_SPLIT).fee, MIN_SPLIT);
  }

  // A 100 % rate charges nothing at all, because every gross nets zero and zero is below
  // `min_split`. That is a reachable state, not an error.
  assert.equal(feeThreshold(rates(1_000_000_000n, 10_000n), verified(MIN_SPLIT), 10_000_000n).kind, 'never');

  // And "the rate could not be read" must never render as "no fee applies".
  const unknown = feeThreshold(UNREAD_RATE, verified(MIN_SPLIT), 10_000_000n);
  assert.equal(unknown.kind, 'unknown');
});
