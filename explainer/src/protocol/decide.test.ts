import { describe, expect, it } from 'vitest';
import { decide } from './decide';
import type { DecisionInputs } from './decide';
import type { GateType, ProposalClass, WelfareGrade } from './types';
import { REJECT_REASONS } from './types';
import vectors from './__fixtures__/vectors.slim.json';

/**
 * Certification against the repository's own reference corpus.
 *
 * `decision_scenarios` is the same family the Rust differential suite replays,
 * so agreement here is agreement with the chain's decision rule — not with a
 * paraphrase of it. Twenty-two rows cover every reason code the engine can
 * produce plus the ordering constraints between them.
 *
 * Tolerance policy: these are exact discrete outcomes. There is no tolerance —
 * an outcome either matches the corpus or the implementation is wrong.
 */

interface RawScenario {
  name: string;
  outcome: string;
  reason?: string;
  l_hat?: string;
  inputs: Record<string, unknown>;
}

const scenarios = vectors.decision_scenarios as unknown as RawScenario[];

const num = (v: unknown): number | undefined =>
  v === undefined ? undefined : Number(v as string);

const gateMap = (
  v: unknown,
): Partial<Record<GateType, number>> | undefined => {
  if (v === undefined || v === null) return undefined;
  const o = v as Record<string, string>;
  const out: Partial<Record<GateType, number>> = {};
  if (o['Survival'] !== undefined) out.Survival = Number(o['Survival']);
  if (o['Security'] !== undefined) out.Security = Number(o['Security']);
  return out;
};

const gateBoolMap = (
  v: unknown,
): Partial<Record<GateType, boolean>> | undefined => {
  if (v === undefined || v === null) return undefined;
  const o = v as Record<string, boolean>;
  const out: Partial<Record<GateType, boolean>> = {};
  if (o['Survival'] !== undefined) out.Survival = Boolean(o['Survival']);
  if (o['Security'] !== undefined) out.Security = Boolean(o['Security']);
  return out;
};

/** Translate one corpus row into the engine's input shape. */
function toInputs(raw: Record<string, unknown>): DecisionInputs {
  const pAdopt = gateMap(raw['p_adopt']);
  const pReject = gateMap(raw['p_reject']);
  const pMax = gateMap(raw['p_max']);
  const eps = gateMap(raw['eps']);
  const valid = gateBoolMap(raw['gate_valid']);

  let gates: DecisionInputs['gates'];
  if (
    pAdopt !== undefined ||
    pReject !== undefined ||
    pMax !== undefined ||
    eps !== undefined ||
    valid !== undefined
  ) {
    gates = {};
    for (const g of ['Survival', 'Security'] as const) {
      const entry: Record<string, unknown> = {};
      if (pAdopt?.[g] !== undefined) entry['pAdopt'] = pAdopt[g];
      if (pReject?.[g] !== undefined) entry['pReject'] = pReject[g];
      if (pMax?.[g] !== undefined) entry['pMax'] = pMax[g];
      if (eps?.[g] !== undefined) entry['eps'] = eps[g];
      if (valid?.[g] !== undefined) entry['bookValid'] = valid[g];
      if (Object.keys(entry).length > 0) gates[g] = entry;
    }
  }

  const out: Record<string, unknown> = {
    acceptFull: Number(raw['accept_full']),
    rejectFullEffective: Number(raw['reject_full_effective']),
    delta: Number(raw['delta']),
  };
  const opt = (key: string, target: string, f: (v: unknown) => unknown) => {
    if (raw[key] !== undefined) out[target] = f(raw[key]);
  };
  opt('accept_trailing', 'acceptTrailing', num);
  opt('reject_trailing_effective', 'rejectTrailingEffective', num);
  opt('converged', 'converged', Boolean);
  opt('extended', 'extended', Boolean);
  opt('preimage_ok', 'preimageOk', Boolean);
  opt('resource_locks_held', 'resourceLocksHeld', Boolean);
  opt('process_hold', 'processHold', Boolean);
  opt('gate_book_valid', 'gateBookValid', Boolean);
  opt('welfare_grade', 'welfareGrade', (v) => v as WelfareGrade);
  opt('proposal_class', 'proposalClass', (v) => v as ProposalClass);
  opt('ask', 'ask', num);
  opt('envelope_value', 'envelopeValue', num);
  opt('spendable_nav', 'spendableNav', num);
  opt('measured_liquidity', 'measuredLiquidity', num);
  opt('pol_depth', 'polDepth', num);
  opt('contest_accept', 'contestAccept', num);
  opt('contest_reject', 'contestReject', num);
  opt('flow_cap', 'flowCap', num);
  opt('b_accept', 'bAccept', num);
  opt('b_reject', 'bReject', num);
  opt('published_flow_per_day', 'publishedFlowPerDay', num);
  opt('decision_window', 'decisionWindow', num);
  opt('attestation_ok', 'attestationOk', Boolean);
  opt('queue_time_ok', 'queueTimeOk', Boolean);
  if (gates !== undefined) out['gates'] = gates;

  return out as unknown as DecisionInputs;
}

