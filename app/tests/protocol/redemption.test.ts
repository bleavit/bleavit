/**
 * The redemption-fee differential — 03 §5.3a, 11 §11.5, 04 §5.
 *
 * Three artifacts are bound here and none of them is this file:
 *
 * * **doc 03 §5.3's own table** decides, per call, whether the fee applies. It is
 *   parsed out of the Markdown rather than restated, because a charged/exempt list
 *   written beside the port is a list that agrees with the port and with nothing
 *   else — and getting one entry wrong is the failure 03 §5.3a(1) spends five
 *   paragraphs on: charging the par leg falsifies G-3, D-3, I-2(b), I-5 and PT-2
 *   simultaneously.
 * * **the generated corpus** (`ledger_fee_scenarios`) supplies real replayed
 *   operations with the reference model's own `gross`/`fee`/`net`, at two rates
 *   and across every redemption call. Read in place per 04 §5's single-generator
 *   rule, through the same loader the LMSR differential uses.
 * * **`@bleavit/protocol`'s `redemption.ts`** is what is under test.
 *
 * A disagreement between any two of them fails, which is what makes this a
 * differential rather than a restatement. The suite additionally proves the two
 * places where the obvious implementation is wrong *in the corpus's own data*
 * rather than in a fixture written to make the point: that `fee(a)` on a pair
 * disagrees with `fee_pair(a)`, and that a gross-based waiver disagrees with the
 * net-based one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  PERBILL_ONE,
  RedemptionRateError,
  firstChargedGross,
  pairLegs,
  redemptionAmounts,
  redemptionAmountsPair,
  redemptionFee,
  redemptionFeePair,
} from '@bleavit/protocol';

import { type LedgerFeeOp, type LedgerFeeScenario, loadCorpus } from './corpus.ts';

const corpus = loadCorpus();
const scenarios = corpus.ledger_fee_scenarios;

const here = dirname(fileURLToPath(import.meta.url));
const DOC_03 = resolve(here, '../../../docs/architecture/03-conditional-ledger.md');

/** Whether 03 §5.3's table says the fee applies to a call. */
type FeeVerdict = 'charged' | 'exempt';

/**
 * The §5.3 table's `Fee (§5.3a)` column, keyed by call name.
 *
 * Parsed from the row's first cell (`` `redeem_scalar(pid, kind, a)` ``) and its
 * fifth. The fifth cell carries prose beside the verdict — *"**exempt** (par leg,
 * G-3)"* — so the verdict is matched as a word and a cell containing **both**
 * words, or neither, throws rather than picking one: an ambiguous verdict read
 * as `charged` would be a fee applied to an exempt call, which is the direction
 * that breaks the par promise.
 */
function feeVerdicts(): ReadonlyMap<string, FeeVerdict> {
  const text = readFileSync(DOC_03, 'utf8');
  const verdicts = new Map<string, FeeVerdict>();
  for (const line of text.split('\n')) {
    if (!line.startsWith('| `redeem')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    // `| call | origin | preconditions | gross | fee | event |` → 8 cells with
    // the empty edges. A row of another shape is not this table's.
    if (cells.length !== 8) continue;
    const call = cells[1]?.replace(/`/g, '').replace(/\(.*$/, '');
    const feeCell = cells[5] ?? '';
    const charged = /\bcharged\b/.test(feeCell);
    const exempt = /\bexempt\b/.test(feeCell);
    if (call === undefined || charged === exempt) {
      throw new Error(
        `03 §5.3's fee column is unreadable for ${call ?? 'an unnamed row'}: ${feeCell}`,
      );
    }
    verdicts.set(call, charged ? 'charged' : 'exempt');
  }
  return verdicts;
}

const VERDICTS = feeVerdicts();

/**
 * `merge*` is exempt by §5.3a(1)'s prose, not by the §5.3 table — that table is
 * *"Redemption calls"* and the mint/burn primitives are not in it. Named here
 * with its citation so the omission is a stated boundary rather than a gap.
 */
const MERGE_EXEMPT = new Set(['merge', 'merge_scalar', 'merge_gate', 'merge_baseline']);

/** The pair calls, whose fee base is their legs and not their gross (§5.3a(2a)). */
const PAIR_CALLS = new Set(['redeem_scalar_pair', 'redeem_baseline_pair']);

/** Operations that move no USDC to a claimant and therefore carry no figures. */
const NOT_A_PAYOUT = new Set([
  'split',
  'split_scalar',
  'split_gate',
  'split_baseline',
  'merge_scalar',
  'merge_gate',
  'resolve',
  'void',
  'settle_scalar',
  'settle_gate',
  'settle_baseline',
  'transfer',
  'sweep_dust',
  'sweep_redemption_fees',
]);

