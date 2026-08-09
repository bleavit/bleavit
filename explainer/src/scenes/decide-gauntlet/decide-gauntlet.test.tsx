import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { DecideGauntletScene, buildModel } from './index';
import type { SceneNode } from '../model';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { runScenario } from '../../sim/engine';
import { SCENARIOS, SCENARIO_SUBJECT } from '../../sim/scenarios';
import type { ScenarioId } from '../../state/store';
import type { ProposalClass } from '../../protocol/types';

/**
 * The gauntlet's two contracts: the drawing must be legible, and the rail must
 * carry everything the drawing does.
 *
 * Legibility is testable rather than a matter of taste. Labels are drawn centred
 * under their node at roughly 0.24 stage units per character, so two labels
 * sharing a row overprint unless their centres are further apart than half of
 * both label widths plus a gap. Eleven stations across one 21-unit row cannot
 * satisfy that at any label length, which is why the scene lays them out as two
 * rows — and this suite is what keeps a later "just add one more station" from
 * quietly breaking it again.
 */

/** Stage units per character of a drawn label, and the gap two labels need. */
const CHAR_WIDTH = 0.24;
const LABEL_GAP = 0.3;
/** `Scene2D`'s viewBox padding: text may overhang the stage, but not the frame. */
const VIEW_PAD = 0.6;

const centre = (n: SceneNode): number => n.x + n.w / 2;
const needed = (a: string, b: string): number =>
  (a.length + b.length) * (CHAR_WIDTH / 2) + LABEL_GAP;

const statesOf = (id: ScenarioId, cls?: ProposalClass) => {
  const scenario = SCENARIOS[id];
  const subject = SCENARIO_SUBJECT[id];
  return Array.from({ length: scenario.steps.length + 1 }, (_, cursor) =>
    runScenario(scenario, cursor, cls ?? (subject.cls as ProposalClass), subject.title),
  );
};

const ALL = [
  ...statesOf('normal-execution'),
  ...statesOf('gate-failure'),
  // The longest class name any slab can carry, and the only class that skips a
  // station — both are the worst case for the label spacing asserted below.
  ...statesOf('normal-execution', 'Constitutional'),
];
const DECIDED = ALL.filter((s) => s.decision !== null);
const UNDECIDED = ALL.filter((s) => s.decision === null);

/** Every distinct drawing this scene can produce, decided and not. */
const MODELS = ALL.map(buildModel);

