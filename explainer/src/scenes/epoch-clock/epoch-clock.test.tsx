import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { EpochClockScene, buildModel } from './index';
import { Scene2D } from '../Scene2D';
import { runScenario } from '../../sim/engine';
import { SCENARIOS } from '../../sim/scenarios';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../model';
import { TICK_COUNT } from '../../protocol/epoch';

const simAt = (cursor: number) =>
  runScenario(SCENARIOS['normal-execution'], cursor, 'Treasury', 'Fund the light-client audit');

describe('epoch-clock buildModel', () => {
  it('lays 21 teeth across the full stage width, one per kernel tick', () => {
    const model = buildModel(simAt(4));
    const teeth = model.nodes.filter((n) => n.kind === 'tooth');
    expect(teeth).toHaveLength(TICK_COUNT);
    expect(teeth.map((t) => t.x)).toEqual(Array.from({ length: TICK_COUNT }, (_, i) => i));
    expect(TICK_COUNT).toBe(STAGE_WIDTH);
  });

  it('keeps every node inside the stage', () => {
    const model = buildModel(simAt(6));
    for (const n of model.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(STAGE_WIDTH);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h).toBeLessThanOrEqual(STAGE_HEIGHT);
    }
  });

  it('cuts the seven boundary ticks deeper, and writes on none of them', () => {
    const model = buildModel(simAt(0));
    const teeth = model.nodes.filter((n) => n.kind === 'tooth');
    const deepest = Math.max(...teeth.map((t) => t.h));
    expect(teeth.filter((t) => t.h === deepest).map((t) => t.x)).toEqual([0, 3, 4, 5, 15, 18, 20]);
    // The ruler is the same seven boundaries it always was; what changed is that
    // it no longer writes them. The day rule underneath prints the numbers, and
    // numbering both put three labels one stage unit apart — a smudge, not data.
    for (const t of teeth) {
      expect(t.label, `tick ${t.x}`).toBeUndefined();
      expect(t.sublabel, `tick ${t.x}`).toBeUndefined();
    }
  });

  it('tiles the epoch with six phase bars, each naming itself once', () => {
    const model = buildModel(simAt(5));
    const bars = model.nodes.filter((n) => n.id.startsWith('phase-'));
    expect(bars).toHaveLength(6);
    expect(bars[0]?.x).toBe(0);
    for (let i = 1; i < bars.length; i += 1) {
      const prev = bars[i - 1];
      const bar = bars[i];
      if (prev === undefined || bar === undefined) throw new Error('missing bar');
      expect(prev.x + prev.w).toBe(bar.x);
    }
    const last = bars[bars.length - 1];
    expect((last?.x ?? 0) + (last?.w ?? 0)).toBe(STAGE_WIDTH);
    for (const b of bars) {
      expect(b.label !== undefined || b.sublabel !== undefined, b.id).toBe(true);
    }
  });

  it('keeps two labels on one text row at least 2.2 units apart', () => {
    // The reported bug: `Scene2D` centres a label under its node, so two labelled
    // nodes a tick apart print one word over another. Labels and sublabels are
    // separate rows, so the check is per row and the row is where the type lands.
    for (const cursor of [0, 3, 5, 8]) {
      const drawn = buildModel(simAt(cursor)).nodes.flatMap((n) =>
        // Baselines as `Scene2D` computes them: flip(y, h) + h + 0.55, which is
        // 12 − y + 0.55 whatever the node's height, and 1.1 for the second row.
        (['label', 'sublabel'] as const)
          .filter((key) => n[key] !== undefined)
          .map((key) => ({
            id: `${n.id} ${key}`,
            row: 12 - n.y + (key === 'label' ? 0.55 : 1.1),
            centre: n.x + n.w / 2,
          })),
      );
      for (const a of drawn) {
        for (const b of drawn) {
          if (a.id >= b.id || Math.abs(a.row - b.row) > 0.3) continue;
          expect(
            Math.abs(a.centre - b.centre),
            `${a.id} and ${b.id} share a row (cursor ${cursor})`,
          ).toBeGreaterThanOrEqual(2.2);
        }
      }
    }
  });

  it('never colours the clock — tone stays achromatic unless the dead-man engages', () => {
    const model = buildModel(simAt(5));
    for (const n of model.nodes) expect(n.tone).toBe('ink');
    for (const r of model.rules) expect(r.tone === 'ink' || r.tone === 'dim').toBe(true);
  });

  it('draws at most four cohort rails, the I-21 cap, each naming its cohort', () => {
    const model = buildModel(simAt(5));
    const rails = model.nodes.filter((n) => n.kind === 'slab');
    expect(rails.length).toBeLessThanOrEqual(4);
    expect(rails.length).toBeGreaterThan(0);
    // Including the one-tick settling rail against the right edge, which is the
    // one whose name has to squeeze into what is left of the stage.
    for (const r of rails) {
      expect(r.label, r.id).toMatch(/^Cohort \d+$/);
      expect(r.sublabel, r.id).toBeDefined();
    }
  });

  it('names a relation', () => {
    expect(buildModel(simAt(3)).relation).toContain('Simultaneity');
  });

  it('keeps every drawn label inside the projected viewBox', () => {
    // Labels are centred on their node, so a wide label on a narrow node against
    // the right edge silently runs off the stage. Estimated from the two label
    // sizes in scene.css; generous enough that it only fires on a real overrun.
    for (const cursor of [0, 3, 5, 8]) {
      const { container } = render(<Scene2D model={buildModel(simAt(cursor))} />);
      const overruns: string[] = [];
      container.querySelectorAll('text').forEach((t) => {
        const x = Number(t.getAttribute('x'));
        const y = Number(t.getAttribute('y'));
        const anchor = t.getAttribute('text-anchor') ?? 'start';
        const perChar = (t.getAttribute('class') ?? '').includes('scene__label') ? 0.23 : 0.19;
        const w = (t.textContent ?? '').length * perChar;
        const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        if (left < -0.6 || left + w > STAGE_WIDTH + 0.6 || y < -0.6 || y > STAGE_HEIGHT + 0.6) {
          overruns.push(`${t.textContent} @ ${left.toFixed(2)}..${(left + w).toFixed(2)}, y ${y}`);
        }
      });
      expect(overruns.join('\n'), `cursor ${cursor}`).toBe('');
    }
  });
});

describe('epoch-clock rail', () => {
  it('carries a DOM row for every node that claims one', () => {
    // jsdom ships no usable matchMedia; SceneFrame's capability probe needs one.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    const sim = simAt(5);
    const { container } = render(<EpochClockScene sim={sim} />);
    const ids = new Set(
      buildModel(sim)
        .nodes.map((n) => n.domRowId)
        .filter((id): id is string => id !== undefined),
    );
    for (const id of ids) {
      expect(container.querySelector(`#${CSS.escape(id)}`), id).not.toBeNull();
    }
  });
});