describe('decide() against the reference corpus', () => {
  it('has the full corpus available', () => {
    expect(scenarios.length).toBe(22);
  });

  for (const s of scenarios) {
    it(`${s.name} -> ${s.outcome}${s.reason ? `(${s.reason})` : ''}`, () => {
      const trace = decide(toInputs(s.inputs));

      if (s.outcome === 'Adopt') {
        expect(trace.outcome).toEqual({ kind: 'Adopt' });
      } else if (s.outcome === 'Extend') {
        expect(trace.outcome).toEqual({ kind: 'Extend' });
      } else {
        expect(trace.outcome.kind).toBe('Reject');
        if (trace.outcome.kind === 'Reject') {
          expect(trace.outcome.reason).toBe(s.reason);
        }
      }
    });
  }

  it('certifies every reason code the corpus exercises', () => {
    const seen = new Set(
      scenarios.filter((s) => s.reason !== undefined).map((s) => s.reason),
    );
    // The corpus does not exercise the post-queue reasons, which are produced by
    // the execution guard rather than by decide(). Name them so the gap is
    // explicit rather than silent.
    const postQueue = new Set([
      'StaleQueue',
      'NotRatified',
      'PayloadReverted',
      'VetoUpheldByReview',
      'RolloverExhausted',
    ]);
    for (const r of REJECT_REASONS) {
      if (postQueue.has(r)) continue;
      expect(seen.has(r), `corpus should exercise ${r}`).toBe(true);
    }
  });
});

describe('the trace, not just the verdict', () => {
  const base: DecisionInputs = {
    proposalClass: 'Treasury',
    acceptFull: 0.562,
    rejectFullEffective: 0.521,
    acceptTrailing: 0.562,
    rejectTrailingEffective: 0.5222,
    delta: 0.0375,
    ask: 200_000,
    polDepth: 34_657.359028,
    contestAccept: 400_000,
    contestReject: 400_000,
    flowCap: 8,
    bAccept: 25_000,
    bReject: 25_000,
  };

  it('always reports eleven steps, in order', () => {
    const t = decide(base);
    expect(t.steps).toHaveLength(11);
    expect(t.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('reproduces the doc 04 §12 worked example as an Adopt', () => {
    // TREASURY, b = 25,000/branch. r_eff = max(0.5210, 0.5230 - 0.005) = 0.5210,
    // uplift 0.0410 >= delta_TREASURY 0.0375.
    const t = decide(base);
    expect(t.outcome).toEqual({ kind: 'Adopt' });
    expect(t.diagnostics.uplift).toBeCloseTo(0.041, 6);
    expect(t.diagnostics.hurdle).toBeCloseTo(0.0375, 6);
  });

  it('marks steps after a refusal as not-reached, never as passed', () => {
    const t = decide({ ...base, processHold: true });
    expect(t.stoppedAt).toBe(2);
    const after = t.steps.slice(2);
    expect(after.every((s) => s.verdict.kind === 'not-reached')).toBe(true);
  });

  it('runs the ruin gates before any welfare comparison', () => {
    // A proposal that would clear the hurdle comfortably is still vetoed, and the
    // hurdle steps are never even evaluated. No welfare margin overrides a veto.
    const t = decide({
      ...base,
      acceptFull: 0.99,
      gates: { Survival: { pAdopt: 0.06, pReject: 0.01 } },
    });
    expect(t.outcome).toEqual({ kind: 'Reject', reason: 'GateVetoSurvival' });
    expect(t.stoppedAt).toBe(4);
    expect(t.steps[5]?.verdict.kind).toBe('not-reached');
  });

  it('reports a rerun hurdle one percentage point higher', () => {
    const t = decide({ ...base, rerun: true });
    expect(t.diagnostics.hurdle).toBeCloseTo(0.0475, 6);
    // 0.0410 uplift no longer clears a 0.0475 hurdle.
    expect(t.outcome).toEqual({ kind: 'Reject', reason: 'HurdleNotMet' });
  });

  it('renders an absent prize proxy as unavailable, never as zero', () => {
    const t = decide({
      proposalClass: 'Param',
      acceptFull: 0.56,
      rejectFullEffective: 0.5,
      delta: 0.05,
      measuredLiquidity: 1_000_000,
    });
    expect(t.outcome).toEqual({ kind: 'Reject', reason: 'SecuritySizing' });
    const sizing = t.steps[8];
    const prize = sizing?.facts.find((f) => f.label === 'InCapPrize');
    expect(prize?.value).toContain('unavailable');
  });

  it('never checks ratification at decide time', () => {
    // The single ratification deadline is at execute (D-5). A CODE proposal with
    // no passed referendum must still be adoptable here.
    const t = decide({
      ...base,
      proposalClass: 'Code',
      ask: 0,
      spendableNav: 0,
      envelopeValue: 0,
    });
    expect(t.outcome).toEqual({ kind: 'Adopt' });
    const meters = t.steps[9];
    const rat = meters?.facts.find((f) => f.label === 'Ratification');
    expect(rat?.value).toContain('execute');
  });

  it('skips the gate steps for a Constitutional proposal', () => {
    const t = decide({ ...base, proposalClass: 'Constitutional' });
    expect(t.steps[2]?.verdict.kind).toBe('skip');
    expect(t.steps[3]?.verdict.kind).toBe('skip');
  });
});