function big(value: number | undefined, what: string, where: string): bigint {
  if (value === undefined) {
    throw new Error(`${where}: expected ${what} on this operation and the corpus carries none`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${where}: ${what} = ${value} is not an exact integer`);
  }
  return BigInt(value);
}

/** The settlement score standing when `index` runs, from the preceding settle op. */
function scoreBefore(ops: readonly LedgerFeeOp[], index: number, where: string): bigint {
  for (let i = index - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (op !== undefined && (op.op === 'settle_scalar' || op.op === 'settle_baseline')) {
      return big(op.args.s, 'a settlement score', where);
    }
  }
  throw new Error(`${where}: a pair redemption with no settlement before it`);
}

interface Params {
  rate: bigint;
  minSplit: bigint;
  protocolAccounts: ReadonlySet<string>;
}

function paramsOf(scenario: LedgerFeeScenario): Params {
  return {
    rate: BigInt(scenario.params.redeem_fee_perbill),
    minSplit: BigInt(scenario.params.min_split),
    protocolAccounts: new Set(scenario.params.protocol_accounts),
  };
}

test('the fee corpus is present, current and exercises both verdicts', () => {
  // Anti-vacuity, in all three directions this suite depends on.
  assert.ok(scenarios.length > 0, 'the corpus carries no ledger_fee_scenarios');
  assert.ok(
    VERDICTS.size >= 7,
    `03 §5.3's table parsed to ${VERDICTS.size} calls; the section lists seven`,
  );
  const values = [...VERDICTS.values()];
  assert.ok(values.includes('charged'), 'no charged call parsed out of 03 §5.3');
  assert.ok(values.includes('exempt'), 'no exempt call parsed out of 03 §5.3');
  // Both rates must appear, or every row runs at one rate and the port could
  // ignore the argument entirely.
  const rates = new Set(scenarios.map((row) => row.params.redeem_fee_perbill));
  assert.ok(rates.size >= 2, `every scenario runs at one rate (${[...rates].join(', ')})`);
});

test('every charged single-leg redemption reproduces the corpus fee exactly', () => {
  let compared = 0;
  for (const scenario of scenarios) {
    const { rate, minSplit, protocolAccounts } = paramsOf(scenario);
    if (rate > PERBILL_ONE) continue; // covered by its own test below
    for (const [index, op] of scenario.ops.entries()) {
      const where = `${scenario.name} op ${index} (${op.op})`;
      if (NOT_A_PAYOUT.has(op.op) || PAIR_CALLS.has(op.op)) continue;
      if (VERDICTS.get(op.op) !== 'charged') continue;
      if (op.args.account !== undefined && protocolAccounts.has(op.args.account)) continue;
      const gross = big(op.gross, 'gross', where);
      const expected = big(op.fee, 'fee', where);
      const amounts = redemptionAmounts(gross, rate, minSplit);
      assert.equal(amounts.fee, expected, `${where}: fee`);
      assert.equal(amounts.net, big(op.net, 'net', where), `${where}: net`);
      compared += 1;
    }
  }
  assert.ok(compared >= 8, `only ${compared} charged single-leg redemptions compared`);
});

test('every charged pair redemption reproduces the corpus fee from its legs', () => {
  let compared = 0;
  for (const scenario of scenarios) {
    const { rate, minSplit, protocolAccounts } = paramsOf(scenario);
    if (rate > PERBILL_ONE) continue;
    for (const [index, op] of scenario.ops.entries()) {
      if (!PAIR_CALLS.has(op.op)) continue;
      const where = `${scenario.name} op ${index} (${op.op})`;
      assert.equal(VERDICTS.get(op.op), 'charged', `${where}: 03 §5.3 says this is not charged`);
      if (op.args.account !== undefined && protocolAccounts.has(op.args.account)) continue;
      const amount = big(op.args.amount, 'an amount', where);
      const sRaw = scoreBefore(scenario.ops, index, where);
      const amounts = redemptionAmountsPair(amount, sRaw, rate, minSplit);
      assert.equal(amounts.gross, big(op.gross, 'gross', where), `${where}: gross is exactly a`);
      assert.equal(amounts.fee, big(op.fee, 'fee', where), `${where}: fee_pair`);
      assert.equal(amounts.net, big(op.net, 'net', where), `${where}: net`);
      compared += 1;
    }
  }
  assert.ok(compared >= 2, `only ${compared} pair redemptions compared`);
});

