import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Line, PerspectiveCamera } from '@react-three/drei';
import type { Group, Mesh } from 'three';
import type { CorridorProps, CorridorVerdict } from '../../motion';
import { Lights, Raked, Tag, approach, usePalette } from '../kit';

/**
 * Eleven checks in a fixed order, drawn as a distance.
 *
 * The flat diagram is an ordered checklist, which is the right shape for reading
 * *what* each step tests. The one thing a checklist is bad at is the fact the
 * whole design turns on: the order is normative, evaluation stops dead at the
 * first failure, and everything below it is never evaluated at all. A list makes
 * that a property of eleven rows the reader has to hold in their head. A corridor
 * makes it the first thing you see — how far the proposal travelled before
 * something shut in front of it.
 *
 * This is the only motion in the app that uses a perspective camera, and the
 * reason is a rule rather than a preference: perspective makes equal things at
 * different depths render at different sizes, so it is forbidden anywhere a size
 * is a quantity. Nothing here is a quantity. The eleven gates are ordinal, the
 * spacing between them is arbitrary, and the only measurement is "which one" —
 * so depth cues cost nothing and buy the corridor.
 */

const GAP = 2.35;
const START_Z = 3.4;
const TRAVEL_PER_GATE = 0.42;
const HOLD_SECONDS = 2.6;

function verdictColor(v: CorridorVerdict, p: ReturnType<typeof usePalette>): string {
  switch (v) {
    case 'pass':
      return p.accept;
    case 'extend':
      return p.judge;
    case 'reject':
      return p.alarm;
    case 'skip':
      return p.dim;
    default:
      return p.line;
  }
}

/** How far each leaf slides aside. A skipped check is open but not lit. */
function leafOpen(v: CorridorVerdict): number {
  return v === 'pass' || v === 'skip' || v === 'extend' ? 1.42 : 0.4;
}

function Gate({
  step,
  z,
  palette,
  reached,
}: {
  step: CorridorProps['steps'][number];
  z: number;
  palette: ReturnType<typeof usePalette>;
  reached: boolean;
}) {
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  const color = verdictColor(step.verdict, palette);
  const open = leafOpen(step.verdict);
  const lit = step.verdict === 'pass' || step.verdict === 'extend';

  useFrame((_, dt) => {
    // Leaves only move once the proposal has arrived. A gate that opens before
    // anything reaches it would say the checks run in advance, and they do not.
    const want = reached ? open : 0.4;
    if (left.current !== null) {
      left.current.position.x = approach(left.current.position.x, -want, 7, dt);
    }
    if (right.current !== null) {
      right.current.position.x = approach(right.current.position.x, want, 7, dt);
    }
  });

  return (
    <group position={[0, 0, z]}>
      {/* The frame. Thin: eleven of these are stacked into the same picture,
          and a heavy one turns the row into a hedge. */}
      {[
        [0, 2.32, 3.2, 0.12],
        [0, -0.02, 3.2, 0.12],
        [-1.54, 1.15, 0.12, 2.34],
        [1.54, 1.15, 0.12, 2.34],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x as number, y as number, 0]}>
          <boxGeometry args={[w as number, h as number, 0.22]} />
          <meshLambertMaterial
            color={reached ? color : palette.line}
            transparent
            opacity={reached ? 0.95 : 0.55}
          />
        </mesh>
      ))}

      {/* The two leaves. An open leaf is drawn almost away, because a row of
          eleven translucent panels reads as glass, not as openings — the first
          build stacked them into an unreadable green wall. Shut is what has to
          be solid, and only the gate that stopped the run is shut hard. */}
      {[left, right].map((ref, i) => (
        <mesh key={i} ref={ref} position={[i === 0 ? -0.4 : 0.4, 1.15, 0]}>
          <boxGeometry args={[1.4, 2.1, 0.1]} />
          <meshLambertMaterial
            color={color}
            transparent
            opacity={step.verdict === 'reject' ? 0.94 : reached ? 0.1 : 0.5}
          />
          <Edges
            lineWidth={1.1}
            threshold={15}
            color={color}
            transparent
            opacity={step.verdict === 'reject' ? 0.95 : reached ? 0.2 : 0.6}
          />
        </mesh>
      ))}

      {/* A floor pip per gate: the eleven checks, countable from outside. */}
      <mesh position={[0, 0.06, 0.42]}>
        <boxGeometry args={[0.44, 0.08, 0.14]} />
        <meshLambertMaterial
          color={lit && reached ? color : palette.line}
          transparent
          opacity={reached ? 0.95 : 0.45}
        />
      </mesh>
    </group>
  );
}

