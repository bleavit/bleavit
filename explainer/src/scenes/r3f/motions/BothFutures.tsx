import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Line, OrthographicCamera } from '@react-three/drei';
import type { Group, Mesh } from 'three';
import type { BothFuturesProps } from '../../motion';
import { Lights, Raked, Tag, approach, useFitZoom, usePalette } from '../kit';

/**
 * One deposit, two futures, both real at once.
 *
 * The flat diagram draws the two branches side by side, which is the clearest
 * way to compare their instrument tables — and it is also the one thing about
 * this mechanism that a reader reliably gets wrong. Side by side reads as *a
 * choice between them*. It is not a choice: `split` mints a full unit of the
 * ACCEPT world and a full unit of the REJECT world from the same dollar, and
 * both are genuinely outstanding claims until the decision resolves. Simultaneity
 * needs an axis to be simultaneous along, and here it gets one: the deposit
 * arrives on the centre line and leaves in two directions at the same instant.
 *
 * What resolution does is the second thing this shows and the flat view cannot.
 * The losing branch is **frozen, not burned** — its tokens stay exactly where
 * they are, cased and unspendable, because a burn would be a supply change and
 * this ledger never has one. You watch them stop rather than vanish.
 */

const SHEET_Y = 2.6;
const LANE_FROM = -5.3;
const LANE_TO = 4.3;
const UNITS = 7;
/** Fraction of a unit's journey spent before the split. */
const SPLIT_AT = 0.42;
const SPEED = 0.19;
/* Shallow on purpose. The two sheets are stacked vertically and that stack is
   the claim, so raking hard would foreshorten the one axis carrying the meaning;
   the spin is what gives the sheets visible thickness. */
const TILT = 0.24;
const SPIN = 0.2;
const OFFSET = [-0.5, 0] as const;

function Sheet({
  y,
  color,
  label,
  dim,
}: {
  y: number;
  color: string;
  label: string;
  dim: number;
}) {
  return (
    <group position={[0, y, 0]}>
      <mesh>
        <boxGeometry args={[12, 0.12, 4.6]} />
        <meshLambertMaterial color={color} transparent opacity={0.16 * dim} />
        <Edges lineWidth={1.4} threshold={15} color={color} transparent opacity={0.55 * dim} />
      </mesh>
      <Line
        points={[
          [-6, 0.09, 0],
          [6, 0.09, 0],
        ]}
        color={color}
        lineWidth={1.6}
        transparent
        opacity={0.5 * dim}
      />
      <Tag position={[-4.6, 0.55, 0]} tone={y > 0 ? 'accept' : 'reject'}>
        {label}
      </Tag>
    </group>
  );
}

/** One escrowed dollar, on its way to being two claims. */
function Unit({
  index,
  palette,
  running,
}: {
  index: number;
  palette: ReturnType<typeof usePalette>;
  running: boolean;
}) {
  const pre = useRef<Mesh>(null);
  const up = useRef<Mesh>(null);
  const down = useRef<Mesh>(null);
  const held = useRef((index / UNITS) % 1);

  useFrame((state, dt) => {
    if (running) held.current = (state.clock.elapsedTime * SPEED + index / UNITS) % 1;
    const u = held.current;
    const before = u < SPLIT_AT;
    if (pre.current !== null) {
      pre.current.visible = before;
      const t = u / SPLIT_AT;
      pre.current.position.x = LANE_FROM + (0 - LANE_FROM) * t;
    }
    // Both halves move on the same clock, from the same point, in the same
    // frame. That is the whole claim, and it is enforced by construction here
    // rather than by two animations that happen to be started together.
    const t = (u - SPLIT_AT) / (1 - SPLIT_AT);
    const x = 0 + (LANE_TO - 0) * t;
    const ease = t * t * (3 - 2 * t);
    for (const [ref, sign] of [
      [up, 1],
      [down, -1],
    ] as const) {
      if (ref.current === null) continue;
      ref.current.visible = !before;
      ref.current.position.x = x;
      ref.current.position.y = sign * SHEET_Y * ease;
      // Frozen mid-air is the honest picture of a ledger freeze: nothing is
      // lost, nothing moves.
      ref.current.rotation.y = approach(ref.current.rotation.y, running ? t * 2.2 : 0, 3, dt);
    }
  });

  return (
    <group>
      <mesh ref={pre} position={[LANE_FROM, 0, 0]}>
        <boxGeometry args={[0.46, 0.46, 0.46]} />
        <meshLambertMaterial color={palette.ink} transparent opacity={0.92} />
      </mesh>
      <mesh ref={up} position={[0, 0, 0]}>
        <boxGeometry args={[0.44, 0.44, 0.44]} />
        <meshLambertMaterial color={palette.accept} />
      </mesh>
      <mesh ref={down} position={[0, 0, 0]}>
        <boxGeometry args={[0.44, 0.44, 0.44]} />
        <meshLambertMaterial color={palette.reject} />
      </mesh>
    </group>
  );
}

