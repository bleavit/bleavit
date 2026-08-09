/**
 * Tolerance policy (project-wide, restated per the test convention):
 *  - integer base-unit results (ledger payouts): EXACT equality, no tolerance;
 *  - values the spec computes on the floored 1e9 grid: absolute tolerance 2e-9;
 *  - pure real-valued transcendental results (LMSR cost/price): relative 1e-12.
 *
 * This module is a state machine, not arithmetic: it computes no value, so no
 * tolerance applies anywhere below and every assertion is exact structural
 * equality. The corpus rows it certifies are all 22 `decision_scenarios` of
 * `vectors.slim.json`, checked for agreement on *which* edge, destination state
 * and reason each row implies — the numeric legs of those rows belong to the
 * decision-engine module.
 *
 * Expectations here come from the specification text or from the corpus, never
 * from `lifecycle.ts`. Where the shape of an expectation could be produced by
 * calling the code under test — the per-state edge lists — the spec's own table
 * is transcribed by hand instead (`SPEC_OUTGOING`).
 */

import { describe, expect, it } from 'vitest';

import vectors from './__fixtures__/vectors.slim.json';
import {
  REJECT_REASON_META,
  STATE_META,
  STATE_TIERS,
  T10_REJECT_REASONS,
  T16_REJECT_REASONS,
  TRANSITIONS,
  fromStates,
  isTerminal,
  isTransient,
  pathFor,
  transitionById,
  transitionsFrom,
} from './lifecycle';
import type { TransitionId } from './lifecycle';
import {
  PROPOSAL_CLASSES,
  PROPOSAL_STATES,
  REJECT_REASONS,
  requiresGateMarkets,
  requiresRatification,
} from './types';
import type { ProposalClass, ProposalState, RejectReason } from './types';

const ALL_IDS: TransitionId[] = Array.from({ length: 26 }, (_, i) => `T${i + 1}` as TransitionId);

/**
 * The outgoing edges of every state, transcribed by hand from doc 05 §2.1's
 * *From → To* column and cross-read against the §2.2 diagram (which the spec
 * certifies as edge-for-edge identical to the table).
 *
 * Written out from the document on purpose. Deriving it from `TRANSITIONS` —
 * `TRANSITIONS.filter((t) => fromStates(t).includes(state))` — is exactly the
 * body of `transitionsFrom`, so such a test restates the implementation and can
 * never fail. §2.2 omits T20's nine force-reject edges "for legibility"; they are
 * added back here from the normative §2.1 T20 row. Ordering is the table's own,
 * T1…T26, which is the order `transitionsFrom` reports.
 */
const SPEC_OUTGOING: Readonly<Record<ProposalState, readonly TransitionId[]>> = {
  Submitted: ['T2', 'T3', 'T20'],
  Screening: ['T4', 'T5', 'T6', 'T20', 'T26'],
  Qualified: ['T7', 'T20'],
  Trading: ['T8', 'T9', 'T10', 'T20', 'T25'],
  Extended: ['T9', 'T10', 'T20', 'T25'],
  Queued: ['T11', 'T14', 'T15', 'T16', 'T18', 'T20', 'T25'],
  Suspended: ['T12', 'T20', 'T24'],
  Rerun: ['T13', 'T20'],
  Executed: ['T17'],
  FailedExecuted: ['T20', 'T22', 'T23'],
  Rejected: ['T21'],
  Expired: ['T21'],
  Measuring: ['T19'],
  Settled: [],
  Cancelled: [],
};

describe('the §2.1 table is complete and closed', () => {
  it('has exactly the 26 transitions T1..T26, each once', () => {
    expect(TRANSITIONS).toHaveLength(26);
    expect(TRANSITIONS.map((t) => t.id).sort()).toEqual([...ALL_IDS].sort());
  });

  it('is in table order, so the data reads like the spec', () => {
    expect(TRANSITIONS.map((t) => t.id)).toEqual(ALL_IDS);
  });

  it('names only real states and real reasons', () => {
    for (const t of TRANSITIONS) {
      expect(PROPOSAL_STATES).toContain(t.to);
      for (const from of fromStates(t)) expect(PROPOSAL_STATES).toContain(from);
      if (t.toReason !== undefined) expect(REJECT_REASONS).toContain(t.toReason);
    }
  });

  it('gives every transition a trigger, an origin, a guard and a citation into doc 05', () => {
    for (const t of TRANSITIONS) {
      expect(t.trigger.length).toBeGreaterThan(0);
      expect(t.origin.length).toBeGreaterThan(0);
      expect(t.guard.length).toBeGreaterThan(0);
      expect(t.cite.doc).toBe('05');
    }
  });

  it('has exactly one entry transition, T1', () => {
    const entries = TRANSITIONS.filter((t) => t.from === null);
    expect(entries.map((t) => t.id)).toEqual(['T1']);
    expect(transitionById('T1').to).toBe('Submitted');
  });

  it('looks up by id totally', () => {
    for (const id of ALL_IDS) expect(transitionById(id).id).toBe(id);
  });
});

