import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import {
  BLEAVIT_PALLET_COUNT,
  BUY,
  DECIDE_DISPATCHED,
  DENIED_FAMILIES,
  PALLET_COUNT,
  PALLET_GROUPS,
  SESSION_BLOCKS,
  SETTLE_COHORT_DISPATCHED,
  TRADES_BY_TIME,
  TRADES_EXTERNAL,
  TRADES_PER_BLOCK,
  TRADES_PRIMARY,
  TheChainScene,
  buildModel,
} from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { BLOCKS_PER_HOUR, MAX_NESTED_CALLS, MAX_NESTED_LEVELS } from '../../protocol/constants';

/**
 * Scene 01's contract with the runtime it is describing.
 *
 * This scene's whole claim is arithmetic over the runtime's declared weights,
 * so the assertions that matter are the ones that would still pass if the
 * arithmetic silently drifted. Three numbers are pinned in
 * `runtime/bleavit-runtime/src/pov_budgets.rs` as live assertions —
 * `MAX_TRADED_EVENTS_PER_BLOCK` (93), `..._PRIMARY` (70) and `..._EXTERNAL`
 * (23) — and two more are pinned there as exact dispatched proof sizes for
 * `decide` (745,551 B) and `settle_cohort(5)` (727,942 B). This module
 * recomputes all five from weight components, so a regeneration that moves one
 * addend fails here rather than leaving the page confidently wrong.
 *
 * The 93 and 70 figures are also what settled the block-size question the
 * scene's own drawer discusses. Doc 13 §5 measured these proof figures against
 * 3,932,160 B until 2026-08-09, and neither ceiling is reachable from that
 * number — it yields exactly half of each. The divisor was the normal class's
 * **length** limit rather than its proof budget, and the specification now
 * states 7,864,320 B. The recomputation below is what made the disagreement
 * legible in the first place, so it stays as it is.
 */

const scenario = SCENARIOS['normal-execution'];
const stepsAt = (n: number) => runScenario(scenario, n, 'Treasury', 'Fund the bootnode budget line');

const early = stepsAt(1);
const late = stepsAt(6);

/**
 * Stage units per label character, and the gap two labels must keep.
 *
 * Deliberately stricter than the renderer, which estimates 0.56 em at a
 * 0.46-unit label size (0.258 per character) and keeps a 0.25 gap.
 */
const CHAR_W = 0.26;
const MIN_GAP = 0.3;

/**
 * How close two labels' baselines may be before their glyphs touch.
 *
 * A label is drawn under its node's **bottom edge**, so which text row it lands
 * on is decided by `node.y` alone — not by the node's extent. This scene stacks
 * two segments in one column, and an extent-overlap test would call a segment
 * and the ceiling resting on top of it a collision while their labels sit four
 * units apart. The renderer's own figure is 0.46 x 1.05; this is rounded up so
 * passing here clears it.
 */
const LINE_HEIGHT = 0.5;

/** Deterministic thousands grouping, matching the scene's own formatter. */
const groups = (v: number): string => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

describe('the runtime figures this scene is built on', () => {
  it('reproduces the runtime’s pinned per-block trade ceiling, and its two halves', () => {
    // pov_budgets.rs: MAX_TRADED_EVENTS_PER_BLOCK / _PRIMARY / _EXTERNAL.
    expect(TRADES_PER_BLOCK).toBe(93);
    expect(TRADES_PRIMARY).toBe(70);
    expect(TRADES_EXTERNAL).toBe(23);
    // The two reservations are simultaneously reachable, so they sum to the
    // block ceiling rather than being capped by it.
    expect(TRADES_PRIMARY + TRADES_EXTERNAL).toBe(TRADES_PER_BLOCK);
  });

  it('shows proof, not computing time, as the binding budget for a trade', () => {
    // The same assertion pov_budgets.rs makes, and the sentence the scene
    // exists to support. "Better than a factor of two" is the runtime's own
    // characterisation of the margin.
    expect(TRADES_PER_BLOCK).toBeLessThan(TRADES_BY_TIME);
    expect(TRADES_BY_TIME).toBe(204);
    expect(TRADES_BY_TIME / TRADES_PER_BLOCK).toBeGreaterThan(2);
  });

  it('reproduces the dispatched proof sizes the runtime pins for the two epoch cranks', () => {
    expect(DECIDE_DISPATCHED.proof).toBe(745_551);
    expect(SETTLE_COHORT_DISPATCHED.proof).toBe(727_942);
  });

  it('carries the buy weight the runtime actually charges, surcharge included', () => {
    // 108,804 generated + 3,056 external-route proof surcharge (496 + 2,560),
    // and the two extra reads the call attribute adds on top of the fixture.
    expect(BUY.proof).toBe(111_860);
    expect(BUY.reads).toBe(78);
  });

  it('derives the session length from the block time rather than naming it', () => {
    expect(SESSION_BLOCKS).toBe(6 * BLOCKS_PER_HOUR);
    expect(SESSION_BLOCKS).toBe(3_600);
  });
});

