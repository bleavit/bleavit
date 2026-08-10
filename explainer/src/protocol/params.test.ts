/**
 * Tolerance policy for this file.
 *
 *  - Integer base-unit results (every `raw` scalar, every block count): EXACT
 *    equality, no tolerance. These are the integers `genesis_params()` seeds.
 *  - Values the spec computes on the floored 1e9 grid: absolute tolerance 2e-9.
 *    Used only where a display value is reconstructed from `raw`.
 *  - Pure real-valued transcendental results: not applicable — this module
 *    holds no transcendental math.
 *
 * The registry is data, so almost everything below is exact. The one place a
 * tolerance is needed is the reverse projection `raw / 1e9 -> value`, where the
 * display decimal (0.0375, 0.06) is not representable in binary.
 */

import { describe, it, expect } from 'vitest';

import genesisKeys from './__fixtures__/genesis-keys.json';
import {
  CLASS_DEFAULTS,
  CLASS_SUFFIX,
  PARAMS,
  PARAM_BY_KEY,
  param,
  perClass,
  unverifiedParams,
  value,
} from './params';
import type { ClassDefaults, ParamClass, ParamRow } from './params';
import { FIXED_SCALE, USDC, VIT, formatBps } from './units';
import { GATE_BEARING_CLASSES } from './types';
import type { GateBearingClass } from './types';

/** Doc 05 §4.4 works on the 1e9 grid; one grid step is 1e-9. */
const GRID = 2e-9;

const KNOWN = new Set<string>(genesisKeys);

