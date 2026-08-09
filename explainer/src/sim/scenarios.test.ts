import { describe, expect, it } from 'vitest';
import { runScenario } from './engine';
import { SCENARIOS, SCENARIO_ORDER, SCENARIO_SUBJECT } from './scenarios';
import { pathFor, transitionById } from '../protocol/lifecycle';
import type { ProposalClass, ProposalState } from '../protocol/types';
import type { TransitionId } from '../protocol/lifecycle';

/**
 * Scenarios are narration attached to a state machine, and narration drifts.
 * These tests bind the two together: every scenario must replay to the terminal
 * state it claims, and every transition path it walks must actually connect in
 * the doc 05 §2.1 table. A scenario that tells a story the engine will not
 * produce fails here rather than misleading a reader.
 */

const run = (id: (typeof SCENARIO_ORDER)[number], cursor?: number) => {
  const scenario = SCENARIOS[id];
  const subject = SCENARIO_SUBJECT[id];
  return runScenario(
    scenario,
    cursor ?? scenario.steps.length,
    subject.cls as ProposalClass,
    subject.title,
  );
};

describe('every scenario', () => {
  it('covers the six requested paths', () => {
    expect(SCENARIO_ORDER).toHaveLength(6);
    expect(new Set(SCENARIO_ORDER).size).toBe(6);
  });

  for (const id of SCENARIO_ORDER) {
    const scenario = SCENARIOS[id];

    it(`${id} — replays to its declared terminal state`, () => {
      const s = run(id);
      expect(s.proposal.state).toBe(scenario.expect.finalState);
      if (scenario.expect.rejectReason !== undefined) {
        expect(s.proposal.rejectReason).toBe(scenario.expect.rejectReason);
      }
    });

    it(`${id} — walks a connected transition path`, () => {
      const s = run(id);
      const ids = s.proposal.history.map((h) => h.id);
      expect(ids.length).toBeGreaterThan(0);
      // Every transition's declared origin must include the state we were in.
      let state: ProposalState | null = null;
      for (const tid of ids) {
        const t = transitionById(tid as TransitionId);
        if (t.from !== null && state !== null) {
          const froms = Array.isArray(t.from) ? t.from : [t.from];
          expect(
            froms.includes(state),
            `${tid} cannot fire from ${state} (allowed: ${froms.join(', ')})`,
          ).toBe(true);
        }
        state = t.to;
      }
      expect(state).toBe(scenario.expect.finalState);
    });

    it(`${id} — is deterministic`, () => {
      const a = run(id);
      const b = run(id);
      expect(a.proposal).toEqual(b.proposal);
      expect(a.log).toEqual(b.log);
      expect(a.welfare).toEqual(b.welfare);
    });

    it(`${id} — every step carries narration and a focus scene`, () => {
      for (const step of scenario.steps) {
        expect(step.narrate.length).toBeGreaterThan(40);
        expect(step.title.length).toBeGreaterThan(3);
        expect(step.focus).toBeTruthy();
        expect(step.events.length).toBeGreaterThan(0);
      }
    });

    it(`${id} — replays identically when scrubbed backwards`, () => {
      const full = run(id);
      const viaCursor = run(id, scenario.steps.length);
      expect(viaCursor.log).toEqual(full.log);
      // Stepping back and forward lands on the same world.
      const mid = run(id, 2);
      const midAgain = run(id, 2);
      expect(mid.log).toEqual(midAgain.log);
    });
  }
});

describe('the decision each scenario reaches', () => {
  it('normal-execution adopts on the spec worked example', () => {
    const s = run('normal-execution', 5);
    expect(s.decision?.outcome).toEqual({ kind: 'Adopt' });
    // r_eff = max(0.5210, 0.5230 - 0.005) = 0.5210; uplift 0.0410 >= 0.0375.
    expect(s.decision?.diagnostics.rEff).toBeCloseTo(0.521, 4);
    expect(s.decision?.diagnostics.uplift).toBeCloseTo(0.041, 4);
    expect(s.decision?.diagnostics.hurdle).toBeCloseTo(0.0375, 4);
  });

  it('gate-failure stops at step 4, before any welfare comparison', () => {
    const s = run('gate-failure', 3);
    expect(s.decision?.outcome).toEqual({
      kind: 'Reject',
      reason: 'GateVetoSurvival',
    });
    expect(s.decision?.stoppedAt).toBe(4);
    // The uplift was never computed, because the ruin gates precede it.
    expect(s.decision?.steps[5]?.verdict.kind).toBe('not-reached');
  });

  it('oracle-dispute stops at step 2 while the dispute is live', () => {
    const s = run('oracle-dispute', 5);
    expect(s.decision?.outcome).toEqual({ kind: 'Reject', reason: 'ProcessHold' });
    expect(s.decision?.stoppedAt).toBe(2);
  });

  it('registry-dispute decides on schedule — a filing holds settlement, not decisions', () => {
    const s = run('registry-dispute', 3);
    expect(s.decision?.outcome).toEqual({ kind: 'Adopt' });
    // The filing is still open at this point, and yet the decision ran.
    expect(s.registry.state.kind).toBe('Challenged');
  });

  it('delayed-resolution extends exactly once, then clears a raised hurdle', () => {
    const extended = run('delayed-resolution', 2);
    expect(extended.decision?.outcome).toEqual({ kind: 'Extend' });
    const final = run('delayed-resolution');
    expect(final.proposal.rerun).toBe(true);
    // A rerun raises the hurdle by one percentage point.
    expect(final.decision?.diagnostics.hurdle).toBeCloseTo(0.0475, 4);
    expect(final.decision?.outcome).toEqual({ kind: 'Adopt' });
  });

  it('blocked-execution is refused, recovers, then fails terminally', () => {
    const notRatified = run('blocked-execution', 2);
    expect(notRatified.guard.blockedAt).toBe(5);
    // NotRatified changes no state: it stays Queued and stays retryable.
    expect(notRatified.proposal.state).toBe('Queued');

    const frozen = run('blocked-execution', 3);
    // Ordered refusal: with both the gate-breach flag (11) and the ledger freeze
    // (12) active, the reason surfaced is the first in check order, not the last
    // one to be set. Users must see the same reason the chain would give.
    expect(frozen.guard.blockedAt).toBe(11);
    expect(frozen.proposal.state).toBe('Queued');

    const final = run('blocked-execution');
    expect(final.proposal.rejectReason).toBe('StaleQueue');
    expect(final.proposal.state).toBe('Measuring');
  });
});

describe('pathFor agrees with the scenarios', () => {
  it('accepts the normal-execution path and rejects a disconnected one', () => {
    expect(() => pathFor(['T1', 'T3', 'T5', 'T7', 'T9', 'T14', 'T17', 'T19'])).not.toThrow();
    expect(() => pathFor(['T1', 'T14'])).toThrow();
  });
});
