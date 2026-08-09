import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ExecutionGuardScene, buildModel } from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { PLAYBOOK_TRIGGERS } from '../../protocol/types';

/**
 * The execution guard's contract with the specification and with the DOM.
 *
 * The property that carries this scene is conjunction: one refusing box must
 * stop the slab however many others hold. That is asserted directly, because it
 * is the exact claim the drawing makes and the exact claim a thirteen-tick
 * checklist would get wrong.
 *
 * Legibility is asserted just as directly. The renderer centres a label under
 * its node, so two labelled nodes sharing a row collide unless their centres are
 * far enough apart for both boxes plus a gap — an unreadable drawing is a
 * defect, not a matter of taste, and it is cheaper to catch here than by eye.
 */

const scenario = SCENARIOS['blocked-execution'];
const stepsAt = (n: number) =>
  runScenario(scenario, n, 'Code', 'Runtime upgrade to spec_version 42');

/** Step 2 of the scenario: queued, and refused at check 5 (Ratification). */
const refused = stepsAt(2);
/** Step 1: queued, nothing attempted, all fourteen still reading as expected. */
const queued = stepsAt(1);

/**
 * Stage units per label character, and the gap two labels must keep.
 *
 * Deliberately stricter than either measure of the renderer: it estimates
 * `0.56 em` at a 0.46-unit label size (0.258 per character) and keeps a 0.25
 * gap, and the design budget this scene was laid out against was 0.24 with a
 * 0.3 gap. Passing at 0.26/0.3 clears both, so a change to either does not
 * quietly turn this assertion into a formality.
 */
const CHAR_W = 0.26;
const MIN_GAP = 0.3;

