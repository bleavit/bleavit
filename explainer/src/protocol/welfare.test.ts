/**
 * Conformance of the welfare pipeline against the reference corpus.
 *
 * Tolerance policy (stated per the module contract):
 *  - Integer base-unit results (ledger payouts): EXACT. None occur here.
 *  - Values the spec computes on the floored 1e9 grid — every pillar, `W`, `s`:
 *    absolute tolerance 2e-9, i.e. two grid units.
 *  - Pure real-valued transcendental results (LMSR cost/price): relative 1e-12.
 *    None occur here. The one transcendental left in this module is `exp2`, and
 *    it is floored onto the grid before it is observable; the square root behind
 *    `s` is taken on the grid integers, so it is exact rather than tolerated.
 *
 * In fact **every** field of every corpus row lands grid-exact, so each
 * assertion checks both: the contractual 2e-9 band and the stronger observed
 * fact that the 1e9-grid integers are identical. If a future engine or platform
 * loses the exact match, the second assertion says so loudly instead of the
 * tolerance quietly absorbing it.
 *
 * The corpus alone is not sufficient evidence and the suite does not pretend it
 * is: none of the eight rows carries a value in the ~2% of the 1e9 grid whose
 * double representation floors a whole ulp low (`0.500000005 · 1e9` is
 * `500000004.99999994`), so a re-flooring bug is invisible to all eight. The
 * `grid discipline` block below pins that class directly, against values taken
 * from the Python reference model — the 15 §4.4 arbiter — rather than from this
 * port.
 */

import { describe, expect, it } from 'vitest';

import vectors from './__fixtures__/vectors.slim.json';
import { EPSILON_C, EPSILON_P, THETA_C_LO_FLOOR, THETA_S_LO_FLOOR } from './constants';
import {
  collatorDEff,
  collatorNCap,
  dropAndRenormalize,
  emptiedPillarGroups,
  fullPipeline,
  fullPipelineRenormalized,
  gate,
  geoComposite,
  geometricMean,
  pillarValues,
  settlementScore,
  THETA_C_HI,
  THETA_S_HI,
  V1_METRICS,
  V1_METRICS_BY_ID,
  weightedGeometric,
  welfareValue,
} from './welfare';
import type { MetricId, PipelineInputs, WeightedComponent } from './welfare';

const GRID_TOLERANCE = 2e-9;
const units = (x: number): number => Math.round(x * 1e9);

/** Both readings of the same claim: the contractual band and the observed grid identity. */
function expectOnGrid(got: number, want: number): void {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(GRID_TOLERANCE);
  expect(units(got)).toBe(units(want));
}

// ---------------------------------------------------------------------------
// Corpus shapes (bleavit.reference-model.v4, `welfare_scenarios`)
// ---------------------------------------------------------------------------

interface SettlementRow {
  readonly name: string;
  readonly inputs: { readonly w_next: string; readonly w_next_2: string };
  readonly s: string;
}

type Values = Readonly<Record<string, string>>;

interface PipelineRow {
  readonly name: string;
  readonly inputs: {
    readonly u: string;
    readonly f: string;
    readonly hhi: string;
    readonly phase: number;
    readonly incident: string;
    readonly c_onchain: Values;
    readonly c_attested: Values;
    readonly c_daily: Values;
    readonly c_weights: Values;
    readonly p_components: Values;
    readonly p_weights: Values;
    readonly a_components: Values;
    readonly a_weights: Values;
  };
  readonly outputs: Values;
  readonly settlement_with_self: string;
  readonly dropped?: readonly string[];
}

const rows = vectors.welfare_scenarios as unknown as readonly (SettlementRow | PipelineRow)[];
const isSettlementRow = (row: SettlementRow | PipelineRow): row is SettlementRow => 's' in row;

function pipelineRow(name: string): PipelineRow {
  const row = rows.find((r) => r.name === name);
  if (row === undefined || isSettlementRow(row)) throw new Error(`corpus: no pipeline row ${name}`);
  return row;
}

function components(values: Values, weights: Values): WeightedComponent[] {
  return Object.entries(values).map(([id, value]) => {
    const weight = weights[id];
    if (weight === undefined) throw new Error(`corpus: no weight for ${id}`);
    return { id, value: Number(value), weight: Number(weight) };
  });
}

