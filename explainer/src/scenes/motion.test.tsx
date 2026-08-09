import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { MotionKind, MotionSpec } from './motion';
import { MOTION_META, motionReadout } from './motion';
import { SCENES, SCENE_ORDER } from './registry';
import { runScenario } from '../sim/engine';
import { SCENARIOS } from '../sim/scenarios';
import { useUi } from '../state/store';

/**
 * The rule these tests exist to hold: **3D only where a plane loses something.**
 *
 * The first version of this app rendered every scene in 3D by projecting the
 * flat diagram's own model, which made the 3D view a copy with fewer labels. The
 * fix was not a better camera, it was deciding per scene whether the third
 * dimension carries a relation at all — and accepting that for three of the
 * eight it does not. That decision is easy to erode one scene at a time, so it
 * is asserted here rather than left to the comments.
 */

const sim = (cursor: number, scenario: keyof typeof SCENARIOS = 'normal-execution') =>
  runScenario(SCENARIOS[scenario], cursor, 'Treasury', 'Fund the light-client audit');

const ALL_KINDS: readonly MotionKind[] = [
  'turning-clock',
  'cost-surface',
  'both-futures',
  'corridor',
  'cliff',
];

/** Scenes whose relation genuinely needs a third dimension, and no others. */
const SCENES_WITH_MOTION = new Set([
  'epoch-clock',
  'market-floor',
  'ledger-escrow',
  'decide-gauntlet',
  'welfare-engine',
]);

describe('MOTION_META', () => {
  it('names every motion after what you get to see, never after the technology', () => {
    for (const kind of ALL_KINDS) {
      const meta = MOTION_META[kind];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.label).not.toMatch(/3D|WebGL|three/i);
    }
  });

  it('makes every motion state the claim a plane cannot hold', () => {
    // The `adds` line is printed under the stage. A motion that cannot say what
    // it adds is a motion that should not exist, and this is the cheapest place
    // for that to become obvious.
    for (const kind of ALL_KINDS) {
      expect(MOTION_META[kind].adds.length).toBeGreaterThan(40);
    }
  });
});

describe('motionReadout', () => {
  const specs: Record<MotionKind, MotionSpec> = {
    'turning-clock': {
      kind: 'turning-clock',
      props: {
        epoch: 12,
        epochLength: 21,
        blockInEpoch: 7,
        arcs: [{ name: 'Trade', fromTick: 5, toTick: 15 }],
        activePhase: 'Trade',
        decideWindow: { name: 'Decision window', fromTick: 12, toTick: 15 },
        stopped: false,
      },
    },
    'cost-surface': {
      kind: 'cost-surface',
      props: { label: 'Decision book', b: 10_000, spot: 0.5 },
    },
    'both-futures': {
      kind: 'both-futures',
      props: {
        escrowed: 5_000,
        acceptUnits: 5_000,
        rejectUnits: 5_000,
        resolved: null,
        voided: false,
        frozen: false,
      },
    },
    corridor: {
      kind: 'corridor',
      props: {
        steps: [
          { n: 1, name: 'Safety flags', verdict: 'pass' },
          { n: 2, name: 'Process holds', verdict: 'reject' },
          { n: 3, name: 'Book validity', verdict: 'not-reached' },
        ],
        haltedAt: 2,
        outcome: 'Reject',
      },
    },
    cliff: {
      kind: 'cliff',
      props: {
        s: 0.95,
        c: 0.9,
        plateau: 0.8,
        w: 0.42,
        thetaS: [0.9, 0.98],
        thetaC: [0.85, 0.95],
      },
    },
  };

  it('gives every motion a title and at least one line of numbers', () => {
    for (const kind of ALL_KINDS) {
      const out = motionReadout(specs[kind]);
      expect(out.title.length).toBeGreaterThan(0);
      expect(out.lines.length).toBeGreaterThan(0);
    }
  });

  it('says which check stopped the run, and that the rest were never evaluated', () => {
    const out = motionReadout(specs.corridor);
    expect(out.title).toContain('Process holds');
    expect(out.lines.join(' ')).toContain('never evaluated');
  });

  it('reports a clean run as eleven cleared rather than as a halt', () => {
    const clean = motionReadout({
      kind: 'corridor',
      props: {
        steps: [{ n: 1, name: 'Safety flags', verdict: 'pass' }],
        haltedAt: null,
        outcome: 'Adopt',
      },
    });
    expect(clean.title).toContain('Adopt');
    expect(clean.lines.join(' ')).not.toContain('never evaluated');
  });

  it('never says a frozen branch was burned', () => {
    const resolved = motionReadout({
      kind: 'both-futures',
      props: {
        escrowed: 1,
        acceptUnits: 1,
        rejectUnits: 1,
        resolved: 'Accept',
        voided: false,
        frozen: false,
      },
    });
    expect(resolved.lines.join(' ')).toContain('frozen, not burned');
  });

  it('states that a closed gate cannot be bought back', () => {
    const zeroed = motionReadout({
      kind: 'cliff',
      props: { ...specs.cliff.props, w: 0 } as never,
    });
    expect(zeroed.lines.join(' ')).toContain('nothing buys it back');
  });
});

describe('which scenes offer an animated view', () => {
  // Motions are opt-in per device; pin the preference so the tab's *presence*
  // is what is under test rather than the viewport the runner happens to have.
  const renderScene = (id: (typeof SCENE_ORDER)[number], cursor = 6) => {
    useUi.setState({ motionEnabled: false, fallbackReason: null });
    const { Component } = SCENES[id];
    return render(<Component sim={sim(cursor)} />);
  };

  it.each(SCENE_ORDER)('%s offers one only where 3D carries a relation', (id) => {
    const { unmount } = renderScene(id);
    const tabs = screen.queryAllByRole('tab');
    if (SCENES_WITH_MOTION.has(id)) {
      expect(tabs).toHaveLength(2);
      expect(tabs[0]?.textContent).toBe('Diagram');
    } else {
      // Not a gap. A state graph, a timeline and an ordered checklist are all
      // better on a plane, and an empty tab would be worse than no tab.
      expect(tabs).toHaveLength(0);
    }
    unmount();
  });

  it('opens on the diagram when the reader has turned animation off', () => {
    const { container, unmount } = renderScene('epoch-clock');
    expect(container.querySelector('svg.scene2d')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    unmount();
  });
});
