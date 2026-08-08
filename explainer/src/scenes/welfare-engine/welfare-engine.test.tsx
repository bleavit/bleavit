import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { WelfareEngineScene, buildModel, compose } from './index';
import { runScenario } from '../../sim/engine';
import { SCENARIOS } from '../../sim/scenarios';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { THETA_C_LO, THETA_S_LO } from '../../protocol/welfare';

/**
 * Half the width of one label character, in stage units.
 *
 * Canvas labels are set at 0.42 stage units (0.50 below 1024px, 0.62 below
 * 768px) and average a little under 0.24 units per character at the widest of
 * those. A label is centred on its node, so two labels on the same row need
 * `(len_a + len_b) · 0.12` between their centres just to touch, plus a gap.
 */
const HALF_CHAR = 0.12;
/** The clear space two labels must keep between them, beyond touching. */
const LABEL_GAP = 0.3;
/**
 * Rows closer than this in stage y draw their labels on top of one another.
 * A label line sits 0.55 below its node's bottom edge and the sublabel 1.10
 * below, so anything under ~0.9 units apart shares a line's worth of space.
 */
const SAME_ROW = 0.9;

const healthy = (cursor: number) =>
  runScenario(SCENARIOS['normal-execution'], cursor, 'Treasury', 'Fund the light-client audit');

/** The step where an upheld severity-2 filing pulls C under its knee. */
const incident = (cursor: number) =>
  runScenario(SCENARIOS['registry-dispute'], cursor, 'Treasury', 'Fund the light-client audit');

describe('welfare-engine buildModel', () => {
  it('keeps every node inside the stage', () => {
    for (const sim of [healthy(0), healthy(6), healthy(8), incident(4), incident(5)]) {
      for (const n of buildModel(sim).nodes) {
        if (n.kind === 'edge') continue;
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.y + n.h).toBeLessThanOrEqual(STAGE_HEIGHT);
      }
    }
  });

  it('never uses a branch tone — welfare belongs to neither branch', () => {
    for (const n of buildModel(healthy(6)).nodes) {
      expect(n.tone).not.toBe('accept');
      expect(n.tone).not.toBe('reject');
    }
  });

  it('sizes each gate disc by its own output', () => {
    const sim = healthy(6);
    const c = compose(sim);
    const disc = buildModel(sim).nodes.find((n) => n.id === 'gate-c');
    expect(disc).toBeDefined();
    expect(c.gC).toBeGreaterThan(0);
    // A live gate is a true disc: width and height are the same number, which is
    // also what makes the 3D renderer draw a cylinder rather than a box.
    expect(disc?.w).toBeCloseTo(disc?.h ?? 0, 12);
    expect(disc?.w).toBeCloseTo(2.2 * c.gC, 12);
  });

  it('collapses a breached gate to a zero-diameter knife edge', () => {
    const sim = incident(4);
    const c = compose(sim);
    expect(c.cPillar).toBeLessThan(THETA_C_LO);
    expect(c.gC).toBe(0);
    expect(c.w).toBe(0);

    const disc = buildModel(sim).nodes.find((n) => n.id === 'gate-c');
    expect(disc?.h).toBeLessThan(0.1);
    expect(disc?.w).toBeGreaterThan(2);
    // Alarm is reserved to genuine safety states; a breached welfare gate is one.
    expect(disc?.tone).toBe('alarm');
  });

  it('drops the whole product run to the floor when a gate is breached', () => {
    const nodes = buildModel(incident(4)).nodes;
    const w = nodes.find((n) => n.id === 'prod-w');
    expect(w?.h).toBeLessThan(0.1);
  });

  it('leaves both epoch slots unmeasured rather than borrowing the snapshot', () => {
    const nodes = buildModel(healthy(8)).nodes;
    for (const id of ['w-e1', 'w-e2']) {
      const n = nodes.find((x) => x.id === id);
      expect(n?.state).toBe('pending');
      expect(n?.sublabel).toBe('not measured');
    }
  });

  it('prints the floor each gated reading has to clear', () => {
    // The knee is what makes the cliff a quantity rather than a mood, so it has
    // to be on the canvas — but as a number the reader can compare against the
    // reading beside it, never as a θ symbol.
    const nodes = buildModel(healthy(6)).nodes;
    expect(nodes.find((n) => n.id === 'in-s')?.sublabel).toContain(THETA_S_LO.toFixed(2));
    expect(nodes.find((n) => n.id === 'in-c')?.sublabel).toContain(THETA_C_LO.toFixed(2));
  });

  it('keeps canvas labels plain and short', () => {
    // Spec symbols live in the rail. A canvas label is read at a glance by
    // someone who has not met the notation, and past a dozen characters it is
    // also what collides with its neighbour.
    for (const n of buildModel(healthy(6)).nodes) {
      if (n.label === undefined) continue;
      expect(n.label.length).toBeLessThanOrEqual(12);
      expect(n.label).toMatch(/^[A-Za-z][A-Za-z0-9 ]*$/);
    }
  });

  it('never draws two labels on top of each other', () => {
    // The user-visible bug this replaces was overlapping text. It is arithmetic,
    // so it is checked rather than eyeballed — across the states that move the
    // gate discs, whose y is a function of the live multiplier.
    for (const sim of [healthy(0), healthy(6), healthy(8), incident(4), incident(5)]) {
      const labelled = buildModel(sim).nodes.filter(
        (n) => n.kind !== 'edge' && n.label !== undefined,
      );
      for (let i = 0; i < labelled.length; i += 1) {
        for (let j = i + 1; j < labelled.length; j += 1) {
          const a = labelled[i];
          const b = labelled[j];
          if (a === undefined || b === undefined) continue;
          if (Math.abs(a.y - b.y) >= SAME_ROW) continue;
          const between = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
          const needed = ((a.label?.length ?? 0) + (b.label?.length ?? 0)) * HALF_CHAR + LABEL_GAP;
          expect(between, `${a.id} and ${b.id} share a label row`).toBeGreaterThan(needed);
        }
      }
    }
  });

  it('names multiplicativity as its relation', () => {
    expect(buildModel(healthy(6)).relation).toContain('Multiplicativity');
  });
});