test('fee(a) on a pair disagrees with fee_pair(a) in BOTH directions', () => {
  // §5.3a(2a)'s argument, proven against replayed data rather than a fixture
  // written to make the point — and the measurement corrected a claim this suite
  // first asserted. `fee(a)` does not merely overstate: it errs both ways, and
  // the corpus exercises both.
  //
  //   a = 20,000,    s = 0.70005: fee(a) = 60   vs fee_pair = 43   (over)
  //   a = 1,000,000, s = 0.70005: fee(a) = 3,000 vs fee_pair = 3,001 (under)
  //
  // The waiver produces the first — one leg falls under `min_split` and is
  // exempted entirely. Independent per-leg ceilings produce the second: two
  // roundings up can exceed one. **The under-charging direction is the dangerous
  // one for a client**, because a displayed fee below the chain's shows a net
  // *above* what the account receives, which is the one error 11 §11.5 rule 3's
  // headline figure must not make.
  let over = 0;
  let under = 0;
  for (const scenario of scenarios) {
    const { rate, minSplit } = paramsOf(scenario);
    if (rate > PERBILL_ONE) continue;
    for (const [index, op] of scenario.ops.entries()) {
      if (!PAIR_CALLS.has(op.op)) continue;
      const where = `${scenario.name} op ${index}`;
      const amount = big(op.args.amount, 'an amount', where);
      const sRaw = scoreBefore(scenario.ops, index, where);
      const combinedBase = redemptionFee(amount, rate, minSplit);
      const fromLegs = redemptionFeePair(amount, sRaw, rate, minSplit);
      if (combinedBase > fromLegs) over += 1;
      else if (combinedBase < fromLegs) under += 1;
    }
  }
  assert.ok(over > 0, 'no corpus pair row where fee(a) overstates the fee');
  assert.ok(under > 0, 'no corpus pair row where fee(a) understates the fee');
});

test('the pair path never pays less than leg-by-leg redemption, net (PT-7)', () => {
  // Asserted over the corpus's own scores and rates rather than a grid, so the
  // property is checked exactly where the reference model exercised it.
  for (const scenario of scenarios) {
    const { rate, minSplit } = paramsOf(scenario);
    if (rate > PERBILL_ONE) continue;
    for (const [index, op] of scenario.ops.entries()) {
      if (!PAIR_CALLS.has(op.op)) continue;
      const where = `${scenario.name} op ${index}`;
      const amount = big(op.args.amount, 'an amount', where);
      const sRaw = scoreBefore(scenario.ops, index, where);
      const legs = pairLegs(amount, sRaw);
      const netLegs =
        redemptionAmounts(legs.long, rate, minSplit).net +
        redemptionAmounts(legs.short, rate, minSplit).net;
      const netPair = redemptionAmountsPair(amount, sRaw, rate, minSplit).net;
      assert.ok(netPair >= netLegs, `${where}: pair net ${netPair} < leg-by-leg ${netLegs}`);
    }
  }
});

test('every exempt redemption the corpus replays charges nothing', () => {
  let compared = 0;
  for (const scenario of scenarios) {
    for (const [index, op] of scenario.ops.entries()) {
      const where = `${scenario.name} op ${index} (${op.op})`;
      const exemptByTable = VERDICTS.get(op.op) === 'exempt';
      const exemptByProse = MERGE_EXEMPT.has(op.op);
      if (!exemptByTable && !exemptByProse) continue;
      if (op.fee === undefined) continue; // `merge_scalar` mints and pays nothing
      assert.equal(big(op.fee, 'fee', where), 0n, `${where}: an exempt call was charged`);
      assert.equal(
        big(op.net, 'net', where),
        big(op.gross, 'gross', where),
        `${where}: net differs from gross on an exempt call`,
      );
      compared += 1;
    }
  }
  assert.ok(compared >= 3, `only ${compared} exempt payouts compared`);
});

test('a protocol account is exempt, and the exemption is not vacuous', () => {
  // §5.3a(1)'s last bullet. The skip in the tests above would hide a mismatch if
  // the arithmetic happened to return zero for these rows anyway, so this proves
  // the opposite: unexempted, they would have been charged.
  let proven = 0;
  for (const scenario of scenarios) {
    const { rate, minSplit, protocolAccounts } = paramsOf(scenario);
    if (protocolAccounts.size === 0 || rate > PERBILL_ONE) continue;
    for (const [index, op] of scenario.ops.entries()) {
      const where = `${scenario.name} op ${index} (${op.op})`;
      if (op.args.account === undefined || !protocolAccounts.has(op.args.account)) continue;
      if (VERDICTS.get(op.op) !== 'charged') continue;
      assert.equal(big(op.fee, 'fee', where), 0n, `${where}: a protocol account was charged`);
      const wouldCharge = redemptionFee(big(op.gross, 'gross', where), rate, minSplit);
      assert.ok(wouldCharge > 0n, `${where}: the exemption changes nothing here`);
      proven += 1;
    }
  }
  assert.ok(proven > 0, 'no corpus row exercises the protocol-account exemption');
});

