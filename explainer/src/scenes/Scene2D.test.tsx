import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Scene2D } from './Scene2D';
import { STAGE_HEIGHT, STAGE_WIDTH } from './model';
import type { SceneModel } from './model';
import { FrameRateWatch, assessCapability, detectWebgl2 } from './capability';

/**
 * The 2D renderer is the accessibility and low-capability path, so it is not
 * optional and not a stub. These tests hold it to the same contract as the
 * canvas: it draws every node, it carries the relation as an accessible
 * description, and it never depends on WebGL.
 */

const model: SceneModel = {
  relation: 'ordering as a hard constraint',
  nodes: [
    { id: 'a', kind: 'plate', x: 2, y: 2, w: 1, h: 4, tone: 'accept', fill: 0.56, label: 'ACCEPT' },
    { id: 'b', kind: 'plate', x: 5, y: 2, w: 1, h: 4, tone: 'reject', fill: 0.52, label: 'REJECT' },
    { id: 'c', kind: 'plate', x: 9, y: 2, w: 1, h: 4, tone: 'ink', fill: 0.523, label: 'Baseline' },
    { id: 'ceil', kind: 'ceiling', x: 12, y: 8, w: 6, h: 0.3, tone: 'alarm', label: 'p_max' },
    { id: 'e1', kind: 'edge', from: 'a', to: 'b', x: 0, y: 0, w: 0, h: 0, tone: 'dim', label: 'T9' },
  ],
  rules: [
    {
      id: 'y',
      axis: 'y',
      at: 1.5,
      from: 2,
      to: 6,
      label: 'price',
      ticks: [
        { at: 2, label: '0' },
        { at: 6, label: '1' },
      ],
    },
  ],
};

describe('<Scene2D>', () => {
  it('renders every node in the model', () => {
    const { container } = render(<Scene2D model={model} />);
    // Four solids plus one edge.
    expect(container.querySelectorAll('.scene__node')).toHaveLength(5);
  });

  it('exposes the relation as the diagram’s accessible description', () => {
    const { container } = render(<Scene2D model={model} />);
    const svg = container.querySelector('svg');
    const label = svg?.getAttribute('aria-label') ?? '';
    expect(label).toContain('ordering as a hard constraint');
    // And it points at the authoritative source, which is the DOM, not the
    // drawing. The rail sits beside the stage rather than under it now, so the
    // sentence says "panel" — what matters is that it still redirects.
    expect(label).toContain('panel beside it');
  });

  it('uses the full stage as its viewBox, so 2D and 3D share one ruler', () => {
    const { container } = render(<Scene2D model={model} />);
    const vb = container.querySelector('svg')?.getAttribute('viewBox') ?? '';
    const [, , w, h] = vb.split(' ').map(Number);
    expect(w).toBeGreaterThanOrEqual(STAGE_WIDTH);
    expect(h).toBeGreaterThanOrEqual(STAGE_HEIGHT);
  });

  it('draws axis ticks with their printed values', () => {
    const { container } = render(<Scene2D model={model} />);
    const ticks = [...container.querySelectorAll('.scene__tick')].map((t) => t.textContent);
    expect(ticks).toContain('0');
    expect(ticks).toContain('1');
  });

  it('needs no WebGL at all', () => {
    // jsdom provides no WebGL context; the 2D path must not care.
    expect(detectWebgl2()).toBe(false);
    expect(() => render(<Scene2D model={model} />)).not.toThrow();
  });
});

describe('capability assessment', () => {
  it('falls back to 2D when WebGL 2 is unavailable, with a reason a user can read', () => {
    const c = assessCapability(1440);
    expect(c.ok).toBe(false);
    expect(c.reason).toBeTruthy();
    // Never a bare error: the copy always says what is shown instead.
    expect(c.reason).toContain('static diagram');
  });

  it('refuses 3D on a viewport too narrow for the stage', () => {
    expect(assessCapability(320).ok).toBe(false);
  });
});

describe('FrameRateWatch', () => {
  it('trips once, and only after a sustained low rate', () => {
    const w = new FrameRateWatch(24, 4);
    let tripped = 0;
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t += 0.1; // 10 fps
      if (w.sample(t)) tripped++;
    }
    expect(tripped).toBe(1);
  });

  it('does not trip at a healthy rate', () => {
    const w = new FrameRateWatch(24, 4);
    let t = 0;
    let tripped = 0;
    for (let i = 0; i < 40; i++) {
      t += 1 / 60;
      if (w.sample(t)) tripped++;
    }
    expect(tripped).toBe(0);
  });

  it('never trips on an idle on-demand loop, however long the gaps are', () => {
    // The renderer draws on demand, so a scene nobody is touching produces
    // frames seconds apart. Read naively that is 0.3 fps, and the guard would
    // degrade a perfectly healthy scene to 2D for the crime of being still.
    const w = new FrameRateWatch(24, 4);
    let t = 0;
    let tripped = 0;
    for (let i = 0; i < 40; i++) {
      t += 3; // one frame every three seconds: idle, not slow
      if (w.sample(t)) tripped++;
    }
    expect(tripped).toBe(0);
  });

  it('still trips on a genuinely slow burst that follows an idle gap', () => {
    const w = new FrameRateWatch(24, 4);
    let t = 0;
    let tripped = 0;
    t += 8; // a long idle stretch first
    w.sample(t);
    for (let i = 0; i < 40; i++) {
      t += 0.1; // then a contiguous burst at 10 fps
      if (w.sample(t)) tripped++;
    }
    expect(tripped).toBe(1);
  });
});
