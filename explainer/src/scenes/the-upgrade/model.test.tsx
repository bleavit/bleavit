import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { TheUpgradeScene, buildModel } from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { layoutLabels } from '../labels';
import type { SimState } from '../../sim/types';
import { DESCRIPTOR_LEAD_TIME_BLOCKS, MIGRATION_STALL_BLOCKS } from '../../protocol/constants';
import { formatBlocks, formatDurationHuman } from '../../protocol/epoch';

/**
 * The upgrade's contract with the specification and with the DOM.
 *
 * Three things here would rot silently and each is asserted directly rather than
 * described:
 *
 *  1. **The ordering.** Authorize, then a gap, then apply — with the gap
 *     exactly filling the space between the two steps and nothing drawn inside
 *     it. If a future edit lets the two steps touch, the picture is making the
 *     precise claim doc 09 §2.2 exists to deny.
 *  2. **The simultaneity.** The new program lands and ordinary transactions stop
 *     at the same x, in two different lanes. That is the only thing this canvas
 *     shows that a table cannot, so it is asserted as a coordinate identity.
 *  3. **The counts.** Eight phases and four build profiles are read out of the
 *     tables the rail prints, so a phase added to one and not the other fails
 *     here rather than shipping as two different answers on one screen.
 *
 * Legibility is asserted too. The renderer centres a label under its node, so
 * two labelled nodes sharing a row collide unless their centres are far enough
 * apart for both boxes plus a gap.
 */

const scenario = SCENARIOS['blocked-execution'];
const base = runScenario(scenario, 2, 'Code', 'Runtime upgrade to spec_version 42');

/**
 * The jammed state.
 *
 * No shipped scenario sets `migrationHalt`, and that is correct — a jammed
 * conversion is not something a demonstration of a proposal's life walks
 * through. It is still a state the runtime has, and the scene draws it, so it is
 * constructed here rather than left undrawn and untested.
 */
const halted: SimState = { ...base, flags: { ...base.flags, migrationHalt: true } };

/** Stage units per label character, and the gap two labels must keep. */
const CHAR_W = 0.26;
const MIN_GAP = 0.3;

const LABEL_BUDGET = 12;

/**
 * The renderer's three label scales, mirrored from `Scene2D`.
 *
 * The check below runs the real placement pass at each of them, because the
 * pairwise-distance assertion is a proxy and this is the actual thing: a label
 * the pass cannot fit is **dropped**, silently, and a dropped label is a fact
 * that left the drawing without leaving a trace. Narrow viewports use *larger*
 * stage-unit type, so the tightest case is the smallest screen rather than the
 * one that is convenient to check.
 */
const SCALES = [
  { label: 0.7, sub: 0.56, band: 0.88, showSub: false },
  { label: 0.56, sub: 0.44, band: 0.7, showSub: false },
  { label: 0.46, sub: 0.36, band: 0.58, showSub: true },
] as const;

const MAX_BANDS = 3;
const flip = (y: number, h = 0): number => STAGE_HEIGHT - y - h;