test('a rate outside the Perbill domain refuses here and is waived on chain', () => {
  // The one deliberate divergence (11 §11.5 rule 5 against 03 §5.3a(5)), asserted
  // in both directions so it is a known difference rather than a latent bug.
  const outOfDomain = scenarios.filter((row) => row.params.redeem_fee_perbill > Number(PERBILL_ONE));
  assert.ok(outOfDomain.length > 0, 'the corpus carries no out-of-domain rate to diverge on');
  for (const scenario of outOfDomain) {
    assert.equal(
      scenario.fees_charged_total,
      0,
      `${scenario.name}: the chain is expected to waive an unreadable rate`,
    );
    assert.throws(
      () => redemptionFee(1_000_000n, BigInt(scenario.params.redeem_fee_perbill), 10_000n),
      RedemptionRateError,
      `${scenario.name}: the client must refuse a figure it cannot verify`,
    );
  }
});

test('the waived set is a prefix interval, and its threshold nets exactly min_split', () => {
  // §5.3a(2b). Rate and floor come from the corpus rather than being typed, so a
  // regenerated corpus at a different default moves this test with it.
  const defaults = scenarios.find(
    (row) => row.params.redeem_fee_perbill > 0 && row.params.redeem_fee_perbill <= Number(PERBILL_ONE),
  );
  assert.ok(defaults !== undefined, 'no in-domain non-zero rate in the corpus');
  const rate = BigInt(defaults.params.redeem_fee_perbill);
  const minSplit = BigInt(defaults.params.min_split);

  const threshold = firstChargedGross(rate, minSplit, minSplit * 1_000n);
  assert.ok(threshold !== undefined, 'no gross is ever charged at the corpus rate');
  assert.equal(redemptionFee(threshold - 1n, rate, minSplit), 0n, 'the gross below it is charged');
  assert.equal(
    redemptionAmounts(threshold, rate, minSplit).net,
    minSplit,
    'the first charged gross must net exactly ledger.min_split (§5.3a(2b))',
  );
  // Prefix interval: once charged, always charged. A second band would make the
  // threshold meaningless and any UI copy derived from it false.
  for (let gross = threshold; gross <= threshold + 5_000n; gross += 137n) {
    assert.ok(
      redemptionFee(gross, rate, minSplit) > 0n,
      `${gross} is above the threshold and was waived — §5.3a(2b) says there is no second band`,
    );
  }
});

test('a gross-based waiver would disagree with the chain on ordinary traffic', () => {
  // The defect §5.3a(2) was corrected to prevent, priced in the corpus's own
  // units: at min_split gross the net-based waiver pays in full and a gross-based
  // one deducts. Written as a witness rather than a comment because the two
  // implementations agree everywhere except this band.
  const defaults = scenarios.find(
    (row) => row.params.redeem_fee_perbill > 0 && row.params.redeem_fee_perbill <= Number(PERBILL_ONE),
  );
  assert.ok(defaults !== undefined);
  const rate = BigInt(defaults.params.redeem_fee_perbill);
  const minSplit = BigInt(defaults.params.min_split);

  assert.equal(redemptionFee(minSplit, rate, minSplit), 0n, 'a gross of exactly min_split is waived');
  const grossBased = (minSplit * rate + PERBILL_ONE - 1n) / PERBILL_ONE;
  assert.ok(grossBased > 0n, 'the band this test describes does not exist at this rate');
});

test('the figures a screen renders cannot be assembled inconsistently', () => {
  // 11 §11.5 rule 3 makes `net` the headline with `gross` and `fee` itemised
  // beside it. Returning the three together is what stops a caller rendering a
  // net from one call and a fee from another.
  const amounts = redemptionAmounts(14_001n, 3_000_000n, 10_000n);
  assert.equal(amounts.gross - amounts.fee, amounts.net);
  const pair = redemptionAmountsPair(20_000n, 700_050_000n, 3_000_000n, 10_000n);
  assert.equal(pair.gross - pair.fee, pair.net);
});

test('the leg split floors independently rather than deriving one from the other', () => {
  // §5.3a(2a): `floor(a·s) + floor(a·(1−s)) ≤ a`, and the gap is the pair path's
  // surviving gross advantage. `short = a − long` would make it exactly `a` and
  // erase the advantage the atomic call exists to provide.
  const amount = 7n;
  const sRaw = 333_333_333n;
  const legs = pairLegs(amount, sRaw);
  assert.ok(legs.long + legs.short < amount, 'this fixture no longer loses anything to flooring');
});

test('a negative amount and an out-of-range score are refused', () => {
  assert.throws(() => redemptionFee(-1n, 0n, 10_000n), RedemptionRateError);
  assert.throws(() => pairLegs(10n, PERBILL_ONE + 1n), RedemptionRateError);
  assert.throws(() => redemptionFee(10n, -1n, 10_000n), RedemptionRateError);
});
