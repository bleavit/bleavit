import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { Group } from 'three';
import type { TurningClockProps } from '../../motion';
import { Lights, Raked, Tag, mixColor, useFitZoom, usePalette } from '../kit';

/**
 * The epoch, as the cycle it actually is.
 *
 * The flat diagram shows the epoch as a ruler with six spans marked on it, which
 * is the right way to read a deadline off. What a ruler cannot show is that the
 * thing wraps — that Housekeeping is adjacent to Intake, that a proposal missing
 * a window waits nearly a whole turn for the next one, and that while this epoch
 * trades, the two behind it are still being measured. A cycle wants a circle, and
 * three concurrent cycles want an axis to be concurrent along.
 *
 * The 21 teeth are not styling: phase boundaries are kernel fractions with
 * denominator 21, so every boundary lands on an integer tooth at any legal epoch
 * length. Reading a boundary off the dial and reading it off the spec is the same
 * act.
 */

const TICKS = 21;
const R_INNER = 3.1;
const R_OUTER = 5.0;
/* The decision window is a tongue that reaches inward from the ring, overlapping
   its inner edge. Two earlier attempts read wrong: free-floating in the hole it
   looked like a separate seventh phase, and flush against the inner wall it was
   swallowed whole the moment Trade lifted. It has to touch the ring — it lies
   inside Trade — and it has to stay clear of the lift. */
const R_BAND_IN = 2.3;
const R_BAND_OUT = 3.2;
const RING_DEPTH = 0.34;
const LIFT = 0.62;
/* Steep enough that the ring reads as a disc lying on a table rather than as an
   ellipse, shallow enough that the stack below it still separates. */
const TILT = 0.62;
/* The drawing's centre sits below the live ring, because two dimmer epochs hang
   beneath it. Framing on the live ring alone would crop the stack, which is the
   whole reason this is three-dimensional. */
const OFFSET = [0, 0.7] as const;

/**
 * Tick 0 at the **near** edge, increasing clockwise seen from above.
 *
 * Near rather than far, which is the opposite of a wall clock and the right way
 * round for a dial lying on a bench: the index stands at the edge closest to the
 * reader, where the arcs are least foreshortened and the lifted phase is not
 * hiding behind the ring's own far wall.
 */
const ang = (tick: number): number => -Math.PI / 2 + (tick * Math.PI * 2) / TICKS;

/**
 * An annular sector, extruded.
 *
 * Built as a shape rather than a `RingGeometry` because the arc has to have
 * thickness: an epoch phase is a span of time, and a span drawn as a zero-height
 * ribbon has nothing to lift when it becomes the active one.
 */
function arcGeometry(from: number, to: number, rIn: number, rOut: number, depth: number) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, ang(from), ang(to), false);
  s.absarc(0, 0, rIn, ang(to), ang(from), true);
  return new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: false,
    curveSegments: 64,
  });
}

