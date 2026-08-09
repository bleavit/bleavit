import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { LifecycleScene, buildModel, collide, labelBoxes } from './index';
import { SCENARIOS } from '../../sim/scenarios';
import { runScenario } from '../../sim/engine';
import { TRANSITIONS } from '../../protocol/lifecycle';
import { PROPOSAL_STATES } from '../../protocol/types';

/**
 * The lifecycle scene's contract with the specification, with the DOM, and with
 * the reader's eye.
 *
 * Three properties matter more than pixels. The drawing must be a faithful image
 * of §2.1 — one edge per row, no invented edge, every endpoint resolvable — the
 * canvas must hold no fact the rail does not also carry, which is checkable
 * because every node names the DOM row it corresponds to, and no label may be
 * printed on top of another, which is checkable because the layout is authored
 * rather than solved.
 */

const scenario = SCENARIOS['gate-failure'];
const sim = runScenario(scenario, scenario.steps.length, 'Treasury', 'Raise the collator target');

describe('buildModel', () => {
  const model = buildModel(sim);
  const edges = model.nodes.filter((n) => n.kind === 'edge');
  const solids = model.nodes.filter((n) => n.kind !== 'edge');
  const ids = new Set(model.nodes.map((n) => n.id));

  it('draws exactly the 26 transitions and the 15 states, plus the T1 entry', () => {
    expect(edges).toHaveLength(TRANSITIONS.length);
    expect(solids).toHaveLength(PROPOSAL_STATES.length + 1);
  });

  it('resolves both endpoints of every edge to a node it also drew', () => {
    for (const e of edges) {
      expect(e.from === undefined ? '' : e.from, `${e.id} from`).toSatisfy((v: string) =>
        ids.has(v),
      );
      expect(e.to === undefined ? '' : e.to, `${e.id} to`).toSatisfy((v: string) =>
        ids.has(v),
      );
    }
  });

  it('gives every node a unique id and a DOM row', () => {
    expect(ids.size).toBe(model.nodes.length);
    for (const n of model.nodes) expect(n.domRowId).toBeTruthy();
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(sim)).toEqual(model);
  });

  it('labels each drawn segment at most once, so T3/T6 and T4/T26 do not overprint', () => {
    const perSegment = new Map<string, number>();
    for (const e of edges) {
      const key = [e.from, e.to].sort().join('|');
      perSegment.set(key, (perSegment.get(key) ?? 0) + (e.label === undefined ? 0 : 1));
    }
    for (const [key, count] of perSegment) expect(count, key).toBeLessThanOrEqual(1);
  });

  it('draws T10 and T21 as the trunk, wider than the T14 execute branch', () => {
    const weight = (id: string): number =>
      edges.find((e) => e.id === `lc-edge-${id}`)?.emphasis ?? 0;
    expect(weight('T10')).toBeGreaterThan(weight('T14'));
    expect(weight('T21')).toBeGreaterThan(weight('T14'));
  });

  it('marks exactly the walked transitions and the current state', () => {
    const walked = new Set(sim.proposal.history.map((h) => h.id));
    expect(edges.filter((e) => e.state === 'passed')).toHaveLength(walked.size);
    const active = solids.filter((n) => n.state === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]?.label).toBe(sim.proposal.state);
  });

  it('never tints a proposal state with a branch tone', () => {
    for (const n of model.nodes) expect(['ink', 'dim']).toContain(n.tone);
  });

  /**
   * The collision gate.
   *
   * This scene shipped with `Executed` and `FailedExecuted` printed on the same
   * pixels, which reads as one nonsense word and destroys the diagram's only job.
   * The layout is hand-authored, so nothing but a test stops that from recurring
   * after any nudge to a column: `labelBoxes` is the renderer's own arithmetic,
   * and two boxes that intersect are two labels a reader cannot separate.
   */
  it('prints no two labels on top of each other', () => {
    const boxes = labelBoxes(model);
    const hits: string[] = [];
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        if (collide(a, b)) hits.push(`${a.id} × ${b.id}`);
      }
    }
    expect(hits).toEqual([]);
  });

  /**
   * The same rule stated the way it is reasoned about while authoring a row: two
   * state names on one row need half of each name plus a gap between their
   * centres. A name is about 0.24 stage units a glyph, so half of it is 0.12.
   */
  it('leaves every pair of state names on a row clear of each other', () => {
    const named = solids.flatMap((n) =>
      n.label === undefined ? [] : [{ label: n.label, cx: n.x + n.w / 2, y: n.y }],
    );
    const tight: string[] = [];
    for (const [i, a] of named.entries()) {
      for (const b of named.slice(i + 1)) {
        if (a.y !== b.y) continue;
        const need = (a.label.length + b.label.length) * 0.12 + 0.3;
        if (Math.abs(a.cx - b.cx) <= need) tight.push(`${a.label} × ${b.label}`);
      }
    }
    expect(tight).toEqual([]);
  });

  it('keeps every state name inside the drawn stage', () => {
    for (const box of labelBoxes(model)) {
      if (box.kind !== 'state') continue;
      expect(box.x0, `${box.id} left`).toBeGreaterThan(-0.6);
      expect(box.x1, `${box.id} right`).toBeLessThan(21.6);
      expect(box.y0, `${box.id} top`).toBeGreaterThan(-0.6);
      expect(box.y1, `${box.id} bottom`).toBeLessThan(12.6);
    }
  });

  /** Every id the drawing drops has to still be reachable in the rail's table. */
  it('prints an id for every drawn segment', () => {
    const labelled = edges.filter((e) => e.label !== undefined).length;
    const segments = new Set(edges.map((e) => [e.from, e.to].sort().join('|')));
    expect(labelled).toBe(segments.size);
  });
});

describe('LifecycleScene', () => {
  it('carries a DOM row for every object on the canvas', () => {
    const { container } = render(<LifecycleScene sim={sim} />);
    const missing = buildModel(sim)
      .nodes.map((n) => n.domRowId)
      .filter((id): id is string => id !== undefined)
      .filter((id) => container.querySelector(`#${CSS.escape(id)}`) === null);
    expect(missing).toEqual([]);
  });

  it('renders the proposal-state chip in ink', () => {
    const { container } = render(<LifecycleScene sim={sim} />);
    const chip = container.querySelector('.chip--state');
    expect(chip?.className).toBe('chip chip--state');
  });

  it('opens with a plain-language lede and the counts, then closed drawers', () => {
    const { container } = render(<LifecycleScene sim={sim} />);
    expect(container.querySelector('.lede')?.textContent).toContain('change the chain');
    expect(container.querySelectorAll('.keyfact')).toHaveLength(3);
    const drawers = container.querySelectorAll('details.depth');
    expect(drawers.length).toBeGreaterThanOrEqual(3);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);
  });
});