describe('buildModel', () => {
  const model = buildModel(base);
  const byId = (id: string) => model.nodes.find((n) => n.id === id);
  const solids = model.nodes.filter((n) => n.kind !== 'edge');

  it('draws four lanes of solids and one argument arrow', () => {
    expect(solids).toHaveLength(9);
    expect(model.nodes.filter((n) => n.kind === 'edge')).toHaveLength(1);
  });

  it('gives every node a unique id, and every solid a DOM row', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
    for (const n of solids) expect(n.domRowId, n.id).toBeTruthy();
  });

  it('keeps every node inside the stage', () => {
    for (const n of solids) {
      expect(n.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  it('labels every solid in plain words, inside the twelve-character budget', () => {
    for (const n of solids) {
      expect(n.label, n.id).toBeTruthy();
      expect(n.label!.length, `${n.id}: ${n.label}`).toBeLessThanOrEqual(LABEL_BUDGET);
    }
  });

  it('leaves every label room to be read', () => {
    for (const sim of [base, halted]) {
      const labelled = buildModel(sim).nodes.filter((n) => n.label !== undefined);
      expect(labelled).toHaveLength(9);
      for (const a of labelled) {
        for (const b of labelled) {
          if (a.id >= b.id) continue;
          // Only nodes whose vertical extents overlap can collide horizontally.
          if (a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
          const gap = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
          const need = (a.label!.length + b.label!.length) * (CHAR_W / 2) + MIN_GAP;
          expect(gap, `${a.id} (${a.label}) vs ${b.id} (${b.label})`).toBeGreaterThan(need);
        }
      }
    }
  });

  it('drops no label at any of the three renderer scales', () => {
    for (const sim of [base, halted]) {
      const drawn = buildModel(sim).nodes;
      for (const scale of SCALES) {
        const nodes = scale.showSub
          ? drawn
          : drawn.map((n) => ({ ...n, sublabel: undefined }));
        const layout = layoutLabels(nodes, {
          flip,
          fontSize: scale.label,
          subFontSize: scale.sub,
          maxBands: MAX_BANDS,
          firstBand: scale.label,
          bandStep: scale.band,
        });
        expect(layout.dropped, `label size ${scale.label}`).toBe(0);
        expect(layout.placed.filter((p) => p.primary)).toHaveLength(9);
      }
    }
  });

  it('separates the two steps by a gap that nothing else occupies', () => {
    const authorize = byId('authorize');
    const wait = byId('wait');
    const apply = byId('apply');
    expect(authorize).toBeDefined();
    expect(wait).toBeDefined();
    expect(apply).toBeDefined();

    // The order on the page is the order in time, and the gap is real.
    expect(authorize!.x + authorize!.w).toBeLessThan(apply!.x);
    // The wait fills the gap exactly: it starts where step 1 ends and ends where
    // step 2 begins, so no edit can shrink the gap without shrinking the wait.
    expect(wait!.x).toBeCloseTo(authorize!.x + authorize!.w, 6);
    expect(wait!.x + wait!.w).toBeCloseTo(apply!.x, 6);
    // Nothing else is drawn in that span at that height.
    const intruders = model.nodes.filter(
      (n) =>
        n.id !== 'wait' &&
        n.kind !== 'edge' &&
        n.x < apply!.x &&
        n.x + n.w > authorize!.x + authorize!.w &&
        n.y < wait!.y + wait!.h &&
        n.y + n.h > wait!.y,
    );
    expect(intruders.map((n) => n.id)).toEqual([]);
  });

  it('prints the wait as the lead-time constant, never as a typed-in number', () => {
    const wait = byId('wait');
    expect(wait?.label).toBe(`${formatDurationHuman(DESCRIPTOR_LEAD_TIME_BLOCKS)} wait`);
    expect(wait?.sublabel).toBe(formatBlocks(DESCRIPTOR_LEAD_TIME_BLOCKS));
    // The axis names the same span, so the two cannot drift apart.
    const timeline = model.rules.find((r) => r.id === 'timeline');
    expect(timeline?.ticks?.map((t) => t.label)).toContain(
      `+ ${formatBlocks(DESCRIPTOR_LEAD_TIME_BLOCKS)}`,
    );
  });

  it('puts the two gate rules through the centres of the two steps', () => {
    for (const [ruleId, nodeId] of [
      ['gate-authorize', 'authorize'],
      ['gate-apply', 'apply'],
    ] as const) {
      const rule = model.rules.find((r) => r.id === ruleId);
      const node = byId(nodeId);
      expect(rule, ruleId).toBeDefined();
      expect(rule!.axis).toBe('y');
      expect(rule!.at).toBeCloseTo(node!.x + node!.w / 2, 6);
    }
    expect(model.rules.find((r) => r.id === 'gate-authorize')!.at).toBeLessThan(
      model.rules.find((r) => r.id === 'gate-apply')!.at,
    );
  });

  it('lands the new program and the transaction freeze at the same instant', () => {
    // The one relation a table cannot carry: two different lanes, one x.
    const apply = model.rules.find((r) => r.id === 'gate-apply');
    expect(byId('code-new')?.x).toBeCloseTo(apply!.at, 6);
    expect(byId('migration')?.x).toBeCloseTo(apply!.at, 6);
    // And the lanes are genuinely different rows, or the claim is trivial.
    expect(byId('code-new')!.y).not.toBeCloseTo(byId('migration')!.y, 6);
    // Each lane is continuous: no gap between the old stretch and the new one.
    expect(byId('code-old')!.x + byId('code-old')!.w).toBeCloseTo(byId('code-new')!.x, 6);
    expect(byId('chain-open')!.x + byId('chain-open')!.w).toBeCloseTo(byId('migration')!.x, 6);
    expect(byId('migration')!.x + byId('migration')!.w).toBeCloseTo(byId('reopen')!.x, 6);
  });

  it('sends the repair arrow forward in time, from before step 1 to the failure', () => {
    const edge = model.nodes.find((n) => n.kind === 'edge');
    expect(edge?.from).toBe('spare');
    expect(edge?.to).toBe('migration');
    const spare = byId('spare');
    const authorize = model.rules.find((r) => r.id === 'gate-authorize');
    // Committed before step 1 and frozen by it: the spare starts to its left.
    expect(spare!.x).toBeLessThan(authorize!.at);
    expect(spare!.x + spare!.w).toBeGreaterThan(authorize!.at);
    // And it points at something strictly later.
    expect(byId('migration')!.x).toBeGreaterThan(spare!.x + spare!.w);
  });

  it('reserves the alarm tone to a genuinely jammed conversion', () => {
    expect(model.nodes.filter((n) => n.tone === 'alarm')).toHaveLength(0);
    const jammed = buildModel(halted);
    expect(jammed.nodes.filter((n) => n.tone === 'alarm').map((n) => n.id).sort()).toEqual([
      'e-spare',
      'migration',
    ]);
    // The spare wakes up, and the far side of the conversion is never reached.
    expect(jammed.nodes.find((n) => n.id === 'spare')?.state).toBe('active');
    expect(jammed.nodes.find((n) => n.id === 'reopen')?.state).toBe('pending');
  });

  it('never uses a branch tone, which belongs to the markets and not to a clock', () => {
    for (const sim of [base, halted]) {
      const tones = new Set(buildModel(sim).nodes.map((n) => n.tone));
      expect(tones.has('accept')).toBe(false);
      expect(tones.has('reject')).toBe(false);
    }
  });

  it('explains every mark it draws, and no mark it does not', () => {
    const marks = new Set(model.legend?.map((e) => e.mark));
    expect(marks.has('alarm')).toBe(false);
    expect(new Set(buildModel(halted).legend?.map((e) => e.mark)).has('alarm')).toBe(true);
    for (const tone of new Set(model.nodes.map((n) => n.tone))) {
      expect(marks.has(tone), `legend is missing ${tone}`).toBe(true);
    }
  });

  it('names the relation and admits the axis is not to scale', () => {
    expect(model.relation).not.toBe('');
    expect(model.caption).toBeDefined();
    expect(model.unitLegend).toContain('not to scale');
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(base)).toEqual(model);
  });
});

describe('TheUpgradeScene', () => {
  it('carries a DOM row for every object on the canvas', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const missing = buildModel(base)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('opens with the plain answer and three numbers, not with a table', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.firstElementChild?.className).toBe('lede');
    expect(rail?.querySelectorAll('.keyfact')).toHaveLength(3);
    // Everything dense is behind a drawer, and every drawer starts closed.
    const drawers = [...container.querySelectorAll('details.depth')];
    expect(drawers).toHaveLength(5);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
    expect(container.querySelectorAll('.depth table').length).toBeGreaterThan(0);
    // The picture's own key stays in the open: a diagram whose parts are named
    // only inside a closed section is a diagram nobody decodes.
    expect(container.querySelector('#up-row-old')?.closest('details')).toBeNull();
  });

  it('states the ordering correction in the open, not in a drawer', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const ordering = container.querySelector('#up-row-ordering');
    expect(ordering).not.toBeNull();
    expect(ordering?.closest('details')).toBeNull();
    const text = ordering?.textContent ?? '';
    expect(text).toContain('what starts the clock');
    expect(text).toContain('execute, then wait');
  });

  it('names the failure the gap prevents, and says nothing shortens it', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const why = container.querySelector('#up-row-gap-reason');
    expect(why).not.toBeNull();
    expect(why?.closest('details')).toBeNull();
    expect(why?.textContent).toContain('unable to sign');
    // The emergency lane compresses every other window and not this one; that is
    // the fact that turns the rule from arbitrary into memorable.
    expect(container.textContent).toContain('leaves this one at full length');
  });

  it('prints the lead time as blocks as well as days', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const text = container.textContent ?? '';
    expect(text).toContain(formatBlocks(DESCRIPTOR_LEAD_TIME_BLOCKS));
    expect(text).toContain(formatDurationHuman(DESCRIPTOR_LEAD_TIME_BLOCKS));
    expect(text).toContain(formatBlocks(MIGRATION_STALL_BLOCKS));
  });

  it('accounts for all eight rollout phases, numbered without a gap', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const rows = [...container.querySelectorAll('tr[id^="up-phase-"]')];
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `up-phase-${i}`),
    );
    // The count the rail claims is the count the table prints.
    expect(container.textContent).toContain(`Phase 0 to Phase ${rows.length - 1}`);
  });

  it('says plainly that phase 3 runs real markets whose verdicts do nothing', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const shadow = container.querySelector('#up-phase-3');
    expect(shadow?.textContent).toContain('yes');
    expect(shadow?.textContent).toContain('recorded');
    expect(shadow?.textContent).toContain('disconnected');
  });

  it('shows the founding key present in exactly the bootstrap builds', () => {
    const { container } = render(<TheUpgradeScene sim={base} />);
    const rows = [...container.querySelectorAll('tr[id^="up-profile-"]')];
    expect(rows).toHaveLength(4);
    const withKey = rows.filter((r) => r.textContent?.includes('present'));
    expect(withKey.map((r) => r.id)).toEqual([
      'up-profile-bootstrap',
      'up-profile-bootstrap-recovery',
    ]);
    for (const r of rows) {
      if (!withKey.includes(r)) expect(r.textContent).toContain('not compiled');
    }
  });

  it('reports the jam in the rail as well as on the canvas', () => {
    const { container } = render(<TheUpgradeScene sim={halted} />);
    const safety = [...container.querySelectorAll('.chip--safety')];
    expect(safety.length).toBe(1);
    expect(safety[0]?.textContent).toContain('jammed');
    // And the quiet state does not claim an alarm it does not have.
    const calm = render(<TheUpgradeScene sim={base} />);
    expect(calm.container.querySelectorAll('.chip--safety')).toHaveLength(0);
  });
});
