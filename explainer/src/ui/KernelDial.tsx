import { useId } from 'react';
import {
  DEGREES_PER_TICK,
  TICK_COUNT,
  decideWindowArc,
  formatBlocks,
  formatDurationHuman,
  phaseArcs,
  phaseAt,
} from '../protocol/epoch';
import { PHASE_OFFSET_NUMERATORS } from '../protocol/constants';
import './dial.css';

/**
 * The Kernel Dial — the signature element.
 *
 * It is not a decorative clock. Bleavit's phase boundaries are kernel fractions
 * with denominator **21** (`futarchy_primitives::phase_offsets::DENOMINATOR`), so
 * a 21-tooth scale makes every boundary land on an integer tooth edge at *any*
 * legal `epoch.length`. No other chain can have this dial, because no other chain
 * has that denominator.
 *
 * It also teaches something a table hides. A META mandate's 14-day timelock, laid
 * on a 21-tooth dial starting at tooth 18, visibly overruns into the next epoch.
 * The geometry does the explaining.
 *
 * **The scale is fixed and the hand moves**, as on a clock. The first version
 * did the opposite — a chronometer drum, where the index stays at the top and
 * the dial turns beneath it — and that was a mistake for a reason that only
 * shows up when you sweep for it. Phase names rode the dial, so their positions
 * turn while their text boxes stay axis-aligned; two names a fixed distance
 * apart therefore separate vertically at one rotation and collide horizontally a
 * few hours later. No placement rule can fix that, because the geometry it is
 * placing against changes every block. Holding the scale still makes the problem
 * static, solves it once, and has the ordinary benefit besides: the name of a
 * phase stays where the reader last saw it.
 */

const BOUNDARY_TICKS: ReadonlySet<number> = new Set<number>(
  Object.values(PHASE_OFFSET_NUMERATORS),
);

const PHASE_SHORT: Record<string, string> = {
  Intake: 'Intake',
  Qualify: 'Qualify',
  Seed: 'Seed',
  Trade: 'Trade',
  Decide: 'Decide',
  Housekeeping: 'House',
};

export interface KernelDialProps {
  epochLength: number;
  /** Current block within the epoch, in `[0, epochLength)`. */
  blockInEpoch: number;
  epochIndex: number;
  decWindowBlocks?: number;
  size?: number;
  /** `nav` is ticks only; `section` adds boundary labels and a readout. */
  variant?: 'nav' | 'section';
  /** Dead-man engaged: the clock stops and the index becomes a double seam. */
  paused?: boolean;
  frozen?: boolean;
}

const polar = (angleDeg: number, r: number): [number, number] => {
  // 0 degrees at the top, increasing clockwise.
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
};

/** Rings the phase names may sit on, as a fraction of the dial radius. */
const LABEL_RINGS = [0.83, 0.6, 0.37] as const;

/** Type metrics for `.dial__phaselabel`, in viewBox units. */
const LABEL_EM = 6;
const LABEL_ADVANCE = 0.56;
const LABEL_GAP = 1.5;

/**
 * Half-diagonal of the centre readout (`.dial__center`, 16px in viewBox units),
 * plus clearance.
 */
const CENTRE_KEEPOUT = 12;

/**
 * Which ring each phase name sits on.
 *
 * Three of the six phases own a single tick of twenty-one — Qualify, Seed and
 * Housekeeping — which is 17.1 degrees of arc. At the outer ring that is about
 * 12 units of arc length for a name that needs roughly 24, so a name on a narrow
 * arc always overruns its neighbours. Qualify and Seed are *adjacent* single-tick
 * arcs, so at one radius they overlap outright: an automated sweep of the app
 * found exactly that pair printed on top of each other.
 *
 * The rule is resolution, not a heuristic. Each name is given the outermost ring
 * on which its box clears every name already placed; the boxes are the real
 * ones, computed from the ring, the arc's midpoint angle and the name's own
 * length. A width-based approximation was tried first and left a two-pixel
 * corner clip between `Decide` and `House` — close enough to look deliberate,
 * which is worse than obvious.
 *
 * Names are placed longest-first so the one that most needs the outer ring gets
 * the first claim on it, rather than whichever phase happens to come first in
 * the epoch.
 *
 * The centre readout gets its own rule. Names and the epoch number are both
 * fixed now, so one check would be enough — but the keep-out is written radially
 * anyway, because it is the property that survives any future decision to let
 * the scale move again, and it costs nothing to state it that way.
 *
 * A name with no usable ring returns `0`, and the caller does not draw it. That
 * is the correct outcome rather than a failure: the dial is 96px across, the
 * phase table beside it names all six in full, and an unreadable name printed
 * over the epoch number teaches less than no name at all.
 */