describe('registry integrity', () => {
  it('invents no parameter: every key is a real genesis key', () => {
    const unknown = PARAMS.map((p) => p.key).filter((k) => !KNOWN.has(k));
    expect(
      unknown,
      `keys not present in genesis-keys.json (doc 13 §1 has no such row): ${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('has no duplicate keys', () => {
    const seen = new Map<string, number>();
    for (const p of PARAMS) seen.set(p.key, (seen.get(p.key) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
    expect(dupes, `duplicate rows: ${dupes.join(', ')}`).toEqual([]);
    expect(PARAM_BY_KEY.size).toBe(PARAMS.length);
  });

  it('models the whole doc 13 §1 registry', () => {
    const missing = genesisKeys.filter((k) => !PARAM_BY_KEY.has(k));
    // The required floor is 55 of the 106 seeded keys; this module carries all
    // of them, so the app can never need a number that has no row here.
    expect(PARAMS.length).toBeGreaterThanOrEqual(55);
    expect(missing, `unmodelled genesis keys: ${missing.join(', ')}`).toEqual([]);
    expect(PARAMS.length).toBe(genesisKeys.length);
  });

  it('fails loudly on an unknown key', () => {
    expect(() => param('dec.delta.emergency')).toThrow(/Unknown parameter key/);
    expect(() => param('')).toThrow();
    // ProposalClass::Emergency is deleted (D-7), so no such row may ever exist.
    expect(KNOWN.has('dec.delta.emergency')).toBe(false);
  });

  it('keeps every value inside its own bounds', () => {
    for (const p of PARAMS) {
      if (p.min !== undefined) expect(p.value, `${p.key} below min`).toBeGreaterThanOrEqual(p.min);
      if (p.max !== undefined) expect(p.value, `${p.key} above max`).toBeLessThanOrEqual(p.max);
      if (p.min !== undefined && p.max !== undefined) {
        expect(p.min, `${p.key} has min > max`).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('cites doc 13 §1 on every row and says what it does', () => {
    for (const p of PARAMS) {
      expect(p.cite.doc, p.key).toBe('13');
      expect(p.cite.at, p.key).toBe('§1');
      expect(p.blurb.length, `${p.key} blurb too thin`).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// The whole corpus: constitution_core::genesis_params(), row for row
// ---------------------------------------------------------------------------

/**
 * All 106 seeded records of doc 13 §1, transcribed from
 * `crates/constitution-core/src/lib.rs :: genesis_params()` and cross-read
 * against doc 13 §1's own table.
 *
 *  - `raw` is the inner scalar the chain stores (doc 13 reading rule 8).
 *  - `min`/`max` are in the row's display unit, as doc 13's table prints them,
 *    and `null` where the record's bound is the maximum representable value of
 *    its type — the "—" of the table and the arming sentinel of the phase-3
 *    caps (doc 13 §1, unbounded-sentinel note).
 *  - `delta` is doc 13's `Max Δ/decision` column verbatim, `null` for its "—".
 *  - `cd` is the cooldown in epochs, `cls` the `ParamRecord.class` of reading
 *    rule 7 (the six-class set, before the lossy `ParamView` projection).
 *
 * This table exists because the fixture corpus (`genesis-keys.json`) carries
 * key *names* only: without it nothing here could catch a wrong number, and
 * spot checks would leave most of the registry uncertified. Kernel-derived
 * bounds are resolved to the values `futarchy_primitives::kernel` gives them
 * (`DECISION_DELTA_FLOOR` = 0.005, `DECISION_SIGMA_FLOOR` = 0,
 * `EXECUTION_TIMELOCK_FLOOR_BLOCKS` = 14,400, `EXECUTION_GRACE_FLOOR_BLOCKS` =
 * 100,800, `GATE_EPS_FLOOR` = 0.005, `GATE_P_MAX_CEILING_1E9` = 0.10,
 * `SEC_FLOW_CAP_FLOOR_1E9` = ×7, `KEEPER_BUDGET_EPOCH_FLOOR_USDC` = 6,000,
 * `KEEPER_REBATE_FEE_BASIS_USDC` = 0.03 USDC, `MIN_SPLIT_USDC` = 0.01,
 * `MAX_ARCHIVE_DELAY_BLOCKS` = 5,256,000, `ORC_REPORTERS_MIN` = 3).
 */
interface GenesisRecord {
  readonly key: string;
  readonly raw: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly delta: string | null;
  readonly cd: number;
  readonly cls: ParamClass;
}

const GENESIS: readonly GenesisRecord[] = [
  { key: 'epoch.length', raw: 302_400, min: 201_600, max: 604_800, delta: '10%', cd: 2, cls: 'Meta' },
  { key: 'epoch.slots', raw: 5, min: 1, max: 12, delta: '2', cd: 1, cls: 'Meta' },
  { key: 'epoch.horizon_k', raw: 2, min: 1, max: 2, delta: '1', cd: 4, cls: 'MetaAndValues' },
  { key: 'mkt.obs_interval', raw: 10, min: 5, max: 50, delta: '5', cd: 1, cls: 'Param' },
  { key: 'mkt.kappa', raw: 5_000_000, min: 0.001, max: 0.02, delta: '0.002', cd: 2, cls: 'Meta' },
  { key: 'mkt.fee', raw: 3_000_000, min: 5, max: 100, delta: '10 bps', cd: 1, cls: 'Param' },
  { key: 'rwd.rate', raw: 2_500_000, min: 0, max: 60, delta: '25 bps', cd: 1, cls: 'Param' },
  { key: 'dec.window', raw: 43_200, min: 14_400, max: 86_400, delta: '20%', cd: 2, cls: 'Meta' },
  { key: 'dec.trailing', raw: 14_400, min: 3_600, max: 28_800, delta: null, cd: 2, cls: 'Meta' },
  { key: 'dec.delta_max', raw: 50_000_000, min: 0.02, max: 0.1, delta: null, cd: 2, cls: 'Meta' },
  { key: 'dec.coverage', raw: 95, min: 90, max: 99, delta: null, cd: 2, cls: 'Meta' },
  { key: 'gate.p_max', raw: 50_000_000, min: 0, max: 0.1, delta: '0.01', cd: 4, cls: 'MetaAndValues' },
  { key: 'gate.eps', raw: 20_000_000, min: 0.005, max: 0.05, delta: null, cd: 2, cls: 'Meta' },
  { key: 'gate.nb_coverage', raw: 98, min: 95, max: 100, delta: null, cd: 2, cls: 'Meta' },
  { key: 'gate.nb_conv', raw: 10_000_000, min: 0.005, max: 0.02, delta: null, cd: 2, cls: 'Meta' },
  { key: 'exec.grace', raw: 201_600, min: 100_800, max: 432_000, delta: null, cd: 2, cls: 'Meta' },
  { key: 'code.spacing', raw: 432_000, min: 201_600, max: null, delta: null, cd: 2, cls: 'Meta' },
  { key: 'dec.delta.param', raw: 37_500_000, min: 0.005, max: 0.1, delta: '0.005', cd: 2, cls: 'Meta' },
  { key: 'dec.delta.trs', raw: 37_500_000, min: 0.005, max: 0.1, delta: '0.005', cd: 2, cls: 'Meta' },
  { key: 'dec.delta.code', raw: 60_000_000, min: 0.005, max: 0.1, delta: '0.005', cd: 2, cls: 'Meta' },
  { key: 'dec.delta.meta', raw: 90_000_000, min: 0.005, max: 0.1, delta: '0.005', cd: 2, cls: 'Meta' },
  { key: 'dec.sigma.param', raw: 3_000_000, min: 0, max: 0.05, delta: null, cd: 2, cls: 'Meta' },
  { key: 'dec.sigma.trs', raw: 5_000_000, min: 0, max: 0.05, delta: null, cd: 2, cls: 'Meta' },
  { key: 'dec.sigma.code', raw: 8_000_000, min: 0, max: 0.05, delta: null, cd: 2, cls: 'Meta' },
  { key: 'dec.sigma.meta', raw: 10_000_000, min: 0, max: 0.05, delta: null, cd: 2, cls: 'Meta' },
  { key: 'dec.v_min.param', raw: 100_000_000_000, min: 10_000, max: 1_000_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'dec.v_min.trs', raw: 250_000_000_000, min: 25_000, max: 2_500_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'dec.v_min.code', raw: 600_000_000_000, min: 60_000, max: 6_000_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'dec.v_min.meta', raw: 1_200_000_000_000, min: 120_000, max: 12_000_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'gate.v_min.param', raw: 10_000_000_000, min: 5_000, max: 50_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'gate.v_min.trs', raw: 25_000_000_000, min: 12_500, max: 125_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'gate.v_min.code', raw: 60_000_000_000, min: 30_000, max: 300_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'gate.v_min.meta', raw: 120_000_000_000, min: 60_000, max: 600_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'prop.bond.param', raw: 1_000_000_000, min: 100, max: 10_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'prop.bond.trs', raw: 5_000_000_000, min: 500, max: 50_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'prop.bond.code', raw: 25_000_000_000, min: 2_500, max: 250_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'prop.bond.meta', raw: 50_000_000_000, min: 5_000, max: 500_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'exec.lock.param', raw: 28_800, min: 14_400, max: 432_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'exec.lock.trs', raw: 43_200, min: 14_400, max: 432_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'exec.lock.code', raw: 100_800, min: 14_400, max: 432_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'exec.lock.meta', raw: 201_600, min: 14_400, max: 432_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'intake.max_acct', raw: 4, min: 2, max: 8, delta: '2', cd: 2, cls: 'Meta' },
  { key: 'intake.slash_pct', raw: 10, min: 5, max: 25, delta: '5 pp', cd: 2, cls: 'Meta' },
  { key: 'pol.b.param', raw: 10_000_000_000, min: 0, max: null, delta: '25%', cd: 1, cls: 'Treasury' },
  { key: 'pol.b.trs', raw: 25_000_000_000, min: 0, max: null, delta: '25%', cd: 1, cls: 'Treasury' },
  { key: 'pol.b.code', raw: 60_000_000_000, min: 0, max: null, delta: '25%', cd: 1, cls: 'Treasury' },
  { key: 'pol.b.meta', raw: 100_000_000_000, min: 0, max: null, delta: '25%', cd: 1, cls: 'Treasury' },
  { key: 'pol.b_gate', raw: 7_500_000_000, min: 0, max: null, delta: '25%', cd: 1, cls: 'Treasury' },
  { key: 'pol.budget_epoch', raw: 7_500_000, min: 0, max: 1.5, delta: null, cd: 2, cls: 'Meta' },
  { key: 'trs.cap_proposal', raw: 5, min: 0, max: 10, delta: '1 pp', cd: 2, cls: 'Meta' },
  { key: 'trs.cap_30d', raw: 10, min: 0, max: 15, delta: null, cd: 2, cls: 'Meta' },
  { key: 'trs.cap_180d', raw: 30, min: 0, max: 40, delta: null, cd: 2, cls: 'Meta' },
  { key: 'trs.stream_thr', raw: 10_000_000, min: 0.5, max: 5, delta: null, cd: 2, cls: 'Meta' },
  { key: 'trs.reward.param', raw: 500_000_000, min: 50, max: 5_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'trs.reward.trs', raw: 25_000_000_000, min: 2_500, max: 250_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'trs.reward.code', raw: 25_000_000_000, min: 2_500, max: 250_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'trs.reward.meta', raw: 25_000_000_000, min: 2_500, max: 250_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'iss.inflation', raw: 2, min: 0, max: 2, delta: null, cd: 0, cls: 'Const' },
  { key: 'welfare.thS_lo', raw: 900_000_000, min: 0.9, max: 1, delta: '0.01', cd: 4, cls: 'Const' },
  { key: 'welfare.thS_hi', raw: 980_000_000, min: 0.9, max: 1, delta: '0.01', cd: 4, cls: 'Const' },
  { key: 'welfare.thC_lo', raw: 850_000_000, min: 0.85, max: 1, delta: '0.01', cd: 4, cls: 'Const' },
  { key: 'welfare.thC_hi', raw: 950_000_000, min: 0.85, max: 1, delta: '0.01', cd: 4, cls: 'Const' },
  { key: 'welfare.wP', raw: 600_000_000, min: 0.3, max: 0.7, delta: '0.05', cd: 4, cls: 'Const' },
  { key: 'welfare.wA', raw: 400_000_000, min: 0.3, max: 0.7, delta: '0.05', cd: 4, cls: 'Const' },
  { key: 'orc.bond_floor', raw: 10_000_000_000, min: 2_500, max: 100_000, delta: null, cd: 2, cls: 'Meta' },
  { key: 'orc.bond_bps', raw: 25_000_000, min: 150, max: 1_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'orc.rounds', raw: 3, min: 2, max: 4, delta: null, cd: 2, cls: 'Meta' },
  { key: 'orc.window', raw: 43_200, min: 43_200, max: 72_000, delta: null, cd: 2, cls: 'Meta' },
  { key: 'orc.rep_stake', raw: 100_000_000_000, min: 25_000, max: 500_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'orc.n_min', raw: 3, min: 3, max: 16, delta: '1', cd: 2, cls: 'Meta' },
  { key: 'wt.quorum', raw: 2, min: 2, max: 5, delta: '1', cd: 2, cls: 'Meta' },
  { key: 'wt.stake', raw: 25_000_000_000, min: 10_000, max: 100_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'reg.bond_inc', raw: 5_000_000_000, min: 2_500, max: 50_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'reg.bond_mile', raw: 2_500_000_000, min: 1_250, max: 25_000, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'res.probe_int', raw: 14_400, min: 1, max: null, delta: null, cd: 1, cls: 'Param' },
  { key: 'res.probe_to', raw: 600, min: 1, max: null, delta: null, cd: 1, cls: 'Param' },
  { key: 'res.probe_amount', raw: 100_000, min: 0.000001, max: null, delta: null, cd: 1, cls: 'Param' },
  { key: 'res.fail_thr', raw: 2, min: 1, max: null, delta: null, cd: 2, cls: 'Meta' },
  { key: 'res.recover_thr', raw: 3, min: 1, max: null, delta: null, cd: 2, cls: 'Meta' },
  { key: 'grd.review_dl', raw: 2, min: 1, max: 4, delta: '1', cd: 2, cls: 'Meta' },
  { key: 'att.bond', raw: 25_000_000_000_000_000, min: 12_500, max: 250_000, delta: '×2', cd: 2, cls: 'Entrenched' },
  { key: 'att.window', raw: 43_200, min: 43_200, max: 72_000, delta: null, cd: 2, cls: 'Meta' },
  { key: 'keeper.budget', raw: 12_000_000_000, min: 6_000, max: 60_000, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'keeper.rebate', raw: 255, min: 0.000085, max: 0.00085, delta: null, cd: 1, cls: 'Param' },
  { key: 'dis.merit_min', raw: 10_000_000_000, min: 10_000, max: null, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'ops.ct_dot_rate', raw: 5_000_000, min: 500_000, max: 500_000_000, delta: '×2', cd: 1, cls: 'Treasury' },
  { key: 'ops.ct_fee_dot', raw: 5_000_000_000, min: 100_000_000, max: 100_000_000_000, delta: '×2', cd: 1, cls: 'Treasury' },
  { key: 'ops.probe_fee', raw: 5_000_000_000, min: 100_000_000, max: 100_000_000_000, delta: '×2', cd: 1, cls: 'Treasury' },
  { key: 'ops.probe_rate', raw: 5_000_000, min: 500_000, max: 500_000_000, delta: '×2', cd: 1, cls: 'Treasury' },
  { key: 'ops.ct_quote_ttl', raw: 100_800, min: 7_200, max: 403_200, delta: '×2', cd: 1, cls: 'Treasury' },
  { key: 'collator.comp', raw: 500_000_000, min: 500, max: 10_000, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'collator.n_min', raw: 4, min: 3, max: 12, delta: '1', cd: 2, cls: 'Meta' },
  { key: 'ledger.min_split', raw: 10_000, min: 0.01, max: 1, delta: null, cd: 2, cls: 'Meta' },
  { key: 'ledger.rdm_fee', raw: 3_000_000, min: 0, max: 100, delta: '10 bps', cd: 1, cls: 'Param' },
  { key: 'ledger.archive', raw: 5_256_000, min: 1_296_000, max: 5_256_000, delta: null, cd: 2, cls: 'Meta' },
  { key: 'ledger.pos_dep', raw: 100_000, min: 0.1, max: 0.1, delta: null, cd: 2, cls: 'Meta' },
  { key: 'pol.b_baseline', raw: 25_000_000_000, min: 10_000, max: 100_000, delta: '25%', cd: 1, cls: 'Treasury' },
  { key: 'collator.n_tgt', raw: 5, min: 4, max: 12, delta: '1', cd: 2, cls: 'Meta' },
  { key: 'sec.prize.param', raw: 50_000_000_000, min: 50_000, max: null, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'sec.prize.code', raw: 300_000_000_000, min: 300_000, max: null, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'sec.prize.meta', raw: 600_000_000_000, min: 600_000, max: null, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'sec.flow_cap', raw: 16_000_000_000, min: 7, max: 32, delta: '×2', cd: 2, cls: 'Meta' },
  { key: 'phase3.tvl_cap', raw: 2_000_000_000_000, min: 0, max: null, delta: null, cd: 0, cls: 'MetaAndValues' },
  { key: 'phase3.dep_cap', raw: 20_000_000_000, min: 0, max: null, delta: null, cd: 0, cls: 'MetaAndValues' },
  { key: 'xcm.dot_per_sec', raw: 100_000_000_000, min: 1_000_000_000, max: 10_000_000_000_000, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'xcm.dot_per_mb', raw: 10_000_000_000, min: 100_000_000, max: 1_000_000_000_000, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'xcm.usdc_per_sec', raw: 50_000_000, min: 500_000, max: 5_000_000_000, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'xcm.usdc_per_mb', raw: 5_000_000, min: 50_000, max: 500_000_000, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'svc.fee_bps', raw: 100_000_000, min: 0, max: 1_000, delta: '×2', cd: 2, cls: 'Param' },
  { key: 'svc.max_live', raw: 16, min: 1, max: 64, delta: '×2', cd: 2, cls: 'Param' },
  { key: 'svc.max_window', raw: 302_400, min: 43_200, max: 302_400, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'svc.epsilon_min', raw: 10_000_000, min: 0.005, max: 0.25, delta: '×2', cd: 1, cls: 'Param' },
  { key: 'svc.client_bond', raw: 100_000_000_000_000_000, min: 1_000, max: 1_000_000, delta: '×2', cd: 2, cls: 'Param' },
  { key: 'svc.price_cap', raw: 4_000_000_000, min: 1, max: 64, delta: '×2', cd: 2, cls: 'Param' },
];

describe('genesis records (constitution_core::genesis_params)', () => {
  it('transcribes the same key set the fixture corpus carries', () => {
    expect(GENESIS.length).toBe(genesisKeys.length);
    expect(GENESIS.map((g) => g.key).sort()).toEqual([...genesisKeys].sort());
  });

  it('reproduces all 106 records exactly — value, both hard bounds', () => {
    for (const g of GENESIS) {
      const p = param(g.key);
      // Integers the chain seeds: exact, no tolerance.
      expect(p.raw, `${g.key} raw`).toBe(g.raw);
      // `?? null` and not `||`: `min: 0` is a real bound (dec.sigma, gate.p_max).
      expect(p.min ?? null, `${g.key} min`).toBe(g.min);
      expect(p.max ?? null, `${g.key} max`).toBe(g.max);
    }
  });

  it('reproduces the governance metadata of all 106 records', () => {
    for (const g of GENESIS) {
      const p = param(g.key);
      expect(p.maxDelta ?? null, `${g.key} max Δ`).toBe(g.delta);
      expect(p.cooldownEpochs, `${g.key} cooldown`).toBe(g.cd);
      expect(p.paramClass, `${g.key} class`).toBe(g.cls);
    }
  });
});

// ---------------------------------------------------------------------------
// raw <-> value, per doc 13 reading rule 8
// ---------------------------------------------------------------------------

/** The VIT-denominated bonds, whose raw scalars sit past 2^53. See below. */
const BIG_RAW = ['att.bond', 'svc.client_bond'];

describe('display projection (13 reading rule 8)', () => {
  it('projects every raw scalar onto its display unit', () => {
    for (const p of PARAMS) {
      switch (p.kind) {
        case 'fixed':
          // Fixed = FixedU64 on the 1e9 grid.
          expect(p.raw, p.key).toBe(Math.round(p.value * FIXED_SCALE));
          expect(p.raw / FIXED_SCALE, p.key).toBeCloseTo(p.value, 9);
          break;
        case 'percent':
        case 'u8':
        case 'u32':
          expect(p.raw, p.key).toBe(p.value);
          break;
        case 'perbill':
          // Three display units for one encoding (doc 13 reading rule 8): bps
          // floors raw/100,000; a NAV share is raw/1e7 percent; and a row whose
          // doc 13 Unit column is "—" prints the bare fraction, which is
          // Perbill's own scale, so it projects by 1e9 like a `fixed` row.
          if (p.unit === 'bps') expect(formatBps(p.raw), p.key).toBe(p.value);
          else if (p.unit === '—') expect(p.raw, p.key).toBe(Math.round(p.value * FIXED_SCALE));
          else expect(p.raw, p.key).toBe(Math.round(p.value * 10_000_000));
          break;
        case 'balance':
          if (p.unit.startsWith('USDC')) expect(p.raw, p.key).toBe(Math.round(p.value * USDC));
          else if (p.unit.startsWith('VIT')) expect(p.raw, p.key).toBe(Math.round(p.value * VIT));
          // µUSDC-, planck- and rate-denominated rows display their raw scalar.
          else expect(p.raw, p.key).toBe(p.value);
          break;
      }
      expect(Number.isInteger(p.raw), `${p.key} raw is not an integer`).toBe(true);
      // The raw scalars past 2^53 are exactly the VIT bonds, and the reason is
      // structural rather than incidental: VIT carries 12 decimals, so any bond
      // above about 9,007 VIT stores past the safe-integer boundary. `att.bond`
      // (25,000 VIT) reaches 2.5e16 and `svc.client_bond` (100,000 VIT) reaches
      // 1e17. Both are still exact doubles, which is why the projection above
      // holds — but no consumer may do integer arithmetic on either in `number`.
      if (!BIG_RAW.includes(p.key)) {
        expect(Number.isSafeInteger(p.raw), `${p.key} raw exceeds 2^53`).toBe(true);
      }
    }
  });

  it('round-trips every raw scalar that exceeds 2^53', () => {
    for (const key of BIG_RAW) {
      const bond = param(key);
      expect(Number.isSafeInteger(bond.raw), key).toBe(false);
      expect(bond.raw / VIT, key).toBe(bond.value);
    }
  });

  it('recovers the 1e9-grid decimals inside one grid step', () => {
    for (const p of PARAMS.filter((r) => r.kind === 'fixed')) {
      expect(Math.abs(p.raw / FIXED_SCALE - p.value), p.key).toBeLessThanOrEqual(GRID);
    }
  });
});

// ---------------------------------------------------------------------------
// Genesis spot checks — exact integers from constitution_core::genesis_params()
// ---------------------------------------------------------------------------

describe('genesis values', () => {
  const raw = (k: string): number => param(k).raw;

  it('reproduces the decision hurdle and its scaling', () => {
    expect(raw('dec.delta.param')).toBe(37_500_000);
    expect(raw('dec.delta.trs')).toBe(37_500_000);
    expect(raw('dec.delta.code')).toBe(60_000_000);
    expect(raw('dec.delta.meta')).toBe(90_000_000);
    expect(value('dec.delta.trs')).toBe(0.0375);
    // The kernel floor is the same for every class; only the default differs.
    for (const c of GATE_BEARING_CLASSES) expect(perClass('dec.delta', c).min).toBe(0.005);
  });

  it('projects the market fee from Perbill to bps by flooring raw/100,000', () => {
    expect(raw('mkt.fee')).toBe(3_000_000);
    expect(value('mkt.fee')).toBe(30);
    expect(formatBps(3_000_000)).toBe(30);
    expect(param('mkt.fee').kind).toBe('perbill');
  });

  it('reproduces the clock', () => {
    const epoch = param('epoch.length');
    expect(epoch.raw).toBe(302_400);
    expect(epoch.min).toBe(201_600);
    expect(epoch.max).toBe(604_800);
    // 21 phase units, exactly: the whole schedule is fractions of this number.
    expect(epoch.value % 21).toBe(0);
    expect(raw('dec.window')).toBe(43_200);
    expect(raw('dec.trailing')).toBe(14_400);
  });

  it('reproduces the balance rows on their native grids', () => {
    expect(raw('dec.v_min.meta')).toBe(1_200_000_000_000);
    expect(value('dec.v_min.meta')).toBe(1_200_000);
    expect(raw('pol.b_baseline')).toBe(25_000_000_000);
    expect(raw('keeper.budget')).toBe(12_000_000_000);
    // VIT carries 12 decimals, not 6 — the one row on the other grid.
    expect(raw('att.bond')).toBe(25_000_000_000_000_000);
    expect(value('att.bond')).toBe(25_000);
    expect(param('att.bond').unit).toBe('VIT');
  });

  it('reproduces the frozen and entrenched rows', () => {
    // ledger.pos_dep: max == min == default (SQ-36) — a single admissible point.
    const dep = param('ledger.pos_dep');
    expect(dep.raw).toBe(100_000);
    expect(dep.min).toBe(dep.value);
    expect(dep.max).toBe(dep.value);
    // Welfare knees are entrenched at their launch values: tighten-only.
    expect(raw('welfare.thS_lo')).toBe(900_000_000);
    expect(param('welfare.thS_lo').min).toBe(0.9);
    expect(raw('welfare.thC_lo')).toBe(850_000_000);
    expect(param('welfare.thC_lo').min).toBe(0.85);
    // Issuance is amendable down only, so max == default.
    expect(param('iss.inflation').max).toBe(2);
    // wP + wA == 1 binds at the engine; the registry seeds the pair.
    expect(value('welfare.wP') + value('welfare.wA')).toBeCloseTo(1, 9);
  });

  it('reproduces the derived rows', () => {
    // keeper.rebate is 3x the measured crank-fee basis of 85 uUSDC.
    expect(raw('keeper.rebate')).toBe(255);
    expect(param('keeper.rebate').min).toBe(0.000085);
    expect(param('keeper.rebate').max).toBe(0.00085);
    // pol.budget_epoch is a Perbill displayed as a NAV percentage.
    expect(raw('pol.budget_epoch')).toBe(7_500_000);
    expect(value('pol.budget_epoch')).toBe(0.75);
    expect(param('pol.budget_epoch').max).toBe(1.5);
    // gate.v_min is seeded at a tenth of dec.v_min for every class.
    for (const c of GATE_BEARING_CLASSES) {
      expect(perClass('gate.v_min', c).value * 10, c).toBe(perClass('dec.v_min', c).value);
    }
  });

  it('reproduces the security-sizing rows', () => {
    expect(raw('sec.prize.param')).toBe(50_000_000_000);
    expect(raw('sec.prize.code')).toBe(300_000_000_000);
    expect(raw('sec.prize.meta')).toBe(600_000_000_000);
    // The genesis value IS the kernel floor: no amendment may go below it.
    for (const k of ['sec.prize.param', 'sec.prize.code', 'sec.prize.meta']) {
      expect(param(k).min, k).toBe(param(k).value);
      expect(param(k).max, `${k} is deliberately open above its floor`).toBeUndefined();
    }
    const flow = param('sec.flow_cap');
    expect(flow.raw).toBe(16_000_000_000);
    expect(flow.min).toBe(7);
    expect(flow.max).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// Per-class resolution
// ---------------------------------------------------------------------------

describe('per-class rows (13 reading rule 6)', () => {
  const SUFFIXES = new Set(Object.values(CLASS_SUFFIX));

  const familiesOf = (): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>();
    for (const p of PARAMS) {
      const cut = p.key.lastIndexOf('.');
      const suffix = p.key.slice(cut + 1);
      if (cut < 0 || !SUFFIXES.has(suffix)) continue;
      const base = p.key.slice(0, cut);
      const set = out.get(base) ?? new Set<string>();
      set.add(suffix);
      out.set(base, set);
    }
    return out;
  };

  it('materializes the four-class families in full', () => {
    const families = familiesOf();
    // sec.prize is the deliberate exception: TREASURY's InCapPrize is the
    // proposal's own ask (doc 08 §5.2), so there is no `sec.prize.trs` row.
    const fourClass = [...families.keys()].filter((b) => b !== 'sec.prize');
    expect(fourClass.sort()).toEqual([
      'dec.delta',
      'dec.sigma',
      'dec.v_min',
      'exec.lock',
      'gate.v_min',
      'pol.b',
      'prop.bond',
      'trs.reward',
    ]);
    for (const base of fourClass) {
      for (const c of GATE_BEARING_CLASSES) {
        const rowForClass: ParamRow = perClass(base, c);
        expect(rowForClass.key).toBe(`${base}.${CLASS_SUFFIX[c]}`);
      }
    }
  });

  it('has no TREASURY prize proxy', () => {
    expect([...(familiesOf().get('sec.prize') ?? [])].sort()).toEqual(['code', 'meta', 'param']);
    expect(() => perClass('sec.prize', 'Treasury')).toThrow(/Unknown parameter key/);
  });

  /**
   * The eight class-dependent numbers, written out per class.
   *
   * Deliberately *not* `perClass(base, c).value`: `classDefaults` is literally
   * that expression, so asserting it against itself would pass no matter what
   * the registry held. These are the `genesis_params()` defaults in their
   * display units — USDC for the balances, s-units for δ/σ, blocks for the
   * timelock.
   */
  const EXPECTED: Readonly<Record<GateBearingClass, ClassDefaults>> = {
    Param: {
      delta: 0.0375,
      sigma: 0.003,
      vMin: 100_000,
      gateVMin: 10_000,
      bond: 1_000,
      polB: 10_000,
      timelock: 28_800,
      secPrize: 50_000,
    },
    Treasury: {
      delta: 0.0375,
      sigma: 0.005,
      vMin: 250_000,
      gateVMin: 25_000,
      bond: 5_000,
      polB: 25_000,
      timelock: 43_200,
      // Doc 08 §5.2 values TREASURY's InCapPrize at the proposal's own ask.
      secPrize: null,
    },
    Code: {
      delta: 0.06,
      sigma: 0.008,
      vMin: 600_000,
      gateVMin: 60_000,
      bond: 25_000,
      polB: 60_000,
      timelock: 100_800,
      secPrize: 300_000,
    },
    Meta: {
      delta: 0.09,
      sigma: 0.01,
      vMin: 1_200_000,
      gateVMin: 120_000,
      bond: 50_000,
      polB: 100_000,
      timelock: 201_600,
      secPrize: 600_000,
    },
  };

  it('gathers the class defaults the spec assigns each class', () => {
    for (const c of GATE_BEARING_CLASSES) {
      expect(CLASS_DEFAULTS[c], c).toEqual(EXPECTED[c]);
      // sigma <= delta/2 is a doc 13 cross-key coupling the records cannot hold.
      expect(CLASS_DEFAULTS[c].sigma, c).toBeLessThanOrEqual(CLASS_DEFAULTS[c].delta / 2);
    }
    // The timelock ladder is strictly increasing in class severity (doc 13 §1).
    const locks = GATE_BEARING_CLASSES.map((c) => CLASS_DEFAULTS[c].timelock);
    expect(locks).toEqual([28_800, 43_200, 100_800, 201_600]);
  });
});

// ---------------------------------------------------------------------------
// Verification status
// ---------------------------------------------------------------------------

describe('verification status (13 reading rule 4)', () => {
  const SIM_GATED = [
    'pol.b_baseline',
    'sec.prize.param',
    'sec.prize.code',
    'sec.prize.meta',
    'sec.flow_cap',
    'phase3.tvl_cap',
    'phase3.dep_cap',
    'xcm.dot_per_sec',
    'xcm.dot_per_mb',
    'xcm.usdc_per_sec',
    'xcm.usdc_per_mb',
  ];
  const VERIFY = [
    'keeper.rebate',
    'collator.n_tgt',
    'ops.ct_dot_rate',
    'ops.ct_fee_dot',
    'ops.probe_fee',
    'ops.probe_rate',
    'svc.max_live',
  ];

  it('marks the uncalibrated rows and gives each a real note', () => {
    for (const k of SIM_GATED) expect(param(k).verification.status, k).toBe('sim-gated');
    for (const k of VERIFY) expect(param(k).verification.status, k).toBe('verify');
    for (const p of unverifiedParams()) {
      const v = p.verification;
      expect(v.status, p.key).not.toBe('settled');
      if (v.status !== 'settled') expect(v.note.length, `${p.key} note is empty`).toBeGreaterThan(20);
    }
  });

  it('reports exactly the unsettled rows', () => {
    expect(unverifiedParams().map((p) => p.key).sort()).toEqual([...SIM_GATED, ...VERIFY].sort());
  });

  it('leaves the calibrated decision parameters settled', () => {
    for (const c of GATE_BEARING_CLASSES) {
      expect(perClass('dec.delta', c).verification.status, c).toBe('settled');
      expect(perClass('dec.v_min', c).verification.status, c).toBe('settled');
    }
    expect(param('mkt.fee').verification.status).toBe('settled');
    expect(param('epoch.length').verification.status).toBe('settled');
  });
});

// ---------------------------------------------------------------------------
// Governance metadata
// ---------------------------------------------------------------------------

describe('governance metadata', () => {
  /**
   * Doc 13 reading rule 7 enumerates the kernel-bounded set "normatively and
   * exhaustively". `sec.flow_cap` is seeded kernel-bounded by
   * `genesis_params()` (its ×7 min is a kernel floor) but is missing from that
   * enumeration, which was written before SQ-486 added the row — the list is
   * stale, not the code, so it is added here.
   */
  const KERNEL_BOUNDED = [
    'att.window',
    'code.spacing',
    'dec.delta.code',
    'dec.delta.meta',
    'dec.delta.param',
    'dec.delta.trs',
    'dec.sigma.code',
    'dec.sigma.meta',
    'dec.sigma.param',
    'dec.sigma.trs',
    'dec.window',
    'epoch.horizon_k',
    'epoch.length',
    'exec.grace',
    'exec.lock.code',
    'exec.lock.meta',
    'exec.lock.param',
    'exec.lock.trs',
    'gate.eps',
    'gate.p_max',
    'intake.slash_pct',
    'iss.inflation',
    'keeper.budget',
    'ledger.archive',
    'ledger.min_split',
    'ledger.pos_dep',
    'mkt.kappa',
    'orc.bond_bps',
    'orc.n_min',
    'orc.window',
    'pol.budget_epoch',
    'res.fail_thr',
    'res.probe_amount',
    'res.probe_int',
    'res.probe_to',
    'res.recover_thr',
    'sec.flow_cap',
    'sec.prize.code',
    'sec.prize.meta',
    'sec.prize.param',
    'svc.max_live',
    'trs.cap_180d',
    'trs.cap_30d',
    'trs.cap_proposal',
    'welfare.thC_lo',
    'welfare.thS_lo',
    'wt.quorum',
  ];

  it('marks exactly the kernel-bounded set', () => {
    const marked = PARAMS.filter((p) => p.kernelBounded).map((p) => p.key).sort();
    expect(marked).toEqual([...KERNEL_BOUNDED].sort());
  });

  it('keeps every cooldown inside the meta-bound of 8 epochs', () => {
    for (const p of PARAMS) {
      expect(p.cooldownEpochs, p.key).toBeDefined();
      expect(p.cooldownEpochs ?? 0, p.key).toBeGreaterThanOrEqual(0);
      expect(p.cooldownEpochs ?? 0, p.key).toBeLessThanOrEqual(8);
    }
  });

  it('uses only the six record classes', () => {
    const classes = new Set(PARAMS.map((p) => p.paramClass));
    expect([...classes].sort()).toEqual([
      'Const',
      'Entrenched',
      'Meta',
      'MetaAndValues',
      'Param',
      'Treasury',
    ]);
  });
});