export function Corridor({ steps, haltedAt, outcome }: CorridorProps) {
  const palette = usePalette();
  const token = useRef<Group>(null);
  const reachedTo = useRef(0);

  /** The gate it stops at, or one past the end when it runs clean. */
  const stopIndex = haltedAt !== null ? haltedAt - 1 : steps.length;
  const endZ = -stopIndex * GAP + (haltedAt !== null ? 1.35 : -2.6);
  const travel = Math.max(0.9, (stopIndex + 1) * TRAVEL_PER_GATE);
  const cycle = travel + HOLD_SECONDS;

  useFrame((state, dt) => {
    const u = (state.clock.elapsedTime % cycle) / cycle;
    const t = Math.min(1, u / (travel / cycle));
    // Ease out into the stop: a halt is a stop, not a bounce.
    const eased = 1 - Math.pow(1 - t, 3);
    const z = START_Z + (endZ - START_Z) * eased;
    if (token.current !== null) {
      token.current.position.z = z;
      token.current.position.y = approach(token.current.position.y, 1.2, 6, dt);
      token.current.rotation.y += dt * 0.55;
    }
    reachedTo.current = z;
  });

  const gates = useMemo(() => steps.map((s, i) => ({ step: s, z: -i * GAP })), [steps]);

  const halted = haltedAt !== null ? steps[haltedAt - 1] : undefined;
  /** Half the run, so the spin turns the row about its own centre. */
  const PIVOT = ((steps.length - 1) * GAP) / 2;

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 24]} fov={36} near={0.1} far={140} />
      <Lights palette={palette} />
      {/* Depth cue, not decoration: without it the far gates read as small
          rather than distant, which is the one thing this drawing must not say. */}
      <fog attach="fog" args={[palette.ground, 22, 54]} />

      {/*
        A receding row, seen from beside it — not a tunnel seen from inside.
        Head-on was the obvious composition and it destroyed the thing this
        motion exists to show: eleven frames on one axis stack into a single
        outline, and the gate that stopped the run is hidden behind the ones in
        front of it. Turned a third of a radian, the row separates and "how far
        it got" is a length you read at a glance.

        The spin pivots about the row's *middle* rather than its first gate,
        which is what `PIVOT` is for. Spinning about the entrance would swing the
        far end nine units sideways and out of frame.
      */}
      <Raked tilt={0.15} spin={0.32} offset={[-1.2, 0.25]}>
        <group position={[0, 0, PIVOT]}>
        {/* The floor. */}
        <mesh
          position={[0, -0.12, -((steps.length - 1) * GAP) / 2 + 1]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[5.4, steps.length * GAP + 10]} />
          <meshLambertMaterial color={palette.well} transparent opacity={0.55} />
        </mesh>
        <Line
          points={[
            [0, 0.02, START_Z + 1],
            [0, 0.02, -steps.length * GAP],
          ]}
          color={palette.line}
          lineWidth={1}
          transparent
          opacity={0.6}
        />

        {gates.map((g, i) => (
          <Gate
            key={g.step.n}
            step={g.step}
            z={g.z}
            palette={palette}
            reached={i <= stopIndex}
          />
        ))}

        {/* The proposal. A slab, notched by class in the flat diagram; here it is
          just the thing that is travelling. */}
        <group ref={token} position={[0, 1.2, START_Z]}>
          <mesh>
            <boxGeometry args={[0.72, 0.72, 0.2]} />
            <meshLambertMaterial
              color={outcome === 'Reject' ? palette.alarm : palette.ink}
              emissive={outcome === 'Reject' ? palette.alarm : palette.ink}
              emissiveIntensity={0.18}
            />
            <Edges lineWidth={1.6} threshold={15} color={palette.ink} />
          </mesh>
        </group>

        {halted !== undefined ? (
          <Tag position={[0, 2.95, -(haltedAt! - 1) * GAP]} tone="alarm">
            {`stopped at ${halted.n} · ${halted.name}`}
          </Tag>
        ) : (
          <Tag position={[0, 2.95, -(steps.length - 1) * GAP]} tone="accept">
            {outcome === 'pending' ? 'not run yet' : `all eleven cleared · ${outcome}`}
          </Tag>
        )}
        </group>
      </Raked>
    </>
  );
}