export function labelRadii(
  spans: readonly number[],
  names: readonly string[],
  dialRadius = 50,
): number[] {
  interface Box {
    cx: number;
    cy: number;
    hw: number;
    hh: number;
  }
  const boxAt = (i: number, ring: number): Box => {
    const from = spans.slice(0, i).reduce((a, b) => a + b, 0);
    const total = spans.reduce((a, b) => a + b, 0);
    const midDeg = ((from + (spans[i] ?? 0) / 2) / total) * 360;
    const [cx, cy] = polar(midDeg, dialRadius * ring);
    const text = names[i] ?? '';
    return {
      cx,
      cy,
      hw: (text.length * LABEL_ADVANCE * LABEL_EM) / 2 + LABEL_GAP,
      hh: LABEL_EM / 2 + LABEL_GAP / 2,
    };
  };
  const hits = (a: Box, b: Box) =>
    Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;

  const order = names.map((_, i) => i).sort((a, b) => {
    const byLength = (names[b] ?? '').length - (names[a] ?? '').length;
    return byLength !== 0 ? byLength : a - b;
  });

  const placed: Box[] = [];
  const out = new Array<number>(spans.length).fill(0);
  for (const i of order) {
    for (const ring of LABEL_RINGS) {
      const box = boxAt(i, ring);
      // Radial keep-out first: it holds at every rotation, so a ring that fails
      // it can never be made to work by waiting.
      if (dialRadius * ring - box.hw < CENTRE_KEEPOUT) continue;
      if (placed.some((p) => hits(p, box))) continue;
      out[i] = ring;
      placed.push(box);
      break;
    }
  }
  return out;
}