describe('buildModel', () => {
  const model = buildModel(refused);
  const boxes = model.nodes.filter((n) => n.id.startsWith('check-'));
  const slab = model.nodes.find((n) => n.id === 'payload');

  it('draws one box per check plus the single payload slab', () => {
    expect(boxes).toHaveLength(refused.guard.checks.length);
    expect(refused.guard.checks).toHaveLength(14);
    expect(slab).toBeDefined();
    expect(model.nodes).toHaveLength(15);
  });

  it('gives every node a unique id and a DOM row', () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.size).toBe(model.nodes.length);
    for (const n of model.nodes) expect(n.domRowId).toBeTruthy();
  });

  it('keeps every node inside the stage', () => {
    for (const n of model.nodes) {
      expect(n.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  it('holds the slab short of the gate while any single box refuses', () => {
    const offset = boxes.filter((n) => n.state === 'blocked');
    expect(offset.length).toBeGreaterThan(0);
    expect(boxes.filter((n) => n.state === 'passed').length).toBeGreaterThan(0);
    expect(slab?.state).not.toBe('passed');
    // A refusing box is never behind the held slab: the payload has cleared none
    // of them, and the drawing must not suggest it cleared some.
    for (const o of offset) expect(slab!.x + slab!.w).toBeLessThan(o.x);
  });

  it('passes the slab whole, and only when all fourteen align', () => {
    const clear = buildModel({
      ...refused,
      guard: {
        ...refused.guard,
        checks: refused.guard.checks.map((c) => ({ ...c, ok: true })),
        blockedAt: null,
      },
    });
    const passed = clear.nodes.find((n) => n.id === 'payload');
    expect(clear.nodes.filter((n) => n.state === 'blocked')).toHaveLength(0);
    expect(passed?.state).toBe('passed');
    // One slab, never two: the batch is atomic, so a partial pass is not drawable.
    expect(clear.nodes.filter((n) => n.kind === 'slab')).toHaveLength(1);
    expect(passed?.w).toBe(slab?.w);
    // And it ends up on the far side of the dispatch line, not merely elsewhere.
    const line = clear.rules.find((r) => r.id === 'dispatch');
    expect(passed!.x).toBeGreaterThan(line!.at);
  });

  // Check 5 is the only clock-shaped row left. Check 14 used to be the second,
  // when it was the descriptor lead time; that row was deleted from the spec,
  // and row 14 is now batch bounds, which is an ordinary state read.
  it('draws check 5 as a level, and the other thirteen as solids', () => {
    const plates = boxes.filter((n) => n.kind === 'plate');
    expect(plates.map((n) => n.id).sort()).toEqual(['check-5']);
    for (const p of plates) {
      expect(p.fill).toBeGreaterThanOrEqual(0);
      expect(p.fill).toBeLessThanOrEqual(1);
    }
    for (const b of boxes.filter((n) => n.kind !== 'plate')) {
      expect(b.kind, b.id).toBe('stop');
      expect(b.fill, b.id).toBeUndefined();
    }
  });

  it('reserves the alarm tone to the two genuine safety checks', () => {
    const alarmed = buildModel(stepsAt(3)).nodes.filter((n) => n.tone === 'alarm');
    expect(alarmed.map((n) => n.id).sort()).toEqual(['check-11', 'check-12']);
    // Nothing in the refused-on-ratification state is an alarm: NotRatified is
    // an ordinary, recoverable refusal.
    expect(model.nodes.filter((n) => n.tone === 'alarm')).toHaveLength(0);
  });

  it('reads nothing before a mandate is queued', () => {
    const early = buildModel(stepsAt(0));
    expect(early.nodes.filter((n) => n.id.startsWith('check-')).every((n) => n.state === 'inactive')).toBe(
      true,
    );
    expect(early.nodes.find((n) => n.id === 'payload')?.state).toBe('pending');
  });

  it('labels every box in plain words, inside the twelve-character budget', () => {
    for (const b of boxes) {
      expect(b.label, b.id).toBeTruthy();
      expect(b.label!.length, `${b.id}: ${b.label}`).toBeLessThanOrEqual(12);
    }
  });

  it('leaves every label room to be read', () => {
    // Every state of the scene, because the slab moves between two of them.
    for (const sim of [stepsAt(0), queued, refused, stepsAt(3)]) {
      const labelled = buildModel(sim).nodes.filter((n) => n.label !== undefined);
      expect(labelled.length).toBe(15);
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

  it('carries its ordinal on every box, in the order the chain reads them', () => {
    // The chain reports a refusal as a number, so the number has to be legible on
    // the box rather than traceable to it from somewhere else on the stage.
    for (const c of refused.guard.checks) {
      const node = boxes.find((n) => n.id === `check-${c.n}`);
      expect(node?.label?.startsWith(`${c.n} `), `check ${c.n}: ${node?.label}`).toBe(true);
    }
    // Down each column, never back up: the ordinals and the geometry agree.
    for (const half of [boxes.slice(0, 7), boxes.slice(7)]) {
      const ys = half.map((n) => n.y);
      expect([...ys].sort((p, q) => q - p)).toEqual(ys);
      expect(new Set(half.map((n) => n.x)).size).toBe(1);
    }
    expect(model.rules.find((r) => r.id === 'order-a')?.label).toBe('checks 1–7');
    expect(model.rules.find((r) => r.id === 'order-b')?.label).toBe('checks 8–14');
  });

  it('marks the first refusal, and only the first', () => {
    const refusal = model.rules.find((r) => r.id === 'refusal');
    const first = refused.guard.checks.find((c) => !c.ok);
    const node = model.nodes.find((n) => n.id === `check-${first!.n}`);
    expect(refusal).toBeDefined();
    expect(refusal!.at).toBeCloseTo(node!.y + node!.h / 2, 6);
    expect(model.rules.filter((r) => r.id === 'refusal')).toHaveLength(1);
    // Nothing is marked before a dispatch is even possible.
    expect(buildModel(stepsAt(0)).rules.find((r) => r.id === 'refusal')).toBeUndefined();
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(refused)).toEqual(model);
  });
});

describe('ExecutionGuardScene', () => {
  it('carries a DOM row for every object on the canvas', () => {
    const { container } = render(<ExecutionGuardScene sim={refused} />);
    const missing = buildModel(refused)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('opens with the plain answer and the numbers, not with a table', () => {
    const { container } = render(<ExecutionGuardScene sim={refused} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.firstElementChild?.className).toBe('lede');
    expect(rail?.querySelectorAll('.keyfact')).toHaveLength(4);
    // The checklist stays out in the open; everything denser is behind a drawer.
    const drawers = [...container.querySelectorAll('details.depth')];
    expect(drawers).toHaveLength(5);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
    expect(container.querySelectorAll('.depth table').length).toBeGreaterThan(0);
    expect(container.querySelector('.guard-checks')?.closest('details')).toBeNull();
  });

  it('names every check twice: the diagram word, then the spec name', () => {
    const { container } = render(<ExecutionGuardScene sim={refused} />);
    const plain = [...container.querySelectorAll('.guard-plain')].map((e) => e.textContent);
    const labels = buildModel(refused)
      .nodes.filter((n) => n.id.startsWith('check-'))
      .map((n) => n.label);
    expect(plain).toEqual(labels);
    expect(container.querySelectorAll('.guard-specname')).toHaveLength(14);
  });

  it('uses the safety chip only in the flag table', () => {
    const { container } = render(<ExecutionGuardScene sim={stepsAt(3)} />);
    const safety = [...container.querySelectorAll('.chip--safety')];
    expect(safety.length).toBeGreaterThan(0);
    for (const el of safety) {
      expect(el.closest('tr')?.id.startsWith('guard-flag-')).toBe(true);
    }
  });

  it('states the v1 playbook gap rather than presenting six live capabilities', () => {
    const { container } = render(<ExecutionGuardScene sim={queued} />);
    const rows = [...container.querySelectorAll('tr[id^="guard-playbook-"]')];
    expect(rows).toHaveLength(6);
    const unavailable = rows.filter((r) => r.textContent?.includes('not in v1'));
    expect(unavailable).toHaveLength(2);
  });

  it('accounts for every playbook trigger exactly once', () => {
    const { container } = render(<ExecutionGuardScene sim={queued} />);
    const printed = [...container.querySelectorAll('.guard-trigger')].map((e) => e.textContent);
    expect(printed.sort()).toEqual([...PLAYBOOK_TRIGGERS].sort());
  });
});
