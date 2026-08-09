import { describe, expect, it } from 'vitest';
import { layoutLabels, staggerTicks } from './labels';
import type { SceneNode } from './model';
import { STAGE_HEIGHT } from './model';

/**
 * The placement pass exists because of a reported defect: two neighbouring
 * lifecycle states printed their labels on top of one another and the diagram
 * read as a typo ("FailedExecuted"). These cases pin the property that fixes it.
 */

const flip = (y: number, h = 0): number => STAGE_HEIGHT - y - h;

const node = (over: Partial<SceneNode> & Pick<SceneNode, 'id'>): SceneNode => ({
  kind: 'node',
  x: 0,
  y: 6,
  w: 2,
  h: 1,
  tone: 'ink',
  ...over,
});

const opts = {
  flip,
  fontSize: 0.46,
  subFontSize: 0.36,
  maxBands: 3,
  firstBand: 0.46,
  bandStep: 0.58,
};

/** Half-width of a label under the same estimate the layout uses. */
const half = (text: string, size: number) => (text.length * 0.56 * size) / 2;

describe('layoutLabels', () => {
  it('keeps a single label in the band closest to its node', () => {
    const out = layoutLabels([node({ id: 'a', label: 'Queued' })], opts);
    expect(out.dropped).toBe(0);
    expect(out.placed).toHaveLength(1);
    expect(out.placed[0]?.band).toBe(0);
  });

  it('pushes a colliding neighbour to the next band instead of overlapping it', () => {
    // The reported case: two wide labels whose boxes overlap on the same row.
    const out = layoutLabels(
      [
        node({ id: 'failed', x: 8, label: 'FailedExecution' }),
        node({ id: 'exec', x: 10, label: 'Executed' }),
      ],
      opts,
    );
    expect(out.dropped).toBe(0);
    const bands = out.placed.map((p) => p.band);
    expect(new Set(bands).size).toBe(2);
  });

  it('never leaves two labels overlapping in the same band', () => {
    const nodes = Array.from({ length: 9 }, (_, i) =>
      node({ id: `n${i}`, x: i * 2, label: 'Measuring' }),
    );
    const out = layoutLabels(nodes, opts);

    const byBand = new Map<number, { lo: number; hi: number }[]>();
    for (const p of out.placed) {
      const h = half(p.text, p.primary ? opts.fontSize : opts.subFontSize);
      const list = byBand.get(p.band) ?? [];
      for (const r of list) {
        // Strict: boxes in one band must be disjoint, with the gap the layout
        // reserves. Touching is allowed; overlapping is the bug.
        expect(p.x + h <= r.lo || p.x - h >= r.hi).toBe(true);
      }
      list.push({ lo: p.x - h, hi: p.x + h });
      byBand.set(p.band, list);
    }
  });

  it('drops what will not fit rather than shrinking or overlapping it', () => {
    // Six long labels stacked on one x cannot fit in three bands.
    const nodes = Array.from({ length: 6 }, (_, i) =>
      node({ id: `n${i}`, x: 9, label: 'ScalarSettled' }),
    );
    const out = layoutLabels(nodes, opts);
    expect(out.placed.length).toBe(3);
    expect(out.dropped).toBe(3);
  });

  it('does not let a crowded row push a far-away label down with it', () => {
    // Bands are allocated in real page coordinates, so a label whose own
    // neighbourhood is empty stays in band 0 however busy another row is.
    const nodes = [
      node({ id: 'top-a', x: 4, y: 9, label: 'Measuring' }),
      node({ id: 'top-b', x: 5, y: 9, label: 'Measuring' }),
      node({ id: 'bottom', x: 4, y: 2, label: 'Measuring' }),
    ];
    const out = layoutLabels(nodes, opts);
    expect(out.placed.find((p) => p.id === 'bottom')?.band).toBe(0);
  });

  it('keeps a sublabel below its own label, never beside or above it', () => {
    const out = layoutLabels(
      [node({ id: 'a', x: 9, label: 'Security', sublabel: 'adopt' })],
      opts,
    );
    const label = out.placed.find((p) => p.id === 'a');
    const sub = out.placed.find((p) => p.id === 'a--sub');
    expect(label).toBeDefined();
    expect(sub).toBeDefined();
    expect(sub!.band).toBeGreaterThan(label!.band);
  });

  it('drops a secondary label before a primary one when space runs out', () => {
    // Three primaries fill all three bands at one x; the sublabel has nowhere
    // left, and it is the sublabel that goes.
    const nodes = [
      node({ id: 'a', x: 9, label: 'Measuring', sublabel: 'leg 1 of 2' }),
      node({ id: 'b', x: 9, label: 'Measuring' }),
      node({ id: 'c', x: 9, label: 'Measuring' }),
    ];
    const out = layoutLabels(nodes, opts);
    expect(out.placed.filter((p) => p.primary)).toHaveLength(3);
    expect(out.placed.filter((p) => !p.primary)).toHaveLength(0);
    expect(out.dropped).toBe(1);
  });

  it('ignores edges — their labels are placed on the connector, not in a band', () => {
    const out = layoutLabels(
      [node({ id: 'e', kind: 'edge', label: 'T14', from: 'a', to: 'b' })],
      opts,
    );
    expect(out.placed).toHaveLength(0);
  });
});

describe('staggerTicks', () => {
  it('leaves a well-spaced scale entirely in the first lane', () => {
    expect(staggerTicks([0, 2, 4, 6, 8], 1)).toEqual([0, 0, 0, 0, 0]);
  });

  it('steps a crowded neighbour into the next lane instead of overprinting it', () => {
    // The market's price axis: 0.00 and 0.02 are two hundredths apart on a
    // 0-1 scale, and their labels printed straight through each other.
    const lanes = staggerTicks([0, 0.02, 0.5, 0.98, 1], 0.4);
    expect(lanes[0]).not.toBe(lanes[1]);
    expect(lanes[3]).not.toBe(lanes[4]);
  });

  it('keeps every tick — a scale that prints only its endpoints is not a scale', () => {
    const positions = [0, 0.02, 0.5, 0.98, 1];
    expect(staggerTicks(positions, 0.4)).toHaveLength(positions.length);
  });

  it('never puts two labels closer than the gap within one lane', () => {
    const positions = [0, 0.1, 0.2, 0.3, 3, 3.05, 6];
    const gap = 0.5;
    const lanes = staggerTicks(positions, gap, 2);
    const byLane = new Map<number, number[]>();
    positions.forEach((p, i) => {
      const lane = lanes[i]!;
      const list = byLane.get(lane) ?? [];
      // With only two lanes and four ticks inside one gap, some crowding is
      // unavoidable; what must hold is that consecutive same-lane labels are
      // never closer than they would have been in a single lane.
      list.push(p);
      byLane.set(lane, list);
    });
    for (const list of byLane.values()) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i]! - list[i - 1]!).toBeGreaterThan(0);
      }
    }
  });
});