function arcPath(fromDeg: number, toDeg: number, rOuter: number, rInner: number): string {
  const sweep = toDeg - fromDeg;
  const large = sweep > 180 ? 1 : 0;
  const [x1, y1] = polar(fromDeg, rOuter);
  const [x2, y2] = polar(toDeg, rOuter);
  const [x3, y3] = polar(toDeg, rInner);
  const [x4, y4] = polar(fromDeg, rInner);
  return [
    `M${x1} ${y1}`,
    `A${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L${x3} ${y3}`,
    `A${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

export function KernelDial({
  epochLength,
  blockInEpoch,
  epochIndex,
  decWindowBlocks = 43_200,
  size = 96,
  variant = 'section',
  paused = false,
  frozen = false,
}: KernelDialProps) {
  const uid = useId();
  const arcs = phaseArcs(epochLength);
  const window = decideWindowArc(epochLength, decWindowBlocks);
  const phase = phaseAt(blockInEpoch, epochLength);
  const progress = epochLength === 0 ? 0 : blockInEpoch / epochLength;
  const nowAngle = progress * 360;

  const R = 50;
  const rOuter = R;
  const rInner = R * 0.66;
  const rBand = R * 0.6;
  const rBandInner = R * 0.5;
  const isNav = variant === 'nav';

  const radii = labelRadii(
    arcs.map((a) => a.toTick - a.fromTick),
    arcs.map((a) => PHASE_SHORT[a.phase] ?? a.phase),
    R,
  );

  // Distance to the next *phase* boundary, not to the end of the epoch. The two
  // coincide only inside Housekeeping, so announcing the epoch remainder as "the
  // next boundary" would be wrong for twenty of the twenty-one ticks — and wrong
  // in the one channel a screen-reader user has.
  const blocksPerTick = epochLength / TICK_COUNT;
  const nextBoundaryTick =
    arcs.find((a) => blockInEpoch < a.toTick * blocksPerTick)?.toTick ?? TICK_COUNT;
  const remaining = Math.max(0, Math.round(nextBoundaryTick * blocksPerTick - blockInEpoch));

  return (
    <div
      className={`dial dial--${variant}${paused ? ' dial--paused' : ''}${frozen ? ' dial--frozen' : ''}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="-60 -60 120 120"
        className="dial__svg"
        role="img"
        aria-label={`Epoch ${epochIndex}, phase ${phase}, ${formatBlocks(remaining)} to the next boundary, about ${formatDurationHuman(remaining)}.`}
      >
        {/* The scale. It does not move; the hand below does. */}
        <g className="dial__scale">
          {/* Phase arcs. Elapsed reads solid; ahead reads as outline. */}
          {arcs.map((a) => {
            const elapsed = a.toAngleDeg <= nowAngle;
            const current = a.fromAngleDeg <= nowAngle && nowAngle < a.toAngleDeg;
            return (
              <path
                key={a.phase}
                d={arcPath(a.fromAngleDeg, a.toAngleDeg, rOuter, rInner)}
                className={`dial__arc${elapsed ? ' is-elapsed' : ''}${current ? ' is-current' : ''}`}
              />
            );
          })}

          {/* The decision-window accrual band: an overlay inside Trade, not a
              wedge of its own. At a non-default dec.window its ticks are
              fractional, and that is correct. */}
          <path
            d={arcPath(window.fromAngleDeg, window.toAngleDeg, rBand, rBandInner)}
            className="dial__window"
          />

          {/* 21 teeth. The seven boundary edges are full-depth grooves. */}
          {Array.from({ length: TICK_COUNT }, (_, i) => {
            const angle = i * DEGREES_PER_TICK;
            const boundary = BOUNDARY_TICKS.has(i);
            const depth = boundary ? R * 0.22 : R * 0.11;
            const [x1, y1] = polar(angle, rOuter);
            const [x2, y2] = polar(angle, rOuter - depth);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={`dial__tick${boundary ? ' is-boundary' : ''}`}
              />
            );
          })}

          {/* Phase names, counter-rotated so they stay upright.
              Staggered by radius — see `labelRadii`. */}
          {!isNav
            ? arcs.map((a, i) => {
                const ring = radii[i] ?? 0;
                // Ring 0 means "no ring cleared" — the name is dropped, never
                // overlapped. The phase table beside the dial carries all six.
                if (ring === 0) return null;
                const mid = (a.fromAngleDeg + a.toAngleDeg) / 2;
                const [lx, ly] = polar(mid, R * ring);
                return (
                  <text
                    key={`l-${a.phase}`}
                    x={lx}
                    y={ly}
                    className="dial__phaselabel"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {PHASE_SHORT[a.phase] ?? a.phase}
                  </text>
                );
              })
            : null}
        </g>

        {/* The hand. It rotates about the dial's centre — (0,0) in this viewBox,
            so the transform origin has to be stated; the CSS default of
            `50% 50%` resolves against the bounding box and would swing it off
            axis. Under a dead-man pause it becomes a double seam and stops. */}
        <g
          className="dial__index"
          style={{ transform: `rotate(${nowAngle}deg)`, transformOrigin: '0px 0px' }}
        >
          <line x1={0} y1={-R - 6} x2={0} y2={-rInner + 2} className="dial__seam" />
          {paused ? (
            <line
              x1={3}
              y1={-R - 6}
              x2={3}
              y2={-rInner + 2}
              className="dial__seam dial__seam--alarm"
            />
          ) : null}
          <path d={`M-4 ${-R - 6} L4 ${-R - 6} L0 ${-R + 2} Z`} className="dial__pointer" />
        </g>

        {!isNav ? (
          <text
            x={0}
            y={4}
            className="dial__center mono"
            textAnchor="middle"
            id={`${uid}-center`}
          >
            {epochIndex}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

/** The dial's readout: blocks and human time, always together. */
export function DialReadout({
  epochLength,
  blockInEpoch,
  epochIndex,
  paused = false,
}: {
  epochLength: number;
  blockInEpoch: number;
  epochIndex: number;
  paused?: boolean;
}) {
  const phase = phaseAt(blockInEpoch, epochLength);
  const arcs = phaseArcs(epochLength);
  const current = arcs.find(
    (a) =>
      blockInEpoch >= (a.fromTick * epochLength) / TICK_COUNT &&
      blockInEpoch < (a.toTick * epochLength) / TICK_COUNT,
  );
  const boundary =
    current !== undefined ? (current.toTick * epochLength) / TICK_COUNT : epochLength;
  const remaining = Math.max(0, Math.round(boundary - blockInEpoch));

  return (
    <div className="dial-readout">
      <span className="label">Epoch</span>
      <span className="mono dial-readout__epoch">{epochIndex}</span>
      <span className="dial-readout__phase">{phase}</span>
      {paused ? (
        <span className="alarm dial-readout__paused">clock paused — dead-man engaged</span>
      ) : (
        <span className="dial-readout__count">
          {/* Blocks and human time always appear together: the chain measures in
              blocks, but nobody plans in them. */}
          <span className="mono">{formatBlocks(remaining)}</span>
          <span className="dial-readout__sep">·</span>
          {formatDurationHuman(remaining)} to{' '}
          <span className="dial-readout__next">next boundary</span>
        </span>
      )}
    </div>
  );
}