/** What has already landed on a sheet, as a column of units. */
function Landed({
  y,
  color,
  units,
  frozen,
  realized,
}: {
  y: number;
  color: string;
  units: number;
  frozen: boolean;
  realized: boolean;
}) {
  const group = useRef<Group>(null);
  // Four, not six: a taller column ran past the frame and said nothing extra.
  const bars = useMemo(() => Array.from({ length: 4 }, (_, i) => i), []);
  const target = Math.max(0, Math.min(4, Math.round(units)));

  useFrame((_, dt) => {
    if (group.current === null) return;
    group.current.scale.y = approach(group.current.scale.y, realized ? 1.12 : 1, 4, dt);
  });

  return (
    <group ref={group} position={[LANE_TO + 0.95, y, 0]}>
      {bars.map((i) => (
        <mesh
          key={i}
          position={[0, (y > 0 ? 1 : -1) * (0.3 + i * 0.44), 0]}
          visible={i < target}
        >
          <boxGeometry args={[0.86, 0.36, 0.86]} />
          {frozen ? (
            <meshLambertMaterial color={color} transparent opacity={0.14} wireframe />
          ) : (
            <meshLambertMaterial color={color} transparent opacity={realized ? 0.98 : 0.8} />
          )}
          {frozen ? <Edges lineWidth={1.2} threshold={15} color={color} /> : null}
        </mesh>
      ))}
    </group>
  );
}

export function BothFutures(props: BothFuturesProps) {
  const { acceptUnits, rejectUnits, resolved, voided, frozen } = props;
  const palette = usePalette();
  const zoom = useFitZoom(14.2, 12.6);

  const acceptFrozen = resolved === 'Reject' && !voided;
  const rejectFrozen = resolved === 'Accept' && !voided;
  const running = !frozen && resolved === null;

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 0, 60]} zoom={zoom} near={-400} far={800} />
      <Lights palette={palette} />

      <Raked tilt={TILT} spin={SPIN} offset={OFFSET}>
        <Sheet
          y={SHEET_Y}
          color={palette.accept}
          label="if it passes"
          dim={acceptFrozen ? 0.4 : 1}
        />
        <Sheet
          y={-SHEET_Y}
          color={palette.reject}
          label="if it is rejected"
          dim={rejectFrozen ? 0.4 : 1}
        />

        {/* The deposit lane. One dollar in, on the centre line, belonging to
          neither branch until it splits. */}
        <mesh position={[-0.4, -0.08, 0]}>
          <boxGeometry args={[10.6, 0.08, 1.4]} />
          <meshLambertMaterial color={palette.well} transparent opacity={0.5} />
          <Edges lineWidth={1} threshold={15} color={palette.line} />
        </mesh>

        {Array.from({ length: UNITS }, (_, i) => (
          <Unit key={i} index={i} palette={palette} running={running} />
        ))}

        <Landed
          y={SHEET_Y}
          color={palette.accept}
          units={acceptUnits}
          frozen={acceptFrozen}
          realized={resolved === 'Accept' || voided}
        />
        <Landed
          y={-SHEET_Y}
          color={palette.reject}
          units={rejectUnits}
          frozen={rejectFrozen}
          realized={resolved === 'Reject' || voided}
        />

        {/* Hold one of each and they merge back into the dollar you started with.
          Drawn as the tie that spans both sheets, because that is what it is. */}
        <Line
          points={[
            [LANE_TO + 0.95, SHEET_Y + 0.3, 0],
            [LANE_TO + 0.95, -SHEET_Y - 0.3, 0],
          ]}
          color={palette.ink}
          lineWidth={1.2}
          dashed
          dashSize={0.22}
          gapSize={0.18}
          transparent
          opacity={0.5}
        />

        <Tag position={[LANE_FROM + 0.5, 0.85, 0]}>one dollar in</Tag>
        <Tag position={[LANE_TO + 0.95, 0.62, 0]} tone="dim">
          a matched pair merges to par
        </Tag>
      </Raked>
    </>
  );
}