describe('the pallet table', () => {
  it('counts every module in construct_runtime!, grouped as that macro groups them', () => {
    expect(PALLET_GROUPS.map((g) => g.rows.length)).toEqual([4, 5, 9, 4, 5, 18]);
    expect(PALLET_COUNT).toBe(45);
    expect(BLEAVIT_PALLET_COUNT).toBe(18);
  });

  it('gives every module a unique index, in ascending order within its group', () => {
    const all = PALLET_GROUPS.flatMap((g) => g.rows.map((r) => r.index));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort((a, b) => a - b)).toEqual(all);
  });

  it('carries the frozen custom slots 61–67 unbroken', () => {
    const bleavit = PALLET_GROUPS.find((g) => g.id === 'bleavit');
    const frozen = (bleavit?.rows ?? []).filter((r) => r.index >= 61 && r.index <= 67);
    expect(frozen.map((r) => r.index)).toEqual([61, 62, 63, 64, 65, 66, 67]);
    expect(frozen.map((r) => r.name)).toEqual([
      'Epoch',
      'ExecutionGuard',
      'InflowCaps',
      'TrackOrigins',
      'ClientRegistry',
      'QuestionService',
      'ServiceLedger',
    ]);
  });

  it('marks exactly the one module that exists only during launch', () => {
    const bootstrap = PALLET_GROUPS.flatMap((g) => g.rows).filter((r) => r.bootstrapOnly === true);
    expect(bootstrap.map((r) => r.name)).toEqual(['Sudo']);
  });
});

