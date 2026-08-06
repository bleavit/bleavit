/**
 * The statistic 10 §9.4's render row is gated on — `app/tools/render-budget/statistic.ts`.
 *
 * This suite exists because the gate spent its first day comparing the wrong one. §9.4
 * publishes two thresholds per form factor under the heading *"Target (p50 / p95)"*, and the
 * gate compared a three-run **median** against both. A median says nothing about a tail: one
 * run in three could sit far above the hard-fail threshold with the gate green, which is a
 * budget that reads enforced and is not (P1 on PR #254, 2026-08-06).
 *
 * The first case below is the reviewer's own example, kept verbatim in numbers, because a
 * regression test whose sample nobody recognises is one somebody later "simplifies".
 *
 * A Lighthouse run cannot be made to produce these samples on demand, which is why the
 * statistics live in a module with no Chrome in it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assess, median, tailP95 } from '../../tools/render-budget/statistic.ts';

/** 10 §9.4's mobile cells: ≤ 3 s p50, ≤ 6 s p95. */
const MOBILE = { targetMs: 3_000, hardFailMs: 6_000 } as const;

test('a severe tail is refused, and the median that hid it is still 2 s', () => {
  const samples = [2_000, 2_000, 20_000];
  const verdict = assess(samples, MOBILE);

  // The statistic the gate used to compare. It passes, which is the whole defect: a third
  // of the sample is over three times the published p95 and nothing said so.
  assert.equal(verdict.median, 2_000);
  assert.equal(verdict.median <= MOBILE.hardFailMs, true);

  // The statistic it compares now.
  assert.equal(verdict.tail, 20_000);
  assert.equal(verdict.overHardFail, true);
});

test('the p95 tail of three runs is the slowest run, whatever order they arrive in', () => {
  assert.equal(tailP95([2_000, 20_000, 2_000]), 20_000);
  assert.equal(tailP95([20_000, 2_000, 2_000]), 20_000);
  assert.equal(median([20_000, 2_000, 2_000]), 2_000);
});

test('a sample inside both cells is admitted', () => {
  const verdict = assess([1_803, 1_809, 1_805], MOBILE);
  assert.equal(verdict.overHardFail, false);
  assert.equal(verdict.overTarget, false);
});

test('a median over p50 whose tail is inside p95 warns and does not fail', () => {
  // §9.4 permits this: the p50 is a target and the p95 is the threshold. Collapsing them
  // would block work the document allows.
  const verdict = assess([3_500, 3_600, 4_000], MOBILE);
  assert.equal(verdict.overTarget, true);
  assert.equal(verdict.overHardFail, false);
  assert.equal(verdict.median, 3_600);
});

test('one slow run fails even when the other two are fast', () => {
  // The direction that matters. Two fast runs cannot buy back a tail: the threshold is
  // stated for the tail, and this comparison errs toward refusing.
  const verdict = assess([400, 420, 6_100], MOBILE);
  assert.equal(verdict.overHardFail, true);
  assert.equal(verdict.overTarget, false);
});

test('nearest rank selects the maximum up to nineteen runs, and stops at twenty', () => {
  // The claim `statistic.ts` makes about itself, and the reason the percentile is written out
  // rather than hardcoded as "the maximum": raising the run count to twenty starts estimating a
  // real p95 instead of quietly keeping a maximum under a p95 label. The boundary is nineteen
  // and not twenty — ⌈0.95·n⌉ = n while 0.05·n < 1 — and this case is why the file says so.
  const nineteen = Array.from({ length: 19 }, (_unused, index) => index + 1);
  assert.equal(tailP95(nineteen), 19);
  const twenty = Array.from({ length: 20 }, (_unused, index) => index + 1);
  assert.equal(tailP95(twenty), 19);
});

test('an empty sample is refused rather than defaulted', () => {
  // Every default available here reads as a fast render: zero passes both thresholds and
  // `undefined` compares false against both.
  assert.throws(() => tailP95([]), RangeError);
  assert.throws(() => median([]), RangeError);
});

test('a metric that produced no duration is refused', () => {
  assert.throws(() => assess([1_000, Number.NaN, 1_000], MOBILE), RangeError);
  assert.throws(() => assess([1_000, 0, 1_000], MOBILE), RangeError);
});