describe('reachability', () => {
  it('reaches every state from Submitted', () => {
    const seen = new Set<ProposalState>(['Submitted']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of TRANSITIONS) {
        if (seen.has(t.to)) continue;
        if (fromStates(t).some((s) => seen.has(s))) {
          seen.add(t.to);
          grew = true;
        }
      }
    }
    expect([...seen].sort()).toEqual([...PROPOSAL_STATES].sort());
  });

  it('gives each state exactly the outgoing edges doc 05 §2.1 draws from it', () => {
    for (const state of PROPOSAL_STATES) {
      expect(
        transitionsFrom(state).map((t) => t.id),
        `outgoing edges of ${state}`,
      ).toEqual(SPEC_OUTGOING[state]);
    }
    // The transcription accounts for every origin the table writes: 38 edges over
    // 25 rows (T1 has no origin; T9/T10/T21 have two, T25 three, T20 nine).
    const edges = Object.values(SPEC_OUTGOING).reduce((sum, ids) => sum + ids.length, 0);
    expect(edges).toBe(38);
    expect(TRANSITIONS.reduce((sum, t) => sum + fromStates(t).length, 0)).toBe(38);
  });

  it('routes the force-reject T20 from every non-terminal pre-Executed state', () => {
    // SQ-319: Queued/Suspended/Rerun/FailedExecuted are pre-Executed *and* decided,
    // so they are in scope even though a DecisionOutcome already exists.
    expect(fromStates(transitionById('T20'))).toEqual([
      'Submitted',
      'Screening',
      'Qualified',
      'Trading',
      'Extended',
      'Queued',
      'Suspended',
      'Rerun',
      'FailedExecuted',
    ]);
    expect(transitionById('T20').toReason).toBe('ProcessHold');
    // A T20 vault is Voided, so measurement is unreachable — no T21 follow-up.
    expect(transitionById('T20').sameBlockFollowUp).toBeUndefined();
  });
});

describe('terminal versus transient', () => {
  it('stops only at Settled and Cancelled regardless of the vault', () => {
    const unconditional = PROPOSAL_STATES.filter((s) => isTerminal(s, true));
    expect([...unconditional].sort()).toEqual(['Cancelled', 'Settled']);
  });

  it('leaves no outgoing edge from a state that is terminal even with a healthy vault', () => {
    for (const state of PROPOSAL_STATES) {
      if (isTerminal(state, true)) expect(transitionsFrom(state)).toHaveLength(0);
    }
  });

  it('makes Rejected and Expired terminal only when the vault cannot resolve', () => {
    for (const state of ['Rejected', 'Expired'] as const) {
      expect(isTerminal(state, false)).toBe(true);
      expect(isTerminal(state, true)).toBe(false);
      expect(isTransient(state, true)).toBe(true);
      expect(isTransient(state, false)).toBe(false);
      // Their single outgoing edge is T21, whose guard is exactly that vault fact.
      expect(transitionsFrom(state).map((t) => t.id)).toEqual(['T21']);
    }
  });

  it('treats no other state as transient', () => {
    for (const state of PROPOSAL_STATES) {
      if (state === 'Rejected' || state === 'Expired') continue;
      expect(isTransient(state, true)).toBe(false);
      expect(isTransient(state, false)).toBe(false);
    }
  });

  it('marks the T10 -> T21 pair as the common path', () => {
    const t10 = transitionById('T10');
    expect(t10.sameBlockFollowUp).toBe('T21');
    expect(t10.commonPath).toBe(true);
    expect(transitionById('T21').commonPath).toBe(true);
  });

  it('declares a same-block T21 exactly where the bond is refunded and the vault survives', () => {
    const withFollowUp = TRANSITIONS.filter((t) => t.sameBlockFollowUp !== undefined).map((t) => t.id);
    expect(withFollowUp).toEqual(['T10', 'T15', 'T16', 'T24']);
    for (const id of withFollowUp) expect(transitionById(id).to).toMatch(/^(Rejected|Expired)$/);
  });
});