describe('buildModel', () => {
  const model = buildModel(late);

  it('draws the block as two walls and one column split into spent and unspent', () => {
    expect(model.nodes.map((n) => n.id)).toEqual([
      'spent',
      'unspent',
      'wall-proof',
      'wall-time',
    ]);
  });

  it('gives every node a unique id and a DOM row', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
    for (const n of model.nodes) expect(n.domRowId, n.id).toBeTruthy();
  });

  it('keeps every node inside the stage', () => {
    for (const n of model.nodes) {
      expect(n.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  it('labels every node inside the twelve-character budget', () => {
    for (const n of model.nodes) {
      expect(n.label, n.id).toBeTruthy();
      expect(n.label?.length, `${n.id}: ${n.label ?? ''}`).toBeLessThanOrEqual(12);
    }
  });

  it('leaves every label room to be read', () => {
    const labelled = model.nodes.filter((n) => n.label !== undefined);
    for (const a of labelled) {
      for (const b of labelled) {
        if (a.id >= b.id) continue;
        // Labels hang from their node's bottom edge, so only nodes whose
        // bottoms are within a line height of each other can collide.
        if (Math.abs(a.y - b.y) >= LINE_HEIGHT) continue;
        const gap = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
        const need = ((a.label?.length ?? 0) + (b.label?.length ?? 0)) * (CHAR_W / 2) + MIN_GAP;
        expect(gap, `${a.id} (${a.label ?? ''}) vs ${b.id} (${b.label ?? ''})`).toBeGreaterThan(
          need,
        );
      }
    }
  });

  it('spends the column’s width on proof and its height on time', () => {
    const spent = model.nodes.find((n) => n.id === 'spent');
    const unspent = model.nodes.find((n) => n.id === 'unspent');
    const wall = model.nodes.find((n) => n.id === 'wall-proof');
    expect(spent).toBeDefined();
    expect(unspent).toBeDefined();
    expect(wall).toBeDefined();

    // Proof is all but spent: the column reaches the wall.
    expect(spent!.x + spent!.w).toBeGreaterThan(wall!.x - 0.2);
    expect(spent!.x + spent!.w).toBeLessThanOrEqual(wall!.x);
    // Time is not: the same 93 trades leave more than half the block’s
    // computing capacity untouched, which is the scene’s entire argument.
    expect(unspent!.h).toBeGreaterThan(spent!.h);
    // The two segments stack without a gap and without overlapping.
    expect(unspent!.y).toBeCloseTo(spent!.y + spent!.h, 9);
    expect(unspent!.w).toBeCloseTo(spent!.w, 9);
  });

  it('draws the two budgets as walls, and nothing else as one', () => {
    expect(model.nodes.filter((n) => n.hatched === true).map((n) => n.id)).toEqual(['wall-proof']);
    expect(model.nodes.filter((n) => n.kind === 'ceiling').map((n) => n.id)).toEqual(['wall-time']);
    // `accept`/`reject` are branch instruments and `alarm` is a safety state.
    // A budget is neither.
    for (const n of model.nodes) expect(['ink', 'dim'], n.id).toContain(n.tone);
  });

  it('prints both budgets on the canvas as the trade counts they allow', () => {
    const byId = (id: string) => model.nodes.find((n) => n.id === id);
    expect(byId('wall-proof')?.sublabel).toBe(`${TRADES_PER_BLOCK} trades`);
    expect(byId('wall-time')?.sublabel).toBe(`${TRADES_BY_TIME} trades`);
    expect(byId('spent')?.label).toBe(`${TRADES_PER_BLOCK} trades`);
  });

  it('carries a key for every mark it draws', () => {
    expect(model.legend?.map((e) => e.mark)).toEqual(['ink', 'dim', 'hatch']);
    expect(model.relation).not.toBe('');
    expect(model.caption).toContain(groups(late.block));
  });

  it('moves only its caption between scenario steps', () => {
    const other = buildModel(early);
    expect(other.caption).not.toBe(model.caption);
    expect(other.nodes).toEqual(model.nodes);
    expect(other.rules).toEqual(model.rules);
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(late)).toEqual(model);
  });
});

describe('TheChainScene', () => {
  it('carries a DOM row for every object on the canvas', () => {
    const { container } = render(<TheChainScene sim={late} />);
    const missing = buildModel(late)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('opens with the plain answer and three numbers, not with a table', () => {
    const { container } = render(<TheChainScene sim={late} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.firstElementChild?.className).toBe('lede');
    expect(rail?.querySelectorAll('.keyfact')).toHaveLength(3);
    const drawers = [...container.querySelectorAll('details.depth')];
    expect(drawers).toHaveLength(5);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
  });

  it('states the headline claims in the rail, not only in the drawing', () => {
    const { container } = render(<TheChainScene sim={late} />);
    const text = container.textContent ?? '';
    // The thesis: evidence, not computing, is what fills a block.
    expect(text).toContain('receipt');
    expect(text).toContain('Polkadot');
    // The three ceilings, each printed where a reader can find it.
    expect(text).toContain(String(TRADES_PER_BLOCK));
    expect(text).toContain(String(TRADES_BY_TIME));
    expect(text).toContain(String(TRADES_PRIMARY));
    // The parts list, and how much of it is Bleavit's own.
    expect(text).toContain(String(PALLET_COUNT));
    expect(text).toContain(String(BLEAVIT_PALLET_COUNT));
  });

  it('renders one row per denied family, with its calls and the failure it prevents', () => {
    const { container } = render(<TheChainScene sim={late} />);
    const rows = [...container.querySelectorAll('tr[id^="row-denied-"]')];
    expect(rows).toHaveLength(DENIED_FAMILIES.length);
    const printed = [...container.querySelectorAll('.chain-calls li')].map((e) => e.textContent);
    expect(printed).toEqual(DENIED_FAMILIES.flatMap((f) => f.calls));
    // The whole point of the list: it is not reachable by the founding key either.
    expect(container.textContent).toContain('sudo.sudo_as');
  });

  it('renders the two nesting bounds that nothing in the app used to import', () => {
    const { container } = render(<TheChainScene sim={late} />);
    const levels = container.querySelector('#row-nesting-levels');
    const calls = container.querySelector('#row-nesting-calls');
    expect(levels?.textContent).toContain(String(MAX_NESTED_LEVELS));
    expect(calls?.textContent).toContain(String(MAX_NESTED_CALLS));
  });

  it('renders one row per module, and one heading per group', () => {
    const { container } = render(<TheChainScene sim={late} />);
    expect(container.querySelectorAll('tr[id^="row-pallet-"]')).toHaveLength(PALLET_COUNT);
    expect(container.querySelectorAll('tbody[id^="row-group-"]')).toHaveLength(
      PALLET_GROUPS.length,
    );
  });

  it('ties the collator panel to the scenario’s own block height', () => {
    const { container } = render(<TheChainScene sim={late} />);
    const note = container.querySelector('.chain-table')?.closest('.panel');
    expect(note).toBeDefined();
    const session = Math.floor(late.block / SESSION_BLOCKS);
    expect(container.textContent).toContain(`session ${session}`);
  });
});