function inputsFor(row: PipelineRow): PipelineInputs {
  const i = row.inputs;
  return {
    u: Number(i.u),
    f: Number(i.f),
    hhi: Number(i.hhi),
    phase: i.phase,
    incident: Number(i.incident),
    cOnchain: components(i.c_onchain, i.c_weights),
    cAttested: components(i.c_attested, i.c_weights),
    cDaily: Object.entries(i.c_daily).map(([id, value]) => ({ id, value: Number(value) })),
    p: components(i.p_components, i.p_weights),
    a: components(i.a_components, i.a_weights),
  };
}

// ---------------------------------------------------------------------------

describe('welfare — doc 05 §4', () => {
  describe('reference corpus (welfare_scenarios)', () => {
    it('covers all eight rows', () => {
      expect(rows).toHaveLength(8);
      expect(rows.filter(isSettlementRow)).toHaveLength(2);
      expect(rows.filter((r) => !isSettlementRow(r) && r.dropped !== undefined)).toHaveLength(3);
    });

    for (const row of rows.filter(isSettlementRow)) {
      it(`${row.name}: s = GeoMean(W₁, W₂)`, () => {
        const s = settlementScore(Number(row.inputs.w_next), Number(row.inputs.w_next_2));
        expectOnGrid(s, Number(row.s));
      });
    }

    for (const row of rows) {
      if (isSettlementRow(row)) continue;
      it(`${row.name}: every pillar, W and s`, () => {
        const dropped = row.dropped;
        const result =
          dropped === undefined
            ? fullPipeline(inputsFor(row))
            : fullPipelineRenormalized(inputsFor(row), dropped);

        // Certify every declared output field, not a chosen subset: the fields
        // that make a row interesting differ from row to row.
        const got = new Map<string, number>(Object.entries(result));
        for (const [field, want] of Object.entries(row.outputs)) {
          const value = got.get(field);
          if (value === undefined) throw new Error(`corpus: ${row.name} declares an output ${field} the pipeline does not return`);
          expectOnGrid(value, Number(want));
        }
        expect(Object.keys(row.outputs).sort()).toEqual(
          ['A', 'C', 'C_daily', 'D_eff', 'P', 'S', 'S_daily', 'W'],
        );
        expectOnGrid(settlementScore(result.W, result.W), Number(row.settlement_with_self));
      });
    }

    it('the cliff: two rows differing only in liveness score 0 and 0.4167', () => {
      const flat = pipelineRow('full_pipeline');
      const live = pipelineRow('full_pipeline_live_gates');
      // Same C, same P, same A. Only S moves — from below θS⁻ to above θS⁺.
      expect(live.outputs.C).toBe(flat.outputs.C);
      expect(live.outputs.P).toBe(flat.outputs.P);
      expect(live.outputs.A).toBe(flat.outputs.A);
      expect(Number(flat.outputs.S)).toBeLessThan(THETA_S_LO_FLOOR);
      expect(fullPipeline(inputsFor(flat)).W).toBe(0);
      expect(fullPipeline(inputsFor(live)).W).toBeGreaterThan(0.41);
    });
  });

  describe('gate g(x; lo, hi) — §4.1, rounded per §4.4(3)', () => {
    it('is exactly zero below the lower knee and exactly one at the upper', () => {
      expect(gate(0.83125, THETA_S_LO_FLOOR, THETA_S_HI)).toBe(0);
      expect(gate(0.899999999, THETA_S_LO_FLOOR, THETA_S_HI)).toBe(0);
      expect(gate(THETA_S_LO_FLOOR, THETA_S_LO_FLOOR, THETA_S_HI)).toBe(0);
      expect(gate(THETA_S_HI, THETA_S_LO_FLOOR, THETA_S_HI)).toBe(1);
      expect(gate(0.99, THETA_S_LO_FLOOR, THETA_S_HI)).toBe(1);
    });

    it('is the smoothstep between the knees, on the grid', () => {
      // The midpoint is the value a double subtraction gets wrong: 0.94 − 0.90
      // is 0.040000000000000036, and t then floors to 0.499999999.
      expect(gate(0.94, THETA_S_LO_FLOOR, THETA_S_HI)).toBe(0.5);
      expect(gate(0.9, THETA_C_LO_FLOOR, THETA_C_HI)).toBe(0.5);
      expectOnGrid(gate(0.904379942, THETA_C_LO_FLOOR, THETA_C_HI), 0.56553108);
    });

    it('is monotone across the band', () => {
      let previous = -1;
      for (let n = 899_000_000; n <= 981_000_000; n += 1_000_000) {
        const g = gate(n / 1e9, THETA_S_LO_FLOOR, THETA_S_HI);
        expect(g).toBeGreaterThanOrEqual(previous);
        previous = g;
      }
      expect(previous).toBe(1);
    });

    it('refuses an inverted band', () => {
      expect(() => gate(0.9, 0.95, 0.95)).toThrow(RangeError);
    });
  });

  describe('weighted geometric aggregation — §4.4(2)', () => {
    const two: WeightedComponent[] = [
      { id: 20, value: 0.8, weight: 0.6 },
      { id: 21, value: 0.7, weight: 0.4 },
    ];

    it('matches the corpus P pillar', () => {
      expectOnGrid(weightedGeometric(two, EPSILON_P), 0.758391065);
    });

    it('is order-independent because it sorts by MetricId', () => {
      expect(weightedGeometric([...two].reverse(), EPSILON_P)).toBe(weightedGeometric(two, EPSILON_P));
    });

    it('floors a dead component at ε rather than annihilating the pillar', () => {
      const withZero: WeightedComponent[] = [
        { id: 1, value: 0, weight: 0.5 },
        { id: 2, value: 1, weight: 0.5 },
      ];
      // sqrt(0.01 · 1) = 0.1, not 0: the ε floor bounds the damage one dead
      // component can do through the logarithm.
      //
      // The ONE place this port does not land grid-exact on the reference, and
      // it is the documented §4.4 rule-3 effect rather than a defect: the true
      // value is exactly on the 1e9 grid, and the reference's 64.64 truncation
      // of `0.5·log2(0.01)` puts the round trip one ulp under, so it reports
      // 0.099999999 (confirmed by running it). Rule 3 carves that out only for a
      // degenerate single-term group, never for a genuine multi-term product, so
      // the reference is conforming and so is this. No corpus row is affected;
      // all eight land grid-exact.
      //
      // Both numbers are pinned rather than hidden inside the 2e-9 band: a band
      // that admits 0.099999999, 0.100000000 and 0.100000001 alike would let
      // this port drift to a third answer without saying so.
      const REFERENCE = 0.099999999;
      expect(weightedGeometric(withZero, EPSILON_C)).toBe(0.1);
      expect(units(0.1) - units(REFERENCE)).toBe(1);
      expect(Math.abs(0.1 - REFERENCE)).toBeLessThanOrEqual(GRID_TOLERANCE);
    });

    it('evaluates a degenerate single-term group exactly (§4.4 rule 3)', () => {
      // Not an optimization: exp2(1·log2 x) truncates one grid ulp low in both
      // conforming implementations, which is wrong rather than imprecise.
      expect(weightedGeometric([{ id: 31, value: 0.6, weight: 1 }], EPSILON_P)).toBe(0.6);
      expect(weightedGeometric([{ id: 31, value: 0.123456789, weight: 1 }], EPSILON_P)).toBe(0.123456789);
      // The ε floor still applies to the survivor.
      expect(weightedGeometric([{ id: 31, value: 0, weight: 1 }], EPSILON_P)).toBe(EPSILON_P);
    });

    it('renormalizes on the Q64.64 grid, reaching weight exactly 1 after a drop', () => {
      const pair: WeightedComponent[] = [
        { id: 30, value: 0.9, weight: 0.4 },
        { id: 31, value: 0.6, weight: 0.6 },
      ];
      expect(dropAndRenormalize(pair, [30], EPSILON_P)).toBe(0.6);
      // The corpus C pillar after dropping the attested component: 0.5/0.3 of a
      // 0.8 surviving sum, i.e. 0.625/0.375.
      const cJoint: WeightedComponent[] = [
        { id: 'C01', value: 0.94, weight: 0.5 },
        { id: 'C02', value: 0.91, weight: 0.3 },
        { id: 'C03', value: 0.9, weight: 0.2 },
      ];
      expectOnGrid(dropAndRenormalize(cJoint, ['C03'], EPSILON_C), 0.928635817);
    });

    it('declines a drop that would empty the group (§4.4 rule 1)', () => {
      const pair: WeightedComponent[] = [
        { id: 30, value: 0.9, weight: 0.4 },
        { id: 31, value: 0.6, weight: 0.6 },
      ];
      // An empty weighted product is 1 — a perfect pillar from total
      // unavailability. The group keeps everything instead.
      expect(dropAndRenormalize(pair, [30, 31], EPSILON_P)).toBe(weightedGeometric(pair, EPSILON_P));
    });

    it('refuses an empty group or a zero weight sum', () => {
      expect(() => weightedGeometric([], EPSILON_P)).toThrow(RangeError);
      expect(() => weightedGeometric([{ id: 1, value: 0.5, weight: 0 }], EPSILON_P)).toThrow(RangeError);
    });
  });

  describe('collator concentration — §4.5', () => {
    it('caps n by rollout phase', () => {
      expect([0, 1, 2, 3, 4, 5, 6, 9].map(collatorNCap)).toEqual([5, 5, 5, 5, 6, 7, 8, 8]);
      expect(() => collatorNCap(-1)).toThrow(RangeError);
    });

    it('scores an equal 5-collator launch set at exactly 1', () => {
      // HHI of five equal shares is 5·0.2² = 0.2. Without the phase cap this
      // would read 0.914 against n_ref = 8 and drag g(S) to ≈ 0.08.
      expect(collatorDEff(0.2, 2)).toBe(1);
      expectOnGrid(collatorDEff(0.2, 6), 0.914285714);
    });

    it('still punishes genuine concentration (§4.5 worked example)', () => {
      // 40/40/10/5/5 authorship ⇒ HHI = 0.335 ⇒ 0.83125, below θS⁻.
      expect(collatorDEff(0.335, 2)).toBe(0.83125);
      expect(collatorDEff(0.335, 2)).toBeLessThan(THETA_S_LO_FLOOR);
      expect(() => collatorDEff(1.5, 2)).toThrow(RangeError);
    });
  });

  describe('pillars — §4.4', () => {
    const base: PipelineInputs = {
      u: 0.97,
      hhi: 0.335,
      phase: 2,
      incident: 0.98,
      cOnchain: [
        { id: 'C01', value: 0.94, weight: 0.5 },
        { id: 'C02', value: 0.91, weight: 0.3 },
      ],
      cAttested: [{ id: 'C03', value: 0.9, weight: 0.2 }],
      cDaily: [
        { id: 'C01', value: 0.93 },
        { id: 'C02', value: 0.89 },
      ],
      p: [
        { id: 'P01', value: 0.8, weight: 0.6 },
        { id: 'P02', value: 0.7, weight: 0.4 },
      ],
      a: [
        { id: 'A01', value: 0.9, weight: 0.4 },
        { id: 'A02', value: 0.6, weight: 0.6 },
      ],
    };

    it('renders S as min(U, D_eff) when F is unregistered (§4.3.2)', () => {
      const withoutF = fullPipeline(base);
      const withF = fullPipeline({ ...base, f: 0.96 });
      // v1 ships two signals, not three. F only ever lowers the min, and here it
      // does not — which is why the corpus rows agree under either reading.
      expect(withoutF.S).toBe(0.83125);
      expect(withF.S).toBe(withoutF.S);
      expect(fullPipeline({ ...base, f: 0.5 }).S).toBe(0.5);
    });

    it('never lets an attested component reach C_daily (§4.2)', () => {
      const louder = fullPipeline({ ...base, cAttested: [{ id: 'C03', value: 0.2, weight: 0.2 }] });
      const quiet = fullPipeline(base);
      expect(louder.C).toBeLessThan(quiet.C);
      // The gate-driving value is untouched: no bonded attestation can flip a
      // gate flag or a gate-market settlement, ever.
      expect(louder.C_daily).toBe(quiet.C_daily);
      expectOnGrid(quiet.C_daily, 0.914793553);
    });

    it('zeroes C and W on an S1 incident', () => {
      const s1 = fullPipeline({ ...base, incident: 0, hhi: 0.1 });
      expect(s1.C).toBe(0);
      expect(s1.W).toBe(0);
      // The daily gate input is unaffected: I is a settlement-time multiplier.
      expectOnGrid(s1.C_daily, 0.914793553);
    });

    it('rejects a drop naming a component the spec set does not have', () => {
      expect(() => fullPipelineRenormalized(base, ['nope'])).toThrow(RangeError);
      expect(() => fullPipelineRenormalized(base, [])).toThrow(RangeError);
    });

    it('takes daily S and C from the daily inputs, not the epoch ones', () => {
      const oneBadDay = fullPipeline({ ...base, uDaily: 0.4 });
      expect(oneBadDay.S).toBe(0.83125);
      expect(oneBadDay.S_daily).toBe(0.4);
      // A day's authorship can be far more concentrated than the epoch's:
      // HHI 0.9 at n_cap 5 is D_eff = 0.125, and the min takes it.
      expect(fullPipeline({ ...base, uDaily: 0.4, hhiDaily: 0.9 }).S_daily).toBe(0.125);
      expect(fullPipeline({ ...base, hhiDaily: 0.9 }).D_eff).toBe(0.83125);
    });
  });

  describe('component drop and renormalization — §4.4 rules 1–3', () => {
    const p: WeightedComponent[] = [{ id: 20, value: 0.8, weight: 1 }];
    const a: WeightedComponent[] = [
      { id: 30, value: 0.9, weight: 0.4 },
      { id: 31, value: 0.6, weight: 0.6 },
    ];

    it('renormalizes an emptied pillar one level up', () => {
      expect(emptiedPillarGroups([30, 31], p, a)).toEqual(['A']);
      // wP + wA = 1, so the survivor's weight becomes exactly 1 and the
      // composite is P alone — measured on what could be measured.
      expect(geoComposite(0.758391065, 1, 0.6, 0.4, ['A'])).toBe(0.758391065);
    });

    it('declines when both pillars would empty', () => {
      expect(emptiedPillarGroups([20, 30, 31], p, a)).toEqual([]);
      expectOnGrid(geoComposite(0.758391065, 0.705647413, 0.6, 0.4), 0.736836322);
    });

    it('is what turns the corpus A pillar into 0.6 exactly', () => {
      // Dropping A01 leaves A02 at renormalized weight 1: exact, not a round trip.
      const dropped: readonly MetricId[] = ['A01', 'C03'];
      const flagged = pipelineRow('settlement_renormalized_drops_flagged_components');
      const result = fullPipelineRenormalized(inputsFor(flagged), dropped);
      expect(result.A).toBe(0.6);
      expectOnGrid(result.C, 0.9100631);
    });
  });

  describe('W and s — §4.1, §4.4(4)', () => {
    it('composes as floor(floor(g(S)·g(C)) · GeoComposite)', () => {
      const w = welfareValue(0.99, 0.904379942, 0.758391065, 0.705647413);
      expectOnGrid(w, 0.41670384);
      expectOnGrid(gate(0.904379942, THETA_C_LO_FLOOR, THETA_C_HI), 0.56553108);
    });

    it('scores a doubly zeroed cohort at one base unit, not zero', () => {
      // ε_W keeps the logarithm finite; the exact geometric mean of two ε_W
      // values is ε_W itself.
      expect(settlementScore(0, 0)).toBe(1e-9);
      expect(geometricMean(0, 0)).toBe(1e-9);
    });

    it('is the exact geometric mean, floored', () => {
      expect(settlementScore(0.8, 0.8)).toBe(0.8);
      expect(settlementScore(0.64, 0.25)).toBe(0.4);
      expect(settlementScore(1, 1)).toBe(1);
    });

    it('a single zeroed measurement epoch nearly annihilates s', () => {
      // One breached epoch out of two is not averaged away: sqrt(1e-9 · W).
      expect(settlementScore(0, 1)).toBeLessThan(4e-5);
    });
  });

  describe('grid discipline — the reference model is the arbiter (15 §4.4)', () => {
    // Every expectation below was produced by running the Python reference
    // model (`bleavit_reference_model.welfare`), which floors `Decimal`s and
    // takes an exact square root. They are deliberately values the eight corpus
    // rows do not contain: on-grid numbers whose double representation sits a
    // fraction *below* their grid integer, e.g. `0.500000005 · 1e9` is
    // `500000004.99999994`. Re-flooring such a value drops it a whole ulp, and
    // no corpus row can see that.
    const MANGLED = [0.500000005, 0.031675220, 0.001032115, 0.500000009, 0.500000013] as const;

    it('never re-floors an on-grid pillar input (rule-3 exactness)', () => {
      // §4.4 rule 3: a degenerate single-term group's value *is* the term's.
      expect(weightedGeometric([{ id: 31, value: 0.500000005, weight: 1 }], EPSILON_P)).toBe(0.500000005);
      expect(weightedGeometric([{ id: 31, value: 0.031675220, weight: 1 }], EPSILON_P)).toBe(0.031675220);
      // …and the ε floor still wins below it, so this is not a blanket passthrough.
      expect(weightedGeometric([{ id: 31, value: 0.001032115, weight: 1 }], EPSILON_P)).toBe(EPSILON_P);
    });

    it('carries an on-grid component value into a genuine product intact', () => {
      // Reference: weighted_geometric({20: 0.500000005, 21: 0.9}, {0.6, 0.4}).
      expectOnGrid(
        weightedGeometric(
          [
            { id: 20, value: 0.500000005, weight: 0.6 },
            { id: 21, value: 0.9, weight: 0.4 },
          ],
          EPSILON_P,
        ),
        0.632526913,
      );
    });

    it('renormalizes an emptied pillar without losing an ulp', () => {
      expect(geoComposite(0.500000005, 1, 0.6, 0.4, ['A'])).toBe(0.500000005);
    });

    it('returns a min over on-grid inputs unchanged — S does no arithmetic', () => {
      for (const u of MANGLED) {
        const result = pillarValues({
          u,
          dEff: 0.9,
          cOnchain: [{ id: 1, value: 1, weight: 1 }],
          p: [{ id: 20, value: 1, weight: 1 }],
          a: [{ id: 30, value: 1, weight: 1 }],
        });
        expect(result.S, `S at u=${u}`).toBe(u);
        expect(result.S_daily, `S_daily at u=${u}`).toBe(u);
      }
    });

    it('takes the settlement root exactly, not to within a double', () => {
      // GeoMean(W, W) = W is spec, not preference: a cohort whose two
      // measurement epochs scored identically settles at that score.
      for (const w of [...MANGLED, 0.416703840, 0.428893718, 1e-9, 1]) {
        expect(settlementScore(w, w), `s(${w}, ${w})`).toBe(w);
      }
      // Unequal pairs, straight from the reference model. The doubles route
      // lands 2, 2, 1 and 12 grid units low on these four respectively — the
      // last is six times the 2e-9 band this file contracts to.
      expectOnGrid(settlementScore(0.490275741, 0.031675220), 0.124617783);
      expectOnGrid(settlementScore(0.903491140, 0.063486696), 0.239498783);
      expectOnGrid(settlementScore(0.553205610, 0.505899072), 0.529023822);
      expectOnGrid(settlementScore(0.001032115, 0.565509108), 0.024159272);
    });
  });

  describe('the v1 metric set — §4.3', () => {
    it('freezes fifteen ids and registers fourteen', () => {
      expect(V1_METRICS.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 10, 11, 12, 20, 21, 22, 30, 31, 32]);
      expect(V1_METRICS.filter((m) => !m.registered).map((m) => m.symbol)).toEqual(['F']);
      expect(V1_METRICS_BY_ID.get(11)?.note).toMatch(/Reserved but inactive/);
      expect(V1_METRICS_BY_ID.get(12)?.symbol).toBe('D_eff');
    });

    it('gives every weighted pillar a weight vector summing to 1', () => {
      for (const pillar of ['COnchain', 'P', 'A'] as const) {
        const sum = V1_METRICS.filter((m) => m.pillar === pillar).reduce((t, m) => t + (m.weight ?? 0), 0);
        expect(sum, pillar).toBeCloseTo(1, 10);
      }
      // S carries none: it is a min, which is exactly why v1 can drop F from it
      // without renormalizing anything.
      expect(V1_METRICS.filter((m) => m.pillar === 'S').every((m) => m.weight === null)).toBe(true);
    });

    it('agrees with pillarValues on the shipped C_onchain weights', () => {
      const cOnchain = V1_METRICS.filter((m) => m.pillar === 'COnchain').map((m) => ({
        id: m.id,
        value: 1,
        weight: m.weight ?? 0,
      }));
      const result = pillarValues({
        u: 1,
        dEff: 1,
        cOnchain,
        p: [{ id: 20, value: 1, weight: 1 }],
        a: [{ id: 30, value: 1, weight: 1 }],
      });
      expect(result.C).toBe(1);
      expect(result.C_daily).toBe(1);
      expect(welfareValue(result.S, result.C, result.P, result.A)).toBe(1);
    });
  });
});