describe('pathFor', () => {
  it('expands the straight-through execution path', () => {
    expect(pathFor(['T1', 'T3', 'T5', 'T7', 'T9', 'T14', 'T17', 'T19'])).toEqual([
      'Submitted',
      'Screening',
      'Qualified',
      'Trading',
      'Queued',
      'Executed',
      'Measuring',
      'Settled',
    ]);
  });

  it('expands the most common path: rejected, then measured anyway', () => {
    expect(pathFor(['T1', 'T3', 'T5', 'T7', 'T10', 'T21', 'T19'])).toEqual([
      'Submitted',
      'Screening',
      'Qualified',
      'Trading',
      'Rejected',
      'Measuring',
      'Settled',
    ]);
  });

  it('expands the guardian delay-then-rerun arc', () => {
    expect(pathFor(['T1', 'T3', 'T5', 'T7', 'T9', 'T11', 'T12', 'T13', 'T9', 'T14', 'T17', 'T19'])).toEqual([
      'Submitted',
      'Screening',
      'Qualified',
      'Trading',
      'Queued',
      'Suspended',
      'Rerun',
      'Extended',
      'Queued',
      'Executed',
      'Measuring',
      'Settled',
    ]);
  });

  it('expands the failed-execution retry arc', () => {
    expect(pathFor(['T1', 'T3', 'T5', 'T7', 'T9', 'T18', 'T23', 'T17'])).toEqual([
      'Submitted',
      'Screening',
      'Qualified',
      'Trading',
      'Queued',
      'FailedExecuted',
      'Executed',
      'Measuring',
    ]);
  });

  it('rejects a disconnected path', () => {
    expect(() => pathFor(['T1', 'T14'])).toThrow(/T14 cannot follow T1/);
  });

  it('rejects a re-entered T1', () => {
    expect(() => pathFor(['T1', 'T3', 'T1'])).toThrow(/entry transition/);
  });

  it('enters a multi-origin head transition at the first origin the spec lists', () => {
    expect(pathFor(['T9', 'T14'])).toEqual(['Trading', 'Queued', 'Executed']);
  });

  it('visits one state per transition, plus the entry state', () => {
    expect(pathFor([])).toEqual([]);
    expect(pathFor(['T1'])).toEqual(['Submitted']); // T1 has no origin state
    expect(pathFor(['T3'])).toEqual(['Submitted', 'Screening']);
  });
});

describe('STATE_META', () => {
  it('describes every state exactly once, with a real tier and a citation', () => {
    expect(Object.keys(STATE_META).sort()).toEqual([...PROPOSAL_STATES].sort());
    for (const state of PROPOSAL_STATES) {
      const meta = STATE_META[state];
      expect(STATE_TIERS).toContain(meta.tier);
      expect(meta.blurb.length).toBeGreaterThan(20);
      expect(meta.blurb.endsWith('.')).toBe(true);
      expect(meta.cite.doc).toMatch(/^0[56]$/);
    }
  });

  it('puts the unconditionally terminal states, and only those, in the terminal tier', () => {
    const terminalTier = PROPOSAL_STATES.filter((s) => STATE_META[s].tier === 'terminal');
    expect([...terminalTier].sort()).toEqual(['Cancelled', 'Settled']);
    for (const state of terminalTier) expect(isTerminal(state, true)).toBe(true);
  });

  it('keeps Rejected and Expired next to Measuring, because T21 is the usual sequel', () => {
    expect(STATE_META['Rejected'].tier).toBe('measurement');
    expect(STATE_META['Expired'].tier).toBe('measurement');
    expect(STATE_META['Measuring'].tier).toBe('measurement');
  });
});

describe('REJECT_REASON_META', () => {
  it('covers the 17 frozen variants exactly', () => {
    expect(REJECT_REASONS).toHaveLength(17);
    expect(Object.keys(REJECT_REASON_META).sort()).toEqual([...REJECT_REASONS].sort());
  });

  it('gives every variant a blurb, a producing site and a citation', () => {
    for (const reason of REJECT_REASONS) {
      const meta = REJECT_REASON_META[reason];
      expect(meta.blurb.length).toBeGreaterThan(20);
      expect(meta.producedBy.length).toBeGreaterThan(10);
      expect(meta.cite.doc.length).toBe(2);
    }
  });

  it("marks only the live-hazard states 'safety' — rejection is the system working", () => {
    const safety = REJECT_REASONS.filter((r) => REJECT_REASON_META[r].severity === 'safety');
    expect([...safety].sort()).toEqual(['GateVetoSecurity', 'GateVetoSurvival', 'ProcessHold']);
    expect(REJECT_REASON_META['HurdleNotMet'].severity).toBe('routine');
  });

  it('records AttestationMissing as the one two-site variant (doc 05 §1.3)', () => {
    expect(REJECT_REASON_META['AttestationMissing'].producedBy).toMatch(/TWO sites/);
    expect(T10_REJECT_REASONS).toContain('AttestationMissing');
    expect(T16_REJECT_REASONS).toContain('AttestationMissing');
    // No other variant is produced at both a decide-time and a dispatch-time site.
    const both = REJECT_REASONS.filter(
      (r) => T10_REJECT_REASONS.includes(r) && T16_REJECT_REASONS.includes(r),
    );
    expect(both).toEqual(['AttestationMissing']);
  });

  it('binds the fixed-reason transitions to their variant', () => {
    expect(transitionById('T20').toReason).toBe('ProcessHold');
    expect(transitionById('T24').toReason).toBe('VetoUpheldByReview');
    expect(transitionById('T26').toReason).toBe('RolloverExhausted');
    // T10 and T16 carry a set, decided at runtime, so they fix no reason.
    expect(transitionById('T10').toReason).toBeUndefined();
    expect(transitionById('T16').toReason).toBeUndefined();
  });

  it('never labels a Rejected state with PayloadReverted', () => {
    // §1.3: it is an annotation on T18/T22, not a rejection reason.
    expect(TRANSITIONS.some((t) => t.toReason === 'PayloadReverted')).toBe(false);
    expect(T10_REJECT_REASONS).not.toContain('PayloadReverted');
    expect(T16_REJECT_REASONS).not.toContain('PayloadReverted');
  });
});

