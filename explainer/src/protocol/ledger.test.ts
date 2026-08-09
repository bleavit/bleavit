/**
 * Ledger certification against `bleavit.reference-model.v4`.
 *
 * Tolerance policy (as mandated):
 *  - Integer base-unit results — every ledger payout in this file — are asserted
 *    with EXACT equality. No tolerance. A payout is a transfer of somebody's
 *    money; "close" is a defect.
 *  - Values the spec computes on the floored 1e9 grid would carry an absolute
 *    tolerance of 2e-9. No assertion here needs it: the settlement score `s`
 *    enters only through `floor(a·s)`, which this module evaluates in BigInt on
 *    the 1e9 grid, so the result is an exact integer.
 *  - Pure real-valued transcendental results would carry a relative tolerance of
 *    1e-12. The ledger contains no transcendental math.
 *
 * No row required an exception.
 */

import { describe, expect, it } from 'vitest';

import vectors from './__fixtures__/vectors.slim.json';
import {
  FEE_CHARGED_CALLS,
  REDEMPTION_MATRIX,
  applyTransferRemainderRule,
  isFeeCharged,
  baselinePayout,
  baselinePositions,
  branchIdentity,
  checkConservation,
  createVault,
  legalCallsFor,
  maxClaimValue,
  merge,
  mergeGate,
  mergeScalar,
  pairRedemptionFee,
  positionKey,
  proposalPositions,
  redeem,
  redemptionFee,
  redeemGate,
  redeemPayout,
  redeemScalar,
  redeemScalarPair,
  redeemVoid,
  redeemVoidPayout,
  resolve,
  scalarPairPayout,
  scalarPayout,
  settleGate,
  settleScalar,
  split,
  splitGate,
  splitScalar,
  transfer,
  voidVault,
} from './ledger';
import type { LedgerResult, RedemptionRow, Vault } from './ledger';
import { MIN_SPLIT_USDC } from './constants';
import type { GateType, PositionKind } from './types';

// ---------------------------------------------------------------------------
// Fixture access
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const corpus = vectors as unknown as Record<string, Row[]>;

/** The corpus stores high-precision reals as decimal strings (schema v4). */
function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  throw new Error(`fixture field is not numeric: ${JSON.stringify(value)}`);
}

function rows(key: string): Row[] {
  const list = corpus[key];
  if (list === undefined) throw new Error(`fixture section missing: ${key}`);
  return list;
}

function rowByName(key: string, name: string): Row {
  const found = rows(key).find((r) => r['name'] === name);
  if (found === undefined) throw new Error(`fixture row missing: ${key}/${name}`);
  return found;
}

function inputs(row: Row): Row {
  return row['inputs'] as Row;
}

/** Unwrap a successful transition, or fail loudly with the ledger error name. */
function ok(result: LedgerResult): Vault {
  if (!result.ok) throw new Error(`unexpected ${result.error}: ${result.why}`);
  expect(checkConservation(result.vault)).toBe(true);
  return result.vault;
}

const BRANCH_USDC: PositionKind = { kind: 'BranchUsdc' };
const LONG: PositionKind = { kind: 'Long' };
const SHORT: PositionKind = { kind: 'Short' };
const gateNo = (gate: GateType): PositionKind => ({ kind: 'GateNo', gate });

// ---------------------------------------------------------------------------
// Instrument identity
// ---------------------------------------------------------------------------

describe('position identity (doc 03 §2.1)', () => {
  it('a proposal vault has exactly 14 instruments, all distinct', () => {
    const ids = proposalPositions(42);
    expect(ids).toHaveLength(14);
    expect(new Set(ids.map(positionKey)).size).toBe(14);
    // 7 kinds per branch: branch-USDC, the scalar pair, and two gate pairs.
    expect(ids.filter((p) => p.scope === 'Proposal' && p.branch === 'Accept')).toHaveLength(7);
  });

  it('a Baseline vault has exactly 2 instruments and no branch layer', () => {
    const ids = baselinePositions(7);
    expect(ids).toHaveLength(2);
    expect(ids.every((p) => p.scope === 'Baseline')).toBe(true);
    expect(ids.map(positionKey)).toEqual(['B/7/Long', 'B/7/Short']);
  });
});

// ---------------------------------------------------------------------------
// ledger_score_scenarios — 10 rows, exact integers
// ---------------------------------------------------------------------------

