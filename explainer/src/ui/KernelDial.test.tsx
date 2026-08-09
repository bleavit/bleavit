import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KernelDial, DialReadout, labelRadii } from './KernelDial';
import { PHASE_OFFSET_NUMERATORS } from '../protocol/constants';

/**
 * The dial is the app's signature element, and its accessible label is the only
 * channel a screen-reader user has for the reading. It therefore has to be
 * exactly as true as the drawing.
 */

const L = 302_400; // the default epoch length
const TICK = L / 21;

describe('<KernelDial>', () => {
  it('draws 21 teeth, one per unit of the phase-offset denominator', () => {
    const { container } = render(
      <KernelDial epochLength={L} blockInEpoch={0} epochIndex={41} />,
    );
    expect(container.querySelectorAll('.dial__tick')).toHaveLength(21);
  });

  it('marks exactly the seven kernel boundaries as deep grooves', () => {
    const { container } = render(
      <KernelDial epochLength={L} blockInEpoch={0} epochIndex={41} />,
    );
    const boundaries = container.querySelectorAll('.dial__tick.is-boundary');
    expect(boundaries).toHaveLength(Object.keys(PHASE_OFFSET_NUMERATORS).length);
    expect(boundaries).toHaveLength(7);
  });

  it('announces the distance to the next PHASE boundary, not to the epoch end', () => {
    // Two ticks into Intake: the next boundary is Qualify at 3/21, so 1 tick away.
    render(
      <KernelDial epochLength={L} blockInEpoch={2 * TICK} epochIndex={41} />,
    );
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain('phase Intake');
    expect(label).toContain('14,400 blocks');
    // The epoch remainder here is 19 ticks = 273,600 blocks. Announcing that
    // would be the bug this test exists to prevent.
    expect(label).not.toContain('273,600');
  });

  it('never says the unit twice', () => {
    render(<KernelDial epochLength={L} blockInEpoch={0} epochIndex={41} />);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).not.toContain('blocks blocks');
  });

  it('announces a paused clock when the dead-man switch is engaged', () => {
    render(
      <DialReadout epochLength={L} blockInEpoch={TICK} epochIndex={41} paused />,
    );
    expect(screen.getByText(/dead-man engaged/)).toBeDefined();
  });

  /** The label boxes `labelRadii` reasons about, recomputed independently. */
  function boxes(spans: readonly number[], names: readonly string[], R = 50) {
    const radii = labelRadii(spans, names, R);
    const total = spans.reduce((a, b) => a + b, 0);
    return names.map((text, i) => {
      const from = spans.slice(0, i).reduce((a, b) => a + b, 0);
      const deg = ((from + (spans[i] ?? 0) / 2) / total) * 360;
      const rad = ((deg - 90) * Math.PI) / 180;
      const r = R * (radii[i] ?? 0);
      return {
        dropped: (radii[i] ?? 0) === 0,
        text,
        cx: Math.cos(rad) * r,
        cy: Math.sin(rad) * r,
        hw: (text.length * 0.56 * 6) / 2 + 1.5,
        hh: 6 / 2 + 0.75,
      };
    });
  }

  const overlaps = (bs: ReturnType<typeof boxes>) => {
    const bad: string[] = [];
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!;
        const b = bs[j]!;
        if (a.dropped || b.dropped) continue;
        if (Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh) {
          bad.push(`${a.text} / ${b.text}`);
        }
      }
    return bad;
  };

  it('never prints two phase names on top of each other', () => {
    // The real spans, in ticks: Intake 3, Qualify 1, Seed 1, Trade 10,
    // Decide 3, Housekeeping 1. Qualify and Seed are adjacent single-tick arcs
    // 17.1 degrees apart — an automated sweep of the running app found their
    // names printed on top of each other, and then found a two-pixel corner
    // clip between Decide and House. This is the regression guard for both.
    const bs = boxes([3, 1, 1, 10, 3, 1], [
      'Intake',
      'Qualify',
      'Seed',
      'Trade',
      'Decide',
      'House',
    ]);
    expect(overlaps(bs)).toEqual([]);
  });

  it('separates even a dial made entirely of single-tick phases', () => {
    const spans = [1, 1, 1, 1, 1, 1];
    const names = ['Intake', 'Qualify', 'Seed', 'Trade', 'Decide', 'House'];
    expect(overlaps(boxes(spans, names))).toEqual([]);
  });

  it('keeps every drawn name clear of the centre readout at any rotation', () => {
    // The names ride the rotor and the epoch number at the centre does not, so
    // an inner-ring name sweeps over it once per epoch. Checking the current
    // rotation finds nothing and ships a collision that appears an hour later;
    // the keep-out has to be radial.
    const spans = [3, 1, 1, 10, 3, 1];
    const names = ['Intake', 'Qualify', 'Seed', 'Trade', 'Decide', 'House'];
    const radii = labelRadii(spans, names, 50);
    radii.forEach((ring, i) => {
      if (ring === 0) return; // dropped, so it is never drawn
      const hw = ((names[i] ?? '').length * 0.56 * 6) / 2 + 1.5;
      expect(50 * ring - hw).toBeGreaterThanOrEqual(12);
    });
  });

  it('gives the outer ring to the name that needs it most, not to the first one', () => {
    // A short name must not squat on the outer ring and force a long one
    // inward, where there is even less room for it. These two arcs are adjacent
    // and narrow, so only one of them can have the outer ring.
    const radii = labelRadii([1, 1, 19], ['Aa', 'Housekeeping', 'Trade'], 50);
    expect(radii[1]).toBeGreaterThan(radii[0]!);
  });

  it('gives blocks and human time together, never one alone', () => {
    // One tick into Intake, which runs [0, 3/21): the next boundary is Qualify,
    // two ticks away — 28,800 blocks, or two days.
    render(<DialReadout epochLength={L} blockInEpoch={TICK} epochIndex={41} />);
    // The chain measures in blocks; nobody plans in them.
    expect(screen.getByText(/28,800 blocks/)).toBeDefined();
    expect(screen.getByText(/2 d/)).toBeDefined();
  });
});