describe('welfare-engine rail', () => {
  it('carries a DOM row for every object drawn on the canvas', () => {
    for (const sim of [healthy(6), healthy(8), incident(4), incident(5)]) {
      const { container, unmount } = render(<WelfareEngineScene sim={sim} />);
      for (const n of buildModel(sim).nodes) {
        if (n.domRowId === undefined) continue;
        const row = container.querySelector(`#${n.domRowId}`);
        expect(row, `missing rail row for node ${n.id}`).not.toBeNull();
        expect(row?.tagName).toBe('TR');
      }
      unmount();
    }
  });

  it('states that the second epoch has not been measured', () => {
    const { getAllByText } = render(<WelfareEngineScene sim={healthy(6)} />);
    expect(getAllByText('not measured').length).toBeGreaterThanOrEqual(2);
  });

  it('opens with a lede and key facts, and keeps the depth closed', () => {
    const { container } = render(<WelfareEngineScene sim={healthy(6)} />);
    const rail = container.querySelector('.col-rail');
    expect(rail?.querySelector('.lede')).not.toBeNull();
    expect(rail?.querySelectorAll('.keyfact').length).toBe(4);

    const drawers = [...(rail?.querySelectorAll('details.depth') ?? [])];
    expect(drawers.length).toBeGreaterThanOrEqual(3);
    for (const d of drawers) expect(d.hasAttribute('open')).toBe(false);

    // Exactly one panel is left standing outside a drawer, and it is the one the
    // canvas points at.
    const loose = [...(rail?.children ?? [])].filter((el) => el.classList.contains('panel'));
    expect(loose.length).toBe(1);
  });

  it('states the plain-word to symbol mapping in the open panel', () => {
    // The canvas says "Uptime" and the rail says "S". If the bridge between them
    // were not on screen, the diagram and the tables would read as two subjects.
    const { container } = render(<WelfareEngineScene sim={healthy(6)} />);
    const open = container.querySelector('.col-rail > .panel')?.textContent ?? '';
    for (const word of ['Uptime', 'Security', 'Economy', 'Progress', 'Score']) {
      expect(open).toContain(word);
    }
  });
});