describe('ledger_score_scenarios (doc 03 §5.3, §6.3)', () => {
  const scenarios = rows('ledger_score_scenarios');

  it('certifies all 10 corpus rows', () => {
    expect(scenarios).toHaveLength(10);
  });

  for (const row of scenarios) {
    const name = String(row['name']);
    const s = num(row['score']) / 1e9;
    const amount = num(row['amount']);

    it(`${name}: long, short and pair payouts are exact`, () => {
      expect(scalarPayout(s, 'Long', amount)).toBe(num(row['long_payout']));
      expect(scalarPayout(s, 'Short', amount)).toBe(num(row['short_payout']));
      expect(scalarPairPayout(amount)).toBe(num(row['pair_payout']));
    });

    it(`${name}: fragmenting a pair never over-draws escrow`, () => {
      const long = num(row['long_payout']);
      const short = num(row['short_payout']);
      expect(long + short).toBeLessThanOrEqual(num(row['pair_payout']));
    });
  }

  it('score 500000001 is the double-flooring witness', () => {
    // Both legs floor down at s just above ½, so leg-by-leg redemption pays
    // 20002 while the atomic pair call pays 20003. That one base unit is the
    // whole reason `redeem_scalar_pair` exists (doc 03 §6.3).
    const row = rowByName('ledger_score_scenarios', 'score-0500000001');
    const s = num(row['score']) / 1e9;
    const a = num(row['amount']);
    expect(scalarPayout(s, 'Long', a)).toBe(10001);
    expect(scalarPayout(s, 'Short', a)).toBe(10001);
    expect(scalarPayout(s, 'Long', a) + scalarPayout(s, 'Short', a)).toBe(20002);
    expect(scalarPairPayout(a)).toBe(20003);
  });

  it('the k/1e9 ± 1 neighbourhood is stable', () => {
    // 700049999 / 700050000 / 700050001 all pay 14003 / 5999. The corpus keeps
    // all three so a float that lands one grid point off is still caught by the
    // rows that do move.
    for (const raw of [700049999, 700050000, 700050001]) {
      expect(scalarPayout(raw / 1e9, 'Long', 20003)).toBe(14003);
      expect(scalarPayout(raw / 1e9, 'Short', 20003)).toBe(5999);
    }
  });
});

// ---------------------------------------------------------------------------
// The redemption fee (doc 03 §5.3a)
// ---------------------------------------------------------------------------