describe('decide-gauntlet geometry', () => {
  it('exercises both the run and the not-yet-run drawing', () => {
    expect(DECIDED.length).toBeGreaterThan(0);
    expect(UNDECIDED.length).toBeGreaterThan(0);
  });

  it('keeps every node inside the stage', () => {
    for (const model of MODELS) {
      for (const n of model.nodes) {
        if (n.kind === 'edge') continue;
        expect(n.x, n.id).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w, n.id).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(n.y, n.id).toBeGreaterThanOrEqual(0);
        expect(n.y + n.h, n.id).toBeLessThanOrEqual(STAGE_HEIGHT);
      }
    }
  });

  it('never lets two labels on one row overlap', () => {
    for (const model of MODELS) {
      // Labels are drawn under the node, so nodes that share a floor share a
      // text line — the slab included, which is why it is grouped with them.
      const rows = new Map<number, SceneNode[]>();
      for (const n of model.nodes) {
        if (n.kind === 'edge' || n.label === undefined) continue;
        rows.set(n.y, [...(rows.get(n.y) ?? []), n]);
      }
      expect(rows.size).toBe(2);

      for (const row of rows.values()) {
        for (let i = 0; i < row.length; i++) {
          for (let j = i + 1; j < row.length; j++) {
            const a = row[i]!;
            const b = row[j]!;
            const gap = Math.abs(centre(a) - centre(b));
            expect(gap, `${a.id} vs ${b.id} labels`).toBeGreaterThan(
              needed(a.label ?? '', b.label ?? ''),
            );
            if (a.sublabel !== undefined && b.sublabel !== undefined) {
              // Sublabels are set smaller than labels, so testing them at the
              // label's character width is the conservative direction.
              expect(gap, `${a.id} vs ${b.id} sublabels`).toBeGreaterThan(
                needed(a.sublabel, b.sublabel),
              );
            }
          }
        }
      }
    }
  });

  it('keeps every label inside the drawn frame', () => {
    for (const model of MODELS) {
      for (const n of model.nodes) {
        if (n.kind === 'edge') continue;
        for (const text of [n.label, n.sublabel]) {
          if (text === undefined) continue;
          const half = (text.length * CHAR_WIDTH) / 2;
          expect(centre(n) - half, `${n.id} "${text}" left`).toBeGreaterThan(-VIEW_PAD);
          expect(centre(n) + half, `${n.id} "${text}" right`).toBeLessThan(
            STAGE_WIDTH + VIEW_PAD,
          );
        }
      }
    }
  });

  it('reads in step order: top row left to right, then the bottom row', () => {
    for (const model of MODELS) {
      const stations = model.nodes.filter((n) => n.id.startsWith('station-'));
      expect(stations).toHaveLength(11);

      const reading = [...stations].sort((a, b) => (b.y === a.y ? a.x - b.x : b.y - a.y));
      reading.forEach((n, i) => {
        expect(n.id).toBe(`station-${i + 1}`);
        // The number is inside the label because rules and sublabels are 2D-only:
        // `label` is the one string the 3D renderer also draws.
        expect(n.label?.startsWith(`${i + 1} `)).toBe(true);
      });

      // Five on top, six below, and the top row genuinely sits above.
      const top = reading.slice(0, 5);
      const bottom = reading.slice(5);
      expect(new Set(top.map((n) => n.y)).size).toBe(1);
      expect(new Set(bottom.map((n) => n.y)).size).toBe(1);
      expect(top[0]!.y).toBeGreaterThan(bottom[0]!.y);
    }
  });

  it('gives the two ruin gates the extra height and nothing else', () => {
    for (const model of MODELS) {
      const stations = model.nodes.filter((n) => n.id.startsWith('station-'));
      const tall = stations.filter((n) => n.h > 1.5).map((n) => n.id);
      expect(tall).toEqual(['station-3', 'station-4']);
    }
  });

  it('resolves both endpoints of every connector to a node it also drew', () => {
    for (const model of MODELS) {
      const ids = new Set(model.nodes.map((n) => n.id));
      for (const e of model.nodes.filter((n) => n.kind === 'edge')) {
        expect(ids.has(e.from ?? ''), `${e.id} from`).toBe(true);
        expect(ids.has(e.to ?? ''), `${e.id} to`).toBe(true);
      }
      // The row change is deliberately unconnected: such a line would leave the
      // last top-row station straight through its own label.
      expect(ids.has('link-5-6')).toBe(false);
    }
  });

  it('dims every station and connector the run never reached', () => {
    const sim = DECIDED.find((s) => s.decision?.outcome.kind === 'Reject');
    expect(sim).toBeDefined();
    const trace = sim!.decision!;
    const model = buildModel(sim!);

    for (let step = trace.stoppedAt + 1; step <= 11; step++) {
      const station = model.nodes.find((n) => n.id === `station-${step}`);
      expect(station?.state, `station-${step}`).toBe('inactive');
      expect(station?.sublabel, `station-${step}`).toBe('not reached');
      const link = model.nodes.find((n) => n.id === `link-${step - 1}-${step}`);
      if (link !== undefined) expect(link.tone, link.id).toBe('dim');
    }
  });

  it('draws no proposal, and no verdict, before the rule has run', () => {
    const model = buildModel(UNDECIDED[0]!);
    expect(model.nodes.find((n) => n.id === 'proposal')).toBeUndefined();
    for (const n of model.nodes.filter((x) => x.id.startsWith('station-'))) {
      expect(n.sublabel).toBe('not run yet');
      expect(n.state).toBe('inactive');
    }
  });

  it('names ordering as the relation the drawing carries', () => {
    expect(MODELS[0]!.relation).toContain('Order');
  });

  it('is deterministic: the same sim yields identical geometry', () => {
    expect(buildModel(DECIDED[0]!)).toEqual(buildModel(DECIDED[0]!));
  });
});

describe('decide-gauntlet rail', () => {
  it('carries a DOM row for every object drawn on the canvas', () => {
    for (const sim of [DECIDED[0]!, DECIDED[DECIDED.length - 1]!, UNDECIDED[0]!]) {
      const { container, unmount } = render(<DecideGauntletScene sim={sim} />);
      for (const n of buildModel(sim).nodes) {
        if (n.domRowId === undefined) continue;
        const row = container.querySelector(`#${n.domRowId}`);
        expect(row, `missing rail row for node ${n.id}`).not.toBeNull();
        expect(row?.tagName).toBe('TR');
      }
      unmount();
    }
  });

  it('opens with a lede and three key facts, and keeps every drawer closed', () => {
    const { container } = render(<DecideGauntletScene sim={DECIDED[0]!} />);
    expect(container.querySelectorAll('.lede')).toHaveLength(1);
    expect(container.querySelectorAll('.keyfact')).toHaveLength(3);
    expect(container.querySelectorAll('details').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('details[open]')).toHaveLength(0);
  });

  it('leaves the checklist itself visible, one row per check', () => {
    const { container } = render(<DecideGauntletScene sim={DECIDED[0]!} />);
    const rows = container.querySelectorAll('tr[id^="decide-step-"]');
    expect(rows).toHaveLength(11);
    // The rail names the check the way the specification does, and prints the
    // canvas label beside it so the two vocabularies are visibly one list.
    expect(container.textContent).toContain('Gate veto');
    expect(container.textContent).toContain('4 Ruin veto');
  });

  it('reports an unrun rule as unrun rather than as a passing one', () => {
    const { container } = render(<DecideGauntletScene sim={UNDECIDED[0]!} />);
    expect(container.textContent).toContain('Not yet evaluable');
    expect(container.textContent).toContain('Not yet run');
  });
});
