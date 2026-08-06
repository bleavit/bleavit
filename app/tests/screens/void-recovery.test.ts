/**
 * VOID recovery — 11 §11.6, D-1, SQ-171, E16.
 *
 * §11.6 is almost entirely a list of ways to overstate a recovery, so almost
 * every test here is a refusal or an exactness check rather than a happy path.
 * Three claims carry the suite:
 *
 * * the decomposition reaches the **maximum** these holdings can recover, which
 *   is what makes it lawful to render as *the* headline (step 3);
 * * the rates are the exact floors D-1 states, computed against the redeemer;
 * * the par copy is permitted strictly less often than the par *action* is
 *   offered (SQ-171) — the distinction the rule exists to make.
 *
 * The rates are read out of doc 11 §11.6's own text rather than typed, so a spec
 * amendment to `floor(a/2)` / `floor(a/4)` fails here instead of silently
 * disagreeing with the screen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BRANCHES,
  GATE_TYPES,
  VoidHoldingsError,
  decomposeVoidRecovery,
  unpairedBranchUsdcPayout,
  unpairedLegPayout,
  type Branch,
  type GateType,
  type VoidHoldings,
} from '@bleavit/features-tx';

const here = dirname(fileURLToPath(import.meta.url));
const DOC_11 = resolve(here, '../../../docs/architecture/11-frontend-workflows.md');

const ZERO_BY_BRANCH: Record<Branch, bigint> = { Accept: 0n, Reject: 0n };
const ZERO_BY_GATE: Record<Branch, Record<GateType, bigint>> = {
  Accept: { Survival: 0n, Security: 0n },
  Reject: { Survival: 0n, Security: 0n },
};

function holdings(patch: Partial<VoidHoldings> = {}): VoidHoldings {
  return {
    branchUsdc: { ...ZERO_BY_BRANCH },
    long: { ...ZERO_BY_BRANCH },
    short: { ...ZERO_BY_BRANCH },
    gateYes: { Accept: { ...ZERO_BY_GATE.Accept }, Reject: { ...ZERO_BY_GATE.Reject } },
    gateNo: { Accept: { ...ZERO_BY_GATE.Accept }, Reject: { ...ZERO_BY_GATE.Reject } },
    ...patch,
  };
}

test('the D-1 rates this module applies are the ones doc 11 §11.6 states', () => {
  const text = readFileSync(DOC_11, 'utf8');
  const section = text.slice(text.indexOf('## 11.6 VOID redemption workflow'));
  // Anti-vacuity first: a slice that found nothing would make both matches below
  // pass for want of contradicting text.
  assert.ok(section.length > 1000, '§11.6 did not slice out of doc 11');
  assert.match(section, /unpaired branch-USDC pays `floor\(a\/2\)`/);
  assert.match(section, /unpaired LONG or SHORT pays `floor\(a\/4\)`/);
  assert.equal(unpairedBranchUsdcPayout(101n), 50n);
  assert.equal(unpairedLegPayout(101n), 25n);
});

test('a cross-branch pair recovers par, and nothing else does', () => {
  const recovery = decomposeVoidRecovery(
    holdings({ branchUsdc: { Accept: 1_000_000n, Reject: 1_000_000n } }),
  );
  assert.equal(recovery.parPair, 1_000_000n);
  assert.deepEqual(recovery.residuals, []);
  assert.equal(recovery.total, 1_000_000n);
  assert.equal(recovery.mayOfferParMerge, true);
  assert.equal(recovery.parCopyPermitted, true);
});

test('a same-branch scalar set alone is NOT a 100 % recovery (§11.6 step 1a)', () => {
  // The exact misstatement §11.6 forbids: merging LONG+SHORT yields one
  // same-branch branch-USDC, which is worth 0.5 unless the opposite branch is
  // also held. A screen presenting this under a 100 % heading is the defect.
  const recovery = decomposeVoidRecovery(
    holdings({ long: { Accept: 1_000_000n, Reject: 0n }, short: { Accept: 1_000_000n, Reject: 0n } }),
  );
  assert.deepEqual(recovery.consolidations, [
    { call: 'merge_scalar', branch: 'Accept', amount: 1_000_000n },
  ]);
  assert.equal(recovery.parPair, 0n, 'a same-branch set must not create a par pair');
  assert.equal(recovery.mayOfferParMerge, false);
  assert.equal(recovery.parCopyPermitted, false);
  assert.equal(recovery.total, 500_000n, 'the consolidated branch-USDC is worth floor(a/2)');
});

test('consolidation is never worse than redeeming the legs separately', () => {
  // `2·floor(a/4) ≤ floor(a/2)` for every `a`, which is what makes the
  // consolidate-first order the maximum rather than a preference. Checked over
  // the residue classes mod 4, where the two differ.
  for (const amount of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 999n, 1_000_001n]) {
    const separately = unpairedLegPayout(amount) * 2n;
    const consolidated = unpairedBranchUsdcPayout(amount);
    assert.ok(
      consolidated >= separately,
      `a=${amount}: consolidating pays ${consolidated}, leaving them pays ${separately}`,
    );
  }
});

test('pairing consolidated branch-USDC beats redeeming both sides unpaired', () => {
  // `a > 2·floor(a/2)` is false for even `a` — they are equal — so the strict
  // claim is `a ≥ 2·floor(a/2)`, with the gain being the whole point for the
  // holder: par instead of half. Asserted as the decomposition's own total.
  const paired = decomposeVoidRecovery(
    holdings({ branchUsdc: { Accept: 777n, Reject: 777n } }),
  );
  const unpaired = decomposeVoidRecovery(
    holdings({ branchUsdc: { Accept: 777n, Reject: 0n } }),
  ).total +
    decomposeVoidRecovery(holdings({ branchUsdc: { Accept: 0n, Reject: 777n } })).total;
  assert.equal(paired.total, 777n);
  assert.equal(unpaired, 776n);
  assert.ok(paired.total > unpaired);
});

test('mixed holdings decompose into pairs, consolidations and residue (§11.6 step 3)', () => {
  // 3 Accept branch-USDC, 1 Reject branch-USDC, and an Accept scalar set of 4.
  // Consolidation lifts Accept to 3 + 4 = 7; the pair is min(7, 1) = 1 at par;
  // the residue is 6 Accept branch-USDC at floor(6/2) = 3. Total 4.
  const recovery = decomposeVoidRecovery(
    holdings({
      branchUsdc: { Accept: 3n, Reject: 1n },
      long: { Accept: 4n, Reject: 0n },
      short: { Accept: 4n, Reject: 0n },
    }),
  );
  assert.equal(recovery.parPair, 1n);
  assert.deepEqual(recovery.residuals, [
    { branch: 'Accept', kind: 'BranchUsdc', amount: 6n, payout: 3n },
  ]);
  assert.equal(recovery.total, 4n);
  // The action is offered (a pair exists) but the copy is not (residue remains).
  assert.equal(recovery.mayOfferParMerge, true);
  assert.equal(recovery.parCopyPermitted, false);
});

test('SQ-171: the par copy is permitted strictly less often than the par action', () => {
  // The rule's whole content. A portfolio that is one unit of pair and a hundred
  // units of residue may offer the merge and MUST NOT promise par.
  const lopsided = decomposeVoidRecovery(
    holdings({ branchUsdc: { Accept: 100n, Reject: 1n } }),
  );
  assert.equal(lopsided.mayOfferParMerge, true);
  assert.equal(lopsided.parCopyPermitted, false);
  assert.equal(lopsided.total, 1n + 49n, 'par 1 plus floor(99/2)');
  // And with no pair at all, neither is available.
  const none = decomposeVoidRecovery(holdings({ branchUsdc: { Accept: 100n, Reject: 0n } }));
  assert.equal(none.mayOfferParMerge, false);
  assert.equal(none.parCopyPermitted, false);
});

test('gate sets consolidate exactly as scalar sets do, per gate', () => {
  // 03 §5.3's consistent extension: each gate leg is one side of a binary claim
  // on a branch worth ½ under VOID, hence ¼. A YES+NO set is a set.
  const recovery = decomposeVoidRecovery(
    holdings({
      gateYes: { Accept: { Survival: 8n, Security: 4n }, Reject: { Survival: 0n, Security: 0n } },
      gateNo: { Accept: { Survival: 8n, Security: 0n }, Reject: { Survival: 0n, Security: 0n } },
    }),
  );
  assert.deepEqual(recovery.consolidations, [
    { call: 'merge_gate', branch: 'Accept', gate: 'Survival', amount: 8n },
  ]);
  // 8 consolidated to branch-USDC → floor(8/2) = 4; the orphan 4 Security YES
  // legs pay floor(4/4) = 1.
  assert.equal(recovery.total, 5n);
  const security = recovery.residuals.find((row) => row.gate === 'Security');
  assert.deepEqual(security, {
    branch: 'Accept',
    kind: 'GateYes',
    gate: 'Security',
    amount: 4n,
    payout: 1n,
  });
});

test('every residue is floored independently, against the redeemer', () => {
  // §11.6 step 4 and PT-3: the floor applies per residual `PositionId`, not once
  // over a summed total. Three legs of 3 pay 0 each, not floor(9/4) = 2.
  // Three legs of 3, none of which can pair or consolidate. Each floors to 0,
  // where a pooled `floor(9/4)` would have paid 2 — the difference is the dust
  // the rule deliberately leaves with escrow.
  const recovery = decomposeVoidRecovery(
    holdings({
      long: { Accept: 3n, Reject: 3n },
      gateYes: { Accept: { Survival: 3n, Security: 0n }, Reject: { Survival: 0n, Security: 0n } },
    }),
  );
  assert.equal(recovery.residuals.length, 3, 'nothing here consolidates or pairs');
  const pooled = recovery.residuals.reduce((sum, row) => sum + row.amount, 0n);
  assert.equal(pooled, 9n);
  assert.equal(pooled / 4n, 2n, 'a pooled floor would have paid 2');
  for (const row of recovery.residuals) assert.equal(row.payout, 0n);
  assert.equal(recovery.total, 0n);
});

test('empty holdings recover nothing and promise nothing', () => {
  const recovery = decomposeVoidRecovery(holdings());
  assert.equal(recovery.total, 0n);
  assert.deepEqual(recovery.consolidations, []);
  assert.deepEqual(recovery.residuals, []);
  assert.equal(recovery.mayOfferParMerge, false);
  // Zero holdings leave no residue, so a `parPair > 0` test alone would be the
  // only thing standing between this and a 100 % headline over nothing.
  assert.equal(recovery.parCopyPermitted, false);
});

test('a negative balance is refused rather than netted against another', () => {
  assert.throws(
    () => decomposeVoidRecovery(holdings({ branchUsdc: { Accept: -1n, Reject: 0n } })),
    VoidHoldingsError,
  );
  assert.throws(
    () => decomposeVoidRecovery(holdings({ long: { Accept: 0n, Reject: -5n } })),
    VoidHoldingsError,
  );
});

test('the branch and gate sets this module iterates are the chain’s', () => {
  // A third branch or gate would make every loop above silently partial.
  assert.deepEqual([...BRANCHES], ['Accept', 'Reject']);
  assert.deepEqual([...GATE_TYPES], ['Survival', 'Security']);
});

test('no fee is computed or exposed anywhere on the VOID path', () => {
  // 11 §11.6 step 2 and 03 §5.3a(1): `redeem_void` and every `merge*` are exempt,
  // so the floors are gross and net alike. Asserted by absence, comments stripped
  // first — a fee line here would be wrong rather than redundant.
  const source = readFileSync(resolve(here, '../../src/features/tx/src/void-recovery.ts'), 'utf8');
  const scannable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(scannable, /\bfee\b/i, 'the VOID path computes no fee');
  assert.doesNotMatch(scannable, /redemptionFee|redeem_fee/, 'the VOID path imports no fee rate');
});