describe('redemption fee (doc 03 §5.3a)', () => {
  it('rounds up, against the claimant', () => {
    // 30 bps of 100,001 is 300.003; the protocol takes 301, never 300.
    expect(redemptionFee(100_001)).toBe(301);
    expect(redemptionFee(100_000)).toBe(300);
  });

  it('waives on the NET, which is the whole point of the rule', () => {
    // The specification's own witness for why a gross-based test fails.
    // `ledger.min_split` and USDC's `min_balance` are both 10,000 base units.
    // A gross of exactly 10,000 would clear a GROSS-based waiver, be charged 30
    // and net 9,970 — below `min_balance`, which is the precise failure the
    // waiver exists to prevent. The net-based test covers the whole band.
    expect(redemptionFee(10_000)).toBe(0);
    expect(10_000 - redemptionFee(10_000)).toBeGreaterThanOrEqual(MIN_SPLIT_USDC);

    // The threshold is where the NET first clears the floor, and everything at
    // or above it is charged. Below it nothing is, so no payout is ever pushed
    // under the floor by the fee itself.
    for (let g = 1; g <= 10_100; g += 1) {
      const net = g - redemptionFee(g);
      expect(net === g || net >= MIN_SPLIT_USDC, `gross ${g} nets ${net}`).toBe(true);
    }
  });

  it('is monotone in the gross, so a bigger claim never nets less', () => {
    let previous = 0;
    for (let g = 0; g <= 60_000; g += 137) {
      const net = g - redemptionFee(g);
      expect(net, `net fell at gross ${g}`).toBeGreaterThanOrEqual(previous);
      previous = net;
    }
  });

  it('never exceeds the gross, at any rate including the degenerate ones', () => {
    // No rate can make a payout negative. At 100 % the net-based waiver means
    // nothing is charged at all and the claimant is paid in full — the spec
    // notes this as a property of the corrected rule rather than a special case.
    for (const rate of [0, 1, 3_000_000, 500_000_000, 1_000_000_000]) {
      for (const gross of [0, 1, 9_999, 10_000, 1_000_000]) {
        const fee = redemptionFee(gross, rate);
        expect(fee, `rate ${rate} gross ${gross}`).toBeLessThanOrEqual(gross);
        expect(fee).toBeGreaterThanOrEqual(0);
      }
    }
    expect(redemptionFee(1_000_000, 1_000_000_000)).toBe(0);
  });

  it('charges the pair leg by leg, never on the combined base', () => {
    // Stated as a general property rather than only at the corpus row: the pair
    // path must never cost more than redeeming the same holdings separately.
    for (const amount of [10_000, 20_000, 20_003, 999_999]) {
      for (const s of [0.5, 0.70005, 0.0500000001, 0.999]) {
        const legs =
          redemptionFee(scalarPayout(s, 'Long', amount)) +
          redemptionFee(scalarPayout(s, 'Short', amount));
        expect(pairRedemptionFee(amount, s), `a=${amount} s=${s}`).toBe(legs);
        const netPair = amount - pairRedemptionFee(amount, s);
        const netLegs =
          scalarPayout(s, 'Long', amount) -
          redemptionFee(scalarPayout(s, 'Long', amount)) +
          (scalarPayout(s, 'Short', amount) - redemptionFee(scalarPayout(s, 'Short', amount)));
        expect(netPair, `a=${amount} s=${s}`).toBeGreaterThanOrEqual(netLegs);
      }
    }
  });

  it('names exactly the charged calls, and exempts the par and failure paths', () => {
    expect([...FEE_CHARGED_CALLS].sort()).toEqual([
      'redeem_baseline',
      'redeem_baseline_pair',
      'redeem_gate',
      'redeem_scalar',
      'redeem_scalar_pair',
    ]);
    // The three exemptions that carry the user-facing promise.
    expect(isFeeCharged('redeem')).toBe(false);
    expect(isFeeCharged('redeem_void')).toBe(false);
    for (const call of ['merge', 'merge_scalar', 'merge_gate', 'merge_baseline'] as const) {
      expect(isFeeCharged(call), call).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// ledger_scenarios — 5 rows, exact integers
// ---------------------------------------------------------------------------

describe('ledger_scenarios (doc 03 §5.3, §6.3, §6.4)', () => {
  it('certifies all 5 corpus rows', () => {
    expect(rows('ledger_scenarios')).toHaveLength(5);
  });

  it('void_branch_and_leg_floors: ½ and ¼ against the claimant', () => {
    const row = rowByName('ledger_scenarios', 'void_branch_and_leg_floors');
    const branchAmount = num(inputs(row)['branch_amount']);
    const legAmount = num(inputs(row)['scalar_leg_amount']);

    expect(redeemVoidPayout(BRANCH_USDC, branchAmount)).toBe(num(row['branch_payout']));
    expect(redeemVoidPayout(LONG, legAmount)).toBe(num(row['leg_payout']));
    expect(redeemVoidPayout({ kind: 'GateYes', gate: 'Security' }, legAmount)).toBe(
      num(row['leg_payout']),
    );

    // Same numbers through the vault, so the state machine and the calculator
    // cannot drift apart.
    let v = ok(split(createVault(1), branchAmount + legAmount));
    v = ok(splitScalar(v, 'Accept', legAmount));
    v = ok(voidVault(v));
    expect(v.branches.Accept.usdc).toBe(branchAmount);
    expect(v.branches.Accept.long).toBe(legAmount);

    const afterBranch = redeemVoid(v, 'Accept', BRANCH_USDC, branchAmount);
    expect(afterBranch.ok && afterBranch.effect.payout).toBe(num(row['branch_payout']));
    const afterLeg = redeemVoid(ok(afterBranch), 'Accept', LONG, legAmount);
    expect(afterLeg.ok && afterLeg.effect.payout).toBe(num(row['leg_payout']));
    ok(afterLeg);
  });

  it('b5_scalar_fragmentation: the retired SHORT rule was insolvent by one', () => {
    const row = rowByName('ledger_scenarios', 'b5_scalar_fragmentation');
    const escrow = num(inputs(row)['escrow']);
    const s = num(inputs(row)['s']);
    const shorts = row['short_payouts'] as number[];

    expect(scalarPayout(s, 'Long', escrow)).toBe(num(row['long_payout']));
    for (const expected of shorts) {
      expect(scalarPayout(s, 'Short', escrow / 2)).toBe(expected);
    }
    const total = num(row['long_payout']) + shorts.reduce((a, b) => a + b, 0);
    expect(total).toBe(num(row['total_payout']));
    expect(total).toBeLessThanOrEqual(escrow);

    // The superseded rule paid SHORT `a − floor(a·s)`, i.e. 3000 each, for a
    // total of 20001 against 20000 of escrow.
    const retired = escrow / 2 - scalarPayout(s, 'Long', escrow / 2);
    expect(num(row['long_payout']) + 2 * retired).toBe(escrow + 1);

    // Replayed through the vault.
    let v = ok(split(createVault(2), escrow));
    v = ok(splitScalar(v, 'Accept', escrow));
    v = ok(resolve(v, 'Accept'));
    v = ok(settleScalar(v, s));
    v = ok(redeemScalar(v, 'Long', escrow));
    v = ok(redeemScalar(v, 'Short', escrow / 2));
    v = ok(redeemScalar(v, 'Short', escrow / 2));
    expect(v.paidOut).toBe(num(row['total_payout']));
    expect(v.escrowed).toBe(escrow - total);
  });

  it('scalar_pair_exact: the atomic pair call pays exactly a gross, less each leg’s fee', () => {
    const row = rowByName('ledger_scenarios', 'scalar_pair_exact');
    const amount = num(inputs(row)['amount']);
    const s = num(inputs(row)['s']);
    // The corpus states the GROSS, which is what the pair rule pays before the
    // doc 03 §5.3a fee. It is the fee that is new, not the payout rule.
    expect(scalarPairPayout(amount)).toBe(num(row['payout']));

    let v = ok(split(createVault(3), amount));
    v = ok(splitScalar(v, 'Accept', amount));
    v = ok(resolve(v, 'Accept'));
    v = ok(settleScalar(v, s));
    const paired = redeemScalarPair(v, amount);
    expect(paired.ok && paired.effect.grossPayout).toBe(num(row['payout']));

    // This row is the specification's own worked witness for why the pair fee
    // is computed leg by leg (doc 03 §5.3a(2a)). At a = 20,000, s = 0.70005 and
    // 30 bps: the LONG leg's gross is 14,001 and pays 43; the SHORT leg's gross
    // is 5,999 and pays nothing, because its own net-based waiver exempts it.
    // So the pair nets 19,957. Charging the combined base would have taken 60
    // and netted 19,940 — leaving the complete-set holder worse off than the
    // fragmented one, which is the exact inversion the rule exists to prevent.
    expect(pairRedemptionFee(amount, s)).toBe(43);
    expect(paired.ok && paired.effect.fee).toBe(43);
    expect(paired.ok && paired.effect.payout).toBe(19_957);
    expect(redemptionFee(amount)).toBe(60);
    expect(amount - redemptionFee(amount)).toBeLessThan(19_957);

    // Escrow still falls by the full gross; the fee is retained rather than
    // left in the vault, so conservation is untouched by the charge.
    expect(ok(paired).escrowed).toBe(0);

    // Leg by leg the same holdings never pay more (doc 03 §6.3:
    // `floor(a·s) + floor(a·(1−s)) ≤ a` for all a, s). This row happens to tie
    // — at a = 20,000 both products are integral — which is why the corpus also
    // carries score-0500000001, where the two floors lose a base unit.
    expect(scalarPayout(s, 'Long', amount) + scalarPayout(s, 'Short', amount)).toBeLessThanOrEqual(
      num(row['payout']),
    );
    expect(scalarPayout(s, 'Long', amount) + scalarPayout(s, 'Short', amount)).toBe(20_000);
  });

  it('gate_settlement_one_zero: the winning side pays 1, the other 0', () => {
    const row = rowByName('ledger_scenarios', 'gate_settlement_one_zero');
    const each = num(inputs(row)['amount_each']);
    const gate = String(inputs(row)['gate']) as GateType;
    const outcome = inputs(row)['outcome'] === true;

    // The corpus row uses a small `amount_each`, which a Signed `split_gate`
    // may no longer create: that call mints new position entries and is bound
    // by the live `ledger.min_split` floor. Split at the floor and redeem the
    // corpus amount out of it, so the payout rule under test is unchanged while
    // the call that sets it up stays legal.
    expect(splitGate(ok(split(createVault(9), MIN_SPLIT_USDC)), 'Accept', gate, each).ok).toBe(
      false,
    );

    let v = ok(split(createVault(4), MIN_SPLIT_USDC));
    v = ok(splitGate(v, 'Accept', gate, MIN_SPLIT_USDC));
    v = ok(resolve(v, 'Accept'));
    v = ok(settleScalar(v, 0.5));
    v = ok(settleGate(v, gate, outcome));

    // Gross is the corpus payout; the winning leg is charged the §5.3a fee, and
    // at this size the net-based waiver exempts it entirely — which is the
    // waiver doing exactly the job it exists for.
    const yes = redeemGate(v, gate, 'Yes', each);
    expect(yes.ok && yes.effect.grossPayout).toBe(num(row['yes_payout']));
    expect(yes.ok && yes.effect.fee).toBe(0);
    expect(yes.ok && yes.effect.payout).toBe(num(row['yes_payout']));
    const no = redeemGate(ok(yes), gate, 'No', each);
    expect(no.ok && no.effect.payout).toBe(num(row['no_payout']));
    ok(no);

    expect(redeemPayout(v.state, { kind: 'GateYes', gate }, each, outcome)).toBe(
      num(row['yes_payout']),
    );
    expect(redeemPayout(v.state, gateNo(gate), each, outcome)).toBe(num(row['no_payout']));
  });

  it('baseline_scalar_and_pair: same arithmetic against E_base', () => {
    const row = rowByName('ledger_scenarios', 'baseline_scalar_and_pair');
    const amount = num(inputs(row)['amount']);
    const s = num(inputs(row)['s']);
    const epoch = num(inputs(row)['epoch']);

    expect(baselinePayout(s, 'Long', amount)).toBe(num(row['long_payout']));
    expect(scalarPairPayout(amount)).toBe(num(row['pair_payout']));
    expect(baselinePositions(epoch)).toHaveLength(2);

    const settled = { kind: 'BaselineSettled', s } as const;
    expect(redeemPayout(settled, LONG, amount)).toBe(num(row['long_payout']));
    // The unpaired short leg takes the complement; together they lose the dust
    // the pair call keeps.
    expect(
      redeemPayout(settled, LONG, amount) + redeemPayout(settled, SHORT, amount),
    ).toBeLessThanOrEqual(num(row['pair_payout']));
    expect(legalCallsFor(settled)).toEqual(['redeem_baseline', 'redeem_baseline_pair']);
  });
});

// ---------------------------------------------------------------------------
// Escrow model
// ---------------------------------------------------------------------------

describe('split is a dual mint (doc 03 §5.1, §6.1)', () => {
  it('mints one branch-USDC per world, not a half share of one', () => {
    const v = ok(split(createVault(10), 100 * 1_000_000));
    expect(v.escrowed).toBe(100_000_000);
    expect(v.branches.Accept.usdc).toBe(100_000_000);
    expect(v.branches.Reject.usdc).toBe(100_000_000);
    // Both sides of L-1 hold at once — that is what makes the escrow safe.
    expect(branchIdentity(v.branches.Accept)).toBe(v.escrowed);
    expect(branchIdentity(v.branches.Reject)).toBe(v.escrowed);
  });

  it('walks the §6.2 POL seeding flow without underflow', () => {
    // The flow that broke the superseded single `branch_pairs` counter: D > 2G,
    // so the second branch's scalar split drove it negative (finding B-4).
    // Doc 03 §6.2's own figures, in the base units the ledger actually uses:
    // pol.b = 25,000 USDC and pol.b_gate = 7,500 USDC (doc 13 §1), so the
    // per-branch seeds are D = pol.b·ln2 ≈ 17,328.68 USDC and
    // G = pol.b_gate·ln2 ≈ 5,198.60 USDC — headroom omitted, since the identity
    // under test is scale-free and headroom only enlarges both terms.
    const D = 17_328_679_513; // floor(25_000 · 1e6 · ln 2)
    const G = 5_198_603_854; // floor( 7_500 · 1e6 · ln 2)
    const T = D + 2 * G;
    let v = ok(split(createVault(11), T));
    v = ok(splitScalar(v, 'Accept', D));
    v = ok(splitScalar(v, 'Reject', D));
    for (const branch of ['Accept', 'Reject'] as const) {
      for (const gate of ['Survival', 'Security'] as const) {
        v = ok(splitGate(v, branch, gate, G));
      }
    }
    expect(v.escrowed).toBe(T);
    for (const branch of ['Accept', 'Reject'] as const) {
      const b = v.branches[branch];
      expect(b.usdc).toBe(0);
      expect(b.scalarSets).toBe(D);
      expect(b.gateSets.Survival).toBe(G);
      expect(branchIdentity(b)).toBe(T);
    }
  });
});

describe('illegal calls are refused by name (doc 03 §2.3, §8)', () => {
  const seeded = (): Vault => ok(splitScalar(ok(split(createVault(12), 1_000_000)), 'Accept', 400_000));

  it('minting requires Open', () => {
    const resolved = ok(resolve(seeded(), 'Accept'));
    for (const attempt of [
      split(resolved, 100_000),
      splitScalar(resolved, 'Accept', 100_000),
      splitGate(resolved, 'Accept', 'Survival', 100_000),
    ]) {
      expect(attempt.ok).toBe(false);
      expect(!attempt.ok && attempt.error).toBe('WrongVaultState');
    }
  });

  it('Resolved bars unpaired redemption — VOID is reachable from here', () => {
    const resolved = ok(resolve(seeded(), 'Accept'));
    const attempt = redeem(resolved, 100_000);
    expect(!attempt.ok && attempt.error).toBe('WrongVaultState');
    expect(redeemPayout(resolved.state, BRANCH_USDC, 100_000)).toBe(0);
    // A cross-branch pair still recovers par, because it burns claim mass on
    // both sides symmetrically.
    expect(merge(resolved, 100_000).ok).toBe(true);
  });

  it('void is barred from ScalarSettled and from Voided', () => {
    // Both are terminal (doc 03 §2.3; the superseded "from every non-ScalarSettled
    // state" quantifier wrongly included Voided — SQ-165).
    const settled = ok(settleScalar(ok(resolve(seeded(), 'Accept')), 0.5));
    const fromSettled = voidVault(settled);
    expect(!fromSettled.ok && fromSettled.error).toBe('WrongVaultState');
    const voided = ok(voidVault(seeded()));
    const twice = voidVault(voided);
    expect(!twice.ok && twice.error).toBe('WrongVaultState');
  });

  it('split below MinSplit is BelowMinimum; over-spending is InsufficientPosition', () => {
    const low = split(createVault(13), MIN_SPLIT_USDC - 1);
    expect(!low.ok && low.error).toBe('BelowMinimum');
    const over = splitScalar(seeded(), 'Accept', 10_000_000);
    expect(!over.ok && over.error).toBe('InsufficientPosition');
  });

  it('a settlement score outside [0,1] is InvalidScore', () => {
    const resolved = ok(resolve(seeded(), 'Accept'));
    for (const s of [-0.001, 1.5, Number.NaN]) {
      const attempt = settleScalar(resolved, s);
      expect(!attempt.ok && attempt.error).toBe('InvalidScore');
    }
  });

  it('a gate outcome cannot be overwritten', () => {
    const resolved = ok(resolve(seeded(), 'Accept'));
    const once = ok(settleGate(resolved, 'Survival', true));
    const twice = settleGate(once, 'Survival', false);
    expect(!twice.ok && twice.error).toBe('GateAlreadySettled');
    // And an unsettled gate cannot be redeemed.
    const settled = ok(settleScalar(once, 0.5));
    const unsettled = redeemGate(settled, 'Security', 'Yes', 1);
    expect(!unsettled.ok && unsettled.error).toBe('GateNotSettled');
  });

  it('illegal calls change no state', () => {
    const before = seeded();
    const attempt = split(ok(voidVault(before)), 100_000);
    expect(attempt.ok).toBe(false);
    expect(seeded()).toEqual(before);
  });
});

describe('transfer (doc 03 §5.1, §7 R-2)', () => {
  const seeded = ok(split(createVault(14), 1_000_000));

  it('is legal in Open, Resolved and Voided but not ScalarSettled', () => {
    const position = proposalPositions(14)[0];
    expect(position).toBeDefined();
    if (position === undefined) return;
    expect(transfer(seeded, position, 100_000).ok).toBe(true);
    expect(transfer(ok(voidVault(seeded)), position, 100_000).ok).toBe(true);
    const settled = ok(settleScalar(ok(resolve(seeded, 'Accept')), 0.4));
    const attempt = transfer(settled, position, 100_000);
    expect(!attempt.ok && attempt.error).toBe('WrongVaultState');
  });

  it('moves the whole balance rather than leaving un-transferable dust', () => {
    expect(applyTransferRemainderRule(25_000, 20_000)).toBe(25_000);
    expect(applyTransferRemainderRule(25_000, 10_000)).toBe(10_000);
    expect(applyTransferRemainderRule(25_000, 25_000)).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------
// Legal call surface and the redemption matrix
// ---------------------------------------------------------------------------

describe('legalCallsFor (doc 03 §5.1, §5.3; I-27)', () => {
  it('Voided admits exactly the I-27 five', () => {
    expect(legalCallsFor({ kind: 'Voided' })).toEqual([
      'merge',
      'merge_scalar',
      'merge_gate',
      'transfer',
      'redeem_void',
    ]);
  });

  it('Open mints, Resolved only pairs, ScalarSettled only redeems', () => {
    expect(legalCallsFor({ kind: 'Open' })).toContain('split');
    expect(legalCallsFor({ kind: 'Resolved', winner: 'Accept' })).not.toContain('split');
    expect(legalCallsFor({ kind: 'Resolved', winner: 'Accept' })).not.toContain('redeem');
    // `transfer` is subsumed by the redemption calls once a score is fixed.
    expect(legalCallsFor({ kind: 'ScalarSettled', winner: 'Accept', s: 0.5 })).not.toContain(
      'transfer',
    );
  });

  it('never offers an authority call', () => {
    const authority = ['resolve', 'void', 'settle_scalar', 'settle_gate', 'settle_baseline'];
    const states = [
      { kind: 'Open' },
      { kind: 'Resolved', winner: 'Accept' },
      { kind: 'ScalarSettled', winner: 'Accept', s: 0.25 },
      { kind: 'Voided' },
      { kind: 'BaselineSettled', s: 0.25 },
    ] as const;
    for (const state of states) {
      for (const call of legalCallsFor(state)) {
        expect(authority).not.toContain(call);
      }
    }
  });
});

describe('REDEMPTION_MATRIX (doc 03 §5.3, §6.4)', () => {
  // 0.70005 is exactly the corpus grid point 700050000/1e9, so every payout the
  // matrix quotes at this score is answerable straight from the fixture rather
  // than by re-running the module under test.
  const ctx = { s: 0.70005, gateWins: true };

  /** Strict lookup — a renamed or deleted row must fail loudly, not silently. */
  const matrixRow = (state: RedemptionRow['state'], holding: string): RedemptionRow => {
    const found = REDEMPTION_MATRIX.find((r) => r.state === state && r.holding === holding);
    if (found === undefined) throw new Error(`matrix row missing: ${state}/${holding}`);
    return found;
  };

  it('every row names a call the state actually admits', () => {
    for (const row of REDEMPTION_MATRIX) {
      if (row.call === null) continue;
      const state =
        row.state === 'Resolved'
          ? ({ kind: 'Resolved', winner: 'Accept' } as const)
          : row.state === 'ScalarSettled'
            ? ({ kind: 'ScalarSettled', winner: 'Accept', s: ctx.s } as const)
            : row.state === 'BaselineSettled'
              ? ({ kind: 'BaselineSettled', s: ctx.s } as const)
              : ({ kind: row.state } as const);
      expect(legalCallsFor(state)).toContain(row.call);
    }
  });

  it('every payout-bearing row agrees with the corpus', () => {
    const score = rowByName('ledger_score_scenarios', 'score-0700050000');
    const voided = rowByName('ledger_scenarios', 'void_branch_and_leg_floors');
    const gate = rowByName('ledger_scenarios', 'gate_settlement_one_zero');
    const baseline = rowByName('ledger_scenarios', 'baseline_scalar_and_pair');
    // The context this table is evaluated at IS a corpus row, not a nearby real.
    expect(num(score['score']) / 1e9).toBe(ctx.s);
    expect(num(inputs(baseline)['s'])).toBe(ctx.s);

    const a = num(score['amount']);
    expect(matrixRow('ScalarSettled', 'winning-branch LONG').payout(a, ctx)).toBe(
      num(score['long_payout']),
    );
    expect(matrixRow('ScalarSettled', 'winning-branch SHORT').payout(a, ctx)).toBe(
      num(score['short_payout']),
    );
    expect(matrixRow('ScalarSettled', 'winning-branch LONG + SHORT pair').payout(a, ctx)).toBe(
      num(score['pair_payout']),
    );
    // The 1:1 rows: the corpus pins a complete set at exactly `a`, which doc 03
    // §5.3 also fixes as the winning branch-USDC and winning gate-side payout.
    expect(matrixRow('ScalarSettled', 'winning branch-USDC').payout(a, ctx)).toBe(
      num(score['pair_payout']),
    );

    const each = num(inputs(gate)['amount_each']);
    const gateRow = matrixRow('ScalarSettled', 'winning gate side of the winning branch');
    expect(gateRow.payout(each, { s: ctx.s, gateWins: true })).toBe(num(gate['yes_payout']));
    expect(gateRow.payout(each, { s: ctx.s, gateWins: false })).toBe(num(gate['no_payout']));

    const branchAmount = num(inputs(voided)['branch_amount']);
    const legAmount = num(inputs(voided)['scalar_leg_amount']);
    expect(matrixRow('Voided', 'unpaired branch-USDC').payout(branchAmount, ctx)).toBe(
      num(voided['branch_payout']),
    );
    expect(
      matrixRow('Voided', 'unpaired LONG / SHORT / gate YES / gate NO').payout(legAmount, ctx),
    ).toBe(num(voided['leg_payout']));

    const bAmount = num(inputs(baseline)['amount']);
    expect(matrixRow('BaselineSettled', 'B-LONG').payout(bAmount, ctx)).toBe(
      num(baseline['long_payout']),
    );
    expect(matrixRow('BaselineSettled', 'B-LONG + B-SHORT pair').payout(bAmount, ctx)).toBe(
      num(baseline['pair_payout']),
    );
    // The corpus carries no Baseline SHORT row, but doc 03 §5.3 makes
    // `redeem_baseline` SHORT the same `floor(a·(1−s))` the score family pins.
    expect(matrixRow('BaselineSettled', 'B-SHORT').payout(a, ctx)).toBe(num(score['short_payout']));
  });

  it('records where the protocol deliberately pays nothing', () => {
    const barred = REDEMPTION_MATRIX.filter((r) => r.call === null);
    expect(barred.length).toBeGreaterThan(0);
    for (const row of barred) expect(row.payout(10_000, ctx)).toBe(0);
    // Same-branch completeness alone recovers no USDC under VOID (SQ-171).
    const sameBranch = REDEMPTION_MATRIX.filter(
      (r) => r.state === 'Voided' && r.call === 'merge_scalar',
    );
    expect(sameBranch).toHaveLength(1);
    expect(sameBranch[0]?.payout(10_000, ctx)).toBe(0);
  });

  it('cites doc 03 everywhere', () => {
    expect(REDEMPTION_MATRIX.every((r) => r.cite.doc === '03')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VOID conservation
// ---------------------------------------------------------------------------

describe('the B-1 counterexample (doc 03 §6.4)', () => {
  // Split 100 USDC, void the vault. The superseded "both kinds redeem 1:1" rule
  // paid 200 against 100 of escrow — a 2x insolvency the first redeemers took.
  const escrow = 100 * 1_000_000;
  const voided = ok(voidVault(ok(split(createVault(20), escrow))));

  it('a cross-branch pair recovers par, and that is the only 100 % path', () => {
    const merged = merge(voided, escrow);
    expect(merged.ok && merged.effect.payout).toBe(escrow);
    expect(ok(merged).escrowed).toBe(0);
  });

  it('both sides redeemed unpaired recover exactly the same total', () => {
    let v = voided;
    let paid = 0;
    for (const branch of ['Accept', 'Reject'] as const) {
      const step = redeemVoid(v, branch, BRANCH_USDC, escrow);
      paid += step.ok ? step.effect.payout : 0;
      v = ok(step);
    }
    expect(paid).toBe(escrow);
    expect(v.escrowed).toBe(0);
  });

  it('any mix of merge-then-redeem pays at most E', () => {
    for (const k of [1, 7, 1_000, 33_333_333, escrow - 1]) {
      let v = ok(merge(voided, k));
      for (const branch of ['Accept', 'Reject'] as const) {
        v = ok(redeemVoid(v, branch, BRANCH_USDC, escrow - k));
      }
      expect(v.paidOut).toBeLessThanOrEqual(escrow);
    }
  });
});

describe('I-26: no interleaving of the Voided call surface over-draws escrow', () => {
  /**
   * Deterministic exhaustive search — no RNG. A fragmented voided vault, then
   * every ordering of eight legal operations to depth 5: 8^5 = 32,768 sequences
   * attempted, whose legal prefixes form a tree of exactly 35,415 reachable
   * states. At every node the §6.5 induction must hold: what has been paid plus
   * what is still claimable never exceeds what was ever escrowed.
   */
  const build = (): Vault => {
    let v = ok(split(createVault(30), 1_000_003));
    v = ok(splitScalar(v, 'Accept', 400_001));
    v = ok(splitGate(v, 'Accept', 'Survival', 200_001));
    v = ok(splitScalar(v, 'Reject', 333_337));
    return ok(voidVault(v));
  };

  const ops: ReadonlyArray<{ label: string; apply: (v: Vault) => LedgerResult }> = [
    { label: 'merge', apply: (v) => merge(v, 150_001) },
    { label: 'merge_scalar(A)', apply: (v) => mergeScalar(v, 'Accept', 100_003) },
    { label: 'merge_gate(A,S)', apply: (v) => mergeGate(v, 'Accept', 'Survival', 70_001) },
    { label: 'merge_scalar(R)', apply: (v) => mergeScalar(v, 'Reject', 111_113) },
    { label: 'redeem_void(A,usdc)', apply: (v) => redeemVoid(v, 'Accept', BRANCH_USDC, 90_001) },
    { label: 'redeem_void(R,usdc)', apply: (v) => redeemVoid(v, 'Reject', BRANCH_USDC, 130_003) },
    { label: 'redeem_void(A,long)', apply: (v) => redeemVoid(v, 'Accept', LONG, 50_003) },
    {
      label: 'redeem_void(A,gateNo)',
      apply: (v) => redeemVoid(v, 'Accept', gateNo('Survival'), 30_001),
    },
  ];

  it('holds at all 35,415 states of the depth-5 interleaving tree', () => {
    const root = build();
    const E = root.escrowed;
    const violations: string[] = [];
    let visited = 0;
    let worstPaid = 0;

    const walk = (vault: Vault, depth: number, trail: readonly string[]): void => {
      visited += 1;
      worstPaid = Math.max(worstPaid, vault.paidOut);
      if (vault.paidOut > E) violations.push(`over-draw ${vault.paidOut} > ${E}: ${trail.join(' > ')}`);
      if (vault.paidOut + maxClaimValue(vault) > vault.collateralIn) {
        violations.push(`claims exceed collateral: ${trail.join(' > ')}`);
      }
      if (!checkConservation(vault)) violations.push(`try-state: ${trail.join(' > ')}`);
      if (depth === 0 || violations.length > 0) return;
      for (const op of ops) {
        const next = op.apply(vault);
        if (next.ok) walk(next.vault, depth - 1, [...trail, op.label]);
      }
    };

    walk(root, 5, []);
    expect(violations).toEqual([]);
    // Pinned, not bounded. A regression that made two thirds of the operations
    // illegal would still clear a `> 10_000` floor while quietly gutting the
    // search this test's entire value rests on.
    expect(visited).toBe(35_415);
    // Equality is reachable only through pair-complete recovery; a fragmented
    // vault always leaves rounding residue behind for the R-5 sweep.
    expect(worstPaid).toBeLessThanOrEqual(E);
  });

  it('first-redeemer strategies gain nothing beyond rounding residue', () => {
    const root = build();
    const patient = ok(merge(root, 400_001));
    const hasty = ok(redeemVoid(root, 'Accept', BRANCH_USDC, 400_001));
    // Par beats the neutral half, every time: pairing is always the better move.
    // The amount is odd, so the hasty holder also eats the flooring residue —
    // 2 · floor(a/2) = a − 1. Rounding is against the claimant, never escrow.
    expect(patient.paidOut).toBeGreaterThan(hasty.paidOut);
    expect(patient.paidOut).toBe(2 * hasty.paidOut + 1);
  });
});

// ---------------------------------------------------------------------------
// Try-state
// ---------------------------------------------------------------------------

describe('checkConservation (doc 03 §9, L-1/L-3/L-4)', () => {
  it('holds across the full lifecycle to ScalarSettled', () => {
    let v = ok(split(createVault(40), 500_000));
    v = ok(splitScalar(v, 'Accept', 200_000));
    v = ok(splitGate(v, 'Reject', 'Security', 120_000));
    expect(maxClaimValue(v)).toBe(v.escrowed);
    v = ok(resolve(v, 'Accept'));
    v = ok(settleGate(v, 'Security', false));
    v = ok(settleScalar(v, 0.123456789));
    expect(checkConservation(v)).toBe(true);
    v = ok(redeem(v, 300_000));
    v = ok(redeemScalarPair(v, 100_000));
    v = ok(redeemScalar(v, 'Long', 100_000));
    expect(v.paidOut + v.escrowed).toBe(v.collateralIn);
    expect(maxClaimValue(v)).toBeLessThanOrEqual(v.escrowed);
  });

  it('rejects a hand-broken vault', () => {
    const v = ok(split(createVault(41), 500_000));
    const inflated: Vault = {
      ...v,
      branches: { Accept: { ...v.branches.Accept, usdc: v.branches.Accept.usdc + 1 }, Reject: v.branches.Reject },
    };
    expect(checkConservation(inflated)).toBe(false);
    // The 2x insolvency shape: escrow silently drained without a payout record.
    expect(checkConservation({ ...v, escrowed: v.escrowed - 1 })).toBe(false);
  });

  it('rejects a proposal vault carrying the view-only BaselineSettled state', () => {
    const v = ok(split(createVault(42), 500_000));
    expect(checkConservation({ ...v, state: { kind: 'BaselineSettled', s: 0.5 } })).toBe(false);
  });
});