function Arc({
  from,
  to,
  rIn,
  rOut,
  depth,
  color,
  opacity,
  y,
}: {
  from: number;
  to: number;
  rIn: number;
  rOut: number;
  depth: number;
  color: string;
  opacity: number;
  y: number;
}) {
  const geo = useMemo(
    () => arcGeometry(from, to, rIn, rOut, depth),
    [from, to, rIn, rOut, depth],
  );
  // Dispose is left to three's own cache here: the geometry is memoised on its
  // own inputs and a dial has six of them.
  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
      <meshLambertMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

/** One turn of the dial: the six phases, the decision band, and 21 teeth. */
function Face({
  arcs,
  activePhase,
  decideWindow,
  palette,
  dim,
  showTeeth,
}: {
  arcs: TurningClockProps['arcs'];
  activePhase: string;
  decideWindow: TurningClockProps['decideWindow'];
  palette: ReturnType<typeof usePalette>;
  dim: number;
  /** Ghost rings drop their graduations: 42 ghosted teeth is noise, not depth. */
  showTeeth: boolean;
}) {
  /**
   * Twenty-one teeth, each lying radially on the rim.
   *
   * Radial, not parallel: a ring of identically-oriented blocks reads as a
   * picket fence standing near a disc rather than as the disc's own graduations,
   * which is what the first version looked like. A tooth belongs to the ring, so
   * it points the way the ring does at that angle.
   */
  const teeth = useMemo(
    () =>
      Array.from({ length: TICKS }, (_, i) => {
        const a = ang(i);
        return {
          x: Math.cos(a) * (R_OUTER + 0.18),
          z: -Math.sin(a) * (R_OUTER + 0.18),
          // Three's +Y rotation runs the other way round from the shape-space
          // angle, so the sign is flipped once here rather than in five places.
          spin: -a,
        };
      }),
    [],
  );

  return (
    <group>
      {arcs.map((a) => {
        const active = a.name === activePhase;
        return (
          <group key={a.name}>
            <Arc
              from={a.fromTick}
              to={a.toTick}
              rIn={R_INNER}
              rOut={R_OUTER}
              depth={RING_DEPTH + (active ? LIFT : 0)}
              color={active ? palette.accent : mixColor(palette.well, palette.accent, 0.22)}
              opacity={(active ? 0.96 : 0.8) * dim}
              y={0}
            />
            {/* The lifted arc gets its own rim so the step up reads as a step. */}
            {active ? (
              <Arc
                from={a.fromTick}
                to={a.toTick}
                rIn={R_INNER - 0.16}
                rOut={R_OUTER + 0.16}
                depth={0.06}
                color={palette.accent}
                opacity={0.9 * dim}
                y={RING_DEPTH + LIFT}
              />
            ) : null}
          </group>
        );
      })}

      {/* The decision window: an overlay inside Trade, not a seventh phase. */}
      <Arc
        from={decideWindow.fromTick}
        to={decideWindow.toTick}
        rIn={R_BAND_IN}
        rOut={R_BAND_OUT}
        depth={RING_DEPTH * 1.1}
        color={palette.judge}
        opacity={0.85 * dim}
        y={0}
      />

      {(showTeeth ? teeth : []).map((t, i) => (
        <mesh key={i} position={[t.x, RING_DEPTH * 0.55, t.z]} rotation={[0, t.spin, 0]}>
          <boxGeometry args={[0.62, 0.14, 0.1]} />
          <meshLambertMaterial
            color={i === 0 ? palette.ink : palette.dim}
            transparent
            opacity={(i === 0 ? 0.95 : 0.75) * dim}
          />
        </mesh>
      ))}
    </group>
  );
}

export function TurningClock(props: TurningClockProps) {
  const { epochLength, blockInEpoch, arcs, activePhase, decideWindow, stopped } = props;
  const palette = usePalette();
  const zoom = useFitZoom(12.6, 12.0);
  const ring = useRef<Group>(null);

  /** Where the block cursor sits, in ticks. */
  const cursorTick = epochLength === 0 ? 0 : (blockInEpoch / epochLength) * TICKS;

  /**
   * The ring turns; the index does not.
   *
   * Same decision as the 2D dial, for a different reason. There the scale had to
   * hold still because rotating labels collide at angles nobody looked at. Here
   * there are no labels on the ring, and turning it is the entire point: a clock
   * whose face moves under a fixed hand is what makes "the epoch is passing"
   * something you see rather than read.
   */
  const target = useRef(0);
  useFrame((_, dt) => {
    if (ring.current === null) return;
    target.current = -(cursorTick * Math.PI * 2) / TICKS;
    const cur = ring.current.rotation.y;
    // Shortest way round, so a wrap at the epoch boundary does not unwind 21
    // ticks backwards through the whole year.
    let delta = target.current - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    ring.current.rotation.y = cur + delta * (1 - Math.exp(-(stopped ? 12 : 5) * dt));
  });

  const past = [1, 2];

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 0, 60]} zoom={zoom} near={-400} far={800} />
      <Lights palette={palette} />

      <Raked tilt={TILT} offset={OFFSET}>
        {/* The epochs behind this one, still being measured. Two of them,
            because the measurement horizon is k = 2: three cohorts are always in
            flight, which is a fact about depth and reads as one. */}
        {past.map((n) => (
          <group key={n} position={[0, -n * 1.55, 0]} scale={1 - n * 0.06}>
            <Face
              arcs={arcs}
              activePhase=""
              decideWindow={decideWindow}
              palette={palette}
              dim={0.62 - n * 0.12}
              showTeeth={false}
            />
          </group>
        ))}

        <group ref={ring}>
          <Face
            arcs={arcs}
            activePhase={activePhase}
            decideWindow={decideWindow}
            palette={palette}
            dim={1}
            showTeeth
          />
        </group>

        {/* The fixed index — the same vertical seam the mark is split by, and
            the same line the 2D dial draws. One idea, three sizes. */}
        <mesh position={[0, RING_DEPTH + LIFT + 0.3, R_OUTER + 0.95]}>
          <boxGeometry args={[0.16, 0.16, 1.6]} />
          <meshLambertMaterial color={palette.ink} />
        </mesh>
        <Line
          points={[
            [0, RING_DEPTH + LIFT + 0.3, R_OUTER + 0.3],
            [0, -3.5, R_OUTER + 0.3],
          ]}
          color={palette.ink}
          lineWidth={1}
          transparent
          opacity={0.35}
        />

        <Tag position={[0, RING_DEPTH + LIFT + 1.1, R_OUTER + 1.4]}>
          {stopped ? `${activePhase} — clock held` : activePhase}
        </Tag>
        <Tag position={[-(R_OUTER + 1.4), -3.4, 0]} tone="dim">
          still being measured
        </Tag>
      </Raked>
    </>
  );
}