describe('agreement with the reference corpus (decision_scenarios)', () => {
  interface DecisionRow {
    readonly name: string;
    readonly outcome: string;
    readonly reason?: string;
    readonly inputs: Readonly<Record<string, unknown>>;
  }

  const rows = vectors.decision_scenarios as readonly DecisionRow[];

  /**
   * The §2.1 edge each §5.5 outcome takes out of the books, and the state it
   * lands in. Both columns are read off the specification, never off
   * `TRANSITIONS`: ADOPT is T9 → `Queued`, Extend is T8 → `Extended`, Reject is
   * T10 → `Rejected`.
   */
  const EDGE_FOR_OUTCOME: Readonly<
    Record<string, { readonly id: TransitionId; readonly to: ProposalState }>
  > = {
    Adopt: { id: 'T9', to: 'Queued' },
    Extend: { id: 'T8', to: 'Extended' },
    Reject: { id: 'T10', to: 'Rejected' },
  };

  /** The row's declared class, checked against the frozen doc 02 enum. */
  const classOf = (row: DecisionRow): ProposalClass | undefined => {
    const raw = row.inputs['proposal_class'];
    if (raw === undefined) return undefined;
    expect(PROPOSAL_CLASSES, row.name).toContain(raw);
    return raw as ProposalClass;
  };

  it('binds each of the 22 rows to the §2.1 edge its own outcome names', () => {
    expect(rows).toHaveLength(22);
    let certified = 0;

    for (const row of rows) {
      const edge = EDGE_FOR_OUTCOME[row.outcome];
      expect(edge, `${row.name}: unknown outcome ${row.outcome}`).toBeDefined();
      if (edge === undefined) continue;

      const t = transitionById(edge.id);
      // The edge leaves the books, and lands where §5.5's outcome column says.
      expect(fromStates(t).some((s) => s === 'Trading' || s === 'Extended'), row.name).toBe(true);
      expect(t.to, row.name).toBe(edge.to);

      // §2.1 T8: one shared extension budget per proposal, so a row that already
      // carries `extended` can never be an Extend — it can only reject (§5.5,
      // "disagreement/fail after extension").
      if (row.inputs['extended'] === true) expect(row.outcome, row.name).not.toBe('Extend');

      const cls = classOf(row);
      const reason = row.reason;
      if (reason !== undefined) {
        expect(row.outcome, row.name).toBe('Reject');
        expect(REJECT_REASONS, row.name).toContain(reason as RejectReason);
        expect(T10_REJECT_REASONS, row.name).toContain(reason as RejectReason);
        // §1.3's producer map, row by row: a decide-time reason names T10.
        expect(REJECT_REASON_META[reason as RejectReason].producedBy, row.name).toMatch(/T10/);

        // §1.1: Constitutional routes to the values track with no markets, so a
        // gate veto (step 4) can only be reached by a gate-bearing class.
        if (reason === 'GateVetoSurvival' || reason === 'GateVetoSecurity') {
          expect(cls, `${row.name}: a gate veto needs a declared class`).toBeDefined();
          if (cls !== undefined) expect(requiresGateMarkets(cls), row.name).toBe(true);
        }
        // §1.3: decide()'s step-10 attestation check is CODE/META only.
        if (reason === 'AttestationMissing') {
          expect(cls, `${row.name}: AttestationMissing needs a declared class`).toBeDefined();
          if (cls !== undefined) expect(requiresRatification(cls), row.name).toBe(true);
        }
      }
      certified += 1;
    }

    // No row was skipped by the `continue` above.
    expect(certified).toBe(22);
  });

  it('covers all twelve decide-time reasons — the corpus and the producer map agree', () => {
    const seen = new Set(rows.flatMap((r) => (r.reason === undefined ? [] : [r.reason])));
    expect([...seen].sort()).toEqual([...T10_REJECT_REASONS].sort());
  });
});
