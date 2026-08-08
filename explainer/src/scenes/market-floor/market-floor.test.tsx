import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { runScenario } from '../../sim/engine';
import { SCENARIOS, SCENARIO_ORDER, SCENARIO_SUBJECT } from '../../sim/scenarios';
import type { ProposalClass } from '../../protocol/types';
import { MARKET_KINDS } from '../../protocol/types';
import { MarketFloorScene, buildModel } from './index';

/**
 * The canvas may hold no fact the rail does not also carry, so the bijection
 * between `domRowId` and the rail's `<tr id>` is asserted rather than reviewed.
 * Every scenario is replayed at every cursor, because the scene has to survive
 * the states where the books do not exist yet as well as the ones where they do.
 */

const states = () =>
  SCENARIO_ORDER.flatMap((id) => {
    const scenario = SCENARIOS[id];
    const subject = SCENARIO_SUBJECT[id];
    return Array.from({ length: scenario.steps.length + 1 }, (_, cursor) =>
      runScenario(scenario, cursor, subject.cls as ProposalClass, subject.title),
    );
  });

describe('market-floor', () => {
  it('draws the seven books in the frozen MarketKind order', () => {
    for (const sim of states()) {
      const plates = buildModel(sim).nodes.filter((n) => n.kind === 'plate');
      expect(plates.map((n) => n.id)).toEqual(MARKET_KINDS.map((k) => `book-${k}`));
    }
  });

  it('keeps the Baseline achromatic and outside both branch groups', () => {
    for (const sim of states()) {
      const nodes = buildModel(sim).nodes;
      const baseline = nodes.find((n) => n.id === 'book-Baseline');
      const decisions = nodes.filter(
        (n) => n.id === 'book-DecisionAccept' || n.id === 'book-DecisionReject',
      );
      expect(baseline?.tone).toBe('ink');
      const rightmostBranch = Math.max(...decisions.map((n) => n.x + n.w));
      // Separated by a gap wider than the gap inside either group.
      expect((baseline?.x ?? 0) - rightmostBranch).toBeGreaterThan(2);
    }
  });

  /**
   * Labels were reported overlapping, so the spacing rule is asserted rather than
   * eyeballed. `Scene2D` centres a label under its node at 0.42 stage-unit type,
   * which is about `0.24` units a character, and it draws every label on the row
   * set by that node's own baseline — so two labels are legible exactly while
   * their centres are further apart than their two half-widths plus clearance.
   */
  const HALF_CHAR = 0.12;
  const CLEARANCE = 0.3;

  it('keeps every drawn label short enough to read', () => {
    for (const sim of states()) {
      for (const node of buildModel(sim).nodes) {
        for (const text of [node.label, node.sublabel]) {
          if (text === undefined) continue;
          expect(text.length).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it('spaces the labels on each row so no two of them can overlap', () => {
    for (const sim of states()) {
      const nodes = buildModel(sim).nodes.filter((n) => n.kind !== 'edge');
      type Drawn = (typeof nodes)[number];
      // Labels and sublabels are drawn on two different rows, so a label can
      // only ever collide with another label.
      const rows: readonly ((n: Drawn) => string | undefined)[] = [
        (n) => n.label,
        (n) => n.sublabel,
      ];
      for (const pick of rows) {
        const drawn = nodes.filter((n) => pick(n) !== undefined);
        for (const a of drawn) {
          for (const b of drawn) {
            if (a.id >= b.id || a.y !== b.y) continue;
            const need = ((pick(a)?.length ?? 0) + (pick(b)?.length ?? 0)) * HALF_CHAR + CLEARANCE;
            const gap = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
            expect(
              gap,
              `${a.id} "${pick(a) ?? ''}" vs ${b.id} "${pick(b) ?? ''}"`,
            ).toBeGreaterThan(need);
          }
        }
      }
    }
  });

  it('prices every plate as a level in [0,1] and never above the plate', () => {
    for (const sim of states()) {
      for (const node of buildModel(sim).nodes) {
        if (node.fill === undefined) continue;
        expect(node.fill).toBeGreaterThanOrEqual(0);
        expect(node.fill).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives every drawn object a rail row to correspond to', () => {
    for (const sim of states()) {
      const { container } = render(<MarketFloorScene sim={sim} />);
      for (const node of buildModel(sim).nodes) {
        if (node.domRowId === undefined) continue;
        expect(container.querySelector(`tr#${node.domRowId}`)).not.toBeNull();
      }
      container.remove();
    }
  });

  it('shows no projected outcome while the windows are still open', () => {
    for (const sim of states()) {
      if (sim.decision !== null) continue;
      const { container } = render(<MarketFloorScene sim={sim} />);
      expect(container.textContent).toContain('None exist yet');
      expect(container.textContent).not.toContain('Uplift, ACCEPT TWAP');
      container.remove();
    }
  });
});
